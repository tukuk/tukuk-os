'use strict';
// ── The outbound guard: one choke point for every call to somebody else's computer ──────
//
// WHY THIS EXISTS (measured on the box, 23 Oct 2026, /var/log/nginx/tukuk-front.log):
//   2,845 requests held the server for 1,506 seconds. 25 of those requests (0.9%) took more
//   than five seconds and between them burned 283.9 of those seconds — 19% of every second the
//   box spent inside a request, for 1% of the traffic. Nine of the 25 were `/muzik/<country>`,
//   each held for *exactly* 15.00 s — the axios timeout in src/muzik.js — and then answered
//   503. A 503 is not cached (correctly: handProxyLease withholds the lease from a non-2xx),
//   so the next crawler hit pays the same 15 s again. Apple's feed is not actually slow from
//   here (1.0–3.0 s measured); what happens is one unlucky DNS answer handing out an Apple edge
//   address this network cannot reach (an IPv4-only retry timed out at 20 s while the default
//   path returned in 2.6 s). So a transient path problem becomes a permanent queue in front of
//   Node, and Node holds a socket, a request and a chunk of heap for each one.
//   The same 12–25 s timeouts sit in bacaan/cuti/explore/gempa/hidup/muzik/nasa/peta/seni.
//
// WHAT IT DOES, in order of how much each one buys:
//   1. DEADLINE  — one shorter, uniform budget per module (`budgetMs`), enforced as the socket
//      timeout so the connection is actually released instead of draining in the background,
//      which is the memory the box is paying for.
//   2. COOLDOWN  — after a failure the URL is refused instantly for a while, so an upstream
//      that is down costs ONE slow request, not one per visitor. Stale-beats-error logic in the
//      modules (fetchChart → cacheGet) is what makes the instant failure useful rather than just
//      fast: the page still shows yesterday's chart instead of a wall of 503s.
//   3. DEDUPE    — N concurrent identical calls share ONE upstream request. A crawler storm that
//      asks for /muzik/pl twenty times costs Apple twenty calls today; it should cost one.
//   4. CONCURRENCY — a cap on simultaneous upstream calls per module, so a storm cannot open
//      forty sockets and turn a slow upstream into a slow server for everybody else.
//
// WHAT IT DELIBERATELY DOES NOT DO: it does not cache success (each module owns its own TTL —
// muzik 24 h, nasa 2–12 h — because only the module knows how stale is acceptable), it does not
// rewrite errors (the same error object is rethrown so `err.notFound` and friends keep working),
// and it never guards a `responseType: 'stream'` call: two readers cannot share one stream, and
// a stream is by definition not a page render waiting on an answer.
//
// TWO MODULES ARE DELIBERATELY LEFT OUT: src/weather.js (a 429-driven 15-minute circuit breaker
// plus a daily call budget — its own outage policy, and a cooldown would stack a second one on
// top of it) and src/crawler.js (a per-domain politeness delay, a bounded worker pool and a queue
// cap that answers HTTP 429 back-pressure to the caller). Neither is in the measured tail: their
// declared timeouts are 8–10 s, not 12–25 s. NASA is half-in — guarded for dedupe and the socket
// ceiling, with `cooldownMs: 0` so its own deliberate three-attempt retry keeps working.
//
// HOW IT HOOKS: the axios *adapter*, which is the single function every request in a module
// instance goes through. That keeps the change in the modules to one line each instead of
// touching every call site, and it means a call site cannot accidentally skip the guard.
const axios = require('axios');

const DEFAULTS = {
  name: 'outbound',
  budgetMs: 15000,        // matches the timeouts the modules already declare, so attaching is safe
  cooldownMs: 120000,     // two minutes of "we just failed, do not try again" per URL
  maxConcurrent: 8,       // generous: this only bites during a storm, never on a normal page view
};

// Every guard that has been attached, so one call can report what the box has been waiting for.
// The counters are the evidence that a deadline or a cooldown is actually firing rather than the
// guard being decorative, so they are published on `/health` (the machine-health report the
// watchdog and scripts/weight-report.sh read from localhost) and deliberately NOT on the public
// `/stats` page, which is a visitor-facing transparency page about the search index.
const GUARDED = [];

function keyOf(config) {
  const base = config.baseURL || '';
  const url = config.url || '';
  const params = config.params && typeof config.params === 'object'
    ? '?' + Object.entries(config.params).map(([k, v]) => `${k}=${v}`).sort().join('&')
    : '';
  return `${base}${url}${params}`;
}

