// Messenger keeps conversations in a local database ("Lightspeed") that its
// own code reads through these modules. Reading it tells more than the DOM
// can: the list on screen is virtualized, and the DOM does not say whether a
// chat is muted. Lightspeed keeps 64-bit numbers as [high, low].
const fbData = (() => {
  const int64 = (value) => (Array.isArray(value)
    ? (BigInt(value[0]) << 32n) + BigInt(value[1] >>> 0)
    : BigInt(value ?? 0));
  const serverNow = () => {
    try { return fbModules.require('ServerTime').getMillis(); } catch { return Date.now(); }
  };
  // Messages that arrive this late are not news (a computer back from sleep
  // gets what it missed one by one).
  const LATE_MS = 2 * 60 * 1000;
  const database = async () => {
    await fbModules.load(['ReQL', 'LSDatabaseSingleton']);
    const ReQL = fbModules.require('ReQL');
    const db = await fbModules.require('LSDatabaseSingleton')?.LSDatabaseSingleton;
    if (typeof ReQL?.firstAsync !== 'function' || !db?.tables?.threads) throw new Error('database unavailable');
    return { ReQL, db };
  };
  const row = (ReQL, table, ...key) => ReQL.firstAsync(ReQL.fromTableAscending(table).getKeyRange(...key));
  const isMuted = (chat) => {
    const until = int64(chat.muteExpireTimeMs);
    return until === -1n || until > BigInt(Math.floor(serverNow()));
  };
  const picture = (name, source) => {
    try {
      const module = fbModules.require(name);
      return (typeof module === 'function' ? module : module?.default)?.(source) ?? null;
    } catch { return null; }
  };

  const idKey = (id) => [Number(BigInt(id) >> 32n), Number(BigInt(id) & 0xffffffffn)];

  return {
    // The signed-in user's own profile picture, as a URL; null when unknown.
    async selfPictureUrl() {
      const me = fbModules.require('CurrentUserInitialData')?.USER_ID;
      if (!me || me === '0') return null;
      await fbModules.load(['getLSMediaContactProfilePictureUrl', 'getLSMediaContactProfilePictureLargeUrl']).catch(() => {});
      const { ReQL, db } = await database();
      const contact = await row(ReQL, db.tables.contacts, idKey(me));
      if (!contact) return null;
      const url = picture('getLSMediaContactProfilePictureUrl', contact) ?? picture('getLSMediaContactProfilePictureLargeUrl', contact);
      return typeof url === 'string' ? url : null;
    },
    // Ids of the chats Messenger counts as unread, as the test behind its own
    // "Unread message" marker decides, muted chats left out (as the badge in
    // Facebook's top bar leaves them out).
    async unreadThreadIds() {
      await fbModules.load(['MWPIsThreadUnread']);
      const isUnread = fbModules.require('MWPIsThreadUnread')?.isThreadUnreadForViewer;
      const { ReQL, db } = await database();
      if (typeof isUnread !== 'function' || typeof ReQL.toArrayAsync !== 'function') throw new Error('unread test unavailable');
      const chats = await ReQL.toArrayAsync(ReQL.fromTableAscending(db.tables.threads));
      return chats.filter((chat) => isUnread(chat) && !isMuted(chat)).map((chat) => String(int64(chat.threadKey)));
    },
    // Whether a message needs no notification: sent long ago, or in a chat
    // already read past it (on another device, say).
    async isOldNews(db, message) {
      const sent = int64(message?.timestampMs);
      if (sent && serverNow() - Number(sent) > LATE_MS) return true;
      const ReQL = fbModules.require('ReQL');
      const chat = await row(ReQL, db.tables.threads, message.threadKey);
      return Boolean(chat && sent) && int64(chat.lastReadWatermarkTimestampMs) >= sent;
    },
    // Who sent a message and where: { thread, sender, group }. Messenger's own
    // notification carries only a title and text.
    async messageDetails(db, message) {
      const ReQL = fbModules.require('ReQL');
      const [chat, contact, participant] = await Promise.all([
        row(ReQL, db.tables.threads, message.threadKey),
        row(ReQL, db.tables.contacts, message.senderId),
        row(ReQL, db.tables.participants, message.threadKey, message.senderId),
      ]);
      if (!chat || !contact) return null;
      const isGroup = fbModules.require('LSMessagingThreadTypeUtil')?.isGroup?.(chat.threadType) === true;
      return {
        thread: String(int64(message.threadKey)),
        sender: participant?.nickname || contact.name || '',
        group: isGroup ? (chat.threadName || null) : null,
      };
    },
  };
})();
