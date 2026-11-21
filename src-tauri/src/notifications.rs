use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::Emitter;
use tauri::{AppHandle, Manager, State, Url, Webview};
use tauri_plugin_notification::NotificationExt;

use crate::toast;

const MAX_TOASTS_PER_MINUTE: usize = 12;

fn with_sound<R: tauri::Runtime>(
    b: tauri_plugin_notification::NotificationBuilder<R>,
) -> tauri_plugin_notification::NotificationBuilder<R> {
    if cfg!(windows) {
        b.sound("Default")
    } else {
        b
    }
}

fn notification_text(preview: bool, title: String, body: String) -> (String, String) {
    if preview {
        (title, body)
    } else {
        ("Mewsenger".into(), "New message".into())
    }
}

#[derive(Default)]
pub struct NotificationState {
    seen: HashMap<String, Instant>,
    rate: VecDeque<Instant>,
    unread: Option<usize>,
    session: Option<bool>,
    replying: HashMap<String, String>,
}

impl NotificationState {
    pub fn session(&self) -> Option<bool> {
        self.session
    }

    pub fn unread(&self) -> Option<usize> {
        self.unread
    }
}

struct PendingToast {
    account: String,
    thread: String,
    created: Instant,
}

/// Per-account notification state plus the toast ids, which stay unique
/// across accounts because the plugin fallback keys on the numeric id alone.
#[derive(Default)]
pub struct Registry {
    accounts: HashMap<String, NotificationState>,
    pending: HashMap<i32, PendingToast>,
    next_toast_id: i32,
}

impl Registry {
    pub fn state(&mut self, account: &str) -> &mut NotificationState {
        self.accounts.entry(account.to_string()).or_default()
    }

    pub fn get(&self, account: &str) -> Option<&NotificationState> {
        self.accounts.get(account)
    }

    /// Sum of the unread counts that are known; unknown accounts add nothing.
    pub fn total_unread(&self) -> usize {
        self.accounts.values().filter_map(|s| s.unread).sum()
    }

    fn next_id(&self) -> i32 {
        self.next_toast_id.checked_add(1).unwrap_or(1)
    }

    fn trim_pending(&mut self, now: Instant) {
        self.pending
            .retain(|_, toast| now.duration_since(toast.created) < TOAST_LIFETIME);
        if self.pending.len() > 128 {
            self.pending.clear();
        }
    }

    /// Drops everything known about an account that no longer exists.
    pub fn forget(&mut self, account: &str) {
        self.accounts.remove(account);
        self.pending.retain(|_, toast| toast.account != account);
    }
}

const TOAST_LIFETIME: Duration = Duration::from_secs(600);

fn routable_thread(thread: &str) -> bool {
    !thread.is_empty()
        && thread.len() <= 160
        && thread
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-:.".contains(&c))
}

fn thread_url(thread: &str) -> Option<Url> {
    if !routable_thread(thread) {
        return None;
    }
    crate::site::current().thread_url(thread)
}

fn clear_thread(registry: &mut Registry, account: &str, thread: &str) {
    registry
        .pending
        .retain(|_, toast| toast.account != account || toast.thread != thread);
}

fn route_for_tap(registry: &mut Registry, id: i32, now: Instant) -> Option<(String, Url)> {
    let toast = registry.pending.remove(&id)?;
    if now.duration_since(toast.created) >= TOAST_LIFETIME {
        return None;
    }
    let url = thread_url(&toast.thread)?;
    Some((toast.account, url))
}

pub fn clicked_thread(app: &AppHandle, id: i32) -> Option<(String, Url)> {
    let registry = app.try_state::<Mutex<Registry>>()?;
    let mut registry = registry.lock().ok()?;
    route_for_tap(&mut registry, id, Instant::now())
}

/// Inline reply from a toast stays off until it has been confirmed against a
/// live Messenger session.
const QUICK_REPLY: bool = false;
const REPLY_FAILED_NOTICE: &str = "Reply not sent; open Messenger";
const MAX_REPLY_CHARS: usize = 2000;
const MAX_PENDING_REPLIES: usize = 16;

