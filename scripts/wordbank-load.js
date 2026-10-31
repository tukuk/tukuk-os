#!/usr/bin/env node
/**
 * Load a tukuk.org word-bank file into Meilisearch as the `kata` index.
 *
 *   node scripts/wordbank-load.js <wordbank-<lang>.jsonl.gz>
 *
 * Reads from env: MEILI_HOST, MEILI_MASTER_KEY, WORDBANK_INDEX (default: kata).
 *
 * Why a SEPARATE index from halaman_web: this is dictionary data, not site pages. Keeping it in its
 * own index means /alat/dictionary can look a word up without ever touching — or being slowed by —
 * the human site search, and one can be re-synced without rebuilding the other.
 *
 * The row `id` (lang|word) is NOT unique — a word like "break" carries 75 senses all sharing
 * "en|break". Using it as the primary key would silently collapse every sense but the last into one
 * document. So the loader derives its own pk from the row content; that also makes a re-sync
 * idempotent (same row -> same pk -> replace, never duplicate). We still deleteAll first so words
 * removed upstream do not linger.
 */
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.WORDBANK_INDEX || 'kata';
const FILE = process.argv[2];
const BATCH = Number(process.env.WORDBANK_BATCH || 1000);

if (!FILE) {
  console.error('usage: node scripts/wordbank-load.js <file.jsonl.gz>');
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

// WordNet parts of speech are single letters; the dictionary UI (and the Free Dictionary API shape
// kamus.js returns) uses names. Map them here so the local answer is indistinguishable in shape
// from the external one — a consumer of define() must not be able to tell where the data came from.
const POS = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb', adv: 'adverb' };

function loadDocs() {
  const raw = fs.readFileSync(FILE);
  const text = FILE.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');
  const docs = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    const pk = crypto.createHash('sha1').update(`${d.id}|${d.p}|${d.d}`).digest('hex').slice(0, 16);
    docs.push({
      pk,
      id: d.id,
      w: d.w,
      lw: String(d.w).toLowerCase(),
      l: d.l,
      p: POS[d.p] || d.p,
      d: d.d,
      y: d.y || [],
      h: d.h || [],
      x: d.x || '',
      z: typeof d.z === 'number' ? d.z : null
    });
  }
  return docs;
}

async function main() {
  const docs = loadDocs();
  if (!docs.length) {
    console.error('no rows parsed from ' + FILE);
    process.exit(1);
  }
  const langs = [...new Set(docs.map((d) => d.l))];
  console.log(`loaded ${docs.length} rows (${langs.join(',')}) from ${FILE}`);

  // Ensure the index exists with our content-hash pk as primary key.
  try {
    await request('GET', `/indexes/${INDEX}`);
  } catch (e) {
    const task = await request('POST', '/indexes', { uid: INDEX, primaryKey: 'pk' });
    await waitForTask(task.taskUid);
    console.log(`created index ${INDEX}`);
  }

  const settings = {
    searchableAttributes: ['w'],
    filterableAttributes: ['l', 'lw', 'p'],
    displayedAttributes: ['*'],
    // A dictionary lookup is an exact word, so the word itself should match, not the definition body.
    typoTolerance: { enabled: true, disableOnAttributes: ['lw', 'l'] }
  };
  const sTask = await request('PATCH', `/indexes/${INDEX}/settings`, settings);
  await waitForTask(sTask.taskUid);

  // Clean sync: drop everything so words removed upstream don't linger, then add in batches.
  const del = await request('DELETE', `/indexes/${INDEX}/documents`);
  await waitForTask(del.taskUid);

  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const task = await request('POST', `/indexes/${INDEX}/documents`, slice);
    // Do not await every batch task: Meilisearch queues them and awaiting 200+ tasks serialises the
    // whole load. Await the LAST one only after telling Meili to wait for the full queue below.
    if (i + BATCH >= docs.length) await waitForTask(task.taskUid);
  }

  const stats = await request('GET', `/indexes/${INDEX}/stats`);
  console.log(`done: index ${INDEX} now has ${stats.numberOfDocuments} documents`);
}

main().catch((err) => {
  console.error('wordbank-load failed:', err.message);
  process.exit(1);
});
