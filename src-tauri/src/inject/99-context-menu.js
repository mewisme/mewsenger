// Right-clicking a chat in the list or a message opens Messenger's own menu
// (the one behind its "..." button) instead of the browser's. The browser's
// menu stays when it is not clear which button to press, when text was
// selected before the click (Copy), on links, pictures, fields and dates, and
// on a second right-click on the same chat or message while Messenger's menu
// is open (which also closes it).
let ctxTarget = null;
let ctxInvoking = false;
let ctxSelectedBefore = false;
document.addEventListener('mousedown', (event) => {
  if (event.button === 2 || (event.button === 0 && event.ctrlKey)) ctxSelectedBefore = !!window.getSelection?.()?.toString().trim();
}, { capture: true, passive: true });

const ctxMenuOpen = () => [...document.querySelectorAll('[role="menu"]')].some(visible);
const ctxDismiss = () => document.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
}));
// Only a button that is there now: the hover toolbar is already showing when
// the pointer is over the message, and with no button the browser's menu is
// the better answer than none.
const ctxThreadButton = (row) => row.querySelector('[role="button"][aria-haspopup="menu"]');
const ctxMessageButton = (row) => {
  const buttons = [...row.querySelectorAll('[role="toolbar"] [role="button"]')];
  return buttons.find((button) => button.getAttribute('aria-haspopup') === 'menu' ||
    /^M456[,\s]410/i.test(button.querySelector('svg path')?.getAttribute('d') ?? '')) ??
    (buttons.length >= 3 ? buttons.at(-1) : null);
};
function ctxPress(button) {
  ctxInvoking = true;
  try { button.click(); } finally { ctxInvoking = false; }
}
// Opens Messenger's menu for the row; false leaves the browser's menu.
function ctxOpen(row, button, event) {
  if (ctxTarget === row && ctxMenuOpen()) {
    ctxTarget = null;
    ctxDismiss();
    return false;
  }
  if (!button) return false;
  event.preventDefault();
  ctxTarget = row;
  ctxPress(button);
  return true;
}
// The message under the pointer: the closest of its wrappers that holds the
// toolbar, going no higher than the one message.
function ctxMessageRow(target) {
  let row = target.closest('[role="main"] [data-scope="messages_table"], [role="main"] [data-message-id]');
  while (row && !ctxMessageButton(row)) {
    const up = row.parentElement;
    if (!up || up.matches('[role="main"], [role="log"]') || up.querySelectorAll('[data-message-id]').length > 1) break;
    row = up;
  }
  return row;
}
document.addEventListener('contextmenu', (event) => {
  const target = event.target;
  if (!(target instanceof Element) || document.documentElement.hasAttribute('data-mew-resizing')) return;
  if (editing(target) || ctxSelectedBefore) return;
  const threadRow = target.closest('[role="navigation"] [role="row"]');
  if (threadRow) {
    ctxOpen(threadRow, ctxThreadButton(threadRow), event);
    return;
  }
  // Links, photos and videos keep the browser's menu (Copy Link, Copy Image).
  if (target.closest('a[href], img, video, svg image, [data-scope="date_break"]')) return;
  const messageRow = ctxMessageRow(target);
  if (!messageRow) return;
  if (ctxOpen(messageRow, ctxMessageButton(messageRow), event)) {
    // The word the right-click selected.
    window.getSelection?.()?.removeAllRanges?.();
  }
}, true);
document.addEventListener('click', (event) => { if (!ctxInvoking && event.isTrusted !== false) ctxTarget = null; }, { capture: true, passive: true });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') ctxTarget = null; }, { capture: true, passive: true });
window.addEventListener('popstate', () => { ctxTarget = null; }, { passive: true });
