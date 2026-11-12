#!/usr/bin/env node
/**
 * Merge the uji_coba index (32k+ English documents) into the main halaman_web index.
 * A copy, not a move — uji_coba stays untouched as the original source.
 * Use: node scripts/merge-index.js
 */
const { client } = require('../src/meili');

const FROM = 'uji_coba';
const TO = 'halaman_web';
const BATCH = 1000;

async function main() {
  const from = client.index(FROM);
  const to = client.index(TO);

  const fromStats = await from.getStats();
  const toStats = await to.getStats();
  console.log(`[merge] ${FROM}: ${fromStats.numberOfDocuments} documents -> ${TO} (${toStats.numberOfDocuments} already there)`);

  let offset = 0;
  let copied = 0;
  for (;;) {
    const res = await from.getDocuments({ offset, limit: BATCH });
    const docs = Array.isArray(res) ? res : (res.results || []);
    if (docs.length === 0) break;
    const task = await to.addDocuments(docs);
    await client.tasks.waitForTask(task.taskUid);
    copied += docs.length;
    process.stdout.write(`[merge] ...${copied}\r`);
    if (docs.length < BATCH) break;
    offset += BATCH;
  }

  const after = await to.getStats();
  console.log(`\n[merge] done: ${copied} documents copied; ${TO} now ${after.numberOfDocuments} documents`);
}

main().catch((err) => {
  console.error('[merge] FAILED:', err.message || err);
  process.exit(1);
});
