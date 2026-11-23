/**
 * Tukuk Traffic — community road reports for the /traffic page (a Waze-style
 * surface with only the pieces we can honestly serve from a tiny VPS).
 *
 * Data flow:
 *   - Every report lives in memory as { id, lat, lon, type, note, createdAt,
 *     up, down } and is persisted (atomic + debounced) to data/traffic.json.
 *   - Reports self-expire per a per-type TTL, extended a little by upvotes and
 *     cut short once the community downvotes them past a threshold. This keeps
 *     the map honest without any human moderation.
 *   - The web page bootstraps with an initial payload (server-rendered) and
 *     then long-polls /api/traffic/reports for updates every 30 seconds.
 *
 * Design notes:
 *   - No authentication: reports are anonymous but rate-limited by the shared
 *     token-bucket middleware. Vote idempotency is best-effort client-side
 *     (session-scoped Set of "id:dir"); a duplicate vote just counts twice and
 *     is a normal trade-off for a free community board on a small server.
 *   - Never 503s: if the JSON load fails, we silently boot from SEED so the
 *     page always renders something. Corrupted rows are dropped, not fatal.
 *   - English-only user-facing strings (memory rule: "tukuk.org content
 *     clusters must be international/English, not Malay-only").
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'traffic.json');

// ── Report types ──────────────────────────────────────────────────────────────
// Emoji + hex are shown on the map (Leaflet circleMarker) and in the sidebar.
// TTL minutes follows how quickly the situation typically clears; camera and
// closure persist longest because those are physical facts about the road.
const TYPES = {
  traffic:  { label: 'Traffic jam',  emoji: '🚗', color: '#ef4444', ttlMin: 60,   blurb: 'Slow or stopped traffic right here.' },
  accident: { label: 'Accident',     emoji: '💥', color: '#f97316', ttlMin: 120,  blurb: 'Collision or breakdown blocking a lane.' },
  police:   { label: 'Police check', emoji: '🚓', color: '#3b82f6', ttlMin: 180,  blurb: 'Checkpoint or enforcement visible ahead.' },
  hazard:   { label: 'Road hazard',  emoji: '⚠️', color: '#eab308', ttlMin: 240,  blurb: 'Debris, pothole, flood water or animal on road.' },
  closure:  { label: 'Road closed',  emoji: '⛔', color: '#a855f7', ttlMin: 1440, blurb: 'Road fully or partly shut to through traffic.' },
  camera:   { label: 'Speed camera', emoji: '📷', color: '#06b6d4', ttlMin: 10080,blurb: 'Fixed or mobile speed camera at this spot.' },
  rain:     { label: 'Heavy rain',   emoji: '🌧️', color: '#14b8a6', ttlMin: 45,   blurb: 'Reduced visibility / slick surface right now.' },
  fuel:     { label: 'Fuel price',   emoji: '⛽', color: '#22c55e', ttlMin: 2880, blurb: 'Petrol / diesel price at a nearby station.' }
};
const TYPE_KEYS = Object.keys(TYPES);

// Community-vote effects on a report's lifetime:
const UPVOTE_BONUS_MS = 10 * 60 * 1000;   // each upvote stretches TTL by 10 min
const UPVOTE_BONUS_CAP = 6;               // …but never more than 6 upvotes' worth
const DOWNVOTE_EXPIRE_AT = 5;             // 5 net downvotes → drop immediately

// Simple persistence cap so an abusive client cannot grow the file forever.
const MAX_REPORTS = 500;

// ── Seed data (only used when the JSON file is missing / empty) ────────────────
// Hand-placed so the page never boots blank. Coordinates are real public spots
// in major world cities and use plausible, non-alarming sample notes.
function seed() {
  const now = Date.now();
  const mins = (m) => now - m * 60 * 1000;
  const rows = [
    { lat: 3.1579,  lon: 101.7116, type: 'traffic',  note: 'Heavy congestion near KLCC, stop-and-go both directions.',        createdAt: mins(8),   up: 5,  down: 0 },
    { lat: 3.0722,  lon: 101.6089, type: 'police',   note: 'Roadblock on the main highway exit, officers checking licences.',  createdAt: mins(21),  up: 3,  down: 0 },
    { lat: -6.2088, lon: 106.8456, type: 'accident', note: 'Two-car collision on the flyover, right lane blocked.',            createdAt: mins(35),  up: 8,  down: 0 },
    { lat: 13.7563, lon: 100.5018, type: 'hazard',   note: 'Large pothole just after the intersection on the right side.',     createdAt: mins(90),  up: 2,  down: 0 },
    { lat: 1.3521,  lon: 103.8198, type: 'camera',   note: 'Mobile speed camera on the expressway approach, unmarked van.',    createdAt: mins(150), up: 12, down: 0 },
    { lat: 35.6762, lon: 139.6503, type: 'rain',     note: 'Sudden downpour, visibility under 50 m near the station.',         createdAt: mins(6),   up: 4,  down: 0 },
    { lat: 51.5072, lon: -0.1276,  type: 'closure',  note: 'Road closed for parade until end of day, expect diversions.',      createdAt: mins(220), up: 9,  down: 0 },
    { lat: 40.7128, lon: -74.0060, type: 'traffic',  note: 'Bridge approach backed up two lanes deep, slow but moving.',       createdAt: mins(14),  up: 6,  down: 1 },
    { lat: 25.2048, lon: 55.2708,  type: 'fuel',     note: 'Supermarket station has the cheapest diesel in the area today.',   createdAt: mins(70),  up: 1,  down: 0 },
    { lat: 41.0082, lon: 28.9784,  type: 'hazard',   note: 'Oil slick near the tram stop, take the corner slowly.',            createdAt: mins(48),  up: 3,  down: 0 }
  ];
  return rows.map((r, i) => ({
    id: `seed-${i}-${crypto.randomBytes(3).toString('hex')}`,
    ...r
  }));
}

// ── In-memory store + debounced atomic persistence ────────────────────────────
let reports = [];
let saveTimer = null;
let inited = false;

function prune(now = Date.now()) {
  // Drop expired + collapse any duplicate ids (defensive against a bad file).
  const seen = new Set();
  reports = reports.filter((r) => {
    if (!r || !r.id || seen.has(r.id)) return false;
    seen.add(r.id);
    return !isExpired(r, now);
  });
  // Enforce the max-report ceiling by dropping oldest first.
  if (reports.length > MAX_REPORTS) {
    reports.sort((a, b) => a.createdAt - b.createdAt);
    reports = reports.slice(reports.length - MAX_REPORTS);
  }
}

function isExpired(r, now = Date.now()) {
  const t = TYPES[r.type];
  if (!t) return true;
  if ((r.down || 0) - (r.up || 0) >= DOWNVOTE_EXPIRE_AT) return true;
  const bonus = Math.min(r.up || 0, UPVOTE_BONUS_CAP) * UPVOTE_BONUS_MS;
  const ttlMs = t.ttlMin * 60 * 1000 + bonus;
  return (now - r.createdAt) > ttlMs;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, 2000);
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), reports }));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.warn('[traffic] save failed:', e.message);
  }
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.reports)) {
      reports = obj.reports.filter((r) => r && TYPES[r.type]);
    }
  } catch {
    reports = [];
  }
  if (!reports.length) reports = seed();
  prune();
  if (!reports.length) reports = seed();
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Boot from disk (idempotent). Every public helper also lazy-ensures this. */
function init() { if (!inited) { load(); inited = true; } }

