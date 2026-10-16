/**
 * Gate kualiti jawapan + fallback ekstraktif.
 *
 * Model 135M parameter sering gagal abide arahan: mereka menggulang semula
 * arahan, atau memberi jawapan yang tidak berkaitan. Kes ini dikesan di sini.
 *
 * Jika jawapan ditolak, dua pilihan:
 *   1. Cuba model seterusnya dalam rantai.
 *   2. Jika semua gagal — jana jawapan EKSTRAKTIF terus daripada sumber.
 *      Ini tidak guna LLM langsung, jadi sentiasa tepat (tiada halusinasi).
 */

const { detectLocale, isSpacelessScript, splitSentencesUnicode, tokenizeQuery, t } = require('../lang');

const ECHO_MIN_LENGTH = 20;
const MIN_COHERENT_CHARS = 40;
// Skrip tanpa-ruang (CJK/Jepun/Korea): 40 aksara ≈ 20+ perkataan — terlalu ketat.
// Ambang berasingan supaya jawapan Cina 15 aksara yang sah tidak ditolak isEcho,
// dan ayat 20 aksara CJK cukup panjang untuk dipetik.
const MIN_COHERENT_CHARS_SPACELESS = 12;
const SENT_LEN_SPACELESS = [12, 150];

/** Adakah output ini cuma menggulang arahan atau soalan? */
function isEcho(answer, prompt) {
  if (!answer) return true;

  const normalized = answer.toLowerCase().replace(/\s+/g, ' ').trim();
  const minCoherent = isSpacelessScript(normalized) ? MIN_COHERENT_CHARS_SPACELESS : MIN_COHERENT_CHARS;
  if ([...normalized].length < minCoherent) return true;

  // Ayat berulang (litar ulang) — model 135M kerap melakukan ini. Potong
  // Unicode-sedar supaya ulang-an CJK （。！？） turut dikesan.
  const sentences = splitSentencesUnicode(normalized);
  if (sentences.length >= 2) {
    const unique = new Set(sentences.map((s) => s.trim()));
    if (unique.size <= sentences.length / 2) return true;
  }

  // Awalan ayat yang berulang, cth. "The answer is: X. The answer is: X."
  if (sentences.length >= 2) {
    const prefixes = sentences.map((s) => s.slice(0, 24).toLowerCase().trim());
    const uniquePrefixes = new Set(prefixes);
    if (uniquePrefixes.size < prefixes.length && prefixes[0] === prefixes[1]) return true;
  }

  // Ayat yang sama berturut-turut
  for (let i = 1; i < sentences.length; i += 1) {
    if (sentences[i] === sentences[i - 1]) return true;
  }

  // Frasa berulang: "X is: ... X is: ..." lebih dari sekali. Skrip-agnostic —
  // pemisah kata Unicode, sebarang aksara/huruf, sebarang kata bantu common.
  const phraseMatches = normalized.match(/\b\p{L}{3,}\s+(?:is|are|adalah|itu|berarti|c'est|ist|es|son|este)\s*:/gu);
  if (phraseMatches && phraseMatches.length >= 2) {
    const uniquePhrases = new Set(phraseMatches);
    if (uniquePhrases.size < phraseMatches.length) return true;
  }

  // Context dump: model hanya mengembalikan sumber secara mentah tanpa sintesis.
  // Cth. "[1] tajuk\nURL: ...\nLaman: ...\nIsi: ..."
  if (/^\s*\[\d+\]\s/.test(answer) && answer.split('\n').length >= 4) return true;

  // Prompt echo: model menyalin rangka prompt RAG dan bukannya menjawab.
  // Label templat ("QUESTION:", "SOURCES:") bukan bahasa jawapan sebenar —
  // model kecil (smollm/qwen) kerap mulakan output dengan meniru label ini.
  if (/(?:^|\n)\s*(QUESTION|SOURCES)\s*:/i.test(answer)) return true;

  // perkataan yang sama berulang kali — bilangan aksara untuk skrip tanpa-ruang
  const words = normalized.split(/\s+/).filter((w) => [...w].length > 4);
  if (words.length >= 12) {
    const uniqueWords = new Set(words);
    if (uniqueWords.size / words.length < 0.4) return true;
  }

  // Adakah jawapan hanya mengulang garis arahan dalam prompt?
  const promptLines = prompt
    .toLowerCase()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= ECHO_MIN_LENGTH);

  const answerWords = new Set(normalized.replace(/\[\d+\]/g, '').split(/\s+/).filter((w) => [...w].length > 3));
  for (const line of promptLines) {
    if (normalized === line) return true;
    const lineWords = new Set(line.split(/\s+/).filter((w) => [...w].length > 3));
    const overlap = [...answerWords].filter((w) => lineWords.has(w)).length;
    const union = new Set([...answerWords, ...lineWords]).size;
    if (union > 0 && overlap / union > 0.55) return true;
  }

  return false;
}

/** Babak ayat daripada teks, susun mengikut skor relevance. 
 *  Unicode-sedar: CJK 。！？, Devanagari ।॥, Thai ฯ ikut dipotong. */
function splitSentences(text) {
  const spaceless = isSpacelessScript(text);
  const [minLen, maxLen] = spaceless ? SENT_LEN_SPACELESS : [40, 400];
  return splitSentencesUnicode(text)
    .filter((sentence) => sentence.length > minLen && sentence.length < maxLen);
}

function scoreSentence(sentence, terms) {
  const lower = sentence.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score += 3;
    const position = lower.indexOf(term);
    if (position > -1 && position < 60) score += 2;
  }
  return score;
}

