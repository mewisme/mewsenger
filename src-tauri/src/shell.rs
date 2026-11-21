use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize,
    Manager, Url, WebviewUrl, Window,
};

use crate::accounts::{self, Config};
use crate::open_popup;

const HEADER_HEIGHT: f64 = 40.0;
const MIN_HEIGHT: f64 = 600.0;
const MIN_WIDTH: f64 = 800.0;
const SETTINGS: &str = "settings";
/// Far enough left that a page placed there is not visible in any window.
const OFFSCREEN_X: f64 = -30000.0;
const MENU_WIDTH: f64 = 260.0;
const MENU_ROW: f64 = 32.0;
const MENU_PADDING: f64 = 4.0;
const MENU_SEPARATOR: f64 = 9.0;

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

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LocalKind {
    Settings,
    Titlebar,
    TabMenu,
}

pub(crate) fn local_kind(label: &str) -> Option<LocalKind> {
    match label {
        SETTINGS => Some(LocalKind::Settings),
        accounts::TAB_MENU => Some(LocalKind::TabMenu),
        _ => {
            accounts::account_of(label)?;
            if label.starts_with("titlebar-") {
                Some(LocalKind::Titlebar)
            } else {
                None
            }
        }
    }
}

/// Window that may host a local view: everything but Settings lives in `main`.
fn owner_ok(label: &str, window_label: &str) -> bool {
    match local_kind(label) {
        Some(LocalKind::Titlebar | LocalKind::TabMenu) => window_label == "main",
        Some(LocalKind::Settings) => true,
        None => false,
    }
}

/// True for a local UI webview of one of `kinds` allowed to call a command.
pub(crate) fn local_webview(webview: &tauri::Webview, kinds: &[LocalKind]) -> bool {
    local_kind(webview.label()).is_some_and(|kind| kinds.contains(&kind))
        && owner_ok(webview.label(), webview.window().label())
        && webview.url().is_ok_and(|url| local_asset_url(&url))
}

/// Sends an event to the title bar, which hosts the settings, update and
/// download controls.
pub(crate) fn emit_chrome<R: tauri::Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    let _ = app.emit_filter(
        event,
        payload,
        |target| matches!(target, EventTarget::Webview { label } if label.starts_with("titlebar-")),
    );
}

fn bounds(window: &Window) -> tauri::Result<(f64, f64)> {
    let physical = window.inner_size()?;
    let scale = window.scale_factor()?;
    Ok((
        f64::from(physical.width) / scale,
        f64::from(physical.height) / scale,
    ))
}

/// Top and bottom of the page area: everything below the title bar.
fn vertical_bounds(height: f64, has_titlebar: bool) -> (f64, f64) {
    let header = if has_titlebar { HEADER_HEIGHT } else { 0.0 };
    (header, height.max(header + 1.0))
}

fn is_remote(label: &str) -> bool {
    label.starts_with("messenger-") && accounts::account_of(label).is_some()
}

/// Lays the main window's views out: the shown account's page fills the body,
/// the other open pages wait off screen so they keep running.
pub fn resize(window: &Window) -> tauri::Result<()> {
    if window.label() != "main" {
        return Ok(());
    }
    let (width, height) = bounds(window)?;
    let views = window.webviews();
    let (header, body_bottom) = vertical_bounds(
        height,
        views
            .iter()
            .any(|v| local_kind(v.label()) == Some(LocalKind::Titlebar)),
    );
    let body_height = body_bottom - header;
    let shown = accounts::remote_label(&accounts::snapshot(&window.app_handle().clone()).active);
    if let Some(menu) = tab_menu(window) {
        // The dropdown is anchored to the old size.
        let _ = menu.close();
    }
    for webview in views {
        let label = webview.label();
        if is_remote(label) {
            let x = if label == shown { 0.0 } else { OFFSCREEN_X };
            webview.set_position(LogicalPosition::new(x, header))?;
            webview.set_size(LogicalSize::new(width, body_height))?;
            continue;
        }
        match local_kind(label) {
            Some(LocalKind::Titlebar) => {
                webview.set_position(LogicalPosition::new(0.0, 0.0))?;
                webview.set_size(LogicalSize::new(width, HEADER_HEIGHT))?;
            }
            Some(LocalKind::Settings) => {
                webview.set_position(LogicalPosition::new(0.0, header))?;
                webview.set_size(LogicalSize::new(width, body_height))?;
            }
            Some(LocalKind::TabMenu) | None => {}
        }
    }
    Ok(())
}

