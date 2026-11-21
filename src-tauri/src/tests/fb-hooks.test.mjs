import assert from 'node:assert/strict';
import { test } from 'vitest';
import { activateRewrite, createPage, facebookModules } from './page-harness.mjs';

const contacts = [{ id: 5, name: 'Alice' }, { id: 6, name: 'Bob' }];
const message = (page, overrides = {}) => ({
  messageId: 'mid.1', threadKey: 77, senderId: 5, timestampMs: page.clock.now - 1000, ...overrides,
});

// A page whose Messenger raises notifications, through the real patch of
// MWDesktopNotifications; `raise` is what Messenger's own trigger does.
async function awayPage(data = {}, { activate = true } = {}) {
  const modules = {};
  const page = createPage({ modules });
  const fb = facebookModules(page, data);
  Object.assign(modules, fb.modules);
  if (activate) activateRewrite(page);
  else page.installLoader();
  page.define('MWDesktopNotifications', (global, require, module, exports) => {
    exports.triggerLocalNotification = (_db, sent) => {
      new page.window.Notification('Alice', { body: sent.body ?? 'hi', tag: sent.messageId });
    };
  });
  const exports = page.run('MWDesktopNotifications');
  return { page, db: fb.db, trigger: (sent) => exports.triggerLocalNotification(fb.db, sent) };
}

const group = { threadKey: 77, threadType: 'group', threadName: 'Team', lastReadWatermarkTimestampMs: 0 };
const direct = { threadKey: 78, threadType: 'one', threadName: '', lastReadWatermarkTimestampMs: 0 };

test('while Messenger notifies, a group message reaches the app with the group and sender', async () => {
  const { page, trigger } = await awayPage({ chats: [group], contacts });
  await trigger(message(page));
  await page.advance(50);
  assert.deepEqual(page.notifies(), [
    { kind: 'notify', id: 'tag:mid.1', title: 'Team', body: 'Alice: hi', thread_id: '77' },
  ]);
  assert.deepEqual(page.NativeNotification.made, [], 'the browser notification is not also shown');
});

test('a message in a one-to-one chat keeps Messenger\'s text and gains the chat to open', async () => {
  const { page, trigger } = await awayPage({ chats: [direct], contacts });
  await trigger(message(page, { threadKey: 78 }));
  await page.advance(50);
  assert.deepEqual(page.notifies(), [
    { kind: 'notify', id: 'tag:mid.1', title: 'Alice', body: 'hi', thread_id: '78' },
  ]);
});

test('a nickname replaces the contact name in the group line', async () => {
  const participants = [{ threadKey: 77, senderId: 5, nickname: 'Al' }];
  const { page, trigger } = await awayPage({ chats: [group], contacts, participants });
  await trigger(message(page));
  await page.advance(50);
  assert.equal(page.notifies()[0].body, 'Al: hi');
});

test('an empty text still gets a body the app accepts', async () => {
  const { page, trigger } = await awayPage({ chats: [direct], contacts });
  await trigger(message(page, { threadKey: 78, body: '' }));
  await page.advance(50);
  assert.equal(page.notifies()[0].body, 'New message');
});

test('messages that arrive long after they were sent, or in a chat already read, are not notified', async () => {
  const { page, trigger } = await awayPage({
    chats: [group, { ...direct, lastReadWatermarkTimestampMs: 1_000_000 }], contacts,
  });
  await trigger(message(page, { timestampMs: page.clock.now - 3 * 60 * 1000 }));
  await trigger(message(page, { messageId: 'mid.2', threadKey: 78, timestampMs: page.clock.now - 10 }));
  await page.advance(50);
  assert.deepEqual(page.notifies(), []);
});

test('without database details the notification still goes out with Messenger\'s own text', async () => {
  const { page, trigger } = await awayPage({ chats: [group], contacts, broken: true });
  await trigger(message(page));
  await page.advance(1200);
  assert.deepEqual(page.notifies(), [
    { kind: 'notify', id: 'tag:mid.1', title: 'Alice', body: 'hi', thread_id: null },
  ]);
});

test('a denied notification permission is never bypassed', async () => {
  const modules = {};
  const page = createPage({ modules, permission: 'denied' });
  Object.assign(modules, facebookModules(page, { chats: [group], contacts }).modules);
  activateRewrite(page);
  new page.window.Notification('Alice', { body: 'hi', tag: 'mid.1' });
  await page.advance(1200);
  assert.deepEqual(page.notifies(), []);
});

test('until Messenger notifies while away, the browser notification is left as it was', async () => {
  const { page, trigger } = await awayPage({ chats: [group], contacts }, { activate: false });
  await trigger(message(page));
  await page.advance(50);
  assert.deepEqual(page.notifies(), []);
  assert.deepEqual(page.NativeNotification.made.filter((made) => made === 'Alice'), ['Alice']);
});

function rows(page, entries) {
  for (const [id, label] of entries) page.addThread(id, label);
}

test('unread comes from Messenger\'s database: muted chats are left out, unseen ones counted', async () => {
  const modules = {};
  const page = createPage({ modules });
  const chats = [
    { threadKey: 1, unread: true, muteExpireTimeMs: 0 },
    { threadKey: 2, unread: true, muteExpireTimeMs: -1 },
    { threadKey: 3, unread: true, muteExpireTimeMs: page.clock.now + 60_000 },
    { threadKey: 4, unread: false, muteExpireTimeMs: 0 },
    { threadKey: 9, unread: true, muteExpireTimeMs: page.clock.now - 60_000 },
  ];
  Object.assign(modules, facebookModules(page, { chats }).modules);
  rows(page, [[4, 'Seen']]);
  page.blur();
  await page.advance(3000);
  const unread = page.events.filter(({ event }) => event.kind === 'unread').at(-1).event.threads;
  assert.deepEqual([...unread].sort(), ['1', '9']);
  assert.equal(page.events.some(({ event }) => event.kind !== 'unread'), false, 'what the database reveals late is not news');
});

test('the row text is used where the database is unavailable', async () => {
  const modules = {};
  const page = createPage({ modules });
  Object.assign(modules, facebookModules(page, { broken: true }).modules);
  rows(page, [[1, 'Unread message'], [2, 'Seen']]);
  await page.advance(3000);
  const unread = page.events.filter(({ event }) => event.kind === 'unread').at(-1).event.threads;
  assert.deepEqual([...unread], ['1']);
});
