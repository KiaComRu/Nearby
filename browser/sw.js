// Generated as sw.js by build-pwa.mjs. Only the public offline screen is cached.
const ROOT = new URL('./', self.location.href);
const PREFIX = `nearby-pwa-offline-${encodeURIComponent(ROOT.pathname)}-`;
const CACHE = PREFIX + 'b959b52f70d38ea649a0';
const ASSETS = ['offline.html', 'pwa-offline.css', 'pwa-offline.js'].map(name => new URL(name, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload', credentials: 'omit' })))));
  // Normal waiting lifecycle: never replace a worker underneath an active transfer.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin) return;
  if (ASSETS.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.href)) || fetch(request))); return;
  }
  if (request.mode !== 'navigate' || ![ROOT.pathname, ROOT.pathname + 'index.html'].includes(url.pathname)) return;
  event.respondWith(fetch(request).catch(async () => {
    const offline = await (await caches.open(CACHE)).match(ASSETS[0]);
    return offline ? new Response(offline.body, { status: 503, statusText: 'Offline', headers: offline.headers }) : Response.error();
  }));
});
