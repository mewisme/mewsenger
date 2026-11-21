use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize,
    Manager, Url, WebviewUrl, Window, WindowBuilder,
};

use crate::accounts::{self, Account, Config};
use crate::{open_popup, DESKTOP_SCRIPT, LINK_SCRIPT, NOTIFICATIONS_SCRIPT};

const HEADER_HEIGHT: f64 = 40.0;
const FOOTER_HEIGHT: f64 = 36.0;
/// Narrowest a pane may get; dragging the divider stops here.
pub const PANE_MIN: f64 = 480.0;
/// Width of the divider strip between panes, drawn by the split view.
pub const HANDLE: f64 = 6.0;
const MIN_HEIGHT: f64 = 600.0;
const MIN_WIDTH: f64 = 800.0;
const SPLIT_MIN_WIDTH: f64 = 2.0 * PANE_MIN + HANDLE;

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
    Status,
    Settings,
    Titlebar,
    Split,
}

pub(crate) fn local_kind(label: &str) -> Option<LocalKind> {
    match label {
        "settings" => Some(LocalKind::Settings),
        accounts::SPLIT => Some(LocalKind::Split),
        _ => {
            accounts::account_of(label)?;
            if label.starts_with("status-") {
                Some(LocalKind::Status)
            } else if label.starts_with("titlebar-") {
                Some(LocalKind::Titlebar)
            } else {
                None
            }
        }
    }
}

