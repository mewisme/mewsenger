import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import vm from 'node:vm';

const script = readFileSync(new URL('./desktop.js', import.meta.url), 'utf8');

function page(url = 'https://www.messenger.com/t/123') {
  const handlers = new Map();
  const timers = [];
  const state = { field: null, image: null, dialog: null, search: null, chats: [], account: null, logout: null, newChat: null };
  class Element {
    constructor() {
      this.style = { transform: '', transformOrigin: '', transition: '', cursor: '' };
      this.isConnected = true;
      this.clicked = 0;
      this.focused = 0;
      this.textContent = '';
    }
    getBoundingClientRect() { return { width: 400, height: 300, left: 20, top: 20, right: 420, bottom: 320 }; }
    closest(selector) {
      if (selector.includes('main') || selector.includes('navigation')) return {};
      if (selector.includes('dialog')) return state.dialog;
      if (selector.includes('input')) return this === state.search ? this : null;
      if (selector.includes('a[href*="/t/"]')) return this.href?.includes('/t/') ? this : null;
      return null;
    }
    click() { this.clicked++; }
    focus() { this.focused++; document.activeElement = this; }
    addEventListener(name, cb) { handlers.set('viewer:' + name, cb); }
    removeEventListener(name) { handlers.delete('viewer:' + name); }
  }
  const document = {
    readyState: 'complete', hidden: false, body: new Element(), documentElement: new Element(),
    activeElement: null,
    hasFocus() { return true; },
    querySelector(selector) { return selector.includes('dialog') ? state.dialog : null; },
    querySelectorAll(selector) {
      if (selector.startsWith('[contenteditable')) return state.field ? [state.field] : [];
      if (selector === '[role="dialog"] img') return state.image ? [state.image] : [];
      if (selector.includes('input[type="search"]')) return state.search ? [state.search] : [];
      if (selector === 'a[href*="/t/"]') return state.chats;
      if (selector === 'a[href*="/new"]') return state.newChat ? [state.newChat] : [];
      if (selector.startsWith('[aria-label')) return state.account ? [state.account] : [];
      if (selector.startsWith('[role="menuitem"]')) return state.logout ? [state.logout] : [];
      return [];
    },
    addEventListener(name, fn) { handlers.set('document:' + name, fn); },
  };
  document.activeElement = document.body;
  const window = {
    addEventListener(name, fn) { handlers.set('window:' + name, fn); },
  };
  window.top = window;
  const location = new URL(url);
  vm.runInNewContext(script, {
    window, location, document, MutationObserver: class {
      constructor(fn) { state.observe = fn; }
      observe() {}
    },
    navigator: { platform: 'Win32' },
    URL, innerWidth: 1200, innerHeight: 800,
    setTimeout(fn) { timers.push(fn); },
  });
  const flush = () => {
    let count = 0;
    while (timers.length) {
      assert.ok(++count < 20, 'Unexpected repeating timer');
      timers.shift()();
    }
  };
  const fire = (name, properties = {}) => {
    const event = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...properties,
    };
    handlers.get(name)?.(event);
    return event;
  };
  return { state, window, document, location, Element, handlers, flush, fire };
}

test('desktop enhancement never runs on third-party pages or non-HTTPS', () => {
  for (const url of ['https://www.facebook.com/messages', 'https://messenger.com.evil.example/', 'http://www.messenger.com/']) {
    const p = page(url);
    assert.equal(p.window.__mewDesktopInstalled, undefined);
    assert.equal(p.handlers.size, 0);
  }
});

test('focuses composer after thread mount without taking search focus', () => {
  const p = page('https://www.messenger.com/t/123');
  const field = new p.Element();
  p.state.field = field;
  p.flush();
  assert.equal(field.focused, 1);
  const search = new p.Element();
  p.state.search = search;
  p.document.activeElement = search;
  p.location.pathname = '/t/456';
  p.state.observe();
  p.flush();
  assert.equal(field.focused, 1, 'must not steal focus from search');
});

test('focuses the composer after clicking a chat navigation link', () => {
  const p = page();
  const field = new p.Element();
  p.state.field = field;
  p.flush();
  const navLink = new p.Element();
  navLink.href = 'https://www.messenger.com/t/456';
  p.document.activeElement = navLink;
  p.location.pathname = '/t/456';
  p.state.observe();
  p.flush();
  assert.equal(field.focused, 2);
});

test('Ctrl+K focuses search; Ctrl+Alt+Down skips active composer', () => {
  const p = page();
  const search = new p.Element();
  p.state.search = search;
  p.flush();
  const e = p.fire('document:keydown', { key: 'k', ctrlKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(search.focused, 1);
  const chat = new p.Element();
  chat.href = 'https://www.messenger.com/t/999';
  p.state.chats = [chat];
  p.fire('document:keydown', { key: 'ArrowDown', ctrlKey: true, altKey: true });
  assert.equal(chat.clicked, 0, 'typing or searching must not navigate chats');
});

test('photo double click zooms and native action resets without touching chat scroll', () => {
  const p = page();
  const dialog = new p.Element();
  const image = new p.Element();
  image.naturalWidth = 1200;
  image.naturalHeight = 800;
  p.state.dialog = dialog;
  p.state.image = image;
  p.flush();
  assert.ok(p.handlers.has('viewer:wheel'));
  p.fire('document:dblclick', { clientX: 150, clientY: 150 });
  assert.match(image.style.transform, /scale\(2\.5\)/);
  const e = p.fire('viewer:wheel', { ctrlKey: false, deltaX: 0, deltaY: 100, clientX: 150, clientY: 150 });
  assert.equal(e.defaultPrevented, true);
  assert.equal(p.window.__mewDesktopAction('zoom-reset'), true);
  assert.equal(image.style.transform, '');
  p.state.dialog = null;
  p.state.image = null;
  p.state.observe();
  p.flush();
  assert.ok(!p.handlers.has('viewer:wheel'));
});

test('account and sign out use only Messenger controls, never clear cookies', () => {
  const p = page();
  const account = new p.Element();
  const logout = new p.Element();
  logout.textContent = 'Đăng xuất';
  p.state.account = account;
  p.state.logout = logout;
  p.flush();
  assert.equal(p.window.__mewDesktopAction('logout'), true);
  p.flush();
  assert.equal(account.clicked, 1);
  assert.equal(logout.clicked, 1);
  assert.equal(p.window.__mewDesktopAction('unrecognized-command'), false);
});

test('new message uses existing Messenger link and stays inactive if missing', () => {
  const p = page();
  p.flush();
  assert.equal(p.window.__mewDesktopAction('new-chat'), false);
  const newChat = new p.Element();
  p.state.newChat = newChat;
  assert.equal(p.window.__mewDesktopAction('new-chat'), true);
  assert.equal(newChat.clicked, 1);
});