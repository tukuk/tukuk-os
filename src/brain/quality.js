/**
 * Answer-quality gate + extractive fallback.
 *
 * The 135M-parameter model often fails to abide by the instructions: it repeats
 * the instruction, or gives an answer that is unrelated. Those cases are caught here.
 *
 * If an answer is rejected there are two options:
 *   1. Try the next model in the chain.
 *   2. If all fail — generate an EXTRACTIVE answer straight from the sources.
 *      This uses no LLM at all, so it is always exact (no hallucination).
 */

const { detectLocale, isSpacelessScript, splitSentencesUnicode, tokenizeQuery, t } = require('../lang');

const ECHO_MIN_LENGTH = 20;
const MIN_COHERENT_CHARS = 40;
// Space-less scripts (CJK/Japanese/Korean): 40 characters ≈ 20+ words — too strict.
// A separate threshold so a valid 15-character Chinese answer is not rejected by isEcho,
// and a 20-character CJK sentence is long enough to be quoted.
const MIN_COHERENT_CHARS_SPACELESS = 12;
const SENT_LEN_SPACELESS = [12, 150];

/**
 * Question words only — not entities, so they could match ANY paragraph.
 * "how many counties" used to be enough to pass a blog sentence about
 * "how many animals"; now only CONTENT TERMS drive the score & eligibility.
 * This list is deliberately conservative: words always present in human questions.
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

/** Terms that genuinely carry meaning (entities), for sentence scoring & eligibility. */
function contentTerms(terms) {
  return (terms || []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Is this output merely repeating the instruction or the question?
 * `opts.smallModel === false` (a big cloud model): the two anti-small-model heuristics
 * are SKIPPED — the 40-character length floor and the ban on the "(Sources: …)" marker.
 * A valid short answer ("California has 58 counties." = 28 characters) and an
 * honest refusal ("I don't know." = 13 characters) were previously dropped as echo,
 * so /ask fell to an extractive paragraph that was not related at all.
 * The repeat-prompt / repeated-sentence / context-dump checks still run.
 */
function isEcho(answer, prompt, opts = {}) {
  const small = opts.smallModel !== false;
  if (!answer) return true;

  const normalized = answer.toLowerCase().replace(/\s+/g, ' ').trim();
  const minCoherent = isSpacelessScript(normalized) ? MIN_COHERENT_CHARS_SPACELESS : MIN_COHERENT_CHARS;
  if (small && [...normalized].length < minCoherent) return true;

  // Repeated sentences (a loop) — the 135M model does this often. Cut
  // Unicode-aware so repeated CJK punctuation （。！？） is detected too.
  const sentences = splitSentencesUnicode(normalized);
  if (sentences.length >= 2) {
    const unique = new Set(sentences.map((s) => s.trim()));
    if (unique.size <= sentences.length / 2) return true;
  }

  // Repeated sentence prefixes, e.g. "The answer is: X. The answer is: X."
  if (sentences.length >= 2) {
    const prefixes = sentences.map((s) => s.slice(0, 24).toLowerCase().trim());
    const uniquePrefixes = new Set(prefixes);
    if (uniquePrefixes.size < prefixes.length && prefixes[0] === prefixes[1]) return true;
  }

  // The same sentence back to back
  for (let i = 1; i < sentences.length; i += 1) {
    if (sentences[i] === sentences[i - 1]) return true;
  }

  // Repeated phrase: "X is: ... X is: ..." more than once. Script-agnostic —
  // Unicode word separators, any characters/letters, any common helper word.
  const phraseMatches = normalized.match(/\b\p{L}{3,}\s+(?:is|are|adalah|itu|berarti|c'est|ist|es|son|este)\s*:/gu);
  if (phraseMatches && phraseMatches.length >= 2) {
    const uniquePhrases = new Set(phraseMatches);
    if (uniquePhrases.size < phraseMatches.length) return true;
  }

  // Context dump: the model returns the source raw, with no synthesis.
  // E.g. "[1] tajuk\nURL: ...\nLaman: ...\nIsi: ..."
  if (/^\s*\[\d+\]\s/.test(answer) && answer.split('\n').length >= 4) return true;

  // Prompt echo: the model copies the RAG prompt skeleton instead of answering.
  // Template labels ("QUESTION:", "SOURCES:") are not real answer language —
  // small models (smollm/qwen) often start their output by mimicking these labels.
  if (/(?:^|\n)\s*(QUESTION|SOURCES)\s*:/i.test(answer)) return true;

  // Small models also emit "(Sumber: ...)" or "(Sources: ...)" at the end of the
  // answer — a template shape copied from the extractive prompt, not a real
  // LLM answer. If the answer starts with sentences and ENDS with a source
  // label, it is an echo that has to be rejected.
  if (small && /\n\s*\((?:Sources|Sumber|Source):/i.test(answer)) return true;

  // the same word over and over — a character count for space-less scripts
  const words = normalized.split(/\s+/).filter((w) => [...w].length > 4);
  if (words.length >= 12) {
    const uniqueWords = new Set(words);
    if (uniqueWords.size / words.length < 0.4) return true;
  }

  // Does the answer just repeat the instruction lines from the prompt?
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

/** Split text into sentences, ordered by relevance score.
 *  Unicode-aware: CJK 。！？, Devanagari ।॥ and Thai ฯ are split too. */
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
 * Extractive answer: pick the sentences most relevant to the sources.
 * It uses no LLM, so there is no hallucination risk.
 * Tokenisation + labels are locale-aware (international) — space-less scripts (CJK)
 * are tokenised character by character so matching keeps working.
 */
function extractiveAnswer(question, hits, maxSentences = 3) {
  const locale = detectLocale(question);
  const terms = tokenizeQuery(question);
  // Score + eligibility run on CONTENT TERMS only. Before, the question "how many
  // counties does California have" passed by quoting a blog sentence that merely
  // contained "how" + "many" → a wrong answer presented as fact.
  // Space-less scripts (CJK) tokenize into single characters → no content terms,
  // so `scoreTerms` falls back to all terms (the old behaviour is preserved).
  const ct = contentTerms(terms);
  const scoreTerms = ct.length ? ct : terms;

  // A multi-word query needs a strong match (≥2 keywords OR a keyword
  // at the start of the sentence) so a sentence containing only a general word ("what")
  // is not listed as an answer. For space-less scripts (token = one character),
  // the score threshold is raised so a single common character is not enough.
  const spaceless = isSpacelessScript(question);
  const minScore = scoreTerms.length >= 2 ? (spaceless ? 7 : 5) : (spaceless ? 4 : 3);
  const candidates = [];
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    // Meilisearch ranking bias: article #1 must beat article #N
    // (N>1) that happens to have one early match. Without this bias, the question
    // "air test" could pick the sentence "England Test captain" (test @ pos ~8)
    // and drop "Volunteers breathe polluted air..." (air @ pos ~65 →
    // loses the +2 bonus, score 3 < minScore 5 → dropped).
    const rankBias = Math.max(0, hits.length - i);
    // Read the article's full body (content) when present — the one-sentence description
    // is often too short and question terms may exist in the article body
    // which Meilisearch already cropped into _formatted.content.
    const raw = String(hit.content || hit._formatted?.content || hit.description || '');
    const text = raw.replace(/<\/?mark>/g, '');
    for (const sentence of splitSentences(text)) {
      const lower = sentence.toLowerCase();
      // At least ONE question entity must appear in the sentence — otherwise
      // that sentence is not an answer, whatever its score.
      if (ct.length && !ct.some((term) => lower.includes(term))) continue;
      const score = scoreSentence(sentence, scoreTerms) + rankBias;
      if (score >= minScore) candidates.push({ sentence, score, ref: hit.url, title: hit.title, rank: i });
    }
  }

  if (candidates.length === 0) {
    // No relevant sentence — return a summary of titles + descriptions.
    const lines = hits.slice(0, 3).map((hit, position) => `[${position + 1}] ${hit.title} — ${hit.description || hit.url}`);
    return {
      answer: lines.length ? `${t('extractiveNoPhrase', locale)}\n${lines.join('\n')}` : '',
      method: 'extractive-fallback-list'
    };
  }

  // ONLY one document: mixing sentences from different articles produces
  // a "two unrelated facts" paragraph that looks like an answer. Take the
  // best candidate document (same score → the earlier ranking) up to
  // `maxSentences` of its sentences, without repeats.
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