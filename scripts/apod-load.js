#!/usr/bin/env node
/**
 * Load tukuk.org's APOD bank (apod.jsonl.gz) into Meilisearch as the `apod` index.
 *
 *   node scripts/apod-load.js <apod.jsonl.gz>
 *
 * Reads from env: MEILI_HOST, MEILI_MASTER_KEY, APODBANK_INDEX (default: apod).
 *
 * The wikibank-load.js companion for a much smaller, date-keyed bank: one row per calendar
 * date, and "YYYY-MM-DD" is already ASCII [0-9-] — a legal Meilisearch document id directly,
 * so pk IS the date and src/apodbank.js looks documents up by id with zero query machinery.
 *
 * Full wipe + reload every sync: the bank arrives as ONE complete dated snapshot per release
 * (the builder resumes forward-only), so a stale row can only mean a page NASA retired.
 * Streaming like the other loaders — the file is small today (~11k rows) but the protocol is
 * the one proven pattern and costs nothing to keep.
 */
const fs = require('fs');
const zlib = require('zlib');

const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.APODBANK_INDEX || 'apod';
const FILE = process.argv[2];
const BATCH = Number(process.env.APODBANK_BATCH || 1000);

if (!FILE) {
  console.error('usage: node scripts/apod-load.js <apod.jsonl.gz>');
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

async function waitForTask(uid, timeoutMs = 300000) {
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

// One bank row -> one document. Fields are exactly what src/nasa.js getApodFromScienceSite
// returns (tools/apod_build.py mirrors that function); pk mirrors the date for the id lookup.
function docFromRow(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ''))) return null;
  if (!d.title || !d.url) return null; // a row the app's own validity bar would reject
  return {
    pk: d.date,
    date: d.date,
    title: String(d.title),
    explanation: String(d.explanation || ''),
    media_type: String(d.media_type || 'image'),
    url: String(d.url),
    hdurl: String(d.hdurl || ''),
    copyright: String(d.copyright || ''),
    source: String(d.source || 'science.nasa.gov')
  };
}

async function main() {
  try {
    await request('GET', `/indexes/${INDEX}`);
  } catch (e) {
    const task = await request('POST', '/indexes', { uid: INDEX, primaryKey: 'pk' });
    await waitForTask(task.taskUid);
    console.log(`created index ${INDEX}`);
  }

  // Lookups are by document id only; nothing here needs to be searchable or filterable, so
  // settings stay minimal and indexing cost on the box stays near zero.
  const settings = {
    searchableAttributes: ['title'],
    filterableAttributes: ['date'],
    displayedAttributes: ['*']
  };
  const sTask = await request('PATCH', `/indexes/${INDEX}/settings`, settings);
  await waitForTask(sTask.taskUid);

  const del = await request('DELETE', `/indexes/${INDEX}/documents`);
  await waitForTask(del.taskUid);

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
  console.error('apod-load failed:', err.message);
  process.exit(1);
});
