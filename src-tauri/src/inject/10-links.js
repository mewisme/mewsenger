// Messenger can handle link clicks in React without a full navigation.
// Open external links as popups so Tauri hands them to the default browser.
const onHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const matchesPath = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);
const isShim = (url) =>
  site.link_shim_hosts.includes(url.hostname) && url.pathname === '/l.php';
const opensInApp = (url) =>
  !isShim(url) &&
  site.in_app_hosts.some((rule) =>
    onHost(url.hostname, rule.domain) &&
    (!rule.paths || rule.paths.some((path) => matchesPath(url.pathname, path))));

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
      event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link || link.hasAttribute('download')) return;

  let url;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol) || opensInApp(url)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  window.open(url.href, '_blank', 'noopener');
}, true);
