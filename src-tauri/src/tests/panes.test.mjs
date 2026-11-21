import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, test } from 'vitest';
import { part } from './inject-source.mjs';

const open = [];
afterEach(() => { for (const window of open.splice(0)) window.close(); });

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const LAYOUT = `
  <div id="app">
    <div role="navigation" id="list"></div>
    <div role="main" id="main"><div id="row"><div id="chat"><div role="log"></div></div><div id="details"></div></div></div>
  </div>`;
const NO_DETAILS = `
  <div id="app">
    <div role="navigation" id="list"></div>
    <div role="main" id="main"><div id="row"><div id="chat"><div role="log"></div></div></div></div>
  </div>`;

// A page with the panes part loaded. jsdom has no layout, so widths and the
// styles Facebook gives the row are stood in for.
async function page({ html = LAYOUT, saved = null, listWidth = 320, chatWidth = 1000, detailsWidth = 300 } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only', url: 'https://www.messenger.com/t/1' });
  const { window } = dom;
  open.push(window);
  if (saved !== null) window.localStorage.setItem('mew-pane-widths', typeof saved === 'string' ? saved : JSON.stringify(saved));
  const { document } = window;
  const widths = { list: listWidth, chat: chatWidth, details: detailsWidth };
  const byId = (id) => document.getElementById(id);
  window.getComputedStyle = (el) => {
    if (el === byId('row')) return { display: 'flex', flexDirection: 'row', minWidth: '0px' };
    if (el === byId('details')) return { display: 'block', flexDirection: 'row', minWidth: '300px' };
    return { display: 'block', flexDirection: 'row', minWidth: '' };
  };
  const rect = (width) => () => ({ width, left: 0, right: width, top: 0, bottom: 0 });
  for (const [id, key] of [['list', 'list'], ['chat', 'chat'], ['details', 'details']]) {
    const el = byId(id);
    if (el) el.getBoundingClientRect = rect(widths[key]);
  }
  window.eval(`(() => {\n${['24-dom.js', '26-prefs.js', '96-panes.js'].map(part).join('\n')}\n})();`);
  await settle();
  const css = () => [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const edge = (pane) => document.querySelector(`.mew-pane-edge[data-pane="${pane}"]`);
  const fire = (el, type, init = {}) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  const drag = (pane, from, to) => {
    const el = edge(pane);
    fire(el, 'pointerdown', { clientX: from });
    fire(el, 'pointermove', { clientX: to });
    fire(el, 'pointerup', { clientX: to });
  };
  const stored = () => JSON.parse(window.localStorage.getItem('mew-pane-widths'));
  return { window, document, css, edge, fire, drag, stored, byId };
}

test('dragging the list edge sets its width, applies it and keeps it', async () => {
  const p = await page();
  assert.ok(p.edge('list'), 'the edge is on the list');
  p.fire(p.edge('list'), 'pointerdown', { clientX: 320 });
  p.fire(p.edge('list'), 'pointermove', { clientX: 420 });
  assert.equal(p.byId('list').style.width, '420px', 'follows the pointer while dragging');
  assert.ok(p.document.documentElement.hasAttribute('data-mew-resizing'));
  p.fire(p.edge('list'), 'pointerup', { clientX: 420 });
  assert.equal(p.byId('list').style.width, '', 'the style sheet takes over');
  assert.ok(!p.document.documentElement.hasAttribute('data-mew-resizing'));
  assert.match(p.css(), /\[data-mew-list\] \{ flex: 0 0 420px !important; width: 420px !important;/);
  assert.deepEqual(p.stored(), { list: 420, details: null });
});

test('dragging the details edge to the left widens the details', async () => {
  const p = await page();
  p.drag('details', 1000, 950);
  assert.match(p.css(), /\[data-mew-chat-row\] > :nth-child\(2\) \{ flex: 0 0 350px/);
  assert.equal(p.stored().details, 350);
});

test('the chat keeps its room and a pane never gets unusably narrow', async () => {
  const p = await page();
  // 1000 wide chat, 360 of it stays: the list can grow by 640 at most.
  p.drag('list', 320, 2320);
  assert.equal(p.stored().list, 960);
  p.drag('list', 960, -5000);
  assert.equal(p.stored().list, 120);
  assert.match(p.css(), /max-width: calc\(100% - 660px\)/, 'the list also leaves the chat and the details their room when the window shrinks');
});

test('double-clicking the edge goes back to Facebook\'s width', async () => {
  const p = await page();
  p.drag('list', 320, 400);
  assert.ok(p.stored());
  p.fire(p.edge('list'), 'dblclick');
  assert.equal(p.window.localStorage.getItem('mew-pane-widths'), null);
  assert.doesNotMatch(p.css(), /flex: 0 0/);
});

test('resetting one pane keeps the other\'s width', async () => {
  const p = await page();
  p.drag('list', 320, 400);
  p.drag('details', 1000, 950);
  p.fire(p.edge('details'), 'dblclick');
  assert.deepEqual(p.stored(), { list: 400, details: null });
});

test('saved widths apply as soon as the layout is there', async () => {
  const p = await page({ saved: { list: 410, details: 380 } });
  const css = p.css();
  assert.match(css, /\[data-mew-list\] \{ flex: 0 0 410px/);
  assert.match(css, /\[data-mew-chat-row\] > :nth-child\(2\) \{ flex: 0 0 380px/);
});

test('saved widths that make no sense are ignored', async () => {
  for (const saved of ['not json', '{"list":-20,"details":"wide"}', '{"list":99999}', 'null', '[]']) {
    const p = await page({ saved });
    assert.doesNotMatch(p.css(), /flex: 0 0/, saved);
  }
});

test('a click on the edge without moving changes nothing', async () => {
  const p = await page();
  p.drag('list', 320, 320);
  assert.equal(p.window.localStorage.getItem('mew-pane-widths'), null);
  assert.equal(p.byId('list').style.width, '');
});

test('a secondary button does not start a drag', async () => {
  const p = await page();
  const el = p.edge('list');
  p.fire(el, 'pointerdown', { clientX: 320, button: 2 });
  p.fire(el, 'pointermove', { clientX: 500, button: 2 });
  assert.ok(!p.document.documentElement.hasAttribute('data-mew-resizing'));
  assert.equal(p.byId('list').style.width, '');
});

test('without details only the list can be resized', async () => {
  const p = await page({ html: NO_DETAILS });
  assert.ok(p.edge('list'));
  assert.equal(p.edge('details'), null);
});

test('the edges follow the layout as Facebook builds and drops it', async () => {
  const p = await page({ html: '<div id="app"></div>' });
  assert.equal(p.edge('list'), null);
  p.document.getElementById('app').innerHTML = LAYOUT.replace('<div id="app">', '').replace(/<\/div>\s*$/, '');
  const { byId } = p;
  p.window.getComputedStyle = (el) => (el === byId('row')
    ? { display: 'flex', flexDirection: 'row', minWidth: '0px' }
    : { display: 'block', flexDirection: 'row', minWidth: el === byId('details') ? '300px' : '' });
  await settle();
  assert.ok(p.edge('list'), 'the list gets its edge');
  assert.ok(p.edge('details'), 'the details get theirs');
  p.byId('details').remove();
  await settle();
  assert.equal(p.edge('details'), null, 'closing the details takes their edge away');
});
