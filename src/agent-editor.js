'use strict';
// Reverse proxy for the Tukuk Agent EDITOR: tukuk.org/agent/* → 127.0.0.1:8443/*.
//
// Why not an agent.tukuk.org subdomain? The API token on this server has no
// Cloudflare Tunnel permission, and the dashboard route must stay untouched — so the editor
// is hosted inside the EXISTING tunnel through this application. code-server is run
// with --abs-proxy-base-path /agent. The /agent prefix is REMOVED before forwarding to
// upstream (code-server's internal routes live at '/'); redirect Locations are rewritten
// so the browser stays under /agent/.
//
// authentication = code-server's own (--auth password; it manages the cookie).
// The admin gate is NOT here because browser subresources (JS/CSS/WS) cannot
// carry a Bearer token — only the code-server cookie works.
//
// WebSocket: Express middleware never sees 'upgrade' — attachUpgrade()
// is called in index.js on the real http server; it only touches requests
// that start with /agent and leaves other upgrades (chat SSE etc.) alone.

const http = require('node:http');

const PREFIX = '/agent';

function upstreamOf(config) {
  return String((config.agentEditor && config.agentEditor.upstream) || '');
}

/** Headers for upstream: host rewritten + the standard proxy hints. */
function forwardHeaders(reqHeaders, target) {
  const host = target.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return {
    ...reqHeaders,
    host,
    'x-forwarded-for': reqHeaders['x-forwarded-for'] || '127.0.0.1',
    'x-forwarded-proto': reqHeaders['x-forwarded-proto'] || 'https',
    'x-forwarded-prefix': PREFIX
  };
}

/**
 * @param {import('express').Express} app
 * @param {{config: object}} deps
 */
// agent-editor.js — reverse proxy for Tukuk Agent (code-server) running on
// 127.0.0.1:8443 with --abs-proxy-base-path /agent.
//
// code-server only uses the /agent prefix to generate URLs inside the HTML (href, WS URL).
// Express's internal routes stay at '/' — so '/agent/login' has to be sent as
// '/login' to upstream. We strip PREFIX before forwarding.

function mount(app, { config }) {
  app.use(PREFIX, (req, res) => {
    const target = upstreamOf(config);
    if (!target) {
      return res.status(503).json({ error: 'The editor agent is not configured (AGENT_EDITOR_UPSTREAM).' });
    }
    // Inside app.use('/agent', ...) req.url already has the prefix removed — use it as is.
    const upstreamPath = req.url || '/';
    const preq = http.request(
      target + upstreamPath,
      { method: req.method, headers: forwardHeaders(req.headers, target) },
      (up) => {
        const headers = Object.assign({}, up.headers);
        // code-server redirects to '/' (no prefix, because its internal routes are at '/').
        // Rewrite Location so the browser stays under /agent/.
        if ([301, 302, 303, 307, 308].includes(up.statusCode) && headers.location) {
          if (headers.location.startsWith('/')) {
            headers.location = PREFIX + headers.location;
          }
        }
        res.writeHead(up.statusCode || 502, headers);
        up.pipe(res);
      }
    );
    preq.on('error', () => {
      // tukuk-agent is not running yet — an honest 4xx/5xx; the edge worker only masks 5xx for HTML.
      if (!res.headersSent) res.status(502).json({ error: 'The editor agent is not ready — please try again in a moment.' });
      else res.end();
    });
    // express.json/urlencoded already consumed req — use rawBody when present.
    // When it isn't (GET, HEAD, multipart, etc.), pipe normally.
    if (req.rawBody && req.rawBody.length) preq.end(req.rawBody);
    else req.pipe(preq);
  });
}

/**
 * Reverse-proxies code-server's 'ws' WebSocket traffic (path /agent/...). Attached to the real
 * http server; the caller gets a detach function back for tests/cleanup.
 * @param {import('node:http').Server} server
 * @param {{config: object}} deps
 */
function attachUpgrade(server, { config }) {
  const onUpgrade = (req, clientSocket, head) => {
    const target = upstreamOf(config);
    if (!target || !req.url || !req.url.startsWith(PREFIX)) return; // not the editor — let other listeners handle it
    // Strip the /agent prefix from the full URL (the browser's ws URL starts with /agent/...).
    const stripped = req.url.slice(PREFIX.length) || '/';
    const p = http.request(target + stripped, { method: req.method, headers: forwardHeaders(req.headers, target) });
    p.on('upgrade', (pres, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${pres.statusCode || 101} ${pres.statusMessage || 'Switching Protocols'}`];
      for (const [k, v] of Object.entries(pres.headers)) {
        if (k === 'transfer-encoding') continue;
        lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
      }
      clientSocket.write(Buffer.from(lines.join('\r\n') + '\r\n\r\n'));
      if (upHead && upHead.length) clientSocket.write(upHead.slice());
      if (head && head.length) upSocket.write(head.slice());
      upSocket.pipe(clientSocket);
      clientSocket.pipe(upSocket);
      const bye = () => { upSocket.destroy(); clientSocket.destroy(); };
      upSocket.on('error', bye);
      clientSocket.on('error', bye);
      upSocket.on('close', () => clientSocket.destroy());
      clientSocket.on('close', () => upSocket.destroy());
    });
    p.on('error', () => clientSocket.destroy());
    p.end();
  };
  server.on('upgrade', onUpgrade);
  return () => server.off('upgrade', onUpgrade);
}

module.exports = { mount, attachUpgrade, forwardHeaders, PREFIX };
