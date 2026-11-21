use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(default)]
pub struct Prefs {
    pub notification_preview: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            notification_preview: true,
        }
    }
}

pub fn from_json(text: &str) -> Prefs {
    serde_json::from_str(text).unwrap_or_default()
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("preferences.json"))
}

pub fn load(app: &AppHandle) -> Prefs {
    path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|text| from_json(&text))
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, prefs: &Prefs) -> std::io::Result<()> {
    let target = path(app).ok_or_else(|| std::io::Error::other("config directory unavailable"))?;
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = target.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(prefs)?)?;
    std::fs::rename(&tmp, &target)
}

pub struct PreviewMenuItem(pub tauri::menu::CheckMenuItem<tauri::Wry>);

pub fn apply(mut prefs: Prefs, key: &str, value: bool) -> Result<Prefs, String> {
    match key {
        "notification_preview" => prefs.notification_preview = value,
        _ => return Err("unknown preference".into()),
    }
    Ok(prefs)
}

pub fn set(app: &AppHandle, key: &str, value: bool) -> Result<Prefs, String> {
    let state = app.state::<Mutex<Prefs>>();
    let mut guard = state.lock().map_err(|_| "preferences unavailable")?;
    let next = apply(*guard, key, value)?;
    save(app, &next).map_err(|error| {
        eprintln!("could not save preferences: {error}");
        "could not save preferences".to_string()
    })?;
    *guard = next;
    drop(guard);
    if let Some(item) = app.try_state::<PreviewMenuItem>() {
        let _ = item.0.set_checked(next.notification_preview);
    }
    for label in [crate::shell::STATUS, "settings"] {
        let _ = app.emit_to(label, "prefs-changed", next);
    }
    Ok(next)
}

fn trusted_settings_view(webview: &tauri::Webview) -> bool {
    webview.label() == "settings"
        && webview
            .url()
            .is_ok_and(|url| crate::shell::local_asset_url(&url))
}

#[tauri::command]
pub fn get_preferences(
    webview: tauri::Webview,
    state: tauri::State<'_, Mutex<Prefs>>,
) -> Result<Prefs, String> {
    if !trusted_settings_view(&webview) {
        return Err("settings view required".into());
    }
    state
        .lock()
        .map(|p| *p)
        .map_err(|_| "preferences unavailable".into())
}

#[tauri::command]
pub fn set_preference(
    app: AppHandle,
    webview: tauri::Webview,
    key: String,
    value: bool,
) -> Result<Prefs, String> {
    if !trusted_settings_view(&webview) {
        return Err("settings view required".into());
    }
    set(&app, &key, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_broken_files_keep_previews_on() {
        assert!(from_json("").notification_preview);
        assert!(from_json("not json").notification_preview);
        assert!(from_json("{}").notification_preview);
    }

    #[test]
    fn unknown_preference_is_rejected_and_known_one_applies() {
        assert_eq!(
            apply(Prefs::default(), "autostart", true).err().as_deref(),
            Some("unknown preference")
        );
        assert!(
            !apply(Prefs::default(), "notification_preview", false)
                .unwrap()
                .notification_preview
        );
    }

    #[test]
    fn stored_choice_is_honored() {
        assert!(!from_json("{\"notification_preview\":false}").notification_preview);
    }
}
