fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notification_event",
            "current_status",
            "test_notification",
            "show_settings",
            "get_preferences",
            "set_preference",
            "reveal_last_download",
            "get_update_state",
            "check_update",
            "install_update",
            "get_diagnostics",
            "set_split_layout",
            "list_accounts",
            "add_account",
            "rename_account",
            "remove_account",
            "set_layout",
            "open_account",
        ]),
    ))
    .expect("could not prepare Tauri application");
}
