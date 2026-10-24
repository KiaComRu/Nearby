import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {parse,parseFragment,serialize} from 'parse5';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {copy,locales,canonical,origin,hreflang,guideContent,structuredData,escape} from './seo-copy.mjs';

const root=new URL('./',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const version=JSON.parse(await read('version.json')).version;
await build({entryPoints:[fileURLToPath(new URL('seo-client.mjs',root))],bundle:true,format:'iife',globalName:'NearbySEO',platform:'browser',minify:true,outfile:fileURLToPath(new URL('seo.js',root))});
const revision=createHash('sha256').update(await read('seo.js')).update(await read('seo.css')).digest('hex').slice(0,12);
const source=await read('localize.js'),boundary=source.indexOf('  const query =');
if(boundary<0)throw new Error('Localization catalogue boundary missing');
// Reuse the trusted application's translation catalogue at build time. The
// prefix contains only the catalogue; DOM and browser code are not executed.
const {languages,rows}=vm.runInNewContext(source.slice(0,boundary)+'return {languages,rows};})();',{}, {timeout:1000});
const catalogue=new Map(rows.map(([ru,...translations])=>[ru,translations]));
const pwa=await read('pwa.js'),pwaStart=pwa.indexOf('const text = '),pwaEnd=pwa.indexOf('  function render()');
if(pwaStart<0||pwaEnd<0)throw new Error('PWA catalogue boundary missing');
const pwaCopy=vm.runInNewContext('('+pwa.slice(pwaStart+'const text = '.length,pwaEnd).trim().replace(/;$/,'')+')',{}, {timeout:1000});
for(const values of Object.values(pwaCopy))catalogue.set(values[0],values.slice(1));
const attr=(node,key)=>node.attrs?.find(item=>item.name===key)?.value;
function set(node,key,value){const found=node.attrs.find(item=>item.name===key);if(found)found.value=value;else node.attrs.push({name:key,value});}
function find(node,test){if(test(node))return node;for(const child of node.childNodes||[]){const result=find(child,test);if(result)return result;}}
function append(node,html){const nodes=parseFragment(html).childNodes;for(const child of nodes){child.parentNode=node;node.childNodes.push(child);}}
function translate(value,language){const translated=catalogue.get(value.trim())?.[languages.indexOf(language)];return translated?value.replace(value.trim(),translated):value;}
const raw=await read('index.html');
const manifests=JSON.parse(await read('manifest.webmanifest'));
await mkdir(new URL('locales/',root),{recursive:true});
await writeFile(new URL('locales/.htaccess',root),'Require all denied\n');
for(const language of locales){
  const doc=parse(raw),c=copy[language];const html=find(doc,node=>node.tagName==='html'),head=find(doc,node=>node.tagName==='head'),body=find(doc,node=>node.tagName==='body');
  set(html,'lang',language);set(html,'data-web-seo-locale',language);
  head.childNodes=head.childNodes.filter(node=>attr(node,'data-web-seo-head')===undefined&&!(node.tagName==='title')&&!(node.tagName==='meta'&&attr(node,'name')==='description'));
  const h1=find(body,node=>node.tagName==='h1'),lead=find(body,node=>attr(node,'class')?.split(' ').includes('lead')),badge=find(body,node=>attr(node,'class')?.split(' ').includes('badge'));
  for(const[node,key]of[[h1,'h1'],[lead,'lead'],[badge,'badge']]){set(node,'data-web-seo',key);node.childNodes=[];append(node,escape(c[key]));}
  let guide=find(body,node=>attr(node,'id')==='free-file-transfer');
  if(guide){guide.childNodes=[];append(guide,guideContent(language));set(guide,'data-language',language);}
  else{const pane=find(body,node=>attr(node,'id')==='connection-pane');append(pane,`<details id="free-file-transfer" class="web-search-guide" data-web-seo-guide data-language="${language}">${guideContent(language)}</details>`);}
  const manifest=find(head,node=>node.tagName==='link'&&attr(node,'rel')==='manifest');set(manifest,'href',language==='ru'?'manifest.webmanifest':`manifest-${language}.webmanifest`);
  const graph=JSON.stringify(structuredData(language,version)).replace(/</g,'\\u003c');
  append(head,`<title data-web-seo-head>${escape(c.title)}</title><meta data-web-seo-head name="description" content="${escape(c.description)}"><meta data-web-seo-head name="robots" content="index,follow,max-snippet:-1,max-image-preview:large"><link data-web-seo-head rel="canonical" href="${canonical(language)}">${locales.map(locale=>`<link data-web-seo-head rel="alternate" hreflang="${hreflang(locale)}" href="${canonical(locale)}">`).join('')}<link data-web-seo-head rel="alternate" hreflang="x-default" href="${canonical('ru')}"><meta data-web-seo-head property="og:type" content="website"><meta data-web-seo-head property="og:site_name" content="Nearby"><meta data-web-seo-head property="og:title" content="${escape(c.title)}"><meta data-web-seo-head property="og:description" content="${escape(c.description)}"><meta data-web-seo-head property="og:url" content="${canonical(language)}"><meta data-web-seo-head property="og:locale" content="${{ru:'ru_RU',en:'en_US',hi:'hi_IN','zh-CN':'zh_CN',es:'es_ES'}[language]}"><meta data-web-seo-head property="og:image" content="${origin}/assets/cover.png"><meta data-web-seo-head property="og:image:alt" content="${escape(c.h1)}"><meta data-web-seo-head name="twitter:card" content="summary_large_image"><meta data-web-seo-head name="twitter:title" content="${escape(c.title)}"><meta data-web-seo-head name="twitter:description" content="${escape(c.description)}"><meta data-web-seo-head name="twitter:image" content="${origin}/assets/cover.png"><link data-web-seo-head rel="stylesheet" href="seo.css?v=${revision}"><script data-web-seo-head id="web-structured-data" data-version="${version}" type="application/ld+json">${graph}</script>`);
  // Execute the SEO helper before the existing localization script.
  const seoScript=parseFragment(`<script data-web-seo-head defer src="seo.js?v=${revision}"></script>`).childNodes[0];seoScript.parentNode=head;
  const localeScript=head.childNodes.findIndex(node=>node.tagName==='script'&&/^localize\.js/.test(attr(node,'src')||''));head.childNodes.splice(localeScript,0,seoScript);
  if(language!=='ru'){
    const markers=new Map();
    function marker(node){if(!markers.has(node))markers.set(node,{text:{},attributes:{}});return markers.get(node);}
    function walk(node,protectedNode=false){
      const skip=protectedNode||['script','style','code'].includes(node.tagName)||attr(node,'data-web-seo')!==undefined||attr(node,'data-web-seo-guide')!==undefined;
      if(skip)return;
      if(node.attrs)for(const key of ['placeholder','aria-label','alt','title']){const original=attr(node,key);if(original){const output=translate(original,language);if(output!==original){marker(node).attributes[key]=original;set(node,key,output);}}}
      for(const[index,child]of(node.childNodes||[]).entries()){
        if(child.nodeName==='#text'){const original=child.value,output=translate(original,language);if(output!==original){marker(node).text[index]=original;child.value=output;}}
        else walk(child,skip);
      }
    }
    walk(body);for(const[node,value]of markers)set(node,'data-nearby-i18n',JSON.stringify(value));
  }
  await writeFile(new URL(language==='ru'?'index.html':`locales/${language}.html`,root),serialize(doc).replace(/[\t ]+$/gm,''));
  const localizedManifest={...manifests,name:c.appName,description:c.description,lang:language,start_url:language==='ru'?'./':`./?lang=${language}`};
  await writeFile(new URL(language==='ru'?'manifest.webmanifest':`manifest-${language}.webmanifest`,root),JSON.stringify(localizedManifest,null,2)+'\n');
}
const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${locales.map(language=>`<url><loc>${canonical(language)}</loc><lastmod>2026-10-24</lastmod>${locales.map(locale=>`<xhtml:link rel="alternate" hreflang="${hreflang(locale)}" href="${canonical(locale)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${canonical('ru')}"/></url>`).join('')}</urlset>\n`;
await writeFile(new URL('sitemap.xml',root),xml);
console.log('Built five server-rendered web languages, free-transfer metadata, instructions, FAQ, manifests and sitemap.');
