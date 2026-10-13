import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLanDiscovery } from '../lan-discovery.mjs';
import { createApp } from '../server.mjs';
import { peerNetworkError } from '../lan-peer.mjs';
import { discoveryBus } from '../test-support/discovery-bus.mjs';

test('discovery uses sender IP, deduplicates adapters, expires hints, ignores malformed/public/self packets and secrets', async () => {
  const bus = discoveryBus(); let time = 10000;
  const ownId = randomUUID();
  const service = createLanDiscovery({ port: 1234, version: '0.4.0', id: ownId, name: 'Первый', socketFactory: () => bus.createSocket(), getInterfaces: () => [{ address: '192.168.1.2' }], now: () => time, intervalMs: 60000 });
  await service.ready;
  const socket = [...bus.sockets][0];
  const other = randomUUID(), base = { protocol: 'nearby-discovery/1', id: other, type: 'announce', name: '<b>Второй ПК</b>', port: 2345, version: '0.4.0', address: 'http://evil.invalid', pin: '123456', token: 'secret' };
  const emit = (body, address = '192.168.1.3') => socket.emit('message', Buffer.from(JSON.stringify(body)), { address });
  try {
    for (const invalid of [null, [], {}, { ...base, id: ownId }, { ...base, id: '../../bad' }, { ...base, port: 0 }, { ...base, port: '80' }, { ...base, name: '\u0000' }, { ...base, name: 'x'.repeat(110) }, { ...base, version: 'bad' }, { ...base, protocol: 'localsend' }]) emit(invalid);
    emit(base, '8.8.8.8'); emit(base, '169.254.169.254');
    socket.emit('message', Buffer.alloc(1025), { address: '192.168.1.3' });
    socket.emit('message', Buffer.from('{bad'), { address: '192.168.1.3' });
    assert.equal(service.state.devices.length, 0);
    emit(base); emit(base); emit(base, '10.0.0.5');
    assert.equal(service.state.devices.length, 1);
    emit({ ...base, secure: { port: 3456, fingerprint: 'a'.repeat(64) } });
    assert.deepEqual(service.state.devices[0].secure, { port: 3456, fingerprint: 'a'.repeat(64) });
    assert.deepEqual(service.state.devices[0].origins, ['http://192.168.1.3:2345', 'http://10.0.0.5:2345']);
    assert.ok(!JSON.stringify(service.state).includes('123456') && !JSON.stringify(service.state).includes('secret') && !JSON.stringify(service.state).includes('evil.invalid'));
    assert.ok(bus.packets.every(packet => !packet.includes('token') && !packet.includes('pin')));
    emit({ ...base, type: 'bye' }); assert.deepEqual(service.state.devices[0].origins, ['http://10.0.0.5:2345']);
    time += 21000; assert.equal(service.state.devices.length, 0);
  } finally { await service.close(); }
  assert.equal(bus.sockets.size, 0);
});

test('discovery rebinds when network changes and socket errors do not stop the app', async () => {
  const bus = discoveryBus(); let interfaces = [{ address: '192.168.1.2' }], time = 20000;
  const service = createLanDiscovery({ port: 1234, version: '0.4.0', socketFactory: () => bus.createSocket(), getInterfaces: () => interfaces, now: () => time, intervalMs: 60000 });
  try {
    await service.ready; assert.equal(service.state.status, 'listening');
    interfaces = []; time += 2100; await service.refresh(); assert.equal(service.state.status, 'no-network');
    interfaces = [{ address: '10.0.0.2' }]; time += 2100; await service.refresh();
    assert.deepEqual(service.state.interfaces, ['10.0.0.2']); assert.equal(service.state.status, 'listening');
    [...bus.sockets][0].emit('error', Object.assign(new Error('Denied'), { code: 'EACCES' }));
    assert.equal(service.state.status, 'unavailable'); assert.equal(service.state.errorCode, 'EACCES');
    time += 16000; await service.refresh(); assert.equal(service.state.status, 'listening');
  } finally { await service.close(); }
});

