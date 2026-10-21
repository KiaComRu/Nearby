import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createApp } from '../server.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'nearby-compact-'));
const browser = await chromium.launch({ headless: true });
const errors = [], checks = [];
let first, second, php;
const hash = value => createHash('sha256').update(value).digest('hex');
const mode = process.env.NEARBY_TEST_MODE || 'internet';
const folderMode = process.env.NEARBY_TEST_FOLDER === '1';
const joinById = process.env.NEARBY_TEST_JOIN_BY_ID === '1';
async function fit(page, label) {
  await page.evaluate(() => document.activeElement?.blur());
  const result = await page.evaluate(() => {
    const stats = document.querySelector('#transfer-statistics').getBoundingClientRect();
    const active = document.querySelector('[role=tabpanel]:not([hidden])').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, statsTop: stats.top, statsBottom: stats.bottom, statsExpected: document.body.dataset.activePane === 'connection', paneHeight: active.height, tab: document.querySelector('[role=tab][aria-selected=true]').dataset.pane };
  });
  assert.ok(result.docWidth <= result.width + 1, label + ': horizontal overflow');
  assert.ok(result.docHeight <= result.height + 1, label + ': page scroll');
  if (result.statsExpected) assert.ok(result.statsBottom <= result.height + 1 && result.statsTop > 0, label + ': stats offscreen');
  else assert.equal(result.statsBottom, 0, label + ': stats must be hidden on the web transfer tab');
  assert.ok(result.paneHeight > 100, label + ': workspace collapsed');
  checks.push({ label, ...result });
}
async function page(context, url) {
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); return page;
}
try {
  await mkdir('artifacts', { recursive: true });
  first = await createApp({ host: '127.0.0.1', port: 0, storage: path.join(directory, 'first'), statistics: false, trustedLan: false, discovery: false });
  second = await createApp({ host: '127.0.0.1', port: 0, storage: path.join(directory, 'second'), statistics: false, trustedLan: false, discovery: false });
  const owner = await page(await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true }), first.adminUrl);
  const client = await page(await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true }), second.adminUrl);
  await owner.locator('#workspace').waitFor(); await client.locator('#workspace').waitFor();
  assert.equal(await owner.locator('#tab-transfer').isDisabled(), true);
  for (const viewport of [{ width: 1366, height: 768 }, { width: 760, height: 560 }, { width: 390, height: 844 }]) {
    await owner.setViewportSize(viewport); await fit(owner, 'desktop connection');
    const cards = await owner.locator('#pc-connect,#connection').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
    assert.equal(cards[0].y, cards[1].y, 'Connect and invite must be side by side'); assert.ok(cards[1].x > cards[0].x);
  }
  await owner.setViewportSize({ width: 1366, height: 768 });
  await owner.screenshot({ path: 'artifacts/compact-desktop-connection.png' });
  await owner.locator('#connection-settings').evaluate(el => el.open = true);
  await owner.locator('#connection-mode').selectOption('internet'); await fit(owner, 'desktop internet');
  assert.ok(await owner.locator('#internet-option').isVisible()); assert.ok(!await owner.locator('#desktop-lan').isVisible());
  await owner.locator('#connection-mode').selectOption('lan'); await owner.locator('#connection-settings').evaluate(el => el.open = false);
  await client.locator('#pc-address').fill(`http://127.0.0.1:${first.port}/#pin=${first.pin}`);
  await client.locator('#pc-connect-submit').click();
  await owner.locator('#tab-transfer[aria-selected=true]').waitFor(); await client.locator('#tab-transfer[aria-selected=true]').waitFor();
  for (const [name, data] of [['auto.bin', randomBytes(1024 * 1024 + 17)], ['auto-empty.txt', Buffer.alloc(0)]]) {
    await owner.locator('#tab-connection').click();
    await client.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: data });
    await client.locator('#queue .file-row').filter({ hasText: name }).getByText('Получено и сохранено на компьютере', { exact: true }).waitFor();
    await owner.locator('#tab-transfer[aria-selected=true]').waitFor();
    assert.equal(await owner.getByRole('button', { name: 'Принять', exact: true }).count(), 0);
    const saved = (await readdir(first.inbox)).find(file => file.endsWith('-' + name));
    assert.equal(hash(await readFile(path.join(first.inbox, saved))), hash(data));
    const downloading = client.waitForEvent('download');
    await owner.locator('#files').setInputFiles({ name: 'back-' + name, mimeType: 'application/octet-stream', buffer: data });
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'back-' + name); assert.equal(hash(await readFile(await download.path())), hash(data));
  }
  await fit(owner, 'desktop receiving'); await owner.screenshot({ path: 'artifacts/compact-desktop-transfer.png' });
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  php = spawn(process.env.PHP_PATH || 'php', ['-S', `127.0.0.1:${port}`, '-t', 'browser'], { env: { ...process.env, NEARBY_WEB_STATE_DIR: path.join(directory, 'web') }, stdio: 'ignore', windowsHide: true });
  const base = `http://127.0.0.1:${port}/`;
  for (let i=0;i<60;i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
  const desktopContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true });
  const webRequests = [];
  for (const context of [desktopContext, mobileContext]) {
    await context.addInitScript(() => { window.showDirectoryPicker = undefined; localStorage.setItem('nearby-site-language', 'ru'); });
    context.on('request', request => { if (request.method() === 'POST') webRequests.push(request.postData() || ''); });
  }
  if (folderMode) await desktopContext.addInitScript(() => { window.showDirectoryPicker = async () => navigator.storage.getDirectory(); });
  const host = await page(desktopContext, base + '#mode=' + mode), guest = await page(mobileContext, base);
  for (const language of ['ru','en','hi','zh-CN','es']) {
    await host.goto(base + '?lang=' + language + '#mode=' + mode); await host.waitForFunction(locale => document.documentElement.lang === locale, language);
    await fit(host, 'web connection ' + language);
    const main = await host.locator('main').textContent(); if(language!=='ru') assert.ok(!/[А-Яа-яЁё]/.test(main), language+': untranslated UI');
  }
  await host.goto(base + '?lang=ru#mode=' + mode);
  if (folderMode) await host.locator('[data-choose-folder]').first().click();
  await fit(guest, 'mobile connection'); await guest.screenshot({ path: 'artifacts/compact-web-mobile-connection.png' });
  const inviteCardBefore = await host.locator('#invite-card').boundingBox();
  await host.locator('#create').click(); await host.locator('#share-link').waitFor();
  assert.ok(await host.locator('#invite-card #session #invitation').isVisible(), 'Invitation must appear inside the original Invite card');
  assert.ok(await host.locator('#connect-card').isVisible(), 'Connect card must remain alongside Invite');
  assert.equal(await host.locator('#create').isVisible(), false);
  assert.equal(await host.locator('#join-form button').isDisabled(), true, 'An active invitation cannot be replaced by another connection');
  const inviteCardAfter = await host.locator('#invite-card').boundingBox();
  assert.equal(inviteCardAfter.x, inviteCardBefore.x);
  assert.equal(inviteCardAfter.y, (await host.locator('#connect-card').boundingBox()).y, 'Invite and connect cards remain aligned below the connection summary');
  assert.equal(inviteCardAfter.width, inviteCardBefore.width);
  const connectionId = await host.locator('#connection-id').textContent();
  assert.match(connectionId.replaceAll('-', ''), /^\d{9}$/);
  assert.ok(await host.locator('#invitation-id').isVisible());
  for (const language of ['en','hi','zh-CN','es','ru']) {
    await host.locator('#web-language-choice').selectOption(language);
    assert.equal(await host.locator('#connection-id').textContent(), connectionId, 'Changing language must preserve the ID');
    if (language !== 'ru') assert.ok(!/[А-Яа-яЁё]/.test(await host.locator('main').textContent()), language + ': invitation UI untranslated');
  }
  await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedIdForTest = text; } } }));
  await host.locator('#copy-id').click(); assert.equal(await host.evaluate(() => window.copiedIdForTest), connectionId);
  await host.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard blocked'); }; });
  await host.locator('#copy-id').click(); await host.locator('#notice').filter({hasText:'Скопируйте выделенный ID.'}).waitFor();
  assert.equal(await host.evaluate(() => getSelection().toString()), connectionId);
  await host.evaluate(() => { getSelection().removeAllRanges(); document.querySelector('#notice').hidden = true; });
  for (const viewport of [{width:1366,height:768},{width:760,height:560},{width:390,height:844}]) {
    await host.setViewportSize(viewport); await fit(host, 'inline invitation');
    await host.locator('#invite-card').evaluate(card => { card.scrollTop = 0; });
    assert.ok(await host.locator('#invite-card').evaluate(card => card.scrollWidth <= card.clientWidth), 'Invitation must fit the card width');
    await host.screenshot({path:`artifacts/inline-invitation-${viewport.width}.png`});
    if (viewport.width === 1366) {
      await host.locator('#disconnect').scrollIntoViewIfNeeded();
      const layout = await host.locator('#invite-card').evaluate(card => ({ bottom: card.getBoundingClientRect().bottom, end: document.querySelector('#disconnect').getBoundingClientRect().bottom, height: card.clientHeight, content: card.scrollHeight }));
      assert.ok(layout.end <= layout.bottom, 'Desktop invitation controls must remain reachable in the scrollable card: '+JSON.stringify(layout));
    }
  }
  await host.setViewportSize({width:1366,height:768});
  const invite = await host.locator('#share-link').inputValue();
  if (joinById) {
    await guest.locator('#invite-input').fill('wrong-id'); await guest.locator('#join-form button').click();
    await guest.locator('#notice').filter({hasText:'Проверьте ID'}).waitFor();
    assert.equal(await guest.locator('#join-form button').isDisabled(),false);
    await guest.locator('#invite-input').fill(connectionId.toLowerCase().replaceAll('-', ' '));
    await guest.locator('#join-form button').click();
  } else {
    await guest.goto(invite);
    await guest.waitForTimeout(300);
    assert.deepEqual(errors, [], 'UI scripts must start without errors');
    await guest.locator('#connect-card #session').waitFor();
    assert.ok(await guest.locator('#join-invite').isHidden(), 'Invitation joins automatically');
  }
  await guest.locator('#connect-card #session').waitFor();
  await host.locator('#approve').click();
  assert.equal(await host.locator('#invitation-id').isVisible(), false, 'A used ID must disappear');
  for (const target of [host,guest]) await target.locator('#tab-transfer[aria-selected=true]').waitFor({ timeout:60000 });
  for (const [from,to,name,data] of [[host,guest,'web-auto.bin',randomBytes(512*1024+7)],[guest,host,'web-back.bin',randomBytes(256*1024+11)],[host,guest,'web-empty.txt',Buffer.alloc(0)]]) {
    const disk = folderMode && to === host;
    const downloading = disk ? null : to.waitForEvent('download');
    await from.locator('#files').setInputFiles({ name, mimeType:'application/octet-stream',buffer:data });
    const card = to.locator('.transfer').filter({ has: to.getByText(name,{exact:true}) });
    if (disk) {
      await card.getByText('Сохранён в выбранную папку.', {exact:true}).waitFor();
      const saved = await to.evaluate(async name => { const dir = await navigator.storage.getDirectory(); for await (const [filename, handle] of dir.entries()) if(filename.endsWith('-'+name)){const file=await handle.getFile();return [...new Uint8Array(await file.arrayBuffer())];} }, name);
      assert.equal(hash(Buffer.from(saved)), hash(data));
    } else {
      const download = await downloading; assert.equal(hash(await readFile(await download.path())),hash(data));
    }
    assert.equal(await card.getByRole('button',{name:'Принять',exact:true}).count(),0);
    if (!disk) await card.getByRole('button',{name:'Удалить из списка'}).click();
    await from.waitForFunction(()=>!document.querySelector('#files').disabled);
  }
  await fit(host,'web connected'); await fit(guest,'mobile connected');
  await guest.locator('#tab-connection').click();
  for (const language of ['ru','en','hi','zh-CN','es']) {
    await guest.locator('#web-language-choice').selectOption(language);
    await guest.waitForFunction(language => document.documentElement.lang === language, language);
    await fit(guest, 'mobile receiving ' + language);
    assert.ok(await guest.locator('#transfer-statistics .statistics-values strong,#transfer-statistics .statistics-values button,#transfer-statistics .statistics-values span').evaluateAll(nodes => {
      const outer = document.querySelector('#transfer-statistics').getBoundingClientRect();
      return nodes.every(node => { const r=node.getBoundingClientRect();return r.bottom<=outer.bottom-12 && r.left>=outer.left && r.right<=outer.right; });
    }), language + ': statistics labels must fit inside the card');
  }
  await guest.locator('#web-language-choice').selectOption('ru');
  await guest.locator('#tab-transfer').click();
  await host.screenshot({path:'artifacts/compact-web-desktop-transfer.png'}); await guest.screenshot({path:'artifacts/compact-web-mobile-transfer.png'});
  await host.locator('#tab-connection').click(); assert.ok(await host.locator('#disconnect').isVisible());
  await host.locator('#disconnect').click(); await guest.locator('#tab-connection').click(); await guest.locator('#disconnect').filter({hasText:'Новое подключение'}).waitFor();
  assert.deepEqual(errors,[]);
  const secret = new URLSearchParams(new URL(invite).hash.slice(1)).get('secret');
  assert.ok(!webRequests.join('\n').includes(connectionId.replaceAll('-', '')), 'Raw ID must stay on the devices');
  if (secret) assert.ok(!webRequests.join('\n').includes(secret), 'Encryption key must stay on the devices');
  await writeFile(`artifacts/compact-ui-${mode}${folderMode ? '-folder' : ''}${joinById ? '-id' : ''}-verification.json`,JSON.stringify({passed:true,testedAt:new Date().toISOString(),automaticReceiving:true,localBothDirections:true,webTransport:mode,joinById,folderStreaming:folderMode,emptyFiles:true,sha256:true,checks,errors},null,2));
  console.log('Compact UI passed: local and encrypted internet transfers automatically received in both directions; SHA-256, empty files, tabs, five languages, desktop/mobile layouts and statistics visibility.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) console.log(await page.evaluate(() => ({ notice: document.querySelector('#notice')?.textContent, state: document.querySelector('#connection-title')?.textContent, detail: document.querySelector('#connection-detail')?.textContent })));
  console.log({ errors }); throw error;
} finally {
  await browser.close(); await first?.close(); await second?.close(); if(php){php.kill();await new Promise(resolve=>php.once('exit',resolve));} await rm(directory,{recursive:true,force:true});
}
