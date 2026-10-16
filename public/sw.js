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
  // Luar domain: biar pelayar urus sendiri (iklan, CDN imej, dsb.)
  if (url.origin !== self.location.origin) return;

  // API & aliran SSE: jangan sentuh langsung. `response.clone()` + `cache.put()`
  // pada respons yang tidak pernah tamat (/api/chat/stream) akan membuat tee
  // tertahan — bingkai tidak sampai ke halaman dan ingatan SW membengkak.
  // Data API pula memang tiada gunanya bila luar talian.
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.headers.get('accept') || '').includes('text/event-stream')) return;

  if (event.request.mode === 'navigate') {
    // HTML: rangkaian dulu supaya pelanggan sentiasa dapat versi terkini.
    // Cache hanya digunakan bila rangkaian gagal (offline).
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

  // Aset statik same-origin (css/js/ikon): rangkaian dulu, cache hanya bila offline.
  // (cache-first menyebabkan CSS basi kelihatan semasa audit/mula sesi baharu.)
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
// Push dihantar dengan badan kosong — SW memaparkan notifikasi generik. Klik pada
// notifikasi akan membuka/menfokos aplikasi T Chat.
self.addEventListener('push', (event) => {
  const title = 'T Chat';
  const body = event.data
    ? event.data.text()
    : 'Anda menerima mesej baru.';
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
