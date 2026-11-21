use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
    Window,
};

use crate::{open_popup, DESKTOP_SCRIPT, LINK_SCRIPT, NOTIFICATIONS_SCRIPT};

pub const REMOTE: &str = "messenger";
pub const TITLEBAR: &str = "titlebar";
pub const STATUS: &str = "status";
const HEADER_HEIGHT: f64 = 40.0;
const FOOTER_HEIGHT: f64 = 36.0;

pub(crate) fn local_asset_url(url: &Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost" | "127.0.0.1")) => {
            cfg!(debug_assertions) && url.port() == Some(14871)
        }
        _ => false,
    }
}

/// True for a local UI webview allowed to call a status/settings command.
pub(crate) fn local_webview(webview: &tauri::Webview, labels: &[&str]) -> bool {
    let owner_ok = match webview.label() {
        STATUS => webview.window().label() == "main",
        _ => true,
    };
    owner_ok
        && labels.contains(&webview.label())
        && webview.url().is_ok_and(|url| local_asset_url(&url))
}

fn bounds(window: &Window) -> tauri::Result<(f64, f64)> {
    let physical = window.inner_size()?;
    let scale = window.scale_factor()?;
    Ok((
        f64::from(physical.width) / scale,
        f64::from(physical.height) / scale,
    ))
}

fn vertical_bounds(height: f64, has_titlebar: bool, has_footer: bool) -> (f64, f64) {
    let header = if has_titlebar { HEADER_HEIGHT } else { 0.0 };
    let footer = if has_footer { FOOTER_HEIGHT } else { 0.0 };
    (header, (height - footer).max(header + 1.0))
}

