/**
 * Script detection + localized fallback strings (international).
 *
 * The high tier (/ask LLM) already answers in the language of the question — the prompt
 * instruction "IN THE SAME LANGUAGE as the QUESTION" is language-agnostic. This module
 * closes the LOW-LEVEL gap: the fallback paths (no LLM / extractive /
 * web list) that used to hard-code only English/Malay, the sentence splitting
 * that only knew [.!?], and the tokenization that dropped non-Latin characters.
 *
 * Approach: SCRIPT DETECTION (not full language) — enough to pick
 * the right fallback language (CJK -> Chinese, Hangul -> Korean, etc.), and for
 * correct tokenization in spaceless scripts (CJK/Japanese).
 */

const SCRIPT_RE = {
  han: /[\u4E00-\u9FFF\u3400-\u4DBF]/,          // CJK ideograph (Chinese)
  kana: /[\u3040-\u30FF]/,                       // Hiragana/Katakana => Japanese
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF]/,        // Korean
  arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
  cyrillic: /[\u0400-\u04FF]/,
  devanagari: /[\u0900-\u097F]/,
  bengali: /[\u0980-\u09FF]/,
  gurmukhi: /[\u0A00-\u0A7F]/,
  gujarati: /[\u0A80-\u0AFF]/,
  oriya: /[\u0B00-\u0B7F]/,
  tamil: /[\u0B80-\u0BFF]/,
  telugu: /[\u0C00-\u0C7F]/,
  kannada: /[\u0C80-\u0CFF]/,
  malayalam: /[\u0D00-\u0D7F]/,
  sinhala: /[\u0D80-\u0DFF]/,
  thai: /[\u0E00-\u0E7F]/,
  lao: /[\u0E80-\u0EFF]/,
  tibetan: /[\u0F00-\u0FFF]/,
  georgian: /[\u10A0-\u10FF]/,
  armenian: /[\u0530-\u058F]/,
  hebrew: /[\u0590-\u05FF]/,
  greek: /[\u0370-\u03FF\u1F00-\u1FFF]/,
  myanmar: /[\u1000-\u109F]/,
  khmer: /[\u1780-\u17FF]/,
  ethiopic: /[\u1200-\u137F]/,
};

// Script -> locale code. kana wins over han (Japanese mixes in kanji).
const SCRIPT_TO_LOCALE = [
  ['kana', 'ja'],
  ['hangul', 'ko'],
  ['han', 'zh'],
  ['cyrillic', 'ru'],
  ['arabic', 'ar'],
  ['devanagari', 'hi'],
  ['bengali', 'bn'],
  ['gurmukhi', 'pa'],
  ['gujarati', 'gu'],
  ['oriya', 'or'],
  ['tamil', 'ta'],
  ['telugu', 'te'],
  ['kannada', 'kn'],
  ['malayalam', 'ml'],
  ['sinhala', 'si'],
  ['thai', 'th'],
  ['lao', 'lo'],
  ['tibetan', 'bo'],
  ['georgian', 'ka'],
  ['armenian', 'hy'],
  ['hebrew', 'he'],
  ['greek', 'el'],
  ['myanmar', 'my'],
  ['khmer', 'km'],
  ['ethiopic', 'am'],
];

/** Unicode script codes for Latin languages — tells MS/ID/EN/ES/FR/DE/PT apart.
 *  The patterns contain accent-FREE variants (que/como/donde/est ce) because users
 *  often type without accents — but only tokens that are rare in an English query. */
