import {selectPane,openSettings} from './web-navigation.mjs';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const root = await mkdtemp(path.join(tmpdir(), 'nearby-pwa-'));
const revision = path.join(root, 'revision.txt'); await writeFile(revision, '1');
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); });
const origin = `http://127.0.0.1:${port}`, target = origin + '/web/';
const server = spawn(process.env.PHP_PATH || 'php', ['-S', `127.0.0.1:${port}`, 'scripts/pwa-test-router.php'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, NEARBY_WEB_STATE_DIR: root, NEARBY_PWA_TEST_REVISION_FILE: revision } });
const stopped = once(server, 'exit'); let browser;
const errors = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(target)).ok) break; } catch {} if (i === 59) throw new Error('PWA preview unavailable'); await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
  await phone.addInitScript(() => { localStorage.setItem('nearby-site-language', 'ru'); window.showSaveFilePicker = undefined; });
  const page = await phone.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(target + '#mode=internet');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller);
  const cdp = await phone.newCDPSession(page); await cdp.send('Page.enable');
  const manifestResult = await cdp.send('Page.getAppManifest'); assert.deepEqual(manifestResult.errors, []);
  const manifest = JSON.parse(manifestResult.data);
  assert.equal(new URL(manifest.id, manifestResult.url).href, target);
  assert.equal(new URL(manifest.start_url, manifestResult.url).href, target);
  assert.equal(new URL(manifest.scope, manifestResult.url).href, target);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const response = await fetch(new URL(icon.src, manifestResult.url)); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  const installability = await cdp.send('Page.getInstallabilityErrors'); assert.deepEqual(installability.installabilityErrors, []);
  const cacheKeys = () => page.evaluate(async () => { const keys = await caches.keys(), result = []; for (const key of keys.filter(value => value.startsWith('nearby-pwa-offline-'))) for (const request of await (await caches.open(key)).keys()) result.push(request.url); return result.sort(); });
  const expected = ['offline.html', 'pwa-offline.css', 'pwa-offline.js'].map(file => target + file).sort();
  assert.deepEqual(await cacheKeys(), expected);
  // Native browser prompts need real devices/user gestures; verify our event handling separately.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }); window.promptCalls = 0;
    event.prompt = async () => { window.promptCalls++; }; event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    dispatchEvent(event); window.installDefaultPrevented = event.defaultPrevented;
  });
  assert.equal(await page.evaluate(() => window.installDefaultPrevented), true);
  await page.locator('.pwa-launcher>summary').click(); await page.locator('#pwa-install').click(); assert.equal(await page.evaluate(() => window.promptCalls), 1);
  assert.equal(await page.locator('#pwa-install').isVisible(), false); assert.equal(await page.locator('#pwa-install-panel').isVisible(), true);
  await page.locator('#pwa-help').evaluate(node => { node.open = true; });
  assert.equal(await page.locator('#pwa-ios').isVisible(), true);
  await mkdir('artifacts', { recursive: true });
  await page.locator('#pwa-install-panel').screenshot({ path: 'artifacts/nearby-pwa-install-mobile.png' });
  await page.evaluate(() => { const event = new Event('beforeinstallprompt', { cancelable: true }); event.prompt = async () => {}; event.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(event); });
  await page.locator('#pwa-install').click(); await page.locator('#pwa-install-panel').waitFor({ state: 'hidden' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const language of ['en','hi','zh-CN','es','ru']) {
    if (await page.locator('#web-language-choice').count()) await page.locator('#web-language-choice').selectOption(language);
    else await page.evaluate(lang => { document.documentElement.lang = lang; }, language);
    await page.waitForFunction(lang => document.documentElement.lang === lang && (lang === 'ru' || !/[А-Яа-яЁё]/.test(document.querySelector('#pwa-install-panel').textContent)), language);
  }
  await page.evaluate(async () => { await caches.open('another-application-cache'); const registration = await navigator.serviceWorker.getRegistration(); const prefix = 'nearby-pwa-offline-' + encodeURIComponent(new URL(registration.scope).pathname) + '-'; await caches.open(prefix + 'obsolete'); });
  await page.evaluate(async () => { const response = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) }); if (!response.ok) throw new Error('Online API failed'); });
  assert.deepEqual(await cacheKeys(), expected);
  await phone.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('api.php', { method: 'POST', body: '{"action":"stats"}' }); return false; } catch { return true; } }), true, 'Offline API must not return a cached response');
  const privateFragment = '#room=' + 'a'.repeat(32) + '&key=' + 'b'.repeat(64) + '&mode=internet&secret=' + 'c'.repeat(64);
  const offline = await page.goto(target + 'index.html?temporary=1' + privateFragment); assert.equal(offline.status(), 503);
  await page.getByRole('heading', { name: 'Сейчас нет связи' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(await cacheKeys(), expected, 'Invitation/keys and API/file data never enter PWA caches');
  await page.screenshot({ path: 'artifacts/nearby-pwa-offline-mobile.png' });
  await phone.setOffline(false); await page.getByRole('link', { name: 'Попробовать снова' }).click();
  await page.locator('#create').waitFor();
  await openSettings(page);
  await page.locator('#connection-mode').selectOption('internet'); await page.locator('#connection-settings [data-close-settings]').last().click(); await page.locator('#create').click();
  await page.locator('#share-link').waitFor(); const invitation = await page.locator('#share-link').inputValue();
  const recipient = await browser.newContext({ acceptDownloads: true });
  await recipient.addInitScript(() => { localStorage.setItem('nearby-site-language', 'ru'); window.showSaveFilePicker = undefined; });
  const guest = await recipient.newPage(); guest.on('pageerror', error => errors.push(error.message));
  await guest.goto(target); await guest.evaluate(() => navigator.serviceWorker.ready); await guest.reload();
  await guest.goto(invitation); await guest.waitForFunction(() => navigator.serviceWorker.controller);
  await page.locator('#approve').click();
  for (const view of [page, guest]) await view.waitForFunction(() => !document.querySelector('#files').disabled, null, { timeout: 60000 });
  await page.evaluate(() => { window.pwaSessionMarker = 'still-open'; });
  await writeFile(revision, '2'); await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
  await page.locator('#pwa-status').filter({ hasText: 'Обновление Nearby готово' }).waitFor();
  const bytes = randomBytes(65536 + 19), name = 'pwa-private.bin';
  const downloading = guest.waitForEvent('download');
  await page.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  const card = guest.locator('.transfer').filter({ has: guest.getByText(name, { exact: true }) });
  await card.getByRole('link', { name: 'Открыть' }).waitFor({ timeout: 60000 });
  assert.equal(hash(await readFile(await (await downloading).path())), hash(bytes));
  assert.equal(await page.evaluate(() => window.pwaSessionMarker), 'still-open');
  assert.deepEqual(await cacheKeys(), expected); assert.deepEqual(await guest.evaluate(async () => { const result = []; for (const key of await caches.keys()) for (const item of await (await caches.open(key)).keys()) result.push(item.url); return result.sort(); }), expected);
  await selectPane(page,'connection'); await page.locator('#disconnect').click(); await page.close();
  const reopened = await phone.newPage(); await reopened.goto(target);
  await reopened.waitForFunction(async () => { const registration = await navigator.serviceWorker.getRegistration(); return registration.active?.state === 'activated' && !registration.waiting; });
  const remaining = await reopened.evaluate(() => caches.keys()); assert.ok(remaining.includes('another-application-cache')); assert.ok(!remaining.some(key => key.endsWith('-obsolete')));
  const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  await ios.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
  const standalone = await ios.newPage(); await standalone.goto(target);
  assert.equal(await standalone.locator('#pwa-install-panel').isVisible(), false);
  assert.equal(await standalone.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'), 'yes');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/Nearby-pwa-verification.json', JSON.stringify({ passed: true, scope: '/web/', chromiumInstallabilityErrors: installability.installabilityErrors, icons: '192/512 + maskable', installPrompt: 'synthetic event UI checks; native phone installation still requires validation', standalone: 'simulated iOS standalone flag', offlineScreen: true, apiAndFilesNotCached: true, transferWithWaitingUpdate: '64 KiB + 19 bytes, SHA-256 match', safeUpdateLifecycle: true, unrelatedCachesPreserved: true, checkedAt: new Date().toISOString() }, null, 2));
  console.log('PWA E2E passed: manifest/installability, icons, install UI, offline/reconnect, no private caches, real transfer during waiting update, safe activation and standalone UI.');
} finally {
  await browser?.close(); server.kill(); await stopped; await rm(root, { recursive: true, force: true });
}
