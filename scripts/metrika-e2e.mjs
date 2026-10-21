import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';
import { localeDefinitions, routeFor } from '../landing/i18n/locales.mjs';
import { pageKeys } from '../landing/i18n/build.mjs';

const root=await mkdtemp(path.join(tmpdir(),'nearby-metrika-')), children=[];
const origin='https://nearby.kiacom.ru', errors=[], requests=[];
let browser;
async function serve(args) {
  const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
  const child=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${port}`,...args],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:root}});
  children.push({child,exited:once(child,'exit')});const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){try{await fetch(base+ (args.includes('scripts/pwa-test-router.php')?'/web/':'/'));return base;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Test server unavailable');
}
try {
  const pages=localeDefinitions.flatMap(locale=>pageKeys.map(key=>routeFor(locale.code,key).slice(1)+'index.html'));
  for(const name of [...pages.map(name=>'landing/'+name),'browser/index.html','browser/offline.html']) {
    const html=await readFile(name,'utf8');assert.equal((html.match(/<script[^>]+src="[^\"]*metrika\.js/g)||[]).length,1,name);
    assert.equal((html.match(/https:\/\/mc\.yandex\.ru\/watch\/113717603/g)||[]).length,1,name);
  }
  const site=await serve(['-t','landing']), web=await serve(['scripts/pwa-test-router.php']);
  browser=await chromium.launch({headless:true});
  async function context(options={}) {
    const context=await browser.newContext(options);
    await context.addInitScript(()=>localStorage.setItem('nearby-site-language','ru'));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin) {
        const base=url.pathname.startsWith('/web/')?web:site;
        const response=await route.fetch({url:base+url.pathname+url.search});await route.fulfill({response});return;
      }
      requests.push(url.href);
      if(url.href==='https://mc.yandex.ru/metrika/tag.js?id=113717603') {
        await route.fulfill({contentType:'text/javascript',body:`window.metrikaCalls=Array.from(window.ym.a||[],args=>Array.from(args));window.ym=function(){window.metrikaCalls.push(Array.from(arguments));};fetch('https://mc.yandex.ru/watch/113717603?probe=1').catch(()=>{});`});return;
      }
      if(url.hostname==='mc.yandex.ru') {await route.fulfill({status:200,contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64')});return;}
      await route.abort();
    });
    return context;
  }
  const desktop=await context();const page=await desktop.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/en/');await page.waitForFunction(()=>window.metrikaCalls?.length===1);
  let calls=await page.evaluate(()=>window.metrikaCalls);assert.equal(calls[0][0],113717603);assert.equal(calls[0][1],'init');
  for(const key of ['ssr','webvisor','clickmap','accurateTrackBounce','trackLinks'])assert.equal(calls[0][2][key],true);
  assert.equal(calls[0][2].ecommerce,'dataLayer');assert.equal(calls[0][2].url,origin+'/en/');
  await page.addScriptTag({type:'module',url:origin+'/metrika.js?duplicate-test'});assert.equal((await page.evaluate(()=>window.metrikaCalls)).length,1);
  assert.equal(await page.locator('script[src="https://mc.yandex.ru/metrika/tag.js?id=113717603"]').count(),1);
  const room='a'.repeat(32),key='b'.repeat(64),secret='c'.repeat(64);
  const response=await page.goto(origin+`/web/#room=${room}&key=${key}&mode=internet&secret=${secret}`);assert.ok(response.headers()['content-security-policy'].includes('https://mc.yandex.ru'));
  await page.waitForFunction(()=>window.metrikaCalls?.length===1);calls=await page.evaluate(()=>window.metrikaCalls);
  assert.equal(calls[0][2].url,origin+'/web/');assert.equal(new URL(page.url()).hash,'');
  assert.ok(!(JSON.stringify(calls)+requests.join('\n')).includes(secret));assert.ok(!(JSON.stringify(calls)+requests.join('\n')).includes(key));
  for(const id of ['device-name','invite-input','share-link','files'])assert.ok(await page.locator('#'+id).evaluate(element=>element.classList.contains('ym-disable-keys')));
  for(const id of ['invitation','invitation-id','device-list','transfers','outgoing-transfers','recipient-name'])assert.ok(await page.locator('#'+id).evaluate(element=>element.classList.contains('ym-hide-content')));
  await page.evaluate(()=>{const tip=document.createElement('div');tip.className='transfer-status-tooltip';tip.textContent='Private file error';document.body.append(tip);});
  await page.waitForFunction(()=>document.querySelector('.transfer-status-tooltip').classList.contains('ym-hide-content'));
  await page.addScriptTag({type:'module',url:origin+'/web/metrika.js?duplicate-test'});assert.equal((await page.evaluate(()=>window.metrikaCalls)).length,1);
  assert.ok(requests.some(url=>url.includes('/watch/113717603?probe=1')),'CSP must allow the counter request');
  const nojs=await context({javaScriptEnabled:false});const pixelPage=await nojs.newPage();const pixel=pixelPage.waitForRequest('https://mc.yandex.ru/watch/113717603');await pixelPage.goto(origin+'/web/');const pixelRequest=await pixel;assert.equal(pixelRequest.headers().referer,undefined);
  const blocked=await context();await blocked.route('https://mc.yandex.ru/**',route=>route.abort());const usable=await blocked.newPage();await usable.goto(origin+'/web/');await usable.locator('#create:enabled').waitFor();assert.ok(await usable.locator('#join-form').isVisible());
  assert.deepEqual(errors,[]);const result={passed:true,staticPages:pages.length,webAndOffline:true,optionsPreserved:true,singleInitialization:true,realCsp:true,privateInvitationExcluded:true,privateDomMasked:true,noscriptPixel:true,blockedCounterDoesNotBlockApp:true,errors};
  await writeFile('artifacts/metrika-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
  await browser?.close();await Promise.all(children.map(async({child,exited})=>{child.kill();await exited;}));
  assert.equal(path.dirname(root),path.resolve(tmpdir()));await rm(root,{recursive:true,force:true});
}
