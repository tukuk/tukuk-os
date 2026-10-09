#!/usr/bin/env node
/**
 * Eksport indeks carian RINGKAS untuk mod sandaran worker www.tukuk.org.
 *
 *   node scripts/export-edge-index.js [fail-keluaran]
 *
 * Baca dari env: MEILI_HOST, MEILI_MASTER_KEY, MEILI_INDEX.
 * Hasil: JSON array [{title, url, description, content, siteName}] dengan
 * konten dipangkas (≤300 aksara) supaya muat & laju dalam Cloudflare Worker.
 */

const fs = require('fs');
const path = require('path');

const MEILI = (process.env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, '');
const KEY = process.env.MEILI_MASTER_KEY || '';
const INDEX = process.env.MEILI_INDEX || 'halaman_web';
const OUT = process.argv[2] || path.join(__dirname, '..', 'data', 'edge-index.json');
const PAGE = 1000;

if (!KEY) {
  console.error('MEILI_MASTER_KEY kosong');
  process.exit(1);
}

async function fetchPage(offset) {
  const url = `${MEILI}/indexes/${INDEX}/documents?limit=${PAGE}&offset=${offset}` +
    '&fields=title,url,description,content,siteName';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`documents?offset=${offset} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const docs = [];
  for (let offset = 0; ; offset += PAGE) {
    const body = await fetchPage(offset);
    const results = body.results || [];
    if (!results.length) break;
    for (const d of results) {
      if (!d || !d.url || !d.title) continue;
      docs.push({
        title: String(d.title).slice(0, 300),
        url: String(d.url),
        description: String(d.description || '').slice(0, 200),
        content: String(d.content || '').slice(0, 300),
        siteName: String(d.siteName || '')
      });
    }
    process.stdout.write(`\r  ${docs.length} dokumen...`);
    if (results.length < PAGE) break;
  }
  console.log('');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(docs));
  const mb = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`edge-index: ${docs.length} dokumen, ${mb} MB → ${OUT}`);
}

main().catch((e) => {
  console.error('eksport gagal:', e.message);
  process.exit(1);
});
