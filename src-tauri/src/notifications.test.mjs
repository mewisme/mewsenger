import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import vm from 'node:vm';
import { site, facebookSite } from './site-fixture.mjs';

const script = fs.readFileSync(new URL('./notifications.js', import.meta.url), 'utf8');

function createPage({
  url = 'https://www.messenger.com/t/1',
  enabled = true,
  browserNotificationFails = false,
  notificationPermission = 'granted',
  siteProfile = site,
  threadBase = 'https://www.messenger.com/t/',
} = {}) {
  const events = [];
  const handlers = new Map();
  const timers = [];
  const rows = [];
  let focused = true;
  const location = new URL(url);
  const window = {
    addEventListener(name, cb) { handlers.set('window:' + name, cb); },
  };
  window.top = window;
  if (siteProfile) window.__MEW_SITE__ = siteProfile;
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
  let composerEl = null;
  const document = {
    readyState: 'complete',
    hidden: false,
    hasFocus: () => focused,
    querySelectorAll(selector) {
      if (selector.startsWith('[contenteditable')) return composerEl ? [composerEl] : [];
      return selector === 'a[href*="/t/"]' ? rows.map((r) => r.anchor) : [];
    },
    execCommand(command, _ui, value) {
      if (!composerEl) return false;
      if (command === 'insertText') composerEl.textContent = composerEl.insertWorks === false ? composerEl.textContent : value;
      if (command === 'delete') composerEl.textContent = '';
      return true;
    },
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
    getComputedStyle: (el) => ({ fontWeight: String(el.weight ?? 400) }),
    KeyboardEvent: class {
      constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    },
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
    addThread(id, label, { weight, rowless = false } = {}) {
      const leaves = weight ? [{ children: { length: 0 }, textContent: 'snippet', weight }] : [];
      const row = {
        getAttribute(name) { return name === 'aria-label' ? label : null; },
        querySelectorAll(selector) { return selector === 'span,div' ? leaves : []; },
        textContent: '',
      };
      const anchor = {
        href: threadBase + id,
        getAttribute(name) { return name === 'aria-label' ? '' : null; },
        closest() { return rowless ? null : row; },
      };
      rows.push({ row, anchor });
    },
    clear() { rows.length = 0; },
    blur() {
      focused = false;
      handlers.get('window:blur')?.();
      this.flush();
    },
    focus() {
      focused = true;
      handlers.get('window:focus')?.();
      this.flush();
    },
    refresh() {
      handlers.get('mutation')();
      this.flush();
    },
    setComposer(element) { composerEl = element; },
    async settle() {
      for (let turn = 0; turn < 400; turn += 1) {
        while (timers.length) timers.shift()();
        await new Promise((resolve) => setImmediate(resolve));
      }
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

test('a bold snippet marks a row unread without any localized phrase', () => {
  const p = createPage();
  p.addThread('a', 'Alice', { weight: 700 });
  p.addThread('b', 'Bob', { weight: 400 });
  p.flush();
  const unread = p.events.find((e) => e.event.kind === 'unread');
  assert.deepEqual([...unread.event.threads], ['a']);
});

test('aggregate navigation links outside a conversation row never mark a thread unread', () => {
  const p = createPage();
  p.addThread('a', 'Chats · 2 unread messages', { rowless: true });
  p.addThread('b', 'Bob');
  p.flush();
  assert.equal(p.events.some((e) => e.event.kind === 'unread' && e.event.threads.length > 0), false);
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

test('blurred Messenger emits a generic native notification for newly unread conversations', () => {
  const p = createPage();
  p.addThread('old', 'Unread message');
  p.addThread('new', 'Seen');
  p.flush();
  assert.equal(p.events.some(({ event }) => event.kind === 'new_unread'), false);
  p.blur();
  p.clear();
  p.addThread('old', 'Unread message');
  p.addThread('new', 'Unread message');
  p.refresh();
  const arrivals = p.events.filter(({ event }) => event.kind === 'new_unread');
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].event.thread_id, 'new');
  assert.deepEqual(Object.keys(arrivals[0].event), ['kind', 'thread_id']);
  p.refresh();
  assert.equal(p.events.filter(({ event }) => event.kind === 'new_unread').length, 1);
});

test('hidden Messenger can report unread arrivals while in tray', () => {
  const p = createPage();
  p.addThread('a', 'Seen');
  p.flush();
  p.document.hidden = true;
  p.handlers.get('document:visibilitychange')();
  p.flush();
  p.clear();
  p.addThread('a', 'Unread message');
  p.refresh();
  assert.equal(p.events.filter(({ event }) => event.kind === 'new_unread').length, 1);
});

test('foreground and first loaded unread list never create native arrival toasts', () => {
  const p = createPage();
  p.addThread('a', 'Unread message');
  p.flush();
  p.clear();
  p.addThread('a', 'Unread message');
  p.addThread('b', 'Unread message');
  p.refresh();
  assert.equal(p.events.some(({ event }) => event.kind === 'new_unread'), false);
  const hidden = createPage();
  hidden.document.hidden = true;
  hidden.addThread('old', 'Unread message');
  hidden.flush();
  assert.equal(hidden.events.some(({ event }) => event.kind === 'new_unread'), false);
});

test('explicit browser notification denial suppresses generic unread fallback', () => {
  const p = createPage({ notificationPermission: 'denied' });
  p.addThread('a', 'Seen');
  p.flush();
  p.blur();
  p.clear();
  p.addThread('a', 'Unread message');
  p.refresh();
  assert.equal(p.events.some(({ event }) => event.kind === 'new_unread'), false);
});

test('focused chat alone does not falsely mark a notification as read', () => {
  const p = createPage();
  p.flush();
  assert.equal(p.events.some((e) => e.event.kind === 'read'), false);
});

test('a recognized unread marker disappearing from the focused chat clears only its mapping', () => {
  const p = createPage();
  p.addThread('1', 'Unread message');
  p.addThread('2', 'Unread message');
  p.flush();
  p.clear();
  p.addThread('1', 'Seen');
  p.addThread('2', 'Unread message');
  p.refresh();
  assert.ok(p.events.some((e) => e.event.kind === 'read' && e.event.thread_id === '1'));
  p.document.hidden = true;
  p.location.pathname = '/t/2';
  p.handlers.get('document:visibilitychange')();
  p.flush();
  assert.equal(p.events.some((e) => e.event.kind === 'read' && e.event.thread_id === '2'), false);
});

test('unread markers disappearing while chat is hidden do not mark it read', () => {
  const p = createPage();
  p.addThread('1', 'Unread message');
  p.flush();
  p.document.hidden = true;
  p.clear();
  p.addThread('1', 'Seen');
  p.refresh();
  assert.equal(p.events.some((e) => e.event.kind === 'read'), false);
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
  assert.deepEqual(settings.webviews, ['messenger-*']);
  assert.equal(settings.windows, undefined);
  assert.deepEqual(settings.permissions, ['allow-notification-event']);
  assert.deepEqual(
    [...settings.remote.urls].sort(),
    site.app_hosts.map((host) => `https://${host}/*`).sort(),
  );
  const local = JSON.parse(fs.readFileSync(
    new URL('../capabilities/default.json', import.meta.url), 'utf8'));
  assert.deepEqual(local.webviews, ['status-*']);
  assert.equal(local.windows, undefined);
  assert.deepEqual(local.permissions, [
    'core:default', 'allow-show-settings', 'allow-reveal-last-download',
    'allow-get-update-state', 'allow-check-update', 'allow-install-update',
  ]);
  const desktop = JSON.parse(fs.readFileSync(
    new URL('../capabilities/desktop.json', import.meta.url), 'utf8'));
  const config = JSON.parse(fs.readFileSync(
    new URL('../tauri.conf.json', import.meta.url), 'utf8'));
  assert.deepEqual(desktop.webviews, ['status-*']);
  assert.deepEqual(desktop.permissions, []);
  const titlebar = JSON.parse(fs.readFileSync(
    new URL('../capabilities/titlebar.json', import.meta.url), 'utf8'));
  assert.deepEqual(titlebar.webviews, ['titlebar-*']);
  assert.equal(titlebar.windows, undefined);
  assert.equal(titlebar.remote, undefined);
  assert.ok(titlebar.permissions.includes('core:window:allow-start-dragging'));
  assert.ok(titlebar.permissions.includes('core:window:allow-close'));
  assert.equal(titlebar.permissions.includes('core:default'), false);
  assert.equal(config.app.withGlobalTauri, false);
  assert.equal(config.build.devUrl, 'http://localhost:14871');
});

test('script follows the configured site profile', () => {
  const messengerOnFacebookProfile = createPage({
    url: 'https://www.messenger.com/t/1', siteProfile: facebookSite,
  });
  assert.equal(messengerOnFacebookProfile.window.__mewNotificationsInstalled, undefined);
  assert.equal(messengerOnFacebookProfile.handlers.size, 0);

  const p = createPage({
    url: 'https://www.facebook.com/messages/t/1', siteProfile: facebookSite,
    threadBase: 'https://www.facebook.com/messages/t/',
  });
  assert.equal(p.window.__mewNotificationsInstalled, true);
  p.addThread('1', 'Unread message');
  p.refresh();
  assert.deepEqual(
    [...p.events.filter(({ event }) => event.kind === 'unread').at(-1).event.threads], ['1']);

  const inert = createPage({ siteProfile: null });
  assert.equal(inert.window.__mewNotificationsInstalled, undefined);
  assert.equal(inert.handlers.size, 0);
});

test('session state is reported once per change and only when recognized', () => {
  const p = createPage();
  p.flush();
  assert.equal(p.events.some((e) => e.event.kind === 'session'), false, 'no chats yet: unknown');
  p.addThread('a', 'Seen');
  p.refresh();
  p.refresh();
  const sessions = () => p.events.filter((e) => e.event.kind === 'session').map((e) => e.event.state);
  assert.deepEqual(sessions(), ['signed_in']);
});

test('the login page reports signed out', () => {
  const p = createPage({ url: 'https://www.messenger.com/login/' });
  p.flush();
  p.refresh();
  assert.deepEqual(
    p.events.filter((e) => e.event.kind === 'session').map((e) => e.event.state),
    ['signed_out'],
  );
});

test('a reloaded page re-baselines instead of announcing old unread conversations', () => {
  const p = createPage();
  p.blur();
  p.addThread('a', 'Unread message');
  p.refresh();
  assert.equal(p.events.some((e) => e.event.kind === 'new_unread'), false);
  p.addThread('b', 'Unread message');
  p.refresh();
  assert.deepEqual(
    p.events.filter((e) => e.event.kind === 'new_unread').map((e) => e.event.thread_id),
    ['b'],
  );
});

function fakeComposer({ text = '', sends = true, insertWorks = true } = {}) {
  const field = {
    textContent: text,
    insertWorks,
    keys: [],
    getBoundingClientRect: () => ({ width: 200 }),
    closest: () => ({}),
    focus() {},
    dispatchEvent(event) {
      this.keys.push(event.type);
      if (event.type === 'keydown' && event.key === 'Enter' && sends) {
        field.sent = field.textContent;
        field.textContent = '';
      }
      return true;
    },
  };
  return field;
}

const replyResults = (p) => p.events.filter((e) => e.event.kind === 'reply_result').map((e) => ({ ...e.event }));

test('quick reply types into the open conversation composer, presses Enter and reports success', async () => {
  const p = createPage();
  const field = fakeComposer();
  p.setComposer(field);
  assert.equal(p.window.__mewQuickReply({ thread: '1', text: 'ok', nonce: 'toast-9' }), true);
  await p.settle();
  assert.equal(field.sent, 'ok');
  assert.deepEqual(field.keys, ['keydown', 'keypress', 'keyup']);
  assert.deepEqual(replyResults(p), [{ kind: 'reply_result', nonce: 'toast-9', ok: true }]);
});

test('quick reply keeps the existing draft when the send does not go through', async () => {
  const p = createPage();
  const field = fakeComposer({ text: 'half-written', sends: false });
  p.setComposer(field);
  p.window.__mewQuickReply({ thread: '1', text: 'ok', nonce: 'toast-9' });
  await p.settle();
  assert.equal(field.textContent, 'half-written');
  assert.deepEqual(replyResults(p), [{ kind: 'reply_result', nonce: 'toast-9', ok: false, reason: 'send_failed' }]);
});

test('quick reply restores the draft after a successful send', async () => {
  const p = createPage();
  const field = fakeComposer({ text: 'draft' });
  p.setComposer(field);
  p.window.__mewQuickReply({ thread: '1', text: 'ok', nonce: 'toast-9' });
  await p.settle();
  assert.equal(field.sent, 'ok');
  assert.equal(field.textContent, 'draft');
  assert.equal(replyResults(p)[0].ok, true);
});

test('quick reply reports a missing conversation instead of typing elsewhere', async () => {
  const p = createPage();
  const field = fakeComposer();
  p.setComposer(field);
  p.window.__mewQuickReply({ thread: '77', text: 'ok', nonce: 'toast-3' });
  await p.settle();
  assert.equal(field.sent, undefined);
  assert.deepEqual(replyResults(p), [{ kind: 'reply_result', nonce: 'toast-3', ok: false, reason: 'thread_not_found' }]);
});

test('quick reply reports when the composer refuses the text', async () => {
  const p = createPage();
  const field = fakeComposer({ insertWorks: false });
  p.setComposer(field);
  p.window.__mewQuickReply({ thread: '1', text: 'ok', nonce: 'toast-4' });
  await p.settle();
  assert.equal(field.keys.length, 0);
  assert.equal(replyResults(p)[0].reason, 'insert_failed');
});

test('quick reply rejects malformed requests without queueing them', () => {
  const p = createPage();
  assert.equal(p.window.__mewQuickReply({ thread: '1', text: '', nonce: 'n' }), false);
  assert.equal(p.window.__mewQuickReply({ thread: '1', text: 'x'.repeat(2001), nonce: 'n' }), false);
  assert.equal(p.window.__mewQuickReply({ thread: '', text: 'x', nonce: 'n' }), false);
  assert.equal(p.window.__mewQuickReply(null), false);
});

const focusEvents = (p) => p.events.filter(({ event }) => event.kind === 'focus').length;

test('a page that loads focused reports focus once, and each regain reports once', () => {
  const p = createPage();
  assert.equal(focusEvents(p), 1);
  // Repeated focus events without a blur in between are one focus gain.
  p.focus();
  p.focus();
  assert.equal(focusEvents(p), 1);
  p.blur();
  assert.equal(focusEvents(p), 1);
  p.focus();
  assert.equal(focusEvents(p), 2);
  p.focus();
  assert.equal(focusEvents(p), 2);
});

test('blurring alone never reports focus', () => {
  const p = createPage();
  p.events.length = 0;
  p.blur();
  assert.equal(focusEvents(p), 0);
});
