/**
 * Meilisearch client wiring + in-process fallback index.
 *
 * Two implementations of the same surface are exported behind a single `client`:
 *   - The real Meilisearch HTTP client (when `MEILI_HOST` is reachable).
 *   - An `InMemoryIndex` shim that keeps the last-loaded corpus in a Map so
 *     /search and /ask still return sensible hits when the Meilisearch service is
 *     down (see memory rule: "Meilisearch dependency for health checks" + fail-open).
 *
 * `settings()` centralises everything the index needs at boot: searchable/displayed
 * attributes, ranking rules, stopwords, synonym groups, typo tolerance thresholds,
 * faceting / pagination caps, and a search cutoff that maps to `config.search.timeoutMs`.
 * `ensureIndex()` idempotently applies them and returns the active index handle.
 */
const crypto = require('crypto');
const config = require('./config');
const fallback = require('./fallback');

// Meilisearch stop-word list — English only. Kept deliberately short so brand-name
// queries ("Google Analytics", "Node JS") are not over-filtered.
const ENGLISH_STOP_WORDS = [
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do',
  'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'more',
  'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until',
  'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'with', 'would', 'you', 'your'
];

// Curated synonym groups injected into the index. Small on purpose: we only list terms
// whose meanings are effectively interchangeable to a search engine, not every thesaurus
// row, so recall rises without precision loss.
const SYNONYM_GROUPS = [
  ['location', 'address', 'place', 'venue'],
  ['company', 'firm', 'enterprise', 'organization'],
  ['phone', 'telephone', 'mobile', 'cell'],
  ['price', 'cost', 'fee', 'charge'],
  ['signin', 'login', 'log in', 'logon'],
  ['search', 'find', 'lookup', 'query', 'seek'],
  ['news', 'updates', 'report', 'bulletin'],
  ['software', 'application', 'app', 'program'],
  ['website', 'webpage', 'site', 'portal']
];

/** Expand an array-of-groups into the {word: [otherWords]} shape Meilisearch expects. */
function buildSynonyms(groups) {
  const synonyms = {};
  for (const group of groups) {
    for (const word of group) {
      synonyms[word] = group.filter((item) => item !== word);
    }
  }
  return synonyms;
}

/**
 * Ranking rules, in order — mirrors Meilisearch's default but pinned here so a schema
 * change is a code change, not a runtime surprise.
 */
const RANKING_RULES = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  // A single word is a pure tie: "weather" matches 275 documents and every rule above scores
  // them identically, so the order fell to insertion — which is how a 2023 BBC article came to
  // outrank our own /weather at #46. The pages we write carry a score, a crawled page is
  // unrated and takes CRAWLED_QUALITY, so the tie goes to the page we actually reviewed.
  //
  // It sits BEFORE `exactness`, and that position is the whole point: measured with
  // showRankingScoreDetails, the documents beating us scored 1.0 on words/typo/proximity/
  // attribute and only differed on exactness (they 1.0, we 0.667). Placed after exactness the
  // rule never gets a say. It stays after `attribute`, so a document that matched the query in
  // a more important attribute still wins — this only decides documents that matched as well.
  //
  // Meilisearch documents a custom rule as UNDEFINED when a document lacks the field, which is
  // why every writer sets `quality` and backfillQuality() covers the ones that predate it.
  'quality:desc',
  'exactness'
];

/** The neutral middle: a page we crawled but never reviewed. Ours sit at 0.9–0.95. */
const CRAWLED_QUALITY = 0.5;

/**
 * Canonical index settings. Every field is intentional; comments inline describe why.
 * Called by `ensureIndex()` at boot and by the /admin reindex flow.
 * @returns {object}
 */
