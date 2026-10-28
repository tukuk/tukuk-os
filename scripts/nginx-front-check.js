'use strict';
/*
 * Checks for the nginx front proxy, run ON THE SERVER against a port that is really
 * listening. Nothing here is mocked: a page is fetched through the proxy, fetched again,
 * and fetched straight from the origin, and the three must agree.
 *
 * It lives in scripts/, not test/, on purpose: `npm test` must stay runnable on any laptop,
 * and this file only means something next to a live nginx (it also reads /etc/nginx/conf.d,
 * so it is run with sudo). It was under data/ first, which is git-ignored — a harness that
 * cannot be committed is a harness that gets lost, and this one is the only thing standing
 * between a config edit and a silent no-op cache.
 *
 *   sudo node scripts/nginx-front-check.js [frontPort] [originPort]
 *
 * frontPort 8080 = the verification pass (proxy beside production, origin still 3000).
 * frontPort 3000 = after `install-tukuk-front.sh cut` (origin moved to 3001).
 * The origin defaults to the other one of 3000/3001, so the same command works in both phases.
 *
 * Why each group exists: the cache is the reason for the change, and the four "silent
 * breakage" classes a front proxy introduces are what could make it a mistake —
 * something cached that should not be, headers lost, the visitor's IP/collapsing to one
 * bucket, and streams buffering.
 */
const http = require('http');
const net = require('net');
const crypto = require('crypto');

const FRONT = Number(process.argv[2] || 8080);
const ORIGIN = Number(process.argv[3] || (FRONT === 3000 ? 3001 : 3000));
// The cacheable public hub this harness probes. It used to be /bendera; the Indonesian→English
// route rename in src/server.js turned that into a permanent 301, and a 301 can never carry a
// lease — so seven checks went red on a box whose cache was working perfectly. /flags is the live
// path. The redirect is asserted on its own merits further down instead of being probed as if it
// were a page, because "the front must not eat a redirect" is a real question and "why does this
// 301 have no X-Accel-Expires" is not.
const HUB = '/flags';
const HUB_404 = `${HUB}/not-a-real-flag-xyz`;
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

// Which differences between a proxied response and a direct one are LEGITIMATE, so that
// "nothing was lost" can be demanded without pretending a proxy is a transparent cable:
//  · hop-by-hop headers belong to one connection and must not be forwarded (RFC 9110 §7.6),
//    so Node's Keep-Alive correctly stops here;
//  · nginx identifies itself, and adds HSTS because it tells Node the request came over
//    https (the tunnel does the same thing for real visitors) — both are additions, not losses.
const HOP_BY_HOP = ['keep-alive', 'connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization'];
const NGINX_ADDS = ['server', 'strict-transport-security'];
// Two of them are clocks: they are allowed to differ because the requests were not made in
// the same instant. (If a cached answer's Date ever drifted a page-length of time, that would
// be a real bug — but it is not something a value comparison can see between two fetches.)
const TIME_DEPENDENT = ['date', 'age'];
function headerParity(proxied, origin) {
  const p = clean(proxied.headers);
  const o = clean(origin.headers);
  const skip = new Set([...HOP_BY_HOP, ...TIME_DEPENDENT]);
  const lost = Object.keys(o).filter((k) => !(k in p) && !skip.has(k));
  const extra = Object.keys(p).filter((k) => !(k in o) && !NGINX_ADDS.includes(k) && !skip.has(k));
  const changed = Object.keys(o).filter((k) => k in p && o[k] !== p[k] && !skip.has(k));
  return {
    ok: lost.length === 0 && extra.length === 0 && changed.length === 0,
    detail: `lost=${lost.join(',') || 'none'} added=${extra.join(',') || 'none'} changed=${changed.join(',') || 'none'} (hop-by-hop, Date/Age, and nginx's own ${NGINX_ADDS.join('/')} excluded by design)`,
  };
}

