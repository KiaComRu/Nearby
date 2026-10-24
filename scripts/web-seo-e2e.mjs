import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,cp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {copy,locales,canonical,hreflang} from '../browser/seo-copy.mjs';
import {metrikaCsp} from '../site/metrika-policy.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'nearby-web-seo-'));
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const host=`http://127.0.0.1:${port}`,base=host+'/web/';
let server,exited,browser;const results=[],errors=[];
try{
  await cp('browser',path.join(directory,'web'),{recursive:true,filter:file=>path.basename(file)!=='config.private.php'});
  server=spawn(process.env.PHP_PATH||'php',['-S',`127.0.0.1:${port}`,'-t',directory],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:path.join(directory,'state')}});exited=once(server,'exit');
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true});
  for(const language of locales){
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
    const page=await context.newPage();
    const response=await page.goto(base+(language==='ru'?'':'?lang='+language));assert.equal(response.status(),200);assert.equal(response.headers()['content-language'],language);
    assert.equal(await page.locator('html').getAttribute('lang'),language);
    assert.equal(await page.title(),copy[language].title);assert.equal(await page.locator('h1').textContent(),copy[language].h1);
    assert.equal(await page.locator('meta[name=description]').getAttribute('content'),copy[language].description);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),canonical(language));
    assert.equal(await page.locator('link[rel=alternate][hreflang]').count(),6);
    for(const other of locales)assert.equal(await page.locator(`link[hreflang="${hreflang(other)}"]`).getAttribute('href'),canonical(other));
    for(const selector of ['meta[property="og:title"]','meta[name="twitter:title"]'])assert.equal(await page.locator(selector).getAttribute('content'),copy[language].title);
    assert.ok((await page.locator('meta[name=robots]').getAttribute('content')).includes('index,follow'));
    const graph=JSON.parse(await page.locator('#web-structured-data').textContent())['@graph'];
    const application=graph.find(node=>node['@type']==='WebApplication');assert.equal(application.offers.price,'0');assert.equal(application.isAccessibleForFree,true);
    const faq=graph.find(node=>node['@type']==='FAQPage');assert.equal(faq.mainEntity.length,7);
    const questions=page.locator('.web-search-question');assert.equal(await questions.count(),7);
    for(let i=0;i<7;i++){assert.equal(await questions.nth(i).locator('summary').textContent(),faq.mainEntity[i].name);assert.equal(await questions.nth(i).locator('p').textContent(),faq.mainEntity[i].acceptedAnswer.text);}
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:844});
      await page.locator('#free-file-transfer>summary').click();await questions.first().locator('summary').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),language+': horizontal overflow');
      assert.ok(await page.locator('.web-search-content').evaluate(node=>node.scrollWidth<=node.clientWidth),language+': guide overflow');
      await page.locator('#free-file-transfer').screenshot({path:`artifacts/web-seo-${language}-${width}.png`});
      await page.locator('#free-file-transfer>summary').click();
    }
    if(language!=='ru'){
      const untranslated=await page.locator('body').evaluate(body=>{const clone=body.cloneNode(true);for(const node of clone.querySelectorAll('script,style,.web-search-languages'))node.remove();return clone.textContent.match(/[А-Яа-яЁё][А-Яа-яЁё\s.,:—·↗!?/()0-9-]*/g)||[];});
      assert.deepEqual(untranslated,[],language+': Russian in server-rendered content');
    }
    const manifest=await(await fetch(base+(language==='ru'?'manifest.webmanifest':`manifest-${language}.webmanifest`))).json();assert.equal(manifest.lang,language);assert.equal(manifest.id,'./');assert.ok(manifest.description.includes(copy[language].free.toLowerCase())||manifest.description.includes(copy[language].free));
    results.push({language,serverRendered:true,freeQueries:true,canonical:true,hreflang:true,matchingStructuredData:true,localizedManifest:true,mobileLayout:true});await context.close();
  }
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==host)return route.abort();if(route.request().isNavigationRequest()){const response=await route.fetch();return route.fulfill({response,headers:{...response.headers(),'content-security-policy':metrikaCsp}});}return route.continue();});
  await context.addInitScript(()=>{window.seoViolations=[];document.addEventListener('securitypolicyviolation',event=>window.seoViolations.push(event.effectiveDirective));});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'?lang=es');await page.locator('#web-language-choice').waitFor();
  for(const language of ['ru','en','hi','zh-CN','es']){
    await page.locator('#web-language-choice').selectOption(language);assert.equal(await page.title(),copy[language].title);assert.equal(await page.locator('h1').textContent(),copy[language].h1);
    assert.equal(new URL(page.url()).searchParams.get('lang'),language==='ru'?null:language);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),canonical(language));
  }
  await page.locator('#free-file-transfer>summary').click();await page.locator('[data-seo-language=en]').click();assert.equal(await page.locator('#web-language-choice').inputValue(),'en');assert.ok(page.url().startsWith(host),'Language links must keep the current document');
  assert.deepEqual(await page.evaluate(()=>seoViolations),[],'Strict CSP must allow the metadata and app');assert.deepEqual(errors,[]);
  for(const query of ['?lang=../../config.private.php','?lang[]=en','?lang=unsupported']){const response=await fetch(base+query);assert.equal(response.status,200);assert.equal(response.headers.get('content-language'),'ru');}
  const sitemap=await(await fetch(base+'sitemap.xml')).text();assert.equal((sitemap.match(/<loc>/g)||[]).length,5);for(const language of locales)assert.ok(sitemap.includes('<loc>'+canonical(language)+'</loc>'));
  await writeFile('artifacts/web-seo-verification.json',JSON.stringify({passed:true,version:'0.6.5',testedAt:new Date().toISOString(),pages:results,languageSwitchWithoutNavigation:true,strictCsp:true,malformedLanguageSafe:true,sitemapLanguages:5,errors},null,2));
  console.log('Web SEO passed: five HTML languages without JavaScript, four free-transfer queries, matching schema, localized manifests, mobile layout, safe switching and strict CSP.');
}finally{await browser?.close();if(server){server.kill();await exited;}assert.equal(path.dirname(directory),path.resolve(tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:200});}
