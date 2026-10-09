// ab.mjs — A/B relevansi: BM25 (aplikasi /search) vs +rerank, pada korpus SEBENAR.
// Jalan di sandbox (~/rktest) terhadap app localhost:3000. Tiada perubahan prod.
const { AutoTokenizer, AutoModelForSequenceClassification, env } =
  await import('@huggingface/transformers');
env.allowRemoteModels = true; env.allowLocalModels = true;

const id = 'cross-encoder/ms-marco-MiniLM-L-6-v2';
const tok = await AutoTokenizer.from_pretrained(id);
const model = await AutoModelForSequenceClassification.from_pretrained(id);
console.log('model loaded:', id);

const BASE = 'http://127.0.0.1:3000';

function docText(hit) {
  const title = String(hit.title || '').replace(/<\/?mark>/g, '');
  const body = String((hit._formatted && hit._formatted.content) || hit.content || hit.description || '')
    .replace(/<\/?mark>/g, '');
  return (title + '. ' + body).replace(/\s+/g, ' ').trim().slice(0, 480);
}

async function search(q) {
  const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&limit=25`);
  const j = await r.json();
  return Array.isArray(j.hits) ? j.hits : [];
}

async function rerankOrder(q, hits) {
  if (hits.length < 2) return { order: hits.map((hit) => ({ hit, s: NaN })), ms: 0 };
  const queries = hits.map(() => q);
  const passages = hits.map(docText);
  const enc = await tok(queries, { text_pair: passages, padding: true, truncation: true, max_length: 256 });
  const t0 = Date.now();
  const { logits } = await model(enc);
  const data = Array.from(logits.data);
  const idx = hits.map((h, i) => i);
  idx.sort((a, b) => data[b] - data[a]);
  return { order: idx.map((i) => ({ hit: hits[i], s: data[i] })), ms: Date.now() - t0 };
}

const short = (h) => String((h && (h.title || h.url)) || '?').replace(/<\/?mark>/g, '').slice(0, 54);
const fmt = (x) => Number.isFinite(x.s) ? short(x.hit) + ` [${x.s.toFixed(1)}]` : short(x.hit);

const queries = [
  'enjin carian',
  'privasi digital',
  'cloudflare',
  'backup',
  'search engine',
  'rate limiting'
];

for (const q of queries) {
  const hits = await search(q);
  const { order, ms } = await rerankOrder(q, hits);
  console.log('\n================ QUERY:', q, `(hits=${hits.length}, rerank_ms=${ms})`);
  console.log('  BM25 top5 :', hits.slice(0, 5).map(short).join('  |  '));
  console.log('  RERANK top5:', order.slice(0, 5).map(fmt).join('  |  '));
}
