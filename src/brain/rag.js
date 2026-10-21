const config = require('../config');
const { client } = require('../meili');
const { systemPrompt, knowledge } = require('./knowledge');
const provider = require('./provider');
const websearch = require('./websearch');
const { isEcho, extractiveAnswer } = require('./quality');
const { detectLocale, t } = require('../lang');
const taskrouter = require('./taskrouter');

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

// Soalan IDENTITI AI → jawab serta-merta dari pengetahuan (tiada carian/LLM).
// Tanpa ini, "siapakah kamu" pergi ke carian + panggilan cloud 30s lalu return
// definisi kamus — perlahan DAN bodoh. Corak ini menangkap siapa/apa/boleh-buat.
const IDENTITY_PATTERNS = [
  /\b(siapakah|siapa)\s+(kamu|kau|anda|awak|engko|kamu\s+ini|ni)\b/i,
  /\b(kamu|anda|awak|kau)\s+siapa\b/i,
  /\bwho\s+are\s+you\b/i,
  /\bwhat\s+are\s+you\b/i,
  /\bare\s+you\s+(an?\s*)?(ai|bot|assistant|real)\b/i,
  /\b(perkenalkan|mengenalkan|ceritakan)\s+(diri(kamu|anda)?|tentang\s+diri)\b/i,
  /\bapa\s+(yang\s+)?(kamu|anda|awak|kau)\s+(boleh|bisa|dapat|nak)\s+(buat|bantu|tolong|erbuat)\b/i,
  /\bbisa\s+(bantu|tolong)\s+(saya|aku|apa)\b/i,
  /\bapa\s+itu\s+(tukuk|ai\s+tukuk)\b/i,
  /\b(tugasmu|kebolehanmu|fungsi\s+awak)\b/i
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

// ─── Web-relevance: tapis hasil DuckDuckGo yang langsung tak berkait ───────
// Stopword Melayu + Inggeris yang kerap dalam soalan kabur ("apa itu ini", "untuk apa").
// Jika semua terma soalan adalah stopword → terlalu kabur (score 0) → buang web hits.
const WEB_STOPWORDS = new Set([
  'apa','itu','ini','yang','dan','untuk','dengan','dari','kepada','pada','dalam','adalah',
  'is','the','a','an','of','in','to','on','for','how','what','do','does','are','was','it',
  'this','that','can','i','you','my','me'  
]);
function webRelevanceScore(query, hit) {
  const qt = String(query).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !WEB_STOPWORDS.has(w));
  if (!qt.length) return 0; // soalan 100% stopword → terlalu kabur untuk web
  const title = String(hit.title || '').toLowerCase();
  const desc = String(hit.description || '').toLowerCase();
  const overlap = qt.filter((t) => title.includes(t) || desc.includes(t)).length;
  return overlap / qt.length;
}

async function retrieve(query, { limit = config.brain.retrievalLimit } = {}) {
  try {
    const result = await index.search(query, {
      limit,
      attributesToCrop: ['content'],
      cropLength: 40,
      // `content` perlu ikut serta supaya ekstraktif boleh membaca badan
      // artikel sebenar — description (1 ayat) sering terlalu pendek & term
      // soalan berada di luar 60 aksara → skoring hilang, artikel betul
      // ditapis keluar sementara artikel salah (ranking lebih rendah)
      // tersangkut kerana satu padanan awal.
      attributesToRetrieve: ['url', 'title', 'description', 'content', 'siteName', 'host', 'lang', 'wordCount'],
      showRankingScore: true
    });
    // Tapis ikut skor relevan Meilisearch.
    const hits = (result.hits || []).filter(
      (hit) => (hit._rankingScore ?? 0) >= config.brain.minConfidence
    );

    if (hits.length === 0 && config.websearch.enabled) {
      try {
        const webResult = await websearch.search(query);
        if (webResult.hits && webResult.hits.length > 0) {
          const scored = webResult.hits.slice(0, limit).map((hit, idx) => ({
            ...hit,
            _rankingScore: 0,
            source: 'web',
            webRef: idx + 1,
            _webRelevance: webRelevanceScore(query, hit)
          }));
          // Hanya kekalkan hasil yang ada OVERLAP nyata dengan soalan.
          // Kalau semua < 0.3 → soalan terlalu kabur untuk web-search → buang semua.
          const relevant = scored.filter((h) => h._webRelevance >= 0.3);
          if (relevant.length > 0) return relevant;
        }
      } catch {
        // abaikan ralat carian web
      }
    }

    return hits;
  } catch {
    return [];
  }
}

