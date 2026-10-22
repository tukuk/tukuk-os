/**
 * agent.js — the face of Tukuk Agent (AI build-agent) for the Tukuk-OS server.
 *
 * Two surfaces:
 *   1. OpenAI-compatible PROXY  (/api/agent/v1/chat/completions, /models) —
 *      called directly by the agent extension (Cline/Kilo) inside Tukuk Agent.
 *      Full passthrough of `messages`+`tools`+`stream` to the cloud rotation (openai-compat.js).
 *   2. Headless BUILD           (/api/agent/build) — one call → files + syntax
 *      checks through the `tukuk_agent` tool on the MCP server (/builder + store can use it).
 *
 * CORS: the *.tukuk.org origins (Tukuk Builder) + config.agent.origin are allowed.
 * Auth: Bearer AGENT_TOKEN, OR Bearer AGENT_FREE_TOKEN (free tier with a strict
 * limit for Tukuk Builder), OR the admin passkey session (auth.requireAdmin).
 * FAILURES are always 4xx — the tukuk.org edge turns any 5xx into fallback mode.
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

  // Free tier (Tukuk Builder) — a STRICTER rate cap, separate cache-key prefix.
  const freeLimiter = rateLimit
    ? rateLimit({ windowMs: 60 * 1000, max: config.agent.freeMaxPerMin, keyPrefix: 'agentfree:' })
    : (req, res, next) => next();

  // Pick the limiter by tier (requireAgent sets req.agentFree first).
  const tierLimiter = (req, res, next) => (req.agentFree ? freeLimiter : limiter)(req, res, next);

  // ── CORS: the Tukuk Agent origin (config.agent.origin) + any tukuk.org subdomain
  //    (Tukuk Builder at build.tukuk.org calls this proxy from the browser) ──
  app.use(`${PREFIX}/v1`, (req, res, next) => {
    const origin = req.get('origin') || '';
    const isTukukHost = /^https?:\/\/([a-z0-9-]+\.)*tukuk\.org$/i.test(origin);
    const allow = isTukukHost ? origin : (config.agent.origin || origin);
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', allow);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // ── Auth: AGENT_TOKEN (bearer) OR the free-tier marker OR an admin session ──
  function requireAgent(req, res, next) {
    const token = auth.bearer(req);
    if (config.agent.token && safeEqual(token, config.agent.token)) return next();
    if (config.agent.freeToken && safeEqual(token, config.agent.freeToken)) {
      req.agentFree = true;
      return next();
    }
    // No token matched → let the admin door (passkey session) try; it 401s if it fails.
    return auth.requireAdmin(req, res, next);
  }

  // ── GET /v1/models ──
  app.get(`${PREFIX}/v1/models`, requireAgent, (req, res) => {
    res.json({ object: 'list', data: openai.listModels() });
  });

  // ── POST /v1/chat/completions (passthrough + rotation + stream) ──
  app.post(`${PREFIX}/v1/chat/completions`, requireAgent, tierLimiter, async (req, res) => {
    // Free tier: clamp max_tokens so one request can't drain the
    // provider's cloud quota (our rotation is the one paying for it).
    if (req.agentFree && req.body) {
      const cap = config.agent.freeMaxTokens;
      if (cap && (!Number.isFinite(req.body.max_tokens) || req.body.max_tokens > cap)) {
        req.body.max_tokens = cap;
      }
    }
    let out;
    // A `-fast` model id (e.g. tukuk-agent-fast) → map to the provider's lightweight model.
    const wantFast = String((req.body && req.body.model) || '').endsWith('-fast');
    try {
      out = await openai.chatWithRotation(req.body || {}, { timeoutMs: config.agent.timeoutMs, fast: wantFast });
    } catch (error) {
      // An unexpected error INSIDE the proxy → 4xx too (never 500; the edge would mask it).
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
    // Pipe the raw upstream bytes (SSE stream OR JSON) — both pass through untouched.
    res.writeHead(status, headers);
    if (upstream.body && typeof upstream.body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of upstream.body) {
        res.write(Buffer.from(chunk));
      }
      return res.end();
    }
    // Non-streaming body: read it as text.
    const text = await upstream.text().catch(() => '');
    return res.end(text);
  });

  // ── POST /build (headless; the tukuk_agent tool on MCP) ──
  app.post(`${PREFIX}/build`, requireAgent, tierLimiter, async (req, res) => {
    const goal = String((req.body && req.body.goal) || '').trim().slice(0, 300);
    const kind = String((req.body && req.body.kind) || 'app').trim().slice(0, 20);
    if (!goal) return res.status(400).json({ error: 'Field "goal" is required.' });
    try {
      // Required lazily so the main process doesn't attach readline/stdin (mcp only runs
      // main() when require.main === module — safe to require here).
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
