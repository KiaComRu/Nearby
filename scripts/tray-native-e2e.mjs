import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {selectPane} from './web-navigation.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'nearby-tray-'));
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const apiPort=await port(),debugPort=await port(),base=`http://127.0.0.1:${apiPort}/`;
const harness=path.resolve('dist/windows-x64/TrayNativeHarness.exe'),inbox=path.join(directory,'received');
const php=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${apiPort}`,'-t','browser'],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:path.join(directory,'relay')}});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),errors=[],pending=new Map();let sequence=0,native,nativeExited,desktop,browser,page;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function command(command,extra={}){
  const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native command timed out: '+command));},15000);pending.set(id,{resolve,reject,timer});native.stdin.write(JSON.stringify({id,command,...extra})+'\n');});
}
async function connectedPage(){
  desktop=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  let result;for(let i=0;i<100;i++){result=desktop.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:'));if(result)break;await pause(200);}assert.ok(result);result.on('pageerror',error=>errors.push(error.message));return result;
}
async function saved(name,bytes){
  for(let i=0;i<180;i++){const file=(await readdir(inbox)).find(n=>n===name);if(file){assert.equal(hash(await readFile(path.join(inbox,file))),hash(bytes));return;}await pause(250);}throw new Error('Background file was not saved: '+name);
}
try{
  for(let i=0;i<60;i++){try{await fetch(base);break;}catch{await pause(100);}}
  // Redirect only the test engine's HTTPS relay fetch to isolated local PHP.
  // This survives disconnecting DevTools during the idle test. No public stats
  // or pairings are created, and production sources remain untouched.
  const preload=path.join(directory,'local-relay.mjs');await writeFile(preload,`const fetchOriginal=globalThis.fetch;globalThis.fetch=(input,options)=>{const url=new URL(input);if(url.origin==='https://nearby.kiacom.ru'&&url.pathname==='/web/api.php'){url.protocol='http:';url.host='127.0.0.1:${apiPort}';url.pathname='/api.php';}return fetchOriginal(url,options);};`);
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/tray-native-build.ps1','-Output',harness],{windowsHide:true,stdio:'pipe'});
  native=spawn(harness,[directory],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:'--import='+pathToFileURL(preload).href,NEARBY_DATA_DIR:path.join(directory,'data'),NEARBY_RECEIVE_DIR:inbox,NEARBY_DISABLE_STATISTICS:'1',NEARBY_DISABLE_DISCOVERY:'1',NEARBY_DISABLE_TRUSTED_LAN:'1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`}});nativeExited=once(native,'exit');let stderr='';native.stderr.on('data',data=>{stderr+=data;});
  createInterface({input:native.stdout}).on('line',line=>{const value=JSON.parse(line),item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(new Error(value.error)):item.resolve(value);}});
  for(let i=0;i<150;i++){if(native.exitCode!==null)throw new Error(stderr);try{if((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok)break;}catch{}await pause(200);}
  page=await connectedPage();await page.locator('#workspace').waitFor();const initial=await command('state');assert.ok(initial.trayVisible&&initial.engineRunning&&initial.visible);
  browser=await chromium.launch({headless:true});const phones=[];
  for(const transport of ['direct','relay']){
    const context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.addInitScript(({relay,name})=>{if(relay)window.RTCPeerConnection=undefined;window.showDirectoryPicker=undefined;localStorage.setItem('nearby.device-name',name);localStorage.setItem('nearby.device-name.version','2');}, {relay:transport==='relay',name:transport+' phone'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());const phone=await context.newPage();phone.on('pageerror',error=>errors.push(error.message));
    await selectPane(page,'connection');await page.locator('#internet-create').click();await page.locator('#internet-link').waitFor();const invite=await page.locator('#internet-link').inputValue();await phone.goto(invite.replace('https://nearby.kiacom.ru/web/',base));await page.locator('#internet-approve').click();
    await page.waitForFunction(kind=>window.NearbyGetInternetTargets().some(t=>t.ready&&t.transport===kind),transport,{timeout:60000});await phone.waitForFunction(()=>!document.querySelector('#files').disabled);
    phones.push(phone);
  }
  const [direct,relay]=phones;
  // Slow actual hashing slightly so minimizing happens during a real transfer.
  await direct.evaluate(()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args)=>{await new Promise(r=>setTimeout(r,20));return digest(...args);};});
  await selectPane(page,'transfer');const payload=randomBytes(2*1024**2+13),download=direct.waitForEvent('download');
  await page.locator('#files').setInputFiles({name:'during-minimize.bin',mimeType:'application/octet-stream',buffer:payload});await page.waitForFunction(()=>sending&&[...records.values()].some(r=>r.received>0&&r.busy));
  const hidden=await command('minimize');assert.ok(!hidden.visible&&hidden.trayVisible&&hidden.engineRunning);assert.equal(hidden.engineId,initial.engineId);
  assert.equal(hash(await readFile(await(await download).path())),hash(payload));await page.waitForFunction(()=>!sending,null,{polling:100});assert.equal((await command('state')).visible,false);
  // Leave only the relay pairing alive: WebRTC can exempt a page from intensive
  // timer throttling and must not mask problems with relay-only tray operation.
  await page.evaluate(async()=>{await internetClient.disconnect(window.NearbyGetInternetTargets().find(t=>t.transport==='direct'));document.querySelector('#select-remaining').click();});
  const room=await page.evaluate(()=>window.NearbyGetInternetTargets()[0].id);
  await page.evaluate(()=>{window.trayTicks={count:0,last:Date.now(),maxGap:0};setInterval(()=>{const now=Date.now();trayTicks.maxGap=Math.max(trayTicks.maxGap,now-trayTicks.last);trayTicks.last=now;trayTicks.count++;},1000);});
  // Browser.close disconnects a connectOverCDP connection, leaving the WebView
  // process owned by WinForms running. No inspector remains attached while idle.
  await desktop.close();desktop=null;
  assert.equal((await command('state')).engineId,initial.engineId);
  const idle=Number(process.env.NEARBY_TRAY_IDLE_MS||360000),until=Date.now()+idle;console.log('Tray: minimized during active direct send; entering relay-only idle with DevTools disconnected.');
  while(Date.now()<until){await pause(Math.min(45000,until-Date.now()));const state=await command('state');assert.ok(!state.visible&&state.engineRunning&&state.trayVisible);assert.equal(state.engineId,initial.engineId);console.log('Tray idle remaining: '+Math.max(0,Math.ceil((until-Date.now())/1000))+' seconds.');}
  const incoming=randomBytes(600013);await relay.locator('#files').setInputFiles({name:'after-idle-to-tray.bin',mimeType:'application/octet-stream',buffer:incoming});await saved('after-idle-to-tray.bin',incoming);await relay.waitForFunction(()=>!document.querySelector('#files').disabled);
  let notification;for(let i=0;i<100;i++){notification=await command('state');if(notification.notifications.length)break;await pause(50);}assert.equal(notification.notifications.length,1);assert.ok(notification.notifications[0].text.includes('after-idle-to-tray.bin'));assert.equal(notification.visible,false);
  page=await connectedPage();assert.equal(await page.evaluate(()=>window.NearbyGetInternetTargets()[0].id),room);const ticks=await page.evaluate(()=>trayTicks);
  // Browser UI intervals may be throttled while hidden. The actual contract is
  // proven by SHA-256, the sender's completion and the unchanged pairing above.
  const outgoing=randomBytes(330013),next=relay.waitForEvent('download');await page.locator('#files').setInputFiles({name:'after-idle-from-tray.bin',mimeType:'application/octet-stream',buffer:outgoing});assert.equal(hash(await readFile(await(await next).path())),hash(outgoing));await page.waitForFunction(()=>!sending,null,{polling:100});assert.equal((await command('state')).visible,false);
  for(const action of ['double-click','icon','open','double-click','icon']){await command('minimize');const restored=await command(action);assert.ok(restored.visible&&restored.windowState!=='Minimized',action+': tray restore');assert.equal(restored.engineId,initial.engineId);await pause(250);assert.ok((await command('state')).visible,action+': stays visible after notification');}
  const reopened=await command('open');assert.ok(reopened.visible&&reopened.trayVisible);assert.equal(reopened.engineId,initial.engineId);
  await command('maximize');await command('minimize');const maximized=await command('reopen');assert.equal(maximized.windowState,'Maximized');assert.ok(maximized.visible);
  await command('minimize');const selection=path.join(directory,'from-explorer.txt');await writeFile(selection,'Explorer restores the same session');await command('shell',{path:selection});await page.locator('#shell-send').waitFor();assert.equal((await command('state')).engineId,initial.engineId);assert.ok((await command('state')).visible);await page.locator('#shell-close').click();
  const origin=new URL(page.url()).origin;await command('exit');await nativeExited;await assert.rejects(fetch(origin+'/'));assert.deepEqual(errors,[]);
  const report={passed:true,version:JSON.parse(await readFile('package.json','utf8')).version,realWinFormsWebView2:true,trayIconCallbacks:true,repeatedRestore:true,minimizeDuringDirectTransfer:true,relayOnlyIdleMs:idle,devToolsDetachedDuringIdle:true,sha256BothWaysAfterIdle:true,receiveNotificationAfterIdle:true,oneEngine:true,restoreMaximized:true,explorerRestoresWindow:true,exitStopsEngine:true,ticks,errors,testedAt:new Date().toISOString()};await writeFile('artifacts/tray-native-verification.json',JSON.stringify(report,null,2));console.log('Tray native verification passed.');
}finally{
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Test ended'));}pending.clear();
  if(native?.exitCode===null){native.stdin.end();const timer=setTimeout(()=>native.kill(),10000);await nativeExited;clearTimeout(timer);}
  await desktop?.close().catch(()=>{});await browser?.close();const exited=new Promise(resolve=>php.once('exit',resolve));php.kill();await exited;
  for(const file of [harness,harness+'.config'])await rm(file,{force:true});assert.equal(path.dirname(directory),path.resolve(tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
