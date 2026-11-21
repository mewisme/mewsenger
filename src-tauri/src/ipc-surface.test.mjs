import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';

const dir = new URL('../capabilities/', import.meta.url);
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
    'core:window:allow-close', 'allow-get-preferences', 'allow-set-preference',
    'allow-get-update-state', 'allow-check-update', 'allow-install-update',
    'allow-get-diagnostics', 'allow-test-notification', 'allow-list-accounts',
    'allow-add-account', 'allow-rename-account', 'allow-remove-account',
    'allow-set-layout', 'allow-open-account', 'allow-switch-account',
    'allow-set-settings-placement', 'allow-close-settings', 'autostart:allow-enable',
    'autostart:allow-disable', 'autostart:allow-is-enabled',
  ]);
  assert.deepEqual(byId('default').permissions, [
    'core:default', 'allow-show-settings', 'allow-reveal-last-download',
    'allow-get-update-state', 'allow-check-update', 'allow-install-update',
  ]);
  assert.deepEqual(byId('split').webviews, ['split']);
  assert.deepEqual(byId('split').permissions, [
    'allow-set-split-layout', 'core:event:allow-listen', 'core:event:allow-unlisten',
  ]);
});

test('settings commands are not offered to the status or title bar views', () => {
  for (const id of ['default', 'titlebar']) {
    const permissions = byId(id).permissions;
    assert.ok(!permissions.includes('allow-set-preference'), id);
    assert.ok(!permissions.includes('allow-get-preferences'), id);
    assert.ok(!permissions.some((permission) => permission.startsWith('autostart:')), id);
  }
});

test('local views are granted by label pattern, one capability per kind', () => {
  assert.deepEqual(byId('default').webviews, ['status-*']);
  assert.deepEqual(byId('desktop-capability').webviews, ['status-*']);
  assert.deepEqual(byId('titlebar').webviews, ['titlebar-*']);
});

test('account management and split layout commands reach only their own view', () => {
  const account = ['allow-list-accounts', 'allow-add-account', 'allow-rename-account',
    'allow-remove-account', 'allow-set-layout', 'allow-open-account',
    'allow-set-settings-placement', 'allow-close-settings'];
  for (const capability of capabilities) {
    const has = account.filter((permission) => capability.permissions.includes(permission));
    assert.deepEqual(has, capability.identifier === 'settings' ? account : [], capability.identifier);
    assert.equal(
      capability.permissions.includes('allow-set-split-layout'),
      capability.identifier === 'split',
      capability.identifier,
    );
    assert.equal(
      capability.permissions.includes('allow-switch-account'),
      capability.identifier === 'settings' || capability.identifier === 'titlebar',
      capability.identifier,
    );
  }
});

test('injected page scripts never wrap network primitives', () => {
  for (const name of ['links.js', 'desktop.js', 'notifications.js']) {
    const source = fs.readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.ok(!/WebSocket|XMLHttpRequest|\bfetch\s*=|\.fetch\b/.test(source), `${name} touches network primitives`);
  }
});
