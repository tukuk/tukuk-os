#!/usr/bin/env node
/**
 * Index the /books reading lists into the main search corpus (Meilisearch `halaman_web`).
 *
 *   node scripts/index-books.js            # upsert every shelf (skips when nothing changed)
 *   node scripts/index-books.js --force    # re-send all of them regardless
 *
 * Idempotent — the document id is derived from the shelf slug, so re-running updates the
 * document instead of adding a second one. The same call runs at boot (index.js, 8 s in);
 * this exists so an operator can index a build without restarting the server.
 */

const config = require('../src/config');
const { ensureIndex } = require('../src/meili');
const books = require('../src/books');
const { indexBooksShelves } = require('../src/books-index');

async function main() {
  const force = process.argv.includes('--force');
  console.log(`[index-books] connecting to ${config.meili.host} (index: ${config.indexName})...`);
  const index = await ensureIndex();
  const { count, skipped, removed } = await indexBooksShelves(index, books, { force });
  console.log(skipped
    ? `[index-books] OK — ${count} reading lists already indexed, nothing to do.`
    : `[index-books] OK — ${count} reading lists searchable${removed ? `, ${removed} retired` : ''}.`);
}

main().catch((error) => {
  console.error('[index-books] failed:', error.message);
  process.exit(1);
});
