use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use tauri::{webview::DownloadEvent, AppHandle, Manager, Runtime, Webview};

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DownloadStatus {
    Downloading { file_name: String },
    Done { file_name: String },
    Failed { file_name: String },
}

/// Rust-only record of the most recent download. The full path never reaches
/// a webview; the UI only sees the file name.
#[derive(Default)]
pub struct DownloadState {
    pending_name: Option<String>,
    last_path: Option<PathBuf>,
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into())
}

fn requested(state: &mut DownloadState, destination: &Path) -> DownloadStatus {
    let name = file_name(destination);
    state.pending_name = Some(name.clone());
    DownloadStatus::Downloading { file_name: name }
}

fn finished(state: &mut DownloadState, path: Option<PathBuf>, success: bool) -> DownloadStatus {
    let name = path
        .as_deref()
        .map(file_name)
        .or_else(|| state.pending_name.take())
        .unwrap_or_else(|| "file".into());
    state.pending_name = None;
    if success {
        if let Some(path) = path {
            state.last_path = Some(path);
        }
        DownloadStatus::Done { file_name: name }
    } else {
        DownloadStatus::Failed { file_name: name }
    }
}

fn publish<R: Runtime>(app: &AppHandle<R>, status: &DownloadStatus) {
    crate::shell::emit_status(app, "download-status", status);
}

/// Shared download policy: allow the download to the default location and tell
/// the local status bar. WebView2 reports no byte progress, so none is shown.
pub fn handler<R: Runtime>(
    app: AppHandle<R>,
) -> impl Fn(Webview<R>, DownloadEvent<'_>) -> bool + Send + Sync + 'static {
    move |_, event| {
        let Some(state) = app.try_state::<Mutex<DownloadState>>() else {
            return true;
        };
        let status = match event {
            DownloadEvent::Requested { destination, .. } => state
                .lock()
                .ok()
                .map(|mut guard| requested(&mut guard, destination)),
            DownloadEvent::Finished { path, success, .. } => state
                .lock()
                .ok()
                .map(|mut guard| finished(&mut guard, path, success)),
            _ => None,
        };
        if let Some(status) = status {
            publish(&app, &status);
        }
        true
    }
}

#[tauri::command]
pub fn reveal_last_download(
    webview: Webview,
    state: tauri::State<'_, Mutex<DownloadState>>,
) -> Result<(), String> {
    if !crate::shell::local_webview(&webview, &[crate::shell::LocalKind::Status]) {
        return Err("local status view required".into());
    }
    let path = state
        .lock()
        .map_err(|_| "download state unavailable")?
        .last_path
        .clone()
        .filter(|path| path.exists())
        .ok_or("no downloaded file")?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|_| "could not show the file".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_reports_only_the_file_name() {
        let mut state = DownloadState::default();
        let status = requested(&mut state, Path::new("C:/Users/me/Downloads/report.pdf"));
        assert_eq!(
            status,
            DownloadStatus::Downloading {
                file_name: "report.pdf".into()
            }
        );
    }

    #[test]
    fn success_remembers_the_path_for_reveal_without_exposing_it() {
        let mut state = DownloadState::default();
        requested(&mut state, Path::new("/tmp/a.zip"));
        let done = finished(&mut state, Some(PathBuf::from("/tmp/a.zip")), true);
        assert_eq!(
            done,
            DownloadStatus::Done {
                file_name: "a.zip".into()
            }
        );
        assert_eq!(state.last_path, Some(PathBuf::from("/tmp/a.zip")));
    }

    #[test]
    fn failure_keeps_the_previous_reveal_target_and_uses_the_requested_name() {
        let mut state = DownloadState {
            last_path: Some(PathBuf::from("/tmp/old.txt")),
            ..Default::default()
        };
        requested(&mut state, Path::new("/tmp/new.bin"));
        let failed = finished(&mut state, None, false);
        assert_eq!(
            failed,
            DownloadStatus::Failed {
                file_name: "new.bin".into()
            }
        );
        assert_eq!(state.last_path, Some(PathBuf::from("/tmp/old.txt")));
    }
}
