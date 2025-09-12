const STATIC_CACHE = 'static-v1';
const ASSETS = ['/', '/index.html', '/app.js', '/idb.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'GET' && url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(_ => cached))
    );
  }
});