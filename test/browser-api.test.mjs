import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const php = process.env.PHP_PATH || 'php';
const available = spawnSync(php, ['-v'], { windowsHide: true }).status === 0;
test('PHP signaling protects rooms, approval, roles, payloads and one-use invitations', { skip: !available && 'Set PHP_PATH or install PHP 8.1+ to run signaling integration tests.' }, async () => {
  const state = await mkdtemp(path.join(tmpdir(), 'nearby-signal-'));
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const proc = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: state }, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/api.php`;
  async function request(body, expected = 200, headers = {}) { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result; }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { await fetch(url); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready, 'PHP dev server started');
    const host = await request({ action: 'create', name: 'ПК' }, 201);
    const auth = { room: host.room, token: host.token };
    await request({ action: 'poll', ...auth }, 403, { Origin: 'https://attacker.invalid' });
    await request({ action: 'poll', room: host.room, token: '0'.repeat(64) }, 403);
    const guest = await request({ action: 'join', room: host.room, token: host.invite, name: '<b>Телефон</b>' });
    const guestAuth = { room: host.room, token: guest.token };
    await request({ action: 'join', room: host.room, token: host.invite }, 409);
    await request({ action: 'approve', ...guestAuth }, 403);
    await request({ action: 'signal', ...guestAuth, message: { type: 'candidate', candidate: {} } }, 403);
    const waiting = await request({ action: 'poll', ...auth }); assert.equal(waiting.approved, false); assert.equal(waiting.guestName, '<b>Телефон</b>');
    await request({ action: 'approve', ...auth });
    await request({ action: 'signal', ...guestAuth, message: { type: 'offer', sdp: 'x' } }, 403);
    await request({ action: 'signal', ...auth, message: { type: 'offer', sdp: 'test-sdp' } });
    const received = await request({ action: 'poll', ...guestAuth, after: 0 }); assert.equal(received.messages.length, 1); assert.equal(received.messages[0].body.sdp, 'test-sdp');
    assert.equal((await request({ action: 'poll', ...guestAuth, after: received.cursor })).messages.length, 0);
    await request({ action: 'signal', ...auth, message: { type: 'file', payload: 'not allowed' } }, 400);
    await request({ action: 'poll', ...auth, data: 'x'.repeat(50000) }, 413);
    await request({ action: 'close', ...guestAuth });
    await request({ action: 'poll', ...auth }, 410);
  } finally { proc.kill(); await new Promise(r => proc.once('exit', r)); await rm(state, { recursive: true, force: true }); }
});
