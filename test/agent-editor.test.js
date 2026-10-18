'use strict';
// Ujian proksi editor Tukuk Agent (src/agent-editor.js): penghantaran HTTP
// (prefix DIBUANG sebelum forward — code-server berjalan pada '/'; x-forwarded-prefix
// tetap dihantar + Location ditulis semula ke /agent/*), ralat mesra bila
// upstream mati, dan relay WebSocket 'upgrade' yang hanya menyentuh path /agent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const agentEditor = require('../src/agent-editor');

/** Upstream code-server palsu: gema url/header & layan upgrade WebSocket mentah. */
function startFakeEditor() {
  const up = http.createServer((req, res) => {
    res.setHeader('x-echo-url', req.url);
    res.setHeader('x-echo-host', req.headers.host || '');
    res.setHeader('x-echo-prefix', req.headers['x-forwarded-prefix'] || '');
    res.setHeader('x-echo-xff', req.headers['x-forwarded-for'] || '');
    res.end('UP:' + req.method);
  });
  up.on('upgrade', (req, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'upgrade: websocket\r\nconnection: upgrade\r\n' +
      'sec-websocket-accept: FAKE123\r\n\r\n' +
      'FRAME-DARI-EDITOR'
    );
  });
  return new Promise((resolve) => up.listen(0, '127.0.0.1', () => resolve({ up, port: up.address().port })));
}

function buildApp(upstream) {
  const app = express();
  const config = { agentEditor: { upstream } };
  agentEditor.mount(app, { config });
  return { app, config };
}

/** Pantau semua soket TCP masuk (termasuk upgrade) supaya tiada yang tertinggal. */
function trackSockets(srv) {
  const set = new Set();
  srv.on('connection', (s) => { set.add(s); s.on('close', () => set.delete(s)); });
  return () => { for (const s of set) s.destroy(); set.clear(); };
}

const get = (port, path) =>
  new Promise((resolve, reject) => {
    http
      .get({ port, path }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on('error', reject);
  });

test('proxy HTTP: kekalkan prefix /agent, tulis host + header proxy', async () => {
  const { up, port: upPort } = await startFakeEditor();
  const { app, config } = buildApp('http://127.0.0.1:' + upPort);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const killSockets = trackSockets(server), killUp = trackSockets(up);

  const r = await get(port, '/agent/login?windowId=_blank');
  assert.equal(r.status, 200);
  assert.equal(r.body, 'UP:GET');
  assert.equal(r.headers['x-echo-url'], '/login?windowId=_blank'); // prefix dibuang (kelakuan 4447109)
  assert.equal(r.headers['x-echo-host'], '127.0.0.1:' + upPort);
  assert.equal(r.headers['x-echo-prefix'], '/agent');
  assert.equal(r.headers['x-echo-xff'], '127.0.0.1');

  killSockets(); killUp();
  server.close(); server.closeAllConnections();
  up.close(); up.closeAllConnections();
});

test('upstream mati → 502 JSON jujur; upstream kosong → 503', async () => {
  const { app } = buildApp('http://127.0.0.1:1'); // port mati
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const r = await get(server.address().port, '/agent/');
  assert.equal(r.status, 502);
  assert.match(r.body, /Editor agent tidak bersedia/);
  server.close(); server.closeAllConnections();

  const { app: app2 } = buildApp('');
  const s2 = app2.listen(0, '127.0.0.1');
  await new Promise((r2) => s2.once('listening', r2));
  const r503 = await get(s2.address().port, '/agent/');
  assert.equal(r503.status, 503);
  s2.close(); s2.closeAllConnections();
});

test('attachUpgrade: relay 101 untuk /agent; upgrade lain tidak diganggu', async () => {
  const { up, port: upPort } = await startFakeEditor();
  const { app, config } = buildApp('http://127.0.0.1:' + upPort);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const killSockets = trackSockets(server), killUp = trackSockets(up);

  // penanda: listener LAIN masih dapat upgrade bukan-/agent (handler kita return awal)
  let otherSaw = false;
  server.on('upgrade', (req) => { if (req.url === '/other') otherSaw = true; });
  const detach = agentEditor.attachUpgrade(server, { config });

  const wsResult = await new Promise((resolve, reject) => {
    const req = http.request({
      port,
      path: '/agent/ws-test',
      headers: { connection: 'upgrade', upgrade: 'websocket', 'sec-websocket-key': 'k1' }
    });
    req.on('upgrade', (res, socket, head) => {
      assert.equal(res.statusCode, 101);
      assert.equal(res.headers['sec-websocket-accept'], 'FAKE123');
      if (head && head.length && head.toString().includes('FRAME-DARI-EDITOR')) {
        resolve(true); socket.destroy(); return;
      }
      socket.on('data', (d) => {
        if (d.toString().includes('FRAME-DARI-EDITOR')) { resolve(true); socket.destroy(); }
      });
      socket.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(4000, () => reject(new Error('timeout upgrade')));
    req.end();
  });
  assert.equal(wsResult, true);

  // upgrade bukan-/agent: proksi kita TIDAK makan handshake — listener lain yang respon
  const other = await new Promise((resolve, reject) => {
    const req = http.request({
      port,
      path: '/other',
      headers: { connection: 'upgrade', upgrade: 'websocket', 'sec-websocket-key': 'k2' }
    });
    req.on('upgrade', () => resolve('salah — proksi tak patut relay /other'));
    req.on('response', (res) => { res.resume(); resolve('plain'); });
    req.on('error', () => resolve('dropped'));
    req.setTimeout(1500, () => { req.destroy(); resolve('timeout'); });
    req.end();
  });
  assert.ok(otherSaw || other === 'dropped' || other === 'plain' || other === 'timeout', 'upgrade asing dibiarkan');
  assert.notEqual(other, 'salah — proksi tak patut relay /other');

  detach();
  killSockets(); killUp();
  server.close(); server.closeAllConnections();
  up.close(); up.closeAllConnections();
});
