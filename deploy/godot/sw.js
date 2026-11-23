// tukuk-play service worker — play.tukuk.org only.
//
// WHY THIS EXISTS
//   The Godot shell pulls ~476 MB of pack plus ~38 MB of engine on every cold
//   load. The heavy artifacts are already published as hash-versioned URLs
//   (index.pck.zip?v=pck<hash>, index.wasm.zip?v=wasm<hash>, index.js?v=js<hash>)
//   with `Cache-Control: immutable`, and the CDN holds them — but the browser's
//   HTTP cache is best-effort: on a small-disk laptop, after days without a
//   visit, or after any cache pressure, the 476 MB file is simply evicted and
//   the next open re-downloads everything. That re-download is what the user
//   experiences as "always downloading again".
//
//   Cache Storage is explicit and much stickier — and with navigator.storage
//   .persist() requested from the page (see web-head.html) it is exempt from
//   eviction under storage pressure. This worker answers the immutable,
//   content-addressed artifacts from that cache whenever it holds them, so a
//   returning visitor downloads nothing at all. A republish changes the hash in
//   the URL, which is a brand-new cache key — so a stale artifact is impossible
//   by construction, and `immutable` on a hash is what makes the cache-first
//   read safe here.
//
// THE MEMORY TRAP
//   Response bodies are single-use streams. Handling a 476 MB download naively
//   (await res.arrayBuffer(), or building the Response before handing it to
//   cache.put) buffers the whole pack in memory and OOM-kills the tab on a
//   weak laptop — the crash this whole effort exists to remove. So:
//     - on a cache MISS the body is TAPPED, not buffered: a ReadableStream tee
//       writes to Cache Storage while the page consumes the response, and
//       `Cache.put(url, streamResponse)` itself accepts a streamed body;
//     - on a cache HIT the cached Response is returned untouched — never read,
//       never re-wrapped, zero added memory on top of what the engine needs.
//
// SCOPE
//   Only the versioned artifacts are cached. index.html stays network (nginx
//   serves it `no-cache`) so a new build's rewritten shell always takes effect
//   on the very next visit, and the bare /index.pck /index.wasm URLs 404 at
//   nginx anyway. The first load of a NEW build is served from the CDN like
//   before; this worker only ever answers after the artifact has been stored.
//   Storing a new version prunes the old one (see retire): the artifact names
//   are stable across builds, so without it every republish would leave another
//   ~500 MB behind on the visitor's disk under a different ?v=.
(self => {
  'use strict';

  const CACHE = 'tukuk-play-artifacts-v1';

  // The publish step rewrites these three extensions to carry ?v=<hash>. A
  // versioned URL can never change content, which is the license for
  // cache-first. Anything without ?v= is NOT an artifact and goes to network.
  const ARTIFACT = /\.(?:pck\.zip|wasm\.zip|js|audio\.worklet\.js|audio\.position\.worklet\.js)$/;
  const isArtifact = url => ARTIFACT.test(url.pathname) && url.searchParams.has('v');

  // Drop every other ?v= of this same file. Runs after a successful store, so a
  // republish costs the visitor nothing on disk: the old pack is gone the moment
  // the new one is in. A delete racing another put only ever removes an entry the
  // next visit re-fetches from the CDN, so failure here is not worth a log.
  async function retire(cache, url) {
    const keys = await cache.keys();
    await Promise.all(keys
      .filter(req => {
        try {
          const old = new URL(req.url);
          return old.origin === url.origin && old.pathname === url.pathname && req.url !== url.href;
        } catch (ignored) {
          return false;
        }
      })
      .map(req => cache.delete(req.url))
    );
  }

  self.addEventListener('install', () => self.skipWaiting());

  self.addEventListener('activate', event => {
    // Drop every older cache generation, then take control so the very next
    // load of the shell is served through this worker.
    event.waitUntil(
      caches.keys()
        .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !isArtifact(url)) return;

    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const hit = await cache.match(url.href, { ignoreSearch: false });
        if (hit) return hit; // streamed straight to the page; never buffered here

        const response = await fetch(request);
        // Only a good answer deserves to be kept: an opaque range failure or a
        // 500 from the tunnel must not fossilise into the persistent cache.
        if (!response || !response.ok || response.status !== 200) return response;

        // Tap the body: the page receives one branch, the cache receives the
        // other, both streaming. If the visitor closes the tab mid-download the
        // tee errors and nothing is stored — the next visit retries cleanly.
        const [forPage, forCache] = response.body.tee();
        cache.put(url.href, new Response(forCache, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        })).then(() => retire(cache, url)).catch(() => { /* disk full or aborted tap; HTTP cache still applies */ });

        return new Response(forPage, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        });
      })
    );
  });
})(self);
