import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'vitest';
import { site } from './site-fixture.mjs';

const script = `(() => {\n${['00-guard', '20-top-frame', '22-ipc', '24-dom', '26-prefs', '97-wide']
  .map((name) => readFileSync(new URL(`../inject/${name}.js`, import.meta.url), 'utf8').trimEnd() + '\n')
  .join('')}})();\n`;

// A chain of elements from the chat up to the body; `maxWidths` is what each
// one computes, from the chat's parent outwards.
function page(maxWidths) {
  const timers = [];
  const body = { hasAttribute: () => false };
  let parent = body;
  const chain = [];
  for (const maxWidth of [...maxWidths].reverse()) {
    const marks = new Set();
    const el = { parentElement: parent, maxWidth, hasAttribute: (n) => marks.has(n), setAttribute: (n) => marks.add(n), marks };
    chain.unshift(el);
    parent = el;
  }
  const main = { parentElement: parent };
  const appended = [];
  const window = { addEventListener() {}, __MEW_SITE__: site };
  window.top = window;
  const document = {
    body,
    documentElement: { append: (node) => appended.push(node) },
    querySelector: (selector) => (selector === '[role="main"]' ? main : null),
    createElement: () => ({}),
    addEventListener() {},
  };
  vm.runInNewContext(script, {
    window, document, location: new URL('https://www.messenger.com/t/1'),
    navigator: {}, URL, clearTimeout() {},
    MutationObserver: class { observe() {} },
    getComputedStyle: (el) => ({ maxWidth: el.maxWidth }),
    setTimeout(cb) { timers.push(cb); return timers.length; },
  });
  while (timers.length) timers.shift()();
  return { chain, appended };
}

test('the page-wide px cap is marked and lifted, small and unset widths are left alone', () => {
  const { chain, appended } = page(['none', '2560px', '320px', 'none']);
  assert.deepEqual(chain.map((el) => el.marks.has('data-mew-wide')), [false, true, false, false]);
  assert.match(appended[0].textContent, /\[data-mew-wide\] \{ max-width: none !important; \}/);
});

test('a page without a cap gets no mark', () => {
  const { chain } = page(['none', '100%']);
  assert.ok(chain.every((el) => !el.marks.has('data-mew-wide')));
});
