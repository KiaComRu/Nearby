import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(here);
test('packaged host uses separate user folders and exits when its launcher closes', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nearby-desktop-'));
  const received = path.join(root, 'Загрузки', 'Nearby');
  const data = path.join(root, 'Данные');
  const child = spawn(process.execPath, [path.join(project, 'desktop/windows/host.mjs')], {
    env: { ...process.env, NEARBY_DATA_DIR: data, NEARBY_RECEIVE_DIR: received },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  try {
    const lines = createInterface({ input: child.stdout });
    const [line] = await once(lines, 'line');
    const handshake = JSON.parse(line);
    const url = new URL(handshake.url);
    const key = new URLSearchParams(url.hash.slice(1)).get('admin');
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(handshake.receivedDirectory, received);
    const adminHeaders = { Authorization: `Bearer ${key}` };
    const state = await (await fetch(url.origin + '/api/state', { headers: adminHeaders })).json();
    assert.equal(state.admin, true);
    assert.equal(state.receivedDirectory, received);
    const joined = await (await fetch(url.origin + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: state.pin, device: 'Desktop test' }) })).json();
    const clientHeaders = { Authorization: `Bearer ${joined.token}`, 'Content-Type': 'application/json' };
    const offer = await (await fetch(url.origin + '/api/offers', { method: 'POST', headers: clientHeaders, body: JSON.stringify({ name: 'desktop.txt', size: 4 }) })).json();
    const acceptance = await fetch(url.origin + `/api/offers/${offer.id}`, { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept' }) });
    assert.equal(acceptance.status, 200);
    const sent = await fetch(url.origin + `/api/offers/${offer.id}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${joined.token}` }, body: 'test' });
    assert.equal(sent.status, 201);
    const files = await readdir(received);
    assert.equal(files.length, 1);
    assert.equal(await readFile(path.join(received, files[0]), 'utf8'), 'test');
    assert.deepEqual((await readdir(data)).sort(), ['shared']);
    child.stdin.end('stop\n');
    const [code] = await exited;
    assert.equal(code, 0, stderr);
    await assert.rejects(fetch(url.origin + '/api/state'));
    assert.equal(await readFile(path.join(received, files[0]), 'utf8'), 'test');
  } finally {
    if (child.exitCode === null) { child.kill(); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop host refuses to store data in an unspecified location', async () => {
  const child = spawn(process.execPath, [path.join(project, 'desktop/windows/host.mjs')], {
    env: { ...process.env, NEARBY_DATA_DIR: '', NEARBY_RECEIVE_DIR: '' }, stdio: 'ignore',
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
});

test('Windows distribution contains program files without prototype storage', async t => {
  const staged = path.join(project, 'dist/windows-x64/app');
  let entries;
  try { entries = await readdir(staged); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Build Windows payload first.'); return; } throw error; }
  assert.deepEqual(entries.sort(), ['desktop', 'node_modules', 'package-lock.json', 'package.json', 'public', 'server.mjs']);
  assert.deepEqual(await readdir(path.join(staged, 'desktop/windows')), ['host.mjs']);
  assert.deepEqual((await readdir(path.join(staged, 'public'))).sort(), ['app.js', 'index.html', 'styles.css']);
});
