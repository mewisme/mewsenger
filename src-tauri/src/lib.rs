mod appid;
mod desktop;
mod links;
mod notifications;
mod prefs;
mod shell;
mod site;

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse},
    AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder, WindowBuilder, WindowEvent,
};
use tauri_plugin_positioner::{Position, WindowExt};

const LINK_SCRIPT: &str = include_str!("links.js");
const DESKTOP_SCRIPT: &str = include_str!("desktop.js");
const NOTIFICATIONS_SCRIPT: &str = include_str!("notifications.js");

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
        .initialization_script(site::current().prelude())
        .initialization_script(LINK_SCRIPT)
        .initialization_script(DESKTOP_SCRIPT)
        .initialization_script(NOTIFICATIONS_SCRIPT)
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main(app);
        }))
        .manage(std::sync::Mutex::new(
            notifications::NotificationState::default(),
        ))
        .invoke_handler(tauri::generate_handler![
            notifications::notification_event,
            notifications::current_status,
            notifications::test_notification,
            shell::show_credits,
            shell::show_settings,
            prefs::get_preferences,
            prefs::set_preference
        ])
        .on_window_event(|window, event| {
            desktop::on_window_event(window, event);
            if matches!(
                event,
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
            ) {
                if let Err(error) = shell::resize(window) {
                    eprintln!("could not resize Messenger views: {error}");
                }
            }
        })
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            appid::register(app.handle());
            app.manage(std::sync::Mutex::new(prefs::load(app.handle())));
            let window = WindowBuilder::new(app, "main")
                .title("Messenger")
                .inner_size(800.0, 600.0)
                .min_inner_size(800.0, 600.0)
                .decorations(false)
                .visible(false)
                .build()?;
            window.move_window(Position::Center).unwrap();
            // A missing system tray must never prevent Messenger from starting.
            if let Err(error) = desktop::setup(app) {
                eprintln!("could not initialize desktop menu/tray: {error}");
            }
            // WebView2 child creation can deadlock from Tauri's synchronous setup
            // and event callbacks. Mount from a worker after the event loop starts.
            let start_hidden = std::env::args().any(|arg| arg == "--minimized");
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = shell::mount(&handle, &window, start_hidden) {
                    eprintln!("could not initialize Messenger views: {error}");
                    let _ = window.set_decorations(true);
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
