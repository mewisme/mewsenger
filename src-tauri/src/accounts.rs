use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
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
    Some(app.path().app_local_data_dir().ok()?.join("accounts").join(id))
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
            from_json("{\"accounts\":[{\"id\":\"a1\",\"name\":\"x\"},{\"id\":\"../x\",\"name\":\"y\"}]}"),
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
}
