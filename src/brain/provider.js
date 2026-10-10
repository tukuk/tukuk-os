const http = require('http');
const config = require('../config');

/**
 * Provider LLM untuk "otak" Tukuk-OS.
 *
 * Default: smollm:135m (91 MB) — berjalan pada CPU, ~12 token/s.
 * Pengguna boleh tukar model; LLM_CHAIN memberi laluan failover.
 *
 * smollm:135m sangat kecil. Ia HANYA boleh bergantung kepada sumber yang
 * diberi (RAG). Tanpa konteks, jawapannya tidak boleh dipercayai.
 */

let activeModel = null;

function baseUrl() {
  const url = new URL(config.brain.ollamaHost);
  return {
    hostname: url.hostname,
    port: url.port || 11434,
    prefix: url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  };
}

function request(path, { method = 'GET', body, timeout = config.brain.timeout } = {}) {
  const { hostname, port, prefix } = baseUrl();
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port,
        path: `${prefix}${path}`,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {})
        },
        timeout
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(Object.assign(new Error(`ollama ${res.statusCode}: ${data.slice(0, 200)}`), {
              status: res.statusCode
            }));
          }
          try {
            return resolve(JSON.parse(data));
          } catch {
            return resolve(data);
          }
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('ollama timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function availableModels() {
  const result = await request('/api/tags', { timeout: 5000 });
  return (result?.models || []).map((model) => ({
    name: model.name,
    sizeMb: Math.round((model.size || 0) / 1048576),
    family: model.details?.family || null,
    parameters: model.details?.parameter_size || null
  }));
}

async function pickModel() {
  const installed = await availableModels();
  const names = installed.map((model) => model.name);

  for (const candidate of config.brain.chain) {
    if (names.includes(candidate)) {
      activeModel = candidate;
      return activeModel;
    }
  }
  throw new Error(`No model in LLM_CHAIN / ${config.brain.chain.join(', ')}. Available: ${names.join(', ') || '(none)'}`);
}

async function generate(prompt, { system, numPredict, temperature, model: forceModel, extraOptions } = {}) {
  const target = forceModel || activeModel || (await pickModel());
  if (!forceModel) activeModel = target;

  const body = {
    model: target,
    prompt,
    stream: false,
    options: {
      num_predict: numPredict ?? config.brain.maxTokens,
      temperature: temperature ?? config.brain.temperature,
      top_p: config.brain.topP,
      num_ctx: config.brain.contextWindow,
      ...(config.brain.seed ? { seed: config.brain.seed } : {}),
      ...(extraOptions || {})
    }
  };
  if (system) body.system = system;

  const result = await request('/api/generate', {
    method: 'POST',
    body,
    timeout: config.brain.timeout
  });
  result._model = target;
  return result;
}

// ── Pendaftar pembekal LLM awan ────────────────────────────────────────
// Lebih SATU pembekal boleh didaftarkan serentak (satu pembolehubah env per
// pembekal). /ask mencuba KEDAP secara rotasi: pembekal yang baru habis kuota
// (429 / "quota / rate limit / daily") dimasukan "cooling" seketika lalu terus
// dilangkau ke pembekal seterusnya yang masih ada kuota. Semua habis → Ollama
// lokal → ekstraktif. Tiada pengiraan kuota manual — isyarat 429 menjadi trigger.
function setting(key, fb) {
  try { return require('../store').getSetting(key, fb); } catch { return fb; }
}