/// Asks WebView2 to trim memory of pages that are not shown. The page keeps
/// running, so its notifications still arrive.
#[cfg(windows)]
fn set_memory_target(webview: &tauri::Webview, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let level = if low {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    let _ = webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
fn set_memory_target(_webview: &tauri::Webview, _low: bool) {}

pub fn should_show_on_start(start_hidden: bool, tray_available: bool) -> bool {
    !start_hidden || !tray_available
}

/// Facebook leaves a 1px absolutely positioned helper at the bottom edge of
/// the page, so the document scrolls by one pixel and WebView2 draws a full
/// scrollbar down the right side. Document scrolling stays; only its bar is
/// hidden (the app scrolls inside its own containers).
const PAGE_STYLE_SCRIPT: &str = "(() => {\
const add = () => {\
  if (!document.documentElement) return false;\
  const style = document.createElement('style');\
  style.textContent = 'html{scrollbar-width:none}';\
  (document.head || document.documentElement).appendChild(style);\
  return true;\
};\
if (!add()) {\
  new MutationObserver((_, observer) => { if (add()) observer.disconnect(); })\
    .observe(document, { childList: true });\
}\
})();";

fn remote_builder(app: &AppHandle, account: &str) -> WebviewBuilder<tauri::Wry> {
    let url = crate::site::current().start_url().clone();
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let page_app = app.clone();
    let builder = WebviewBuilder::new(accounts::remote_label(account), WebviewUrl::External(url))
        .initialization_script(crate::site::current().prelude())
        .initialization_script(crate::prefs::page_script(&crate::prefs::current(app)))
        .initialization_script(crate::INJECT_SCRIPT)
        // The creation-time choices go stale once a setting changes; a reload
        // runs that script again, so hand the page the current ones.
        .on_page_load(move |webview, _| {
            let _ = webview.eval(crate::prefs::page_script(&crate::prefs::current(&page_app)));
        })
        .initialization_script(PAGE_STYLE_SCRIPT)
        .on_navigation(move |url| crate::links::allow_navigation(&navigation_app, url))
        .on_new_window(move |url, features| open_popup(&popup_app, url, features))
        .on_download(crate::downloads::handler(app.clone()));
    match accounts::data_directory(app, account) {
        Some(directory) => builder.data_directory(directory),
        None => builder,
    }
}

fn local_builder(label: String, query: &str) -> WebviewBuilder<tauri::Wry> {
    WebviewBuilder::new(label, WebviewUrl::App(format!("index.html?{query}").into()))
        .on_navigation(local_asset_url)
}

fn add_titlebar(window: &Window, config: &Config, width: f64) -> tauri::Result<()> {
    let all = config.accounts.iter().collect::<Vec<_>>();
    let query = format!(
        "view=titlebar&accounts={}&open={}&active={}",
        accounts::accounts_param(&all),
        config.open.join(","),
        config.shown_account()
    );
    let header = window.add_child(
        local_builder(accounts::titlebar_label(accounts::FIRST), &query),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(width, HEADER_HEIGHT),
    );
    if let Err(error) = header {
        eprintln!("could not initialize custom title bar: {error}");
        // Never leave a frameless window with no visible controls.
        window.set_decorations(true)?;
    }
    Ok(())
}

/// Title bar of the main window.
fn mount_chrome(window: &Window, config: &Config, show: bool) -> tauri::Result<()> {
    window.set_min_size(Some(LogicalSize::new(MIN_WIDTH, MIN_HEIGHT)))?;
    let (width, _) = bounds(window)?;
    add_titlebar(window, config, width)?;
    resize(window)?;
    if show {
        window.show()?;
    }
    Ok(())
}

static TABS_LOCK: Mutex<()> = Mutex::new(());

fn wait_until(mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !done() {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    true
}

/// Makes the main window's pages match the stored open tabs: closes pages of
/// closed tabs, creates pages of new ones and shows the active one.
fn reconcile(app: &AppHandle) -> tauri::Result<()> {
    let config = accounts::snapshot(app);
    let main = app.get_window("main").ok_or(tauri::Error::WindowNotFound)?;
    close_tab_menu_now(&main);
    let stale = main
        .webviews()
        .into_iter()
        .filter(|v| {
            is_remote(v.label())
                && accounts::account_of(v.label()).is_some_and(|id| !config.is_open(id))
        })
        .collect::<Vec<_>>();
    for webview in &stale {
        webview.close()?;
    }
    if !wait_until(|| stale.iter().all(|v| main.get_webview(v.label()).is_none())) {
        eprintln!("closed tabs are still shutting down");
    }
    let missing = config
        .open
        .iter()
        .filter(|id| main.get_webview(&accounts::remote_label(id)).is_none())
        .collect::<Vec<_>>();
    forget_low(&missing);
    // Pages added later sit above older views, so Settings drawn over the
    // page is rebuilt on top of them.
    let overlay = !missing.is_empty() && settings_overlay(&main).is_some();
    if overlay {
        if let Some(view) = settings_overlay(&main) {
            view.close()?;
        }
        wait_until(|| settings_overlay(&main).is_none());
    }
    let (width, height) = bounds(&main)?;
    let (header, body_bottom) = vertical_bounds(height, true);
    for id in missing {
        main.add_child(
            remote_builder(app, id),
            LogicalPosition::new(OFFSCREEN_X, header),
            LogicalSize::new(width, body_bottom - header),
        )?;
    }
    if overlay {
        add_settings_overlay(&main)?;
    }
    resize(&main)?;
    if settings_overlay(&main).is_none() {
        if let Some(webview) = app.get_webview(&accounts::remote_label(config.shown_account())) {
            let _ = webview.set_focus();
        }
    }
    apply_memory_levels(app);
    Ok(())
}

/// Brings the pages in line with the open tabs on a worker (WebView2 creation
/// must not block the event loop), then runs `after`.
pub fn sync_tabs(app: &AppHandle, after: impl FnOnce() + Send + 'static) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _serial = TABS_LOCK.lock();
        if let Err(error) = reconcile(&app) {
            eprintln!("could not update Messenger tabs: {error}");
        }
        after();
    });
}

/// A tab unused this long (or the whole window, when minimized or in the
/// background) is asked to give memory back. Pages keep running.
const TRIM_AFTER: Duration = Duration::from_secs(5 * 60);
const TRIM_CHECK_EVERY: Duration = Duration::from_secs(5);

#[derive(Default)]
struct TrimState {
    /// When each tab was last the shown one.
    last_shown: HashMap<String, Instant>,
    /// Since when the main window is minimized, hidden or not focused.
    inactive_since: Option<Instant>,
    /// Tabs currently at the low memory target.
    low: HashSet<String>,
}

static TRIM: Mutex<Option<TrimState>> = Mutex::new(None);

/// Tabs that should be at the low memory target: background tabs unused for
/// `after`, or every tab once the window has been idle for `after`.
fn low_memory_tabs(
    open: &[String],
    shown: &str,
    last_shown: &mut HashMap<String, Instant>,
    window_idle: Option<Duration>,
    now: Instant,
    after: Duration,
) -> HashSet<String> {
    last_shown.insert(shown.to_string(), now);
    if window_idle.is_some_and(|idle| idle >= after) {
        return open.iter().cloned().collect();
    }
    open.iter()
        .filter(|id| id.as_str() != shown)
        .filter(|id| now.duration_since(*last_shown.entry((*id).clone()).or_insert(now)) >= after)
        .cloned()
        .collect()
}

/// Moves tabs between the normal and low memory target as their situation
/// changed since the last call.
fn apply_memory_levels(app: &AppHandle) {
    let config = accounts::snapshot(app);
    let enabled = crate::prefs::current(app).trim_idle_memory;
    let window_inactive = app.get_window("main").is_some_and(|main| {
        !main.is_visible().unwrap_or(true)
            || main.is_minimized().unwrap_or(false)
            || !main.is_focused().unwrap_or(true)
    });
    let now = Instant::now();
    let (to_low, to_normal) = {
        let mut guard = TRIM.lock().unwrap_or_else(|e| e.into_inner());
        let state = guard.get_or_insert_with(TrimState::default);
        state.last_shown.retain(|id, _| config.is_open(id));
        match (window_inactive, state.inactive_since) {
            (true, None) => state.inactive_since = Some(now),
            (false, _) => state.inactive_since = None,
            _ => {}
        }
        let wanted = if enabled {
            low_memory_tabs(
                &config.open,
                config.shown_account(),
                &mut state.last_shown,
                state.inactive_since.map(|since| now.duration_since(since)),
                now,
                TRIM_AFTER,
            )
        } else {
            HashSet::new()
        };
        let to_low = wanted.difference(&state.low).cloned().collect::<Vec<_>>();
        let to_normal = state.low.difference(&wanted).cloned().collect::<Vec<_>>();
        state.low = wanted;
        (to_low, to_normal)
    };
    for (ids, low) in [(to_low, true), (to_normal, false)] {
        for id in ids {
            if let Some(webview) = app.get_webview(&accounts::remote_label(&id)) {
                set_memory_target(&webview, low);
            }
        }
    }
}

/// A page created after the last check starts at the normal target.
fn forget_low(ids: &[&String]) {
    let mut guard = TRIM.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(state) = guard.as_mut() {
        for id in ids {
            state.low.remove(id.as_str());
        }
    }
}

fn start_memory_trimmer(app: &AppHandle) {
    static STARTED: std::sync::Once = std::sync::Once::new();
    let app = app.clone();
    STARTED.call_once(move || {
        std::thread::spawn(move || loop {
            std::thread::sleep(TRIM_CHECK_EVERY);
            apply_memory_levels(&app);
        });
    });
}

/// Creates the title bar, footer and open tabs. Runs on a worker.
pub fn apply_layout(app: &AppHandle, show_main: bool) {
    start_memory_trimmer(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let _serial = TABS_LOCK.lock();
        let config = accounts::snapshot(&app);
        let result = app
            .get_window("main")
            .ok_or(tauri::Error::WindowNotFound)
            .and_then(|main| mount_chrome(&main, &config, show_main))
            .and_then(|()| reconcile(&app));
        if let Err(error) = result {
            eprintln!("could not initialize Messenger views: {error}");
            if let Some(window) = app.get_window("main") {
                let _ = window.set_decorations(true);
                let _ = window.show();
            }
        }
    });
}

