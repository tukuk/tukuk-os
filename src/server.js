const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const net = require('./net');
const store = require('./store');
const brain = require('./brain/provider');
const rag = require('./brain/rag');
const websearch = require('./brain/websearch');
const mediaSearch = require('./brain/media-search');
const reranker = require('./brain/reranker');
const news = require('./news');
const queries = require('./queries');
const answer = require('./answer');
const bingbot = require('./bingbot');
const { client, health } = require('./meili');
const crawler = require('./crawler');
const fallback = require('./fallback');
const nasa = require('./nasa');
const explore = require('./explore');
const { rateLimit, requireApiKey } = require('./middleware');
const { safeError, truncate, escapeHtml } = require('./util');
const { assertPublicUrl } = require('./util');
const auth = require('./auth');
const blogRedirects = require('./blog-redirects');
const publish = require('./publish');
const { exec } = require('child_process');

const index = client.index(config.indexName);

// Index korpus ujian yang boleh dipilih melalui ?index= pada /search.
// Indeks lain tidak dibenarkan supaya carian awam tidak boleh dialih sesuka hati.
const DEMO_INDEXES = new Set(['uji_coba']);

const START_TIME = Date.now();

// Jumlah seumur-hidup yang DISIMPAN ke cakera supaya /stats tidak set ke 0 setiap kali
// restart/deploy. requestCount/errorCount dimulakan daripada fail ini dan diflush berkala.
const LIFETIME_FILE = path.join(path.dirname(config.store.path), 'lifetime-stats.json');
let lifetime = { requests: 0, errors: 0, firstStartedAt: START_TIME };
try {
  const j = JSON.parse(fs.readFileSync(LIFETIME_FILE, 'utf8'));
  if (j && typeof j === 'object') {
    lifetime = {
      requests: Number(j.requests) || 0,
      errors: Number(j.errors) || 0,
      firstStartedAt: Number(j.firstStartedAt) || START_TIME
    };
  }
} catch { /* fail belum wujud — mula kosong */ }
let requestCount = lifetime.requests;
let errorCount = lifetime.errors;

function persistLifetime() {
  try {
    lifetime.requests = requestCount;
    lifetime.errors = errorCount;
    lifetime.firstStartedAt = Math.min(lifetime.firstStartedAt || START_TIME, START_TIME);
    fs.mkdirSync(path.dirname(LIFETIME_FILE), { recursive: true });
    const tmp = `${LIFETIME_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lifetime));
    fs.renameSync(tmp, LIFETIME_FILE);
  } catch { /* terbaik sahaja — jangan gagikan permintaan */ }
}
const lifetimeTimer = setInterval(persistLifetime, 20000);
if (lifetimeTimer.unref) lifetimeTimer.unref();
process.on('SIGTERM', persistLifetime);
process.on('SIGINT', persistLifetime);

const limiter = config.rateLimit.enabled
  ? {
      search: rateLimit({
        windowMs: config.rateLimit.searchWindowMs,
        max: config.rateLimit.searchMax,
        keyPrefix: 'search:'
      }),
      write: rateLimit({
        windowMs: config.rateLimit.writeWindowMs,
        max: config.rateLimit.writeMax,
        keyPrefix: 'write:'
      }),
      crawl: rateLimit({
        windowMs: config.rateLimit.writeWindowMs,
        max: config.rateLimit.crawlMax,
        keyPrefix: 'crawl:'
      }),
      websearch: rateLimit({
        windowMs: config.rateLimit.searchWindowMs,
        max: config.rateLimit.websearchMax,
        keyPrefix: 'websearch:'
      })
    }
  : { search: (req, res, next) => next(), write: (req, res, next) => next(), crawl: (req, res, next) => next(), websearch: (req, res, next) => next() };

// Borang hubungi: hadkan setiap pelawat kepada 5 hantaran / 10 minit
const contactLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 10 * 60 * 1000, max: 5, keyPrefix: 'contact:' })
  : (req, res, next) => next();

const app = express();
app.disable('x-powered-by');

// Security headers (Lighthouse "Trust & Safety"). Cloudflare boleh tambah di edge juga,
// tapi ini memastikan header ada tanpa mengira laluan (aplikasi terus, tunnel, dsb.).
// CSP DUA LAPISAN:
//  (1) ENFORCED — `CSP_ENFORCED` HANYA direktif struktur (frame-ancestors/object-src/
//      base-uri/form-action). Sengaja TIDAK menyentuh default-src/script-src/style-src,
//      jadi TiADA kerosakan: AdSense + `<script>` inline SPA + 62 atribut style= terus jalan.
//      Ini tetap memberi perlindungan nyata (clickjacking, penyisipan <base>/<object>/form).
//  (2) REPORT-ONLY — `CSP_REPORT_ONLY` = dasar ketat penuh (default/script-src dll.) untuk
//      kumpul telemetri ke /csp-report. Peralihan ke enforced PENUH butuh: esktraksi skrip
//      inline ke fail luar + de-inline 70 handler (onclick/onerror) + AdSense strict-dynamic/
//      nonce — kerja besar & wajib QA pelayar. Clickjacking juga dilindungi X-Frame-Options;
//      COOP = same-origin-allow-popups supaya popup OAuth/login (window.open) tak terputus.
const CSP_ENFORCED = [
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ') + ';';
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://adservice.google.com https://www.googletagservices.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: https: wss:",
  "media-src 'self' data: blob: https:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /csp-report",
].join('; ') + ';';
// (3) CSP_STRICT — untuk halaman STATIK yang terbukti bersih (0 handler inline, 0 <script>
//     inline — skripnya external sahaja, 0 rujukan iklan/analytics, dan player.js yang
//     disuntik theme.js tidak pakai `new Function`/`eval`). Untuk halaman ini kita ENFORCE
//     `script-src 'self'` TANPA unsafe-inline/unsafe-eval — inilah kemenangan Lighthouse
//     sebenar. Halaman interaktif (index/apps/nasa/editor/collage/studio*) TIDAK dahilkan
//     kerana ada <script> inline + handler + `new Function` (boleh rosak senyap).
const CSP_STRICT_PAGES = new Set(['about', 'privacy', 'terms', 'docs', 'access', 'tentang', 'terma', 'privasi', 'dokumen']);
const CSP_STRICT = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "media-src 'self' data: blob: https:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /csp-report",
].join('; ') + ';';
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-DNS-Prefetch-Control', 'on');
  // Halaman statik bersih → ENFORCE script-src penuh; selainnya → enforced struktur sahaja.
  const seg = req.path.replace(/^\/+/, '').replace(/\.html$/i, '').replace(/\/+$/, '').toLowerCase();
  res.setHeader('Content-Security-Policy', CSP_STRICT_PAGES.has(seg) ? CSP_STRICT : CSP_ENFORCED);
  res.setHeader('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
  // HSTS hanya bermakna atas HTTPS; tiada `preload` (butuh daftar + semua subdomain HTTPS dulu).
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// SEO: canonical host — semua permintaan www di301 ke apex
app.use((req, res, next) => {
  if (req.hostname === 'www.tukuk.org') {
    return res.redirect(301, `https://tukuk.org${req.originalUrl}`);
  }
  next();
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
// Gzip: semua teks (HTML/JSON) dipampatkan — halaman ~32KB jadi ~8KB.
app.use(compression());

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Akses global: beritahu Tor Browser tentang onion mirror automatik
// (header Onion-Location → Tor Browser tawar buka laman via onion).
const ONION_HOST = process.env.ONION_HOST || 'd33axv7iaq4sp5hlwjn7i2tovkuxmxc53xl2drjhve7mboitsoicdfid.onion';
app.use((req, res, next) => {
  if (!/\.[a-z0-9]+$/i.test(req.path) || req.path.endsWith('.html')) {
    res.setHeader('Onion-Location', `http://${ONION_HOST}${req.originalUrl}`);
  }
  next();
});

app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  maxAge: '1h',
  redirect: false,   // jangan redirect /apps → /apps/ — biar lalu ke STATIC_PAGES
  setHeaders(res, filePath) {
    // Service worker: JANGAN sekali cache — pelanggan mesti dapat versi terkini terus.
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-store');
    // HTML: biar revalidate setiap kali supaya kemas-kini segera kelihatan.
    else if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    // CSS/JS: revalidate setiap kali — kemas-kini gaya segera kelihatan (browser + edge cache).
    else if (/\.(css|js)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// Satu Kata — hidangkan hub app+game STATIK daripada generated/public (dijana cron
// GitHub Actions). Ini HILANGkan kebergantungan pada Cloudflare Pages & token API-nya;
// hanya fail HTML statik, jadi kos pada VPS sangat ringan. Tiada kata → hub di /satu-kata/.
const GENERATED_DIR = path.join(__dirname, '..', 'generated', 'public');
app.use('/satu-kata', express.static(GENERATED_DIR, {
  index: 'index.html',
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// URL bersih untuk halaman statik: /privacy -> public/privacy.html
const STATIC_PAGES = ['about', 'privacy', 'terms', 'contact', 'dev', 'terminal', 'settings', 'docs', 'nasa', 'explore', 'access', 'bingbot', 'editor', 'editor-video', 'movie', 'design', '3d', 'builder', 'studio', 'apps', 'bg-remover', 'collage'];
for (const name of STATIC_PAGES) {
  app.get(`/${name}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${name}.html`), (error) => {
      if (error) res.status(404).json({ error: 'Halaman tidak dijumpai', path: req.originalUrl });
    });
  });
}

// Sub-page untuk setiap app: /apps/notes → public/apps/notes.html
const APPS = ['notes', 'calc', 'todo', 'convert', 'timer', 'color', 'password', 'text'];
for (const name of APPS) {
  app.get(`/apps/${name}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'apps', `${name}.html`), (error) => {
      if (error) res.status(404).json({ error: `App '${name}' belum wujud`, path: req.originalUrl });
    });
  });
}
// Alias /apps/ → sama seperti /apps
app.get('/apps/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'apps.html')));

// Alias bahasa supaya pautan sedia ada tidak 404
const PAGE_ALIASES = { tentang: 'about', hubungi: 'contact', terma: 'terms', privasi: 'privacy', dokumen: 'docs' };
for (const [alias, name] of Object.entries(PAGE_ALIASES)) {
  app.get(`/${alias}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${name}.html`), (error) => {
      if (error) res.status(404).json({ error: 'Halaman tidak dijumpai', path: req.originalUrl });
    });
  });
}

app.get("/test", (req, res) => res.send("OK"));

// CSP Report-Only receiver — browser POST JSON bertipe `application/csp-report` ke sini.
// Bukan kritikal: cuma log baris ringkas (matikan dgn CSP_REPORTS=0) & balas 204. Tiada
// PII disimpan; had body 16kb supaya tak boleh digunakan utk spam.
app.post('/csp-report', express.json({ type: ['application/csp-report', 'application/json'], limit: '16kb' }), (req, res) => {
  if (process.env.CSP_REPORTS !== '0') {
    const r = (req.body && req.body['csp-report']) || {};
    console.log(`[csp-report] directive=${r['violated-directive'] || r['effective-directive'] || '?'} blocked=${r['blocked-uri'] || '?'} page=${r['document-uri'] || '?'}`);
  }
  res.status(204).end();
});

// Negotiasi kandungan: pelayar (Accept: text/html) dapat halaman HTML yang cantik;
// skrip/API/agent (curl default, fetch Accept:*/*) kekal dapat JSON seperti sebelum ini.
function isHtmlRequest(req) {
  return req.accepts(['json', 'html']) === 'html';
}

// ——— IndexNow: beritahu enjin carian (Bing/Yandex/Naver/Seznam) serta-merta bila
// kandungan baharu diterbitkan. Non-blocking, ralat diabaikan. Dimatikan jika tiada key.
const INDEXNOW_KEY = (process.env.INDEXNOW_KEY || 'bd8f0317c5ab4cddb9a3dc62f7ec15ae').trim();
function notifyIndexNow(urls) {
  if (!INDEXNOW_KEY || !process.env.INDEXNOW_ENABLED) return; // opt-in supaya tak bazir derma permintaan
  const list = (Array.isArray(urls) ? urls : [urls]).filter(u => typeof u === 'string' && u.startsWith('https://tukuk.org/'));
  if (!list.length) return;
  fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'tukuk.org', key: INDEXNOW_KEY, keyLocation: `https://tukuk.org/${INDEXNOW_KEY}.txt`, urlList: list })
  }).catch(() => {}); // senyap — pengindeksan ialah penambahbaikan, bukan kritikal
}

// Halaman HASIL carian — SPA yang sama dengan index.html, tetapi pada URL
// berasingan. Ini memisahkan permukaan iklan: `/` = dashboard kandungan original
// (layak AdSense), `/cari` = hasil carian pihak ketiga (KOSONG iklan, mematuhi
// dasar Google "no ads on web-search result pages").
app.get('/cari', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (error) => {
    if (error) res.status(404).json({ error: 'Halaman tidak dijumpai', path: req.originalUrl });
  });
});