/** Copy of active reports, newest first. Optional bbox: {sw,ne} in [lat,lon]. */
function listActive(now = Date.now(), bbox = null) {
  init();
  const out = [];
  for (const r of reports) {
    if (isExpired(r, now)) continue;
    if (bbox) {
      if (r.lat < bbox.sw[0] || r.lat > bbox.ne[0]) continue;
      if (r.lon < bbox.sw[1] || r.lon > bbox.ne[1]) continue;
    }
    out.push(publicView(r));
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

function publicView(r) {
  const t = TYPES[r.type];
  const ttlMs = t.ttlMin * 60 * 1000 + Math.min(r.up || 0, UPVOTE_BONUS_CAP) * UPVOTE_BONUS_MS;
  const remaining = Math.max(0, ttlMs - (Date.now() - r.createdAt));
  return {
    id: r.id, lat: r.lat, lon: r.lon, type: r.type,
    label: t.label, emoji: t.emoji, color: t.color,
    note: r.note || '',
    createdAt: r.createdAt, up: r.up || 0, down: r.down || 0,
    expiresInMin: Math.round(remaining / 60000)
  };
}

function getOne(id) {
  init();
  return reports.find((r) => r.id === id && !isExpired(r)) || null;
}

/** Create a report; returns the public view or throws Error with a client-safe msg. */
function addReport({ lat, lon, type, note }) {
  init();
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be a number between -90 and 90.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Longitude must be a number between -180 and 180.');
  if (!TYPE_KEYS.includes(type)) throw new Error('Unknown report type.');
  const cleanNote = String(note || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 140);
  const r = {
    id: 'r-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'),
    lat: +lat.toFixed(5), lon: +lon.toFixed(5),
    type, note: cleanNote,
    createdAt: Date.now(), up: 0, down: 0
  };
  reports.push(r);
  prune();
  scheduleSave();
  return publicView(r);
}

/** Vote on a report; returns the public view or null if the id is gone. */
function vote(id, dir) {
  init();
  const r = getOne(id);
  if (!r) return null;
  if (dir === 'up') r.up = (r.up || 0) + 1;
  else if (dir === 'down') r.down = (r.down || 0) + 1;
  else throw new Error("Vote must be 'up' or 'down'.");
  prune();
  scheduleSave();
  return publicView(r);
}

/** Report counts by type for the current active set (drives the filter chips). */
function countsByType(now = Date.now()) {
  init();
  const out = {};
  for (const k of TYPE_KEYS) out[k] = 0;
  for (const r of reports) {
    if (isExpired(r, now)) continue;
    out[r.type] = (out[r.type] || 0) + 1;
  }
  return out;
}

/** Total active reports right now (used on the hub page hero). */
function activeCount() { return listActive().length; }

module.exports = {
  TYPES, TYPE_KEYS, DATA_FILE,
  init, listActive, getOne, addReport, vote, countsByType, activeCount,
  // Internals exposed for tests / admin panel.
  _prune: prune, _reportsRef: () => reports, _seed: seed
};