fn tab_menu(window: &Window) -> Option<tauri::Webview> {
    window
        .webviews()
        .into_iter()
        .find(|v| v.label() == accounts::TAB_MENU)
}

fn close_tab_menu_now(window: &Window) {
    if let Some(menu) = tab_menu(window) {
        let _ = menu.close();
    }
}

fn tab_menu_height(closed_accounts: usize) -> f64 {
    let separator = if closed_accounts > 0 {
        MENU_SEPARATOR
    } else {
        0.0
    };
    2.0 * MENU_PADDING + (closed_accounts as f64 + 1.0) * MENU_ROW + separator
}

static MENU_CLOSED_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// A click on "+" that dismissed the open dropdown also reaches the button;
/// it must not reopen the dropdown at once.
const MENU_REOPEN_GUARD: Duration = Duration::from_millis(300);

pub fn close_tab_menu(app: &AppHandle) {
    if let Ok(mut closed) = MENU_CLOSED_AT.lock() {
        *closed = Some(Instant::now());
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(main) = app.get_window("main") {
            close_tab_menu_now(&main);
        }
    });
}

/// Opens the account dropdown under the "+" button at `x`, or closes it.
pub fn toggle_tab_menu(app: &AppHandle, x: f64) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(main) = app.get_window("main") else {
            return;
        };
        if tab_menu(&main).is_some() {
            close_tab_menu_now(&main);
            return;
        }
        let recently_closed = MENU_CLOSED_AT
            .lock()
            .ok()
            .and_then(|closed| *closed)
            .is_some_and(|at| at.elapsed() < MENU_REOPEN_GUARD);
        if recently_closed {
            return;
        }
        let config = accounts::snapshot(&app);
        let closed = config.closed();
        let query = format!(
            "view=tabmenu&accounts={}&next={}",
            accounts::accounts_param(&closed),
            config.next_id
        );
        let result = bounds(&main).and_then(|(width, _)| {
            let left = x.clamp(0.0, (width - MENU_WIDTH).max(0.0));
            main.add_child(
                // Transparent, so the part of the view the menu card does not
                // fill (and its shadow) shows the page beneath instead of black.
                local_builder(accounts::TAB_MENU.to_string(), &query).transparent(true),
                LogicalPosition::new(left, HEADER_HEIGHT),
                LogicalSize::new(MENU_WIDTH, tab_menu_height(closed.len())),
            )
        });
        match result {
            Ok(menu) => {
                let _ = menu.set_focus();
            }
            Err(error) => eprintln!("could not open the account menu: {error}"),
        }
    });
}

