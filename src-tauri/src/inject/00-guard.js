// Every part of the page script runs inside one function (see build.rs), in
// file-name order, so a part can use what an earlier part declares. This
// first part runs in every frame: it does nothing outside the live Messenger
// origin or without the site profile that src-tauri/site.json injects.
const site = window.__MEW_SITE__;
if (!site?.app_hosts?.includes(location.hostname) || location.protocol !== 'https:') return;
