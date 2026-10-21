import test from 'node:test';
import assert from 'node:assert/strict';
import { ProbeChannel } from '../browser/probe-channel.mjs';
class Channel extends EventTarget {
  readyState = 'open'; bufferedAmount = 0;
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  send(data) { this.sent = data; }
}
test('automatic direct handshake holds early hello until protocol listener is installed', () => {
  const raw = new Channel(), probe = new ProbeChannel(raw), messages = [];
  raw.dispatchEvent(new MessageEvent('message', { data: 'hello' }));
  probe.addEventListener('message', event => messages.push(event.data));
  assert.deepEqual(messages, []); probe.activate(); probe.activate();
  raw.dispatchEvent(new MessageEvent('message', { data: 'offer' }));
  assert.deepEqual(messages, ['hello', 'offer']); probe.send('answer'); assert.equal(raw.sent, 'answer');
});
test('automatic handshake buffer is bounded and discarded on cancellation', () => {
  const raw = new Channel(), probe = new ProbeChannel(raw);
  raw.dispatchEvent(new MessageEvent('message', { data: 'x'.repeat(65537) })); assert.equal(raw.readyState, 'closed');
  probe.close(); assert.deepEqual(probe.pending, []);
});
