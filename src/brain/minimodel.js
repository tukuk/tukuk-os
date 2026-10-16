/**
 * minimodel.js — model AI MILIK SENDIRI Tukuk-OS ("Tukuk-Brain Mini").
 *
 * Multinomial logistic regression (softmax) ke atas ciri hashed:
 *   • unigram + bigigram token (pecahan Unicode, bahasa-agnostic)
 *   • trigram aksara (tahan Ejaan berbeza & skrip tanpa-ruang: CJK/Arab/Cyrillic)
 *
 * Kenapa bukan LLM dari-sifar? CPU-only (AMD Kaveri, tiada AVX2) — latih 100M+
 * parameter ambil bulan. Softmax di atas 8192 hashed bucket LATIH dalam detik
 * pada CPU dan MEMANG model neural (lapisan tunggal, gradient descent) —
 * dilatih daripada data carian/soalan server ini sendiri, bukan salinan model orang.
 *
 * Guna: klasifikasi NIAT soalan (math/code/compare/list/howto/define/general)
 * supaya taskrouter pilih bentuk jawapan yang betul walaupun_regex terlepas.
 */

const fs = require('fs');

const DIMS = 8192; // bucket hashed (2^13) — kecil, muat serta-merta di CPU
const CLASSES = ['math', 'code', 'compare', 'list', 'howto', 'define', 'general'];

// FNV-1a — hash 32-bit pantas, distribusi rata untuk token pendek.
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Ciri teks → indeks bucket hashed. Token + bigigram + trigram aksara.
 *  Trigram DIBATASKAN (90): pada set data kecil, trimen tak terhad buat model
 *  menghafal ayat (train 100% / holdout 47%) — unigram+bigigram lebih general. */
function features(text, cap = 240, tri = undefined) {
  const norm = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const idx = new Set();
  const words = norm.split(' ').filter(Boolean);
  for (const w of words) {
    // unigram (abaikan 1 huruf — noise) + bigigram bersebelahan
    if (w.length > 1) idx.add(fnv1a('w:' + w) % DIMS);
    // awalan 4 aksara: morfosintesis ("hitung", "hitungkan", "hitungan" → sama)
    if (w.length > 3) idx.add(fnv1a('p:' + w.slice(0, 4)) % DIMS);
  }
  for (let i = 0; i + 1 < words.length; i += 1) idx.add(fnv1a('b:' + words[i] + ' ' + words[i + 1]) % DIMS);
  // trigram aksara HINGGA tri — penanda bahasa/ejaan sahaja, bukan capaian
  // hafalan; 0 = mati sekali (unigram/bigram murni). tri tersimpan dalam fail
  // model supaya train dan predict SENTIASA pakai ciri yang sama.
  const TRI = tri ?? Number(process.env.BRAIN_TRI ?? 90);
  let c = 0;
  for (let i = 0; i + 2 < norm.length && c < TRI; i += 1, c += 1) idx.add(fnv1a('c:' + norm.slice(i, i + 3)) % DIMS);
  return [...idx].slice(0, cap);
}

// Softmax numerik-stabil (tolak max sebelum exp).
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

/** PRNG berbenih (mulberry32) — latihan Deterministik: seed sama → model sama. */
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
 * Latih daripada contoh {text, label}. Gradient descent SGD + L2.
 * opts: epochs (lalai 80), lr (0.4), l2 (1e-4), seed (42), holdout (0.2).
 * Pulangkan { model, stats } — stats.accuracy ialah kejituan HOLDOUT (tidak
 * dilihat semasa latihan) supaya angka tidak menipu diri sendiri.
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

  // Split holdout rawak-berbenih.
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
    // susun semula setiap epoch (SGD)
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
        // Gradient DESCENT: w ← w − g − l2·w  (g ialah kecerunan × lr).
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

/** Simpan muat JSON — bobot SPARSE (hanya bukan-sifar, dibulat 5 dp): fail
 *  jadi kecil (~50 KB) dan mesra git; muat semula ke vektor padat. */
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
  // sparse → padat; format lama (pejal) turut diterima.
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
