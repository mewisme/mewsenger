// Messenger keeps its own appearance setting: light, dark, or the system's.
// Mewsenger's theme choice drives that setting, so a switch in Settings reaches
// the page at once and Messenger's own Preferences agree with it.
//
// Messenger's dark mode is React state at the root of the page. The setter its
// Preferences use is read from inside that provider (a patch of the module that
// builds it), which switches the page without a reload. Without the setter the
// setting is only saved and the page changes on its next load.
const mewTheme = (() => {
  const SETTINGS = { system: 'USE_SYSTEM', light: 'DISABLED', dark: 'ENABLED' };
  let setter = null;
  let applied = null;
  // Saved while the setter was missing: the page still shows the old look.
  let stale = false;

  fbModules.patch('makeCometDarkModeStateProvider.react', (exports) => {
    const make = exports.default;
    if (typeof make !== 'function' || make.length !== 1) return false;
    exports.default = (options) => {
      const Provider = make(options);
      const React = fbModules.require('react');
      const contextModule = fbModules.require('CometDarkModeContext');
      const context = contextModule?.$$typeof ? contextModule : contextModule?.default;
      if (!React || !context) return Provider;
      const ReadSetter = () => {
        const first = typeof setter !== 'function';
        setter = React.useContext(context).setDarkModeSetting;
        if (first) setTimeout(() => { void apply(); }, 0);
        return null;
      };
      return (props) => React.createElement(Provider, props, React.createElement(ReadSetter), props.children);
    };
    return true;
  });

  const wanted = () => SETTINGS[mewPrefs.get('theme')] ?? SETTINGS.system;

  const apply = async () => {
    const want = wanted();
    if (applied === want && !(stale && typeof setter === 'function')) return;
    try {
      let darkMode = fbModules.require('CometDarkMode');
      if (!darkMode) {
        await fbModules.load(['CometDarkMode']);
        darkMode = fbModules.require('CometDarkMode');
      }
      const live = typeof setter === 'function';
      if (darkMode?.getDarkModeSetting?.() === want && !(stale && live)) {
        applied = want;
        return;
      }
      if (live) setter(want);
      else darkMode?.saveDarkModeSetting?.(want, { onRevert() {} });
      stale = !live;
      applied = want;
    } catch {
      // Facebook changed the modules; the page keeps the look it has.
    }
  };

  mewPrefs.onChange(() => { void apply(); });
  // Pages that load without the provider hook still get the setting saved.
  setTimeout(() => { void apply(); }, 1000);
  return { apply, state: () => ({ wanted: wanted(), applied, hasSetter: typeof setter === 'function' }) };
})();
window.__mewTheme = () => mewTheme.state();
