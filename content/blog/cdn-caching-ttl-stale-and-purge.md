SLUG: cdn-caching-ttl-stale-and-purge
TITLE: CDN Caching in Plain Terms: TTL, Stale, and When to Purge
EXCERPT: A CDN is not a copy of your site — it's a set of expiry rules about how long each edge may serve an old one. Understanding TTL, stale-while-revalidate, and cache keys is 90% of correct caching.
TAGS: caching, cdn, edge, operations

## The One Idea That Matters

A CDN stores responses at edge locations near users. The hard part is not storing — it's knowing **how long that stored copy may still be served**. That decision is a **TTL** (time-to-live) and a **cache key**.

- **Cache key** = what identifies "the same" response. Usually the URL, but also the parts you vary on (host, `Accept`, cookies, a version header). Get this wrong and you serve the logged-in page to anonymous users, or you never reuse the cache at all.
- **TTL** = how long the edge may serve without checking origin. Short TTL = fresher but more origin load. Long TTL = cheaper but staler.

## Setting TTLs by Volatility

Cache the things that rarely change, longest:

| Content | Typical TTL |
|---|---|
| Versioned static assets (`app.a1b2c3.js`) | Weeks–a year (they're immutable by name) |
| Images / fonts | Days–weeks |
| HTML shell | Minutes, or `no-cache` + revalidate |
| API responses | Seconds–minutes, or don't cache |

Immutable, fingerprinted filenames let you cache forever: you never invalidate, you just ship a new name.

## Serving Stale on Purpose (SWR)

`stale-while-revalidate` lets the edge serve the *expired* copy immediately while it fetches a fresh one in the background. Users get instant (slightly old) content and the cache quietly updates. Perfect for feeds, product pages, blog lists — where one-minute-stale is invisible but sub-second latency is felt. `stale-if-error` does the same when the origin is down, which turns an outage into "looks a little dated" instead of "502 everywhere".

```http
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

Freshness for 60s, then serve stale for up to 300s while revalidating.

## When You Must Purge (and When Not To)

Purge (invalidate) is a blunt, per-object operation you reserve for real need: a price changed, a security page updated, content deleted. Purging everything on every deploy is an anti-pattern — it turns your CDN into a stampede against origin (cache miss = every edge races the source at once, a **thundering herd**). Prefer:

1. **Versioned names** for cache-busting (never purge).
2. **Short TTL + SWR** for pages that just need to be roughly current.
3. **Targeted purge** for the few URLs that genuinely must drop now.

## Debugging Checklist

- **Why is my user seeing old content?** Check the cache key first — are you varying on something you forgot (user, device, cookie)? Then the TTL.
- **Why is origin getting hammered?** Cache key too specific, TTL too short, or you're purging globally.
- **Is anything actually cacheable?** If responses set `Cache-Control: private` or carry a `Set-Cookie`, edges won't store them.

A CDN is a distributed set of promises about freshness. Keep the cache key honest, match TTL to volatility, serve stale deliberately, and purge only when a human would notice the difference.
