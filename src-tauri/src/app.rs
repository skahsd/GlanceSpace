use crate::scan::{self, Metric, Page, Progress, Query, Scan, View};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{ipc::Channel, State};

#[derive(Default)]
struct Manager {
    current: Mutex<Option<(u64, Scan)>>,
    next_id: AtomicU64,
}

impl Manager {
    fn get(&self, id: u64) -> Result<Scan, String> {
        self.current
            .lock()
            .map_err(|_| "扫描状态不可用")?
            .as_ref()
            .filter(|(scan_id, _)| *scan_id == id)
            .map(|(_, scan)| scan.clone())
            .ok_or_else(|| "扫描任务已失效，请重新扫描".into())
    }
}

#[tauri::command]
fn list_drives() -> Vec<String> {
    scan::list_drives()
}

#[tauri::command]
async fn start_scan(
    root: String,
    on_progress: Channel<Progress>,
    manager: State<'_, Manager>,
) -> Result<u64, String> {
    let scan = Scan::new(Path::new(&root))?;
    let mut current = manager.current.lock().map_err(|_| "扫描状态不可用")?;
    if current
        .as_ref()
        .is_some_and(|(_, s)| !s.progress().terminal())
    {
        return Err("请先取消或等待当前扫描结束".into());
    }
    let id = manager.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    scan.spawn(move |progress| {
        let _ = on_progress.send(progress);
    })?;
    *current = Some((id, scan));
    Ok(id)
}

#[tauri::command]
fn control_scan(
    scan_id: u64,
    action: String,
    manager: State<'_, Manager>,
) -> Result<Progress, String> {
    let scan = manager.get(scan_id)?;
    match action.as_str() {
        "pause" => scan.set_paused(true)?,
        "resume" => scan.set_paused(false)?,
        "cancel" => scan.cancel()?,
        _ => return Err("未知扫描操作".into()),
    }
    Ok(scan.progress())
}

#[tauri::command]
fn get_progress(scan_id: u64, manager: State<'_, Manager>) -> Result<Progress, String> {
    Ok(manager.get(scan_id)?.progress())
}

#[tauri::command]
async fn get_children(
    scan_id: u64,
    query: Query,
    manager: State<'_, Manager>,
) -> Result<Page, String> {
    let scan = manager.get(scan_id)?;
    tauri::async_runtime::spawn_blocking(move || scan.children(query))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_view(
    scan_id: u64,
    node_id: u32,
    metric: Metric,
    expanded: Vec<u32>,
    manager: State<'_, Manager>,
) -> Result<View, String> {
    let scan = manager.get(scan_id)?;
    tauri::async_runtime::spawn_blocking(move || scan.expanded_view(node_id, metric, &expanded))
        .await
        .map_err(|e| e.to_string())?
}

async fn external_action(
    scan: Scan,
    node_id: u32,
    owner: usize,
    open_with: bool,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::spawn(move || {
            if open_with {
                let result = scan.external_path(node_id, false).and_then(|path| {
                    if path.is_dir() {
                        return Err("目录请使用资源管理器打开".into());
                    }
                    // shortcut: Shell takes a path after validation; deletion requires atomic object revalidation in P3.
                    crate::shell::open_with(&path, owner)
                });
                if let Err(error) = result {
                    let path = scan.external_path(node_id, true)?;
                    crate::shell::reveal(&path, false, owner)
                        .map_err(|fallback| format!("{error}；{fallback}"))?;
                    return Ok(Some(format!("{error}；已在资源管理器中定位")));
                }
            } else {
                let path = scan.external_path(node_id, true)?;
                use std::os::windows::fs::MetadataExt;
                let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
                let open_directory = meta.is_dir()
                    && meta.file_attributes() & (0x400 | 0x1000 | 0x40000 | 0x400000) == 0;
                crate::shell::reveal(&path, open_directory, owner)?;
            }
            Ok(None)
        })
        .join()
        .map_err(|_| "系统文件操作线程异常".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_with(
    scan_id: u64,
    node_id: u32,
    window: tauri::Window,
    manager: State<'_, Manager>,
) -> Result<Option<String>, String> {
    let scan = manager.get(scan_id)?;
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    external_action(scan, node_id, owner, true).await
}

#[tauri::command]
async fn show_in_explorer(
    scan_id: u64,
    node_id: u32,
    window: tauri::Window,
    manager: State<'_, Manager>,
) -> Result<Option<String>, String> {
    let scan = manager.get(scan_id)?;
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    external_action(scan, node_id, owner, false).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Manager::default())
        .invoke_handler(tauri::generate_handler![
            list_drives,
            start_scan,
            control_scan,
            get_progress,
            get_children,
            get_view,
            open_with,
            show_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("GlanceSpace failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_rejects_missing_and_replaced_scan_ids() {
        let manager = Manager::default();
        assert!(manager.get(1).is_err());
        let root = tempfile::tempdir().unwrap();
        let scan = Scan::new(root.path()).unwrap();
        *manager.current.lock().unwrap() = Some((2, scan));
        assert!(manager.get(1).is_err());
        assert!(manager.get(2).is_ok());
    }
}
