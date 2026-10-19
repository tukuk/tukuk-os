const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const candidates = [path.join(__dirname, '..', '.env')];
  if (process.env.KILO_ENV_FILE) candidates.unshift(process.env.KILO_ENV_FILE);

  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator === -1) continue;
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
      return file;
    } catch {
      continue;
    }
  }
  return null;
}

const envFile = loadEnvFile();

function num(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: num(process.env.PORT, 3000),
  indexName: process.env.MEILI_INDEX || 'halaman_web',

  meili: {
    host: process.env.MEILI_HOST || 'http://127.0.0.1:7700',
    apiKey: process.env.MEILI_MASTER_KEY || '',
    timeout: num(process.env.MEILI_TIMEOUT, 30000)
  },

  crawl: {
    userAgent: process.env.CRAWLER_UA || 'TukukOS-Bot/1.0 (+https://tukuk-os.local/bot)',
    concurrency: num(process.env.CRAWL_CONCURRENCY, 2),
    queueLimit: num(process.env.CRAWL_QUEUE_LIMIT, 10000),
    timeout: num(process.env.CRAWL_TIMEOUT, 25000),
    maxBytes: num(process.env.CRAWL_MAX_BYTES, 5 * 1024 * 1024),
    maxRedirects: num(process.env.CRAWL_MAX_REDIRECTS, 3),
    maxDepth: num(process.env.CRAWL_MAX_DEPTH, 5),
    maxPagesPerSeed: num(process.env.CRAWL_MAX_PAGES, 1000),
    respectRobots: bool(process.env.CRAWL_RESPECT_ROBOTS, true),
    allowPrivateHosts: bool(process.env.CRAWL_ALLOW_PRIVATE, false),
    indexOnCrawl: bool(process.env.INDEX_ON_CRAWL, true),
    crawlDelayMs: num(process.env.CRAWL_DELAY_MS, 1500),
    minWordCount: num(process.env.CRAWL_MIN_WORDS, 100)
  },

  docs: {
    contentChars: num(process.env.CONTENT_CHARS, 12000),
    summaryChars: num(process.env.SUMMARY_CHARS, 400)
  },

  search: {
    defaultLimit: num(process.env.SEARCH_DEFAULT_LIMIT, 20),
    maxLimit: num(process.env.SEARCH_MAX_LIMIT, 100),
    cropLength: num(process.env.SEARCH_CROP_LENGTH, 30),
    highlightPreTag: process.env.SEARCH_PRE_TAG || '<mark>',
    highlightPostTag: process.env.SEARCH_POST_TAG || '</mark>',
    timeoutMs: num(process.env.SEARCH_TIMEOUT_MS, 1000),
    cacheSeconds: num(process.env.SEARCH_CACHE_SECONDS, 60),
    fallbackOnError: bool(process.env.SEARCH_FALLBACK_ON_ERROR, true),
    fallbackOnEmpty: bool(process.env.SEARCH_FALLBACK_ON_EMPTY, true)
  },

  // Neural re-ranking. DUA backend:
  //   1) tempatan  — cross-encoder ONNX (perlukan model Kaggle; lalai MATI).
  //   2) cloud     — embeddings Workers AI (bi-encoder). Aktif AUTOMATIK bila
  //                  CLOUDFLARE_API_TOKEN (keizinan Workers AI) wujud; no-op
  //                  selamat bila tiada. Tiada had keras — latensi dipagari.
  rerank: {
    enabled: bool(process.env.RERANK_ENABLED, false),
    modelDir: process.env.RERANK_MODEL_DIR || path.join(__dirname, '..', 'models', 'tukuk-reranker'),
    quantized: bool(process.env.RERANK_QUANTIZED, false),
    candidates: Math.min(num(process.env.RERANK_CANDIDATES, 40), 100),
    timeoutMs: num(process.env.RERANK_TIMEOUT_MS, 2500),
    cloud: bool(process.env.RERANK_CLOUD, true),
    embedModel: process.env.RERANK_EMBED_MODEL || '@cf/baai/bge-base-en-v1.5'
  },

  rateLimit: {
    enabled: bool(process.env.RATE_LIMIT_ENABLED, true),
    trustProxy: bool(process.env.RATE_LIMIT_TRUST_PROXY, true),
    searchWindowMs: num(process.env.RATE_LIMIT_SEARCH_WINDOW, 60000),
    searchMax: num(process.env.RATE_LIMIT_SEARCH_MAX, 120),
    writeWindowMs: num(process.env.RATE_LIMIT_WRITE_WINDOW, 60000),
    writeMax: num(process.env.RATE_LIMIT_WRITE_MAX, 10),
    crawlMax: num(process.env.RATE_LIMIT_CRAWL_MAX, 5),
    websearchMax: num(process.env.RATE_LIMIT_WEBSEARCH_MAX, 60)
  },

  security: {
    apiKey: process.env.API_KEY || ''
  },

  // Pentadbir: hanya SATU e-mel dibenarkan + WebAuthn passkey.
  admin: {
    // E-mel pemilik yang dibenarkan. Siapa selain ini DITOLAK.
    email: String(process.env.ADMIN_EMAIL || 'fevianbenjo48@gmail.com').trim().toLowerCase(),
    // Kata laluan bootstrap (hanya untuk mendaftarkan passkey pertama).
    bootstrapPassword: process.env.ADMIN_PASSWORD || process.env.ADMIN_PIN || 'tukuk123',
    // Tempoh sesi login (millisaat). Lalai 8 jam.
    sessionTtlMs: num(process.env.ADMIN_SESSION_TTL_MS, 8 * 60 * 60 * 1000)
  },

  // Konfigurasi WebAuthn (passkey). rpID mesti sepadan dengan domain sebenar.
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'Tukuk-OS Admin',
    rpID: process.env.WEBAUTHN_RP_ID || 'tukuk.org',
    origin: process.env.WEBAUTHN_ORIGIN || 'https://tukuk.org'
  },

  adsense: {
    enabled: bool(process.env.ADSENSE_ENABLED, true),
    client: process.env.ADSENSE_CLIENT || 'ca-pub-8954948214333501',
    // Unit sebenar dalam akaun ini (konsol AdSense, Okt 2026):
    // top=「test banner 1」, in-article=「test banner」, bottom=「test banner 2」.
    slotTop: process.env.ADSENSE_SLOT_TOP || '4776075642',
    slotInArticle: process.env.ADSENSE_SLOT_IN_ARTICLE || '2206273113',
    slotBottom: process.env.ADSENSE_SLOT_BOTTOM || '7701621880'
  },

  brain: {
    enabled: bool(process.env.BRAIN_ENABLED, true),
    ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    chain: (process.env.LLM_CHAIN || 'smollm:135m,qwen2.5-coder:0.5b')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.2),
    topP: Number(process.env.LLM_TOP_P ?? 0.9),
    maxTokens: num(process.env.LLM_MAX_TOKENS, 120),
    // Model reasoning cloud (gpt-oss, qwen3, gemini-*-latest) belanja token pada
    // akal dalaman SEBELUM jawapan; bajet Ollama (≈80) memotong mereka jadi KOSONG.
    // Cloud murah & laju → beri bajet longgar (ruang akal + jawapan). Override env.
    cloudMaxTokens: num(process.env.LLM_CLOUD_MAX_TOKENS, 512),
    contextWindow: num(process.env.LLM_CONTEXT_WINDOW, 2048),
    seed: num(process.env.LLM_SEED, 42),
    timeout: num(process.env.LLM_TIMEOUT, 15000),
    // BAJET INTERAKTIF: had MASA KESELURUhan bagi fasa LLM /ask (cloud+ollama).
    // Rotasi cuba pembekal satu-satu; bila melebihi bajet ini → berhenti & guna
    // ekstraktif serta-merta. Ini MENAMAT kes 37s/60s: pengguna tak menunggu.
    budgetMs: num(process.env.BRAIN_BUDGET_MS, 9000),
    retrievalLimit: num(process.env.BRAIN_RETRIEVAL_LIMIT, 4),
    snippetChars: num(process.env.BRAIN_SNIPPET_CHARS, 700),
    minConfidence: Number(process.env.BRAIN_MIN_CONFIDENCE ?? 0.5),
    fastMode: bool(process.env.BRAIN_FAST_MODE, true),
    // LOCAL-FIRST: aktif melalui BRAIN_LOCAL_FIRST=1 atau setting admin
    // aiLocalFirst=1. Dalam hibrida semasa ia TIDAK menangguh cloud — cloud dan
    // Ollama berlumba serentak; localFirst hanya membuang head-start ~1.2s cloud
    // supaya model lokal mula menjana serta-merta. Lalai mati.
    localFirst: bool(process.env.BRAIN_LOCAL_FIRST, false),
    provider: process.env.BRAIN_PROVIDER || 'ollama',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    xaiApiKey: process.env.XAI_API_KEY || '',
    huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '',
    // Cloudflare Workers AI: token (boleh pakai CLOUDFLARE_API_TOKEN jika ia
    // mempunyai keizinan Workers AI) + account id. Kedua-dua wajib ada.
    cloudflareAiToken: process.env.CLOUDFLARE_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '',
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    ollamaCloudApiKey: process.env.OLLAMA_CLOUD_API_KEY || '',
    // Tier pinggir LiteRT-LM: serve OpenAI-compatible (gemma3-1B int4 +
    // EmbeddingGemma) di port 8090 pada pelayan ini. HANYA aktif bila
    // LITERT_HOST ditetapkan eksplisit — default mati supaya CI/laptop tak
    // cuba menghubungi port yang tiada. Model boleh dioverride LITERT_MODEL.
    litertHost: process.env.LITERT_HOST || '',
    // Susunan rotasi cloud (kiri→kanan). PALING LAJU DULU: groq (LPU ~1s) & gemini-flash
    // mendahului; cloudflare scout (lambat ~30s+) dihantar ke belakang supaya bajet
    // interaktif jarang perlu menunggu pembekal lambat. litert (tier pinggir lokal)
    // paling belakang: sentiasa ada, tiada kuota, tapi paling perlahan.
    cloudOrder: process.env.LLM_CLOUD_ORDER || 'groq,gemini-openai,gemini,ollama-cloud,openrouter,xai,huggingface,cloudflare,openai,litert'
  },

  // Tukuk Agent (editor AI) — OpenAI-compatible tool-calling proxy + headless build.
  // AGENT_TOKEN protects /api/agent/* (apart from admin passkey). agentOrigin is the
  // code-server/Tukuk Agent origin allowed by CORS. agentTimeoutMs caps upstream calls.
  agent: {
    token: process.env.AGENT_TOKEN || '',
    origin: process.env.AGENT_ORIGIN || '',
    timeoutMs: num(process.env.AGENT_TIMEOUT_MS, 120000),
    maxPerMin: num(process.env.AGENT_RATE_PER_MIN, 30),
    // Tier PERCUMA untuk Tukuk Builder (build.tukuk.org): pelawat tak punya
    // kunci. freeToken ialah penanda AWAM (sudah terbit di GitHub fork), jadi
    // perlindungannya = had kadar ketat + kekangan max_tokens, BUKAN kerahsiaan.
    freeToken: process.env.AGENT_FREE_TOKEN || '',
    freeMaxPerMin: num(process.env.AGENT_FREE_RATE_PER_MIN, 8),
    freeMaxTokens: num(process.env.AGENT_FREE_MAX_TOKENS, 16384)
  },

  // Editor Tukuk Agent (fork code-server) yang proksi ini dinaung —
  // tukuk.org/agent → 127.0.0.1:8443 (--auth password di sisinya).
  agentEditor: {
    upstream: process.env.AGENT_EDITOR_UPSTREAM || 'http://127.0.0.1:8443'
  },

  net: {
    checkIntervalMs: num(process.env.NET_CHECK_INTERVAL, 30000),
    probeUrl: process.env.NET_PROBE_URL || 'https://cloudflare.com/cdn-cgi/trace',
    timeoutMs: num(process.env.NET_PROBE_TIMEOUT, 5000)
  },

  store: {
    path: process.env.STORE_PATH || path.join(__dirname, '..', 'data', 'tukuk-os.json')
  },

  websearch: {
    enabled: bool(process.env.WEBSEARCH_ENABLED, true),
    provider: process.env.WEBSEARCH_PROVIDER || 'duckduckgo',
    timeout: num(process.env.WEBSEARCH_TIMEOUT, 4000),
    maxResults: num(process.env.WEBSEARCH_MAX_RESULTS, 10),
    cacheSeconds: num(process.env.WEBSEARCH_CACHE_SECONDS, 300),
    userAgent: process.env.WEBSEARCH_UA || 'TukukOS-WebSearch/1.0'
  },

  paths: {
    data: process.env.MEILI_DB_PATH || path.join(__dirname, '..', 'meili_data')
  },

  nasa: {
    apiKey: process.env.NASA_API_KEY || 'fmALFBwD70rhld4szo2P3qGezLRgTqWH6vLUh2lb',
    baseUrl: 'https://api.nasa.gov',
    // Auto-update APOD: selang tarikan latar belakang (minit, minimum 5)
    apodRefreshMinutes: num(process.env.NASA_APOD_REFRESH_MIN, 30)
  },

  // OpenWeather — tier percuma (1,000 panggilan/hari, 60/min): current, forecast
  // 5-hari/3-jam, air pollution (+forecast) dan geocoding. Peta jubin juga percuma
  // dengan appid. Sejarah/OneCall adalah berbayar → TIDAK digunakan di sini.
  weather: {
    apiKey: process.env.OPENWEATHER_API_KEY || 'c5cdeb2e2261ae767890f8e3c3a651ab',
    baseUrl: 'https://api.openweathermap.org',
    tileBase: 'https://tile.openweathermap.org/map',
    // Bajet harian konservatif supaya ada ruang untuk retry/manual seed.
    dailyBudget: num(process.env.OW_DAILY_BUDGET, 950)
  },

  envFile
};