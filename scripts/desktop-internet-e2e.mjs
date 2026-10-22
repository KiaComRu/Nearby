import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../server.mjs';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn,execFileSync } from 'node:child_process';
import {once} from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
const directory=await mkdtemp(path.join(tmpdir(),'nearby-pc-internet-'));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const relay=`http://127.0.0.1:${port}/`,apps=[],errors=[],posts=[];
const php=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${port}`,'-t','browser'],{env:{...process.env,NEARBY_WEB_STATE_DIR:path.join(directory,'relay')},stdio:'ignore',windowsHide:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let browser,nativeBrowser,native,nativeExited,harness,nativePage;
try {
  for(let i=0;i<60;i++){try{await fetch(relay);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  for(let i=0;i<2;i++)apps.push(await createApp({host:'127.0.0.1',port:0,storage:path.join(directory,String(i)),statistics:false,discovery:false,trustedLan:false,internetEndpoint:relay+'api.php'}));
  if(process.argv.includes('--native')){
    harness=path.resolve('dist/windows-x64/DesktopParityNativeHarness.exe');
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/desktop-parity-native-build.ps1','-Output',harness],{windowsHide:true,stdio:'pipe'});
    const debugPort=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
    native=spawn(harness,[directory],{windowsHide:true,stdio:['pipe','ignore','pipe'],env:{...process.env,NEARBY_DATA_DIR:path.join(directory,'native-data'),NEARBY_RECEIVE_DIR:path.join(directory,'native-received'),NEARBY_DISABLE_STATISTICS:'1',NEARBY_DISABLE_DISCOVERY:'1',NEARBY_DISABLE_TRUSTED_LAN:'1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`}});nativeExited=once(native,'exit');
    for(let i=0;i<150;i++){try{if((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
    nativeBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    for(let i=0;i<100;i++){nativePage=nativeBrowser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:'));if(nativePage)break;await new Promise(r=>setTimeout(r,200));}
    await nativePage.locator('#workspace').waitFor();
    const gateway=apps[0],gatewayOrigin=new URL(gateway.adminUrl).origin;
    await nativePage.route('**/api/internet',async route=>{const response=await route.fetch({url:gatewayOrigin+'/api/internet',headers:{'Content-Type':'application/json',Authorization:`Bearer ${gateway.adminToken}`}});await route.fulfill({response});});
    const key=await nativePage.evaluate(()=>sessionStorage.getItem('nearby-token'));
    apps[0]={...gateway,adminUrl:nativePage.url(),adminToken:key,inbox:path.join(directory,'native-received')};
  }
  browser=await chromium.launch({headless:true});
  const pages=[];
  for(const app of apps){
    if(app===apps[0]&&nativePage){nativePage.on('pageerror',e=>errors.push(e.message));pages.push(nativePage);continue;}
    const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:900}}),origin=new URL(app.adminUrl).origin;
    await context.addInitScript(()=>{window.RTCPeerConnection=undefined;});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    context.on('request',r=>{if(r.url().endsWith('/api/internet'))posts.push(r.postData());});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(app.adminUrl);await page.locator('#workspace').waitFor();pages.push(page);
  }
  const [a,b]=pages;
  async function internet(page,name){await page.locator('#tab-connection').click();await page.locator('#connection-settings').evaluate(el=>el.open=true);await page.locator('#connection-mode').selectOption('internet');await page.locator('#internet-name').fill(name);}
  await internet(a,'Internet PC A');await internet(b,'Internet PC B');
  await a.locator('#internet-create').click();await a.locator('#internet-invitation').waitFor();
  const code=await a.locator('#internet-code').textContent();assert.match(code,/^\d{3}-\d{3}-\d{3}$/);
  await b.locator('#internet-id').fill(code);await b.locator('#internet-join').click();await a.locator('#internet-approval').waitFor();
  assert.ok(await a.locator('#files').isDisabled());await a.locator('#internet-approve').click();
  for(const page of pages)await page.waitForFunction(()=>!document.querySelector('#files').disabled,null,{timeout:60000});
  let files=0,bytes=0;
  async function transfer(from,to,index,name,data){
    await from.locator('#tab-transfer').click();await from.locator('#files').setInputFiles({name,mimeType:'application/octet-stream',buffer:data});
    const row=to.locator('#incoming .file-row').filter({hasText:name});await row.getByText('Получено и сохранено',{exact:true}).waitFor({state:'attached',timeout:60000});
    const saved=(await readdir(apps[index].inbox)).find(n=>n.endsWith('-'+name));assert.equal(digest(await readFile(path.join(apps[index].inbox,saved))),digest(data));
    assert.equal(await row.locator('td').count(),4);await from.waitForFunction(()=>!document.querySelector('#files').disabled);files++;bytes+=data.length;
    console.log(`PC internet: ${name}, ${data.length} bytes, SHA-256 verified`);
  }
  await transfer(a,b,1,'private-to-b.bin',randomBytes(1024*1024+17));
  await transfer(b,a,0,'private-to-a.bin',randomBytes(66001));
  if(nativePage){let opened;const handler=async route=>{opened=route.request().postDataJSON();await route.fulfill({json:{ok:true}});};await a.route('**/api/files/open',handler);const row=a.locator('#incoming .file-row').filter({hasText:'private-to-a.bin'});await row.getByRole('button',{name:'Открыть',exact:true}).click();await a.waitForTimeout(300);assert.equal(opened.kind,'offer');assert.match(opened.id,/^[a-f0-9-]{36}$/);await a.unroute('**/api/files/open',handler);}
  await transfer(a,b,1,'private-empty.txt',Buffer.alloc(0));
  // The phone sees only the public website. It cannot reach either PC's LAN engine.
  const context=await browser.newContext({acceptDownloads:true,isMobile:true,hasTouch:true,viewport:{width:390,height:844}});
  await context.addInitScript(()=>{window.RTCPeerConnection=undefined;window.showSaveFilePicker=undefined;localStorage.setItem('nearby-site-language','ru');});
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='https://nearby.kiacom.ru')return route.abort();url.protocol='http:';url.host=`127.0.0.1:${port}`;url.pathname=url.pathname.replace(/^\/web\//,'/');const response=await route.fetch({url:url.href,headers:{...route.request().headers(),origin:new URL(relay).origin}});await route.fulfill({response});});
  const phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
  await internet(a,'Internet PC A');await a.locator('#internet-create').click();await a.locator('#internet-invitation').waitFor();const invite=await a.locator('#internet-link').inputValue();
  await phone.goto(invite);try{await a.locator('#internet-approve').waitFor();}catch(error){console.log('PHONE DEBUG',await phone.locator('body').innerText(),errors);throw error;}await a.locator('#internet-approve').click();await phone.waitForFunction(()=>!document.querySelector('#files').disabled,null,{timeout:60000});
  await a.locator('#tab-devices').waitFor();assert.equal(await a.locator('.device-target').count(),2);
  // The original PC remains selected when another device connects.
  assert.equal(await a.locator('#recipient-name').textContent(),'Internet PC B');
  await phone.locator('#files').setInputFiles({name:'private-from-phone.txt',mimeType:'text/plain',buffer:Buffer.from('phone via encrypted relay')});
  await a.locator('#incoming .file-row').filter({hasText:'private-from-phone.txt'}).getByText('Получено и сохранено',{exact:true}).waitFor({state:'attached',timeout:60000});files++;bytes+=Buffer.byteLength('phone via encrypted relay');
  const phoneTarget=await a.locator('.device-target').filter({hasNotText:'Internet PC B'}).locator('input').inputValue();
  await a.locator('#tab-devices').click();await a.locator(`.device-target input[value="${phoneTarget}"]`).check();await a.locator('#devices-transfer').click();
  const download=phone.waitForEvent('download');await a.locator('#files').setInputFiles({name:'private-to-phone.txt',mimeType:'text/plain',buffer:Buffer.from('PC to phone')});assert.equal(await readFile(await (await download).path(),'utf8'),'PC to phone');await a.waitForFunction(()=>!document.querySelector('#files').disabled);files++;bytes+=11;
  // Explorer uses the same encrypted session and selected recipient.
  if(nativePage){const selected=path.join(directory,'private-explorer.txt');await writeFile(selected,'Explorer works');const cdp=await a.context().newCDPSession(a),doc=await cdp.send('DOM.getDocument'),node=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#shell-files'});await cdp.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[selected]});}
  else await a.locator('#shell-files').setInputFiles({name:'private-explorer.txt',mimeType:'text/plain',buffer:Buffer.from('Explorer works')});
  await a.evaluate(()=>document.dispatchEvent(new Event('nearby-shell-selection')));await a.locator('#shell-send').waitFor();
  await a.locator('#shell-target').selectOption({label:'Internet PC B · интернет'});await a.locator('#shell-start').click();await b.locator('#incoming .file-row').filter({hasText:'private-explorer.txt'}).getByText('Получено и сохранено',{exact:true}).waitFor({state:'attached',timeout:60000});await a.locator('#shell-start').waitFor({state:'visible'});files++;bytes+=14;
  await a.locator('#shell-close').click();
  if(nativePage){const row=a.locator('#queue .file-row').filter({hasText:'private-explorer.txt'});await row.getByRole('button',{name:'Открыть',exact:true}).click();await a.waitForTimeout(300);assert.ok((await readFile(path.join(directory,'opened.txt'),'utf8')).includes(path.join(directory,'private-explorer.txt')));}
  // A Windows guest can also accept the existing web application's automatic invitation.
  await phone.locator('#tab-connection').click();await phone.locator('#connection-settings').evaluate(el=>el.open=true);await phone.locator('#connection-mode').selectOption('auto');await phone.locator('#create').click();await phone.locator('#share-link').waitFor();const webInvite=await phone.locator('#share-link').inputValue(),webRoom=new URLSearchParams(new URL(webInvite).hash.slice(1)).get('room');
  await internet(b,'Internet PC B');await b.locator('#internet-id').fill(webInvite);await b.locator('#internet-join').click();await phone.locator('#approve').waitFor();await phone.locator('#approve').click();await b.waitForFunction(()=>window.NearbyGetInternetTargets().length===2&&window.NearbyGetInternetTargets().every(t=>t.ready),null,{timeout:60000});
  await b.locator('#tab-devices').click();await b.locator(`.device-target input[value="internet:${webRoom}"]`).check();await b.locator('#devices-transfer').click();
  const resumed=phone.waitForEvent('download');await b.locator('#files').setInputFiles({name:'private-auto-invite.txt',mimeType:'text/plain',buffer:Buffer.from('Web invite works')});assert.equal(await readFile(await(await resumed).path(),'utf8'),'Web invite works');await b.waitForFunction(()=>!document.querySelector('#files').disabled);files++;bytes+=16;
  // Disconnecting the selected device must not silently send a subsequent file elsewhere.
  await b.locator('#tab-connection').click();const phoneName=await b.evaluate(room=>window.NearbyGetInternetTargets().find(t=>t.id==='internet:'+room).name,webRoom);await b.locator('.internet-connected').filter({hasText:phoneName}).getByRole('button',{name:'Отключить',exact:true}).click();await b.waitForFunction(()=>document.querySelector('#recipient-name').textContent==='Устройство не выбрано');assert.ok(await b.locator('#files').isDisabled());
  // Owner-only bridge and bounded disk reservations.
  const origin=new URL(apps[0].adminUrl).origin;
  assert.equal((await fetch(origin+'/api/internet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create'})})).status,403);
  const headers={Authorization:`Bearer ${apps[0].adminToken}`,'Content-Type':'application/json'};
  assert.equal((await fetch(origin+'/api/internet/receives',{method:'POST',headers,body:JSON.stringify({room:'a'.repeat(32),name:'large.bin',size:100*1024**2+1})})).status,400);
  for(let i=0;i<50;i++){const result=await(await fetch(relay+'api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stats'})})).json();if(result.files===files){assert.equal(result.bytes,bytes);break;}if(i===49)assert.fail(JSON.stringify(result));await new Promise(r=>setTimeout(r,100));}
  for(const post of posts)assert.ok(!post.includes('private-'),'file names must remain encrypted over the relay');
  assert.deepEqual(errors,[]);await a.screenshot({path:'artifacts/desktop-internet.png'});
  const report={passed:true,realWinFormsWebView2:Boolean(nativePage),twoIsolatedPCs:!nativePage,rtcDisabled:!nativePage,phoneInteroperability:true,shortId:true,explorer:true,automaticSave:true,sha256:true,files,bytes,errors,testedAt:new Date().toISOString()};await writeFile('artifacts/desktop-internet'+(nativePage?'-native':'')+'-verification.json',JSON.stringify(report,null,2));console.log(report);
}finally{if(native?.stdin.writable)native.stdin.end('stop\n');if(native&&native.exitCode===null){const timer=setTimeout(()=>native.kill(),10000);await nativeExited;clearTimeout(timer);}await nativeBrowser?.close().catch(()=>{});await browser?.close();await Promise.all(apps.map(app=>app.close()));const exited=new Promise(r=>php.once('exit',r));php.kill();await exited;assert.equal(path.dirname(directory),path.resolve(tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:250});if(harness)for(const file of [harness,harness+'.config'])await rm(file,{force:true});}
