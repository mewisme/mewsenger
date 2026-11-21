// Keyboard shortcuts for the actions above.
const openChat = (n) => { const link = chatLinks()[n - 1]; if (!link) return false; link.click(); return true; };
const foreignInput = () => { const el = document.activeElement; return editing(el) && el !== composer(); };
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || event.repeat) return;
  const modifier = /Mac/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
  if (!modifier) return;
  const key = event.key.toLowerCase();
  let run = null;
  if (event.altKey) {
    if (event.shiftKey || editing(document.activeElement)) return;
    const action = event.key === 'ArrowDown' ? 'next-chat' : event.key === 'ArrowUp' ? 'prev-chat' : null;
    run = action && actions[action];
  } else if (event.shiftKey) {
    if (key === 'n') run = actions['new-chat'];
    else if (!foreignInput()) {
      if (event.code === 'BracketRight') run = actions['next-chat'];
      else if (event.code === 'BracketLeft') run = actions['prev-chat'];
    }
  } else if (/^[1-9]$/.test(key)) {
    if (!foreignInput()) run = () => openChat(Number(key));
  } else {
    const action = { k: 'search', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' }[key];
    run = action && actions[action];
  }
  if (run && run()) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