// Proksi imej luar — untuk lightbox & Tukuk Studio (/editor).
// Same-origin = canvas tidak "tainted", export/edge filter boleh jalan.
app.get('/api/image', limiter.search, async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'Parameter url (http/https) diperlukan' });
  }
  try {
    await assertPublicUrl(targetUrl); // sekat SSRF alamat dalaman
    const upstream = await fetch(targetUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TukukOSBot/2.1; +https://tukuk.org)' }
    });
    if (!upstream.ok) return res.status(502).json({ error: `Remote responded ${upstream.status}` });
    const ct = upstream.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) return res.status(415).json({ error: `Bukan imej (${ct || 'unknown'})` });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) return res.status(413).json({ error: 'Imej terlalu besar (max 15MB)' });
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: 'Gagal proksi imej', details: safeError(error) });
  }
});

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  requestCount += 1;
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;
    if (res.statusCode >= 400) {
      errorCount += 1;
      console.error(`[http] ${line}`);
    } else if (process.env.LOG_REQUESTS !== '0') {
      console.log(`[http] ${line}`);
    }
  });
  next();
});

function clampLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return config.search.defaultLimit;
  return Math.min(limit, config.search.maxLimit);
}

const FACETS = ['host', 'lang', 'type', 'siteName', 'keywords', 'section'];

function literal(value) {
  return `"${String(value).replace(/["\\]/g, '\\$&')}"`;
}

function buildFilter(query) {
  const filters = [];

  if (query.host) {
    const hosts = String(query.host).split(',').map((item) => item.trim()).filter(Boolean);
    filters.push(`(${hosts.map((host) => `host = ${literal(host)}`).join(' OR ')})`);
  }
  if (query.lang) {
    const langs = String(query.lang).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    filters.push(`(${langs.map((lang) => `lang = ${literal(lang)}`).join(' OR ')})`);
  }
  if (query.type) {
    const types = String(query.type).split(',').map((item) => item.trim()).filter(Boolean);
    filters.push(`(${types.map((type) => `type = ${literal(type)}`).join(' OR ')})`);
  }
  if (query.site) filters.push(`siteName = ${literal(String(query.site).trim())}`);
  if (query.section) filters.push(`section = ${literal(String(query.section).trim())}`);

  if (query.after) filters.push(`crawledAt > ${literal(String(query.after))}`);
  if (query.before) filters.push(`crawledAt < ${literal(String(query.before))}`);

  if (query.minWords) filters.push(`wordCount >= ${Number.parseInt(query.minWords, 10) || 0}`);

  if (query.excludeHost) {
    const hosts = String(query.excludeHost).split(',').map((item) => item.trim()).filter(Boolean);
    filters.push(`(${hosts.map((host) => `host != ${literal(host)}`).join(' AND ')})`);
  }

  return filters.join(' AND ');
}

const HIGHLIGHT_FIELDS = ['title', 'description', 'headings', 'content'];

function buildSearchParams(query) {
  const params = {
    limit: clampLimit(query.limit),
    offset: Math.max(0, Number.parseInt(query.offset, 10) || 0),
    attributesToHighlight: HIGHLIGHT_FIELDS,
    attributesToCrop: ['content'],
    cropLength: config.search.cropLength,
    highlightPreTag: config.search.highlightPreTag,
    highlightPostTag: config.search.highlightPostTag,
    showMatchesPosition: true,
    matchingStrategy: query.smart === 'false' ? 'last' : 'frequency'
  };

  const filter = buildFilter(query);
  if (filter) params.filter = filter;

  if (query.sort === 'newest') params.sort = ['publishedAt:desc', 'crawledAt:desc'];
  else if (query.sort === 'oldest') params.sort = ['publishedAt:asc'];
  else if (query.sort === 'longest') params.sort = ['wordCount:desc'];
  else if (query.sort === 'shortest') params.sort = ['wordCount:asc'];

  if (query.facets !== 'false') params.facets = [...FACETS];
  if (query.attributes) params.attributesToRetrieve = String(query.attributes).split(',').map((item) => item.trim());

  return params;
}

function reshape(hit, { includeContent = false } = {}) {
  const { _formatted, _matchesPosition, content, ...rest } = hit;
  const formatted = _formatted || {};
  const highlights = Object.fromEntries(
    Object.entries(formatted).filter(
      ([key, value]) =>
        HIGHLIGHT_FIELDS.includes(key) &&
        typeof value === 'string' &&
        value.includes(config.search.highlightPreTag)
    )
  );

  return {
    ...rest,
    snippet: formatted.content
      ? `${formatted.content}…`
      : truncate(rest.description, 200),
    highlights,
    matchedTerms: _matchesPosition ? Object.keys(_matchesPosition) : [],
    ...(includeContent ? { content } : {})
  };
}

app.get('/ask', limiter.search, async (req, res) => {
  const question = String(req.query.q || req.query.question || '').trim();
  if (!question) {
    return res.status(400).json({ error: 'Question required (parameter q)' });
  }

  if (!config.brain.enabled) {
    return res.status(503).json({ error: 'Brain engine disabled (BRAIN_ENABLED=false)' });
  }

  const health = await brain.health();
  // Jangan blok walaupun Ollama mati — rag.ask akan guna cloud (jika ada kunci) atau jawapan ekstraktif.

  try {
    const offline = !net.snapshot().internet;
    const answer = await rag.ask(question);
    store.recordAsk(question, {
      mode: answer.mode,
      tookMs: answer.tookMs,
      sources: answer.sources.length,
      offline
    });
    const backendName = health.cloud ? health.provider : (health.online ? 'ollama' : 'extractive');
    res.json({
      question,
      answer: answer.answer,
      mode: answer.mode,
      model: answer.model,
      provider: backendName,
      sources: answer.sources,
      tookMs: answer.tookMs,
      cached: Boolean(answer.cached),
      offline,
      warning: answer.warning,
      network: net.snapshot().status
    });
  } catch (error) {
    res.status(500).json({ error: 'Otak gagal menjawab', details: safeError(error) });
  }
});

app.get('/brain', async (req, res) => {
  const [health, network] = await Promise.all([brain.health(), net.check()]);
  res.json({
    enabled: config.brain.enabled,
    provider: health.cloud ? health.provider : (health.online ? 'ollama' : 'extractive'),
    cloud: Boolean(health.cloud),
    extractiveOnly: Boolean(health.extractiveOnly),
    host: config.brain.ollamaHost,
    chain: config.brain.chain,
    activeModel: health.model,
    online: health.online,
    models: health.models || [],
    satisfied: health.satisfied,
    parameters: {
      temperature: config.brain.temperature,
      maxTokens: config.brain.maxTokens,
      contextWindow: config.brain.contextWindow,
      timeout: config.brain.timeout,
      retrievalLimit: config.brain.retrievalLimit
    },
    answerCache: rag.cacheStats(),
    network,
    note:
      'Model 135M hanya boleh bergantung kepada sumber yang diberikan. ' +
      'Tanpa sumber, jawapannya tidak boleh dipercayai.'
  });
});

app.get('/network', async (req, res) => {
  res.json(await net.check());
});

app.get('/sitemap.xml', async (req, res) => {
  const host = req.get('host') || 'tukuk.org';
  const base = host.includes('tukuk.org') ? `https://${host}` : `${req.protocol}://${host}`;
  const staticPages = ['', '/nasa', '/explore', '/docs', '/about', '/privacy', '/terms', '/contact', '/blog', '/access', '/learn', '/bingbot'];
  const posts = store.getAllPosts(200);
  
  const urls = [];
  for (const page of staticPages) {
    // Homepage ikut canonical (akhiran '/'); halaman lain tanpa slash
    const loc = page === '' ? `${base}/` : `${base}${page}`;
    urls.push(`  <url>\n    <loc>${loc}</loc>\n    <changefreq>daily</changefreq>\n    <priority>${page === '' ? '1.0' : '0.8'}</priority>\n  </url>`);
  }
  for (const post of posts) {
    const lastMod = post.updatedAt ? post.updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    urls.push(`  <url>\n    <loc>${base}/blog/${encodeURIComponent(post.slug)}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`);
  }

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join('\n') +
    `\n</urlset>\n`
  );
});

