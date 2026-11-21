//! The app's folders are named after its identifier, which changed from
//! `com.mew.messenger` to `com.mew.mewsenger`. Moving them keeps the signed-in
//! sessions, accounts and preferences instead of starting over.
use std::{fs, io, path::Path};

use tauri::{AppHandle, Manager};

const OLD_IDENTIFIER: &str = "com.mew.messenger";

/// Moves `old` to `new` when `old` exists and `new` is missing or empty; true
/// when it moved. Anything already in `new` is never overwritten.
pub(crate) fn move_dir(old: &Path, new: &Path) -> io::Result<bool> {
    if !old.is_dir() {
        return Ok(false);
    }
    if new.exists() {
        // A folder the new identifier already got (a log directory, say) must
        // not block the move, but one with content is the user's.
        if fs::read_dir(new)?.next().is_some() {
            return Ok(false);
        }
        fs::remove_dir(new)?;
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(old, new)?;
    Ok(true)
}

/// Runs before anything reads or creates the app's data.
pub fn run(app: &AppHandle) {
    let paths = app.path();
    for new in [
        paths.app_config_dir(),
        paths.app_data_dir(),
        paths.app_local_data_dir(),
    ]
    .into_iter()
    .flatten()
    {
        let Some(old) = new.parent().map(|parent| parent.join(OLD_IDENTIFIER)) else {
            continue;
        };
        if let Err(error) = move_dir(&old, &new) {
            eprintln!(
                "could not move {} to {}: {error}",
                old.display(),
                new.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mewsenger-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn old_data_moves_when_the_new_folder_is_missing_or_empty() {
        let root = scratch("moves");
        let old = root.join("old");
        fs::create_dir_all(old.join("EBWebView")).unwrap();
        fs::write(old.join("accounts.json"), "{}").unwrap();
        let new = root.join("new");
        assert!(move_dir(&old, &new).unwrap());
        assert!(new.join("accounts.json").is_file() && new.join("EBWebView").is_dir());
        assert!(!old.exists());

        let again = root.join("again");
        fs::create_dir_all(&again).unwrap();
        fs::create_dir_all(root.join("older")).unwrap();
        fs::write(root.join("older/file"), "x").unwrap();
        assert!(move_dir(&root.join("older"), &again).unwrap());
        assert!(again.join("file").is_file());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn nothing_is_overwritten_and_nothing_moves_without_old_data() {
        let root = scratch("keeps");
        let old = root.join("old");
        let new = root.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("a"), "old").unwrap();
        fs::write(new.join("a"), "new").unwrap();
        assert!(!move_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("a")).unwrap(), "new");
        assert!(old.join("a").is_file());
        assert!(!move_dir(&root.join("missing"), &root.join("elsewhere")).unwrap());
        fs::remove_dir_all(&root).unwrap();
    }
}
