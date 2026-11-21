// Opening a chat is instant only when Messenger already holds its newest
// messages in memory (its Lightspeed database lives only in the page).
// Otherwise the list waits on the server (plain chats) or on its worker's
// encrypted store (end-to-end encrypted chats). Messenger reads ahead only for
// the chat under the pointer; with the "readAhead" preference on, this reads
// ahead, with the same calls, for the chats at the top of the list. Reading
// ahead opens no chat, so nothing is marked as seen, and the older messages it
// brings in raise no notification (Messenger notifies only for messages newer
// than any it has seen).
//
// It runs while the window is hidden or unfocused too: leaving the window is
// when it starts, so the chats are ready when the user comes back.
void (() => {
  const LIMITS = {
    chats: 12,
    messages: 40, // a window's worth, and some to scroll up through
    plainRounds: 2, // a server page each
    plainGapMs: 1200,
    plainPerHour: 60,
    plainAgainMs: 5 * 60 * 1000, // per chat
    secureGapMs: 200, // the worker reads its own store
    roundGapMs: 20 * 1000,
  };
  const AUTHORITATIVE = 80n; // LSAuthorityLevel
  const HIDDEN_ROW = 2n; // LSMessageRenderingType
  const MODULES = ['ReQL', 'LSDatabaseSingleton', 'LSFactory', 'LSIntEnum',
    'LSIssueMessagesRangeQueryStoredProcedure', 'LSMessagingThreadTypeUtil'];
  const SECURE_MODULES = ['MAWPreloadSecureMessages'];
  const askedAt = new Map();
  const asks = [];
  let started = false;
  let waiting = false;
  let timer = false;
  let running = false;
  let lastRound = -Infinity;

  const enabled = () => mewPrefs.get('readAhead') === true;
  const int64 = (value) => (Array.isArray(value)
    ? (BigInt(value[0]) << 32n) + BigInt(value[1] >>> 0)
    : BigInt(value ?? 0));
  const fn = (module) => (typeof module === 'function' ? module : module?.default);
  const chatListed = () => document.querySelectorAll('a[href*="/t/"]').length > 0;
  const need = (ok) => { if (!ok) throw new Error('read-ahead unavailable'); };

  const database = async () => {
    await fbModules.load(MODULES);
    const ReQL = fbModules.require('ReQL');
    const db = await fbModules.require('LSDatabaseSingleton')?.LSDatabaseSingleton;
    const util = fbModules.require('LSMessagingThreadTypeUtil');
    need(['firstAsync', 'toArrayAsync', 'fromTableAscending', 'fromTableDescending'].every((name) => typeof ReQL?.[name] === 'function'));
    need(db?.tables?.threads && typeof db.tables.threads.index === 'function');
    need(['isMessengerOrE2EEInbox', 'isOpenOrArmadilloFnFThread', 'isArmadilloSecure'].every((name) => typeof util?.[name] === 'function'));
    return { ReQL, db, util };
  };

  // Friends' 1:1 and group chats at the top of the inbox, plain or encrypted.
  // Encrypted chats' rows are all marked isHidden (the chat list shows them
  // through other tables), so isHidden only rules out plain ones.
  // Disappearing-message chats are left alone: their timers are Messenger's.
  const recentChats = async ({ ReQL, db, util }) => {
    const rows = await ReQL.toArrayAsync(
      ReQL.fromTableDescending(db.tables.threads.index('lastActivityTimestampMs')).take(LIMITS.chats * 3),
    );
    return rows
      .filter((chat) => util.isMessengerOrE2EEInbox(chat.folderName) && util.isOpenOrArmadilloFnFThread(chat))
      .filter((chat) => (!chat.isHidden || util.isArmadilloSecure(chat.threadType)) && !chat.isDisappearingMode)
      .filter((chat) => int64(chat.authorityLevel) === AUTHORITATIVE)
      .slice(0, LIMITS.chats)
      .map((chat) => ({ chat, secure: util.isArmadilloSecure(chat.threadType) }));
  };

  // A plain chat: the list shows rows from its newest range and asks for more
  // when it has fewer than a page. This asks the server for the page before
  // that range, as scrolling up (and Messenger's hover read-ahead) does.
  const newestRange = ({ ReQL, db }, chat) =>
    ReQL.firstAsync(ReQL.fromTableDescending(db.tables.messages_ranges_v2__generated).getKeyRange(chat.threadKey));
  const rowsInRange = async ({ ReQL, db }, chat, range) => {
    const rows = await ReQL.toArrayAsync(
      ReQL.fromTableDescending(db.tables.messages).getKeyRange(chat.threadKey).take(LIMITS.messages + 10),
    );
    const from = int64(range.minTimestampMs);
    return rows.filter((row) => int64(row.timestampMs) >= from && row.isCollapsed !== true
      && int64(row.messageRenderingType) !== HIDDEN_ROW).length;
  };
  const warmPlainChat = async (context, chat) => {
    const { ReQL, db } = context;
    for (let round = 0; round < LIMITS.plainRounds && enabled(); round += 1) {
      // No range: the server hasn't sent the chat's newest message yet, and
      // Messenger can't ask before it either.
      const range = await newestRange(context, chat);
      if (!range || !range.hasMoreBefore || range.isLoadingBefore) return;
      if ((await rowsInRange(context, chat, range)) >= LIMITS.messages) return;
      while (asks.length && asks[0] < Date.now() - 3600e3) asks.shift();
      if (asks.length >= LIMITS.plainPerHour) return;
      const query = fn(fbModules.require('LSIssueMessagesRangeQueryStoredProcedure'));
      const factory = fn(fbModules.require('LSFactory'));
      const direction = fbModules.require('LSIntEnum')?.ofNumber;
      need(typeof query === 'function' && typeof factory === 'function'
        && typeof direction === 'function' && typeof db.runInTransaction === 'function');
      asks.push(Date.now());
      askedAt.set(String(int64(chat.threadKey)), Date.now());
      const before = fbModules.require('LSIntEnum').ofNumber(0); // LSMailboxMessagesRangeQueryDirection.BEFORE
      await db.runInTransaction(
        (tx) => query(factory(tx), { direction: before, referenceTimestampMs: range.minTimestampMs, threadKey: chat.threadKey }),
        'readwrite',
      );
      // The answer clears isLoadingBefore on the range.
      for (let wait = 0; wait < 20 && (await newestRange(context, chat))?.isLoadingBefore; wait += 1) await pause(300);
      await pause(LIMITS.plainGapMs);
    }
  };

  // An encrypted chat: what pressing its row in the chat list does
  // (useMWPreloadThread): Messenger's worker loads its newest messages from its
  // own store into the page. It does nothing for a chat already loaded, so
  // asking again is cheap. The worker knows a chat only once it is mapped.
  const warmSecureChat = async ({ ReQL, db }, chat) => {
    if (!db.tables.mi_act_mapping_table) return;
    if (!(await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.mi_act_mapping_table).getKeyRange(chat.threadKey)))) return;
    const preload = fbModules.require('MAWPreloadSecureMessages')?.preloadSecureMessages;
    need(typeof preload === 'function');
    await Promise.race([preload(db, chat.threadKey, LIMITS.messages, chat.authorityLevel), pause(15000)]);
    await pause(LIMITS.secureGapMs);
  };

  const warmRecentChats = async () => {
    if (running || !enabled() || navigator.onLine === false) return;
    running = true;
    try {
      const context = await database();
      const secureReady = await fbModules.load(SECURE_MODULES).then(() => true, () => false);
      for (const { chat, secure } of await recentChats(context)) {
        if (!enabled()) return;
        const key = String(int64(chat.threadKey));
        // The open chat is loaded already.
        if (threadFrom(location.href) === key) continue;
        try {
          if (secure) {
            if (secureReady) await warmSecureChat(context, chat);
          } else if (Date.now() - (askedAt.get(key) ?? 0) > LIMITS.plainAgainMs) {
            await warmPlainChat(context, chat);
          }
        } catch {
          // One kind of chat failing (a module changed) must not stop the other.
        }
      }
    } catch {
      // Facebook changed something this relies on; the next round tries again.
    } finally {
      running = false;
    }
  };

  // At most a round every 20 s, however often it is asked for.
  const schedule = (delay) => {
    if (!enabled() || timer) return;
    timer = true;
    setTimeout(() => {
      timer = false;
      if (!enabled()) return;
      const wait = lastRound + LIMITS.roundGapMs - Date.now();
      if (wait > 0) return schedule(wait);
      lastRound = Date.now();
      void warmRecentChats();
    }, delay);
  };

  const subscribeToChats = async () => {
    try {
      const { ReQL, db } = await database();
      if (typeof ReQL.fromTableAscending(db.tables.threads).subscribe === 'function') {
        ReQL.fromTableAscending(db.tables.threads).subscribe(() => schedule(5000));
      }
    } catch {
      // The timed rounds still run.
    }
  };

  const everyFewMinutes = () => {
    schedule(0);
    setTimeout(everyFewMinutes, 4 * 60 * 1000);
  };

  // Once the chat list is there and the first sync has settled; again when the
  // window is left, every few minutes, and when a chat changes (a new message
  // can leave Messenger with only that one, or move a chat into the top of the
  // list).
  const begin = () => {
    if (started || waiting || !enabled()) return;
    const poll = () => {
      if (!enabled()) { waiting = false; return; }
      if (!chatListed()) { setTimeout(poll, 1000); return; }
      waiting = false;
      started = true;
      schedule(8000);
      window.addEventListener('blur', () => schedule(2000));
      setTimeout(everyFewMinutes, 4 * 60 * 1000);
      void subscribeToChats();
    };
    waiting = true;
    poll();
  };

  mewPrefs.onChange(() => { if (started) schedule(2000); else begin(); });
  begin();
})();
