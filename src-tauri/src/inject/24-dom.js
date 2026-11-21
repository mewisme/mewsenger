// Small helpers for reading Messenger's DOM.
const visible = (el) => !!el && el.getBoundingClientRect().width > 0;
const clamp = (n, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), n));
const editing = (el) => !!el?.closest?.('input,textarea,[contenteditable="true"],[role="combobox"],[role="searchbox"]');
const threadPath = () => /\/(?:messages\/)?t\/[^/]+/.test(location.pathname) ? location.pathname : null;
const composer = () => [...document.querySelectorAll('[contenteditable="true"][role="textbox"],[contenteditable="true"][data-lexical-editor]')]
  .filter((el) => visible(el) && !!el.closest('[role="main"],main')).at(-1) ?? null;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (probe, ms) => {
  for (let waited = 0; waited <= ms; waited += 100) {
    const value = probe();
    if (value) return value;
    await pause(100);
  }
  return null;
};
// The script runs before the page has an <html> element in WebView2; what needs
// it waits for it.
const withRoot = (use) => {
  if (document.documentElement) return use(document.documentElement);
  const wait = new MutationObserver(() => {
    if (!document.documentElement) return;
    wait.disconnect();
    use(document.documentElement);
  });
  wait.observe(document, { childList: true });
};