fn toast_tag(account: &str, id: i32) -> String {
    format!("toast-{account}-{id}")
}

fn parse_toast_tag(tag: &str) -> Option<(String, i32)> {
    let (account, id) = tag.strip_prefix("toast-")?.split_once('-')?;
    crate::accounts::account_of(&crate::accounts::remote_label(account))?;
    Some((account.to_string(), id.parse().ok()?))
}

/// Action Center group for one conversation; empty when it would not fit.
fn thread_group(account: &str, thread: Option<&str>) -> String {
    thread
        .map(|thread| format!("{account}-thread-{thread}"))
        .filter(|group| group.chars().count() <= 64)
        .unwrap_or_default()
}

/// Trimmed reply text, or `None` when it is empty, too long or has control
/// characters other than a newline.
fn validate_reply(text: &str) -> Option<String> {
    let text = text.trim();
    let valid = !text.is_empty()
        && text.chars().count() <= MAX_REPLY_CHARS
        && text.chars().all(|c| c == '\n' || !c.is_control());
    valid.then(|| text.to_string())
}

/// Account and conversation a still-valid toast belongs to. Does not consume
/// the mapping.
fn reply_target(registry: &Registry, id: i32, now: Instant) -> Option<(String, String)> {
    let toast = registry.pending.get(&id)?;
    (now.duration_since(toast.created) < TOAST_LIFETIME)
        .then(|| (toast.account.clone(), toast.thread.clone()))
}

/// How a message for an account is announced.
#[derive(Debug, PartialEq, Eq)]
enum Delivery {
    /// The account's tab is on screen in the window in use.
    None,
    /// Another tab is in front of the window in use: its tab says so.
    TabAlert,
    /// The window is hidden or not in use: a system toast.
    Toast,
}

fn delivery(window_in_use: bool, account_shown: bool) -> Delivery {
    match (window_in_use, account_shown) {
        (true, true) => Delivery::None,
        (true, false) => Delivery::TabAlert,
        (false, _) => Delivery::Toast,
    }
}

/// True when the main window is visible and has the focus.
fn window_in_use(app: &AppHandle) -> bool {
    app.get_window("main").is_some_and(|window| {
        window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
    })
}

/// Shows an alert on the account's tab; it lasts until the tab is opened.
fn alert_tab(app: &AppHandle, account: &str, title: &str, body: &str) {
    let _ = app.emit_filter(
        "tab-alert",
        serde_json::json!({ "account": account, "title": title, "body": body }),
        |target| {
            matches!(target, tauri::EventTarget::Webview { label }
                if label.starts_with("titlebar-"))
        },
    );
}

/// True when nobody is looking at the account's page: its tab is not the one
/// on screen, or the main window is hidden or unfocused.
fn in_background(app: &AppHandle, account: &str) -> bool {
    if crate::accounts::snapshot(app).shown_account() != account {
        return true;
    }
    app.get_window("main").is_none_or(|window| {
        !window.is_visible().unwrap_or(true) || !window.is_focused().unwrap_or(true)
    })
}

fn notice(app: &AppHandle, body: &str) {
    if let Err(error) = with_sound(app.notification().builder())
        .title("Mewsenger")
        .body(body)
        .show()
    {
        eprintln!("could not show notice: {error}");
    }
}

/// Shows one desktop toast: through WinRT where available (so it can be
/// removed per conversation), otherwise through the notification plugin.
fn deliver(
    app: &AppHandle,
    account: &str,
    toast_id: i32,
    group: String,
    title: String,
    body: String,
    reply: bool,
) -> Result<(), String> {
    let handler_app = app.clone();
    let request = toast::ToastRequest {
        tag: toast_tag(account, toast_id),
        group,
        title: title.clone(),
        body: body.clone(),
        reply,
    };
    match toast::show(app, request, move |event| {
        handle_toast_event(&handler_app, event)
    }) {
        Ok(()) => return Ok(()),
        Err(error) if error == "unsupported" => {}
        Err(error) => eprintln!("WinRT toast unavailable, using plugin: {error}"),
    }
    with_sound(app.notification().builder())
        .id(toast_id)
        .extra("messenger_fallback", true)
        .title(title)
        .body(body)
        .show()
        .map_err(|error| {
            eprintln!("could not show desktop notification: {error}");
            "native notification unavailable".into()
        })
}

