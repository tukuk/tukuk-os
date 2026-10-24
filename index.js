/**
 * Tukuk-OS entry point.
 *
 * Boot sequence, in order:
 *   1. Load local runtime store (settings, history, events) and start the network monitor.
 *   2. Wait for Meilisearch to be reachable, then wire the crawler to the primary index.
 *   3. Kick off deferred, non-blocking corpus pre-warming (blog posts, geo cluster hubs).
 *   4. Bind the HTTP server so /health responds quickly even if step 2 or 3 is still running.
 *   5. Warm slow external feeds (RSS, USGS quakes, Met Museum object IDs) in the background
 *      so the first visitor to each tab gets a warm cache instead of a cold 503.
 *   6. Attach the Agent editor WebSocket upgrade handler (allowed paths only — chat SSE and
 *      every other upgrade stays on the normal HTTP pipeline).
 *   7. Register SIGINT/SIGTERM handlers so a systemctl restart closes the listener cleanly
 *      instead of orphaning sockets.
 *
 * Every subsystem is fail-soft: a missing dependency downgrades the corresponding feature to
 * fallback mode, but the process itself never exits on boot-time errors — the search engine
 * and the static pages must remain reachable even if Meilisearch or Ollama is offline.
 */
const config = require('./src/config');
const { ensureIndex, health } = require('./src/meili');
const crawler = require('./src/crawler');
const net = require('./src/net');
const store = require('./src/store');
const { indexBlogPosts } = require('./src/blog-index');
const { indexGeoHubs, indexSectionHubs } = require('./src/cluster-index');
const { indexBooksShelves } = require('./src/books-index');
const { sectionHubs } = require('./src/section-hubs');
const { app, geoClusters, notifyIndexNow } = require('./src/server');
const news = require('./src/news');
const queries = require('./src/queries');
const nasa = require('./src/nasa');
const gempa = require('./src/gempa');
const seni = require('./src/seni');
const negara = require('./src/negara');
const bendera = require('./src/bendera');
const agentEditor = require('./src/agent-editor');
const warmup = require('./src/warmup');
const books = require('./src/books');
const recipes = require('./src/recipes');
const radar = require('./src/radar');

// ── Runtime resilience guard ────────────────────────────────────────────────
// The boot contract above is "the process never exits on subsystem errors", but
// that only covered *boot-time* failures. A runtime throw that escapes the
// request lifecycle still killed node: `compression`'s Brotli `onStreamEnd`
// fires from a stream 'end' tick after the route function has already returned,
// so Express's error middleware can't see it — when it races a closed response
// it throws ERR_HTTP_HEADERS_SENT, which propagated to the top and took the
// whole engine down (observed 2026-10-23: 24 crashes in a burst, systemd
// restart-looping every page offline). Install catch-all handlers so a single
// malformed response can never crash the server. They only keep the process
// alive once we are *serving*; a real startup failure still exits non-zero.
// Logging is throttled so a crash storm can't refill the size-capped journal.
let serving = false;
let lastGuardLog = 0;
let suppressedSinceLastLog = 0;
function reportRuntimeError(kind, err) {
  const detail = err && err.stack ? err.stack : String(err);
  if (!serving) {
    console.error(`[tukuk-os] fatal during startup, exiting: ${kind}: ${detail}`);
    process.exit(1);
  }
  const now = Date.now();
  if (now - lastGuardLog >= 1000) {
    if (suppressedSinceLastLog > 0) console.error(`[tukuk-os] ... ${suppressedSinceLastLog} similar suppressed`);
    lastGuardLog = now;
    suppressedSinceLastLog = 0;
    console.error(`[tukuk-os] ${kind} (kept alive, connection dropped): ${detail}`);
  } else {
    suppressedSinceLastLog += 1;
  }
}
process.on('uncaughtException', (err) => reportRuntimeError('UNCAUGHT EXCEPTION', err));
process.on('unhandledRejection', (reason) => reportRuntimeError('UNHANDLED REJECTION', reason));

/**
 * Poll Meilisearch until it reports "available", or throw after `attempts` tries.
 * @param {{attempts?: number, delayMs?: number}} [opts]
 * @returns {Promise<void>}
 */
