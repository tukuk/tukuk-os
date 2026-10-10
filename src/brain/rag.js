const config = require('../config');
const { client } = require('../meili');
const { systemPrompt, knowledge } = require('./knowledge');
const provider = require('./provider');
const websearch = require('./websearch');
const { isEcho, extractiveAnswer } = require('./quality');
const { detectLocale, t } = require('../lang');

const index = client.index(config.indexName);

const THINKING_PATTERNS = [
  /\bapa(kan)? (itu|ini)\b/,
  /\bbagaimanakah\b/,
  /\bmengapa\b/,
  /\bbAGA(pa|macara)\b/,
  /\bapa itu\b/,
  /\bmaksud\b/,
  /\bdefine\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bwhy\b/i,
  /\bexplain\b/i
];

const TUUK_PATTERNS = [
  /\btukuk[\s-]?os\b/i,
  /\baplikasi (ini|tukuk)\b/i,
  /\bantai ni\b/i,
  /\blaman (ini|web ni)\b/i,
  /\bkau (ada|tahu|boleh)\b/i,
  /\bendpoint\b/i,
  /\bapi\b/i
];

/** Cache jawapan supaya model tidak dipanggil semula untuk soalan yang sama. */
const answerCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 200;

function cacheGet(key) {
  const entry = answerCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL) {
    answerCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (answerCache.size >= CACHE_MAX) {
    answerCache.delete(answerCache.keys().next().value);
  }
  answerCache.set(key, { at: Date.now(), value });
}

async function retrieve(query, { limit = config.brain.retrievalLimit } = {}) {
  try {
    const result = await index.search(query, {
      limit,
      attributesToCrop: ['content'],
      cropLength: 40,
      attributesToRetrieve: ['url', 'title', 'description', 'siteName', 'host', 'lang', 'wordCount'],
      showRankingScore: true
    });
    // Tapis ikut skor relevan Meilisearch. TANPA ini, dokumen yang HANYA padan
    // separa (cth. "enjin KERETA" -> artikel "enjin CARIAN web", skor ~0.49) ikut
    // dihantar sebagai "grounded", lalu model kecil mengarang jawapan yang salah
    // topik ("lain tanya lain dijawab"). Had `minConfidence` (=BRAIN_MIN_CONFIDENCE,
    // lalai 0.5) mengekalkan padanan SEJATI (skor ~0.9) & menolak yang kebetulan.
    // Skor hasil web (di bawah) TIDAK ditapis — ia memang fallback semasa indeks
    // tempatan kosong, dan DuckDuckGo sudah menyusunnya ikut relevansi.
    const hits = (result.hits || []).filter(
      (hit) => (hit._rankingScore ?? 0) >= config.brain.minConfidence
    );

    if (hits.length === 0 && config.websearch.enabled) {
      try {
        const webResult = await websearch.search(query);
        if (webResult.hits && webResult.hits.length > 0) {
          return webResult.hits.slice(0, limit).map((hit, idx) => ({
            ...hit,
            _rankingScore: 0,
            source: 'web',
            webRef: idx + 1
          }));
        }
      } catch {
        // abaikan ralat carian web, gunakan hasil tempatan (kosong)
      }
    }

    return hits;
  } catch {
    return [];
  }
}

function isSelfQuestion(query) {
  return TUUK_PATTERNS.some((pattern) => pattern.test(query));
}

function isKnowledgeQuestion(query) {
  return THINKING_PATTERNS.some((pattern) => pattern.test(query));
}

function buildContext(hits) {
  if (hits.length === 0) return '';
  return hits
    .map((hit, position) => {
      const body = hit._formatted?.content || hit.description || '';
      const trimmed = String(body).replace(/<\/?mark>/g, '').slice(0, config.brain.snippetChars);
      const source = hit.source === 'web' ? `[WEB] ${hit.url}` : hit.url;
      const site = hit.siteName || hit.host || (hit.source === 'web' ? new URL(hit.url).hostname : 'tidak diketahui');
      return [
        `[${position + 1}] ${hit.title || source}`,
        `URL: ${source}`,
        `Site: ${site}`,
        trimmed ? `Content: ${trimmed}` : 'Content: (no summary)'
      ].join('\n');
    })
    .join('\n\n');
}

