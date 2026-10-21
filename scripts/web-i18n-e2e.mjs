import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const directory = await mkdtemp(path.join(tmpdir(), 'nearby-web-i18n-'));
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); });
const base = `http://127.0.0.1:${port}/`;
const php = process.env.PHP_PATH || 'php';
const server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, NEARBY_WEB_STATE_DIR: directory } });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errors = []; let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true });
  for (const [language, createText] of [['ru','Создать подключение'],['en','Create a connection'],['hi','कनेक्शन बनाएँ'],['zh-CN','创建连接'],['es','Crear conexión']]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '?lang=' + language);
    await page.getByRole('button', { name: createText }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), language);
    assert.equal(await page.locator('#web-language-choice').inputValue(), language);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (language !== 'ru') assert.ok(!/[А-Яа-яЁё]/.test(await page.locator('main').innerText()), language + ': untranslated initial UI');
    await page.close();
  }
  const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext({ acceptDownloads: true })]);
  for (const context of contexts) await context.addInitScript(() => { window.RTCPeerConnection = undefined; window.showSaveFilePicker = undefined; });
  await contexts[1].addInitScript(() => localStorage.setItem('nearby-site-language', 'es'));
  const host = await contexts[0].newPage(), guest = await contexts[1].newPage();
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  await host.goto(base + '?lang=en#mode=internet');
  await host.getByRole('button', { name: 'Create a connection' }).click();
  await host.locator('#share-link').waitFor();
  const invitation = await host.locator('#share-link').inputValue();
  await guest.goto(invitation);
  await host.getByRole('button', { name: 'This is my device — allow' }).click();
  for (const page of [host, guest]) await page.waitForFunction(() => !document.querySelector('#files').disabled, null, { timeout: 60000 });
  await host.locator('#web-language-choice').selectOption('hi');
  await host.waitForFunction(() => document.querySelector('#connection-title').textContent === 'डिवाइस जुड़ गए');
  assert.equal(await host.locator('#share-link').inputValue(), invitation, 'Language switching preserves the invitation and encryption key');
  const payload = randomBytes(64 * 1024 + 17);
  async function transfer(from, to, fileName, bytes, accept, save) {
    const event = to.waitForEvent('download');
    await from.locator('#files').setInputFiles({ name: fileName, mimeType: 'application/octet-stream', buffer: bytes });
    const card = to.locator('.transfer').filter({ has: to.getByText(fileName, { exact: true }) });
    const saving = card.getByRole('link', { name: save }); await saving.waitFor({ timeout: 30000 });
    assert.equal(await card.locator('.transfer-title').textContent(), fileName, 'User file names are not translated');
    const download = await event;
    assert.equal(download.suggestedFilename(), fileName);
    assert.equal(hash(await readFile(await download.path())), hash(bytes));
  }
  await transfer(host, guest, 'Принять-файл.bin', payload, 'Aceptar', 'Abrir');
  await guest.locator('#web-language-choice').selectOption('zh-CN');
  await guest.waitForFunction(() => document.querySelector('#connection-title').textContent === '设备已连接');
  await transfer(guest, host, 'empty-файл.txt', Buffer.alloc(0), 'स्वीकार करें', 'खोलें');
  assert.equal(await host.locator('#files').isDisabled(), false);
  await mkdir('artifacts', { recursive: true });
  await guest.setViewportSize({ width: 390, height: 844 });
  await guest.screenshot({ path: 'artifacts/nearby-web-chinese.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile('artifacts/nearby-web-i18n-verification.json', JSON.stringify({ passed: true, testedAt: new Date().toISOString(), languages: ['ru','en','hi','zh-CN','es'], switchDuringConnection: true, invitationUnchanged: true, originalFileNames: true, sha256BothWays: true, emptyFile: true, automaticReception: true, mobileWidth: 390, errors }, null, 2));
  console.log('Web localization passed: five languages, mobile layout, English/Spanish pairing, Hindi/Chinese switching during encrypted transfer, original filenames, SHA-256 both ways, empty file and automatic reception.');
} finally { await browser?.close(); server.kill(); await rm(directory, { recursive: true, force: true }); }
