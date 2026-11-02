use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::MenuBuilder,
    tray::{TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Window, WindowEvent,
};

const MAIN: &str = "main";
const REMOTE: &str = "messenger";
static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn dispatch(app: &AppHandle, id: &str) {
    match id {
        "quit" => app.exit(0),
        "show" => show_main(app),
        "hide" => {
            if let Some(window) = app.get_window(MAIN) {
                let _ = window.hide();
            }
        }
        "search" | "new-chat" | "account" | "logout" | "next-chat" | "prev-chat" | "zoom-in"
        | "zoom-out" | "zoom-reset" => {
            show_main(app);
            if let Some(window) = app.get_webview(REMOTE) {
                let script = match id {
                    "search" => r#"window.__mewDesktopAction?.("search")"#,
                    "new-chat" => r#"window.__mewDesktopAction?.("new-chat")"#,
                    "account" => r#"window.__mewDesktopAction?.("account")"#,
                    "logout" => r#"window.__mewDesktopAction?.("logout")"#,
                    "next-chat" => r#"window.__mewDesktopAction?.("next-chat")"#,
                    "prev-chat" => r#"window.__mewDesktopAction?.("prev-chat")"#,
                    "zoom-in" => r#"window.__mewDesktopAction?.("zoom-in")"#,
                    "zoom-out" => r#"window.__mewDesktopAction?.("zoom-out")"#,
                    _ => r#"window.__mewDesktopAction?.("zoom-reset")"#,
                };
                let _ = window.eval(script);
            }
        }
        "reload" => {
            show_main(app);
            if let Some(window) = app.get_webview(REMOTE) {
                let _ = window.eval("location.reload()");
            }
        }
        "back" | "forward" => {
            show_main(app);
            if let Some(window) = app.get_webview(REMOTE) {
                let _ = window.eval(if id == "back" {
                    "history.back()"
                } else {
                    "history.forward()"
                });
            }
        }
        _ => {}
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show", "Show Messenger")
        .text("search", "Search chats")
        .text("new-chat", "New message")
        .text("next-chat", "Next chat")
        .text("prev-chat", "Previous chat")
        .separator()
        .text("zoom-in", "Zoom photo in")
        .text("zoom-out", "Zoom photo out")
        .text("zoom-reset", "Reset photo zoom")
        .separator()
        .text("back", "Back")
        .text("forward", "Forward")
        .text("reload", "Reload Messenger")
        .text("account", "Account menu")
        .text("logout", "Sign out")
        .separator()
        .text("hide", "Hide Messenger")
        .text("quit", "Quit")
        .build()?;
    // Keep the web interface unchanged: commands live in the native tray menu.
    app.on_menu_event(|app, event| dispatch(app, event.id().as_ref()));
    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::new()
        .tooltip("Messenger")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    TRAY_AVAILABLE.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        if !TRAY_AVAILABLE.load(Ordering::Relaxed) {
            return;
        }
        api.prevent_close();
        let _ = window.hide();
    }
}
