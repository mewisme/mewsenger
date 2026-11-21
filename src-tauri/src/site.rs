//! Compile-time site profile loaded from `src-tauri/site.json`.
//!
//! - `start_url`: page the main WebView loads; https, no port, host in `app_hosts`.
//! - `app_hosts`: exact hostnames of the main page where enhancements and IPC are
//!   allowed (no subdomain matching, https only, no port).
//! - `in_app_hosts`: popup/navigation allowlist. `domain` matches itself and any
//!   subdomain; `paths` omitted means any path, otherwise a path prefix that must
//!   end on a segment boundary.
//! - `link_shim_hosts`: redirect hosts whose `/l.php?u=` links are unwrapped.
//! - `thread_path`: path segments placed before a thread id.
//!
//! The same JSON is injected into pages as `window.__MEW_SITE__`.
use std::sync::OnceLock;

use serde::Deserialize;
use tauri::Url;

const SITE_JSON: &str = include_str!("../site.json");

#[derive(Deserialize)]
struct Raw {
    start_url: String,
    app_hosts: Vec<String>,
    in_app_hosts: Vec<InAppRule>,
    link_shim_hosts: Vec<String>,
    thread_path: Vec<String>,
}

#[derive(Deserialize)]
struct InAppRule {
    domain: String,
    #[serde(default)]
    paths: Option<Vec<String>>,
}

pub struct SiteProfile {
    start_url: Url,
    raw: Raw,
    prelude: String,
}

fn check_host(field: &str, host: &str) -> Result<(), String> {
    if host.is_empty()
        || !host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    {
        return Err(format!("{field}: invalid host {host:?}"));
    }
    Ok(())
}

pub fn parse(json: &str) -> Result<SiteProfile, String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let raw: Raw = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    let start_url = Url::parse(&raw.start_url).map_err(|e| format!("start_url: {e}"))?;
    if start_url.scheme() != "https" || start_url.port().is_some() {
        return Err("start_url: must be https without a port".into());
    }
    if raw.app_hosts.is_empty() {
        return Err("app_hosts: must not be empty".into());
    }
    for host in &raw.app_hosts {
        check_host("app_hosts", host)?;
    }
    if !start_url
        .host_str()
        .is_some_and(|h| raw.app_hosts.iter().any(|a| a == h))
    {
        return Err("start_url: host is not in app_hosts".into());
    }
    for rule in &raw.in_app_hosts {
        check_host("in_app_hosts", &rule.domain)?;
        for path in rule.paths.iter().flatten() {
            if !path.starts_with('/') {
                return Err(format!("in_app_hosts.paths: {path:?} must start with '/'"));
            }
        }
    }
    for host in &raw.link_shim_hosts {
        check_host("link_shim_hosts", host)?;
    }
    if raw.thread_path.is_empty()
        || raw
            .thread_path
            .iter()
            .any(|s| s.is_empty() || s.contains('/'))
    {
        return Err("thread_path: needs non-empty segments without '/'".into());
    }
    let prelude = format!(
        "window.__MEW_SITE__=Object.freeze({});",
        serde_json::to_string(&value).map_err(|e| e.to_string())?
    );
    Ok(SiteProfile {
        start_url,
        raw,
        prelude,
    })
}

pub fn current() -> &'static SiteProfile {
    static SITE: OnceLock<SiteProfile> = OnceLock::new();
    SITE.get_or_init(|| parse(SITE_JSON).expect("src-tauri/site.json is invalid"))
}

impl SiteProfile {
    pub fn start_url(&self) -> &Url {
        &self.start_url
    }

    pub fn prelude(&self) -> &str {
        &self.prelude
    }

    pub fn is_app_origin(&self, url: &Url) -> bool {
        url.scheme() == "https"
            && url.port().is_none()
            && url
                .host_str()
                .is_some_and(|h| self.raw.app_hosts.iter().any(|a| a == h))
    }

    pub fn is_link_shim(&self, url: &Url) -> bool {
        url.host_str()
            .is_some_and(|h| self.raw.link_shim_hosts.iter().any(|a| a == h))
            && url.path() == "/l.php"
    }

    pub fn opens_in_app(&self, url: &Url) -> bool {
        if !matches!(url.scheme(), "http" | "https") || self.is_link_shim(url) {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        let path = url.path();
        self.raw.in_app_hosts.iter().any(|rule| {
            (host == rule.domain || host.ends_with(&format!(".{}", rule.domain)))
                && rule.paths.as_ref().is_none_or(|paths| {
                    paths
                        .iter()
                        .any(|p| path == p || path.starts_with(&format!("{p}/")))
                })
        })
    }

    pub fn thread_url(&self, thread: &str) -> Option<Url> {
        let mut url = self.start_url.clone();
        url.set_query(None);
        url.set_fragment(None);
        url.path_segments_mut()
            .ok()?
            .clear()
            .extend(&self.raw.thread_path)
            .push(thread);
        Some(url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FACEBOOK: &str = r#"{
      "start_url": "https://www.facebook.com/messages/",
      "app_hosts": ["facebook.com", "www.facebook.com"],
      "in_app_hosts": [{"domain": "facebook.com", "paths": ["/messages", "/messenger_media", "/groupcall", "/videocall", "/login", "/checkpoint", "/dialog", "/connect"]}],
      "link_shim_hosts": ["l.messenger.com", "l.facebook.com", "lm.facebook.com"],
      "thread_path": ["messages", "t"]
    }"#;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn bundled_profile_is_valid() {
        let site = parse(SITE_JSON).unwrap();
        assert_eq!(
            site.thread_url("123").unwrap().as_str(),
            "https://www.messenger.com/t/123"
        );
    }

    #[test]
    fn facebook_profile_switches_every_rule() {
        let site = parse(FACEBOOK).unwrap();
        assert!(site.is_app_origin(&url("https://www.facebook.com/messages/t/1")));
        assert!(!site.is_app_origin(&url("https://www.messenger.com/")));
        assert!(!site.is_app_origin(&url("https://www.facebook.com:444/")));
        assert!(!site.is_app_origin(&url("http://www.facebook.com/")));
        assert_eq!(
            site.thread_url("123").unwrap().as_str(),
            "https://www.facebook.com/messages/t/123"
        );
        assert!(site.opens_in_app(&url("https://www.facebook.com/groupcall/1")));
        assert!(!site.opens_in_app(&url("https://www.facebook.com/reel/1")));
        assert!(!site.opens_in_app(&url("https://www.facebook.com/messages-malicious")));
    }

    #[test]
    fn rejects_invalid_profiles() {
        let swap = |from: &str, to: &str| FACEBOOK.replacen(from, to, 1);
        let bad = [
            swap(
                "https://www.facebook.com/messages/",
                "http://www.facebook.com/messages/",
            ),
            swap(
                "https://www.facebook.com/messages/",
                "https://www.example.com/",
            ),
            swap(
                "\"facebook.com\", \"www.facebook.com\"",
                "\"facebook.com\", \"www.facebook.com\", \"WWW.messenger.com\"",
            ),
            swap(
                "\"facebook.com\", \"www.facebook.com\"",
                "\"facebook.com\", \"www.facebook.com\", \"*.messenger.com\"",
            ),
            swap("\"/messages\"", "\"messages\""),
            swap("[\"messages\", \"t\"]", "[]"),
            "{not json".to_string(),
        ];
        for json in bad {
            assert!(parse(&json).is_err(), "accepted: {json}");
        }
    }
}
