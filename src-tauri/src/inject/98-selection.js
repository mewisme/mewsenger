// Text editing and selection details:
//  - Spell check (Settings: spellCheck). Windows checks only the languages the
//    system has, so on a system set up in English nearly every Vietnamese word
//    is underlined in red. Turned off, fields do not check spelling; they are
//    turned off as they take the focus, so a message box Facebook draws again
//    is too. Turned on again, they get back what they had.
//  - Double-clicking empty space beside a message starts a reply to it
//    (Settings: doubleClickReply). Double-clicking text selects words as usual.
const SPELL_FIELDS = 'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
const SPELL_UNCHECKED = 'data-mew-unchecked';
// What the field had before: 'none' when it had no spellcheck attribute.
function uncheckField(field) {
  if (!field || field.hasAttribute(SPELL_UNCHECKED)) return;
  field.setAttribute(SPELL_UNCHECKED, field.getAttribute('spellcheck') ?? 'none');
  field.setAttribute('spellcheck', 'false');
}
function recheckFields() {
  for (const field of document.querySelectorAll(`[${SPELL_UNCHECKED}]`)) {
    const before = field.getAttribute(SPELL_UNCHECKED);
    field.removeAttribute(SPELL_UNCHECKED);
    if (before === 'none') field.removeAttribute('spellcheck');
    else field.setAttribute('spellcheck', before);
  }
}
function uncheckFieldsNow() {
  for (const field of document.querySelectorAll(SPELL_FIELDS)) uncheckField(field);
}
document.addEventListener('focusin', (event) => {
  if (mewPrefs.get('spellCheck') === false && event.target instanceof Element) uncheckField(event.target.closest(SPELL_FIELDS));
}, true);
function applySpellCheck(on) {
  if (on) recheckFields();
  else uncheckFieldsNow();
}
if (mewPrefs.get('spellCheck') === false) applySpellCheck(false);
let spellWasOn = mewPrefs.get('spellCheck') !== false;
mewPrefs.onChange((values) => {
  const on = values.spellCheck !== false;
  if (on === spellWasOn) return;
  spellWasOn = on;
  applySpellCheck(on);
});

// The reply button in a message's hover toolbar: by its icon, by its label
// when the icon changed, or by its place (reply is the middle of three).
const isReplyButton = (button) => {
  if (!(button instanceof Element) || button.getAttribute('role') !== 'button') return false;
  const d = button.querySelector('svg path')?.getAttribute('d') ?? '';
  return /^m101 936\.5c/i.test(d) || /reply|trả lời/i.test(button.getAttribute('aria-label') ?? '');
};
const findReplyButton = (row) => {
  const buttons = [...row.querySelectorAll('[role="toolbar"] [role="button"]')];
  return buttons.find(isReplyButton) ?? (buttons.length === 3 ? buttons[1] : null);
};
// The message row under the pointer: in the chat, not the list, not a field,
// not a date; and one that holds a message.
const findMessageRow = (target) => {
  if (!(target instanceof Element) || !target.closest('[role="main"]')) return null;
  if (target.closest('[role="navigation"], [role="banner"], form, [contenteditable="true"]')) return null;
  const row = target.closest('[data-scope="messages_table"], [role="log"] [role="article"], [role="row"]');
  if (!row || row.matches('[data-scope="date_break"]') || row.querySelector('[data-scope="date_break"]')) return null;
  if (!row.matches('[data-message-id]') && !row.querySelector('[data-message-id]')) return null;
  return row;
};
const isContentTarget = (target) => target instanceof Element && !!target.closest(
  'a[href], button, [role="button"], img, video, audio, blockquote, [role="toolbar"], [dir="auto"], [data-scope="date_break"], input, textarea, [contenteditable="true"]',
);
const inRect = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
// Beside what the message shows (its text, pictures, buttons), on the side
// away from where the message sits in the row, and not over it.
const isEmptySpaceClick = (row, x, y) => {
  const rowRect = row.getBoundingClientRect();
  if (!inRect(rowRect, x, y)) return false;
  for (const el of row.querySelectorAll('[role="button"], [role="toolbar"]')) {
    if (inRect(el.getBoundingClientRect(), x, y)) return false;
  }
  const shown = (row.matches('[data-message-id]') ? [row] : [])
    .concat([...row.querySelectorAll('[data-message-id], [dir="auto"], blockquote, img, video, audio')])
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0 && rect.width < rowRect.width * 0.95);
  if (!shown.length) return false;
  if (shown.some((rect) => inRect(rect, x, y))) return false;
  const left = Math.min(...shown.map((rect) => rect.left));
  const right = Math.max(...shown.map((rect) => rect.right));
  // A message on the right (sent by the user) is replied to from its left.
  return (left + right) / 2 > (rowRect.left + rowRect.right) / 2 ? x < left : x > right;
};
async function replyToRow(row) {
  let button = findReplyButton(row);
  if (!button) {
    // The toolbar shows while the pointer is over the message.
    const target = row.querySelector('[data-message-id]') ?? row;
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    button = await until(() => findReplyButton(row), 400);
  }
  if (!button) return;
  button.click();
  row.closest('[role="main"]')?.querySelector('[role="textbox"][contenteditable="true"]')?.focus();
}
document.addEventListener('dblclick', (event) => {
  if (mewPrefs.get('doubleClickReply') !== true || isContentTarget(event.target)) return;
  const row = findMessageRow(event.target);
  if (!row || !isEmptySpaceClick(row, event.clientX, event.clientY)) return;
  event.preventDefault();
  window.getSelection?.()?.removeAllRanges?.();
  replyToRow(row).catch(() => {});
}, true);
