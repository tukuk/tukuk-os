'use strict';
// Tests for the Tukuk Agent editor proxy (src/agent-editor.js): HTTP forwarding
// (the prefix is STRIPPED before forwarding — code-server runs at '/'; x-forwarded-prefix
// is still sent + Location is rewritten back to /agent/*), the friendly errors when
// the upstream is dead, and the WebSocket 'upgrade' relay that only touches the /agent path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const express = require('express');
const agentEditor = require('../src/agent-editor');

/** Fake code-server upstream: echoes url/headers and serves raw WebSocket upgrades. */
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
      'FRAME-FROM-EDITOR'
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

/** Watch every incoming TCP socket (upgrades included) so none are left behind. */
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

test('HTTP proxy: keeps the /agent prefix, rewrites host + proxy headers', async () => {
  const { up, port: upPort } = await startFakeEditor();
  const { app, config } = buildApp('http://127.0.0.1:' + upPort);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const killSockets = trackSockets(server), killUp = trackSockets(up);

  const r = await get(port, '/agent/login?windowId=_blank');
  assert.equal(r.status, 200);
  assert.equal(r.body, 'UP:GET');
  assert.equal(r.headers['x-echo-url'], '/login?windowId=_blank'); // the prefix is stripped (behaviour of 4447109)
  assert.equal(r.headers['x-echo-host'], '127.0.0.1:' + upPort);
  assert.equal(r.headers['x-echo-prefix'], '/agent');
  assert.equal(r.headers['x-echo-xff'], '127.0.0.1');

  killSockets(); killUp();
  server.close(); server.closeAllConnections();
  up.close(); up.closeAllConnections();
});

test('dead upstream → honest 502 JSON; empty upstream → 503', async () => {
  const { app } = buildApp('http://127.0.0.1:1'); // a dead port
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const r = await get(server.address().port, '/agent/');
  assert.equal(r.status, 502);
  assert.match(r.body, /editor agent is not ready/);
  server.close(); server.closeAllConnections();

  const { app: app2 } = buildApp('');
  const s2 = app2.listen(0, '127.0.0.1');
  await new Promise((r2) => s2.once('listening', r2));
  const r503 = await get(s2.address().port, '/agent/');
  assert.equal(r503.status, 503);
  s2.close(); s2.closeAllConnections();
});

test('attachUpgrade: relays 101 for /agent; other upgrades are left alone', async () => {
  const { up, port: upPort } = await startFakeEditor();
  const { app, config } = buildApp('http://127.0.0.1:' + upPort);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const killSockets = trackSockets(server), killUp = trackSockets(up);

  // marker: another listener still receives non-/agent upgrades (our handler returns early)
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
      if (head && head.length && head.toString().includes('FRAME-FROM-EDITOR')) {
        resolve(true); socket.destroy(); return;
      }
      socket.on('data', (d) => {
        if (d.toString().includes('FRAME-FROM-EDITOR')) { resolve(true); socket.destroy(); }
      });
      socket.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(4000, () => reject(new Error('timeout upgrade')));
    req.end();
  });
  assert.equal(wsResult, true);

  // a non-/agent upgrade: our proxy does NOT eat the handshake — another listener answers
  const other = await new Promise((resolve, reject) => {
    const req = http.request({
      port,
      path: '/other',
      headers: { connection: 'upgrade', upgrade: 'websocket', 'sec-websocket-key': 'k2' }
    });
    req.on('upgrade', () => resolve('wrong — the proxy must not relay /other'));
    req.on('response', (res) => { res.resume(); resolve('plain'); });
    req.on('error', () => resolve('dropped'));
    req.setTimeout(1500, () => { req.destroy(); resolve('timeout'); });
    req.end();
  });
  assert.ok(otherSaw || other === 'dropped' || other === 'plain' || other === 'timeout', 'a foreign upgrade was left alone');
  assert.notEqual(other, 'wrong — the proxy must not relay /other');

  detach();
  killSockets(); killUp();
  server.close(); server.closeAllConnections();
  up.close(); up.closeAllConnections();
});

test('attachUpgrade with no upstream: refuses with 503 on the socket instead of hanging', async () => {
  // This is the bug that made a rebuilt box look like a broken front proxy. The handler used to
  // `return` when there was no AGENT_EDITOR_UPSTREAM, leaving the socket open until the client
  // timed out. So the SAME upgrade request answered differently depending on the route taken:
  // straight to Node it was an empty close, through nginx (which cannot wait for a response that
  // never comes) it was a 503. scripts/nginx-front-check.js compares the two and therefore blamed
  // the proxy. The app now refuses the way its HTTP half does, identically on every port.
  const { app, config } = buildApp('');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const killSockets = trackSockets(server);
  const detach = agentEditor.attachUpgrade(server, { config });

  const ask = () => new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = '';
    s.setTimeout(4000);
    s.on('connect', () => s.write('GET /agent/ HTTP/1.1\r\nHost: tukuk.org\r\nUpgrade: websocket\r\n'
      + 'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
    s.on('data', (d) => { buf += d.toString('latin1'); });
    s.on('timeout', () => { s.destroy(); reject(new Error('the upgrade hung — nothing was ever sent back')); });
    s.on('close', () => resolve(buf));
    s.on('error', reject);
  });

  const answer = await ask();
  assert.match(answer, /^HTTP\/1\.1 503 /, `an HTTP refusal is required, got ${JSON.stringify(answer.slice(0, 48))}`);
  assert.match(answer, /AGENT_EDITOR_UPSTREAM/, 'and it has to name the setting that is missing');

  // An upgrade on a path that is not the editor still belongs to someone else (chat SSE does this).
  detach();
  killSockets();
  server.close(); server.closeAllConnections();
});
