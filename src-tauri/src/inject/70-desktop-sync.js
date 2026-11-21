// Keeps the composer focus and the photo viewer in step with the page.
let desktopScheduled = false;
function syncDesktop() {
  if (desktopScheduled) return;
  desktopScheduled = true;
  setTimeout(() => { desktopScheduled = false; syncViewer(); focusComposer(); }, 70);
}
new MutationObserver(syncDesktop).observe(document, { subtree: true, childList: true });
window.addEventListener('popstate', syncDesktop);
window.addEventListener('hashchange', syncDesktop);
window.addEventListener('focus', syncDesktop);
document.addEventListener('visibilitychange', syncDesktop);
document.addEventListener('load', syncDesktop, true);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncDesktop, { once: true });
else syncDesktop();
