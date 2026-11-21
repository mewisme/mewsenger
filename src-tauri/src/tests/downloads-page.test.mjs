import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'vitest';
import { Listeners } from './listeners.mjs';
import { part } from './inject-source.mjs';

const source = `(() => {\n${part('94-downloads.js')}\n})();`;

// A page holding only this part: the click listener, a fetch stand-in and an
// anchor factory that records what gets saved.
function setup({ fetchResult } = {}) {
  const handlers = new Listeners();
  const saved = [];
  const fetched = [];
  const revoked = [];
  const timers = [];
  class Element {}
  const context = {
    URL: class extends URL {
      static createObjectURL() { return 'blob:saved'; }
      static revokeObjectURL(url) { revoked.push(url); }
    },
    Element,
    location: new URL('https://www.messenger.com/t/1'),
    setTimeout(cb, ms) { timers.push({ cb, ms }); },
    fetch: async (href, init) => {
      fetched.push([href, { ...init }]);
      const result = fetchResult ?? { ok: true, blob: async () => ({}) };
      if (result instanceof Error) throw result;
      return result;
    },
    document: {
      addEventListener: (name, listener, capture) => handlers.set(name, (e) => listener(e, capture)),
      body: { append() {} },
      createElement: () => ({
        click() { saved.push({ href: this.href, download: this.download }); },
        remove() {},
      }),
    },
  };
  vm.runInNewContext(source, context);

  function click(href, { download = true, button = 0, prevented = false } = {}) {
    const target = new Element();
    const link = Object.assign(new Element(), {
      href,
      clicks: 0,
      click() { this.clicks += 1; handlers.get('click')({ ...makeEvent(), target }); },
    });
    target.closest = (selector) => (selector === 'a[download][href]' && download ? link : null);
    const makeEvent = () => ({
      button,
      defaultPrevented: prevented,
      preventDefault() { this.defaultPrevented = true; },
    });
    const event = { ...makeEvent(), target };
    handlers.get('click')(event);
    return { event, link };
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { click, settle, saved, fetched, revoked, timers, handlers };
}

test('a CDN download is fetched without cookies and saved under the CDN file name', async () => {
  const page = setup();
  const { event } = page.click('https://scontent-xyz1-1.xx.fbcdn.net/v/t1.6/a%20b.jpg?oh=1&oe=2');
  assert.equal(event.defaultPrevented, true);
  await page.settle();
  assert.equal(page.fetched.length, 1);
  assert.equal(page.fetched[0][0], 'https://scontent-xyz1-1.xx.fbcdn.net/v/t1.6/a%20b.jpg?oh=1&oe=2');
  assert.equal(page.fetched[0][1].credentials, 'omit');
  assert.deepEqual(page.saved, [{ href: 'blob:saved', download: 'a b.jpg' }]);
  page.timers[0].cb();
  assert.deepEqual(page.revoked, ['blob:saved']);
});

test('links that are not CDN downloads are left to the page', async () => {
  const page = setup();
  for (const [href, options] of [
    ['https://example.com/file.jpg'],
    ['https://www.messenger.com/file.jpg'],
    ['https://evilfbcdn.net/x.jpg'],
    ['http://scontent.xx.fbcdn.net/x.jpg'],
    ['blob:https://www.messenger.com/abc'],
    ['https://scontent.xx.fbcdn.net/x.jpg', { download: false }],
    ['https://scontent.xx.fbcdn.net/x.jpg', { button: 1 }],
    ['https://scontent.xx.fbcdn.net/x.jpg', { prevented: true }],
  ]) {
    const { event } = page.click(href, options);
    assert.equal(event.defaultPrevented, options?.prevented ?? false, href);
  }
  await page.settle();
  assert.equal(page.fetched.length, 0);
  assert.equal(page.saved.length, 0);
});

test('when the fetch fails the click runs again so the page behaves as before', async () => {
  for (const fetchResult of [new Error('offline'), { ok: false, status: 403 }]) {
    const page = setup({ fetchResult });
    const { link } = page.click('https://scontent.xx.fbcdn.net/v/clip.mp4');
    await page.settle();
    assert.equal(link.clicks, 1);
    assert.equal(page.saved.length, 0);
  }
});

test('the replayed click is not intercepted again and later clicks are', async () => {
  const page = setup({ fetchResult: new Error('offline') });
  page.click('https://scontent.xx.fbcdn.net/v/a.mp4');
  await page.settle();
  assert.equal(page.fetched.length, 1);
  page.click('https://scontent.xx.fbcdn.net/v/b.mp4');
  await page.settle();
  assert.equal(page.fetched.length, 2);
});
