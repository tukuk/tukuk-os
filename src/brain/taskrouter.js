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
const ARITH_RE = /(\d+\s*[+\-*/x×÷%^]\s*\d+|\d+\s*(?:%|peratus)\s*(?:of|dari|daripada)\s*\d+)/i;

const SIGNALS = {
  math: {
    re: [
      ARITH_RE,
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

/** Kelas utama + cadangan guidance + token tambahan (untuk math/code yang perlu ruang). */
function classify(query) {
  const q = String(query || '');
  // Arithmetik jelas menang (kerap tiada kata kunci bahasa).
  if (ARITH_RE.test(q)) return finalize('math');
  if (matches(SIGNALS.code, q)) return finalize('code');
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
    // code & math untung dengan lebih token; lain cukup ringkas.
    extraTokens: kind === 'code' ? 160 : kind === 'math' ? 60 : 0,
  };
}

module.exports = { classify };
