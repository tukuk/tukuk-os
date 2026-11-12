#!/usr/bin/env node
/**
 * Restore a gzipped JSON export (produced by scripts/export-index.js) into Meilisearch.
 *
 *   node scripts/import-index.js <file.json.gz> [index-name]
 *
 * Reads from env: MEILI_HOST, MEILI_MASTER_KEY.
 */

const fs = require('fs');
const zlib = require('zlib');

const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const FILE = process.argv[2];
const OVERRIDE_INDEX = process.argv[3] || null;
const BATCH = 500;
// A large index (tens of thousands of documents) on an old CPU can take several minutes.
const TASK_TIMEOUT_MS = Number(process.env.IMPORT_TASK_TIMEOUT_MS || 900000);

if (!FILE) {
  console.error('usage: node scripts/import-index.js <file.json.gz> [index]');
  process.exit(1);
}
if (!KEY) {
  console.error('MEILI_MASTER_KEY is empty');
  process.exit(1);
}

function request(method, pathname, body) {
  return fetch(`${MEILI}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  }).then(async (res) => {
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  });
}

async function waitForTasks(taskUids, timeoutMs = TASK_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = taskUids.filter((uid) => uid != null);
    if (!pending.length) return;
    const res = await request('GET', `/tasks?uids=${pending.join(',')}&limit=100`);
    const done = res.results.every((task) => ['succeeded', 'failed', 'canceled'].includes(task.status));
    const failed = res.results.filter((task) => task.status === 'failed');
    if (failed.length) throw new Error(`task failed: ${JSON.stringify(failed[0].error || failed[0]).slice(0, 300)}`);
    if (done) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timeout waiting for the Meilisearch task');
}

async function main() {
  const raw = zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8');
  const payload = JSON.parse(raw);
  const index = OVERRIDE_INDEX || payload.index;
  if (!index) throw new Error('payload has no index name');
  if (!Array.isArray(payload.documents)) throw new Error('payload has no documents[]');

  const tasks = [];
  const exists = await request('GET', `/indexes/${index}`).catch(() => null);
  if (!exists) {
    const created = await request('POST', '/indexes', { uid: index, primaryKey: payload.primaryKey || undefined });
    tasks.push(created.taskUid);
    console.log(`index ${index} created`);
  }

  if (payload.settings) {
    const patched = await request('PATCH', `/indexes/${index}/settings`, payload.settings);
    tasks.push(patched.taskUid);
  }

  for (let i = 0; i < payload.documents.length; i += BATCH) {
    const batch = payload.documents.slice(i, i + BATCH);
    const added = await request('POST', `/indexes/${index}/documents`, batch);
    tasks.push(added.taskUid);
    console.log(`  ${Math.min(i + BATCH, payload.documents.length)}/${payload.documents.length} documents sent`);
  }

  await waitForTasks(tasks);
  const stats = await request('GET', `/indexes/${index}/stats`);
  console.log(`${index}: restored ${stats.numberOfDocuments} documents (imported ${payload.documents.length})`);
}

main().catch((err) => {
  console.error(`restore failed: ${err.message}`);
  process.exit(1);
});
