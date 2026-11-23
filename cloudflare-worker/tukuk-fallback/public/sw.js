/**
 * Service worker for the tukuk-fallback Cloudflare Worker bundle.
 *
 * This is the offline copy served by the `tukuk-fallback` Worker when the VPS origin
 * is unreachable (see memory rules on R2 fallback + dead-tunnel recovery). Behaviour:
 *   - `install`: pre-caches the shell (index.html, manifest, PWA icons) so the site
 *     loads from cache even on the first cold offline visit.
 *   - `activate`: purges any older cache version so the app never serves a mix of stale
 *     and current assets.
 *   - `fetch`: network-first for GET requests (so live content stays live when we can
 *     reach the origin) with a cache fallback for offline and a background cache-write
 *     on every successful response.
 *
 * Never caches non-GET requests (search POSTs, admin mutations, chat SSE). Bump
 * CACHE_NAME whenever the shell assets change so existing clients get invalidated.
 */
const CACHE_NAME = 'tukuk-os-v1';
// Shell assets we always want available offline — kept deliberately tiny (PWA shell
// + icons only, no article text or user data).
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/build/icon-192.png',
  '/build/icon-512.png'
];

// Warm the cache on install and activate the new SW immediately so a returning visitor
// gets the current shell without a second reload.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Drop every cache except the current one so old versions don't shadow new shell files.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Network-first for GETs. Cache is only used when the origin is unreachable. Any 200
// response is written back into the cache so the offline copy keeps improving.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => cached);
      
      return cached || fetchPromise;
    })
  );
});
