'use strict';
// ── tukuk.org's own Wikipedia snapshots, served locally before en.wikipedia.org ──
// ~620 content modules (bukit.js, distrik-afghanistan.js, muzium-auto.js, …) each call
// en.wikipedia.org/api/rest_v1/page/summary/<title> at request time for their infobox text. That
// is an outbound call on every cold page — fine while it answers, invisible latency when it does
// not. The wikibank (built incrementally in the public tukuk/tukuk-devops repo by
// wikibank-build.yml, loaded into the Meilisearch `wiki` index by scripts/wikibank-sync.sh) lets
// the box answer those lookups from local disk in ~5 ms instead.
//
// Same rule as src/wordbank.js: this may only make a page better or leave it EXACTLY as it was.
// Any problem — index missing, Meilisearch down, slow, tombstoned article, title we have not
// banked yet — returns null and the caller makes the same Wikipedia call it always made. The
// external call is not removed; it is the fallback, and the bank's whole point is to be needed
// less often.
const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.WIKIBANK_INDEX || 'wiki';
const BUDGET_MS = Number(process.env.WIKIBANK_LOOKUP_MS || 500);

let enabled = true;
function setEnabled(v) { enabled = !!v; }

// MUST stay identical to norm_key() in tukuk-devops/tools/wikibank_build.py and to what the
// modules send Wikipedia: t.trim(), spaces to underscores, matched case-insensitively.
function normKey(title) {
  return String(title || '').trim().lower().replace(/ /g, '_');
}

// Escape a value going inside a Meilisearch `"..."` filter — titles can contain quotes.
function esc(v) {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Hand the caller back the same REST-summary shape it would have got from Wikipedia, so the
// per-module post-processing (extract/description/thumbnail/content_urls) runs unchanged and a
// local hit is indistinguishable from a network one apart from speed.
function toSummary(hit) {
  if (!hit || !hit.x) return null; // tombstone or banked-without-extract: fall through
  const out = {
    type: 'standard',
    title: hit.t,
    extract: hit.x,
    content_urls: { desktop: { page: hit.u } },
  };
  if (hit.d) out.description = hit.d;
  if (hit.h) out.thumbnail = { source: hit.h };
  return out;
}

// Returns a REST-summary-shaped object, or null for "call Wikipedia like always".
async function summary(title) {
  if (!enabled || !KEY) return null;
  const k = normKey(title);
  if (!k) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET_MS);
  try {
    const res = await fetch(`${MEILI}/indexes/${INDEX}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: `k = "${esc(k)}"`, limit: 1 }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hits = Array.isArray(data && data.hits) ? data.hits : [];
    return hits.length ? toSummary(hits[0]) : null;
  } catch (err) {
    // Index missing, Meili down, timeout — all identical from here: make the call we always made.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { summary, normKey, setEnabled };