const LATIN_HINTS = [
  [/\b(tidak|tak|apa|itu|ini|dan|yang|di|ke|dari|untuk|dengan|bagaimana|mengapa|adalah|boleh|sudah|saja|atau)\b/i, 'ms'],
  [/\b(qu'est|qu est|quelle|êtes|mercie|français|est-ce|est ce|avec|dans|pour|une|vous|où)\b/i, 'fr'],
  [/\b(ß|ä|ö|ü|wie|was|ist|nicht|und|für|mit|von)\b/, 'de'],
  [/\b(¿|qué|que|dónde|donde|cómo|como|cuándo|gracias|por|una|los|está|esta|también)\b/i, 'es'],
  [/\b(você|voce|não|nao|obrigad|está|como|onde|uma)\b/i, 'pt'],
  [/\b(apakah|bagaimana|kenapa|saja|begini|terima kasih)\b/i, 'id'],
];

/** Localize only as far as we support it; anything else becomes 'en'. */
const LOCALES_SUPPORTED = new Set(['en', 'ms', 'id', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'bn', 'th', 'fr', 'de', 'es', 'pt']);

/** detectLocale('apa itu DNS') -> 'ms'; detectLocale('什么是API') -> 'zh'. */
function detectLocale(text) {
  const s = String(text || '');
  for (const [script, locale] of SCRIPT_TO_LOCALE) {
    if (SCRIPT_RE[script].test(s)) return LOCALES_SUPPORTED.has(locale) ? locale : 'en';
  }
  if (/[a-zA-Z\u00C0-\u024F]/.test(s)) {
    for (const [re, locale] of LATIN_HINTS) {
      if (re.test(s)) return locale;
    }
    return 'en';
  }
  return 'en'; // unsupported script / fallback string → English (safe)
}

/** Spaceless scripts (CJK/Japanese): token = character, not word. */
const SPACELESS_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;
function isSpacelessScript(text) {
  return SPACELESS_RE.test(String(text || ''));
}

// Sentence separators across scripts: Latin `[.!?]`, CJK `。！？`, Devanagari `।॥`,
// Armenian `։`, Greek `·`? — only the markers that truly end a sentence.
const SENTENCE_END = '(?<=[.!?。！？\\u0E5B\\u104A\\u104B।॥։])';

/** Cut text into sentences for ALL scripts (not just [.!?]). */
function splitSentencesUnicode(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(new RegExp(SENTENCE_END + '\\s*'))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Unicode-aware query tokens:
 *  - spaced scripts: words of ≥2 characters (technical `+`/`.` kept)
 *  - spaceless scripts: every CJK character is one token
 *  - combining characters (\u0300-\u036F etc.) stay attached to the letter
 */
function tokenizeQuery(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return [];
  if (isSpacelessScript(s)) {
    return [...s].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  }
  return s
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Display strings for the low level (fallback) — every major language
 * is represented. `t(key, locale)` falls back to 'en' if the key/locale is missing.
 */
const STRINGS = {
  dontKnow: {
    en: "I don't know — that information is not in the Tukuk-OS index.",
    ms: 'Saya tidak tahu — maklumat itu tiada dalam indeks Tukuk-OS.',
    id: 'Saya tidak tahu — informasi itu tidak ada di indeks Tukuk-OS.',
    ja: 'わかりません — その情報はTukuk-OS索引にありません。',
    ko: '모르겠습니다 — 해당 정보가 Tukuk-OS 색인에 없습니다.',
    zh: '我不知道 — 该信息不在 Tukuk-OS 索引中。',
    ru: 'Я не знаю — этой информации нет в индексе Tukuk-OS.',
    ar: 'لا أعرف — هذه المعلومة ليست في فهرس Tukuk-OS.',
    hi: 'मुझे नहीं पता — यह जानकारी Tukuk-OS अनुक्रमणिका में नहीं है।',
    bn: 'আমি জানি না — তথ্যটি Tukuk-OS সূচিতে নেই।',
    th: 'ไม่ทราบ — ข้อมูลนั้นไม่มีในดัชนี Tukuk-OS',
    fr: "Je ne sais pas — cette information n'est pas dans l'index Tukuk-OS.",
    de: 'Ich weiß es nicht — diese Information ist nicht im Tukuk-OS-Index.',
    es: 'No lo sé — esa información no está en el índice de Tukuk-OS.',
    pt: 'Não sei — essa informação não está no índice Tukuk-OS.',
  },
  webListHeader: {
    en: 'Most relevant web results:',
    ms: 'Berikut hasil web yang paling relevan:',
    id: 'Berikut hasil web yang paling relevan:',
    ja: '最も関連するWeb検索結果:',
    ko: '가장 관련성 높은 웹 결과:',
    zh: '最相关的网页结果:',
    ru: 'Наиболее релевантные результаты:',
    ar: 'أكثر نتائج الويب صلة:',
    hi: 'सर्वाधिक प्रासंगिक वेब परिणाम:',
    bn: 'সবচেয়ে প্রাসঙ্গিক ওয়েব ফলাফল:',
    th: 'ผลการค้นหาเว็บที่เกี่ยวข้องที่สุด:',
    fr: 'Résultats web les plus pertinents :',
    de: 'Die relevantesten Web-Ergebnisse:',
    es: 'Resultados web más relevantes:',
    pt: 'Resultados web mais relevantes:',
  },
  extractiveNoPhrase: {
    en: 'No exact phrase match — here are the most relevant results:',
    ms: 'Tiada padanan ayat tepat — ini hasil paling relevan:',
    id: 'Tidak ada frasa yang cocok — ini hasil paling relevan:',
    ja: '完全な一致はありません — 関連する結果:',
    ko: '정확히 일치하는 항목은 없지만 관련 결과:',
    zh: '没有精确匹配 — 以下是最相关的结果:',
    ru: 'Точного совпадения нет — вот наиболее релевантные результаты:',
    ar: 'لا يوجد تطابق تام — هذه أكثر النتائج صلة:',
    hi: 'कोई सঠिक मिलान नहीं — सबसे प्रासंगिक परिणाम:',
    bn: 'সঠিক মিল নেই — সবচেয়ে প্রাসঙ্গিক ফলাফল:',
    th: 'ไม่พบข้อความตรงตัว — นี่คือผลที่เกี่ยวข้องที่สุด:',
    fr: 'Aucune correspondance exacte — voici les résultats les plus pertinents :',
    de: 'Keine exakte Übereinstimmung — hier sind die relevantesten Ergebnisse:',
    es: 'Sin coincidencia exacta — estos son los resultados más relevantes:',
    pt: 'Sem correspondência exata — estes são os resultados mais relevantes:',
  },
  sourcesLabel: {
    en: 'Sources', ms: 'Sumber', id: 'Sumber', ja: '出典', ko: '출처', zh: '来源',
    ru: 'Источники', ar: 'المصادر', hi: 'स्रोत', bn: 'উৎস', th: 'แหล่งข้อมูล',
    fr: 'Sources', de: 'Quellen', es: 'Fuentes', pt: 'Fontes',
  },
};

function t(key, locale) {
  const table = STRINGS[key];
  if (!table) return '';
  return table[locale] || table.en;
}

module.exports = { detectLocale, isSpacelessScript, splitSentencesUnicode, tokenizeQuery, t };
