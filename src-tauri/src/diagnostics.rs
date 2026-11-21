use std::sync::Mutex;

use serde::Serialize;
use tauri::{State, Webview};

use crate::{notifications::Registry, updater::UpdateState};

/// Support information that is safe to paste into a bug report: no paths, no
/// URLs and no account or message data.
#[derive(Serialize)]
pub struct Diagnostics {
    app_version: String,
    tauri_version: &'static str,
    webview2_version: Option<String>,
    os: &'static str,
    arch: &'static str,
    update_state: &'static str,
    session: Option<bool>,
    unread_known: bool,
}

#[tauri::command]
pub fn get_diagnostics(
    app: tauri::AppHandle,
    webview: Webview,
    notifications: State<'_, Mutex<Registry>>,
    update: State<'_, Mutex<UpdateState>>,
) -> Result<Diagnostics, String> {
    use crate::shell::LocalKind;
    if !crate::shell::local_webview(&webview, &[LocalKind::Status, LocalKind::Settings]) {
        return Err("local view required".into());
    }
    let (session, unread_known) = notifications
        .lock()
        .map(|registry| {
            let state = registry.get(crate::accounts::FIRST);
            (
                state.and_then(|s| s.session()),
                state.is_some_and(|s| s.unread().is_some()),
            )
        })
        .map_err(|_| "status unavailable")?;
    let update_state = update
        .lock()
        .map(|state| state.label())
        .map_err(|_| "status unavailable")?;
    Ok(Diagnostics {
        app_version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION,
        webview2_version: tauri::webview_version().ok(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        update_state,
        session,
        unread_known,
    })
}
