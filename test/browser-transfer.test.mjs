import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FileLink, MEMORY_LIMIT, validateFileSpec } from '../browser/transfer.mjs';

class Channel extends EventTarget {
  readyState = 'open'; bufferedAmount = 0;
  send(data) {
    if (this.readyState !== 'open') throw new Error('closed');
    const copy = typeof data === 'string' ? data : data.slice(0);
    queueMicrotask(() => { if (this.other.readyState === 'open') this.other.dispatchEvent(new MessageEvent('message', { data: this.mutate?.(copy) ?? copy })); });
  }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
}
function pair() { const a = new Channel(), b = new Channel(); a.other = b; b.other = a; return [a, b]; }
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('browser protocol rejects unsafe names and invalid sizes', () => {
  for (const name of ['../x', 'CON.txt', 'bad\0name', 'x/y', 'x\\y', 'x.']) assert.throws(() => validateFileSpec({ id: crypto.randomUUID(), name, size: 2 }));
  assert.throws(() => validateFileSpec({ id: crypto.randomUUID(), name: 'x', size: MEMORY_LIMIT + 1 }, MEMORY_LIMIT));
  assert.throws(() => validateFileSpec({ id: 'x', name: 'x', size: 1 }));
});

test('browser transfer requires acceptance, verifies chunks and preserves binary and empty files', async () => {
  const [a, b] = pair(); let offer, result, writes = 0;
  const sender = new FileLink(a), receiver = new FileLink(b, { onOffer: value => { offer = value; }, onComplete: (id, direction, data) => { result = data; } });
  try {
    await tick();
    for (const bytes of [randomBytes(80 * 1024 + 7), Buffer.alloc(0)]) {
      offer = null; result = null;
      const sending = sender.sendFile(new File([bytes], 'тест.bin'));
      await tick(); assert.ok(offer); assert.equal(writes, 0);
      const parts = [];
      await receiver.accept(offer.id, { write: async data => { writes++; parts.push(Buffer.from(data)); }, close: async () => Buffer.concat(parts), abort: async () => {} });
      await sending; await tick(); assert.deepEqual(result, bytes); writes = 0;
    }
  } finally { sender.close(); receiver.close(); a.close(); b.close(); }
});

test('browser rejection ends both sides without cancel echo loop', async () => {
  const [a, b] = pair(); let messages = 0;
  a.mutate = data => { messages++; return data; }; b.mutate = data => { messages++; return data; };
  const sender = new FileLink(a), receiver = new FileLink(b, { onOffer: value => receiver.cancel(value.id, 'declined') });
  try { await tick(); await assert.rejects(sender.sendFile(new File(['hello'], 'hello.txt')), /отклонена|отменена/); await tick(); assert.ok(messages < 10); }
  finally { sender.close(); receiver.close(); a.close(); b.close(); }
});

test('browser corrupted chunk is rejected before it reaches the sink', async () => {
  const [a, b] = pair(); let writes = 0, failure = '';
  a.mutate = data => { if (data instanceof ArrayBuffer) new Uint8Array(data)[0] ^= 255; return data; };
  const sender = new FileLink(a), receiver = new FileLink(b, { onOffer: value => receiver.accept(value.id, { write: async () => { writes++; }, close: async () => {}, abort: async () => {} }), onError: (id, message) => { failure = message; } });
  try { await tick(); await assert.rejects(sender.sendFile(new File(['hello'], 'hello.txt'))); assert.equal(writes, 0); assert.match(failure, /сумма/); }
  finally { sender.close(); receiver.close(); a.close(); b.close(); }
});

test('browser disconnect rejects a pending transfer and releases the sink', async () => {
  const [a, b] = pair(); let aborted = false;
  const sender = new FileLink(a), receiver = new FileLink(b, { onOffer: async value => { await receiver.accept(value.id, { write: async () => {}, close: async () => {}, abort: async () => { aborted = true; } }); a.close(); b.close(); } });
  try { await tick(); await assert.rejects(sender.sendFile(new File(['hello'], 'hello.txt'))); assert.ok(aborted); }
  finally { sender.close(); receiver.close(); }
});

test('browser cancellation during transfer leaves the channel usable for the next file', async () => {
  const [a, b] = pair(); let cancelFirst = true, aborted = false, received;
  const sender = new FileLink(a), receiver = new FileLink(b, {
    onOffer: value => { const parts = []; receiver.accept(value.id, { write: async data => parts.push(Buffer.from(data)), close: async () => Buffer.concat(parts), abort: async () => { aborted = true; } }); },
    onProgress: (id, bytes) => { if (cancelFirst && bytes > 0) { cancelFirst = false; receiver.cancel(id); } },
    onComplete: (id, direction, data) => { received = data; }
  });
  try {
    await tick(); await assert.rejects(sender.sendFile(new File([randomBytes(100000)], 'cancel.bin')));
    await tick(); assert.ok(aborted); assert.equal(a.readyState, 'open'); assert.equal(b.readyState, 'open');
    await sender.sendFile(new File(['after cancellation'], 'next.txt')); assert.equal(received.toString(), 'after cancellation');
  } finally { sender.close(); receiver.close(); a.close(); b.close(); }
});
