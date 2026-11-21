// Privacy: hide what is said on screens others can see (Settings: redactMode).
// Names, previews, messages, pinned banners and tooltips become solid pills,
// photos and videos go flat and dark, and people's pictures grey circles. The
// rules are in the page only while redacting: their :has() selectors make the
// browser look at the chat each time Messenger adds messages, even when idle.
const REDACT = 'data-mew-redact';
const UNREDACT = 'data-mew-unredact';
let redactStyleElement = null;
const redactStyle = () => {
  if (redactStyleElement) return redactStyleElement;
  redactStyleElement = document.createElement('style');
  redactStyleElement.textContent = `
  /* Redact colors: light mode default, dark mode adapts to deep black and subdued media/avatars */
  html[${REDACT}] {
    --mew-redact-pill: #484a4d;
    --mew-redact-media: brightness(0.35);
    --mew-redact-avatar: brightness(0.8);
  }
  html[${REDACT}].__fb-dark-mode {
    --mew-redact-pill: #000000;
    --mew-redact-media: brightness(0.12);
    --mew-redact-avatar: brightness(0.35);
  }
  /* Redact contact names, snippet previews, message bubbles, pinned banners, tooltips, and dialog messages with solid charcoal pills */
  html[${REDACT}] [role="navigation"] [role="row"] [dir="auto"],
  html[${REDACT}] [data-mew-ui="chat-header"] [dir="auto"]:not([role="button"] *),
  html[${REDACT}] [role="main"] :is([role="banner"], [data-mew-ui="pinned-banner"]) :is([dir="auto"], span):not(:has([dir="auto"])):not(:has(span)):not([role="button"]):not([role="button"] *),
  html[${REDACT}] [role="main"] [role="log"] [dir="auto"]:not(:has([dir="auto"])),
  html[${REDACT}] [role="main"] [data-mew-ui="details"] > div:first-child [dir="auto"]:not([role="button"] *):not([role="tab"] *):not([role="listitem"] *):not([${UNREDACT}]),
  html[${REDACT}] [role="dialog"] :is([role="article"], [role="listitem"], [dir="auto"], time):not([role="dialog"] h2 *):not([role="dialog"] [role="heading"] *):not([role="button"] *),
  html[${REDACT}] [role="tooltip"] {
    background: var(--mew-redact-pill) !important;
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    border-radius: 4px !important;
    box-decoration-break: clone !important;
    -webkit-box-decoration-break: clone !important;
    padding: 2px 4px !important;
    user-select: none !important;
  }
  /* Ensure all text descendants inside redacted containers have transparent fill so diacritics/spans never poke out */
  html[${REDACT}] :is(
    [role="navigation"] [role="row"],
    [role="main"] :is([role="banner"], [data-mew-ui="pinned-banner"]),
    [role="main"] [role="log"],
    [data-mew-ui="chat-header"]
  ) [dir="auto"]:not([${UNREDACT}]) *,
  html[${REDACT}] [role="tooltip"] *,
  html[${REDACT}] [role="main"] [data-mew-ui="details"] > div:first-child [dir="auto"]:not([role="button"] *):not([role="tab"] *):not([role="listitem"] *):not([${UNREDACT}]) *,
  html[${REDACT}] [role="dialog"] [dir="auto"]:not([role="dialog"] h2 *):not([role="dialog"] [role="heading"] *):not([role="button"] *) * {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
  }
  /* Hide image emojis inside redacted text spans */
  html[${REDACT}] :is(
    [role="navigation"] [role="row"],
    [role="main"] :is([role="banner"], [data-mew-ui="pinned-banner"]),
    [role="main"] [role="log"],
    [data-mew-ui="chat-header"]
  ) [dir="auto"]:not([${UNREDACT}]) img,
  html[${REDACT}] [role="main"] [data-mew-ui="details"] > div:first-child [dir="auto"]:not([role="button"] *):not([role="tab"] *):not([role="listitem"] *):not([${UNREDACT}]) img,
  html[${REDACT}] [role="dialog"] [dir="auto"]:not([role="dialog"] h2 *):not([role="dialog"] [role="heading"] *):not([role="button"] *) img {
    opacity: 0 !important;
    visibility: hidden !important;
  }
  /* Redact message reactions attached to bubbles */
  html[${REDACT}] [role="main"] [role="log"] [role="button"]:is(:has(img[src*="emoji.php"]), [aria-label*="reaction" i], [aria-label*="cảm xúc" i]) {
    filter: grayscale(1) contrast(0) brightness(0.6) !important;
  }
  /* Exclude composer input and buttons so composition remains visible */
  html[${REDACT}] :is([role="textbox"], [role="textbox"] *, input, textarea, [data-mew-ui="composer"], [data-mew-ui="composer"] *) {
    color: inherit !important;
    -webkit-text-fill-color: initial !important;
    user-select: auto !important;
  }
  /* Specifically preserve Profile, Notifications/Mute, and Search action buttons and labels in details sidebar */
  html[${REDACT}] [${UNREDACT}],
  html[${REDACT}] [${UNREDACT}] * {
    background: transparent !important;
    color: var(--primary-text, inherit) !important;
    -webkit-text-fill-color: currentColor !important;
    user-select: auto !important;
  }
  /* Redact media (photos, videos, lightbox viewer, previews) synchronously on DOM insertion without route delay */
  html[${REDACT}] :is(img:not([src*="emoji.php"]), video) {
    filter: contrast(0) var(--mew-redact-media) !important;
    user-select: none !important;
  }
  /* Redact avatars: flat gray circle without entropy (higher specificity overrides general media rule) */
  html[${REDACT}] :is([role="navigation"] [role="row"], [data-mew-ui="chat-header"], [role="log"], [data-mew-ui="details"] > div:first-child, [role="dialog"], [role="complementary"]) :is(img:not([src*="emoji.php"]), svg image, [role="img"]:not([aria-label*="emoji"])) {
    filter: grayscale(1) contrast(0) var(--mew-redact-avatar) !important;
  }
`;
  return redactStyleElement;
};
// In the page only while redacting: its :has() rules cost WebKit a look at
// the chat each time Messenger adds messages, even with the mode off.

