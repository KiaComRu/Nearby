import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const php = process.env.PHP_PATH || 'php';
test('automatic transport agrees once, requires approval, handles expiry and shares relay capacity', { skip: spawnSync(php, ['-v'], { windowsHide: true }).status !== 0 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-auto-api-'));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const proc = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: directory }, stdio: 'ignore', windowsHide: true });
  async function request(body, expected = 200) {
    const response = await fetch(`http://127.0.0.1:${port}/api.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  }
  async function room() {
    const created = await request({ action: 'create', mode: 'auto' }, 201);
    const guest = await request({ action: 'join', room: created.room, token: created.invite });
    return { host: { room: created.room, token: created.token }, guest: { room: created.room, token: guest.token }, path: path.join(directory, `room-${created.room}.json`) };
  }
  const vote = (auth, event, expected) => request({ ...auth, action: 'transport', event }, expected);
  const state = r => readFile(r.path, 'utf8').then(JSON.parse);
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const direct = await room();
    await vote(direct.guest, 'direct-ready', 403);
    await request({ ...direct.host, action: 'relay-pull', after: 0 }, 403);
    await request({ ...direct.host, action: 'approve' });
    const deadline = (await state(direct)).probeDeadline;
    await request({ ...direct.host, action: 'approve' }); assert.equal((await state(direct)).probeDeadline, deadline);
    await vote({ ...direct.host, token: '0'.repeat(64) }, 'fallback', 403);
    await vote(direct.host, 'unknown', 400);
    assert.equal((await vote(direct.host, 'direct-ready')).transport, 'probing');
    assert.equal((await vote(direct.host, 'direct-ready')).transport, 'probing');
    assert.equal((await vote(direct.guest, 'direct-ready')).transport, 'direct');
    assert.equal((await vote(direct.host, 'fallback')).transport, 'direct');
    assert.ok(!(await state(direct)).relay);
    await request({ ...direct.guest, action: 'relay-pull', after: 0 }, 403);
    const fallback = await room(); await request({ ...fallback.host, action: 'approve' });
    const choices = await Promise.all([vote(fallback.host, 'fallback'), vote(fallback.guest, 'direct-ready')]);
    assert.ok(choices.every(result => result.transport === 'relay'));
    const selected = await state(fallback);
    assert.ok(selected.expires > Math.floor(Date.now() / 1000) + 7000);
    await request({ ...fallback.host, action: 'signal', message: { type: 'offer', sdp: 'late-offer' } });
    assert.deepEqual((await state(fallback)).messages, []);
    const frame = { seq: 1, data: Buffer.alloc(17, 1).toString('base64') };
    await request({ ...fallback.host, action: 'relay-push', frames: [frame] });
    assert.equal((await request({ ...fallback.guest, action: 'relay-pull', after: 0 })).frames.length, 1);
    await vote(fallback.host, 'fallback'); assert.equal((await state(fallback)).relay.host.seq, 1, 'retry must preserve the ciphertext queue');
    await request({ ...fallback.guest, action: 'close' });
    assert.ok(!(await state(fallback)).relay);
    const expired = await room(); await request({ ...expired.host, action: 'approve' });
    const expiredState = await state(expired); expiredState.probeDeadline = 1; await writeFile(expired.path, JSON.stringify(expiredState));
    assert.equal((await request({ ...expired.guest, action: 'poll' })).transport, 'relay');
    assert.equal((await vote(expired.host, 'direct-ready')).transport, 'relay');
    await request({ ...expired.host, action: 'close' });
    const limited = await room(); await request({ ...limited.host, action: 'approve' });
    const reservations = [];
    for (let i = 1; i <= 20; i++) {
      const file = path.join(directory, `room-${String(i).padStart(32, '0')}.json`); reservations.push(file);
      await writeFile(file, JSON.stringify({ mode: i % 2 ? 'internet' : 'auto', transport: 'relay', expires: Math.floor(Date.now() / 1000) + 1000, closed: false }));
    }
    await vote(limited.host, 'fallback', 503); assert.equal((await state(limited)).transport, 'probing');
    await request({ action: 'create', mode: 'internet' }, 503);
    await Promise.all(reservations.map(file => rm(file)));
    assert.equal((await vote(limited.host, 'fallback')).transport, 'relay');
    assert.equal((await request({ action: 'stats' })).uses, 0, 'probing and transport votes never count as usage');
  } finally { proc.kill(); await new Promise(resolve => proc.once('exit', resolve)); await rm(directory, { recursive: true, force: true }); }
});
