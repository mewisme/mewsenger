mod desktop;
mod links;

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse},
    AppHandle, Runtime, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_positioner::{Position, WindowExt};

const MESSENGER_URL: &str = "https://www.messenger.com";
const LINK_SCRIPT: &str = include_str!("links.js");
const DESKTOP_SCRIPT: &str = include_str!("desktop.js");

fn open_popup<R: Runtime>(
    app: &AppHandle<R>,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<R> {
    if !links::opens_in_app(&url) {
        links::open_external(app, &url);
        return NewWindowResponse::Deny;
    }

    static NEXT_POPUP: AtomicUsize = AtomicUsize::new(1);
    let label = format!("popup-{}", NEXT_POPUP.fetch_add(1, Ordering::Relaxed));
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title("Messenger")
        .window_features(features)
        .initialization_script(LINK_SCRIPT)
        .initialization_script(DESKTOP_SCRIPT)
        .on_navigation(move |url| links::allow_navigation(&navigation_app, url))
        .on_new_window(move |url, features| open_popup(&popup_app, url, features))
        .on_download(|_, _| true);

    match builder.build() {
        Ok(window) => NewWindowResponse::Create { window },
        Err(err) => {
            eprintln!("could not open Messenger popup: {err}");
            NewWindowResponse::Deny
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .on_window_event(desktop::on_window_event)
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let url = Url::parse(MESSENGER_URL).expect("valid initial URL");
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Messenger")
                .inner_size(800.0, 600.0)
                .min_inner_size(800.0, 600.0)
                .initialization_script(LINK_SCRIPT)
                .initialization_script(DESKTOP_SCRIPT)
                .on_navigation(move |url| links::allow_navigation(&navigation_app, url))
                .on_new_window(move |url, features| open_popup(&popup_app, url, features))
                .on_download(|_, _| true)
                .build()?;
            window.move_window(Position::Center).unwrap();
            // A missing system tray must never prevent Messenger from starting.
            if let Err(error) = desktop::setup(app) {
                eprintln!("could not initialize desktop menu/tray: {error}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
