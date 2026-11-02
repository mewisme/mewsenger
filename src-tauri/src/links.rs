use tauri::{AppHandle, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

const LINK_SHIM_HOSTS: &[&str] = &["l.messenger.com", "l.facebook.com", "lm.facebook.com"];
const FACEBOOK_POPUP_PATHS: &[&str] = &[
    "/messages",
    "/messenger_media",
    "/groupcall",
    "/videocall",
    "/login",
    "/checkpoint",
    "/dialog",
    "/connect",
];

fn matches_path(path: &str, prefix: &str) -> bool {
    path == prefix || path.starts_with(&format!("{prefix}/"))
}

fn on_host(url: &Url, domain: &str) -> bool {
    url.host_str()
        .is_some_and(|host| host == domain || host.ends_with(&format!(".{domain}")))
}

fn is_link_shim(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| LINK_SHIM_HOSTS.contains(&host))
        && url.path() == "/l.php"
}

/// Popups for Messenger and its calls remain in the app. Other links go to the browser.
pub fn opens_in_app(url: &Url) -> bool {
    if url.scheme() == "about" && url.path() == "blank" {
        return true;
    }
    if !matches!(url.scheme(), "http" | "https") || is_link_shim(url) {
        return false;
    }
    on_host(url, "messenger.com")
        || (on_host(url, "facebook.com")
            && FACEBOOK_POPUP_PATHS
                .iter()
                .any(|path| matches_path(url.path(), path)))
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

pub fn open_external<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let target = if is_link_shim(url) {
        unwrap_link_shim(url)
    } else {
        Some(url.clone())
    };
    let Some(target) =
        target.filter(|url| matches!(url.scheme(), "http" | "https" | "mailto" | "tel"))
    else {
        return;
    };
    let target = strip_tracking(target);
    if let Err(err) = app.opener().open_url(target.as_str(), None::<&str>) {
        eprintln!("could not open external link: {err}");
    }
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
