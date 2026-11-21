// The page's only way to the app: the notification_event command. No other
// Tauri IPC is exposed to Messenger.
const send = (event) => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') return false;
  try {
    Promise.resolve(invoke('notification_event', { event })).catch(() => {});
    return true;
  } catch {
    return false;
  }
};
const hash = (text) => {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  }
  return (value >>> 0).toString(16);
};
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 160 &&
  !/[\x00-\x1f\x7f]/.test(id);
const threadFrom = (href) => {
  try {
    const url = new URL(href, location.href);
    if (!window.__MEW_SITE__.app_hosts.includes(url.hostname)) return null;
    const match = url.pathname.match(/\/(?:messages\/)?t\/([^/?#]+)/);
    return match ? match[1] : null;
  } catch { return null; }
};
