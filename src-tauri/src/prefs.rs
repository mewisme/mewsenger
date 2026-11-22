use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Colour scheme of the app. Only the scheme is set here: Messenger's own
/// appearance setting then follows it (or not) as it does in any browser.
#[derive(Serialize, Deserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ThemePref {
    #[default]
    System,
    Dark,
    Light,
}

impl ThemePref {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "dark" => Some(Self::Dark),
            "light" => Some(Self::Light),
            _ => None,
        }
    }

    /// The window theme to force; none follows the system.
    pub fn window_theme(self) -> Option<tauri::Theme> {
        match self {
            Self::System => None,
            Self::Dark => Some(tauri::Theme::Dark),
            Self::Light => Some(tauri::Theme::Light),
        }
    }
}

/// How often to look for an update by itself.
#[derive(Serialize, Deserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum UpdateSchedule {
    Off,
    Hourly,
    Every6Hours,
    Every12Hours,
    #[default]
    Daily,
    Weekly,
    Monthly,
    EvenDays,
    OddDays,
}

const HOUR: u64 = 3600;
const DAY: u64 = 24 * HOUR;

impl UpdateSchedule {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "hourly" => Some(Self::Hourly),
            "every_6_hours" => Some(Self::Every6Hours),
            "every_12_hours" => Some(Self::Every12Hours),
            "daily" => Some(Self::Daily),
            "weekly" => Some(Self::Weekly),
            "monthly" => Some(Self::Monthly),
            "even_days" => Some(Self::EvenDays),
            "odd_days" => Some(Self::OddDays),
            _ => None,
        }
    }

    /// Whether a check is due at `now` (Unix seconds, UTC) given when the
    /// last one ran. Day parity schedules check once on each matching day of
    /// the month.
    pub fn due(self, last: Option<u64>, now: u64) -> bool {
        let elapsed = |secs: u64| last.is_none_or(|last| now.saturating_sub(last) >= secs);
        match self {
            Self::Off => false,
            Self::Hourly => elapsed(HOUR),
            Self::Every6Hours => elapsed(6 * HOUR),
            Self::Every12Hours => elapsed(12 * HOUR),
            Self::Daily => elapsed(DAY),
            Self::Weekly => elapsed(7 * DAY),
            Self::Monthly => elapsed(30 * DAY),
            Self::EvenDays | Self::OddDays => {
                let wanted = if self == Self::EvenDays { 0 } else { 1 };
                day_of_month(now / DAY) % 2 == wanted && elapsed(DAY / 2)
            }
        }
    }
}

/// Day of the month (1-31, UTC) of a day count since 1970-01-01.
fn day_of_month(days: u64) -> u64 {
    // Civil-from-days (H. Hinnant): shift the epoch to 0000-03-01.
    let z = days + 719_468;
    let era = z / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    day_of_year - (153 * month_index + 2) / 5 + 1
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(default)]
pub struct Prefs {
    pub theme: ThemePref,
    pub notification_preview: bool,
    /// Do not show others that you are typing.
    pub block_typing: bool,
    /// Draw people's pictures as their initials.
    pub hide_avatars: bool,
    /// Cover names, messages and photos for screens others can see.
    pub redact_mode: bool,
    /// Underline misspelled words in message fields.
    pub spell_check: bool,
    /// Reload a Messenger page that is stuck or woke from sleep.
    pub auto_recover: bool,
    /// Load the newest messages of the top chats before they are opened.
    pub read_ahead: bool,
    /// Double-click empty space in a message to reply to it.
    pub double_click_reply: bool,
    /// Let unused tabs, or the whole app when minimized or in the background, give memory back.
    pub trim_idle_memory: bool,
    /// Closing the main window hides it to the tray instead of quitting.
    pub close_to_tray: bool,
    /// Look for an update when the app starts.
    pub check_on_start: bool,
    /// Download and install an update as soon as one is found.
    pub auto_install: bool,
    pub update_schedule: UpdateSchedule,
    /// Unix seconds of the last automatic check; not a setting.
    pub last_update_check: Option<u64>,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            theme: ThemePref::System,
            notification_preview: true,
            block_typing: false,
            hide_avatars: false,
            redact_mode: false,
            spell_check: true,
            auto_recover: true,
            read_ahead: false,
            double_click_reply: false,
            trim_idle_memory: true,
            close_to_tray: false,
            check_on_start: true,
            auto_install: false,
            update_schedule: UpdateSchedule::Daily,
            last_update_check: None,
        }
    }
}

