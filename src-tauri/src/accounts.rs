use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::{AppHandle, Manager};

pub const SPLIT: &str = "split";
pub const MAX_ACCOUNTS: usize = 4;
pub const MAX_SPLIT_ACCOUNTS: usize = 2;
const MAX_NAME_CHARS: usize = 24;
pub const FIRST: &str = "a1";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    Windows,
    Split,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Config {
    pub layout: Layout,
    pub split_ratio: f64,
    pub next_id: u32,
    pub accounts: Vec<Account>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            layout: Layout::Windows,
            split_ratio: 0.5,
            next_id: 2,
            accounts: vec![Account {
                id: FIRST.into(),
                name: "Account 1".into(),
            }],
        }
    }
}

fn clamp_ratio(ratio: f64) -> f64 {
    ratio.clamp(0.2, 0.8)
}

/// Parses stored configuration; anything unusable falls back to the default.
pub fn from_json(text: &str) -> Config {
    let Ok(mut config) = serde_json::from_str::<Config>(text) else {
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
    if !valid || !config.split_ratio.is_finite() {
        return Config::default();
    }
    config.split_ratio = clamp_ratio(config.split_ratio);
    if config.layout == Layout::Split && config.accounts.len() > MAX_SPLIT_ACCOUNTS {
        config.layout = Layout::Windows;
    }
    let floor = config
        .accounts
        .iter()
        .filter_map(|a| a.id[1..].parse::<u32>().ok())
        .max()
        .unwrap_or(1)
        + 1;
    config.next_id = config.next_id.max(floor);
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

    pub fn name_of(&self, id: &str) -> String {
        self.account(id)
            .map_or_else(|| id.to_string(), |a| a.name.clone())
    }

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
        if self.accounts.len() > MAX_SPLIT_ACCOUNTS {
            self.layout = Layout::Windows;
        }
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
        Ok(())
    }

    pub fn set_layout(&mut self, layout: Layout) -> Result<(), String> {
        if layout == Layout::Split && self.accounts.len() > MAX_SPLIT_ACCOUNTS {
            return Err("split supports up to 2 accounts".into());
        }
        self.layout = layout;
        Ok(())
    }

    pub fn set_split_ratio(&mut self, ratio: f64) -> Result<(), String> {
        if !ratio.is_finite() {
            return Err("invalid ratio".into());
        }
        self.split_ratio = clamp_ratio(ratio);
        Ok(())
    }

    /// Split layout is only effective with two or more accounts.
    pub fn is_split(&self) -> bool {
        self.layout == Layout::Split && self.accounts.len() >= 2
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

pub fn window_label(id: &str) -> String {
    if id == FIRST {
        "main".into()
    } else {
        format!("acct-{id}")
    }
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

/// Account that owns a window or webview label, if the label is one of ours.
pub fn account_of(label: &str) -> Option<&str> {
    if label == "main" {
        return Some(FIRST);
    }
    let id = ["messenger-", "titlebar-", "status-", "acct-"]
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

/// Account whose Messenger page last reported window focus.
pub struct ActiveAccount(pub Mutex<String>);

impl Default for ActiveAccount {
    fn default() -> Self {
        Self(Mutex::new(FIRST.to_string()))
    }
}

/// Window that shows an account: `main` in split layout, otherwise the
/// account's own window.
pub fn host_window(app: &AppHandle, account: &str) -> Option<tauri::Window> {
    if snapshot(app).is_split() {
        app.get_window("main")
    } else {
        app.get_window(&window_label(account))
    }
}

/// Active account, or the first one when its page is gone.
pub fn active_account(app: &AppHandle) -> String {
    let active = app
        .try_state::<ActiveAccount>()
        .and_then(|a| a.0.lock().ok().map(|a| a.clone()))
        .unwrap_or_else(|| FIRST.to_string());
    if app.get_webview(&remote_label(&active)).is_some() {
        active
    } else {
        FIRST.to_string()
    }
}

/// Updates the split ratio in memory at once and writes it to disk once the
/// drag has settled, so a drag does not rewrite the file on every frame.
pub fn set_ratio_live(app: &AppHandle, ratio: f64) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    {
        let state = app.state::<Mutex<Config>>();
        let mut guard = state.lock().map_err(|_| "accounts unavailable")?;
        guard.set_split_ratio(ratio)?;
    }
    let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if GENERATION.load(Ordering::Acquire) == generation {
            if let Err(error) = save(&app, &snapshot(&app)) {
                eprintln!("could not save accounts: {error}");
            }
        }
    });
    Ok(())
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

fn settings_view(webview: &tauri::Webview) -> Result<(), String> {
    if crate::shell::local_webview(webview, &[crate::shell::LocalKind::Settings]) {
        Ok(())
    } else {
        Err("settings view required".into())
    }
}

/// Tells the settings window and every status bar that the list changed.
fn announce(app: &AppHandle, config: &Config) {
    crate::shell::emit_status(app, "accounts-changed", config);
    let _ = app.emit_to("settings", "accounts-changed", config);
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
    settings_view(&webview)?;
    let (_, config) = mutate(&app, |c| c.add(&name))?;
    crate::desktop::sync_accounts_menu(&app);
    announce(&app, &config);
    crate::shell::apply_layout(&app, None, || {});
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
    if id != FIRST {
        if let Some(window) = app.get_window(&window_label(&id)) {
            let _ = window.set_title(&format!("Messenger - {}", config.name_of(&id)));
        }
    }
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
    if let Some(active) = app.try_state::<ActiveAccount>() {
        if let Ok(mut active) = active.0.lock() {
            if *active == id {
                *active = FIRST.to_string();
            }
        }
    }
    crate::desktop::sync_accounts_menu(&app);
    announce(&app, &config);
    let cleanup_app = app.clone();
    crate::shell::apply_layout(&app, None, move || {
        crate::notifications::account_removed(&cleanup_app, &id);
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
pub fn set_layout(
    app: AppHandle,
    webview: tauri::Webview,
    layout: Layout,
) -> Result<Config, String> {
    settings_view(&webview)?;
    let (_, config) = mutate(&app, |c| c.set_layout(layout))?;
    announce(&app, &config);
    crate::shell::apply_layout(&app, None, || {});
    Ok(config)
}

#[tauri::command]
pub fn open_account(app: AppHandle, webview: tauri::Webview, id: String) -> Result<(), String> {
    settings_view(&webview)?;
    if snapshot(&app).account(&id).is_none() {
        return Err("unknown account".into());
    }
    crate::desktop::open_account(&app, &id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_round_trip_and_reject_lookalikes() {
        assert_eq!(window_label("a1"), "main");
        assert_eq!(window_label("a2"), "acct-a2");
        for id in ["a1", "a2", "a14"] {
            assert_eq!(account_of(&remote_label(id)), Some(id));
            assert_eq!(account_of(&titlebar_label(id)), Some(id));
            assert_eq!(account_of(&status_label(id)), Some(id));
            if id != "a1" {
                assert_eq!(account_of(&window_label(id)), Some(id));
            }
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
            "split",
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
    fn third_account_forces_windows_layout() {
        let mut config = Config::default();
        config.add("B").unwrap();
        config.set_layout(Layout::Split).unwrap();
        assert!(config.is_split());
        config.add("C").unwrap();
        assert_eq!(config.layout, Layout::Windows);
        assert!(config.set_layout(Layout::Split).is_err());
        assert_eq!(config.layout, Layout::Windows);
    }

    #[test]
    fn split_needs_two_accounts_to_take_effect() {
        let mut config = Config::default();
        config.set_layout(Layout::Split).unwrap();
        assert!(!config.is_split());
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
    fn stored_layout_ratio_and_next_id_are_repaired() {
        let config = from_json(
            "{\"layout\":\"split\",\"split_ratio\":0.95,\"next_id\":1,\"accounts\":[{\"id\":\"a1\",\"name\":\"A\"},{\"id\":\"a2\",\"name\":\"B\"},{\"id\":\"a3\",\"name\":\"C\"}]}",
        );
        assert_eq!(config.layout, Layout::Windows);
        assert_eq!(config.split_ratio, 0.8);
        assert_eq!(config.next_id, 4);
        assert_eq!(from_json("{\"split_ratio\":0.1}").split_ratio, 0.2);
    }

    #[test]
    fn ratio_is_clamped_and_must_be_finite() {
        let mut config = Config::default();
        config.set_split_ratio(0.0).unwrap();
        assert_eq!(config.split_ratio, 0.2);
        config.set_split_ratio(5.0).unwrap();
        assert_eq!(config.split_ratio, 0.8);
        assert!(config.set_split_ratio(f64::NAN).is_err());
        assert!(config.set_split_ratio(f64::INFINITY).is_err());
        assert_eq!(config.split_ratio, 0.8);
    }

    #[test]
    fn rename_validates_and_needs_a_known_account() {
        let mut config = Config::default();
        assert!(config.rename("a9", "x").is_err());
        assert!(config.rename("a1", "").is_err());
        config.rename("a1", " Home ").unwrap();
        assert_eq!(config.name_of("a1"), "Home");
    }

    #[test]
    fn status_query_survives_commas_colons_and_non_ascii() {
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
