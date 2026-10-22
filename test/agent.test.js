'use strict';
// Tests for the Tukuk Agent: src/brain/openai-compat.js (rotation + the 4xx mapping) and
// src/agent.js (the OpenAI-compatible proxy + /build + auth/CORS) over loopback HTTP.
// No real network — fetch/provider/mcp are stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const provider = require('../src/brain/provider');
const openai = require('../src/brain/openai-compat');
const agent = require('../src/agent');
const mcp = require('../mcp/server');

// ── Stub the OpenAI providers without touching the real store/env ────────────
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

test('chatWithRotation: no OpenAI provider -> 409 (not 5xx)', () => withProviders([], async () => {
  const out = await openai.chatWithRotation({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.ok(out.status < 500, 'pasti 4xx supaya tepi tak topeng mod sandaran');
}));

test('chatWithRotation: empty messages -> 400', () => withProviders([groq], async () => {
  const out = await openai.chatWithRotation({ messages: [] });
  assert.equal(out.status, 400);
}));

test('chatWithRotation: a successful provider -> ok, the model is forced to the provider model', () => withProviders([groq], async () => {
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
  assert.equal(seenBody.model, 'openai/gpt-oss-120b', 'the client model is mapped to the real model');
  assert.ok(Array.isArray(seenBody.tools), 'tools diteruskan utuh');
}));

test('chatWithRotation: all 429 -> 429; not a quota -> 424', () => withProviders([groq, or], async () => {
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
  assert.ok(n.rejected.length >= 2, 'the rejected list is filled');
}));

// ── openaiProviders(): filtering tool-blind providers + the ollama-cloud mapping ──
test('openaiProviders: litert (tool-blind) is dropped from the agent rotation', () => withProviders([
  groq,
  { name: 'litert', kind: 'openai', baseUrl: 'http://127.0.0.1:8090/v1', key: 'edge', model: 'gemma3-1b' },
], async () => {
  const names = openai.openaiProviders().map((p) => p.name);
  assert.deepEqual(names, ['groq'], 'litert must not show up on /api/agent/v1');
}));

test('openaiProviders: ollama-cloud is mapped into the OpenAI /v1 shape', () => withProviders([
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

test('the fast rotation: the provider model maps to a light model when fast=true', () => withProviders([groq], async () => {
  let seenBody;
  const fetchImpl = async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await openai.chatWithRotation(
    { model: 'tukuk-agent-fast', messages: [{ role: 'user', content: 'x' }] },
    { fetchImpl, fast: true }
  );
  assert.equal(out.ok, true);
  assert.equal(seenBody.model, 'openai/gpt-oss-20b', 'groq → model kilat');
  assert.equal(out.model, 'openai/gpt-oss-20b', 'header X-Agent-Model ikut model sebenar');
}));

test('the fast rotation: a provider rejecting the fast model (404) → falls back to the normal model, not cooling', () => withProviders([groq], async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const b = JSON.parse(opts.body);
    calls.push(b.model);
    return b.model === 'openai/gpt-oss-20b'
      ? new Response('model not found', { status: 404 })
      : new Response('{"choices":[]}', { status: 200 });
  };
  const out = await openai.chatWithRotation(
    { model: 'tukuk-agent-fast', messages: [{ role: 'user', content: 'x' }] },
    { fetchImpl, fast: true }
  );
  assert.equal(out.ok, true, 'the normal model rescued the request');
  assert.deepEqual(calls, ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
}));

test('/models advertises tukuk-agent + tukuk-agent-fast', () => {
  const ids = openai.listModels().map((m) => m.id);
  assert.deepEqual(ids, ['tukuk-agent', 'tukuk-agent-fast']);
});

// ── A full loopback HTTP run for src/agent.js ──────────────────────────────
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

test('route: /v1/models without a token -> 401, with a token -> the tukuk-agent list', async () => {
  const { base, close } = await startApp();
  try {
    assert.equal((await fetch(base + '/api/agent/v1/models')).status, 401, 'tanpa auth ditolak');
    const ok = await fetch(base + '/api/agent/v1/models', { headers: { Authorization: 'Bearer secret-agent' } });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.data[0].id, 'tukuk-agent');
  } finally { await close(); }
});

test('the free tier: freeToken is accepted on /models; a wrong token still gets 401', async () => {
  const { base, close } = await startApp();
  try {
    const free = await fetch(base + '/api/agent/v1/models', { headers: { Authorization: 'Bearer free-public' } });
    assert.equal(free.status, 200, 'penanda free tier layak ke /models');
    const bogus = await fetch(base + '/api/agent/v1/models', { headers: { Authorization: 'Bearer teka-pecah' } });
    assert.equal(bogus.status, 401, 'an unknown token does not slip through');
  } finally { await close(); }
});

test('the free tier: the client max_tokens is clamped to freeMaxTokens before the rotation', async () => {
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

    // A full token (the admin token) is NOT clamped.
    await fetch(base + '/api/agent/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-agent' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], max_tokens: 200000 }),
    });
    assert.equal(seenBody.max_tokens, 200000, 'the full tier is not clamped');
  } finally { openai.chatWithRotation = saved; await close(); }
});

test('CORS: a tukuk.org subdomain (the Builder) is echoed even when AGENT_ORIGIN differs', async () => {
  const { base, close } = await startApp({ origin: 'https://agent.tukuk.org' });
  try {
    const pre = await fetch(base + '/api/agent/v1/models', {
      method: 'OPTIONS',
      headers: { Origin: 'https://build.tukuk.org', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://build.tukuk.org');
    // A foreign origin that is not tukuk.org → still config.agent.origin (the old behaviour).
    const alien = await fetch(base + '/api/agent/v1/models', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(alien.headers.get('access-control-allow-origin'), 'https://agent.tukuk.org');
  } finally { await close(); }
});

test('route: the `-fast` model reaches the rotation with the fast=true flag', async () => {
  const saved = openai.chatWithRotation;
  let seenOpts;
  openai.chatWithRotation = async (body, opts) => {
    seenOpts = opts;
    return {
      ok: true, provider: 'groq', model: 'openai/gpt-oss-20b',
      response: new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } }),
    };
  };
  const { base, close } = await startApp();
  try {
    await fetch(base + '/api/agent/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-agent' },
      body: JSON.stringify({ model: 'tukuk-agent-fast', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(seenOpts.fast, true, 'the `-fast` suffix is folded into the rotation flag');
  } finally { openai.chatWithRotation = saved; await close(); }
});

test('route: /v1/chat/completions streams the upstream answer + the provider headers', async () => {
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

test('route: a provider failure is mapped to 4xx (never 5xx)', async () => {
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

test('route: /build calls the mcp tukuk_agent; an empty goal -> 400', async () => {
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
