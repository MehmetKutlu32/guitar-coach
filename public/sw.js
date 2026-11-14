/* Gitar Çalışma — service worker. Liste ve sürüm build sırasında doldurulur (vite.config.ts). */
const VERSION = '__VERSION__';
const CACHE = 'gitar-' + VERSION;
const FILES = /*__PRECACHE__*/[];
const INDEX = new URL('./index.html', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new URL(f, self.location).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('gitar-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const index = await cache.match(INDEX);
        if (index) return index;
      }
      try {
        return await fetch(req);
      } catch (err) {
        const index = req.mode === 'navigate' ? await cache.match(INDEX) : undefined;
        if (index) return index;
        throw err;
      }
    })(),
  );
});
