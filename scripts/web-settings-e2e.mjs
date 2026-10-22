import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
const supplied=process.argv.find(value=>value.startsWith('--origin='))?.slice(9);
const directory=supplied?null:await mkdtemp(path.join(tmpdir(),'nearby-web-settings-'));
let php,browser;let base=supplied;
const errors=[],checks=[];
try{
  if(!base){const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});base=`http://127.0.0.1:${port}/`;php=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${port}`,'-t','browser'],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:directory}});for(let i=0;i<50;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}}
  browser=await chromium.launch({headless:true});
  for(const [locale,title] of [['ru','Дополнительные настройки'],['en','Advanced settings'],['hi','अतिरिक्त सेटिंग'],['zh-CN','高级设置'],['es','Ajustes avanzados']]){
    for(const width of [1366,390,320]){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});
      await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'?lang='+locale);await page.waitForFunction(language=>document.documentElement.lang===language,locale);
      await page.evaluate(()=>{window.NearbyWorkspace.setDevices(2);window.NearbyWorkspace.selectTab('devices');});
      const gear=await page.locator('#open-settings').boundingBox(),bar=await page.locator('.workspace-bar').boundingBox(),tab=await page.locator('#tab-connection').boundingBox();
      assert.ok(Math.abs(gear.x+gear.width-bar.x-bar.width)<2);assert.ok(Math.abs(gear.y+gear.height/2-tab.y-tab.height/2)<2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await page.locator('#open-settings').getAttribute('aria-label'),title);await page.locator('#open-settings').click();assert.ok(await page.locator('#connection-settings').evaluate(dialog=>dialog.matches(':modal')));assert.equal(await page.locator('#settings-heading').textContent(),title);assert.equal(await page.locator('#connection-settings summary').count(),0);
      const box=await page.locator('#connection-settings').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=844);
      if(locale!=='ru'){assert.ok(!/[А-Яа-яЁё]/.test(await page.locator('#connection-settings').innerText()));assert.ok(!/[А-Яа-яЁё]/.test(await page.locator('.settings-close').getAttribute('aria-label')));}
      await page.locator('#confirm-invitation').check();await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.querySelector('#connection-settings').contains(document.activeElement)),'keyboard focus stays inside the modal');
      if(locale==='ru'&&width!==320)await page.screenshot({path:`artifacts/web-settings-${width}.png`});
      await page.locator('#connection-settings [data-close-settings]').last().click();assert.ok(await page.locator('#connection-settings').isHidden());assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('id'),'tab-devices');assert.ok(await page.locator('#open-settings').evaluate(button=>button===document.activeElement));
      await page.locator('#open-settings').click();await page.keyboard.press('Escape');assert.ok(await page.locator('#connection-settings').isHidden());
      await page.locator('#open-settings').click();await page.mouse.click(2,2);assert.ok(await page.locator('#connection-settings').isHidden());
      await page.locator('#open-settings').click();await page.locator('#connection-settings [data-close-settings]').first().click();assert.ok(await page.locator('#connection-settings').isHidden());
      await page.reload();await page.locator('#open-settings').click();assert.ok(await page.locator('#confirm-invitation').isChecked());await page.locator('#confirm-invitation').uncheck();await page.locator('#connection-mode').selectOption('internet');await page.locator('#connection-settings [data-close-settings]').last().click();assert.equal(await page.locator('#connection-mode').inputValue(),'internet');
      checks.push({locale,width,threeTabs:true,rightGear:true,modal:true,keyboard:true,preferenceSaved:true});await context.close();
    }
  }
  assert.deepEqual(errors,[]);const report={passed:true,origin:base,testedAt:new Date().toISOString(),checks,errors};await writeFile('artifacts/web-settings'+(supplied?'-public':'')+'-verification.json',JSON.stringify(report,null,2));console.log('Web settings passed: five languages, three widths, three tabs, modal, keyboard, focus, four close actions and saved preference.');
}finally{await browser?.close();if(php){const exited=new Promise(r=>php.once('exit',r));php.kill();await exited;}if(directory){assert.equal(path.dirname(directory),path.resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}}
