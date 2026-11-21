// The panes can be resized: drag the edge between the chat list and the chat,
// or between the chat and its details, and double-click an edge to go back to
// Facebook's widths. The widths are kept in localStorage (one profile per
// account, so one set of widths per account).
//
// The list is the role="navigation" beside role="main". The details are the
// second child of the row that holds the chat (found from the messages);
// Facebook adds and drops them in that row as they open and close, and the row
// stays, so a saved width applies as soon as they open.
const PANE_KEY = 'mew-pane-widths';
const PANE_LIST = 'data-mew-list';
const PANE_ROW = 'data-mew-chat-row';
const PANE_RESIZING = 'data-mew-resizing';
// The chat keeps at least this much room; the details Facebook's own minimum.
const PANE_MIN_CHAT = 360;
const PANE_MIN_DETAILS = 300;
// Narrower than this a pane is of no use; wider than this is no screen.
const PANE_LEAST = 120;
const PANE_MOST = 2000;
const paneSelectors = {
  list: `[${PANE_LIST}]`,
  details: `[${PANE_ROW}] > :nth-child(2)`,
};
const paneCaps = {
  list: `calc(100% - ${PANE_MIN_CHAT + PANE_MIN_DETAILS}px)`,
  details: `calc(100% - ${PANE_MIN_CHAT}px)`,
};
const paneValid = (n) => typeof n === 'number' && Number.isFinite(n) && n >= PANE_LEAST && n <= PANE_MOST;
const paneWidths = { list: null, details: null };
try {
  const stored = JSON.parse(window.localStorage.getItem(PANE_KEY));
  for (const pane of Object.keys(paneWidths)) if (paneValid(stored?.[pane])) paneWidths[pane] = Math.round(stored[pane]);
} catch { /* Nothing saved, or storage is not there: Facebook's widths. */ }

const PANE_CSS = `
  [${PANE_LIST}], [${PANE_ROW}] > :nth-child(2) { position: relative; }
  .mew-pane-edge { position: absolute; top: 0; bottom: 0; width: 9px; z-index: 5; cursor: col-resize; touch-action: none; }
  /* Half over the chat: the list's own scroll bar is at its edge. */
  .mew-pane-edge[data-pane="list"] { right: -6px; }
  /* Inside the details: the chat's scroll bar is at their edge. */
  .mew-pane-edge[data-pane="details"] { left: 0; }
  .mew-pane-edge::after {
    content: ''; position: absolute; top: 0; bottom: 0; width: 2px;
    background: var(--primary-button-background, #0866ff);
    opacity: 0; transition: opacity 0.15s;
  }
  .mew-pane-edge[data-pane="list"]::after { left: 5px; }
  .mew-pane-edge[data-pane="details"]::after { left: 0; }
  .mew-pane-edge:hover::after { opacity: 0.6; transition-delay: 0.15s; }
  .mew-pane-edge.dragging::after { opacity: 0.6; transition-delay: 0s; }
  html[${PANE_RESIZING}], html[${PANE_RESIZING}] * { cursor: col-resize !important; user-select: none !important; }
`;
let paneStyle = null;
let paneWidthStyle = null;
// A set width does not shrink with the window (it would stop following the
// pointer near the limit); it is capped so the chat keeps its room instead.
function showPaneWidths() {
  paneWidthStyle.textContent = Object.keys(paneSelectors)
    .filter((pane) => paneWidths[pane] > 0)
    .map((pane) => `${paneSelectors[pane]} { flex: 0 0 ${paneWidths[pane]}px !important; width: ${paneWidths[pane]}px !important; max-width: ${paneCaps[pane]} !important; }`)
    .join('\n');
}
function savePaneWidths() {
  showPaneWidths();
  try {
    if (paneWidths.list || paneWidths.details) window.localStorage.setItem(PANE_KEY, JSON.stringify(paneWidths));
    else window.localStorage.removeItem(PANE_KEY);
  } catch { /* The widths still hold until the page closes. */ }
}
// Made when the layout first shows, so that its widths are there from then on.
function ensurePaneUi() {
  if (paneStyle) return;
  paneStyle = document.createElement('style');
  paneStyle.textContent = PANE_CSS;
  paneWidthStyle = document.createElement('style');
  showPaneWidths();
  withRoot((root) => root.append(paneStyle, paneWidthStyle));
  paneListEdge = makePaneEdge('list');
  paneDetailsEdge = makePaneEdge('details');
}

