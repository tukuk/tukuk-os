/**
 * Express middleware: token-bucket rate limiter, optional API-key gate, and the cache
 * lease handed to a shared front proxy (see handProxyLease).
 *
 * Rate limiter state lives in an in-process Map keyed by `prefix + clientIp`. Buckets
 * are lazily expired (a full sweep runs every 500 requests) so a burst of unique IPs
 * cannot leak memory indefinitely. Standard `X-RateLimit-*` headers are always set;
 * on 429 we also send `Retry-After`.
 *
 * Note: single-instance only. Behind a future multi-process deployment we'd need Redis
 * or a shared store; the current tukuk-os.service is one Node process, so Map is fine.
 */
const config = require('./config');

const buckets = new Map();
let cleanupCounter = 0;

/** Resolve the identity used to bucket a request (proxy-aware when trustProxy is set). */
function clientKey(req) {
  if (config.rateLimit.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Build a per-route rate-limit middleware.
 * @param {{windowMs: number, max: number, keyPrefix?: string}} opts
 * @returns {(req: any, res: any, next: any) => void}
 */
function rateLimit({ windowMs, max, keyPrefix = '' }) {
  return (req, res, next) => {
    const id = `${keyPrefix}${clientKey(req)}`;
    const now = Date.now();

    cleanupCounter += 1;
    if (cleanupCounter % 500 === 0) {
      for (const [key, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(key);
      }
    }

    let entry = buckets.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(id, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests',
        retryAfterSeconds: retryAfter
      });
    }

    return next();
  };
}

/** Optional API-key gate — no-op when `config.security.apiKey` is empty. */
function requireApiKey(req, res, next) {
  if (!config.security.apiKey) return next();

  const provided =
    req.headers['x-api-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (provided && provided === config.security.apiKey) return next();

  return res.status(401).json({ error: 'API key invalid or missing' });
}

/**
 * Hand a shared front proxy its cache lease at the last instant it can still be decided.
 *
 * `app.use` can only say "this prefix may be cached"; it cannot know what the route will
 * finally do. Two real cases prove the gap: an unknown flag slug 404s under a cacheable
 * prefix (the proxy would serve a cached "not found" for the whole lease), and
 * /bendera/studio overwrites Cache-Control with no-store while living under /bendera.
 * So the lease (`X-Accel-Expires`, the one header nginx's proxy_cache obeys while
 * deliberately ignoring the browser-facing `max-age=0`) is applied only if the final
 * status is 2xx and the final Cache-Control is still the policy that was offered.
 *
 * WHY THE HOOK IS writeHead AND NOT write/end: writeHead is the one function every response
 * goes through before a single header byte leaves, and at that moment setHeader() is still
 * legal. Deciding at `end()` throws ERR_HTTP_HEADERS_SENT because compression() calls
 * writeHead() itself (node_modules/compression/index.js:126) and then streams the body — that
 * throw crash-looped the live process. Guarding `end()` with headersSent then marks NOTHING,
 * because by then the headers are long gone: every gzipped page would silently get no lease
 * and the cache would stay empty while every other check kept passing. Both directions are
 * pinned by test/proxy-lease.test.js, which runs the real express + real compression chain.
 *
 * @param {any} res express response
 * @param {{policy: string, seconds: string}} opts the exact Cache-Control value that
 *   entitles the response to a lease, and how long the proxy may hold it
 */
function handProxyLease(res, { policy, seconds }) {
  const decide = () => {
    if (res.headersSent) return;                                  // too late; leave it uncached
    if (res.getHeader('Cache-Control') !== policy) return;        // a route said no
    if (!(res.statusCode >= 200 && res.statusCode < 300)) return; // not a real render
    res.setHeader('X-Accel-Expires', seconds);
  };
  const original = res.writeHead;
  res.writeHead = function (...args) {
    if (res.headersSent) return original.apply(this, args);   // nothing left to decide
    // writeHead(status, [reason,] headers) applies `headers` itself, AFTER this point. Cache-
    // Control is the one value the decision depends on, so mirror it into the header store
    // first — a route that passes no-store here must not be leased. Any other shape (an
    // array of pairs, anything not a plain object) is not worth guessing about: skip the
    // decision entirely, which leaves the response uncached, never wrongly cached.
    const passed = typeof args[1] === 'string' ? args[2] : args[1];
    if (passed !== undefined && (typeof passed !== 'object' || Array.isArray(passed))) {
      res.writeHead = original;
      return original.apply(this, args);
    }
    if (passed) {
      const cc = passed['Cache-Control'] !== undefined ? passed['Cache-Control'] : passed['cache-control'];
      if (cc !== undefined) res.setHeader('Cache-Control', cc);
    }
    decide();
    res.writeHead = original;   // only the first flush can still be influenced
    return original.apply(this, args);
  };
}

module.exports = { rateLimit, requireApiKey, clientKey, handProxyLease, buckets };