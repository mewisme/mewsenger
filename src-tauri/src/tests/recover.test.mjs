import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'vitest';
import { Listeners } from './listeners.mjs';
import { part } from './inject-source.mjs';

// Only the parts recovery builds on, joined as build.rs joins them.
const script = `(() => {\n${['00-guard', '20-top-frame', '22-ipc', '24-dom', '26-prefs', '30-fb-modules', '90-recover']
  .map((name) => part(`${name}.js`).trimEnd() + '\n')
  .join('')}})();\n`;
import { site } from './site-fixture.mjs';

// A Messenger page with a fake clock that can also "sleep" (timers stop while
// the clock jumps), a message box, a reload counter and a session storage that
// outlives the page, as a tab's does across a reload.
function recoverPage({
  url = 'https://www.messenger.com/t/1',
  prefs = null,
  storage = new Map(),
  now = 1_000_000,
  answers = true,
  online = true,
  // (no options for sockets: the page always has a constructor)
} = {}) {
  const clock = { now };
  const timers = [];
  const handlers = new Listeners();
  const state = { reloads: 0, text: '', answers, online };
  const box = {
    get textContent() { return state.text; },
    getBoundingClientRect: () => ({ width: 100 }),
    closest: () => ({}),
  };
  const location = new URL(url);
  location.reload = () => { state.reloads += 1; };
  const timer = (cb, ms, every = 0) => { timers.push({ cb, at: clock.now + ms, every }); return timers.length; };
  const window = {
    addEventListener(name, cb) { handlers.set(`window:${name}`, cb); },
    setTimeout: (cb, ms = 0) => timer(cb, ms),
    setInterval: (cb, ms) => timer(cb, ms, ms),
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    __MEW_SITE__: site,
    __TAURI_INTERNALS__: { invoke: () => Promise.resolve() },
  };
  window.top = window;
  if (prefs) window.__MEW_PREFS = prefs;

  const opened = [];
  {
    window.WebSocket = class {
      send() {}
      constructor(address) {
        opened.push(this);
        this.address = address;
        this.listeners = new Listeners();
      }
      addEventListener(name, cb) { this.listeners.set(name, cb); }
      fire(name) { this.listeners.get(name)?.(); }
    };
  }
  const document = {
    readyState: 'complete',
    hidden: false,
    hasFocus: () => true,
    head: { append() {} },
    createElement: () => ({ remove() {} }),
    querySelectorAll: (selector) => (selector.includes('contenteditable') ? [box] : []),
    querySelector: () => null,
    addEventListener(name, cb) { handlers.set(`document:${name}`, cb); },
  };
  class FakeDate extends Date { static now() { return clock.now; } }
  const loader = new Map();
  vm.runInNewContext(script, {
    window, document, location, Date: FakeDate, URL, Blob,
    Notification: class { static permission = 'granted'; },
    navigator: { platform: 'Win32', get onLine() { return state.online; } },
    MutationObserver: class { constructor(cb) { handlers.set('mutation', cb); } observe() {} },
    setTimeout: window.setTimeout,
    clearTimeout() {},
    getComputedStyle: () => ({ fontWeight: '400' }),
    KeyboardEvent: class {},
    Element: class {},
    WebSocket: window.WebSocket,
    AbortController,
    fetch: () => (state.answers ? Promise.resolve({ ok: true }) : Promise.reject(new Error('offline'))),
  });

  const page = {
    window, state, storage, clock, opened,
    async advance(ms) {
      const end = clock.now + ms;
      for (let guard = 0; guard < 2000; guard += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        clock.now = Math.max(clock.now, next.at);
        if (next.every) next.at += next.every;
        else timers.splice(timers.indexOf(next), 1);
        next.cb();
      }
      clock.now = end;
      await new Promise((resolve) => setImmediate(resolve));
    },
    // The computer sleeps: the clock moves, no timer runs.
    sleep(ms) {
      clock.now += ms;
      for (const t of timers) t.at += ms;
    },
    applyPrefs: (next) => window.__mewApplyPrefs(next),
    // Facebook's loader, assigned after the page script ran; returns the exports.
    defineAndRun(name, factory) {
      if (!window.__d) window.__d = (n, deps, f) => loader.set(n, f);
      window.__d(name, [], factory);
      const exports = {};
      loader.get(name)(window, () => null, {}, exports);
      return exports;
    },
  };
  return page;
}

const SLEPT = 10 * 60_000;
// One tick, then a sleep, then the tick that notices it.
async function sleepThrough(page) {
  await page.advance(20_000);
  page.sleep(SLEPT);
  await page.advance(15_000);
}

test('after the computer slept the page reloads once, when the message box is empty', async () => {
  const page = recoverPage();
  await sleepThrough(page);
  await page.advance(60_000);
  assert.equal(page.state.reloads, 1);
  await page.advance(5 * 60_000);
  assert.equal(page.state.reloads, 1, 'not reloaded again');
});

test('a message being typed holds the reload until the box is empty', async () => {
  const page = recoverPage();
  page.state.text = 'half a message';
  await sleepThrough(page);
  await page.advance(3 * 60_000);
  assert.equal(page.state.reloads, 0);
  page.state.text = '  ';
  await page.advance(10_000);
  assert.equal(page.state.reloads, 1);
});

test('a short pause is not a sleep', async () => {
  const page = recoverPage();
  await page.advance(20_000);
  page.sleep(60_000);
  await page.advance(5 * 60_000);
  assert.equal(page.state.reloads, 0);
});

