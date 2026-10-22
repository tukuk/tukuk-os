/**
 * openai-compat.js — the agent BRIDGE for Tukuk Agent (the AI editor).
 *
 * Cline/Kilo clients (and other OpenAI-compatible clients) send the FULL
 * `messages` + `tools` + `tool_choice` + `stream` and expect `tool_calls`
 * back. `provider.js.callCloud()` cannot do that — it flattens everything
 * into one text-only `prompt`. This module does a raw PASSTHROUGH to
 * OpenAI-kind providers (Groq `openai/gpt-oss-120b`, OpenRouter, OpenAI, xAI,
 * HuggingFace) that support function-calling, using the same quota ROTATION +
 * COOLING as /ask (imported from provider.js — no duplicated logic).
 *
 * CSP/edge note: NEVER return 5xx for application failures —
 * the tukuk.org edge worker reads any upstream 5xx as "server down" and
 * switches to fallback mode. All failures are mapped to 4xx.
 */
const provider = require('./provider');

// The stable model advertised to clients. Mapped to the actual provider model
// that is active on each attempt (rotation may switch provider/model).
const ADVERTISED_MODEL = 'tukuk-agent';
// FAST variant: mapped to each provider's lightweight model (see FAST_MODELS).
const ADVERTISED_MODEL_FAST = 'tukuk-agent-fast';

/*
 * Fast-model map for the free/`-fast` tier: the
 * AGENT_FAST_MODEL_<NAME> variable wins; if absent, a default proven to EXIST + be QUICK
 * on our Groq account (openai/gpt-oss-20b replies in ±0.9s, lighter than
 * 120b). llama-3.1-8b-instant is RETIRED by Groq (404) — do not use it.
 * Providers without a default just use the regular model (no model 404s).
 */
const FAST_MODELS = {
  groq: process.env.AGENT_FAST_MODEL_GROQ || 'openai/gpt-oss-20b',
  openrouter: process.env.AGENT_FAST_MODEL_OPENROUTER || 'meta-llama/llama-3.3-70b-instruct',
};

function fastModelFor(name) {
  const key = 'AGENT_FAST_MODEL_' + String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[key] || FAST_MODELS[String(name)] || '';
}

// Providers with `kind:'openai'` that do NOT understand `tools`/`tool_calls`.
// litert (edge gemma3-1b) answers 200 with text only and AVOIDS
// tooling — if it enters the agent rotation (e.g. when aiProvider=admin = litert),
// the client's Agent mode goes tool-silent. bolt.diy/Cline clients need tool_calls.
const NO_TOOLS_PROVIDERS = new Set(['litert']);

// Only `kind:'openai'` providers understand /chat/completions + tools. Gemini,
// Cloudflare (Workers AI) are SKIPPED here — they are text-only.
// Exception: 'ollama-cloud' is stored as 'ollama-native' in
// provider.js, BUT api.ollama.com also serves /v1/chat/completions
// (OpenAI format) with tool support for gpt-oss — so we map it to the
// OpenAI shape here only, leaving the existing /ask logic untouched.
function openaiProviders() {
  return provider
    .listCloudProviders()
    .map((p) => (p.name === 'ollama-cloud' && p.baseUrl ? { ...p, kind: 'openai', baseUrl: `${p.baseUrl}/v1` } : p))
    .filter((p) => p.kind === 'openai' && p.baseUrl && !NO_TOOLS_PROVIDERS.has(p.name));
}

// The model list for GET /v1/models — just one stable ID so clients don't get
// stuck on a specific provider model that rotation may swap out.
function listModels() {
  return [
    {
      id: ADVERTISED_MODEL,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'tukuk-agent',
    },
    {
      id: ADVERTISED_MODEL_FAST,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'tukuk-agent',
    },
  ];
}

