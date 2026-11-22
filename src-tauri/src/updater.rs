use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tauri_plugin_updater::UpdaterExt;

const RELEASES_URL: &str = "https://github.com/mewisme/mewsenger/releases/latest";
const CHECK_FAILED: &str = "Could not check for updates";
const INSTALL_FAILED: &str = "Could not install the update";

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UpdateState {
    Unconfigured,
    Idle,
    Checking,
    Available { version: String },
    Downloading,
    Ready,
    UpToDate,
    Error { message: String },
}

impl UpdateState {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Unconfigured => "unconfigured",
            Self::Idle => "idle",
            Self::Checking => "checking",
            Self::Available { .. } => "available",
            Self::Downloading => "downloading",
            Self::Ready => "ready",
            Self::UpToDate => "up_to_date",
            Self::Error { .. } => "error",
        }
    }
}

pub enum UpdateResult {
    CheckStarted,
    Found(String),
    NoneFound,
    InstallStarted,
    Installed,
    OpenedReleases,
    Failed(&'static str),
}

pub fn next_state(current: UpdateState, result: UpdateResult) -> UpdateState {
    if current == UpdateState::Unconfigured {
        return current;
    }
    match result {
        UpdateResult::CheckStarted => UpdateState::Checking,
        UpdateResult::Found(version) => UpdateState::Available { version },
        UpdateResult::NoneFound => UpdateState::UpToDate,
        UpdateResult::InstallStarted => UpdateState::Downloading,
        UpdateResult::Installed => UpdateState::Ready,
        UpdateResult::OpenedReleases => UpdateState::Idle,
        UpdateResult::Failed(message) => UpdateState::Error {
            message: message.into(),
        },
    }
}

pub fn configured(app: &AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

pub fn initial_state(configured: bool) -> UpdateState {
    if configured {
        UpdateState::Idle
    } else {
        UpdateState::Unconfigured
    }
}

fn transition(app: &AppHandle, state: &Mutex<UpdateState>, result: UpdateResult) -> UpdateState {
    let next = match state.lock() {
        Ok(mut guard) => {
            let next = next_state(guard.clone(), result);
            *guard = next.clone();
            next
        }
        Err(_) => UpdateState::Error {
            message: CHECK_FAILED.into(),
        },
    };
    crate::shell::emit_chrome(app, "update-status", &next);
    let _ = app.emit_to("settings", "update-status", &next);
    next
}

fn allowed(webview: &Webview) -> Result<(), String> {
    if crate::shell::local_webview(
        webview,
        &[
            crate::shell::LocalKind::Titlebar,
            crate::shell::LocalKind::Settings,
        ],
    ) {
        Ok(())
    } else {
        Err("local view required".into())
    }
}

#[tauri::command]
pub fn get_update_state(
    webview: Webview,
    state: State<'_, Mutex<UpdateState>>,
) -> Result<UpdateState, String> {
    allowed(&webview)?;
    state
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| "update state unavailable".into())
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    webview: Webview,
    state: State<'_, Mutex<UpdateState>>,
) -> Result<UpdateState, String> {
    allowed(&webview)?;
    Ok(check(&app, &state).await)
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    webview: Webview,
    state: State<'_, Mutex<UpdateState>>,
) -> Result<UpdateState, String> {
    allowed(&webview)?;
    Ok(install(&app, &state).await)
}

/// Looks for an update and records what it found.
async fn check(app: &AppHandle, state: &Mutex<UpdateState>) -> UpdateState {
    if !configured(app) {
        return UpdateState::Unconfigured;
    }

    transition(app, state, UpdateResult::CheckStarted);
    let result = match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => UpdateResult::Found(update.version),
            Ok(None) => UpdateResult::NoneFound,
            Err(_) => UpdateResult::Failed(CHECK_FAILED),
        },
        Err(_) => UpdateResult::Failed(CHECK_FAILED),
    };
    transition(app, state, result)
}

