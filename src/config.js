/**
 * Centralised runtime configuration.
 *
 * Precedence (highest wins): explicit `process.env` > `.env` file at repo root > default
 * literal. The `.env` loader is intentionally simple (KEY=value only, no shell expansion)
 * — dotenv-style multiline/interpolation is a security risk on a systemd-managed server
 * and we do not need it.
 *
 * Every subsystem (crawl / search / brain / adsense / admin / webauthn / agent / litert /
 * store / nasa …) exposes a nested object so callers destructure what they need instead
 * of reading env variables directly. Tests may override fields after require to simulate
 * alternate configurations.
 */
const fs = require('fs');
const path = require('path');

/**
 * Parse a KEY=value file into process.env without overwriting anything already set.
 * Search order: optional KILO_ENV_FILE override, then repo-root `.env`.
 * @returns {string|null} the file we loaded, or null when none was readable
 */
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

/** Coerce an env value to a number with a numeric fallback. */
function num(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Coerce an env value to a boolean ('1' | 'true' | 'yes' | 'on' → true). */
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

  // Neural re-ranking. TWO backends:
  //   1) local   — ONNX cross-encoder (needs the Kaggle model; OFF by default).
  //   2) cloud   — Workers AI embeddings (bi-encoder). ACTIVE AUTOMATICALLY when
  //                CLOUDFLARE_API_TOKEN (Workers AI permission) exists; a safe
  //                no-op when it doesn't. No hard caps — latency is bounded.
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

  // Admin: only ONE e-mail is allowed + a WebAuthn passkey.
  admin: {
    // The owner's allowed e-mail. Anyone else is REJECTED.
    email: String(process.env.ADMIN_EMAIL || 'fevianbenjo48@gmail.com').trim().toLowerCase(),
    // Bootstrap password (only used to register the first passkey).
    bootstrapPassword: process.env.ADMIN_PASSWORD || process.env.ADMIN_PIN || 'tukuk123',
    // Login session duration (milliseconds). Default 8 hours.
    sessionTtlMs: num(process.env.ADMIN_SESSION_TTL_MS, 8 * 60 * 60 * 1000)
  },

  // WebAuthn (passkey) configuration. rpID must match the real domain.
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'Tukuk-OS Admin',
    rpID: process.env.WEBAUTHN_RP_ID || 'tukuk.org',
    origin: process.env.WEBAUTHN_ORIGIN || 'https://tukuk.org'
  },

  adsense: {
    enabled: bool(process.env.ADSENSE_ENABLED, true),
    // Pre-approval gate. While this is false NOTHING from AdSense reaches a page — not the
    // library loader, not the three in-page units, not the Funding Choices tag — whatever the
    // Admin toggle or ADSENSE_ENABLED says. The account is reviewed on the LIVE markup, and
    // units on pages that carry one sentence is the "ads on screens without publisher content"
    // violation. Set ADSENSE_APPROVED=1 the day the account is approved; nothing else changes.
    approved: bool(process.env.ADSENSE_APPROVED, false),
    client: process.env.ADSENSE_CLIENT || 'ca-pub-8954948214333501',
    // The real units inside this account (AdSense console, Oct 2026):
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
    // Cloud reasoning models (gpt-oss, qwen3, gemini-*-latest) spend tokens on
    // internal thinking BEFORE the answer; the Ollama budget (≈80) cuts them to ZERO.
    // Cloud is cheap & fast → give a generous budget (thinking room + answer). Env override.
    cloudMaxTokens: num(process.env.LLM_CLOUD_MAX_TOKENS, 512),
    contextWindow: num(process.env.LLM_CONTEXT_WINDOW, 2048),
    seed: num(process.env.LLM_SEED, 42),
    timeout: num(process.env.LLM_TIMEOUT, 15000),
    // INTERACTIVE BUDGET: the OVERALL TIME cap for the /ask LLM phase (cloud+ollama).
    // Rotation tries providers one by one; once this budget is exceeded → stop & use
    // the extractive answer immediately. This ENDS the 37s/60s cases: users don't wait.
    budgetMs: num(process.env.BRAIN_BUDGET_MS, 9000),
    retrievalLimit: num(process.env.BRAIN_RETRIEVAL_LIMIT, 4),
    snippetChars: num(process.env.BRAIN_SNIPPET_CHARS, 700),
    minConfidence: Number(process.env.BRAIN_MIN_CONFIDENCE ?? 0.5),
    fastMode: bool(process.env.BRAIN_FAST_MODE, true),
    // LOCAL-FIRST: enabled via BRAIN_LOCAL_FIRST=1 or the admin setting
    // aiLocalFirst=1. In the current hybrid it does NOT delay the cloud — cloud and
    // Ollama race simultaneously; localFirst only drops the ~1.2s cloud
    // head-start so the local model starts generating right away. Off by default.
    localFirst: bool(process.env.BRAIN_LOCAL_FIRST, false),
    provider: process.env.BRAIN_PROVIDER || 'ollama',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    // Kept only so an old .env does not crash — Groq is VETOED in provider.js
    // (LLM_DISABLED_PROVIDERS defaults to 'groq'). Do not add a GROQ_API_KEY.
    groqApiKey: process.env.GROQ_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    xaiApiKey: process.env.XAI_API_KEY || '',
    huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '',
    // Cloudflare Workers AI: token (may reuse CLOUDFLARE_API_TOKEN if it
    // carries the Workers AI permission) + account id. Both are required.
    cloudflareAiToken: process.env.CLOUDFLARE_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '',
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    ollamaCloudApiKey: process.env.OLLAMA_CLOUD_API_KEY || '',
    // LiteRT-LM edge tier: serves OpenAI-compatible (gemma3-1B int4 +
    // EmbeddingGemma) on port 8090 on this server. ONLY active when
    // LITERT_HOST is set explicitly — off by default so CI/laptops don't
    // try to reach a port that isn't there. The model is overridable via LITERT_MODEL.
    litertHost: process.env.LITERT_HOST || '',
    // The cloud rotation order (left→right). FASTEST FIRST: the Gemini OpenAI-compatible
    // layer & gemini-flash lead; the cloudflare scout (slow, ~30s+) is sent to the back so
    // the interactive budget rarely waits for a slow provider. litert (the local edge tier)
    // is last: always available, no quota, but the slowest.
    // Groq is DELIBERATELY ABSENT (owner veto, enforced by LLM_DISABLED_PROVIDERS).
    cloudOrder: process.env.LLM_CLOUD_ORDER || 'gemini-openai,gemini,ollama-cloud,openrouter,xai,huggingface,cloudflare,openai,litert',
    // Hard veto list for cloud providers: a name here can never enter the rotation,
    // whatever LLM_CLOUD_ORDER or the admin aiProvider says. Default 'groq' (owner).
    disabledProviders: process.env.LLM_DISABLED_PROVIDERS ?? 'groq'
  },

  // Tukuk Agent (editor AI) — OpenAI-compatible tool-calling proxy + headless build.
  // AGENT_TOKEN protects /api/agent/* (apart from admin passkey). agentOrigin is the
  // code-server/Tukuk Agent origin allowed by CORS. agentTimeoutMs caps upstream calls.
  agent: {
    token: process.env.AGENT_TOKEN || '',
    origin: process.env.AGENT_ORIGIN || '',
    timeoutMs: num(process.env.AGENT_TIMEOUT_MS, 120000),
    maxPerMin: num(process.env.AGENT_RATE_PER_MIN, 30),
    // FREE tier for Tukuk Builder (build.tukuk.org): visitors have no
    // key. freeToken is a PUBLIC marker (already published in the GitHub fork), so
    // its protection = a strict rate cap + max_tokens limits, NOT secrecy.
    freeToken: process.env.AGENT_FREE_TOKEN || '',
    freeMaxPerMin: num(process.env.AGENT_FREE_RATE_PER_MIN, 8),
    freeMaxTokens: num(process.env.AGENT_FREE_MAX_TOKENS, 16384)
  },

  // The Tukuk Agent editor (a code-server fork) this proxy fronts —
  // tukuk.org/agent → 127.0.0.1:8443 (--auth password on its side).
  agentEditor: {
    upstream: process.env.AGENT_EDITOR_UPSTREAM || 'http://127.0.0.1:8443'
  },

  // OUR OWN models (trained on Kaggle GPU, stored on Hugging Face, pulled onto
  // this box). The registry file is the source of truth: ai-models/registry.json.
  // src/brain/modelhub.js only READS it and probes the local filesystem, so
  // /api/models never waits on the network.
  models: {
    registryPath: process.env.TUKUK_MODEL_REGISTRY || path.join(__dirname, '..', 'ai-models', 'registry.json'),
    localDir: process.env.TUKUK_MODEL_DIR || '/home/tukuk/models',
    // Where scripts/hf-model-pull.sh drops downloads before installing; shown in
    // the inventory so a half-finished pull is visible instead of silent.
    stagingDir: process.env.TUKUK_MODEL_STAGING || '/opt/tukuk-os/generated/hf'
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
    // APOD auto-update: the background pull interval (minutes, minimum 5)
    apodRefreshMinutes: num(process.env.NASA_APOD_REFRESH_MIN, 30)
  },

  // OpenWeather — free tier (1,000 calls/day, 60/min): current, 5-day/3-hour
  // forecast, air pollution (+forecast) and geocoding. Tile maps are also free
  // with the appid. History/OneCall are paid → NOT used here.
  weather: {
    apiKey: process.env.OPENWEATHER_API_KEY || 'c5cdeb2e2261ae767890f8e3c3a651ab',
    baseUrl: 'https://api.openweathermap.org',
    tileBase: 'https://tile.openweathermap.org/map',
    // Conservative daily budget so there is headroom for retries/manual seeds.
    dailyBudget: num(process.env.OW_DAILY_BUDGET, 950)
  },

  envFile
};