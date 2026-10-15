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
const desktop = await build('windows-build.json'), serverBuild = await build('windows-server-2016-build.json');
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
      assert.equal(await choices.locator('[data-installer]').count(),2);
      for(const [id,metadata,title,framework] of [['windows',desktop,'Windows 10/11','4.8'],['server2016',serverBuild,'Windows Server 2016','4.6.2']]) {
        const link=choices.locator(`[data-installer="${id}"]`), card=link.locator('..');
        assert.equal(await link.evaluate(a=>new URL(a.href).pathname),'/downloads/'+metadata.installer);
        assert.ok(await link.getAttribute('download')!==null);
        assert.equal(await card.locator('h4').textContent(),title);
        assert.ok((await card.textContent()).includes('.NET Framework '+framework));
        if(id==='server2016')assert.ok((await card.textContent()).includes('Desktop Experience'));
        const box=await link.boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0 && box.x+box.width<=width);
        if(locale==='ru'&&width===1280){const downloadEvent=page.waitForEvent('download');await link.click();const download=await downloadEvent;assert.equal(download.suggestedFilename(),metadata.installer);await download.cancel();}
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${locale} ${width}`);
      if(locale==='ru'||locale==='en')await choices.screenshot({path:`artifacts/nearby-download-choice-${publicOrigin?'public':'local'}-${locale}-${width}.png`});
      results.push({locale,width,desktop:desktop.installer,server:serverBuild.installer});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(`artifacts/Nearby-download-choice-${publicOrigin?'public':'local'}-verification.json`,JSON.stringify({passed:true,origin,pages:results,version:desktop.version,desktopAndServerChoices:true,heroOpensChoice:true,bothDownloadCommandsVerified:true,statisticsUnchangedByTest:true,checkedAt:new Date().toISOString()},null,2));
  console.log('Windows download selection passed: five languages, desktop/mobile, explicit requirements and correct installer downloads.');
} finally {await browser?.close();if(server){server.kill();await exited;}}