impl Prefs {
    /// The choices the page script acts on, as the object it reads
    /// (window.__MEW_PREFS); keys follow inject/26-prefs.js.
    pub fn page_json(&self) -> String {
        serde_json::json!({
            "theme": self.theme,
            "blockTyping": self.block_typing,
            "hideAvatars": self.hide_avatars,
            "redactMode": self.redact_mode,
            "spellCheck": self.spell_check,
            "autoRecover": self.auto_recover,
            "readAhead": self.read_ahead,
            "doubleClickReply": self.double_click_reply,
        })
        .to_string()
    }
}

/// Script that gives a page the current choices, before its own scripts run
/// and again after a load (a reload keeps the creation-time script).
pub fn page_script(prefs: &Prefs) -> String {
    format!(
        "window.__MEW_PREFS = {json}; window.__mewApplyPrefs && window.__mewApplyPrefs(window.__MEW_PREFS);",
        json = prefs.page_json()
    )
}

/// Current choices for a script injected into a new page.
pub fn current(app: &AppHandle) -> Prefs {
    app.try_state::<Mutex<Prefs>>()
        .and_then(|state| state.lock().ok().map(|p| *p))
        .unwrap_or_default()
}

/// Gives every open Messenger page the new choices.
fn push_to_pages(app: &AppHandle, prefs: &Prefs) {
    let script = page_script(prefs);
    for (label, webview) in app.webviews() {
        if label.starts_with("messenger-") && crate::accounts::account_of(&label).is_some() {
            let _ = webview.eval(script.as_str());
        }
    }
}

pub fn from_json(text: &str) -> Prefs {
    serde_json::from_str(text).unwrap_or_default()
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("preferences.json"))
}

pub fn load(app: &AppHandle) -> Prefs {
    path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|text| from_json(&text))
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, prefs: &Prefs) -> std::io::Result<()> {
    let target = path(app).ok_or_else(|| std::io::Error::other("config directory unavailable"))?;
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = target.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(prefs)?)?;
    std::fs::rename(&tmp, &target)
}

pub fn apply(mut prefs: Prefs, key: &str, value: bool) -> Result<Prefs, String> {
    match key {
        "notification_preview" => prefs.notification_preview = value,
        "block_typing" => prefs.block_typing = value,
        "hide_avatars" => prefs.hide_avatars = value,
        "redact_mode" => prefs.redact_mode = value,
        "spell_check" => prefs.spell_check = value,
        "auto_recover" => prefs.auto_recover = value,
        "read_ahead" => prefs.read_ahead = value,
        "double_click_reply" => prefs.double_click_reply = value,
        "trim_idle_memory" => prefs.trim_idle_memory = value,
        "close_to_tray" => prefs.close_to_tray = value,
        "check_on_start" => prefs.check_on_start = value,
        "auto_install" => prefs.auto_install = value,
        _ => return Err("unknown preference".into()),
    }
    Ok(prefs)
}

pub fn set(app: &AppHandle, key: &str, value: bool) -> Result<Prefs, String> {
    let state = app.state::<Mutex<Prefs>>();
    let mut guard = state.lock().map_err(|_| "preferences unavailable")?;
    let next = apply(*guard, key, value)?;
    save(app, &next).map_err(|error| {
        eprintln!("could not save preferences: {error}");
        "could not save preferences".to_string()
    })?;
    *guard = next;
    drop(guard);
    let _ = app.emit_to("settings", "prefs-changed", next);
    push_to_pages(app, &next);
    if key == "trim_idle_memory" {
        crate::shell::sync_tabs(app, || {});
    }
    Ok(next)
}

/// Applies the saved colour scheme to every window and view.
pub fn apply_theme(app: &AppHandle, theme: ThemePref) {
    app.set_theme(theme.window_theme());
    for webview in app.webviews().values() {
        apply_webview_theme(webview, theme);
    }
}

