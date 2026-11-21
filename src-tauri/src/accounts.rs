use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Label of the small view that lists accounts without an open tab.
pub const TAB_MENU: &str = "tabmenu";
pub const MAX_ACCOUNTS: usize = 4;
const MAX_NAME_CHARS: usize = 24;
pub const FIRST: &str = "a1";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub name: String,
}

/// Where Settings opens: its own window, or over the main window's page.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SettingsPlacement {
    #[default]
    Window,
    Overlay,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Config {
    pub settings: SettingsPlacement,
    /// Tab on screen; restored on the next start.
    pub active: String,
    /// Accounts that have a tab, in tab order. Closing a tab keeps the
    /// account and its login; only removing the account deletes them.
    pub open: Vec<String>,
    pub next_id: u32,
    pub accounts: Vec<Account>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            settings: SettingsPlacement::Window,
            active: FIRST.into(),
            open: vec![FIRST.into()],
            next_id: 2,
            accounts: vec![Account {
                id: FIRST.into(),
                name: "Account 1".into(),
            }],
        }
    }
}

/// Parses stored configuration; anything unusable falls back to the default.
pub fn from_json(text: &str) -> Config {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Config::default();
    };
    let has_tabs = value.get("open").is_some();
    let Ok(mut config) = serde_json::from_value::<Config>(value) else {
        return Config::default();
    };
    let valid = !config.accounts.is_empty()
        && config.accounts.len() <= MAX_ACCOUNTS
        && config.accounts[0].id == FIRST
        && config.accounts.iter().all(|a| valid_id(&a.id))
        && config
            .accounts
            .iter()
            .enumerate()
            .all(|(i, a)| config.accounts[..i].iter().all(|b| b.id != a.id));
    if !valid {
        return Config::default();
    }
    if !has_tabs {
        // Files from before tabs: every account was on screen.
        config.open = config.accounts.iter().map(|a| a.id.clone()).collect();
    }
    let floor = config
        .accounts
        .iter()
        .filter_map(|a| a.id[1..].parse::<u32>().ok())
        .max()
        .unwrap_or(1)
        + 1;
    config.next_id = config.next_id.max(floor);
    config.normalize();
    config
}

fn valid_id(id: &str) -> bool {
    let digits = id.strip_prefix('a').unwrap_or("");
    (1..=3).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
}

impl Config {
    pub fn account(&self, id: &str) -> Option<&Account> {
        self.accounts.iter().find(|a| a.id == id)
    }

    /// Keeps `open` to known, distinct accounts with at least one tab, and
    /// `active` on one of them.
    fn normalize(&mut self) {
        let mut seen: Vec<String> = Vec::new();
        for id in std::mem::take(&mut self.open) {
            if self.account(&id).is_some() && !seen.contains(&id) {
                seen.push(id);
            }
        }
        if seen.is_empty() {
            seen.push(self.accounts[0].id.clone());
        }
        self.open = seen;
        if !self.open.contains(&self.active) {
            self.active = self.open[0].clone();
        }
    }

    pub fn is_open(&self, id: &str) -> bool {
        self.open.iter().any(|open| open == id)
    }

    /// Account on screen.
    pub fn shown_account(&self) -> &str {
        &self.active
    }

    /// Accounts without a tab, in account order.
    pub fn closed(&self) -> Vec<&Account> {
        self.accounts
            .iter()
            .filter(|a| !self.is_open(&a.id))
            .collect()
    }

    /// Adds an account, opens its tab and shows it.
    pub fn add(&mut self, name: &str) -> Result<String, String> {
        if self.accounts.len() >= MAX_ACCOUNTS {
            return Err("account limit reached".into());
        }
        let name = valid_name(name)?;
        let id = format!("a{}", self.next_id);
        self.next_id += 1;
        self.accounts.push(Account {
            id: id.clone(),
            name,
        });
        self.open.push(id.clone());
        self.active = id.clone();
        Ok(id)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = valid_name(name)?;
        let account = self
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("unknown account")?;
        account.name = name;
        Ok(())
    }

