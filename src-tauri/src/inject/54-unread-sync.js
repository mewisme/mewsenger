// Reports the page's state to the app: unread conversations, which chat was
// read, and the signed-in state. A change in unread never raises a notification
// of its own, whether at start-up or when the database answers: only a message
// Messenger notifies about does (see 40-notifications).
let unreadScheduled = false;
let lastState = null;
let lastRead = null;
let previousUnread = new Set();
let knownMarker = false;
let sentReset = false;
let lastSession = null;

const syncUnread = () => {
  unreadScheduled = false;
  void refreshDatabaseUnread(queueUnread);
  const list = unreadThreads();
  const currentUnread = new Set(list);
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
  // Focusing a chat does not prove Messenger marked its messages read.
  // Revoke routing only after a previously observed unread indicator has
  // disappeared while its thread is active in a focused, loaded page.
  const confirmedRead = loadedChats && activeThread &&
    !document.hidden && document.hasFocus() &&
    previousUnread.has(activeThread) && !currentUnread.has(activeThread);
  if (confirmedRead && activeThread !== lastRead) {
    lastRead = activeThread;
    send({ kind: 'read', thread_id: activeThread });
  }
  if (!activeThread || currentUnread.has(activeThread)) lastRead = null;
  previousUnread = currentUnread;
  if (!location.pathname.includes('/t/') && !document.querySelector('[role="navigation"],nav')) {
    if (!sentReset) {
      lastState = null;
      knownMarker = false;
      previousUnread = new Set();
      lastSession = null;
      send({ kind: 'reset' });
      sentReset = true;
    }
  } else sentReset = false;
  // Report only a positively recognized state; anything else stays unknown.
  const passwordField = [...document.querySelectorAll('input[type="password"]')]
    .some((el) => el.getBoundingClientRect?.().width > 0);
  const session = loadedChats && document.querySelector('[role="navigation"],nav')
    ? 'signed_in'
    : (passwordField || location.pathname.startsWith('/login') ? 'signed_out' : null);
  if (session && session !== lastSession) {
    lastSession = session;
    send({ kind: 'session', state: session });
  }
};
function queueUnread() {
  if (unreadScheduled) return;
  unreadScheduled = true;
  setTimeout(syncUnread, 250);
}
new MutationObserver(queueUnread).observe(document, {
  subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'],
});
document.addEventListener('visibilitychange', queueUnread);
window.addEventListener('blur', queueUnread);
window.addEventListener('focus', queueUnread);
window.addEventListener('popstate', queueUnread);
window.addEventListener('hashchange', queueUnread);
window.addEventListener('pagehide', () => send({ kind: 'reset' }));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueUnread, { once: true });
else queueUnread();
