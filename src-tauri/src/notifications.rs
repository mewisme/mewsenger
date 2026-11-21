use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, Url, Webview};
use tauri_plugin_notification::NotificationExt;

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

#[derive(Clone, Serialize)]
pub struct DesktopStatus {
    unread_count: Option<usize>,
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
    with_sound(app.notification().builder())
        .title("Messenger notification test")
        .body("Desktop notification request sent from Messenger.")
        .show()
        .map_err(|error| {
            eprintln!("could not send test notification: {error}");
            "Windows notification request failed".into()
        })
}

fn publish_status(app: &AppHandle, unread_count: Option<usize>) {
    // Do not send thread IDs, notification bodies, or account data to local UI.
    let _ = app.emit_to(
        EventTarget::webview("status"),
        "desktop-status",
        DesktopStatus { unread_count },
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
    let unread_count = state.lock().map_err(|_| "status unavailable")?.unread;
    Ok(DesktopStatus { unread_count })
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
    let mut status_change = None;
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
            if let Err(error) = with_sound(app.notification().builder())
                .id(toast_id)
                .extra("messenger_fallback", true)
                .title(title)
                .body(body)
                .show()
            {
                eprintln!("could not show desktop notification: {error}");
                return Err("native notification unavailable".into());
            }
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
                status_change = Some(Some(count));
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
            if let Err(error) = with_sound(app.notification().builder())
                .id(toast_id)
                .extra("messenger_fallback", true)
                .title("Messenger")
                .body("New unread conversation")
                .show()
            {
                eprintln!("could not show unread notification: {error}");
                return Err("native notification unavailable".into());
            }
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
            // Windows cannot remove the delivered OS toast with this plugin.
            // Stop routing only this thread's now-stale notifications.
            clear_thread(&mut notifications, &thread_id);
        }
        MessageEvent::Reset => {
            reset_view_state(&mut notifications);
            badge(&app, 0);
            status_change = Some(None);
        }
    }
    drop(notifications);
    if let Some(count) = status_change {
        publish_status(&app, count);
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
}
