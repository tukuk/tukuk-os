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
// Varian CEPAT: dipeta ke model ringan setiap pembekal (lihat FAST_MODELS).
const ADVERTISED_MODEL_FAST = 'tukuk-agent-fast';

/*
 * Peta model laju bagi tier percuma/`-fast`: pemboleh ubah
 * AGENT_FAST_MODEL_<NAMA> menang; jika tiada, default terbukti ADA + PANTAS
 * pada akaun Groq kita (openai/gpt-oss-20b balas ±0.9s, lebih ringan daripada
 * 120b). llama-3.1-8b-instant SUDAH DITANGGALKAN Groq (404) — jangan guna.
 * Pembekal tanpa default hanya guna model biasa (tiada 404 model).
 */
const FAST_MODELS = {
  groq: process.env.AGENT_FAST_MODEL_GROQ || 'openai/gpt-oss-20b',
  openrouter: process.env.AGENT_FAST_MODEL_OPENROUTER || 'meta-llama/llama-3.3-70b-instruct',
};

function fastModelFor(name) {
  const key = 'AGENT_FAST_MODEL_' + String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[key] || FAST_MODELS[String(name)] || '';
}

// Pembekal yang `kind:'openai'` tetapi TIDAK faham `tools`/`tool_calls`.
// litert (gemma3-1b pinggir) menjawab 200 dengan text sahaja dan MENJAUH
// fungsi — kalau ia masuk rotasi agen (cth bila aiProvider=admin = litert),
// mod Agent kliennya jadi bisu tool. Klien bolt.diy/Cline perlukan tool_calls.
const NO_TOOLS_PROVIDERS = new Set(['litert']);

// Hanya pembekal `kind:'openai'` yang faham /chat/completions + tools. Gemini,
// Cloudflare (Workers AI) diLANGGAU di sini — mereka text-only.
// Pengecualian: 'ollama-cloud' disimpan sebagai 'ollama-native' dalam
// provider.js, TETAPI api.ollama.com juga menyajikan /v1/chat/completions
// (format OpenAI) dengan sokongan tool untuk gpt-oss — jadi kita petakan ke
// bentuk OpenAI di sini sahaja, tanpa mengubah logik /ask sedia ada.
function openaiProviders() {
  return provider
    .listCloudProviders()
    .map((p) => (p.name === 'ollama-cloud' && p.baseUrl ? { ...p, kind: 'openai', baseUrl: `${p.baseUrl}/v1` } : p))
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
    {
      id: ADVERTISED_MODEL_FAST,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'tukuk-agent',
    },
  ];
}

// Satu percubaan ke SATU pembekal. Body diteruskan HANYLA dengan `model`
// dipaksa ke model pembekal (menjamin model function-calling digunakan walau
// klien hantar ID lain). Authorization + header per-pembekal ditangani di sini.
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
 * cubaRotation(body, { fetchImpl, timeoutMs })
 *  → { ok:true, provider, response }   (response = upstream fetch Response; pemanggil paip)
 *  → { ok:false, status, error, rejected }
 *
 * Rotasi: langkau pembekal cooling; pada ralat kuota (429/402) tandai cooling
 * lalu cuba pembekal seterusnya. Kegagalan BUKAN kuota (cth 400 pembekal) juga
 * mencuba pembekal seterusnya tetapi TIDAK menjejaskan cooling. Semua habis →
 * 429 (kuota) atau 424 (ralat lain). Tiada 5xx.
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
       * Model laju tak dikenal pasti (400/404) — JANGAN tandai kuota/cooling;
       * rotasi biasa (model pembekal) masih peluang kedua yang betul.
       */
      if (useModel && (err.status === 400 || err.status === 404)) {
        rejected.push({ provider: p.name, reason: `fast model ditolak: ${err.message}` });
        try {
          const res2 = await callUpstream(p, rest, fetchImpl, timeoutMs, p.model);
          if (res2.ok) return { ok: true, provider: p.name, model: p.model, response: res2 };
        } catch { /* jatuh ke bawah sebagai rejection biasa */ }
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

module.exports = { ADVERTISED_MODEL, ADVERTISED_MODEL_FAST, openaiProviders, listModels, chatWithRotation, fastModelFor };
