import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const state = await mkdtemp(path.join(tmpdir(), 'nearby-multi-'));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}/web/`;
const server = spawn(process.env.PHP_PATH || 'php', ['-S', `127.0.0.1:${port}`, 'scripts/pwa-test-router.php'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: state }, stdio: 'ignore', windowsHide: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errors = [], downloads = new Map(), posted = [], results = [];
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true });
  const pages = [];
  for (const [index, name] of ['Hub', 'Laptop', 'Phone', 'Tablet'].entries()) {
    const context = await browser.newContext({ acceptDownloads: true, viewport: index === 0 ? { width: 1100, height: 800 } : { width: 390, height: 844 }, isMobile: index !== 0 });
    await context.addInitScript(name => { localStorage.setItem('nearby-site-language', 'ru'); localStorage.setItem('nearby.device-name', name); localStorage.setItem('nearby.device-name.version', '2'); window.showDirectoryPicker = undefined; window.testConnections = []; const RTC = window.RTCPeerConnection; window.RTCPeerConnection = class extends RTC { constructor(...args) { super(...args); window.testConnections.push(this); } get connectionState() { return this.testState || super.connectionState; } forceState(state) { this.testState = state; this.dispatchEvent(new Event('connectionstatechange')); } }; }, name);
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    context.on('request', request => { if (request.method() === 'POST') posted.push(request.postData()); });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); downloads.set(page, []); page.on('download', download => downloads.get(page).push(download)); pages.push(page); await page.goto(base);
  }
  const [hub, laptop, phone, tablet] = pages;
  async function pair(host, guest, mode, hostCount, guestCount, numeric = false) {
    await host.locator('#tab-connection').click();
    if (await host.locator('#connection-mode').inputValue() !== mode) {
      await host.locator('#connection-settings').evaluate(node => node.open = true); await host.locator('#connection-mode').selectOption(mode); await host.locator('#connection-settings').evaluate(node => node.open = false);
    }
    await host.locator('#create').click(); await host.locator('#share-link').waitFor();
    const invite = await host.locator('#share-link').inputValue(), code = await host.locator('#connection-id').textContent();
    assert.match(code, /^\d{3}-\d{3}-\d{3}$/);
    if (numeric) { await guest.locator('#tab-connection').click(); await guest.locator('#invite-input').fill(code); await guest.locator('#join-form button').click(); }
    else await guest.goto(invite);
    await host.locator('#approve').waitFor(); await host.locator('#approve').click();
    await host.waitForFunction(count => document.querySelector('#connected-count').textContent === String(count), hostCount, { timeout: 60000 });
    await guest.waitForFunction(count => document.querySelector('#connected-count').textContent === String(count), guestCount, { timeout: 60000 });
    return { code, room: new URLSearchParams(new URL(invite).hash.slice(1)).get('room'), secret: new URLSearchParams(new URL(invite).hash.slice(1)).get('secret') };
  }
  async function select(page, name) {
    await page.locator('#tab-devices').click(); await page.locator('.device-target').filter({ has: page.locator('.device-name', { hasText: name }) }).locator('input').check();
    await page.locator('#devices-transfer').click(); assert.equal(await page.locator('#recipient-name').textContent(), name);
  }
  async function send(from, to, name, bytes = randomBytes(70001)) {
    const pending = to.waitForEvent('download');
    await from.locator('#tab-transfer').click(); await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
    const download = await pending; assert.equal(download.suggestedFilename(), name); assert.equal(hash(await readFile(await download.path())), hash(bytes));
    await from.waitForFunction(() => !document.querySelector('#files').disabled);
    return bytes.length;
  }
  const a = await pair(hub, laptop, 'auto', 1, 1);
  assert.ok(await hub.locator('#tab-devices').isHidden()); assert.match(await hub.locator('#transport-label').textContent(), /WebRTC/);
  const b = await pair(hub, phone, 'internet', 2, 1, true); assert.notEqual(a.code, b.code); assert.notEqual(a.room, b.room);
  assert.deepEqual(await hub.locator('[role=tab]:visible').allTextContents(), ['Подключение', 'Устройства', 'Передача']);
  assert.equal(await hub.locator('body').getAttribute('data-active-pane'), 'devices');
  assert.ok(await hub.locator('#transfer-statistics').isHidden()); assert.deepEqual(await hub.locator('#device-list .device-name').allTextContents(), ['Laptop', 'Phone']);
  assert.equal(await hub.locator('#recipient-name').textContent(), 'Laptop');
  let totalBytes = 0;
  await select(hub, 'Laptop'); totalBytes += await send(hub, laptop, 'only-laptop.bin'); assert.equal(downloads.get(phone).length, 0);
  await select(hub, 'Phone'); totalBytes += await send(hub, phone, 'only-phone.bin'); totalBytes += await send(hub, phone, 'empty-phone.bin', Buffer.alloc(0)); assert.equal(downloads.get(laptop).length, 1);
  await hub.locator('#tab-devices').click();
  totalBytes += await send(laptop, hub, 'from-laptop.bin'); assert.equal(await hub.locator('body').getAttribute('data-active-pane'), 'devices'); assert.equal(await hub.locator('#recipient-name').textContent(), 'Phone');
  totalBytes += await send(phone, hub, 'from-phone.bin'); assert.equal(await hub.locator('#recipient-name').textContent(), 'Phone');
  // A pending extra invitation can be cancelled without disturbing either active pairing.
  await hub.locator('#tab-connection').click(); await hub.locator('#create').click(); await hub.locator('#share-link').waitFor(); await hub.locator('#disconnect').click();
  assert.equal(await hub.locator('#connected-count').textContent(), '2');
  await select(hub, 'Phone'); await hub.evaluate(() => window.testConnections[0].forceState('failed'));
  await laptop.waitForFunction(() => document.querySelector('#transport-label').textContent.includes('Интернет') && !document.querySelector('#files').disabled);
  assert.equal(await hub.locator('#recipient-name').textContent(), 'Phone'); assert.equal(await hub.locator('#connected-count').textContent(), '2');
  await select(hub, 'Laptop'); totalBytes += await send(hub, laptop, 'after-cancel.bin');
  // The hub can also be a guest while retaining both of its host pairings.
  const c = await pair(tablet, hub, 'auto', 1, 3, true); assert.notEqual(c.room, a.room);
  await select(hub, 'Tablet'); totalBytes += await send(hub, tablet, 'mixed-role.bin');
  await select(hub, 'Phone');
  // Hold the next encrypted frame, then close its selected pairing during a two-file batch.
  let releaseFrame, frameStarted;
  const held = new Promise(resolve => { frameStarted = resolve; }), release = new Promise(resolve => { releaseFrame = resolve; });
  let hold = true;
  const frameRoute = async route => {
    if (hold && route.request().postDataJSON()?.action === 'relay-push') { hold = false; frameStarted(); await release; }
    try { await route.continue(); } catch (error) { if (!/already handled/i.test(error.message)) throw error; }
  };
  await hub.route('**/api.php?transport=relay', frameRoute);
  await hub.locator('#files').setInputFiles([{ name: 'interrupted.bin', mimeType: 'application/octet-stream', buffer: randomBytes(400000) }, { name: 'must-not-redirect.bin', mimeType: 'application/octet-stream', buffer: randomBytes(1000) }]);
  await Promise.race([held, new Promise((_, reject) => setTimeout(() => reject(new Error('No relay frame intercepted')), 10000))]);
  await hub.locator('#disconnect-selected').click(); releaseFrame(); await hub.unroute('**/api.php?transport=relay', frameRoute);
  await hub.waitForFunction(() => document.querySelector('#connected-count').textContent === '2');
  assert.equal(await hub.locator('#recipient-name').textContent(), 'Устройство не выбрано'); assert.ok(await hub.locator('#files').isDisabled());
  assert.equal(await laptop.locator('.transfer-title', { hasText: 'must-not-redirect' }).count(), 0); assert.equal(await tablet.locator('.transfer-title', { hasText: 'must-not-redirect' }).count(), 0);
  await select(hub, 'Tablet'); await hub.locator('#disconnect-selected').click(); await hub.waitForFunction(() => document.querySelector('#connected-count').textContent === '1');
  assert.ok(await hub.locator('#tab-devices').isHidden()); assert.ok(await hub.locator('#files').isDisabled()); await hub.locator('#select-remaining').click(); assert.equal(await hub.locator('#recipient-name').textContent(), 'Laptop');
  totalBytes += await send(hub, laptop, 'explicit-new-recipient.bin');
  await hub.locator('#tab-connection').click(); assert.ok(await hub.locator('#transfer-statistics').isVisible()); await hub.locator('#tab-transfer').click(); assert.ok(await hub.locator('#transfer-statistics').isHidden());
  // Return to two targets for mobile, keyboard and locale checks.
  const d = await pair(hub, phone, 'auto', 2, 1, true);
  await hub.setViewportSize({ width: 390, height: 844 }); await hub.locator('#tab-devices').click();
  await hub.screenshot({ path: 'artifacts/multi-device-mobile.png', fullPage: true });
  for (const pane of ['connection', 'devices', 'transfer']) { await hub.locator(`#tab-${pane}`).click(); assert.ok(await hub.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await select(hub, 'Phone'); await hub.screenshot({ path: 'artifacts/multi-device-transfer-mobile.png', fullPage: true });
  await hub.locator('#tab-devices').click(); await hub.locator('#tab-devices').focus(); await hub.keyboard.press('ArrowRight'); assert.equal(await hub.locator('#tab-transfer').getAttribute('aria-selected'), 'true');
  const selectedRoom = await hub.locator('#device-list input:checked').inputValue();
  for (const language of ['en', 'hi', 'zh-CN', 'es', 'ru']) {
    await hub.locator('#web-language-choice').selectOption(language); await hub.waitForFunction(language => document.documentElement.lang === language, language);
    await hub.locator('#tab-devices').click();
    if (language !== 'ru') assert.ok(!/[А-Яа-яЁё]/.test(await hub.locator('#devices-pane').innerText()), language + ': untranslated device selector');
    assert.deepEqual(await hub.locator('#device-list .device-name').allTextContents(), ['Laptop', 'Phone']);
    assert.equal(await hub.locator('#device-list input:checked').inputValue(), selectedRoom);
    await hub.locator('#tab-transfer').click(); assert.equal(await hub.locator('#recipient-name').textContent(), 'Phone');
  }
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1366, height: 768 }]) {
    await hub.setViewportSize(viewport); await hub.locator('#tab-devices').click();
    assert.ok(await hub.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    assert.ok((await hub.locator('#device-list').boundingBox()).height > 100);
  }
  const totals = await (await fetch(base + 'api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) })).json();
  assert.equal(totals.uses, 4); assert.equal(totals.files, 8); assert.equal(totals.bytes, totalBytes);
  for (const connection of [a, b, c, d]) if (connection.secret) assert.ok(!posted.join('\n').includes(connection.secret));
  assert.ok(!posted.join('\n').includes('only-laptop.bin')); assert.deepEqual(errors, []);
  results.push('simultaneous direct + encrypted relay', 'mixed host/guest roles', 'fresh numeric invitation per peer', 'recipient isolation + incoming from both peers', 'cancel invitation preserves active peers', 'recovery of one pairing preserves other pairings and recipient', 'disconnect never redirects queued files', 'explicit selection after recipient loss', 'mobile layout + keyboard tabs + five locales preserve selected device', 'statistics once per pairing + completed files only');
  await writeFile('artifacts/multi-device-verification.json', JSON.stringify({ testedAt: new Date().toISOString(), results, totals, errors }, null, 2)); console.log(JSON.stringify({ results, totals, errors }));
} finally { await browser?.close(); server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); await rm(state, { recursive: true, force: true }); }