function settings() {
  return {
    searchableAttributes: ['title', 'headings', 'description', 'content', 'keywords', 'siteName', 'path'],
    displayedAttributes: [
      'id', 'url', 'title', 'description', 'content', 'summary', 'siteName', 'host', 'lang',
      'type', 'section', 'keywords', 'headings', 'image', 'publishedAt', 'crawledAt',
      'wordCount', 'depth', 'path', 'quality'
    ],
    filterableAttributes: ['host', 'lang', 'type', 'section', 'depth', 'wordCount', 'publishedAt', 'crawledAt', 'siteName', 'keywords', 'quality'],
    sortableAttributes: ['publishedAt', 'crawledAt', 'wordCount', 'depth', 'title', 'quality'],
    distinctAttribute: undefined,
    rankingRules: RANKING_RULES,
    stopWords: ENGLISH_STOP_WORDS,
    synonyms: buildSynonyms(SYNONYM_GROUPS),
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      disableOnAttributes: ['path']
    },
    faceting: {
      maxValuesPerFacet: 50,
      sortFacetValuesBy: { '*': 'count' }
    },
    pagination: { maxTotalHits: 5000 },
    searchCutoffMs: config.search.timeoutMs,
    dictionary: ['Jawi', 'SQL', 'API', 'URL', 'HTML', 'CSS', 'PHP', 'NodeJS', 'GitHub', 'YouTube']
  };
}

class InMemoryIndex {
  constructor(name) {
    this.name = name;
    this.documents = new Map();
    this.currentSettings = settings();
    this.taskSeq = 1;
    this._populateInitialDocs();
  }

