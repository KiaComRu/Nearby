import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { discoveryBus } from '../test-support/discovery-bus.mjs';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-trusted-ui-'));
const bus = discoveryBus(), applications = [], errors = []; let browser;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (const name of ['Первый проверенный ПК', 'Второй проверенный ПК']) applications.push(await createApp({ host: '127.0.0.1', port: 0, statistics: false, storage: path.join(directory, String(applications.length)),
    trustedLan: { identityOptions: { protection: process.env.NEARBY_TEST_DPAPI === '1' ? 'dpapi' : 'file', name } }, discovery: { socketFactory: () => bus.createSocket(), getInterfaces: () => [{ address: '127.0.0.1' }] } }));
  let [first, second] = applications;
  browser = await chromium.launch({ headless: true });
  const [host, client] = await Promise.all([browser.newPage({ acceptDownloads: true }), browser.newPage({ acceptDownloads: true })]);
  const posts = [];
  for (const page of [host, client]) { page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); }); }
  await Promise.all([host.goto(first.adminUrl), client.goto(second.adminUrl)]);
  for (const page of [host,client]) await page.locator('#saved-devices').evaluate(node => { node.open = true; });
  const discovered = client.locator('#nearby-devices .device-card').filter({ hasText: 'Первый проверенный ПК' });
  await discovered.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await Promise.all([host.locator('.pairing-code').waitFor(), client.locator('.pairing-code').waitFor()]);
  for (const page of [host, client]) assert.equal(await page.locator('#transfer-workspace').isVisible(), false, 'Pairing is not yet a connection');
  const code = await host.locator('.pairing-code').textContent(); assert.equal(code, await client.locator('.pairing-code').textContent()); assert.equal(code.replaceAll(' ', '').length, 64);
  await mkdir('artifacts', { recursive: true });
  await client.setViewportSize({ width: 390, height: 844 }); assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await client.locator('.pairing-card').evaluate(card => { const bounds = card.getBoundingClientRect(); return [...card.querySelectorAll('button')].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; }); }), 'Pairing actions fit inside the verification card');
  await client.locator('.pairing-card').screenshot({ path: 'artifacts/nearby-pairing-code-mobile.png' });
  await client.setViewportSize({ width: 1280, height: 900 });
  await client.getByRole('button', { name: 'Строки совпадают — подтвердить' }).click();
  assert.equal(await client.locator('#trusted-devices [data-fingerprint]').count(), 0);
  await host.getByRole('button', { name: 'Строки совпадают — подтвердить' }).click();
  const hostSaved = host.locator('#trusted-devices .file-row').filter({ hasText: 'Второй проверенный ПК' });
  await hostSaved.getByRole('button', { name: 'Переименовать' }).click();
  await hostSaved.getByRole('textbox', { name: 'Новое имя устройства' }).fill('Рабочий ноутбук');
  await hostSaved.getByRole('button', { name: 'Сохранить имя' }).click();
  await host.locator('#saved-devices').evaluate(node => { node.open = true; }); await client.locator('#saved-devices').evaluate(node => { node.open = true; });
  await host.locator('#trusted-devices .file-row').filter({ hasText: 'Рабочий ноутбук' }).waitFor();
  for (const page of [host, client]) assert.equal(await page.locator('#transfer-workspace').isVisible(), false, 'Saved trust is not an active connection');
  const saved = client.locator('#trusted-devices .file-row').filter({ hasText: 'Первый проверенный ПК' });
  await saved.getByRole('button', { name: 'Подключиться защищённо' }).click();
  await client.waitForFunction(() => document.querySelector('#pc-transport').textContent.includes('TLS 1.3'));
  await host.locator('#transfer-workspace').waitFor();
  await client.locator('#transfer-workspace').waitFor();
  const bytes = randomBytes(1024 * 1024 + 13);
  for (const [name, content] of [['secure-peer.bin', bytes], ['secure-empty.txt', Buffer.alloc(0)]]) {
    await client.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: content });
    await client.locator('#queue .file-row').filter({ hasText: name }).getByText('Получено и сохранено на компьютере', { exact: true }).waitFor();
    const file = (await readdir(first.inbox)).find(value => value.endsWith('-' + name)); assert.equal(hash(await readFile(path.join(first.inbox, file))), hash(content));
    const downloading = client.waitForEvent('download');
    await host.locator('#files').setInputFiles({ name: 'back-' + name, mimeType: 'application/octet-stream', buffer: content });
    const receiving = client.locator('#shared .file-row').filter({ hasText: 'back-' + name });

    const download = await downloading; assert.equal(hash(await readFile(await download.path())), hash(content));
  }
  await client.reload(); await client.waitForFunction(() => document.querySelector('#pc-transport').textContent.includes('TLS 1.3'));
  const savedFingerprint = await saved.getAttribute('data-fingerprint');
  await Promise.all(applications.map(app => app.close())); applications.length = 0;
  for (const name of ['Первый проверенный ПК', 'Второй проверенный ПК']) applications.push(await createApp({ host: '127.0.0.1', port: 0, statistics: false, storage: path.join(directory, String(applications.length)),
    trustedLan: { identityOptions: { protection: process.env.NEARBY_TEST_DPAPI === '1' ? 'dpapi' : 'file', name } }, discovery: { socketFactory: () => bus.createSocket(), getInterfaces: () => [{ address: '127.0.0.1' }] } }));
  [first, second] = applications;
  await Promise.all([host.goto(first.adminUrl), client.goto(second.adminUrl)]);
  for (const page of [host,client]) await page.locator('#saved-devices').evaluate(node => { node.open = true; });
  await host.locator('#trusted-devices .file-row').filter({ hasText: 'Рабочий ноутбук' }).waitFor();
  await client.locator('#nearby-devices .device-card').filter({ hasText: 'Первый проверенный ПК' }).getByRole('button', { name: 'Подключиться', exact: true }).waitFor();
  assert.equal(await saved.getAttribute('data-fingerprint'), savedFingerprint);
  await saved.getByRole('button', { name: 'Подключиться защищённо' }).click();
  await client.waitForFunction(() => document.querySelector('#pc-transport').textContent.includes('TLS 1.3'));
  await mkdir('artifacts', { recursive: true });
  await host.screenshot({ path: 'artifacts/nearby-trusted-host.png', fullPage: true });
  await client.setViewportSize({ width: 390, height: 844 }); assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await client.screenshot({ path: 'artifacts/nearby-trusted-mobile.png', fullPage: true });
  await client.locator('#tab-connection').click(); await client.locator('#saved-devices').evaluate(node => { node.open = true; }); await saved.getByRole('button', { name: 'Забыть устройство' }).click();
  await client.locator('#connection').waitFor();
  await client.waitForFunction(() => document.querySelectorAll('#trusted-devices [data-fingerprint]').length === 0);
  await host.waitForFunction(() => document.querySelectorAll('#trusted-devices [data-fingerprint]').length === 0);
  await host.waitForFunction(() => document.querySelector('#files').disabled);
  assert.equal(await client.locator('#files').isDisabled(), true);
  assert.ok(!posts.includes('/api/join'), 'TLS pairing and transfers do not submit a legacy PIN');
  assert.equal(posts.filter(route => route === '/api/trust/pair').length, 1, 'Restart does not require new pairing');
  if (process.env.NEARBY_TEST_DPAPI === '1') for (const name of ['0', '1']) { const stored = await readFile(path.join(directory, name, 'device-identity.json'), 'utf8'); assert.equal(JSON.parse(stored).protection, 'dpapi'); assert.ok(!stored.includes('PRIVATE KEY')); }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/Nearby-trusted-verification.json', JSON.stringify({ passed: true, bothOwnerConfirmation: true, verificationBits: 256, mutualTls: 'TLS 1.3', files: '1 MiB + empty, both directions, SHA-256 match', noLegacyPin: true, revokeAndReload: true, mobileWidth: 390, windowsDpapi: process.env.NEARBY_TEST_DPAPI === '1', discovery: 'simulated transport; separate real UDP test available', limitations: 'Two engines on one host; physical devices still require testing', testedAt: new Date().toISOString() }, null, 2));
  console.log('Trusted UI passed: both confirmations, TLS 1.3, 1 MiB + empty both directions SHA-256, reload, revocation, no PIN, mobile layout.');
} finally { await browser?.close(); await Promise.all(applications.map(app => app.close())); await rm(directory, { recursive: true, force: true }); }