fn handle_toast_event(app: &AppHandle, event: toast::ToastEvent) {
    match event {
        toast::ToastEvent::Opened { tag } => {
            if let Some((account, id)) = parse_toast_tag(&tag) {
                crate::desktop::activate_toast(app, &account, id);
            }
        }
        toast::ToastEvent::Reply { tag, text } => quick_reply(app, &tag, &text),
        toast::ToastEvent::Dismissed { .. } => {}
    }
}

fn quick_reply(app: &AppHandle, tag: &str, text: &str) {
    let (Some((account, id)), Some(text)) = (parse_toast_tag(tag), validate_reply(text)) else {
        return;
    };
    let Some(registry) = app.try_state::<Mutex<Registry>>() else {
        return;
    };
    let Some(webview) = app.get_webview(&crate::accounts::remote_label(&account)) else {
        return;
    };
    if !webview
        .url()
        .is_ok_and(|url| trusted(&url, webview.label()))
    {
        return;
    }
    let nonce = tag.to_string();
    let thread = {
        let Ok(mut registry) = registry.lock() else {
            return;
        };
        let Some((owner, thread)) = reply_target(&registry, id, Instant::now()) else {
            return;
        };
        if owner != account {
            return;
        }
        let state = registry.state(&account);
        if state.replying.len() >= MAX_PENDING_REPLIES {
            return;
        }
        state.replying.insert(nonce.clone(), thread.clone());
        thread
    };
    let payload = serde_json::json!({ "thread": thread, "text": text, "nonce": nonce });
    let delivered = serde_json::to_string(&payload).ok().is_some_and(|json| {
        webview
            .eval(format!("window.__mewQuickReply?.({json});"))
            .is_ok()
    });
    if !delivered {
        if let Ok(mut registry) = registry.lock() {
            registry.state(&account).replying.remove(&nonce);
        }
        notice(app, REPLY_FAILED_NOTICE);
    }
}

#[tauri::command]
pub fn test_notification(app: AppHandle, webview: Webview) -> Result<(), String> {
    use crate::shell::LocalKind;
    if !crate::shell::local_webview(&webview, &[LocalKind::Settings]) {
        return Err("local view required".into());
    }
    deliver(
        &app,
        crate::accounts::FIRST,
        0,
        "test".into(),
        "Mewsenger notification test".into(),
        "Desktop notification request sent from Messenger.".into(),
        false,
    )
    .map_err(|_| "Windows notification request failed".into())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MessageEvent {
    Notify {
        id: String,
        title: String,
        body: String,
        thread_id: Option<String>,
    },
    Unread {
        threads: Vec<String>,
    },
    Read {
        thread_id: String,
    },
    Session {
        state: String,
    },
    ReplyResult {
        nonce: String,
        ok: bool,
        reason: Option<String>,
    },
    Shortcut {
        action: String,
    },
    AccountName {
        name: String,
        picture: Option<String>,
    },
    Reset,
}

pub(crate) fn trusted(url: &Url, label: &str) -> bool {
    label.starts_with("messenger-")
        && crate::accounts::account_of(label).is_some()
        && crate::site::current().is_app_origin(url)
}

fn safe_string(value: &str, max: usize) -> Option<&str> {
    if value.is_empty() || value.len() > max || value.chars().any(|c| c.is_control() && c != '\n') {
        return None;
    }
    Some(value)
}

fn trim_history(state: &mut NotificationState, now: Instant) {
    state.seen.retain(|key, time| {
        let max_age = if key.starts_with("body:") {
            15
        } else {
            600
        };
        now.duration_since(*time) < Duration::from_secs(max_age)
    });
    while state
        .rate
        .front()
        .is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60))
    {
        state.rate.pop_front();
    }
}

fn reset_view_state(registry: &mut Registry, account: &str) {
    registry.pending.retain(|_, toast| toast.account != account);
    let state = registry.state(account);
    state.unread = None;
    state.session = None;
    // Keep deduplication and rate limits across navigation and page reloads.
    // A remote page must not reset notification throttling.
}

