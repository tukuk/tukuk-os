/**
 * Task router — membuat model KECIL menjawab lebih baik untuk SEMUA jenis
 * soalan dengan memberikan BENTUK jawapan yang tepat ikut tugas.
 *
 * Realiti: pada VPS CPU-only (qwen2.5:1.5b) kita tak boleh jadikan model 1.5B
 * itu pakar sejagat. TETAPI kualiti keluaran sangat bergantung pada sama ada
 * arahan prompt sepadan dengan JENIS tugasan. Model kecil yang diminta "senarai
 * bernombor" atau "kod fenced" atau "kira langkah demi langkah" jauh lebih
 * seragam dan tepat daripada arahan generic "answer in 2-4 sentences".
 *
 * Pengelasan adalah MULTI-BAHASA (kita baru antarabangsakan /ask): isyarat
 * Melayu/Indonesia/English/Spanish/Portuguese/French/German + angka/operator
 * script-neutral (12*7, 2+2) dan aksara CJK/Arab/Cyrillic untuk kata kunci.
 *
 * Kelas: math | code | compare | list | howto | define | general.
 */

// Ekspresi arithmetik murni / separuh (script-neutral): "12*7", "(3+4)/2", "18%of 250".
const ARITH_SYM_RE = /(\d+\s*[+/\-*x×÷%^]\s*\d+|\d+\s*(?:%|peratus)\s*(?:of|dari|daripada)\s*\d+)/i;
// Bentuk perkataan pelbagai bahasa: "12 darab 7", "10 divided by 4", "5 tambah 3".
const ARITH_WORD_RE = /\b\d+\s*(?:darab|dibahagi|bahagi|tambah|tolak|kurang|kali|power|kuasa|times|multiplied\s+by|divided\s+by|plus|minus|to\s+the\s+power)\s*\d+\b/i;
const ARITH_RE = (q) => ARITH_SYM_RE.test(q) || ARITH_WORD_RE.test(q);

const SIGNALS = {
  math: {
    re: [
      ARITH_SYM_RE,
      ARITH_WORD_RE,
      /\b(hitung|kira|kira|berapakah|calculate|compute|how many|berapa|jumlah|result of|berapa banyak)\b/i,
      /(多少|いくら|كم|कितने|combien|cuánto|quantos|сколько)/,
    ],
  },
  code: {
    // KOD hanya bila ada NIAT mengkod (kata kerja/token teknikal khusus), BUKAN
    // sekadar noun teknologi — "apa itu api" ialah DEFINISI, bukan minta kod.
    re: [
      /\b(kode|kod|code|script|snippet|function|regex|implement|compile|debug|syntax|variable|loop|array|class|method|async|await)\b/i,
      /\b(tulis|buatkan|buat|write|generate|create|make|show me)\b[^.?!]*\b(javascript|typescript|python|java|css|html|sql|bash|json|code|program|api|function|script|query)\b/i,
      /\b(javascript|typescript|python|java|css|html|sql|bash)\b[^.?!]*\b(tulis|write|code|function|snippet|regex|program)\b/i,
      /(代码|код|コード|كود)/,
    ],
  },
  compare: {
    re: [
      /\b(vs\.?|berbeza|perbezaan|beza|beda|difference|diff|compare|perbandingan|kontra|atau\b.*\bbetween|between\b.*\band\b)\b/i,
      /(разница|diferencia|différence|versus|対|vs)/i,
    ],
  },
  list: {
    re: [
      /\b(senarai|senaraikan|list|sebutkan|contoh|contohnya|example|examples|beberapa|top\s?\d|terbaik|best|some\smain|apa\s_saja|antara)\b/i,
      /(列表|例え|リスト|أمثلة|примеры)/,
    ],
  },
  howto: {
    re: [
      /\b(cara|bagaimana|macam mana|macam mana|how to|how do|how does|how can|langkah|steps|guide|panduan|tutorial|kami mana)\b/i,
      /(怎么做|怎么|どうやる|كيف|как)\b/i,
    ],
  },
  define: {
    re: [
      /\b(apa itu|apa ni|maksud|maksudnya|define|definition|what is|what are|who is|who was|siapa|kenapa|mengapa|why is|jelaskan|explain)\b/i,
      /(是什么|何|qué es|qu est|was ist|Was ist|Что такое|ما هو|ما هي|que es|o que é)/i,
    ],
  },
};

