// What the shell's menu and the keyboard can ask the page to do, by name
// (window.__mewDesktopAction).
const clickFirst = (selectors) => {
  for (const selector of selectors) {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (el) { el.click(); return true; }
  }
  return false;
};
const chatLinks = () => [...document.querySelectorAll('a[href*="/t/"]')]
  .filter((el) => visible(el) && !!el.closest('[role="navigation"],[role="grid"],nav'));
function selectChat(step) {
  const links = chatLinks();
  if (!links.length) return false;
  const index = links.findIndex((el) => new URL(el.href).pathname === location.pathname);
  links[clamp(index + step, 0, links.length - 1)]?.click();
  return true;
}
function zoomBy(factor) {
  const img = viewerImage();
  if (!img) return false;
  const rect = img.getBoundingClientRect();
  return zoomAt((zoom?.scale || 1) * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}
const actions = {
  search() {
    const field = [...document.querySelectorAll('input[type="search"],[role="searchbox"]')].find(visible);
    if (!field) return false;
    field.focus({ preventScroll: true });
    return true;
  },
  'new-chat': () => clickFirst(['a[href*="/new"]', '[aria-label*="new message" i]', '[aria-label*="tin nhắn mới" i]']),
  account: () => clickFirst(['[role="banner"] [aria-label*="account" i]',
    '[role="navigation"] [aria-label*="account" i]', 'button[aria-label*="account" i]',
    '[role="banner"] [aria-label*="tài khoản" i]',
    '[role="navigation"] [aria-label*="tài khoản" i]',
    '[aria-label*="your profile" i]', '[aria-label*="trang cá nhân của bạn" i]']),
  logout() {
    if (!actions.account()) return false;
    // Only Messenger's own Log out control can terminate the session.
    setTimeout(() => {
      [...document.querySelectorAll('[role="menuitem"],[role="button"],button')]
        .find((el) => visible(el) && /^(log\s*out|đăng\s*xuất)$/i.test(el.textContent.trim()))?.click();
    }, 300);
    return true;
  },
  'next-chat': () => selectChat(1),
  'prev-chat': () => selectChat(-1),
  'zoom-in': () => zoomBy(1.25),
  'zoom-out': () => zoomBy(0.8),
  'zoom-reset': () => { if (!zoom) return false; resetZoom(); return true; },
};
window.__mewDesktopAction = (name) => actions[name]?.() ?? false;
