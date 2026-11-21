// Enhance only the live Messenger page. No Tauri IPC is exposed to it.
(() => {
  if (location.protocol !== 'https:' ||
      !window.__MEW_SITE__?.app_hosts?.includes(location.hostname) ||
      window !== window.top || window.__mewDesktopInstalled) return;
  window.__mewDesktopInstalled = true;

  const visible = (el) => !!el && el.getBoundingClientRect().width > 0;
  const threadPath = () => /\/(?:messages\/)?t\/[^/]+/.test(location.pathname) ? location.pathname : null;
  const editing = (el) => !!el?.closest?.('input,textarea,[contenteditable="true"],[role="combobox"],[role="searchbox"]');
  const composer = () => [...document.querySelectorAll('[contenteditable="true"][role="textbox"],[contenteditable="true"][data-lexical-editor]')]
    .filter((el) => visible(el) && !!el.closest('[role="main"],main')).at(-1) ?? null;
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

  const viewerImage = () => [...document.querySelectorAll('[role="dialog"] img')]
    .filter((img) => img.getBoundingClientRect().width > 100 &&
      img.naturalWidth >= 240 && img.naturalHeight >= 160)
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0] ?? null;
  const clamp = (n, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), n));
  const isOn = (el, x, y) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  let viewer = null;
  let zoom = null;
  let drag = null;
  let suppressClick = false;
  function resetZoom() {
    if (!zoom) return;
    Object.assign(zoom.img.style, zoom.original);
    zoom = null;
    drag = null;
  }
  function syncViewer() {
    const img = viewerImage();
    if (zoom && (zoom.img !== img || zoom.page !== location.href || !img?.isConnected)) resetZoom();
    const next = img?.closest('[role="dialog"]') ?? null;
    if (viewer === next) return;
    viewer?.removeEventListener('wheel', onWheel, true);
    viewer = next;
    viewer?.addEventListener('wheel', onWheel, { capture: true, passive: false });
  }
  function startZoom() {
    const img = viewerImage();
    if (!img) return false;
    if (zoom?.img === img && zoom.page === location.href) return true;
    resetZoom();
    zoom = { img, page: location.href, base: img.getBoundingClientRect(), scale: 1, x: 0, y: 0,
      original: { transform: img.style.transform, transformOrigin: img.style.transformOrigin,
        transition: img.style.transition, cursor: img.style.cursor } };
    img.style.transformOrigin = '0 0';
    return true;
  }
  function applyZoom(scale, x, y) {
    if (!zoom) return;
    scale = clamp(scale, 1, 8);
    if (scale <= 1) return resetZoom();
    const { base } = zoom;
    zoom.scale = scale;
    zoom.x = clamp(x, innerWidth - base.left - base.width * scale, -base.left);
    zoom.y = clamp(y, innerHeight - base.top - base.height * scale, -base.top);
    zoom.img.style.transform = 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + scale + ')';
    zoom.img.style.cursor = drag ? 'grabbing' : 'grab';
  }
  function zoomAt(scale, x, y) {
    if (!startZoom()) return false;
    const { base } = zoom;
    const px = (x - base.left - zoom.x) / zoom.scale;
    const py = (y - base.top - zoom.y) / zoom.scale;
    applyZoom(scale, x - base.left - scale * px, y - base.top - scale * py);
    return true;
  }
  function onWheel(event) {
    if (!viewer || !viewerImage()) return;
    if (event.ctrlKey && isOn(viewerImage(), event.clientX, event.clientY)) {
      if (!zoomAt((zoom?.scale || 1) * Math.exp(-event.deltaY / 140), event.clientX, event.clientY)) return;
    } else if (zoom) applyZoom(zoom.scale, zoom.x - event.deltaX, zoom.y - event.deltaY);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  document.addEventListener('dblclick', (event) => {
    const img = viewerImage();
    if (!img || !isOn(img, event.clientX, event.clientY)) return;
    event.preventDefault();
    if (zoom) resetZoom();
    else zoomAt(2.5, event.clientX, event.clientY);
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (!zoom || event.button !== 0 || event.target !== zoom.img ||
        !isOn(zoom.img, event.clientX, event.clientY)) return;
    drag = { x: event.clientX - zoom.x, y: event.clientY - zoom.y,
      startX: event.clientX, startY: event.clientY, moved: false };
    event.preventDefault();
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (drag && zoom) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) drag.moved = true;
      applyZoom(zoom.scale, event.clientX - drag.x, event.clientY - drag.y);
    }
  }, true);
  document.addEventListener('pointerup', () => {
    if (drag?.moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    drag = null;
    if (zoom) zoom.img.style.cursor = 'grab';
  }, true);
  document.addEventListener('pointercancel', () => { drag = null; }, true);
  document.addEventListener('click', (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('resize', resetZoom);

  let scheduled = false;
  function sync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; syncViewer(); focusComposer(); }, 70);
  }
  new MutationObserver(sync).observe(document, { subtree: true, childList: true });
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('load', sync, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();

  const clickFirst = (selectors) => {
    for (const selector of selectors) {
      const el = [...document.querySelectorAll(selector)].find(visible);
      if (el) { el.click(); return true; }
    }
    return false;
  };
  const chatLinks = () => [...document.querySelectorAll('a[href*="/t/"]')]
    .filter((el) => visible(el) && !!el.closest('[role="navigation"],[role="grid"],nav'));
  function selectChat(step) {
    const links = chatLinks();
    if (!links.length) return false;
    const index = links.findIndex((el) => new URL(el.href).pathname === location.pathname);
    links[clamp(index + step, 0, links.length - 1)]?.click();
    return true;
  }
  function zoomBy(factor) {
    const img = viewerImage();
    if (!img) return false;
    const rect = img.getBoundingClientRect();
    return zoomAt((zoom?.scale || 1) * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  const actions = {
    search() {
      const field = [...document.querySelectorAll('input[type="search"],[role="searchbox"]')].find(visible);
      if (!field) return false;
      field.focus({ preventScroll: true });
      return true;
    },
    'new-chat': () => clickFirst(['a[href*="/new"]', '[aria-label*="new message" i]', '[aria-label*="tin nhắn mới" i]']),
    account: () => clickFirst(['[role="banner"] [aria-label*="account" i]',
      '[role="navigation"] [aria-label*="account" i]', 'button[aria-label*="account" i]',
      '[role="banner"] [aria-label*="tài khoản" i]',
      '[role="navigation"] [aria-label*="tài khoản" i]',
      '[aria-label*="your profile" i]', '[aria-label*="trang cá nhân của bạn" i]']),
    logout() {
      if (!actions.account()) return false;
      // Only Messenger's own Log out control can terminate the session.
      setTimeout(() => {
        [...document.querySelectorAll('[role="menuitem"],[role="button"],button')]
          .find((el) => visible(el) && /^(log\s*out|đăng\s*xuất)$/i.test(el.textContent.trim()))?.click();
      }, 300);
      return true;
    },
    'next-chat': () => selectChat(1),
    'prev-chat': () => selectChat(-1),
    'zoom-in': () => zoomBy(1.25),
    'zoom-out': () => zoomBy(0.8),
    'zoom-reset': () => { if (!zoom) return false; resetZoom(); return true; },
  };
  window.__mewDesktopAction = (name) => actions[name]?.() ?? false;
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
        else if (event.code === 'BracketLeft' || key === 'tab') run = actions['prev-chat'];
      }
    } else if (/^[1-9]$/.test(key)) {
      if (!foreignInput()) run = () => openChat(Number(key));
    } else if (key === 'tab') {
      if (!foreignInput()) run = actions['next-chat'];
    } else {
      const action = { k: 'search', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' }[key];
      run = action && actions[action];
    }
    if (run && run()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
})();