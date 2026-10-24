'use strict';
/**
 * Tukuk Reranker — neural re-ranking for /search.
 *
 * Model: a cross-encoder (BERT-style MiniLM) fine-tuned on Kaggle
 * (`fine-tune/reranker/`, fully offline) then exported to ONNX via torch.onnx.
 * It runs ENTIRELY IN NODE using `@huggingface/transformers`
 * (onnxruntime behind the scenes) — NO cloud, NO Ollama, NO Python.
 *
 * Why not pipeline('text-classification')? This model has ONE logit (a regression
 * relevance score). The pipeline path may apply softmax over a single logit
 * (= always 1.0) and DESTROY the ranking. So we load
 * AutoModelForSequenceClassification directly and read the RAW LOGITS — monotonic
 * with relevance, exactly right for ordering documents.
 *
 * Concept: Meilisearch BM25 → top-K candidates → score (query, document) → top-N.
 * A small cross-encoder (~22M) is fast enough on CPU; this is the right tool for
 * ranking (not a generative LLM).
 *
 * SAFETY: if `enabled=false`, the model is missing, or loading/scoring fails,
 * `rerank()` RETURNS ONLY the original input. /search will not break.
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

/** The files required to load a transformers.js model. */
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

    // transformers.js is ESM — load it dynamically from CommonJS.
    const { AutoTokenizer, AutoModelForSequenceClassification, env } =
      await import('@huggingface/transformers');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    try { env.backends.onnx.logLevel = 'error'; } catch { /* optional only */ }

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

/** Document text to pair with the query (highlight tags stripped). */
function docText(hit) {
  const title = String(hit.title || '').replace(/<\/?mark>/g, '');
  const body = String(
    (hit._formatted && hit._formatted.content) || hit.content || hit.description || ''
  ).replace(/<\/?mark>/g, '');
  return `${title}. ${body}`.replace(/\s+/g, ' ').trim().slice(0, 480);
}

/**
 * Reorder `hits` by relevance to `query`.
 * Returns the original array when reranking isn't available (safe).
 * Preference: local ONNX cross-encoder → cloud Workers AI embeddings → original input.
 */
async function rerank(query, hits, { topN } = {}) {
  const list = Array.isArray(hits) ? hits : [];
  if (list.length < 2) return list;
  if (!config.rerank.enabled && !config.rerank.cloud) return list;

  // 1) The local cross-encoder model (the main choice when enabled & deployed).
  if (config.rerank.enabled) {
    const eng = await loadOnce();
    if (eng) return localRerank(eng, query, list, topN);
  }

  // 2) Cloud — Workers AI embeddings (cosine bi-encoder). A no-op without credentials.
  if (config.rerank.cloud) {
    try {
      // Hard guard: even if the fetch hangs, never hold up /search.
      const guard = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('cloud-timeout')), config.rerank.timeoutMs + 800)
      );
      return await Promise.race([cloudRerank(query, list, topN), guard]);
    } catch (err) {
      // Keep the more precise "no creds" signal if it was already set.
      if (status.error !== 'cloud-no-creds' && status.error !== 'cloud-no-account') {
        status.error = 'cloud:' + (err && err.message ? err.message : String(err));
      }
      return list; // safe: don't break /search
    }
  }
  return list;
}

/** Rerank with the local ONNX model (raw cross-encoder logits). */
async function localRerank(eng, query, list, topN) {
  const started = Date.now();
  const work = (async () => {
    const queries = list.map(() => String(query || ''));
    const passages = list.map((h) => docText(h));
    // transformers.js v4 API: the 2nd arg = an options OBJECT with `text_pair`.
    // (The positional form `tok(qs, ps, opts)` SILENTLY drops text_pair —
    //  confirmed by probe: every logit came out identical.)
    const encoded = await eng.tokenizer(queries, {
      text_pair: passages,
      padding: true,
      truncation: true,
      max_length: 256
    });
    const { logits } = await eng.model(encoded);
    // logits.dims = [batch, 1]; data = Float32Array of length = batch (raw logits).
    const data = logits.data;
    const scored = list.map((hit, i) => ({ hit, s: Number(data[i]) || 0 }));
    scored.sort((a, b) => b.s - a.s);
    const sliced = scored.slice(0, topN == null ? scored.length : topN);
    // Attach the raw scores for debug/display (not a required frontend field).
    return sliced.map((x) => Object.assign({}, x.hit, { _relevance: Number(x.s.toFixed(4)) }));
  })();

  // Latency guard: a CPU without AVX2 can be slow. If the work exceeds
  // `timeoutMs`, we SURRENDER the original BM25 order (users don't wait).
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
    return list; // safe: don't break /search
  }
}

// ── Cloud backend: Workers AI embeddings (cosine bi-encoder) ────────────
// Token: env (CLOUDFLARE_AI_TOKEN/API_TOKEN) OR Admin→AI Settings
// (aiProvider=cloudflare + aiApiKey), matching provider.js. The account id
// may come from env or be auto-discovered from the token (/accounts).
function CF_TOKEN() {
  let t = config.brain.cloudflareAiToken || '';
  if (!t) {
    try {
      const s = require('../store');
      if (String(s.getSetting('aiProvider', '') || '').toLowerCase() === 'cloudflare') {
        t = String(s.getSetting('aiApiKey', '') || '');
      }
    } catch { /* store not ready yet */ }
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

/** Whether any rerank backend is really available (avoids repeated queries). */
function available() {
  if (config.rerank.enabled && looksDeployed(resolveModelDir())) return true;
  if (config.rerank.cloud && CF_TOKEN()) return true;
  return false;
}

/**
 * Load whatever backend this box actually has before the first visitor needs it.
 *
 * Both backends pay a one-off cost on their first call: the cloud one loads the model at the
 * edge (measured from this VPS, 623 ms for the first embed against 203 ms for the next, and the
 * second embed of the same text was the warm one), and the local one parses an ONNX file into
 * memory. Whoever types the first search after a restart paid that cost in full — 1.3 s end to
 * end against 0.25 s warm. One tiny embed at boot removes it.
 *
 * Never throws and never retries: a warm-up that fails is a warm-up that was not needed yet.
 */
async function warm() {
  try {
    if (!available()) return false;
    if (config.rerank.enabled && looksDeployed(resolveModelDir())) {
      if (!(await loadOnce())) return false;
    }
    if (config.rerank.cloud) {
      const token = CF_TOKEN();
      if (!token) return false;
      const account = config.brain.cloudflareAccountId || (await resolveAccount());
      if (!account) return false;
      await embedBatch(token, account, ['warm up']);
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { rerank, warm, status, looksDeployed, available };