// Blog templates & markdown parser
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>')
    .replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>');
  
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
  html = html.split('\n\n').map(p => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol') || p.startsWith('<li')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

const COMMON_CSS = `
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e6e9ef; --muted:#9aa3b2; --accent:#4c8dff; --code-bg:#12151c; }
  @media (prefers-color-scheme: light) { :root { --bg:#f7f8fa; --panel:#fff; --line:#e3e6ec; --text:#151922; --muted:#5c6472; --accent:#1f6feb; --code-bg:#f0f3f8; } }
  * { box-sizing:border-box; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.75 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:0 20px; }
  header { padding:48px 0 16px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 8px; font-size:2.2rem; letter-spacing:-.5px; }
  h2 { margin:34px 0 10px; font-size:1.3rem; }
  h3 { margin:22px 0 8px; font-size:1.08rem; color:var(--accent); }
  .tagline { color:var(--muted); font-size:1.05rem; margin:0; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  nav { display:flex; gap:16px; flex-wrap:wrap; margin:18px 0 0; font-size:.92rem; }
  footer { margin:54px 0 36px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:.88rem; text-align:center; }
  .post-card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:22px; margin:22px 0; transition:border-color .2s; }
  .post-card:hover { border-color:var(--accent); }
  .post-card h2 { margin:0 0 8px; font-size:1.4rem; }
  .meta { color:var(--muted); font-size:.88rem; margin-bottom:12px; }
  .tags { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
  .tag { background:var(--bg); border:1px solid var(--line); border-radius:4px; padding:2px 8px; font-size:.8rem; color:var(--muted); }
  article { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:28px; margin:28px 0; }
  code { background:var(--code-bg); border:1px solid var(--line); border-radius:4px; padding:2px 6px; font-size:.9em; font-family:monospace; }
  ul, ol { padding-left:24px; margin:14px 0; }
  li { margin-bottom:6px; }
  .back-link { display:inline-block; margin-bottom:16px; font-size:.92rem; }
  .ad-slot { margin:24px 0; overflow:hidden; }
`;

// Blog routes
// AdSense: hanya papar unit bila AKTIF + client `ca-pub-…` sah + slot numerik
// SEBENAR. Placeholder `2206273113` dianggap belum dikonfigurasi → return ''
// (laman kekal bersih iklan sampai ID sebenar ditampal di Admin → paste-and-go).
const ADSENSE_PLACEHOLDER = '2206273113';
function adsenseClient() {
  const c = String(store.getSetting('adsClient', config.adsense.client) || '').trim();
  return /^ca-pub-\d+$/.test(c) ? c : '';
}
function adsenseOn() {
  return config.adsense.enabled && adsenseClient();
}
function realSlot(slot) {
  const s = String(slot || '').trim();
  return /^\d+$/.test(s) && s !== ADSENSE_PLACEHOLDER ? s : '';
}
// Slot boleh dikonfigur via Admin (store: adsSlotTop/adsSlotInArticle/adsSlotBottom)
// dengan fallback ke env/config. `label` dari pemanggil menentukan kunci store.
const ADSENSE_STORE_KEYS = { top: 'adsSlotTop', 'in-article': 'adsSlotInArticle', bottom: 'adsSlotBottom' };
function adUnit(slot, label) {
  const client = adsenseOn();
  const storeKey = ADSENSE_STORE_KEYS[label];
  const raw = storeKey ? store.getSetting(storeKey, slot) : slot;
  const s = realSlot(raw);
  if (!client || !s) return '';
  return `<ins class="adsbygoogle" style="display:block" data-ad-client="${client}" data-ad-slot="${s}" data-ad-format="auto" data-full-width-responsive="true"></ins>` +
    `<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
}
// Script pemuat Adsense satu kali di <head> (hanya bila aktif + client sah).
function adsenseLoader() {
  const client = adsenseOn();
  if (!client) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;
}

// Microsoft Ads / rangkaian lain: Admin tampal snippet HTML/JS penuh dari
// pembekal (mis. Microsoft monetizenow). Kita inject APA ADANYA bila msAdsEnabled.
// Reka bentuk ini elak daripada aku mereka markup MS yang mungkin salah.
// Field store: msAdsSnippetTop / msAdsSnippetInArticle / msAdsSnippetBottom.
const MSADS_STORE_KEYS = { top: 'msAdsSnippetTop', 'in-article': 'msAdsSnippetInArticle', bottom: 'msAdsSnippetBottom' };
function msAdUnit(label) {
  if (!store.getSetting('msAdsEnabled', false)) return '';
  const key = MSADS_STORE_KEYS[label];
  if (!key) return '';
  const raw = String(store.getSetting(key, '') || '').trim();
  return raw ? `<div class="ad-slot" data-ad-network="ms-${label}">${raw}</div>` : '';
}

app.get('/blog', (req, res) => {
  const posts = store.getAllPosts(100);
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blog &amp; Tech Knowledge Base &mdash; Tukuk-OS</title>
<meta name="description" content="Articles, tutorials and analysis on search engine technology, data privacy and artificial intelligence from Tukuk-OS.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="Blog &amp; Tech Knowledge Base — Tukuk-OS">
<meta property="og:description" content="Articles, tutorials and analysis on search engine technology, data privacy and artificial intelligence from Tukuk-OS.">
<meta property="og:url" content="https://tukuk.org/blog">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Blog &amp; Tech Knowledge Base — Tukuk-OS">
<meta name="twitter:description" content="Articles, tutorials and analysis on search engine technology, data privacy and artificial intelligence from Tukuk-OS.">
<meta name="twitter:image" content="https://tukuk.org/og.png">
<link rel="canonical" href="https://tukuk.org/blog">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${COMMON_CSS}</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${adsenseLoader()}
</head>
<body>
<div class="wrap">
  <header>
    <h1>Blog &amp; Knowledge Archive</h1>
    <p class="tagline">In-depth articles on search engine technology, cybersecurity, semantic AI and web privacy.</p>
    <nav>
      <a href="/">Home</a>
      <a href="/explore">Explore</a>
      <a href="/nasa">NASA</a>
      <a href="/learn">Learn</a>
      <a href="/blog">Blog</a>
      <a href="/docs">Docs</a>
      <a href="/about">About</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/contact">Contact</a>
      <span class="theme-tools">
        <button type="button" id="theme-toggle" class="tk-btn" aria-label="Colour theme">◐</button>
        <span class="tk-accents" role="group" aria-label="Accent colour">
          <button type="button" data-accent-set="blue" class="tk-dot" aria-label="Blue"></button>
          <button type="button" data-accent-set="green" class="tk-dot" aria-label="Green"></button>
          <button type="button" data-accent-set="violet" class="tk-dot" aria-label="Violet"></button>
          <button type="button" data-accent-set="amber" class="tk-dot" aria-label="Amber"></button>
          <button type="button" data-accent-set="rose" class="tk-dot" aria-label="Rose"></button>
        </span>
      </span>
    </nav>
  </header>
  <main>${adUnit(config.adsense.slotTop, 'top')}${msAdUnit('top')}`;

  for (const post of posts) {
    const postDate = new Date(post.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    html += `
    <div class="post-card">
      <h2><a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
      <div class="meta">${postDate} &middot; Author: ${escapeHtml(post.author || 'Fevian Donald')}</div>
      <p>${escapeHtml(post.excerpt)}</p>
      ${post.tags && post.tags.length ? `<div class="tags">${post.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  html += `
  ${adUnit(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
  <footer>
    <p>&copy; 2026 Tukuk-OS &mdash; All rights reserved. A free and open web search engine.</p>
  </footer>
</div>
</body>
</html>`;
  res.send(html);
});

// Kurikulum "Tukuk-OS 0 -> Hero": susunan pembelajaran merentas semua artikel.
const LEARN_STAGES = [
  {
    n: '0',
    title: 'Zero — Start From Nothing',
    blurb: 'Machine basics, your first page, and the mindset that keeps you going.',
    slugs: [
      'what-is-tukuk-os',
      'learn-programming-by-building-zero-to-hero',
      'from-broken-laptop-to-first-attempt',
      'learning-ubuntu-from-zero-to-terminal',
      '10-terminal-commands-i-still-use',
      'my-first-html-and-css-page',
      'my-first-javascript',
    ],
  },
  {
    n: '1',
    title: 'Build — Foundations of the Web',
    blurb: 'Servers, HTTP, version control, testing, and debugging like a professional.',
    slugs: [
      'my-first-nodejs-server',
      'why-i-chose-nodejs-and-express',
      'http-and-apis-fundamentals',
      'http-status-codes-and-when-to-use-them',
      'git-and-github-for-solo-projects',
      'testing-your-nodejs-app-without-ceremony',
      'logging-and-debugging-in-production',
      'browser-devtools-for-backend-people',
      'git-bisect-finding-the-commit-that-broke-it',
      'race-conditions-in-nodejs-async-bugs',
      'off-by-one-and-common-logic-bugs',
      'famous-software-bugs-that-changed-engineering',
    ],
  },
  {
    n: '2',
    title: 'Search — Inside the Engine',
    blurb: 'Crawling, inverted indexes, ranking, and the search index that powers it all.',
    slugs: [
      'my-first-web-crawler',
      'how-crawlers-collect-documents-for-indexing',
      'building-an-inverted-index-by-hand',
      'inverted-index-behind-search',
      'how-modern-search-engines-work',
      'meilisearch-beginners-guide',
      'getting-to-know-meilisearch-fast-search-engine',
      'meilisearch-fast-indexing-for-tukuk-os',
      'bm25-relevance-explained',
      'image-and-video-search-in-tukuk-os',
    ],
  },
  {
    n: '3',
    title: 'Ship — Deploy, Protect, Stay Reachable',
    blurb: 'Domains, HTTPS, caching, abuse protection — and staying online when someone tries to stop you.',
    slugs: [
      'cloudflare-tunnel-and-a-free-domain',
      'nginx-reverse-proxy-cloudflare-guide',
      'cloudflare-workers-serverless-at-edge',
      'http2-and-http3-quic-brief-guide',
      'caching-strategy-and-circuit-breakers',
      'redis-cache-for-fast-web-apps',
      'service-worker-caching-network-first-vs-cache-first',
      'rate-limiting-and-basic-abuse-protection',
      'understanding-progressive-web-apps',
      'cloudflare-anycast-global-availability',
      'why-no-website-is-100-percent-unblockable',
      'tor-onion-services-for-websites',
      'onion-location-header-explained',
      'dns-over-https-explained',
    ],
  },
  {
    n: '4',
    title: 'Grow — Traffic, Content, Money',
    blurb: 'SEO, indexing pipelines, analytics without cookies, and keeping the lights funded.',
    slugs: [
      'seo-for-new-blogs-10-practical-steps',
      'seo-on-page-content-google-loves',
      'web-optimization-basic-and-technical-seo',
      'indexnow-submit-urls-instantly-to-bing',
      'rss-feeds-for-news-discovery',
      'inline-video-player-embeds',
      'the-tukuk-os-blogging-system',
      'cookieless-web-analytics-ga-alternatives',
      'adsense-for-small-blogs-an-honest-guide',
      'contact-form-and-cloudflare-email',
      'automation-backups-and-watchdogs',
      'building-a-backup-system-with-cloudflare',
      'monitoring-uptime-for-free',
      'launch-checklist-for-a-side-project',
      'the-real-cost-of-running-tukuk-os',
    ],
  },
  {
    n: '5',
    title: 'Master — Privacy, AI, Philosophy',
    blurb: 'The ideas layer: data ownership, honest AI answers, and the story of Tukuk-OS itself.',
    slugs: [
      'privacy-without-tracking-cookies',
      'local-ai-privacy-no-data-to-cloud',
      'digital-privacy-and-free-web-search',
      'data-sovereignty-free-search-infrastructure',
      'cybersecurity-guide-protecting-your-privacy',
      'extractive-vs-abstractive-ai-answers',
      'future-of-ai-semantic-search-and-rag',
      'parsing-search-results-language-market-signals',
      'how-tukuk-os-became-a-free-web-search-engine',
      'tukuk-os-complete-feature-tour',
      'tukuk-os-is-alive-reflections',
      'tukuk-os-bug-retrospective',
    ],
  },
];

app.get('/learn', (req, res) => {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tukuk-OS Academy: Zero to Hero Learning Path</title>
<meta name="description" content="A free six-stage curriculum: from your first terminal command to running, defending and growing your own search engine.">
<link rel="canonical" href="https://tukuk.org/learn">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="Tukuk-OS Academy: Zero to Hero Learning Path">
<meta property="og:description" content="A free six-stage curriculum: from your first terminal command to running, defending and growing your own search engine.">
<meta property="og:url" content="https://tukuk.org/learn">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Tukuk-OS Academy: Zero to Hero Learning Path">
<meta name="twitter:description" content="A free six-stage curriculum: from your first terminal command to running, defending and growing your own search engine.">
<meta name="twitter:image" content="https://tukuk.org/og.png">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#4c8dff">
<style>${COMMON_CSS}
.stage-head{display:flex;align-items:baseline;gap:12px;margin:44px 0 6px;}
.stage-num{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:38px;border-radius:50%;
  background:var(--accent-fill,#2a6edb);color:#fff;font-weight:700;font-size:1rem;flex:none;}
.stage-title{margin:0;font-size:1.3rem;}
.stage-blurb{color:#9aa3b2;margin:4px 0 14px 50px;}
.stage-list{list-style:none;margin:0 0 8px;padding:0 0 0 50px;counter-reset:lesson;}
.stage-list li{counter-increment:lesson;position:relative;padding:9px 12px 9px 44px;border-bottom:1px solid var(--line,#262b36);}
.stage-list li::before{content:counter(lesson);position:absolute;left:8px;top:9px;width:24px;height:24px;border-radius:6px;
  background:var(--panel,#171a21);border:1px solid var(--line,#262b36);font-size:.75rem;display:flex;align-items:center;justify-content:center;color:#9aa3b2;}
.stage-list a{font-weight:600;text-decoration:none;color:inherit;}
.stage-list a:hover{color:var(--accent,#4c8dff);text-decoration:underline;}
.stage-list .ex{display:block;font-size:.88rem;color:#9aa3b2;font-weight:400;margin-top:2px;}
.learn-intro{font-size:1.05rem;}
.badge-count{display:inline-block;background:rgba(76,141,255,.15);border:1px solid rgba(76,141,255,.35);color:var(--accent,#4c8dff);
  border-radius:999px;padding:2px 12px;font-size:.85rem;font-weight:600;margin-left:8px;}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
</head>
<body>
<div class="wrap">
  <header>
    <h1>Tukuk-OS Academy<span class="badge-count" id="lesson-count"></span></h1>
    <p class="tagline">Zero to Hero: one free curriculum from your first terminal command to running, defending and growing your own search engine.</p>
    <p class="learn-intro">Follow the stages in order — each lesson assumes only what came before it. Stuck at any point? Start at <a href="/learn">Stage 0</a> and keep the <a href="/blog">full archive</a> within reach.</p>
    <nav>
      <a href="/">Home</a>
      <a href="/learn">Learn</a>
      <a href="/blog">Blog</a>
      <a href="/explore">Explore</a>
      <a href="/docs">Docs</a>
      <a href="/about">About</a>
      <a href="/access">Global Access</a>
    </nav>
  </header>
  <main>`;

  let lessonNo = 0;
  for (const stage of LEARN_STAGES) {
    html += `
    <div class="stage-head"><span class="stage-num">${stage.n}</span><h2 class="stage-title">${stage.title}</h2></div>
    <p class="stage-blurb">${stage.blurb}</p>
    <ol class="stage-list">`;
    for (const slug of stage.slugs) {
      const post = store.getPostBySlug(slug);
      if (!post) continue;
      lessonNo += 1;
      html += `
      <li><a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a><span class="ex">${escapeHtml(post.excerpt || '')}</span></li>`;
    }
    html += `
    </ol>`;
  }

  html += `
  </main>
  <footer>
    <p>&copy; 2026 Tukuk-OS &mdash; All rights reserved. A free and open web search engine.</p>
  </footer>
</div>
<script>document.getElementById('lesson-count').textContent='${lessonNo} lessons';</script>
</body>
</html>`;
  res.send(html);
});

app.get('/blog/:slug', (req, res) => {
  const post = store.getPostBySlug(req.params.slug);
  if (!post) {
    const redirectTo = blogRedirects[req.params.slug];
    if (redirectTo) return res.redirect(301, `/blog/${encodeURIComponent(redirectTo)}`);
    return res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Article Not Found &mdash; Tukuk-OS</title><style>${COMMON_CSS}</style><script src="/theme.js"></script><link rel="stylesheet" href="/theme.css"></head><body><div class="wrap" style="padding-top:60px"><h1>404 &mdash; Article not found</h1><p>Sorry, the article you are looking for does not exist or has moved.</p><p><a href="/blog">&larr; Back to the blog</a></p></div></body></html>`);
  }

  const postDate = new Date(post.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const renderedContent = renderMarkdown(post.content);

  // Nilai lolos-HTML untuk mengelakkan XSS dalam kepala/meta & badan.
  const eTitle = escapeHtml(post.title);
  const eTitleAttr = escapeHtml(post.title);
  const eExcerptAttr = escapeHtml(post.excerpt || '');
  const eAuthor = escapeHtml(post.author || 'Fevian Donald');

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "description": post.excerpt,
    "author": {
      "@type": "Person",
      "name": post.author || "Fevian Donald"
    },
    "datePublished": post.createdAt,
    "dateModified": post.updatedAt || post.createdAt,
    "mainEntityOfPage": `https://tukuk.org/blog/${post.slug}`,
    "publisher": {
      "@type": "Organization",
      "name": "Tukuk-OS",
      "url": "https://tukuk.org"
    }
  }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${eTitle} &mdash; Tukuk-OS</title>
<meta name="description" content="${eExcerptAttr}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${eTitleAttr}">
<meta property="og:description" content="${eExcerptAttr}">
<meta property="og:url" content="https://tukuk.org/blog/${encodeURIComponent(post.slug)}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="article:published_time" content="${escapeHtml(post.createdAt)}">
<meta property="article:author" content="${eAuthor}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${eTitleAttr}">
<meta name="twitter:description" content="${eExcerptAttr}">
<meta name="twitter:image" content="https://tukuk.org/og.png">
<link rel="canonical" href="https://tukuk.org/blog/${encodeURIComponent(post.slug)}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${jsonLd}</script>
<style>${COMMON_CSS}</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${adsenseLoader()}
</head>
<body>
<div class="wrap">
  <header>
    <a href="/blog" class="back-link">&larr; Back to all articles</a>
    <h1>${eTitle}</h1>
    <div class="meta">Published: ${postDate} &middot; Author: ${eAuthor}</div>
    <nav>
      <a href="/">Home</a>
      <a href="/explore">Explore</a>
      <a href="/nasa">NASA</a>
      <a href="/blog">Blog</a>
      <a href="/docs">Docs</a>
      <a href="/about">About</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/contact">Contact</a>
      <span class="theme-tools">
        <button type="button" id="theme-toggle" class="tk-btn" aria-label="Colour theme">◐</button>
        <span class="tk-accents" role="group" aria-label="Accent colour">
          <button type="button" data-accent-set="blue" class="tk-dot" aria-label="Blue"></button>
          <button type="button" data-accent-set="green" class="tk-dot" aria-label="Green"></button>
          <button type="button" data-accent-set="violet" class="tk-dot" aria-label="Violet"></button>
          <button type="button" data-accent-set="amber" class="tk-dot" aria-label="Amber"></button>
          <button type="button" data-accent-set="rose" class="tk-dot" aria-label="Rose"></button>
        </span>
      </span>
    </nav>
  </header>
  <main>
    ${adUnit(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    <article>
      ${renderedContent}
      ${adUnit(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
      ${post.tags && post.tags.length ? `<div class="tags" style="margin-top:28px; padding-top:16px; border-top:1px solid var(--line);">${post.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </article>
    ${adUnit(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
  <footer>
    <p>&copy; 2026 Tukuk-OS &mdash; All rights reserved. A free and open web search engine.</p>
  </footer>
</div>
</body>
</html>`;
  res.send(html);
});

app.get('/api', (req, res) => {
  res.json({
    name: 'Tukuk-OS Search API',
    version: '2.0.0',
    documentation: 'https://tukuk.org/docs',
    auth: config.security.apiKey ? 'X-API-Key required on mutation routes' : 'none',
    endpoints: [
      { method: 'GET', path: '/search', description: 'Full search with highlighting, facets and filters' },
      { method: 'GET', path: '/suggest', description: 'Autocomplete suggestions' },
      { method: 'GET', path: '/answer', description: 'AI answer card for a query (grounded in index + web results)' },
      { method: 'GET', path: '/trending', description: 'Trending queries from the last 7 days' },
      { method: 'GET', path: '/api/bingbot', description: 'Verify an IP is Bingbot (rDNS + forward-confirm + published list)' },
      { method: 'GET', path: '/websearch', description: 'Web search (merged: Bing, Brave, Wikipedia, DDG + tech verticals)' },
      { method: 'GET', path: '/images', description: 'Web image search' },
      { method: 'GET', path: '/music', description: 'Music search (iTunes)' },
      { method: 'GET', path: '/radio', description: 'Live internet radio stations' },
      { method: 'GET', path: '/videos', description: 'Web video search' },
      { method: 'GET', path: '/news', description: 'News search (RSS: BBC, TechCrunch, The Verge, NASA, Hacker News)' },
      { method: 'GET', path: '/health', description: 'Service status' },
      { method: 'GET', path: '/stats', description: 'Index metrics and settings' },
      { method: 'GET', path: '/sitemap.xml', description: 'XML sitemap' },
      { method: 'GET', path: '/blog', description: 'Blog article listing' },
      { method: 'GET', path: '/api/explore/earthquakes', description: 'Earthquakes, last 7 days (USGS)' },
      { method: 'GET', path: '/api/explore/countries', description: 'Country data (World Bank)' },
      { method: 'GET', path: '/api/explore/geocode', description: 'Geocode place names (Open-Meteo)' },
      { method: 'GET', path: '/api/explore/weather', description: 'Weather and forecast (Open-Meteo)' },
      { method: 'GET', path: '/api/explore/sun', description: 'Sunrise and sunset times' },
      { method: 'GET', path: '/api/explore/arxiv', description: 'Research papers (arXiv)' },
      { method: 'GET', path: '/api/explore/ip', description: 'Visitor IP geolocation' },
      { method: 'GET', path: '/api/nasa/iss', description: 'Live ISS position & telemetry (wheretheiss.at)' },
      { method: 'GET', path: '/api/nasa/crew', description: 'Who is in space right now (open-notify.org)' },
      { method: 'GET', path: '/api/nasa/asset', description: 'Direct mp4 asset for a NASA media id' },
      { method: 'GET', path: '/api/nasa/apod', description: 'Astronomy Picture of the Day' },
      { method: 'GET', path: '/api/nasa/asteroids', description: 'Near-Earth asteroids (NeoWs)' },
      { method: 'GET', path: '/api/nasa/experiments/asteroid-trend', description: 'Experiment: asteroid approach trend (weeks)' },
      { method: 'GET', path: '/api/nasa/experiments/solar', description: 'Experiment: solar flares & CME (days)' },
      { method: 'POST', path: '/api/contact', description: 'Contact form submission' },
      { method: 'GET', path: '/api/contact/messages', description: 'Read stored contact messages', auth: true },
      { method: 'POST', path: '/crawl', description: 'Crawl a single URL', auth: true },
      { method: 'POST', path: '/crawl/batch', description: 'Crawl a list of URLs', auth: true },
      { method: 'POST', path: '/crawl/sitemap', description: 'Crawl URLs from a sitemap', auth: true },
      { method: 'POST', path: '/crawl/site', description: 'BFS crawl of a whole site', auth: true },
      { method: 'POST', path: '/documents', description: 'Index documents directly', auth: true },
      { method: 'DELETE', path: '/documents/:id', description: 'Delete a document', auth: true },
      { method: 'POST', path: '/settings', description: 'Update search settings', auth: true }
    ],
    parameterSearch: ['q', 'limit', 'offset', 'host', 'lang', 'type', 'site', 'section',
      'minWords', 'excludeHost', 'after', 'before', 'sort', 'facets', 'full', 'smart']
  });
});

app.get('/health', async (req, res) => {
  try {
    const meiliHealth = await health();
    const serverStats = await index.getStats();
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      meilisearch: meiliHealth.status,
      documents: serverStats.numberOfDocuments,
      rerank: reranker.status,
      crawler: crawler.snapshot()
    });
  } catch (error) {
    res.status(503).json({ status: 'degraded', meilisearch: 'unreachable', error: safeError(error) });
  }
});

app.get('/stats', limiter.search, async (req, res) => {
  try {
    const [indexStats, settings] = await Promise.all([index.getStats(), index.getSettings()]);
    const data = {
      documents: indexStats.numberOfDocuments,
      indexSize: indexStats.indexSize,
      searchableAttributes: settings.searchableAttributes,
      rankingRules: settings.rankingRules,
      filters: settings.filterableAttributes,
      fallbackCache: fallback.size(),
      crawler: crawler.snapshot(),
      http: { requests: requestCount, errors: errorCount, firstStartedAt: new Date(lifetime.firstStartedAt).toISOString() },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        startedAt: new Date(START_TIME).toISOString()
      }
    };
    if (isHtmlRequest(req)) return res.send(statsPageHtml(data));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read statistics', details: safeError(error) });
  }
});

// Halaman transparansi manusia untuk /stats (isyarat kepercayaan untuk pelawat & Google AdSense:
// "laman ini jujur tentang cara ia beroperasi, tiada penjejakan").
function fmtBytes(n) {
  n = Number(n) || 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function fmtUptime(sec) {
  sec = Number(sec) || 0;
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return (d ? `${d}d ` : '') + (h ? `${h}j ` : '') + `${m}m`;
}
function statsPageHtml(d) {
  const rows = [
    ['Documents indexed', (Number(d.documents) || 0).toLocaleString('en-US')],
    ['Index size', fmtBytes(d.indexSize)],
    ['Requests served (total)', (Number(d.http && d.http.requests) || 0).toLocaleString('en-US')],
    ['Errors logged (total)', (Number(d.http && d.http.errors) || 0).toLocaleString('en-US')],
    ['Online since', d.http && d.http.firstStartedAt ? new Date(d.http.firstStartedAt).toUTCString() : '—'],
    ['Uptime (this run)', fmtUptime(d.process && d.process.uptimeSeconds)],
    ['Memory in use', `${(Number(d.process && d.process.memoryMb) || 0)} MB`]
  ].map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live Statistics &amp; Transparency — Tukuk-OS</title>
<meta name="description" content="Real-time, honest statistics for the Tukuk-OS search index: documents indexed, uptime, memory and request counts. No tracking cookies, no analytics scripts.">
<link rel="canonical" href="https://tukuk.org/stats">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; margin:24px 0; }
  th, td { text-align:left; padding:14px 18px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; width:50%; }
  td { font-variant-numeric:tabular-nums; }
  tr:last-child th, tr:last-child td { border-bottom:0; }
  .trust { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:10px; padding:18px 22px; margin:24px 0; color:var(--muted); line-height:1.7; }
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
</head>
<body>
<div class="wrap">
  <header>
    <h1>Live Statistics</h1>
    <p class="tagline">A fully transparent look at how Tukuk-OS is running right now.</p>
    <nav><a href="/">Home</a><a href="/blog">Blog</a><a href="/explore">Explore</a><a href="/nasa">NASA</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></nav>
  </header>
  <main>
    <p>Tukuk-OS is a free, open web search engine. These numbers are read live from the running server — refresh the page to see them change.</p>
    <table>
    ${rows}
    </table>
    <div class="trust">
      <strong>Privacy promise.</strong> This page loads no third-party analytics or tracking cookies. The counts above are in-memory totals for the current server run and contain no personal data about any visitor.
    </div>
    <p class="meta">Want the machine-readable version? This page is served from the same data as <a href="/stats" rel="nofollow">the JSON <code>/stats</code> endpoint</a>.</p>
  </main>
  <footer><p>&copy; 2026 Tukuk-OS &mdash; A free and open web search engine.</p></footer>
</div>
</body>
</html>`;
}

app.get('/search', limiter.search, async (req, res) => {
  const { q, index: indexParam, ...rest } = req.query;
  const corpus = DEMO_INDEXES.has(String(indexParam || '')) ? String(indexParam) : null;
  if (!q || String(q).trim() === '') {
    return res.json({ query: '', hits: [], total: 0, index: corpus || config.indexName });
  }
  try {
    const target = corpus ? client.index(corpus) : index;
    const qq = String(q).trim();
    const params = buildSearchParams(rest);
    const wantedLimit = params.limit;
    let result = await target.search(qq, params);
    // Rerank neural (hanya mod relevansi, halaman pertama). Selamat: no-op jika
    // tiada backend tersedia (model tempatan belum di-deploy & tiada cred cloud).
    if (reranker.available() && !params.sort && (params.offset || 0) === 0 && result.hits.length > 1) {
      if (wantedLimit < config.rerank.candidates) {
        params.limit = Math.min(config.rerank.candidates, config.search.maxLimit);
        result = await target.search(qq, params);
      }
      const reranked = await reranker.rerank(qq, result.hits, { topN: wantedLimit });
      result = { ...result, hits: reranked };
    }
    const total = result.totalHits ?? result.estimatedTotalHits ?? result.hits.length;
    queries.logQuery(qq, { hits: total });
    res.json({
      query: qq,
      index: corpus || config.indexName,
      ...result,
      related: queries.related(qq),
      didYouMean: total === 0 ? queries.didYouMean(qq) : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// AI answer card
app.get('/answer', limiter.search, async (req, res) => {
  try {
    res.json(await answer.getAnswer(String(req.query.q || '')));
  } catch (error) {
    res.status(500).json({ error: 'Answer failed', details: safeError(error) });
  }
});

// Trending queries from the last 7 days
app.get('/trending', limiter.search, async (req, res) => {
  res.json({ queries: queries.trending(), windowDays: 7, updatedAt: Date.now() });
});

// Web search
app.get('/websearch', limiter.search, async (req, res) => {
  try {
    res.json(await websearch.search(String(req.query.q || '')));
  } catch (error) {
    res.status(500).json({ error: 'Web search failed', details: safeError(error) });
  }
});

app.get('/images', limiter.search, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.json(await mediaSearch.searchImages(String(req.query.q || ''), { page }));
  } catch (error) {
    res.status(500).json({ error: 'Image search failed', details: safeError(error) });
  }
});

app.get('/videos', limiter.search, async (req, res) => {
  try {
    const sp = String(req.query.sp || '').slice(0, 200);
    res.json(await mediaSearch.searchVideos(String(req.query.q || ''), { sp }));
  } catch (error) {
    res.status(500).json({ error: 'Video search failed', details: safeError(error) });
  }
});

app.get('/news', limiter.search, async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    res.json(await news.searchNews(String(req.query.q || ''), { offset }));
  } catch (error) {
    res.status(500).json({ error: 'News search failed', details: safeError(error) });
  }
});

// Verify Bingbot IP
app.get('/api/bingbot', limiter.search, async (req, res) => {
  try {
    let ip = String(req.query.ip || '').trim();
    if (!ip) {
      ip = String(req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
    }
    res.json(await bingbot.verify(ip));
  } catch (error) {
    res.status(500).json({ error: 'Bingbot verification failed', details: safeError(error) });
  }
});

app.get('/music', limiter.search, async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    res.json(await mediaSearch.searchMusic(String(req.query.q || ''), { offset }));
  } catch (error) {
    res.status(500).json({ error: 'Music search failed', details: safeError(error) });
  }
});

app.get('/radio', limiter.search, async (req, res) => {
  try {
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const country = String(req.query.country || '').trim();
    const tag = String(req.query.tag || '').trim();
    res.json(await mediaSearch.searchRadio(String(req.query.q || ''), { skip, country, tag }));
  } catch (error) {
    res.status(500).json({ error: 'Radio search failed', details: safeError(error) });
  }
});

// Senarai negara untuk pelayaran radio seluruh dunia (radio-browser, di-cache).
app.get('/radio/countries', limiter.search, async (req, res) => {
  try {
    res.json({ countries: await mediaSearch.listRadioCountries() });
  } catch (error) {
    res.status(502).json({ error: 'Radio countries failed', details: safeError(error) });
  }
});

// Carian ASET Creative Commons — Wikimedia Commons (semua gambar berlesen bebas/CC).
// Direka untuk Tab "CC Aset" di Studio: setiap hasil SAH diedit & dieksport,
// jadi tiada isu hak cipta bila pengguna hantar gambar ke Tukuk Studio.
app.get('/cc', limiter.search, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ hits: [], provider: 'Wikimedia Commons' });
  const startedAt = Date.now();
  try {
    const params = new URLSearchParams({
      action: 'query', format: 'json', generator: 'search',
      gsrsearch: q, gsrnamespace: '6', gsrlimit: '48',
      prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '640',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const upstream = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Tukuk-OS/1.0 (search; +https://tukuk.org)' },
    });
    clearTimeout(timeout);
    const j = await upstream.json();
    const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
    const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
    const hits = pages
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => {
        const ii = (p.imageinfo && p.imageinfo[0]) || {};
        const md = ii.extmetadata || {};
        return {
          title: String(p.title || '').replace(/^File:/, ''),
          url: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title || '')}`,
          thumb: ii.thumburl || ii.url,
          full: ii.url,
          width: ii.width, height: ii.height, mime: ii.mime || '',
          license: stripTags((md.LicenseShortName && md.LicenseShortName.value) || (md.License && md.License.value) || 'CC'),
          author: stripTags((md.Artist && md.Artist.value)).slice(0, 80),
          source: 'Wikimedia Commons',
        };
      })
      .filter((h) => h.thumb && /^image\//i.test(h.mime));
    res.json({ hits, provider: 'Wikimedia Commons (Creative Commons)', total: hits.length, tookMs: Date.now() - startedAt });
  } catch (error) {
    res.status(502).json({ error: 'CC search failed', details: safeError(error) });
  }
});

// Cadangan automatik (autocomplete) untuk kotak carian di laman depan
app.get('/suggest', limiter.search, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ suggestions: [] });
  try {
    const result = await index.search(q, { limit: 6, attributesToRetrieve: ['title', 'url'] });
    const suggestions = result.hits
      .filter((hit) => hit && hit.title)
      .map((hit) => ({ title: hit.title, url: hit.url || '' }));
    res.json({ suggestions });
  } catch {
    res.json({ suggestions: [] });
  }
});

// Tukuk-OS In-App Web Reader & Content Extractor
app.get('/api/reader', limiter.search, async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).json({ ok: false, error: 'Valid URL is required' });
  }

  try {
    // Sekat SSRF: selesaikan DNS dan tolak alamat dalaman/tertempatan.
    const parsed = await assertPublicUrl(targetUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TukukOSBot/2.1; +https://tukuk.org)',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.json({
        ok: false,
        url: targetUrl,
        siteName: parsed.hostname,
        error: `Remote server responded with HTTP ${response.status}`,
        canIframe: true
      });
    }

    const html = (await response.text()).slice(0, 500000);
    
    let title = '';
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim();

    let heroImage = '';
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                     html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (imgMatch) heroImage = imgMatch[1];

    let excerpt = '';
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    if (descMatch) excerpt = descMatch[1].trim();

    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');

    const blockRegex = /<(p|h1|h2|h3|h4|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
    const blocks = [];
    let match;
    while ((match = blockRegex.exec(cleaned)) !== null) {
      const tag = match[1].toLowerCase();
      const text = match[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      if (text.length > 25) {
        blocks.push({ tag, text });
      }
      if (blocks.length >= 80) break;
    }

    res.json({
      ok: true,
      url: targetUrl,
      title: title || parsed.hostname,
      siteName: parsed.hostname.replace(/^www\./, ''),
      heroImage,
      excerpt,
      blocks,
      canIframe: true
    });
  } catch (err) {
    const hostname = (() => { try { return new URL(targetUrl).hostname; } catch { return 'web'; } })();
    res.json({
      ok: false,
      url: targetUrl,
      siteName: hostname,
      error: err.name === 'AbortError' ? 'Page request timed out' : err.message,
      canIframe: true
    });
  }
});

// NASA Open Data API Endpoints
app.get('/api/nasa/apod', async (req, res) => {
  try {
    const data = await nasa.getAPOD({
      date: req.query.date,
      count: req.query.count,
      force: req.query.force === '1' || req.query.force === 'true'
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve NASA APOD data', details: safeError(error) });
  }
});

app.get('/api/nasa/mars', async (req, res) => {
  try {
    const data = await nasa.getMarsPhotos({
      rover: req.query.rover,
      sol: req.query.sol,
      earth_date: req.query.earth_date,
      camera: req.query.camera,
      page: req.query.page
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve NASA Mars photos', details: safeError(error) });
  }
});

app.get('/api/nasa/asteroids', async (req, res) => {
  try {
    const data = await nasa.getNearEarthObjects({
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve NASA asteroid data', details: safeError(error) });
  }
});

app.get('/api/nasa/epic', async (req, res) => {
  try {
    const data = await nasa.getEPIC({ date: req.query.date });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve NASA EPIC data', details: safeError(error) });
  }
});

app.get('/api/nasa/space-weather', async (req, res) => {
  try {
    const data = await nasa.getSpaceWeather({
      type: req.query.type,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve NASA space weather data', details: safeError(error) });
  }
});

app.get('/api/nasa/search', async (req, res) => {
  try {
    const data = await nasa.searchNASAMedia(req.query.q, {
      mediaType: req.query.mediaType || 'image'
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search NASA media archive', details: safeError(error) });
  }
});

app.get('/api/nasa/asset', async (req, res) => {
  try {
    res.json(await nasa.getNasaAssetUrl(req.query.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve NASA asset', details: safeError(error) });
  }
});

app.get('/api/nasa/iss', async (req, res) => {
  try {
    const data = await nasa.getISSTelemetry();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read ISS position', details: safeError(error) });
  }
});

// Krew ISS langsung — siapa yang sedang di angkasa sekarang (open-notify.org, tiada kunci)
app.get('/api/nasa/crew', async (req, res) => {
  try {
    res.json(await nasa.getCrew());
  } catch (error) {
    res.status(500).json({ error: 'Failed to read live crew', details: safeError(error) });
  }
});

app.get('/api/nasa/audio', async (req, res) => {
  try {
    const data = await nasa.getSpaceAudio(req.query.q || 'apollo');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search NASA audio', details: safeError(error) });
  }
});

// NASA Experiments
app.get('/api/nasa/experiments/asteroid-trend', async (req, res) => {
  try {
    const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 4, 1), 8);
    res.json(await nasa.getAsteroidTrend({ weeks }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to compute asteroid trends', details: safeError(error) });
  }
});

app.get('/api/nasa/experiments/solar', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 14), 42);
    res.json(await nasa.getSolarActivity({ days }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to compute solar activity', details: safeError(error) });
  }
});

// Borang hubungi: simpan mesej pelawat (admin baca melalui /api/contact/messages)
const CONTACT_FILE = path.join(path.dirname(config.store.path), 'contact-messages.json');

function loadContactMessages() {
  try {
    return JSON.parse(fs.readFileSync(CONTACT_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveContactMessage(entry) {
  const list = loadContactMessages();
  list.unshift(entry);
  const trimmed = list.slice(0, 200);
  fs.mkdirSync(path.dirname(CONTACT_FILE), { recursive: true });
  const temporary = `${CONTACT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(trimmed, null, 2));
  fs.renameSync(temporary, CONTACT_FILE);
  return trimmed.length;
}

app.post('/api/contact', contactLimiter, (req, res) => {
  const body = req.body || {};
  const name = truncate(String(body.name || '').trim(), 120);
  const email = truncate(String(body.email || '').trim(), 200);
  const message = truncate(String(body.message || '').trim(), 5000);
  const honeypot = String(body.website || '').trim();

  // Bot mengisi medan tersembunyi: buang senyap supaya mereka tidak sedar
  if (honeypot) return res.redirect('/contact?sent=1');
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.redirect(400, '/contact?error=1');
  }

  const entry = {
    id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    ip: req.ip,
    userAgent: truncate(String(req.get('user-agent') || ''), 200),
    name,
    email,
    message
  };

  const total = saveContactMessage(entry);
  store.event('contact', `mesej baharu daripada ${name}`, { email, characters: message.length, total });

  // Pilihan: hantar notifikasi segera (Discord/Slack/maka webhook)
  const webhook = process.env.CONTACT_WEBHOOK_URL;
  if (webhook) {
    fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Mesej baharu: ${name}`, email, message, at: entry.receivedAt })
    }).catch(() => {});
  }

  res.redirect('/contact?sent=1');
});

app.get('/api/contact/messages', requireApiKey, (req, res) => {
  const list = loadContactMessages();
  res.json({ total: list.length, messages: list.slice(0, Math.min(Number(req.query.limit) || 50, 200)) });
});

// Logger ralat JS pelawat — penambah Clarity ScriptError/ErrorClick (punca tak dapat dari API)
const JS_ERROR_FILE = path.join(path.dirname(config.store.path), 'js-errors.json');
const jsErrorLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'jserr:' })
  : (req, res, next) => next();

function loadJsErrors() {
  try {
    return JSON.parse(fs.readFileSync(JS_ERROR_FILE, 'utf8'));
  } catch {
    return [];
  }
}

app.post('/api/js-error', jsErrorLimiter, (req, res) => {
  const body = req.body || {};
  const message = truncate(String(body.message || ''), 400);
  if (!message) return res.status(400).json({ error: 'message wajib' });

  const entry = {
    at: new Date().toISOString(),
    page: truncate(String(body.page || ''), 300),
    kind: truncate(String(body.kind || 'error'), 20),
    message,
    source: truncate(String(body.source || ''), 300),
    line: Number(body.line) || 0,
    col: Number(body.col) || 0,
    ua: truncate(String(req.get('user-agent') || ''), 200)
  };

  const list = loadJsErrors();
  // gabung mesej sama supaya tak banjiri fail
  const same = list.find((e) => e.message === entry.message && e.page === entry.page);
  if (same) {
    same.count = (same.count || 1) + 1;
    same.lastAt = entry.at;
  } else {
    list.unshift({ ...entry, count: 1 });
    list.splice(300);
    fs.mkdirSync(path.dirname(JS_ERROR_FILE), { recursive: true });
    const temporary = `${JS_ERROR_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(list, null, 2));
    fs.renameSync(temporary, JS_ERROR_FILE);
  }
  res.json({ ok: true });
});

app.get('/api/js-error', requireApiKey, (req, res) => {
  const list = loadJsErrors();
  res.json({ total: list.length, errors: list.slice(0, Math.min(Number(req.query.limit) || 100, 300)) });
});

// ── Terbitan /builder: satu-klik ke pautan awam (tukuk.org/a/<slug>) ─────────
// HTML berdiri sendiri yang dijana pembina disimpan pada cakera & dihidangkan di
// /a/<slug> DALAM SANDBOX opaque-origin (lihat src/publish.js) — skrip app berjalan
// tapi tak boleh sentuh cookie/fetch/storage domain utama. Anti-XSS/phishing rentas-asal.
const PUBLISH_DIR = path.join(path.dirname(config.store.path), 'published');
const publishLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyPrefix: 'publish:' })
  : (req, res, next) => next();

function uniqueSlug(pref) {
  let s = pref;
  for (let i = 0; i < 200; i++) {
    if (publish.isSlug(s) && !fs.existsSync(path.join(PUBLISH_DIR, `${s}.html`))) return s;
    s = `${pref}-${Math.random().toString(36).slice(2, 6)}`.replace(/-/g, '-').slice(0, 40);
  }
  return null;
}

app.post('/api/publish', publishLimiter, (req, res) => {
  const body = req.body || {};
  const html = String(body.html || '');
  if (!html) return res.status(400).json({ error: 'Tiada kandungan untuk diterbitkan' });
  if (html.length > publish.PUBLISH_MAX_BYTES) return res.status(413).json({ error: 'Aplikasi terlalu besar (maks ~1.5MB)' });
  if (!publish.looksLikeHtml(html)) return res.status(400).json({ error: 'Bukan dokumen HTML yang sah' });
  try {
    fs.mkdirSync(PUBLISH_DIR, { recursive: true });
    const slug = uniqueSlug(publish.slugify(body.name || body.slug || 'app'));
    if (!slug) return res.status(500).json({ error: 'Gagal menjana pautan unik' });
    const tmp = path.join(PUBLISH_DIR, `${slug}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, html, 'utf8');
    fs.renameSync(tmp, path.join(PUBLISH_DIR, `${slug}.html`));
    const url = `${publish.publicOrigin(req)}/a/${slug}`;
    store.event('publish', `Aplikasi diterbitkan: /a/${slug}`, { name: truncate(String(body.name || ''), 120), bytes: html.length });
    notifyIndexNow(url); // pautan awam → indeks (opt-in)
    res.json({ ok: true, slug, url });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menerbitkan', details: safeError(error) });
  }
});

// Senarai app awam (slug terbaru) — ringan, untuk indeks /a.
function listPublished(limit = 200) {
  try {
    return fs.readdirSync(PUBLISH_DIR)
      .filter((f) => f.endsWith('.html'))
      .map((f) => { const s = f.slice(0, -5); let t = 0; try { t = fs.statSync(path.join(PUBLISH_DIR, f)).mtimeMs; } catch {} return { slug: s, t }; })
      .sort((a, b) => b.t - a.t)
      .slice(0, limit);
  } catch { return []; }
}

// Indeks /a — senarai aplikasi yang diterbitkan komuniti (pautan sahaja, nama disanitasi).
app.get('/a', (req, res) => {
  const items = listPublished();
  const rows = items.length
    ? items.map((x) => `<li><a href="/a/${encodeURIComponent(x.slug)}">/${escapeHtml(x.slug)}</a></li>`).join('\n')
    : '<li>Belum ada aplikasi. Bina satu di <a href="/builder">Pembina</a> lalu tekan 🚀 Terbitkan.</li>';
  res.type('html').send(`<!DOCTYPE html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aplikasi Terbitan — Tukuk Studio</title><meta name="robots" content="noindex"><style>body{font:16px/1.6 system-ui;margin:0;padding:40px 20px;background:#0f1115;color:#e6e9ef}a{color:#4c8dff}main{max-width:720px;margin:0 auto}h1{font-size:1.6rem}ul{list-style:none;padding:0}li{padding:6px 0;border-bottom:1px solid #262b36}</style></head><body><main><h1>🧩 Aplikasi Terbitan</h1><p style="color:#9aa3b2">Dijana dengan Tukuk Studio — Pembina. Dilihat dalam sandbox (asal berasingan).</p><ul>\n${rows}\n</ul><p style="margin-top:24px"><a href="/builder">→ Buka Pembina</a></p></main></body></html>`);
});

// Hidangkan satu app terbitan dalam sandbox opaque-origin.
app.get('/a/:slug', (req, res) => {
  const slug = String(req.params.slug || '');
  if (!publish.isSlug(slug)) return res.status(400).type('html').send('Slug tidak sah');
  const file = path.join(PUBLISH_DIR, `${slug}.html`);
  let html;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch { return res.status(404).type('html').send(`<!DOCTYPE html><html lang="ms"><head><meta charset="utf-8"><title>Tiada — Tukuk Studio</title><style>body{font:16px system-ui;padding:40px;background:#0f1115;color:#e6e9ef}a{color:#4c8dff}</style></head><body><h1>404</h1><p>Aplikasi <code>/${escapeHtml(slug)}</code> tiada atau telah dibuang.</p><p><a href="/a">← Semua aplikasi</a> · <a href="/builder">Bina sendiri</a></p></body></html>`); }
  res.setHeader('Content-Security-Policy', publish.PUBLISH_CSP);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(html);
});

// Explore: sains & geografi (data terbuka, tanpa kunci API)
app.get('/api/explore/earthquakes', async (req, res) => {
  try {
    res.json(await explore.getEarthquakes({
      limit: req.query.limit,
      minMagnitude: req.query.minmagnitude
    }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve earthquake data', details: safeError(error) });
  }
});

app.get('/api/explore/countries', async (req, res) => {
  try {
    res.json(await explore.searchCountries({ q: req.query.q, limit: req.query.limit }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve country data', details: safeError(error) });
  }
});

app.get('/api/explore/geocode', async (req, res) => {
  try {
    res.json(await explore.geocode({ q: req.query.q, limit: req.query.limit }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to geocode location', details: safeError(error) });
  }
});

app.get('/api/explore/weather', async (req, res) => {
  try {
    res.json(await explore.getWeather({ lat: req.query.lat, lon: req.query.lon, days: req.query.days }));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Failed to retrieve weather data', details: safeError(error) });
  }
});

app.get('/api/explore/sun', async (req, res) => {
  try {
    res.json(await explore.getSunTimes({ lat: req.query.lat, lon: req.query.lon, date: req.query.date }));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Failed to retrieve solar times', details: safeError(error) });
  }
});

app.get('/api/explore/arxiv', async (req, res) => {
  try {
    res.json(await explore.searchArxiv({ q: req.query.q, limit: req.query.limit }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve arXiv results', details: safeError(error) });
  }
});

app.get('/api/explore/ip', async (req, res) => {
  try {
    res.json(await explore.getIpInfo(req.query.ip));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Failed to identify IP', details: safeError(error) });
  }
});

// Mutation routes — requires API_KEY (header X-API-Key or Bearer)
app.post('/crawl', requireApiKey, async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'Parameter "url" is required' });
    res.json(await crawler.crawlOne(url));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Crawl failed', details: safeError(error) });
  }
});

app.post('/crawl/batch', requireApiKey, async (req, res) => {
  try {
    const urls = (req.body && req.body.urls) || [];
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Field "urls" must be a non-empty array' });
    }
    if (urls.length > 100) return res.status(400).json({ error: 'Maximum 100 URLs per request' });
    res.json(await crawler.crawlBatch(urls));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Batch crawl failed', details: safeError(error) });
  }
});

app.post('/crawl/sitemap', requireApiKey, async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'Parameter "url" is required' });
    res.json(await crawler.crawlSitemap(url));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Sitemap crawl failed', details: safeError(error) });
  }
});

app.post('/crawl/site', requireApiKey, async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'Parameter "url" is required' });
    const maxPages = Number(req.body.maxPages);
    const options = {};
    if (Number.isFinite(maxPages) && maxPages > 0) options.maxPages = Math.min(maxPages, 200);
    if (req.body.sameDomain === false) options.sameDomain = false;
    res.json(await crawler.crawlSeed(url, options));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Site crawl failed', details: safeError(error) });
  }
});

app.post('/documents', requireApiKey, async (req, res) => {
  try {
    const documents = (req.body && (req.body.documents || req.body)) || [];
    const list = Array.isArray(documents) ? documents : [documents];
    const valid = list.filter((doc) => doc && typeof doc === 'object' && doc.id && doc.content);
    if (!valid.length) {
      return res.status(400).json({ error: 'Each document requires "id" and "content" fields' });
    }
    const task = await index.addDocuments(valid, { primaryKey: 'id' });
    res.json({ indexed: valid.length, taskUid: task.taskUid });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Document indexing failed', details: safeError(error) });
  }
});

app.delete('/documents/:id', requireApiKey, async (req, res) => {
  try {
    const task = await index.deleteDocument(req.params.id);
    res.json({ deleted: req.params.id, taskUid: task.taskUid });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Delete document failed', details: safeError(error) });
  }
});

const SETTINGS_ALLOWLIST = new Set(['searchDefaultLimit', 'synonymsEnabled', 'safeSearch', 'defaultSort', 'resultsPerPage']);

app.post('/settings', requireApiKey, (req, res) => {
  try {
    const updates = req.body && typeof req.body === 'object' ? req.body : {};
    const keys = Object.keys(updates);
    if (!keys.length) return res.status(400).json({ error: 'No settings provided' });
    const applied = {};
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (!SETTINGS_ALLOWLIST.has(key)) continue;
      applied[key] = store.setSetting(key, updates[key]);
    }
    if (!Object.keys(applied).length) {
      return res.status(400).json({ error: 'No valid keys modified', allowed: [...SETTINGS_ALLOWLIST] });
    }
    res.json({ updated: applied });
  } catch (error) {
    res.status(500).json({ error: 'Settings update failed', details: safeError(error) });
  }
});

// Admin GUI route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Admin API
// ── Pentadbir: login e-mel + WebAuthn passkey ────────────────────────────────
// Hanya SATU e-mel dibenarkan (config.admin.email). Yang lain ditolak.
const adminLoginLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 5 * 60 * 1000, max: 20, keyPrefix: 'adminlogin:' })
  : (req, res, next) => next();

// Konfigurasi awam untuk UI login (e-mel dibenarkan, ada passkey?, RP config).
app.get('/api/admin/auth/config', (req, res) => {
  res.json(auth.publicConfig());
});

// Origin sebenar permintaan (untuk pengesahan WebAuthn pelbagai-hostname).
function requestOrigin(req) {
  const h = String(req.headers.origin || '').trim();
  if (h) return h;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

// Langkah 1 daftar passkey: sahkan e-mel + kata laluan bootstrap, dapat cabaran.
app.post('/api/admin/auth/register/start', adminLoginLimiter, auth.requireAllowedEmail, (req, res) => {
  const password = String((req.body && req.body.password) || '');
  if (!auth.checkBootstrapPassword(password)) {
    return res.status(401).json({ error: 'Kata laluan bootstrap tidak sah.' });
  }
  auth.startRegistration(req.body.email)
    .then((options) => res.json(options))
    .catch((error) => res.status(500).json({ error: 'Gagal memulakan pendaftaran', details: safeError(error) }));
});

// Langkah 2 daftar: sahkan attestasi, simpan passkey, keluarkan sesi.
app.post('/api/admin/auth/register/finish', adminLoginLimiter, auth.requireAllowedEmail, async (req, res) => {
  try {
    const credential = req.body && req.body.credential;
    if (!credential) return res.status(400).json({ error: 'Kredential diperlukan' });
    const result = await auth.finishRegistration(req.body.email, credential, requestOrigin(req));
    const token = auth.issueSession(req.body.email);
    res.json({ ok: true, registered: result, token });
  } catch (error) {
    console.error('[webauthn register/finish]', error && error.message, 'origin=', requestOrigin(req));
    res.status(error.statusCode || 500).json({ error: 'Pendaftaran passkey gagal', details: safeError(error) });
  }
});

// Langkah 1 login: sahkan e-mel, dapat cabaran authenticasi (passkey).
app.post('/api/admin/auth/login/start', adminLoginLimiter, auth.requireAllowedEmail, async (req, res) => {
  try {
    if (!auth.passkeys().length) {
      return res.json({ status: 'needs-setup' });
    }
    const options = await auth.startAuthentication(req.body.email);
    res.json({ status: 'ok', options });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memulakan login', details: safeError(error) });
  }
});

// Langkah 2 login: sahkan assertasi passkey, keluarkan token sesi.
app.post('/api/admin/auth/login/finish', adminLoginLimiter, auth.requireAllowedEmail, async (req, res) => {
  try {
    const credential = req.body && req.body.credential;
    if (!credential) return res.status(400).json({ error: 'Kredential diperlukan' });
    const token = await auth.finishAuthentication(req.body.email, credential, requestOrigin(req));
    res.json({ ok: true, token });
  } catch (error) {
    console.error('[webauthn login/finish]', error && error.message, 'origin=', requestOrigin(req));
    res.status(error.statusCode || 500).json({ ok: false, error: 'Login passkey gagal', details: safeError(error) });
  }
});

// Logout: batalkan sesi semasa.
app.post('/api/admin/auth/logout', (req, res) => {
  auth.revokeSession((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});

// Senarai & buang passkey (perlu sesi sah).
app.get('/api/admin/auth/passkeys', auth.requireAdmin, (req, res) => {
  res.json({ passkeys: auth.passkeys().map((k) => ({ id: k.id, label: k.label, addedAt: k.addedAt })) });
});

app.post('/api/admin/auth/passkeys/remove', auth.requireAdmin, (req, res) => {
  const id = String((req.body && req.body.id) || '');
  if (!id) return res.status(400).json({ error: 'id diperlukan' });
  res.json(auth.removePasskey(id));
});

app.get('/api/admin/status', auth.requireAdmin, async (req, res) => {
  try {
    const stats = await index.getStats();
    res.json({
      memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
      uptimeSeconds: Math.round(process.uptime()),
      documentsCount: stats.numberOfDocuments || 0,
      totalSearches: store.stats().searches || 0,
      totalCrawls: store.stats().crawls || 0,
      popularQueries: store.popularQueries(8)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve admin status', details: safeError(error) });
  }
});

app.get('/api/public/settings', (req, res) => {
  res.json({
    adsEnabled: Boolean(store.getSetting('adsEnabled', false)),
    adsClient: store.getSetting('adsClient', 'ca-pub-8954948214333501'),
    adsSlotTop: store.getSetting('adsSlotTop', ''),
    adsSlotBottom: store.getSetting('adsSlotBottom', ''),
    msAdsEnabled: Boolean(store.getSetting('msAdsEnabled', false)),
    msAdsTagId: store.getSetting('msAdsTagId', ''),
    clarityEnabled: Boolean(store.getSetting('clarityEnabled', false)),
    clarityId: String(store.getSetting('clarityId', process.env.CLARITY_PROJECT_ID || '') || ''),
    bgMode: store.getSetting('bgMode', 'default'),
    customBgUrl: store.getSetting('customBgUrl', ''),
    siteTitle: store.getSetting('siteTitle', 'Tukuk-OS'),
    siteTagline: store.getSetting('siteTagline', 'Free web search engine — inverted index, word highlighting, faceted filters')
  });
});

app.get('/api/admin/settings', auth.requireAdmin, (req, res) => {
  const rawKey = String(store.getSetting('aiApiKey', '') || '');
  res.json({
    // Google Ads
    adsEnabled: Boolean(store.getSetting('adsEnabled', false)),
    adsClient: store.getSetting('adsClient', 'ca-pub-8954948214333501'),
    adsSlotTop: store.getSetting('adsSlotTop', ''),
    adsSlotInArticle: store.getSetting('adsSlotInArticle', ''),
    adsSlotBottom: store.getSetting('adsSlotBottom', ''),
    // Microsoft Ads
    msAdsEnabled: Boolean(store.getSetting('msAdsEnabled', false)),
    msAdsTagId: store.getSetting('msAdsTagId', ''),
    msAdsSlotTop: store.getSetting('msAdsSlotTop', ''),
    msAdsSlotBottom: store.getSetting('msAdsSlotBottom', ''),
    // Snippet penuh (HTML/JS) ditampal dari pembekal. Renderer inject apa adanya.
    msAdsSnippetTop: store.getSetting('msAdsSnippetTop', ''),
    msAdsSnippetInArticle: store.getSetting('msAdsSnippetInArticle', ''),
    msAdsSnippetBottom: store.getSetting('msAdsSnippetBottom', ''),
    // Microsoft Clarity (analytics)
    clarityEnabled: Boolean(store.getSetting('clarityEnabled', false)),
    clarityId: String(store.getSetting('clarityId', process.env.CLARITY_PROJECT_ID || '') || ''),
    // Custom Themes & Wallpaper
    bgMode: store.getSetting('bgMode', 'default'),
    customBgUrl: store.getSetting('customBgUrl', ''),
    // AI Configuration — jangan pulangkan kunci sebenar, hanya status tersimpan
    aiProvider: store.getSetting('aiProvider', 'gemini'),
    aiApiKeySet: Boolean(rawKey),
    aiApiKeyMasked: rawKey ? `${rawKey.slice(0, 4)}…${rawKey.slice(-4)}` : '',
    aiModel: store.getSetting('aiModel', 'gemini-2.5-flash'),
    ollamaUrl: store.getSetting('ollamaUrl', 'http://127.0.0.1:11434'),
    ollamaModel: store.getSetting('ollamaModel', 'llama3.2'),
    // Website Branding
    siteTitle: store.getSetting('siteTitle', 'Tukuk-OS'),
    siteTagline: store.getSetting('siteTagline', 'Free web search engine — inverted index, word highlighting, faceted filters'),
    defaultTheme: store.getSetting('defaultTheme', 'dark'),
    defaultAccent: store.getSetting('defaultAccent', 'blue')
  });
});

app.post('/api/admin/settings', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  // Google Ads
  if (typeof b.adsEnabled !== 'undefined') store.setSetting('adsEnabled', Boolean(b.adsEnabled));
  if (typeof b.adsClient !== 'undefined') store.setSetting('adsClient', String(b.adsClient));
  if (typeof b.adsSlotTop !== 'undefined') store.setSetting('adsSlotTop', String(b.adsSlotTop));
  if (typeof b.adsSlotInArticle !== 'undefined') store.setSetting('adsSlotInArticle', String(b.adsSlotInArticle));
  if (typeof b.adsSlotBottom !== 'undefined') store.setSetting('adsSlotBottom', String(b.adsSlotBottom));
  // Microsoft Ads
  if (typeof b.msAdsEnabled !== 'undefined') store.setSetting('msAdsEnabled', Boolean(b.msAdsEnabled));
  if (typeof b.msAdsTagId !== 'undefined') store.setSetting('msAdsTagId', String(b.msAdsTagId));
  if (typeof b.msAdsSlotTop !== 'undefined') store.setSetting('msAdsSlotTop', String(b.msAdsSlotTop));
  if (typeof b.msAdsSlotBottom !== 'undefined') store.setSetting('msAdsSlotBottom', String(b.msAdsSlotBottom));
  if (typeof b.msAdsSnippetTop !== 'undefined') store.setSetting('msAdsSnippetTop', String(b.msAdsSnippetTop));
  if (typeof b.msAdsSnippetInArticle !== 'undefined') store.setSetting('msAdsSnippetInArticle', String(b.msAdsSnippetInArticle));
  if (typeof b.msAdsSnippetBottom !== 'undefined') store.setSetting('msAdsSnippetBottom', String(b.msAdsSnippetBottom));
  // Microsoft Clarity
  if (typeof b.clarityEnabled !== 'undefined') store.setSetting('clarityEnabled', Boolean(b.clarityEnabled));
  if (typeof b.clarityId !== 'undefined') store.setSetting('clarityId', String(b.clarityId).trim());
  // Themes & Custom Background
  if (typeof b.bgMode !== 'undefined') store.setSetting('bgMode', String(b.bgMode));
  if (typeof b.customBgUrl !== 'undefined') store.setSetting('customBgUrl', String(b.customBgUrl));
  // AI Settings — hanya kemas kini kunci jika nilai baharu diberikan (jangan kosongkan tersirat)
  if (typeof b.aiProvider !== 'undefined') store.setSetting('aiProvider', String(b.aiProvider));
  if (typeof b.aiApiKey !== 'undefined' && String(b.aiApiKey).trim()) store.setSetting('aiApiKey', String(b.aiApiKey).trim());
  if (typeof b.aiModel !== 'undefined') store.setSetting('aiModel', String(b.aiModel));
  if (typeof b.ollamaUrl !== 'undefined') store.setSetting('ollamaUrl', String(b.ollamaUrl));
  if (typeof b.ollamaModel !== 'undefined') store.setSetting('ollamaModel', String(b.ollamaModel));
  // Branding
  if (typeof b.siteTitle !== 'undefined') store.setSetting('siteTitle', String(b.siteTitle));
  if (typeof b.siteTagline !== 'undefined') store.setSetting('siteTagline', String(b.siteTagline));
  if (typeof b.defaultTheme !== 'undefined') store.setSetting('defaultTheme', String(b.defaultTheme));
  if (typeof b.defaultAccent !== 'undefined') store.setSetting('defaultAccent', String(b.defaultAccent));
  res.json({ ok: true });
});

// Admin Web Terminal — hanya pentadbir bersesi. Sekatan arahan musnah diperketat.
app.post('/api/admin/terminal', auth.requireAdmin, (req, res) => {
  const cmd = req.body && String(req.body.cmd || '').trim();
  if (!cmd) return res.status(400).json({ error: 'Command is required' });

  // Sekat arahan pemadam/perosak dan helah rantai shell yang jelas berbahaya.
  const dangerous = [
    /\brm\b/i,
    /\brmdir\b/i,
    /\bmkfs\b/i,
    /\bdd\b.*of=\/dev/i,
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bdeluser\b/i,
    /\buserdel\b/i,
    />\s*\/dev\/sd/i
  ];
  if (dangerous.some((re) => re.test(cmd))) {
    return res.status(403).json({ error: 'Command blocked for server safety' });
  }

  const start = Date.now();
  exec(cmd, { timeout: 10000, maxBuffer: 1024 * 512, cwd: process.cwd() }, (err, stdout, stderr) => {
    const tookMs = Date.now() - start;
    res.json({
      stdout: stdout || '',
      stderr: stderr || (err ? err.message : ''),
      code: err ? (err.code || 1) : 0,
      tookMs
    });
  });
});

// Admin AI Content Generation
app.post('/api/admin/ai/generate', auth.requireAdmin, async (req, res) => {
  const prompt = req.body && String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  const provider = store.getSetting('aiProvider', 'gemini');
  const start = Date.now();

  try {
    if (provider === 'ollama') {
      const ollamaUrl = store.getSetting('ollamaUrl', 'http://127.0.0.1:11434');
      const model = store.getSetting('ollamaModel', 'llama3.2');
      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false })
      });
      const data = await response.json();
      return res.json({ text: data.response || 'No response', provider: `Ollama (${model})`, tookMs: Date.now() - start });
    } else {
      // Gemini API
      const apiKey = store.getSetting('aiApiKey') || process.env.GEMINI_API_KEY || '';
      const model = store.getSetting('aiModel', 'gemini-2.5-flash');
      if (!apiKey) {
        return res.status(400).json({ error: 'Please set your Gemini API Key in AI Settings first.' });
      }
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || data.error?.message || 'No response';
      return res.json({ text, provider: `Google Gemini (${model})`, tookMs: Date.now() - start });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

// In-app Reader View Proxy (opens articles inside Tukuk-OS without leaving)
// Lindung daripada SSRF: hanya URL awam yang dibenarkan.
app.get('/api/proxy/reader', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).send('Invalid URL');
  }
  try {
    await assertPublicUrl(targetUrl);
  } catch {
    return res.status(403).send('Access to internal address is blocked');
  }
  try {
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Tukuk-OS-Reader/2.0'
      },
      signal: AbortSignal.timeout(8000)
    });
    let html = await resp.text();
    // Inject base href so images & relative links work
    const baseTag = `<base href="${escapeHtml(targetUrl)}">`;
    html = html.replace(/<head[^>]*>/i, `$&${baseTag}`);
    // Disable intrusive redirects inside iframe
    html = html.replace(/window\.top\.location/g, 'window.self.location');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:40px;text-align:center;"><h2>Could not load preview</h2><p>This website prevents in-frame preview.</p><a href="${escapeHtml(targetUrl)}" target="_blank" style="color:#3b82f6;font-size:1.1rem;">Open in new window &rarr;</a></body></html>`);
  }
});

