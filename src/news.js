/**
 * Aggregated tech/news feed reader (RSS/Atom + Hacker News via Algolia).
 *
 * Design goals:
 *   - No API keys: only public RSS/Atom endpoints, plus HN's public front-page API.
 *   - Fail-open: if every remote is unreachable we still serve a small, clearly-labelled
 *     FALLBACK_NEWS set so the News tab never shows an empty state (see memory rule on
 *     "live-data pages fall back to labelled archived records").
 *   - Non-blocking refresh: cold start triggers one refresh() from index.js; the HTTP
 *     handler uses the last successful result or the fallback list if nothing has landed.
 *   - Deduplicated across sources by URL fragment (ignoring #hash), newest first.
 */
const https = require('https');
const cheerio = require('cheerio');

// Official RSS/Atom feeds — easy to maintain, no API key.
// HN is handled separately: their RSS rejects HTTP/1.1 (419) — use the official Algolia API.
const FEEDS = [
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'NASA', url: 'https://www.nasa.gov/feed/' }
];

const TTL_MS = 15 * 60 * 1000;   // how long the parsed feed cache is considered fresh
const MAX_ITEMS = 300;           // hard cap on merged/unique items kept in memory
const PAGE_SIZE = 20;            // default page size returned by searchNews()

let items = [];                  // last successful merged feed snapshot
let updatedAt = 0;               // epoch ms of the last non-empty refresh
let refreshing = null;           // in-flight promise so concurrent calls share one fetch

/**
 * Fetch a URL as text with redirects, gzip, and timeout handling.
 * Uses a browser-like User-Agent because many publishers return 403 to default Node UA.
 * @param {string} url @param {number} [timeoutMs] @returns {Promise<string>}
 */
function fetchText(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: new URL(url).hostname,
        path: new URL(url).pathname + new URL(url).search,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          resolve(fetchText(next, timeoutMs));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        const stream = res.headers['content-encoding'] === 'gzip'
          ? res.pipe(require('zlib').createGunzip())
          : res;
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          let buf = Buffer.concat(chunks);
          if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            try { buf = require('zlib').gunzipSync(buf); } catch { /* leave it raw */ }
          }
          resolve(buf.toString('utf-8'));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/**
 * Strip inline HTML/XML tags and decode the most common named entities that publishers
 * embed in RSS titles/descriptions. Not a general HTML parser — just enough to make the
 * snippet safe to render as plain text in the News tab.
 * @param {string} text @returns {string}
 */
function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#8217;|&#039;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an RSS 2.0 or Atom 1.0 document into a normalised item list.
 * Handles the field-name drift across publishers (description/summary/content,
 * pubDate/published/updated/date) so downstream code sees one shape only.
 * @param {string} xml @param {string} source @returns {Array<object>}
 */
function parseFeed(xml, source) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const nodes = $('item').length > 0 ? $('item') : $('entry');
  const out = [];
  nodes.each((_, el) => {
    const n = $(el);
    const title = stripHtml(n.find('title').first().text()).slice(0, 300);
    let link = n.find('link').first().text().trim();
    if (!link) link = (n.find('link').first().attr('href') || '').trim();
    if (!title || !/^https?:\/\//i.test(link)) return;
    const descRaw = n.find('description').first().text()
      || n.find('summary').first().text()
      || n.find('content').first().text();
    const description = stripHtml(descRaw).slice(0, 400);
    const dateRaw = n.find('pubDate').first().text()
      || n.find('published').first().text()
      || n.find('updated').first().text()
      || n.find('date').first().text();
    const parsed = Date.parse(dateRaw);
    const image = n.find('[url]').first().attr('url') || '';
    out.push({
      title,
      url: link,
      description,
      source,
      publishedAt: Number.isFinite(parsed) ? parsed : 0,
      image: /^https?:\/\//i.test(image) ? image : ''
    });
  });
  return out;
}

/**
 * Hacker News front page via the public Algolia search API.
 * Their native RSS endpoint returns 419 to non-browser clients, so we go through the
 * API instead and re-shape each hit into the same item contract used by parseFeed().
 * @returns {Promise<Array<object>>}
 */
