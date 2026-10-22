#!/usr/bin/env node
/**
 * Index the blog content into the main search corpus (Meilisearch `halaman_web`).
 *
 *   node scripts/index-blog.js
 *
 * Idempotent — the document id is derived from the slug, so re-running will
 * UPDATE the existing document instead of adding a duplicate. config.js loads
 * .env on its own, so MEILI_HOST / MEILI_MASTER_KEY are picked up automatically.
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
