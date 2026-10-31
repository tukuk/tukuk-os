'use strict';
// ── tukuk.org's own dictionary data, served locally before any external API ──
// src/kamus.js used to reach api.dictionaryapi.dev for EVERY English definition. That endpoint is
// keyless, anonymous and shared with the whole internet, so it is rate-limited and can vanish without
// notice. The word bank (built free in the public tukuk/tukuk-devops repo, loaded into the Meilisearch
// `kata` index by scripts/wordbank-sync.sh) lets us answer a normal lookup from disk in a couple of
// milliseconds instead.
//
// The rule this module obeys: it may only make /alat/dictionary better or leave it exactly as it was.
// Any problem at all — index missing, Meilisearch down, slow, malformed answer — returns null and the
// caller falls through to the external API. The external APIs are NOT removed; they become the
// fallback for words we do not hold yet (and every non-English language, which is a Wiktionary
// pipeline still to come). This is the "kurangkan API, banyakkan data asli" the site is aiming at.
const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.WORDBANK_INDEX || 'kata';
// A dictionary lookup must never be the reason a request is slow. If the local store cannot answer in
// this many ms, give up and use the network path we always had.
const BUDGET_MS = Number(process.env.WORDBANK_LOOKUP_MS || 500);

let enabled = true;
function setEnabled(v) { enabled = !!v; }

// Map a `kata` search result (one row per sense) into the exact object shape kamus.js/define() has
// always returned, grouped by part of speech. The caller and the front-end cannot tell this apart
// from a Free Dictionary API answer.
function toDefinition(word, lang, hits) {
  const byPos = new Map();
  for (const h of hits) {
    const pos = String(h.p || '');
    if (!byPos.has(pos)) byPos.set(pos, { partOfSpeech: pos, defs: [], synonyms: new Set() });
    const m = byPos.get(pos);
    m.defs.push({ def: String(h.d || ''), example: String(h.x || '') });
    for (const s of (Array.isArray(h.y) ? h.y : [])) m.synonyms.add(s);
    if (!m.phonetic && h.h && h.h.length) m.hypernym = h.h[0];
    if (m.defs.length >= 4) break; // match the external path's "top 4 senses" cap
  }
  const meanings = [...byPos.values()].map((m) => ({
    partOfSpeech: m.partOfSpeech,
    defs: m.defs.slice(0, 4),
    synonyms: [...m.synonyms].slice(0, 8),
    ...(m.hypernym ? { hypernym: m.hypernym } : {})
  })).filter((m) => m.defs.length);
  if (!meanings.length) return null;
  return { found: true, word, lang, phonetic: '', audio: '', meanings, source: 'local' };
}

// Returns a definition object, or null for "ask the outside world".
async function lookup(word, lang) {
  if (!enabled || !KEY) return null;
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET_MS);
  try {
    const res = await fetch(`${MEILI}/indexes/${INDEX}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: `l = "${lang}" AND lw = "${w}"`, limit: 12 }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hits = Array.isArray(data && data.hits) ? data.hits : [];
    return hits.length ? toDefinition(word, lang, hits) : null;
  } catch (err) {
    // Missing index, Meili down, timeout: all identical from here — degrade to the external API.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { lookup, setEnabled };
