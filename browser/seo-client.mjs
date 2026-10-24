import {copy,locales,canonical,guideContent,structuredData} from './seo-copy.mjs';

export function apply(language) {
  if (!locales.includes(language)) return;
  const c=copy[language];document.title=c.title;
  for(const node of document.querySelectorAll('[data-web-seo]')){
    const key=node.dataset.webSeo;if(c[key]&&node.textContent!==c[key])node.textContent=c[key];
  }
  const description=document.querySelector('meta[name=description]');if(description)description.content=c.description;
  for(const [selector,value] of [
    ['meta[property="og:title"]',c.title],['meta[property="og:description"]',c.description],['meta[property="og:url"]',canonical(language)],
    ['meta[property="og:locale"]',{ru:'ru_RU',en:'en_US',hi:'hi_IN','zh-CN':'zh_CN',es:'es_ES'}[language]],
    ['meta[name="twitter:title"]',c.title],['meta[name="twitter:description"]',c.description],['meta[property="og:image:alt"]',c.h1],
  ]){const node=document.querySelector(selector);if(node)node.content=value;}
  const link=document.querySelector('link[rel=canonical]');if(link)link.href=canonical(language);
  const manifest=document.querySelector('link[rel=manifest]');if(manifest)manifest.href=language==='ru'?'manifest.webmanifest':`manifest-${language}.webmanifest`;
  const guide=document.getElementById('free-file-transfer');
  if(guide&&guide.dataset.language!==language){guide.innerHTML=guideContent(language);guide.dataset.language=language;}
  const data=document.getElementById('web-structured-data');
  if(data)data.textContent=JSON.stringify(structuredData(language,data.dataset.version));
  // Keep the existing document and fragment: changing language must preserve
  // the invitation, active channels, selected files and encryption keys.
  const url=new URL(location.href);
  if(language==='ru')url.searchParams.delete('lang');else url.searchParams.set('lang',language);
  if(url.href!==location.href)history.replaceState(history.state,'',url);
}

document.addEventListener('click',event=>{
  const link=event.target.closest?.('[data-seo-language]');
  if(!link||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const select=document.getElementById('web-language-choice');if(!select)return;
  event.preventDefault();select.value=link.dataset.seoLanguage;select.dispatchEvent(new Event('change',{bubbles:true}));
});
