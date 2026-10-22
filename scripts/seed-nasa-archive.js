'use strict';
// Seed the local APOD archive — a one-off manual run (not a schedule) so the
// /nasa/archive page is immediately full of images spanning decades. Every
// getAPOD({date}) call persists to data/tukuk-os.json via nasa-store → forever.
// Usage: node scripts/seed-nasa-archive.js [startYear] [endYear]
// (default 1995 → this year; ±2 dates a year = ~64 API calls, limit-friendly.)
const config = require('../src/config');
const nasa = require('../src/nasa');

const startYear = Number(process.argv[2]) || 1995;
const endYear = Number(process.argv[3]) || new Date().getFullYear();

// Two milestone dates per year: Jan 1 (AWW — World Wide Web Day on APOD) and
// Jul 20 (the Moon landing anniversary). APOD publishes daily since 1995-06-16.
const MONTH_DAYS = ['01-01', '07-20'];

function iso(d) { return d.toISOString().slice(0, 10); }

function milestoneDates() {
  const dates = [];
  const todayIso = iso(new Date());
  for (let y = Math.max(1995, startYear); y <= endYear; y++) {
    for (const md of MONTH_DAYS) {
      const d = `${y}-${md}`;
      if (d >= '1995-06-16' && d <= todayIso) dates.push(d);
    }
  }
  // Extra: the trailing 30 days so the archive feed looks "hot".
  for (let i = 1; i <= 30; i++) {
    const d = iso(new Date(Date.now() - i * 86400000));
    if (!dates.includes(d)) dates.push(d);
  }
  return dates.sort();
}

async function main() {
  const dates = milestoneDates();
  console.log(`[seed] ${dates.length} APOD dates to seed (key ${config.nasa.apiKey ? 'OK' : 'MISSING'})`);
  let ok = 0, skip = 0, fail = 0;
  for (const date of dates) {
    try {
      const apod = await nasa.getAPOD({ date });
      if (apod && apod.date === date && apod.title) { ok += 1; console.log(`  ✓ ${date} — ${String(apod.title).slice(0, 60)}`); }
      else { skip += 1; console.log(`  - ${date} (payload not valid / video-only)`); }
    } catch (err) {
      fail += 1; console.log(`  ✗ ${date}: ${err.message}`);
    }
    // Polite on the rate limit: ~2 requests/second.
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`[seed] done — ${ok} saved, ${skip} skipped, ${fail} failed`);
}

main().catch((err) => { console.error('[seed] fatal:', err.message); process.exit(1); });
