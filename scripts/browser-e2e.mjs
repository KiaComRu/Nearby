import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
const target = process.env.NEARBY_WEB_URL || 'http://127.0.0.1:8088/';
for (let i = 0; i < 50; i++) {
  try { const response = await fetch(target); if (response.ok) break; } catch {}
  if (i === 49) throw new Error('Browser preview server did not become ready.');
  await new Promise(resolve => setTimeout(resolve, 100));
}
const browser = await chromium.launch({ headless: true });
const errors = [];
const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } })]);
const pages = await Promise.all(contexts.map(c => c.newPage()));
for (const page of pages) {
  page.on('pageerror', e => errors.push(e.message));
  // Exercise the portable download path. Disk streaming is covered separately.
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
}
const [host, guest] = pages;
async function transfer(from, to, name, bytes) {
  await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  const card = to.locator('.transfer').filter({ has: to.getByText(name, { exact: true }) }).first();
  await card.getByRole('button', { name: 'Принять', exact: true }).click();
  await card.getByText('Файл принят. Нажмите «Сохранить файл».', { exact: true }).waitFor({ timeout: 60000 });
  const downloadEvent = to.waitForEvent('download');
  await card.getByRole('link', { name: 'Сохранить файл' }).click();
  const download = await downloadEvent;
  const downloaded = await readFile(await download.path());
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  assert.equal(download.suggestedFilename(), name);
  console.log(`Verified ${name}: ${bytes.length} bytes, SHA-256 match`);
  await card.getByRole('button', { name: 'Убрать из памяти' }).click();
}
try {
  await host.goto(target);
  await host.waitForFunction(() => document.querySelector('#device-name').value.includes(' · '));
  const generatedName = await host.locator('#device-name').inputValue();
  await host.reload();
  await host.waitForFunction(name => document.querySelector('#device-name').value === name, generatedName);
  await host.locator('#device-name').fill('Тестовый Windows');
  await host.reload();
  await host.waitForFunction(() => document.querySelector('#device-name').value === 'Тестовый Windows');
  await host.locator('#create').click();
  await host.locator('#share-link').waitFor(); const invitation = await host.locator('#share-link').inputValue(); assert.ok(invitation.includes('#room='));
  await guest.goto(invitation); await guest.locator('#device-name').fill('Тестовый телефон'); await guest.locator('#join-invite').click();
  await host.locator('#approve').waitFor();
  assert.equal(await host.locator('#peer-name').textContent(), 'Тестовый телефон');
  assert.ok((await guest.locator('#connection-detail').textContent()).includes('Тестовый Windows'));
  assert.equal(await host.locator('#files').isDisabled(), true); await host.locator('#approve').click();
  await Promise.all(pages.map(p => p.waitForFunction(() => document.querySelector('#files').disabled === false, null, { timeout: 60000 })));
  await transfer(host, guest, 'binary-to-phone.bin', randomBytes(1024 * 1024 + 31));
  await transfer(guest, host, 'файл-на-компьютер.bin', randomBytes(65536 + 3));
  await transfer(host, guest, 'empty.txt', Buffer.alloc(0));
  await host.locator('#files').setInputFiles({ name: 'declined.txt', mimeType: 'text/plain', buffer: Buffer.from('decline me') });
  await guest.locator('.transfer').filter({ hasText: 'declined.txt' }).getByRole('button', { name: 'Отклонить' }).click();
  await host.getByText('Передача отклонена или отменена другим устройством.', { exact: true }).first().waitFor();
  assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile has no horizontal overflow');
  await mkdir('artifacts', { recursive: true });
  await host.screenshot({ path: 'artifacts/nearby-web-desktop.png', fullPage: true }); await guest.screenshot({ path: 'artifacts/nearby-web-mobile.png', fullPage: true });
  await guest.locator('#disconnect').click(); await host.getByText('Соединение с другим устройством закрыто.', { exact: false }).first().waitFor();
  // Real browser FileSystemWritableFileStream; substitute only the OS picker.
  const diskContext = await browser.newContext();
  await diskContext.addInitScript(() => { window.showSaveFilePicker = async () => { const directory = await navigator.storage.getDirectory(); return directory.getFileHandle('stream-test.bin', { create: true }); }; });
  const diskPage = await diskContext.newPage(); diskPage.on('pageerror', e => errors.push(e.message));
  await Promise.all([host.waitForEvent('load'), host.locator('#disconnect').click()]);
  await host.locator('#create').click(); await host.locator('#share-link').waitFor();
  await diskPage.goto(await host.locator('#share-link').inputValue()); await diskPage.locator('#join-invite').click(); await host.locator('#approve').click();
  await diskPage.waitForFunction(() => document.querySelector('#files').disabled === false);
  await host.waitForFunction(() => document.querySelector('#files').disabled === false);
  const diskBytes = randomBytes(2 * 1024 * 1024 + 5);
  await host.locator('#files').setInputFiles({ name: 'stream-test.bin', mimeType: 'application/octet-stream', buffer: diskBytes });
  await diskPage.getByRole('button', { name: 'Принять', exact: true }).click();
  await diskPage.getByText('Сохранён в выбранный файл.', { exact: true }).waitFor({ timeout: 60000 });
  const diskHash = await diskPage.evaluate(async () => { const directory = await navigator.storage.getDirectory(); const handle = await directory.getFileHandle('stream-test.bin'); const file = await handle.getFile(); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join(''); });
  assert.equal(diskHash, createHash('sha256').update(diskBytes).digest('hex')); console.log('Verified browser disk stream: 2 MiB, SHA-256 match');
  await diskPage.locator('#disconnect').click();
  assert.deepEqual(errors, []); console.log('Browser E2E passed: pairing, both directions, binary hash, empty file, refusal, disconnect, mobile layout.');
} catch (error) {
  console.error('Browser errors:', errors);
  for (const [index, page] of pages.entries()) console.error('Page', index, await page.evaluate(() => ({ notice: document.querySelector('#notice').textContent, title: document.querySelector('#connection-title').textContent, startHidden: document.querySelector('#start').hidden, invitationHidden: document.querySelector('#invitation').hidden, createDisabled: document.querySelector('#create').disabled })));
  throw error;
} finally { await browser.close(); }
