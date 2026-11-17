use glancespace_lib::scan::{Metric, Query, Scan};
use std::{
    fs, thread,
    time::{Duration, Instant},
};

fn finished(scan: &Scan) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !scan.progress().terminal() {
        assert!(Instant::now() < deadline, "scan did not terminate");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn aggregates_nested_files_once_and_filters_without_changing_totals() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("first.txt"), b"abc").unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/second.bin"), b"12345").unwrap();
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    let progress = scan.progress();
    assert_eq!(progress.phase, "completed");
    assert_eq!(progress.logical_size, 8);
    assert_eq!(progress.files, 2);
    assert_eq!(progress.errors, 0);
    let all = scan.children(Query::new(0)).unwrap();
    assert_eq!(all.total, 2);
    assert_eq!(all.items.iter().map(|n| n.logical_size).sum::<u64>(), 8);
    let nested = all.items.iter().find(|n| n.name == "nested").unwrap();
    assert!(nested.is_dir);
    assert_eq!(
        scan.children(Query::new(nested.id)).unwrap().items[0].name,
        "second.bin"
    );
    let mut query = Query::new(0);
    query.pattern = "*.TXT".into();
    query.metric = Metric::Logical;
    assert_eq!(scan.children(query).unwrap().items.len(), 1);
    assert_eq!(scan.progress().logical_size, 8);
    assert!(scan.view(0, Metric::Logical).unwrap().items.len() <= 5000);
}

#[test]
fn pause_blocks_work_and_cancel_wakes_a_paused_worker() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("keep.txt"), b"keep").unwrap();
    let scan = Scan::new(root.path()).unwrap();
    scan.set_paused(true).unwrap();
    scan.spawn(|_| {}).unwrap();
    thread::sleep(Duration::from_millis(80));
    assert_eq!(scan.progress().phase, "paused");
    assert_eq!(scan.progress().files, 0);
    scan.cancel().unwrap();
    finished(&scan);
    assert_eq!(scan.progress().phase, "cancelled");
    assert!(!scan.node(0).unwrap().complete);
}

#[test]
fn resume_finishes_and_terminal_scans_cannot_be_paused() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("item"), b"123456").unwrap();
    let scan = Scan::new(root.path()).unwrap();
    scan.set_paused(true).unwrap();
    scan.spawn(|_| {}).unwrap();
    scan.set_paused(false).unwrap();
    finished(&scan);
    assert_eq!(scan.progress().logical_size, 6);
    assert!(scan.node(0).unwrap().complete);
    assert!(scan.set_paused(true).is_err());
    assert!(scan.children(Query::new(99999)).is_err());
}

#[test]
fn rejects_unc_missing_paths_and_file_roots() {
    assert!(Scan::new(std::path::Path::new(r"\\server\share")).is_err());
    let root = tempfile::tempdir().unwrap();
    assert!(Scan::new(&root.path().join("missing")).is_err());
    fs::write(root.path().join("file"), b"file").unwrap();
    assert!(Scan::new(&root.path().join("file")).is_err());
}

#[cfg(windows)]
#[test]
fn junction_is_visible_but_never_traversed_and_cannot_be_a_root() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("outside.txt"), b"secret").unwrap();
    let junction = root.path().join("link");
    let result = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "junction creation failed: {:?}",
        result
    );
    assert!(Scan::new(&junction).is_err());
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    let children = scan.children(Query::new(0)).unwrap();
    assert_eq!(children.total, 1);
    assert_eq!(children.items[0].state, "skipped");
    assert!(scan.external_path(children.items[0].id, false).is_err());
    assert!(scan.external_path(children.items[0].id, true).is_ok());
    assert_eq!(scan.progress().files, 0);
    assert_eq!(scan.progress().skipped, 1);
    assert!(!scan.node(0).unwrap().complete);
}

#[test]
fn paginates_and_sorts_by_logical_size() {
    let root = tempfile::tempdir().unwrap();
    for (name, count) in [("small", 1), ("large", 9), ("middle", 4)] {
        fs::write(root.path().join(name), vec![0; count]).unwrap();
    }
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    let mut query = Query::new(0);
    query.metric = Metric::Logical;
    query.offset = 1;
    query.limit = 1;
    let page = scan.children(query).unwrap();
    assert_eq!(page.total, 3);
    assert_eq!(page.items[0].name, "middle");
}

