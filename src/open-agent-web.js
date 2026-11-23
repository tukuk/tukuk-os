/**
 * src/open-agent-web.js — Web Ejen Terbuka / Open Agent Web
 *
 * Menukarkan tukuk.org kepada "Web Ejen Terbuka": laman web yang boleh didapati,
 * dicari, dibaca dan diakui oleh apa-apa agen AI di web terbuka melalui HTTP JSON
 * yang mudah, plus panggilan alat MCP (Model Context Protocol) melalui HTTP.
 *
 * Dipasang di src/server.js melalui openAgentWeb.mount(app, { config, rateLimit }).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const { client } = require('./meili');
const rag = require('./brain/rag');
const mcp = require('../mcp/server');
const config = require('./config');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const index = client.index(config.indexName);

const PREFIX = '/api/open-agent';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-store'
  });
  res.end(s);
}

const buckets = new Map();
const WINDOW_MS = 60 * 1000;
function rateLimiter(maxPerWindow) {
  return (req, res, next) => {
    const key = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.reset > WINDOW_MS) { b = { count: 0, reset: now }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > maxPerWindow) {
      return json(res, 429, { error: 'Too many requests', retryAfterMs: Math.max(0, WINDOW_MS - (now - b.reset)) });
    }
    res.setHeader('X-RateLimit-Limit', maxPerWindow);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxPerWindow - b.count));
    next();
  };
}

// ── util: baca fail laman statik dan ambil teks (cheerio) ──
function readPage(safePath) {
  const resolved = path.resolve(PUBLIC_DIR, safePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) return null;
  if (!fs.existsSync(resolved)) return null;
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) return null;
  const html = fs.readFileSync(resolved, 'utf8');
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg').remove();
  let text = $('body').text() || $('html').text() || '';
  text = text.replace(/\s+/g, ' ').trim();
  const title = $('title').text().trim() || path.basename(safePath, '.html');
  const description = $('meta[name="description"]').attr('content') || '';
  return { url: safePath, title, description, text };
}

function pagePathFor(reqPath) {
  let p = String(reqPath || '').replace(/^\/+/, '').replace(/\/$/, '');
  if (!p) p = 'index.html';
  if (!p.endsWith('.html')) p = p + '.html';
  return p;
}

// ── Dapatkan semua laman statik untuk sitemap agen ──
function listStaticPages() {
  let files = [];
  try { files = fs.readdirSync(PUBLIC_DIR); } catch { return []; }
  const pages = [];
  for (const f of files) {
    if (!f.endsWith('.html')) continue;
    const meta = readPage(f);
    if (meta) pages.push({ path: '/' + f.replace('.html', ''), title: meta.title, description: meta.description });
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));
  return pages;
}

// ── GET /api/open-agent — manifest penemuan ──
function manifest(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  json(res, 200, {
    name: 'Tukuk-OS Open Agent Web (Web Ejen Terbuka)',
    version: '1.0.0',
    description:
      'Laman web terbuka untuk agen AI. Cari, baca laman, tanya soalan (RAG) dan panggil ' +
      'alat tukuk melalui HTTP JSON dan JSON-RPC (MCP-over-HTTP). Tiada akaun diperlukan.',
    baseUrl: (config.publicUrl || '').replace(/\/$/, '') || '(tetapkan env PUBLIC_URL)',
    endpoints: {
      'GET /api/open-agent': 'Manifest ini (penemuan)',
      'GET /api/open-agent/sitemap': 'Senarai semua laman laman web (agente boleh memetakan laman)',
      'GET /api/open-agent/search?q=...&limit=...': 'Cari indeks laman web (Meilisearch), kembali JSON',
      'GET /api/open-agent/page?path=...': 'Muat turun kandungan teks satu laman',
      'GET /api/open-agent/ask?q=...': 'Tanya soalan; jawapan RAG dengan sumber rujukan',
      'GET /api/open-agent/mcp': 'Senarai alat MCP (tools/list) melalui HTTP',
      'POST /api/open-agent/mcp': 'Panggil alat MCP (tools/call) melalui JSON-RPC 2.0'
    },
    example: {
      search: '/api/open-agent/search?q=malaysia%20weather',
      ask: '/api/open-agent/ask?q=apakah%20tukuk-os',
      mcpCall: { method: 'tools/call', params: { name: 'tukuk_search', arguments: { q: 'kerjaya IT' } } }
    },
    rateLimit: 'Terbuka tetapi tertakluk kepada rate-limit (lihat header X-RateLimit-*)'
  });
}

// ── GET /api/open-agent/sitemap ──
async function sitemap(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  try {
    const pages = listStaticPages();
    json(res, 200, { ok: true, count: pages.length, pages });
  } catch (err) {
    json(res, 503, { ok: false, error: 'Sitemap tidak boleh dibina', details: String(err.message || err) });
  }
}

// ── GET /api/open-agent/search ──
async function search(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  if (!q) return json(res, 400, { ok: false, error: 'Parameter "q" diperlukan' });
  try {
    const found = await index.search(q, { limit, attributesToCrop: ['content'], cropLength: 300 });
    const hits = (found.hits || []).map((h) => ({
      url: h.url, title: h.title, siteName: h.siteName,
      description: h.description || '',
      snippet: (h._formatted && h._formatted.content ? h._formatted.content : '').replace(/<[^>]*>/g, '').slice(0, 300)
    }));
    json(res, 200, { ok: true, query: q, total: found.estimatedTotalHits ?? hits.length, processingTimeMs: found.processingTimeMs, hits });
  } catch (err) {
    json(res, 424, { ok: false, error: 'Carian gagal', details: String(err.message || err) });
  }
}

// ── GET /api/open-agent/page ──
function page(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const safePath = pagePathFor(req.query.path);
  const meta = readPage(safePath);
  if (!meta) return json(res, 404, { ok: false, error: 'Laman tidak dijumpai', path: req.query.path });
  json(res, 200, { ok: true, ...meta });
}

// ── GET /api/open-agent/ask ──
async function ask(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const q = String(req.query.q || '').trim();
  if (!q) return json(res, 400, { ok: false, error: 'Parameter "q" diperlukan' });
  try {
    const answer = await rag.ask(q);
    json(res, 200, {
      ok: true, question: q,
      answer: answer.answer,
      sources: (answer.sources || []).map((s) => ({ ref: s.ref, title: s.title, url: s.url })),
      mode: answer.mode, model: answer.model, tookMs: answer.tookMs
    });
  } catch (err) {
    json(res, 424, { ok: false, error: 'RAG gagal', details: String(err.message || err) });
  }
}

// ── GET /api/open-agent/mcp — tools/list melalui HTTP ──
function mcpList(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const tools = (mcp.TOOLS || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  json(res, 200, { ok: true, protocol: 'JSON-RPC 2.0 over HTTP', tools });
}

// ── POST /api/open-agent/mcp — JSON-RPC tools/call (dan tools/list) ──
async function mcpCall(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let body;
  try { body = req.body || {}; } catch { body = {}; }
  const id = body.id !== undefined ? body.id : null;
  const method = String(body.method || '');
  const params = body.params || {};

  try {
    if (method === 'tools/list' || method === '') {
      const tools = (mcp.TOOLS || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
      return json(res, 200, { jsonrpc: '2.0', id, result: { tools } });
    }
    if (method === 'tools/call') {
      const name = String(params.name || '');
      const args = params.arguments || {};
      if (!name) return json(res, 400, { jsonrpc: '2.0', id, error: { code: -32602, message: 'params.name diperlukan' } });
      const result = await mcp.handle(name, args);
      return json(res, 200, { jsonrpc: '2.0', id, result });
    }
    return json(res, 404, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method tidak diketahui: ' + method } });
  } catch (err) {
    return json(res, 424, { jsonrpc: '2.0', id, error: { code: -32603, message: 'Panggilan alat gagal', data: String(err.message || err) } });
  }
}


// ── baca badan JSON mentah untuk POST /api/open-agent/mcp ──
function collectRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function mcpHandler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Gunakan POST' });
  let raw = '';
  try { raw = await collectRawBody(req); } catch { return json(res, 400, { ok: false, error: 'Badan tidak boleh dibaca' }); }
  let parsed;
  try { parsed = JSON.parse(raw || '{}'); } catch { return json(res, 400, { ok: false, error: 'JSON tidak sah' }); }
  req.body = parsed;
  return mcpCall(req, res);
}

// ── Mount ──
function mount(app, deps) {
  const { config: cfg, rateLimit } = deps || {};
  const useLimit = rateLimit || rateLimiter;

  // CORS preamble untuk semua endpoint /api/open-agent/*
  // Express 5 / path-to-regexp tidak terima '*' boleh tanpa parameter nama,
  // jadi setiap route handler set CORS sendiri (setCorsHeaders dipanggil dalam
  // semua handler atas). Tiada catch-all diperlukan di sini.

  const searchLimit = useLimit ? useLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'openagent:search:' }) : (req, res, next) => next();
  const readLimit = useLimit ? useLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'openagent:read:' }) : (req, res, next) => next();
  const mcpLimit = useLimit ? useLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'openagent:mcp:' }) : (req, res, next) => next();

  app.get(`${PREFIX}`, manifest);
  app.get(`${PREFIX}/sitemap`, readLimit, sitemap);
  app.get(`${PREFIX}/search`, searchLimit, search);
  app.get(`${PREFIX}/page`, readLimit, page);
  app.get(`${PREFIX}/ask`, searchLimit, ask);
  app.get(`${PREFIX}/mcp`, readLimit, mcpList);
  app.post(`${PREFIX}/mcp`, mcpLimit, mcpHandler);

  // Halaman pelarian manusia untuk Web Ejen Terbuka.
  app.get('/open-agent', (req, res) => {
    const html = `<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Web Ejen Terbuka — Tukuk-OS</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e9ef;margin:0;padding:24px} .wrap{max-width:720px;margin:0 auto} h1{margin:0 0 8px;font-size:1.5rem} .muted{color:#9aa3b2} pre{background:#171a21;border:1px solid #262b36;border-radius:8px;padding:14px;overflow:auto} a{color:#4c8dff} code{color:#ffd54a}</style></head><body><div class="wrap"><h1>🌐 Web Ejen Terbuka — Tukuk-OS</h1><p class="muted">Laman web terbuka untuk agen AI. Cari, baca laman, tanya soalan, dan panggil alat tukuk melalui HTTP JSON.</p><p>Endpoint:</p><ul><li><code>GET /api/open-agent</code> — manifest &amp; penemuan</li><li><code>GET /api/open-agent/sitemap</code> — semua laman laman web</li><li><code>GET /api/open-agent/search?q=...&amp;limit=10</code> — carian laman web</li><li><code>GET /api/open-agent/page?path=/about</code> — kandungan laman</li><li><code>GET /api/open-agent/ask?q=...amp;</code> — jawapan RAG dengan sumber</li><li><code>GET /api/open-agent/mcp</code> — senarai alat MCP (HTTP)</li><li><code>POST /api/open-agent/mcp</code> — panggil alat MCP (JSON-RPC)</li></ul><p>Contoh carian: <code>/api/open-agent/search?q=cuaca%20malaysia</code><br>Contoh panggilan alat (POST <code>/api/open-agent/mcp</code>):</p><pre>{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tukuk_search","arguments":{"q":"pekerjaan IT","limit":5}}}</pre><p class="muted">Terbuka untuk semua asal, tertakluk kepada rate-limit. Sumber terbuka (ISC).</p></div></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  console.log('[open-agent-web] Web Ejen Terbuka dipasang di', PREFIX);
}

module.exports = { mount, manifest, sitemap, search, page, ask, mcpList, mcpCall, PREFIX };