const updateRedactions = (root = document) => {
  if (!redacting) return;
  const detailsTop = root.querySelector?.('[data-mew-ui="details"] > div:first-child');
  if (detailsTop) {
    // Action buttons (Profile, Mute, Search) are icon-only buttons with adjacent text labels in the top header
    for (const btn of detailsTop.querySelectorAll('[role="button"]:not([aria-expanded])')) {
      if (btn.querySelector('[dir="auto"]')) continue;
      const label = btn.parentElement?.querySelector('[dir="auto"]');
      if (label && !label.hasAttribute(UNREDACT)) label.setAttribute(UNREDACT, '');
    }
    for (const span of detailsTop.querySelectorAll('[dir="auto"]')) {
      const text = span.textContent?.trim().toLowerCase();
      if (['profile', 'trang cá nhân', 'notifications', 'thông báo', 'mute', 'tắt thông báo', 'search', 'tìm kiếm'].includes(text) && !span.hasAttribute(UNREDACT)) {
        span.setAttribute(UNREDACT, '');
      }
    }
  }
  const main = root.querySelector?.('[role="main"]') ?? (typeof document !== 'undefined' ? document.querySelector('[role="main"]') : null);
  if (main) {
    const header = main.querySelector('[data-mew-ui="chat-header"]');
    const log = main.querySelector('[role="log"]');
    if (header && log) {
      let curr = log;
      while (curr && curr !== header.parentElement && curr !== main) {
        let prev = curr.previousElementSibling;
        while (prev) {
          if (!prev.contains(header) && prev !== header) {
            if (!prev.hasAttribute('data-mew-ui')) {
              prev.setAttribute('data-mew-ui', 'pinned-banner');
            }
          }
          prev = prev.previousElementSibling;
        }
        curr = curr.parentElement;
      }
      let next = header.nextElementSibling;
      while (next && !next.contains(log)) {
        if (!next.hasAttribute('data-mew-ui')) {
          next.setAttribute('data-mew-ui', 'pinned-banner');
        }
        next = next.nextElementSibling;
      }
    }
  }
};

let redactFrame = 0;
const redactWatcher = new MutationObserver(() => {
  redactFrame ||= requestAnimationFrame(() => ((redactFrame = 0), updateRedactions(document)));
});

let redacting = false;
const setRedactMode = (enabled) => {
  if (enabled === redacting) return;
  redacting = enabled;
  mewMarks.use(enabled);
  withRoot((root) => (root.toggleAttribute(REDACT, enabled), enabled ? root.append(redactStyle()) : redactStyleElement?.remove()));
  redactWatcher.disconnect();
  cancelAnimationFrame(redactFrame);
  redactFrame = 0;
  if (enabled) {
    withRoot((root) => redactWatcher.observe(root, { childList: true, subtree: true, characterData: true }));
    updateRedactions(document);
  } else {
    for (const el of document.querySelectorAll(`[${UNREDACT}]`)) {
      el.removeAttribute(UNREDACT);
    }
    for (const el of document.querySelectorAll('[data-mew-ui="pinned-banner"]')) {
      el.removeAttribute('data-mew-ui');
    }
  }
};
setRedactMode(mewPrefs.get('redactMode'));
mewPrefs.onChange((values) => setRedactMode(values.redactMode));
