use std::sync::atomic::{AtomicBool, Ordering};

use crate::{accounts, notifications};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Window, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

const MAIN: &str = "main";
pub static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

/// Tray submenu with one entry per account.
pub struct AccountsMenu(pub Submenu<tauri::Wry>);

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

/// Opens the conversation a toast was created for in its account's page and
/// returns that account.
fn open_notification_thread(app: &AppHandle, notification_id: i32) -> Option<String> {
    let (account, url) = notifications::clicked_thread(app, notification_id)?;
    let webview = app.get_webview(&accounts::remote_label(&account))?;
    // A toast must not interrupt Messenger login or an external redirect.
    if !webview
        .url()
        .is_ok_and(|url| notifications::trusted(&url, webview.label()))
    {
        return None;
    }
    // This is a URL built and validated on the Rust side, never executable
    // text supplied by a notification or an external browser.
    let target = serde_json::to_string(url.as_str()).ok()?;
    let _ = webview.eval(format!("window.location.assign({target});"));
    Some(account)
}

fn show_window(window: &Window) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_window(MAIN) {
        show_window(&window);
    }
}

/// Brings the main window to the front showing `account`'s tab, opening the
/// tab first when the account has none.
pub(crate) fn show_account(app: &AppHandle, account: &str) {
    let config = accounts::snapshot(app);
    if config.account(account).is_some() && config.shown_account() != account {
        let _ = accounts::activate(app, account);
    }
    show_main(app);
}

fn is_account_window(label: &str) -> bool {
    label == MAIN
}

fn show_all(app: &AppHandle) {
    show_main(app);
}

fn hide_all(app: &AppHandle) {
    if let Some(window) = app.get_window(MAIN) {
        let _ = window.hide();
    }
}

/// Shows an account's tab and puts focus in its page.
pub(crate) fn open_account(app: &AppHandle, account: &str) {
    if accounts::snapshot(app).account(account).is_none() {
        return;
    }
    show_account(app, account);
    if let Some(webview) = app.get_webview(&accounts::remote_label(account)) {
        let _ = webview.set_focus();
    }
}

/// A WinRT toast created by this app was clicked.
pub(crate) fn activate_toast(app: &AppHandle, account: &str, notification_id: i32) {
    show_account(app, account);
    open_notification_thread(app, notification_id);
}

fn dispatch(app: &AppHandle, id: &str) {
    if let Some(account) = id.strip_prefix("open-account-") {
        open_account(app, account);
        return;
    }
    let active = accounts::active_account(app);
    let remote = || app.get_webview(&accounts::remote_label(&active));
    match id {
        "quit" => app.exit(0),
        "show" => show_all(app),
        "hide" => hide_all(app),
        "search" | "new-chat" | "account" | "logout" | "next-chat" | "prev-chat" | "zoom-in"
        | "zoom-out" | "zoom-reset" => {
            show_account(app, &active);
            if let Some(window) = remote() {
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
            show_account(app, &active);
            if let Some(window) = remote() {
                let _ = window.eval("location.reload()");
            }
        }
        "back" | "forward" => {
            show_account(app, &active);
            if let Some(window) = remote() {
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

/// Rebuilds the tray "Accounts" entries from the stored account list.
pub fn sync_accounts_menu(app: &AppHandle) {
    let Some(menu) = app.try_state::<AccountsMenu>() else {
        return;
    };
    if let Ok(items) = menu.0.items() {
        for item in items {
            let _ = menu.0.remove(&item);
        }
    }
    for account in accounts::snapshot(app).accounts {
        let item = MenuItemBuilder::with_id(format!("open-account-{}", account.id), account.label())
            .build(app);
        match item {
            Ok(item) => {
                let _ = menu.0.append(&item);
            }
            Err(error) => eprintln!("could not add account menu item: {error}"),
        }
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    // Windows only reports notification clicks while the toast is visible.
    // Never infer a conversation ID or promise Action Center activation.
    let notification_app = app.handle().clone();
    if let Err(error) = app.notification().on_action(move |action| {
        if activates_main_on_toast(action.action_id()) {
            let fallback = action
                .notification()
                .filter(|notification| is_messenger_fallback(notification))
                .and_then(|notification| {
                    open_notification_thread(&notification_app, notification.id())
                });
            match fallback {
                Some(account) => show_account(&notification_app, &account),
                None => show_main(&notification_app),
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
    let accounts_menu = SubmenuBuilder::with_id(app, "accounts", "Accounts").build()?;
    app.manage(AccountsMenu(accounts_menu.clone()));
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
        .item(&accounts_menu)
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
        .tooltip("Mewsenger")
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
    sync_accounts_menu(app.handle());
    TRAY_AVAILABLE.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn set_tray_tooltip(app: &AppHandle, unread: usize) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let text = if unread == 0 {
        "Mewsenger".to_string()
    } else {
        format!("Mewsenger - {unread} unread")
    };
    let _ = tray.set_tooltip(Some(text));
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if !is_account_window(window.label()) {
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
    use super::{activates_main_on_toast, is_account_window, is_messenger_fallback};

    #[test]
    fn toast_activation_only_handles_direct_taps() {
        assert!(activates_main_on_toast("tap"));
        assert!(!activates_main_on_toast("dismiss"));
        assert!(!activates_main_on_toast("reply"));
        assert!(!activates_main_on_toast(""));
    }

    #[test]
    fn closing_the_main_window_hides_it_but_other_windows_close() {
        assert!(is_account_window("main"));
        assert!(!is_account_window("acct-a2"));
        assert!(!is_account_window("settings"));
        assert!(!is_account_window("popup-1"));
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