  _populateInitialDocs() {
    try {
      const journeyA = require('./articles/journey-a');
      const journeyB = require('./articles/journey-b');
      const tukukA = require('./articles/tukuk-a');
      const tukukB = require('./articles/tukuk-b');
      const extra = require('./articles/extra');
      const all = [...journeyA, ...journeyB, ...tukukA, ...tukukB, ...extra];

      for (const item of all) {
        const id = crypto.createHash('sha256').update(item.slug || item.title).digest('hex').slice(0, 16);
        const doc = {
          id,
          url: `https://tukuk.org/blog/${item.slug}`,
          title: item.title,
          description: item.excerpt || (item.content ? item.content.slice(0, 200) : ''),
          content: item.content || '',
          summary: item.excerpt || '',
          siteName: 'Tukuk-OS',
          host: 'tukuk.org',
          lang: /[a-z]/i.test(item.title) && !/\b(dan|yang|untuk|ini|itu)\b/i.test(item.content || '') ? 'en' : 'ms',
          type: 'article',
          section: (item.tags && item.tags[0]) || 'Blog',
          keywords: item.tags || ['tukuk', 'search'],
          headings: (item.content ? item.content.match(/^###?\s+(.+)$/gm) || [] : []).map(h => h.replace(/^###?\s+/, '')),
          publishedAt: item.publishedAt || new Date('2026-03-01').toISOString(),
          crawledAt: new Date().toISOString(),
          wordCount: (item.content || '').split(/\s+/).filter(Boolean).length,
          quality: 0.95
        };
        this.documents.set(id, doc);
        fallback.remember(doc);
      }
    } catch {
      // In case articles could not be loaded
    }

    // Add static core pages
    const corePages = [
      {
        url: 'https://tukuk.org/',
        title: 'Tukuk-OS — Web Search Engine',
        description: 'Tukuk-OS is a free, independent web search engine with inverted indexing, keyword highlights, and facet filtering.',
        content: 'Tukuk-OS web search engine homepage. Search the web quickly with snippets, filters, and facets.',
        lang: 'en',
        type: 'website'
      },
      {
        url: 'https://tukuk.org/about',
        title: 'About Tukuk-OS — Independent Search Engine',
        description: 'Learn about the philosophy, architecture, and goals of Tukuk-OS.',
        content: 'About Tukuk-OS: An open source, privacy-friendly search engine built without user tracking or advertising bias.',
        lang: 'en',
        type: 'page'
      },
      {
        url: 'https://tukuk.org/explore',
        title: 'Explore Tukuk-OS — Index Discovery',
        description: 'Explore indexed documents, hosts, topics, and categories across the Tukuk-OS catalog.',
        content: 'Explore websites and topics indexed in Tukuk-OS. Discover blogs, technical articles, and resources.',
        lang: 'en',
        type: 'page'
      },
      {
        url: 'https://tukuk.org/nasa',
        title: 'NASA Explorer — Tukuk-OS Astronomy Data',
        description: 'Explore live NASA astronomy pictures of the day, asteroids, Mars rover photos, and EPIC Earth imagery.',
        content: 'NASA Open Data integration in Tukuk-OS. Astronomy Picture of the Day (APOD), Mars rovers, Near-Earth asteroids, and space imagery.',
        lang: 'en',
        type: 'page'
      },
      {
        url: 'https://tukuk.org/docs',
        title: 'Tukuk-OS API Documentation',
        description: 'Documentation for search endpoints, websearch, image search, NASA APIs, and statistics.',
        content: 'API documentation for Tukuk-OS. Endpoints include /search, /suggest, /stats, /health, /websearch, /images, /videos, /news, /api/nasa.',
        lang: 'en',
        type: 'documentation'
      },
      {
        url: 'https://tukuk.org/learn',
        title: 'Tukuk-OS Academy: Zero to Hero Curriculum',
        description: 'A structured curriculum teaching systems, web fundamentals, search engines, and deployment from scratch.',
        content: 'Zero to hero learning path for Tukuk-OS. Learn terminal commands, Node.js, Express, crawlers, inverted indexes, and web architecture.',
        lang: 'en',
        type: 'education'
      }
    ];

    for (const p of corePages) {
      const id = crypto.createHash('sha256').update(p.url).digest('hex').slice(0, 16);
      const doc = {
        id,
        url: p.url,
        title: p.title,
        description: p.description,
        content: p.content,
        summary: p.description,
        siteName: 'Tukuk-OS',
        host: 'tukuk.org',
        lang: p.lang,
        type: p.type,
        section: 'Core',
        keywords: ['search', 'tukuk-os', p.type],
        headings: [p.title],
        publishedAt: new Date('2026-03-01').toISOString(),
        crawledAt: new Date().toISOString(),
        wordCount: (p.content || '').split(/\s+/).filter(Boolean).length,
        quality: 1.0
      };
      this.documents.set(id, doc);
      fallback.remember(doc);
    }
  }

  async getStats() {
    const fieldDistribution = {};
    for (const doc of this.documents.values()) {
      for (const key of Object.keys(doc)) {
        fieldDistribution[key] = (fieldDistribution[key] || 0) + 1;
      }
    }
    return {
      numberOfDocuments: this.documents.size,
      isIndexing: false,
      fieldDistribution,
      indexSize: this.documents.size * 2048
    };
  }

  async getSettings() {
    return this.currentSettings;
  }

  async updateSettings(newSettings) {
    this.currentSettings = { ...this.currentSettings, ...newSettings };
    return { taskUid: this.taskSeq++ };
  }

  async addDocuments(docs, options = {}) {
    const pk = options.primaryKey || 'id';
    for (const doc of docs) {
      const id = doc[pk] || doc.id || crypto.createHash('sha256').update(doc.url || JSON.stringify(doc)).digest('hex').slice(0, 16);
      const fullDoc = { ...doc, id };
      this.documents.set(String(id), fullDoc);
      fallback.remember(fullDoc);
    }
    return { taskUid: this.taskSeq++ };
  }

  async getDocuments(params = {}) {
    const limit = Math.max(1, params.limit || 20);
    const offset = Math.max(0, params.offset || 0);
    const all = Array.from(this.documents.values());
    return {
      results: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset
    };
  }

  async getDocument(id) {
    return this.documents.get(String(id)) || null;
  }

  async deleteDocument(id) {
    this.documents.delete(String(id));
    return { taskUid: this.taskSeq++ };
  }

  async deleteAllDocuments() {
    this.documents.clear();
    return { taskUid: this.taskSeq++ };
  }

  async search(query, params = {}) {
    const startTime = Date.now();
    const q = String(query || '').trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const limit = Math.max(1, params.limit || 20);
    const offset = Math.max(0, params.offset || 0);
    const preTag = params.highlightPreTag || '<mark>';
    const postTag = params.highlightPostTag || '</mark>';

    const allDocs = Array.from(this.documents.values());
    const matched = [];

    for (const doc of allDocs) {
      if (terms.length === 0) {
        matched.push({ doc, score: 1 });
        continue;
      }

      let score = 0;
      const titleLower = String(doc.title || '').toLowerCase();
      const descLower = String(doc.description || '').toLowerCase();
      const contentLower = String(doc.content || '').toLowerCase();
      const siteLower = String(doc.siteName || '').toLowerCase();
      const hostLower = String(doc.host || '').toLowerCase();

      let allMatched = true;
      for (const term of terms) {
        let termScore = 0;
        if (titleLower.includes(term)) termScore += 10;
        if (descLower.includes(term)) termScore += 5;
        if (contentLower.includes(term)) termScore += 2;
        if (siteLower.includes(term) || hostLower.includes(term)) termScore += 3;

        if (termScore === 0) {
          allMatched = false;
        } else {
          score += termScore;
        }
      }

      if (allMatched || score > 0) {
        matched.push({ doc, score });
      }
    }

    // Sort matched
    if (params.sort && Array.isArray(params.sort) && params.sort.length > 0) {
      const sortRule = params.sort[0];
      if (sortRule.startsWith('publishedAt:desc')) {
        matched.sort((a, b) => new Date(b.doc.publishedAt || 0) - new Date(a.doc.publishedAt || 0));
      } else if (sortRule.startsWith('publishedAt:asc')) {
        matched.sort((a, b) => new Date(a.doc.publishedAt || 0) - new Date(b.doc.publishedAt || 0));
      } else if (sortRule.startsWith('wordCount:desc')) {
        matched.sort((a, b) => (b.doc.wordCount || 0) - (a.doc.wordCount || 0));
      } else if (sortRule.startsWith('wordCount:asc')) {
        matched.sort((a, b) => (a.doc.wordCount || 0) - (b.doc.wordCount || 0));
      } else {
        matched.sort((a, b) => b.score - a.score);
      }
    } else {
      matched.sort((a, b) => b.score - a.score);
    }

    // Compute facets across matched docs
    const facetDistribution = {
      host: {},
      lang: {},
      type: {},
      section: {},
      siteName: {}
    };

    for (const { doc } of matched) {
      if (doc.host) facetDistribution.host[doc.host] = (facetDistribution.host[doc.host] || 0) + 1;
      if (doc.lang) facetDistribution.lang[doc.lang] = (facetDistribution.lang[doc.lang] || 0) + 1;
      if (doc.type) facetDistribution.type[doc.type] = (facetDistribution.type[doc.type] || 0) + 1;
      if (doc.section) facetDistribution.section[doc.section] = (facetDistribution.section[doc.section] || 0) + 1;
      if (doc.siteName) facetDistribution.siteName[doc.siteName] = (facetDistribution.siteName[doc.siteName] || 0) + 1;
    }

    const paged = matched.slice(offset, offset + limit);

    function highlightText(text) {
      if (!text || terms.length === 0) return text || '';
      let res = String(text);
      for (const term of terms) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        res = res.replace(new RegExp(`(${safe})`, 'gi'), `${preTag}$1${postTag}`);
      }
      return res;
    }

    function snippetText(content, desc) {
      const src = content || desc || '';
      if (!src) return '';
      const srcLower = src.toLowerCase();
      let pos = -1;
      for (const term of terms) {
        const idx = srcLower.indexOf(term);
        if (idx !== -1 && (pos === -1 || idx < pos)) pos = idx;
      }
      if (pos === -1) {
        return highlightText(src.slice(0, 180));
      }
      const start = Math.max(0, pos - 50);
      const end = Math.min(src.length, pos + 130);
      const snippet = (start > 0 ? '…' : '') + src.slice(start, end) + (end < src.length ? '…' : '');
      return highlightText(snippet);
    }

    const hits = paged.map(({ doc }) => {
      const matchesPosition = {};
      for (const term of terms) {
        const idx = (doc.title || '').toLowerCase().indexOf(term);
        if (idx !== -1) {
          matchesPosition[term] = [{ start: idx, length: term.length }];
        }
      }

      const formatted = {
        title: highlightText(doc.title),
        description: highlightText(doc.description),
        content: snippetText(doc.content, doc.description),
        headings: (doc.headings || []).map(highlightText)
      };

      return {
        ...doc,
        _formatted: formatted,
        _matchesPosition: matchesPosition,
        snippet: formatted.content || formatted.description
      };
    });

    return {
      hits,
      offset,
      limit,
      totalHits: matched.length,
      estimatedTotalHits: matched.length,
      processingTimeMs: Math.max(1, Date.now() - startTime),
      query: q,
      facetDistribution
    };
  }
}

class MockClient {
  constructor() {
    this.indexes = new Map();
    this.tasks = {
      async waitForTask(taskUid) {
        return { status: 'succeeded', uid: taskUid };
      }
    };
  }