function buildSources(hits) {
  return hits.map((hit, position) => ({
    ref: position + 1,
    title: hit.title,
    url: hit.url,
    siteName: hit.siteName || hit.host || (hit.source === 'web' ? new URL(hit.url).hostname : ''),
    score: hit._rankingScore ?? null,
    source: hit.source || 'local'
  }));
}

const MINIMAL_SYSTEM =
  'You are a search assistant. Answer briefly IN THE SAME LANGUAGE as the QUESTION ' +
  '(Malay question -> Malay answer, English -> English). Use ONLY the information in ' +
  'the context. If the context does not actually answer the question, say you do not ' +
  'know instead of guessing or inventing.';

function buildPrompt(question, hits, selfQuestion) {
  const lines = [];

  if (selfQuestion) {
    // Soalan tentang Tukuk-OS: gunakan pengetahuan sistem sahaja.
    lines.push(knowledgeForSelf());
    lines.push(`QUESTION: ${question}`);
    lines.push('Answer in 2-3 sentences, in the SAME LANGUAGE as the QUESTION.');
    return lines.join('\n\n');
  }

  lines.push(`QUESTION: ${question}`);

  if (hits.length > 0) {
    lines.push(`SOURCES:\n${buildContext(hits)}`);
    lines.push(
      'Write a 2-4 sentence answer in the SAME LANGUAGE as the QUESTION (any language — '
      + 'answer in whatever language the question is written in), using only '
      + 'the sources above. Reference sources with numbers [1], [2]. '
      + 'If the sources do NOT actually address the question, do not force an answer — '
      + 'say you do not know in the language of the question.'
    );
  } else {
    lines.push(
      'No information in the sources. Answer exactly, in the SAME LANGUAGE as the QUESTION, '
      + 'that you do not know and the information is not in the Tukuk-OS index. Do not make anything up.'
    );
  }

  return lines.join('\n\n');
}

function knowledgeForSelf() {
  // `knowledge` di sini sudah objek pengetahuan (dari destructure di atas).
  return [
    'Tukuk-OS is a web search engine for tukuk.org, ISC license, built with Meilisearch.',
    `Routes: ${knowledge.routes.split('\n').slice(0, 8).join('; ')}`,
    `Brain: ${knowledge.brain.split('\n')[0]}`,
    `Limits: ${knowledge.limits.split('\n')[0]}`,
    `Operations: ${knowledge.operations.split('\n')[0]}`
  ].join('\n');
}