fn unread_icon(count: usize) -> tauri::image::Image<'static> {
    const W: usize = 32;
    const H: usize = 32;
    let mut rgba = vec![0u8; W * H * 4];
    for y in 0..H {
        for x in 0..W {
            let d = (x as i32 - 16).pow(2) + (y as i32 - 16).pow(2);
            if d <= 14 * 14 {
                let i = (y * W + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[213, 35, 49, 255]);
            }
        }
    }
    let label = if count >= 100 {
        "99+".to_owned()
    } else {
        count.to_string()
    };
    let digit = |c: char| -> [u8; 7] {
        match c {
            '0' => [7, 5, 5, 5, 5, 5, 7],
            '1' => [2, 6, 2, 2, 2, 2, 7],
            '2' => [7, 1, 1, 7, 4, 4, 7],
            '3' => [7, 1, 1, 7, 1, 1, 7],
            '4' => [5, 5, 5, 7, 1, 1, 1],
            '5' => [7, 4, 4, 7, 1, 1, 7],
            '6' => [7, 4, 4, 7, 5, 5, 7],
            '7' => [7, 1, 1, 1, 1, 1, 1],
            '8' => [7, 5, 5, 7, 5, 5, 7],
            '9' => [7, 5, 5, 7, 1, 1, 7],
            _ => [0, 0, 2, 7, 2, 0, 0],
        }
    };
    let scale = if label.len() == 3 { 2 } else { 3 };
    let width = label.len() * 4 * scale - scale;
    let start_x = (W - width) / 2;
    let start_y = (H - 7 * scale) / 2;
    for (char_index, c) in label.chars().enumerate() {
        for (row, bits) in digit(c).iter().enumerate() {
            for col in 0..3 {
                if bits & (1 << (2 - col)) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let x = start_x + char_index * 4 * scale + col * scale + dx;
                        let y = start_y + row * scale + dy;
                        let i = (y * W + x) * 4;
                        rgba[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
                    }
                }
            }
        }
    }
    tauri::image::Image::new_owned(rgba, W as u32, H as u32)
}

fn parse_session(state: &str) -> Result<bool, String> {
    match state {
        "signed_in" => Ok(true),
        "signed_out" => Ok(false),
        _ => Err("invalid session state".into()),
    }
}

fn badge(app: &AppHandle, count: usize) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    #[cfg(target_os = "windows")]
    {
        let result = if count == 0 {
            window.set_overlay_icon(None)
        } else {
            window.set_overlay_icon(Some(unread_icon(count)))
        };
        if let Err(err) = result {
            eprintln!("could not update taskbar badge: {err}");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.set_badge_count(if count == 0 { None } else { Some(count as i64) });
    }
}