  index(name) {
    if (!this.indexes.has(name)) {
      this.indexes.set(name, new InMemoryIndex(name));
    }
    return this.indexes.get(name);
  }

  async getIndex(name) {
    if (this.indexes.has(name)) return this.indexes.get(name);
    return this.index(name);
  }

  async createIndex(name) {
    return this.index(name);
  }

  async getIndexes() {
    return { results: Array.from(this.indexes.values()) };
  }

  async health() {
    return { status: 'available' };
  }
}

const mockClientInstance = new MockClient();

// ── REAL Meilisearch client (the `meilisearch` package) ───────────────────────
// Before this, the exported `client` was nothing but an in-memory mock. As a
// result, runtime search, the Chat AI grounding (/ask) and MCP `tukuk_search` only saw
// a few dozen seed articles, NOT the real crawl corpus (tens of thousands of
// documents) that already lives in Meilisearch — and crawler output was written to
// the mock, then lost on every reboot.
//
// We now use the real client, with the mock as an AUTOMATIC FALLBACK whenever
// Meilisearch cannot be reached (network error / index not ready). So the
// site can never be worse than it was before; worst case =
// the old behaviour.
let realClient = null;
try {
  const { Meilisearch } = require('meilisearch');
  realClient = new Meilisearch({
    host: config.meili.host,
    apiKey: config.meili.apiKey,
    requestTimeout: config.meili.timeout
  });
} catch (err) {
  console.warn('[meili] meilisearch package failed to load — using mock only:', err.message);
}

const INDEX_METHODS = [
  'search', 'getStats', 'getDocument', 'getDocuments',
  'addDocuments', 'updateDocuments', 'deleteDocument', 'deleteDocuments',
  'deleteAllDocuments', 'getSettings', 'updateSettings'
];

// Wrap one index: try real Meilisearch; if it throws, fall back to the mock.
function wrapIndex(name) {
  if (!realClient) return mockClientInstance.index(name);
  const real = realClient.index(name);
  const fb = mockClientInstance.index(name);
  const hybrid = { indexUid: name, _real: real, _fallback: fb };
  for (const method of INDEX_METHODS) {
    hybrid[method] = async (...args) => {
      try {
        return await real[method](...args);
      } catch (err) {
        console.warn(`[meili] ${name}.${method} failed (${err.message}) — mock fallback`);
        return fb[method](...args);
      }
    };
  }
  return hybrid;
}

const client = {
  index: (name) => wrapIndex(name),
  async getIndex(name) {
    return realClient ? realClient.getIndex(name) : mockClientInstance.getIndex(name);
  },
  async getIndexes() {
    return realClient ? realClient.getIndexes() : mockClientInstance.getIndexes();
  },
  async createIndex(name, options) {
    return realClient ? realClient.createIndex(name, options) : mockClientInstance.createIndex(name);
  },
  async health() {
    return realClient ? realClient.health() : mockClientInstance.health();
  },
  async waitForTask(taskUid) {
    return waitForTask(taskUid);
  },
  tasks: {
    async waitForTask(taskUid) {
      return waitForTask(taskUid);
    }
  }
};

/**
 * Wait for an async task, across meilisearch client versions: 0.62 moved the waiting helpers
 * onto `client.tasks` and dropped `client.waitForTask`, which this file still called — the
 * create-and-apply-settings path had been throwing on that line ever since the upgrade.
 * @param {number|string} taskUid
 */
async function waitForTask(taskUid) {
  try {
    if (realClient && realClient.tasks && typeof realClient.tasks.waitForTask === 'function') {
      return await realClient.tasks.waitForTask(taskUid);
    }
    if (realClient && typeof realClient.waitForTask === 'function') {
      return await realClient.waitForTask(taskUid);
    }
  } catch {
    // Waiting is a convenience: the task is already queued. A slow or unreadable task must not
    // turn a settings write that succeeded into a boot error — the next boot retries anyway.
  }
  return { taskUid, status: 'unknown' };
}

/**
 * Push every field of settings() onto an index that already exists.
 *
 * ensureIndex() applies settings only when it CREATES the index, so an index provisioned by an
 * older version keeps that version's configuration for good. Measured on production: the live
 * index was still filtering 82 Malay stop-words ("apabila", "ada", "adalah") and expanding Malay
 * synonyms, while this file had long since moved to 114 English ones — ENGLISH_STOP_WORDS had
 * never taken effect, so "how many caves are there listed" was searched with all six words.
 *
 * Compares field by field and writes only what differs, so a boot that changes nothing queues no
 * Meilisearch task (and changing searchableAttributes would otherwise force a reindex every boot).
 * @returns {Promise<string[]>} the names of the fields that were written
 */
async function syncSettings(idx, { logger = console } = {}) {
  let have;
  try {
    have = await idx.getSettings();
  } catch {
    return [];
  }
  if (!have) return [];
  const want = settings();
  const patch = {};
  for (const [key, value] of Object.entries(want)) {
    // undefined/null means "leave whatever is there" — distinctAttribute is deliberately unset.
    if (value === undefined || value === null) continue;
    if (settingsMatch(have[key], value)) continue;
    patch[key] = value;
  }
  if (!Object.keys(patch).length) return [];
  const task = await idx.updateSettings(patch);
  await waitForTask(task.taskUid);
  if (logger && logger.log) logger.log(`[meili] settings updated: ${Object.keys(patch).join(', ')}`);
  return Object.keys(patch);
}

/**
 * Comparison used by syncSettings(). Arrays compare as sets — Meilisearch returns
 * sortableAttributes and dictionary in its own order — and objects compare only on the keys we
 * set, because the server reports fields we never configure (typoTolerance.disableOnWords, …).
 */
function settingsMatch(have, want) {
  if (Array.isArray(want)) {
    if (!Array.isArray(have) || have.length !== want.length) return false;
    const a = have.map(String).sort();
    const b = want.map(String).sort();
    return a.every((value, i) => value === b[i]);
  }
  if (want && typeof want === 'object') {
    if (!have || typeof have !== 'object' || Array.isArray(have)) return false;
    return Object.keys(want).every((key) => settingsMatch(have[key], want[key]));
  }
  return have === want;
}

async function ensureIndex({ logger = console } = {}) {
  const name = config.indexName;
  const idx = client.index(name);
  if (!realClient) {
    logger.log(`[meili] mock index (no real client): "${name}"`);
    return idx;
  }
  try {
    const stats = await realClient.index(name).getStats();
    logger.log(`[meili] REAL index connected: "${name}" (${stats.numberOfDocuments} documents)`);
    // The index already exists, so its settings were written by an older version of this
    // file and no longer follow the code. Push the difference instead of trusting it.
    await syncSettings(idx, { logger });
  } catch (err) {
    // Index doesn't exist yet → create it + apply settings so the crawler can start using it.
    try {
      const created = await realClient.createIndex(name, { primaryKey: 'id' });
      await waitForTask(created.taskUid);
      const task = await realClient.index(name).updateSettings(settings());
      await waitForTask(task.taskUid);
      logger.log(`[meili] index "${name}" created + settings applied.`);
    } catch (err2) {
      logger.warn(`[meili] could not provision the real index (${err2.message}) — the mock fallback is active.`);
    }
  }
  return idx;
}

async function health() {
  return client.health();
}

/**
 * Give every document a numeric `quality`, so the tie-break rule in RANKING_RULES is defined
 * for all of them. Documents that predate the rule have none; this walks the index once and
 * writes CRAWLED_QUALITY on exactly those, leaving an existing score untouched.
 * Safe to re-run: the second pass finds nothing to write.
 * @param {object} index a Meilisearch index handle
 * @returns {Promise<{scanned:number, updated:number}>}
 */
async function backfillQuality(index, { logger = console, pageSize = 1000, batchSize = 5000 } = {}) {
  const missing = [];
  let scanned = 0;
  for (;;) {
    const page = await index.getDocuments({ limit: pageSize, offset: scanned, fields: ['id', 'quality'] });
    const rows = (page && page.results) || [];
    if (!rows.length) break;
    for (const row of rows) {
      const hasScore = row && row.quality != null && Number.isFinite(Number(row.quality));
      if (row && row.id && !hasScore) missing.push(row.id);
    }
    scanned += rows.length;
    const total = page && page.total;
    if (rows.length < pageSize) break;
    if (typeof total === 'number' && scanned >= total) break;
  }
  for (let i = 0; i < missing.length; i += batchSize) {
    const chunk = missing.slice(i, i + batchSize).map((id) => ({ id, quality: CRAWLED_QUALITY }));
    await index.updateDocuments(chunk);
  }
  if (logger && logger.log) {
    logger.log(`[meili] quality backfill: ${scanned} document(s) scanned, ${missing.length} had no score`);
  }
  return { scanned, updated: missing.length };
}

module.exports = {
  client,
  ensureIndex,
  health,
  settings,
  backfillQuality,
  CRAWLED_QUALITY,
  syncSettings,
  indexName: config.indexName
};
