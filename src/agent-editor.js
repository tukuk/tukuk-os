'use strict';
// Proksi terbalik Tukuk Agent EDITOR: tukuk.org/agent/* → 127.0.0.1:8443/*.
//
// Kenapa bukan subdomain agent.tukuk.org? Token API di pelayan tidak punya
// izin Cloudflare Tunnel, dan laluan dashboard tidak disentuh — jadi editor
// dinaung dalam TUNNEL SEDIA ADA melalui applikasi ini. code-server dijalankan
// dengan --abs-proxy-base-path /agent. Prefix /agent DIBUANG sebelum forward ke
// upstream (route dalaman code-server di '/'); Location redirect ditulis semula
// supaya browser kekal di bawah /agent/.
//
// autentikasi = code-server sendiri (--auth password; kuki diuruskan olehnya).
// Gerbang admin BUKAN di sini kerana subresource pelayar (JS/CSS/WS) tidak
// boleh memikul token Bearer — hanya kuki code-server yang berfungsi.
//
// WebSocket: middleware Express tidak melihat 'upgrade' — attachUpgrade()
// dipanggil di index.js pada http server sebenar; dia cuma sentuh permintaan
// yang berimbuh /agent dan meninggalkan upgrade lain (SSE chat dsb.) aman.

const http = require('node:http');

const PREFIX = '/agent';

function upstreamOf(config) {
  return String((config.agentEditor && config.agentEditor.upstream) || '');
}

/** Header untuk upstream: host ditulis semula + isyarat proxy standard. */
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
// agent-editor.js — proksi balik untuk Tukuk Agent (code-server) yang berjalan di
// 127.0.0.1:8443 dengan --abs-proxy-base-path /agent.
//
// code-server hanya pakai prefix /agent untuk menjana URL dalam HTML (href, WS URL).
// Route dalaman Express tetap di '/' — maka '/agent/login' perlu dihantar sebagai
// '/login' ke upstream. Kita buang PREFIX sebelum forward.

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
        // code-server buat redirect ke '/' (tanpa prefix kerana route dalaman di '/').
        // Tulis-semula Location supaya browser kekal di bawah /agent/.
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
    // express.json/urlencoded sudahconsume req — gunakan rawBody jika ada.
    // Jika tiada (GET, HEAD, multipart, dll), pipe secara normal.
    if (req.rawBody && req.rawBody.length) preq.end(req.rawBody);
    else req.pipe(preq);
  });
}

/**
 * Proksi WebSocket 'ws' code-server (path /agent/...). Dipasang pada http
 * server sebenar; pemanggil dapat fungsi detach untuk ujian/kebersihan.
 * @param {import('node:http').Server} server
 * @param {{config: object}} deps
 */
function attachUpgrade(server, { config }) {
  const onUpgrade = (req, clientSocket, head) => {
    const target = upstreamOf(config);
    if (!target || !req.url || !req.url.startsWith(PREFIX)) return; // bukan editor — biarkan listener lain
    // Buang prefix /agent daripada URL penuh (ws URL browser bermula /agent/...).
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
