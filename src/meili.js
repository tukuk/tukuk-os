const crypto = require('crypto');
const config = require('./config');
const fallback = require('./fallback');

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

function buildSynonyms(groups) {
  const synonyms = {};
  for (const group of groups) {
    for (const word of group) {
      synonyms[word] = group.filter((item) => item !== word);
    }
  }
  return synonyms;
}

const RANKING_RULES = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  'exactness'
];

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

// ── Klien Meilisearch SEBENAR (pakej `meilisearch`) ──────────────────────────
// SEBELUM ini, `client` yang dieksport ialah mock in-memory semata-mata. Akibat:
// carian runtime, grounding AI Sembang (/ask) dan MCP `tukuk_search` HANYA nampak
// ~puluhan artikel seed, BUKAN korpus crawl sebenar (puluh ribu dokumen) yang
// sudah pun ada di Meilisearch — dan hasil crawler ditulis ke mock lalu lesap
// setiap reboot.
//
// Sekarang kita guna klien sebenar, dengan mock sebagai SANDARAN AUTOMATIK bila
// Meilisearch tak dapat dicapai (ralat rangkaian / index belum sedia). Jadi
// tapak tidak mungkin menjadi lebih teruk daripada sebelum ini; worst case =
// kelakuan lama.
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

// Bungkus satu index: cuba Meilisearch sebenar; kalau throw, jatuh ke mock.
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
    return realClient ? realClient.waitForTask(taskUid) : { taskUid, status: 'succeeded' };
  },
  tasks: {
    async waitForTask(taskUid) {
      return realClient ? realClient.waitForTask(taskUid) : { taskUid, status: 'succeeded' };
    }
  }
};

async function ensureIndex({ logger = console } = {}) {
  const name = config.indexName;
  const idx = client.index(name);
  if (!realClient) {
    logger.log(`[meili] mock index (no real client): "${name}"`);
    return idx;
  }
  try {
    const stats = await realClient.index(name).getStats();
    logger.log(`[meili] index SEBENAR tersambung: "${name}" (${stats.numberOfDocuments} dokumen)`);
  } catch (err) {
    // Index belum wujud → cipta + terap tetapan supaya crawler mula guna.
    try {
      const created = await realClient.createIndex(name, { primaryKey: 'id' });
      await realClient.waitForTask(created.taskUid).catch(() => {});
      const task = await realClient.index(name).updateSettings(settings());
      await realClient.waitForTask(task.taskUid).catch(() => {});
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

module.exports = {
  client,
  ensureIndex,
  health,
  settings,
  indexName: config.indexName
};
