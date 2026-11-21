import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'vitest';
import { createPage } from './page-harness.mjs';

test('a patch changes the module it names and reports it', () => {
  const p = createPage();
  p.installLoader();
  p.define('MWDesktopNotifications', (global, require, module, exports) => {
    exports.triggerLocalNotification = () => 'original';
  });
  const exports = p.run('MWDesktopNotifications');
  assert.notEqual(exports.triggerLocalNotification.toString(), (() => 'original').toString());
  assert.equal(p.window.__mewModules().MWDesktopNotifications, 'patched');
});

test('a module that does not look as expected is left alone', () => {
  const p = createPage();
  p.installLoader();
  p.define('MWDesktopNotifications', (global, require, module, exports) => {
    exports.somethingElse = 1;
  });
  const exports = p.run('MWDesktopNotifications');
  assert.deepEqual({ ...exports }, { somethingElse: 1 });
  assert.equal(p.window.__mewModules().MWDesktopNotifications, 'shape-mismatch');
});

test('modules without a hook go through the loader untouched', () => {
  const p = createPage();
  p.installLoader();
  const factory = (global, require, module, exports) => { exports.value = 7; };
  p.define('SomethingElse', factory);
  assert.equal(p.run('SomethingElse').value, 7);
  assert.equal(p.window.__mewModules().SomethingElse, undefined);
});

// The two checks that decide whether Messenger raises its own notifications,
// as they appear in Facebook's minified source.
const POPPER = `(function (global, require, module, exports) {
  var hidden = require("VisibilityAPI").isVisibilityHidden()===!0;
  var app = require("isMessengerPWA")()&&require("justknobx")._("1465");
  exports.raises = hidden && app;
})`;
const popperFactory = (source = POPPER) => vm.runInNewContext(source);

const modules = (hidden = false) => ({
  VisibilityAPI: { isVisibilityHidden: () => hidden },
  isMessengerPWA: () => false,
  justknobx: { _: () => true },
});

// The browser runs the blob script; the factory it carries lands on window.
function loadRewritten(p, view) {
  const carried = {};
  vm.runInNewContext(p.blobs.at(-1), { window: carried, document: view });
  const [key] = Object.keys(carried);
  p.window[key] = carried[key];
  p.appended[0].onload();
}

test('Messenger counts a window without focus as away and as an installed app', () => {
  const p = createPage();
  const view = { focus: false, hasFocus: () => view.focus };
  p.installLoader();
  p.define('useMWLSChatPopperUpper', popperFactory());
  loadRewritten(p, view);
  assert.equal(p.window.__mewModules().useMWLSChatPopperUpper, 'rewritten');
  assert.equal(p.run('useMWLSChatPopperUpper', (name) => modules()[name]).raises, true, 'unfocused window raises notifications');
  view.focus = true;
  assert.equal(p.run('useMWLSChatPopperUpper', (name) => modules()[name]).raises, false, 'focused window does not');
  assert.equal(p.run('useMWLSChatPopperUpper', (name) => modules(true)[name]).raises, true, 'a hidden window still does');
});

test('a source that no longer matches exactly once is not rewritten', () => {
  for (const source of [
    POPPER.replace('isVisibilityHidden()===!0', 'isVisibilityHidden()===true'),
    POPPER.replace(/\}\)$/, '; require("VisibilityAPI").isVisibilityHidden()===!0 })'),
  ]) {
    const p = createPage();
    p.installLoader();
    p.define('useMWLSChatPopperUpper', popperFactory(source));
    assert.equal(p.window.__mewModules().useMWLSChatPopperUpper, 'no-match');
    assert.equal(p.appended.length, 0);
  }
});

test('a rewrite the page refuses leaves the original module running', () => {
  const p = createPage();
  p.installLoader();
  p.define('useMWLSChatPopperUpper', popperFactory());
  p.appended[0].onerror();
  assert.equal(p.window.__mewModules().useMWLSChatPopperUpper, 'blocked');
  assert.equal(p.run('useMWLSChatPopperUpper', (name) => modules()[name]).raises, false, 'unchanged: not an installed app');
});
