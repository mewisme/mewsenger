// On a screen wider than Facebook's page cap (2560px) Messenger stops growing
// and centres itself, leaving empty bands on both sides. The element that
// carries the cap is the one above the chat with a fixed max-width; it is
// marked and the cap lifted, so the chat list and chat use the whole width.
const WIDE_MARK = 'data-mew-wide';
// A px max-width at least this wide is the page cap, not a small component.
const WIDE_LEAST = 1200;
const WIDE_CSS = `[${WIDE_MARK}] { max-width: none !important; }`;
let wideStyled = false;
let wideScheduled = false;
function syncWide() {
  const main = document.querySelector('[role="main"]');
  if (!main) return;
  if (!wideStyled) {
    wideStyled = true;
    const style = document.createElement('style');
    style.textContent = WIDE_CSS;
    withRoot((root) => root.append(style));
  }
  for (let el = main.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.hasAttribute(WIDE_MARK)) continue;
    const max = getComputedStyle(el).maxWidth;
    if (typeof max === 'string' && max.endsWith('px') && parseFloat(max) >= WIDE_LEAST) el.setAttribute(WIDE_MARK, '');
  }
}
function scheduleWide(ms = 300) {
  if (wideScheduled) return;
  wideScheduled = true;
  setTimeout(() => { wideScheduled = false; syncWide(); }, ms);
}
new MutationObserver(() => scheduleWide()).observe(document, { subtree: true, childList: true });
window.addEventListener('resize', () => scheduleWide(), { passive: true });
scheduleWide();