async function ask(question, { limit } = {}) {
  const query = String(question || '').trim();
  if (!query) {
    return { answer: 'Empty question. Type your question.', sources: [], mode: 'empty' };
  }

  const cacheKey = `${query}|${limit || config.brain.retrievalLimit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, mode: cached.mode, cached: true };

  const startedAt = Date.now();
  const selfQuestion = isSelfQuestion(query);
  const hits = selfQuestion ? [] : await retrieve(query, { limit });

  // Soalan tentang Tukuk-OS: gunakan pengetahuan sistem terus — tidak guna LLM.
  // Model 135M parameter terlalu kecil untuk menjawab soalan generale dengan tepat.
  if (selfQuestion) {
    const answer = knowledgeForSelf();
    return {
      question: query,
      answer,
      method: 'knowledge',
      model: 'fixed knowledge (no LLM)',
      tookMs: Date.now() - startedAt,
      sources: [],
      mode: 'self',
      warning: undefined
    };
  }

  const prompt = buildPrompt(query, hits, selfQuestion);

  const system = selfQuestion ? systemPrompt() : MINIMAL_SYSTEM;
  const numPredict = selfQuestion ? config.brain.maxTokens : Math.min(config.brain.maxTokens, 120);

  let answer = '';
  let model = provider.currentModel();
  let method = 'llm';
  let rejected = [];

  const backend = await provider.activeBackend();
  // Ekstraktif serta-merta bila: tiada LLM langsung, ATAU Ollama + mod laju (bukan soalan kendiri).
  const useExtractive = backend.kind === 'none' || (backend.kind === 'ollama' && config.brain.fastMode && !selfQuestion);

  if (useExtractive) {
    const extracted = hits.length > 0 ? extractiveAnswer(query, hits) : { answer: '', method: 'none' };
    answer = extracted.answer;
    method = extracted.method;
    model = 'extractive (no LLM)';
  } else if (backend.kind === 'cloud') {
    try {
      const out = await provider.generateCloud(backend, prompt, {
        system, temperature: config.brain.temperature, maxTokens: numPredict, topP: config.brain.topP
      });
      const text = String(out?.response || '').trim();
      model = out?._model || backend.model;
      if (isEcho(text, prompt)) rejected.push({ model, reason: 'output tidak koheren (mengulang arahan)' });
      else answer = text;
    } catch (error) {
      rejected.push({ model: backend.model, reason: error.message });
    }
  } else {
    // Ollama (dipilih eksplisit) — rantaian failover seperti biasa.
    for (const candidate of config.brain.chain) {
      let output;
      try {
        output = await provider.generate(prompt, { system, temperature: config.brain.temperature, numPredict, model: candidate });
      } catch (error) {
        rejected.push({ model: candidate, reason: error.message });
        continue;
      }
      const text = String(output?.response || '').trim();
      model = candidate;
      if (isEcho(text, prompt)) {
        rejected.push({ model: candidate, reason: 'output tidak koheren (mengulang arahan)' });
        continue;
      }
      answer = text;
      break;
    }
  }

  const sources = buildSources(hits);

  // Tiada jawapan daripada LLM (gagal/offline/tiada model) → jatuhkan ke ekstraktif.
  if (!answer) {
    let extracted;
    if (hits.length > 0 && hits[0].source === 'web') {
      // Hasil WEB jarang mengandungi satu ayat yang boleh dipetik; teks Wikipedia
      // (infobox) bila dilombat jadi run-on "dishes Java rice Nasi bogana…" yang
      // busuk. Untuk mod web, hidangkan SENARAI tajuk + penerangan yang kemas.
      const lines = hits.slice(0, 4).map((hit, i) =>
        `[${i + 1}] ${hit.title || hit.url}${hit.description ? ' — ' + String(hit.description).replace(/\s+/g, ' ').trim().slice(0, 160) : ''}`);
      extracted = { answer: `${t('webListHeader', detectLocale(query))}\n${lines.join('\n')}`, method: 'web-list' };
    } else {
      extracted = hits.length > 0 ? extractiveAnswer(query, hits) : { answer: '', method: 'none' };
    }
    answer = extracted.answer;
    method = extracted.method;
    model = 'extractive (no LLM)';
  }

  if (!answer) {
    answer = selfQuestion
      ? `Tukuk-OS is a web search engine for tukuk.org. Use /search to search, or /ask to ask questions.`
      : t('dontKnow', detectLocale(query));
    method = 'fallback';
  }

  const result = {
    question: query,
    answer,
    method,
    model: method === 'llm' ? model : 'extractive (no LLM)',
    tookMs: Date.now() - startedAt,
    sources,
    rejectedModels: rejected,
    mode: selfQuestion ? 'self' : sources.length > 0 ? (sources.some(s => s.source === 'web') ? 'web' : 'grounded') : 'ungrounded',
    warning:
      sources.length === 0 && !selfQuestion
        ? 'No sources in the index — this answer is not grounded.'
        : rejected.length > 0 && method !== 'llm'
          ? 'The small model failed to give a coherent answer — the answer was generated directly from the sources.'
          : undefined
  };

  cacheSet(cacheKey, result);
  return result;
}

function cacheStats() {
  return { entries: answerCache.size, ttlMs: CACHE_TTL };
}

function clearCache() {
  answerCache.clear();
}

module.exports = { ask, retrieve, isSelfQuestion, isKnowledgeQuestion, cacheStats, clearCache };