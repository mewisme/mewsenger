mod accounts;
mod appid;
mod desktop;
mod diagnostics;
mod downloads;
mod links;
mod notifications;
mod prefs;
mod shell;
mod site;
mod toast;
mod updater;

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse},
    AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder, WindowBuilder, WindowEvent,
};
use tauri_plugin_positioner::{Position, WindowExt};

/// Page scripts, run in file-name order after the site prelude. Numbers leave
/// room to slot new parts between existing ones.
pub(crate) const INJECT_SCRIPTS: [&str; 3] = [
    include_str!("inject/10-links.js"),
    include_str!("inject/20-desktop.js"),
    include_str!("inject/30-notifications.js"),
];

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
        .initialization_script(site::current().prelude());
    let builder = INJECT_SCRIPTS
        .iter()
        .fold(builder, |builder, script| builder.initialization_script(*script))
        .on_navigation(move |url| links::allow_navigation(&navigation_app, url))
        .on_new_window(move |url, features| open_popup(&popup_app, url, features))
        .on_download(downloads::handler(app.clone()));

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
        .manage(std::sync::Mutex::new(notifications::Registry::default()))
        .manage(std::sync::Mutex::new(downloads::DownloadState::default()))
        .invoke_handler(tauri::generate_handler![
            notifications::notification_event,
            notifications::test_notification,
            shell::show_settings,
            prefs::get_preferences,
            prefs::set_preference,
            downloads::reveal_last_download,
            updater::get_update_state,
            updater::check_update,
            updater::install_update,
            diagnostics::get_diagnostics,
            accounts::list_accounts,
            accounts::add_account,
            accounts::rename_account,
            accounts::remove_account,
            accounts::open_account,
            accounts::close_tab,
            accounts::move_tab,
            accounts::tab_shortcut,
            accounts::open_tab_menu,
            accounts::close_tab_menu,
            accounts::set_settings_placement,
            accounts::close_settings
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
            app.manage(std::sync::Mutex::new(accounts::load(app.handle())));
            let updater_configured = updater::configured(app.handle());
            app.manage(std::sync::Mutex::new(updater::initial_state(
                updater_configured,
            )));
            if updater_configured {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
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
            // and event callbacks; the layout is mounted from a worker.
            let start_hidden = std::env::args().any(|arg| arg == "--minimized");
            let show = shell::should_show_on_start(
                start_hidden,
                desktop::TRAY_AVAILABLE.load(std::sync::atomic::Ordering::Relaxed),
            );
            shell::apply_layout(app.handle(), show);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
