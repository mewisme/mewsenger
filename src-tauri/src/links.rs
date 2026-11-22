use tauri::{AppHandle, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

fn is_link_shim(url: &Url) -> bool {
    crate::site::current().is_link_shim(url)
}

/// Popups for Messenger and its calls remain in the app. Other links go to the browser.
pub fn opens_in_app(url: &Url) -> bool {
    if url.scheme() == "about" && url.path() == "blank" {
        return true;
    }
    crate::site::current().opens_in_app(url)
}

/// Do not treat iframe navigation as a user click. The injected script handles
/// clicked links; this hook handles Facebook's redirect and non-web schemes.
pub fn allow_navigation<R: Runtime>(app: &AppHandle<R>, url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" if is_link_shim(url) => {
            open_external(app, url);
            false
        }
        "http" | "https" | "about" | "blob" | "data" => true,
        "mailto" | "tel" => {
            open_external(app, url);
            false
        }
        _ => false,
    }
}

fn external_target(url: &Url) -> Option<Url> {
    let target = if is_link_shim(url) {
        unwrap_link_shim(url)
    } else {
        Some(url.clone())
    };
    target
        .filter(|u| matches!(u.scheme(), "http" | "https" | "mailto" | "tel"))
        .map(strip_tracking)
}

pub fn open_external<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let Some(target) = external_target(url) else {
        return;
    };
    if let Err(err) = app.opener().open_url(target.as_str(), None::<&str>) {
        eprintln!("could not open external link: {err}");
    }
}

const PROJECT_URL: &str = "https://github.com/mewisme/mewsenger";

/// The project page behind a name Settings sends; never an arbitrary URL.
fn project_page(page: &str) -> Option<String> {
    match page {
        "repo" => Some(PROJECT_URL.to_string()),
        "releases" => Some(format!("{PROJECT_URL}/releases")),
        "issues" => Some(format!("{PROJECT_URL}/issues")),
        "license" => Some(format!("{PROJECT_URL}/blob/main/LICENSE")),
        _ => None,
    }
}

/// Opens one of the project's pages in the default browser.
#[tauri::command]
pub fn open_project_link(
    app: AppHandle,
    webview: tauri::Webview,
    page: String,
) -> Result<(), String> {
    if !crate::shell::local_webview(&webview, &[crate::shell::LocalKind::Settings]) {
        return Err("settings view required".into());
    }
    let url = project_page(&page).ok_or("unknown page")?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "could not open the page".to_string())
}

fn unwrap_link_shim(url: &Url) -> Option<Url> {
    if !is_link_shim(url) {
        return None;
    }
    let (_, target) = url.query_pairs().find(|(key, _)| key == "u")?;
    Url::parse(&target)
        .ok()
        .filter(|target| matches!(target.scheme(), "http" | "https"))
}

fn strip_tracking(mut url: Url) -> Url {
    if !url.query_pairs().any(|(key, _)| key == "fbclid") {
        return url;
    }
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "fbclid")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(kept);
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn keeps_messenger_and_call_popups_inside_the_app() {
        assert!(opens_in_app(&url("https://www.messenger.com/t/123")));
        assert!(opens_in_app(&url("https://www.facebook.com/groupcall/123")));
        assert!(opens_in_app(&url("https://www.facebook.com/login/")));
        assert!(opens_in_app(&url("about:blank")));
        assert!(!opens_in_app(&url("https://www.facebook.com/reel/123")));
        assert!(!opens_in_app(&url("https://notmessenger.com/t/123")));
        assert!(!opens_in_app(&url(
            "https://www.facebook.com/groupcallback"
        )));
        assert!(!opens_in_app(&url(
            "https://www.facebook.com/messages-malicious"
        )));
        assert!(!opens_in_app(&url(
            "https://www.messenger.com.evil.example/t/123"
        )));
        assert!(!opens_in_app(&url("https://example.com/groupcall/123")));
        assert!(!opens_in_app(&url("javascript:alert(1)")));
        assert!(!opens_in_app(&url(
            "https://l.messenger.com/l.php?u=https%3A%2F%2Fexample.com"
        )));
    }

    #[test]
    fn only_web_mail_and_phone_links_leave_the_app() {
        assert_eq!(
            external_target(&url("https://example.com/?fbclid=a"))
                .unwrap()
                .as_str(),
            "https://example.com/"
        );
        assert!(external_target(&url("mailto:a@example.com")).is_some());
        assert!(external_target(&url("tel:+84123456789")).is_some());
        assert_eq!(
            external_target(&url(
                "https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2F%3Ffbclid%3Dabc"
            ))
            .unwrap()
            .as_str(),
            "https://example.com/"
        );
        for blocked in [
            "file:///C:/Windows/System32/calc.exe",
            "smb://attacker.example/share",
            "search-ms:query=x&crumb=location:\\\\attacker.example\\share",
            "ms-msdt:/id PCWDiagnostic",
            "fb://profile/1",
            "javascript:alert(1)",
            "https://l.facebook.com/l.php?u=file%3A%2F%2F%2Fetc%2Fpasswd",
        ] {
            assert!(external_target(&url(blocked)).is_none(), "{blocked}");
        }
    }

    #[test]
    fn unwraps_facebook_link_redirects_and_removes_fbclid() {
        let shim = url("https://l.messenger.com/l.php?u=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26fbclid%3Dabc&h=AT0");
        let target = strip_tracking(unwrap_link_shim(&shim).unwrap());
        assert_eq!(target.as_str(), "https://example.com/a?x=1");
        assert_eq!(
            strip_tracking(url("https://example.com/?fbclid=a")).as_str(),
            "https://example.com/"
        );
        assert_eq!(
            strip_tracking(url("https://example.com/?a=1&fbclid=x&b=2")).as_str(),
            "https://example.com/?a=1&b=2"
        );
    }

    #[test]
    fn refuses_unsafe_and_malformed_redirects() {
        assert!(
            unwrap_link_shim(&url("https://l.facebook.com/l.php?u=javascript%3Aalert(1)"))
                .is_none()
        );
        assert!(unwrap_link_shim(&url(
            "https://l.facebook.com/l.php?u=file%3A%2F%2F%2Fetc%2Fpasswd"
        ))
        .is_none());
        assert!(unwrap_link_shim(&url("https://l.facebook.com/l.php")).is_none());
        assert!(unwrap_link_shim(&url(
            "https://example.com/l.php?u=https%3A%2F%2Fexample.org"
        ))
        .is_none());
    }

    #[test]
    fn project_links_are_named_pages_never_arbitrary_urls() {
        assert_eq!(
            project_page("releases").as_deref(),
            Some("https://github.com/mewisme/mewsenger/releases")
        );
        assert!(project_page("repo").is_some() && project_page("license").is_some());
        assert_eq!(project_page("https://example.com"), None);
        assert_eq!(project_page(""), None);
    }

    #[test]
    fn preserves_other_tracking_parameters_and_fragments() {
        assert_eq!(
            strip_tracking(url(
                "https://example.com/path?utm_source=chat&fbclid=x&q=1#anchor"
            ))
            .as_str(),
            "https://example.com/path?utm_source=chat&q=1#anchor"
        );
        assert_eq!(
            strip_tracking(url("https://example.com/path?fbclid=x&fbclid=y")).as_str(),
            "https://example.com/path"
        );
        assert_eq!(
            strip_tracking(url("https://example.com/path?x=1#frag")).as_str(),
            "https://example.com/path?x=1#frag"
        );
    }
}
