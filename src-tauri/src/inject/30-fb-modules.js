// Facebook defines its code as named modules, window.__d(name, deps, factory),
// and loads them with window.require(name). Hooking __d, which has to happen
// before the page's own scripts run, is how one module is adjusted; modules
// that are already loaded can simply be required.
//
// Module names are source file names, so they outlive rebuilds far better than
// minified code. Every hook still checks the shape of what it finds and leaves
// the module alone when Facebook changed it (see fbModules.state).
//
//   fbModules.patch(name, (exports) => boolean)  adjust a module's exports
//   fbModules.rewrite(name, [[regex, text]])     change its source, one match each
//   fbModules.require(name) / load(names)        use a module, loading it first
//   fbModules.state(name)                        what happened to a hook
const fbModules = (() => {
  const patches = new Map();
  const rewrites = new Map();
  const rewritten = new Map();
  const states = new Map();
  const mark = (name, value) => states.set(name, value);
  const run = (hook, value) => {
    try { return hook(value) === true; } catch { return false; }
  };

  // The page forbids eval but allows blob: scripts, so a rewritten factory
  // loads as one. It is used by modules that run after it arrived (they run on
  // first require); until then, or when a pattern no longer matches exactly
  // once, the original runs.
  const rewriteFactory = (name, factory) => {
    let source = factory.toString();
    for (const [pattern, replacement] of rewrites.get(name)) {
      if (source.match(new RegExp(pattern.source, 'g'))?.length !== 1) return mark(name, 'no-match');
      source = source.replace(pattern, replacement);
    }
    const key = `__mewFactory:${name}`;
    const script = document.createElement('script');
    const url = URL.createObjectURL(new Blob([`window[${JSON.stringify(key)}] = (${source});`], { type: 'text/javascript' }));
    const done = (state) => {
      URL.revokeObjectURL(url);
      script.remove();
      mark(name, state);
    };
    script.onload = () => {
      rewritten.set(name, window[key]);
      delete window[key];
      done('rewritten');
    };
    script.onerror = () => done('blocked');
    script.src = url;
    mark(name, 'loading');
    (document.head || document.documentElement).append(script);
  };

  const wrap = (loaderDefine) => function (name, deps, factory, ...rest) {
    if (typeof factory === 'function' && rewrites.has(name)) {
      const original = factory;
      rewriteFactory(name, original);
      factory = function (...args) {
        return (rewritten.get(name) ?? original).apply(this, args);
      };
      // The loader passes a factory's extra arguments only when it declares them.
      Object.defineProperty(factory, 'length', { value: original.length });
    } else if (typeof factory === 'function' && patches.has(name)) {
      const original = factory;
      factory = function (...args) {
        const result = original.apply(this, args);
        const applied = args.some((arg) => arg && typeof arg === 'object' && arg !== window && run(patches.get(name), arg));
        mark(name, applied ? 'patched' : 'shape-mismatch');
        return result;
      };
      Object.defineProperty(factory, 'length', { value: original.length });
    }
    return loaderDefine.call(this, name, deps, factory, ...rest);
  };

  let define = typeof window.__d === 'function' ? wrap(window.__d) : undefined;
  try {
    Object.defineProperty(window, '__d', {
      configurable: true,
      get: () => define,
      set(loaderDefine) { define = wrap(loaderDefine); },
    });
  } catch {
    // Without the hook every patch simply stays unapplied.
  }

  const use = (name) => {
    try { return window.require?.(name) ?? null; } catch { return null; }
  };
  return {
    patch(name, hook) { patches.set(name, hook); },
    rewrite(name, pairs) { rewrites.set(name, pairs); },
    state: (name) => states.get(name) ?? null,
    snapshot: () => Object.fromEntries(states),
    require: use,
    // A name Facebook dropped would never call back, so loading gives up.
    load: (names) => new Promise((resolve, reject) => {
      const bootloader = use('Bootloader');
      if (typeof bootloader?.loadModules !== 'function') return reject(new Error('Bootloader unavailable'));
      const timer = setTimeout(() => reject(new Error(`could not load ${names.join(', ')}`)), 10000);
      bootloader.loadModules(names, () => { clearTimeout(timer); resolve(); }, 'mewsenger');
    }),
  };
})();
// Which hooks applied; read by live checks and diagnostics.
window.__mewModules = () => fbModules.snapshot();
