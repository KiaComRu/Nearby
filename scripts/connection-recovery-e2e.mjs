import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-recovery-'));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}/`;
const proc = spawn(process.env.PHP_PATH || 'php', ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: directory }, stdio: 'ignore', windowsHide: true });
const baseline = process.env.NEARBY_RECOVERY_BASELINE === '1';
const errors = [], report = [];
const hash = value => createHash('sha256').update(value).digest('hex');
let browser, completedFiles = 0;
async function stats() { return (await fetch(base + 'api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) })).json(); }
async function readRoom(id) {
  for (let attempt = 0; ; attempt++) {
    try { return JSON.parse(await readFile(path.join(directory, `room-${id}.json`), 'utf8')); }
    catch (error) {
      // Windows denies a test reader while a PHP worker holds the room lock.
      if (attempt >= 40 || (!['EBUSY', 'EPERM'].includes(error.code) && !(error instanceof SyntaxError))) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
async function connected(page, mode) { await page.waitForFunction(mode => !document.querySelector('#files').disabled && document.querySelector('#transport-label').textContent.includes(mode), mode, { timeout: 30000 }); }
async function transfer(from, to, name, bytes) {
  await from.waitForFunction(() => !document.querySelector('#files').disabled);
  const downloading = to.waitForEvent('download');
  await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  const download = await downloading; assert.equal(hash(await readFile(await download.path())), hash(bytes)); completedFiles++;
  await from.waitForFunction(() => !document.querySelector('#files').disabled);
}
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  browser = await chromium.launch({ headless: true });
  const allScenarios = ['idle-host', 'idle-guest', 'simultaneous-failure', 'during-transfer', 'channel-error'];
  const selected = process.env.NEARBY_RECOVERY_SCENARIO;
  if (selected) assert.ok(allScenarios.includes(selected));
  const scenarios = baseline ? ['idle-host'] : selected ? [selected] : allScenarios;
  for (const scenario of scenarios) {
    const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true })]);
    for (const context of contexts) {
      await context.addInitScript(() => {
        localStorage.setItem('nearby-site-language', 'ru'); window.showDirectoryPicker = undefined;
        window.testConnections = []; window.testChannels = [];
        const RTC = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends RTC {
          constructor(...args) { super(...args); window.testConnections.push(this); }
          get connectionState() { return this.testState || super.connectionState; }
          forceState(state) { this.testState = state; this.dispatchEvent(new Event('connectionstatechange')); }
          createDataChannel(...args) {
            const channel = super.createDataChannel(...args), send = channel.send.bind(channel);
            window.testChannels.push(channel);
            channel.send = data => {
              send(data);
              if (window.dropOnBinary && typeof data !== 'string') { window.dropOnBinary = false; queueMicrotask(() => this.forceState('failed')); }
            };
            return channel;
          }
        };
      });
      if (baseline) await context.route(/\/app-\d+\.\d+\.\d+\.js/, async route => route.fulfill({ contentType: 'text/javascript', body: await readFile('artifacts/connection-recovery-baseline/browser/app.js.snapshot', 'utf8') }));
    }
    const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
    await host.goto(base); await host.locator('#create').click(); await host.locator('#share-link').waitFor();
    const invite = await host.locator('#share-link').inputValue();
    const roomId = new URLSearchParams(new URL(invite).hash.slice(1)).get('room');
    await guest.goto(invite); await guest.locator('#join-invite').click(); await host.locator('#approve').click();
    for (const page of [host, guest]) await connected(page, 'WebRTC');
    // Let the established connection sit idle across several server polls.
    if (scenario === 'idle-host') {
      await new Promise(resolve => setTimeout(resolve, 11000));
      if (!baseline) {
        await host.evaluate(() => window.testConnections[0].forceState('disconnected'));
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.ok(await host.locator('#files').isDisabled());
        await host.evaluate(() => window.testConnections[0].forceState('connected'));
        await connected(host, 'WebRTC');
        assert.ok(!(await readRoom(roomId)).relay, 'brief outage must retain the direct connection');
      }
    }
    if (scenario === 'during-transfer') {
      await transfer(guest, host, 'completed-before-loss.bin', randomBytes(180001));
      await host.evaluate(() => { window.dropOnBinary = true; });
      await host.locator('#files').setInputFiles([{ name: 'unfinished.bin', mimeType: 'application/octet-stream', buffer: randomBytes(2 * 1024 ** 2) }, { name: 'queued.bin', mimeType: 'application/octet-stream', buffer: randomBytes(100001) }]);
    } else if (scenario === 'channel-error') {
      await host.evaluate(() => window.testChannels[0].dispatchEvent(new Event('error')));
    } else {
      const target = scenario === 'idle-guest' ? guest : host;
      await target.evaluate(state => window.testConnections[0].forceState(state), scenario === 'idle-guest' ? 'disconnected' : 'failed');
      if (scenario === 'simultaneous-failure') await guest.evaluate(() => window.testConnections[0].forceState('failed'));
    }
    if (baseline) {
      await host.locator('#notice').filter({ hasText: 'Прямое соединение не удалось. Создайте новое подключение.' }).waitFor();
      console.log('Reproduced original idle failure: direct connection terminated with the exact reported error.');
      await host.screenshot({ path: 'artifacts/recovery-original-failure.png' });
      await Promise.all(contexts.map(context => context.close())); break;
    }
    for (const page of [host, guest]) await connected(page, 'Интернет');
    const room = await readRoom(roomId);
    assert.equal(room.transport, 'relay');
    if (scenario === 'during-transfer') {
      for (const page of [host, guest]) await page.locator('.transfer.error').filter({ hasText: 'unfinished.bin' }).waitFor();
      assert.equal(await guest.getByText('queued.bin', { exact: true }).count(), 0, 'old queue must not silently continue on a new channel');
      assert.ok(await host.getByText('Сохранить файл ↓', { exact: true }).isVisible(), 'completed file remains available');
    }
    await transfer(host, guest, `after-${scenario}.bin`, randomBytes(300007));
    await transfer(guest, host, `back-${scenario}.bin`, randomBytes(240001));
    await transfer(host, guest, `empty-${scenario}.txt`, Buffer.alloc(0));
    assert.equal(await host.locator('#share-link').inputValue(), invite);
    await guest.screenshot({ path: `artifacts/recovery-${scenario}.png` });
    await guest.locator('#tab-connection').click();
    await host.locator('#tab-connection').click(); await host.locator('#disconnect').click();
    await guest.locator('#disconnect').filter({ hasText: 'Новое подключение' }).waitFor({ timeout: 15000 });
    report.push({ scenario, recovered: true, hashes: true }); console.log(JSON.stringify(report.at(-1)));
    await Promise.all(contexts.map(context => context.close()));
  }
  if (!baseline) {
    let totals;
    for (let i = 0; i < 30; i++) { totals = await stats(); if (totals.files === completedFiles) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(totals.uses, scenarios.length); assert.equal(totals.files, scenarios.length * 3 + Number(scenarios.includes('during-transfer'))); assert.equal(totals.files, completedFiles);
    assert.deepEqual(errors, []);
    await writeFile(`artifacts/connection-recovery${selected ? '-' + selected : ''}-verification.json`, JSON.stringify({ testedAt: new Date().toISOString(), report, totals, errors }, null, 2));
  }
} finally { await browser?.close(); proc.kill(); await new Promise(resolve => proc.once('exit', resolve)); await rm(directory, { recursive: true, force: true }); }