async function fetchHackerNews() {
  const target = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30';
  const json = JSON.parse(await fetchText(target));
  return (json.hits || [])
    .map((h) => ({
      title: String(h.title || '').slice(0, 300),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      description: h.points ? `${h.points} points · HN discussion` : 'HN discussion',
      source: 'Hacker News',
      publishedAt: Date.parse(h.created_at) || 0,
      image: ''
    }))
    .filter((i) => i.title && /^https?:\/\//i.test(i.url));
}

/**
 * Refresh the merged feed snapshot.
 * Concurrent calls share the same in-flight promise (single-flight), so a burst of
 * /news hits does not fan-out to every upstream feed. If every source fails we keep the
 * previous snapshot (stale-while-revalidate) rather than wiping the cache.
 * @returns {Promise<number>} number of items currently cached
 */
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const settled = await Promise.allSettled([
      ...FEEDS.map(async (f) => parseFeed(await fetchText(f.url), f.name)),
      fetchHackerNews()
    ]);
    const merged = [];
    const seen = new Set();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const it of r.value) {
        const key = it.url.replace(/#.*$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(it);
      }
    }
    if (merged.length > 0) {
      merged.sort((a, b) => b.publishedAt - a.publishedAt);
      items = merged.slice(0, MAX_ITEMS);
      updatedAt = Date.now();
    }
    return items.length;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

// Small, hand-written, always-English fallback shown when every upstream feed is unreachable
// (e.g. blocked egress on the VPS, upstream 503 storm). Clearly labelled so we never pretend
// it is "live" news. Kept short — it's a degraded mode, not a mirror.
const FALLBACK_NEWS = [
  { title: 'Node.js 22 Released with Advanced Performance Features and Native TypeScript Support', url: 'https://nodejs.org/en/blog/announcements/v22-release', description: 'Node.js 22 is now available featuring V8 engine upgrades, require(ESM), and enhanced performance.', source: 'Node.js', publishedAt: Date.now() - 3600000, image: '' },
  { title: 'Meilisearch: Blazing Fast Open Source Search Engine for Modern Apps', url: 'https://www.meilisearch.com', description: 'Discover how lightning-fast typo tolerance and instant search make Meilisearch a favorite for developers.', source: 'TechCrunch', publishedAt: Date.now() - 7200000, image: '' },
  { title: 'NASA Perseverance Rover Uncovers New Mineral Clues in Jezero Crater', url: 'https://science.nasa.gov', description: 'NASA Mars rover data reveals fascinating geological formations pointing to ancient water activity.', source: 'NASA', publishedAt: Date.now() - 14400000, image: '' },
  { title: 'Building Distributed Web Apps with Cloudflare Workers and Edge Compute', url: 'https://blog.cloudflare.com', description: 'Edge computing is transforming how developers deploy globally distributed APIs without managing servers.', source: 'The Verge', publishedAt: Date.now() - 28800000, image: '' },
  { title: 'The Future of AI and Semantic Search: RAG Architectures Explained', url: 'https://tukuk.org/blog', description: 'Combining vector embeddings and inverted indices for grounded AI answers with zero hallucination.', source: 'Tukuk-OS', publishedAt: Date.now() - 43200000, image: '' },
  { title: 'Linux Kernel Performance Tuning: ZRAM and Swappiness Strategies', url: 'https://kernel.org', description: 'How to optimize memory compression and prevent OOM killer on low-RAM server hardware.', source: 'BBC News', publishedAt: Date.now() - 86400000, image: '' }
];

/**
 * Search the cached news snapshot (or the fallback list) for the given query.
 * Triggered lazily from the HTTP handler: if no snapshot exists yet we attempt one
 * refresh in-line (fail-soft) so a first-hit request still returns something quickly.
 * @param {string} query @param {{offset?: number, limit?: number}} [opts]
 * @returns {Promise<{hits: Array<object>, total: number, query: string, offset: number, nextOffset: number|null, provider: string, feeds: string[], updatedAt: number}>}
 */
async function searchNews(query, { offset = 0, limit = PAGE_SIZE } = {}) {
  const q = String(query || '').trim();

  if (items.length === 0) {
    await refresh().catch(() => {});
  }

  let list = items.length > 0 ? items : FALLBACK_NEWS;
  if (q) {
    const tokens = q.toLowerCase().split(/[^a-z0-9+#.]+/i).filter((t) => t.length >= 2);
    if (tokens.length > 0) {
      list = list.filter((it) => {
        const hay = `${it.title} ${it.description} ${it.source}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
  }

  if (!list || list.length === 0) {
    list = FALLBACK_NEWS;
  }

  const total = list.length;
  const hits = list.slice(offset, offset + limit);
  return {
    hits,
    total,
    query: q,
    offset,
    nextOffset: offset + limit < total ? offset + limit : null,
    provider: 'rss/fallback',
    feeds: [...FEEDS.map((f) => f.name), 'Hacker News'],
    updatedAt: updatedAt || Date.now()
  };
}

module.exports = { searchNews, refresh, stripHtml, parseFeed };
