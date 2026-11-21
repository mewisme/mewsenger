import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, test } from 'vitest';
import { part } from './inject-source.mjs';

const open = [];
afterEach(() => { for (const window of open.splice(0)) window.close(); });
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function load(body, prefs) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: 'outside-only', url: 'https://www.messenger.com/t/1' });
  const { window } = dom;
  open.push(window);
  if (prefs) window.__MEW_PREFS = prefs;
  return window;
}
const run = (window) => window.eval(`(() => {\n${['24-dom.js', '26-prefs.js', '98-selection.js'].map(part).join('\n')}\n})();`);
const rect = (left, right, top = 0, bottom = 40) => () => ({ left, right, top, bottom, width: right - left, height: bottom - top });

const FIELDS = `
  <input id="a">
  <div id="b" contenteditable="true" spellcheck="true"></div>
  <div id="c">not a field</div>`;
const focusIn = (window, el) => el.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));

test('spell check is left alone by default', () => {
  const window = load(FIELDS);
  run(window);
  const { document } = window;
  focusIn(window, document.getElementById('a'));
  focusIn(window, document.getElementById('b'));
  assert.equal(document.getElementById('a').getAttribute('spellcheck'), null);
  assert.equal(document.getElementById('b').getAttribute('spellcheck'), 'true');
});

test('with spell check off, fields stop checking at load and as they take the focus', () => {
  const window = load(FIELDS, { spellCheck: false });
  run(window);
  const { document } = window;
  assert.equal(document.getElementById('a').getAttribute('spellcheck'), 'false');
  assert.equal(document.getElementById('b').getAttribute('spellcheck'), 'false');
  assert.equal(document.getElementById('c').getAttribute('spellcheck'), null, 'only fields');
  // A message box Facebook draws again.
  const fresh = document.createElement('div');
  fresh.setAttribute('contenteditable', 'true');
  const inner = document.createElement('span');
  fresh.append(inner);
  document.body.append(fresh);
  focusIn(window, inner);
  assert.equal(fresh.getAttribute('spellcheck'), 'false');
});

test('turning spell check off and on in Settings takes effect at once and restores each field', () => {
  const window = load(FIELDS);
  run(window);
  const { document } = window;
  window.__mewApplyPrefs({ spellCheck: false });
  assert.equal(document.getElementById('a').getAttribute('spellcheck'), 'false');
  assert.equal(document.getElementById('b').getAttribute('spellcheck'), 'false');
  window.__mewApplyPrefs({ spellCheck: false });
  window.__mewApplyPrefs({ spellCheck: true });
  assert.equal(document.getElementById('a').hasAttribute('spellcheck'), false, 'no attribute as before');
  assert.equal(document.getElementById('b').getAttribute('spellcheck'), 'true', 'its own value back');
  focusIn(window, document.getElementById('a'));
  assert.equal(document.getElementById('a').hasAttribute('spellcheck'), false, 'focus no longer turns it off');
});

// A message sent by the user: on the right of the row, its toolbar to the left.
const CHAT = (toolbar = true) => `
  <div role="navigation"><div role="row" data-message-id="nope" id="listrow"></div></div>
  <div role="main"><div role="log">
    <div role="article" id="row">
      <div data-message-id="m1" id="bubble"><div dir="auto" id="text">hello</div></div>
      ${toolbar ? '<div role="toolbar" id="bar"><div role="button" id="react"></div><div role="button" id="reply"></div><div role="button" id="more"></div></div>' : ''}
    </div>
    <div role="textbox" contenteditable="true" id="box"></div>
  </div></div>`;
function chat({ prefs, toolbar = true } = {}) {
  const window = load(CHAT(toolbar), prefs);
  const { document } = window;
  const get = (id) => document.getElementById(id);
  get('row').getBoundingClientRect = rect(0, 800);
  get('bubble').getBoundingClientRect = rect(500, 700);
  get('text').getBoundingClientRect = rect(520, 680);
  const clicks = [];
  for (const id of ['react', 'reply', 'more']) get(id)?.addEventListener('click', () => clicks.push(id));
  run(window);
  const dbl = (el, x = 100, y = 20) => {
    const event = new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    el.dispatchEvent(event);
    return event;
  };
  return { window, document, get, clicks, dbl };
}

test('double-click reply does nothing while the setting is off', async () => {
  const c = chat();
  const event = c.dbl(c.get('row'));
  await settle();
  assert.deepEqual(c.clicks, []);
  assert.equal(event.defaultPrevented, false);
});

test('with the setting on, double-clicking empty space beside a message replies to it', async () => {
  const c = chat({ prefs: { doubleClickReply: true } });
  const event = c.dbl(c.get('row'));
  await settle();
  assert.deepEqual(c.clicks, ['reply']);
  assert.equal(event.defaultPrevented, true);
});

test('the setting applies live', async () => {
  const c = chat();
  c.window.__mewApplyPrefs({ doubleClickReply: true });
  c.dbl(c.get('row'));
  await settle();
  assert.deepEqual(c.clicks, ['reply']);
  c.window.__mewApplyPrefs({ doubleClickReply: false });
  c.dbl(c.get('row'));
  await settle();
  assert.deepEqual(c.clicks, ['reply']);
});

test('double-clicking text, a button or the message itself still selects, never replies', async () => {
  const c = chat({ prefs: { doubleClickReply: true } });
  for (const [el, x] of [[c.get('text'), 600], [c.get('bubble'), 600], [c.get('more'), 100], [c.get('row'), 600]]) {
    const event = c.dbl(el, x);
    assert.equal(event.defaultPrevented, false);
  }
  await settle();
  assert.deepEqual(c.clicks, []);
});

test('empty space on the message\'s own side of the row is not a reply either', async () => {
  const c = chat({ prefs: { doubleClickReply: true } });
  c.dbl(c.get('row'), 750);
  await settle();
  assert.deepEqual(c.clicks, []);
});

test('the chat list and the message box never start a reply', async () => {
  const c = chat({ prefs: { doubleClickReply: true } });
  c.dbl(c.get('listrow'));
  c.dbl(c.get('box'));
  await settle();
  assert.deepEqual(c.clicks, []);
});

test('the reply button is found by its icon even when the toolbar has another shape', async () => {
  const c = chat({ prefs: { doubleClickReply: true } });
  c.get('reply').remove();
  c.get('bar').insertAdjacentHTML('beforeend', '<div role="button" id="r2"><svg><path d="m101 936.5c1 2"></path></svg></div>');
  c.get('r2').addEventListener('click', () => c.clicks.push('r2'));
  c.dbl(c.get('row'));
  await settle();
  assert.deepEqual(c.clicks, ['r2']);
});

test('the toolbar only shows on hover: the message is hovered first, then replied to', async () => {
  const c = chat({ prefs: { doubleClickReply: true }, toolbar: false });
  c.get('bubble').addEventListener('mouseover', () => {
    if (c.get('row').querySelector('[role="toolbar"]')) return;
    c.get('row').insertAdjacentHTML('beforeend', '<div role="toolbar"><div role="button" id="x1"></div><div role="button" id="x2"></div><div role="button" id="x3"></div></div>');
    c.get('x2').addEventListener('click', () => c.clicks.push('x2'));
  });
  c.dbl(c.get('row'));
  await settle(300);
  assert.deepEqual(c.clicks, ['x2']);
});

test('with no reply button to be found nothing happens', async () => {
  const c = chat({ prefs: { doubleClickReply: true }, toolbar: false });
  c.dbl(c.get('row'));
  await settle(600);
  assert.deepEqual(c.clicks, []);
});
