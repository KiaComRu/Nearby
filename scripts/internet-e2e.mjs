import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { checkFilePresentation } from './check-file-presentation.mjs';
const state = await mkdtemp(path.join(tmpdir(), 'nearby-internet-e2e-'));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const target = `http://127.0.0.1:${port}/`;
const server = spawn(process.env.PHP_PATH || 'php', ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: state }, stdio: 'ignore', windowsHide: true });
let browser;
const errors = [], requests = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function stats() { return (await fetch(target + 'api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) })).json(); }
try {
  for (let i = 0; i < 50; i++) { try { await fetch(target); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  browser = await chromium.launch({ headless: true });
  const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' })]);
  // Only the website HTTP origin is reachable; no RTC transport or peer LAN endpoints.
  for (const context of contexts) {
    await context.addInitScript(() => { localStorage.setItem('nearby-site-language', 'ru'); window.RTCPeerConnection = undefined; window.showSaveFilePicker = undefined; });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
    context.on('request', request => { if (request.method() === 'POST') requests.push(request.postData()); });
  }
  const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
  for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
  await host.goto(target + '#mode=internet');
  assert.equal(await host.locator('#connection-mode').inputValue(), 'internet');
  await host.locator('#create').click(); await host.locator('#share-link').waitFor();
  const invite = await host.locator('#share-link').inputValue();
  const secret = new URLSearchParams(new URL(invite).hash.slice(1)).get('secret'); assert.equal(secret.length, 64);
  await guest.goto(invite);
  await host.locator('#approve').waitFor(); assert.equal(await host.locator('#files').isDisabled(), true);
  await host.locator('#approve').click();
  for (const page of [host, guest]) await page.waitForFunction(() => !document.querySelector('#files').disabled, null, { timeout: 60000 });
  assert.match(await host.locator('#transport-label').textContent(), /Интернет/);
  let count = 0, size = 0;
  async function transfer(from, to, name, bytes) {
    await from.waitForFunction(() => !document.querySelector('#files').disabled);
    const downloading = to.waitForEvent('download');
    await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
    const card = to.locator('.transfer').filter({ has: to.getByText(name, { exact: true }) });
    await card.getByText('Файл принят. Загрузка началась автоматически.', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
    const download = await downloading; assert.equal(download.suggestedFilename(), name);
    assert.equal(hash(await readFile(await download.path())), hash(bytes));
    count++; size += bytes.length;
    assert.equal(await card.locator('td').count(), 5);
    const cells = await card.locator('td').evaluateAll(nodes => nodes.map(n => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })));
    assert.ok(cells.every(c => Math.abs(c.y - cells[0].y) < 1), 'all cells belong to the same table row'); assert.ok(cells.every((c, i) => !i || c.x > cells[i-1].x));
    const started = Date.parse(await card.locator('time').getAttribute('datetime')); assert.ok(Math.abs(Date.now() - started) < 60000);
    const open = card.getByRole('link', { name: 'Открыть', exact: true }); const url = await open.getAttribute('href'); assert.ok(url.startsWith('blob:'));
    assert.equal(await open.getAttribute('rel'), 'noopener noreferrer');
    const preview = await to.evaluate(async url => { const response = await fetch(url); return { type: response.headers.get('content-type'), bytes: [...new Uint8Array(await response.arrayBuffer())] }; }, url);
    assert.equal(hash(Buffer.from(preview.bytes)), hash(bytes));
    assert.equal(preview.type, name.endsWith('.png') ? 'image/png' : name.endsWith('.txt') ? 'text/plain' : 'application/octet-stream');
    if (name.endsWith('.png')) {
      await checkFilePresentation(to, card, { image: true, touch: to === guest });
      const outgoing = from.locator('#outgoing-transfers .transfer').filter({ has: from.getByText(name, { exact: true }) });
      await checkFilePresentation(from, outgoing, { image: true, touch: from === guest });
      await to.screenshot({ path: 'artifacts/preview-status-mobile.png' });
      await outgoing.locator('.transfer-status-button').click(); await from.screenshot({ path: 'artifacts/preview-status-desktop.png' }); await from.keyboard.press('Escape');
    }
    if (name.endsWith('.html')) { assert.equal(await card.locator('.file-preview img').count(), 0); assert.equal(await card.locator('.file-preview').textContent(), 'HTML'); }
    if (name === 'preview.txt') { const opened = to.waitForEvent('popup'); await open.click(); const previewPage = await opened; await previewPage.waitForLoadState(); assert.equal(await previewPage.locator('body').innerText(), bytes.toString()); await previewPage.close(); }
    if (name.endsWith('.html')) assert.equal(await open.getAttribute('download'), name);
    if (name === 'private-to-phone.bin') {
      await to.screenshot({ path: 'artifacts/transfer-table-mobile.png' });
      await open.scrollIntoViewIfNeeded(); await to.screenshot({ path: 'artifacts/transfer-table-mobile-actions.png' });
      await from.setViewportSize({ width: 1440, height: 1000 }); await from.screenshot({ path: 'artifacts/transfer-table-desktop.png' });
    }
    await card.getByRole('button', { name: 'Удалить из списка' }).click(); assert.equal(await card.count(), 0);
    assert.ok(await to.evaluate(url => fetch(url).then(() => false, () => true), url), 'removed blob URL must be revoked');
    assert.ok(await to.locator('#empty').isVisible());
    const sent = from.locator('#outgoing-transfers .transfer').filter({ has: from.getByText(name, { exact: true }) }); await sent.getByRole('link', { name: 'Открыть', exact: true }).waitFor();
    await sent.getByRole('button', { name: 'Удалить из списка' }).click(); assert.equal(await sent.count(), 0);
    await from.waitForFunction(() => !document.querySelector('#files').disabled);
    console.log(`Internet relay: ${name}, ${bytes.length} bytes, SHA-256 verified`);
  }
  await transfer(host, guest, 'private-to-phone.bin', randomBytes(1024 * 1024 + 31));
  await transfer(guest, host, 'private-to-pc.bin', randomBytes(1024 * 1024 + 7));
  await transfer(host, guest, 'private-empty.txt', Buffer.alloc(0));
  await transfer(host, guest, 'preview.txt', Buffer.from('Nearby preview works.'));
  await transfer(host, guest, 'untrusted.html', Buffer.from('<script>opener.alert(1)</script>'));
  const image = Buffer.from(await host.evaluate(() => { const canvas=document.createElement('canvas'); canvas.width=160; canvas.height=100; const context=canvas.getContext('2d'); context.fillStyle='#3686c8'; context.fillRect(0,0,160,100); context.fillStyle='#77e8ff'; context.fillRect(15,15,50,70); context.fillStyle='#fff'; context.fillRect(80,40,65,45); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  await transfer(host, guest, 'image-preview.png', image);
  await host.evaluate(() => { const files = new DataTransfer(); files.items.add(new File([new ArrayBuffer(100 * 1024 ** 2 + 1)], 'private-too-large.bin')); const input = document.querySelector('#files'); input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await host.locator('#notice').filter({ hasText: 'Недопустимое имя или размер файла' }).waitFor();
  assert.equal(await guest.getByText('private-too-large.bin', { exact: true }).count(), 0);
  assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (let i = 0; i < 50; i++) { const totals = await stats(); if (totals.files === count && totals.bytes === size) break; await new Promise(r => setTimeout(r, 100)); }
  const totals = await stats(); assert.equal(totals.files, count); assert.equal(totals.bytes, size);
  const posted = requests.join('\n'); assert.ok(!posted.includes(secret)); assert.ok(!posted.includes('private-')); assert.ok(!posted.includes('"action":"signal"'));
  for (const name of (await readdir(state)).filter(n => n.startsWith('room-'))) { const body = await readFile(path.join(state, name), 'utf8'); assert.ok(!body.includes(secret)); assert.ok(!body.includes('private-')); }
  await mkdir('artifacts', { recursive: true });
  await host.screenshot({ path: 'artifacts/nearby-internet-desktop.png', fullPage: true });
  await guest.screenshot({ path: 'artifacts/nearby-internet-mobile.png', fullPage: true });
  await guest.locator('#tab-connection').click(); await host.locator('#tab-connection').click(); await guest.locator('#disconnect').click(); await host.locator('#disconnect').filter({ hasText: 'Новое подключение' }).waitFor({ timeout: 10000 });
  assert.deepEqual(errors, []);
  const report = { passed: true, rtcDisabled: true, websiteOriginOnly: true, files: count, bytes: size, encryptedRequests: true, statisticsVerified: true, limitMiB: 100, testedAt: new Date().toISOString() };
  await writeFile('artifacts/Nearby-internet-verification.json', JSON.stringify(report, null, 2));
  console.log('Internet E2E passed: HTTP-only pairing, both directions, binary hashes, empty file, automatic reception, size limit, ciphertext privacy, statistics, disconnect.');
} finally { await browser?.close(); server.kill(); await new Promise(r => server.once('exit', r)); await rm(state, { recursive: true, force: true }); }
