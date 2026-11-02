use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
    Window,
};

use crate::{open_popup, DESKTOP_SCRIPT, LINK_SCRIPT, MESSENGER_URL, NOTIFICATIONS_SCRIPT};

pub const REMOTE: &str = "messenger";
pub const STATUS: &str = "status";
const FOOTER_HEIGHT: f64 = 36.0;

pub(crate) fn local_asset_url(url: &Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost" | "127.0.0.1")) => {
            cfg!(debug_assertions) && url.port() == Some(1420)
        }
        _ => false,
    }
}

fn bounds(window: &Window) -> tauri::Result<(f64, f64)> {
    let physical = window.inner_size()?;
    let scale = window.scale_factor()?;
    Ok((
        f64::from(physical.width) / scale,
        f64::from(physical.height) / scale,
    ))
}

pub fn resize(window: &Window) -> tauri::Result<()> {
    let (width, height) = bounds(window)?;
    let has_footer = window.webviews().iter().any(|view| view.label() == STATUS);
    let body = if has_footer {
        (height - FOOTER_HEIGHT).max(1.0)
    } else {
        height
    };
    for webview in window.webviews() {
        match webview.label() {
            REMOTE => {
                webview.set_position(LogicalPosition::new(0.0, 0.0))?;
                webview.set_size(LogicalSize::new(width, body))?;
            }
            STATUS => {
                webview.set_position(LogicalPosition::new(0.0, body))?;
                webview.set_size(LogicalSize::new(width, height - body))?;
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn mount(app: &AppHandle, window: &Window) -> tauri::Result<()> {
    let (width, height) = bounds(window)?;
    let body = (height - FOOTER_HEIGHT).max(1.0);
    let url = Url::parse(MESSENGER_URL).expect("valid initial URL");
    let navigation_app = app.clone();
    let popup_app = app.clone();

    window.add_child(
        WebviewBuilder::new(REMOTE, WebviewUrl::External(url))
            .initialization_script(LINK_SCRIPT)
            .initialization_script(DESKTOP_SCRIPT)
            .initialization_script(NOTIFICATIONS_SCRIPT)
            .on_navigation(move |url| crate::links::allow_navigation(&navigation_app, url))
            .on_new_window(move |url, features| open_popup(&popup_app, url, features))
            .on_download(|_, _| true),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(width, height),
    )?;

    let footer = window.add_child(
        WebviewBuilder::new(STATUS, WebviewUrl::App("index.html".into()))
            .on_navigation(local_asset_url)
            .on_page_load(|_, _| {
                #[cfg(debug_assertions)]
                eprintln!("local status navigation observed");
            }),
        LogicalPosition::new(0.0, body),
        LogicalSize::new(width, FOOTER_HEIGHT),
    );
    if let Err(error) = footer {
        eprintln!("could not initialize local status: {error}");
        // The remote WebView is already mounted at full height, so the chat
        // remains usable even if this optional local interface fails.
        window.show()?;
        return Ok(());
    }
    resize(window)?;
    #[cfg(debug_assertions)]
    eprintln!("Messenger webviews mounted: {}", window.webviews().len());
    window.show()?;
    Ok(())
}

#[tauri::command]
pub fn show_credits(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    let url = webview.url().map_err(|_| "local URL unavailable")?;
    if webview.label() != STATUS || webview.window().label() != "main" || !local_asset_url(&url) {
        return Err("local status view required".into());
    }

    if let Some(window) = app.get_webview_window("credits") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "credits", WebviewUrl::App("index.html".into()))
        .on_navigation(local_asset_url)
        .title("About Messenger")
        .inner_size(440.0, 240.0)
        .min_inner_size(380.0, 220.0)
        .resizable(false)
        .center()
        .build()
        .map(|_| ())
        .map_err(|error| format!("could not open credits: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinct_child_labels_and_bounded_footer() {
        assert_ne!(REMOTE, STATUS);
        assert_eq!(FOOTER_HEIGHT, 36.0);
        assert_eq!((600.0_f64 - FOOTER_HEIGHT).max(1.0), 564.0);
        assert_eq!((20.0_f64 - FOOTER_HEIGHT).max(1.0), 1.0);
    }

    #[test]
    fn local_view_cannot_navigate_to_an_external_page() {
        for url in [
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/index.html",
            "tauri://localhost/index.html",
            "http://localhost:1420/",
        ] {
            assert_eq!(
                local_asset_url(&Url::parse(url).unwrap()),
                !url.starts_with("http://localhost") || cfg!(debug_assertions)
            );
        }
        for url in [
            "https://www.messenger.com/",
            "http://localhost:1421/",
            "http://127.0.0.1:4420/",
            "https://tauri.localhost.evil.example/",
            "javascript:alert(1)",
        ] {
            assert!(!local_asset_url(&Url::parse(url).unwrap()));
        }
    }
}
