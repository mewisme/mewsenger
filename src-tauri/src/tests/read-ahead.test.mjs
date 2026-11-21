import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'vitest';
import { site } from './site-fixture.mjs';

// Only the parts read-ahead stands on, joined as build.rs joins them, so the
// test does not depend on parts it never touches.
const script = `(() => {\n${['00-guard', '20-top-frame', '22-ipc', '24-dom', '26-prefs', '30-fb-modules', '92-read-ahead']
  .map((name) => readFileSync(new URL(`../inject/${name}.js`, import.meta.url), 'utf8').trimEnd() + '\n')
  .join('')}})();\n`;

// A page with a fake clock; `modules` are what window.require returns.
function createPage({ modules, prefs, chatLinks = true }) {
  const clock = { now: 1_000_000 };
  const timers = [];
  const handlers = new Map();
  const window = { addEventListener: (name, cb) => handlers.set(name, cb), __MEW_SITE__: site, __MEW_PREFS: prefs };
  window.top = window;
  window.require = (name) => (name in modules ? modules[name] : undefined);
  const document = {
    querySelectorAll: (selector) => (chatLinks && selector === 'a[href*="/t/"]' ? [{}] : []),
    addEventListener() {},
  };
  class FakeDate extends Date { static now() { return clock.now; } }
  vm.runInNewContext(script, {
    window, document, location: new URL('https://www.messenger.com/t/1'), Date: FakeDate,
    navigator: {}, URL, clearTimeout() {},
    setTimeout(cb, ms = 0) { timers.push({ cb, at: clock.now + ms }); return timers.length; },
  });
  return {
    async advance(ms) {
      const end = clock.now + ms;
      for (let guard = 0; guard < 2000; guard += 1) {
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
    blur: () => handlers.get('blur')?.(),
    applyPrefs: (next) => window.__mewApplyPrefs(next),
  };
}

// Stand-ins for Messenger's database modules. `chats` is the thread table in
// list order; `calls` records what the page asked of Messenger.
function messenger({ chats, secureMapped = [], hasMoreBefore = true, missing = [] }) {
  const calls = { plain: [], secure: [], loads: 0 };
  const tables = {
    threads: { name: 'threads', index: () => tables.threads },
    messages_ranges_v2__generated: { name: 'ranges' },
    messages: { name: 'messages' },
    mi_act_mapping_table: { name: 'mapping' },
    runInTransaction: undefined,
  };
  const db = {
    tables,
    runInTransaction: async (work) => { work('tx'); },
  };
  const query = (table, extra = {}) => ({
    table,
    getKeyRange: (key) => query(table, { key }),
    take: () => query(table, extra),
    ...extra,
  });
  const ReQL = {
    fromTableAscending: query,
    fromTableDescending: query,
    firstAsync: async (q) => {
      if (q.table.name === 'ranges') return { hasMoreBefore, isLoadingBefore: false, minTimestampMs: 1000 };
      if (q.table.name === 'mapping') return secureMapped.includes(q.key) ? { threadKey: q.key } : undefined;
      return undefined;
    },
    toArrayAsync: async (q) => (q.table.name === 'threads' ? chats : []),
  };
  const util = {
    isMessengerOrE2EEInbox: () => true,
    isOpenOrArmadilloFnFThread: () => true,
    isArmadilloSecure: (type) => type === 'secure',
  };
  const modules = {
    Bootloader: { loadModules: (_names, done) => { calls.loads += 1; done(); } },
    ReQL,
    LSDatabaseSingleton: { LSDatabaseSingleton: Promise.resolve(db) },
    LSFactory: (tx) => tx,
    LSIntEnum: { ofNumber: (n) => n },
    LSIssueMessagesRangeQueryStoredProcedure: (_tx, args) => { calls.plain.push(args.threadKey); },
    LSMessagingThreadTypeUtil: util,
    MAWPreloadSecureMessages: { preloadSecureMessages: async (_db, key) => { calls.secure.push(key); } },
  };
  for (const name of missing) delete modules[name];
  return { modules, calls };
}

const chat = (threadKey, overrides = {}) => ({
  threadKey, threadType: 'one', folderName: 'inbox', authorityLevel: 80, ...overrides,
});

function readAheadPage(options, { readAhead = true } = {}) {
  const fake = messenger(options);
  const page = createPage({ modules: fake.modules, prefs: { readAhead } });
  return { page, calls: fake.calls };
}

test('with read-ahead off nothing is asked of Messenger', async () => {
  const { page, calls } = readAheadPage({ chats: [chat(10)] }, { readAhead: false });
  page.blur();
  await page.advance(60_000);
  assert.deepEqual(calls.plain, []);
  assert.equal(calls.loads, 0);
});

test('with read-ahead on, the top plain and encrypted chats are read ahead once per round', async () => {
  const { page, calls } = readAheadPage({
    chats: [chat(10), chat(11, { threadType: 'secure', isHidden: true }), chat(12)],
    secureMapped: [11],
  });
  await page.advance(20_000);
  assert.deepEqual(calls.plain, [10, 10, 12, 12], 'each plain chat is asked for two pages');
  assert.deepEqual(calls.secure, [11]);
});

test('rounds come at most every 20 seconds however often they are asked for', async () => {
  const { page, calls } = readAheadPage({ chats: [chat(11, { threadType: 'secure', isHidden: true })], secureMapped: [11] });
  await page.advance(20_000);
  assert.equal(calls.secure.length, 1);
  for (let i = 0; i < 5; i += 1) {
    page.blur();
    await page.advance(1_000);
  }
  assert.equal(calls.secure.length, 1, 'less than 20 s since the last round');
  await page.advance(20_000);
  assert.equal(calls.secure.length, 2);
});

test('a plain chat just asked about is left alone by the next round', async () => {
  const { page, calls } = readAheadPage({ chats: [chat(10)] });
  await page.advance(20_000);
  assert.equal(calls.plain.length, 2);
  page.blur();
  await page.advance(30_000);
  assert.equal(calls.plain.length, 2);
});

test('disappearing-message chats, hidden plain rows, other authority and the open chat are skipped', async () => {
  const { page, calls } = readAheadPage({
    chats: [
      chat(20, { isDisappearingMode: true }),
      chat(21, { isHidden: true }),
      chat(22, { authorityLevel: 0 }),
      chat(1),
      chat(23),
    ],
  });
  await page.advance(20_000);
  assert.deepEqual([...new Set(calls.plain)], [23]);
});

test('an encrypted chat the worker does not know yet is not asked about', async () => {
  const { page, calls } = readAheadPage({ chats: [chat(11, { threadType: 'secure', isHidden: true })], secureMapped: [] });
  await page.advance(20_000);
  assert.deepEqual(calls.secure, []);
});

test('missing Messenger modules make nothing happen and nothing throw', async () => {
  for (const missing of [['ReQL'], ['LSDatabaseSingleton'], ['LSMessagingThreadTypeUtil'], ['Bootloader']]) {
    const { page, calls } = readAheadPage({ chats: [chat(10)], missing });
    await page.advance(20_000);
    page.blur();
    await page.advance(30_000);
    assert.deepEqual(calls.plain, [], missing.join());
    assert.deepEqual(calls.secure, [], missing.join());
  }
});

test('missing request modules leave plain chats alone but encrypted ones still load', async () => {
  const { page, calls } = readAheadPage({
    chats: [chat(10), chat(11, { threadType: 'secure', isHidden: true })],
    secureMapped: [11],
    missing: ['LSIssueMessagesRangeQueryStoredProcedure'],
  });
  await page.advance(20_000);
  assert.deepEqual(calls.plain, []);
  assert.deepEqual(calls.secure, [11]);
});

test('turning read-ahead on later starts it, and off stops it', async () => {
  const { page, calls } = readAheadPage({ chats: [chat(11, { threadType: 'secure', isHidden: true })], secureMapped: [11] }, { readAhead: false });
  await page.advance(30_000);
  assert.equal(calls.secure.length, 0);
  page.applyPrefs({ readAhead: true });
  await page.advance(20_000);
  assert.equal(calls.secure.length, 1);
  page.applyPrefs({ readAhead: false });
  page.blur();
  await page.advance(60_000);
  assert.equal(calls.secure.length, 1);
});
