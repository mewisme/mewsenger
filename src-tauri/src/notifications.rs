use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::{AppHandle, Manager, State, Url, Webview};
use tauri_plugin_notification::NotificationExt;

const HOSTS: &[&str] = &["messenger.com", "www.messenger.com"];
const MAX_TOASTS_PER_MINUTE: usize = 12;

#[derive(Default)]
pub struct NotificationState {
    seen: HashMap<String, Instant>,
    rate: VecDeque<Instant>,
    pending: HashMap<String, String>,
    unread: usize,
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
    Reset,
}

fn trusted(url: &Url, label: &str) -> bool {
    label == "messenger"
        && url.scheme() == "https"
        && url.port().is_none()
        && url.host_str().is_some_and(|host| HOSTS.contains(&host))
}

fn safe_string(value: &str, max: usize) -> Option<&str> {
    if value.is_empty() || value.len() > max || value.chars().any(|c| c.is_control() && c != '\n') {
        return None;
    }
    Some(value)
}

fn trim_history(state: &mut NotificationState, now: Instant) {
    state.seen.retain(|key, time| {
        let max_age = if key.starts_with("body:") { 15 } else { 600 };
        now.duration_since(*time) < Duration::from_secs(max_age)
    });
    while state
        .rate
        .front()
        .is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60))
    {
        state.rate.pop_front();
    }
    if state.pending.len() > 128 {
        state.pending.clear();
    }
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
    event: MessageEvent,
) -> Result<(), String> {
    let current = webview.url().map_err(|_| "origin unavailable")?;
    if webview.window().label() != "main" || !trusted(&current, webview.label()) {
        return Err("origin not permitted".into());
    }
    let now = Instant::now();
    let mut notifications = state.lock().map_err(|_| "notification state unavailable")?;
    trim_history(&mut notifications, now);
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
            // Messenger can create its own browser toast. Only the JS fallback
            // reports notifications that require desktop delivery.
            if let Err(error) = app.notification().builder().title(title).body(body).show() {
                eprintln!("could not show desktop notification: {error}");
                return Err("native notification unavailable".into());
            }
            notifications.seen.insert(id.clone(), now);
            notifications.rate.push_back(now);
            if let Some(thread) = thread_id {
                notifications.pending.insert(thread, id);
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
            if notifications.unread != count {
                notifications.unread = count;
                badge(&app, count);
            }
        }
        MessageEvent::Read { thread_id } => {
            safe_string(&thread_id, 160).ok_or("invalid conversation id")?;
            // Notification history removal is not available in the desktop
            // notification plugin. Forget the mapping; never clear other threads.
            notifications.pending.remove(&thread_id);
        }
        MessageEvent::Reset => {
            notifications.pending.clear();
            notifications.seen.clear();
            notifications.rate.clear();
            notifications.unread = 0;
            badge(&app, 0);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
