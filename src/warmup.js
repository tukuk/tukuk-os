'use strict';
// ── BOOT WARM-UP: pay the cold cache once, at 04:30, not per visitor ────────────
//
// Every deploy restarts Node, and a restart empties the in-process caches that make the
// expensive pages cheap. Measured after the 24 Oct 2026 restart: /nasa/sounds took 13.6 s
// and /academy/body 8.3 s for whoever arrived first — and then 0.68 s and 0.86 s for
// everyone after them. The pages were never broken; they were just cold, at exactly the
// moment nobody was watching.
//
// So after the listener is up we walk a short list of the pages that are expensive on a
// cold render, sequentially, and throw the bytes away. The cost is one render per page
// per restart; the benefit is that the first real visitor gets the warm path.
//
// Deliberate choices:
//   • Sequential with a gap, never in parallel — this is a 4 GB box coming back from a
//     restart, and eight simultaneous upstream calls is how a restart becomes an outage.
//   • A per-request deadline, so one wedged page cannot hold the queue open forever.
//   • Anonymous and same-origin (127.0.0.1), with the public Host header, so nothing is
//     rendered referring to 127.0.0.1 and no visitor IP is ever involved.
//   • Fail-soft: a warm-up that fails is worth a log line, never an exception.
const http = require('http');

// Chosen from measured cold renders, not from a sitemap: these are the pages that cost
// seconds on the first hit after a restart.
const DEFAULT_PATHS = [
  '/',
  '/holidays/2026',
  '/holidays/long-weekends',
  // /nasa is the most expensive page on the box: 12.8 s cold, 0.44 s warm.
  '/nasa',
  '/nasa/earth',
  '/nasa/iss',
  '/nasa/sounds',
  '/academy/body',
  '/weather/map',
];

const PER_REQUEST_MS = 15000;
const GAP_MS = 750;
// A page slower than this on a cold render is worth naming in the log: the list above
// should be tuned from measurements, not from guesses about what looks heavy.
const SLOW_MS = 2000;
const MAX_PATHS = 24;
const UA = 'TukukOS-Warmup/1.0 (+https://tukuk.org)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Work out what to warm, from the environment.
 * @param {Record<string,string|undefined>} [env]
 * @param {number} [port] the port this process is actually listening on
 * @returns {{base:string,paths:string[],host:string}|null} null = warm-up disabled
 */
function plan(env = process.env, port = 3000) {
  if (String(env.WARMUP || '').trim() === '0') return null;
  const base = String(env.WARMUP_BASE || `http://127.0.0.1:${port}`).trim();
  const custom = String(env.WARMUP_PATHS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    base,
    paths: (custom.length ? custom : DEFAULT_PATHS).slice(0, MAX_PATHS),
    host: String(env.WARMUP_HOST || 'tukuk.org').trim(),
  };
}

/**
 * One page, rendered and discarded.
 * @returns {Promise<number>} HTTP status, or 0 if it never answered
 */
function hit(url, { host, timeoutMs = PER_REQUEST_MS, ua = UA } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (status) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    let req;
    // A header whose value is `undefined` makes http.get throw instead of sending the
    // request, so the Host header is only added when there is one to add.
    const headers = { 'User-Agent': ua, Accept: 'text/html' };
    if (host) headers.Host = host;
    try {
      req = http.get(String(url), { headers }, (res) => {
        // We want the render, not the payload — drain it so the response can finish.
        res.on('end', () => done(res.statusCode));
        res.on('error', () => done(0));
        res.resume();
      });
    } catch {
      done(0);
      return;
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      done(0);
    });
    req.on('error', () => done(0));
  });
}

/**
 * Walk the list. Never rejects.
 * @returns {Promise<{ok:number,total:number,results:Array<{path:string,status:number}>}>}
 */
async function start({ base, paths, host, delayMs = GAP_MS, timeoutMs = PER_REQUEST_MS, slowMs = SLOW_MS, log = console.log } = {}) {
  if (!base || !Array.isArray(paths) || !paths.length) return { ok: 0, total: 0, results: [] };
  const startedAt = Date.now();
  const results = [];
  for (const p of paths) {
    const at = Date.now();
    const status = await hit(new URL(p, base), { host, timeoutMs });
    results.push({ path: p, status, ms: Date.now() - at });
    if (delayMs) await sleep(delayMs);
  }
  const ok = results.filter((r) => r.status >= 200 && r.status < 400).length;
  log(`[warmup] ${ok}/${results.length} pages warm in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  const cold = results.filter((r) => !(r.status >= 200 && r.status < 400));
  if (cold.length) log(`[warmup] not warm: ${cold.map((c) => `${c.path} (${c.status || 'no answer'})`).join(', ')}`);
  const slow = results.filter((r) => r.ms >= slowMs);
  if (slow.length) log(`[warmup] expensive: ${slow.map((r) => `${r.path} ${r.ms}ms`).join(', ')}`);
  return { ok, total: results.length, results };
}

module.exports = { plan, start, hit, DEFAULT_PATHS, PER_REQUEST_MS, GAP_MS, SLOW_MS };
