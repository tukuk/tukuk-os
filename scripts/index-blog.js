#!/usr/bin/env node
/**
 * Indekskan kandungan blog ke korpus carian utama (Meilisearch `halaman_web`).
 *
 *   node scripts/index-blog.js
 *
 * Idempotent — id dokumen derivatif daripada slug, jadi jalan semula akan
 * KEMAS KINI dokumen sedia ada, bukan tambah duplikat. config.js memuat .env
 * sendiri, jadi MEILI_HOST / MEILI_MASTER_KEY dibaca automatik.
 */

const config = require('../src/config');
const { ensureIndex } = require('../src/meili');
const { indexBlogPosts } = require('../src/blog-index');

async function main() {
  console.log(`[index-blog] menyambung ke ${config.meili.host} (index: ${config.indexName})...`);
  const index = await ensureIndex();
  const { count } = await indexBlogPosts(index);
  if (count === 0) {
    console.warn('[index-blog] TIADA post store untuk diindeks — jalankan store.load() / import-posts dahulu.');
    return;
  }
  console.log(`[index-blog] OK — ${count} post blog kini boleh dicari di /search.`);
}

main().catch((error) => {
  console.error('[index-blog] gagal:', error.message);
  process.exit(1);
});