/// Tells a page which scheme `prefers-color-scheme` reports. The window theme
/// alone does not reach a WebView2 page, so Messenger would keep the old
/// look after a switch.
#[cfg(windows)]
pub fn apply_webview_theme(webview: &tauri::Webview, theme: ThemePref) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_13, COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO,
        COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK, COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
    };
    use windows::core::Interface;
    let scheme = match theme {
        ThemePref::System => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO,
        ThemePref::Dark => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
        ThemePref::Light => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
    };
    let _ = webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            if let Ok(core) = core.cast::<ICoreWebView2_13>() {
                if let Ok(profile) = core.Profile() {
                    let _ = profile.SetPreferredColorScheme(scheme);
                }
            }
        }
    });
}

#[cfg(not(windows))]
pub fn apply_webview_theme(_webview: &tauri::Webview, _theme: ThemePref) {}

pub fn set_theme(app: &AppHandle, value: &str) -> Result<Prefs, String> {
    let theme = ThemePref::parse(value).ok_or("unknown theme")?;
    let state = app.state::<Mutex<Prefs>>();
    let mut guard = state.lock().map_err(|_| "preferences unavailable")?;
    let mut next = *guard;
    next.theme = theme;
    save(app, &next).map_err(|error| {
        eprintln!("could not save preferences: {error}");
        "could not save preferences".to_string()
    })?;
    *guard = next;
    drop(guard);
    apply_theme(app, theme);
    let _ = app.emit_to("settings", "prefs-changed", next);
    push_to_pages(app, &next);
    Ok(next)
}

/// Saves how often updates are checked for by themselves.
pub fn set_schedule(app: &AppHandle, value: &str) -> Result<Prefs, String> {
    let schedule = UpdateSchedule::parse(value).ok_or("unknown schedule")?;
    let state = app.state::<Mutex<Prefs>>();
    let mut guard = state.lock().map_err(|_| "preferences unavailable")?;
    let mut next = *guard;
    next.update_schedule = schedule;
    save(app, &next).map_err(|error| {
        eprintln!("could not save preferences: {error}");
        "could not save preferences".to_string()
    })?;
    *guard = next;
    drop(guard);
    let _ = app.emit_to("settings", "prefs-changed", next);
    Ok(next)
}

/// Remembers when an automatic update check ran.
pub fn record_update_check(app: &AppHandle, now: u64) {
    let state = app.state::<Mutex<Prefs>>();
    let Ok(mut guard) = state.lock() else { return };
    let mut next = *guard;
    next.last_update_check = Some(now);
    if let Err(error) = save(app, &next) {
        eprintln!("could not save preferences: {error}");
        return;
    }
    *guard = next;
}

fn trusted_settings_view(webview: &tauri::Webview) -> bool {
    webview.label() == "settings"
        && webview
            .url()
            .is_ok_and(|url| crate::shell::local_asset_url(&url))
}

#[tauri::command]
pub fn get_preferences(
    webview: tauri::Webview,
    state: tauri::State<'_, Mutex<Prefs>>,
) -> Result<Prefs, String> {
    if !trusted_settings_view(&webview) {
        return Err("settings view required".into());
    }
    state
        .lock()
        .map(|p| *p)
        .map_err(|_| "preferences unavailable".into())
}

#[tauri::command]
pub fn set_preference(
    app: AppHandle,
    webview: tauri::Webview,
    key: String,
    value: bool,
) -> Result<Prefs, String> {
    if !trusted_settings_view(&webview) {
        return Err("settings view required".into());
    }
    set(&app, &key, value)
}

#[tauri::command]
pub fn set_theme_preference(
    app: AppHandle,
    webview: tauri::Webview,
    value: String,
) -> Result<Prefs, String> {
    if !trusted_settings_view(&webview) {
        return Err("settings view required".into());
    }
    set_theme(&app, &value)
}

