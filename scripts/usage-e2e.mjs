import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'nearby-usage-ui-'));
await writeFile(path.join(directory,'statistics.json'),JSON.stringify({files:5,bytes:100,startedAt:'2026-10-12T20:00:00Z',updatedAt:null,rooms:{}}));
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const origin=`http://127.0.0.1:${port}`, web=origin+'/web/';
const php=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${port}`,'-t','landing','scripts/usage-test-router.php'],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:directory}}), exited=once(php,'exit');
let browser, native; const errors=[];
const stats=async()=>(await fetch(web+'api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"stats"}'})).json();
const until=async condition=>{for(let i=0;i<100;i++){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('Usage count did not update');};
try {
  await until(async()=>{try{return(await fetch(origin)).ok;}catch{return false;}});
  browser=await chromium.launch({headless:true});
  const first=await browser.newContext({viewport:{width:1280,height:900}}), second=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  for(const context of [first,second])await context.addInitScript(()=>{localStorage.setItem('nearby-site-language','ru');window.RTCPeerConnection=undefined;});
  native=await createApp({host:'127.0.0.1',port:0,storage:path.join(directory,'native'),statistics:{endpoint:web+'api.php'},trustedLan:false,discovery:false});
  const nativeOrigin=`http://127.0.0.1:${native.port}`;
  async function pinConnect(){const response=await fetch(nativeOrigin+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:native.pin,device:'Same phone'})});const {token}=await response.json();for(let i=0;i<5;i++)assert.equal((await fetch(nativeOrigin+'/api/state',{headers:{Authorization:`Bearer ${token}`}})).status,200);return token;}
  await pinConnect();await until(async()=>(await stats()).uses===1);
  for(let count=2;count<=3;count++) {
    const host=await first.newPage(),guest=await second.newPage();for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
    await host.goto(web+'#mode=internet');await host.locator('#device-name').fill('Same PC');await host.locator('#create').click();
    await host.locator('#share-link').waitFor();await guest.goto(await host.locator('#share-link').inputValue());await guest.locator('#device-name').fill('Same phone');await guest.locator('#join-invite').click();
    await host.locator('#approve').waitFor();assert.equal((await stats()).uses,count-1);
    await host.locator('#approve').click();for(const page of [host,guest])await page.waitForFunction(()=>!document.querySelector('#files').disabled);
    await until(async()=>(await stats()).uses===count);await host.locator('#disconnect').click();await host.close();await guest.close();
  }
  await pinConnect();await until(async()=>(await stats()).uses===4);
  await mkdir('artifacts',{recursive:true});
  for(const [locale,route] of [['ru','/'],['en','/en/'],['hi','/hi/'],['zh-CN','/zh-cn/'],['es','/es/']]) {
    const page=await first.newPage();page.on('pageerror',e=>errors.push(e.message));
    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900});await page.goto(origin+route);
      await page.waitForFunction(()=>document.querySelector('#stats-uses')?.textContent==='4');
      assert.equal(await page.locator('#stats-files').textContent(),new Intl.NumberFormat(locale).format(5));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(locale==='ru')await page.locator('#transfer-statistics').screenshot({path:`artifacts/nearby-usage-landing-${width}.png`});
    }
    await page.close();
  }
  const page=await second.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const [name,url] of [['web',web],['windows',native.adminUrl]]) {
    await page.goto(url);await page.waitForFunction(()=>document.querySelector('#stats-uses')?.textContent==='4');
    assert.equal(await page.locator('#stats-uses-label').textContent(),'количество использований');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#transfer-statistics').screenshot({path:`artifacts/nearby-usage-${name}-mobile.png`});
  }
  const totals=await stats();assert.equal(totals.uses,4);assert.equal(totals.files,5);assert.equal(totals.bytes,100);assert.equal(totals.startedAt,'2026-10-12T20:00:00Z');assert.deepEqual(errors,[]);
  await writeFile('artifacts/Nearby-usage-verification.json',JSON.stringify({passed:true,repeatWebConnections:2,repeatNativeConnections:2,heartbeatsDeduplicated:true,uses:4,oldFilesAndBytesPreserved:true,landingLocales:5,widths:[1280,390],webAndWindowsCounter:true,physicalDevices:false,checkedAt:new Date().toISOString()},null,2));
  console.log('Usage E2E passed: repeat web and native connections, unchanged file/byte totals, five landing languages, desktop/mobile and Windows UI.');
} finally {await browser?.close();await native?.close();php.kill();await exited;await rm(directory,{recursive:true,force:true});}