    /// Deletes the account itself; its tab goes with it.
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if id == FIRST {
            return Err("the first account cannot be removed".into());
        }
        let index = self
            .accounts
            .iter()
            .position(|a| a.id == id)
            .ok_or("unknown account")?;
        self.accounts.remove(index);
        self.open.retain(|open| open != id);
        self.normalize();
        Ok(())
    }

    /// Opens a tab for `id` if it has none and shows it.
    pub fn open_tab(&mut self, id: &str) -> Result<(), String> {
        if self.account(id).is_none() {
            return Err("unknown account".into());
        }
        if !self.is_open(id) {
            self.open.push(id.to_string());
        }
        self.active = id.to_string();
        Ok(())
    }

    /// Closes a tab, never the last one. The neighbour takes over when the
    /// active tab closes.
    pub fn close_tab(&mut self, id: &str) -> Result<(), String> {
        let index = self
            .open
            .iter()
            .position(|open| open == id)
            .ok_or("tab is not open")?;
        if self.open.len() == 1 {
            return Err("the last tab cannot be closed".into());
        }
        self.open.remove(index);
        if self.active == id {
            self.active = self.open[index.min(self.open.len() - 1)].clone();
        }
        Ok(())
    }
}

fn valid_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let chars = name.chars().count();
    if chars == 0 || chars > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err("invalid account name".into());
    }
    Ok(name.to_string())
}

pub fn remote_label(id: &str) -> String {
    format!("messenger-{id}")
}

pub fn titlebar_label(id: &str) -> String {
    format!("titlebar-{id}")
}

pub fn status_label(id: &str) -> String {
    format!("status-{id}")
}

/// Account that owns a webview label, if the label is one of ours.
pub fn account_of(label: &str) -> Option<&str> {
    if label == "main" {
        return Some(FIRST);
    }
    let id = ["messenger-", "titlebar-", "status-"]
        .iter()
        .find_map(|prefix| label.strip_prefix(prefix))?;
    valid_id(id).then_some(id)
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("accounts.json"))
}

pub fn load(app: &AppHandle) -> Config {
    path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|text| from_json(&text))
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, config: &Config) -> std::io::Result<()> {
    let target = path(app).ok_or_else(|| std::io::Error::other("config directory unavailable"))?;
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = target.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(config)?)?;
    std::fs::rename(&tmp, &target)
}

/// `None` for the first account: it keeps the default WebView2 profile.
pub fn data_directory(app: &AppHandle, id: &str) -> Option<PathBuf> {
    if id == FIRST || !valid_id(id) {
        return None;
    }
    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("accounts")
            .join(id),
    )
}

pub fn snapshot(app: &AppHandle) -> Config {
    app.state::<Mutex<Config>>()
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default()
}

/// Applies `change` to the stored configuration, persisting it on success.
pub fn mutate<T>(
    app: &AppHandle,
    change: impl FnOnce(&mut Config) -> Result<T, String>,
) -> Result<(T, Config), String> {
    let state = app.state::<Mutex<Config>>();
    let mut guard = state.lock().map_err(|_| "accounts unavailable")?;
    let mut next = guard.clone();
    let value = change(&mut next)?;
    save(app, &next).map_err(|error| {
        eprintln!("could not save accounts: {error}");
        "could not save accounts".to_string()
    })?;
    *guard = next.clone();
    Ok((value, next))
}

/// Account on screen, which tray actions target.
pub fn active_account(app: &AppHandle) -> String {
    snapshot(app).shown_account().to_string()
}

fn encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Value of the `accounts` query parameter for local views: `id:name` pairs
/// with the name escaped, joined by commas, then escaped as a whole.
pub fn accounts_param(accounts: &[&Account]) -> String {
    let inner = accounts
        .iter()
        .map(|a| format!("{}:{}", a.id, encode_component(&a.name)))
        .collect::<Vec<_>>()
        .join(",");
    encode_component(&inner)
}

fn view_of(webview: &tauri::Webview, kinds: &[crate::shell::LocalKind]) -> Result<(), String> {
    if crate::shell::local_webview(webview, kinds) {
        Ok(())
    } else {
        Err("local view required".into())
    }
}

