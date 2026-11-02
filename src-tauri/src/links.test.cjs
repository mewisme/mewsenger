const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, 'links.js'), 'utf8');

function click(href, {
  button = 0, download = false, ctrlKey = false, metaKey = false,
  shiftKey = false, altKey = false, pageUrl = 'https://www.messenger.com/t/123',
} = {}) {
  const handlers = new Map();
  const opened = [];
  class Element {
    closest() {
      return { href, hasAttribute: (name) => name === 'download' && download };
    }
  }
  vm.runInNewContext(script, {
    URL,
    Element,
    location: new URL(pageUrl),
    document: { addEventListener: (name, listener) => handlers.set(name, listener) },
    window: { open: (...args) => opened.push(args) },
  });
  const event = {
    button,
    ctrlKey,
    metaKey,
    shiftKey,
    altKey,
    defaultPrevented: false,
    target: new Element(),
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  handlers.get('click')?.(event);
  return { event, opened, handlers };
}

test('external links open in the default-browser popup path', () => {
  const { event, opened } = click('https://example.com/post?x=1');
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(opened[0][0], 'https://example.com/post?x=1');
  assert.equal(opened[0][1], '_blank');
});

test('Messenger links and Facebook call windows remain inside the app', () => {
  for (const href of ['https://www.messenger.com/t/456', 'https://www.facebook.com/groupcall/123', 'https://www.facebook.com/login/']) {
    const { event, opened } = click(href);
    assert.equal(event.defaultPrevented, false);
    assert.equal(opened.length, 0);
  }
});

test('Facebook posts and redirected external links leave the app', () => {
  for (const href of [
    'https://www.facebook.com/reel/123',
    'https://l.messenger.com/l.php?u=https%3A%2F%2Fexample.com',
    'https://notmessenger.com/t/123',
    'https://www.facebook.com/groupcallback',
    'https://www.facebook.com/messages-malicious',
  ]) {
    const { event, opened } = click(href);
    assert.equal(event.defaultPrevented, true);
    assert.equal(opened.length, 1);
  }
});

test('download links, modifiers, non-web schemes and right clicks keep browser behavior', () => {
  for (const [href, options] of [
    ['https://example.com/file', { download: true }],
    ['javascript:alert(1)', {}],
    ['https://example.com', { button: 2 }],
    ['https://example.com', { button: 1 }],
    ['https://example.com', { ctrlKey: true }],
    ['https://example.com', { metaKey: true }],
    ['https://example.com', { shiftKey: true }],
    ['https://example.com', { altKey: true }],
  ]) {
    const { event, opened } = click(href, options);
    assert.equal(event.defaultPrevented, false);
    assert.equal(opened.length, 0);
  }
});

test('does not inject behavior into unrelated or insecure web origins', () => {
  for (const pageUrl of [
    'https://www.facebook.com/login/',
    'https://www.messenger.com.evil.example/',
    'https://l.messenger.com/',
    'https://other.messenger.com/',
    'http://www.messenger.com/',
  ]) {
    const { handlers, opened, event } = click('https://example.com/', { pageUrl });
    assert.equal(handlers.size, 0);
    assert.equal(opened.length, 0);
    assert.equal(event.defaultPrevented, false);
  }
});

test('does not override the native context menu', () => {
  const { handlers } = click('https://example.com');
  assert.equal(handlers.has('contextmenu'), false);
});