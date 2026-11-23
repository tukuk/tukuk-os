'use strict';
// ── tukuk.org's own APOD archive, served locally before api.nasa.gov is ever asked ──
// src/nasa.js getAPOD consults this first for date lookups. The bank is built by
// apodbank-build.yml in the public tukuk/tukuk-devops repo — one fetch of the official
// science.nasa.gov APOD page per calendar date — loaded into the Meilisearch `apod` index by
// scripts/apod-load.js, and synced by scripts/wordbank-sync.sh. It exists because the keyed
// NASA API is structurally unreliable for us (no IPv6 on the box, IPv4 LB backends 500, and
// 2025/2026-era "broken payload" responses with placeholder titles) while these banked rows
// are exactly what the app's own Fallback A parsed from the official pages.
//
// Same rule as src/wikibank.js and src/wordbank.js: this may only make a page better or leave
// it EXACTLY as it was. Index missing, Meilisearch down, slow, date not banked yet — returns
// null and getAPOD runs the live chain it always ran (API → page → disk → archive DB).
//
// Rows carry the same field names getApodFromScienceSite returns; the document id IS the date
// (YYYY-MM-DD is ASCII-safe as a Meilisearch pk, unlike free-text titles), so a lookup is a
// single GET /documents/<date> — no query, no filter, ~5 ms.
const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.APODBANK_INDEX || 'apod';
const BUDGET_MS = Number(process.env.APODBANK_LOOKUP_MS || 500);

let enabled = true;
function setEnabled(v) { enabled = !!v; }

// Returns an APOD-shaped row for the exact date, or null for "run the live chain".
async function byDate(dateStr) {
  if (!enabled || !KEY) return null;
  const d = String(dateStr || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null; // never bounce off Meili with a junk id
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET_MS);
  try {
    const res = await fetch(`${MEILI}/indexes/${INDEX}/documents/${encodeURIComponent(d)}`, {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: controller.signal
    });
    if (!res.ok) return null; // 404 = not banked (yet); 40x/5x = index or Meili problem
    const doc = await res.json();
    if (!doc || doc.date !== d || !doc.title || !doc.url) return null;
    const { pk, ...row } = doc; // the caller must not see our storage id
    return row;
  } catch (err) {
    // Meili down, timeout, malformed doc — all identical from here: fall through to the live chain.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { byDate, setEnabled };