/// Downloads and installs the newest update, then restarts into it.
async fn install(app: &AppHandle, state: &Mutex<UpdateState>) -> UpdateState {
    if !configured(app) {
        return UpdateState::Unconfigured;
    }
    if cfg!(feature = "portable") {
        // A running portable executable cannot replace itself.
        use tauri_plugin_opener::OpenerExt;
        let opened = app.opener().open_url(RELEASES_URL, None::<&str>).is_ok();
        let result = if opened {
            UpdateResult::OpenedReleases
        } else {
            UpdateResult::Failed(INSTALL_FAILED)
        };
        return transition(app, state, result);
    }
    let update = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let update = match update {
        Ok(Some(update)) => update,
        Ok(None) => return transition(app, state, UpdateResult::NoneFound),
        Err(_) => return transition(app, state, UpdateResult::Failed(INSTALL_FAILED)),
    };
    transition(app, state, UpdateResult::InstallStarted);
    if update.download_and_install(|_, _| {}, || {}).await.is_err() {
        return transition(app, state, UpdateResult::Failed(INSTALL_FAILED));
    }
    transition(app, state, UpdateResult::Installed);
    app.restart()
}

const SCHEDULER_START_DELAY: std::time::Duration = std::time::Duration::from_secs(20);
const SCHEDULER_TICK: std::time::Duration = std::time::Duration::from_secs(600);

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// Checks for updates by itself: once after start when asked to, and then
/// whenever the chosen schedule says one is due. The choices are read each
/// round, so changes in Settings apply without a restart.
pub fn start_scheduler(app: AppHandle) {
    if !configured(&app) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(SCHEDULER_START_DELAY);
        let mut first = true;
        loop {
            let prefs = crate::prefs::current(&app);
            let now = unix_now();
            let due = (first && prefs.check_on_start)
                || prefs.update_schedule.due(prefs.last_update_check, now);
            first = false;
            if due {
                crate::prefs::record_update_check(&app, now);
                let state = app.state::<Mutex<UpdateState>>();
                let found = tauri::async_runtime::block_on(check(&app, &state));
                if prefs.auto_install
                    && !cfg!(feature = "portable")
                    && matches!(found, UpdateState::Available { .. })
                {
                    tauri::async_runtime::block_on(install(&app, &state));
                }
            }
            std::thread::sleep(SCHEDULER_TICK);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unconfigured_never_leaves_its_state() {
        for result in [
            UpdateResult::CheckStarted,
            UpdateResult::Found("1.0.0".into()),
            UpdateResult::Installed,
        ] {
            assert_eq!(
                next_state(UpdateState::Unconfigured, result),
                UpdateState::Unconfigured
            );
        }
    }

    #[test]
    fn a_normal_update_walks_through_every_state() {
        let mut state = initial_state(true);
        state = next_state(state, UpdateResult::CheckStarted);
        assert_eq!(state, UpdateState::Checking);
        state = next_state(state, UpdateResult::Found("0.2.0".into()));
        assert_eq!(
            state,
            UpdateState::Available {
                version: "0.2.0".into()
            }
        );
        state = next_state(state, UpdateResult::InstallStarted);
        assert_eq!(state, UpdateState::Downloading);
        state = next_state(state, UpdateResult::Installed);
        assert_eq!(state, UpdateState::Ready);
    }

    #[test]
    fn failures_carry_only_the_fixed_message_and_can_be_retried() {
        let state = next_state(UpdateState::Checking, UpdateResult::Failed(CHECK_FAILED));
        assert_eq!(
            state,
            UpdateState::Error {
                message: CHECK_FAILED.into()
            }
        );
        assert_eq!(
            next_state(state, UpdateResult::NoneFound),
            UpdateState::UpToDate
        );
        assert_eq!(initial_state(false), UpdateState::Unconfigured);
    }

    #[test]
    fn portable_hand_off_returns_to_idle() {
        assert_eq!(
            next_state(
                UpdateState::Available {
                    version: "1".into()
                },
                UpdateResult::OpenedReleases
            ),
            UpdateState::Idle
        );
    }
}
