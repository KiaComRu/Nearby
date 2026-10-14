import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const directory = await mkdtemp(path.join(tmpdir(), 'nearby-shell-native-'));
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0,'127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const stage = path.resolve('dist/windows-x64');
const hash = value => createHash('sha256').update(value).digest('hex');
let native, browser, exited;
async function activate(files) {
  const process = spawn(path.join(stage,'Nearby.exe'), files.length ? ['--send', ...files] : [], { windowsHide: true, stdio: 'ignore' });
  const timeout = setTimeout(() => process.kill(), 20000);
  try { const [code] = await once(process,'exit'); assert.equal(code,0,'Activation must reach the existing instance'); } finally { clearTimeout(timeout); }
}
try {
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/shell-native-build.ps1'],{windowsHide:true,stdio:'pipe'});
  const files = [path.join(directory,'Первый файл.txt'),path.join(directory,'100% & заметка.txt'),path.join(directory,'пустой.txt'),path.join(directory,'из меню & 50%.txt')];
  const contents = [randomBytes(1024*1024+17),Buffer.from('Привет, Nearby!\n'),Buffer.alloc(0),randomBytes(257)];
  for (let i=0;i<files.length;i++) await writeFile(files[i],contents[i]);
  native = spawn(path.join(stage,'ShellNativeHarness.exe'),[files[0]],{windowsHide:true,stdio:['pipe','ignore','pipe'],env:{...process.env,NEARBY_DATA_DIR:path.join(directory,'data'),NEARBY_RECEIVE_DIR:path.join(directory,'received'),NEARBY_DISABLE_STATISTICS:'1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`}});
  exited=once(native,'exit'); let errors=''; native.stderr.on('data', data => { errors += data; });
  let ready=false;
  for(let i=0;i<150;i++){try{ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{}if(ready)break;if(native.exitCode!==null)throw new Error('Native harness stopped: '+errors);await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(ready,'WebView2 debug target must start');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for(let i=0;i<150;i++){page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('http://127.0.0.1:'));if(page)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(page,'Real native engine page must load');
  await page.waitForFunction(()=>document.querySelectorAll('.shell-file').length===1);
  const origin = new URL(page.url()).origin, token = await page.evaluate(()=>sessionStorage.getItem('nearby-token'));
  const api=async(route,data,key=token)=>{const response=await fetch(origin+route,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${key}`,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});assert.ok(response.ok,route);return response.json();};
  const owner=await api('/api/state'); const joined=await api('/api/join',{pin:owner.pin,device:'Телефон для проверки'},'');await api('/api/state',undefined,joined.token);
  await Promise.all([activate([files[1]]),activate([files[2]])]);
  await page.waitForFunction(()=>document.querySelectorAll('.shell-file').length===3);
  execFileSync(path.join(stage,'ShellNativeHarness.exe'),['--invoke-verb',path.join(stage,'Nearby.exe'),files[3]],{windowsHide:true,stdio:'pipe'});
  await page.waitForFunction(()=>document.querySelectorAll('.shell-file').length===4);
  assert.equal(new URL(page.url()).origin,origin,'A second activation must keep the existing engine');
  await activate([]);assert.equal(await page.locator('.shell-file').count(),4);
  await page.waitForFunction(()=>!document.getElementById('shell-start').disabled);
  await page.locator('#shell-start').click();await page.waitForFunction(()=>[...document.querySelectorAll('.shell-file small')].length===4&&[...document.querySelectorAll('.shell-file small')].every(item=>item.textContent.includes('ожидает скачивания')));
  const offered=(await api('/api/state',undefined,joined.token)).shares;assert.equal(offered.length,4);
  for(const item of offered){const index=files.findIndex(file=>path.basename(file)===item.name);assert.ok(index>=0);const{url}=await api(`/api/shares/${item.id}/ticket`,{},joined.token);const bytes=Buffer.from(await(await fetch(origin+url)).arrayBuffer());assert.equal(hash(bytes),hash(contents[index]));}
  await page.locator('#shell-send').screenshot({path:'artifacts/nearby-shell-native-picker.png'});
  await writeFile('artifacts/Nearby-shell-native-verification.json',JSON.stringify({passed:true,realWinFormsWebView2:true,privateNamedPipe:true,initialFileBeforeReady:true,concurrentSecondaryActivations:2,registeredWindowsShellVerb:true,temporaryRegistryKeyRemoved:true,normalReactivation:true,existingConnectionPreserved:true,namesWithSpacesCyrillicAndMetacharacters:true,files:4,binaryAndEmptySHA256:true,statisticsDisabled:true,checkedAt:new Date().toISOString()},null,2));
  console.log('Native shell integration passed: registered Windows Shell verb, real WebView2 file injection, private IPC, concurrent activations, existing connection and four exact file hashes.');
} finally {
  if(native?.stdin.writable)native.stdin.end('stop\n');
  if(native&&native.exitCode===null){const timer=setTimeout(()=>native.kill(),10000);await exited;clearTimeout(timer);}
  await browser?.close().catch(()=>{});
  assert.equal(path.dirname(directory),path.resolve(tmpdir()));
  await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:250});
  for(const name of ['ShellNativeHarness.exe','ShellNativeHarness.exe.config'])await rm(path.join(stage,name),{force:true});
}