static SETTINGS_OPENING: AtomicBool = AtomicBool::new(false);

struct SettingsOpening;

impl Drop for SettingsOpening {
    fn drop(&mut self) {
        SETTINGS_OPENING.store(false, Ordering::Release);
    }
}

/// Settings drawn over `window`, if any. Looked up among the window's own
/// views: the app-wide label lookup would also find a settings window.
fn settings_overlay(window: &Window) -> Option<tauri::Webview> {
    window
        .webviews()
        .into_iter()
        .find(|v| v.label() == SETTINGS)
}

/// The separate settings window, if open.
fn settings_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_window(SETTINGS)?;
    app.get_webview_window(SETTINGS)
}

#[tauri::command]
pub fn show_settings(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    if !local_webview(&webview, &[LocalKind::Titlebar]) {
        return Err("title bar required".into());
    }
    open_settings(&app);
    Ok(())
}

pub fn open_settings(app: &AppHandle) {
    if accounts::snapshot(app).settings == accounts::SettingsPlacement::Overlay {
        open_settings_overlay(app);
    } else {
        open_settings_window(app);
    }
}

fn focus_window(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Settings in its own window.
fn open_settings_window(app: &AppHandle) {
    if let Some(window) = settings_window(app) {
        focus_window(&window);
        return;
    }
    if let Some(overlay) = app.get_window("main").as_ref().and_then(settings_overlay) {
        let _ = overlay.set_focus();
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
        if let Some(window) = settings_window(&app) {
            focus_window(&window);
            return;
        }
        match tauri::WebviewWindowBuilder::new(
            &app,
            SETTINGS,
            WebviewUrl::App("index.html?view=settings".into()),
        )
        .on_navigation(local_asset_url)
        .title("Messenger settings")
        .inner_size(480.0, 620.0)
        .min_inner_size(420.0, 360.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
        {
            Ok(window) => focus_window(&window),
            Err(error) => eprintln!("could not open settings: {error}"),
        }
    });
}

/// Settings drawn over the main window's page, between title bar and footer.
fn add_settings_overlay(window: &Window) -> tauri::Result<()> {
    let (width, height) = bounds(window)?;
    window.add_child(
        local_builder(SETTINGS.to_string(), "view=settings&overlay=1"),
        LogicalPosition::new(0.0, HEADER_HEIGHT),
        LogicalSize::new(width, (height - HEADER_HEIGHT).max(1.0)),
    )?;
    resize(window)
}

fn open_settings_overlay(app: &AppHandle) {
    if let Some(window) = settings_window(app) {
        focus_window(&window);
        return;
    }
    crate::desktop::show_main(app);
    let Some(main) = app.get_window("main") else {
        return;
    };
    if let Some(overlay) = settings_overlay(&main) {
        let _ = overlay.set_focus();
        return;
    }
    if SETTINGS_OPENING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || {
        let _opening = SettingsOpening;
        if settings_overlay(&main).is_none() {
            if let Err(error) = add_settings_overlay(&main) {
                eprintln!("could not open settings: {error}");
            }
        }
    });
}