#[tauri::command]
pub fn notification_event(
    app: AppHandle,
    webview: Webview,
    registry: State<'_, Mutex<Registry>>,
    prefs: State<'_, Mutex<crate::prefs::Prefs>>,
    event: MessageEvent,
) -> Result<(), String> {
    let current = webview.url().map_err(|_| "origin unavailable")?;
    let account = crate::accounts::account_of(webview.label())
        .ok_or("origin not permitted")?
        .to_string();
    let in_main = webview.window().label() == "main";
    if !trusted(&current, webview.label()) || !in_main {
        return Err("origin not permitted".into());
    }
    let now = Instant::now();
    let mut registry = registry
        .lock()
        .map_err(|_| "notification state unavailable")?;
    registry.trim_pending(now);
    trim_history(registry.state(&account), now);
    let mut unread_change = false;
    match event {
        MessageEvent::Notify {
            id,
            title,
            body,
            thread_id,
        } => {
            safe_string(&id, 160).ok_or("invalid notification id")?;
            safe_string(&title, 140).ok_or("invalid notification title")?;
            safe_string(&body, 500).ok_or("invalid notification body")?;
            if let Some(thread) = &thread_id {
                safe_string(thread, 160).ok_or("invalid conversation id")?;
            }
            {
                let state = registry.state(&account);
                if state.seen.contains_key(&id) {
                    return Ok(());
                }
                // Even a compromised page must not flood Windows notification center.
                if state.rate.len() >= MAX_TOASTS_PER_MINUTE {
                    return Ok(());
                }
            }
            // Messenger raises its notifications whenever its page lacks focus,
            // which also holds while this account's tab is in front of a
            // focused window. A message for the tab on screen needs nothing;
            // one for another tab, with the window in use, shows on that tab;
            // otherwise a system toast.
            let shown = crate::accounts::snapshot(&app).shown_account() == account;
            let how = delivery(window_in_use(&app), shown);
            if how == Delivery::None {
                return Ok(());
            }
            let preview = prefs.lock().map(|p| p.notification_preview).unwrap_or(true);
            let (title, body) = notification_text(preview, title, body);
            if how == Delivery::TabAlert {
                alert_tab(&app, &account, &title, &body);
                let state = registry.state(&account);
                state.seen.insert(id, now);
                state.rate.push_back(now);
                return Ok(());
            }
            let toast_id = registry.next_id();
            // The page reports the notifications Messenger raises while away
            // (and any a browser notification could not show); the app shows them.
            let routable = thread_id.as_deref().filter(|t| routable_thread(t));
            let reply = QUICK_REPLY && routable.is_some() && in_background(&app, &account);
            deliver(
                &app,
                &account,
                toast_id,
                thread_group(&account, routable),
                title,
                body,
                reply,
            )?;
            registry.next_toast_id = toast_id;
            {
                let state = registry.state(&account);
                state.seen.insert(id.clone(), now);
                state.rate.push_back(now);
            }
            if let Some(thread) = thread_id {
                if routable_thread(&thread) {
                    registry.pending.insert(
                        toast_id,
                        PendingToast {
                            account: account.clone(),
                            thread,
                            created: now,
                        },
                    );
                }
            }
        }
        MessageEvent::Unread { threads } => {
            if threads.len() > 500 {
                return Err("too many conversations".into());
            }
            if threads.iter().any(|id| safe_string(id, 160).is_none()) {
                return Err("invalid conversation id".into());
            }
            // Count unique conversation identifiers, not message indicators.
            let unique = threads
                .into_iter()
                .collect::<std::collections::HashSet<_>>();
            let count = unique.len();
            let state = registry.state(&account);
            if state.unread != Some(count) {
                state.unread = Some(count);
                unread_change = true;
            }
        }
        MessageEvent::Read { thread_id } => {
            safe_string(&thread_id, 160).ok_or("invalid conversation id")?;
            // Stop routing this thread's stale notifications and remove its
            // delivered toasts from Action Center (Windows toasts we created).
            clear_thread(&mut registry, &account, &thread_id);
            remove_thread_toasts(&app, &account, &thread_id);
        }
        MessageEvent::AccountName { name, picture } => {
            crate::accounts::set_display_name(&app, &account, &name, picture.as_deref())?;
        }
        MessageEvent::Shortcut { action } => {
            crate::accounts::shortcut(&app, &action)?;
        }
        MessageEvent::Reset => {
            reset_view_state(&mut registry, &account);
            toast::clear_account(&app, &account);
            unread_change = true;
        }
        MessageEvent::ReplyResult { nonce, ok, reason } => {
            safe_string(&nonce, 160).ok_or("invalid reply id")?;
            if let Some(reason) = &reason {
                safe_string(reason, 40).ok_or("invalid reply reason")?;
            }
            if let Some(thread) = registry.state(&account).replying.remove(&nonce) {
                if ok {
                    clear_thread(&mut registry, &account, &thread);
                    remove_thread_toasts(&app, &account, &thread);
                } else {
                    notice(&app, REPLY_FAILED_NOTICE);
                }
            }
        }
        MessageEvent::Session { state } => {
            let signed_in = parse_session(&state)?;
            registry.state(&account).session = Some(signed_in);
        }
    }
    let total = registry.total_unread();
    drop(registry);
    if unread_change {
        badge(&app, total);
        crate::desktop::set_tray_tooltip(&app, total);
    }
    Ok(())
}

