'use strict';
// Computed geography — the facts a coordinate can be made to tell honestly.
//
// 816k shard pages currently know five things: a name, a country, a continent, two
// coordinates and a Wikipedia extract. Everything else they print is a restatement of
// those five, which is why Google reads them as one page duplicated 816k times. But the
// coordinates are real data, and arithmetic on real data is not filler: distance to the
// equator, the nearest neighbours and their exact distances, the sun's behaviour at that
// latitude today, that latitude's time zone, an item's rank inside its own cluster.
//
// All of it is derived, so it cannot go stale, be rate-limited, or be wrong because a
// model hallucinated. Nothing here touches the network.
const { haversineKm, solarTimes } = require('./peta');

const KM_PER_DEG = 111.32;   // latitude, mean
const CELL = 1;              // degrees per grid cell
const BOX_DEG = 3;           // the first box searched, in degrees

function point(x) { return { lat: Number(x.lat), lon: Number(x.lng) }; }

// Distance in km between two dataset items, rounded to 0.1 the way haversineKm does.
function kmBetween(a, b) { return haversineKm(point(a), point(b)); }

// One grid per cluster array, built once and kept on a WeakMap: 254k settlements sort
// into 1° cells in ~40 ms, and then every "nearest five" is a handful of Map lookups
// instead of 254k distance calculations per page view.
const INDEX = new WeakMap();

function indexFor(list) {
  const hit = INDEX.get(list);
  if (hit) return hit;
  const cells = new Map();
  for (const it of list) {
    const key = `${Math.floor(Number(it.lat) / CELL)}:${Math.floor(Number(it.lng) / CELL)}`;
    let bucket = cells.get(key);
    if (!bucket) cells.set(key, bucket = []);
    bucket.push(it);
  }
  const idx = { cells };
  INDEX.set(list, idx);
  return idx;
}

// The n closest items in the same cluster, nearest first, never the item itself.
//
// One degree of latitude is 111 km everywhere; one degree of longitude is 111 km only at
// the equator and shrinks with cos(latitude). A ring-based search that forgets this stops
// too early at high latitude and returns the wrong neighbour — which is exactly the bug an
// earlier version of this function had, caught by the brute-force comparison in the tests.
//
// So the search is a box, and the box is only trusted when the arithmetic proves it: every
// point outside it is at least (BOX_DEG - 1) * 111 * cos(maxLatitude in the box) away. If
// the n-th candidate is closer than that, nothing outside can beat it. Otherwise the whole
// list is scanned, which costs ~20 ms on the largest dataset and is always correct.
function nearest(list, item, n = 5) {
  if (!item || !Array.isArray(list) || list.length < 2) return [];
  const lat = Number(item.lat);
  const lon = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const { cells } = indexFor(list);
  const best = [];
  // The box pass and the full-scan fallback both visit the same items; without this a
  // fallback would enter the box's candidates a second time and list them twice.
  const seen = new Set();

  const keep = (other) => {
    if (other === item || other.slug === item.slug || seen.has(other)) return;
    seen.add(other);
    const d = kmBetween(item, other);
    if (best.length === n && d >= best[best.length - 1].km) return;
    best.push({ item: other, km: d });
    best.sort((a, b) => a.km - b.km);
    if (best.length > n) best.pop();
  };

  const y0 = Math.floor((lat - BOX_DEG) / CELL), y1 = Math.floor((lat + BOX_DEG) / CELL);
  const x0 = Math.floor((lon - BOX_DEG) / CELL), x1 = Math.floor((lon + BOX_DEG) / CELL);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const bucket = cells.get(`${y}:${x}`);
      if (bucket) for (const other of bucket) keep(other);
    }
  }

  if (best.length === n) {
    // Cells reach one degree past the box, so an outside point is at least BOX_DEG - 1
    // degrees away on at least one axis; the cosine of the highest latitude in the box is
    // the smallest a longitude degree can be, so it is the safe floor.
    const latMax = Math.min(89.9, Math.abs(lat) + BOX_DEG);
    const floorKm = (BOX_DEG - 1) * KM_PER_DEG * Math.cos(latMax * Math.PI / 180);
    // A box near the antimeridian or a pole is not a box at all in this grid: the cells it
    // needs live on the other side of the world's seam. Those go straight to the full scan.
    const seams = Math.abs(lon) > 175 || Math.abs(lat) > 86;
    if (!seams && best[best.length - 1].km <= floorKm) return best;
  }

  for (const other of list) keep(other);
  return best;
}

// Roughly how far the item sits from the equator — a latitude, said in kilometres.
function equatorKm(item) { return Math.round(Math.abs(Number(item.lat)) * KM_PER_DEG); }

// Solar (clock-free) time zone from longitude: the sky's own answer, good to a quarter
// hour. 15° of longitude is one hour, so minutes = longitude * 4. Real political zones
// differ, so callers must label it as solar time.
function solarOffsetMinutes(lng) {
  return Math.round((Number(lng) * 4) / 15) * 15;
}

function formatUtcOffset(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

function formatMinutesUtc(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// What the sun does at this coordinate on a given day. Pure arithmetic, and it admits
// polar day and polar night rather than inventing a sunrise that never happens.
function sunOn(item, dateStr) {
  try {
    const s = solarTimes(Number(item.lat), Number(item.lng), dateStr);
    return {
      polar: s.polar || null,
      sunrise: typeof s.sunriseUtc === 'number' ? s.sunriseUtc : null,
      sunset: typeof s.sunsetUtc === 'number' ? s.sunsetUtc : null,
      noon: typeof s.noonUtc === 'number' ? s.noonUtc : null,
      dayLengthMin: typeof s.dayLengthMin === 'number' ? s.dayLengthMin : null,
    };
  } catch {
    return null;
  }
}

// Elevation is not clean data. Thirty rows in gunung-data.json carry feet (16,390 ft =
// 4,996 m) while the rest carry metres, which makes a raw ranking put a 4,996 m peak above
// Everest and print 16,390 m for something that is not 16,390 m tall. Earth's ceiling is
// 8,849 m, so anything above that can only be feet and is converted, not trusted.
const CEILING_M = 8900;
const FEET_IN_M = 0.3048;
function elevMeters(item) {
  const v = Number(item && item.elev);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v > CEILING_M ? v * FEET_IN_M : v);
}

// Where the item stands inside its own cluster, by a numeric field (elevation, mostly).
// Ties share the same rank, and `ties` counts every item at that value, this one included.
// An optional normaliser lets callers rank on cleaned values (see elevMeters) without a
// second pass over 6,000 rows.
function rankBy(list, item, field, normalise) {
  const val = (x) => (normalise ? normalise(x) : Number(x[field]));
  const v = val(item);
  if (!Number.isFinite(v)) return null;
  let better = 0, ties = 0, total = 0;
  for (const x of list) {
    const xv = val(x);
    if (!Number.isFinite(xv)) continue;
    total++;
    if (xv > v) better++;
    else if (xv === v) ties++;
  }
  return total ? { rank: better + 1, total, ties } : null;
}

// Compact human distance: 0.4 km, 12 km, 1,284 km.
function formatKm(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return '';
  if (n < 10) return `${n.toFixed(1)} km`;
  return `${Math.round(n).toLocaleString('en-US')} km`;
}

module.exports = {
  kmBetween, nearest, equatorKm, solarOffsetMinutes, formatUtcOffset,
  formatMinutesUtc, sunOn, rankBy, elevMeters, formatKm, KM_PER_DEG,
};
