#!/usr/bin/env node
/**
 * builder-wakekeeper.js — an always-on front door for the Tukuk Builder.
 *
 * WHY THIS EXISTS
 * The builder (tukuk-builder.service, a `vite preview` SSR app) is put to sleep after a few
 * idle hours by builder-idle-stop.sh to reclaim ~500 MB of RAM. While it sleeps, cloudflared
 * still answers at the edge but its origin — 127.0.0.1:5174 — refuses the connection, so the
 * visitor gets a raw Cloudflare 502 ("bad gateway"), which looks like an outage and is easy to
 * misread as a broken tunnel.
 *
 * WHAT THIS DOES
 * This tiny process owns port 5174 (the port cloudflared is configured to reach) and forwards
 * every request to the real builder on 127.0.0.1:5176. It is a transparent, streaming proxy:
 * HTTP bodies, Server-Sent-Events (the AI chat stream) and WebSocket upgrades all pass through
 * untouched, and the original Host header is preserved so Vite's allowedHosts (.tukuk.org) still
 * accepts the request. When the builder is asleep the upstream connection is refused, so instead
 * of failing we (a) ask systemd to start it and (b) serve a friendly "warming up" page that
 * reloads itself until the builder is listening again. The visitor never sees a 502.
 *
 * It uses only Node core modules — no install step, no dependency drift from the builder itself.
 *
 * ONE ORIGIN ONLY (and why)
 * The builder is served from build.tukuk.org and nowhere else. That was not always true: it used
 * to answer on dashboard.tukuk.org as well, where the apex app owns `/api/*` and `/admin`, so a
 * builder page served there called its OWN `/api/chat`, `/api/models`, `/api/configured-providers`
 * and got Tukuk-OS's answers (404 `{"error":"Route not found"}` or a different JSON shape), which
 * the client spread and crashed on ("TypeError: r is not iterable" -> "Application Error").
 * That hostname is retired; the redirect below stays as a guard for any FUTURE alias, because a
 * shared `/api` namespace fails the same way every time.
 *
 *   BUILDER_CANONICAL_HOST=build.tukuk.org   # where aliases are sent
 *   BUILDER_ALIAS_HOSTS=                     # comma list; empty (the default) disables the redirect
 */
'use strict';

const http = require('http');
const net = require('net');
const { execFile } = require('child_process');

const UP_HOST = process.env.BUILDER_UP_HOST || '127.0.0.1';
const UP_PORT = Number(process.env.BUILDER_UP_PORT || 5176); // the real builder
const LISTEN_PORT = Number(process.env.BUILDER_PORT || 5174); // what cloudflared reaches
const SERVICE = process.env.BUILDER_SERVICE || 'tukuk-builder';
const KICK_COOLDOWN_MS = 8000;   // never call `systemctl start` more than once per this window
const SLOW_WARN_MS = 45000;      // after this long still-down, hint that a redeploy may be needed

// Canonical origin + the hostnames that must be redirected to it (see the header above).
const CANONICAL_HOST = String(process.env.BUILDER_CANONICAL_HOST || 'build.tukuk.org').toLowerCase();
const ALIAS_HOSTS = String(process.env.BUILDER_ALIAS_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// Paths owned by the OTHER app that shares an alias hostname. They never reach this process
// (the edge routes them to :3000), but if a rule ever changes they must not be redirected into
// the builder either — a silent pass-through keeps the existing behaviour obvious.
const ALIAS_PASSTHROUGH = /^\/(?:api|admin)(?:\/|$|\?)/i;

let lastKickAt = 0;
let wakeStartedAt = 0; // when we first noticed the builder was down during this wake cycle

function log(...a) { console.log('[wakekeeper]', ...a); }

// Where (if anywhere) this request should be sent instead of the builder.
function aliasRedirectUrl(req) {
  if (!ALIAS_HOSTS.length) return null;
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!ALIAS_HOSTS.includes(host)) return null;
  if (ALIAS_PASSTHROUGH.test(req.url || '/')) return null;
  return 'https://' + CANONICAL_HOST + (req.url || '/');
}

// Ask systemd to start the builder. Fire-and-forget: the warming page keeps reloading, and the
// moment the builder binds 5176 the next proxied request succeeds. Coalesced so a burst of
// auto-reloads (or many visitors) triggers exactly one start attempt.
function kickBuilder() {
  const now = Date.now();
  if (!wakeStartedAt) wakeStartedAt = now;
  if (now - lastKickAt < KICK_COOLDOWN_MS) return;
  lastKickAt = now;
  log('builder not answering on :' + UP_PORT + ' -> systemctl start ' + SERVICE);
  execFile('systemctl', ['start', SERVICE], (err) => {
    if (err) log('systemctl start failed:', err.message);
  });
}

