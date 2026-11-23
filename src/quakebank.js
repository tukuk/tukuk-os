'use strict';
// ── tukuk.org's own earthquake feeds, served locally before earthquake.usgs.gov is asked ──
// src/gempa.js consults this before its network chain for the five fixed region feeds. The
// bank is a rolling 35-day window rebuilt daily by quakebank-build.yml in the public
// tukuk/tukuk-devops repo, loaded into the Meilisearch `quake` index by scripts/quake-load.js.
// USGS revises events, so the bank is replaced whole every sync — it can lag the live feed by
// up to a day, which for a 7/30-day list is invisible and for brand-new events is exactly what
// the live fallback still covers when the bank misses a row the page then refreshes tomorrow.
//
// Same rule as apodbank/wikibank/wordbank: only ever make the page better or leave it exactly
// as it was. Any problem — index missing, Meili down, slow, empty answer — returns null and
// gempa.js runs its own USGS call, cache, mirror and retry untouched.
//
// Rows carry the EXACT field names gempa.js fetchOnce maps GeoJSON into (id, mag, place, time,
// depth, lat, lon, url, tsunami, felt, cdi, status, sig) — a bank hit is indistinguishable from
// a live answer apart from speed.
const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.QUAKEBANK_INDEX || 'quake';
const BUDGET_MS = Number(process.env.QUAKEBANK_LOOKUP_MS || 500);

let enabled = true;
function setEnabled(v) { enabled = !!v; }

// Build the Meilisearch filter string from the SAME param object gempa.js sends to USGS:
// {starttime, endtime, minmagnitude, limit, minlongitude, minlatitude, maxlongitude, maxlatitude}
// Times are ISO strings in both worlds; Meili filters on epoch ms numbers, so convert.
function filterFor(params) {
  const parts = [];
  const t0 = Date.parse(params.starttime);
  const t1 = Date.parse(params.endtime);
  if (Number.isFinite(t0)) parts.push(`time >= ${t0}`);
  if (Number.isFinite(t1)) parts.push(`time <= ${t1}`);
  if (params.minmagnitude != null) parts.push(`mag >= ${Number(params.minmagnitude)}`);
  if (params.minlatitude != null) parts.push(`lat >= ${Number(params.minlatitude)}`);
  if (params.maxlatitude != null) parts.push(`lat <= ${Number(params.maxlatitude)}`);
  if (params.minlongitude != null) parts.push(`lon >= ${Number(params.minlongitude)}`);
  if (params.maxlongitude != null) parts.push(`lon <= ${Number(params.maxlongitude)}`);
  return parts.join(' AND ');
}

// Returns an array of gempa-shaped rows, or null for "call USGS like always".
async function feed(params) {
  if (!enabled || !KEY || !params) return null;
  const filter = filterFor(params);
  if (!filter) return null; // a feed we cannot express locally must not pretend to be answered
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET_MS);
  try {
    const res = await fetch(`${MEILI}/indexes/${INDEX}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter, sort: ['time:desc'], limit: Math.min(Number(params.limit) || 100, 500) }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hits = Array.isArray(data && data.hits) ? data.hits : [];
    if (!hits.length) return null; // empty bank window for this region — let live answer it
    // Drop our storage id, sort locally too: correct even if this Meilisearch version ignores `sort`.
    return hits.map(({ pk, ...row }) => row).sort((a, b) => (b.time || 0) - (a.time || 0));
  } catch (err) {
    // Index missing, Meili down, timeout — identical from here: make the call we always made.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { feed, filterFor, setEnabled };
