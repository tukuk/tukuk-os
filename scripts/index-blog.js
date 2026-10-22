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
  console.log(`[index-blog] connecting to ${config.meili.host} (index: ${config.indexName})...`);
  const index = await ensureIndex();
  const { count } = await indexBlogPosts(index);
  if (count === 0) {
    console.warn('[index-blog] no post store to index — run store.load() / import-posts first.');
    return;
  }
  console.log(`[index-blog] OK — ${count} blog posts are now searchable at /search.`);
}

main().catch((error) => {
  console.error('[index-blog] failed:', error.message);
  process.exit(1);
});
