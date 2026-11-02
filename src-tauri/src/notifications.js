// Observe only signals published by the Messenger web page.
(() => {
  if (location.protocol !== 'https:' ||
      !['messenger.com', 'www.messenger.com'].includes(location.hostname) ||
      window !== window.top || window.__mewNotificationsInstalled) return;
  window.__mewNotificationsInstalled = true;

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
  const threadId = (options) => {
    const value = options?.data?.threadId ?? options?.data?.thread_id ?? null;
    return validId(value) ? value : null;
  };
  const notifyFallback = (title, options = {}) => {
    // Never bypass a denied or not-yet-granted browser notification permission.
    if (OriginalNotification?.permission !== 'granted') return;
    if (typeof title !== 'string' || !title.trim()) return;
    const body = typeof options?.body === 'string' ? options.body.slice(0, 500) : '';
    const name = title.slice(0, 140);
    const key = typeof options?.tag === 'string' && validId(options.tag)
      ? 'tag:' + options.tag : 'body:' + hash(name + '\u0000' + body);
    send({ kind: 'notify', id: key, title: name, body, thread_id: threadId(options) });
  };

  // A working Web Notification is already displayed by the system. Avoid
  // double toasts: invoke our native fallback only when WebView2 rejects it.
  const OriginalNotification = window.Notification;
  if (typeof OriginalNotification === 'function') {
    try {
      window.Notification = new Proxy(OriginalNotification, {
        construct(target, argumentsList, newTarget) {
          try {
            return Reflect.construct(target, argumentsList, newTarget);
          } catch (error) {
            notifyFallback(argumentsList[0], argumentsList[1]);
            throw error;
          }
        },
      });
    } catch {
      // The original Notification API remains unchanged if it cannot be wrapped.
    }
  }

  const sw = window.ServiceWorkerRegistration?.prototype;
  if (sw && typeof sw.showNotification === 'function') {
    const originalShow = sw.showNotification;
    try {
      sw.showNotification = function (title, options) {
        try {
          return Promise.resolve(originalShow.call(this, title, options)).catch((err) => {
            notifyFallback(title, options);
            throw err;
          });
        } catch (error) {
          notifyFallback(title, options);
          throw error;
        }
      };
    } catch {
      // Keep the browser's original Service Worker behavior.
    }
  }

  // Unread count only uses explicit conversation markers; title counts are
  // message counts and are intentionally ignored.
  const unreadMarker = /\b(unread|chưa đọc|chưa xem|non lu|sin leer)\b/i;
  const threadFrom = (href) => {
    try {
      const url = new URL(href, location.href);
      if (!['messenger.com', 'www.messenger.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/\/(?:messages\/)?t\/([^/?#]+)/);
      return match ? match[1] : null;
    } catch { return null; }
  };
  const unreadThreads = () => {
    const ids = new Set();
    const links = document.querySelectorAll('a[href*="/t/"]');
    for (const a of links) {
      const id = threadFrom(a.href);
      const row = a.closest('[role="row"],[role="listitem"],li') ?? a;
      if (!id) continue;
      const own = a.getAttribute('aria-label') ?? '';
      const label = row.getAttribute('aria-label') ?? '';
      const markers = [...row.querySelectorAll('[aria-label]')].some(
        (el) => unreadMarker.test(el.getAttribute('aria-label') ?? ''));
      if (unreadMarker.test(own) || unreadMarker.test(label) || markers) ids.add(id);
    }
    return [...ids];
  };

  let scheduled = false;
  let lastState = null;
  let lastRead = null;
  let knownMarker = false;
  let sentReset = false;
  const sync = () => {
    scheduled = false;
    const list = unreadThreads();
    const loadedChats = document.querySelectorAll('a[href*="/t/"]').length > 0;
    if (list.length > 0 || loadedChats) knownMarker = true;
    if (knownMarker) {
      const signature = [...list].sort().join('|');
      if (signature !== lastState) {
        lastState = signature;
        send({ kind: 'unread', threads: list });
      }
    }
    const activeThread = threadFrom(location.href);
    if (activeThread && !document.hidden && document.hasFocus()) {
      if (activeThread !== lastRead) {
        lastRead = activeThread;
        send({ kind: 'read', thread_id: activeThread });
      }
    } else lastRead = null;
    if (!location.pathname.includes('/t/') && !document.querySelector('[role="navigation"],nav')) {
      if (!sentReset) {
        lastState = null;
        knownMarker = false;
        send({ kind: 'reset' });
        sentReset = true;
      }
    } else sentReset = false;
  };
  const queue = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(sync, 250);
  };
  new MutationObserver(queue).observe(document, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'],
  });
  document.addEventListener('visibilitychange', queue);
  window.addEventListener('focus', queue);
  window.addEventListener('popstate', queue);
  window.addEventListener('hashchange', queue);
  window.addEventListener('pagehide', () => send({ kind: 'reset' }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queue, { once: true });
  else queue();
})();
