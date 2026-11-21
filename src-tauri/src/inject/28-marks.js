// Marks (data-mew-ui) for the few parts of the chat that features need to find
// without Facebook's translated labels: chat-header and in it info (the button
// that shows the details), details (the pane beside the chat) and composer (the
// message box). They are found by where they are, and kept only while a feature
// that needs them is on (see mewMarks.use).
const mewMarks = (() => {
  const UI = 'data-mew-ui';
  const mark = (el, name) => {
    if (el && el.getAttribute(UI) !== name) el.setAttribute(UI, name);
  };
  // The row whose first child holds the messages and whose second is a pane of
  // its own (Facebook gives the details a minimum width).
  const findChatRow = (log, main) => {
    for (let el = log; el && el !== main; el = el.parentElement) {
      const row = el.parentElement;
      if (!row || row.children.length < 2 || row.firstElementChild !== el) continue;
      const details = el.nextElementSibling;
      const style = getComputedStyle(row);
      if (style.display === 'flex' && style.flexDirection === 'row' && parseFloat(getComputedStyle(details).minWidth) >= 200) return row;
    }
    return null;
  };
  let chatRow = null;
  let searchedLog = null;
  let info = null;
  const scan = () => {
    const main = document.querySelector('[role="main"]');
    const log = main?.querySelector('[role="log"]');
    if (!main || !log) return;
    // Looked for once per chat (it reads styles), and again after a click,
    // which can open the details.
    if (!chatRow?.contains(log) && log !== searchedLog) {
      searchedLog = log;
      chatRow = findChatRow(log, main);
    }
    const details = chatRow?.contains(log) && chatRow.children.length > 1 ? chatRow.children[1] : null;
    mark(details, 'details');
    const textbox = main.querySelector('[role="textbox"][contenteditable="true"]');
    const region = textbox?.closest('[role="region"]');
    mark(region && !region.contains(log) ? region : null, 'composer');
    // The header's button with aria-expanded opens the details.
    if (!(info?.isConnected && main.contains(info))) {
      info = [...main.querySelectorAll('[role="button"][aria-expanded]')].find(
        (button) => !log.contains(button) && !region?.contains(button) && !details?.contains(button)) ?? null;
      if (info) {
        mark(info, 'info');
        let header = info;
        while (header.parentElement && !header.parentElement.contains(log)) header = header.parentElement;
        mark(header, 'chat-header');
      }
    }
  };

  let wanted = 0;
  let frame = 0;
  let timer = 0;
  const observer = new MutationObserver(() => {
    frame ||= requestAnimationFrame(() => { frame = 0; scan(); });
  });
  const onClick = () => {
    searchedLog = null;
    setTimeout(scan, 50);
    setTimeout(scan, 400);
  };
  const start = () => {
    withRoot((root) => observer.observe(root, { childList: true, subtree: true }));
    document.addEventListener('click', onClick, { capture: true, passive: true });
    timer = setInterval(scan, 1000);
    scan();
  };
  const stop = () => {
    observer.disconnect();
    document.removeEventListener('click', onClick, { capture: true });
    clearInterval(timer);
    cancelAnimationFrame(frame);
    frame = 0;
    chatRow = searchedLog = info = null;
    for (const el of document.querySelectorAll(`[${UI}]`)) el.removeAttribute(UI);
  };
  return {
    // A feature that needs the marks calls this with true, and with false when
    // it is done; the marks are kept while any feature wants them.
    use(on) {
      const before = wanted;
      wanted = Math.max(0, wanted + (on ? 1 : -1));
      if (before === 0 && wanted > 0) start();
      else if (before > 0 && wanted === 0) stop();
    },
  };
})();
