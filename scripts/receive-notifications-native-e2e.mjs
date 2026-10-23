import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {openSettings,selectDesktopLan} from './web-navigation.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'nearby-notifications-'));
const inbox=path.join(directory,'received'),data=path.join(directory,'data');
const harness=path.resolve('dist/windows-x64/TrayNativeHarness.exe');
const debugPort=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const pending=new Map(),errors=[];let sequence=0,native,nativeExited,desktop,page,remote,origin,admin;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function command(command){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native command timed out: '+command));},15000);pending.set(id,{resolve,reject,timer});native.stdin.write(JSON.stringify({id,command})+'\n');});}
async function start(){
  native=spawn(harness,[directory],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NEARBY_DATA_DIR:data,NEARBY_RECEIVE_DIR:inbox,NEARBY_DISABLE_STATISTICS:'1',NEARBY_DISABLE_DISCOVERY:'1',NEARBY_DISABLE_TRUSTED_LAN:'1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`}});
  nativeExited=once(native,'exit');let stderr='';native.stderr.on('data',bytes=>{stderr+=bytes;});
  createInterface({input:native.stdout}).on('line',line=>{const value=JSON.parse(line),item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(new Error(value.error)):item.resolve(value);}});
  for(let i=0;i<150;i++){if(native.exitCode!==null)throw new Error(stderr);try{if((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok)break;}catch{}await pause(200);}
  desktop=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const browserCDP=await desktop.newBrowserCDPSession();await browserCDP.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true});
  page=null;for(let i=0;i<100;i++){page=desktop.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:'));if(page)break;await pause(100);}assert.ok(page);
  page.on('pageerror',error=>errors.push(error.message));await page.locator('#workspace').waitFor();
  await page.locator('#receive-notifications:enabled').waitFor({state:'attached'});
  origin=new URL(page.url()).origin;admin=await page.evaluate(()=>sessionStorage.getItem('nearby-token'));
}
async function call(url,body,token=admin){const binary=Buffer.isBuffer(body);return fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':binary?'application/octet-stream':'application/json'})},body:body===undefined?undefined:binary?body:JSON.stringify(body)});}
async function incoming(name,bytes,token,size=bytes.length){const offerResponse=await call('/api/offers',{name,size},token);assert.equal(offerResponse.status,201);const offer=await offerResponse.json();const response=await call(`/api/offers/${offer.id}/upload`,bytes,token);assert.equal(response.status,size===bytes.length?201:400);if(size===bytes.length)await saved(name,bytes);}
async function saved(name,bytes){for(let i=0;i<120;i++){const file=(await readdir(inbox)).find(file=>file.endsWith('-'+name));if(file){assert.equal(digest(await readFile(path.join(inbox,file))),digest(bytes));return;}await pause(100);}throw new Error('Received file missing: '+name);}
async function count(expected,name){let state;for(let i=0;i<100;i++){state=await command('state');if(state.notifications.length>=expected)break;await pause(50);}assert.equal(state.notifications.length,expected);if(name){assert.equal(state.notifications.at(-1).title,'Получен файл');assert.ok(state.notifications.at(-1).text.includes(name));}return state;}
async function preference(enabled){await openSettings(page);const checkbox=page.locator('#receive-notifications');await checkbox.setChecked(enabled);await page.waitForFunction(value=>!document.getElementById('receive-notifications').disabled&&document.getElementById('receive-notifications').checked===value,enabled);assert.ok(await page.locator('#connection-settings').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth),'Settings must fit without horizontal scrolling');await page.locator('#connection-settings').screenshot({path:'artifacts/receive-notifications-settings.png'});await page.locator('[data-close-settings]').last().click();assert.equal((await command('state')).receiveNotifications,enabled);}
async function stop(){await desktop.close();desktop=null;await command('exit');await nativeExited;}
try{
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/tray-native-build.ps1','-Output',harness],{windowsHide:true,stdio:'pipe'});
  await start();const initial=await command('state');assert.equal(initial.receiveNotifications,true);
  const localState=await(await call('/api/state')).json();const joined=await(await call('/api/join',{pin:localState.pin,device:'Notification sender'})).json();assert.ok(joined.token);
  await incoming('visible.txt',Buffer.from('No popup while visible'),joined.token);assert.equal((await command('state')).notifications.length,0);
  await command('minimize');await incoming('Принятый файл.txt',randomBytes(33013),joined.token);await count(1,'Принятый файл.txt');
  await pause(600);await count(1);assert.equal((await command('state')).visible,false,'Notification must not restore the window by itself');
  await incoming('incomplete.bin',Buffer.from('x'),joined.token,2);await count(1);
  const staged=await call('/api/shares?name=outgoing.txt&size=1',Buffer.from('x'));assert.equal(staged.status,201);await count(1);
  await command('notification-click');await page.waitForFunction(()=>document.body.dataset.activePane==='transfer');assert.ok((await command('state')).visible);
  await preference(false);await command('minimize');await incoming('muted.bin',randomBytes(9),joined.token);await count(1);
  await command('open');await preference(true);await command('minimize');await incoming('empty.txt',Buffer.alloc(0),joined.token);await count(2,'empty.txt');
  // Receive a remote PC share through WebView2's real download handler.
  await command('open');await selectDesktopLan(page);
  remote=await createApp({host:'127.0.0.1',port:0,storage:path.join(directory,'peer'),statistics:false,discovery:false,trustedLan:false});
  const remoteOrigin=new URL(remote.adminUrl).origin;
  const connection=await call('/api/peer/connect',{address:remoteOrigin,pin:remote.pin,device:'Native recipient'});assert.equal(connection.status,200);
  await page.evaluate(()=>refresh());await command('minimize');
  const bytes=randomBytes(9301),name='pc-download.bin';const share=await fetch(remoteOrigin+`/api/shares?name=${name}&size=${bytes.length}`,{method:'POST',headers:{Authorization:`Bearer ${remote.adminToken}`},body:bytes});assert.equal(share.status,201);
  await page.evaluate(()=>refresh());await saved(name,bytes);await count(3,name);
  await command('notification-click');await page.waitForFunction(()=>document.body.dataset.activePane==='transfer');assert.ok((await command('state')).visible);
  await preference(false);assert.equal(JSON.parse(await readFile(path.join(data,'desktop-settings.json'),'utf8')).receiveNotifications,false);
  await stop();await remote.close();remote=null;
  await start();assert.equal((await command('state')).receiveNotifications,false,'Preference survives an application restart and a new local origin');
  const nextState=await(await call('/api/state')).json();const nextGuest=await(await call('/api/join',{pin:nextState.pin,device:'After restart'})).json();
  await command('minimize');await incoming('still-muted.txt',Buffer.from('Stored preference'),nextGuest.token);await count(0);
  await command('open');await preference(true);await command('minimize');await incoming('enabled-again.txt',Buffer.from('Notifications enabled'),nextGuest.token);await count(1,'enabled-again.txt');
  await stop();assert.deepEqual(errors,[]);
  await writeFile('artifacts/receive-notifications-native-verification.json',JSON.stringify({passed:true,version:JSON.parse(await readFile('package.json','utf8')).version,realWinFormsWebView2:true,defaultEnabled:true,successfulReceiveOnly:true,noVisibleWindowPopup:true,noOutgoingPopup:true,noFailedReceivePopup:true,oneNotificationPerReceive:true,zeroByteFile:true,lanAndNativeDownload:true,clickRestoresTransferPane:true,disableAndReenable:true,persistedAcrossRestart:true,sha256:true,errors,testedAt:new Date().toISOString()},null,2));
  console.log('Receive notifications passed: saved files, tray only, click to restore, muted failures/outgoing, native PC download, preference and restart.');
}catch(error){
  const diagnostic=await page?.evaluate(()=>({peerMode,records:[...records.values()].map(({name,status,failed})=>({name,status,failed})),remoteShares:remoteState?.shares?.map(({name})=>name)})).catch(()=>null);
  await writeFile('artifacts/receive-notifications-failure.json',JSON.stringify({error:error.message,diagnostic,files:await readdir(inbox).catch(()=>[])},null,2));throw error;
}finally{
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Test ended'));}pending.clear();
  await desktop?.close().catch(()=>{});if(native?.exitCode===null){native.stdin.end();const timer=setTimeout(()=>native.kill(),10000);await nativeExited;clearTimeout(timer);}await remote?.close();
  for(const file of [harness,harness+'.config'])await rm(file,{force:true});assert.equal(path.dirname(directory),path.resolve(tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:200});
}
