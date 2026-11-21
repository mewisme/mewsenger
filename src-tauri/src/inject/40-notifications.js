// Desktop toasts for what the page notifies about. While Messenger raises its
// own notifications (see 34-fb-notification-hooks) the page's Notification is
// answered here and delivered through the app, with the sender and group read
// from Messenger's database. Otherwise a working Web Notification is already
// displayed by the system: the native fallback is invoked only when WebView2
// rejects it, to avoid double toasts.
const threadId = (options) => {
  const value = options?.data?.threadId ?? options?.data?.thread_id ?? null;
  return validId(value) ? value : null;
};
const OriginalNotification = window.Notification;

const deliverNotification = (title, options = {}, { title: rewrittenTitle, body: rewrittenBody, thread } = {}) => {
  // Never bypass a denied or not-yet-granted browser notification permission.
  if (OriginalNotification?.permission !== 'granted') return;
  if (typeof title !== 'string' || !title.trim()) return;
  const text = rewrittenBody ?? (typeof options?.body === 'string' ? options.body : '');
  const body = text.slice(0, 500);
  const name = (rewrittenTitle ?? title).slice(0, 140);
  const key = typeof options?.tag === 'string' && validId(options.tag)
    ? 'tag:' + options.tag : 'body:' + hash(name + '\u0000' + body);
  const target = thread ?? threadId(options);
  send({ kind: 'notify', id: key, title: name, body, thread_id: target });
};
const notifyFallback = (title, options) => deliverNotification(title, options);

// A notification Messenger raised while away: delivered once Messenger's own
// copy of the message has said who sent it and where.
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
async function deliverMessengerNotification(title, options = {}) {
  const info = await within(notificationHooks.details(options.tag), 1000).catch(() => null);
  const body = typeof options.body === 'string' && options.body ? options.body : 'New message';
  if (!info?.group) return deliverNotification(title, options, { body, thread: info?.thread });
  const prefixed = !info.sender || body.startsWith(info.sender) ? body : `${info.sender}: ${body}`;
  deliverNotification(title, options, { title: info.group, body: prefixed, thread: info.thread });
}
// What the page gets for the notification it asked for: the delivery itself
// is the app's, so there is nothing to show, close or click here.
const delivered = (title, options = {}) => ({
  title, body: options.body ?? '', tag: options.tag ?? '', data: options.data ?? null,
  onclick: null, onshow: null, onclose: null, onerror: null,
  close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
});

if (typeof OriginalNotification === 'function') {
  try {
    window.Notification = new Proxy(OriginalNotification, {
      construct(target, argumentsList, newTarget) {
        if (notificationHooks.active()) {
          void deliverMessengerNotification(argumentsList[0], argumentsList[1]).catch(() => {});
          return delivered(argumentsList[0], argumentsList[1]);
        }
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

const serviceWorker = window.ServiceWorkerRegistration?.prototype;
if (serviceWorker && typeof serviceWorker.showNotification === 'function') {
  const originalShow = serviceWorker.showNotification;
  try {
    serviceWorker.showNotification = function (title, options) {
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
