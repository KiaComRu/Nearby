import { chromium } from 'playwright';
import { createApp } from '../server.mjs';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-shell-ui-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let sender, receiver, browser; const errors = [];
const call = async (app, route, data, token = app.adminToken) => {
  const response = await fetch(`http://127.0.0.1:${app.port}` + route, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.ok(response.ok, `${route}: ${response.status}`); return response.json();
};
try {
  const settings = name => ({ host: '127.0.0.1', port: 0, storage: path.join(directory, name), statistics: false, trustedLan: false, discovery: false });
  sender = await createApp(settings('sender')); receiver = await createApp(settings('receiver'));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1180, height: 860 } }); page.on('pageerror', error => errors.push(error.message));
  await page.goto(sender.adminUrl);
  const source = path.join(directory, 'фото & документ.txt'), empty = path.join(directory, 'пустой.txt'), bytes = randomBytes(1024 * 1024 + 37);
  await writeFile(source, bytes); await writeFile(empty, '');
  const stage = async files => { await page.locator('#shell-files').setInputFiles(files); await page.evaluate(() => { document.dispatchEvent(new Event('nearby-shell-selection')); document.getElementById('shell-files').value = ''; }); await page.locator('#shell-send').waitFor(); };
  await stage([source, empty]); assert.equal(await page.locator('.shell-file').count(), 2);
  await page.getByText('Нет подключённых устройств', { exact: true }).waitFor({ state: 'attached' }); assert.ok(await page.locator('#shell-start').isDisabled());
  await page.locator('#shell-close').click(); assert.equal(await page.locator('#shell-send').isVisible(), false);
  const guestPages = [];
  for (const name of ['Телефон А', 'Телефон Б']) {
    const { token } = await call(sender, '/api/join', { pin: sender.pin, device: name }, '');
    const context = await browser.newContext(); await context.addInitScript(value => sessionStorage.setItem('nearby-token', value), token);
    const guest = await context.newPage(); guest.on('pageerror', error => errors.push(error.message)); await guest.goto(`http://127.0.0.1:${sender.port}/`); await guest.locator('#workspace').waitFor(); guestPages.push({ guest, token });
  }
  await page.locator('#shell-reopen').click(); await page.waitForFunction(() => document.querySelector('#shell-target').options.length === 3);
  const chosen = (await call(sender, '/api/send-targets')).targets.find(item => item.name === 'Телефон А');
  await page.locator('#shell-target').selectOption(chosen.id); await page.locator('#shell-start').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.shell-file small')].length === 2 && [...document.querySelectorAll('.shell-file small')].every(item => item.textContent.includes('ожидает скачивания')));
  const first = await call(sender, '/api/state', undefined, guestPages[0].token), second = await call(sender, '/api/state', undefined, guestPages[1].token);
  assert.equal(first.shares.length, 2); assert.equal(second.shares.length, 0);
  for (const item of first.shares) {
    const { url } = await call(sender, `/api/shares/${item.id}/ticket`, {}, guestPages[0].token);
    const downloaded = Buffer.from(await (await fetch(`http://127.0.0.1:${sender.port}` + url)).arrayBuffer());
    assert.equal(hash(downloaded), hash(item.size ? bytes : Buffer.alloc(0)));
  }
  await page.locator('#shell-send').screenshot({ path: 'artifacts/nearby-shell-target-picker.png' });
  await page.locator('#shell-clear').click();
  await call(sender, '/api/peer/connect', { address: `http://127.0.0.1:${receiver.port}`, pin: receiver.pin, device: 'ПК отправителя' });
  const receiverPage = await browser.newPage(); receiverPage.on('pageerror', error => errors.push(error.message)); await receiverPage.goto(receiver.adminUrl);
  await stage([source, empty]); await page.waitForFunction(() => document.querySelector('#shell-target').options.length === 4);
  const peer = (await call(sender, '/api/send-targets')).targets.find(item => item.kind === 'peer');
  await page.locator('#shell-target').selectOption(peer.id); await page.locator('#shell-start').click();
  await receiverPage.locator('#incoming').getByRole('button', { name: 'Принять', exact: true }).click();
  await receiverPage.locator('#incoming').getByRole('button', { name: 'Нет', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.shell-file small')].some(item => item.textContent.includes('отклонил')));
  const files = await readdir(receiver.inbox); assert.equal(files.length, 1); assert.equal(hash(await readFile(path.join(receiver.inbox, files[0]))), hash(bytes));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.querySelector('#shell-send').scrollWidth <= document.querySelector('#shell-send').clientWidth));
  await page.locator('#shell-send').screenshot({ path: 'artifacts/nearby-shell-target-picker-mobile.png' });
  await page.locator('#shell-clear').click(); await stage([empty]);
  await page.locator('#shell-start').click();
  await page.waitForFunction(() => document.querySelector('.shell-file small')?.textContent.includes('Ожидаем подтверждение'));
  await page.locator('#shell-cancel').click();
  await page.waitForFunction(() => document.querySelector('.shell-file small')?.textContent.includes('Отправка остановлена'));
  await call(sender, '/api/peer/disconnect', {});
  await call(sender, '/api/peer/connect', { address: `http://127.0.0.1:${receiver.port}`, pin: receiver.pin, device: 'ПК отправителя' });
  await page.waitForFunction(() => document.getElementById('shell-target').value === '' && document.getElementById('shell-start').disabled);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/Nearby-shell-ui-verification.json', JSON.stringify({ passed: true, retainedSelectionBeforeConnecting: true, simultaneousRecipients: 3, targetedPhoneShares: 2, unrelatedPhoneCannotSeeFiles: true, peerTransferSHA256: true, rejection: true, cancellation: true, reconnectDoesNotReplaceSelectedRecipient: true, widths: [1180,390], physicalDevices: false, checkedAt: new Date().toISOString() }, null, 2));
  console.log('Explorer-send UI passed: retained selection, recipient choice, private binary/empty shares, PC transfer SHA-256 and refusal.');
} finally { await browser?.close(); await Promise.all([sender?.close(), receiver?.close()]); await rm(directory, { recursive: true, force: true }); }
