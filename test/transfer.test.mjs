import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, safeName } from '../server.mjs';

let app, root, base, guest, other, openedFolder;
async function call(url, { method = 'GET', key = guest, data, body, headers = {} } = {}) {
  return fetch(base + url, { method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: data === undefined ? body : JSON.stringify(data),
  });
}
async function offer(name, size, key = guest) {
  const response = await call('/api/offers', { method: 'POST', key, data: { name, size } });
  assert.equal(response.status, 201);
  return response.json();
}
async function accept(id) {
  const response = await call(`/api/offers/${id}`, { method: 'POST', key: app.adminToken, data: { action: 'accept' } });
  assert.equal(response.status, 200);
}
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nearby-test-'));
  app = await createApp({ host: '127.0.0.1', port: 0, storage: root, maxSize: 8 * 1024 ** 2,
    openReceivedFolder: async folder => { openedFolder = folder; } });
  base = `http://127.0.0.1:${app.port}`;
  for (const name of ['Телефон', 'Другой телефон']) {
    const response = await call('/api/join', { method: 'POST', key: '', data: { pin: app.pin, device: name } });
    assert.equal(response.status, 200);
    const { token } = await response.json();
    if (!guest) guest = token; else other = token;
  }
});
after(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test('rejects path traversal, Windows reserved names and controls', () => {
  for (const name of ['../secret', 'C:\\test.txt', 'CON.txt', 'a\u0000.txt', 'nul', '.', 'a ', 'file.']) {
    assert.throws(() => safeName(name));
  }
  assert.equal(safeName('Фотография 2026.jpg'), 'Фотография 2026.jpg');
});

test('static page loads; unauthenticated clients cannot inspect state', async () => {
  const page = await call('/', { key: '' });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Nearby/u);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/u);
  assert.equal((await call('/api/state', { key: '' })).status, 401);
  const state = await (await call('/api/state')).json();
  assert.equal(state.admin, false);
  assert.equal(state.pin, undefined);
  assert.equal(state.urls, undefined);
  assert.equal(state.receivedDirectory, undefined);
});

test('only the local owner can see and open the fixed receive folder', async () => {
  const state = await (await call('/api/state', { key: app.adminToken })).json();
  assert.equal(state.receivedDirectory, app.inbox);
  assert.ok(path.isAbsolute(state.receivedDirectory));
  assert.equal((await call('/api/received/open', { method: 'POST', key: '' })).status, 403);
  assert.equal((await call('/api/received/open', { method: 'POST' })).status, 403);
  assert.equal(openedFolder, undefined);
  assert.equal((await call('/api/received/open', { method: 'POST', key: app.adminToken,
    data: { path: '..', command: 'ignored' } })).status, 200);
  assert.equal(openedFolder, app.inbox);
});

test('PIN is required and malformed unicode does not crash comparison', async () => {
  for (const pin of ['xxxxxx', '😀😀😀']) {
    assert.equal((await call('/api/join', { method: 'POST', key: '', data: { pin } })).status, 401);
  }
});

