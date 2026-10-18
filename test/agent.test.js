'use strict';
// Ujian Tukuk Agent: src/brain/openai-compat.js (rotasi + peta 4xx) dan
// src/agent.js (proksi OpenAI-compatible + /build + auth/CORS) melalui loopback HTTP.
// Tiada rangkaian sebenar — fetch/provider/mcp di-stub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const provider = require('../src/brain/provider');
const openai = require('../src/brain/openai-compat');
const agent = require('../src/agent');
const mcp = require('../mcp/server');

// ── Stub pembekal OpenAI tanpa menyentuh store/env sebenar ──────────────────
function withProviders(list, fn) {
  const saved = {
    listCloudProviders: provider.listCloudProviders,
    coolingRemaining: provider.coolingRemaining,
    markCooling: provider.markCooling,
  };
  provider.listCloudProviders = () => list;
  provider.coolingRemaining = () => 0;
  provider.markCooling = () => {};
  return fn().finally(() => Object.assign(provider, saved));
}

const groq = { name: 'groq', kind: 'openai', baseUrl: 'https://groq.test/v1', key: 'k1', model: 'openai/gpt-oss-120b' };
const or = { name: 'openrouter', kind: 'openai', baseUrl: 'https://or.test/v1', key: 'k2', model: 'x/y' };

test('chatWithRotation: tiada provider OpenAI -> 409 (bukan 5xx)', () => withProviders([], async () => {
  const out = await openai.chatWithRotation({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.ok(out.status < 500, 'pasti 4xx supaya tepi tak topeng mod sandaran');
}));

test('chatWithRotation: messages kosong -> 400', () => withProviders([groq], async () => {
  const out = await openai.chatWithRotation({ messages: [] });
  assert.equal(out.status, 400);
}));

test('chatWithRotation: provider jaya -> ok, model dipaksa ke model pembekal', () => withProviders([groq], async () => {
  let seenBody;
  const fetchImpl = async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await openai.chatWithRotation(
    { model: 'tukuk-agent', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function' }] },
    { fetchImpl }
  );
  assert.equal(out.ok, true);
  assert.equal(out.provider, 'groq');
  assert.equal(seenBody.model, 'openai/gpt-oss-120b', 'model klien dipeta ke model sebenar');
  assert.ok(Array.isArray(seenBody.tools), 'tools diteruskan utuh');
}));

test('chatWithRotation: semua 429 -> 429; bukan kuota -> 424', () => withProviders([groq, or], async () => {
  const q = await openai.chatWithRotation(
    { messages: [{ role: 'user', content: 'x' }] },
    { fetchImpl: async () => new Response('rate limited', { status: 429 }) }
  );
  assert.equal(q.status, 429);

  const n = await openai.chatWithRotation(
    { messages: [{ role: 'user', content: 'x' }] },
    { fetchImpl: async () => new Response('bad model', { status: 400 }) }
  );
  assert.equal(n.status, 424);
  assert.ok(n.rejected.length >= 2, 'senarai rejected diisi');
}));

// ── openaiProviders(): penapisan pembekal buta-tools + pemetaan ollama-cloud ──
test('openaiProviders: litert (buta tool) dibuang dari rotasi agen', () => withProviders([
  groq,
  { name: 'litert', kind: 'openai', baseUrl: 'http://127.0.0.1:8090/v1', key: 'edge', model: 'gemma3-1b' },
], async () => {
  const names = openai.openaiProviders().map((p) => p.name);
  assert.deepEqual(names, ['groq'], 'litert tak boleh muncul pada /api/agent/v1');
}));

test('openaiProviders: ollama-cloud dipetakan ke bentuk OpenAI /v1', () => withProviders([
  { name: 'ollama-cloud', kind: 'ollama-native', baseUrl: 'https://api.ollama.com', key: 'k', model: 'gpt-oss:20b' },
], async () => {
  const ps = openai.openaiProviders();
  assert.equal(ps.length, 1);
  assert.equal(ps[0].kind, 'openai');
  assert.equal(ps[0].baseUrl, 'https://api.ollama.com/v1', 'URL ditampal /v1 demi /chat/completions');
  const out = await openai.chatWithRotation(
    { messages: [{ role: 'user', content: 'pakai tool' }], tools: [{ type: 'function' }] },
    { fetchImpl: async (url) => { assert.equal(url, 'https://api.ollama.com/v1/chat/completions'); return new Response('{"choices":[]}', { status: 200 }); } }
  );
  assert.equal(out.ok, true);
  assert.equal(out.provider, 'ollama-cloud');
}));

// ── Loopback HTTP penuh untuk src/agent.js ──────────────────────────────────
function startApp({ token = 'secret-agent', freeToken = 'free-public', origin = '', patch } = {}) {
  const app = express();
  app.use(express.json());
  const auth = {
    bearer: (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim(),
    requireAdmin: (req, res) => res.status(401).json({ error: 'nope' }),
  };
  const config = {
    agent: {
      token, origin, timeoutMs: 5000, maxPerMin: 1000,
      freeToken, freeMaxPerMin: 8, freeMaxTokens: 4096,
    },
  };
  agent.mount(app, { auth, rateLimit: null, config, store: { event() {} } });
  if (patch) patch();
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

test('route: /v1/models tanpa token -> 401, dengan token -> senarai tukuk-agent', async () => {
  const { base, close } = await startApp();
  try {
    assert.equal((await fetch(base + '/api/agent/v1/models')).status, 401, 'tanpa auth ditolak');
    const ok = await fetch(base + '/api/agent/v1/models', { headers: { Authorization: 'Bearer secret-agent' } });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.data[0].id, 'tukuk-agent');
  } finally { await close(); }
});

test('tier percuma: freeToken diterima di /models; token salah tetap 401', async () => {
  const { base, close } = await startApp();
  try {
    const free = await fetch(base + '/api/agent/v1/models', { headers: { Authorization: 'Bearer free-public' } });
    assert.equal(free.status, 200, 'penanda free tier layak ke /models');
    const bogus = await fetch(base + '/api/agent/v1/models', { headers: { Authorization: 'Bearer teka-pecah' } });
    assert.equal(bogus.status, 401, 'token tidak dikenali tak lolos');
  } finally { await close(); }
});

test('tier percuma: max_tokens klien dikekang ke freeMaxTokens sebelum rotasi', async () => {
  const saved = openai.chatWithRotation;
  let seenBody;
  openai.chatWithRotation = async (body) => {
    seenBody = body;
    return {
      ok: true, provider: 'groq', model: 'openai/gpt-oss-120b',
      response: new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } }),
    };
  };
  const { base, close } = await startApp();
  try {
    const r = await fetch(base + '/api/agent/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer free-public' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], max_tokens: 999999 }),
    });
    assert.equal(r.status, 200);
    assert.equal(seenBody.max_tokens, 4096, 'clamp ke had tier percuma');

    // Token penuh (admin token) TIDAK dikekang.
    await fetch(base + '/api/agent/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-agent' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], max_tokens: 200000 }),
    });
    assert.equal(seenBody.max_tokens, 200000, 'tier penuh tak dikekang');
  } finally { openai.chatWithRotation = saved; await close(); }
});

