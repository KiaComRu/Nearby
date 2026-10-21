import { chromium } from 'playwright';
import { createApp } from '../server.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-file-actions-native-'));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const stage = path.resolve('dist/windows-x64'), harness = path.join(stage, 'DesktopParityNativeHarness.exe');
let native, exited, browser, guestBrowser, remote;
try {
  execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/desktop-parity-native-build.ps1','-Output',harness], { windowsHide: true, stdio: 'pipe' });
  native = spawn(harness, [directory], { windowsHide: true, stdio: ['pipe','ignore','pipe'], env: { ...process.env, NEARBY_DATA_DIR: path.join(directory, 'data'), NEARBY_RECEIVE_DIR: path.join(directory, 'received'), NEARBY_DISABLE_STATISTICS:'1', NEARBY_DISABLE_DISCOVERY:'1', NEARBY_DISABLE_TRUSTED_LAN:'1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } }); exited = once(native, 'exit'); let stderr=''; native.stderr.on('data', d => { stderr += d; });
  for (let i=0;i<150;i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {} if (native.exitCode !== null) throw new Error(stderr); await new Promise(resolve=>setTimeout(resolve,200)); }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const browserCDP = await browser.newBrowserCDPSession(); await browserCDP.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  let page;
  for (let i=0;i<150;i++) { page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:')); if (page) break; await new Promise(resolve=>setTimeout(resolve,200)); }
  assert.ok(page); await page.evaluate(() => { window.testNativeMessages = []; window.chrome.webview.addEventListener('message', e => window.testNativeMessages.push(e.data)); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message)); await page.locator('#workspace').waitFor();
  const origin = new URL(page.url()).origin, key = await page.evaluate(()=>sessionStorage.getItem('nearby-token'));
  const api = async (url,data) => (await fetch(origin+url,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})).json();
  const state = await api('/api/state'); guestBrowser = await chromium.launch({headless:true}); const guest = await guestBrowser.newPage({acceptDownloads:true}); await guest.goto(origin+'/#pin='+state.pin); await guest.waitForFunction(()=>!document.querySelector('#files').disabled); await page.waitForFunction(()=>!document.querySelector('#files').disabled);
  const selected = path.join(directory,'Original & выбранный.txt'); await writeFile(selected,'Native original selection.'); const download = guest.waitForEvent('download'); const cdp = await page.context().newCDPSession(page); const doc = await cdp.send('DOM.getDocument'); const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#files' }); await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [selected] }); await download;
  const row = page.locator('#queue .file-row').filter({hasText:path.basename(selected)}); await row.getByRole('button',{name:'Открыть',exact:true}).waitFor();
  const recordId = await row.getAttribute('data-record'); assert.ok(await page.evaluate(id=>nativeFiles.has(id),recordId),'native shell must retain the selected original path'); await row.getByRole('button',{name:'Открыть',exact:true}).click();
  for (let i=0;i<50;i++) { try { if ((await readFile(path.join(directory,'opened.txt'),'utf8')).includes(selected)) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.equal((await readFile(path.join(directory,'opened.txt'),'utf8')).trim(), selected);
  await page.evaluate(()=>window.chrome.webview.postMessage({type:'nearby-open-file',id:'C:\\Windows\\not-a-selected-file.txt'})); await page.waitForTimeout(200); assert.equal((await readFile(path.join(directory,'opened.txt'),'utf8')).trim(),selected);
  remote = await createApp({host:'127.0.0.1',port:0,storage:path.join(directory,'remote'),statistics:false,trustedLan:false,discovery:false}); const remoteOrigin=`http://127.0.0.1:${remote.port}`;
  await page.locator('#tab-connection').click(); await page.locator('#pc-address').fill(remoteOrigin+'/#pin='+remote.pin); await page.locator('#pc-connect-submit').click(); await page.locator('#tab-devices').waitFor();
  const targets = await (await fetch(remoteOrigin+'/api/send-targets',{headers:{Authorization:`Bearer ${remote.adminToken}`}})).json();
  const body = Buffer.from('Received through real Windows WebView2.'); const sent = await fetch(remoteOrigin+`/api/shares?recipient=${targets.targets[0].id}&name=from-peer.txt&size=${body.length}`,{method:'POST',headers:{Authorization:`Bearer ${remote.adminToken}`},body}); const share=await sent.json(); assert.equal(sent.status,201);
  try { await page.waitForFunction(id=>nativeFiles.has(id),share.id); }
  catch (error) { const debug = await page.evaluate(() => ({ nativeIds: [...nativeFiles], records: [...records.values()].map(r => ({ key:r.key, id:r.serverId, status:r.status })), messages: window.testNativeMessages })); debug.savedFiles = await readdir(path.join(directory,'received')); await writeFile('artifacts/native-file-actions-debug.json',JSON.stringify(debug,null,2)); console.log(JSON.stringify(debug)); throw error; } await page.locator('#tab-transfer').click(); const received=page.locator('#shared .file-row').filter({hasText:'from-peer.txt'}); await received.getByRole('button',{name:'Открыть',exact:true}).click();
  let lines=[]; for(let i=0;i<50;i++){lines=(await readFile(path.join(directory,'opened.txt'),'utf8')).trim().split('\n');if(lines.length===2)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(lines.length,2); assert.ok(path.resolve(lines[1]).startsWith(path.join(directory,'received')+path.sep)); assert.equal(await readFile(lines[1],'utf8'),body.toString());
  await received.getByRole('button',{name:'Удалить из списка'}).click(); await page.waitForTimeout(1800); assert.equal(await received.count(),0); assert.equal(await readFile(lines[1],'utf8'),body.toString());
  assert.deepEqual(errors,[]); const result={passed:true,realWinFormsWebView2:true,selectedOriginalPath:true,automaticDownloadMappedToFile:true,opensSavedFile:true,unknownPathsRejected:true,historyRemovalPreservesFile:true,errors};await writeFile('artifacts/desktop-native-parity-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
  if(native?.stdin.writable)native.stdin.end('stop\n'); if(native&&native.exitCode===null){const timer=setTimeout(()=>native.kill(),10000);await exited;clearTimeout(timer);}
  await browser?.close().catch(()=>{}); await guestBrowser?.close(); await remote?.close();
  assert.equal(path.dirname(directory),path.resolve(tmpdir())); await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:250}); for(const name of [harness,harness+'.config'])await rm(name,{force:true});
}