app.post('/api/admin/crawl', auth.requireAdmin, async (req, res) => {
  const { url, mode, maxPages } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const pagesLimit = Math.min(Math.max(Number(maxPages) || 20, 1), 100);
    let sampleTitles = [];
    let count = 0;

    if (mode === 'sitemap') {
      const urls = await crawler.crawlSitemap(url);
      const batch = await crawler.crawlBatch(urls.slice(0, pagesLimit));
      count = batch.length;
      sampleTitles = batch.map(b => b.document?.title || b.url).filter(Boolean).slice(0, 5);
    } else if (mode === 'site') {
      const result = await crawler.crawlSeed(url, { maxPages: pagesLimit });
      count = (result.results || []).length;
      sampleTitles = (result.results || []).map(r => r.document?.title || r.url).filter(Boolean).slice(0, 5);
    } else {
      const result = await crawler.crawlOne(url);
      count = 1;
      sampleTitles = [result.document?.title || result.url].filter(Boolean);
    }

    res.json({ ok: true, indexedCount: count, sampleTitles });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Crawl failed' });
  }
});

app.get('/api/admin/posts', auth.requireAdmin, (req, res) => {
  res.json(store.getAllPosts(100));
});

app.post('/api/admin/posts', auth.requireAdmin, (req, res) => {
  const { title, content, slug, tags, author } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const post = store.createPost({ title, content, slug, tags, author });
  const id = require('crypto').createHash('sha256').update(post.slug || post.title).digest('hex').slice(0, 16);
  index.addDocuments([{
    id,
    url: `https://tukuk.org/blog/${post.slug}`,
    title: post.title,
    description: post.excerpt,
    content: post.content,
    summary: post.excerpt,
    siteName: 'Tukuk-OS',
    host: 'tukuk.org',
    lang: 'en',
    type: 'article',
    section: (post.tags && post.tags[0]) || 'Blog',
    keywords: post.tags || ['tukuk', 'blog'],
    publishedAt: post.createdAt,
    crawledAt: post.createdAt,
    wordCount: post.content.split(/\s+/).length,
    quality: 1.0
  }]);
  notifyIndexNow(`https://tukuk.org/blog/${post.slug}`);
  res.json(post);
});