const paneRow = () => document.querySelector(`[${PANE_ROW}]`);
function startPaneDrag(event, edge) {
  if (event.button !== 0) return;
  const pane = edge.dataset.pane;
  const el = edge.parentElement;
  if (!el) return;
  event.preventDefault();
  event.stopPropagation();
  try { edge.setPointerCapture(event.pointerId); } catch { /* Then the moves are followed on the document. */ }
  const startX = event.clientX;
  const startWidth = el.getBoundingClientRect().width;
  // The chat is the row's first child, or all of role="main" without details.
  const chat = paneRow()?.firstElementChild ?? document.querySelector('[role="main"]');
  const room = Math.max(0, (chat?.getBoundingClientRect().width ?? 0) - PANE_MIN_CHAT);
  const least = Math.max(PANE_LEAST, parseFloat(getComputedStyle(el).minWidth) || 0);
  const most = Math.max(least, startWidth + room);
  const direction = pane === 'details' ? -1 : 1;
  let width = startWidth;
  document.documentElement.setAttribute(PANE_RESIZING, '');
  edge.classList.add('dragging');
  const move = (moveEvent) => {
    width = Math.round(clamp(startWidth + direction * (moveEvent.clientX - startX), least, most));
    // Only the pane's own style changes while dragging, not the style sheet
    // (which would have the whole page's style worked out again each move).
    el.style.setProperty('flex', `0 0 ${width}px`, 'important');
    el.style.setProperty('width', `${width}px`, 'important');
    el.style.setProperty('max-width', paneCaps[pane], 'important');
  };
  const end = () => {
    for (const name of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      edge.removeEventListener(name, name === 'pointermove' ? move : end);
    }
    document.documentElement.removeAttribute(PANE_RESIZING);
    edge.classList.remove('dragging');
    if (width !== Math.round(startWidth) && width >= PANE_LEAST) {
      paneWidths[pane] = width;
      savePaneWidths();
    }
    for (const name of ['flex', 'width', 'max-width']) el.style.removeProperty(name);
  };
  edge.addEventListener('pointermove', move);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) edge.addEventListener(name, end);
}
function makePaneEdge(pane) {
  const edge = document.createElement('div');
  edge.className = 'mew-pane-edge';
  edge.dataset.pane = pane;
  edge.addEventListener('pointerdown', (event) => startPaneDrag(event, edge));
  edge.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    paneWidths[pane] = null;
    savePaneWidths();
  });
  return edge;
}
let paneListEdge = null;
let paneDetailsEdge = null;

// The row whose first child holds the messages and whose second is a pane of
// its own (Facebook gives the details a minimum width).
function findPaneRow(log, main) {
  for (let el = log; el && el !== main; el = el.parentElement) {
    const row = el.parentElement;
    if (!row || row.children.length < 2 || row.firstElementChild !== el) continue;
    const style = getComputedStyle(row);
    if (style.display === 'flex' && style.flexDirection === 'row' && parseFloat(getComputedStyle(el.nextElementSibling).minWidth) >= 200) return row;
  }
  return null;
}
let paneSearchedLog = null;
function syncPanes() {
  const main = document.querySelector('[role="main"]');
  if (!main) {
    paneListEdge?.remove();
    paneDetailsEdge?.remove();
    return;
  }
  ensurePaneUi();
  const list = main.parentElement?.querySelector(':scope > [role="navigation"]');
  if (list && !list.hasAttribute(PANE_LIST)) {
    document.querySelector(`[${PANE_LIST}]`)?.removeAttribute(PANE_LIST);
    list.setAttribute(PANE_LIST, '');
  }
  if (list && paneListEdge.parentElement !== list) list.append(paneListEdge);
  else if (!list) paneListEdge.remove();
  const log = main?.querySelector('[role="log"]');
  let row = paneRow();
  // Looked for until the details have been open once. Finding the row reads
  // styles, so once per chat, then after a click or a resize (either can open
  // the details).
  if (log && !row?.contains(log) && log !== paneSearchedLog) {
    paneSearchedLog = log;
    const found = findPaneRow(log, main);
    if (found) {
      row?.removeAttribute(PANE_ROW);
      found.setAttribute(PANE_ROW, '');
      row = found;
    }
  }
  const details = row?.contains(log) && row.children.length > 1 ? row.children[1] : null;
  if (details && paneDetailsEdge.parentElement !== details) details.append(paneDetailsEdge);
  else if (!details) paneDetailsEdge.remove();
}
let panesScheduled = false;
function schedulePanes(ms = 70) {
  if (panesScheduled) return;
  panesScheduled = true;
  setTimeout(() => { panesScheduled = false; syncPanes(); }, ms);
}
new MutationObserver(() => schedulePanes()).observe(document, { subtree: true, childList: true });
// Opening a chat or its details is a click; look again once it has drawn.
document.addEventListener('click', () => { paneSearchedLog = null; schedulePanes(); }, { capture: true, passive: true });
window.addEventListener('resize', () => { paneSearchedLog = null; schedulePanes(); }, { passive: true });
schedulePanes();