/// Closes Settings, whichever way it is open.
pub fn close_settings(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(overlay) = app.get_window("main").as_ref().and_then(settings_overlay) {
            let _ = overlay.close();
        } else if let Some(window) = settings_window(&app) {
            let _ = window.close();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_idle_background_tabs_but_never_a_lone_shown_tab() {
        let open = ["a1", "a2", "a3"].map(String::from).to_vec();
        let start = Instant::now();
        let after = Duration::from_secs(300);
        let mut last = HashMap::new();
        assert!(low_memory_tabs(&open, "a1", &mut last, None, start, after).is_empty());
        // a2 was shown again at 200s, so only a3 has been idle for 300s.
        last.insert("a2".to_string(), start + Duration::from_secs(200));
        let later = start + Duration::from_secs(300);
        let low = low_memory_tabs(&open, "a1", &mut last, None, later, after);
        assert_eq!(low, HashSet::from(["a3".to_string()]));
        // One tab: nothing to trim while the window is in use.
        let one = ["a1".to_string()];
        let far = start + Duration::from_secs(900);
        assert!(low_memory_tabs(&one, "a1", &mut last, None, far, after).is_empty());
    }

    #[test]
    fn an_idle_window_trims_every_tab_including_the_shown_one() {
        let open = ["a1", "a2"].map(String::from).to_vec();
        let now = Instant::now();
        let after = Duration::from_secs(300);
        let mut last = HashMap::new();
        let short = Some(Duration::from_secs(299));
        assert!(low_memory_tabs(&open, "a1", &mut last, short, now, after).is_empty());
        let long = Some(Duration::from_secs(300));
        assert_eq!(low_memory_tabs(&open, "a1", &mut last, long, now, after).len(), 2);
    }

    #[test]
    fn hidden_start_needs_a_tray_to_stay_reachable() {
        assert!(should_show_on_start(false, false));
        assert!(should_show_on_start(false, true));
        assert!(should_show_on_start(true, false));
        assert!(!should_show_on_start(true, true));
    }

    #[test]
    fn bounded_header_and_footer() {
        assert_eq!(HEADER_HEIGHT, 40.0);
        assert_eq!(vertical_bounds(600.0, true), (40.0, 600.0));
        assert_eq!(vertical_bounds(600.0, false), (0.0, 600.0));
        assert_eq!(vertical_bounds(10.0, true), (40.0, 41.0));
    }

    #[test]
    fn local_kinds_come_from_the_label_alone() {
        assert_eq!(local_kind("titlebar-a1"), Some(LocalKind::Titlebar));
        assert_eq!(local_kind("settings"), Some(LocalKind::Settings));
        assert_eq!(local_kind("tabmenu"), Some(LocalKind::TabMenu));
        for other in [
            "status-a1",
            "titlebar",
            "messenger-a1",
            "split",
            "main",
            "popup-1",
            "",
        ] {
            assert_eq!(local_kind(other), None, "{other}");
        }
    }

    #[test]
    fn local_views_only_work_inside_the_main_window() {
        assert!(owner_ok("titlebar-a1", "main"));
        assert!(owner_ok("tabmenu", "main"));
        assert!(!owner_ok("tabmenu", "settings"));
        assert!(!owner_ok("titlebar-a1", "popup-1"));
        assert!(owner_ok("settings", "settings"));
        assert!(owner_ok("settings", "main"));
        assert!(!owner_ok("messenger-a1", "main"));
    }

    #[test]
    fn the_dropdown_has_a_row_per_closed_account_plus_the_sign_in_row() {
        assert_eq!(tab_menu_height(0), 8.0 + 32.0);
        assert_eq!(tab_menu_height(2), 8.0 + 3.0 * 32.0 + 9.0);
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
