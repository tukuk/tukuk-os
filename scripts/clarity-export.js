#!/usr/bin/env node
// =============================================================================
// clarity-export.js — pull a Microsoft Clarity Data-Export report to local JSON.
// Auth is a Bearer header (NOT a query token); the API token is already bound to
// its project, so there is no project_id parameter. Max 10 requests/project/day,
// data only for the last 1–3 days, ≤3 dimensions, ≤1000 rows, no pagination.
//
//   CLARITY_API_TOKEN=xxxx node scripts/clarity-export.js --numOfDays=1 --dimension1=URL
//   node scripts/clarity-export.js project-live-insights --numOfDays=3 --dimension1=Country/Region
//
// Token is a SECRET: pass only via the CLARITY_API_TOKEN env var. Output goes to
// clarity-export/ (gitignored).
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.CLARITY_API_TOKEN || '';
const OUT_DIR = path.join(__dirname, '..', 'clarity-export');

function arg(name, dflt) {
  // Support both --name=value and --name value.
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(eq.indexOf('=') + 1);
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return dflt;
}

async function main() {
  if (!TOKEN) {
    console.error('CLARITY_API_TOKEN is not set. Clarity → Settings → Data Export → Generate new API token.');
    process.exit(2);
  }
  const report = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'project-live-insights';
  const params = new URLSearchParams();
  params.set('numOfDays', arg('numOfDays', '1'));
  for (const d of ['dimension1', 'dimension2', 'dimension3']) {
    const v = arg(d); if (v) params.set(d, v);
  }
  const url = `https://www.clarity.ms/export-data/api/v1/${encodeURIComponent(report)}?${params}`;
  console.log(`GET ${report}  ${params.toString()}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    console.error({ 401: '→ missing/invalid/expired token.', 403: '→ token not authorized.', 429: '→ daily 10-call limit hit.' }[res.status] || '');
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = `${params.get('numOfDays')}d_${new Date().toISOString().slice(0, 10)}`;
  const file = path.join(OUT_DIR, `${report}_${stamp}.json`);
  fs.writeFileSync(file, text);
  let rows = 'n/a';
  try { const j = JSON.parse(text); rows = Array.isArray(j) ? `${j.length} metric group(s)` : 'object'; } catch {}
  console.log(`✓ saved ${file}  (${(text.length / 1024).toFixed(1)} KB, ${rows})`);
}

main().catch((e) => { console.error('clarity-export FAILED:', e.message); process.exit(1); });
