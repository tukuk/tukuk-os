/**
 * agent.js — Luka Tukuk Agent (AI build-agent) untuk server Tukuk-OS.
 *
 * Dua permukaan:
 *   1. PROXY OpenAI-compatible  (/api/agent/v1/chat/completions, /models) —
 *      dipanggil terus oleh pelanjutan agen (Cline/Kilo) dalam Tukuk Agent.
 *      Passthrough penuh `messages`+`tools`+`stream` ke rotasi cloud (openai-compat.js).
 *   2. BUILD kepala-tanpa       (/api/agent/build) — satu panggilan → fail + semakan
 *      sintaks via alat `tukuk_agent` pada pelayan MCP (/builder + store boleh guna).
 *
 * CORS: asal Tukuk Agent (config.agent.origin) dibenarkan memanggil tukuk.org.
 * Auth: Bearer AGENT_TOKEN, ATAU sesi passkey admin (auth.requireAdmin).
 * KEGAGALAN sentiasa 4xx — tepi tukuk.org menukar sebarang 5xx kepada mod sandaran.
 */
const crypto = require('crypto');
const openai = require('./brain/openai-compat');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function mount(app, deps) {
  const { auth, rateLimit, config, store } = deps;
  const PREFIX = '/api/agent';

  const limiter = rateLimit
    ? rateLimit({ windowMs: 60 * 1000, max: config.agent.maxPerMin, keyPrefix: 'agent:' })
    : (req, res, next) => next();

  // ── CORS untuk pelanjutan agen (berbeza asal bila di-host agent.tukuk.org) ──
  app.use(`${PREFIX}/v1`, (req, res, next) => {
    const allow = config.agent.origin || req.get('origin') || '';
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', allow);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // ── Auth: AGENT_TOKEN (bearer) atau sesi admin ──
  function requireAgent(req, res, next) {
    const token = auth.bearer(req);
    if (config.agent.token && safeEqual(token, config.agent.token)) return next();
    // Tiada padanan token → biar pintu admin (passkey sesi) cuba; ia 401 jika gagal.
    return auth.requireAdmin(req, res, next);
  }

  // ── GET /v1/models ──
  app.get(`${PREFIX}/v1/models`, requireAgent, (req, res) => {
    res.json({ object: 'list', data: openai.listModels() });
  });

  // ── POST /v1/chat/completions (passthrough + rotasi + stream) ──
  app.post(`${PREFIX}/v1/chat/completions`, requireAgent, limiter, async (req, res) => {
    let out;
    try {
      out = await openai.chatWithRotation(req.body || {}, { timeoutMs: config.agent.timeoutMs });
    } catch (error) {
      // Ralat tak dijangka DALAM proxy → 4xx juga (jangan 500; tepi akan topeng).
      return res.status(424).json({ error: 'Agent proxy failed', details: String(error && error.message || error) });
    }

    if (!out.ok) {
      return res.status(out.status).json({ error: out.error, rejected: out.rejected });
    }

    const upstream = out.response;
    const status = upstream.status;
    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'X-Agent-Provider': out.provider,
      'X-Agent-Model': out.model,
      'Cache-Control': 'no-cache',
    };
    // Paip bayangan mentah (SSE stream ATAU JSON) — kedua-duanya lalu tanpa diubah.
    res.writeHead(status, headers);
    if (upstream.body && typeof upstream.body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of upstream.body) {
        res.write(Buffer.from(chunk));
      }
      return res.end();
    }
    // Riwayat badan tanpa stream (fetch tanpa body).
    const text = await upstream.text().catch(() => '');
    return res.end(text);
  });

  // ── POST /build (kepala-tanpa; alat tukuk_agent pada MCP) ──
  app.post(`${PREFIX}/build`, requireAgent, limiter, async (req, res) => {
    const goal = String((req.body && req.body.goal) || '').trim().slice(0, 300);
    const kind = String((req.body && req.body.kind) || 'app').trim().slice(0, 20);
    if (!goal) return res.status(400).json({ error: 'Field "goal" is required.' });
    try {
      // Dimuat lewat supaya proses utama tak pasang readline/stdin (mcp hanya main()
      // bila require.main === module — selamat di-require di sini).
      const mcp = require('../mcp/server');
      const payload = await mcp.handle('tukuk_agent', { goal, kind });
      if (store) store.event('agent', `Build (${kind}): ${goal.slice(0, 60)}`, { kind, goal });
      res.json({ ok: true, goal, kind, result: payload });
    } catch (error) {
      res.status(424).json({ error: 'Build failed', details: String(error && error.message || error) });
    }
  });
}

module.exports = { mount };
