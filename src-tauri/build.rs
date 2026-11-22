use std::{env, fs, path::PathBuf};

/// Joins src/inject/*.js, in file-name order, into one function that is
/// handed to every Messenger page (see INJECT_SCRIPT in lib.rs). The parts
/// share its scope, so a part can use what an earlier one declares and
/// `return` ends the whole script. src/tests/inject-source.mjs does the same
/// join for the tests; keep the two wrappers identical.
fn join_inject_parts() {
    let dir = PathBuf::from("src/inject");
    println!("cargo:rerun-if-changed=src/inject");
    let mut parts: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("src/inject is missing")
        .map(|entry| entry.expect("unreadable src/inject entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "js"))
        .collect();
    parts.sort();
    let mut script = String::from("(() => {\n");
    for part in parts {
        let source = fs::read_to_string(&part).expect("unreadable inject part");
        script.push_str(&format!(
            "// ---- {}\n",
            part.file_name().unwrap().to_string_lossy()
        ));
        script.push_str(source.trim_end());
        script.push('\n');
    }
    script.push_str("})();\n");
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is not set")).join("inject.js");
    fs::write(out, script).expect("could not write inject.js");
}

fn main() {
    join_inject_parts();
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notification_event",
            "test_notification",
            "show_settings",
            "get_preferences",
            "set_preference",
            "set_theme_preference",
            "reveal_last_download",
            "get_update_state",
            "check_update",
            "install_update",
            "get_diagnostics",
            "list_accounts",
            "add_account",
            "set_update_schedule",
            "open_project_link",
            "remove_account",
            "open_account",
            "close_tab",
            "move_tab",
            "tab_shortcut",
            "open_tab_menu",
            "close_tab_menu",
        ]),
    ))
    .expect("could not prepare Tauri application");
}
