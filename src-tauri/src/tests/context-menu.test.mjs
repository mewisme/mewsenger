import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, test } from 'vitest';
import { part } from './inject-source.mjs';

const open = [];
afterEach(() => { for (const window of open.splice(0)) window.close(); });

const BODY = `
  <div role="navigation">
    <div role="row" id="t1"><span id="t1name">Ann</span><div role="button" aria-haspopup="menu" id="t1menu"></div></div>
    <div role="row" id="t2"><span id="t2name">Bob</span></div>
  </div>
  <div role="main">
    <div data-scope="messages_table" id="m1">
      <div data-message-id="1"><span id="m1text">hello there</span><a href="https://example.com" id="m1link">link</a><img id="m1img"></div>
      <div role="toolbar"><div role="button" id="m1react"></div><div role="button" id="m1reply"></div><div role="button" id="m1more"></div></div>
    </div>
    <div data-scope="messages_table" id="m2">
      <div data-message-id="2"><span id="m2text">only two</span></div>
      <div role="toolbar"><div role="button" id="m2react"></div><div role="button" id="m2reply"></div></div>
    </div>
    <div data-scope="messages_table" id="m3">
      <div data-message-id="3"><span id="m3text">menu button</span></div>
      <div role="toolbar"><div role="button" id="m3a"></div><div role="button" aria-haspopup="menu" id="m3menu"></div><div role="button" id="m3c"></div></div>
    </div>
    <div data-scope="date_break" id="date"><span id="datetext">Today</span></div>
    <div role="textbox" contenteditable="true" id="box"></div>
  </div>`;

function page() {
  const dom = new JSDOM(`<!doctype html><body>${BODY}</body>`, { runScripts: 'outside-only', url: 'https://www.messenger.com/t/1' });
  const { window } = dom;
  open.push(window);
  const { document } = window;
  window.eval(`(() => {\n${['24-dom.js', '99-context-menu.js'].map(part).join('\n')}\n})();`);
  const get = (id) => document.getElementById(id);
  const clicks = [];
  for (const el of document.querySelectorAll('[role="button"]')) el.addEventListener('click', () => clicks.push(el.id));
  const escapes = [];
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') escapes.push(true); });
  const rightClick = (el) => {
    el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 2 }));
    const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    el.dispatchEvent(event);
    return event;
  };
  const showMenu = () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.getBoundingClientRect = () => ({ width: 200, height: 100, left: 0, right: 200, top: 0, bottom: 100 });
    document.body.append(menu);
    return menu;
  };
  return { window, document, get, clicks, escapes, rightClick, showMenu };
}

test('right-clicking a chat in the list opens its own menu instead of the browser\'s', () => {
  const p = page();
  const event = p.rightClick(p.get('t1name'));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(p.clicks, ['t1menu']);
});

test('a chat whose menu button is not there keeps the browser menu', () => {
  const p = page();
  const event = p.rightClick(p.get('t2name'));
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(p.clicks, []);
});

test('right-clicking a message opens the menu behind the last button of its toolbar', () => {
  const p = page();
  const event = p.rightClick(p.get('m1text'));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(p.clicks, ['m1more']);
});

test('the menu button is picked by what it is, not by its place', () => {
  const p = page();
  p.rightClick(p.get('m3text'));
  assert.deepEqual(p.clicks, ['m3menu']);
});

test('when it is unclear which button is the menu, the browser menu stays', () => {
  const p = page();
  const event = p.rightClick(p.get('m2text'));
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(p.clicks, []);
});

test('links, pictures, dates and the message box keep the browser menu', () => {
  const p = page();
  for (const id of ['m1link', 'm1img', 'datetext', 'box']) {
    assert.equal(p.rightClick(p.get(id)).defaultPrevented, false, id);
  }
  assert.deepEqual(p.clicks, []);
});

test('text selected before the click keeps the browser menu (Copy)', () => {
  const p = page();
  p.window.getSelection().selectAllChildren(p.get('m1text'));
  const event = p.rightClick(p.get('m1text'));
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(p.clicks, []);
});

test('a second right-click on the same message closes the menu and shows the browser\'s', () => {
  const p = page();
  assert.equal(p.rightClick(p.get('m1text')).defaultPrevented, true);
  p.showMenu();
  const second = p.rightClick(p.get('m1text'));
  assert.equal(second.defaultPrevented, false);
  assert.equal(p.escapes.length, 1, 'Messenger\'s menu is dismissed');
  assert.deepEqual(p.clicks, ['m1more'], 'and not opened again');
});

test('right-clicking another message while a menu is open opens that message\'s menu', () => {
  const p = page();
  p.rightClick(p.get('m1text'));
  p.showMenu();
  assert.equal(p.rightClick(p.get('m3text')).defaultPrevented, true);
  assert.deepEqual(p.clicks, ['m1more', 'm3menu']);
});
test('closing the menu with Escape forgets the message, so the next right-click opens its menu again', () => {
  const p = page();
  p.rightClick(p.get('m1text'));
  const menu = p.showMenu();
  p.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  menu.remove();
  assert.equal(p.rightClick(p.get('m1text')).defaultPrevented, true);
  assert.deepEqual(p.clicks, ['m1more', 'm1more']);
});
