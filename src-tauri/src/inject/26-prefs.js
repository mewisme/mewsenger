// The user's choices from Settings that the page acts on. The app puts them in
// window.__MEW_PREFS before this script runs, and calls window.__mewApplyPrefs
// with the changed values (also after every page load). The defaults here are
// the ones in prefs.rs.
//
//   mewPrefs.get(key)        the current value
//   mewPrefs.onChange(fn)    fn(values) after any change; returns a function that stops it
const mewPrefs = (() => {
  const values = {
    theme: 'system',
    blockTyping: false,
    hideAvatars: false,
    redactMode: false,
    spellCheck: true,
    autoRecover: true,
    readAhead: false,
    doubleClickReply: false,
    ...(typeof window.__MEW_PREFS === 'object' && window.__MEW_PREFS ? window.__MEW_PREFS : {}),
  };
  const listeners = new Set();
  window.__mewApplyPrefs = (next) => {
    if (!next || typeof next !== 'object') return;
    for (const key of Object.keys(values)) {
      if (typeof next[key] === typeof values[key]) values[key] = next[key];
    }
    for (const listener of [...listeners]) {
      try { listener({ ...values }); } catch { /* One listener failing must not stop the others. */ }
    }
  };
  return {
    get: (key) => values[key],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();
