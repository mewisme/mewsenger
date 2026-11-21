import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createPage } from './page-harness.mjs';

const encode = (text) => new TextEncoder().encode(text);
const LIGHTSPEED = 'wss://edge-chat.messenger.com/ws/lightspeed?x=1';

// One request frame as Messenger sends it: a data part holding two flag bytes
// and the request as JSON, nested in strings.
function typingFrame(isTyping = 1, label = '3') {
  const inner = JSON.stringify({ thread_key: '123', is_typing: isTyping });
  const middle = JSON.stringify({ label, payload: inner, version: '1' });
  const json = encode(JSON.stringify({ type: 4, request_id: 7, payload: middle }));
  const frame = new Uint8Array(8 + json.length);
  const length = json.length + 2;
  frame.set([0x0d, 1, 0, length & 0xff, (length >> 8) & 0xff, length >> 16, 0, 0]);
  frame.set(json, 8);
  return frame;
}
const requestOf = (data) => {
  const bytes = new Uint8Array(data);
  const request = JSON.parse(new TextDecoder().decode(bytes.subarray(8)));
  return JSON.parse(JSON.parse(request.payload).payload);
};
const sentFrame = (page) => page.wire.frames.at(-1).data;

test('hiding typing sends the request with typing off, and everything else untouched', () => {
  const page = createPage({ prefs: { blockTyping: true } });
  const original = typingFrame(1);
  page.socket(LIGHTSPEED).send(original);
  assert.equal(requestOf(sentFrame(page)).is_typing, 0);
  assert.equal(requestOf(sentFrame(page)).thread_key, '123');
  const other = typingFrame(1, '9');
  page.socket(LIGHTSPEED).send(other);
  assert.equal(sentFrame(page), other, 'another kind of request is not edited');
  const text = 'hello';
  page.socket(LIGHTSPEED).send(text);
  assert.equal(sentFrame(page), text);
  page.socket('wss://other.example/ws/lightspeed'.replace('lightspeed', 'chat')).send(original);
  assert.equal(requestOf(sentFrame(page)).is_typing, 1, 'only the lightspeed socket is edited');
});

test('typing is shown when the choice is off, and follows a change at once', () => {
  const page = createPage({ prefs: { blockTyping: false } });
  page.socket(LIGHTSPEED).send(typingFrame(1));
  assert.equal(requestOf(sentFrame(page)).is_typing, 1);
  page.applyPrefs({ blockTyping: true });
  page.socket(LIGHTSPEED).send(typingFrame(1));
  assert.equal(requestOf(sentFrame(page)).is_typing, 0);
  page.applyPrefs({ blockTyping: false });
  page.socket(LIGHTSPEED).send(typingFrame(1));
  assert.equal(requestOf(sentFrame(page)).is_typing, 1);
});

test('a frame that is cut short goes out as it was', () => {
  const page = createPage({ prefs: { blockTyping: true } });
  const frame = typingFrame(1);
  const cut = frame.slice(0, frame.length - 5);
  page.socket(LIGHTSPEED).send(cut);
  assert.equal(sentFrame(page), cut);
});

test('typing in an encrypted chat is turned into idle on its way to the worker', () => {
  const page = createPage({ prefs: { blockTyping: true } });
  const batch = [
    { type: 'request', content: { name: 'sendChatStateFromComposer', arg: { state: 'typing', thread: 5 } } },
    { type: 'request', content: { name: 'somethingElse', arg: { state: 'typing' } } },
  ];
  page.port().postMessage(batch);
  const [state, other] = page.wire.messages.at(-1);
  assert.deepEqual({ ...state.content.arg }, { state: 'idle', thread: 5 });
  assert.equal(other.content.arg.state, 'typing');
  assert.equal(batch[0].content.arg.state, 'typing', 'Messenger\'s own object is not changed');
  page.applyPrefs({ blockTyping: false });
  page.port().postMessage(batch);
  assert.equal(page.wire.messages.at(-1)[0].content.arg.state, 'typing');
});
