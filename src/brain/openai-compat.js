/**
 * openai-compat.js — JEMBATAN agent untuk Tukuk Agent (editor AI).
 *
 * Pembuka Cline/Kilo (dan klien OpenAI-compatible lain) menghantar FULL
 * `messages` + `tools` + `tool_choice` + `stream` dan menjangkakan `tool_calls`
 * balik. `provider.js.callCloud()` TIDAK boleh itu — ia meratakan semuanya
 * kepada satu `prompt` text-only. Modul ini melakukan PASSTHROUGH mentah ke
 * pembekal OpenAI-kind (Groq `openai/gpt-oss-120b`, OpenRouter, OpenAI, xAI,
 * HuggingFace) yang menyokong function-calling, dengan ROTASI + COOLING kuota
 * yang sama dipakai /ask (diimport dari provider.js — tiada logik berganda).
 *
 * Perhatian CSP/tepi: JANGAN pernah pulang 5xx untuk kegagalan aplikasi —
 * worker tepi tukuk.org menafsir sebarang 5xx asal sebagai "pelayan mati" lalu
 * menukar dengan mod sandaran. Semua kegagalan dipetakan ke 4xx.
 */
const provider = require('./provider');

// Model stabil yang diiklankan ke klien. Dipeta kepada model sebenar pembekal
// yang aktif pada setiap percubaan (rotasi boleh tukar pembekal/model).
const ADVERTISED_MODEL = 'tukuk-agent';

// Pembekal yang `kind:'openai'` tetapi TIDAK faham `tools`/`tool_calls`.
// litert (gemma3-1b pinggir) menjawab 200 dengan text sahaja dan MENJAUH
// fungsi — kalau ia masuk rotasi agen (cth bila aiProvider=admin = litert),
// mod Agent kliennya jadi bisu tool. Klien bolt.diy/Cline perlukan tool_calls.
const NO_TOOLS_PROVIDERS = new Set(['litert']);

// Hanya pembekal `kind:'openai'` yang faham /chat/completions + tools. Gemini,
// Cloudflare (Workers AI) dan ollama-native diLANGGAU di sini — mereka text-only.
function openaiProviders() {
  return provider
    .listCloudProviders()
    .filter((p) => p.kind === 'openai' && p.baseUrl && !NO_TOOLS_PROVIDERS.has(p.name));
}

// Senarai model untuk GET /v1/models — satu ID stabil sahaja supaya klien tidak
// tersangkut pada model pembekal tertentu yang mungkin bertukar bila rotasi.
function listModels() {
  return [
    {
      id: ADVERTISED_MODEL,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'tukuk-agent',
    },
  ];
}

// Satu percubaan ke SATU pembekal. Body diteruskan HANYLA dengan `model`
// dipaksa ke model pembekal (menjamin model function-calling digunakan walau
// klien hantar ID lain). Authorization + header per-pembekal ditangani di sini.
async function callUpstream(p, fwdBody, fetchImpl, timeoutMs) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` };
  if (p.name === 'openrouter') {
    headers['HTTP-Referer'] = 'https://tukuk.org';
    headers['X-Title'] = 'Tukuk Agent';
  }
  const signal = AbortSignal.timeout(timeoutMs);
  return fetchImpl(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...fwdBody, model: p.model }),
    signal,
  });
}

/**
 * cubaRotation(body, { fetchImpl, timeoutMs })
 *  → { ok:true, provider, response }   (response = upstream fetch Response; pemanggil paip)
 *  → { ok:false, status, error, rejected }
 *
 * Rotasi: langkau pembekal cooling; pada ralat kuota (429/402) tandai cooling
 * lalu cuba pembekal seterusnya. Kegagalan BUKAN kuota (cth 400 pembekal) juga
 * mencuba pembekal seterusnya tetapi TIDAK menjejaskan cooling. Semua habis →
 * 429 (kuota) atau 424 (ralat lain). Tiada 5xx.
 */
async function chatWithRotation(body, { fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  const messages = body && body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, error: 'Request must include a non-empty "messages" array.', rejected: [] };
  }

  const providers = openaiProviders();
  if (!providers.length) {
    return {
      ok: false,
      status: 409,
      error: 'No OpenAI-compatible agent provider configured. Set GROQ_API_KEY (or another cloud key) in .env.',
      rejected: [],
    };
  }

  // Teruskan field OpenAI yang sah; buang `model` (kami paksa) & apa-apa sampler
  // yang boleh merosakkan function-calling. `tools`/`tool_choice` wajib lalu.
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
      const res = await callUpstream(p, rest, fetchImpl, timeoutMs);
      if (res.ok) return { ok: true, provider: p.name, model: p.model, response: res };

      const detail = await res.clone().text().catch(() => '');
      const err = new Error(`${p.name} ${res.status}: ${detail.slice(0, 160)}`);
      err.status = res.status;
      if (provider.isQuotaError(err)) {
        sawQuota = true;
        provider.markCooling(p.name, provider.quotaCooldownMs(err));
      }
      rejected.push({ provider: p.name, reason: err.message });
    } catch (err) {
      // Timeout/ralat rangkaian — guna isQuotaError untuk consistency.
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

module.exports = { ADVERTISED_MODEL, openaiProviders, listModels, chatWithRotation };