#[tauri::command]
pub fn set_update_schedule(
    app: AppHandle,
    webview: tauri::Webview,
    value: String,
) -> Result<Prefs, String> {
    if !trusted_settings_view(&webview) {
        return Err("settings view required".into());
    }
    set_schedule(&app, &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000; // 2027-01-15 08:00:00 UTC, an odd day of the month

    #[test]
    fn day_of_month_matches_known_dates() {
        assert_eq!(day_of_month(0), 1); // 1970-01-01
        assert_eq!(day_of_month(59), 1); // 1970-03-01
        assert_eq!(day_of_month(58), 28); // 1970-02-28
        assert_eq!(day_of_month(NOW / DAY), 15);
        assert_eq!(day_of_month(11_016), 29); // 2000-02-29
    }

    #[test]
    fn interval_schedules_wait_for_their_period() {
        assert!(UpdateSchedule::Daily.due(None, NOW));
        assert!(!UpdateSchedule::Off.due(None, NOW));
        assert!(!UpdateSchedule::Hourly.due(Some(NOW - 3599), NOW));
        assert!(UpdateSchedule::Hourly.due(Some(NOW - 3600), NOW));
        assert!(!UpdateSchedule::Every12Hours.due(Some(NOW - 11 * HOUR), NOW));
        assert!(UpdateSchedule::Every12Hours.due(Some(NOW - 12 * HOUR), NOW));
        assert!(!UpdateSchedule::Weekly.due(Some(NOW - 6 * DAY), NOW));
        assert!(UpdateSchedule::Monthly.due(Some(NOW - 30 * DAY), NOW));
        // A clock set back never makes a check due by itself.
        assert!(!UpdateSchedule::Daily.due(Some(NOW + DAY), NOW));
    }

    #[test]
    fn day_parity_schedules_check_once_on_matching_days() {
        assert!(UpdateSchedule::OddDays.due(None, NOW));
        assert!(!UpdateSchedule::EvenDays.due(None, NOW));
        assert!(!UpdateSchedule::OddDays.due(Some(NOW - HOUR), NOW));
        assert!(UpdateSchedule::OddDays.due(Some(NOW - 2 * DAY), NOW));
        assert!(UpdateSchedule::EvenDays.due(Some(NOW - DAY), NOW + DAY));
    }

    #[test]
    fn schedule_parses_known_names_and_defaults_to_daily() {
        assert_eq!(
            UpdateSchedule::parse("every_6_hours"),
            Some(UpdateSchedule::Every6Hours)
        );
        assert_eq!(UpdateSchedule::parse("sometimes"), None);
        assert_eq!(from_json("{}").update_schedule, UpdateSchedule::Daily);
        assert_eq!(
            from_json("{\"update_schedule\":\"odd_days\"}").update_schedule,
            UpdateSchedule::OddDays
        );
        assert_eq!(
            from_json("{\"update_schedule\":\"nope\"}").update_schedule,
            UpdateSchedule::Daily
        );
        let prefs = from_json("{}");
        assert!(!prefs.close_to_tray && prefs.check_on_start && !prefs.auto_install);
    }

    #[test]
    fn theme_is_system_unless_chosen_and_only_known_names_parse() {
        assert_eq!(from_json("{}").theme, ThemePref::System);
        assert_eq!(from_json("{\"theme\":\"dark\"}").theme, ThemePref::Dark);
        assert_eq!(from_json("{\"theme\":\"sepia\"}").theme, ThemePref::System);
        assert_eq!(ThemePref::parse("light"), Some(ThemePref::Light));
        assert_eq!(ThemePref::parse("Light"), None);
        assert_eq!(ThemePref::System.window_theme(), None);
        assert_eq!(ThemePref::Dark.window_theme(), Some(tauri::Theme::Dark));
    }

    #[test]
    fn missing_or_broken_files_keep_previews_on() {
        assert!(from_json("").notification_preview);
        assert!(from_json("not json").notification_preview);
        assert!(from_json("{}").notification_preview);
    }

    #[test]
    fn unknown_preference_is_rejected_and_known_one_applies() {
        assert_eq!(
            apply(Prefs::default(), "autostart", true).err().as_deref(),
            Some("unknown preference")
        );
        assert!(
            !apply(Prefs::default(), "notification_preview", false)
                .unwrap()
                .notification_preview
        );
    }

    #[test]
    fn page_gets_every_choice_under_the_names_the_script_reads() {
        let prefs = Prefs {
            block_typing: true,
            spell_check: false,
            ..Prefs::default()
        };
        let value: serde_json::Value = serde_json::from_str(&prefs.page_json()).unwrap();
        assert_eq!(value["blockTyping"], true);
        assert_eq!(value["spellCheck"], false);
        assert_eq!(value["autoRecover"], true);
        assert_eq!(value["readAhead"], false);
        assert_eq!(value.as_object().unwrap().len(), 8);
        assert_eq!(value["theme"], "system");
        assert!(page_script(&prefs).starts_with("window.__MEW_PREFS = {"));
    }

    #[test]
    fn stored_choice_is_honored() {
        assert!(!from_json("{\"notification_preview\":false}").notification_preview);
    }
}
