use std::sync::atomic::{AtomicBool, Ordering};

use crate::notifications;
use tauri::{
    menu::MenuBuilder,
    tray::{TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Window, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

const MAIN: &str = "main";
const REMOTE: &str = "messenger";
pub static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

fn activates_main_on_toast(action: &str) -> bool {
    action == "tap"
}

fn is_messenger_fallback(notification: &tauri_plugin_notification::ActiveNotification) -> bool {
    notification
        .extra()
        .get("messenger_fallback")
        .and_then(|value| value.as_bool())
        == Some(true)
}

fn open_notification_thread(app: &AppHandle, notification_id: i32) {
    let Some(url) = notifications::clicked_thread(app, notification_id) else {
        return;
    };
    let Some(webview) = app.get_webview(REMOTE) else {
        return;
    };
    // A toast must not interrupt Messenger login or an external redirect.
    if !webview
        .url()
        .is_ok_and(|url| notifications::trusted(&url, webview.label()))
    {
        return;
    }
    // This is a URL built and validated on the Rust side, never executable
    // text supplied by a notification or an external browser.
    let Ok(target) = serde_json::to_string(url.as_str()) else {
        return;
    };
    let _ = webview.eval(format!("window.location.assign({target});"));
}

pub(crate) fn show_main(app: &AppHandle) {
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
        "notification-preview" => {
            // The check item already toggled itself on click.
            if let Some(item) = app.try_state::<crate::prefs::PreviewMenuItem>() {
                if let Ok(checked) = item.0.is_checked() {
                    if let Err(error) = crate::prefs::set(app, "notification_preview", checked) {
                        eprintln!("could not save preferences: {error}");
                    }
                }
            }
        }
        "settings" => crate::shell::open_settings(app),
        _ => {}
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    // Windows only reports notification clicks while the toast is visible.
    // Never infer a conversation ID or promise Action Center activation.
    let notification_app = app.handle().clone();
    if let Err(error) = app.notification().on_action(move |action| {
        if activates_main_on_toast(action.action_id()) {
            show_main(&notification_app);
            if let Some(notification) = action.notification() {
                if is_messenger_fallback(notification) {
                    open_notification_thread(&notification_app, notification.id());
                }
            }
        }
    }) {
        eprintln!("could not register notification actions: {error}");
    }
    let preview = app
        .state::<std::sync::Mutex<crate::prefs::Prefs>>()
        .lock()
        .map(|p| p.notification_preview)
        .unwrap_or(true);
    let preview_item = tauri::menu::CheckMenuItemBuilder::with_id(
        "notification-preview",
        "Show message previews in notifications",
    )
    .checked(preview)
    .build(app)?;
    app.manage(crate::prefs::PreviewMenuItem(preview_item.clone()));
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
        .text("settings", "Settings…")
        .text("logout", "Sign out")
        .separator()
        .item(&preview_item)
        .separator()
        .text("hide", "Hide Messenger")
        .text("quit", "Quit")
        .build()?;
    // Keep the web interface unchanged: commands live in the native tray menu.
    app.on_menu_event(|app, event| dispatch(app, event.id().as_ref()));
    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id("main")
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

pub fn set_tray_tooltip(app: &AppHandle, unread: usize) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let text = if unread == 0 {
        "Messenger".to_string()
    } else {
        format!("Messenger - {unread} unread")
    };
    let _ = tray.set_tooltip(Some(text));
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

#[cfg(test)]
mod tests {
    use super::{activates_main_on_toast, is_messenger_fallback};

    #[test]
    fn toast_activation_only_handles_direct_taps() {
        assert!(activates_main_on_toast("tap"));
        assert!(!activates_main_on_toast("dismiss"));
        assert!(!activates_main_on_toast("reply"));
        assert!(!activates_main_on_toast(""));
    }

    #[test]
    fn only_app_generated_fallback_toasts_can_route_a_chat() {
        let ours: tauri_plugin_notification::ActiveNotification =
            serde_json::from_value(serde_json::json!({
                "id": 17, "extra": { "messenger_fallback": true }
            }))
            .unwrap();
        let other: tauri_plugin_notification::ActiveNotification =
            serde_json::from_value(serde_json::json!({
                "id": 17, "extra": { "messenger_fallback": false }
            }))
            .unwrap();
        let missing: tauri_plugin_notification::ActiveNotification =
            serde_json::from_value(serde_json::json!({
                "id": 17
            }))
            .unwrap();
        assert!(is_messenger_fallback(&ours));
        assert!(!is_messenger_fallback(&other));
        assert!(!is_messenger_fallback(&missing));
    }
}
