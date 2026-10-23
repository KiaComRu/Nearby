import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import assert from 'node:assert/strict';
const publicOrigin = process.argv.find(arg => arg.startsWith('--origin='))?.slice('--origin='.length);
let server, exited, browser;
const port = publicOrigin ? null : await new Promise(resolve => { const listener = net.createServer(); listener.listen(0,'127.0.0.1', () => { const value=listener.address().port;listener.close(()=>resolve(value)); }); });
const origin = publicOrigin || `http://127.0.0.1:${port}/`;
const build = async name => JSON.parse((await readFile(`artifacts/${name}`, 'utf8')).replace(/^\uFEFF/,''));
const desktop = await build('windows-build.json');
const results = [], errors = [];
try {
  if (!publicOrigin) {
    server = spawn(process.env.PYTHON_PATH || 'C:\\Python314\\python.exe', ['-m','http.server',String(port),'--bind','127.0.0.1','--directory','landing'], { windowsHide:true, stdio:'ignore' }); exited=once(server,'exit');
    for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  }
  await mkdir('artifacts',{recursive:true}); browser=await chromium.launch({headless:true});
  for (const [locale,route] of [['ru',''],['en','en/'],['es','es/'],['hi','hi/'],['zh-CN','zh-cn/']]) {
    const context=await browser.newContext({reducedMotion:'reduce'});
    await context.addInitScript(()=>localStorage.setItem('nearby-site-language','ru'));
    if(!publicOrigin)await context.route('**/web/api.php',route=>route.fulfill({json:{files:5,bytes:6211235,uses:0,startedAt:'2026-10-12T20:04:37Z',usesStartedAt:'2026-10-14T19:58:12Z',updatedAt:null}}));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900});await page.goto(origin+route);
      const choose=page.locator('.hero-actions a[href="#download"]');await choose.click();
      assert.equal(new URL(page.url()).hash,'#download');
      const choices=page.locator('#download .windows-download-choices');await choices.waitFor();
      assert.equal(await choices.locator('select').count(),0,'One supported build needs no selector');
      const link=choices.locator('[data-installer="windows"]');
      assert.equal(await link.count(),1);
      assert.equal(await link.evaluate(a=>new URL(a.href).pathname),'/downloads/'+desktop.installer);
      assert.ok((await link.getAttribute('aria-label')).includes('Windows 10/11'));
      assert.ok((await choices.textContent()).includes('.NET Framework 4.8'));
      const box=await link.boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0&&box.x+box.width<=width);
      assert.ok((await choices.boundingBox()).height<340);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${locale} ${width}`);
      if(locale==='ru'||locale==='en')await choices.screenshot({path:`artifacts/nearby-download-choice-${publicOrigin?'public':'local'}-${locale}-${width}.png`});
      results.push({locale,width,desktop:desktop.installer});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(`artifacts/Nearby-download-dropdown-${publicOrigin?'public':'local'}-verification.json`,JSON.stringify({passed:true,origin,pages:results,version:desktop.version,singleWindowsBuild:true,singleDownloadButton:true,compactLayout:true,heroOpensChoice:true,downloadLinkVerified:true,statisticsUnchangedByTest:true,checkedAt:new Date().toISOString()},null,2));
  console.log('Single Windows download passed: five languages and desktop/mobile layouts.');
} finally {await browser?.close();if(server){server.kill();await exited;}}