#[test]
fn disk_size_counts_allocated_clusters_instead_of_file_length() {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceW;
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("allocated.bin");
    fs::write(&file, vec![7u8; 16385]).unwrap();
    let drive = root.path().to_string_lossy()[..3]
        .encode_utf16()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let (mut sectors, mut bytes, mut free, mut total) = (0, 0, 0, 0);
    assert_ne!(
        unsafe {
            GetDiskFreeSpaceW(
                drive.as_ptr(),
                &mut sectors,
                &mut bytes,
                &mut free,
                &mut total,
            )
        },
        0
    );
    let cluster = sectors as u64 * bytes as u64;
    let expected = 16385u64.div_ceil(cluster) * cluster;
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    assert_eq!(scan.progress().logical_size, 16385);
    assert_eq!(scan.progress().disk_size, expected);
}

#[test]
fn disappearing_root_is_reported_as_incomplete_instead_of_empty() {
    let root = tempfile::tempdir().unwrap();
    let scan = Scan::new(root.path()).unwrap();
    fs::remove_dir(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    assert_eq!(scan.node(0).unwrap().unknown, 1);
    assert!(!scan.node(0).unwrap().complete);
    assert!(scan.progress().errors > 0);
}

#[test]
fn long_unicode_paths_are_scanned_without_truncation() {
    let root = tempfile::tempdir().unwrap();
    let mut path = fs::canonicalize(root.path()).unwrap();
    for i in 0..8 {
        path.push(format!("中文目录-{i}-{}", "a".repeat(35)));
    }
    fs::create_dir_all(&path).unwrap();
    fs::write(path.join("照片.bin"), b"123456789").unwrap();
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    assert_eq!(scan.progress().logical_size, 9);
    assert_eq!(scan.progress().errors, 0);
}

#[test]
fn root_replaced_by_junction_after_validation_stays_incomplete() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("root");
    fs::create_dir(&root).unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("outside.bin"), b"outside").unwrap();
    let scan = Scan::new(&root).unwrap();
    fs::remove_dir(&root).unwrap();
    let result = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&root)
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(result.status.success());
    assert!(scan.external_path(0, false).is_err());
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    assert_eq!(scan.progress().files, 0);
    assert_eq!(scan.progress().skipped, 1);
    assert!(!scan.node(0).unwrap().complete);
}

#[test]
fn invalid_queries_do_not_silently_return_misleading_results() {
    let root = tempfile::tempdir().unwrap();
    let scan = Scan::new(root.path()).unwrap();
    let mut query = Query::new(0);
    query.kind = "nonsense".into();
    assert!(scan.children(query).is_err());
    let mut query = Query::new(0);
    query.min_size = Some(10);
    query.max_size = Some(5);
    assert!(scan.children(query).is_err());
}

#[test]
fn expanded_view_is_bounded_and_keeps_each_directory_total_separate() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/a"), b"123").unwrap();
    fs::write(root.path().join("sibling"), b"1").unwrap();
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    let page = scan.children(Query::new(0)).unwrap();
    let nested = page.items.iter().find(|n| n.is_dir).unwrap();
    let view = scan
        .expanded_view(0, Metric::Logical, &[nested.id])
        .unwrap();
    assert_eq!(view.items.iter().map(|n| n.logical_size).sum::<u64>(), 4);
    assert_eq!(view.branches.len(), 1);
    assert_eq!(view.branches[0].items[0].logical_size, 3);
    assert!(scan.expanded_view(nested.id, Metric::Disk, &[0]).is_err());
    assert!(scan.expanded_view(0, Metric::Disk, &[99999]).is_err());
    assert!(scan
        .expanded_view(0, Metric::Disk, &[nested.id; 17])
        .is_err());
}

#[test]
fn external_paths_require_a_current_existing_node() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("中文 file.txt"), b"test").unwrap();
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    let file = &scan.children(Query::new(0)).unwrap().items[0];
    assert!(scan.external_path(99999, false).is_err());
    assert!(scan
        .external_path(file.id, false)
        .unwrap()
        .ends_with("中文 file.txt"));
    fs::remove_file(root.path().join("中文 file.txt")).unwrap();
    assert!(scan.external_path(file.id, false).is_err());
}

#[test]
fn expanded_view_truncates_without_losing_bytes_or_exceeding_total_budget() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    for index in 0..5100 {
        fs::write(
            root.path().join("nested").join(format!("{index}.txt")),
            b"123",
        )
        .unwrap();
    }
    let scan = Scan::new(root.path()).unwrap();
    scan.spawn(|_| {}).unwrap();
    finished(&scan);
    let id = scan.children(Query::new(0)).unwrap().items[0].id;
    let view = scan.expanded_view(0, Metric::Logical, &[id]).unwrap();
    assert!(view.items.len() + view.branches.iter().map(|b| b.items.len()).sum::<usize>() <= 5000);
    let branch = &view.branches[0];
    assert!(branch.truncated);
    assert_eq!(
        branch.items.iter().map(|n| n.logical_size).sum::<u64>() + branch.omitted_logical_size,
        15300
    );
}