// Arahan BENTUK jawapan (English ke model, tetapi WAJIB jawab ikut bahasa
// soalan — dipertegas di sini supaya bentuk + bahasa serentak dipatuhi).
const GUIDANCE = {
  math:
    'This is a numeric/arithmetric question. Compute it STEP BY STEP (show the short ' +
    'calculation), then give ONLY the final result on the last line. If real-world data ' +
    'is required (not pure arithmetic), use the sources; if absent, say you do not know.',
  code:
    'This asks for CODE. Reply with a single fenced code block tagged with the language, ' +
    'minimal but runnable. Add at most one short sentence of explanation. Keep the code ' +
    'self-contained.',
  compare:
    'This compares things. Answer as a short structured comparison — one clear line per ' +
    'item ("A: …", "B: …"), then one sentence stating the key difference. Use the sources.',
  list:
    'This wants a LIST. Give concrete numbered items (1. 2. 3.), each brief. Derive them ' +
    'from the sources; do not pad with filler.',
  howto:
    'This is a how-to. Answer with ordered steps (1. 2. 3.), each one short action. Base ' +
    'the steps on the sources.',
  define:
    'This asks for a definition/explanation. Start with ONE clear defining sentence, then ' +
    'at most one clarifying detail. Ground it in the sources.',
  general:
    'Answer directly and completely in 2-4 sentences, using only the sources.',
};

const path = require('path');

/**
 * Model AI milik sendiri ("Tukuk-Brain Mini") — softmax dilatih
 * scripts/train-brain.js pada data carian/soalan server ini. Regex di atas
 * ialah GURU berketepatan tinggi; model hanya MELAPISKAN CELAH: bila semua
 * regex terlepas (calon 'general'), model yang yakin boleh tukar kelas.
 * Fail: data/tukuk-brain-v1.json (atau env BRAIN_MODEL_FILE). Tiada fail →
 * tingkah laku lama sama sekali (regex-only).
 */
const MODEL_FILE = () => process.env.BRAIN_MODEL_FILE
  || path.join(__dirname, '..', '..', 'data', 'tukuk-brain-v1.json');
let brainCache = null; // { mm, m } | { none: true }
function brainModel() {
  if (!brainCache) {
    try {
      const mm = require('./minimodel');
      const m = mm.load(MODEL_FILE());
      brainCache = { mm, m };
    } catch {
      brainCache = { none: true };
    }
  }
  return brainCache.none ? null : brainCache;
}

// Uji-sahaja: paksa muat semula model (contoh selepas train baru).
function _resetModelCache() { brainCache = null; }

/** Maklumat model untuk paparan /api/models (Data Center). */
function modelInfo() {
  const b = brainModel();
  if (!b) return { loaded: false, file: MODEL_FILE() };
  const meta = b.m.meta || {};
  return {
    loaded: true,
    name: meta.name || 'Tukuk-Brain Mini',
    version: meta.version || '?',
    purpose: meta.purpose || 'intent classifier',
    trainedAt: meta.trainedAt || b.m.savedAt,
    accuracy: meta.accuracy,
    probeAccuracy: meta.probeAccuracy,
    regexGapsRescued: meta.regexGapsRescued,
    classes: b.m.classes,
    sources: meta.sources,
    host: meta.host
  };
}

/** Kelas utama + cadangan guidance + token tambahan (untuk math/code yang perlu ruang). */
function classify(query) {
  const q = String(query || '');
  const regex = classifyRawRegex(q);
  if (regex.kind !== 'general') return regex;
  // Semua regex terlepas → BIAR MODEL NEURAL yang memutuskan (kalau yakin).
  const b = brainModel();
  if (b) {
    const r = b.mm.predict(b.m, q);
    if (r.label !== 'general' && r.p >= 0.5 && r.margin >= 0.2) {
      // code hasil model TIDAK dianggap self-contained (tiada bukti niat kukuh
      // seperti regex) → cuma bentuk jawapan (guidance) ditukar.
      return finalize(r.label);
    }
  }
  return regex;
}

/** Hanya lapisan regex (tanpa model) — dipakai train-brain.js utk ukur celah. */
function classifyRawRegex(q) {
  // Arithmetik: jika boleh dinilai sebagai ekspresi numeric bersih, kira DETERMINISTIK
  // (kalkulator) — jauh lebih tepat daripada model 1.5B. Jika ada perkataan lain
  // (masalah cerita / julat tarikh) → kekal math BERGROUNDED, jangan kira buta.
  if (ARITH_RE(q)) {
    const calc = computeArithmetic(q);
    if (calc) return { ...finalize('math'), pureMath: true, selfContained: true, arithmetic: calc };
    return finalize('math');
  }
  if (matches(SIGNALS.code, q)) return { ...finalize('code'), selfContained: true };
  if (matches(SIGNALS.math, q)) return finalize('math');
  if (matches(SIGNALS.compare, q)) return finalize('compare');
  if (matches(SIGNALS.howto, q)) return finalize('howto');
  if (matches(SIGNALS.list, q)) return finalize('list');
  if (matches(SIGNALS.define, q)) return finalize('define');
  return finalize('general');
}

