// Puts the cursor in the message box when a chat opens, as long as that
// takes nothing from what the user is doing. A click on a chat asks for it too,
// including the chat that is already open, where nothing else changes.
let lastThread = null;
// Until when a click on a chat still wants the cursor in the message box.
let clickFocusUntil = 0;
let lastComposer = null;
let pendingFocus = false;
function focusComposer() {
  const thread = threadPath();
  const field = thread && composer();
  const previousComposer = lastComposer;
  const changed = thread !== lastThread || (field && lastComposer && field !== lastComposer);
  lastThread = thread;
  lastComposer = field;
  const clicked = Date.now() < clickFocusUntil;
  if (changed || clicked) pendingFocus = true;
  const active = document.activeElement;
  const safeToFocus = active === document.body || active === document.documentElement ||
    (active === previousComposer && !previousComposer?.isConnected) ||
    !!active?.closest?.('a[href*="/t/"]') ||
    // Facebook moves the focus to a heading as a chat opens; a click on a chat
    // still wins over that, but never over a field the user is typing in.
    (clicked && !editing(active));
  if (!pendingFocus || !field || document.hidden || !document.hasFocus() ||
      document.querySelector('[role="dialog"],[aria-modal="true"]') ||
      !safeToFocus) return;
  pendingFocus = false;
  clickFocusUntil = 0;
  field.focus({ preventScroll: true });
}
// The chat's page may take a moment to draw its message box, so look again a
// few times; each look is a finite timer.
document.addEventListener('click', (event) => {
  if (!event.target?.closest?.('a[href*="/t/"]')) return;
  clickFocusUntil = Date.now() + 5000;
  for (const delay of [0, 150, 500, 1200]) setTimeout(focusComposer, delay);
}, { capture: true, passive: true });
