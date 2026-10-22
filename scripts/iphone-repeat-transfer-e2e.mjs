import assert from 'node:assert/strict';
import {chromium,webkit,devices} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {selectPane} from './web-navigation.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'nearby-iphone-repeat-'));
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
const base=`http://127.0.0.1:${port}/`,errors=[],checks=[];
const php=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${port}`,'-t','browser'],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:path.join(directory,'relay')}});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let desktop,safari,app;
try{
  for(let i=0;i<60;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  desktop=await chromium.launch({headless:true});safari=await webkit.launch({headless:true});
  app=await createApp({host:'127.0.0.1',port:0,storage:path.join(directory,'pc'),statistics:false,discovery:false,trustedLan:false,internetEndpoint:base+'api.php'});
  for(const kind of ['web-relay','web-direct','windows-relay']){
    const pcContext=await desktop.newContext({acceptDownloads:true});
    const phoneContext=await(kind==='web-direct'?desktop:safari).newContext({...devices['iPhone 13'],acceptDownloads:true});
    const pcOrigin=kind==='windows-relay'?new URL(app.adminUrl).origin:new URL(base).origin;
    await pcContext.route('**/*',route=>new URL(route.request().url()).origin===pcOrigin?route.continue():route.abort());
    await phoneContext.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    // Simulate the iOS preview navigating the current document when an automatic
    // download is attempted; desktop WebKit does not provide iOS's download UI.
    await phoneContext.addInitScript(({direct})=>{
      if(!direct)window.RTCPeerConnection=undefined;
      window.showDirectoryPicker=undefined;
      localStorage.setItem('nearby-site-language','ru');
      window.unsafeAutomaticDownloads=0;
      const click=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){
        if(this.hasAttribute('download')&&this.href.startsWith('blob:')){
          window.unsafeAutomaticDownloads++;
          window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));return;
        }
        return click.call(this);
      };
    },{direct:kind==='web-direct'});
    if(kind!=='web-direct')await pcContext.addInitScript(()=>{window.RTCPeerConnection=undefined;});
    const pc=await pcContext.newPage(),phone=await phoneContext.newPage();
    for(const page of [pc,phone])page.on('pageerror',e=>errors.push(e.message));
    if(kind==='windows-relay'){
      await pc.goto(app.adminUrl);await pc.locator('#invite-internet').click();await pc.locator('#internet-link').waitFor();
      await phone.goto((await pc.locator('#internet-link').inputValue()).replace('https://nearby.kiacom.ru/web/',base));
      await pc.locator('#internet-approve').click();
    }else{
      await pc.goto(base+'#mode='+(kind==='web-direct'?'lan':'internet'));await pc.locator('#create').click();await pc.locator('#share-link').waitFor();
      await phone.goto(await pc.locator('#share-link').inputValue());await pc.locator('#approve').click();
    }
    for(const page of [pc,phone])await page.waitForFunction(()=>!document.querySelector('#files').disabled,null,{timeout:60000});
    const originalUrl=phone.url();await selectPane(pc,'transfer');
    const payloads=[Buffer.from('%PDF-1.4\nNearby iPhone repeat test\n%%EOF'),randomBytes(90013),Buffer.alloc(0),randomBytes(33001)];
    for(let i=0;i<payloads.length;i++){
      const name=i===0?'preview.pdf':i===2?'empty.txt':'same-name.bin',bytes=payloads[i];
      const previous=await phone.locator('#transfers .transfer').count();
      await pc.locator('#files').setInputFiles({name,mimeType:'application/octet-stream',buffer:bytes});
      await phone.waitForFunction(count=>document.querySelectorAll('#transfers .transfer').length===count+1,previous,{timeout:60000});
      const row=phone.locator('#transfers .transfer').filter({hasText:name}).first();
      await row.locator('a.open-transfer').waitFor({state:'attached',timeout:60000});
      assert.equal(await phone.evaluate(()=>window.unsafeAutomaticDownloads),0,'iPhone must not automatically navigate into a file preview');
      const received=await row.locator('a.open-transfer').evaluate(async a=>Array.from(new Uint8Array(await(await fetch(a.href)).arrayBuffer())));
      assert.equal(digest(Buffer.from(received)),digest(bytes),`${kind}: file ${i+1} SHA-256`);
      await pc.waitForFunction(()=>!document.querySelector('#files').disabled,null,{timeout:15000});
      assert.equal(phone.url(),originalUrl);assert.ok(await phone.locator('#files').isEnabled());
      if(i===0){
        // Safari keeps this document alive in its history cache. Resuming it
        // must retain both the connection and received file Blob URLs.
        await phone.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
        await selectPane(phone,'received');
        assert.equal(await row.locator('a.open-transfer').getAttribute('target'),'_blank');
        const popup=phone.waitForEvent('popup');await row.locator('a.open-transfer').click();const preview=await popup;await preview.close();
        assert.equal(phone.url(),originalUrl);
      }
    }
    // The same pairing is also usable in the opposite direction afterwards.
    await selectPane(phone,'transfer');const returned=Buffer.from('iPhone still connected');
    if(kind==='windows-relay'){
      await phone.locator('#files').setInputFiles({name:'back.txt',mimeType:'text/plain',buffer:returned});
      await pc.locator('#incoming .file-row').filter({hasText:'back.txt'}).getByText('Получено и сохранено',{exact:true}).waitFor({state:'attached',timeout:60000});
      const saved=(await readdir(app.inbox)).find(name=>name.endsWith('-back.txt'));
      assert.equal(digest(await readFile(path.join(app.inbox,saved))),digest(returned));
    }else{
      const download=pc.waitForEvent('download');await phone.locator('#files').setInputFiles({name:'back.txt',mimeType:'text/plain',buffer:returned});
      assert.equal(digest(await readFile(await(await download).path())),digest(returned));
    }
    await phone.waitForFunction(()=>!document.querySelector('#files').disabled);
    checks.push({kind,files:payloads.length,sha256:true,previewDoesNotNavigate:true,bfcacheRetainsSession:true,reverseTransfer:true});
    console.log(`${kind}: four consecutive files, same name, empty file, manual preview, cached page return and reverse transfer passed.`);
    await phoneContext.close();await pcContext.close();
  }
  assert.deepEqual(errors,[]);await writeFile('artifacts/iphone-repeat-transfer-verification.json',JSON.stringify({passed:true,checks,errors,testedAt:new Date().toISOString()},null,2));
}finally{
  await safari?.close();await desktop?.close();await app?.close();
  const exited=new Promise(resolve=>php.once('exit',resolve));php.kill();await exited;
  assert.equal(path.dirname(directory),path.resolve(tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
