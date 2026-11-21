// Puts the cursor in the message box when a chat opens, as long as that
// takes nothing from what the user is doing.
let lastThread = null;
let lastComposer = null;
let pendingFocus = false;
function focusComposer() {
  const thread = threadPath();
  const field = thread && composer();
  const previousComposer = lastComposer;
  const changed = thread !== lastThread || (field && lastComposer && field !== lastComposer);
  lastThread = thread;
  lastComposer = field;
  if (changed) pendingFocus = true;
  const active = document.activeElement;
  const safeToFocus = active === document.body || active === document.documentElement ||
    (active === previousComposer && !previousComposer?.isConnected) ||
    !!active?.closest?.('a[href*="/t/"]');
  if (!pendingFocus || !field || document.hidden || !document.hasFocus() ||
      document.querySelector('[role="dialog"],[aria-modal="true"]') ||
      !safeToFocus) return;
  pendingFocus = false;
  field.focus({ preventScroll: true });
}
