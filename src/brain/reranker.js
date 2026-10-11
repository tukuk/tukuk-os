'use strict';
/**
 * Tukuk Reranker — penatalan semula neural untuk /search.
 *
 * Model: cross-encoder (BERT-style MiniLM) yang di-fine-tune di Kaggle
 * (`fine-tune/reranker/`, fully offline) lalu dieksport ke ONNX via torch.onnx.
 * Ianya dijalankan SEPENUHNYA DALAM NODE menggunakan `@huggingface/transformers`
 * (onnxruntime di belakang tabir) — TIADA cloud, TIADA Ollama, TIADA Python.
 *
 * Kenapa bukan pipeline('text-classification')? Model ini SATU logit (skor
 * relevansi regression). Laluan pipeline boleh apply softmax ke atas 1 logit
 * (= sentiasa 1.0) dan MUSNAK penatalan. Jadi kita muat
 * AutoModelForSequenceClassification terus dan baca LOGIT MENTAH — monotonic
 * dengan relevansi, tepat untuk menyusun dokumen.
 *
 * Konsep: Meilisearch BM25 → calon top-K → skor (query, dokumen) → top-N.
 * Cross-encoder kecil (~22M) cukup laju pada CPU; inilah alat betul untuk
 * ranking (bukan LLM generatif).
 *
 * KESELAMATAN: Jika `enabled=false`, model tiada, atau pembebanan/pengiraan
 * gagal, `rerank()` HANYA memulangkan input asal. /search tidak akan pecah.
 */

const path = require('path');
const fs = require('fs');
const config = require('../config');

let engine = null; // { tokenizer, model }
let loadPromise = null;
const status = {
  enabled: Boolean(config.rerank.enabled),
  backend: 'none', // 'local' | 'cloud' | 'none'
  ready: false,
  attempted: false,
  modelDir: null,
  error: null,
  lastTookMs: null,
  lastCount: 0
};

function resolveModelDir() {
  const p = config.rerank.modelDir;
  return path.isAbsolute(p) ? p : path.join(__dirname, '..', '..', p);
}

/** Fail yang diperlukan untuk memuat model transformers.js. */
function looksDeployed(dir) {
  return (
    fs.existsSync(path.join(dir, 'config.json')) &&
    fs.existsSync(path.join(dir, 'tokenizer.json')) &&
    (fs.existsSync(path.join(dir, 'onnx', 'model_quantized.onnx')) ||
      fs.existsSync(path.join(dir, 'onnx', 'model.onnx')))
  );
}

async function loadOnce() {
  if (loadPromise) return loadPromise;
  status.attempted = true;
  loadPromise = (async () => {
    const dir = resolveModelDir();
    status.modelDir = dir;
    if (!config.rerank.enabled) { status.error = 'disabled'; return null; }
    if (!looksDeployed(dir)) { status.error = 'model-not-found'; return null; }

    // transformers.js ialah ESM — muat secara dinamik dari CommonJS.
    const { AutoTokenizer, AutoModelForSequenceClassification, env } =
      await import('@huggingface/transformers');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    try { env.backends.onnx.logLevel = 'error'; } catch { /* pilihan sahaja */ }

    const tokenizer = await AutoTokenizer.from_pretrained(dir);
    const model = await AutoModelForSequenceClassification.from_pretrained(dir, {
      quantized: config.rerank.quantized
    });
    engine = { tokenizer, model };
    status.ready = true;
    status.error = null;
    return engine;
  })().catch((err) => {
    status.error = err && err.message ? err.message : String(err);
    engine = null;
    return null;
  });
  return loadPromise;
}

/** Teks dokumen untuk dipasangkan dengan query (buang tag highlight). */
function docText(hit) {
  const title = String(hit.title || '').replace(/<\/?mark>/g, '');
  const body = String(
    (hit._formatted && hit._formatted.content) || hit.content || hit.description || ''
  ).replace(/<\/?mark>/g, '');
  return `${title}. ${body}`.replace(/\s+/g, ' ').trim().slice(0, 480);
}

/**
 * Susun semula `hits` ikut relevansi kepada `query`.
 * Pulangkan array asal jika rerank tidak tersedia (selamat).
 * Keutamaan: model ONNX tempatan → embeddings Workers AI cloud → input asal.
 */
async function rerank(query, hits, { topN } = {}) {
  const list = Array.isArray(hits) ? hits : [];
  if (list.length < 2) return list;
  if (!config.rerank.enabled && !config.rerank.cloud) return list;

  // 1) Model cross-encoder tempatan (pilihan utama jika didayakan & di-deploy).
  if (config.rerank.enabled) {
    const eng = await loadOnce();
    if (eng) return localRerank(eng, query, list, topN);
  }

  // 2) Cloud — embeddings Workers AI (bi-encoder kosine). No-op jika tiada cred.
  if (config.rerank.cloud) {
    try {
      // Pagar keras: walaupun fetch menggantung, jangan tahan /search.
      const guard = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('cloud-timeout')), config.rerank.timeoutMs + 800)
      );
      return await Promise.race([cloudRerank(query, list, topN), guard]);
    } catch (err) {
      // Kekalkan isyarat "tiada cred" yang lebih tepat jika sudah diletak.
      if (status.error !== 'cloud-no-creds' && status.error !== 'cloud-no-account') {
        status.error = 'cloud:' + (err && err.message ? err.message : String(err));
      }
      return list; // selamat: jangan pecahkan /search
    }
  }
  return list;
}

