import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

test('local transfers count only saved uploads and finished guest downloads; offline events survive restart', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'nearby-local-stats-'));
  const events = new Map(); let offline = false, app, base, guest;
  const statistics = { source: 'windows', retryMs: 3600000, fetchImpl: async (_url, options) => {
    if (offline) throw new Error('No internet');
    const body = JSON.parse(options.body);
    if (body.action === 'local-session') return Response.json({ token: 'abc.def' }, { status: 201 });
    if (body.action === 'record-local-transfer') { events.set(body.id, body); return Response.json({ ok: true }); }
    return Response.json({ files: events.size, bytes: [...events.values()].reduce((sum, event) => sum + event.size, 0), startedAt: '2026-10-12T20:00:00Z', updatedAt: null });
  } };
  const start = async () => {
    app = await createApp({ host: '127.0.0.1', port: 0, storage, statistics });
    base = `http://127.0.0.1:${app.port}`;
    const response = await request('/api/join', { pin: app.pin }); guest = (await response.json()).token;
  };
  const request = (url, data, key = guest, body, method = 'POST') => fetch(base + url, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : body });
  const upload = async (name, body, declared = body.length, approve = true) => {
    const offer = await (await request('/api/offers', { name, size: declared })).json();
    await request(`/api/offers/${offer.id}`, { action: approve ? 'accept' : 'reject' }, app.adminToken);
    return request(`/api/offers/${offer.id}/upload`, null, guest, body);
  };
  const waitTotals = async (files, bytes) => {
    for (let i = 0; i < 100; i++) {
      if (events.size === files && [...events.values()].reduce((sum, event) => sum + event.size, 0) === bytes) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`Unexpected totals: ${JSON.stringify([...events.values()])}`);
  };
  try {
    await start();
    assert.equal((await upload('saved.txt', Buffer.from('hello'))).status, 201);
    assert.equal((await upload('empty.txt', Buffer.alloc(0))).status, 201);
    await waitTotals(2, 5);
    assert.equal((await upload('wrong-size.txt', Buffer.from('x'), 10)).status, 400);
    assert.equal((await upload('declined.txt', Buffer.from('x'), 1, false)).status, 409);
    const share = await (await request('/api/shares?name=shared.bin&size=7', null, app.adminToken, Buffer.alloc(7))).json();
    await waitTotals(2, 5);
    for (const key of [guest, app.adminToken, guest]) {
      const ticket = await (await request(`/api/shares/${share.id}/ticket`, null, key)).json();
      assert.equal((await (await request(ticket.url, null, '', undefined, 'GET')).arrayBuffer()).byteLength, 7);
    }
    await waitTotals(4, 19);
    const large = await (await request('/api/shares?name=interrupted.bin&size=16777216', null, app.adminToken, Buffer.alloc(16777216))).json();
    const ticket = await (await request(`/api/shares/${large.id}/ticket`)).json();
    await new Promise(resolve => {
      const request = http.get(base + ticket.url, response => { response.once('data', () => { response.destroy(); request.destroy(); resolve(); }); });
      request.on('error', resolve);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    await waitTotals(4, 19);
    const publicStats = await (await request('/api/statistics', null, '', undefined, 'GET')).json();
    assert.equal(publicStats.files, 4); assert.equal(publicStats.bytes, 19);
    offline = true;
    assert.equal((await upload('offline.txt', Buffer.from('test'))).status, 201);
    await app.close();
    const queued = JSON.parse(await readFile(path.join(storage, 'statistics-outbox.json'), 'utf8'));
    assert.equal(queued.length, 1); assert.equal(queued[0].size, 4);
    assert.ok(!JSON.stringify(queued).includes('offline.txt'));
    offline = false; await start(); await waitTotals(5, 23);
    for (const event of events.values()) assert.deepEqual(Object.keys(event).sort(), ['action', 'completedAt', 'id', 'size', 'source', 'token']);
  } finally { await app?.close(); await rm(storage, { recursive: true, force: true }); }
});
