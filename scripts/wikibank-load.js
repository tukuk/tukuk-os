#!/usr/bin/env node
/**
 * Load tukuk.org's Wikipedia summary bank (wikibank.jsonl.gz) into Meilisearch as the `wiki` index.
 *
 *   node scripts/wikibank-load.js <wikibank.jsonl.gz>
 *
 * Reads from env: MEILI_HOST, MEILI_MASTER_KEY, WIKIBANK_INDEX (default: wiki).
 *
 * The companion of scripts/wordbank-load.js for a different kind of data: wordbank rows are dictionary
 * senses keyed by word; these are article snapshots keyed by normalized Wikipedia title (`k`, exactly
 * what src/wikibank.js computes from a title). One row per title, so `k` is the primary key as-is —
 * no content hash needed.
 *
 * Tombstones ({"k":..,"t":..,"m":1} — a title Wikipedia answered 404 for) are SKIPPED, not loaded:
 * wikibank.js only needs to find rows it can serve, and a missing key already means "call Wikipedia",
 * which is the correct behaviour for a dead article.
 *
 * Full wipe + reload every sync (same end state as the word bank's first file): the bank arrives as ONE
 * complete file per release, so a stale row can only mean an article the snapshot no longer contains.
 * Streaming is deliberate — the bank is a daily-growing file (target ~640k rows, ~150 MB gz) and
 * readFileSync of the whole gunzipped body would hand the box a multi-hundred-MB spike for no reason.
 */
const fs = require('fs');
const zlib = require('zlib');

const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.WIKIBANK_INDEX || 'wiki';
const FILE = process.argv[2];
const BATCH = Number(process.env.WIKIBANK_BATCH || 1000);

if (!FILE) {
  console.error('usage: node scripts/wikibank-load.js <wikibank.jsonl.gz>');
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

async function waitForTask(uid, timeoutMs = 600000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const t = await request('GET', `/tasks/${uid}`);
    if (t && (t.status === 'succeeded' || t.status === 'failed' || t.status === 'canceled')) {
      if (t.status === 'failed') throw new Error(`task ${uid} failed: ${t.error && t.error.message}`);
      return t;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`task ${uid} timed out after ${timeoutMs}ms`);
}

// Map one bank row to one Meili document. Field names stay short for the same reason the bank's do:
// millions of rows. `k` must already be normalized (devops wikibank_build.py norm_key).
function docFromRow(d) {
  if (d.m || !d.k || !d.x) return null; // tombstone / no key / no extract
  return { pk: d.k, k: d.k, t: d.t || '', d: d.d || '', x: d.x, u: d.u || '', h: d.h || '' };
}

async function main() {
  // Ensure the index exists with `k` as primary key (pk mirrors k; kept so a future re-key stays
  // a one-field change, exactly like kata's pk).
  try {
    await request('GET', `/indexes/${INDEX}`);
  } catch (e) {
    const task = await request('POST', '/indexes', { uid: INDEX, primaryKey: 'pk' });
    await waitForTask(task.taskUid);
    console.log(`created index ${INDEX}`);
  }

  const settings = {
    searchableAttributes: ['t'],
    filterableAttributes: ['k'],
    displayedAttributes: ['*'],
    // A summary lookup is an exact title — the title may match, the extract body must not.
    typoTolerance: { enabled: true, disableOnAttributes: ['k'] }
  };
  const sTask = await request('PATCH', `/indexes/${INDEX}/settings`, settings);
  await waitForTask(sTask.taskUid);

  // Clean reload: the file is one whole snapshot; drop everything first so removed/retitled
  // articles do not linger.
  const del = await request('DELETE', `/indexes/${INDEX}/documents`);
  await waitForTask(del.taskUid);

  // Stream: gunzip -> split lines -> batches of BATCH, never more than one batch's JSON in RAM.
  const rl = require('readline').createInterface({
    input: fs.createReadStream(FILE).pipe(zlib.createGunzip()),
    crlfDelay: Infinity
  });
  let batch = [];
  let seen = 0;
  let loaded = 0;
  let lastTask = null;
  async function flush() {
    if (!batch.length) return;
    const task = await request('POST', `/indexes/${INDEX}/documents`, batch);
    batch = [];
    lastTask = task;
  }
  for await (const line of rl) {
    if (!line.trim()) continue;
    seen++;
    let d;
    try {
      d = JSON.parse(line);
    } catch (e) {
      continue;
    }
    const doc = docFromRow(d);
    if (!doc) continue;
    batch.push(doc);
    loaded++;
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  if (lastTask) await waitForTask(lastTask.taskUid);

  const stats = await request('GET', `/indexes/${INDEX}/stats`);
  console.log(`done: read ${seen} rows, served ${loaded} into index ${INDEX} (now ${stats.numberOfDocuments} documents)`);
}

main().catch((err) => {
  console.error('wikibank-load failed:', err.message);
  process.exit(1);
});
