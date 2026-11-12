#!/usr/bin/env node
/**
 * backfill-quality.js — one-off index maintenance, safe to re-run.
 *
 * The tie-break ranking rule (see RANKING_RULES in src/meili.js) needs a numeric `quality`
 * on every document. Pages crawled before that rule existed have none, and Meilisearch
 * documents the rule as UNDEFINED when a document lacks the field. This walks the index once
 * and writes CRAWLED_QUALITY on exactly the documents that have no score, leaving ours alone.
 *
 * Usage, on the machine that runs Meilisearch (it reads the repo-root .env):
 *   node scripts/backfill-quality.js
 */
'use strict';
const { client, indexName, backfillQuality } = require('../src/meili');

(async () => {
  const index = client.index(indexName);
  const { scanned, updated } = await backfillQuality(index);
  console.log(`[backfill-quality] "${indexName}": ${scanned} scanned, ${updated} updated`);
})().catch((error) => {
  console.error(`[backfill-quality] FAILED: ${error.message}`);
  process.exit(1);
});
