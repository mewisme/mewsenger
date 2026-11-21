// Which conversations are unread. Messenger's own database is asked first
// (see 32-fb-data); until it answers, or where its modules are not there, the
// conversation rows are read.
//
// Only explicit conversation markers count; title counts are message counts
// and are intentionally ignored.
const unreadMarker = /\b(unread|chưa đọc|chưa xem|non lu|sin leer)\b/i;
// Conversation rows carry the unread state: a visually hidden "unread"
// phrase in the row text and a bold (>= 600) snippet. The navigation links
// outside any row only report an aggregate over all chats and are ignored.
const heavyText = (row) => [...row.querySelectorAll('span,div')].some((el) =>
  el.children.length === 0 && (el.textContent ?? '').trim() &&
  Number.parseInt(getComputedStyle(el).fontWeight, 10) >= 600);
const domUnreadThreads = () => {
  const ids = new Set();
  const links = document.querySelectorAll('a[href*="/t/"]');
  for (const a of links) {
    const id = threadFrom(a.href);
    const row = a.closest('[role="row"],[role="listitem"],li');
    if (!id || !row) continue;
    const own = a.getAttribute('aria-label') ?? '';
    const label = row.getAttribute('aria-label') ?? '';
    const markers = [...row.querySelectorAll('[aria-label]')].some(
      (el) => unreadMarker.test(el.getAttribute('aria-label') ?? ''));
    if (unreadMarker.test(own) || unreadMarker.test(label) || markers ||
        unreadMarker.test(row.textContent ?? '') || heavyText(row)) ids.add(id);
  }
  return [...ids];
};

// null until the database has answered, and again after it failed.
let databaseUnread = null;
let databaseCheckedAt = 0;
let databaseChecking = false;
const REFRESH_MS = 1500;
const RETRY_MS = 30000;
const unreadThreads = () => databaseUnread ?? domUnreadThreads();
// Called on every change of the page; asks the database at most every
// REFRESH_MS and tells `changed` when the answer differs.
async function refreshDatabaseUnread(changed) {
  if (databaseChecking || Date.now() < databaseCheckedAt) return;
  databaseChecking = true;
  let next = null;
  try {
    next = await fbData.unreadThreadIds();
    databaseCheckedAt = Date.now() + REFRESH_MS;
  } catch {
    databaseCheckedAt = Date.now() + RETRY_MS;
  } finally {
    databaseChecking = false;
  }
  const same = next === databaseUnread || (next && databaseUnread && next.slice().sort().join('|') === databaseUnread.slice().sort().join('|'));
  databaseUnread = next;
  if (!same) changed();
}
