import vm from 'node:vm';
import { Listeners } from './listeners.mjs';
import { script } from './inject-source.mjs';
import { fakeElement } from './fake-element.mjs';
import { site } from './site-fixture.mjs';

// A Messenger page with a fake clock, the native bridge recorded in `events`,
// and a stand-in for Facebook's module loader (define / run).
export function createPage({
  url = 'https://www.messenger.com/t/1',
  siteProfile = site,
  permission = 'granted',
  modules = null,
  now = 1_000_000,
  prefs = null,
} = {}) {
  const events = [];
  const handlers = new Listeners();
  const timers = [];
  const appended = [];
  const blobs = [];
  const clock = { now };
  const rows = [];
  let focused = true;
  const location = new URL(url);

  const window = { addEventListener(name, cb) { handlers.set('window:' + name, cb); } };
  window.top = window;
  if (siteProfile) window.__MEW_SITE__ = siteProfile;
  if (prefs) window.__MEW_PREFS = prefs;
  window.__TAURI_INTERNALS__ = {
    invoke(name, input) {
      events.push({ name, event: input.event });
      return Promise.resolve();
    },
  };
  class NativeNotification {
    constructor(title) { this.title = title; NativeNotification.made.push(title); }
  }
  NativeNotification.made = [];
  NativeNotification.permission = permission;
  window.Notification = NativeNotification;
  if (modules) window.require = (name) => (name in modules ? modules[name] : undefined);

  const document = {
    readyState: 'complete',
    hidden: false,
    hasFocus: () => focused,
    head: { append: (element) => appended.push(element) },
    createElement: () => fakeElement(),
    querySelectorAll(selector) {
      return selector === 'a[href*="/t/"]' ? rows.map((r) => r.anchor) : [];
    },
    querySelector: () => null,
    addEventListener(name, cb) { handlers.set('document:' + name, cb); },
  };
  class FakeURL extends URL {
    static createObjectURL() { return 'blob:fake'; }
    static revokeObjectURL() {}
  }
  class FakeBlob { constructor(parts) { blobs.push(parts.join('')); } }
  class FakeDate extends Date { static now() { return clock.now; } }

  // Sockets and ports as the page's code sees them: what reaches `send` /
  // `postMessage` is what would go to the network.
  const wire = { frames: [], messages: [] };
  class FakeWebSocket {
    constructor(address) { this.url = address; }
    send(data) { wire.frames.push({ url: this.url, data }); }
  }
  class FakeMessagePort {
    postMessage(message) { wire.messages.push(message); }
  }

  vm.runInNewContext(script, {
    window, document, location, Notification: NativeNotification,
    WebSocket: FakeWebSocket, MessagePort: FakeMessagePort,
    TextEncoder, TextDecoder, ArrayBuffer, Uint8Array,
    requestAnimationFrame: (cb) => setImmediate(cb), cancelAnimationFrame() {},
    setInterval() { return 0; }, clearInterval() {},
    URL: FakeURL, Blob: FakeBlob, Date: FakeDate,
    navigator: { platform: 'Win32' },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() { handlers.set('mutation', this.cb); }
    },
    setTimeout(cb, ms = 0) { timers.push({ cb, at: clock.now + ms }); return timers.length; },
    clearTimeout() {},
    getComputedStyle: (el) => ({ fontWeight: String(el.weight ?? 400) }),
    KeyboardEvent: class {},
    Element: class {},
  });

  // Plain copies: objects made inside the page belong to another realm.
  const sent = (kind) => events
    .filter(({ event }) => event.kind === kind)
    .map(({ event }) => JSON.parse(JSON.stringify(event)));
  const loader = new Map();
  const page = {
    events, window, document, location, handlers, appended, blobs, clock, NativeNotification, wire,
    socket: (address) => new FakeWebSocket(address),
    port: () => new FakeMessagePort(),
    notifies: () => sent('notify'),
    // Lets time pass: due timers run in order, with the promises they start.
    async advance(ms) {
      const end = clock.now + ms;
      for (let guard = 0; guard < 500; guard += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers.splice(timers.indexOf(next), 1);
        clock.now = Math.max(clock.now, next.at);
        next.cb();
      }
      clock.now = end;
      await new Promise((resolve) => setImmediate(resolve));
    },
    addThread(id, label) {
      const row = {
        getAttribute: (name) => (name === 'aria-label' ? label : null),
        querySelectorAll: () => [],
        textContent: '',
      };
      rows.push({ row, anchor: { href: `https://www.messenger.com/t/${id}`, getAttribute: () => '', closest: () => row } });
    },
    // What the app does when a preference changes.
    applyPrefs(next) { window.__mewApplyPrefs?.(next); },
    blur() { focused = false; handlers.get('window:blur')?.(); },
    // Facebook's loader: its __d is assigned once, after the page script ran.
    installLoader() {
      window.__d = (name, deps, factory) => loader.set(name, factory);
    },
    define(name, factory) { window.__d(name, [], factory); },
    // Runs a defined module's factory the way the loader does; returns its exports.
    run(name, require = () => null) {
      const exports = {};
      loader.get(name)(window, require, {}, exports);
      return exports;
    },
  };
  return page;
}

// Facebook's minified popper hook: the two checks that decide whether
// Messenger raises its own notifications.
export const POPPER_SOURCE = `(function (global, require, module, exports) {
  var hidden = require("VisibilityAPI").isVisibilityHidden()===!0;
  var app = require("isMessengerPWA")()&&require("justknobx")._("1465");
  exports.raises = hidden && app;
})`;

// Defines the popper module and lets its rewritten source arrive, as the
// browser would run the blob script.
export function activateRewrite(page, view = { hasFocus: () => false }) {
  page.installLoader();
  page.define('useMWLSChatPopperUpper', vm.runInNewContext(POPPER_SOURCE));
  const carried = {};
  vm.runInNewContext(page.blobs.at(-1), { window: carried, document: view });
  const [key] = Object.keys(carried);
  page.window[key] = carried[key];
  page.appended.at(-1).onload();
}

// A stand-in for the modules of Messenger's local database and its unread test.
export function facebookModules(page, { chats = [], contacts = [], participants = [], broken = false } = {}) {
  const id = (value) => String(Array.isArray(value) ? (BigInt(value[0]) << 32n) + BigInt(value[1]) : value);
  const query = (rows, keyOf, key) => ({ rows, keyOf, key });
  const tables = {
    threads: { rows: chats, keyOf: (row) => [row.threadKey] },
    contacts: { rows: contacts, keyOf: (row) => [row.id] },
    participants: { rows: participants, keyOf: (row) => [row.threadKey, row.senderId] },
  };
  const modules = {
    Bootloader: { loadModules: (_names, done) => done() },
    ServerTime: { getMillis: () => page.clock.now },
    ReQL: broken ? undefined : {
      fromTableAscending: (table) => ({
        ...query(table.rows, table.keyOf),
        getKeyRange: (...key) => query(table.rows, table.keyOf, key),
      }),
      firstAsync: async (q) => q.rows.find((row) => q.keyOf(row).map(id).join() === q.key.map(id).join()),
      toArrayAsync: async (q) => q.rows,
    },
    LSDatabaseSingleton: { LSDatabaseSingleton: Promise.resolve({ tables }) },
    MWPIsThreadUnread: { isThreadUnreadForViewer: (chat) => chat.unread === true },
    LSMessagingThreadTypeUtil: { isGroup: (type) => type === 'group' },
  };
  return { modules, db: { tables } };
}
