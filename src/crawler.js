/**
 * Web crawler / index-ingest pipeline.
 *
 * Responsibilities:
 *   - Fetch an arbitrary URL (with robots.txt respect, per-domain politeness delay, and
 *     an SSRF guard via `assertPublicUrl`) and extract a clean title/description/body via
 *     `src/extract.js`.
 *   - Skip obviously low-value documents (too few words, no title, non-HTML content-type)
 *     and unchanged documents (matched by content hash) so re-crawls are cheap.
 *   - Push accepted documents into both the Meilisearch index (when reachable) and the
 *     on-disk fallback cache so /search keeps answering offline.
 *   - Expose sitemap + BFS seed crawling with strict page caps so a misconfigured seed
 *     cannot turn into an unbounded scrape.
 *
 * Every public function returns a status-tagged object ('crawled' | 'skipped' | 'unchanged'
 * | 'failed') so the HTTP layer can surface a per-URL result without throwing.
 */
const axios = require('axios');
const config = require('./config');
const { extract } = require('./extract');
const fallback = require('./fallback');
const { assertPublicUrl, documentId, contentHash, normalizeUrl, sameSite } = require('./util');
const safety = require('./safety');
const { CRAWLED_QUALITY } = require('./meili');

// Runtime counters surfaced via /dev and the crawler status API. Kept in one place so
// resetStats() can zero everything atomically.
const stats = {
  queued: 0,
  crawled: 0,
  failed: 0,
  skipped: 0,
  indexed: 0,
  startedAt: Date.now(),
  lastError: null,
  robots: new Map(),        // origin -> parsed robots.txt rules (cached per process)
  domainTimestamps: new Map() // origin -> last request time, for crawlDelayMs politeness
};

// Shared HTTP client: timeout + maxRedirects + maxContentLength + a Mozilla UA so most
// public sites don't reject us as a bot. Content-type filter is applied by the caller
// because some non-HTML responses (e.g. JSON APIs) are legitimately interesting elsewhere.
const http = axios.create({
  timeout: config.crawl.timeout,
  maxRedirects: config.crawl.maxRedirects,
  maxContentLength: config.crawl.maxBytes,
  validateStatus: (status) => status >= 200 && status < 300,
  headers: {
    'User-Agent': config.crawl.userAgent,
    // Publisher sites content-negotiate on Accept-Language; ms-MY first keeps Malay-language
    // sources serving their native variant, with en;q=0.8 as the fallback for global sites.
    'Accept-Language': 'ms-MY,ms;q=0.9,en;q=0.8'
  },
  decompress: true
});

/** Promise-based sleep helper used to enforce politeness delays. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enforce `crawlDelayMs` between requests to the same origin.
 * Sleeps for the remaining gap (if any) and then records "now" as the new last-hit time,
 * so parallel crawl workers naturally serialize per-domain without a global lock.
 * @param {string} targetUrl
 */
async function domainDelay(targetUrl) {
  const origin = new URL(targetUrl).origin;
  const now = Date.now();
  const last = stats.domainTimestamps.get(origin) || 0;
  const delay = Math.max(0, config.crawl.crawlDelayMs - (now - last));
  if (delay > 0) {
    await sleep(delay);
  }
  stats.domainTimestamps.set(origin, Date.now());
}

/**
 * Robots.txt gate. Fetches and caches rules per origin on first touch; on network or
 * parse failure we default to "allow everything" so a broken robots.txt never silently
 * blocks the whole crawl. Allow/disallow matching follows the standard longest-prefix rule.
 * @param {string} targetUrl @returns {Promise<boolean>}
 */
async function isAllowed(targetUrl) {
  if (!config.crawl.respectRobots) return true;
  const { origin, pathname } = new URL(targetUrl);
  let rules = stats.robots.get(origin);

  if (!rules) {
    rules = { allow: [], disallow: [] };
    try {
      const { data } = await http.get(`${origin}/robots.txt`, { responseType: 'text', timeout: 8000 });
      parseRobots(String(data), rules);
    } catch {
      rules.allow.push('/');
    }
    stats.robots.set(origin, rules);
  }

  const target = `${pathname}${new URL(targetUrl).search}`;
  const matchingDisallow = rules.disallow.filter((rule) => rule && target.startsWith(rule));
  const matchingAllow = rules.allow.filter((rule) => rule && target.startsWith(rule));
  if (matchingDisallow.length === 0) return true;
  if (matchingAllow.length === 0) return false;
  return matchingAllow[matchingAllow.length - 1].length >= matchingDisallow[matchingDisallow.length - 1].length;
}

/**
 * Minimal robots.txt parser — recognises User-agent / Allow / Disallow only, ignores
 * Crawl-delay, Sitemap, and other directives we don't act on. If nothing applies to our
 * UA, we treat the site as fully allowed.
 * @param {string} text @param {{allow: string[], disallow: string[]}} rules
 */