const CLOUD_PROVIDERS = {
  gemini: { defaultModel: 'gemini-flash-latest', kind: 'gemini' },
  groq: { defaultModel: 'openai/gpt-oss-120b', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  openai: { defaultModel: 'gpt-4o-mini', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  openrouter: { defaultModel: 'openrouter/free', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  xai: { defaultModel: 'grok-4', kind: 'openai', baseUrl: 'https://api.x.ai/v1' },
  huggingface: { defaultModel: 'meta-llama/Llama-3.3-70B-Instruct', kind: 'openai', baseUrl: 'https://router.huggingface.co/v1' },
  cloudflare: { defaultModel: '@cf/meta/llama-4-scout-17b-16e-instruct', kind: 'cloudflare' }
};
const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'huggingface', 'xai', 'cloudflare', 'openai'];

function cloudKey(name) {
  const b = config.brain;
  // Kunci Admin (aiProvider + aiApiKey) menghidupkan pembekal yang sepadan,
  // supaya UI Admin → AI Settings tetap berfungsi walaupun rotasi baca env.
  const pref = String(setting('aiProvider', '') || '').toLowerCase();
  const adminKey = (pref === name) ? (setting('aiApiKey', '') || '') : '';
  if (name === 'gemini') return process.env.GEMINI_API_KEY || b.geminiApiKey || adminKey;
  if (name === 'openai') return process.env.OPENAI_API_KEY || b.openaiApiKey || adminKey;
  if (name === 'groq') return process.env.GROQ_API_KEY || b.groqApiKey || adminKey;
  if (name === 'openrouter') return process.env.OPENROUTER_API_KEY || b.openrouterApiKey || adminKey;
  if (name === 'xai') return process.env.XAI_API_KEY || b.xaiApiKey || adminKey;
  if (name === 'huggingface') return process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || b.huggingfaceApiKey || adminKey;
  if (name === 'cloudflare') return process.env.CLOUDFLARE_AI_TOKEN || b.cloudflareAiToken || adminKey;
  return '';
}
function cloudAccountId() {
  return process.env.CLOUDFLARE_ACCOUNT_ID || config.brain.cloudflareAccountId || '';
}
function cloudModel(name) {
  const fromEnv = process.env[`${name.toUpperCase()}_MODEL`];
  return setting(`${name}Model`, '') || fromEnv || CLOUD_PROVIDERS[name]?.defaultModel || '';
}
function cloudAvailable(name) {
  if (!CLOUD_PROVIDERS[name] || !cloudKey(name)) return false;
  // Workers AI perlu account id selain token — kalau tiada, anggap tak dikonfigurasi.
  if (name === 'cloudflare' && !cloudAccountId()) return false;
  return true;
}
function providerOrder() {
  const configured = String(config.brain.cloudOrder || DEFAULT_ORDER.join(','))
    .split(',').map((s) => s.trim()).filter((n) => CLOUD_PROVIDERS[n]);
  const order = configured.length ? configured : DEFAULT_ORDER.slice();
  // aiProvider admin (jika salah satu cloud) menolak pembekal itu ke depan.
  const pref = String(setting('aiProvider', '') || '').toLowerCase();
  if (order.includes(pref)) { order.splice(order.indexOf(pref), 1); order.unshift(pref); }
  return order;
}
// Pembekal awan yang ADA kunci, ikut susunan rotasi.
function listCloudProviders() {
  return providerOrder().filter(cloudAvailable).map((name) => ({
    name,
    kind: CLOUD_PROVIDERS[name].kind,
    key: cloudKey(name),
    model: cloudModel(name),
    baseUrl: CLOUD_PROVIDERS[name].baseUrl,
    account: name === 'cloudflare' ? cloudAccountId() : undefined
  }));
}

// ── Cooling: jangan tempek pembekal yang baru saja habis kuota ─────────
const cooldown = new Map(); // name -> untilTs(ms)
function coolingRemaining(name) {
  const until = cooldown.get(name) || 0;
  return Date.now() < until ? until - Date.now() : 0;
}
function markCooling(name, ms) { cooldown.set(name, Date.now() + ms); }
function isQuotaError(err) {
  const status = err && (err.status || err.statusCode);
  if (status === 429 || status === 402) return true;
  return /quota|rate.?limit|too many|exhaust|429|overloaded|capacity|resource_exhausted|daily|credit|billing|insufficient|payment|not have any credit/i
    .test(String(err && err.message || ''));
}
function quotaCooldownMs(err) {
  const msg = String(err && err.message || '').toLowerCase();
  // Tiada kredit / isu pembayaran → cooling panjang (tak cuba lagi 2 jam).
  if (/credit|billing|insufficient|payment|top.?up|subscribe/i.test(msg)) return 2 * 60 * 60 * 1000;
  // Kuota harian → 10 min; had seminit → 60s.
  if (/daily|per day|per-day|resets|day\b/i.test(msg)) return 10 * 60 * 1000;
  return 60 * 1000;
}

async function ollamaReachable() {
  try { await availableModels(); return true; } catch { return false; }
}

// Backend aktif. `cloud` kini membawa SENARAI pembekal (rotasi), bukan satu sahaja.
async function activeBackend() {
  const pref = String(setting('aiProvider', '') || '').toLowerCase();
  if (pref === 'ollama') {
    return (await ollamaReachable()) ? { kind: 'ollama' } : { kind: 'none' };
  }
  const providers = listCloudProviders();
  if (providers.length) {
    const first = providers.find((p) => !coolingRemaining(p.name)) || providers[0];
    return { kind: 'cloud', name: first.name, key: first.key, model: first.model, providers: providers.map((p) => p.name) };
  }
  if (await ollamaReachable()) return { kind: 'ollama' };
  return { kind: 'none' };
}

// Satu panggilan ke SATU pembekal. Ralat HTTP dinaikkan dengan .status supaya
// rotasi dapat bezakan kuota (429) daripada ralat sementara.
async function callCloud(p, prompt, { system, temperature, maxTokens, topP } = {}) {
  const t = temperature ?? config.brain.temperature;
  const mt = maxTokens ?? config.brain.maxTokens;
  const tp = topP ?? config.brain.topP;
  const signal = AbortSignal.timeout(config.brain.timeout);

  if (p.kind === 'gemini') {
    // gemini-*-latest ialah model "thinking": tanpa budget, token akal dalan
    // habiskan bajet kecil → jawapan KOSONG (finishReason MAX_TOKENS). Matikan
    // thinking (thinkingBudget 0) supaya jawapan ringkas cukup ruang & laju.
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: t, maxOutputTokens: mt, topP: tp, thinkingConfig: { thinkingBudget: 0 } } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${encodeURIComponent(p.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`gemini ${res.status}: ${String(data?.error?.message || '').slice(0, 160)}`); e.status = res.status; throw e; }
    const text = (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text).join('') || '';
    if (!text) { const e = new Error('gemini: respons kosong'); e.status = res.status; throw e; }
    return { response: text, _model: p.model };
  }

  const base = p.kind === 'cloudflare'
    ? `https://api.cloudflare.com/client/v4/accounts/${p.account}/ai/v1`
    : p.baseUrl;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` };
  if (p.name === 'openrouter') { headers['HTTP-Referer'] = 'https://tukuk.org'; headers['X-Title'] = 'Tukuk-OS'; }
  const body = { model: p.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], temperature: t, max_tokens: mt, top_p: tp };
  const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message || data?.errors?.[0]?.message || JSON.stringify(data).slice(0, 120);
    const e = new Error(`${p.name} ${res.status}: ${String(detail).slice(0, 160)}`); e.status = res.status; throw e;
  }
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) { const e = new Error(`${p.name}: respons kosong`); e.status = res.status; throw e; }
  return { response: text, _model: p.model };
}

// Rotasi penuh: cuba setiap pembekal (langkau yang cooling). Pulangkan { response,
// _model, _provider } jaya, atau { response:'', rejected:[...] } bila semua habis/gagal.
async function generateCloudRotation(prompt, opts = {}) {
  const rejected = [];
  for (const p of listCloudProviders()) {
    const rem = coolingRemaining(p.name);
    if (rem) { rejected.push({ provider: p.name, reason: `cooling (habis kuota; cuba semula dlm ${Math.ceil(rem / 1000)}s)` }); continue; }
    try {
      const out = await callCloud(p, prompt, opts);
      return { ...out, _provider: p.name };
    } catch (err) {
      if (isQuotaError(err)) markCooling(p.name, quotaCooldownMs(err));
      rejected.push({ provider: p.name, reason: err.message });
    }
  }
  return { response: '', _provider: null, rejected };
}

// Muka TERPELIHARA: `generateCloud(backend, ...)` kini menjalankan ROTASI penuh,
// jadi pemanggil lama (rag.js, mcp/server.js) dapat kedap-automatik tanpa diubah
// panggilannya. Jika `backend` ialah satu pembekal eksplisit (ada .key), cuba dia
// dahulu; bila ia gagal/habis, sambung rotasi pembekal lain.
async function generateCloud(b, prompt, opts = {}) {
  if (b && b.key && b.name && CLOUD_PROVIDERS[b.name]) {
    const single = {
      name: b.name, kind: CLOUD_PROVIDERS[b.name].kind, key: b.key,
      model: b.model || cloudModel(b.name), baseUrl: CLOUD_PROVIDERS[b.name].baseUrl,
      account: b.name === 'cloudflare' ? cloudAccountId() : undefined
    };
    if (!coolingRemaining(single.name)) {
      try {
        const out = await callCloud(single, prompt, opts);
        return { ...out, _provider: single.name };
      } catch (err) {
        if (isQuotaError(err)) markCooling(single.name, quotaCooldownMs(err));
      }
    }
  }
  return generateCloudRotation(prompt, opts);
}

async function health() {
  const b = await activeBackend();
  if (b.kind === 'cloud') {
    const providers = b.providers.map((name) => ({
      name, model: cloudModel(name), cooling: Boolean(coolingRemaining(name)),
      retryInMs: coolingRemaining(name)
    }));
    const active = providers.find((p) => !p.cooling) || providers[0];
    return { online: true, cloud: true, provider: active.name, model: active.model, providers, wanted: config.brain.chain, satisfied: true };
  }
  if (b.kind === 'ollama') {
    try {
      const models = await availableModels();
      return { online: true, cloud: false, provider: 'ollama', model: activeModel, models, wanted: config.brain.chain, satisfied: config.brain.chain.some((n) => models.some((m) => m.name === n)) };
    } catch (error) {
      return { online: false, provider: 'ollama', model: null, error: error.message };
    }
  }
  return { online: false, provider: 'none', extractiveOnly: true, model: null, note: 'Tiada LLM dikonfigurasi — /ask akan guna jawapan ekstraktif.' };
}

function currentModel() {
  return activeModel || config.brain.chain[0];
}

module.exports = {
  generate, generateCloud, generateCloudRotation, health, availableModels, pickModel,
  currentModel, activeBackend, ollamaReachable, listCloudProviders
};