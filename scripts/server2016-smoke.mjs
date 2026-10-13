import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'DPAPI smoke check requires Windows');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(project, 'dist/windows-server-2016-x64');
const app = path.join(stage, 'app');
const node = path.join(stage, 'runtime/node.exe');
const manifest = JSON.parse((await readFile(path.join(project, 'artifacts/windows-server-2016-build.json'), 'utf8')).replace(/^\uFEFF/, ''));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(path.join(project, 'artifacts', manifest.installer))), manifest.sha256);
assert.match(execFileSync(node, ['-p', 'process.version+" "+process.arch'], { encoding: 'utf8', windowsHide: true }).trim(), /^v24\.\d+\.\d+ x64$/);
assert.match(await readFile(path.join(stage, 'Nearby.exe.config'), 'utf8'), /Version=v4\.6\.2/);
for (const file of ['server.mjs', 'device-identity.mjs', 'lan-tls.mjs', 'trusted-lan.mjs', 'lan-peer.mjs', 'lan-discovery.mjs', 'transfer-statistics.mjs', 'desktop/windows/host.mjs', 'public/app.js', 'public/index.html', 'public/styles.css']) {
  assert.deepEqual(await readFile(path.join(app, file)), await readFile(path.join(project, file)), `Staged ${file} must match source`);
}
assert.deepEqual((await readdir(app)).sort(), ['desktop', 'device-identity.mjs', 'lan-discovery.mjs', 'lan-peer.mjs', 'lan-tls.mjs', 'node_modules', 'package-lock.json', 'package.json', 'public', 'server.mjs', 'transfer-statistics.mjs', 'trusted-lan.mjs']);
const root = await mkdtemp(path.join(tmpdir(), 'nearby-server2016-smoke-'));
const data = path.join(root, 'Данные'), received = path.join(root, 'Загрузки');
const child = spawn(node, [path.join(app, 'desktop/windows/host.mjs')], {
  cwd: app, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NEARBY_DATA_DIR: data, NEARBY_RECEIVE_DIR: received, NEARBY_DISABLE_STATISTICS: '1', NEARBY_DISABLE_DISCOVERY: '1', NEARBY_DISABLE_TRUSTED_LAN: '0' },
});
const exited = once(child, 'exit');
let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
const deadline = setTimeout(() => child.kill(), 30000);
try {
  const lines = createInterface({ input: child.stdout });
  const firstLine = once(lines, 'line');
  const line = await Promise.race([firstLine, exited.then(() => { throw new Error('Engine exited before handshake: ' + stderr); })]);
  const handshake = JSON.parse(line[0]), url = new URL(handshake.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(handshake.receivedDirectory, received);
  const admin = { Authorization: `Bearer ${new URLSearchParams(url.hash.slice(1)).get('admin')}` };
  const state = await (await fetch(url.origin + '/api/state', { headers: admin })).json();
  const trust = await (await fetch(url.origin + '/api/trust', { headers: admin })).json();
  assert.equal(trust.enabled, true);
  const identity = await readFile(path.join(data, 'device-identity.json'), 'utf8');
  assert.equal(JSON.parse(identity).protection, 'dpapi'); assert.ok(!identity.includes('PRIVATE KEY'));
  const json = { 'Content-Type': 'application/json' };
  const joined = await (await fetch(url.origin + '/api/join', { method: 'POST', headers: json, body: JSON.stringify({ pin: state.pin, device: 'Server package smoke' }) })).json();
  const guest = { Authorization: `Bearer ${joined.token}` };
  const bytes = randomBytes(1024 * 1024 + 17);
  const offer = await (await fetch(url.origin + '/api/offers', { method: 'POST', headers: { ...guest, ...json }, body: JSON.stringify({ name: 'проверка.bin', size: bytes.length }) })).json();
  assert.equal((await fetch(url.origin + `/api/offers/${offer.id}`, { method: 'POST', headers: { ...admin, ...json }, body: JSON.stringify({ action: 'accept' }) })).status, 200);
  assert.equal((await fetch(url.origin + `/api/offers/${offer.id}/upload`, { method: 'POST', headers: guest, body: bytes })).status, 201);
  const files = await readdir(received); assert.equal(files.length, 1);
  assert.equal(hash(await readFile(path.join(received, files[0]))), hash(bytes));
  child.stdin.end('stop\n'); assert.equal((await exited)[0], 0, stderr);
  await assert.rejects(fetch(url.origin + '/api/state'));
  assert.equal(hash(await readFile(path.join(received, files[0]))), hash(bytes));
  await writeFile(path.join(project, 'artifacts/Nearby-server-2016-smoke.json'), JSON.stringify({ passed: true, installer: manifest.installer, sha256: manifest.sha256, packagedNode: manifest.node, targetFramework: '4.6.2', dpapi: true, transfer: '1 MiB + 17 bytes, SHA-256 match', cleanShutdown: true, testedOS: execFileSync('cmd.exe', ['/c', 'ver'], { encoding: 'utf8', windowsHide: true }).trim(), targetOSVerified: false, checkedAt: new Date().toISOString() }, null, 2));
  console.log('Server 2016 package smoke passed: embedded Node 24 x64, current sources, DPAPI, binary transfer, shutdown. Target OS itself still requires validation.');
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null) { child.kill(); await exited; }
  await rm(root, { recursive: true, force: true });
}
