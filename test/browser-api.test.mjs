import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const php = process.env.PHP_PATH || 'php';
const available = spawnSync(php, ['-v'], { windowsHide: true }).status === 0;
test('statistics count each transfer once across concurrent PHP workers', { skip: !available }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-stat-workers-'));
  try {
    const code = "require getenv('NEARBY_STATS_SCRIPT'); function fail($status, $message) { throw new RuntimeException($message); } transferStatistics(getenv('NEARBY_STATS_DIR'), json_decode(getenv('NEARBY_STATS_REPORT'), true));";
    await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise((resolve, reject) => {
      const index = i % 6;
      const report = { room: 'a'.repeat(32), id: `12345678-1234-1234-1234-${String(index).padStart(12, '0')}`, size: index * 1000, expires: Math.floor(Date.now() / 1000) + 900 };
      const worker = spawn(php, ['-r', code], { env: { ...process.env, NEARBY_STATS_SCRIPT: path.resolve('browser/statistics.php'), NEARBY_STATS_DIR: directory, NEARBY_STATS_REPORT: JSON.stringify(report) }, windowsHide: true });
      let errors = '';
      worker.stderr.on('data', data => { errors += data; });
      worker.on('error', reject);
      worker.on('exit', status => status === 0 ? resolve() : reject(new Error(errors || `PHP worker exited ${status}`)));
    })));
    const stored = JSON.parse(await readFile(path.join(directory, 'statistics.json'), 'utf8'));
    assert.equal(stored.files, 6); assert.equal(stored.bytes, 15000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('PHP signaling protects rooms, approval, roles, payloads and one-use invitations', { skip: !available && 'Set PHP_PATH or install PHP 8.1+ to run signaling integration tests.' }, async () => {
  const state = await mkdtemp(path.join(tmpdir(), 'nearby-signal-'));
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const launch = () => spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: state }, stdio: 'ignore', windowsHide: true });
  let proc = launch();
  const url = `http://127.0.0.1:${port}/api.php`;
  async function request(body, expected = 200, headers = {}) { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result; }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { await fetch(url); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready, 'PHP dev server started');
    const initialStats = await request({ action: 'stats' });
    assert.equal(initialStats.files, 0); assert.equal(initialStats.bytes, 0);
    assert.ok(Number.isFinite(Date.parse(initialStats.startedAt)));
    assert.deepEqual(Object.keys(initialStats).sort(), ['bytes', 'files', 'startedAt', 'updatedAt']);
    await request({ action: 'record-transfer', id: '12345678-1234-1234-1234-123456789abc', size: 1 }, 400);
    const host = await request({ action: 'create', name: 'ПК' }, 201);
    const auth = { room: host.room, token: host.token };
    await request({ action: 'poll', ...auth }, 403, { Origin: 'https://attacker.invalid' });
    await request({ action: 'poll', room: host.room, token: '0'.repeat(64) }, 403);
    const guest = await request({ action: 'join', room: host.room, token: host.invite, name: '<b>Телефон</b>' });
    const guestAuth = { room: host.room, token: guest.token };
    const report = { action: 'record-transfer', ...guestAuth, id: '12345678-1234-1234-1234-123456789abc', size: 1001 };
    await request(report, 403);
    await request({ action: 'join', room: host.room, token: host.invite }, 409);
    await request({ action: 'approve', ...guestAuth }, 403);
    await request({ action: 'signal', ...guestAuth, message: { type: 'candidate', candidate: {} } }, 403);
    const waiting = await request({ action: 'poll', ...auth }); assert.equal(waiting.approved, false); assert.equal(waiting.guestName, '<b>Телефон</b>');
    await request({ action: 'approve', ...auth });
    for (const size of [-1, 1.5, '100', 10 * 1024 ** 3 + 1]) await request({ ...report, size }, 400);
    await request({ ...report, id: '../../bad' }, 400);
    await request({ ...report, token: '0'.repeat(64) }, 403);
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => request(report)));
    for (const stats of duplicates) { assert.equal(stats.files, 1); assert.equal(stats.bytes, 1001); }
    await request({ ...report, ...auth }); // Other peer cannot double-count the same transfer.
    await request({ ...report, size: 1002 }, 409);
    await request({ ...report, id: '12345678-1234-1234-1234-123456789abd', size: 0 });
    await request({ ...report, id: '12345678-1234-1234-1234-123456789abe', size: 10 * 1024 ** 3 });
    const totals = await request({ action: 'stats' });
    assert.equal(totals.files, 3); assert.equal(totals.bytes, 1001 + 10 * 1024 ** 3);
    assert.equal(totals.startedAt, initialStats.startedAt);
    assert.ok(totals.updatedAt);
    const stored = await readFile(path.join(state, 'statistics.json'), 'utf8');
    assert.ok(!stored.includes(host.token) && !stored.includes(guest.token) && !stored.includes('Телефон'));
    const localSession = await request({ action: 'local-session' }, 201);
    const localReport = { action: 'record-local-transfer', token: localSession.token, id: '87654321-4321-4321-4321-cba987654321', size: 100 * 1024 ** 3, completedAt: Math.floor(Date.now() / 1000), source: 'windows' };
    await request({ ...localReport, token: 'bad' }, 403);
    await request({ ...localReport, source: 'unknown' }, 400);
    await request({ ...localReport, size: 100 * 1024 ** 3 + 1 }, 400);
    await request({ ...localReport, completedAt: localReport.completedAt - 8 * 86400 }, 410);
    await request({ ...localReport, completedAt: localReport.completedAt + 3600 }, 410);
    await request(localReport);
    const renewed = await request({ action: 'local-session' }, 201);
    await request({ ...localReport, token: renewed.token });
    const combined = await request({ action: 'stats' });
    assert.equal(combined.files, totals.files + 1); assert.equal(combined.bytes, totals.bytes + localReport.size);
    assert.equal(combined.startedAt, initialStats.startedAt);
    await request({ action: 'signal', ...guestAuth, message: { type: 'offer', sdp: 'x' } }, 403);
    await request({ action: 'signal', ...auth, message: { type: 'offer', sdp: 'test-sdp' } });
    const received = await request({ action: 'poll', ...guestAuth, after: 0 }); assert.equal(received.messages.length, 1); assert.equal(received.messages[0].body.sdp, 'test-sdp');
    assert.equal((await request({ action: 'poll', ...guestAuth, after: received.cursor })).messages.length, 0);
    await request({ action: 'signal', ...auth, message: { type: 'file', payload: 'not allowed' } }, 400);
    await request({ action: 'poll', ...auth, data: 'x'.repeat(50000) }, 413);
    await request({ action: 'close', ...guestAuth });
    await request({ action: 'poll', ...auth }, 410);
    await request(report, 410);
    proc.kill(); await new Promise(r => proc.once('exit', r));
    proc = launch();
    for (let i = 0; i < 50; i++) { try { await fetch(url); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.deepEqual(await request({ action: 'stats' }), combined, 'Combined totals survive a PHP server restart');
    await writeFile(path.join(state, 'statistics.json'), '{broken');
    await request({ action: 'stats' }, 500);
    assert.equal(await readFile(path.join(state, 'statistics.json'), 'utf8'), '{broken', 'Corrupt state is never silently reset to zero');
  } finally { proc.kill(); await new Promise(r => proc.once('exit', r)); await rm(state, { recursive: true, force: true }); }
});