function parseRobots(text, rules) {
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      const agents = value.toLowerCase().split(',').map((item) => item.trim());
      applies = agents.some((agent) => agent === '*' || config.crawl.userAgent.toLowerCase().includes(agent));
      continue;
    }
    if (!applies) continue;
    if (key === 'allow') rules.allow.push(value);
    if (key === 'disallow') rules.disallow.push(value);
  }
  if (!rules.allow.length && !rules.disallow.length) rules.allow.push('/');
}

/**
 * Fetch and parse a single document.
 * Returns a status-tagged result — never throws for ordinary HTTP/quality issues, so
 * the caller can just push it into a results array. Throws only for SSRF rejections
 * (blocked by assertPublicUrl) which indicate a programming/config error.
 * @param {string} targetUrl
 * @returns {Promise<{status:'crawled',document:object}|{status:'skipped',reason:string,url:string}|{status:'unchanged',url:string,id:string}>}
 */
async function fetchDocument(targetUrl) {
  await assertPublicUrl(targetUrl, { allowPrivate: config.crawl.allowPrivateHosts });

  if (!(await isAllowed(targetUrl))) {
    stats.skipped += 1;
    return { status: 'skipped', reason: 'robots.txt', url: targetUrl };
  }

  await domainDelay(targetUrl);

  const { data, headers } = await http.get(targetUrl, { responseType: 'text' });
  const contentType = String(headers['content-type'] || '');
  if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
    stats.skipped += 1;
    return { status: 'skipped', reason: `content-type ${contentType}`, url: targetUrl };
  }

  const parsed = extract(String(data), targetUrl);
  const hash = contentHash(`${parsed.title}|${parsed.description}|${parsed.content}`);

  // Quality filter
  if (parsed.wordCount < config.crawl.minWordCount) {
    stats.skipped += 1;
    return { status: 'skipped', reason: `low quality (${parsed.wordCount} words)`, url: targetUrl };
  }

  if (!parsed.title || parsed.title.length < 3) {
    stats.skipped += 1;
    return { status: 'skipped', reason: 'no title', url: targetUrl };
  }

  // Never let abuse-linked material into the index in the first place (the same
  // term list that gates /search results — see src/safety.js).
  if (safety.blockedHit({ title: parsed.title, url: parsed.url })) {
    stats.skipped += 1;
    return { status: 'skipped', reason: 'safety', url: targetUrl };
  }

  // The index may be null if Meilisearch was unreachable at boot.
  const existing = index ? await index.getDocument(documentId(parsed.url)).catch(() => null) : null;
  if (existing && existing.hash === hash) {
    stats.skipped += 1;
    return { status: 'unchanged', url: parsed.url, id: documentId(parsed.url) };
  }

  return {
    status: 'crawled',
    document: {
      ...parsed,
      id: documentId(parsed.url),
      hash,
      summary: parsed.description,
      // Every document carries a score so the quality tie-break in meili.js stays defined;
      // a crawled page is unrated, so it takes the neutral middle.
      quality: CRAWLED_QUALITY,
      crawledAt: new Date().toISOString()
    }
  };
}

/** Meilisearch index handle — set once at boot via setIndex(); null in fallback-only mode. */
let index = null;
/** Wire the crawler to a Meilisearch index (called from index.js after ensureIndex). */
function setIndex(value) {
  index = value;
}

/**
 * Public wrapper around fetchDocument that also writes to Meilisearch + fallback cache
 * and updates the run-time counters. Never throws: any error is captured in `stats.lastError`
 * and surfaced as `{status:'failed'}` so a batch worker keeps running.
 * @param {string} targetUrl @returns {Promise<object>}
 */
async function crawlOne(targetUrl) {
  try {
    const result = await fetchDocument(targetUrl);
    if (result.status === 'crawled' && config.crawl.indexOnCrawl) {
      fallback.remember(result.document);
      let taskUid = null;
      try {
        const task = await index.addDocuments([result.document], { primaryKey: 'id' });
        taskUid = task.taskUid;
      } catch (indexError) {
        stats.lastError = { url: result.url, message: `index failed: ${indexError.message}` };
      }
      stats.indexed += 1;
      stats.crawled += 1;
      return { status: 'crawled', url: result.document.url, id: result.document.id, taskUid, document: result.document };
    }
    return result;
  } catch (error) {
    stats.failed += 1;
    stats.lastError = { url: targetUrl, message: error.message };
    return { status: 'failed', url: targetUrl, error: error.message };
  }
}

/**
 * Crawl a set of URLs with bounded concurrency.
 * Deduplicates the input, enforces a global queue cap (queueLimit) with an HTTP-429
 * error object so the caller can propagate back-pressure, and runs `concurrency` worker
 * coroutines that pull from a shared cursor. Order of `results` is non-deterministic.
 * @param {string[]} urls @param {{concurrency?: number}} [opts]
 * @returns {Promise<Array<object>>}
 */
