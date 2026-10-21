// The same counter is used by the public website and its web/PWA application.
(() => {
  'use strict';
  if (location.hostname !== 'nearby.kiacom.ru' || window.__nearbyMetrika113717603) return;
  window.__nearbyMetrika113717603 = true;
  const application = location.pathname.startsWith('/web/');
  // The application module consumes invitations before this module runs.
  // If it failed to start, never load analytics while its keys are in the URL.
  if (application && [location.hash.slice(1),location.search.slice(1)].some(value => {
    const params = new URLSearchParams(value); return ['room','key','secret','token','admin'].some(name=>params.has(name));
  })) return;
  function pageUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      if (application || url.pathname.startsWith('/web/')) { url.hash = ''; url.search = ''; }
      return url.href;
    } catch { return ''; }
  }
  if (application) {
    // Mark sensitive containers before loading Session Replay. Descendants,
    // including file thumbnails and newly received rows, inherit this masking.
    const hidden = '#invitation,#invitation-id,#peer-request,#connection-detail,#device-list,#recipient-name,#remaining-name,#transfers,#outgoing-transfers,#notice,.receive-folder-name,.transfer-status-tooltip';
    const protect = () => {
      for (const element of document.querySelectorAll(hidden)) element.classList.add('ym-hide-content');
      for (const input of document.querySelectorAll('input,textarea')) input.classList.add('ym-disable-keys');
    };
    protect();
    // Tooltips are mounted outside the transfer tables.
    new MutationObserver(records => { if (records.some(record => record.addedNodes.length)) protect(); }).observe(document.body, { childList: true, subtree: true });
  }
  (function(m,e,t,r,i,k,a){
    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j=0;j<document.scripts.length;j++) { if (document.scripts[j].src===r) return; }
    k=e.createElement(t);a=e.getElementsByTagName(t)[0];k.async=1;k.src=r;a.parentNode.insertBefore(k,a);
  })(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=113717603','ym');
  window.ym(113717603,'init',{
    ssr:true,webvisor:true,clickmap:true,ecommerce:'dataLayer',
    referrer:pageUrl(document.referrer),url:pageUrl(location.href),
    accurateTrackBounce:true,trackLinks:true,trackHash:false
  });
})();
