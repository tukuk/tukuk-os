#!/usr/bin/env node
// =============================================================================
// clarity-export.js — pull a Microsoft Clarity report through the Data Export
// API and save it as JSON for local consumption. Clarity limits this to
// 10 calls per project per DAY, so this script calls ONCE and caches to disk.
//
//   CLARITY_API_TOKEN=xxxx node scripts/clarity-export.js get-live-insights
//   node scripts/clarity-export.js get-top-pages-data --from 2026-10-01 --to 2026-10-26
//
// Reports (v1): get-live-insights, get-dashboard-data, get-top-pages-data,
//   get-heatmap-data, get-latest-noteworthy-sessions. Use the exact name Clarity
//   shows you; the "project-live-insights" label in the UI maps to get-live-insights.
//
// The token is a SECRET: pass it via the CLARITY_API_TOKEN env var only. Never
// put it in a file that is committed. Output goes to clarity-export/ (gitignored).
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.CLARITY_API_TOKEN || '';
const PROJECT_ID = process.env.CLARITY_PROJECT_ID || 'ytshvg0zer';
const OUT_DIR = path.join(__dirname, '..', 'clarity-export');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  if (!TOKEN) {
    console.error('CLARITY_API_TOKEN is not set. Create one in Clarity → Settings → Data export,');
    console.error('then run:  CLARITY_API_TOKEN=<token> node scripts/clarity-export.js <report>');
    process.exit(2);
  }
  const report = process.argv[2] || 'get-live-insights';
  const params = new URLSearchParams({ project_id: PROJECT_ID, format: 'json', token: TOKEN });
  const from = arg('from'), to = arg('to');
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const url = `https://www.clarity.ms/export-data/api/v1/${encodeURIComponent(report)}?${params}`;
  console.log(`Fetching Clarity report "${report}" for project ${PROJECT_ID} …`);
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    console.error(res.status === 401 ? '→ bad/expired token.' : res.status === 429 ? '→ daily 10-call limit hit; try again tomorrow.' : '');
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = (from || to ? `${from || 'x'}_${to || 'x'}` : new Date().toISOString().slice(0, 10));
  const file = path.join(OUT_DIR, `${report}_${stamp}.json`);
  fs.writeFileSync(file, text);
  let rows = 'n/a';
  try { const j = JSON.parse(text); rows = Array.isArray(j) ? j.length : (j.rows ? j.rows.length : Object.keys(j).length); } catch {}
  console.log(`✓ saved ${file}  (${(text.length / 1024).toFixed(1)} KB, ~${rows} record(s))`);
}

main().catch((e) => { console.error('clarity-export FAILED:', e.message); process.exit(1); });
