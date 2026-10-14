import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createApp } from '../server.mjs';
const request = (app, route, token = app.adminToken, data, extra = {}) => fetch(`http://127.0.0.1:${app.port}` + route, {
  method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
  body: data === undefined ? undefined : JSON.stringify(data),
});
async function join(app, name = 'Одинаковое имя') {
  const { token } = await (await request(app, '/api/join', '', { pin: app.pin, device: name })).json();
  await request(app, '/api/state', token); return token;
}
const targets = async app => (await (await request(app, '/api/send-targets')).json()).targets;
const share = (app, id, data = Buffer.from('selected recipient')) => fetch(`http://127.0.0.1:${app.port}/api/shares?name=file.txt&size=${data.length}${id === undefined ? '' : '&recipient=' + encodeURIComponent(id)}`, { method: 'POST', headers: { Authorization: `Bearer ${app.adminToken}` }, body: data });

test('targeted shares are visible and downloadable only by the selected active client', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-targets-')); let app;
  try {
    app = await createApp({ host: '127.0.0.1', port: 0, storage: directory, statistics: false, discovery: false, trustedLan: false });
    assert.deepEqual(await targets(app), []);
    assert.equal((await request(app, '/api/send-targets', '')).status, 403);
    const first = await join(app), second = await join(app), list = await targets(app);
    assert.equal(list.length, 2); assert.notEqual(list[0].id, list[1].id);
    assert.ok(!JSON.stringify(list).includes(first) && !JSON.stringify(list).includes(second));
    assert.equal((await request(app, '/api/send-targets', first)).status, 403);
    const data = Buffer.from('Только выбранному получателю & spaces\0\xff');
    const response = await share(app, list[0].id, data); assert.equal(response.status, 201); const sent = await response.json();
    const state = async key => (await (await request(app, '/api/state', key)).json()).shares;
    assert.deepEqual((await state(first)).map(x => x.id), [sent.id]); assert.deepEqual(await state(second), []);
    assert.equal((await request(app, `/api/shares/${sent.id}/ticket`, second, {})).status, 403);
    assert.equal((await request(app, `/api/shares/${sent.id}/ticket`, '', {})).status, 401);
    const { url } = await (await request(app, `/api/shares/${sent.id}/ticket`, first, {})).json();
    const download = await request(app, url, ''); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), data);
    assert.equal((await request(app, url, '')).status, 403, 'One-use download ticket');
    assert.equal((await share(app, 'missing')).status, 409);
    assert.equal((await readdir(path.join(directory, 'shared'))).length, 1, 'Invalid target does not copy a file');
    const broadcast = await share(app); assert.equal(broadcast.status, 201);
    assert.equal((await state(second)).length, 1, 'Existing ordinary sharing stays compatible');
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('expired and explicitly disconnected recipients cannot be silently replaced by a reconnect', async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-target-expiry-')); let app;
  try {
    app = await createApp({ host: '127.0.0.1', port: 0, storage: directory, statistics: false, discovery: false, trustedLan: false });
    const key = await join(app); const old = (await targets(app))[0];
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() }); context.mock.timers.tick(46000);
    assert.deepEqual(await targets(app), []); assert.equal((await share(app, old.id)).status, 409);
    await request(app, '/api/state', key); const renewed = (await targets(app))[0]; assert.notEqual(renewed.id, old.id);
    assert.equal((await share(app, old.id)).status, 409);
    assert.equal((await request(app, '/api/leave', key, {})).status, 200);
    assert.deepEqual(await targets(app), []); assert.equal((await share(app, renewed.id)).status, 409);
  } finally { context.mock.timers.reset(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('selected outgoing connection identity protects offers and uploads when switching PCs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-target-peer-')); let sender, receiver;
  try {
    const settings = storage => ({ host: '127.0.0.1', port: 0, storage, statistics: false, discovery: false, trustedLan: false });
    sender = await createApp(settings(path.join(directory, 'sender'))); receiver = await createApp(settings(path.join(directory, 'receiver')));
    const connect = () => request(sender, '/api/peer/connect', sender.adminToken, { address: `http://127.0.0.1:${receiver.port}`, pin: receiver.pin, device: 'Sender' });
    assert.equal((await connect()).status, 200); const old = (await targets(sender))[0]; assert.equal(old.kind, 'peer');
    await request(sender, '/api/peer/disconnect', sender.adminToken, {}); assert.equal((await connect()).status, 200);
    const current = (await targets(sender))[0]; assert.notEqual(current.id, old.id);
    assert.equal((await request(sender, '/api/peer/remote/api/offers', sender.adminToken, { name: 'wrong.txt', size: 0 }, { 'X-Nearby-Peer': old.id })).status, 409);
    assert.equal((await request(sender, '/api/peer/remote/api/state', sender.adminToken, undefined, { 'X-Nearby-Peer': old.id })).status, 409);
    const result = await request(sender, '/api/peer/remote/api/offers', sender.adminToken, { name: 'correct.txt', size: 0 }, { 'X-Nearby-Peer': current.id }); assert.equal(result.status, 201);
    const offer = await result.json(); assert.equal((await request(receiver, `/api/offers/${offer.id}`, receiver.adminToken, { action: 'accept' })).status, 200);
    const upload = await fetch(`http://127.0.0.1:${sender.port}/api/peer/remote/api/offers/${offer.id}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${sender.adminToken}`, 'X-Nearby-Peer': current.id }, body: Buffer.alloc(0) }); assert.equal(upload.status, 201);
    const received = (await (await request(receiver, '/api/state')).json()).offers; assert.equal(received.length, 1); assert.equal(received[0].state, 'completed');
  } finally { await Promise.all([sender?.close(), receiver?.close()]); await rm(directory, { recursive: true, force: true }); }
});

test('a recipient leaving during staging prevents the selected file from being published', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-target-interrupted-')); let app;
  try {
    app = await createApp({ host: '127.0.0.1', port: 0, storage: directory, statistics: false, discovery: false, trustedLan: false });
    const key = await join(app), selected = (await targets(app))[0], body = new PassThrough();
    const response = fetch(`http://127.0.0.1:${app.port}/api/shares?name=partial.bin&size=2&recipient=${selected.id}`, { method: 'POST', headers: { Authorization: `Bearer ${app.adminToken}`, 'Content-Length': '2' }, body, duplex: 'half' });
    body.write(Buffer.from([1]));
    for (let i=0;i<100;i++) { if ((await readdir(path.join(directory,'shared'))).some(name => name.endsWith('.part'))) break; await new Promise(resolve => setTimeout(resolve,10)); }
    await request(app, '/api/leave', key, {}); body.end(Buffer.from([2]));
    assert.equal((await response).status,409);
    assert.deepEqual((await (await request(app, '/api/state')).json()).shares, []);
    assert.deepEqual(await readdir(path.join(directory,'shared')), []);
  } finally { await app?.close(); await rm(directory,{recursive:true,force:true}); }
});
