// Tab shortcuts belong to the shell's tab strip; the page only forwards them.
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || !event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  let action = null;
  if (key === 'tab') action = event.shiftKey ? 'prev' : 'next';
  else if (!event.shiftKey && !event.repeat && key === 't') action = 'new';
  else if (!event.shiftKey && !event.repeat && key === 'w') action = 'close';
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  send({ kind: 'shortcut', action });
}, true);