fn settings_view(webview: &tauri::Webview) -> Result<(), String> {
    view_of(webview, &[crate::shell::LocalKind::Settings])
}

/// Views that may open tabs: settings, the tab strip and its dropdown.
fn tab_views(webview: &tauri::Webview) -> Result<(), String> {
    use crate::shell::LocalKind;
    view_of(
        webview,
        &[LocalKind::Settings, LocalKind::Titlebar, LocalKind::TabMenu],
    )
}

/// Tells the settings view and the tab strip that the configuration changed.
fn announce(app: &AppHandle, config: &Config) {
    let _ = app.emit_filter("accounts-changed", config, |target| {
        matches!(target, tauri::EventTarget::Webview { label }
            if label == "settings" || label.starts_with("titlebar-"))
    });
}

/// Opens a tab for `id` when it has none and shows it.
pub fn activate(app: &AppHandle, id: &str) -> Result<Config, String> {
    let (_, config) = mutate(app, |c| c.open_tab(id))?;
    announce(app, &config);
    crate::shell::sync_tabs(app, || {});
    Ok(config)
}

#[tauri::command]
pub fn list_accounts(webview: tauri::Webview, app: AppHandle) -> Result<Config, String> {
    settings_view(&webview)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn add_account(
    app: AppHandle,
    webview: tauri::Webview,
    name: String,
) -> Result<Config, String> {
    tab_views(&webview)?;
    let (_, config) = mutate(&app, |c| c.add(&name))?;
    crate::desktop::sync_accounts_menu(&app);
    announce(&app, &config);
    crate::shell::sync_tabs(&app, || {});
    Ok(config)
}

#[tauri::command]
pub fn rename_account(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
    name: String,
) -> Result<Config, String> {
    settings_view(&webview)?;
    let (_, config) = mutate(&app, |c| c.rename(&id, &name))?;
    crate::desktop::sync_accounts_menu(&app);
    announce(&app, &config);
    Ok(config)
}

#[tauri::command]
pub fn remove_account(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<Config, String> {
    settings_view(&webview)?;
    let (_, config) = mutate(&app, |c| c.remove(&id))?;
    crate::desktop::sync_accounts_menu(&app);
    announce(&app, &config);
    let cleanup_app = app.clone();
    crate::shell::sync_tabs(&app, move || {
        crate::notifications::account_closed(&cleanup_app, &id);
        remove_data_directory(&cleanup_app, &id);
    });
    Ok(config)
}

/// WebView2 keeps profile files open for a moment after its views close, so
/// deleting is retried; a leftover folder is logged, never an error.
fn remove_data_directory(app: &AppHandle, id: &str) {
    let Some(directory) = data_directory(app, id) else {
        return;
    };
    for attempt in 0..5 {
        match std::fs::remove_dir_all(&directory) {
            Ok(()) => return,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) if attempt == 4 => {
                eprintln!("could not delete account data: {error}");
            }
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(200)),
        }
    }
}

#[tauri::command]
pub fn open_account(app: AppHandle, webview: tauri::Webview, id: String) -> Result<Config, String> {
    tab_views(&webview)?;
    activate(&app, &id)
}

/// Closes the tab only: the account, its login and its data stay.
#[tauri::command]
pub fn close_tab(app: AppHandle, webview: tauri::Webview, id: String) -> Result<Config, String> {
    view_of(&webview, &[crate::shell::LocalKind::Titlebar])?;
    let (_, config) = mutate(&app, |c| c.close_tab(&id))?;
    announce(&app, &config);
    let cleanup_app = app.clone();
    crate::shell::sync_tabs(&app, move || {
        crate::notifications::account_closed(&cleanup_app, &id);
    });
    Ok(config)
}

/// Opens or closes the account dropdown below the "+" button at `x`.
#[tauri::command]
pub fn open_tab_menu(app: AppHandle, webview: tauri::Webview, x: f64) -> Result<(), String> {
    view_of(&webview, &[crate::shell::LocalKind::Titlebar])?;
    if !x.is_finite() {
        return Err("invalid position".into());
    }
    crate::shell::toggle_tab_menu(&app, x);
    Ok(())
}