// One attempt against ONE provider. The body is forwarded ONLY with `model`
// forced to the provider's model (guaranteeing a function-calling model is used even if
// the client sends a different ID). Authorization + per-provider headers are handled here.
async function callUpstream(p, fwdBody, fetchImpl, timeoutMs, model) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` };
  if (p.name === 'openrouter') {
    headers['HTTP-Referer'] = 'https://tukuk.org';
    headers['X-Title'] = 'Tukuk Agent';
  }
  const signal = AbortSignal.timeout(timeoutMs);
  return fetchImpl(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...fwdBody, model: model || p.model }),
    signal,
  });
}

/**
 * chatWithRotation(body, { fetchImpl, timeoutMs })
 *  → { ok:true, provider, response }   (response = the upstream fetch Response; the caller pipes it)
 *  → { ok:false, status, error, rejected }
 *
 * Rotation: skip cooling providers; on a quota error (429/402) mark cooling
 * then try the next provider. NON-quota failures (e.g. a provider 400) also
 * try the next provider but do NOT affect cooling. All exhausted →
 * 429 (quota) or 424 (other errors). Never 5xx.
 */
async function chatWithRotation(body, { fetchImpl = globalThis.fetch, timeoutMs = 120000, fast = false } = {}) {
  const messages = body && body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, error: 'Request must include a non-empty "messages" array.', rejected: [] };
  }

  const providers = openaiProviders();
  if (!providers.length) {
    return {
      ok: false,
      status: 409,
      error: 'No tool-capable agent provider configured. Set OLLAMA_CLOUD_API_KEY or GROQ_API_KEY (etc) in .env.',
      rejected: [],
    };
  }

  // Keep valid OpenAI fields; drop `model` (we force it) and any sampler that
  // could break function-calling. `tools`/`tool_choice` must pass through.
  const { model: _drop, ...rest } = body;

  const rejected = [];
  let sawQuota = false;
  for (const p of providers) {
    const rem = provider.coolingRemaining(p.name);
    if (rem) {
      rejected.push({ provider: p.name, reason: `cooling (retry in ${Math.ceil(rem / 1000)}s)` });
      continue;
    }
    try {
      const useModel = fast ? fastModelFor(p.name) : '';
      const res = await callUpstream(p, rest, fetchImpl, timeoutMs, useModel);
      if (res.ok) return { ok: true, provider: p.name, model: useModel || p.model, response: res };

      const detail = await res.clone().text().catch(() => '');
      const err = new Error(`${p.name} ${res.status}: ${detail.slice(0, 160)}`);
      err.status = res.status;
      if (provider.isQuotaError(err)) {
        sawQuota = true;
        provider.markCooling(p.name, provider.quotaCooldownMs(err));
      }
      /*
       * An unrecognised fast model (400/404) — do NOT mark quota/cooling;
       * normal rotation (the provider model) is still the correct second chance.
       */
      if (useModel && (err.status === 400 || err.status === 404)) {
        rejected.push({ provider: p.name, reason: `fast model rejected: ${err.message}` });
        try {
          const res2 = await callUpstream(p, rest, fetchImpl, timeoutMs, p.model);
          if (res2.ok) return { ok: true, provider: p.name, model: p.model, response: res2 };
        } catch { /* falls through as a normal rejection */ }
      }
      rejected.push({ provider: p.name, reason: err.message });
    } catch (err) {
      // Timeout/network errors — use isQuotaError for consistency.
      if (provider.isQuotaError(err)) sawQuota = true;
      rejected.push({ provider: p.name, reason: String((err && err.message) || err) });
    }
  }

  return {
    ok: false,
    status: sawQuota ? 429 : 424,
    error: sawQuota
      ? 'All agent providers are cooling (quota exhausted). Retry shortly or add another cloud key.'
      : 'All configured agent providers failed. Check keys/models in AI Settings.',
    rejected,
  };
}

module.exports = { ADVERTISED_MODEL, ADVERTISED_MODEL_FAST, openaiProviders, listModels, chatWithRotation, fastModelFor };
