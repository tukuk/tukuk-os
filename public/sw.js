const CACHE_NAME = 'tukuk-os-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/manifest-chat.json',
  '/manifest-os.json',
  '/os',
  '/os.html',
  '/apps/chat',
  '/build/icon-192.png',
  '/build/icon-512.png',
  '/icons/apps/chat.svg',
  '/icons/apps/chat-192.png',
  '/icons/apps/chat-512.png',
  '/icons/apps/chat-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Off origin: leave it to the browser (ads, image CDNs, etc.)
  if (url.origin !== self.location.origin) return;

  // API and SSE streams: never touch them. `response.clone()` + `cache.put()`
  // on a response that never ends (/api/chat/stream) would build a stalled
  // tee — the frames never reach the page and the SW heap grows.
  // API data is of no use offline anyway.
  if (url.pathname.startsWith('/api/')) return;
  if ((event.request.headers.get('accept') || '').includes('text/event-stream')) return;

  if (event.request.mode === 'navigate') {
    // HTML: network first, so visitors always get the current version.
    // The cache is only used when the network fails (offline).
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Same-origin static assets (css/js/icons): network first, cache only when offline.
  // (cache-first made stale CSS show up during an audit / the start of a new session.)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Web Push ───
// Push is sent with an empty body — the SW shows a generic notification. Clicking
// it opens or focuses the T Chat app.
self.addEventListener('push', (event) => {
  const title = 'T Chat';
  const body = event.data
    ? event.data.text()
    : 'You have a new message.';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/apps/chat-192.png',
      badge: '/icons/apps/chat-192.png',
      tag: 'tukuk-chat',
      data: { url: '/apps/chat' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(event.notification.data?.url || '/apps/chat');
    })
  );
});
