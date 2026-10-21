import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-auto-'));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}/`;
const proc = spawn(process.env.PHP_PATH || 'php', ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: directory }, stdio: 'ignore', windowsHide: true });
let browser;
const errors = [], report = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  browser = await chromium.launch({ headless: true });
  for (const scenario of ['direct', 'blocked-ice', 'host-without-rtc', 'guest-without-rtc']) {
    const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true })]);
    const posted = [];
    for (const [index, context] of contexts.entries()) {
      await context.addInitScript(({ scenario, index }) => {
        localStorage.setItem('nearby-site-language', 'ru'); window.showDirectoryPicker = undefined;
        if ((scenario === 'host-without-rtc' && index === 0) || (scenario === 'guest-without-rtc' && index === 1)) window.RTCPeerConnection = undefined;
        if (scenario === 'blocked-ice') {
          const RTC = window.RTCPeerConnection;
          window.RTCPeerConnection = class extends RTC {
            addIceCandidate() { return Promise.resolve(); }
            setRemoteDescription(description) { return super.setRemoteDescription({ type: description.type, sdp: description.sdp.replace(/^a=candidate:.*\r?\n/gm, '') }); }
          };
        }
      }, { scenario, index });
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
      context.on('request', request => { if (request.method() === 'POST') posted.push(request.postData()); });
    }
    const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
    for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
    await host.goto(base);
    assert.equal(await host.locator('#connection-mode').inputValue(), 'auto');
    assert.equal(await host.locator('#connection-settings').getAttribute('open'), null);
    await host.locator('#create').click(); await host.locator('#share-link').waitFor();
    const invite = await host.locator('#share-link').inputValue();
    const params = new URLSearchParams(new URL(invite).hash.slice(1));
    assert.equal(params.get('mode'), 'auto'); const secret = params.get('secret'); assert.equal(secret.length, 64);
    if (scenario === 'guest-without-rtc') {
      await guest.goto(base); await guest.locator('#invite-input').fill(await host.locator('#connection-id').textContent()); await guest.locator('#join-form button').click();
    } else { await guest.goto(invite); await guest.locator('#join-invite').click(); }
    await host.locator('#approve').waitFor(); assert.ok(await host.locator('#files').isDisabled());
    const approvedAt = Date.now(); await host.locator('#approve').click();
    for (const page of [host, guest]) await page.waitForFunction(() => !document.querySelector('#files').disabled, null, { timeout: 60000 });
    const expected = scenario === 'direct' ? /WebRTC/ : /Интернет/;
    for (const page of [host, guest]) assert.match(await page.locator('#transport-label').textContent(), expected);
    const elapsedMs = Date.now() - approvedAt;
    for (const [from, to, bytes] of [[host, guest, randomBytes(300000)], [guest, host, randomBytes(270001)], [host, guest, Buffer.alloc(0)]]) {
      const name = `private-${scenario}-${bytes.length}.bin`;
      const downloading = to.waitForEvent('download');
      await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
      const download = await downloading;
      assert.equal(hash(await readFile(await download.path())), hash(bytes));
      await from.waitForFunction(() => !document.querySelector('#files').disabled);
    }
    assert.ok(!posted.join('\n').includes(secret)); assert.ok(!posted.join('\n').includes('private-'));
    const room = JSON.parse(await readFile(path.join(directory, `room-${params.get('room')}.json`), 'utf8'));
    assert.equal(room.transport, scenario === 'direct' ? 'direct' : 'relay');
    assert.equal(Boolean(room.relay), scenario !== 'direct');
    await guest.screenshot({ path: `artifacts/automatic-${scenario}.png`, fullPage: true });
    assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await guest.locator('#tab-connection').click(); await guest.locator('#disconnect').click();
    report.push({ scenario, transport: room.transport, elapsedMs, files: 3, sha256: true }); console.log(JSON.stringify(report.at(-1)));
    await Promise.all(contexts.map(c => c.close()));
  }
  const totals = await (await fetch(base + 'api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) })).json();
  assert.equal(totals.uses, 4); assert.equal(totals.files, 12); assert.equal(totals.bytes, 4 * 570001);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/automatic-verification.json', JSON.stringify({ testedAt: new Date().toISOString(), report, totals, errors }, null, 2));
} finally { await browser?.close(); proc.kill(); await new Promise(resolve => proc.once('exit', resolve)); await rm(directory, { recursive: true, force: true }); }
