use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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
    fn stored_choice_is_honored() {
        assert!(!from_json("{\"notification_preview\":false}").notification_preview);
    }
}
