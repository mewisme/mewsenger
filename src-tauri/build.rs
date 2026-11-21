fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notification_event",
            "current_status",
            "test_notification",
            "show_credits",
            "show_settings",
            "get_preferences",
            "set_preference",
        ]),
    ))
    .expect("could not prepare Tauri application");
}