/**
 * Jawapan ekstraktif: pilih ayat paling relevan daripada sumber.
 * Tidak menggunakan LLM, jadi tiada risiko halusinasi.
 * Tokenisasi + label berlokal (internasional) — skrip tanpa-ruang (CJK)
 * ditokenkan aksara demi aksara supaya padanan tetap berfungsi.
 */
function extractiveAnswer(question, hits, maxSentences = 3) {
  const locale = detectLocale(question);
  const terms = tokenizeQuery(question);

  // Query berbilang kata perlu padanan kukuh (≥2 kata kunci ATAU kata kunci
  // di posisi awal) supaya ayat yang hanya mengandungi kata umum ("what")
  // tak tersenarai sebagai jawapan. Untuk skrip tanpa-ruang (token = aksara),
  // ambang skor dinaikan supaya 1 aksara common tak cukup.
  const spaceless = isSpacelessScript(question);
  const minScore = terms.length >= 2 ? (spaceless ? 7 : 5) : (spaceless ? 4 : 3);
  const candidates = [];
  for (const hit of hits) {
    const text = String(hit.content || hit.description || '');
    for (const sentence of splitSentences(text)) {
      const score = scoreSentence(sentence, terms);
      if (score >= minScore) candidates.push({ sentence, score, ref: hit.url, title: hit.title });
    }
  }

  if (candidates.length === 0) {
    // Tiada ayat relevan — pulangkan ringkasan tajuk + deskripsi.
    const lines = hits.slice(0, 3).map((hit, position) => `[${position + 1}] ${hit.title} — ${hit.description || hit.url}`);
    return {
      answer: lines.length ? `${t('extractiveNoPhrase', locale)}\n${lines.join('\n')}` : '',
      method: 'extractive-fallback-list'
    };
  }

  // Ambil ayat atas tanpa ulang dalam doc yang sama.
  const seen = new Set();
  const picked = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const key = candidate.sentence.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
    if (picked.length >= maxSentences) break;
  }

  const body = picked.map((item) => item.sentence).join(' ');
  return {
    answer: `${body}\n\n(${t('sourcesLabel', locale)}: ${[...new Set(picked.map((item) => item.title))].join('; ')})`,
    method: 'extractive'
  };
}

module.exports = { isEcho, extractiveAnswer, splitSentences };