function isSelfQuestion(query) {
  return TUUK_PATTERNS.some((pattern) => pattern.test(query))
    || IDENTITY_PATTERNS.some((pattern) => pattern.test(query));
}

function isKnowledgeQuestion(query) {
  return THINKING_PATTERNS.some((pattern) => pattern.test(query));
}

function buildContext(hits) {
  if (hits.length === 0) return '';
  return hits
    .map((hit, position) => {
      // Utamakan `content` penuh (badan artikel dari Meilisearch), kemudian
      // crop _formatted, kemudian description — supaya LLM dapat teks sebenar
      // dan mudah bezakan artikel yang mana menjawab soalan.
      const body = hit.content || hit._formatted?.content || hit.description || '';
      const trimmed = String(body).replace(/<\/?mark>/g, '').slice(0, config.brain.snippetChars);
      const source = hit.source === 'web' ? `[WEB] ${hit.url}` : hit.url;
      const site = hit.siteName || hit.host || (hit.source === 'web' ? new URL(hit.url).hostname : 'unknown');
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
  '(Malay question -> Malay answer, English -> English, any script -> that language). ' +
  'Use ONLY the information in the context. If the context does not actually answer the ' +
  'question, say you do not know instead of guessing or inventing.';

// Fall-back jika taskrouter tidak diberi (keliru-pelindung).
const GUIDANCE_DEFAULT = 'Answer directly in 2-4 sentences, using only the sources.';

function buildPrompt(question, hits, selfQuestion, task) {
  const lines = [];

  if (selfQuestion) {
    // Soalan tentang Tukuk-OS: gunakan pengetahuan sistem sahaja.
    lines.push(knowledgeForSelf());
    lines.push(`QUESTION: ${question}`);
    lines.push('Answer in 2-3 sentences, in the SAME LANGUAGE as the QUESTION.');
    return lines.join('\n\n');
  }

  lines.push(`QUESTION: ${question}`);

  // Arithmetik tulen / penjanaan kod: bukan fakta dunia — jawab terus, ABAIKAN
  // hit yang tak relevan (retrieve mungkin keluarkan noise) supaya tak tertolak.
  if (task && task.selfContained) {
    lines.push(
      'This is a self-contained task (arithmetic or code), not a factual lookup. Solve it '
      + 'directly and correctly. ' + (task.guidance || '') + '\n'
      + 'Give the response in the SAME LANGUAGE as the QUESTION (code and numbers stay as-is).'
    );
    return lines.join('\n\n');
  }

  if (hits.length > 0) {
    // Bila hasil #1 skor tinggi (≥ 0.8): tajuk/padanan sangat kuat — nyatakan
    // kepada LLM supaya fokus pada sumber [1] dan abaikan sumber tambahan
    // (mencegah model kecil seperti smollm/qwen jawab artikel yang salah).
    const topScore = hits[0]._rankingScore ?? 0;
    const srcsLabel = topScore >= 0.8
      ? `SOURCES (source [1] is the closest match to the question — answer from [1] first):\n${buildContext(hits)}`
      : `SOURCES:\n${buildContext(hits)}`;
    lines.push(srcsLabel);
    // Arahan adaptif ikut JENIS tugasan (math/code/list/…) — membuatkan model
    // kecil memberi BENTUK jawapan yang betul, bukan hanya 2-4 ayat generic.
    const guidance = (task && task.guidance) || GUIDANCE_DEFAULT;
    lines.push(
      'Write the answer in the SAME LANGUAGE as the QUESTION (any language — answer in '
      + 'whatever language the question is written in), using only the sources above. '
      + 'Reference sources with numbers [1], [2]. '
      + 'If the sources do NOT actually address the question, do not force an answer — '
      + 'say you do not know in the language of the question.\n'
      + guidance
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

  const startedAt = Date.now();
  // Gate awal: soalan terlalu kabur (hanya stopword/common words) → BM25 tidak
  // dapat membezakan → jangan cari, refuse. Contoh: "untuk apa ini", "apa itu".
  const meaningful = query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !WEB_STOPWORDS.has(w));
  if (!meaningful.length && !isSelfQuestion(query)) {
    const msg = detectLocale(query) === 'ms'
      ? 'Question too general. Please ask something more specific.'
      : 'Question too vague. Please ask something more specific.';
    return { question: query, answer: msg, method: 'refuse', model: null, tookMs: Date.now() - startedAt, sources: [], mode: 'ungrounded', warning: undefined };
  }

  const cacheKey = `${query}|${limit || config.brain.retrievalLimit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, mode: cached.mode, cached: true };

  const selfQuestion = isSelfQuestion(query);
  const task = taskrouter.classify(query);
  // Aritmetik tulen → jawab dengan KALKULATOR deterministik (tepat, serta-merta,
  // tiada halusinasi). Jangan guna LLM untuk kira 12*7 — dia boleh silap.
  if (!selfQuestion && task.arithmetic) {
    const { expression, value } = task.arithmetic;
    return {
      question: query,
      answer: `${expression} = ${value}`,
      method: 'arithmetic',
      model: 'deterministic calculator',
      tookMs: Date.now() - startedAt,
      sources: [],
      mode: 'direct'
    };
  }
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

  const prompt = buildPrompt(query, hits, selfQuestion, task);

  const system = selfQuestion ? systemPrompt() : MINIMAL_SYSTEM;
  // Bawaan token; code/math dapat ruang tambahan supaya jawapan tidak terpotong
  // (dibincangkan pada lantai CPU kecil — tambahan hanya bila tugasan benar-benar perlu).
  const baseTokens = selfQuestion ? config.brain.maxTokens : Math.min(config.brain.maxTokens, 120);
  const numPredict = Math.min(baseTokens + (selfQuestion ? 0 : (task.extraTokens || 0)), 320);
  // Cloud boleh guna bajet lebih besar: model reasoning (gpt-oss/qwen3/gemini-latest)
  // perlukan ruang akal dalaman sebelum jawapan; bajet Ollama kecil akan kosongkan mereka.
  const cloudTokens = Math.max(numPredict, config.brain.cloudMaxTokens);

  let answer = '';
  let model = provider.currentModel();
  let method = 'llm';
  let rejected = [];

  // BAJET INTERAKTIF: fasa LLM (cloud+ollama) tidak boleh melebihi budgetMs dari
  // mula. Lewat itu → berhenti & guna ekstraktif serta-merta (instan, berpunca).
  // Ini menutup 37s/60s. Lantai kecil selepas retrieve supaya websearch lambat
  // tidak merampas seluruh bajet — cloud (groq) biasanya pulang dalam 1–2s.
  const deadline = Math.max(
    startedAt + (config.brain.budgetMs || config.brain.timeout),
    Date.now() + 3000
  );

  const backend = await provider.activeBackend();
  // Ekstraktif serta-merta bila: tiada LLM langsung, ATAU Ollama + mod laju.
  // Cloud SENTIASA dicuba (cepat & murah) — fastMode hanya penggalang ollama/none.
  // Tugasan self-contained (aritmetik/kod) WAJIB lalu LLM — ekstraktif tak boleh mengira/menjana kod.
  const useExtractive = backend.kind === 'none'
    || (backend.kind === 'ollama' && config.brain.fastMode && !backend.localFirst && !selfQuestion && !task.selfContained);

  if (useExtractive) {
    const extracted = hits.length > 0 ? extractiveAnswer(query, hits) : { answer: '', method: 'none' };
    answer = extracted.answer;
    method = extracted.method;
    model = 'extractive (no LLM)';
  } else {
    // HIBRIDA SERENTAK (ollama lokal + cloud dipakai bersama): rotasi cloud dan
    // rantai Ollama berjalan SERENTAK — jawapan koheren PERTAMA menang, yang kalah
    // dibatalkan serta-merta (AbortController) supaya token/CPU tidak dibakar.
    // Cloud lazimnya ~1–2s (groq); model lokal mengisi jurang bila cloud cooling/
    // blip/tiada kunci — dan tetap COBA, bukan terus jatuh ke ekstraktif.
    const controller = new AbortController();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Cloud dicuba bila backend cloud aktif ATAU localFirst dengan senarai
    // pelarian. Admin paksa aiProvider=ollama (tiada cloudFallback) → lokal sahaja.
    const cloudWanted = backend.kind === 'cloud'
      || (backend.kind === 'ollama' && Array.isArray(backend.cloudFallback) && backend.cloudFallback.length > 0);
    const attempts = [];

    if (cloudWanted) {
      attempts.push((async () => {
        const out = await provider.generateCloud(backend, prompt, {
          system, temperature: config.brain.temperature, maxTokens: cloudTokens,
          topP: config.brain.topP, deadline, signal: controller.signal
        });
        for (const r of (out?.rejected || [])) rejected.push({ model: r.provider, reason: r.reason });
        const text = String(out?.response || '').trim();
        // Model awan besar TIDAK dinilai dengan heuristik model 135M: jawapan
        // ringkas ("California has 58 counties.") dan penolakan jujur ("I don't
        // know.") dulu dibuang sebagai echo → /ask jatuh ke perenggan ekstraktif
        // daripada artikel tak berkaitan, iaitu jauh lebih buruk daripada "tidak
        // tahu". Semakan ulang-prompt & ulang-an ayat tetap jalan.
        if (text && !isEcho(text, prompt, { smallModel: false })) return { text, model: `${out._provider}:${out._model}` };
        if (text) rejected.push({ model: out._provider, reason: 'output not coherent (repeating the prompt)' });
        return null;
      })());
    }

    // Probed selepas cloud dilancarkan — supaya pusingan /api/tags tidak
    // menangguh permulaan tier awan yang laju.
    const wantOllama = backend.kind === 'ollama' || (await provider.ollamaReachable());
    if (wantOllama) {
      attempts.push((async () => {
        // Beri cloud head-start ~1.2s supaya CPU VPS tidak berputar untuk jawapan
        // yang sedang dalam perjalanan. Tiada cloud / localFirst → jana serta-merta.
        if (cloudWanted && !backend.localFirst) {
          const head = Math.min(1200, Math.max(0, deadline - Date.now() - 1500));
          if (head > 0) await sleep(head);
        }
        if (controller.signal.aborted) return null;
        for (const candidate of config.brain.chain) {
          const left = deadline - Date.now();
          if (left < 1500) { rejected.push({ model: candidate, reason: 'interactive budget reached' }); break; }
          let output;
          try {
            output = await provider.generate(prompt, {
              system, temperature: config.brain.temperature, numPredict,
              model: candidate, timeout: left, signal: controller.signal
            });
          } catch (error) {
            if (controller.signal.aborted) return null;
            rejected.push({ model: candidate, reason: error.message });
            continue;
          }
          const text = String(output?.response || '').trim();
          if (!text || isEcho(text, prompt)) {
            rejected.push({ model: candidate, reason: 'output not coherent (repeating the prompt)' });
            continue;
          }
          return { text, model: candidate };
        }
        return null;
      })());
    }

    // Pusingan null → rejection supaya Promise.any terus menunggu racer seterusnya.
    const guarded = attempts.map((p) => p.then((r) => r || Promise.reject(new Error('attempt yielded nothing'))));
    try {
      const winner = await Promise.any(guarded);
      answer = winner.text;
      model = winner.model;
    } catch {
      // Semua racer gagal — jatuh ke ekstraktif di bawah (instan, berpunca).
    }
    controller.abort(); // bunuh racer yang belum selesai — jangan bakar token/CPU lagi
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
    mode: selfQuestion ? 'self' : task.selfContained ? 'direct' : sources.length > 0 ? (sources.some(s => s.source === 'web') ? 'web' : 'grounded') : 'ungrounded',
    warning:
      sources.length === 0 && !selfQuestion && !task.selfContained
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