pub fn resize(window: &Window) -> tauri::Result<()> {
    let (width, height) = bounds(window)?;
    let views = window.webviews();
    let (header, body_bottom) = vertical_bounds(
        height,
        views.iter().any(|view| view.label() == TITLEBAR),
        views.iter().any(|view| view.label() == STATUS),
    );
    let body_height = body_bottom - header;
    for webview in window.webviews() {
        match webview.label() {
            REMOTE => {
                webview.set_position(LogicalPosition::new(0.0, header))?;
                webview.set_size(LogicalSize::new(width, body_height))?;
            }
            TITLEBAR => {
                webview.set_position(LogicalPosition::new(0.0, 0.0))?;
                webview.set_size(LogicalSize::new(width, HEADER_HEIGHT))?;
            }
            STATUS => {
                webview.set_position(LogicalPosition::new(0.0, body_bottom))?;
                webview.set_size(LogicalSize::new(width, (height - body_bottom).max(1.0)))?;
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn should_show_on_start(start_hidden: bool, tray_available: bool) -> bool {
    !start_hidden || !tray_available
}

pub fn mount(app: &AppHandle, window: &Window, start_hidden: bool) -> tauri::Result<()> {
    let (width, height) = bounds(window)?;
    let url = crate::site::current().start_url().clone();
    let navigation_app = app.clone();
    let popup_app = app.clone();

    window.add_child(
        WebviewBuilder::new(REMOTE, WebviewUrl::External(url))
            .initialization_script(crate::site::current().prelude())
            .initialization_script(LINK_SCRIPT)
            .initialization_script(DESKTOP_SCRIPT)
            .initialization_script(NOTIFICATIONS_SCRIPT)
            .on_navigation(move |url| crate::links::allow_navigation(&navigation_app, url))
            .on_new_window(move |url, features| open_popup(&popup_app, url, features))
            .on_download(crate::downloads::handler(app.clone())),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(width, height),
    )?;

    let header = window.add_child(
        WebviewBuilder::new(TITLEBAR, WebviewUrl::App("index.html?view=titlebar".into()))
            .on_navigation(local_asset_url),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(width, HEADER_HEIGHT),
    );
    if let Err(error) = header {
        eprintln!("could not initialize custom title bar: {error}");
        // Never leave a frameless window with no visible controls.
        window.set_decorations(true)?;
    }

    let footer = window.add_child(
        WebviewBuilder::new(STATUS, WebviewUrl::App("index.html?view=status".into()))
            .on_navigation(local_asset_url),
        LogicalPosition::new(0.0, (height - FOOTER_HEIGHT).max(1.0)),
        LogicalSize::new(width, FOOTER_HEIGHT),
    );
    if let Err(error) = footer {
        eprintln!("could not initialize local status: {error}");
        // The remote WebView remains usable if the optional footer fails.
        resize(window)?;
        if should_show_on_start(
            start_hidden,
            crate::desktop::TRAY_AVAILABLE.load(Ordering::Relaxed),
        ) {
            window.show()?;
        }
        return Ok(());
    }
    resize(window)?;
    #[cfg(debug_assertions)]
    eprintln!("Messenger webviews mounted: {}", window.webviews().len());
    if should_show_on_start(
        start_hidden,
        crate::desktop::TRAY_AVAILABLE.load(Ordering::Relaxed),
    ) {
        window.show()?;
    }
    Ok(())
}

static SETTINGS_OPENING: AtomicBool = AtomicBool::new(false);

struct SettingsOpening;

impl Drop for SettingsOpening {
    fn drop(&mut self) {
        SETTINGS_OPENING.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub fn show_settings(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    let url = webview.url().map_err(|_| "local URL unavailable")?;
    if webview.label() != STATUS || webview.window().label() != "main" || !local_asset_url(&url) {
        return Err("local status view required".into());
    }
    open_settings(&app);
    Ok(())
}

pub fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    // WebView2 window creation from a synchronous callback can block the
    // native event loop, so build it off the event thread.
    if SETTINGS_OPENING.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let _opening = SettingsOpening;
        if let Some(window) = app.get_webview_window("settings") {
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
        match tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            WebviewUrl::App("index.html?view=settings".into()),
        )
        .on_navigation(local_asset_url)
        .title("Messenger settings")
        .inner_size(480.0, 420.0)
        .min_inner_size(420.0, 360.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
        {
            Ok(window) => {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Err(error) => eprintln!("could not open settings: {error}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_start_needs_a_tray_to_stay_reachable() {
        assert!(should_show_on_start(false, false));
        assert!(should_show_on_start(false, true));
        assert!(should_show_on_start(true, false));
        assert!(!should_show_on_start(true, true));
    }

    #[test]
    fn distinct_child_labels_and_bounded_footer() {
        assert_ne!(REMOTE, STATUS);
        assert_ne!(TITLEBAR, STATUS);
        assert_ne!(REMOTE, TITLEBAR);
        assert_eq!(HEADER_HEIGHT, 40.0);
        assert_eq!(FOOTER_HEIGHT, 36.0);
        assert_eq!(600.0 - HEADER_HEIGHT - FOOTER_HEIGHT, 524.0);
        assert_eq!((20.0_f64 - FOOTER_HEIGHT).max(1.0), 1.0);
        assert_eq!(vertical_bounds(600.0, true, true), (40.0, 564.0));
        assert_eq!(vertical_bounds(600.0, false, true), (0.0, 564.0));
        assert_eq!(vertical_bounds(600.0, true, false), (40.0, 600.0));
        assert_eq!(vertical_bounds(600.0, false, false), (0.0, 600.0));
    }

    #[test]
    fn local_view_cannot_navigate_to_an_external_page() {
        for url in [
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/index.html",
            "tauri://localhost/index.html",
            "http://localhost:14871/",
        ] {
            assert_eq!(
                local_asset_url(&Url::parse(url).unwrap()),
                !url.starts_with("http://localhost") || cfg!(debug_assertions)
            );
        }
        for url in [
            "https://www.messenger.com/",
            "http://localhost:1420/",
            "http://127.0.0.1:4420/",
            "https://tauri.localhost.evil.example/",
            "javascript:alert(1)",
        ] {
            assert!(!local_asset_url(&Url::parse(url).unwrap()));
        }
    }
}