test('CORS: subdomain tukuk.org (Builder) didengungkan walau AGENT_ORIGIN lain', async () => {
  const { base, close } = await startApp({ origin: 'https://agent.tukuk.org' });
  try {
    const pre = await fetch(base + '/api/agent/v1/models', {
      method: 'OPTIONS',
      headers: { Origin: 'https://build.tukuk.org', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://build.tukuk.org');
    // Asal asing bukan tukuk.org → tetap config.agent.origin (tingkah laku lama).
    const alien = await fetch(base + '/api/agent/v1/models', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(alien.headers.get('access-control-allow-origin'), 'https://agent.tukuk.org');
  } finally { await close(); }
});

test('route: /v1/chat/completions memancarkan jawapan upstream + header provider', async () => {
  const saved = openai.chatWithRotation;
  openai.chatWithRotation = async () => ({
    ok: true, provider: 'groq', model: 'openai/gpt-oss-120b',
    response: new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const { base, close } = await startApp();
  try {
    const r = await fetch(base + '/api/agent/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-agent' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-agent-provider'), 'groq');
    const j = await r.json();
    assert.equal(j.choices[0].message.content, 'ok');
  } finally { openai.chatWithRotation = saved; await close(); }
});

test('route: kegagalan provider dipantau 4xx (tiada 5xx)', async () => {
  const saved = openai.chatWithRotation;
  openai.chatWithRotation = async () => ({ ok: false, status: 409, error: 'no provider', rejected: [] });
  const { base, close } = await startApp();
  try {
    const r = await fetch(base + '/api/agent/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-agent' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(r.status, 409);
    assert.ok(r.status < 500);
  } finally { openai.chatWithRotation = saved; await close(); }
});

test('route: /build memanggil mcp tukuk_agent; goal kosong -> 400', async () => {
  const saved = mcp.handle;
  mcp.handle = async (name, args) => ({ content: [{ type: 'text', text: name + ':' + args.goal }] });
  const { base, close } = await startApp();
  try {
    const bad = await fetch(base + '/api/agent/build', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-agent' },
      body: JSON.stringify({}),
    });
    assert.equal(bad.status, 400);

    const ok = await fetch(base + '/api/agent/build', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-agent' },
      body: JSON.stringify({ goal: 'snake game', kind: 'game' }),
    });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.ok, true);
    assert.equal(j.result.content[0].text, 'tukuk_agent:snake game');
  } finally { mcp.handle = saved; await close(); }
});
