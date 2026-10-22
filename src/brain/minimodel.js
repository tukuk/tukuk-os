/**
 * minimodel.js — Tukuk-OS's OWN AI model ("Tukuk-Brain Mini").
 *
 * Multinomial logistic regression (softmax) over hashed features:
 *   • token unigrams + bigrams (Unicode splits, language-agnostic)
 *   • character trigrams (tolerant of spelling variants & space-less scripts: CJK/Arabic/Cyrillic)
 *
 * Why not an LLM from scratch? CPU-only (AMD Kaveri, no AVX2) — training 100M+
 * parameters takes months. A softmax over 8192 hashed buckets TRAINS in seconds
 * on CPU and IS genuinely a neural model (single layer, gradient descent) —
 * trained from this server's own search/question data, not a copy of someone else's model.
 *
 * Use: classify the question's INTENT (math/code/compare/list/howto/define/general)
 * so taskrouter picks the right answer shape even when a regex is missed.
 */

const fs = require('fs');

const DIMS = 8192; // hashed buckets (2^13) — small, loads instantly on CPU
const CLASSES = ['math', 'code', 'compare', 'list', 'howto', 'define', 'general'];

// FNV-1a — a fast 32-bit hash with an even spread for short tokens.
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Text features → hashed bucket indices. Tokens + bigrams + character trigrams.
 *  Trigrams are CAPPED (90): on a small dataset unlimited trigrams make the model
 *  memorise sentences (train 100% / holdout 47%) — unigrams+bigrams generalise better. */
function features(text, cap = 240, tri = undefined) {
  const norm = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const idx = new Set();
  const words = norm.split(' ').filter(Boolean);
  for (const w of words) {
    // unigrams (skip single letters — noise) + adjacent bigrams
    if (w.length > 1) idx.add(fnv1a('w:' + w) % DIMS);
    // 4-char prefix: morphosynthesis ("hitung", "hitungkan", "hitungan" → identical)
    if (w.length > 3) idx.add(fnv1a('p:' + w.slice(0, 4)) % DIMS);
  }
  for (let i = 0; i + 1 < words.length; i += 1) idx.add(fnv1a('b:' + words[i] + ' ' + words[i + 1]) % DIMS);
  // Character trigrams UP TO tri — only a language/spelling marker, not a memorisation
  // channel; 0 = off entirely (pure unigrams/bigrams). tri is stored in the model file
  // so training and prediction ALWAYS use the same features.
  const TRI = tri ?? Number(process.env.BRAIN_TRI ?? 90);
  let c = 0;
  for (let i = 0; i + 2 < norm.length && c < TRI; i += 1, c += 1) idx.add(fnv1a('c:' + norm.slice(i, i + 3)) % DIMS);
  return [...idx].slice(0, cap);
}

// Numerically stable softmax (subtract the max before exp).
function softmax(logits) {
  const m = Math.max(...logits);
  const ex = logits.map((v) => Math.exp(v - m));
  const s = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map((v) => v / s);
}

function scoreAll(featIdx, W, bias) {
  const out = new Array(W.length);
  for (let c = 0; c < W.length; c += 1) {
    let z = bias[c];
    const row = W[c];
    for (const i of featIdx) z += row[i];
    out[c] = z;
  }
  return out;
}

/** Seeded PRNG (mulberry32) — deterministic training: the same seed → the same model. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Train on {text, label} examples. SGD gradient descent + L2.
 * opts: epochs (default 80), lr (0.4), l2 (1e-4), seed (42), holdout (0.2).
 * Returns { model, stats } — stats.accuracy is the HOLDOUT accuracy (never
 * seen during training) so the number isn't self-deception.
 */
