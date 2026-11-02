fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["notification_event"])),
    )
    .expect("could not prepare Tauri application");
}
