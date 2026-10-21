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

/**
 * Terma soal sahaja — bukan entiti, jadi ia boleh padan dengan SEMBARANG
 * perenggan. "how many counties" dulu cukup untuk meluluskan ayat blog tentang
 * "how many animals"; kini hanya TERMA KANDUNGAN yang mengira skor & kelayakan.
 * Senarai ini sengaja konservatif: kata yang sentiasa ada dalam soalan manusia.
 */
const STOPWORDS = new Set([
  // Melayu / Indonesia
  'apa', 'apakah', 'itu', 'ini', 'yang', 'dan', 'atau', 'untuk', 'dengan', 'dari',
  'kepada', 'pada', 'dalam', 'adalah', 'siapa', 'berapa', 'mana', 'bila', 'kenapa',
  'mengapa', 'bagaimana', 'sudah', 'boleh', 'tidak', 'tak', 'ada', 'akan', 'kah',
  // Inggeris
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'about', 'into',
  'how', 'many', 'much', 'more', 'most', 'long', 'far', 'old', 'new', 'big',
  'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'whose', 'that', 'this',
  'these', 'those', 'there', 'here', 'it', 'its', 'i', 'you', 'we', 'they', 'he',
  'she', 'him', 'her', 'my', 'me', 'our', 'their', 'can', 'could', 'will', 'would',
  'should', 'shall', 'may', 'might', 'have', 'has', 'had', 'not', 'no', 'yes', 'so',
  'if', 'then', 'than', 'very', 'just', 'also', 'get', 'gets', 'like', 'well', 'ever'
]);

/** Terma yang benar-benar membawa makna (entiti), untuk skor & kelayakan ayat. */
function contentTerms(terms) {
  return (terms || []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Adakah output ini cuma menggulang arahan atau soalan?
 * `opts.smallModel === false` (model awan besar): dua heuristik anti-model-kecil
 * DILOMPATKAN — lantai panjang 40 aksara dan larangan penanda "(Sources: …)".
 * Jawapan ringkas yang sah ("California has 58 counties." = 28 aksara) dan
 * penolakan jujur ("I don't know." = 13 aksara) dahulu dibuang sebagai echo,
 * sehingga /ask jatuh ke perenggan ekstraktif yang tak berkaitan sama sekali.
 * Semakan ulang-prompt / ayat berulang / context dump tetap berjalan.
 */
function isEcho(answer, prompt, opts = {}) {
  const small = opts.smallModel !== false;
  if (!answer) return true;

  const normalized = answer.toLowerCase().replace(/\s+/g, ' ').trim();
  const minCoherent = isSpacelessScript(normalized) ? MIN_COHERENT_CHARS_SPACELESS : MIN_COHERENT_CHARS;
  if (small && [...normalized].length < minCoherent) return true;

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

  // Model kecil juga menghasilkan "(Sumber: ...)" atau "(Sources: ...)" di akhir
  // jawapan — bentuk templat yang ditiru dari prompt ekstraktif, bukan jawapan
  // LLM sebenar. Jika jawapan bermula dengan ayat dan TAMAT dengan label
  // sumber, ia adalah echo yang perlu ditolak.
  if (small && /\n\s*\((?:Sources|Sumber|Source):/i.test(answer)) return true;

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
  // Skor + kelayakan hanya pada TERMA KANDUNGAN. Sebelumnya soalan "how many
  // counties does California have" lulus dengan memetik ayat blog yang cuma
  // mengandungi "how" + "many" → jawapan salah tersaji sebagai fakta.
  // Skrip tanpa-ruang (CJK) tokenize jadi aksara tunggal → tiada terma kandungan,
  // jadi `scoreTerms` jatuh kembali ke semua terma (kelakuan lama dikekalkan).
  const ct = contentTerms(terms);
  const scoreTerms = ct.length ? ct : terms;

  // Query berbilang kata perlu padanan kukuh (≥2 kata kunci ATAU kata kunci
  // di posisi awal) supaya ayat yang hanya mengandungi kata umum ("what")
  // tak tersenarai sebagai jawapan. Untuk skrip tanpa-ruang (token = aksara),
  // ambang skor dinaikan supaya 1 aksara common tak cukup.
  const spaceless = isSpacelessScript(question);
  const minScore = scoreTerms.length >= 2 ? (spaceless ? 7 : 5) : (spaceless ? 4 : 3);
  const candidates = [];
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    // Bias ranking Meilisearch: artikel #1 mesti menang ke atas artikel #N
    // (N>1) yang kebetulan ada satu padanan awal. Tanpa bias ini, soalan
    // "air test" boleh pick ayat "England Test captain" (test @ pos ~8)
    // dan buang "Volunteers breathe polluted air..." (air @ pos ~65 →
    // hilang bonus +2, skor 3 < minScore 5 → dibuang).
    const rankBias = Math.max(0, hits.length - i);
    // Baca badan penuh artikel (content) jika ada — description 1-ayat
    // sering terlalu pendek & terma soalan mungkin wujud dalam isi artikel
    // yang mana Meilisearch dah crop ke _formatted.content.
    const raw = String(hit.content || hit._formatted?.content || hit.description || '');
    const text = raw.replace(/<\/?mark>/g, '');
    for (const sentence of splitSentences(text)) {
      const lower = sentence.toLowerCase();
      // Wajib ada sekurang-kurangnya SATU entiti soalan dalam ayat — jika tidak,
      // ayat itu bukan jawapan, berapa pun skornya.
      if (ct.length && !ct.some((term) => lower.includes(term))) continue;
      const score = scoreSentence(sentence, scoreTerms) + rankBias;
      if (score >= minScore) candidates.push({ sentence, score, ref: hit.url, title: hit.title, rank: i });
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

  // SATU dokumen sahaja: mencampur ayat daripada artikel berbeza menghasilkan
  // perenggan "dua fakta tak berkaitan" yang kelihatan seperti jawapan. Ambil
  // dokumen calon terbaik (sama skor → ranking lebih awal) sehingga
  // `maxSentences` ayatnya, tanpa ayat berulang.
  candidates.sort((a, b) => (b.score - a.score) || (a.rank - b.rank));
  const bestRef = candidates[0].ref;
  const seen = new Set();
  const picked = [];
  for (const candidate of candidates) {
    if (candidate.ref !== bestRef) continue;
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

module.exports = { isEcho, extractiveAnswer, splitSentences, contentTerms };