// A calm, on-brand holding page. It reloads itself so the visitor lands in the builder as soon
// as it is awake, without having to hit refresh.
function warmingHtml() {
  const slow = Date.now() - wakeStartedAt > SLOW_WARN_MS;
  const hint = slow
    ? 'This is taking longer than usual — the builder may need to be rebuilt (<code>scripts/deploy-builder.sh</code>).'
    : 'This only takes a few seconds.';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="3">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex">'
    + '<title>Tukuk Builder is waking up…</title><style>'
    + '*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'font:16px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e6e9ef;'
    + 'background:radial-gradient(1200px 600px at 50% -10%,#12203f,#05080f)}'
    + '.card{max-width:420px;text-align:center;padding:34px 28px;background:rgba(12,18,32,.72);'
    + 'border:1px solid #1e2b47;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.5)}'
    + '.spin{width:46px;height:46px;margin:0 auto 18px;border-radius:50%;'
    + 'border:3px solid #1e2b47;border-top-color:#4c8dff;animation:s 1s linear infinite}'
    + '@keyframes s{to{transform:rotate(360deg)}}'
    + 'h1{font-size:1.2rem;margin:0 0 8px}p{margin:0 0 6px;color:#9fb0cc;line-height:1.5}'
    + 'code{background:#0b1324;padding:1px 6px;border-radius:6px;color:#8fb8ff}'
    + '.b{font-weight:700;background:linear-gradient(135deg,#4c8dff,#7a5cff);-webkit-background-clip:text;'
    + 'background-clip:text;color:transparent}</style></head><body><div class="card">'
    + '<div class="spin"></div><h1><span class="b">Tukuk Builder</span> is waking up</h1>'
    + '<p>The builder was asleep to save memory. Bringing it back now.</p>'
    + '<p>' + hint + '</p><p style="margin-top:14px;color:#5f7095;font-size:.85rem">This page reloads automatically.</p>'
    + '</div></body></html>';
}

function serveWarming(req, res) {
  kickBuilder();
  const body = warmingHtml();
  res.writeHead(503, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const redirectTo = aliasRedirectUrl(req);
  if (redirectTo) {
    /*
     * 308, not 301: the method and body are preserved, so a stray POST ends up as the same
     * POST on the builder's own origin rather than being downgraded to a GET.
     */
    log('alias host -> ' + redirectTo);
    res.writeHead(308, {
      Location: redirectTo,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength('Moved to ' + redirectTo),
    });
    res.end('Moved to ' + redirectTo);
    return;
  }

  const proxyReq = http.request(
    { host: UP_HOST, port: UP_PORT, method: req.method, path: req.url, headers: req.headers },
    (proxyRes) => {
      // A real response means the builder is awake again — reset the wake timer.
      wakeStartedAt = 0;
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    // Connection refused / reset: builder is (re)starting. Fall back to the holding page unless
    // response bytes are already on the wire (a mid-stream failure we cannot paper over).
    if (res.headersSent) { res.destroy(); return; }
    if (err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT')) {
      serveWarming(req, res);
    } else {
      log('proxy error:', err && err.message);
      if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Bad gateway'); }
      else res.destroy();
    }
  });
  req.pipe(proxyReq);
});

// WebSockets (and any other upgrade) go through as a raw byte pipe. If the builder is asleep the
// socket is simply dropped — the page is reloading anyway, and it reconnects once the builder is up.
server.on('upgrade', (req, clientSocket, head) => {
  // An alias host cannot host a WebSocket for this builder either (its /api belongs elsewhere);
  // drop the socket and let the page reload onto the canonical origin.
  if (aliasRedirectUrl(req)) { clientSocket.destroy(); return; }

  const upstream = net.connect(UP_PORT, UP_HOST, () => {
    let raw = req.method + ' ' + req.url + ' HTTP/1.1\r\n';
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1] + '\r\n';
    raw += '\r\n';
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    wakeStartedAt = 0;
  });
  upstream.on('error', () => { kickBuilder(); clientSocket.destroy(); });
  clientSocket.on('error', () => upstream.destroy());
});

// Long-lived streams (SSE AI responses) must not be cut off by Node's default request timeout.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 65000;

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  log('front door on :' + LISTEN_PORT + ' -> builder :' + UP_PORT + ' (service ' + SERVICE + ')');
});
