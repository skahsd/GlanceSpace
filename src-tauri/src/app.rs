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
    manager: State<'_, Manager>,
) -> Result<View, String> {
    let scan = manager.get(scan_id)?;
    tauri::async_runtime::spawn_blocking(move || scan.view(node_id, metric))
        .await
        .map_err(|e| e.to_string())?
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
            get_view
        ])
        .run(tauri::generate_context!())
        .expect("GlanceSpace failed to start");
}
