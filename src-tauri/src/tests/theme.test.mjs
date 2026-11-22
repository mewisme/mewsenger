import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createPage } from './page-harness.mjs';

// A page whose Messenger has a dark mode module, optionally with the provider
// that hands out the live setter (as Facebook's loader would run it).
function themedPage({ theme, current = 'USE_SYSTEM', provider = true }) {
  const saved = [];
  const state = { current };
  const live = [];
  const modules = {
    react: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useContext: () => ({ setDarkModeSetting: (value) => { live.push(value); state.current = value; } }),
    },
    CometDarkModeContext: { $$typeof: Symbol.for('react.context') },
    CometDarkMode: {
      getDarkModeSetting: () => state.current,
      saveDarkModeSetting: (value) => saved.push(value),
    },
  };
  const page = createPage({ modules, prefs: { theme } });
  page.installLoader();
  page.define('makeCometDarkModeStateProvider.react', (_g, _r, _m, exports) => {
    exports.default = function make(options) { return () => options; };
  });
  const exports = page.run('makeCometDarkModeStateProvider.react');
  if (provider) {
    // Mounting the provider runs the component that reads the setter.
    const element = exports.default({})({ children: 'page' });
    element.children[0].type();
  }
  return { page, saved, live };
}

test('the chosen theme becomes Messenger\'s own setting, through the live setter when it is there', async () => {
  const { page, saved, live } = themedPage({ theme: 'dark' });
  await page.advance(600);
  assert.deepEqual(live, ['ENABLED']);
  assert.deepEqual(saved, []);
  page.applyPrefs({ theme: 'light' });
  await page.advance(10);
  page.applyPrefs({ theme: 'system' });
  await page.advance(10);
  assert.deepEqual(live, ['ENABLED', 'DISABLED', 'USE_SYSTEM']);
});

test('without the setter the setting is saved once and the page changes on its next load', async () => {
  const { page, saved, live } = themedPage({ theme: 'light', provider: false });
  await page.advance(30_000);
  assert.deepEqual(saved, ['DISABLED']);
  assert.deepEqual(live, []);
});

test('a page that already has the setting is left alone, and an unknown theme means the system\'s', async () => {
  const { page, saved, live } = themedPage({ theme: 'dark', current: 'ENABLED' });
  await page.advance(600);
  assert.deepEqual([...saved, ...live], []);
  page.applyPrefs({ theme: 'sepia' });
  await page.advance(10);
  assert.deepEqual(live, ['USE_SYSTEM']);
});
