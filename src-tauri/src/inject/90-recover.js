// Getting Messenger back by itself. Four things left a page stuck until it was
// reloaded by hand, and it is reloaded for them (Settings: autoRecover):
//  - Sleep: while the computer sleeps the page's connections to Facebook die
//    without the page noticing, and messages sent afterwards sit at "Sending".
//    Sleep shows as a jump in the clock between two ticks of a timer, since
//    timers do not run while the computer sleeps (a hidden page's timers run
//    late by about a minute at most, far under `sleptMs`).
//  - A connection that stays down: Messenger keeps WebSockets to Facebook (by
//    kind: messages, realtime, calls). One that worked before and is still down
//    `downMs` after Facebook answers again gets the page reloaded.
//  - "Couldn't load chats": Messenger's own error screen. It is reloaded once;
//    should the screen come back soon after, it stays for Messenger's own
//    Reload.
//  - Encrypted chats that never load, with no error screen: their rows show
//    only a name, or an open one spins with no message, while online.
// A reload waits for an empty message box (a message being typed is left
// alone), for Facebook to answer, and for the computer to have been awake
// `steadyMs`, never comes on a login or checkpoint page, and comes at most
// every `againMs`. Each tab is its own page and decides for itself.
//
// Messenger's sockets are seen through a Proxy of the page's WebSocket
// constructor that only records the ones going to Facebook's /ws/ paths and
// hands every other one straight through.
if (!window.opener && typeof window.setTimeout === 'function' && typeof window.setInterval === 'function') {
  const timing = {
    tickMs: 15_000,
    sleptMs: 5 * 60_000,
    downMs: 30_000,
    retryMs: 3_000,
    againMs: 2 * 60_000,
    chatsAgainMs: 10 * 60_000,
    steadyMs: 20_000,
    settledMs: 30_000,
    stuckMs: 90_000,
    chatStuckMs: 60_000,
    answerMs: 5_000,
  };
  const STUCK = 'encrypted chats stuck';
  const ERROR_SCREEN = 'chats error';
  const STORE_KEY = 'mew.recovered';
  const started = Date.now();
  // Facebook replaces the page's timers later; these stay the browser's.
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const enabled = () => mewPrefs.get('autoRecover') !== false;

  const lastRecovery = () => {
    try {
      return JSON.parse(window.sessionStorage.getItem(STORE_KEY) || 'null');
    } catch {
      return null;
    }
  };

  // Messenger's WebSockets to Facebook, by kind (the path after /ws/): the
  // newest of each is the one in use (a dead one is left behind unclosed and
  // another opened).
  const gatewaySockets = new Map();
  if (typeof window.WebSocket === 'function') {
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try {
          const url = new URL(String(args[0]));
          const kind = /(?:^|\.)(?:facebook|messenger)\.com$/.test(url.hostname) && url.pathname.startsWith('/ws/')
            ? url.pathname.slice(4)
            : null;
          if (kind) {
            const entry = { since: Date.now(), open: false, worked: gatewaySockets.get(kind)?.worked ?? false };
            gatewaySockets.set(kind, entry);
            socket.addEventListener('open', () => {
              entry.open = true;
              entry.worked = true;
              entry.since = Date.now();
            });
            socket.addEventListener('close', () => {
              entry.open = false;
              entry.since = Date.now();
            });
          }
        } catch { /* An unreadable address is not one of Messenger's sockets. */ }
        return socket;
      },
    });
  }
  const deadSockets = (now) => [...gatewaySockets]
    .filter(([, entry]) => entry.worked && !entry.open && now - entry.since >= timing.downMs)
    .map(([kind]) => kind);

  const typing = () => Boolean(composer()?.textContent?.trim());
  const onLoginPage = () => /^\/(?:login|checkpoint|recover|two_step_verification|cookie)(?:\/|$)/.test(location.pathname) ||
    Boolean(document.querySelector('input[type="password"]'));
  const offline = () => navigator.onLine === false;

  // Whether Facebook answers. A dead network gives no answer at all, hence the
  // timeout; any HTTP answer, whatever its status, proves the network is up.
  const answering = () => {
    if (typeof fetch !== 'function' || typeof AbortController !== 'function') return Promise.resolve(false);
    const timeout = new AbortController();
    const timer = nativeSetTimeout(() => timeout.abort(), timing.answerMs);
    return fetch('/favicon.ico', { cache: 'no-store', credentials: 'omit', signal: timeout.signal })
      .then(() => true, () => false)
      .finally(() => clearTimeout(timer));
  };

  let recovering = false;
  // Reloads for `reason` as soon as it may.
  const recover = (reason) => {
    if (recovering || !enabled() || onLoginPage()) return;
    const last = lastRecovery();
    const chats = reason === ERROR_SCREEN || reason === STUCK;
    const since = last ? Date.now() - last.at : Infinity;
    if (since < timing.againMs) return;
    if (chats && last?.reason === reason && since < timing.chatsAgainMs) return;
    recovering = true;
    // Awake since when: the tries come every few seconds, so a longer gap
    // between two is a sleep, and the count starts again.
    let awakeSince = Date.now();
    let lastTry = awakeSince;
    const attempt = async () => {
      if (!enabled() || onLoginPage()) {
        recovering = false;
        return;
      }
      const now = Date.now();
      if (now - lastTry > timing.retryMs + 12_000) awakeSince = now;
      lastTry = now;
      const ready = now - awakeSince >= timing.steadyMs && now - started >= timing.settledMs && !typing() && !offline();
      if (ready && (await answering()) && enabled() && !typing() && !onLoginPage()) {
        try {
          window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), reason }));
        } catch { /* Without storage the limit cannot be kept; the reload still helps. */ }
        location.reload();
        return;
      }
      nativeSetTimeout(attempt, timing.retryMs);
    };
    attempt();
  };

  // A loaded row has the name, the last message and its time; a stuck one the
  // name alone (grey bars for the rest). Counted by lines, not words, so no
  // language's text is matched.
  const openChatStuck = () =>
    /\/e2ee\/t\//.test(location.pathname) &&
    Boolean(document.querySelector('[role="main"] [role="log"] [data-visualcompletion="loading-state"]')) &&
    !document.querySelector('[role="main"] [data-message-id]');
  const encryptedChatsStuck = () => {
    const rows = [...document.querySelectorAll('[role="navigation"] [role="grid"] a[href*="/e2ee/t/"]')].filter(visible);
    return rows.length >= 3 && rows.every((row) => row.innerText.split('\n').filter((line) => line.trim()).length <= 1);
  };

  let lastTick = Date.now();
  // Since when Facebook has answered while a socket was down.
  let answeringSince = 0;
  // Since when every encrypted chat in the list has shown no last message, and
  // since when the open encrypted chat has spun with none of its own.
  let stuckSince = 0;
  let chatStuckSince = 0;
  const tick = async () => {
    const now = Date.now();
    const slept = now - lastTick - timing.tickMs;
    lastTick = now;
    if (recovering) return;
    if (!enabled()) {
      stuckSince = chatStuckSince = answeringSince = 0;
      return;
    }
    if (slept >= timing.sleptMs) return recover(`slept ${Math.round(slept / 1000)} s`);
    if (!encryptedChatsStuck() || offline()) stuckSince = 0;
    else if (!stuckSince) stuckSince = now;
    else if (now - stuckSince >= timing.stuckMs) return recover(STUCK);
    if (!openChatStuck() || offline()) chatStuckSince = 0;
    else if (!chatStuckSince) chatStuckSince = now;
    else if (now - chatStuckSince >= timing.chatStuckMs) return recover(STUCK);
    const dead = deadSockets(now);
    if (!dead.length || !(await answering())) {
      answeringSince = 0;
      return;
    }
    answeringSince ||= now;
    if (now - answeringSince >= timing.downMs) recover(`down: ${dead.join(', ')}`);
  };
  nativeSetInterval(tick, timing.tickMs);

  // Messenger's own word that the encrypted chats' worker hangs: its calls to
  // it time out while it is there and connected. Twice in two minutes.
  let workerHangs = [];
  window.addEventListener('unhandledrejection', (event) => {
    if (!/shared_exists_and_connected/.test(String(event.reason?.message ?? event.reason))) return;
    const now = Date.now();
    workerHangs = workerHangs.filter((at) => now - at < 2 * 60_000).concat(now);
    if (workerHangs.length >= 2) recover(STUCK);
  });

  // Messenger's error screens, "Couldn't load chats" among them, offer Reload;
  // the first one is taken by reloading here.
  fbModules.patch('getMWErrorDefinition', (exports) => {
    const define = exports.default;
    if (typeof define !== 'function') return false;
    exports.default = function (error, ...rest) {
      const definition = define.call(this, error, ...rest);
      try {
        if (definition?.action) recover(ERROR_SCREEN);
      } catch { /* Messenger's own screen is shown regardless. */ }
      return definition;
    };
    return true;
  });
}
