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

const CLOUD_DEFAULT_MODEL = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', groq: 'llama-3.1-8b-instant' };

function setting(key, fb) {
  try { return require('../store').getSetting(key, fb); } catch { return fb; }
}
function envKeyFor(name) {
  if (name === 'gemini') return process.env.GEMINI_API_KEY || config.brain.geminiApiKey || '';
  if (name === 'openai') return process.env.OPENAI_API_KEY || config.brain.openaiApiKey || '';
  if (name === 'groq') return process.env.GROQ_API_KEY || config.brain.groqApiKey || '';
  return '';
}
async function ollamaReachable() {
  try { await availableModels(); return true; } catch { return false; }
}

// Tentukan backend LLM aktif: cloud (Gemini/OpenAI/Groq) → Ollama → none (ekstraktif).
// Sesuai server CPU-only — tiada model dilari lokal; hanya satu panggilan HTTP ke awan.
async function activeBackend() {
  const pref = String(setting('aiProvider', '') || '').toLowerCase();
  if (pref === 'ollama') {
    return (await ollamaReachable()) ? { kind: 'ollama' } : { kind: 'none' };
  }
  const clouds = ['gemini', 'openai', 'groq'];
  if (clouds.includes(pref)) {
    const key = setting('aiApiKey', '') || envKeyFor(pref);
    if (key) return { kind: 'cloud', name: pref, key, model: setting('aiModel', '') || CLOUD_DEFAULT_MODEL[pref] };
  }
  for (const name of ['gemini', 'groq', 'openai']) {
    const k = envKeyFor(name);
    if (k) return { kind: 'cloud', name, key: k, model: setting('aiModel', '') || CLOUD_DEFAULT_MODEL[name] };
  }
  if (await ollamaReachable()) return { kind: 'ollama' };
  return { kind: 'none' };
}

// Jana teks melalui API cloud. Pulangkan bentuk sama seperti Ollama ({ response }).
async function generateCloud(b, prompt, { system, temperature, maxTokens, topP } = {}) {
  const t = temperature ?? config.brain.temperature;
  const mt = maxTokens ?? config.brain.maxTokens;
  const tp = topP ?? config.brain.topP;
  const timeout = { signal: AbortSignal.timeout(config.brain.timeout) };

  if (b.name === 'gemini') {
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: t, maxOutputTokens: mt, topP: tp } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${b.model}:generateContent?key=${encodeURIComponent(b.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...timeout
    });
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('') || '';
    if (!text) throw new Error(data?.error?.message || 'Gemini: respons kosong');
    return { response: text, _model: b.model };
  }

  const base = b.name === 'openai' ? 'https://api.openai.com/v1' : 'https://api.groq.com/openai/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.key}` },
    body: JSON.stringify({ model: b.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], temperature: t, max_tokens: mt, top_p: tp }),
    ...timeout
  });
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error(data?.error?.message || `${b.name}: respons kosong`);
  return { response: text, _model: b.model };
}

async function health() {
  const b = await activeBackend();
  if (b.kind === 'cloud') {
    return { online: true, cloud: true, provider: b.name, model: b.model, wanted: config.brain.chain, satisfied: true };
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

module.exports = { generate, generateCloud, health, availableModels, pickModel, currentModel, activeBackend };