test('rejects requests from a different web origin and unexpected Host', async () => {
  assert.equal((await call('/api/state', { headers: { Origin: 'https://example.org' } })).status, 403);
  const result = await new Promise((resolve, reject) => {
    const req = http.get(base + '/api/state', { headers: { Host: `evil.test:${app.port}`, Authorization: `Bearer ${guest}` } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  assert.equal(result, 403);
});

test('upload requires approval; another guest cannot approve or use the offer', async () => {
  const incoming = await offer('approved.txt', 5);
  assert.equal((await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', body: 'hello' })).status, 409);
  assert.equal((await call(`/api/offers/${incoming.id}`, { method: 'POST', data: { action: 'accept' } })).status, 403);
  const otherState = await (await call('/api/state', { key: other })).json();
  assert.ok(!otherState.offers.some(x => x.id === incoming.id));
  await accept(incoming.id);
  assert.equal((await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', key: other, body: 'hello' })).status, 403);
  const sent = await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', body: 'hello' });
  assert.equal(sent.status, 201);
  const state = await sent.json();
  assert.equal(state.state, 'completed'); assert.equal(state.received, 5);
  const file = (await readdir(app.inbox)).find(name => name.endsWith('-approved.txt'));
  assert.equal(await readFile(path.join(app.inbox, file), 'utf8'), 'hello');
  assert.equal((await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', body: 'hello' })).status, 409);
});

test('rejected file cannot upload', async () => {
  const incoming = await offer('rejected.txt', 3);
  assert.equal((await call(`/api/offers/${incoming.id}`, { method: 'POST', key: app.adminToken, data: { action: 'reject' } })).status, 200);
  assert.equal((await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', body: 'abc' })).status, 409);
});

test('wrong size fails without a partial file', async () => {
  const incoming = await offer('wrong-size.txt', 20);
  await accept(incoming.id);
  assert.equal((await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', body: 'short' })).status, 400);
  assert.ok(!(await readdir(app.inbox)).some(name => name.endsWith('.part') || name.endsWith('-wrong-size.txt')));
});

test('two files with the same name are preserved; empty files work', async () => {
  for (const data of ['first', 'second']) {
    const incoming = await offer('duplicate.txt', data.length); await accept(incoming.id);
    assert.equal((await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', body: data })).status, 201);
  }
  assert.equal((await readdir(app.inbox)).filter(name => name.endsWith('-duplicate.txt')).length, 2);
  const incoming = await offer('empty.txt', 0); await accept(incoming.id);
  assert.equal((await call(`/api/offers/${incoming.id}/upload`, { method: 'POST', body: '' })).status, 201);
});

test('interrupted upload removes the temporary file and records failure', async () => {
  const incoming = await offer('interrupted.bin', 1_000_000); await accept(incoming.id);
  await new Promise(resolve => {
    const req = http.request(base + `/api/offers/${incoming.id}/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${guest}`, 'Content-Length': 1_000_000 },
    });
    req.on('error', () => resolve());
    req.write(Buffer.alloc(10_000));
    setTimeout(() => req.destroy(), 80);
  });
  let completed = false;
  for (let i = 0; i < 40; i++) {
    const state = await (await call('/api/state')).json();
    if (state.offers.find(x => x.id === incoming.id).state === 'failed') { completed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(completed, true);
  assert.ok(!(await readdir(app.inbox)).some(name => name.endsWith('.part') || name.endsWith('-interrupted.bin')));
});

test('host shares binary data, guest downloads with a single-use ticket, host removes it', async () => {
  const binary = Buffer.from([0, 255, 1, 2, 10, 13, 128]);
  const publish = await call(`/api/shares?name=${encodeURIComponent('Пример.bin')}&size=${binary.length}`, {
    method: 'POST', key: app.adminToken, body: binary,
  });
  assert.equal(publish.status, 201);
  const shared = await publish.json();
  assert.equal((await call(`/api/shares/${shared.id}/download`, { key: '' })).status, 403);
  const ticket = await (await call(`/api/shares/${shared.id}/ticket`, { method: 'POST' })).json();
  const download = await call(ticket.url, { key: '' });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8/u);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), binary);
  assert.equal((await call(ticket.url, { key: '' })).status, 403);
  assert.equal((await call(`/api/shares/${shared.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await call(`/api/shares/${shared.id}`, { method: 'DELETE', key: app.adminToken })).status, 200);
  assert.equal((await readdir(path.join(root, 'shared'))).length, 0);
});

test('invalid sizes and unsafe names are rejected at the API boundary', async () => {
  for (const data of [{ name: '../escape', size: 1 }, { name: 'huge.bin', size: 9 * 1024 ** 2 }, { name: 'a.txt', size: -1 }]) {
    assert.equal((await call('/api/offers', { method: 'POST', data })).status, 400);
  }
});

test('QR endpoint requires host privileges', async () => {
  assert.equal((await call('/api/qr?ip=127.0.0.1')).status, 403);
  const ip = app.urls.length ? new URL(app.urls[0]).hostname : null;
  if (ip) {
    const response = await call(`/api/qr?ip=${ip}`, { key: app.adminToken });
    assert.equal(response.status, 200); assert.match(await response.text(), /<svg/u);
  }
});

test('PIN brute force is rate limited', async () => {
  let response;
  for (let i = 0; i < 9; i++) response = await call('/api/join', { method: 'POST', key: '', data: { pin: 'invalid' } });
  assert.equal(response.status, 429);
});
