import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const state = await mkdtemp(path.join(tmpdir(), 'nearby-autojoin-'));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}/`;
const proc = spawn(process.env.PHP_PATH || 'php', ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: state }, windowsHide: true, stdio: 'ignore' });
let browser; const errors = [], joins = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext({ acceptDownloads: true });
  const phone = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const context of [owner, phone]) {
    await context.addInitScript(() => { try { localStorage.setItem('nearby-site-language', 'ru'); } catch {} window.showDirectoryPicker = undefined; });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  }
  phone.on('request', request => { if (request.method() === 'POST' && JSON.parse(request.postData() || '{}').action === 'join') joins.push(request.postData()); });
  async function invite() { const host = await owner.newPage(); await host.goto(base); await host.locator('#create').click(); await host.locator('#share-link').waitFor(); return { host, url: await host.locator('#share-link').inputValue() }; }
  async function approve(host, guest) {
    await host.locator('#approve').waitFor(); assert.ok(await guest.locator('#files').isDisabled());
    await host.locator('#approve').click();
    for (const page of [host, guest]) await page.waitForFunction(() => !document.querySelector('#files').disabled, null, { timeout: 45000 });
  }
  async function close(host, guest) { await host.locator('#tab-connection').click(); await host.locator('#disconnect').click(); await host.close(); await guest.close(); }
  const first = await invite(), guest = await phone.newPage();
  await guest.route('**/api.php', async route => {
    if (route.request().postDataJSON()?.action !== 'join') return route.continue();
    const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ response });
  });
  await guest.goto(first.url);
  await guest.evaluate(() => { document.querySelector('#join-invite').onclick(); document.querySelector('#join-invite').onclick(); });
  await guest.locator('#connect-card #session').waitFor();
  assert.equal(joins.length, 1, 'opening a QR URL joins exactly once, including repeated clicks while waiting');
  assert.ok(await guest.locator('#join-invite').isHidden()); assert.equal(new URL(guest.url()).hash, '');
  await approve(first.host, guest);
  for (const [from, to, bytes] of [[first.host, guest, randomBytes(240001)], [guest, first.host, randomBytes(180003)], [first.host, guest, Buffer.alloc(0)]]) {
    const downloading = to.waitForEvent('download');
    await from.locator('#files').setInputFiles({ name: `autojoin-${bytes.length}.bin`, mimeType: 'application/octet-stream', buffer: bytes });
    const download = await downloading; assert.equal(hash(await readFile(await download.path())), hash(bytes));
    await from.waitForFunction(() => !document.querySelector('#files').disabled);
  }
  await guest.screenshot({ path: 'artifacts/invitation-autojoin-mobile.png' });
  await close(first.host, guest);
  const settings = await phone.newPage(); await settings.goto(base);
  assert.equal(await settings.locator('#connection-settings').getAttribute('open'), null);
  await settings.locator('#connection-settings summary').click();
  assert.equal(await settings.locator('#confirm-invitation').isChecked(), false);
  await settings.locator('#confirm-invitation').check(); await settings.reload();
  assert.equal(await settings.locator('#confirm-invitation').isChecked(), true);
  const manual = await invite(); await settings.goto(manual.url);
  await settings.locator('#join-invite').waitFor(); assert.equal(joins.length, 1, 'saved manual preference waits for a click');
  await settings.locator('#join-invite').click(); await approve(manual.host, settings); await close(manual.host, settings);
  const reset = await phone.newPage(); await reset.goto(base); await reset.locator('#connection-settings summary').click();
  await reset.locator('#confirm-invitation').uncheck(); await reset.reload(); assert.equal(await reset.locator('#confirm-invitation').isChecked(), false);
  const automaticAgain = await invite(); await reset.goto(automaticAgain.url); await approve(automaticAgain.host, reset); await close(automaticAgain.host, reset);
  const invalid = await phone.newPage();
  const expiredUrl = base + '#room=' + 'a'.repeat(32) + '&key=' + 'b'.repeat(64) + '&mode=auto&secret=' + 'c'.repeat(64);
  await invalid.goto(expiredUrl); await invalid.locator('#notice').filter({ hasText: 'Приглашение не найдено' }).waitFor();
  assert.equal(joins.length, 4); assert.ok(await invalid.locator('#join-invite').isEnabled());
  await invalid.locator('#join-invite').click(); await invalid.waitForFunction(() => !document.querySelector('#join-invite').disabled); assert.equal(joins.length, 5);
  await invalid.goto(base + '#room=bad'); await invalid.locator('#notice.error').waitFor(); assert.equal(joins.length, 5, 'malformed invite must not reach the API'); await invalid.close();
  const noStorage = await phone.newPage();
  await noStorage.route(base, async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace(/<label class="invitation-confirmation"[^\n]+<\/label>/, '') }); });
  await noStorage.addInitScript(() => { const get = Storage.prototype.getItem; Storage.prototype.getItem = function(key) { if (key === 'nearby.confirm-invitation') throw new DOMException('Disabled', 'SecurityError'); return get.call(this, key); }; });
  const fourth = await invite(); await noStorage.goto(fourth.url); await approve(fourth.host, noStorage); await close(fourth.host, noStorage);
  for (const locale of ['ru', 'en', 'hi', 'zh-CN', 'es']) {
    const page = await phone.newPage(); await page.goto(base + '?lang=' + locale); await page.locator('#connection-settings summary').click();
    await page.waitForFunction(locale => document.documentElement.lang === locale, locale);
    assert.ok(await page.locator('#confirm-invitation').isVisible());
    if (locale !== 'ru') assert.ok(!/[А-Яа-яЁё]/.test(await page.locator('.invitation-confirmation').innerText()));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.close();
  }
  let totals;
  for (let i = 0; i < 30; i++) { totals = await (await fetch(base + 'api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"stats"}' })).json(); if (totals.uses === 4 && totals.files === 3) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(totals.uses, 4); assert.equal(totals.files, 3); assert.deepEqual(errors, []);
  const secret = new URLSearchParams(new URL(first.url).hash.slice(1)).get('secret'); assert.ok(!joins.join('\n').includes(secret));
  await writeFile('artifacts/invitation-autojoin-verification.json', JSON.stringify({ testedAt: new Date().toISOString(), automaticJoin: true, manualPreference: true, preferencePersistence: true, duplicateJoinPrevented: true, expiredInviteRetry: true, storageUnavailable: true, cachedMarkupCompatible: true, languages: 5, filesVerified: 3, totals, errors }, null, 2));
  console.log('Invitation autojoin passed: automatic QR/link entry, saved opt-in confirmation, retries, duplicate prevention, storage failure, five languages and SHA-256 transfers.');
} finally { await browser?.close(); proc.kill(); await new Promise(resolve => proc.once('exit', resolve)); await rm(state, { recursive: true, force: true }); }
