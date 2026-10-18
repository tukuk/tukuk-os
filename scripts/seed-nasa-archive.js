'use strict';
// Seed arkib APOD setempat — satu larian manual (bukan jadual) supaya halaman
// /nasa/archive segera penuh dengan gambar merentas dekad. Setiap panggilan
// getAPOD({date}) persist ke data/tukuk-os.json melalui nasa-store → selamanya.
// Penggunaan: node scripts/seed-nasa-archive.js [tahunMula] [tahunAkhir]
// (default 1995 → tahun ini; ±2 tarikh setahun = ~64 panggilan API, mesra had.)
const config = require('../src/config');
const nasa = require('../src/nasa');

const startYear = Number(process.argv[2]) || 1995;
const endYear = Number(process.argv[3]) || new Date().getFullYear();

// Dua tarikh memento setahun: 1 Jan (AWW — World Wide Web Day di APOD) dan
// 20 Jul (ulang tahun pendaratan Moon). APOD terbit setiap hari sejak 1995-06-16.
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
  // Tambahan: 30 hari terbelakang supaya suapan arkib nampak "panas".
  for (let i = 1; i <= 30; i++) {
    const d = iso(new Date(Date.now() - i * 86400000));
    if (!dates.includes(d)) dates.push(d);
  }
  return dates.sort();
}

async function main() {
  const dates = milestoneDates();
  console.log(`[seed] ${dates.length} tarikh APOD akan disemai (kunci ${config.nasa.apiKey ? 'OK' : 'TIADA'})`);
  let ok = 0, skip = 0, fail = 0;
  for (const date of dates) {
    try {
      const apod = await nasa.getAPOD({ date });
      if (apod && apod.date === date && apod.title) { ok += 1; console.log(`  ✓ ${date} — ${String(apod.title).slice(0, 60)}`); }
      else { skip += 1; console.log(`  - ${date} (payload tak sah / video-only)`); }
    } catch (err) {
      fail += 1; console.log(`  ✗ ${date}: ${err.message}`);
    }
    // Sopan pada had kadar: ~2 permintaan/saatinja.
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`[seed] selesai — ${ok} disimpan, ${skip} diliwati, ${fail} gagal`);
}

main().catch((err) => { console.error('[seed] mati:', err.message); process.exit(1); });
