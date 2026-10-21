import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('file-table metadata tracks delivery; only loopback owner can open managed files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nearby-file-table-')), opened = [];
  const app = await createApp({ host: '127.0.0.1', port: 0, storage: root, statistics: false, discovery: false, trustedLan: false, openTransferredFile: async file => opened.push(file) });
  const origin = `http://127.0.0.1:${app.port}`;
  const request = (url, { key = app.adminToken, method = 'GET', data, body } = {}) => fetch(origin + url, { method, headers: { Authorization: `Bearer ${key}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : body });
  try {
    const guest = await (await request('/api/join', { method: 'POST', data: { pin: app.pin, device: 'Recipient' }, key: '' })).json();
    await request('/api/state', { key: guest.token });
    const offer = await (await request('/api/offers', { key: guest.token, method: 'POST', data: { name: 'received.txt', size: 4 } })).json();
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'offer', id: offer.id } })).status, 404);
    const complete = await request(`/api/offers/${offer.id}/upload`, { key: guest.token, method: 'POST', body: 'data' }); assert.equal(complete.status, 201);
    assert.equal((await request('/api/files/open', { method: 'POST', key: guest.token, data: { kind: 'offer', id: offer.id } })).status, 403);
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'offer', id: '../outside', path: 'C:/Windows/not-owned.txt' } })).status, 404);
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'offer', id: offer.id } })).status, 200);
    assert.equal(await readFile(opened[0], 'utf8'), 'data'); assert.ok(opened[0].startsWith(path.join(root, 'received') + path.sep));
    const targets = await (await request('/api/send-targets')).json();
    const createdAt = Date.now();
    const share = await (await request(`/api/shares?name=sent.txt&size=4&recipient=${targets.targets[0].id}`, { method: 'POST', body: 'copy' })).json();
    assert.ok(share.created >= createdAt); assert.equal(share.state, 'ready'); assert.ok(!('path' in share));
    const ticket = await (await request(`/api/shares/${share.id}/ticket`, { method: 'POST', key: guest.token, data: {} })).json();
    assert.equal(await (await fetch(origin + ticket.url + '&nearbyFile=' + share.id)).text(), 'copy');
    let state; for (let attempt = 0; attempt < 50; attempt++) { state = await (await request('/api/state')).json(); if (state.shares[0].state === 'completed') break; await new Promise(resolve => setTimeout(resolve, 10)); } assert.equal(state.shares[0].state, 'completed'); assert.ok(state.shares[0].completedAt >= share.created);
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'share', id: share.id } })).status, 200); assert.equal(await readFile(opened[1], 'utf8'), 'copy');
  } finally { await app.close(); assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});
