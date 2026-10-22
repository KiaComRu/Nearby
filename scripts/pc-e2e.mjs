import { chromium } from 'playwright';
import { mkdtemp, readdir, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import {selectDesktopLan} from './web-navigation.mjs';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-pc-ui-'));
const applications = []; let browser;
try {
  for (const name of ['first', 'second']) applications.push(await createApp({ host: '127.0.0.1', port: 0, storage: path.join(directory, name), statistics: false }));
  const [first, second] = applications;
  browser = await chromium.launch({ headless: true });
  const contexts = await Promise.all(applications.map(() => browser.newContext({ acceptDownloads: true })));
  const [owner, client] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  for (const page of [owner, client]) page.on('pageerror', error => errors.push(error.message));
  await Promise.all([owner.goto(first.adminUrl), client.goto(second.adminUrl)]);
  for (const page of [owner, client]) {
    await page.locator('#workspace').waitFor();
    assert.equal(await page.locator('#transfer-workspace').isVisible(), false, 'Transfers stay hidden before a connection');
    assert.equal(await page.locator('#connection-status').isVisible(), false);
    assert.equal(await page.locator('#connection-mode').inputValue(),'auto');
    assert.ok(await page.locator('#internet-option').isVisible());
    await selectDesktopLan(page);
  }
  await client.locator('#tab-connection').click();
  await client.locator('#pc-connect-form').waitFor();
  await client.locator('#pc-address').fill(`http://127.0.0.1:${first.port}/#pin=${first.pin}`);
  assert.equal(await client.locator('#pc-pin').inputValue(), first.pin);
  await client.locator('#pc-device').fill('Второй Windows-ПК');
  await client.locator('#pc-connect-submit').click();
  await client.waitForFunction(() => !document.querySelector('#pc-connected').hidden);
  await owner.locator('#transfer-workspace').waitFor();
  await client.locator('#transfer-workspace').waitFor();
  assert.match(await owner.locator('#connection-status').textContent(), /Второй Windows-ПК/);
  assert.equal(new URL(client.url()).port, String(second.port), 'In-app navigation stays on its own engine');
  await client.reload();
  await client.waitForFunction(() => !document.querySelector('#pc-connected').hidden);
  await selectDesktopLan(client);
  const bytes = randomBytes(1024 * 1024 + 17);
  const digest = data => createHash('sha256').update(data).digest('hex');
  for (const [name, data] of [['ПК-на-ПК.bin', bytes], ['empty.txt', Buffer.alloc(0)]]) {
    await client.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: data });
    const incoming = owner.locator('#incoming .file-row').filter({ hasText: name });
    await client.locator('#queue .file-row').filter({ hasText: name }).getByText('Получено и сохранено на компьютере', { exact: true }).waitFor({ state: 'attached' });
    const saved = (await readdir(first.inbox)).find(file => file.endsWith('-' + name));
    assert.equal(digest(await readFile(path.join(first.inbox, saved))), digest(data));
    const downloading = client.waitForEvent('download');
    await owner.locator('#files').setInputFiles({ name: 'back-' + name, mimeType: 'application/octet-stream', buffer: data });
    const remoteFile = client.locator('#shared .file-row').filter({ hasText: 'back-' + name });
    await remoteFile.getByRole('button', { name: 'Открыть', exact: true }).waitFor();

    const download = await downloading;
    assert.equal(digest(await readFile(await download.path())), digest(data));
    assert.equal(download.suggestedFilename(), 'back-' + name);
  }
  await mkdir('artifacts', { recursive: true });
  await owner.screenshot({ path: 'artifacts/nearby-pc-owner.png', fullPage: true });
  await client.screenshot({ path: 'artifacts/nearby-pc-client.png', fullPage: true });
  await client.locator('#tab-connection').click(); await client.locator('#pc-disconnect').click();
  await client.locator('#connection').waitFor();
  await owner.waitForFunction(() => document.querySelector('#files').disabled);
  assert.equal(await client.locator('#files').isDisabled(), true);
  await client.locator('#tab-connection').click();
  await client.locator('#pc-address').fill(`http://127.0.0.1:${first.port}/#pin=${first.pin}`);
  await client.locator('#pc-connect-submit').click();
  await client.waitForFunction(() => !document.querySelector('#pc-connected').hidden);
  // Losing the remote engine must leave local administrator access and disconnect intact.
  await first.close(); applications.shift();
  await client.getByText('Нет связи с другим ПК.', { exact: false }).waitFor({ timeout: 20000 });
  assert.equal(await client.locator('#files').isDisabled(), true, 'Unavailable peer disables sending and retains file history');
  await client.locator('#tab-connection').click(); await client.locator('#pc-disconnect').click();
  await client.locator('#connection').waitFor();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`http://127.0.0.1:${second.port}/#pin=${second.pin}`);
  await mobile.locator('#transfer-workspace').waitFor();
  await client.locator('#tab-transfer').click();
  if (await client.locator('#select-remaining').isVisible()) await client.locator('#select-remaining').click();
  await client.locator('#transfer-workspace').waitFor();
  assert.equal(await mobile.locator('#pc-connect').isVisible(), false);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PC UI passed: separate owner sessions, address/PIN, reload, 1 MiB + empty files both ways with SHA-256, automatic receiving, disconnect/reconnect, remote shutdown and existing phone mode.');
} finally {
  await browser?.close();
  await Promise.all(applications.map(app => app.close()));
  await rm(directory, { recursive: true, force: true });
}