test('with automatic recovery off nothing is reloaded, and switching it off stops a waiting reload', async () => {
  const off = recoverPage({ prefs: { autoRecover: false } });
  await sleepThrough(off);
  await off.advance(3 * 60_000);
  assert.equal(off.state.reloads, 0);

  const page = recoverPage();
  page.state.text = 'typing';
  await sleepThrough(page);
  page.applyPrefs({ autoRecover: false });
  page.state.text = '';
  await page.advance(2 * 60_000);
  assert.equal(page.state.reloads, 0);
});

test('switching it on later makes the next sleep recover', async () => {
  const page = recoverPage({ prefs: { autoRecover: false } });
  page.applyPrefs({ autoRecover: true });
  await sleepThrough(page);
  await page.advance(60_000);
  assert.equal(page.state.reloads, 1);
});

test('a reload comes at most every two minutes, counted across the reload itself', async () => {
  const first = recoverPage();
  await sleepThrough(first);
  await first.advance(60_000);
  assert.equal(first.state.reloads, 1);

  // The error screen shows 40 s into a page opened 30 s after the reload.
  const soon = recoverPage({ storage: first.storage, now: first.clock.now + 30_000 });
  const screen = errorScreen(soon);
  await soon.advance(40_000);
  screen.default(new Error('x'));
  await soon.advance(2 * 60_000);
  assert.equal(soon.state.reloads, 0, 'a second reload within two minutes of the first');

  const later = recoverPage({ storage: first.storage, now: first.clock.now + 10 * 60_000 });
  await sleepThrough(later);
  await later.advance(60_000);
  assert.equal(later.state.reloads, 1);
});

test('never on a login or checkpoint page', async () => {
  for (const path of ['/login', '/checkpoint/1501092823525282/']) {
    const page = recoverPage({ url: `https://www.messenger.com${path}` });
    await sleepThrough(page);
    await page.advance(3 * 60_000);
    assert.equal(page.state.reloads, 0, path);
  }
});

test('waits while offline or while Facebook does not answer', async () => {
  const page = recoverPage({ online: false });
  await sleepThrough(page);
  await page.advance(2 * 60_000);
  assert.equal(page.state.reloads, 0);
  page.state.online = true;
  page.state.answers = false;
  await page.advance(2 * 60_000);
  assert.equal(page.state.reloads, 0);
  page.state.answers = true;
  await page.advance(10_000);
  assert.equal(page.state.reloads, 1);
});

const errorScreen = (page) => page.defineAndRun('getMWErrorDefinition', (global, require, module, exports) => {
  exports.default = (error) => (error ? { title: 'Could not load chats', action: { label: 'Reload' } } : { title: 'fine' });
});

test("Messenger's error screen is reloaded once; coming back soon after it is left alone", async () => {
  const page = recoverPage();
  const exports = errorScreen(page);
  await page.advance(40_000);
  assert.equal(exports.default(new Error('x')).title, 'Could not load chats', 'the screen itself is unchanged');
  exports.default(new Error('x'));
  await page.advance(60_000);
  assert.equal(page.state.reloads, 1);

  const again = recoverPage({ storage: page.storage, now: page.clock.now + 3 * 60_000 });
  const second = errorScreen(again);
  await again.advance(40_000);
  second.default(new Error('x'));
  await again.advance(2 * 60_000);
  assert.equal(again.state.reloads, 0, 'Messenger\'s own Reload is left to the user');

  const much = recoverPage({ storage: page.storage, now: page.clock.now + 15 * 60_000 });
  const third = errorScreen(much);
  await much.advance(40_000);
  third.default(new Error('x'));
  await much.advance(60_000);
  assert.equal(much.state.reloads, 1);
});

test('a definition without an action (no error screen) does not reload', async () => {
  const page = recoverPage();
  const exports = errorScreen(page);
  await page.advance(40_000);
  exports.default(null);
  await page.advance(2 * 60_000);
  assert.equal(page.state.reloads, 0);
});

test('a socket to Facebook that worked and stays down reloads the page; others do not', async () => {
  const page = recoverPage();
  const Socket = page.window.WebSocket;
  const other = new Socket('wss://example.com/ws/chat');
  other.fire('open');
  other.fire('close');
  const never = new Socket('wss://gateway.facebook.com/ws/never');
  assert.ok(never);
  await page.advance(5 * 60_000);
  assert.equal(page.state.reloads, 0, 'foreign and never-opened sockets are ignored');

  const live = new Socket('wss://gateway.facebook.com/ws/realtime?x=1');
  assert.ok(live instanceof Socket);
  live.fire('open');
  await page.advance(2 * 60_000);
  assert.equal(page.state.reloads, 0, 'an open socket is fine');
  live.fire('close');
  await page.advance(3 * 60_000);
  assert.equal(page.state.reloads, 1);
});

test('a socket that came back before the wait ended is not a reason', async () => {
  const page = recoverPage();
  const Socket = page.window.WebSocket;
  const live = new Socket('wss://gateway.facebook.com/ws/realtime');
  live.fire('open');
  live.fire('close');
  await page.advance(20_000);
  const fresh = new Socket('wss://gateway.facebook.com/ws/realtime');
  fresh.fire('open');
  await page.advance(5 * 60_000);
  assert.equal(page.state.reloads, 0);
});
