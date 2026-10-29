const http = require('http');
const config = require('../config');

/**
 * LLM providers for the Tukuk-OS "brain".
 *
 * Default: smollm:135m (91 MB) — runs on CPU, ~12 tokens/s.
 * Users can switch models; LLM_CHAIN provides the failover path.
 *
 * smollm:135m is very small. It can ONLY rely on sources that are fed
 * to it (RAG). Without context its answers cannot be trusted.
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

function request(path, { method = 'GET', body, timeout = config.brain.timeout, signal } = {}) {
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
    // Outside signal (the losing racers are cancelled) — kill the request at once
    // so Ollama stops generating and CPU is not burned on a thrown-away answer.
    if (signal) {
      if (signal.aborted) req.destroy(new Error('aborted'));
      else signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    }
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

async function generate(prompt, { system, numPredict, temperature, model: forceModel, extraOptions, timeout, signal } = {}) {
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
    timeout: timeout ? Math.min(timeout, config.brain.timeout) : config.brain.timeout,
    signal
  });
  result._model = target;
  return result;
}

// ── Registry of cloud LLM providers ────────────────────────────────────────
// MORE THAN ONE provider can be registered at a time (one env variable per
// provider). /ask tries BOTH in rotation: a provider that just ran out of quota
// (429 / "quota / rate limit / daily") goes into a short-lived "cooling" and the call moves
// straight on to the next provider that still has quota. All exhausted → local Ollama
// → extractive. No manual quota counting — the 429 signal is the trigger.
function setting(key, fb) {
  try { return require('../store').getSetting(key, fb); } catch { return fb; }
}

// LOCAL-FIRST is switched on by the BRAIN_LOCAL_FIRST env (1/true/yes/on) OR the
// admin setting `aiLocalFirst=1` (toggleable from /admin without a deploy). In the hybrid
// mode localFirst NO LONGER delays the cloud — it only removes the cloud "head
// start" so Ollama begins generating at once, side by side with the cloud.
function isLocalFirst() {
  if (config.brain.localFirst) return true;
  if (['1', 'true', 'yes', 'on'].includes(String(process.env.BRAIN_LOCAL_FIRST || '').toLowerCase())) return true;
  return String(setting('aiLocalFirst', '')) === '1';
}

const CLOUD_PROVIDERS = {
  gemini: { defaultModel: 'gemini-flash-latest', kind: 'gemini' },
  // VETOED by the owner — kept in the registry ONLY so providerBaseUrl()/tests keep
  // working. Never reached: 'groq' is in DISABLED_PROVIDERS below, and every rotation
  // path (listCloudProviders → providerOrder) drops it. Do not put it back in env.
  groq: { defaultModel: 'openai/gpt-oss-120b', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  // Google Gemini through the OpenAI-compatible layer (function-calling supported) so
  // it QUALIFIES for the builder AGENT rotation (kind:'openai'). The key is the same GEMINI_API_KEY
  // as the native 'gemini'. Gemini's free tier is generous → it widens the free builder capacity.
  'gemini-openai': { defaultModel: 'gemini-3.8-flash', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openai: { defaultModel: 'gpt-4o-mini', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  openrouter: { defaultModel: 'openrouter/free', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  xai: { defaultModel: 'grok-4', kind: 'openai', baseUrl: 'https://api.x.ai/v1' },
  huggingface: { defaultModel: 'meta-llama/Llama-3.3-70B-Instruct', kind: 'openai', baseUrl: 'https://router.huggingface.co/v1' },
  cloudflare: { defaultModel: '@cf/meta/llama-4-scout-17b-16e-instruct', kind: 'cloudflare' },
  // Ollama Cloud API (native /api/chat format, not OpenAI). The free tier has
  // 5-hour/daily caps → an automatic cooldown on 429, serving the big models while quota exists.
  'ollama-cloud': { defaultModel: 'gpt-oss:20b', kind: 'ollama-native', baseUrl: 'https://api.ollama.com' },
  // LiteRT-LM edge tier (serves locally, OpenAI-compatible, e.g. port 8090).
  // No real key — the presence of LITERT_HOST enables it; the baseUrl is dynamic
  // via providerBaseUrl(). No quota → no cooling; always the last in line.
  litert: { defaultModel: 'gemma3-1b-it-int4.litertlm', kind: 'openai', baseUrl: '' }
};
const DEFAULT_ORDER = ['gemini-openai', 'gemini', 'ollama-cloud', 'openrouter', 'xai', 'huggingface', 'cloudflare', 'openai', 'litert'];

// ── Provider veto list ─────────────────────────────────────────────────────
// A HARD filter applied to every rotation source (env, config default, the admin
// aiProvider). One comma-separated env var, default 'groq' because the owner does
// not want Groq in this project at all. Set LLM_DISABLED_PROVIDERS='' to lift the
// veto — nothing else needs to change.
const DISABLED_PROVIDERS = new Set(
  String(process.env.LLM_DISABLED_PROVIDERS ?? 'groq')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);
function isDisabled(name) { return DISABLED_PROVIDERS.has(String(name).toLowerCase()); }

function providerBaseUrl(name) {
  if (name === 'litert') return config.brain.litertHost;
  return CLOUD_PROVIDERS[name] ? CLOUD_PROVIDERS[name].baseUrl : undefined;
}

function cloudKey(name) {
  const b = config.brain;
  // The Admin keys (aiProvider + aiApiKey) enable the matching provider,
  // so the Admin UI → AI Settings still works even though rotation reads env.
  const pref = String(setting('aiProvider', '') || '').toLowerCase();
  const adminKey = (pref === name) ? (setting('aiApiKey', '') || '') : '';
  if (name === 'gemini') return process.env.GEMINI_API_KEY || b.geminiApiKey || adminKey;
  if (name === 'gemini-openai') return process.env.GEMINI_API_KEY || b.geminiApiKey || adminKey;
  if (name === 'openai') return process.env.OPENAI_API_KEY || b.openaiApiKey || adminKey;
  if (name === 'groq') return process.env.GROQ_API_KEY || b.groqApiKey || adminKey;
  if (name === 'openrouter') return process.env.OPENROUTER_API_KEY || b.openrouterApiKey || adminKey;
  if (name === 'xai') return process.env.XAI_API_KEY || b.xaiApiKey || adminKey;
  if (name === 'huggingface') return process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || b.huggingfaceApiKey || adminKey;
  if (name === 'cloudflare') return process.env.CLOUDFLARE_AI_TOKEN || b.cloudflareAiToken || adminKey;
  if (name === 'ollama-cloud') return process.env.OLLAMA_CLOUD_API_KEY || b.ollamaCloudApiKey || adminKey;
  // The LiteRT edge tier: the "key" is the presence of LITERT_HOST itself (it serves
  // locally with no auth — a token value is sent but litert-lm ignores it).
  if (name === 'litert') return b.litertHost ? 'edge-tier' : '';
  return '';
}
function cloudAccountId() {
  return process.env.CLOUDFLARE_ACCOUNT_ID || config.brain.cloudflareAccountId || '';
}
function cloudModel(name) {
  const fromEnv = process.env[name.toUpperCase().replace(/-/g, '_') + '_MODEL'];
  return setting(`${name}Model`, '') || fromEnv || CLOUD_PROVIDERS[name]?.defaultModel || '';
}
function cloudAvailable(name) {
  if (!CLOUD_PROVIDERS[name] || !cloudKey(name)) return false;
  // Workers AI needs an account id besides the token — if it is missing, treat it as unconfigured.
  if (name === 'cloudflare' && !cloudAccountId()) return false;
  return true;
}
function providerOrder() {
  const configured = String(config.brain.cloudOrder || DEFAULT_ORDER.join(','))
    .split(',').map((s) => s.trim()).filter((n) => CLOUD_PROVIDERS[n]);
  const order = configured.length ? configured : DEFAULT_ORDER.slice();
  // The admin aiProvider (when it is one of the cloud ones) pushes that provider to the front.
  const pref = String(setting('aiProvider', '') || '').toLowerCase();
  if (order.includes(pref)) { order.splice(order.indexOf(pref), 1); order.unshift(pref); }
  // The veto is the LAST word: no env value and no admin setting can re-admit a provider
  // that lives on the veto list (owner decision for Groq).
  return order.filter((name) => !isDisabled(name));
}
// The cloud providers that HAVE a key, in rotation order.
function listCloudProviders() {
  return providerOrder().filter(cloudAvailable).map((name) => ({
    name,
    kind: CLOUD_PROVIDERS[name].kind,
    key: cloudKey(name),
    model: cloudModel(name),
    baseUrl: providerBaseUrl(name),
    account: name === 'cloudflare' ? cloudAccountId() : undefined
  }));
}

// ── Cooling: don't touch a provider that just ran out of quota ─────────
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
  // No credit / billing issue → a long cooling (no retry for 2 hours).
  if (/credit|billing|insufficient|payment|top.?up|subscribe/i.test(msg)) return 2 * 60 * 60 * 1000;
  // Daily quota → 10 min; a per-minute cap → 60s.
  if (/daily|per day|per-day|resets|day\b|usage.?limit|free.?limit|5.?hour|weekly/i.test(msg)) return 10 * 60 * 1000;
  return 60 * 1000;
}

async function ollamaReachable() {
  try { await availableModels(); return true; } catch { return false; }
}

// The active backend. `cloud` now carries a LIST of providers (rotation), not just one.
async function activeBackend() {
  const pref = String(setting('aiProvider', '') || '').toLowerCase();
  if (pref === 'ollama') {
    return (await ollamaReachable()) ? { kind: 'ollama' } : { kind: 'none' };
  }
  // LOCAL-FIRST: Ollama is the main brain; list the cloud as an emergency fallback.
  if (isLocalFirst() && (await ollamaReachable())) {
    return { kind: 'ollama', localFirst: true, cloudFallback: listCloudProviders().map((p) => p.name) };
  }
  const providers = listCloudProviders();
  if (providers.length) {
    const first = providers.find((p) => !coolingRemaining(p.name)) || providers[0];
    return { kind: 'cloud', name: first.name, key: first.key, model: first.model, providers: providers.map((p) => p.name) };
  }
  if (await ollamaReachable()) return { kind: 'ollama' };
  return { kind: 'none' };
}

// One call to ONE provider. HTTP errors are raised with .status so that
// rotation can tell a quota error (429) apart from a temporary failure.
async function callCloud(p, prompt, { system, temperature, maxTokens, topP, timeout, signal: outerSignal } = {}) {
  const t = temperature ?? config.brain.temperature;
  const mt = maxTokens ?? config.brain.maxTokens;
  const tp = topP ?? config.brain.topP;
  // The per-call timeout can be PINCHED (the interactive budget in rag.ask) — when absent,
  // config.brain.timeout is used. An AbortSignal kills the stream right on time.
  const capMs = Math.max(1000, Math.min(timeout || config.brain.timeout, config.brain.timeout));
  // Combine the per-call budget with the outside cancellation signal (the losing racer).
  const signal = outerSignal
    ? AbortSignal.any([AbortSignal.timeout(capMs), outerSignal])
    : AbortSignal.timeout(capMs);

  if (p.kind === 'gemini') {
    // gemini-*-latest is a "thinking" model: with no budget its internal thinking tokens
    // burn the small budget → an EMPTY answer (finishReason MAX_TOKENS). Switch
    // thinking off (thinkingBudget 0) so a short answer has enough room and stays fast.
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: t, maxOutputTokens: mt, topP: tp, thinkingConfig: { thinkingBudget: 0 } } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${encodeURIComponent(p.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`gemini ${res.status}: ${String(data?.error?.message || '').slice(0, 160)}`); e.status = res.status; throw e; }
    const text = (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text).join('') || '';
    if (!text) { const e = new Error('gemini: empty response'); e.status = res.status; throw e; }
    return { response: text, _model: p.model };
  }

  // Ollama native cloud API (the /api/chat format with a different response shape)
  if (p.kind === 'ollama-native') {
    const body = { model: p.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], stream: false, options: { temperature: t, num_predict: mt } };
    const res = await fetch(`${p.baseUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` }, body: JSON.stringify(body), signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`${p.name} ${res.status}: ${String(data?.error || JSON.stringify(data)).slice(0,160)}`); e.status = res.status; throw e; }
    const text = data?.message?.content || '';
    if (!text) { const e = new Error(`${p.name}: empty response`); e.status = res.status; throw e; }
    return { response: text, _model: p.model };
  }

  // OpenAI-compatible providers (groq, openai, openrouter, xai, huggingface)
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
  if (!text) { const e = new Error(`${p.name}: empty response`); e.status = res.status; throw e; }
  return { response: text, _model: p.model };
}

// Full rotation: try every provider (skipping the ones cooling). Return { response,
// _model, _provider } on success, or { response:'', rejected:[...] } when all are exhausted/failed.
async function generateCloudRotation(prompt, opts = {}) {
  const rejected = [];
  // The OVERALL deadline (a ms timestamp). Interactive callers (rag.ask) pass
  // deadline = now + budget; once it hits, stop rotating slow providers and use
  // the extractive path at once. No deadline → the config timeout is the default.
  const deadline = opts.deadline || (Date.now() + config.brain.timeout);
  for (const p of listCloudProviders()) {
    const rem = coolingRemaining(p.name);
    if (rem) { rejected.push({ provider: p.name, reason: `cooling (quota exhausted; retry in ${Math.ceil(rem / 1000)}s)` }); continue; }
    const left = deadline - Date.now();
    if (left < 1500) { rejected.push({ provider: p.name, reason: 'interactive budget reached' }); break; }
    try {
      const out = await callCloud(p, prompt, { ...opts, timeout: left });
      return { ...out, _provider: p.name };
    } catch (err) {
      if (isQuotaError(err)) markCooling(p.name, quotaCooldownMs(err));
      rejected.push({ provider: p.name, reason: err.message });
    }
  }
  return { response: '', _provider: null, rejected };
}

// SURFACE PRESERVED: `generateCloud(backend, ...)` now runs the FULL rotation,
// so older callers (rag.js, mcp/server.js) get automatic load-shedding without changing their
// calls. If `backend` is one explicit provider (it has a .key), try it
// first; when it fails or runs out, continue the rotation with other providers.
async function generateCloud(b, prompt, opts = {}) {
  const deadline = opts.deadline || (Date.now() + config.brain.timeout);
  if (b && b.key && b.name && CLOUD_PROVIDERS[b.name]) {
    const single = {
      name: b.name, kind: CLOUD_PROVIDERS[b.name].kind, key: b.key,
      model: b.model || cloudModel(b.name), baseUrl: providerBaseUrl(b.name),
      account: b.name === 'cloudflare' ? cloudAccountId() : undefined
    };
    const left = deadline - Date.now();
    if (!coolingRemaining(single.name) && left >= 1500) {
      try {
        const out = await callCloud(single, prompt, { ...opts, timeout: left });
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
      return { online: true, cloud: false, localFirst: Boolean(b.localFirst), cloudFallback: b.cloudFallback || [], provider: 'ollama', model: activeModel, models, wanted: config.brain.chain, satisfied: config.brain.chain.some((n) => models.some((m) => m.name === n)) };
    } catch (error) {
      return { online: false, provider: 'ollama', model: null, error: error.message };
    }
  }
  return { online: false, provider: 'none', extractiveOnly: true, model: null, note: 'No LLM configured — /ask will use extractive answers.' };
}

function currentModel() {
  return activeModel || config.brain.chain[0];
}

module.exports = {
  generate, generateCloud, generateCloudRotation, health, availableModels, pickModel,
  currentModel, activeBackend, ollamaReachable, listCloudProviders, isLocalFirst,
  // Used by src/brain/openai-compat.js (the agent tool-calling proxy) to reuse the
  // SAME rotation + quota-cooling state as /ask, without re-implementing it.
  markCooling, coolingRemaining, isQuotaError, quotaCooldownMs, cloudModel, CLOUD_PROVIDERS, providerBaseUrl,
  // The veto list (owner decision: no Groq) — surfaced by /api/models so a missing
  // provider is explained instead of looking like a bug.
  DISABLED_PROVIDERS, isDisabled
};