import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { loadDeviceIdentity } from '../device-identity.mjs';
import { tlsJson, pinnedTls } from '../lan-tls.mjs';
import { pairingCode } from '../trusted-lan.mjs';
import https from 'node:https';
import { readdir } from 'node:fs/promises';

const call = async (app, route, body, key = app.adminToken) => {
  const response = await fetch(`http://127.0.0.1:${app.port}` + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json(); return { status: response.status, ...result };
};
const options = storage => ({ host: '127.0.0.1', port: 0, storage, statistics: false, discovery: false, trustedLan: { identityOptions: { protection: 'file' } } });
const until = async condition => { for (let i = 0; i < 100; i++) { if (await condition()) return; await new Promise(r => setTimeout(r, 50)); } assert.fail('Pairing did not advance'); };

test('mutual TLS pairing requires both owners; protects files, persists identity and trust, pins certificates and revokes', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-trust-'));
  const firstDir = path.join(directory, 'first'), secondDir = path.join(directory, 'second');
  let first, second, attacker;
  try {
    first = await createApp(options(firstDir)); second = await createApp(options(secondDir)); attacker = await createApp(options(path.join(directory, 'attacker')));
    const address = app => `http://127.0.0.1:${app.port}`;
    const firstIdentity = await loadDeviceIdentity(firstDir, { protection: 'file' }), secondIdentity = await loadDeviceIdentity(secondDir, { protection: 'file' });
    const info = await call(second, '/api/info'), secureOrigin = `https://127.0.0.1:${info.secure.port}`;
    const firstTls = pinnedTls(firstIdentity, secondIdentity.cert);
    await assert.rejects(tlsJson(secureOrigin, '/api/state', firstTls), error => error.status === 403);
    assert.equal((await call(first, '/api/trust', undefined, '')).status, 403);
    const start = await call(first, '/api/trust/pair', { address: address(second) }); assert.equal(start.status, 200);
    const a = (await call(first, '/api/trust')).requests[0], b = (await call(second, '/api/trust')).requests[0];
    assert.equal(a.id, b.id); assert.equal(a.code, b.code); assert.equal(a.code.replaceAll(' ', '').length, 64);
    assert.equal((await call(first, '/api/trust/confirm', { id: a.id }, '')).status, 403);
    await call(first, '/api/trust/confirm', { id: a.id });
    assert.equal((await call(first, '/api/trust')).devices.length, 0);
    assert.equal((await call(second, '/api/trust')).devices.length, 0);
    await assert.rejects(tlsJson(secureOrigin, '/api/state', firstTls), error => error.status === 403);
    await call(second, '/api/trust/confirm', { id: b.id });
    await until(async () => (await call(first, '/api/trust')).devices.length === 1);
    assert.equal((await call(second, '/api/trust')).devices.length, 1);
    const raw = JSON.stringify(await call(first, '/api/trust')); assert.ok(!raw.includes('PRIVATE KEY') && !raw.includes(firstIdentity.key));
    const remote = await tlsJson(secureOrigin, '/api/state', firstTls); assert.equal(remote.admin, false); assert.ok(!JSON.stringify(remote).includes(second.adminToken));
    for (const route of ['/api/trust', '/api/received/open', '/api/discovery']) await assert.rejects(tlsJson(secureOrigin, route, firstTls), error => error.status === 403);
    const connected = await call(first, '/api/peer/connect', { fingerprint: secondIdentity.fingerprint, address: address(second) }); assert.equal(connected.status, 200); assert.equal(connected.peer.secure, true);
    assert.deepEqual((await call(second, '/api/state')).connectedDevices, [{ name: firstIdentity.name, secure: true }]);
    await call(first, '/api/peer/disconnect', {});
    assert.deepEqual((await call(second, '/api/state')).connectedDevices, [], 'TLS disconnect clears inbound presence');
    assert.equal((await call(first, '/api/peer/connect', { fingerprint: secondIdentity.fingerprint, address: address(second) })).status, 200);
    const bytes = Buffer.from([0, 255, 10, 128, 20]);
    const offer = await call(first, '/api/peer/remote/api/offers', { name: 'encrypted.bin', size: bytes.length }); assert.equal(offer.status, 201);
    await call(second, `/api/offers/${offer.id}`, { action: 'accept' });
    const upload = await fetch(address(first) + `/api/peer/remote/api/offers/${offer.id}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${first.adminToken}` }, body: bytes }); assert.equal(upload.status, 201);
    // A ticket issued to a TLS identity cannot be redeemed over legacy HTTP.
    const shareResponse = await fetch(address(second) + '/api/shares?name=reply.bin&size=5', { method: 'POST', headers: { Authorization: `Bearer ${second.adminToken}` }, body: bytes });
    const share = await shareResponse.json();
    const ticket = await tlsJson(secureOrigin, `/api/shares/${share.id}/ticket`, firstTls, {});
    assert.equal((await fetch(address(second) + ticket.url)).status, 403);
    const proxyTicket = await call(first, `/api/peer/remote/api/shares/${share.id}/ticket`, {});
    const download = await fetch(address(first) + proxyTicket.url); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const attackerIdentity = await loadDeviceIdentity(path.join(directory, 'attacker'), { protection: 'file' });
    await assert.rejects(tlsJson(secureOrigin, '/api/state', pinnedTls(attackerIdentity, secondIdentity.cert)), error => error.status === 403);
    await assert.rejects(tlsJson(secureOrigin, '/api/state', pinnedTls(firstIdentity, attackerIdentity.cert))); // Wrong pin never falls back to HTTP.
    await first.close(); first = null; await second.close(); second = null;
    first = await createApp(options(firstDir)); second = await createApp(options(secondDir));
    assert.equal((await call(first, '/api/trust')).identity.fingerprint, firstIdentity.fingerprint);
    assert.equal((await call(first, '/api/trust')).devices.length, 1);
    assert.equal((await call(first, '/api/peer/connect', { fingerprint: secondIdentity.fingerprint, address: address(second) })).status, 200);
    const revoked = await call(second, '/api/trust/revoke', { fingerprint: firstIdentity.fingerprint }); assert.equal(revoked.status, 200);
    assert.deepEqual((await call(second, '/api/state')).connectedDevices, [], 'Revoked trust clears inbound presence');
    await assert.rejects(tlsJson(`https://127.0.0.1:${(await call(second, '/api/info')).secure.port}`, '/api/state', firstTls), error => error.status === 403);
    assert.equal((await call(second, '/api/trust')).devices.length, 0);
    const reconnect = await call(first, '/api/peer/connect', { fingerprint: secondIdentity.fingerprint, address: address(second) }); assert.notEqual(reconnect.status, 200);
  } finally { await first?.close(); await second?.close(); await attacker?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('pairing transcript changes with either identity, nonce or request and rejected requests cannot be confirmed', { timeout: 20000 }, async () => {
  const base = { initiator: 'a'.repeat(64), responder: 'b'.repeat(64), nonceA: 'c'.repeat(64), nonceB: 'd'.repeat(64), id: 'e'.repeat(64) };
  for (const key of Object.keys(base)) assert.notEqual(pairingCode(base), pairingCode({ ...base, [key]: 'f'.repeat(64) }));
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-trust-reject-')); let first, second;
  try {
    first = await createApp(options(path.join(directory, 'a'))); second = await createApp(options(path.join(directory, 'b')));
    const result = await call(first, '/api/trust/pair', { address: `http://127.0.0.1:${second.port}` }); assert.equal(result.status, 200);
    await call(second, '/api/trust/reject', { id: result.id });
    await call(first, '/api/trust/confirm', { id: result.id });
    assert.equal((await call(second, '/api/trust/confirm', { id: result.id })).status, 409);
    assert.equal((await call(first, '/api/trust')).devices.length, 0);
    assert.equal((await call(second, '/api/trust')).devices.length, 0);
    const retry = await call(first, '/api/trust/pair', { address: `http://127.0.0.1:${second.port}` }); assert.equal(retry.status, 200);
    await call(first, '/api/trust/confirm', { id: retry.id }); await call(second, '/api/trust/confirm', { id: retry.id });
    await until(async () => (await call(first, '/api/trust')).devices.length === 1);
    await call(first, '/api/trust/reject', { id: retry.id }); // A delayed cancel must not leave newly saved trust active.
    assert.equal((await call(first, '/api/trust')).devices.length, 0);
    assert.equal((await call(second, '/api/trust')).devices.length, 0);
  } finally { await first?.close(); await second?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('corrupt identity and trust storage are preserved and never silently replaced', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-trust-corrupt-')); let app;
  try {
    app = await createApp(options(directory)); await app.close(); app = null;
    const trust = path.join(directory, 'trusted-devices.json'); await writeFile(trust, '{broken');
    await assert.rejects(createApp(options(directory)), /повреждён/); assert.equal(await readFile(trust, 'utf8'), '{broken');
    await rm(trust); const identity = path.join(directory, 'device-identity.json'); await writeFile(identity, '{broken');
    await assert.rejects(createApp(options(directory)), /повреждено/); assert.equal(await readFile(identity, 'utf8'), '{broken');
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('revocation interrupts an in-progress TLS upload and removes its partial file', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-trust-abort-')); let first, second, request;
  try {
    const firstDir = path.join(directory, 'a'), secondDir = path.join(directory, 'b');
    first = await createApp(options(firstDir)); second = await createApp(options(secondDir));
    const pair = await call(first, '/api/trust/pair', { address: `http://127.0.0.1:${second.port}` });
    await call(first, '/api/trust/confirm', { id: pair.id }); await call(second, '/api/trust/confirm', { id: pair.id });
    await until(async () => (await call(first, '/api/trust')).devices.length === 1);
    const a = await loadDeviceIdentity(firstDir, { protection: 'file' }), b = await loadDeviceIdentity(secondDir, { protection: 'file' });
    const origin = `https://127.0.0.1:${(await call(second, '/api/info')).secure.port}`, tls = pinnedTls(a, b.cert);
    const offer = await tlsJson(origin, '/api/offers', tls, { name: 'unfinished.bin', size: 1024 });
    await call(second, `/api/offers/${offer.id}`, { action: 'accept' });
    let interrupted = false;
    request = https.request(origin + `/api/offers/${offer.id}/upload`, { ...tls, method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '1024' } });
    request.on('error', () => { interrupted = true; }); request.write(Buffer.alloc(128, 1));
    await until(async () => (await call(second, '/api/state')).offers.some(item => item.id === offer.id && item.received === 128));
    await call(second, '/api/trust/revoke', { fingerprint: a.fingerprint });
    await until(async () => interrupted && (await call(second, '/api/state')).offers.some(item => item.id === offer.id && item.state === 'failed'));
    assert.deepEqual(await readdir(second.inbox), []);
  } finally { request?.destroy(); await first?.close(); await second?.close(); await rm(directory, { recursive: true, force: true }); }
});
