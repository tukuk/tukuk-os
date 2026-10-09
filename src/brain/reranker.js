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
 */
async function rerank(query, hits, { topN } = {}) {
  const list = Array.isArray(hits) ? hits : [];
  if (!config.rerank.enabled || list.length === 0) return list;
  const eng = await loadOnce();
  if (!eng) return list;

  const started = Date.now();
  try {
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
    status.lastTookMs = Date.now() - started;
    status.lastCount = scored.length;
    const sliced = scored.slice(0, topN == null ? scored.length : topN);
    // Tampal skor mentah untuk debug/papar (bukan medan wajib frontend).
    return sliced.map((x) => Object.assign({}, x.hit, { _relevance: Number(x.s.toFixed(4)) }));
  } catch (err) {
    status.error = err && err.message ? err.message : String(err);
    return list; // selamat: jangan pecahkan /search
  }
}

module.exports = { rerank, status, looksDeployed };