/** Rerank dengan model ONNX tempatan (logit mentah cross-encoder). */
async function localRerank(eng, query, list, topN) {
  const started = Date.now();
  const work = (async () => {
    const queries = list.map(() => String(query || ''));
    const passages = list.map((h) => docText(h));
    // API transformers.js v4: 2nd arg = OBJEK options dengan `text_pair`.
    // (Bentuk positional `tok(qs, ps, opts)` SILENTLY menjatuhkan text_pair —
    //  disahkan melalui probe: semua logit menjadi sama.)
    const encoded = await eng.tokenizer(queries, {
      text_pair: passages,
      padding: true,
      truncation: true,
      max_length: 256
    });
    const { logits } = await eng.model(encoded);
    // logits.dims = [batch, 1]; data = Float32Array panjang = batch (logit mentah).
    const data = logits.data;
    const scored = list.map((hit, i) => ({ hit, s: Number(data[i]) || 0 }));
    scored.sort((a, b) => b.s - a.s);
    const sliced = scored.slice(0, topN == null ? scored.length : topN);
    // Tampal skor mentah untuk debug/papar (bukan medan wajib frontend).
    return sliced.map((x) => Object.assign({}, x.hit, { _relevance: Number(x.s.toFixed(4)) }));
  })();

  // Pagar latensi: CPU tanpa AVX2 boleh lambat. Jika kerja melebihi
  // `timeoutMs`, kita SERAH susunan BM25 asal (user tak menunggu lama).
  const guard = new Promise((resolve) => setTimeout(() => resolve(null), config.rerank.timeoutMs));
  try {
    const out = await Promise.race([work, guard]);
    if (out === null) { status.error = 'timeout'; return list; }
    status.backend = 'local';
    status.lastTookMs = Date.now() - started;
    status.lastCount = out.length;
    return out;
  } catch (err) {
    status.error = err && err.message ? err.message : String(err);
    return list; // selamat: jangan pecahkan /search
  }
}

// ── Backend cloud: embeddings Workers AI (bi-encoder kosine) ────────────
// Token: env (CLOUDFLARE_AI_TOKEN/API_TOKEN) ATAU Admin→AI Settings
// (aiProvider=cloudflare + aiApiKey), selari dengan provider.js. Account id
// boleh env atau auto-temui daripada token (/accounts).
function CF_TOKEN() {
  let t = config.brain.cloudflareAiToken || '';
  if (!t) {
    try {
      const s = require('../store');
      if (String(s.getSetting('aiProvider', '') || '').toLowerCase() === 'cloudflare') {
        t = String(s.getSetting('aiApiKey', '') || '');
      }
    } catch { /* store belum sedia */ }
  }
  return t;
}
let acctCache = '';
let acctTried = false;

async function resolveAccount() {
  if (acctCache) return acctCache;
  if (acctTried) return acctCache;
  acctTried = true;
  const token = CF_TOKEN();
  if (!token) return '';
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(6000)
    });
    const j = await r.json().catch(() => ({}));
    acctCache = (j.result && j.result[0] && j.result[0].id) || '';
  } catch {
    acctCache = '';
  }
  return acctCache;
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

async function embedBatch(token, account, texts) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${config.rerank.embedModel}`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts }),
      signal: AbortSignal.timeout(config.rerank.timeoutMs)
    }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.result || !Array.isArray(j.result.data)) {
    const detail = (j.errors && j.errors[0] && j.errors[0].message) || JSON.stringify(j).slice(0, 120);
    throw new Error('embed ' + res.status + ': ' + String(detail).slice(0, 160));
  }
  return j.result.data;
}

async function cloudRerank(query, list, topN) {
  const token = CF_TOKEN();
  if (!token) { status.error = 'cloud-no-creds'; return list; }
  const account = config.brain.cloudflareAccountId || (await resolveAccount());
  if (!account) { status.error = 'cloud-no-account'; return list; }

  const started = Date.now();
  const texts = [String(query || ''), ...list.map((h) => docText(h))];
  const vecs = await embedBatch(token, account, texts);
  if (!Array.isArray(vecs) || vecs.length !== texts.length) throw new Error('embed-count');
  const qv = vecs[0];
  const scored = list.map((hit, i) => ({ hit, s: cosine(qv, vecs[i + 1]) }));
  scored.sort((a, b) => b.s - a.s);
  const sliced = scored.slice(0, topN == null ? scored.length : topN);
  status.backend = 'cloud';
  status.ready = true;
  status.error = null;
  status.lastTookMs = Date.now() - started;
  status.lastCount = sliced.length;
  return sliced.map((x) => Object.assign({}, x.hit, { _relevance: Number(x.s.toFixed(4)) }));
}

/** Adakah sebarang backend rerank benar-benar tersedia (jimatkan query berganda). */
function available() {
  if (config.rerank.enabled && looksDeployed(resolveModelDir())) return true;
  if (config.rerank.cloud && CF_TOKEN()) return true;
  return false;
}

module.exports = { rerank, status, looksDeployed, available };