async function crawlBatch(urls, { concurrency = config.crawl.concurrency } = {}) {
  const queue = [...new Set(urls)].filter(Boolean);
  if (stats.queued + queue.length > config.crawl.queueLimit) {
    throw Object.assign(new Error('Crawl request queue is full'), { statusCode: 429 });
  }
  stats.queued += queue.length;

  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const target = queue[cursor++];
      const result = await crawlOne(target);
      stats.queued -= 1;
      results.push(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return results;
}

/**
 * Extract `<loc>` entries from a sitemap.xml body.
 * Uses regex (not a full XML parser) because sitemaps are simple and huge — a streaming
 * parse would be overkill here. Hard-caps the output at 5000 URLs to bound memory.
 * @param {string} xml @returns {string[]}
 */
function collectSitemapUrls(xml) {
  const urls = [];
  const blocks = String(xml).match(/<url\b[\s\S]*?<\/url>/gi) || [];
  for (const block of blocks) {
    const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i);
    if (!loc) continue;
    const value = loc[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (value) urls.push(value);
    if (urls.length >= 5000) break;
  }
  return urls;
}

/**
 * Fetch a sitemap and return the page URLs it references.
 * Handles both plain `<urlset>` sitemaps and index sitemaps (which list child `<sitemap>`
 * locs) — for index sitemaps we expand up to 10 children with a small delay between each
 * to stay polite. Overall output is capped by `maxPagesPerSeed`.
 * @param {string} sitemapUrl @returns {Promise<string[]>}
 */
async function crawlSitemap(sitemapUrl) {
  await assertPublicUrl(sitemapUrl, { allowPrivate: config.crawl.allowPrivateHosts });
  const { data } = await http.get(sitemapUrl, { responseType: 'text' });
  const body = String(data);

  if (/<urlset/i.test(body)) {
    return collectSitemapUrls(body).slice(0, config.crawl.maxPagesPerSeed);
  }

  const nested = [...body.matchAll(/<sitemap>\s*<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].trim())
    .slice(0, 10);

  const collected = [];
  for (const child of nested) {
    collected.push(...collectSitemapUrls(await http.get(child, { responseType: 'text' }).then((res) => String(res.data))));
    if (collected.length >= config.crawl.maxPagesPerSeed) break;
    await sleep(150);
  }
  return collected.slice(0, config.crawl.maxPagesPerSeed);
}

/**
 * Breadth-first crawl starting from a seed URL.
 * Follows same-site links (unless `sameDomain: false`), respects the total page cap, and
 * sleeps briefly between layers so a misconfigured seed can't turn into a full-site scrape.
 * Deduplicates by normalised URL to survive `?ref=` variants and trailing slashes.
 * @param {string} seedUrl @param {{maxPages?: number, sameDomain?: boolean}} [opts]
 * @returns {Promise<{seed: string, discovered: number, results: Array<object>}>}
 */
async function crawlSeed(seedUrl, { maxPages = config.crawl.maxPagesPerSeed, sameDomain = true } = {}) {
  const seen = new Set([normalizeUrl(seedUrl)]);
  const results = [];
  let frontier = [...seen];

  while (frontier.length && results.length < maxPages) {
    const remaining = Math.max(1, maxPages - results.length);
    const batch = frontier.slice(0, remaining);
    frontier = [];

    const processed = await crawlBatch(batch, { concurrency: config.crawl.concurrency });
    results.push(...processed);

    for (const item of processed) {
      if (item.status !== 'crawled' && item.status !== 'unchanged') continue;
      for (const link of item.document?.links || []) {
        if (seen.size >= maxPages * 4) break;
        if (sameDomain && !sameSite(link, item.url)) continue;
        if (seen.has(link)) continue;
        seen.add(link);
        frontier.push(link);
      }
    }

    if (frontier.length) await sleep(120);
  }

  return { seed: seedUrl, discovered: seen.size, results };
}

/**
 * Public view of the run-time counters. Excludes the internal `robots` and
 * `domainTimestamps` maps so the response stays small and JSON-serialisable.
 * @returns {{queued:number,crawled:number,failed:number,skipped:number,indexed:number,uptimeSeconds:number,lastError:object|null}}
 */
function snapshot() {
  return {
    queued: stats.queued,
    crawled: stats.crawled,
    failed: stats.failed,
    skipped: stats.skipped,
    indexed: stats.indexed,
    uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000),
    lastError: stats.lastError
  };
}

/** Reset the counters (used by the /dev panel to start a fresh measurement window). */
function resetStats() {
  stats.queued = 0;
  stats.crawled = 0;
  stats.failed = 0;
  stats.skipped = 0;
  stats.indexed = 0;
  stats.lastError = null;
  stats.startedAt = Date.now();
}

/** Drop the inline `document` blob from crawl results before returning them over HTTP. */
function stripDocuments(results) {
  return results.map(({ document, ...rest }) => rest);
}

module.exports = {
  crawlOne,
  crawlBatch,
  crawlSitemap,
  crawlSeed,
  isAllowed,
  setIndex,
  stripDocuments,
  snapshot,
  resetStats
};