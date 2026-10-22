import assert from 'node:assert/strict';
import {chromium,devices} from 'playwright';
import {createApp} from '../server.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {selectPane,openSettings} from './web-navigation.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'nearby-desktop-auto-'));
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
const base=`http://127.0.0.1:${port}/`,apps=[],checks=[],errors=[];
const php=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${port}`,'-t','browser'],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:path.join(directory,'relay')}});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');let browser;
try{
  for(let i=0;i<60;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  for(let i=0;i<2;i++)apps.push(await createApp({host:'127.0.0.1',port:0,storage:path.join(directory,String(i)),statistics:false,discovery:false,trustedLan:false,internetEndpoint:base+'api.php'}));
  browser=await chromium.launch({headless:true});
  for(const [kind,expected] of [['phone-direct','direct'],['phone-relay','relay'],['pc-direct','direct'],['pc-relay','relay']]){
    const phone=kind.startsWith('phone'),contexts=[];
    const ownerContext=await browser.newContext({viewport:{width:1366,height:900}}),guestContext=await browser.newContext(phone?devices['iPhone 13']:{viewport:{width:1366,height:900}});contexts.push(ownerContext,guestContext);
    if(expected==='relay')await guestContext.addInitScript(()=>{window.RTCPeerConnection=undefined;});
    for(const [index,context] of contexts.entries()){
      const nativeOrigin=new URL(apps[index].adminUrl).origin;
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(index===1&&phone&&url.origin==='https://nearby.kiacom.ru'){
          url.protocol='http:';url.host=`127.0.0.1:${port}`;url.pathname=url.pathname.replace(/^\/web\//,'/');
          const response=await route.fetch({url:url.href,headers:{...route.request().headers(),origin:new URL(base).origin}});return route.fulfill({response});
        }
        return url.origin===nativeOrigin?route.continue():route.abort();
      });
    }
    const owner=await ownerContext.newPage(),guest=await guestContext.newPage();
    for(const page of [owner,guest])page.on('pageerror',error=>errors.push(error.message));
    await owner.goto(apps[0].adminUrl);await owner.locator('#workspace').waitFor();
    assert.equal(await owner.locator('#connection-mode').inputValue(),'auto');assert.ok(await owner.locator('#connection-settings').isHidden());assert.ok(await owner.locator('#discovery').isVisible());assert.ok(await owner.locator('#qr').isHidden());
    await owner.locator('#internet-name').fill('Automatic PC');await owner.locator('#internet-create').click();await owner.locator('#internet-invitation').waitFor();
    const invite=await owner.locator('#internet-link').inputValue(),code=await owner.locator('#internet-code').textContent();
    assert.equal(new URL(invite).origin,'https://nearby.kiacom.ru');assert.equal(new URLSearchParams(new URL(invite).hash.slice(1)).get('mode'),'auto');assert.match(code,/^\d{3}-\d{3}-\d{3}$/);
    assert.equal(await owner.locator('#internet-qr:visible,#qr:visible').count(),1);
    if(phone)await guest.goto(invite);
    else{await guest.goto(apps[1].adminUrl);await guest.locator('#workspace').waitFor();await guest.locator('#internet-name').fill('Automatic guest PC');await guest.locator('#internet-id').fill(code);await guest.locator('#internet-join').click();}
    await owner.locator('#internet-approve').click();
    for(const page of [owner,guest])await page.waitForFunction(()=>!document.querySelector('#files').disabled,null,{timeout:60000});
    await owner.waitForFunction(transport=>window.NearbyGetInternetTargets().length===1&&window.NearbyGetInternetTargets()[0].transport===transport,expected);
    const room=await owner.evaluate(()=>window.NearbyGetInternetTargets()[0].id);
    if(!phone)assert.equal(await guest.evaluate(()=>window.NearbyGetInternetTargets()[0].transport),expected);
    async function send(name,bytes){
      await selectPane(owner,'transfer');await owner.locator('#files').setInputFiles({name,mimeType:'application/octet-stream',buffer:bytes});
      if(phone){
        const row=guest.locator('#transfers .transfer').filter({hasText:name});await row.locator('a.open-transfer').waitFor({state:'attached',timeout:60000});
        const data=await row.locator('a.open-transfer').evaluate(async a=>Array.from(new Uint8Array(await(await fetch(a.href)).arrayBuffer())));assert.equal(hash(Buffer.from(data)),hash(bytes));
      }else{
        await guest.locator('#incoming .file-row').filter({hasText:name}).getByText('Получено и сохранено',{exact:true}).waitFor({state:'attached',timeout:60000});
        const saved=(await readdir(apps[1].inbox)).find(file=>file.endsWith('-'+name));assert.equal(hash(await readFile(path.join(apps[1].inbox,saved))),hash(bytes));
      }
      await owner.waitForFunction(()=>!document.querySelector('#files').disabled);
    }
    await send(kind+'.bin',randomBytes(120017));await send(kind+'-empty.txt',Buffer.alloc(0));
    if(kind==='phone-direct'){
      await owner.evaluate(()=>internetClient.connection(window.NearbyGetInternetTargets()[0]).peer.close());
      await owner.waitForFunction(()=>window.NearbyGetInternetTargets().some(target=>target.ready&&target.transport==='relay'),null,{timeout:45000});
      assert.equal(await owner.evaluate(()=>window.NearbyGetInternetTargets()[0].id),room,'fallback must reuse the original pairing');
      await send('same-qr-after-direct-loss.bin',randomBytes(77013));
    }
    await selectPane(guest,'transfer');const returned=Buffer.from('automatic reverse '+kind),name='reverse-'+kind+'.txt';
    await guest.locator('#files').setInputFiles({name,mimeType:'text/plain',buffer:returned});
    await owner.locator('#incoming .file-row').filter({hasText:name}).getByText('Получено и сохранено',{exact:true}).waitFor({state:'attached',timeout:60000});
    const saved=(await readdir(apps[0].inbox)).find(file=>file.endsWith('-'+name));assert.equal(hash(await readFile(path.join(apps[0].inbox,saved))),hash(returned));
    await selectPane(owner,'connection');await owner.screenshot({path:'artifacts/desktop-auto-'+kind+'.png'});
    // Offline legacy connection stays explicitly accessible, with one visible QR.
    await openSettings(owner);await owner.locator('#connection-mode').selectOption('lan');await owner.locator('#connection-settings [data-close-settings]').last().click();assert.ok(await owner.locator('#connection').isVisible());assert.ok(await owner.locator('#internet-option').isHidden());
    checks.push({kind,transport:expected,singleHttpsQR:true,shortId:true,sha256BothWays:true,emptyFile:true,fallbackRetainsPairing:kind==='phone-direct',offlineLocalAvailable:true});
    console.log(kind+': automatic '+expected+', one QR, SHA-256 both ways, empty file and offline local mode passed.');
    // Close the pairing explicitly: a browser context disappearing cannot send
    // a best-effort API close on every browser engine.
    await owner.evaluate(()=>internetClient.disconnect(window.NearbyGetInternetTargets()[0]));
    for(const context of contexts)await context.close();
  }
  assert.deepEqual(errors,[]);await writeFile('artifacts/desktop-auto-verification.json',JSON.stringify({passed:true,checks,errors,testedAt:new Date().toISOString()},null,2));
}finally{
  await browser?.close();for(const app of apps)await app.close();
  const exited=new Promise(resolve=>php.once('exit',resolve));php.kill();await exited;
  assert.equal(path.dirname(directory),path.resolve(tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
