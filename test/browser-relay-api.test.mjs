import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { relayCipher, newRelaySecret } from '../browser/relay.mjs';
const php = process.env.PHP_PATH || 'php';
const available = spawnSync(php, ['-v'], { windowsHide: true }).status === 0;

test('PHP internet relay enforces approval, authentication, ordering, bounds, retry budget and cleanup', { skip: !available, timeout: 20000 }, async () => {
  const state = await mkdtemp(path.join(tmpdir(), 'nearby-relay-'));
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const proc = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: state }, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/api.php?transport=relay`;
  const request = async (body, expected = 200) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(url); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const host = await request({ action: 'create', mode: 'internet', name: 'PC' }, 201);
    assert.equal(host.mode, 'internet');
    const auth = { room: host.room, token: host.token };
    const guest = await request({ action: 'join', room: host.room, token: host.invite, name: 'Phone' });
    assert.equal(guest.mode, 'internet');
    const guestAuth = { room: host.room, token: guest.token };
    await request({ action: 'relay-pull', ...guestAuth, after: 0 }, 403);
    await request({ action: 'approve', ...auth });
    await request({ action: 'relay-pull', ...auth, token: '0'.repeat(64), after: 0 }, 403);
    const secret = newRelaySecret(), cipher = await relayCipher(host.room, secret, 'host');
    const data = await cipher.encrypt(1, 'private-файл.txt');
    const frame = { seq: 1, data };
    await request({ action: 'relay-push', ...auth, frames: [{ ...frame, seq: 2 }] }, 409);
    await request({ action: 'relay-push', ...auth, frames: [frame] });
    assert.deepEqual((await request({ action: 'relay-pull', ...guestAuth, after: 0 })).frames, [frame]);
    await request({ action: 'relay-pull', ...guestAuth, after: 1 });
    const budget = await readFile(path.join(state, 'relay-traffic.json'), 'utf8');
    await request({ action: 'relay-push', ...auth, frames: [frame] }); // Retry after the recipient acknowledged it.
    assert.equal(await readFile(path.join(state, 'relay-traffic.json'), 'utf8'), budget);
    await request({ action: 'relay-push', ...auth, frames: [{ seq: 1, data: await cipher.encrypt(2, 'different') }] }, 409);
    await request({ action: 'relay-pull', ...guestAuth, after: 2 }, 400);
    await request({ action: 'relay-push', ...auth, frames: [{ seq: 2, data: 'invalid' }] }, 400);
    const large = Buffer.alloc(262161).toString('base64');
    await request({ action: 'relay-push', ...auth, frames: [2, 3, 4].map(seq => ({ seq, data: large })) }, 413); // Request body limit.
    for (const seq of [2, 3, 4]) await request({ action: 'relay-push', ...auth, frames: [{ seq, data: large }] });
    await request({ action: 'relay-push', ...auth, frames: [{ seq: 5, data: large }] }, 429); // Ciphertext queue limit.
    await request({ action: 'relay-pull', ...guestAuth, after: 4 });
    await writeFile(path.join(state, 'relay-traffic.json'), JSON.stringify({ day: new Date().toISOString().slice(0, 10), bytes: 5 * 1024 ** 3 }));
    await request({ action: 'relay-push', ...auth, frames: [{ seq: 5, data: large }] }, 429);
    const stored = await readFile(path.join(state, `room-${host.room}.json`), 'utf8');
    assert.ok(!stored.includes(secret) && !stored.includes('private-') && !stored.includes(host.token));
    await request({ action: 'close', ...auth });
    assert.ok(!JSON.parse(await readFile(path.join(state, `room-${host.room}.json`), 'utf8')).relay);
    await request({ action: 'relay-pull', ...guestAuth, after: 4 }, 410);
    const lan = await request({ action: 'create', mode: 'lan' }, 201);
    await request({ action: 'relay-pull', room: lan.room, token: lan.token, after: 0 }, 403);
    // Inactive ciphertext is removed on the next janitor pass, without touching statistics.
    const old = await request({ action: 'create', mode: 'internet' }, 201);
    const oldPath = path.join(state, `room-${old.room}.json`);
    const ancient = new Date(Date.now() - 180000);
    await utimes(oldPath, ancient, ancient); await writeFile(path.join(state, 'relay-cleanup.lock'), '0');
    await request({ action: 'stats' });
    assert.ok(!(await readdir(state)).includes(`room-${old.room}.json`));
  } finally { proc.kill(); await new Promise(r => proc.once('exit', r)); await rm(state, { recursive: true, force: true }); }
});
