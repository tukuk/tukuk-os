const config = require('./src/config');
const { ensureIndex, health } = require('./src/meili');
const crawler = require('./src/crawler');
const net = require('./src/net');
const store = require('./src/store');
const { indexBlogPosts } = require('./src/blog-index');
const { app } = require('./src/server');
const news = require('./src/news');
const queries = require('./src/queries');
const nasa = require('./src/nasa');
const agentEditor = require('./src/agent-editor');

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
    console.log(`[meili] terhubung ke ${config.meili.host}`);
    index = await ensureIndex();
    crawler.setIndex(index);
    console.log(`[meili] index sedia: ${config.indexName}`);
    // Indekskan kandungan blog ke korpus utama supaya panduan/blog kurasi boleh
    // dicari di /search (idempotent; non-blocking — jangan tahan cold start).
    indexBlogPosts(index)
      .then(({ count }) => { if (count > 0) console.log(`[blog-index] ${count} post blog boleh dicari`); })
      .catch((err) => console.warn(`[blog-index] dilewati: ${err.message}`));
  } catch (error) {
    // Jangan mati — enjin carian masih boleh menjawab daripada cache fallback.
    console.warn(`[tukuk-os] AMARAN: ${error.message}`);
    console.warn('[tukuk-os] search will use fallback mode until Meilisearch recovers.');
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(`[tukuk-os] search engine running at http://${config.host}:${config.port}`);
    console.log(`[tukuk-os] health: http://localhost:${config.port}/health  |  search: http://localhost:${config.port}/search?q=word`);
    console.log(`[tukuk-os] ask:    http://localhost:${config.port}/ask?q=question     |  dev: http://localhost:${config.port}/dev`);
    if (!index) {
      console.log('[tukuk-os] fallback-only mode — check systemctl --user status meilisearch');
    }
    if (!config.brain.enabled) {
      console.log('[tukuk-os] brain disabled (BRAIN_ENABLED=false)');
    }
    // Pra-refresh feed RSS supaya tab News pantas pada permintaan pertama.
    setTimeout(() => {
      news.refresh()
        .then((n) => { if (n > 0) console.log(`[news] ${n} item RSS sedia`); })
        .catch(() => {});
    }, 3000);
    // Auto-update APOD + backfill arkib NASA — NYALI hanya bila NASA_AUTO=1.
    // Halaman NASA sudah dibuang (fokus konten + server ringan); secara lalai
    // dimatikan supaya tak bazir CPU/jaringan/disk pada VPS.
    if (process.env.NASA_AUTO === '1') {
      nasa.startApodAutoUpdate();
      console.log(`[nasa] auto-update APOD setiap ${config.nasa.apodRefreshMinutes} minit`);
      nasa.startArchiveBackfill();
    } else {
      console.log('[nasa] kerja latar dimatikan (NASA_AUTO!=1) — mod konten/ringan');
    }
  });

  // WebSocket editor Tukuk Agent (/agent/...) —Upgrade lulus terus ke
  // code-server tempatan; listener ini tak sentuh upgrade lain (chat SSE dsb.).
  agentEditor.attachUpgrade(server, { config });

  const shutdown = (signal) => async () => {
    console.log(`\n[tukuk-os] menerima ${signal}, menutup dengan perlahan...`);
    net.stop();
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