test('discovery caps untrusted device lists and refresh broadcasts', async () => {
  const bus = discoveryBus(); let time = 30000;
  const service = createLanDiscovery({ port: 1234, version: '0.4.0', socketFactory: () => bus.createSocket(), getInterfaces: () => [{ address: '192.168.1.2' }], now: () => time, intervalMs: 60000 });
  try {
    await service.ready; const socket = [...bus.sockets][0], initial = bus.packets.length;
    await service.refresh(); await service.refresh(); assert.equal(bus.packets.length, initial + 1);
    for (let i = 0; i < 150; i++) { time += 20; socket.emit('message', Buffer.from(JSON.stringify({ protocol: 'nearby-discovery/1', id: randomUUID(), type: 'announce', name: 'ПК', port: 1234, version: '0.4.0' })), { address: '192.168.1.3' }); }
    assert.equal(service.state.devices.length, 100);
  } finally { await service.close(); }
});

test('UDP bind denial leaves discovery unavailable without failing startup', async () => {
  const bus = discoveryBus();
  const service = createLanDiscovery({ port: 1234, version: '0.4.0', intervalMs: 60000, socketFactory: () => {
    const socket = bus.createSocket();
    socket.bind = () => queueMicrotask(() => socket.emit('error', Object.assign(new Error('Denied'), { code: 'EACCES' })));
    return socket;
  } });
  try { await service.ready; assert.equal(service.state.status, 'unavailable'); assert.equal(service.state.errorCode, 'EACCES'); }
  finally { await service.close(); }
});

test('owner-only discovery and diagnosis do not reveal credentials or consume PIN attempts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-discovery-api-'));
  const bus = discoveryBus(); let first, second;
  const options = { host: '127.0.0.1', port: 0, statistics: false };
  try {
    first = await createApp({ ...options, storage: path.join(directory, 'first'), discovery: { name: 'Первый ПК', socketFactory: () => bus.createSocket(), getInterfaces: () => [{ address: '127.0.0.1' }] } });
    second = await createApp({ ...options, storage: path.join(directory, 'second'), discovery: { name: 'Второй ПК', socketFactory: () => bus.createSocket(), getInterfaces: () => [{ address: '127.0.0.1' }] } });
    const origin = app => `http://127.0.0.1:${app.port}`;
    const request = (app, route, body, key = app.adminToken) => fetch(origin(app) + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await request(first, '/api/discovery', undefined, '')).status, 403);
    assert.equal((await request(first, '/api/peer/diagnose', { address: origin(second) }, '')).status, 403);
    const discovery = await (await request(first, '/api/discovery')).json();
    assert.equal(discovery.devices.length, 1); assert.equal(discovery.devices[0].name, 'Второй ПК');
    assert.deepEqual(discovery.devices[0].origins, [origin(second)]);
    assert.ok(!JSON.stringify(discovery).includes(second.pin) && !JSON.stringify(discovery).includes(second.adminToken));
    const self = await (await request(first, '/api/peer/diagnose', { address: origin(first) })).json(); assert.equal(self.code, 'self-address');
    for (const address of ['http://8.8.8.8', 'http://169.254.169.254', 'http://user:pass@192.168.1.3', 'http://192.168.1.3/api/state']) assert.equal((await request(first, '/api/peer/diagnose', { address })).status, 400);
    for (let i = 0; i < 10; i++) {
      const checked = await (await request(first, '/api/peer/diagnose', { address: origin(second) })).json();
      assert.equal(checked.code, 'ready'); assert.equal(checked.ok, true); assert.ok(!JSON.stringify(checked).includes(second.pin));
    }
    const connected = await request(first, '/api/peer/connect', { address: origin(second), pin: second.pin, device: 'Первый ПК' }); assert.equal(connected.status, 200);
    await second.close(); second = null;
    assert.equal((await (await request(first, '/api/discovery')).json()).devices.length, 0);
    const checked = await (await request(first, '/api/peer/diagnose', { address: discovery.devices[0].origins[0] })).json(); assert.equal(checked.ok, false); assert.equal(checked.code, 'connection-refused');
  } finally { await first?.close(); await second?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('network diagnostics distinguish timeout, refusal and missing route without claiming firewall inspection', () => {
  assert.equal(peerNetworkError({ cause: { code: 'ECONNREFUSED' } }).code, 'connection-refused');
  assert.equal(peerNetworkError({ name: 'AbortError' }).code, 'timeout');
  assert.equal(peerNetworkError({ cause: { code: 'EHOSTUNREACH' } }).code, 'network-unreachable');
});