/**
 * Wrap an axios instance's adapter with the guard.
 *
 * @param {object} instance the module's own axios.create(...) result
 * @param {{name?: string, budgetMs?: number, cooldownMs?: number, maxConcurrent?: number}} opts
 * @returns {{stats: object, reset: function}} stats for the weight report, reset for tests
 */
function attachGuard(instance, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const builtIn = axios.getAdapter(instance.defaults.adapter);
  const inflight = new Map();   // url key -> Promise (the ONE call everybody shares)
  const cooling = new Map();    // url key -> epoch ms until which a retry is refused
  let busy = 0;
  const waiting = [];
  const stats = { name: cfg.name, through: 0, deduped: 0, cooled: 0, queued: 0, deadline: 0, failed: 0 };

  const takeSlot = () => busy < cfg.maxConcurrent
    ? (busy++, Promise.resolve())
    : (stats.queued++, new Promise((go) => waiting.push(go)));
  const freeSlot = () => {
    const next = waiting.shift();
    if (next) next(); else busy--;
  };

  const guarded = async (config) => {
    const key = keyOf(config);
    // A stream is a pipe, not an answer: nothing here may be shared or replayed.
    if (config.responseType === 'stream') return builtIn(config);

    const until = cooling.get(key);
    if (until && Date.now() < until) {
      stats.cooled++;
      const e = new Error(`${cfg.name}: ${key} failed ${Math.round((until - Date.now()) / 1000)}s ago, retry refused for now`);
      e.code = 'EOUTBOUND_COOLING';
      e.cooling = true;
      throw e;                                  // instant: the whole point of the cooldown
    }
    if (inflight.has(key)) { stats.deduped++; return inflight.get(key); }

    // A call that declares its own shorter timeout keeps it: the guard must never make a
    // request SLOWER by replacing a careful 6 s with a careless 15 s. A call that needs longer
    // than the module budget says so explicitly with `guardBudgetMs` (NASA's media downloads).
    const budget = config.guardBudgetMs || Math.min(cfg.budgetMs, config.timeout || cfg.budgetMs);
    // The deadline is handed to axios's OWN timeout, not to a timer plus an aborted signal.
    // Measured here: if the guard aborts config.signal itself, axios' dispatchRequest runs
    // `throwIfCancellation(config)` on the rejection path and replaces the guard's error with
    // its own CanceledError (ERR_CANCELED) — the caller then loses which URL timed out and in
    // how long, which is exactly the information the weight report needs. axios' timeout
    // destroys the socket just as well, and leaves the error intact for the annotation below.
    // It also retries nothing (no retry path exists in lib/adapters/http.js), so one unreachable
    // edge IP costs a single failed attempt and then the cooldown, not three — which is why NASA,
    // whose whole outage strategy IS a three-attempt retry, is attached without a cooldown.
    config.timeout = budget;

    stats.through++;
    const run = (async () => {
      await takeSlot();
      try {
        return await builtIn(config);
      } catch (err) {
        const timedOut = err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');
        if (timedOut) {
          stats.deadline++;
          err.outboundDeadline = true;          // annotated, never replaced — see above
          err.message = `${cfg.name}: ${key} did not answer within ${budget}ms`;
        }
        // A 4xx is an answer, not an outage: the caller should get it and NOT be silenced.
        const status = err && err.response ? Number(err.response.status) : 0;
        const anAnswer = status >= 400 && status < 500;
        if (!anAnswer) {
          stats.failed++;
          cooling.set(key, Date.now() + cfg.cooldownMs);
        }
        throw err;
      } finally {
        inflight.delete(key);
        freeSlot();
      }
    })();

    inflight.set(key, run);
    return run;
  };

  instance.defaults.adapter = guarded;
  const api = {
    stats,
    // Only for tests: production must never be able to wish a cooldown away.
    reset: () => {
      inflight.clear(); cooling.clear(); busy = 0; waiting.length = 0;
      stats.through = 0; stats.deduped = 0; stats.cooled = 0; stats.queued = 0; stats.deadline = 0; stats.failed = 0;
    },
  };
  GUARDED.push(api);
  return api;
}

module.exports = { attachGuard, DEFAULTS, keyOf, guardedStats: () => GUARDED.map((g) => g.stats) };