/** One request. `firstChunkOnly` stops at the first byte of body — that is how a
 *  buffered stream is told apart from an unbuffered one without downloading a song. */
function get({ port = FRONT, method = 'GET', path = '/', headers = {}, body = null, firstChunkOnly = false, timeoutMs = 25000 }) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, timeout: timeoutMs }, (res) => {
      let ttfb = null;
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        if (ttfb === null) ttfb = Date.now() - t0;
        chunks.push(c);
        size += c.length;
        if (firstChunkOnly) { res.destroy(); }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), size, ttfb: ttfb ?? Date.now() - t0 }));
      res.on('close', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), size, ttfb: ttfb ?? Date.now() - t0, closedEarly: true }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}
const cacheStatus = (r) => String(r.headers['x-cache-status'] || '');
// X-Accel-* headers are nginx's private instruction channel: nginx acts on them and does
// not forward them, so they cannot appear in a parity comparison with the origin response.
const clean = (headers) => {
  const o = {};
  for (const [k, v] of Object.entries(headers)) if (k !== 'x-cache-status' && !k.startsWith('x-accel-')) o[k] = v;
  return o;
};

(async () => {
  console.log(`front 127.0.0.1:${FRONT} → origin 127.0.0.1:${ORIGIN}\n`);

  // ─────────────── 0. is there even a proxy on that port? ───────────────
  let probe;
  try { probe = await get({ path: '/health' }); } catch (e) {
    console.log(`HARNESS ERROR: cannot reach 127.0.0.1:${FRONT} — ${e.message}`);
    process.exit(2);
  }
  check('the front port answers at all', probe.status === 200, `health ${probe.status}`);
  check('it identifies itself as the proxy (every response carries X-Cache-Status)',
    cacheStatus(probe) !== '', `'${cacheStatus(probe)}'`);
  const direct = await get({ port: ORIGIN, path: '/health' }).catch(() => null);
  check('the origin port answers too, so MISS/HIT can be compared against the app itself',
    direct && direct.status === 200, direct ? `${direct.status}` : 'unreachable');

  // ─────────────── A. the cache, for real ───────────────
  // Three different kinds of public page: a data-driven detail page, a tool page, and the
  // hub that lists them — all under a cacheable prefix, all rendered per request today.
  // Plus the root (the busiest single render on the box) and the local APOD archive, which
  // is the entry to the ±11,000-date cluster and reads only the on-disk store (no NASA quota
  // involved, so the check cannot go red because NASA is having a bad minute).
  const PAGES = [HUB, '/alat/unit', '/blog', '/', '/nasa/archive'];
  for (const p of PAGES) {
    const a = await get({ path: p, headers: { 'Accept-Encoding': 'identity' } });
    const b = await get({ path: p, headers: { 'Accept-Encoding': 'identity' } });
    const o = await get({ port: ORIGIN, path: p, headers: { 'Accept-Encoding': 'identity' } });
    check(`${p}: the app marks it cacheable (X-Accel-Expires is the whole contract)`,
      o.status === 200 && o.headers['x-accel-expires'] === '300' && a.status === 200,
      `origin status ${o.status} x-accel-expires=${o.headers['x-accel-expires']}`);
    check(`${p}: nginx consumed that instruction instead of leaking it to the browser`,
      a.headers['x-accel-expires'] === undefined, `client sees ${String(a.headers['x-accel-expires'])}`);
    check(`${p}: the browser-facing policy is still max-age=0 (a view is never stale)`,
      /max-age=0/.test(String(a.headers['cache-control'])) && /s-maxage=300/.test(String(a.headers['cache-control'])),
      String(a.headers['cache-control']));
    check(`${p}: the second request is served from the cache, not rendered again`,
      cacheStatus(b) === 'HIT', `first ${cacheStatus(a)} → second ${cacheStatus(b)}`);
    check(`${p}: the cached bytes are identical to what the app rendered`,
      b.size === o.size && sha(b.body) === sha(o.body), `${b.size} vs ${o.size} bytes ${sha(b.body)}/${sha(o.body)}`);
    check(`${p}: the app's headers all survive the hop`, headerParity(b, o).ok, headerParity(b, o).detail);
    check(`${p}: a cached answer is quicker than a rendered one`, b.ttfb <= a.ttfb + 5, `${a.ttfb} ms → ${b.ttfb} ms`);
  }

  // ─────────── B. what must NEVER be served from the cache ───────────
  const never = [
    ['= /health (the watchdog reads this; a cached ok would hide a broken app)', '/health'],
    ['/trending (live counts, and it sends NO cache headers at all — the construction, not the header, must protect it)', '/trending'],
    ['/api/models (no-store)', '/api/models'],
    ['/stats (the page says the numbers are live)', '/stats'],
    ['/gempa (a live reading)', '/gempa'],
    ['/cari?q=… (a search)', '/cari?q=test'],
    ['/nasa/iss/live.json (a live reading that a client polls; no-store is explicit)', '/nasa/iss/live.json'],
    // THE other drift case, and the one that a prefix list would have got wrong: this page
    // sits INSIDE the now-cacheable /nasa prefix, but the app re-reads its telemetry every
    // 12 seconds on purpose, so the route overrides the policy to no-store itself.
    ['/nasa/iss ("right now" — the app re-reads it every 12 s, so a 5-minute copy is 25x too stale)', '/nasa/iss'],
    // THE drift case, measured rather than assumed: this slug 404s INSIDE the cacheable
    // /flags prefix, and the middleware has already put the public policy on the response
    // by the time the route answered. Only the withheld lease keeps it out of the cache.
    ['a 404 under a cacheable prefix', HUB_404],
  ];
  for (const [label, path] of never) {
    const a = await get({ path });
    const b = await get({ path });
    check(`${label} is never a cache hit`, !['HIT', 'STALE'].includes(cacheStatus(b)) && !['HIT', 'STALE'].includes(cacheStatus(a)),
      `${cacheStatus(a)} → ${cacheStatus(b)} (status ${b.status})`);
  }
  const studioOrigin = await get({ port: ORIGIN, path: HUB_404 });
  check('…and for that 404 it is the APP that withholds the lease, not a rule in nginx',
    studioOrigin.status === 404 && studioOrigin.headers['x-accel-expires'] === undefined
      && /s-maxage=300/.test(String(studioOrigin.headers['cache-control'])),
    `origin status ${studioOrigin.status} x-accel-expires=${studioOrigin.headers['x-accel-expires']} cache-control=${String(studioOrigin.headers['cache-control']).slice(0, 40)}…`);
  const liveJson = await get({ port: ORIGIN, path: '/nasa/iss/live.json' });
  check('a route that overrode Cache-Control to no-store gets no lease either',
    /no-store/.test(String(liveJson.headers['cache-control'])) && liveJson.headers['x-accel-expires'] === undefined,
    `cache-control=${liveJson.headers['cache-control']} x-accel-expires=${liveJson.headers['x-accel-expires']}`);
  const issDirect = await get({ port: ORIGIN, path: '/nasa/iss' });
  check('the ISS HTML opts itself back out of a cacheable prefix (the app decides, prefix inclusions do not)',
    /no-store/.test(String(issDirect.headers['cache-control'])) && issDirect.headers['x-accel-expires'] === undefined,
    `${issDirect.status} cache-control=${String(issDirect.headers['cache-control']).slice(0, 12)} x-accel-expires=${issDirect.headers['x-accel-expires']}`);
  const apodToday = await get({ port: ORIGIN, path: '/nasa' });
  check('the APOD page is leased when NASA answered and NOT leased when it 5xxs (no cached outage)',
    apodToday.status === 200 ? apodToday.headers['x-accel-expires'] === '300'
      : apodToday.headers['x-accel-expires'] === undefined,
    `${apodToday.status} x-accel-expires=${apodToday.headers['x-accel-expires']}`);
  // The cache key carries the query string, so two different URLs must never share one copy
  // — otherwise /nasa/sky?a=1 could serve someone else's /nasa/sky?b=2 for five minutes.
  // The probe value is unique per run on purpose: a run that reused last run's key would
  // start on a HIT and the check would read as a failure of the cache rather than of the run.
  const pKey = `harness-${Date.now()}`;
  const qa1 = await get({ path: `/nasa/sky?probe=${pKey}a`, headers: { 'Accept-Encoding': 'identity' } });
  const qb1 = await get({ path: `/nasa/sky?probe=${pKey}b`, headers: { 'Accept-Encoding': 'identity' } });
  const qa2 = await get({ path: `/nasa/sky?probe=${pKey}a`, headers: { 'Accept-Encoding': 'identity' } });
  check('a different query string is a different cached object, never a reuse of the first',
    cacheStatus(qa1) !== 'HIT' && cacheStatus(qb1) !== 'HIT' && cacheStatus(qa2) === 'HIT',
    `first ${cacheStatus(qa1)} → other key ${cacheStatus(qb1)} → first again ${cacheStatus(qa2)}`);
  const redir = await get({ port: ORIGIN, path: '/bendera', headers: { Accept: 'text/html' } });
  check('a redirect or error never carries the lease either (only a real 2xx render does)',
    redir.status === 301 && /\/flags$/.test(String(redir.headers.location || ''))
      && redir.headers['x-accel-expires'] === undefined,
    `${redir.status} → ${redir.headers.location} x-accel-expires=${redir.headers['x-accel-expires']}`);
  const headReq = await get({ method: 'HEAD', path: '/alat/unit' });
  check('a HEAD of a cacheable page is answered like the GET (200, same policy)',
    headReq.status === 200 && /s-maxage=300/.test(String(headReq.headers['cache-control'])),
    `${headReq.status} ${String(headReq.headers['cache-control']).slice(0, 30)}…`);

  const nf = await get({ path: HUB_404 });
  const nf2 = await get({ path: HUB_404 });
  check('a 404 is not cached (an unknown slug must 404 again, not forever)',
    nf.status === 404 && nf2.status === 404 && !['HIT', 'STALE'].includes(cacheStatus(nf2)),
    `${nf.status}/${cacheStatus(nf)} then ${nf2.status}/${cacheStatus(nf2)}`);

  // Poisoning: an authenticated-looking request must not replace what anonymous visitors get.
  // Two halves, because a public page is 200 whether or not a bogus token is present — what
  // matters is that credentials keep it out of the shared cache. On a route that actually
  // requires them, a cached copy would be a private answer handed to a stranger.
  const before = await get({ path: HUB, headers: { 'Accept-Encoding': 'identity' } });
  const authed = await get({ path: HUB, headers: { Authorization: 'Bearer deliberately-not-a-token' } });
  const withCookie = await get({ path: HUB, headers: { Cookie: 'session=abc' } });
  const after = await get({ path: HUB, headers: { 'Accept-Encoding': 'identity' } });
  const adminDirect = await get({ port: ORIGIN, path: '/api/admin/status', headers: { Authorization: 'Bearer deliberately-not-a-token' } });
  const adminFrontA = await get({ path: '/api/admin/status', headers: { Authorization: 'Bearer deliberately-not-a-token' } });
  const adminFrontB = await get({ path: '/api/admin/status', headers: { Authorization: 'Bearer deliberately-not-a-token' } });
  check('a public page with a bogus token is served correctly but kept out of the cache',
    authed.status === 200 && !['HIT', 'STALE'].includes(cacheStatus(authed)), `${authed.status} ${cacheStatus(authed)}`);
  check('a route that really does require a token still refuses through the proxy, and is never stored',
    adminFrontA.status === adminDirect.status && adminFrontA.status === 401
      && !['HIT', 'STALE'].includes(cacheStatus(adminFrontA)) && !['HIT', 'STALE'].includes(cacheStatus(adminFrontB)),
    `origin ${adminDirect.status} front ${adminFrontA.status}/${cacheStatus(adminFrontA)} → ${cacheStatus(adminFrontB)}`);
  check('a Cookie is not answered from the cache either',
    withCookie.status === 200 && !['HIT', 'STALE'].includes(cacheStatus(withCookie)), `${withCookie.status} ${cacheStatus(withCookie)}`);
  check('neither of them put anything into the shared copy',
    sha(before.body) === sha(after.body) && cacheStatus(after) === 'HIT', `${sha(before.body)} vs ${sha(after.body)} ${cacheStatus(after)}`);
  const post = await get({ method: 'POST', path: HUB, headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('a POST is not cached and not turned into a page',
    !['HIT', 'STALE'].includes(cacheStatus(post)), `${post.status} ${cacheStatus(post)}`);

  // ─────────── C. the four things a proxy breaks quietly ───────────
  const noProto = await get({ path: '/about' });
  const https = await get({ path: '/about', headers: { 'X-Forwarded-Proto': 'https' } });
  check('HSTS still reaches visitors (Node only sends it when it sees https)',
    Boolean(noProto.headers['strict-transport-security']) && Boolean(https.headers['strict-transport-security']),
    `no-header:${noProto.headers['strict-transport-security'] || 'ABSENT'} https:${https.headers['strict-transport-security'] || 'ABSENT'}`);
  for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
    check(`the ${h} header survives the hop`, Boolean(noProto.headers[h]), String(noProto.headers[h]).slice(0, 28) + '…');
  }
  const www = await get({ path: '/stats', headers: { Host: 'www.tukuk.org' } });
  check('www is still 301’d to the apex (Host is passed through, not swallowed)',
    www.status === 301 && String(www.headers.location).startsWith('https://tukuk.org/stats'), `${www.status} → ${www.headers.location}`);
  const tchat = await get({ path: '/', headers: { Host: 'tchat.tukuk.org' } });
  const apex = await get({ path: '/', headers: { Host: 'tukuk.org' } });
  check('a different hostname gets a different answer (the tunnel serves several hosts here)',
    tchat.status !== apex.status || sha(tchat.body) !== sha(apex.body),
    `tchat ${tchat.status}/${tchat.size}b vs apex ${apex.status}/${apex.size}b`);
  // The messenger's own origin is the one place where a shared copy would be a privacy
  // problem, so the app withholds its lease by overwriting the offered policy (src/server.js
  // → the TCHAT_HOST gate). nginx has no rule about it — these three lines are the proof.
  check('tchat / answers the chat app, not the blog list',
    tchat.status === 200 && /T Chat|chat/i.test(tchat.body.slice(0, 4000)), `${tchat.status} ${tchat.size}b`);
  const tchat2 = await get({ path: '/', headers: { Host: 'tchat.tukuk.org' } });
  check('…and it is never held in the shared cache (no lease, so nothing to store)',
    tchat.headers['x-accel-expires'] === undefined && !['HIT', 'STALE'].includes(cacheStatus(tchat2)),
    `lease=${tchat.headers['x-accel-expires'] || 'ABSENT'} second read ${cacheStatus(tchat2)}`);
  check('the private-space headers survive the hop (noindex + frame-ancestors none)',
    /noindex/.test(String(tchat.headers['x-robots-tag']))
      && /frame-ancestors 'none'/.test(String(tchat.headers['content-security-policy'])),
    `robots="${String(tchat.headers['x-robots-tag']).slice(0, 24)}"`);
  const tchatAway = await get({ path: '/bendera', headers: { Host: 'tchat.tukuk.org' } });
  check('a path T Chat does not serve is 302’d back to tukuk.org, not answered from here',
    tchatAway.status === 302 && String(tchatAway.headers.location).startsWith('https://tukuk.org/bendera'),
    `${tchatAway.status} → ${tchatAway.headers.location}`);

  // The visitor's identity: Node buckets rate limits on the FIRST X-Forwarded-For entry.
  // If nginx replaced the header instead of appending, every visitor would share one bucket
  // and the site would start answering 429 for unrelated people — invisible until it happens.
  const IP1 = '203.0.113.7';
  const IP2 = '203.0.113.8';
  const r1 = await get({ path: '/trending', headers: { 'X-Forwarded-For': IP1 } });
  const r2 = await get({ path: '/trending', headers: { 'X-Forwarded-For': IP1 } });
  const r3 = await get({ path: '/trending', headers: { 'X-Forwarded-For': IP2 } });
  const rem = (r) => Number(r.headers['x-ratelimit-remaining']);
  check('the rate limiter is counting per visitor, not per proxy',
    Number.isFinite(rem(r1)) && Number.isFinite(rem(r2)) && rem(r2) === rem(r1) - 1 && rem(r3) === rem(r1),
    `${IP1}: ${rem(r1)}→${rem(r2)}  ${IP2}: ${rem(r3)}`);

  // Streams must stream. /radio/stream pipes external audio through the app for as long as
  // a listener stays; buffered, it would stall. Compare time-to-first-byte through the proxy
  // against the same request direct on the origin — a buffered proxy shows up as a large gap.
  const streamPath = '/radio/stream?url=https%3A%2F%2Fstream.zeno.fm%2F6n6ewddtad0uv';
  // Three samples each way, alternating. One pair cannot tell "the proxy buffered it" apart
  // from "the radio station answered slowly that second" — the median of three can.
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const pairs = [];
  for (let i = 0; i < 3; i++) {
    const f = await get({ path: streamPath, firstChunkOnly: true, timeoutMs: 20000 }).catch((e) => ({ error: e.message }));
    const o = await get({ port: ORIGIN, path: streamPath, firstChunkOnly: true, timeoutMs: 20000 }).catch((e) => ({ error: e.message }));
    pairs.push({ f, o });
  }
  const sFront = pairs[pairs.length - 1].f;
  const sOrigin = pairs[pairs.length - 1].o;
  const fTtfb = med(pairs.map((x) => x.f.ttfb));
  const oTtfb = med(pairs.map((x) => x.o.ttfb));
  const sameAnswer = pairs.every((x) => x.f.status === x.o.status);
  const streaming = sFront.status && sFront.status < 400 && sFront.size > 0;
  check('the radio stream behaves through the proxy exactly as it does on the origin (no buffering stall)',
    sameAnswer && (!streaming || fTtfb <= oTtfb * 2 + 400),
    `median first-byte front ${fTtfb}ms vs origin ${oTtfb}ms; status front ${pairs.map((x) => x.f.status)} origin ${pairs.map((x) => x.o.status)}; bytes ${sFront.size}/${sOrigin.size}`);
  check('…and the proxy does not cache it',
    !['HIT', 'STALE'].includes(cacheStatus(sFront)), pairs.map((x) => cacheStatus(x.f)).join('/'));

  // /agent/ is a WebSocket upgrade handled by Node’s own server. Whatever code-server
  // answers (101, or 401 for the password), the proxy must answer the SAME thing.
  // A box without the builder installed has no upstream at all: src/agent-editor.js then
  // refuses the upgrade with its own 503, on every port, and that agreement is the proxy
  // working — not the proxy inventing a gateway error. The case this check exists for is the
  // opposite one: the origin handshakes (101) while the front answers 5xx, i.e. the Upgrade
  // headers were eaten on the hop.
  const wsAsk = (port) => new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = '';
    s.setTimeout(8000);
    s.on('connect', () => s.write('GET /agent/ HTTP/1.1\r\nHost: tukuk.org\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
    s.on('data', (d) => { buf += d.toString('latin1'); s.destroy(); });
    s.on('timeout', () => { s.destroy(); resolve('TIMEOUT'); });
    s.on('close', () => resolve(buf.split('\r\n')[0] || 'EMPTY'));
    s.on('error', () => resolve('ERR'));
  });
  const wsO = await wsAsk(ORIGIN);
  const wsF = await wsAsk(FRONT);
  const bothRefused = wsF === wsO && / 50[0-9]/.test(wsF);
  check('the WebSocket upgrade is forwarded, not eaten (proxy status == origin status)',
    wsF === wsO && (!/50[0-9]/.test(wsF) || bothRefused),
    `origin "${wsO}" front "${wsF}"${bothRefused ? ' — no editor upstream here, so both refuse identically; install the builder to turn this into a 101' : ''}`);

  // A too-small client_max_body_size would show up as 413 on the builder’s publish route.
  // Judged against the same request sent straight to the origin: the app may reject the body
  // (it has no valid token) and that is fine — what must not happen is nginx deciding first.
  const big = Buffer.alloc(3 * 1024 * 1024, 'a');
  const bigBody = Buffer.concat([Buffer.from('{"html":"'), big, Buffer.from('","token":"not-a-token"}')]);
  const opts = { method: 'POST', path: '/api/publish', headers: { 'Content-Type': 'application/json', 'Content-Length': String(bigBody.length) }, body: bigBody };
  const up = await get(opts);
  const upO = await get({ ...opts, port: ORIGIN });
  check('a 3 MB publish body gets past the proxy (refused by the app, not by nginx)',
    up.status !== 413 && up.status === upO.status, `front ${up.status} vs origin ${upO.status}`);

  // ─────────── D. the shipped config’s own promises ───────────
  const fs = require('fs');
  const confRaw = fs.readFileSync('/etc/nginx/conf.d/tukuk-front.conf', 'utf8');
  // Comments are not directives: the file explains at length why there is no fallback TTL,
  // so the string has to be looked for in the live config, not in the prose about it.
  const conf = confRaw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  check('there is NO fallback TTL: only a response the app marks gets cached',
    !/proxy_cache_valid/.test(conf) && /proxy_ignore_headers Cache-Control Expires;/.test(conf), '');
  check('the nginx version is not published (server_tokens off)', /server_tokens off;/.test(conf), 'the Server header still says "nginx", which it always does; only the version is withheld');
  check('the cache key includes the hostname (one nginx serves tukuk/tchat/dashboard)',
    /proxy_cache_key "\$scheme\$host\$request_uri"/.test(conf), '');
  check('the origin is never retried (a retry would replay a POST body)', /proxy_next_upstream off;/.test(conf), '');
  for (const loc of ['location = /health', 'location /api/', 'location /radio/', 'location /agent/']) {
    check(`${loc} exists and skips the cache`, new RegExp(loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,240}proxy_cache off;').test(conf), '');
  }
  const srcRaw = fs.existsSync('/opt/tukuk-os/deploy/nginx/tukuk-front.conf')
    ? fs.readFileSync('/opt/tukuk-os/deploy/nginx/tukuk-front.conf', 'utf8') : confRaw;
  const srcConf = srcRaw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  check('the file in git listens on the verification port, never on production',
    /listen 127\.0\.0\.1:8080;/.test(srcConf) && !/listen 127\.0\.0\.1:3000;/.test(srcConf),
    'a git pull cannot put nginx in front of the site');
  check('and it keeps both loopback families (cloudflared dials "localhost")',
    /listen \[::1\]:/.test(srcConf), '');

  const failed = results.filter((x) => !x.pass);
  console.log('\n' + (failed.length ? `${failed.length} FAILED of ${results.length}:\n  ` + failed.map((f) => f.name).join('\n  ') : `ALL ${results.length} PASS (nginx front, port ${FRONT})`));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.log('HARNESS ERROR: ' + err.message); process.exit(2); });
