// Quick reply: type into Messenger's own composer like a user would. No
// Messenger network API is called and nothing is sent unless the page does it.
const fieldText = (el) => (el.textContent ?? '').replace(/\u200b/g, '').trim();
const replaceText = (el, text) => {
  el.focus();
  document.execCommand('selectAll', false, null);
  return text ? document.execCommand('insertText', false, text) : document.execCommand('delete', false, null);
};
const pressEnter = (el) => {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }
};
const reportReply = (nonce, ok, reason) =>
  send(reason ? { kind: 'reply_result', nonce, ok, reason } : { kind: 'reply_result', nonce, ok });
async function runReply({ thread, text, nonce }) {
  if (threadFrom(location.href) !== thread) {
    const link = await until(() => [...document.querySelectorAll('a[href*="/t/"]')]
      .find((a) => threadFrom(a.href) === thread), 3000);
    if (!link) return reportReply(nonce, false, 'thread_not_found');
    link.click();
    if (!await until(() => threadFrom(location.href) === thread, 3000)) {
      return reportReply(nonce, false, 'thread_not_found');
    }
  }
  const field = await until(composer, 3000);
  if (!field) return reportReply(nonce, false, 'composer_not_found');
  const draft = field.textContent ?? '';
  replaceText(field, text);
  if (fieldText(field) !== text) {
    replaceText(field, draft);
    return reportReply(nonce, false, 'insert_failed');
  }
  pressEnter(field);
  if (!await until(() => fieldText(field) === '', 2000)) {
    replaceText(field, draft);
    return reportReply(nonce, false, 'send_failed');
  }
  if (draft.trim()) replaceText(field, draft);
  return reportReply(nonce, true);
}
const replyQueue = new Map();
let replying = false;
async function pumpReplies() {
  if (replying) return;
  replying = true;
  try {
    for (const [thread, items] of replyQueue) {
      while (items.length) {
        const item = items.shift();
        try { await runReply(item); } catch { reportReply(item.nonce, false, 'error'); }
      }
      replyQueue.delete(thread);
    }
  } finally { replying = false; }
}
window.__mewQuickReply = (request) => {
  const { thread, text, nonce } = request ?? {};
  if (!validId(thread) || !validId(nonce) || typeof text !== 'string' ||
      text.length === 0 || text.length > 2000) return false;
  if (!replyQueue.has(thread)) replyQueue.set(thread, []);
  replyQueue.get(thread).push({ thread, text, nonce });
  void pumpReplies();
  return true;
};
