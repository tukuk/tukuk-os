/**
 * Task router — making the SMALL model answer better for EVERY kind of
 * question by giving it the right answer SHAPE for the task.
 *
 * Reality: on a CPU-only VPS (qwen2.5:1.5b) we cannot turn a 1.5B model
 * into an all-round expert. BUT output quality depends heavily on whether the
 * prompt instructions match the task KIND. Asked for a "numbered
 * list" or "fenced code" or "count step by step", a small model is far
 * more consistent and accurate than with the generic "answer in 2-4 sentences".
 *
 * Classification is MULTI-LINGUAL (we just internationalised /ask): Malay/Indonesian/
 * English/Spanish/Portuguese/French/German cues + numbers/operators are
 * script-neutral (12*7, 2+2), with CJK/Arabic/Cyrillic characters for the keywords.
 *
 * Classes: math | code | compare | list | howto | define | general.
 */

// A pure / half arithmetic expression (script-neutral): "12*7", "(3+4)/2", "18%of 250".
const ARITH_SYM_RE = /(\d+\s*[+/\-*x×÷%^]\s*\d+|\d+\s*(?:%|peratus)\s*(?:of|dari|daripada)\s*\d+)/i;
// Multi-language word forms: "12 darab 7", "10 divided by 4", "5 tambah 3".
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
    // CODE only when there is a CODING INTENT (a verb/specific technical token), NOT
    // just a technology noun — "apa itu api" is a DEFINITION, not a request for code.
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

// Answer-SHAPE instructions (English to the model, but it MUST answer in the
// question's language — restated here so shape + language are obeyed together).
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
 * Our own AI model ("Tukuk-Brain Mini") — a softmax trained by
 * scripts/train-brain.js on this server's search/question data. The regexes above
 * are the high-precision TEACHER; the model only BRIDGES THE GAP: when every
 * regex misses (a 'general' candidate), a confident model may change the class.
 * File: data/tukuk-brain-v1.json (or the BRAIN_MODEL_FILE env). No file →
 * the old behaviour entirely (regex-only).
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

// Test-only: force a model reload (e.g. after a fresh training run).
function _resetModelCache() { brainCache = null; }

/** Model info for the /api/models display (Data Center). */
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

/** Main class + fallback guidance + extra tokens (math/code need the room). */
function classify(query) {
  const q = String(query || '');
  const regex = classifyRawRegex(q);
  if (regex.kind !== 'general') return regex;
  // Every regex missed → LET THE NEURAL MODEL decide (when it is confident).
  const b = brainModel();
  if (b) {
    const r = b.mm.predict(b.m, q);
    if (r.label !== 'general' && r.p >= 0.5 && r.margin >= 0.2) {
      // Code from the model is NOT treated as self-contained (no strong intent evidence
      // like the regexes) → only the answer shape (guidance) is changed.
      return finalize(r.label);
    }
  }
  return regex;
}

/** The regex layer only (without the model) — used by train-brain.js to measure the gap. */
function classifyRawRegex(q) {
  // Arithmetic: if it evaluates as a clean numeric expression, compute DETERMINISTICALLY
  // (a calculator) — far more exact than a 1.5B model. If other words remain
  // (a word problem / a date range) → keep the math BERGROUNDED, don't compute blindly.
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
    // Self-contained tasks ( pure arithmetic / code generation ) need no
    // world sources — they can be answered directly without a "context required" gate.
    selfContained: false,
    pureMath: false,
    // code & math gain from more tokens; the others are fine concise.
    extraTokens: kind === 'code' ? 160 : kind === 'math' ? 60 : 0,
  };
}

// Question words/fillers ALLOWED inside arithmetic questions (several languages).
// Once word-operators are converted to symbols & these words are dropped, if any LETTER
// is still left → the question is not pure arithmetic (e.g. "perang 1939-1945").
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
 * Evaluate an arithmetic expression SAFELY from multi-language text. Returns
 * { expression, value } when it really is a clean numeric calculation; null when
 * other words or modifiers remain (so the caller can stay grounded).
 */
function computeArithmetic(query) {
  let s = ' ' + String(query || '').toLowerCase() + ' ';
  s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '');
  // "X% of Y" / "X peratus dari Y" → (X/100)*Y
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:%|peratus|percent)\s*(?:of|dari|daripada)\s*(\d+(?:\.\d+)?)/g, '($1/100)*$2');
  // word operators → symbols
  s = s.replace(/\b(?:darab|kali|times|multiplied|multiply)\b/g, '*');
  s = s.replace(/\b(?:dibahagi|bahagi|divided|divide)\b/g, '/');
  s = s.replace(/\b(?:tambah|plus|add)\b/g, '+');
  s = s.replace(/\b(?:tolak|kurang|minus|subtract|less)\b/g, '-');
  s = s.replace(/\b(?:kuasa|power|eksponen)\b/g, '^');
  // drop the allowed filler words
  s = s.replace(FILLER_RE, ' ');
  // if any LETTER is left (any character of any script) → not pure arithmetic
  if (/\p{L}/u.test(s)) return null;
  // keep to mathematical characters only
  s = s.replace(/[^0-9.+\-*/^()\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // there must be at least one BINARY operator between two numbers
  const hasBinOp = /[+*/^]/.test(s) || /\d\s*-\s*\d/.test(s);
  if (!hasBinOp || !/\d/.test(s)) return null;
  // balance the parentheses
  if (((s.match(/\(/g) || []).length) !== ((s.match(/\)/g) || []).length)) return null;
  // clean shape: only digits/operators/parentheses/spaces
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