async function waitForMeili({ attempts = 30, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const status = await health();
      if (status.status === 'available') return;
    } catch {
      if (attempt === attempts) {
        throw new Error(`Meilisearch unreachable at ${config.meili.host}. Make sure it is running.`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/**
 * Main boot routine. Never throws on subsystem failure — only on a fatal top-level error.
 * @returns {Promise<void>}
 */
async function main() {
  console.log('[tukuk-os] starting search engine...');
  store.load();
  net.start();
  const logged = queries.loadRecent();
  if (logged > 0) console.log(`[queries] ${logged} search log entries loaded`);

  net.onChange((state) => {
    store.event('info', `network -> ${state.status}`);
  });

  let index = null;
  try {
    await waitForMeili();
    console.log(`[meili] connected to ${config.meili.host}`);
    index = await ensureIndex();
    crawler.setIndex(index);
    console.log(`[meili] index ready: ${config.indexName}`);
    // Index the blog content into the main corpus so the curated guides/blog posts
    // are searchable at /search (idempotent; non-blocking — don't hold up cold start).
    indexBlogPosts(index)
      .then(({ count }) => { if (count > 0) console.log(`[blog-index] ${count} blog posts are searchable`); })
      .catch((err) => console.warn(`[blog-index] skipped: ${err.message}`));
    // The geo cluster hub pages belong to our corpus too — built from data that is
    // already loaded (no HTTP), deferred so cold start stays light. Without this,
    // /ask and /search are blind to the 612 clusters that we ourselves serve.
    setTimeout(() => {
      indexGeoHubs(index, geoClusters())
        .then(({ count, skipped }) => {
          if (!skipped) console.log(`[cluster-index] ${count} cluster hubs are searchable`);
        })
        .catch((err) => console.warn(`[cluster-index] skipped: ${err.message}`));
      // The section front doors (/countries, /weather, /holidays…) belong to the corpus too.
      // Only blog posts and geo clusters were indexed, so searching "weather" or "how many
      // countries" reached third-party pages instead of the answer we publish ourselves.
      sectionHubs().then((hubs) => indexSectionHubs(index, hubs)).catch((err) => console.warn(`[section-hubs] skipped: ${err.message}`));
      // And the 2,550 reading lists. They were published but never indexed, which is why
      // "beekeeping" and "climate change" reached a crawled BBC article while /books/bees
      // and /books/climate-change sat on this disk unanswered. Files only, no HTTP; the hash
      // guard means a restart that changed nothing sends nothing.
      indexBooksShelves(index, books)
        .then(({ count, skipped }) => { if (!skipped && count) console.log(`[books-index] ${count} reading lists are searchable`); })
        .catch((err) => console.warn(`[books-index] skipped: ${err.message}`));
    }, 8000);
  } catch (error) {
    // Don't die — the search engine can still answer from the fallback cache.
    console.warn(`[tukuk-os] WARNING: ${error.message}`);
    console.warn('[tukuk-os] search will use fallback mode until Meilisearch recovers.');
  }

  const server = app.listen(config.port, config.host, () => {
    serving = true; // the resilience guard now logs & continues instead of exiting
    // Posts that syncPostsFromContent ADDED to the store during this boot are
    // submitted too — previously only the admin publish route pinged IndexNow.
    const freshSlugs = store.takeContentNewSlugs();
    if (freshSlugs.length) notifyIndexNow(freshSlugs.map((s) => `https://tukuk.org/blog/${s}`));
    console.log(`[tukuk-os] search engine running at http://${config.host}:${config.port}`);
    console.log(`[tukuk-os] health: http://localhost:${config.port}/health  |  search: http://localhost:${config.port}/search?q=word`);
    console.log(`[tukuk-os] ask:    http://localhost:${config.port}/ask?q=question     |  dev: http://localhost:${config.port}/dev`);
    if (!index) {
      console.log('[tukuk-os] fallback-only mode — check systemctl --user status meilisearch');
    }
    if (!config.brain.enabled) {
      console.log('[tukuk-os] brain disabled (BRAIN_ENABLED=false)');
    }
    // Pre-refresh the RSS feeds so the News tab is fast on the first request.
    setTimeout(() => {
      news.refresh()
        .then((n) => { if (n > 0) console.log(`[news] ${n} RSS items ready`); })
        .catch(() => {});
    }, 3000);
    // Warm the earthquake feeds (a USGS query can take ~8s) so the first visitor
    // gets a warm cache instead of a cold 503. Non-blocking, fails silently.
    setTimeout(() => {
      Promise.all([
        gempa.regionFeed(gempa.findRegion('world')).catch(() => {}),
        gempa.regionFeed(gempa.findRegion('malaysia')).catch(() => []),
      ]).catch(() => {});
    }, 4000);
    // Warm the art-gallery objectID list (Met API) for sitemap-seni so the crawler's
    // first GET is already loaded. buildObjectUrls runs in the background, non-blocking
    // and self-handled (never rejects); the sitemap serves the static part if still cold.
    setTimeout(() => { seni.buildObjectUrls(3).catch(() => {}); }, 6000);
    // Warm the flag-story snapshot (English Wikipedia summaries, cached 30 days on disk)
    // so the first visitor to /bendera reads a real story instead of an empty page.
    // Bounded to the priority flags, polite 800 ms spacing, fail-soft.
    setTimeout(() => {
      negara.loadCountries()
        .then((rows) => bendera.warmStories(rows, bendera.PRIORITY.length))
        .catch(() => {});
    }, 9000);
    // Warm the pages whose first render after a restart is expensive (/nasa/sounds was
    // 13.6 s cold vs 0.68 s warm, /academy/body 8.3 s vs 0.86 s). Sequential, spaced and
    // fail-soft; WARMUP=0 turns it off. See src/warmup.js.
    setTimeout(() => {
      const plan = warmup.plan(process.env, config.port);
      if (!plan) {
        console.log('[warmup] disabled (WARMUP=0)');
        return;
      }
      warmup.start(plan).catch(() => {});
    }, 15000);
    // Build the twenty-six reading lists before anybody asks for one. A cold /books page
    // waits on an Open Library search that has measured up to 13 s, and the first visitor
    // after a deploy should not be the one who pays for it. Sequential, spaced, retried
    // once, and it never rejects — the disk mirror covers whatever the network refused.
    setTimeout(() => { books.prime().catch(() => {}); }, 20000);
    // And fill the twenty-seven recipe shelves. A cold shelf costs two or three seconds of
    // Wikibooks API, and a dish page cannot be built without its shelf. Read after the
    // reading lists so the two do not queue behind each other on a slow link; sequential and
    // spaced inside, because that wiki is a shared free service and not our own database.
    setTimeout(() => { recipes.prime().catch(() => {}); }, 30000);
    // Live runtime for /maps/live. If a free aisstream.io token is configured, open ONE
    // inbound AIS socket over the busy lanes and keep the vessel store warm for every
    // viewer; with no token this is a deliberate no-op and the ships layer just reads
    // "not enabled" — never a crash, never a fake dot. Then warm one aircraft box so the
    // first visitor to the page gets a snapshot instead of a cold wait. Both fail-soft.
    radar.startAis();
    setTimeout(() => { radar.aircraft(3.1, 101.6, 150).catch(() => {}); }, 10000);
    // APOD auto-update + NASA archive backfill — OFF unless NASA_AUTO=1.
    // The NASA pages were removed (content focus + a light server); they are disabled
    // by default so the VPS does not waste CPU/network/disk on them.
    if (process.env.NASA_AUTO === '1') {
      nasa.startApodAutoUpdate();
      console.log(`[nasa] APOD auto-update every ${config.nasa.apodRefreshMinutes} minutes`);
      nasa.startArchiveBackfill();
    } else {
      console.log('[nasa] background work disabled (NASA_AUTO!=1) — content/light mode');
    }
  });

  // The Tukuk Agent editor WebSocket (/agent/...) — an allowed Upgrade goes straight
  // to the local code-server; this listener never touches other upgrades (chat SSE etc.).
  agentEditor.attachUpgrade(server, { config });

  // Handle SIGINT / SIGTERM (systemctl stop / restart / Ctrl-C) by tearing down in reverse
  // order: stop the network probe first, then background timers, then flush the on-disk
  // store, then close the HTTP listener with a 5s hard-kill backstop so a stuck socket
  // can never block a service restart.
  const shutdown = (signal) => async () => {
    console.log(`\n[tukuk-os] received ${signal}, shutting down gracefully...`);
    net.stop();
    radar.stopAis();
    nasa.stopApodAutoUpdate();
    nasa.stopArchiveBackfill();
    store.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[tukuk-os] failed to start:', error.message);
  process.exit(1);
});