function matches(sig, q) {
  return sig.re.some((re) => re.test(q));
}

function finalize(kind) {
  return {
    kind,
    guidance: GUIDANCE[kind],
    // Tugasan self-contained ( arithmetic tulen / penjanaan kod ) tidak memerlukan
    // sumber dunia — boleh dijawab terus tanpa gate "mesti ada konteks".
    selfContained: false,
    pureMath: false,
    // code & math untung dengan lebih token; lain cukup ringkas.
    extraTokens: kind === 'code' ? 160 : kind === 'math' ? 60 : 0,
  };
}

// Kata tanya/pengisi yang DIBENARKAN dalam soalan aritmetik (pelbagai bahasa).
// Selepas operator-perkataan ditukar ke simbol & kata ini dibuang, jika ada HURUF
// lain tinggal → soalan itu bukan aritmetik tulen (cth "perang 1939-1945").
const FILLER_RE = new RegExp(
  '\\b(' + [
    'berapa', 'berapakah', 'berapa banyak', 'hitung', 'hitungkan', 'kira', 'kirakan', 'kiran',
    'jumlah', 'result', 'hasil', 'apa', 'itu', 'ini', 'ialah', 'adalah', 'dan', 'kan',
    'peratus', 'percent', 'percentage', 'of', 'dari', 'daripada', 'untuk', 'dalam',
    'what', 'is', 'the', 'how', 'much', 'many', 'calculate', 'compute', 'equals', 'equal',
    'plus', 'minus', 'times', 'multiplied', 'multiply', 'divided', 'divide', 'by', 'total',
    'power', 'to', 'and', 'a', 'an', 'jawi', 'nilai'
  ].join('|') + ')\\b', 'gi');

/**
 * Nilai ekspresi aritmetik SECURA dari teks multi-bahasa. Pulangkan
 * { expression, value } jika ia benar-benar pengiraan numeric bersih; null jika
 * terdapat perkataan/ubah suai lain (supaya pemanggil boleh bergaya grounded).
 */
function computeArithmetic(query) {
  let s = ' ' + String(query || '').toLowerCase() + ' ';
  s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '');
  // "X% of Y" / "X peratus dari Y" → (X/100)*Y
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:%|peratus|percent)\s*(?:of|dari|daripada)\s*(\d+(?:\.\d+)?)/g, '($1/100)*$2');
  // operator-perkataan → simbol
  s = s.replace(/\b(?:darab|kali|times|multiplied|multiply)\b/g, '*');
  s = s.replace(/\b(?:dibahagi|bahagi|divided|divide)\b/g, '/');
  s = s.replace(/\b(?:tambah|plus|add)\b/g, '+');
  s = s.replace(/\b(?:tolak|kurang|minus|subtract|less)\b/g, '-');
  s = s.replace(/\b(?:kuasa|power|eksponen)\b/g, '^');
  // buang kata pengisi yang dibenarkan
  s = s.replace(FILLER_RE, ' ');
  // jika masih ada HURUF (aksara apa-apa script) → bukan aritmetik tulen
  if (/\p{L}/u.test(s)) return null;
  // kunci kepada aksara matematik sahaja
  s = s.replace(/[^0-9.+\-*/^()\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // mestilah ada sekurang-kurangnya satu operator BINARI antara dua angka
  const hasBinOp = /[+*/^]/.test(s) || /\d\s*-\s*\d/.test(s);
  if (!hasBinOp || !/\d/.test(s)) return null;
  // imbang kurungan
  if (((s.match(/\(/g) || []).length) !== ((s.match(/\)/g) || []).length)) return null;
  // bentuk bersih: hanya angka/operator/kurungan/ruang
  if (!/^[-+*/^().\d\s]+$/.test(s)) return null;
  const expr = s.replace(/\^/g, '**');
  let value;
  try {
    value = Function('"use strict"; return (' + expr + ');')();
  } catch {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  value = Math.round(value * 1e10) / 1e10;
  return { expression: s, value };
}

module.exports = { classify, classifyRawRegex, computeArithmetic, modelInfo, _resetModelCache };
