// NASA archive database — a persistent JSON store in data/nasa/ so the space
// data isn't lost when the memory cache expires or the NASA API is down.
// Collections: apod (by date), asteroids (by NEO id), epic (by image id).
// Written without require('./nasa') to avoid a require cycle (nasa.js → store).
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Testable directory (NASA_DB_PATH) — defaults to next to the main store file.
const DB_DIR = process.env.NASA_DB_PATH || path.join(path.dirname(config.store.path), 'nasa');
const APOD_FILE = path.join(DB_DIR, 'apod.json');
const ASTERIOD_FILE = path.join(DB_DIR, 'asteroids.json');
const EPIC_FILE = path.join(DB_DIR, 'epic.json');

// Archive caps — drop the oldest records when full; even ~30 years of APOD is only ~11k entries.
const APOD_MAX = 4000;
const ASTEROID_MAX = 3000;
const EPIC_MAX = 500;

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomic write: tmp then rename — avoids a half-written file if the process dies.
function saveJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

// Light validation of an APOD entry (same logic as nasa.isValidApodPayload, no require cycle).
function isGoodApod(e) {
  if (!e || typeof e !== 'object') return false;
  const title = String(e.title || '').trim();
  const expl = String(e.explanation || '').trim();
  const media = String(e.url || e.hdurl || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) return false;
  if (!title || /^(nasa science|astronomy picture of the day)$/i.test(title)) return false;
  if (expl.length < 40) return false;
  if (!media || /nasa-logo|logo\.(png|svg|gif|jpg)/i.test(media)) return false;
  return true;
}

/** Save one or many APOD entries (the API payload may be an array when count>1). */
function saveApod(data) {
  const entries = Array.isArray(data) ? data : [data];
  const db = loadJson(APOD_FILE, {});
  let added = 0;
  for (const e of entries) {
    if (!isGoodApod(e)) continue;
    if (!db[e.date]) added += 1;
    db[e.date] = {
      date: e.date,
      title: String(e.title).trim(),
      explanation: String(e.explanation || '').trim(),
      url: e.url || e.hdurl || '',
      hdurl: e.hdurl || '',
      media_type: e.media_type || 'image',
      copyright: e.copyright || '',
      savedAt: new Date().toISOString()
    };
  }
  if (!added) return 0;
  // Drop the oldest entries past the cap (keeping the newest ones).
  const dates = Object.keys(db).sort();
  while (dates.length > APOD_MAX) delete db[dates.shift()];
  saveJson(APOD_FILE, db);
  return added;
}

/** Get a single archived APOD by exact date. */
function getApod(dateStr) {
  const db = loadJson(APOD_FILE, {});
  return db[String(dateStr || '').slice(0, 10)] || null;
}

/** The newest archived APOD on/before a date (fallback when the API is down). */
function latestApod(onOrBefore) {
  const db = loadJson(APOD_FILE, {});
  const cutoff = String(onOrBefore || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dates = Object.keys(db).filter((d) => d <= cutoff).sort();
  if (!dates.length) return null;
  return db[dates[dates.length - 1]];
}

/** List archived APODs newest first; q filters title/explanation (case-insensitive). */
function listApod({ limit = 30, q = '' } = {}) {
  const db = loadJson(APOD_FILE, {});
  const needle = String(q || '').trim().toLowerCase();
  return Object.values(db)
    .filter((e) => !needle
      || String(e.title || '').toLowerCase().includes(needle)
      || String(e.explanation || '').toLowerCase().includes(needle))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 30, 200)));
}

/** Save the formatted NeoWs asteroid list (keys: id). */
function saveAsteroids(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const db = loadJson(ASTERIOD_FILE, {});
  let added = 0;
  for (const a of list) {
    if (!a || !a.id) continue;
    if (!db[a.id]) added += 1;
    db[a.id] = {
      ...a,
      lastSeen: new Date().toISOString()
    };
  }
  if (!added) return 0;
  const ids = Object.keys(db);
  while (ids.length > ASTEROID_MAX) delete db[ids.shift()];
  saveJson(ASTERIOD_FILE, db);
  return added;
}

/** The newest NEO records that were really pulled from NeoWs successfully —
 *  an honest fallback when the live feed is busy (NO invented data). */
function latestAsteroids({ limit = 60 } = {}) {
  const db = loadJson(ASTERIOD_FILE, {});
  return Object.values(db)
    .filter((a) => a && a.id && a.close_approach_date)
    .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 60, 100)));
}

/** Search archived asteroids by name; hazardous first, closest approach first. */
function searchAsteroids({ q = '', limit = 20, hazardousOnly = false } = {}) {
  const db = loadJson(ASTERIOD_FILE, {});
  const needle = String(q || '').trim().toLowerCase();
  return Object.values(db)
    .filter((a) => (!needle || String(a.name || '').toLowerCase().includes(needle)))
    .filter((a) => (hazardousOnly ? a.is_potentially_hazardous : true))
    .sort((a, b) => (Number(b.is_potentially_hazardous) - Number(a.is_potentially_hazardous))
      || (a.miss_distance_km || 0) - (b.miss_distance_km || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)));
}

/** Save EPIC images (the daily Earth shot) by identifier. */
function saveEpic(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const db = loadJson(EPIC_FILE, {});
  let added = 0;
  for (const it of items) {
    if (!it || !it.identifier) continue;
    if (!db[it.identifier]) added += 1;
    db[it.identifier] = { ...it, savedAt: new Date().toISOString() };
  }
  if (!added) return 0;
  const ids = Object.keys(db);
  while (ids.length > EPIC_MAX) delete db[ids.shift()];
  saveJson(EPIC_FILE, db);
  return added;
}

/** List EPIC images newest first. */
function listEpic({ limit = 12 } = {}) {
  const db = loadJson(EPIC_FILE, {});
  return Object.values(db)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 12, 100)));
}

/** Quick counts for the dashboard/AI. */
function stats() {
  return {
    dir: DB_DIR,
    apodEntries: Object.keys(loadJson(APOD_FILE, {})).length,
    asteroidEntries: Object.keys(loadJson(ASTERIOD_FILE, {})).length,
    epicEntries: Object.keys(loadJson(EPIC_FILE, {})).length
  };
}

module.exports = {
  DB_DIR,
  saveApod,
  getApod,
  latestApod,
  listApod,
  saveAsteroids,
  latestAsteroids,
  searchAsteroids,
  saveEpic,
  listEpic,
  stats
};
