import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('./notifications.js', import.meta.url), 'utf8');

function createPage({
  url = 'https://www.messenger.com/t/1',
  enabled = true,
  browserNotificationFails = false,
  notificationPermission = 'granted',
} = {}) {
  const events = [];
  const handlers = new Map();
  const timers = [];
  const rows = [];
  const location = new URL(url);
  const window = {
    addEventListener(name, cb) { handlers.set('window:' + name, cb); },
  };
  window.top = window;
  if (enabled) {
    window.__TAURI_INTERNALS__ = {
      invoke(name, input) {
        events.push({ name, event: input.event });
        return Promise.resolve();
      },
    };
  }
  class NativeNotification {
    constructor(title) {
      if (browserNotificationFails) throw new Error('notification unsupported');
      this.title = title;
    }
  }
  NativeNotification.permission = notificationPermission;
  window.Notification = NativeNotification;
  const document = {
    readyState: 'complete',
    hidden: false,
    hasFocus: () => true,
    querySelectorAll(selector) { return selector === 'a[href*="/t/"]' ? rows.map((r) => r.anchor) : []; },
    querySelector(selector) {
      return selector.includes('navigation') ? { available: true } : null;
    },
    addEventListener(name, cb) { handlers.set('document:' + name, cb); },
  };
  vm.runInNewContext(script, {
    window, document, location, Notification: NativeNotification, URL,
    MutationObserver: class {
      constructor(cb) { handlers.set('mutation', cb); }
      observe() {}
    },
    setTimeout(cb) { timers.push(cb); },
    Math, Promise, Reflect,
  });
  return {
    events, window, document, location, handlers,
    flush() {
      let runs = 0;
      while (timers.length) {
        assert.ok(++runs < 20);
        timers.shift()();
      }
    },
    addThread(id, label) {
      const row = {
        getAttribute(name) { return name === 'aria-label' ? label : null; },
        querySelectorAll() { return []; },
      };
      const anchor = {
        href: 'https://www.messenger.com/t/' + id,
        getAttribute(name) { return name === 'aria-label' ? '' : null; },
        closest() { return row; },
      };
      rows.push({ row, anchor });
    },
    clear() { rows.length = 0; },
    refresh() {
      handlers.get('mutation')();
      this.flush();
    },
  };
}

test('origin restricts native messaging and refuses nested iframes', () => {
  for (const url of ['https://evil.example/t/1', 'http://www.messenger.com/t/1',
    'https://www.messenger.com.evil.example/t/1']) {
    const p = createPage({ url });
    assert.equal(p.window.__mewNotificationsInstalled, undefined);
    assert.equal(p.handlers.size, 0);
  }
});

test('unread badge counts unique conversations with explicit unread markers only', () => {
  const p = createPage();
  p.addThread('a', 'Unread message');
  p.addThread('a', 'Unread message');
  p.addThread('b', 'Tin nhắn chưa đọc');
  p.addThread('c', 'Seen');
  p.flush();
  const unread = p.events.find((e) => e.event.kind === 'unread');
  assert.deepEqual([...unread.event.threads].sort(), ['a', 'b']);
  p.clear();
  p.refresh();
  const last = p.events.at(-1);
  assert.equal(last.event.kind, 'unread');
  assert.equal(last.event.threads.length, 0);
});

test('does not invent nonzero unread counts if Messenger has no recognizable markers', () => {
  const p = createPage();
  p.addThread('a', 'Conversation');
  p.flush();
  const reports = p.events.filter((e) => e.event.kind === 'unread');
  assert.equal(reports.every((e) => e.event.threads.length === 0), true);
});

test('normal working Web Notifications are not duplicated', () => {
  const p = createPage();
  p.flush();
  const notification = new p.window.Notification('Alice', { body: 'Hello' });
  assert.equal(notification.title, 'Alice');
  assert.equal(p.events.some((e) => e.event.kind === 'notify'), false);
});

test('failed Web Notifications fall back to native bridge with bounded fields', () => {
  const p = createPage({ browserNotificationFails: true });
  p.flush();
  assert.throws(() => new p.window.Notification('Alice', { body: 'Hello',
    tag: 'message-123', data: { threadId: 't123' } }));
  const toast = p.events.find((e) => e.event.kind === 'notify');
  assert.equal(toast.name, 'notification_event');
  assert.equal(toast.event.title, 'Alice');
  assert.equal(toast.event.body, 'Hello');
  assert.equal(toast.event.thread_id, 't123');
  assert.equal(toast.event.id, 'tag:message-123');
});

test('denied notification permission is not bypassed by desktop fallback', () => {
  const p = createPage({ browserNotificationFails: true, notificationPermission: 'denied' });
  p.flush();
  assert.throws(() => new p.window.Notification('Alice', { body: 'Hello' }));
  assert.equal(p.events.some((e) => e.event.kind === 'notify'), false);
});

test('reading an active thread only clears its local mapping', () => {
  const p = createPage();
  p.flush();
  assert.ok(p.events.some((e) => e.event.kind === 'read' && e.event.thread_id === '1'));
  p.document.hidden = true;
  p.location.pathname = '/t/2';
  p.handlers.get('document:visibilitychange')();
  p.flush();
  assert.equal(p.events.some((e) => e.event.kind === 'read' && e.event.thread_id === '2'), false);
});

test('leaving Messenger resets native unread and notification state', () => {
  const p = createPage();
  p.flush();
  p.handlers.get('window:pagehide')();
  assert.equal(p.events.at(-1).event.kind, 'reset');
});

test('no desktop command exposure means app keeps the Messenger page functioning', () => {
  const p = createPage({ enabled: false, browserNotificationFails: true });
  p.addThread('a', 'Unread');
  p.flush();
  assert.equal(p.events.length, 0);
  assert.throws(() => new p.window.Notification('Alice'));
});

test('only the scoped Messenger command is granted to remote content', () => {
  const settings = JSON.parse(fs.readFileSync(
    new URL('../capabilities/messenger-notifications.json', import.meta.url), 'utf8'));
  assert.equal(settings.local, false);
  assert.deepEqual(settings.webviews, ['messenger']);
  assert.equal(settings.windows, undefined);
  assert.deepEqual(settings.permissions, ['allow-notification-event']);
  assert.deepEqual(settings.remote.urls, [
    'https://www.messenger.com/*', 'https://messenger.com/*',
  ]);
  const local = JSON.parse(fs.readFileSync(
    new URL('../capabilities/default.json', import.meta.url), 'utf8'));
  const credits = JSON.parse(fs.readFileSync(
    new URL('../capabilities/credits.json', import.meta.url), 'utf8'));
  assert.deepEqual(local.webviews, ['status']);
  assert.equal(local.windows, undefined);
  assert.deepEqual(local.permissions, ['core:default', 'allow-show-credits', 'allow-current-status']);
  assert.deepEqual(credits.webviews, ['credits']);
  assert.equal(credits.windows, undefined);
  assert.equal(credits.remote, undefined);
  assert.deepEqual(credits.permissions, ['core:app:allow-version']);
  const desktop = JSON.parse(fs.readFileSync(
    new URL('../capabilities/desktop.json', import.meta.url), 'utf8'));
  const config = JSON.parse(fs.readFileSync(
    new URL('../tauri.conf.json', import.meta.url), 'utf8'));
  assert.deepEqual(desktop.webviews, ['status']);
  assert.deepEqual(desktop.permissions, []);
  assert.equal(config.app.withGlobalTauri, false);
  assert.equal(config.build.devUrl, 'http://localhost:1420');
});
