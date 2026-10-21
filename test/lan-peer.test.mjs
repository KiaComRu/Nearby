import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { lanOrigin } from '../lan-peer.mjs';

test('PC address accepts LAN invitations and rejects external URLs, admin links and credentials', () => {
  assert.equal(lanOrigin('http://192.168.1.10:53317/#pin=123456'), 'http://192.168.1.10:53317');
  assert.equal(lanOrigin('http://10.0.0.1:1234'), 'http://10.0.0.1:1234');
  for (const value of ['https://nearby.kiacom.ru/web/', 'http://example.org', 'http://8.8.8.8', 'http://169.254.169.254', 'http://192.168.1.1/#admin=secret', 'http://user:pass@192.168.1.1', 'http://192.168.1.1/api/state', 'http://192.168.1.1?next=other']) assert.throws(() => lanOrigin(value));
});

test('two independent PC engines pair, transfer binary and empty files both ways, preserve auth and disconnect', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-pc-pair-'));
  let first, second;
  const options = { host: '127.0.0.1', port: 0, statistics: false };
  try {
    first = await createApp({ ...options, storage: path.join(directory, 'one') });
    second = await createApp({ ...options, storage: path.join(directory, 'two') });
    const origin = app => `http://127.0.0.1:${app.port}`;
    const request = (app, url, { method = 'GET', data, body, key = app.adminToken } = {}) => fetch(origin(app) + url, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : body });
    const connection = { address: origin(first), pin: first.pin, device: 'Второй ПК · тест' };
    assert.equal((await request(second, '/api/peer/connect', { method: 'POST', data: connection, key: '' })).status, 403);
    assert.equal((await request(second, '/api/peer/connect', { method: 'POST', data: { ...connection, address: origin(second) } })).status, 400);
    const wrongPin = String((Number(first.pin) + 1) % 1000000).padStart(6, '0');
    assert.equal((await request(second, '/api/peer/connect', { method: 'POST', data: { ...connection, pin: wrongPin } })).status, 401);
    const connected = await request(second, '/api/peer/connect', { method: 'POST', data: connection });
    assert.equal(connected.status, 200);
    const connectedState = await connected.json();
    assert.equal(connectedState.admin, false); assert.equal(connectedState.localAdmin, true);
    assert.equal(connectedState.receivedDirectory, second.inbox);
    assert.ok(!JSON.stringify(connectedState).includes(first.adminToken));
    assert.equal((await (await request(second, '/api/state')).json()).peerConnection.origin, origin(first));
    assert.equal((await request(second, '/api/peer/remote/api/state', { key: '' })).status, 403);
    for (const route of ['/api/received/open', '/api/qr', '/api/shares', '/api/peer/connect']) assert.equal((await request(second, '/api/peer/remote' + route, { method: 'POST', data: {} })).status, 403);
    const binary = Buffer.from([0, 255, 1, 128, 10, 13]);
    for (const bytes of [binary, Buffer.alloc(0)]) {
      const offer = await (await request(second, '/api/peer/remote/api/offers', { method: 'POST', data: { name: 'ПК-файл.bin', size: bytes.length } })).json();
      assert.equal(offer.state, 'accepted', 'An authenticated PC connection permits automatic receiving');
      assert.equal((await request(second, `/api/peer/remote/api/offers/${offer.id}`, { method: 'POST', data: { action: 'accept' } })).status, 403);
      const sent = await request(second, `/api/peer/remote/api/offers/${offer.id}/upload`, { method: 'POST', body: bytes });
      assert.equal(sent.status, 201); assert.equal((await sent.json()).state, 'completed');
      const saved = (await readdir(first.inbox)).filter(file => file.endsWith('-ПК-файл.bin'));
      assert.ok((await Promise.all(saved.map(file => readFile(path.join(first.inbox, file))))).some(content => content.equals(bytes)));
      const share = await (await request(first, `/api/shares?name=${encodeURIComponent('ответ-ПК.bin')}&size=${bytes.length}`, { method: 'POST', body: bytes })).json();
      const visible = await (await request(second, '/api/peer/remote/api/state')).json();
      assert.ok(visible.shares.some(file => file.id === share.id)); assert.equal(visible.offers[0].device, connection.device);
      const ticket = await (await request(second, `/api/peer/remote/api/shares/${share.id}/ticket`, { method: 'POST', data: {} })).json();
      assert.ok(ticket.url.startsWith('/api/peer/download?ticket='));
      const download = await request(second, ticket.url, { key: '' });
      assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
      assert.equal((await request(second, ticket.url, { key: '' })).status, 403);
    }
    assert.equal((await request(second, '/api/peer/disconnect', { method: 'POST', data: {} })).status, 200);
    assert.equal((await request(second, '/api/peer/remote/api/state')).status, 409);
    assert.equal((await (await request(second, '/api/state')).json()).admin, true);
    assert.deepEqual((await (await request(first, '/api/state')).json()).connectedDevices, []);
    assert.equal((await request(second, '/api/peer/connect', { method: 'POST', data: connection })).status, 200);
    await first.close(); first = null;
    assert.equal((await request(second, '/api/peer/remote/api/state')).status, 504);
    assert.equal((await request(second, '/api/state')).status, 200, 'Its own PC remains usable after remote shutdown');
  } finally { await first?.close(); await second?.close(); await rm(directory, { recursive: true, force: true }); }
});
