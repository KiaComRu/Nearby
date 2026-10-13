import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { newRelaySecret, relayCipher, HttpsRelayChannel } from '../browser/relay.mjs';
import { FileLink } from '../browser/transfer.mjs';

test('internet encryption binds frames to room, direction and sequence; changed key/data cannot decrypt', async () => {
  const room = 'a'.repeat(32), secret = newRelaySecret();
  const sender = await relayCipher(room, secret, 'host'), receiver = await relayCipher(room, secret, 'host');
  const encrypted = await sender.encrypt(1, 'private-файл.txt');
  assert.equal(await receiver.decrypt(1, encrypted), 'private-файл.txt');
  assert.ok(!encrypted.includes('private'));
  assert.equal(Buffer.from(await receiver.decrypt(2, await sender.encrypt(2, new Uint8Array([0, 255]).buffer))).toString('hex'), '00ff');
  for (const cipher of [await relayCipher(room, secret, 'guest'), await relayCipher('b'.repeat(32), secret, 'host'), await relayCipher(room, newRelaySecret(), 'host')]) await assert.rejects(cipher.decrypt(1, encrypted));
  await assert.rejects(receiver.decrypt(2, encrypted));
  const changed = Buffer.from(encrypted, 'base64'); changed[0] ^= 1;
  await assert.rejects(receiver.decrypt(1, changed.toString('base64')));
  assert.notEqual(await sender.encrypt(2, 'same'), await sender.encrypt(3, 'same'));
});

test('encrypted HTTPS channel transfers binary and empty files with negotiated chunks and idempotent retries', { timeout: 15000 }, async () => {
  const room = 'a'.repeat(32), secret = newRelaySecret();
  const queues = { host: [], guest: [] }, seen = { host: new Map(), guest: new Map() }, captured = [];
  let responseLost = false;
  const request = role => async (action, body) => {
    captured.push(structuredClone(body));
    if (action === 'relay-push') {
      for (const frame of body.frames) {
        if (!seen[role].has(frame.seq)) { seen[role].set(frame.seq, frame.data); queues[role].push(frame); }
        else assert.equal(seen[role].get(frame.seq), frame.data);
      }
      if (!responseLost) { responseLost = true; throw new Error('Acknowledgement lost'); }
      return { seq: body.frames.at(-1).seq };
    }
    const other = role === 'host' ? 'guest' : 'host';
    queues[other] = queues[other].filter(frame => frame.seq > body.after);
    return { frames: structuredClone(queues[other]) };
  };
  const channels = ['host', 'guest'].map(role => new HttpsRelayChannel({ room, secret, role, request: request(role), idleMs: 5 }));
  let sender, receiver, received, offer, maxWrite = 0;
  const ready = [];
  channels[0].addEventListener('open', () => { sender = new FileLink(channels[0], { onReady: () => ready.push('host') }); });
  channels[1].addEventListener('open', () => { receiver = new FileLink(channels[1], { onReady: () => ready.push('guest'), onOffer: value => { offer = value; }, onComplete: (_id, _direction, result) => { received = result; } }); });
  const until = async condition => { for (let i = 0; i < 1000; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Relay state did not advance'); };
  try {
    await Promise.all(channels.map(channel => channel.start())); await until(() => ready.length === 2);
    assert.equal(sender.chunkSize, 262144);
    for (const bytes of [randomBytes(1024 * 1024 + 7), Buffer.alloc(0)]) {
      offer = null; received = null;
      const sending = sender.sendFile(new File([bytes], 'secret-photo.bin'));
      await until(() => offer !== null);
      const parts = [];
      await receiver.accept(offer.id, { write: async data => { parts.push(Buffer.from(data)); maxWrite = Math.max(maxWrite, data.byteLength); }, close: async () => Buffer.concat(parts), abort: async () => {} });
      await sending; await until(() => received !== null);
      assert.deepEqual(received, bytes);
    }
    assert.equal(maxWrite, 262144);
    assert.ok(!JSON.stringify(captured).includes('secret-photo.bin'));
    assert.ok(!JSON.stringify(captured).includes(secret));
  } finally { sender?.close(); receiver?.close(); channels.forEach(channel => channel.close()); }
});