#[tauri::command]
pub fn close_tab_menu(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    view_of(&webview, &[crate::shell::LocalKind::TabMenu])?;
    crate::shell::close_tab_menu(&app);
    Ok(())
}

#[tauri::command]
pub fn set_settings_placement(
    app: AppHandle,
    webview: tauri::Webview,
    placement: SettingsPlacement,
) -> Result<Config, String> {
    settings_view(&webview)?;
    let (_, config) = mutate(&app, |c| {
        c.settings = placement;
        Ok(())
    })?;
    announce(&app, &config);
    Ok(config)
}

#[tauri::command]
pub fn close_settings(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    settings_view(&webview)?;
    crate::shell::close_settings(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two() -> Config {
        let mut config = Config::default();
        config.add("Second").unwrap();
        config
    }

    #[test]
    fn labels_round_trip_and_reject_lookalikes() {
        for id in ["a1", "a2", "a14"] {
            assert_eq!(account_of(&remote_label(id)), Some(id));
            assert_eq!(account_of(&titlebar_label(id)), Some(id));
            assert_eq!(account_of(&status_label(id)), Some(id));
        }
        assert_eq!(account_of("main"), Some("a1"));
        for bad in [
            "messenger-../x",
            "messenger-a1x",
            "messenger-",
            "messenger-a",
            "messenger-a1234",
            "messenger",
            "settings",
            "tabmenu",
            "acct-a2",
            "popup-1",
        ] {
            assert_eq!(account_of(bad), None, "{bad}");
        }
    }

    #[test]
    fn accounts_are_limited_and_names_validated() {
        let mut config = Config::default();
        for n in 2..=4 {
            assert_eq!(config.add(&format!("Acc {n}")).unwrap(), format!("a{n}"));
        }
        assert!(config.add("Five").is_err());
        assert_eq!(config.accounts.len(), 4);
        let mut config = Config::default();
        assert!(config.add("   ").is_err());
        assert!(config.add(&"x".repeat(25)).is_err());
        assert!(config.add("bad\nname").is_err());
        assert_eq!(config.accounts.len(), 1);
        assert!(config.add("  Work  ").is_ok());
        assert_eq!(config.accounts[1].name, "Work");
    }

    #[test]
    fn a_new_account_gets_a_tab_and_is_shown() {
        let config = two();
        assert_eq!(config.open, vec!["a1", "a2"]);
        assert_eq!(config.shown_account(), "a2");
    }

    #[test]
    fn ids_are_never_reused() {
        let mut config = Config::default();
        config.add("B").unwrap();
        config.remove("a2").unwrap();
        assert_eq!(config.add("C").unwrap(), "a3");
    }

    #[test]
    fn first_account_cannot_be_removed() {
        let mut config = Config::default();
        assert!(config.remove("a1").is_err());
        assert!(config.remove("a9").is_err());
        assert_eq!(config.accounts.len(), 1);
    }

    #[test]
    fn closing_a_tab_keeps_the_account_and_hands_over_to_a_neighbour() {
        let mut config = two();
        config.add("Third").unwrap();
        config.open_tab("a2").unwrap();
        config.close_tab("a2").unwrap();
        assert_eq!(config.open, vec!["a1", "a3"]);
        assert_eq!(config.shown_account(), "a3");
        assert_eq!(config.accounts.len(), 3);
        assert_eq!(config.closed().len(), 1);
        assert_eq!(config.closed()[0].id, "a2");
        // Closing a background tab leaves the shown one alone.
        config.close_tab("a1").unwrap();
        assert_eq!(config.shown_account(), "a3");
    }

    #[test]
    fn the_last_tab_and_unopened_tabs_cannot_be_closed() {
        let mut config = two();
        assert!(config.close_tab("a9").is_err());
        config.close_tab("a2").unwrap();
        assert!(config.close_tab("a1").is_err());
        assert!(config.close_tab("a2").is_err());
        assert_eq!(config.open, vec!["a1"]);
    }

    #[test]
    fn reopening_a_closed_account_appends_a_tab_and_shows_it() {
        let mut config = two();
        config.close_tab("a2").unwrap();
        config.open_tab("a2").unwrap();
        assert_eq!(config.open, vec!["a1", "a2"]);
        assert_eq!(config.shown_account(), "a2");
        config.open_tab("a1").unwrap();
        assert_eq!(config.open, vec!["a1", "a2"]);
        assert_eq!(config.shown_account(), "a1");
        assert!(config.open_tab("a9").is_err());
    }

    #[test]
    fn removing_an_account_removes_its_tab() {
        let mut config = two();
        config.remove("a2").unwrap();
        assert_eq!(config.open, vec!["a1"]);
        assert_eq!(config.shown_account(), "a1");
    }

    #[test]
    fn corrupt_or_inconsistent_json_gives_default() {
        assert_eq!(from_json("not json"), Config::default());
        assert_eq!(from_json("{\"accounts\":[]}"), Config::default());
        assert_eq!(
            from_json("{\"accounts\":[{\"id\":\"a2\",\"name\":\"x\"}]}"),
            Config::default()
        );
        assert_eq!(
            from_json(
                "{\"accounts\":[{\"id\":\"a1\",\"name\":\"x\"},{\"id\":\"a1\",\"name\":\"y\"}]}"
            ),
            Config::default()
        );
        assert_eq!(
            from_json(
                "{\"accounts\":[{\"id\":\"a1\",\"name\":\"x\"},{\"id\":\"../x\",\"name\":\"y\"}]}"
            ),
            Config::default()
        );
    }

    #[test]
    fn files_from_before_tabs_open_every_account_and_keep_the_last_used_one() {
        let config = from_json(
            r#"{"layout":"split","split_ratio":0.6,"active":"a2","next_id":1,"accounts":[{"id":"a1","name":"A"},{"id":"a2","name":"B"}]}"#,
        );
        assert_eq!(config.open, vec!["a1", "a2"]);
        assert_eq!(config.shown_account(), "a2");
        assert_eq!(config.next_id, 3);
        assert_eq!(config.settings, SettingsPlacement::Window);
    }

    #[test]
    fn stored_tabs_are_repaired() {
        let accounts = r#""accounts":[{"id":"a1","name":"A"},{"id":"a2","name":"B"}]"#;
        let config = from_json(&format!(
            r#"{{"open":["a2","a9","a2"],"active":"a1",{accounts}}}"#
        ));
        assert_eq!(config.open, vec!["a2"]);
        assert_eq!(config.shown_account(), "a2");
        let config = from_json(&format!(r#"{{"open":[],{accounts}}}"#));
        assert_eq!(config.open, vec!["a1"]);
        let again = from_json(&serde_json::to_string(&two()).unwrap());
        assert_eq!(again, two());
    }

    #[test]
    fn rename_validates_and_needs_a_known_account() {
        let mut config = Config::default();
        assert!(config.rename("a9", "x").is_err());
        assert!(config.rename("a1", "").is_err());
        config.rename("a1", " Home ").unwrap();
        assert_eq!(config.accounts[0].name, "Home");
    }

    #[test]
    fn local_view_query_survives_commas_colons_and_non_ascii() {
        let a = Account {
            id: "a2".into(),
            name: "Work, home: é".into(),
        };
        let value = accounts_param(&[&a]);
        assert!(value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'%'));
        let mut bytes = Vec::new();
        let raw = value.as_bytes();
        let mut i = 0;
        while i < raw.len() {
            if raw[i] == b'%' {
                bytes.push(u8::from_str_radix(&value[i + 1..i + 3], 16).unwrap());
                i += 3;
            } else {
                bytes.push(raw[i]);
                i += 1;
            }
        }
        // One decode, as the URL parser does: pairs are still split on `,` and `:`.
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            "a2:Work%2C%20home%3A%20%C3%A9"
        );
    }
}
