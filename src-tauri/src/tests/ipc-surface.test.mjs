import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import { parts, part } from './inject-source.mjs';

const dir = new URL('../../capabilities/', import.meta.url);
const capabilities = fs.readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8')));
const byId = (id) => capabilities.find((capability) => capability.identifier === id);

test('only the remote Messenger view is reachable from a web origin', () => {
  const remote = capabilities.filter((capability) => capability.remote);
  assert.deepEqual(remote.map((capability) => capability.identifier), ['messenger-notifications']);
  assert.deepEqual(remote[0].webviews, ['messenger-*']);
  assert.equal(remote[0].local, false);
  for (const capability of capabilities) {
    if (capability.identifier !== 'messenger-notifications') {
      assert.ok(!capability.webviews?.some((view) => view.startsWith('messenger')), `${capability.identifier} reaches the remote view`);
      assert.ok(!capability.windows?.includes('main'), `${capability.identifier} reaches the main window`);
    }
  }
});

test('the remote view can only send bounded notification events', () => {
  assert.deepEqual(byId('messenger-notifications').permissions, ['allow-notification-event']);
});

test('no capability hands the default core permission set to Messenger or popups', () => {
  for (const capability of capabilities) {
    const reachesWeb = capability.remote || capability.webviews?.some((view) => view.startsWith('messenger') || view.startsWith('popup'));
    if (reachesWeb) {
      assert.ok(!capability.permissions.some((permission) => permission.startsWith('core:')), capability.identifier);
    }
  }
});

test('local views receive exactly the commands they use', () => {
  assert.deepEqual(byId('settings').permissions, [
    'core:event:allow-listen', 'core:event:allow-unlisten', 'core:app:allow-version',
    'allow-get-preferences', 'allow-set-preference',
    'allow-set-theme-preference', 'allow-set-update-schedule', 'allow-open-project-link',
    'allow-get-update-state', 'allow-check-update', 'allow-install-update',
    'allow-get-diagnostics', 'allow-test-notification', 'allow-list-accounts',
    'allow-add-account', 'allow-remove-account',
    'allow-open-account',
    'autostart:allow-enable', 'autostart:allow-disable', 'autostart:allow-is-enabled',
  ]);
  assert.equal(byId('default'), undefined);
  assert.equal(byId('desktop-capability'), undefined);
  for (const permission of [
    'allow-show-settings', 'allow-select-settings', 'allow-reveal-last-download', 'allow-get-update-state',
    'allow-check-update', 'allow-install-update',
  ]) {
    assert.ok(byId('titlebar').permissions.includes(permission), permission);
  }
  assert.deepEqual(byId('tabmenu').webviews, ['tabmenu']);
  assert.deepEqual(byId('tabmenu').permissions, [
    'allow-open-account', 'allow-list-accounts', 'allow-add-account', 'allow-close-tab-menu',
  ]);
  for (const permission of ['allow-open-account', 'allow-add-account', 'allow-close-tab', 'allow-open-tab-menu']) {
    assert.ok(byId('titlebar').permissions.includes(permission), permission);
  }
});

test('settings commands are not offered to the title bar view', () => {
  const permissions = byId('titlebar').permissions;
  assert.ok(!permissions.includes('allow-set-preference'));
  assert.ok(!permissions.includes('allow-get-preferences'));
  assert.ok(!permissions.some((permission) => permission.startsWith('autostart:')));
});

test('local views are granted by label pattern, one capability per kind', () => {
  assert.deepEqual(byId('titlebar').webviews, ['titlebar-*']);
  assert.deepEqual(byId('tabmenu').webviews, ['tabmenu']);
});

test('account and tab commands reach only the views that use them', () => {
  const settingsOnly = ['allow-remove-account'];
  const tabViews = ['allow-open-account', 'allow-add-account', 'allow-list-accounts'];
  const allowed = {
    settings: [...settingsOnly, ...tabViews],
    titlebar: [...tabViews, 'allow-close-tab', 'allow-open-tab-menu', 'allow-move-tab', 'allow-tab-shortcut'],
    tabmenu: [...tabViews, 'allow-close-tab-menu'],
  };
  const tracked = [...new Set(Object.values(allowed).flat())];
  for (const capability of capabilities) {
    const has = tracked.filter((permission) => capability.permissions.includes(permission));
    assert.deepEqual(has.sort(), [...(allowed[capability.identifier] ?? [])].sort(), capability.identifier);
  }
});

// The few parts that may touch the network primitives, and why: the typing
// filter edits Messenger's own requests on their way out, recovery watches its
// connections and probes whether Messenger answers, downloads fetch a photo
// the browser would not save, and the account part fetches the user's own
// picture to shrink it for the tab.
const MAY_USE_SOCKETS = new Set(['80-privacy-typing.js', '90-recover.js']);
const MAY_FETCH = new Set(['56-account-name.js', '90-recover.js', '94-downloads.js']);

test('injected page scripts touch network primitives only where listed', () => {
  for (const name of parts) {
    const source = part(name);
    assert.ok(!/XMLHttpRequest|sendBeacon/.test(source), `${name} uses XMLHttpRequest or sendBeacon`);
    assert.ok(MAY_USE_SOCKETS.has(name) || !/WebSocket/.test(source), `${name} touches WebSocket`);
    assert.ok(MAY_FETCH.has(name) || !/\bfetch\b/.test(source.replace(/\/\/.*$/gm, '')), `${name} uses fetch`);
  }
});