function train(examples, opts = {}) {
  const epochs = opts.epochs ?? 80;
  const lr = opts.lr ?? 0.4;
  const l2 = opts.l2 ?? 1e-4;
  const tri = opts.tri ?? Number(process.env.BRAIN_TRI ?? 90);
  const rand = rng(opts.seed ?? 42);
  const classes = opts.classes || CLASSES;

  const data = examples
    .filter((e) => classes.includes(e.label) && String(e.text || '').trim())
    .map((e) => ({ x: features(e.text, 240, tri), y: classes.indexOf(e.label) }));
  if (data.length < classes.length) throw new Error('too few examples to train');

  // Seeded random holdout split.
  for (let i = data.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [data[i], data[j]] = [data[j], data[i]];
  }
  const nTest = Math.max(1, Math.floor(data.length * (opts.holdout ?? 0.2)));
  const test = data.slice(0, nTest);
  const fit = data.slice(nTest);

  const W = classes.map(() => new Float64Array(DIMS));
  const bias = new Float64Array(classes.length);

  let lastTrainAcc = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    // reshuffle every epoch (SGD)
    for (let i = fit.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [fit[i], fit[j]] = [fit[j], fit[i]];
    }
    let correct = 0;
    for (const { x, y } of fit) {
      const p = softmax(scoreAll(x, W, bias));
      let best = 0;
      for (let c = 1; c < p.length; c += 1) if (p[c] > p[best]) best = c;
      if (best === y) correct += 1;
      for (let c = 0; c < p.length; c += 1) {
        const g = (p[c] - (c === y ? 1 : 0)) * lr;
        // Gradient DESCENT: w ← w − g − l2·w  (g is the gradient × lr).
        bias[c] -= g;
        for (const i of x) W[c][i] -= g + l2 * W[c][i];
      }
    }
    lastTrainAcc = correct / Math.max(1, fit.length);
  }

  let ok = 0;
  for (const { x, y } of test) {
    const s = scoreAll(x, W, bias);
    let best = 0;
    for (let c = 1; c < s.length; c += 1) if (s[c] > s[best]) best = c;
    if (best === y) ok += 1;
  }

  const perClass = classes.map((name, c) => ({
    name,
    samples: data.filter((d) => d.y === c).length
  }));

  const model = { classes, W: Array.from(W, (row) => Array.from(row)), bias: Array.from(bias), tri };
  return {
    model,
    stats: {
      examples: data.length,
      heldOut: nTest,
      accuracy: Math.round((ok / Math.max(1, nTest)) * 1000) / 1000,
      trainAccuracy: Math.round(lastTrainAcc * 1000) / 1000,
      epochs, lr, seed: opts.seed ?? 42,
      perClass
    }
  };
}

/** JSON save/load — weights are SPARSE (non-zeros only, rounded to 5 dp): the file
 *  stays small (~50 KB) and git-friendly; it reloads into dense vectors. */
function save(model, file, meta = {}) {
  const rows = model.classes.map((_, c) => {
    const nz = [];
    const row = model.W[c];
    for (let i = 0; i < DIMS; i += 1) {
      const v = Math.round((row[i] || 0) * 1e5) / 1e5;
      if (v !== 0) nz.push([i, v]);
    }
    return nz;
  });
  const payload = {
    format: 'tukuk-minimodel-v1',
    sparse: true,
    dims: DIMS,
    tri: model.tri ?? 90,
    savedAt: new Date().toISOString(),
    meta,
    classes: model.classes,
    bias: model.bias.map((v) => Math.round((v || 0) * 1e5) / 1e5),
    W: rows
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  return payload;
}

function load(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.format !== 'tukuk-minimodel-v1') throw new Error('not a tukuk minimodel file');
  // sparse → dense; the older (dense) format is still accepted.
  const W = raw.classes.map((_, c) => {
    const dense = new Float64Array(DIMS);
    if (raw.sparse) { for (const [i, v] of raw.W[c]) dense[i] = v; }
    else raw.W[c].forEach((v, i) => { dense[i] = v; });
    return dense;
  });
  return {
    classes: raw.classes,
    W,
    bias: Float64Array.from(raw.bias),
    tri: raw.tri ?? 90,
    meta: raw.meta || {},
    savedAt: raw.savedAt
  };
}

/** Ramal → { label, p (top), margin, probs }. Margin = top1 − top2. */
function predict(model, text) {
  const s = scoreAll(features(text, 240, model.tri), model.W, model.bias);
  const probs = softmax(s);
  let top = 0;
  let second = 1;
  for (let i = 1; i < probs.length; i += 1) {
    if (probs[i] > probs[top]) { second = top; top = i; }
  }
  return {
    label: model.classes[top],
    p: probs[top],
    margin: probs[top] - probs[second],
    probs: Object.fromEntries(model.classes.map((c, i) => [c, Math.round(probs[i] * 1000) / 1000]))
  };
}

module.exports = { train, predict, save, load, features, DIMS, CLASSES };
