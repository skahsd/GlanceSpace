use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Component, Path, PathBuf, Prefix},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;
use windows_sys::Win32::Storage::FileSystem::{
    FileAttributeTagInfo, FileCompressionInfo, FileStandardInfo, GetDriveTypeW,
    GetFileInformationByHandleEx, GetLogicalDrives, FILE_ATTRIBUTE_TAG_INFO, FILE_COMPRESSION_INFO,
    FILE_STANDARD_INFO,
};

const NONE: u32 = u32::MAX;
const REPARSE: u32 = 0x400;
const OFFLINE: u32 = 0x1000;
const RECALL: u32 = 0x40000 | 0x400000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Metric {
    #[default]
    Disk,
    Logical,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    pub node_id: u32,
    pub offset: usize,
    pub limit: usize,
    pub metric: Metric,
    pub pattern: String,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    pub older_than_days: Option<u64>,
    pub kind: String,
}
impl Default for Query {
    fn default() -> Self {
        Self {
            node_id: 0,
            offset: 0,
            limit: 100,
            metric: Metric::Disk,
            pattern: String::new(),
            min_size: None,
            max_size: None,
            older_than_days: None,
            kind: "all".into(),
        }
    }
}
impl Query {
    pub fn new(node_id: u32) -> Self {
        Self {
            node_id,
            ..Self::default()
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub id: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub logical_size: u64,
    pub disk_size: u64,
    pub unknown: u32,
    pub errors: u32,
    pub skipped: u32,
    pub modified: Option<u64>,
    pub state: String,
    pub message: Option<String>,
    pub complete: bool,
    pub child_count: u32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub files: u64,
    pub directories: u64,
    pub logical_size: u64,
    pub disk_size: u64,
    pub errors: u32,
    pub skipped: u32,
    pub unknown: u32,
    pub revision: u64,
    pub elapsed_ms: u64,
    pub message: Option<String>,
}
impl Progress {
    pub fn terminal(&self) -> bool {
        matches!(self.phase.as_str(), "completed" | "cancelled" | "failed")
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub directory: NodeView,
    pub breadcrumbs: Vec<NodeView>,
    pub items: Vec<NodeView>,
    pub total: usize,
    pub revision: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub directory: NodeView,
    pub items: Vec<NodeView>,
    pub truncated: bool,
    pub omitted_logical_size: u64,
    pub omitted_disk_size: u64,
    pub revision: u64,
    pub branches: Vec<Branch>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub directory: NodeView,
    pub items: Vec<NodeView>,
    pub truncated: bool,
    pub omitted_logical_size: u64,
    pub omitted_disk_size: u64,
}
struct Node {
    parent: u32,
    first_child: u32,
    next_sibling: u32,
    child_count: u32,
    name: OsString,
    is_dir: bool,
    logical_size: u64,
    disk_size: u64,
    unknown: u32,
    errors: u32,
    skipped: u32,
    modified: Option<u64>,
    message: Option<String>,
}
impl Node {
    fn empty(name: OsString, parent: u32, is_dir: bool) -> Self {
        Self {
            parent,
            name,
            is_dir,
            first_child: NONE,
            next_sibling: NONE,
            child_count: 0,
            logical_size: 0,
            disk_size: 0,
            unknown: 0,
            errors: 0,
            skipped: 0,
            modified: None,
            message: None,
        }
    }
}
struct Data {
    root: PathBuf,
    nodes: Vec<Node>,
    phase: String,
    files: u64,
    directories: u64,
    revision: u64,
    started: Instant,
    elapsed_ms: u64,
    message: Option<String>,
    spawned: bool,
}
#[derive(Default)]
struct Control {
    paused: bool,
    cancelled: bool,
}
#[derive(Clone)]
pub struct Scan {
    data: Arc<Mutex<Data>>,
    control: Arc<(Mutex<Control>, Condvar)>,
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}
fn validate_root(input: &Path) -> Result<PathBuf, String> {
    if !input.is_absolute() {
        return Err("请选择本机固定磁盘上的绝对目录路径".into());
    }
    let drive = match input.components().next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::Disk(d) | Prefix::VerbatimDisk(d) => d,
            _ => return Err("首版不支持 UNC、网络路径或设备路径".into()),
        },
        _ => return Err("仅支持带盘符的本机目录".into()),
    };
    let volume = [drive as u16, 58, 92, 0];
    if unsafe { GetDriveTypeW(volume.as_ptr()) } != 3 {
        return Err("首版仅支持本机固定磁盘，不支持网络盘或可移动磁盘".into());
    }
    // Check ancestors before canonicalization so a junction cannot hide its origin.
    let mut ancestor = PathBuf::new();
    for component in input.components() {
        if matches!(component, Component::ParentDir) {
            return Err("扫描路径不能包含 ..".into());
        }
        ancestor.push(component);
        if matches!(component, Component::Normal(_)) {
            let meta = fs::symlink_metadata(&ancestor).map_err(|e| format!("无法访问目录：{e}"))?;
            if meta.file_attributes() & (REPARSE | OFFLINE | RECALL) != 0 {
                return Err("不能以重解析点、联接目录或云端占位目录作为扫描根路径".into());
            }
        }
    }
    let root = fs::canonicalize(input).map_err(|e| format!("目录不可用：{e}"))?;
    if !fs::symlink_metadata(&root)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("扫描目标必须是目录".into());
    }
    Ok(root)
}
pub fn list_drives() -> Vec<String> {
    let bits = unsafe { GetLogicalDrives() };
    (0..26)
        .filter_map(|i| {
            let letter = b'A' + i;
            let root = [letter as u16, 58, 92, 0];
            (bits & (1 << i) != 0 && unsafe { GetDriveTypeW(root.as_ptr()) } == 3)
                .then(|| format!("{}:\\", letter as char))
        })
        .collect()
}
fn disk_size(path: &Path) -> Result<u64, String> {
    let file = fs::OpenOptions::new()
        .access_mode(0x80)
        .share_mode(7)
        .custom_flags(0x0020_0000 | 0x0010_0000)
        .open(path)
        .map_err(|e| format!("无法读取磁盘占用：{e}"))?;
    let read_info = |kind, pointer, size| {
        if unsafe { GetFileInformationByHandleEx(file.as_raw_handle(), kind, pointer, size) } == 0 {
            Err(format!(
                "磁盘占用读取失败：{}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    };
    let mut attributes: FILE_ATTRIBUTE_TAG_INFO = unsafe { std::mem::zeroed() };
    read_info(
        FileAttributeTagInfo,
        (&mut attributes as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
        std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
    )?;
    if attributes.FileAttributes & (REPARSE | OFFLINE | RECALL) != 0 {
        return Err("条目已变为重解析点或云端占位文件，跳过占用读取".into());
    }
    let size = if attributes.FileAttributes & (0x800 | 0x200) != 0 {
        let mut info: FILE_COMPRESSION_INFO = unsafe { std::mem::zeroed() };
        read_info(
            FileCompressionInfo,
            (&mut info as *mut FILE_COMPRESSION_INFO).cast(),
            std::mem::size_of::<FILE_COMPRESSION_INFO>() as u32,
        )?;
        info.CompressedFileSize
    } else {
        let mut info: FILE_STANDARD_INFO = unsafe { std::mem::zeroed() };
        read_info(
            FileStandardInfo,
            (&mut info as *mut FILE_STANDARD_INFO).cast(),
            std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
        )?;
        info.AllocationSize
    };
    u64::try_from(size).map_err(|_| "文件系统返回了无效占用".into())
}
impl Scan {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root = validate_root(root)?;
        let label = root
            .file_name()
            .map(OsString::from)
            .unwrap_or_else(|| display_path(&root).into());
        Ok(Self {
            data: Arc::new(Mutex::new(Data {
                root,
                nodes: vec![Node::empty(label, NONE, true)],
                phase: "ready".into(),
                files: 0,
                directories: 0,
                revision: 0,
                started: Instant::now(),
                elapsed_ms: 0,
                message: None,
                spawned: false,
            })),
            control: Arc::new((Mutex::new(Control::default()), Condvar::new())),
        })
    }
    pub fn spawn(&self, notify: impl Fn(Progress) + Send + 'static) -> Result<(), String> {
        {
            let control = self.control.0.lock().unwrap();
            let mut data = self.data.lock().unwrap();
            if data.spawned {
                return Err("扫描任务已启动".into());
            }
            data.spawned = true;
            data.phase = if control.paused { "paused" } else { "scanning" }.into();
            data.started = Instant::now();
        }
        let scan = self.clone();
        thread::Builder::new()
            .name("glancespace-scan".into())
            .spawn(move || {
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| scan.walk(&notify)));
                if result.is_err() {
                    let mut data = scan.data.lock().unwrap_or_else(|e| e.into_inner());
                    data.phase = "failed".into();
                    data.message = Some("扫描线程异常退出，结果不完整".into());
                    data.revision += 1;
                    data.elapsed_ms = data.started.elapsed().as_millis() as u64;
                }
                notify(scan.progress());
            })
            .map_err(|e| {
                let mut data = self.data.lock().unwrap();
                data.phase = "failed".into();
                data.message = Some(e.to_string());
                e.to_string()
            })?;
        Ok(())
    }
    pub fn progress(&self) -> Progress {
        let d = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let root = &d.nodes[0];
        Progress {
            phase: d.phase.clone(),
            files: d.files,
            directories: d.directories,
            logical_size: root.logical_size,
            disk_size: root.disk_size,
            errors: root.errors,
            skipped: root.skipped,
            unknown: root.unknown,
            revision: d.revision,
            elapsed_ms: if matches!(d.phase.as_str(), "completed" | "cancelled" | "failed") {
                d.elapsed_ms
            } else {
                d.started.elapsed().as_millis() as u64
            },
            message: d.message.clone(),
        }
    }
    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        let mut control = self.control.0.lock().unwrap();
        let mut data = self.data.lock().unwrap();
        if matches!(
            data.phase.as_str(),
            "completed" | "cancelled" | "cancelling" | "failed"
        ) {
            return Err("当前任务已结束或正在取消".into());
        }
        control.paused = paused;
        data.phase = if paused {
            "paused"
        } else if data.spawned {
            "scanning"
        } else {
            "ready"
        }
        .into();
        data.revision += 1;
        self.control.1.notify_all();
        Ok(())
    }
    pub fn cancel(&self) -> Result<(), String> {
        let mut control = self.control.0.lock().unwrap();
        let mut data = self.data.lock().unwrap();
        if matches!(data.phase.as_str(), "completed" | "cancelled" | "failed") {
            return Ok(());
        }
        control.cancelled = true;
        data.phase = if data.spawned {
            "cancelling"
        } else {
            "cancelled"
        }
        .into();
        data.revision += 1;
        self.control.1.notify_all();
        Ok(())
    }
    fn wait_or_cancel(&self) -> bool {
        let (lock, wake) = &*self.control;
        let mut control = lock.lock().unwrap();
        while control.paused && !control.cancelled {
            control = wake.wait(control).unwrap();
        }
        control.cancelled
    }
    fn walk(&self, notify: &impl Fn(Progress)) {
        let root = self.data.lock().unwrap().root.clone();
        if let Ok(meta) = fs::symlink_metadata(&root) {
            if meta.file_attributes() & (REPARSE | OFFLINE | RECALL) != 0 {
                let mut data = self.data.lock().unwrap();
                data.nodes[0].skipped = 1;
                data.nodes[0].unknown = 1;
                data.nodes[0].message = Some("扫描开始前根目录已变为重解析点，未跟随".into());
                data.phase = "completed".into();
                data.elapsed_ms = data.started.elapsed().as_millis() as u64;
                data.revision += 1;
                return;
            }
        } else {
            let mut data = self.data.lock().unwrap();
            data.nodes[0].unknown = 1;
            data.nodes[0].errors = 1;
            data.nodes[0].message = Some("扫描开始前根目录已消失或不可访问".into());
            data.phase = "completed".into();
            data.elapsed_ms = data.started.elapsed().as_millis() as u64;
            data.revision += 1;
            return;
        }
        let mut directories = HashMap::from([(root.clone(), 0u32)]);
        let mut walker = WalkDir::new(&root)
            .follow_links(false)
            .follow_root_links(false)
            .max_open(16)
            .into_iter();
        let mut last_notify = Instant::now();
        notify(self.progress());
        loop {
            if self.wait_or_cancel() {
                break;
            }
            let Some(entry) = walker.next() else {
                break;
            };
            match entry {
                Ok(entry) if entry.depth() == 0 => {}
                Ok(entry) => {
                    directories.retain(|path, _| entry.path().starts_with(path));
                    let parent = entry
                        .path()
                        .parent()
                        .and_then(|p| directories.get(p))
                        .copied()
                        .unwrap_or(0);
                    let mut node = Node::empty(
                        entry.file_name().to_os_string(),
                        parent,
                        entry.file_type().is_dir(),
                    );
                    match fs::symlink_metadata(entry.path()) {
                        Ok(meta) => {
                            node.is_dir = meta.is_dir();
                            node.modified = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_secs());
                            if meta.file_attributes() & (REPARSE | OFFLINE | RECALL) != 0 {
                                node.skipped = 1;
                                node.unknown = 1;
                                node.message =
                                    Some("重解析点或云端占位条目，未跟随、未下载".into());
                                if entry.file_type().is_dir() {
                                    walker.skip_current_dir();
                                }
                            } else if !node.is_dir {
                                node.logical_size = meta.len();
                                match disk_size(entry.path()) {
                                    Ok(bytes) => node.disk_size = bytes,
                                    Err(message) => {
                                        node.unknown = 1;
                                        node.errors = 1;
                                        node.message = Some(message);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            node.errors = 1;
                            node.unknown = 1;
                            node.message = Some(format!("无法读取元数据：{e}"));
                            if entry.file_type().is_dir() {
                                walker.skip_current_dir();
                            }
                        }
                    }
                    let descend = node.is_dir && node.skipped == 0 && node.errors == 0;
                    let mut data = self.data.lock().unwrap();
                    if data.nodes.len() >= NONE as usize {
                        data.phase = "failed".into();
                        data.message = Some("条目数量超过索引上限".into());
                        break;
                    }
                    let id = data.nodes.len() as u32;
                    if node.is_dir {
                        data.directories += 1;
                    } else if node.skipped == 0 {
                        data.files += 1;
                    }
                    node.next_sibling = data.nodes[parent as usize].first_child;
                    data.nodes[parent as usize].first_child = id;
                    data.nodes[parent as usize].child_count += 1;
                    let (logical, disk, unknown, errors, skipped) = (
                        node.logical_size,
                        node.disk_size,
                        node.unknown,
                        node.errors,
                        node.skipped,
                    );
                    data.nodes.push(node);
                    let mut ancestor = parent;
                    while ancestor != NONE {
                        let folder = &mut data.nodes[ancestor as usize];
                        folder.logical_size = folder.logical_size.saturating_add(logical);
                        folder.disk_size = folder.disk_size.saturating_add(disk);
                        folder.unknown += unknown;
                        folder.errors += errors;
                        folder.skipped += skipped;
                        ancestor = folder.parent;
                    }
                    data.revision += 1;
                    drop(data);
                    if descend {
                        directories.insert(entry.path().to_path_buf(), id);
                    }
                }
                Err(error) => {
                    let mut data = self.data.lock().unwrap();
                    let mut id = error
                        .path()
                        .and_then(|p| {
                            directories
                                .get(p)
                                .or_else(|| p.parent().and_then(|p| directories.get(p)))
                        })
                        .copied()
                        .unwrap_or(0);
                    if let Some(node) = data.nodes.get_mut(id as usize) {
                        node.message = Some(format!("无法访问：{error}"));
                    }
                    while id != NONE {
                        let node = &mut data.nodes[id as usize];
                        node.errors += 1;
                        node.unknown += 1;
                        id = node.parent;
                    }
                    data.revision += 1;
                }
            }
            if last_notify.elapsed() >= Duration::from_millis(250) {
                notify(self.progress());
                last_notify = Instant::now();
            }
        }
        let control = self.control.0.lock().unwrap();
        let mut data = self.data.lock().unwrap();
        if data.phase != "failed" {
            data.phase = if control.cancelled {
                "cancelled"
            } else {
                "completed"
            }
            .into();
        }
        data.elapsed_ms = data.started.elapsed().as_millis() as u64;
        data.revision += 1;
    }
    pub fn node(&self, id: u32) -> Result<NodeView, String> {
        let data = self.data.lock().unwrap();
        if id as usize >= data.nodes.len() {
            return Err("节点不存在".into());
        }
        Ok(node_view(&data, id))
    }
    pub fn children(&self, query: Query) -> Result<Page, String> {
        if query.pattern.chars().count() > 256 {
            return Err("过滤表达式不能超过 256 个字符".into());
        }
        if query.limit == 0 || query.limit > 500 {
            return Err("每页条目数必须在 1 到 500 之间".into());
        }
        if !matches!(query.kind.as_str(), "all" | "directory" | "file") {
            return Err("未知项目类型过滤".into());
        }
        if query
            .min_size
            .zip(query.max_size)
            .is_some_and(|(min, max)| min > max)
        {
            return Err("大小过滤范围无效".into());
        }
        let data = self.data.lock().unwrap();
        let parent = data.nodes.get(query.node_id as usize).ok_or("节点不存在")?;
        if !parent.is_dir || parent.skipped > 0 && parent.child_count == 0 {
            return Err("该节点不可展开".into());
        }
        let mut ids = child_ids(&data, query.node_id);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        ids.retain(|&id| {
            let n = &data.nodes[id as usize];
            let size = metric_size(n, query.metric);
            let known = !matches!(query.metric, Metric::Disk) || n.unknown == 0;
            (query.kind == "all"
                || query.kind == "directory" && n.is_dir
                || query.kind == "file" && !n.is_dir)
                && matches_pattern(&n.name.to_string_lossy(), &query.pattern)
                && query.min_size.is_none_or(|min| known && size >= min)
                && query.max_size.is_none_or(|max| known && size <= max)
                && query.older_than_days.is_none_or(|days| {
                    n.modified
                        .is_some_and(|time| now.saturating_sub(time) >= days.saturating_mul(86400))
                })
        });
        sort_ids(&data, &mut ids, query.metric);
        let total = ids.len();
        let items = ids
            .into_iter()
            .skip(query.offset)
            .take(query.limit)
            .map(|id| node_view(&data, id))
            .collect();
        let mut ancestry = Vec::new();
        let mut id = query.node_id;
        loop {
            ancestry.push(node_view(&data, id));
            id = data.nodes[id as usize].parent;
            if id == NONE {
                break;
            }
        }
        ancestry.reverse();
        Ok(Page {
            directory: node_view(&data, query.node_id),
            breadcrumbs: ancestry,
            items,
            total,
            revision: data.revision,
        })
    }
    pub fn view(&self, id: u32, metric: Metric) -> Result<View, String> {
        self.expanded_view(id, metric, &[])
    }
    pub fn expanded_view(&self, id: u32, metric: Metric, expanded: &[u32]) -> Result<View, String> {
        let data = self.data.lock().unwrap();
        if id as usize >= data.nodes.len() || !data.nodes[id as usize].is_dir {
            return Err("目录不存在".into());
        }
        if expanded.len() > 16 {
            return Err("最多展开 16 个目录".into());
        }
        let wanted: HashSet<u32> = expanded.iter().copied().collect();
        for &entry in &wanted {
            let node = data.nodes.get(entry as usize).ok_or("展开节点不存在")?;
            if !node.is_dir || entry == id {
                return Err("展开节点必须是当前视图内的子目录".into());
            }
            let mut parent = node.parent;
            while parent != id {
                if parent == NONE || !wanted.contains(&parent) {
                    return Err("展开节点不在当前可见目录内".into());
                }
                parent = data.nodes[parent as usize].parent;
            }
        }
        // Reserve a fair slice for every expanded branch; the whole IPC stays bounded.
        let quota = 5000 / (wanted.len() + 1);
        let root = view_branch(&data, id, metric, quota, &wanted);
        let mut queue: Vec<u32> = root
            .items
            .iter()
            .filter(|n| wanted.contains(&n.id))
            .map(|n| n.id)
            .collect();
        let mut branches = Vec::new();
        let mut cursor = 0;
        while cursor < queue.len() {
            let branch = view_branch(&data, queue[cursor], metric, quota, &wanted);
            queue.extend(
                branch
                    .items
                    .iter()
                    .filter(|n| wanted.contains(&n.id))
                    .map(|n| n.id),
            );
            branches.push(branch);
            cursor += 1;
        }
        Ok(View {
            directory: root.directory,
            items: root.items,
            truncated: root.truncated,
            omitted_logical_size: root.omitted_logical_size,
            omitted_disk_size: root.omitted_disk_size,
            revision: data.revision,
            branches,
        })
    }

    pub fn external_path(&self, id: u32, reveal: bool) -> Result<PathBuf, String> {
        let data = self.data.lock().unwrap();
        let node = data.nodes.get(id as usize).ok_or("节点不存在")?;
        let is_dir = node.is_dir;
        let path = node_path(&data, id);
        if !path.starts_with(&data.root) {
            return Err("目标不在扫描范围内".into());
        }
        drop(data);
        for ancestor in path.ancestors() {
            let meta = fs::symlink_metadata(ancestor)
                .map_err(|e| format!("项目已不存在或无法访问：{e}"))?;
            let unsafe_attributes = meta.file_attributes() & (REPARSE | OFFLINE | RECALL) != 0;
            if unsafe_attributes && !(reveal && ancestor == path) {
                return Err("不能打开重解析点或云端占位项目，请使用资源管理器处理".into());
            }
            if ancestor == path && meta.is_dir() != is_dir {
                return Err("项目类型在扫描后发生变化，请重新扫描".into());
            }
        }
        Ok(path)
    }
}
fn view_branch(
    data: &Data,
    id: u32,
    metric: Metric,
    quota: usize,
    wanted: &HashSet<u32>,
) -> Branch {
    let mut ids = child_ids(data, id);
    sort_ids(data, &mut ids, metric);
    ids.sort_by_key(|entry| !wanted.contains(entry));
    let mut omitted_logical_size = 0u64;
    let mut omitted_disk_size = 0u64;
    let truncated = ids.len() > quota;
    for &extra in ids.iter().skip(quota) {
        omitted_logical_size =
            omitted_logical_size.saturating_add(data.nodes[extra as usize].logical_size);
        omitted_disk_size = omitted_disk_size.saturating_add(data.nodes[extra as usize].disk_size);
    }
    ids.truncate(quota);
    Branch {
        directory: node_view(data, id),
        items: ids.into_iter().map(|i| node_view(data, i)).collect(),
        truncated,
        omitted_logical_size,
        omitted_disk_size,
    }
}
fn child_ids(data: &Data, id: u32) -> Vec<u32> {
    let mut ids = Vec::with_capacity(data.nodes[id as usize].child_count as usize);
    let mut child = data.nodes[id as usize].first_child;
    while child != NONE {
        ids.push(child);
        child = data.nodes[child as usize].next_sibling;
    }
    ids
}
fn metric_size(node: &Node, metric: Metric) -> u64 {
    match metric {
        Metric::Disk => node.disk_size,
        Metric::Logical => node.logical_size,
    }
}
fn sort_ids(data: &Data, ids: &mut [u32], metric: Metric) {
    ids.sort_unstable_by(|&a, &b| {
        let (a, b) = (&data.nodes[a as usize], &data.nodes[b as usize]);
        let known = if matches!(metric, Metric::Disk) {
            (a.unknown > 0).cmp(&(b.unknown > 0))
        } else {
            Ordering::Equal
        };
        known
            .then_with(|| metric_size(b, metric).cmp(&metric_size(a, metric)))
            .then_with(|| a.name.cmp(&b.name))
    });
}
fn node_path(data: &Data, id: u32) -> PathBuf {
    let mut parts = Vec::new();
    let mut current = id;
    while current != 0 {
        let n = &data.nodes[current as usize];
        parts.push(&n.name);
        current = n.parent;
    }
    let mut path = data.root.clone();
    for part in parts.iter().rev() {
        path.push(part);
    }
    path
}
fn node_view(data: &Data, id: u32) -> NodeView {
    let node = &data.nodes[id as usize];
    let path = node_path(data, id);
    let complete = node.unknown == 0 && (!node.is_dir || data.phase == "completed");
    let state = if node.skipped > 0 && node.child_count == 0 {
        "skipped"
    } else if node.errors > 0 || node.skipped > 0 || node.unknown > 0 {
        "partial"
    } else if node.is_dir && data.phase != "completed" {
        "incomplete"
    } else {
        "ok"
    };
    NodeView {
        id,
        parent: (node.parent != NONE).then_some(node.parent),
        name: node.name.to_string_lossy().into_owned(),
        path: display_path(&path),
        is_dir: node.is_dir,
        logical_size: node.logical_size,
        disk_size: node.disk_size,
        unknown: node.unknown,
        errors: node.errors,
        skipped: node.skipped,
        modified: node.modified,
        state: state.into(),
        message: node.message.clone(),
        complete,
        child_count: node.child_count,
    }
}
pub fn matches_pattern(name: &str, pattern: &str) -> bool {
    if pattern.is_empty() {
        return true;
    }
    let lower = pattern.to_lowercase();
    if !lower.contains(['*', '?']) {
        return name.to_lowercase().contains(&lower);
    }
    let text: Vec<char> = name.to_lowercase().chars().collect();
    let mask: Vec<char> = lower.chars().collect();
    let (mut t, mut m, mut star, mut retry) = (0, 0, None, 0);
    while t < text.len() {
        if m < mask.len() && (mask[m] == '?' || mask[m] == text[t]) {
            t += 1;
            m += 1;
        } else if m < mask.len() && mask[m] == '*' {
            star = Some(m);
            m += 1;
            retry = t;
        } else if let Some(s) = star {
            retry += 1;
            t = retry;
            m = s + 1;
        } else {
            return false;
        }
    }
    while m < mask.len() && mask[m] == '*' {
        m += 1;
    }
    m == mask.len()
}
