import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { newInvitationId, normalizeInvitationId, formatInvitationId, invitationCredentials } from '../browser/invitation-id.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
test('invitation IDs tolerate typing aliases without changing encryption keys', async () => {
  const code = '0123456789ABCDEFGHJKMNPQRS';
  assert.equal(normalizeInvitationId('oi23-4567 89ab-cdef-ghjk-mnpq-rs'), code);
  assert.equal(normalizeInvitationId(code.replace('1', 'l')), code);
  assert.deepEqual(await invitationCredentials(formatInvitationId(code).toLowerCase()), await invitationCredentials(code));
  const keys = await invitationCredentials(code);
  assert.equal(keys.lookup, hash('nearby-invitation-id:v1:lookup:' + code));
  assert.equal(keys.token, hash('nearby-invitation-id:v1:invite:' + code));
  assert.equal(keys.relaySecret, hash('nearby-invitation-id:v1:relay:' + code));
  assert.equal(keys.inviteDigest, hash(keys.token));
  assert.equal(new Set(Object.values(keys)).size, 4);
  for (const invalid of ['', code.slice(1), code + '0', code.replace('A', 'U'), 'https://example.com/#id=' + code]) assert.throws(() => normalizeInvitationId(invalid));
  const random = new Set(Array.from({ length: 1000 }, () => newInvitationId()));
  assert.equal(random.size, 1000); for (const value of random) assert.equal(normalizeInvitationId(value), value);
});
const php = process.env.PHP_PATH || 'php';
const available = spawnSync(php, ['-v'], { windowsHide: true }).status === 0;
test('ID lookup expires, is single use, preserves approval, hides secrets and limits guesses', { skip: !available }, async () => {
  const state = await mkdtemp(path.join(tmpdir(), 'nearby-id-api-'));
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: state }, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/api.php`;
  const request = async (body, expected = 200) => { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result; };
  const create = async mode => {
    const id = newInvitationId(), keys = await invitationCredentials(id);
    const room = await request({ action: 'create', name: 'ID host', mode, idLookup: keys.lookup, idInviteDigest: keys.inviteDigest }, 201);
    assert.equal(room.idEnabled, true); assert.equal(room.invite, null); assert.ok(room.inviteExpires <= Math.floor(Date.now() / 1000) + 900);
    const stored = await readFile(path.join(state, 'room-' + room.room + '.json'), 'utf8');
    for (const secret of [id, keys.token, keys.relaySecret]) assert.ok(!stored.includes(secret), 'Secrets must not be stored on the server');
    return { id, keys, ...room };
  };
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(url); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    await request({ action: 'create', idLookup: 'x' }, 400);
    const room = await create('internet'), auth = { room: room.room, token: room.token };
    await request({ action: 'create', idLookup: room.keys.lookup, idInviteDigest: room.keys.inviteDigest }, 409);
    assert.deepEqual(await request({ action: 'resolve-id', lookup: room.keys.lookup }), { room: room.room, mode: 'internet', expires: room.inviteExpires });
    const guest = await request({ action: 'join', room: room.room, token: room.keys.token, name: 'ID guest' });
    assert.equal((await request({ action: 'poll', ...auth })).approved, false);
    await request({ action: 'record-usage', room: room.room, token: guest.token }, 403);
    await request({ action: 'resolve-id', lookup: room.keys.lookup }, 404);
    await request({ action: 'join', room: room.room, token: room.keys.token }, 409);
    await request({ action: 'approve', ...auth });
    assert.equal((await request({ action: 'poll', room: room.room, token: guest.token })).approved, true);
    const expired = await create('internet');
    const expiryPath = path.join(state, 'room-' + expired.room + '.json'), stored = JSON.parse(await readFile(expiryPath, 'utf8'));
    stored.inviteExpires = Math.floor(Date.now() / 1000) - 1; await writeFile(expiryPath, JSON.stringify(stored));
    await request({ action: 'resolve-id', lookup: expired.keys.lookup }, 404);
    await request({ action: 'join', room: expired.room, token: expired.keys.token }, 410);
    await request({ action: 'poll', room: expired.room, token: expired.token });
    const closed = await create('lan'); await request({ action: 'close', room: closed.room, token: closed.token });
    await request({ action: 'resolve-id', lookup: closed.keys.lookup }, 404);
    await request({ action: 'resolve-id', lookup: '../bad' }, 400);
    // Start a fresh address budget to check precisely the dedicated ID limit.
    for (const name of await readdir(state)) if (name.startsWith('budget-')) await rm(path.join(state, name));
    for (let i = 0; i < 12; i++) await request({ action: 'resolve-id', lookup: '0'.repeat(64) }, 404);
    await request({ action: 'resolve-id', lookup: '0'.repeat(64) }, 429);
    await request({ action: 'poll', ...auth }); // Exhausting ID guesses must not interrupt existing connections.
  } finally { server.kill(); await new Promise(resolve => server.once('exit', resolve)); await rm(state, { recursive: true, force: true }); }
});