app.delete('/api/admin/posts/:id', auth.requireAdmin, (req, res) => {
  const success = store.deletePost(req.params.id);
  res.json({ ok: success });
});

app.use((req, res) => {
  const wantsJson = req.path.startsWith('/api') || /\.(json|xml)$/i.test(req.path) || !isHtmlRequest(req);
  if (wantsJson) return res.status(404).json({ error: 'Route not found', path: req.originalUrl });
  res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 — Page Not Found — Tukuk-OS</title>
<meta name="description" content="The page you were looking for on Tukuk-OS could not be found. Search the web or browse the blog instead.">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="https://tukuk.org/">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
  .oops { text-align:center; padding:40px 0 8px; }
  .oops .code { font-size:5rem; font-weight:800; color:var(--accent); line-height:1; letter-spacing:-2px; }
  .hint { color:var(--muted); margin:6px 0 26px; }
  .actions { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin:24px 0; }
  .actions a { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 20px; text-decoration:none; color:var(--text); }
  .actions a:hover { border-color:var(--accent); color:var(--accent); }
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
</head>
<body>
<div class="wrap">
  <div class="oops">
    <div class="code">404</div>
    <h1>Page not found</h1>
    <p class="hint">Sorry — <code>${escapeHtml(req.path)}</code> doesn't exist, or has moved.</p>
    <div class="actions">
      <a href="/">🔍 Search the web</a>
      <a href="/blog">📝 Read the blog</a>
      <a href="/explore">🌍 Explore</a>
      <a href="/nasa">🚀 NASA</a>
      <a href="/contact">✉️ Contact us</a>
    </div>
  </div>
  <footer><p>&copy; 2026 Tukuk-OS &mdash; A free and open web search engine. <a href="/">Home</a> <a href="/about">About</a> <a href="/privacy">Privacy</a></p></footer>
</div>
</body>
</html>`);
});

app.use((error, req, res, next) => {
  errorCount += 1;
  if (res.headersSent) return next(error);
  res.status(error.statusCode || 500).json({ error: 'Server error', details: safeError(error) });
});

module.exports = { app };