fn remove_thread_toasts(app: &AppHandle, account: &str, thread: &str) {
    let group = thread_group(account, Some(thread));
    if !group.is_empty() {
        toast::remove_group(app, &group);
    }
}

/// Drops everything held for an account whose tab closed or that was removed,
/// and refreshes the totals.
pub fn account_closed(app: &AppHandle, account: &str) {
    toast::clear_account(app, account);
    let Some(registry) = app.try_state::<Mutex<Registry>>() else {
        return;
    };
    let total = {
        let Ok(mut registry) = registry.lock() else {
            return;
        };
        registry.forget(account);
        registry.total_unread()
    };
    badge(app, total);
    crate::desktop::set_tray_tooltip(app, total);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_message_text_when_previews_are_off() {
        assert_eq!(
            notification_text(true, "Alice".into(), "hi".into()),
            ("Alice".to_string(), "hi".to_string())
        );
        assert_eq!(
            notification_text(false, "Alice".into(), "hi".into()),
            ("Mewsenger".to_string(), "New message".to_string())
        );
    }
    fn pend(registry: &mut Registry, id: i32, account: &str, thread: &str, created: Instant) {
        registry.pending.insert(
            id,
            PendingToast {
                account: account.into(),
                thread: thread.into(),
                created,
            },
        );
    }

    #[test]
    fn only_messenger_https_in_an_account_webview_is_trusted() {
        let ok = Url::parse("https://www.messenger.com/t/12").unwrap();
        assert!(trusted(&ok, "messenger-a1"));
        assert!(trusted(&ok, "messenger-a2"));
        assert!(!trusted(&ok, "messenger"));
        assert!(!trusted(&ok, "messenger-a1x"));
        assert!(!trusted(&ok, "messenger-../x"));
        assert!(!trusted(&ok, "titlebar-a1"));
        assert!(!trusted(&ok, "popup-1"));
        assert!(!trusted(
            &Url::parse("http://www.messenger.com/").unwrap(),
            "messenger-a1"
        ));
        assert!(!trusted(
            &Url::parse("https://www.messenger.com.evil.org/").unwrap(),
            "messenger-a1"
        ));
        assert!(!trusted(
            &Url::parse("https://www.messenger.com:444/").unwrap(),
            "messenger-a1"
        ));
    }
    #[test]
    fn payload_bounds_reject_controls_and_giant_strings() {
        assert!(safe_string("Alice", 20).is_some());
        assert!(safe_string("a\nb", 20).is_some());
        assert!(safe_string("bad\u{0000}title", 20).is_none());
        assert!(safe_string(&"x".repeat(161), 160).is_none());
    }
    #[test]
    fn badge_png_source_is_valid_rgba() {
        let icon = unread_icon(99);
        assert_eq!(icon.width(), 32);
        assert_eq!(icon.height(), 32);
        assert_eq!(icon.rgba().len(), 4096);
    }

    #[test]
    fn unread_starts_unknown_not_zero() {
        let state = NotificationState::default();
        assert_eq!(state.unread, None);
    }

    #[test]
    fn resetting_a_page_cannot_reset_toast_deduplication_or_rate_limits() {
        let mut registry = Registry::default();
        let now = Instant::now();
        let state = registry.state("a1");
        state.seen.insert("tag:one".into(), now);
        state.rate.push_back(now);
        state.unread = Some(2);
        pend(&mut registry, 7, "a1", "thread", now);
        reset_view_state(&mut registry, "a1");
        let state = registry.state("a1");
        assert_eq!(state.unread, None);
        assert_eq!(state.seen.len(), 1);
        assert_eq!(state.rate.len(), 1);
        assert!(registry.pending.is_empty());
    }

    #[test]
    fn resetting_one_account_leaves_the_other_alone() {
        let mut registry = Registry::default();
        let now = Instant::now();
        registry.state("a1").unread = Some(2);
        registry.state("a2").unread = Some(5);
        registry.state("a2").session = Some(true);
        pend(&mut registry, 1, "a1", "t", now);
        pend(&mut registry, 2, "a2", "t", now);
        reset_view_state(&mut registry, "a1");
        assert_eq!(registry.state("a1").unread, None);
        assert_eq!(registry.state("a2").unread, Some(5));
        assert_eq!(registry.state("a2").session, Some(true));
        assert!(registry.pending.contains_key(&2));
        assert!(!registry.pending.contains_key(&1));
    }

    #[test]
    fn total_unread_sums_only_known_counts() {
        let mut registry = Registry::default();
        assert_eq!(registry.total_unread(), 0);
        registry.state("a1").unread = Some(2);
        registry.state("a2");
        registry.state("a3").unread = Some(4);
        assert_eq!(registry.total_unread(), 6);
        registry.forget("a3");
        assert_eq!(registry.total_unread(), 2);
    }

    #[test]
    fn toast_ids_stay_unique_across_accounts() {
        let mut registry = Registry::default();
        let now = Instant::now();
        let mut ids = Vec::new();
        for account in ["a1", "a2", "a1", "a2"] {
            let id = registry.next_id();
            registry.next_toast_id = id;
            pend(&mut registry, id, account, "t", now);
            ids.push(id);
        }
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 4);
        assert_eq!(registry.pending.len(), 4);
    }

    #[test]
    fn click_routes_only_live_mapped_threads_and_consumes_the_match() {
        let now = Instant::now();
        let mut registry = Registry::default();
        pend(&mut registry, 4, "a1", "123", now);
        pend(&mut registry, 5, "a2", "456", now);
        let (account, url) = route_for_tap(&mut registry, 4, now).unwrap();
        assert_eq!(account, "a1");
        assert_eq!(url.as_str(), "https://www.messenger.com/t/123");
        assert!(route_for_tap(&mut registry, 4, now).is_none());
        let (account, url) = route_for_tap(&mut registry, 5, now).unwrap();
        assert_eq!(account, "a2");
        assert_eq!(url.as_str(), "https://www.messenger.com/t/456");
    }

    #[test]
    fn reply_text_is_trimmed_and_bounded() {
        assert_eq!(validate_reply("  ok \n").as_deref(), Some("ok"));
        assert_eq!(validate_reply("a\nb").as_deref(), Some("a\nb"));
        assert!(validate_reply("").is_none());
        assert!(validate_reply("   \n ").is_none());
        assert!(validate_reply(&"x".repeat(2000)).is_some());
        assert!(validate_reply(&"x".repeat(2001)).is_none());
        assert!(validate_reply("bad\u{0007}bell").is_none());
        assert!(validate_reply("tab\there").is_none());
    }

    #[test]
    fn toast_tags_round_trip_and_reject_other_shapes() {
        assert_eq!(
            parse_toast_tag(&toast_tag("a2", 17)),
            Some(("a2".into(), 17))
        );
        assert_eq!(parse_toast_tag("toast-a1-0"), Some(("a1".into(), 0)));
        for bad in [
            "toast-x",
            "toast-17",
            "toast-a1",
            "toast-a1-x",
            "toast--5",
            "toast-b1-5",
            "toast-a1x-5",
            "17",
            "thread-17",
        ] {
            assert_eq!(parse_toast_tag(bad), None, "{bad}");
        }
    }

    #[test]
    fn group_is_per_account_and_conversation_and_dropped_when_too_long() {
        assert_eq!(thread_group("a1", Some("123")), "a1-thread-123");
        assert_ne!(
            thread_group("a1", Some("123")),
            thread_group("a2", Some("123"))
        );
        assert_eq!(thread_group("a1", None), "");
        assert_eq!(thread_group("a1", Some(&"x".repeat(60))), "");
    }

    #[test]
    fn page_reports_parse_into_events() {
        let failed: MessageEvent = serde_json::from_str(
            r#"{"kind":"reply_result","nonce":"toast-1","ok":false,"reason":"send_failed"}"#,
        )
        .unwrap();
        assert!(matches!(
            failed,
            MessageEvent::ReplyResult {
                ok: false,
                reason: Some(_),
                ..
            }
        ));
        let done: MessageEvent =
            serde_json::from_str(r#"{"kind":"reply_result","nonce":"toast-1","ok":true}"#).unwrap();
        assert!(matches!(
            done,
            MessageEvent::ReplyResult {
                ok: true,
                reason: None,
                ..
            }
        ));
        let session: MessageEvent =
            serde_json::from_str(r#"{"kind":"session","state":"signed_in"}"#).unwrap();
        assert!(matches!(session, MessageEvent::Session { .. }));
        let shortcut: MessageEvent =
            serde_json::from_str(r#"{"kind":"shortcut","action":"next"}"#).unwrap();
        assert!(matches!(shortcut, MessageEvent::Shortcut { action } if action == "next"));
    }

    #[test]
    fn reply_only_reaches_a_live_mapped_thread_and_keeps_the_mapping() {
        let now = Instant::now();
        let mut registry = Registry::default();
        pend(&mut registry, 3, "a2", "123", now);
        let expected = Some(("a2".to_string(), "123".to_string()));
        assert_eq!(reply_target(&registry, 3, now), expected);
        assert_eq!(reply_target(&registry, 3, now), expected);
        assert!(reply_target(&registry, 4, now).is_none());
        assert!(reply_target(&registry, 3, now + TOAST_LIFETIME).is_none());
    }

    #[test]
    fn reading_one_thread_preserves_unrelated_click_targets() {
        let now = Instant::now();
        let mut registry = Registry::default();
        pend(&mut registry, 1, "a1", "one", now);
        pend(&mut registry, 2, "a1", "one", now);
        pend(&mut registry, 3, "a1", "two", now);
        pend(&mut registry, 4, "a2", "one", now);
        clear_thread(&mut registry, "a1", "one");
        assert!(route_for_tap(&mut registry, 1, now).is_none());
        assert!(route_for_tap(&mut registry, 2, now).is_none());
        assert!(route_for_tap(&mut registry, 3, now).is_some());
        // Same thread id in another account is a different conversation.
        assert!(route_for_tap(&mut registry, 4, now).is_some());
    }

    #[test]
    fn rejects_stale_and_unroutable_notification_data() {
        let now = Instant::now();
        let mut registry = Registry::default();
        pend(&mut registry, 1, "a1", "123", now - TOAST_LIFETIME);
        pend(&mut registry, 2, "a1", "https://other.example/", now);
        assert!(route_for_tap(&mut registry, 1, now).is_none());
        assert!(route_for_tap(&mut registry, 2, now).is_none());
        assert!(thread_url("hello/world").is_none());
        assert_eq!(
            thread_url("fbid:123_A").unwrap().host_str(),
            Some("www.messenger.com")
        );
    }

    #[test]
    fn expired_toasts_are_trimmed_per_registry() {
        let now = Instant::now();
        let mut registry = Registry::default();
        pend(&mut registry, 1, "a1", "123", now - TOAST_LIFETIME);
        pend(&mut registry, 2, "a2", "123", now);
        registry.trim_pending(now);
        assert_eq!(registry.pending.len(), 1);
        assert!(registry.pending.contains_key(&2));
    }

    #[test]
    fn a_message_is_announced_where_the_user_is_looking() {
        assert_eq!(delivery(true, true), Delivery::None);
        assert_eq!(delivery(true, false), Delivery::TabAlert);
        assert_eq!(delivery(false, true), Delivery::Toast);
        assert_eq!(delivery(false, false), Delivery::Toast);
    }

    #[test]
    fn session_state_accepts_only_known_values() {
        assert_eq!(parse_session("signed_in"), Ok(true));
        assert_eq!(parse_session("signed_out"), Ok(false));
        assert_eq!(
            parse_session("connected").err().as_deref(),
            Some("invalid session state")
        );
        assert!(parse_session("").is_err());
    }

    #[test]
    fn leaving_messenger_returns_unread_and_session_to_unknown() {
        let mut registry = Registry::default();
        let state = registry.state("a1");
        state.unread = Some(3);
        state.session = Some(true);
        pend(&mut registry, 1, "a1", "123", Instant::now());
        reset_view_state(&mut registry, "a1");
        assert_eq!(registry.state("a1").unread, None);
        assert_eq!(registry.state("a1").session, None);
        assert!(registry.pending.is_empty());
    }
}
