use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, Url, Webview};
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
        ("Messenger".into(), "New message".into())
    }
}

#[derive(Default)]
pub struct NotificationState {
    seen: HashMap<String, Instant>,
    rate: VecDeque<Instant>,
    pending: HashMap<i32, PendingToast>,
    next_toast_id: i32,
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
    thread: String,
    created: Instant,
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

fn clear_thread(state: &mut NotificationState, thread: &str) {
    state.pending.retain(|_, toast| toast.thread != thread);
}

fn route_for_tap(state: &mut NotificationState, id: i32, now: Instant) -> Option<Url> {
    let toast = state.pending.remove(&id)?;
    (now.duration_since(toast.created) < TOAST_LIFETIME)
        .then(|| thread_url(&toast.thread))
        .flatten()
}

pub fn clicked_thread(app: &AppHandle, id: i32) -> Option<Url> {
    let state = app.try_state::<Mutex<NotificationState>>()?;
    let mut state = state.lock().ok()?;
    route_for_tap(&mut state, id, Instant::now())
}

/// Inline reply from a toast stays off until it has been confirmed against a
/// live Messenger session.
const QUICK_REPLY: bool = false;
const REPLY_FAILED_NOTICE: &str = "Reply not sent; open Messenger";
const MAX_REPLY_CHARS: usize = 2000;
const MAX_PENDING_REPLIES: usize = 16;

fn toast_tag(id: i32) -> String {
    format!("toast-{id}")
}

fn parse_toast_tag(tag: &str) -> Option<i32> {
    tag.strip_prefix("toast-")?.parse().ok()
}

/// Action Center group for one conversation; empty when it would not fit.
fn thread_group(thread: Option<&str>) -> String {
    thread
        .map(|thread| format!("thread-{thread}"))
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

/// Conversation a still-valid toast belongs to. Does not consume the mapping.
fn reply_target(state: &NotificationState, id: i32, now: Instant) -> Option<String> {
    let toast = state.pending.get(&id)?;
    (now.duration_since(toast.created) < TOAST_LIFETIME).then(|| toast.thread.clone())
}

fn main_in_background(app: &AppHandle) -> bool {
    app.get_window("main").is_none_or(|window| {
        !window.is_visible().unwrap_or(true) || !window.is_focused().unwrap_or(true)
    })
}

fn notice(app: &AppHandle, body: &str) {
    if let Err(error) = with_sound(app.notification().builder())
        .title("Messenger")
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
    toast_id: i32,
    group: String,
    title: String,
    body: String,
    reply: bool,
) -> Result<(), String> {
    let handler_app = app.clone();
    let request = toast::ToastRequest {
        tag: toast_tag(toast_id),
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
            if let Some(id) = parse_toast_tag(&tag) {
                crate::desktop::activate_toast(app, id);
            }
        }
        toast::ToastEvent::Reply { tag, text } => quick_reply(app, &tag, &text),
        toast::ToastEvent::Dismissed { .. } => {}
    }
}

fn quick_reply(app: &AppHandle, tag: &str, text: &str) {
    let (Some(id), Some(text)) = (parse_toast_tag(tag), validate_reply(text)) else {
        return;
    };
    let Some(state) = app.try_state::<Mutex<NotificationState>>() else {
        return;
    };
    let Some(webview) = app.get_webview("messenger") else {
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
        let Ok(mut state) = state.lock() else {
            return;
        };
        let Some(thread) = reply_target(&state, id, Instant::now()) else {
            return;
        };
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
        if let Ok(mut state) = state.lock() {
            state.replying.remove(&nonce);
        }
        notice(app, REPLY_FAILED_NOTICE);
    }
}

#[derive(Clone, Serialize)]
pub struct DesktopStatus {
    unread_count: Option<usize>,
    session: Option<bool>,
}

fn trusted_status_view(webview: &Webview) -> bool {
    webview.label() == "status"
        && webview.window().label() == "main"
        && webview
            .url()
            .is_ok_and(|url| crate::shell::local_asset_url(&url))
}

#[tauri::command]
pub fn test_notification(app: AppHandle, webview: Webview) -> Result<(), String> {
    if !trusted_status_view(&webview) {
        return Err("local status view required".into());
    }
    deliver(
        &app,
        0,
        "test".into(),
        "Messenger notification test".into(),
        "Desktop notification request sent from Messenger.".into(),
        false,
    )
    .map_err(|_| "Windows notification request failed".into())
}

fn publish_status(app: &AppHandle, unread_count: Option<usize>, session: Option<bool>) {
    // Do not send thread IDs, notification bodies, or account data to local UI.
    let _ = app.emit_to(
        EventTarget::webview("status"),
        "desktop-status",
        DesktopStatus {
            unread_count,
            session,
        },
    );
}

#[tauri::command]
pub fn current_status(
    webview: Webview,
    state: State<'_, Mutex<NotificationState>>,
) -> Result<DesktopStatus, String> {
    if !trusted_status_view(&webview) {
        return Err("local status view required".into());
    }
    let state = state.lock().map_err(|_| "status unavailable")?;
    Ok(DesktopStatus {
        unread_count: state.unread,
        session: state.session,
    })
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
    NewUnread {
        thread_id: String,
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
    Reset,
}

pub(crate) fn trusted(url: &Url, label: &str) -> bool {
    label == "messenger" && crate::site::current().is_app_origin(url)
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
        } else if key.starts_with("unread:") {
            45
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
    state
        .pending
        .retain(|_, toast| now.duration_since(toast.created) < TOAST_LIFETIME);
    if state.pending.len() > 128 {
        state.pending.clear();
    }
}

fn reset_view_state(state: &mut NotificationState) {
    state.pending.clear();
    state.unread = None;
    state.session = None;
    // Keep deduplication and rate limits across navigation and page reloads.
    // A remote page must not reset notification throttling.
}

fn should_show_background_unread(
    state: &NotificationState,
    thread_id: &str,
    in_background: bool,
) -> bool {
    let key = format!("unread:{thread_id}");
    in_background
        && routable_thread(thread_id)
        && !state.seen.contains_key(&key)
        && state.rate.len() < MAX_TOASTS_PER_MINUTE
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
    state: State<'_, Mutex<NotificationState>>,
    prefs: State<'_, Mutex<crate::prefs::Prefs>>,
    event: MessageEvent,
) -> Result<(), String> {
    let current = webview.url().map_err(|_| "origin unavailable")?;
    if webview.window().label() != "main" || !trusted(&current, webview.label()) {
        return Err("origin not permitted".into());
    }
    let now = Instant::now();
    let mut notifications = state.lock().map_err(|_| "notification state unavailable")?;
    trim_history(&mut notifications, now);
    let mut status_change = false;
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
            if notifications.seen.contains_key(&id) {
                return Ok(());
            }
            // Even a compromised page must not flood Windows notification center.
            if notifications.rate.len() >= MAX_TOASTS_PER_MINUTE {
                return Ok(());
            }
            let preview = prefs.lock().map(|p| p.notification_preview).unwrap_or(true);
            let (title, body) = notification_text(preview, title, body);
            let toast_id = notifications.next_toast_id.checked_add(1).unwrap_or(1);
            // Messenger can create its own browser toast. Only the JS fallback
            // reports notifications that require desktop delivery.
            let routable = thread_id.as_deref().filter(|t| routable_thread(t));
            let reply = QUICK_REPLY && routable.is_some() && main_in_background(&app);
            deliver(&app, toast_id, thread_group(routable), title, body, reply)?;
            notifications.next_toast_id = toast_id;
            notifications.seen.insert(id.clone(), now);
            notifications.rate.push_back(now);
            if let Some(thread) = thread_id {
                if routable_thread(&thread) {
                    notifications.pending.insert(
                        toast_id,
                        PendingToast {
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
            if notifications.unread != Some(count) {
                notifications.unread = Some(count);
                badge(&app, count);
                crate::desktop::set_tray_tooltip(&app, count);
                status_change = true;
            }
        }
        MessageEvent::NewUnread { thread_id } => {
            let window = app.get_window("main").ok_or("main window unavailable")?;
            let in_background =
                !window.is_visible().unwrap_or(true) || !window.is_focused().unwrap_or(true);
            if !should_show_background_unread(&notifications, &thread_id, in_background) {
                return Ok(());
            }
            let toast_id = notifications.next_toast_id.checked_add(1).unwrap_or(1);
            deliver(
                &app,
                toast_id,
                thread_group(
                    Some(&thread_id)
                        .filter(|t| routable_thread(t))
                        .map(|t| t.as_str()),
                ),
                "Messenger".into(),
                "New unread conversation".into(),
                false,
            )?;
            notifications.next_toast_id = toast_id;
            notifications
                .seen
                .insert(format!("unread:{thread_id}"), now);
            notifications.rate.push_back(now);
            notifications.pending.insert(
                toast_id,
                PendingToast {
                    thread: thread_id,
                    created: now,
                },
            );
        }
        MessageEvent::Read { thread_id } => {
            safe_string(&thread_id, 160).ok_or("invalid conversation id")?;
            // Stop routing this thread's stale notifications and remove its
            // delivered toasts from Action Center (Windows toasts we created).
            clear_thread(&mut notifications, &thread_id);
            toast::remove_group(&app, &format!("thread-{thread_id}"));
        }
        MessageEvent::Reset => {
            reset_view_state(&mut notifications);
            toast::clear_all(&app);
            badge(&app, 0);
            crate::desktop::set_tray_tooltip(&app, 0);
            status_change = true;
        }
        MessageEvent::ReplyResult { nonce, ok, reason } => {
            safe_string(&nonce, 160).ok_or("invalid reply id")?;
            if let Some(reason) = &reason {
                safe_string(reason, 40).ok_or("invalid reply reason")?;
            }
            if let Some(thread) = notifications.replying.remove(&nonce) {
                if ok {
                    clear_thread(&mut notifications, &thread);
                    toast::remove_group(&app, &format!("thread-{thread}"));
                } else {
                    notice(&app, REPLY_FAILED_NOTICE);
                }
            }
        }
        MessageEvent::Session { state } => {
            let signed_in = parse_session(&state)?;
            if notifications.session != Some(signed_in) {
                notifications.session = Some(signed_in);
                status_change = true;
            }
        }
    }
    let snapshot = (notifications.unread, notifications.session);
    drop(notifications);
    if status_change {
        publish_status(&app, snapshot.0, snapshot.1);
    }
    Ok(())
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
            ("Messenger".to_string(), "New message".to_string())
        );
    }
    #[test]
    fn only_messenger_https_in_the_main_window_is_trusted() {
        assert!(trusted(
            &Url::parse("https://www.messenger.com/t/12").unwrap(),
            "messenger"
        ));
        assert!(!trusted(
            &Url::parse("http://www.messenger.com/").unwrap(),
            "messenger"
        ));
        assert!(!trusted(
            &Url::parse("https://www.messenger.com.evil.org/").unwrap(),
            "messenger"
        ));
        assert!(!trusted(
            &Url::parse("https://www.messenger.com/").unwrap(),
            "popup-1"
        ));
        assert!(!trusted(
            &Url::parse("https://www.messenger.com:444/").unwrap(),
            "messenger"
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
        let mut state = NotificationState::default();
        let now = Instant::now();
        state.seen.insert("tag:one".into(), now);
        state.rate.push_back(now);
        state.pending.insert(
            7,
            PendingToast {
                thread: "thread".into(),
                created: now,
            },
        );
        state.unread = Some(2);
        reset_view_state(&mut state);
        assert_eq!(state.unread, None);
        assert!(state.pending.is_empty());
        assert_eq!(state.seen.len(), 1);
        assert_eq!(state.rate.len(), 1);
    }

    #[test]
    fn click_routes_only_live_mapped_threads_and_consumes_the_match() {
        let now = Instant::now();
        let mut state = NotificationState::default();
        state.pending.insert(
            4,
            PendingToast {
                thread: "123".into(),
                created: now,
            },
        );
        state.pending.insert(
            5,
            PendingToast {
                thread: "456".into(),
                created: now,
            },
        );
        assert_eq!(
            route_for_tap(&mut state, 4, now).unwrap().as_str(),
            "https://www.messenger.com/t/123"
        );
        assert!(route_for_tap(&mut state, 4, now).is_none());
        assert_eq!(
            route_for_tap(&mut state, 5, now).unwrap().as_str(),
            "https://www.messenger.com/t/456"
        );
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
        assert_eq!(parse_toast_tag(&toast_tag(17)), Some(17));
        assert_eq!(parse_toast_tag("toast-x"), None);
        assert_eq!(parse_toast_tag("17"), None);
        assert_eq!(parse_toast_tag("thread-17"), None);
    }

    #[test]
    fn group_is_per_conversation_and_dropped_when_too_long() {
        assert_eq!(thread_group(Some("123")), "thread-123");
        assert_eq!(thread_group(None), "");
        assert_eq!(thread_group(Some(&"x".repeat(60))), "");
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
    }

    #[test]
    fn reply_only_reaches_a_live_mapped_thread_and_keeps_the_mapping() {
        let now = Instant::now();
        let mut state = NotificationState::default();
        state.pending.insert(
            3,
            PendingToast {
                thread: "123".into(),
                created: now,
            },
        );
        assert_eq!(reply_target(&state, 3, now).as_deref(), Some("123"));
        assert_eq!(reply_target(&state, 3, now).as_deref(), Some("123"));
        assert!(reply_target(&state, 4, now).is_none());
        assert!(reply_target(&state, 3, now + TOAST_LIFETIME).is_none());
    }

    #[test]
    fn reading_one_thread_preserves_unrelated_click_targets() {
        let now = Instant::now();
        let mut state = NotificationState::default();
        state.pending.insert(
            1,
            PendingToast {
                thread: "one".into(),
                created: now,
            },
        );
        state.pending.insert(
            2,
            PendingToast {
                thread: "one".into(),
                created: now,
            },
        );
        state.pending.insert(
            3,
            PendingToast {
                thread: "two".into(),
                created: now,
            },
        );
        clear_thread(&mut state, "one");
        assert!(route_for_tap(&mut state, 1, now).is_none());
        assert!(route_for_tap(&mut state, 2, now).is_none());
        assert!(route_for_tap(&mut state, 3, now).is_some());
    }

    #[test]
    fn rejects_stale_and_unroutable_notification_data() {
        let now = Instant::now();
        let mut state = NotificationState::default();
        state.pending.insert(
            1,
            PendingToast {
                thread: "123".into(),
                created: now - TOAST_LIFETIME,
            },
        );
        state.pending.insert(
            2,
            PendingToast {
                thread: "https://other.example/".into(),
                created: now,
            },
        );
        assert!(route_for_tap(&mut state, 1, now).is_none());
        assert!(route_for_tap(&mut state, 2, now).is_none());
        assert!(thread_url("hello/world").is_none());
        assert_eq!(
            thread_url("fbid:123_A").unwrap().host_str(),
            Some("www.messenger.com")
        );
    }

    #[test]
    fn background_unread_requires_valid_thread_and_free_rate_budget() {
        let now = Instant::now();
        let mut state = NotificationState::default();
        assert!(!should_show_background_unread(&state, "123", false));
        assert!(!should_show_background_unread(&state, "bad/path", true));
        assert!(should_show_background_unread(&state, "123", true));
        state.seen.insert("unread:123".into(), now);
        assert!(!should_show_background_unread(&state, "123", true));
        assert!(should_show_background_unread(&state, "456", true));
        state
            .rate
            .extend(std::iter::repeat_n(now, MAX_TOASTS_PER_MINUTE));
        assert!(!should_show_background_unread(&state, "456", true));
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
        let mut state = NotificationState {
            unread: Some(3),
            session: Some(true),
            ..Default::default()
        };
        state.pending.insert(
            1,
            PendingToast {
                thread: "123".into(),
                created: Instant::now(),
            },
        );
        reset_view_state(&mut state);
        assert_eq!(state.unread, None);
        assert_eq!(state.session, None);
        assert!(state.pending.is_empty());
    }
}
