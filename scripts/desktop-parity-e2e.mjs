import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../server.mjs';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-desktop-parity-'));
const applications = [], opened = [], errors = [], downloads = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let browser;
try {
  for (let index = 0; index < 3; index++) applications.push(await createApp({ host: '127.0.0.1', port: 0, storage: path.join(directory, String(index)), statistics: false, discovery: false, trustedLan: false, openTransferredFile: async file => { opened.push(file); } }));
  browser = await chromium.launch({ headless: true });
  const pages = [];
  for (const app of applications) { const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } })).newPage(); page.on('pageerror', e => errors.push(e.message)); downloads.set(page, []); page.on('download', d => downloads.get(page).push(d)); await page.goto(app.adminUrl); await page.locator('#workspace').waitFor(); pages.push(page); }
  const [owner, second, third] = pages, [firstApp, secondApp] = applications;
  const origin = app => `http://127.0.0.1:${app.port}`;
  const request = (app, url, method = 'GET', data) => fetch(origin(app) + url, { method, headers: { Authorization: `Bearer ${app.adminToken}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  for (const [page, name] of [[second, 'Second PC'], [third, 'Third PC']]) {
    await page.locator('#pc-address').fill(origin(firstApp) + '/#pin=' + firstApp.pin); await page.locator('#pc-device').fill(name); await page.locator('#pc-connect-submit').click(); await page.waitForFunction(() => !document.querySelector('#pc-connected').hidden && !document.querySelector('#files').disabled);
  }
  await owner.locator('#tab-devices').waitFor();
  assert.deepEqual(await owner.locator('[role=tab]:visible').allTextContents(), ['Подключение', 'Устройства', 'Передача']);
  async function choose(page, name) { await page.locator('#tab-devices').click(); await page.locator('.device-target').filter({ has: page.getByText(name, { exact: true }) }).locator('input').check(); await page.locator('#devices-transfer').click(); assert.equal(await page.locator('#recipient-name').textContent(), name); }
  async function sendDownload(from, to, name, bytes = randomBytes(88001)) {
    const event = to.waitForEvent('download'); await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes }); const download = await event; assert.equal(digest(await readFile(await download.path())), digest(bytes)); await from.waitForFunction(() => !document.querySelector('#files').disabled); return bytes;
  }
  await choose(owner, 'Second PC'); await sendDownload(owner, second, 'only-second.bin'); assert.equal(downloads.get(third).length, 0);
  await choose(owner, 'Third PC'); await sendDownload(owner, third, 'only-third.bin'); assert.equal(downloads.get(second).length, 1);
  const phone = await (await browser.newContext({ acceptDownloads: true, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })).newPage(); phone.on('pageerror', e => errors.push(e.message)); downloads.set(phone, []); phone.on('download', d => downloads.get(phone).push(d));
  await phone.goto(origin(secondApp) + '/#pin=' + secondApp.pin); await phone.waitForFunction(() => !document.querySelector('#files').disabled); assert.equal(new URL(phone.url()).hash, '');
  await second.locator('#tab-devices').waitFor();
  const targets = (await (await request(secondApp, '/api/send-targets')).json()).targets;
  const phoneTarget = targets.find(t => t.kind === 'client'), ownerTarget = targets.find(t => t.kind === 'peer');
  await choose(second, phoneTarget.name); await sendDownload(second, phone, 'only-phone.bin'); assert.equal(await owner.locator('#incoming .file-name').filter({ hasText: 'only-phone.bin' }).count(), 0);
  await choose(second, ownerTarget.name);
  const bytes = randomBytes(66001); await second.locator('#files').setInputFiles({ name: 'to-owner.bin', mimeType: 'application/octet-stream', buffer: bytes });
  const received = owner.locator('#incoming .file-row').filter({ hasText: 'to-owner.bin' }); await received.getByText('Получено и сохранено', { exact: true }).waitFor();
  const saved = (await readdir(firstApp.inbox)).find(name => name.endsWith('-to-owner.bin')); assert.equal(digest(await readFile(path.join(firstApp.inbox, saved))), digest(bytes));
  assert.equal(await received.locator('td').count(), 5); assert.ok(Date.parse(await received.locator('time').getAttribute('datetime')) > 0);
  const cells = await received.locator('td').evaluateAll(nodes => nodes.map(n => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y }))); assert.ok(cells.every(c => c.y === cells[0].y));
  await received.getByRole('button', { name: 'Открыть', exact: true }).click(); assert.equal(opened.at(-1), path.join(firstApp.inbox, saved));
  await received.getByRole('button', { name: 'Удалить из списка' }).click(); await owner.waitForTimeout(1800); assert.equal(await received.count(), 0); assert.equal(digest(await readFile(path.join(firstApp.inbox, saved))), digest(bytes));
  // The second PC keeps receiving from its phone while the upstream PC remains selected.
  const incomingPhone = Buffer.from('From phone while another recipient is selected.'); await phone.locator('#files').setInputFiles({ name: 'phone-to-second.txt', mimeType: 'text/plain', buffer: incomingPhone });
  await second.locator('#incoming .file-row').filter({ hasText: 'phone-to-second.txt' }).getByText('Получено и сохранено', { exact: true }).waitFor(); assert.equal(await second.locator('#recipient-name').textContent(), ownerTarget.name);
  const phoneSaved = (await readdir(secondApp.inbox)).find(name => name.endsWith('-phone-to-second.txt')); assert.equal(await readFile(path.join(secondApp.inbox, phoneSaved), 'utf8'), incomingPhone.toString());
  await owner.locator('#tab-connection').click(); assert.ok(await owner.locator('#transfer-statistics').isVisible()); await owner.locator('#tab-transfer').click(); assert.ok(await owner.locator('#transfer-statistics').isHidden());
  await choose(owner, 'Second PC');
  let release, started; const hold = new Promise(resolve => { release = resolve; }), intercepted = new Promise(resolve => { started = resolve; }); let once = true;
  const routeHandler = async route => { if (once && route.request().method() === 'POST') { once = false; started(); await hold; } try { await route.continue(); } catch (error) { if (!/already handled/i.test(error.message)) throw error; } };
  await owner.route('**/api/shares?*', routeHandler);
  await owner.locator('#files').setInputFiles([{ name: 'interrupted.bin', mimeType: 'application/octet-stream', buffer: randomBytes(10000) }, { name: 'never-third.bin', mimeType: 'application/octet-stream', buffer: randomBytes(10000) }]);
  await intercepted; await second.locator('#tab-connection').click(); await second.locator('#pc-disconnect').click(); release(); await owner.unroute('**/api/shares?*', routeHandler);
  await owner.waitForFunction(() => document.querySelector('#recipient-name').textContent === 'Устройство не выбрано'); assert.ok(await owner.locator('#tab-devices').isHidden()); assert.ok(await owner.locator('#files').isDisabled());
  assert.equal(await third.locator('.file-name').filter({ hasText: 'never-third.bin' }).count(), 0);
  await owner.locator('#select-remaining').click(); assert.equal(await owner.locator('#recipient-name').textContent(), 'Third PC');
  await sendDownload(owner, third, 'after-explicit-selection.bin');
  const sent = owner.locator('#queue .file-row').filter({ hasText: 'after-explicit-selection.bin' }); await sent.getByText('Передан получателю', { exact: true }).waitFor(); await sent.getByRole('button', { name: 'Удалить из списка' }).click(); await owner.waitForTimeout(1800); assert.equal(await sent.count(), 0, 'a hidden local send must not reappear as a share');
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) { await owner.setViewportSize(viewport); assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)); }
  await owner.screenshot({ path: 'artifacts/desktop-parity-mobile.png' }); await second.screenshot({ path: 'artifacts/desktop-parity-second.png' });
  const manual = await (await browser.newContext()).newPage(); await manual.addInitScript(() => localStorage.setItem('nearby.confirm-invitation', 'true')); await manual.goto(origin(firstApp) + '/#pin=' + firstApp.pin); await manual.locator('#join-form').waitFor(); assert.ok(await manual.locator('#transfer-workspace').isHidden()); await manual.locator('#join-form button').click(); await manual.waitForFunction(() => !document.querySelector('#files').disabled);
  assert.deepEqual(errors, []);
  const results = { threePCEngines: true, simultaneousUpstreamAndIncoming: true, selectedRecipientsIsolated: true, tableColumnsAndFileOpening: true, removePreservesFiles: true, noRedirectOnDisconnect: true, statisticsOnlyConnection: true, qrAutojoinAndOptionalConfirmation: true, errors };
  await writeFile('artifacts/desktop-parity-verification.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
} finally { await browser?.close(); await Promise.all(applications.map(app => app.close())); await rm(directory, { recursive: true, force: true }); }