/// Window that may host a local view: status and titlebar belong to their
/// account's window (or `main` in split layout), the split view to `main`.
fn owner_ok(label: &str, window_label: &str) -> bool {
    match local_kind(label) {
        Some(LocalKind::Status | LocalKind::Titlebar) => accounts::account_of(label)
            .is_some_and(|id| window_label == "main" || window_label == accounts::window_label(id)),
        Some(LocalKind::Split) => window_label == "main",
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

/// Sends an event to every status webview.
pub(crate) fn emit_status<R: tauri::Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    let _ = app.emit_filter(
        event,
        payload,
        |target| matches!(target, EventTarget::Webview { label } if label.starts_with("status-")),
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

fn vertical_bounds(height: f64, has_titlebar: bool, has_footer: bool) -> (f64, f64) {
    let header = if has_titlebar { HEADER_HEIGHT } else { 0.0 };
    let footer = if has_footer { FOOTER_HEIGHT } else { 0.0 };
    (header, (height - footer).max(header + 1.0))
}

/// Horizontal `(x, width)` of each pane. Two panes split `width` minus the
/// divider by `ratio`, never narrower than [`PANE_MIN`].
pub fn split_rects(width: f64, ratio: f64, panes: usize) -> Vec<(f64, f64)> {
    match panes {
        0 => Vec::new(),
        1 => vec![(0.0, width)],
        2 => {
            if width < SPLIT_MIN_WIDTH {
                return vec![(0.0, PANE_MIN), (PANE_MIN + HANDLE, PANE_MIN)];
            }
            let left = ((width - HANDLE) * ratio).clamp(PANE_MIN, width - HANDLE - PANE_MIN);
            vec![(0.0, left), (left + HANDLE, width - HANDLE - left)]
        }
        n => {
            let each = (width - HANDLE * (n as f64 - 1.0)) / n as f64;
            (0..n).map(|i| (i as f64 * (each + HANDLE), each)).collect()
        }
    }
}

const SETTINGS: &str = "settings";
/// Far enough left that a page placed there is not visible in any window.
const OFFSCREEN_X: f64 = -30000.0;

fn is_account_window(label: &str) -> bool {
    label == "main" || label.starts_with("acct-")
}

fn is_remote(label: &str) -> bool {
    label.starts_with("messenger-") && accounts::account_of(label).is_some()
}

pub fn resize(window: &Window) -> tauri::Result<()> {
    if !is_account_window(window.label()) {
        return Ok(());
    }
    let (width, height) = bounds(window)?;
    let views = window.webviews();
    let kind_of = |label: &str| local_kind(label);
    let (header, body_bottom) = vertical_bounds(
        height,
        views
            .iter()
            .any(|v| kind_of(v.label()) == Some(LocalKind::Titlebar)),
        views
            .iter()
            .any(|v| kind_of(v.label()) == Some(LocalKind::Status)),
    );
    let body_height = body_bottom - header;
    let split = views.iter().any(|v| v.label() == accounts::SPLIT);
    let config = accounts::snapshot(&window.app_handle().clone());
    let switching = window.label() == "main" && config.is_switch();
    if split && width + 0.5 < SPLIT_MIN_WIDTH {
        // The OS minimum can come out narrower than asked for on a frameless
        // window. Snap back; the resulting resize event lays the views out.
        return window.set_size(LogicalSize::new(SPLIT_MIN_WIDTH, height));
    }
    if split {
        let remotes = config
            .accounts
            .iter()
            .filter_map(|a| window.get_webview(&accounts::remote_label(&a.id)))
            .collect::<Vec<_>>();
        let rects = split_rects(width, config.split_ratio, remotes.len());
        for (webview, (x, pane_width)) in remotes.iter().zip(rects) {
            webview.set_position(LogicalPosition::new(x, header))?;
            webview.set_size(LogicalSize::new(pane_width, body_height))?;
        }
    }
    for webview in views {
        let label = webview.label();
        if is_remote(label) {
            if switching {
                let shown = label == accounts::remote_label(config.shown_account());
                let x = if shown { 0.0 } else { OFFSCREEN_X };
                webview.set_position(LogicalPosition::new(x, header))?;
                webview.set_size(LogicalSize::new(width, body_height))?;
            } else if !split {
                webview.set_position(LogicalPosition::new(0.0, header))?;
                webview.set_size(LogicalSize::new(width, body_height))?;
            }
            continue;
        }
        match kind_of(label) {
            Some(LocalKind::Titlebar) => {
                webview.set_position(LogicalPosition::new(0.0, 0.0))?;
                webview.set_size(LogicalSize::new(width, HEADER_HEIGHT))?;
            }
            Some(LocalKind::Status) => {
                webview.set_position(LogicalPosition::new(0.0, body_bottom))?;
                webview.set_size(LogicalSize::new(width, (height - body_bottom).max(1.0)))?;
            }
            Some(LocalKind::Split | LocalKind::Settings) => {
                webview.set_position(LogicalPosition::new(0.0, header))?;
                webview.set_size(LogicalSize::new(width, body_height))?;
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn should_show_on_start(start_hidden: bool, tray_available: bool) -> bool {
    !start_hidden || !tray_available
}

fn remote_builder(app: &AppHandle, account: &str) -> WebviewBuilder<tauri::Wry> {
    let url = crate::site::current().start_url().clone();
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewBuilder::new(accounts::remote_label(account), WebviewUrl::External(url))
        .initialization_script(crate::site::current().prelude())
        .initialization_script(LINK_SCRIPT)
        .initialization_script(DESKTOP_SCRIPT)
        .initialization_script(NOTIFICATIONS_SCRIPT)
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

fn add_titlebar(
    window: &Window,
    account: &str,
    width: f64,
    tabs: Option<&Config>,
) -> tauri::Result<()> {
    let query = match tabs {
        Some(config) => {
            let all = config.accounts.iter().collect::<Vec<_>>();
            format!(
                "view=titlebar&accounts={}&active={}",
                accounts::accounts_param(&all),
                config.shown_account()
            )
        }
        None => "view=titlebar".to_string(),
    };
    let header = window.add_child(
        local_builder(accounts::titlebar_label(account), &query),
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

fn add_status(window: &Window, account: &str, width: f64, height: f64) -> tauri::Result<()> {
    let query = "view=status";
    let footer = window.add_child(
        local_builder(accounts::status_label(account), &query),
        LogicalPosition::new(0.0, (height - FOOTER_HEIGHT).max(1.0)),
        LogicalSize::new(width, FOOTER_HEIGHT),
    );
    if let Err(error) = footer {
        // The remote WebView stays usable if the optional footer fails.
        eprintln!("could not initialize local status: {error}");
    }
    Ok(())
}

/// One account in its own window: page, title bar and status footer.
fn mount_account(
    app: &AppHandle,
    window: &Window,
    account: &Account,
    show: bool,
) -> tauri::Result<()> {
    let (width, height) = bounds(window)?;
    window.add_child(
        remote_builder(app, &account.id),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(width, height),
    )?;
    add_titlebar(window, &account.id, width, None)?;
    add_status(window, &account.id, width, height)?;
    resize(window)?;
    #[cfg(debug_assertions)]
    eprintln!("Messenger webviews mounted: {}", window.webviews().len());
    if show {
        window.show()?;
    }
    Ok(())
}

/// All accounts as panes of the main window, with a shell view below the
/// panes that draws the draggable divider.
fn mount_split(app: &AppHandle, window: &Window, config: &Config, show: bool) -> tauri::Result<()> {
    window.set_min_size(Some(LogicalSize::new(SPLIT_MIN_WIDTH, MIN_HEIGHT)))?;
    let (width, height) = bounds(window)?;
    let (width, height) = if width < SPLIT_MIN_WIDTH {
        window.set_size(LogicalSize::new(SPLIT_MIN_WIDTH, height))?;
        bounds(window)?
    } else {
        (width, height)
    };
    add_titlebar(window, accounts::FIRST, width, None)?;
    let ids = config
        .accounts
        .iter()
        .map(|a| a.id.as_str())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!("view=split&ratio={}&accounts={ids}", config.split_ratio);
    window.add_child(
        local_builder(accounts::SPLIT.to_string(), &query),
        LogicalPosition::new(0.0, HEADER_HEIGHT),
        LogicalSize::new(width, height - HEADER_HEIGHT - FOOTER_HEIGHT),
    )?;
    for account in &config.accounts {
        window.add_child(
            remote_builder(app, &account.id),
            LogicalPosition::new(0.0, HEADER_HEIGHT),
            LogicalSize::new(PANE_MIN, height - HEADER_HEIGHT - FOOTER_HEIGHT),
        )?;
    }
    add_status(window, accounts::FIRST, width, height)?;
    resize(window)?;
    if show {
        window.show()?;
    }
    Ok(())
}

/// One window holding every account's page; the title bar tabs pick which
/// one is on screen. The others stay mounted off screen so their pages keep
/// running and can still raise notifications.
fn mount_switch(
    app: &AppHandle,
    window: &Window,
    config: &Config,
    show: bool,
) -> tauri::Result<()> {
    window.set_min_size(Some(LogicalSize::new(MIN_WIDTH, MIN_HEIGHT)))?;
    let (width, height) = bounds(window)?;
    add_titlebar(window, accounts::FIRST, width, Some(config))?;
    for account in &config.accounts {
        window.add_child(
            remote_builder(app, &account.id),
            LogicalPosition::new(0.0, HEADER_HEIGHT),
            LogicalSize::new(width, height - HEADER_HEIGHT - FOOTER_HEIGHT),
        )?;
    }
    add_status(window, accounts::FIRST, width, height)?;
    resize(window)?;
    if show {
        window.show()?;
    }
    Ok(())
}

static LAYOUT_LOCK: Mutex<()> = Mutex::new(());

fn remaining_views(app: &AppHandle) -> usize {
    let main = app
        .get_window("main")
        .map_or(0, |window| window.webviews().len());
    let others = app
        .windows()
        .keys()
        .filter(|label| label.starts_with("acct-"))
        .count();
    main + others
}

fn rebuild(app: &AppHandle, show_main: Option<bool>) -> tauri::Result<()> {
    let config = accounts::snapshot(app);
    let main = app
        .get_window("main")
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    let reopen = app
        .windows()
        .into_iter()
        .filter(|(label, window)| {
            label.starts_with("acct-") && window.is_visible().unwrap_or(false)
        })
        .map(|(label, _)| label)
        .collect::<Vec<_>>();
    for (label, window) in app.windows() {
        if label.starts_with("acct-") {
            window.destroy()?;
        }
    }
    let overlay_open = settings_overlay(&main).is_some();
    for webview in main.webviews() {
        webview.close()?;
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while remaining_views(app) > 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    if remaining_views(app) > 0 {
        eprintln!("previous views are still closing; mounting anyway");
    }

    let show_main = show_main.unwrap_or_else(|| main.is_visible().unwrap_or(true));
    if config.is_split() {
        mount_split(app, &main, &config, show_main)?;
    } else if config.is_switch() {
        mount_switch(app, &main, &config, show_main)?;
    } else {
        main.set_min_size(Some(LogicalSize::new(MIN_WIDTH, MIN_HEIGHT)))?;
        let first = &config.accounts[0];
        mount_account(app, &main, first, show_main)?;
        let mut windows = vec![main.clone()];
        for account in config.accounts.iter().skip(1) {
            let label = accounts::window_label(&account.id);
            let window = WindowBuilder::new(app, &label)
                .title(format!("Messenger - {}", account.name))
                .inner_size(MIN_WIDTH, MIN_HEIGHT)
                .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
                .decorations(false)
                .visible(false)
                .center()
                .build()?;
            mount_account(app, &window, account, reopen.contains(&label))?;
            windows.push(window);
        }
        arrange_windows(&main, &windows);
    }
    if overlay_open {
        add_settings_overlay(&main)?;
    }
    Ok(())
}

/// Top-left corners that put windows of `sizes` in one centered row inside
/// `area` (x, y, width, height), or `None` when they do not fit side by side.
fn row_positions(area: (i32, i32, u32, u32), sizes: &[(u32, u32)]) -> Option<Vec<(i32, i32)>> {
    let total: u64 = sizes.iter().map(|s| u64::from(s.0)).sum();
    if sizes.len() < 2 || total > u64::from(area.2) {
        return None;
    }
    let mut x = area.0 + ((u64::from(area.2) - total) / 2) as i32;
    Some(
        sizes
            .iter()
            .map(|&(width, height)| {
                let y = area.1 + (i64::from(area.3) - i64::from(height)).max(0) as i32 / 2;
                let position = (x, y);
                x += width as i32;
                position
            })
            .collect(),
    )
}

/// Lines the account windows up so they can all be seen at once when the
/// screen is wide enough; otherwise they keep their centered placement.
fn arrange_windows(anchor: &Window, windows: &[Window]) {
    let Ok(Some(monitor)) = anchor.current_monitor() else {
        return;
    };
    let area = monitor.work_area();
    let sizes = windows
        .iter()
        .filter_map(|w| w.outer_size().ok().map(|s| (s.width, s.height)))
        .collect::<Vec<_>>();
    if sizes.len() != windows.len() {
        return;
    }
    let rect = (
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
    );
    if let Some(positions) = row_positions(rect, &sizes) {
        for (window, (x, y)) in windows.iter().zip(positions) {
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
}

/// Tears down and mounts every account view for the stored layout. Runs on a
/// worker: WebView2 creation must not block the event loop. `show_main` is
/// `None` to keep the main window's current visibility. `after` runs on the
/// worker once the old views are gone and the new ones are mounted.
pub fn apply_layout(
    app: &AppHandle,
    show_main: Option<bool>,
    after: impl FnOnce() + Send + 'static,
) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _serial = LAYOUT_LOCK.lock();
        if let Err(error) = rebuild(&app, show_main) {
            eprintln!("could not initialize Messenger views: {error}");
            if let Some(window) = app.get_window("main") {
                let _ = window.set_decorations(true);
                let _ = window.show();
            }
        }
        after();
    });
}

#[derive(Deserialize)]
pub struct PaneRect {
    x: f64,
    width: f64,
}

/// Split ratio implied by pane rectangles reported by the split view, or an
/// error when they are not a plausible layout of `panes` panes in `body_width`.
fn ratio_from_rects(rects: &[PaneRect], body_width: f64, panes: usize) -> Result<f64, String> {
    if panes != 2 || rects.len() != panes {
        return Err("pane count mismatch".into());
    }
    let sane = rects.iter().all(|r| {
        r.x.is_finite()
            && r.width.is_finite()
            && r.x >= 0.0
            && r.width >= PANE_MIN - 1.0
            && r.x + r.width <= body_width + 1.0
    });
    if !sane {
        return Err("invalid pane layout".into());
    }
    Ok(rects[0].width / (rects[0].width + rects[1].width))
}

/// Only the split view reports divider drags; the ratio is all Rust keeps.
#[tauri::command]
pub fn set_split_layout(
    app: AppHandle,
    webview: tauri::Webview,
    rects: Vec<PaneRect>,
) -> Result<(), String> {
    if !local_webview(&webview, &[LocalKind::Split]) {
        return Err("split view required".into());
    }
    let window = webview.window();
    let (width, _) = bounds(&window).map_err(|_| "window unavailable")?;
    let panes = window
        .webviews()
        .iter()
        .filter(|view| is_remote(view.label()))
        .count();
    let ratio = ratio_from_rects(&rects, width, panes)?;
    accounts::set_ratio_live(&app, ratio)?;
    resize(&window).map_err(|_| "could not resize views".to_string())
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
    if !local_webview(&webview, &[LocalKind::Status]) {
        return Err("local status view required".into());
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
        LogicalSize::new(width, (height - HEADER_HEIGHT - FOOTER_HEIGHT).max(1.0)),
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
    fn hidden_start_needs_a_tray_to_stay_reachable() {
        assert!(should_show_on_start(false, false));
        assert!(should_show_on_start(false, true));
        assert!(should_show_on_start(true, false));
        assert!(!should_show_on_start(true, true));
    }

    #[test]
    fn bounded_header_and_footer() {
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
    fn local_kinds_come_from_the_label_alone() {
        assert_eq!(local_kind("status-a1"), Some(LocalKind::Status));
        assert_eq!(local_kind("titlebar-a2"), Some(LocalKind::Titlebar));
        assert_eq!(local_kind("settings"), Some(LocalKind::Settings));
        assert_eq!(local_kind("split"), Some(LocalKind::Split));
        for other in [
            "status",
            "titlebar",
            "messenger-a1",
            "status-a1x",
            "status-../x",
            "main",
            "popup-1",
            "",
        ] {
            assert_eq!(local_kind(other), None, "{other}");
        }
    }

    #[test]
    fn local_views_only_work_inside_their_own_window() {
        assert!(owner_ok("status-a1", "main"));
        assert!(owner_ok("status-a2", "acct-a2"));
        assert!(owner_ok("titlebar-a2", "acct-a2"));
        // Split layout keeps every status and title bar in main.
        assert!(owner_ok("status-a1", "main"));
        assert!(!owner_ok("status-a2", "acct-a3"));
        assert!(!owner_ok("status-a1", "acct-a2"));
        assert!(!owner_ok("status-a1", "settings"));
        assert!(owner_ok("split", "main"));
        assert!(!owner_ok("split", "acct-a2"));
        assert!(owner_ok("settings", "settings"));
        assert!(!owner_ok("messenger-a1", "main"));
    }

    #[test]
    fn two_panes_fill_the_width_and_stop_at_the_minimum() {
        let rects = split_rects(966.0, 0.5, 2);
        assert_eq!(rects, vec![(0.0, 480.0), (486.0, 480.0)]);
        let rects = split_rects(1206.0, 0.5, 2);
        assert_eq!(rects, vec![(0.0, 600.0), (606.0, 600.0)]);
        // A ratio near either end locks at the minimum pane width.
        let rects = split_rects(1206.0, 0.9, 2);
        assert_eq!(rects[1].1, 480.0);
        assert_eq!(rects[0].1, 720.0);
        let rects = split_rects(1206.0, 0.1, 2);
        assert_eq!(rects[0].1, 480.0);
        assert_eq!(rects[1].0, 486.0);
    }

    #[test]
    fn windows_form_one_centered_row_only_when_they_fit() {
        let area = (0, 0, 3000, 1400);
        let sizes = [(802, 602), (802, 602)];
        assert_eq!(
            row_positions(area, &sizes),
            Some(vec![(698, 399), (1500, 399)])
        );
        // Offset monitors keep their origin.
        assert_eq!(
            row_positions((-1920, 200, 1920, 1000), &sizes).unwrap()[0],
            (-1920 + 158, 200 + 199)
        );
        assert_eq!(row_positions((0, 0, 1500, 900), &sizes), None);
        assert_eq!(row_positions(area, &[(802, 602)]), None);
    }

    #[test]
    fn narrow_windows_never_panic_or_shrink_panes() {
        let rects = split_rects(500.0, 0.5, 2);
        assert_eq!(rects, vec![(0.0, 480.0), (486.0, 480.0)]);
        assert_eq!(split_rects(0.0, 0.5, 2).len(), 2);
    }

    #[test]
    fn one_pane_takes_the_whole_width_and_none_is_empty() {
        assert_eq!(split_rects(900.0, 0.5, 1), vec![(0.0, 900.0)]);
        assert!(split_rects(900.0, 0.5, 0).is_empty());
    }

    fn rect(x: f64, width: f64) -> PaneRect {
        PaneRect { x, width }
    }

    #[test]
    fn reported_panes_become_a_ratio_only_when_plausible() {
        let ok = [rect(0.0, 600.0), rect(606.0, 600.0)];
        assert_eq!(ratio_from_rects(&ok, 1206.0, 2), Ok(0.5));
        let skewed = [rect(0.0, 480.0), rect(486.0, 720.0)];
        assert_eq!(ratio_from_rects(&skewed, 1206.0, 2), Ok(0.4));
        // Wrong count, below the minimum, outside the body, not finite, negative.
        assert!(ratio_from_rects(&ok[..1], 1206.0, 2).is_err());
        assert!(ratio_from_rects(&ok, 1206.0, 1).is_err());
        assert!(ratio_from_rects(&[rect(0.0, 300.0), rect(306.0, 900.0)], 1206.0, 2).is_err());
        assert!(ratio_from_rects(&[rect(0.0, 600.0), rect(606.0, 900.0)], 1206.0, 2).is_err());
        assert!(ratio_from_rects(&[rect(0.0, f64::NAN), rect(6.0, 600.0)], 1206.0, 2).is_err());
        assert!(ratio_from_rects(&[rect(-5.0, 600.0), rect(606.0, 600.0)], 1206.0, 2).is_err());
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
