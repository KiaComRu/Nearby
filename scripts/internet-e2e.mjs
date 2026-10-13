import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
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
  const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' })]);
  // Only the website HTTP origin is reachable; no RTC transport or peer LAN endpoints.
  for (const context of contexts) {
    await context.addInitScript(() => { window.RTCPeerConnection = undefined; window.showSaveFilePicker = undefined; });
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
  await guest.goto(invite); await guest.locator('#join-invite').click();
  await host.locator('#approve').waitFor(); assert.equal(await host.locator('#files').isDisabled(), true);
  await host.locator('#approve').click();
  for (const page of [host, guest]) await page.waitForFunction(() => !document.querySelector('#files').disabled, null, { timeout: 60000 });
  assert.match(await host.locator('#transport-label').textContent(), /Интернет/);
  let count = 0, size = 0;
  async function transfer(from, to, name, bytes) {
    await from.waitForFunction(() => !document.querySelector('#files').disabled);
    await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
    const card = to.locator('.transfer').filter({ has: to.getByText(name, { exact: true }) });
    await card.getByRole('button', { name: 'Принять', exact: true }).click();
    await card.getByText('Файл принят. Нажмите «Сохранить файл».', { exact: true }).waitFor({ timeout: 60000 });
    const downloading = to.waitForEvent('download'); await card.getByRole('link', { name: 'Сохранить файл' }).click();
    const download = await downloading; assert.equal(download.suggestedFilename(), name);
    assert.equal(hash(await readFile(await download.path())), hash(bytes));
    count++; size += bytes.length;
    await card.getByRole('button', { name: 'Убрать из памяти' }).click();
    await from.waitForFunction(() => !document.querySelector('#files').disabled);
    console.log(`Internet relay: ${name}, ${bytes.length} bytes, SHA-256 verified`);
  }
  await transfer(host, guest, 'private-to-phone.bin', randomBytes(1024 * 1024 + 31));
  await transfer(guest, host, 'private-to-pc.bin', randomBytes(1024 * 1024 + 7));
  await transfer(host, guest, 'private-empty.txt', Buffer.alloc(0));
  await host.locator('#files').setInputFiles({ name: 'private-refused.txt', mimeType: 'text/plain', buffer: Buffer.from('do not receive') });
  await guest.locator('.transfer').filter({ hasText: 'private-refused.txt' }).getByRole('button', { name: 'Отклонить' }).click();
  await host.getByText('Передача отклонена или отменена другим устройством.', { exact: true }).first().waitFor();
  await host.waitForFunction(() => !document.querySelector('#files').disabled);
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
  await guest.locator('#disconnect').click(); await host.locator('#disconnect').filter({ hasText: 'Новое подключение' }).waitFor({ timeout: 10000 });
  assert.deepEqual(errors, []);
  const report = { passed: true, rtcDisabled: true, websiteOriginOnly: true, files: count, bytes: size, encryptedRequests: true, statisticsVerified: true, limitMiB: 100, testedAt: new Date().toISOString() };
  await writeFile('artifacts/Nearby-internet-verification.json', JSON.stringify(report, null, 2));
  console.log('Internet E2E passed: HTTP-only pairing, both directions, binary hashes, empty file, refusal, size limit, ciphertext privacy, statistics, disconnect.');
} finally { await browser?.close(); server.kill(); await new Promise(r => server.once('exit', r)); await rm(state, { recursive: true, force: true }); }
