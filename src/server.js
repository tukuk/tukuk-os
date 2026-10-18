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
const taskrouter = require('./brain/taskrouter');
const approuter = require('./brain/approuter');
const websearch = require('./brain/websearch');
const mediaSearch = require('./brain/media-search');
const reranker = require('./brain/reranker');
const builderGen = require('./builder-gen');
const news = require('./news');
const queries = require('./queries');
const answer = require('./answer');
const bingbot = require('./bingbot');
const { client, health } = require('./meili');
const crawler = require('./crawler');
const fallback = require('./fallback');
const nasa = require('./nasa');
const wx = require('./weather');
const gp = require('./gempa');
const cu = require('./cuti');
const cd = require('./cuti-dunia');
const ng = require('./negara');
const study = require('./study');
const udara = require('./udara');
const st = require('./statistik');
const bc = require('./bencana');
const social = require('./social');
const explore = require('./explore');
const { rateLimit, requireApiKey } = require('./middleware');
const { safeError, truncate, escapeHtml } = require('./util');
const { assertPublicUrl } = require('./util');
const auth = require('./auth');
const chat = require('./chat');
const sms = require('./sms');
const agent = require('./agent');
const agentEditor = require('./agent-editor');
const blogRedirects = require('./blog-redirects');
const publish = require('./publish');
const { exec } = require('child_process');
const { Readable } = require('stream');

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
// verify: simpan mentah badan (Buffer) pada req.rawBody supaya proksi /agent boleh
// hantar semula badan POST yang tepat walaupun express.json/urlencoded sudah membacanya.
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '64kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
// Gzip: semua teks (HTML/JSON) dipampatkan — halaman ~32KB jadi ~8KB.
// Aliran SSE (/api/chat/stream) tidak boleh dimampat — mampat menyimpan bingkai
// daripada dihantar serta-merta, jadi terus kecualikan jenis kandungan itu.
app.use(compression({
  filter: (req, res) => {
    const ct = String(res.getHeader('Content-Type') || '');
    // Jangan mampat aliran langsung (SSE) maupun audio/video radio — mampat
    // menyimpan bingkai/byte daripada dihantar serta-merta (stream jadi tersekat).
    if (/text\/event-stream|audio\/|video\/|application\/octet-stream/i.test(ct)) return false;
    return compression.filter(req, res);
  },
}));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ── Domain khas T Chat: tchat.tukuk.org ─────────────────────────────────────
// Ruang terpencil untuk messenger: hanya aset yang T Chat guna dilaluan;
// CSP lebih ketat (frame-ancestors 'none', tanpa iklan/analitik), X-Robots-Tag
// noindex supaya mesej/katalog tidak terindeks, dan mana-mana path lain → 302
// ke tukuk.org supaya pelawat tidak tersesat ke enjin carian/iklan. Sesi (Bearer
// token di localStorage) terasing ikut origin — cookie tukuk.org tidak mengalir
// ke sini, dan sebaliknya.
const TCHAT_HOST = String(process.env.TCHAT_HOST || 'tchat.tukuk.org').trim().toLowerCase();
const TCHAT_ALLOWED = [
  /^\/apps\/chat(\.html)?\/?$/,                   // path asal applikasi (pautan sedia ada)
  /^\/api\/chat(\/.*)?$/,                     // root + semua endpoint chat (SSE, media, dsb.)
  /^\/csp-report$/,                                // pelapor CSP (dipakai CSP report-uri)
  /^\/sw\.js$/,                                     // service worker (skop root host ini)
  /^\/manifest-chat\.json$/,                      // PWA install
  /^\/theme\.(?:css|js)$/,                         // tema global
  /^\/icons\/[A-Za-z0-9._/-]+$/,                  // logo + ikon apl (chat.svg, chat-192.png, ...)
  /^\/(?:favicon\.ico|apple-touch-icon\.png|og\.png|icon\.svg|logo\.png|logo-mark\.svg)$/,
  /^\/downloads\/tukuk-chat\.apk$/,               // muat turun APK beta
  /^\/libs\/[A-Za-z0-9._-]+$/,                    // pustaka vendored (ggwave-js utk 📻 Sound Wave)
];
const CSP_TCHAT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",              // chat.html memang inline <script> + atribut onclick
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",                    // rakaman suara + lampiran (blob URL)
  "connect-src 'self' data: blob: wss: turn: stun: stuns:",  // SSE + WebRTC + muat naik
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",                          // anti-clickjacking mutlak untuk messenger
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /csp-report",
].join('; ') + ';';
app.use((req, res, next) => {
  if (!TCHAT_HOST) return next();
  if (String(req.hostname || '').toLowerCase() !== TCHAT_HOST) return next();
  // Header ruang-khas (timpa nilai global dari blok security-headers di atas).
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Content-Security-Policy', CSP_TCHAT);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Root host tchat → hidang chat.html secara terus (URL kekal tchat.tukuk.org/).
  if (req.path === '/' || req.path === '/index.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'apps', 'chat.html'), (err) => {
      if (err) res.status(503).type('txt').send('T Chat cannot load right now.');
    });
  }
  for (const re of TCHAT_ALLOWED) if (re.test(req.path)) return next();
  // Selainnya: bawa pelawat ke ruang utama (kekalkan query string & path asal).
  return res.redirect(302, 'https://tukuk.org' + req.originalUrl);
});

// Akses global: beritahu Tor Browser tentang onion mirror automatik
// (header Onion-Location → Tor Browser tawar buka laman via onion).
const ONION_HOST = process.env.ONION_HOST || 'd33axv7iaq4sp5hlwjn7i2tovkuxmxc53xl2drjhve7mboitsoicdfid.onion';
app.use((req, res, next) => {
  if (!/\.[a-z0-9]+$/i.test(req.path) || req.path.endsWith('.html')) {
    res.setHeader('Onion-Location', `http://${ONION_HOST}${req.originalUrl}`);
  }
  next();
});

// tukuk.org ROOT = hub konten (permukaan AdSense/SEO yang boleh di-crawl),
// BUKAN portal carian. Diregister sebelum express.static supaya menang ke atas
// public/index.html. Portal carian kekal di /cari. T Chat ada di tchat.tukuk.org.
app.get('/', (req, res) => {
  res.type('html').send(renderBlogListPage(req, true));
});

// Halaman NASA APOD yang boleh di-index + beriklan (SEO text + ImageObject JSON-LD). Data
// APOD = domain-awam NASA (selamat dari copyright), bahasa Inggeris (trafik global), ni‑astronomi
// CPC sederhana → sesuai untuk AdSense. Diambil ATAS PERMINTAAN melalui nasa.getAPOD() (cache 4
// jam + circuit-breaker sedia ada), jadi TIADA kerja latar / beban tambahan pada server.
app.get('/nasa', async (req, res) => {
  try {
    const apod = await nasa.getAPOD();
    res.type('html').send(renderNasaApodPage(req, apod));
  } catch {
    res.status(503).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Astronomy Picture of the Day | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>Astronomy Picture of the Day</h1><p>Today\u2019s picture is briefly unavailable. Please try again shortly.</p><p><a href="/">Back to Tukuk-OS</a></p></body>');
  }
});

// ── NASA SPACE COMPLEX — laluan ──────────────────────────────────────────
// Setiap seksyen hidang HTML boleh-index + 3 unit iklan melalui nasaDoc. Data
// ditarik ATAS PERMINTAAN (src/nasa.js sudah ada cache 2–12 jam + pemutus litar),
// jadi walaupun Googlebot menyerbu kluster ini, server kekal ringan dan kuot
// NASA tidak tercetus. Ralat data → 503 noindex (tiada halaman kosong terindeks).
const APOD_FIRST_DAY = '1995-06-16';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nasaHtml(res, html, status) {
  res.status(status || 200).type('html').send(html);
}

// `/nasa/random` → 302 ke satu tarikh APOD rawak. Tidak di-index (ia sentiasa
// berbeza), tapi pautan darinya mengukuhkan struktur crawl seluruh arkib.
app.get('/nasa/random', (req, res) => {
  const start = Date.parse(`${APOD_FIRST_DAY}T12:00:00Z`);
  const span = Math.max(1, Date.now() - start);
  const d = new Date(start + Math.floor(Math.random() * span)).toISOString().slice(0, 10);
  res.redirect(302, `/nasa/apod/${d}`);
});

// Arkib setempat: senarai + carian teks atas rekod yang pernah disimpan (sifar
// kuot API). Semakin lama pelayan berjalan, semakin besar arkib ini secara organik.
app.get('/nasa/archive', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  try {
    const items = nasa.store.listApod({ limit: 120, q });
    nasaHtml(res, nasaArchivePage(req, items, q));
  } catch {
    nasaHtml(res, nasaBusy('APOD archive is unavailable'), 503);
  }
});

// Penjana halaman SEO terbesar: satu halaman PER HARI sejak 16 Jun 1995 —
// ±11,000 URL unik berindeks yang ditulis oleh NASA, bukan oleh kita.
app.get('/nasa/apod/:date', async (req, res) => {
  const dateStr = String(req.params.date || '');
  const today = new Date().toISOString().slice(0, 10);
  if (!ISO_DATE_RE.test(dateStr) || dateStr < APOD_FIRST_DAY || dateStr > today) {
    return nasaHtml(res, nasaBusy('That date is outside the APOD archive (16 June 1995 \u2013 today)'), 404);
  }
  try {
    const apod = await nasa.getAPOD({ date: dateStr });
    nasaHtml(res, nasaApodDatePage(req, apod, dateStr));
  } catch {
    nasaHtml(res, nasaBusy('No picture recorded for that date'), 503);
  }
});

app.get('/nasa/sky', async (req, res) => {
  const useQuery = req.query.lat !== undefined || req.query.lng !== undefined;
  try {
    const sky = await nasa.getSkyTonight({ lat: req.query.lat, lng: req.query.lng });
    nasaHtml(res, nasaSkyPage(req, sky, useQuery));
  } catch {
    nasaHtml(res, nasaBusy('Sky calculations are unavailable'), 503);
  }
});

app.get('/nasa/iss', async (req, res) => {
  try {
    const [iss, crew] = await Promise.all([nasa.getISSTelemetry(), nasa.getCrew().catch(() => null)]);
    nasaHtml(res, nasaIssPage(req, iss, crew));
  } catch {
    nasaHtml(res, nasaBusy('ISS telemetry is unavailable'), 503);
  }
});

// Suapan JSON kecil untuk auto-refresh klien (peta ISS poll setiap 15s).
app.get('/nasa/iss/live.json', async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const iss = await nasa.getISSTelemetry();
    if (!iss || iss.source === 'unavailable') { res.status(503).json({ source: 'unavailable' }); return; }
    res.json(iss);
  } catch {
    res.status(503).json({ source: 'unavailable' });
  }
});

app.get('/nasa/asteroids', async (req, res) => {
  try {
    const [week, trend, sentry] = await Promise.all([
      nasa.getNearEarthObjects(),
      nasa.getAsteroidTrend({ weeks: 4 }).catch(() => null),
      nasa.getSentryRisk().catch(() => null),
    ]);
    nasaHtml(res, nasaAsteroidsPage(req, week, trend, sentry));
  } catch {
    nasaHtml(res, nasaBusy('Asteroid data is unavailable'), 503);
  }
});

app.get('/nasa/space-weather', async (req, res) => {
  try {
    const solar = await nasa.getSolarActivity({ days: 30 });
    nasaHtml(res, nasaSpaceWeatherPage(req, solar));
  } catch {
    nasaHtml(res, nasaBusy('Space-weather data is unavailable'), 503);
  }
});

function marsRoute(slug) {
  return async (req, res) => {
    const rv = MARS_ROVERS.find((r) => r.slug === slug) || MARS_ROVERS[0];
    try {
      const data = await nasa.getMarsPhotos({ rover: rv.slug, sol: rv.sol });
      nasaHtml(res, nasaMarsPage(req, data, rv.slug));
    } catch {
      nasaHtml(res, nasaBusy('Mars imagery is unavailable'), 503);
    }
  };
}

app.get('/nasa/mars', marsRoute('perseverance'));
// Slug sebarang → laluan parameter + sahkan dalam handler. (Loop daftar route di
// sini akan kena TDZ: MARS_ROVERS ialah `const` yang baru diisytihar kemudian.)
app.get('/nasa/mars/:slug', (req, res) => {
  const rv = MARS_ROVERS.find((r) => r.slug === String(req.params.slug));
  if (!rv) return res.redirect(301, '/nasa/mars');
  return marsRoute(rv.slug)(req, res);
});

app.get('/nasa/earth', async (req, res) => {
  try {
    const epic = await nasa.getEPIC({});
    nasaHtml(res, nasaEarthPage(req, epic));
  } catch {
    nasaHtml(res, nasaBusy('EPIC imagery is unavailable'), 503);
  }
});

app.get('/nasa/exoplanets', async (req, res) => {
  const d = Number(req.query.d) || 0;
  try {
    const exo = await nasa.getExoplanets({ limit: 250 });
    nasaHtml(res, nasaExoplanetsPage(req, exo, d));
  } catch {
    nasaHtml(res, nasaBusy('The exoplanet archive is unreachable'), 503);
  }
});

function soundsRoute(topic) {
  return async (req, res) => {
    try {
      const audio = await nasa.getSpaceAudio(topic);
      nasaHtml(res, nasaSoundsPage(req, audio, topic));
    } catch {
      nasaHtml(res, nasaBusy('NASA audio is unavailable'), 503);
    }
  };
}

app.get('/nasa/sounds', soundsRoute('apollo'));
app.get('/nasa/sounds/:topic', (req, res) => {
  const t = NASA_SOUND_TOPICS.find((x) => x.slug === String(req.params.topic));
  if (!t) return res.redirect(301, '/nasa/sounds');
  return soundsRoute(t.slug)(req, res);
});

function satellitesRoute(group) {
  return async (req, res) => {
    try {
      const data = await nasa.getSatellites({ group });
      nasaHtml(res, nasaSatellitesPage(req, data, group));
    } catch {
      nasaHtml(res, nasaBusy('Orbital element data is unavailable'), 503);
    }
  };
}

app.get('/nasa/satellites', satellitesRoute('stations'));
app.get('/nasa/satellites/:group', (req, res) => {
  const g = SAT_GROUPS.find((x) => x.slug === String(req.params.group));
  if (!g) return res.redirect(301, '/nasa/satellites');
  return satellitesRoute(g.slug)(req, res);
});

// ── LALUAN KOMPLEKS CUACA (/cuaca*) ── semua statik-dahulu, kemudian :slug ──
// robots.txt: hidang dari fail dengan no-store — Cloudflare pernah sajikan versi
// lapuk (baris Sitemap baharu tak nampak di tepi). Fail kecil, kos sifar, dan
// enjin carian sentiasa baca versi paling terkini.
app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/plain').send(fs.readFileSync(path.join(PUBLIC_DIR, 'robots.txt'), 'utf8'));
});

function cuacaHtml(res, html, status) {
  res.status(status || 200).type('html').send(html);
}

app.get('/cuaca', async (req, res) => {
  try {
    const snap = await wx.getFeaturedSnapshot();
    if (!snap || snap.length < 4) throw new Error('snapshot tipis');
    cuacaHtml(res, cuacaHubPage(req, snap));
  } catch {
    cuacaHtml(res, weatherBusy('Suapan cuaca belum sempat dimuat'), 503);
  }
});

app.get('/cuaca/peta', (req, res) => cuacaHtml(res, cuacaMapPage(req)));
app.get('/cuaca/kod', (req, res) => cuacaHtml(res, cuacaCodesPage(req)));
app.get('/cuaca/awan', (req, res) => cuacaHtml(res, cuacaCloudPage(req)));
app.get('/cuaca/angin', (req, res) => cuacaHtml(res, cuacaWindPage(req)));

app.get('/cuaca/ekstrem', async (req, res) => {
  try {
    const snap = await wx.getFeaturedSnapshot();
    if (!snap || snap.length < 4) throw new Error('snapshot tipis');
    cuacaHtml(res, cuacaExtremesPage(req, snap));
  } catch {
    cuacaHtml(res, weatherBusy('Data suhu dunia tidak sempat dimuat'), 503);
  }
});

// Carian → geokoding → 302 ke halaman kota. Slugs sebarang nama di dunia.
app.get('/cuaca/cari', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length > 60) return res.redirect(301, '/cuaca');
  try {
    let city = wx.findCity(q);
    if (!city) city = await wx.geocode(q);
    if (!city) return cuacaHtml(res, weatherBusy(`Tiada bandar bernama “${q}” ditemui`), 404);
    return res.redirect(302, `/cuaca/${city.slug}`);
  } catch {
    return cuacaHtml(res, weatherBusy('Carian bandar tidak sempat diproses'), 503);
  }
});

async function cuacaCityHandler(req, res, view) {
  const slug = wx.slugify(req.params.slug);
  if (!slug || slug.length > 60) return res.redirect(301, '/cuaca');
  let city;
  try { city = await wx.resolveCity(slug); } catch { city = null; }
  if (!city) return cuacaHtml(res, weatherBusy(`Halaman cuaca untuk “${slug}” belum tersedia`), 404);
  try {
    if (view === 'udara') {
      const [air, airFc] = await Promise.all([wx.getAir(city), wx.getAirForecast(city).catch(() => null)]);
      if (!air) throw new Error('tiada data');
      return cuacaHtml(res, cuacaAirPage(req, city, air, airFc));
    }
    if (view === 'surya') {
      const cur = await wx.getCurrent(city);
      return cuacaHtml(res, cuacaSunPage(req, city, cur));
    }
    const [cur, fc, air] = await Promise.all([
      wx.getCurrent(city),
      wx.getForecast(city).catch(() => null),
      wx.getAir(city).catch(() => null),
    ]);
    return cuacaHtml(res, cuacaCityPage(req, city, cur, fc, air));
  } catch {
    return cuacaHtml(res, weatherBusy(`Cuaca ${city.name} tidak sempat dimuat`), 503);
  }
}

app.get('/cuaca/:slug/udara', (req, res) => cuacaCityHandler(req, res, 'udara'));
app.get('/cuaca/:slug/surya', (req, res) => cuacaCityHandler(req, res, 'surya'));
app.get('/cuaca/:slug', (req, res) => cuacaCityHandler(req, res, 'kota'));

// ── LALUAN KOMPLEKS GEMPA (/gempa*) — suapan USGS, statik-dahulu, kemudian :region ──
app.get('/gempa', async (req, res) => {
  try {
    const [rows, myRows] = await Promise.all([
      gp.regionFeed(gp.findRegion('dunia')),
      gp.regionFeed(gp.findRegion('malaysia')),
    ]);
    if (!rows || !rows.length) throw new Error('suapan kosong');
    res.status(200).type('html').send(gempaHubPage(req, rows, myRows || []));
  } catch {
    res.status(503).type('html').send(gempaBusy('Suapan gempa belum sempat dimuat'));
  }
});

app.get('/gempa/penjelasan', (req, res) => res.status(200).type('html').send(gempaExplainPage(req)));

// :region DIHURUFKAN selepas laluan literal — senarai semak dalam handler (TDZ selamat).
app.get('/gempa/:region', async (req, res) => {
  const region = gp.findRegion(req.params.region);
  if (!region) return res.status(404).type('html').send(gempaBusy(`Rantau "${req.params.region}" tidak dikenali`));
  try {
    const rows = await gp.regionFeed(region);
    res.status(200).type('html').send(gempaRegionPage(req, region, rows || []));
  } catch {
    res.status(503).type('html').send(gempaBusy(`Data gempa ${region.name} tidak sempat dimuat`));
  }
});

// ── LALUAN KOMPLEKS CUTI (/cuti*) — kalendar cuti umum DUNIA + jadual negeri MY ──
// HAB /cuti — DUNIA: kalendar cuti umum 60 negara (Nager.Date, tanpa kunci).
// Jadual Malaysia negeri kekal di /cuti/2026, /cuti/2027 & /cuti/:negeri.
app.get('/cuti', async (req, res) => {
  try {
    const [world, rows] = await Promise.all([cd.loadWorld(2026), ng.loadCountries()]);
    res.status(200).type('html').send(cutiHubPage(req, world, rows));
  } catch {
    res.status(503).type('html').send(cutiBusy('Kalendar cuti dunia belum sempat dimuat'));
  }
});

app.get('/cuti/penjelasan', (req, res) => res.status(200).type('html').send(cutiExplainPage(req)));
app.get('/cuti/hujung-minggu-panjang', async (req, res) => {
  try {
    const [worldLw, rows26, rows27, ngRows] = await Promise.all([
      cd.loadWorldLongWeekends(2026).catch(() => null),
      cu.getHolidays(cu.YEAR_MIN).catch(() => null),
      cu.getHolidays(cu.YEAR_MAX).catch(() => null),
      ng.loadCountries().catch(() => []),
    ]);
    if (!worldLw && (!rows26 || !rows26.length)) throw new Error('jadual kosong');
    res.status(200).type('html').send(cutiLongWeekendPage(req, rows26 || [], rows27 || [], worldLw, ngRows || []));
  } catch {
    res.status(503).type('html').send(cutiBusy('Pengiraan hujung minggu panjang tidak sempat dimuat'));
  }
});

// /cuti/2026, /cuti/2027 — tahun divalidasi DALAM handler (jangan lalui :negeri).
app.get(/^\/cuti\/(2026|2027)$/, async (req, res, next) => {
  const year = Number(req.params[0]);
  try {
    const rows = await cu.getHolidays(year);
    if (!rows || !rows.length) return next(); // bukan tahun liputan → :negeri/404
    return res.status(200).type('html').send(cutiYearPage(req, year, rows));
  } catch {
    return res.status(503).type('html').send(cutiBusy(`Kalendar cuti ${year} tidak sempat dimuat`));
  }
});

// /cuti/dunia — indeks lama; hab utama sudah dunia jadi 301 sahaja.
app.get('/cuti/dunia', (req, res) => res.redirect(301, '/cuti'));

// Halaman cuti negara & rantau — slug ASCII kami sendiri (bukan slug Kompleks Negara,
// yang boleh bercacat ejaan seperti 't-rkiye'). Rantau disemak dahulu.
app.get('/cuti/dunia/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const region = cd.findRegion(slug);
  const coun = cd.findCountryBySlug(slug);
  if (!region && !coun) return res.status(404).type('html').send(cutiBusy(`Halaman cuti "${req.params.slug}" tiada dalam liputan`));
  let ngRows = [];
  try { ngRows = await ng.loadCountries(); } catch { /* nama BM sekadar pelengkap */ }
  try {
    if (region) {
      const world = await cd.loadWorld(2026);
      return res.status(200).type('html').send(cutiRegionPage(req, region, world, ngRows));
    }
    const [holidays, rawLw] = await Promise.all([
      cd.loadHolidays(2026, coun.cca2),
      cd.loadLongWeekends(2026, coun.cca2).catch(() => []),
    ]);
    if (!holidays || !holidays.length) return res.status(503).type('html').send(cutiBusy(`Jadual cuti ${coun.en} 2026 belum tersedia dalam sumber`));
    // Nager beri startDate/endDate/needBridgeDay — dinormalkan ke bentuk jadual paparan.
    const lws = (rawLw || []).map((w) => ({ start: w.startDate, end: w.endDate, dayCount: w.dayCount, needBridge: !!w.needBridgeDay, bridgeDays: w.bridgeDays || [] }));
    return res.status(200).type('html').send(cutiCountryPage(req, coun, holidays, lws, ngRows));
  } catch {
    return res.status(503).type('html').send(cutiBusy(`Jadual cuti ${region ? region.bm : coun.en} tidak sempat dimuat`));
  }
});

// :negeri DIHURUFKAN selepas laluan literal — senarai semak dalam handler (TDZ selamat).
app.get('/cuti/:negeri', async (req, res) => {
  const st = cu.findState(req.params.negeri);
  if (!st) return res.status(404).type('html').send(cutiBusy(`Negeri "${req.params.negeri}" tidak dikenali`));
  let year = Number(req.query.tahun || cu.YEAR_MIN);
  if (!Number.isFinite(year) || year < cu.YEAR_MIN || year > cu.YEAR_MAX) year = cu.YEAR_MIN;
  try {
    const rows = await cu.getStateHolidays(st.code, year);
    res.status(200).type('html').send(cutiStatePage(req, st, year, rows || []));
  } catch {
    res.status(503).type('html').send(cutiBusy(`Jadual cuti ${st.name} tidak sempat dimuat`));
  }
});

// ── LALUAN KOMPLEKS NEGARA (/negara*) — world-countries + World Bank, tanpa kunci ──
// Hab + :slug; rantau/negara divalidasi DALAM handler (ikut tertib: region →
// country → 404). Data di-cache 30 hari, jadi permintaan susulan segera.
app.get('/negara', async (req, res) => {
  try {
    const rows = await ng.loadCountries();
    if (!rows || rows.length < 200) throw new Error('dataset kosong');
    res.status(200).type('html').send(negaraHubPage(req, rows));
  } catch {
    res.status(503).type('html').send(negaraBusy('Data negara belum sempat dimuat'));
  }
});

app.get('/negara/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  let rows;
  try {
    rows = await ng.loadCountries();
    if (!rows || rows.length < 200) throw new Error('dataset kosong');
  } catch {
    return res.status(503).type('html').send(negaraBusy('Data negara belum sempat dimuat'));
  }
  const region = ng.findRegion(slug);
  if (region) return res.status(200).type('html').send(negaraRegionPage(req, region, ng.inRegion(rows, slug)));
  const country = ng.findCountry(rows, slug);
  if (country) return res.status(200).type('html').send(negaraCountryPage(req, country, rows));
  return res.status(404).type('html').send(negaraBusy(`Negara "${slug}" tidak dikenali`));
});

// ── LALUAN KOMPLEKS STATISTIK (/statistik*) — World Bank Open Data, tanpa kunci ──
// Hab + satu halaman setiap indikator; slug divalidasi DALAM handler (TDZ selamat).
app.get('/statistik', async (req, res) => {
  try {
    const rows = await ng.loadCountries();
    if (!rows || rows.length < 200) throw new Error('dataset kosong');
    res.status(200).type('html').send(await statistikHubPage(req, rows));
  } catch {
    res.status(503).type('html').send(statistikBusy('Data statistik dunia belum sempat dimuat'));
  }
});

app.get('/statistik/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const ind = st.findIndicator(slug);
  if (!ind) return res.status(404).type('html').send(statistikBusy(`Indikator "${slug}" tidak dikenali`));
  try {
    const rows = await ng.loadCountries();
    if (!rows || rows.length < 200) throw new Error('dataset kosong');
    const rk = await st.loadRanking(ind, rows);
    if (!rk.list.length) throw new Error('tiada nilai');
    res.status(200).type('html').send(statistikIndPage(req, rk, rows));
  } catch {
    res.status(503).type('html').send(statistikBusy(`Data ${ind.bm} tidak sempat dimuat`));
  }
});

// ── LALUAN KOMPLEKS BENCANA (/bencana*) — suapan acara NASA EONET, tanpa kunci ──
app.get('/bencana', async (req, res) => {
  try {
    const all = await bc.loadAllOpen();
    res.status(200).type('html').send(bencanaHubPage(req, all));
  } catch {
    res.status(503).type('html').send(bencanaBusy('Suapan acara NASA EONET tidak sempat dimuat'));
  }
});

app.get('/bencana/:cat', async (req, res) => {
  const cat = bc.findCat(String(req.params.cat || '').toLowerCase());
  if (!cat) return res.status(404).type('html').send(bencanaBusy(`Kategori "${req.params.cat}" tidak dikenali`));
  try {
    const events = await bc.loadEvents(cat);
    res.status(200).type('html').send(bencanaCatPage(req, cat, events || []));
  } catch {
    res.status(503).type('html').send(bencanaBusy(`Suapan ${cat.bm} tidak sempat dimuat`));
  }
});

app.get('/bencana/:cat/:id', async (req, res) => {
  const cat = bc.findCat(String(req.params.cat || '').toLowerCase());
  const id = String(req.params.id || '');
  if (!cat || !/^EONET_\d+$/.test(id)) return res.status(404).type('html').send(bencanaBusy('Halaman acara tidak dikenali'));
  try {
    const ev = await bc.loadEvent(id);
    res.status(200).type('html').send(bencanaEventPage(req, cat, ev));
  } catch {
    res.status(503).type('html').send(bencanaBusy(`Butiran acara ${id} tidak sempat dimuat`));
  }
});

app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  maxAge: '1h',
  redirect: false,   // jangan redirect /apps → /apps/ — biar lalu ke STATIC_PAGES
  setHeaders(res, filePath) {
    // APK pembungkus WebView — hidang sebagai muat turun dengan nama fail sebenar
    // (tukuk-<slug>.apk), supaya setiap apl gedung tersimpan dengan nama yang betul.
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
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
// NOTE: halaman AI berat (nasa/explore/builder/editor/editor-video/3d/design/movie/
// collage/converter/bg-remover/studio) + app store UI (store) telah dibuang — fokus T Chat.
const STATIC_PAGES = ['about', 'privacy', 'terms', 'contact', 'dev', 'terminal', 'settings', 'docs', 'access', 'bingbot', 'playstore', 'download', 'rekomendasi', 'os', 'sms'];
for (const name of STATIC_PAGES) {
  app.get(`/${name}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${name}.html`), (error) => {
      if (error) res.status(404).json({ error: 'Page not found', path: req.originalUrl });
    });
  });
}

// Sub-page untuk setiap app: /apps/chat → public/apps/chat.html (fokus chat sahaja)
const APPS = ['chat'];
for (const name of APPS) {
  app.get(`/apps/${name}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'apps', `${name}.html`), (error) => {
      if (error) res.status(404).json({ error: `App '${name}' does not exist yet`, path: req.originalUrl });
    });
  });
}
// Katalog app/game (/apps, /apps/) dibuang — fokus konten+chat. /apps/ → '/' supaya
// pautan lama tak 404. /apps/chat (chat) kekal dilayan oleh loop APPS di atas.
app.get(['/apps', '/apps/'], (req, res) => res.redirect(301, '/'));

// Alias bahasa supaya pautan sedia ada tidak 404
const PAGE_ALIASES = { tentang: 'about', hubungi: 'contact', terma: 'terms', privasi: 'privacy', dokumen: 'docs' };
for (const [alias, name] of Object.entries(PAGE_ALIASES)) {
  app.get(`/${alias}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${name}.html`), (error) => {
      if (error) res.status(404).json({ error: 'Page not found', path: req.originalUrl });
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

// `/cari` DIHIDUPKAN: SPA carian Meilisearch lama (web/CC, images, videos, music,
// radio, apps, NASA) — index.html yang sama, tetapi noindex + BEBAS IKLAN
// (adsense-loader.js self-skip pada /cari; dasar Google: halaman hasil carian
// tidak layak diiklankan). Cache string sekali; restart servis ↔ index.html baru.
let cariHtml = null;
app.get('/cari', (req, res) => {
  if (!cariHtml) {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    cariHtml = /name="robots"/i.test(raw)
      ? raw.replace(/<meta name="robots"[^>]*>/i, '<meta name="robots" content="noindex,follow">')
      : raw.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex,follow">');
  }
  res.type('html').send(cariHtml);
});

// Proksi imej luar — untuk lightbox & Tukuk Studio (/editor).
// Same-origin = canvas tidak "tainted", export/edge filter boleh jalan.
app.get('/api/image', limiter.search, async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'url parameter (http/https) required' });
  }
  try {
    await assertPublicUrl(targetUrl); // sekat SSRF alamat dalaman
    const upstream = await fetch(targetUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TukukOSBot/2.1; +https://tukuk.org)' }
    });
    if (!upstream.ok) return res.status(502).json({ error: `Remote responded ${upstream.status}` });
    const ct = upstream.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) return res.status(415).json({ error: `Not an image (${ct || 'unknown'})` });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 15MB)' });
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: 'Image proxy failed', details: safeError(error) });
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
  // Jawapan AI berubah selepas setiap deploy — jangan biar browser replay
  // respons lama (sebelum fix ranking) dan pengguna sangka masih rosak.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
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
      // Gabungan brain ↔ aplikasi: soalan pengguna juga dipadankan dengan
      // katalog app server ("buang background gambar" → /bg-remover).
      apps: approuter.route(question).apps,
      // Debug diagonal: `?debug=1` mendedahkan model yang dicuba-tolak (sebab
      // qwen dilangkau, ralat ollama, dsb.) dan status local-first.
      ...(req.query.debug
        ? { rejected: answer.rejectedModels || [], localFirst: Boolean(health.localFirst), cloudFallback: health.cloudFallback || [] }
        : {}),
      network: net.snapshot().status
    });
  } catch (error) {
    res.status(500).json({ error: 'Brain failed to answer', details: safeError(error) });
  }
});

app.get('/brain', async (req, res) => {
  const [health, network] = await Promise.all([brain.health(), net.check()]);
  res.json({
    enabled: config.brain.enabled,
    provider: health.cloud ? health.provider : (health.online ? 'ollama' : 'extractive'),
    cloud: Boolean(health.cloud),
    localFirst: Boolean(health.localFirst),
    cloudFallback: health.cloudFallback || [],
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
      'The 135M model can only rely on the sources it is given. ' +
      'Without sources, its answer cannot be trusted.'
  });
});

app.get('/network', async (req, res) => {
  res.json(await net.check());
});

// ── AI Data Center: inventori model AI yang berjalan di server ini ─────────
async function modelsInventory() {
  const health = await brain.health();
  let ollamaModels = [];
  try { ollamaModels = await brain.availableModels(); } catch { /* ollama offline */ }
  return {
    dataCenter: 'Tukuk-OS AI',
    backend: {
      provider: health.cloud ? health.provider : (health.online ? 'ollama' : 'extractive'),
      localFirst: Boolean(health.localFirst),
      cloudFallback: health.cloudFallback || [],
      chain: config.brain.chain,
      online: health.online,
      timeout: config.brain.timeout
    },
    ollamaModels,
    // Model AI MILIK SENDIRI — dilatih di sini oleh scripts/train-brain.js.
    ownModel: taskrouter.modelInfo(),
    reranker: {
      enabled: config.rerank.enabled,
      modelDir: config.rerank.modelDir,
      cloudEmbed: config.rerank.cloud && Boolean(process.env.CLOUDFLARE_API_TOKEN)
    },
    answerCache: rag.cacheStats()
  };
}
app.get('/api/models', async (req, res) => {
  res.json(await modelsInventory());
});

// ── App Router API: padankan teks bebas → aplikasi server ("tool use" ringan) ──
app.get('/api/apps/route', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q parameter required' });
  res.json({ ok: true, query: q, apps: approuter.route(q).apps });
});

// ── /datacenter: papan pemuka operasi — semua aplikasi + AI dalam satu pandang ──
app.get('/api/datacenter', async (req, res) => {
  try {
    const models = await modelsInventory();
    // JANGAN dedahkan spesifikasi fizikal pelayan (model CPU, teras, RAM, load,
    // uptime) ke publik — papan pemuka ini menunjuki KEBOLEHAN (model, app,
    // aktiviti), bukan perkakasan tempat ia berjalan.
    res.json({
      dataCenter: 'Tukuk-OS AI Data Center',
      models,
      apps: {
        routerEntries: approuter.CATALOG.length,
        storeItems: storeCatalog().length,
        catalog: approuter.CATALOG.map((e) => ({ name: e[0], url: e[1], ic: e[2], title: e[3] }))
      },
      activity: { ...store.stats(), answerCache: models.answerCache },
      network: net.snapshot().status,
      offline: !net.snapshot().internet
    });
  } catch (error) {
    res.status(500).json({ error: 'Data center snapshot failed', details: safeError(error) });
  }
});

app.get('/datacenter', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Data Center - Tukuk-OS</title>
<meta name="description" content="Live operations dashboard of the Tukuk-OS AI data center: models, apps, routing and activity.">
<link rel="canonical" href="https://tukuk.org/datacenter">
<style>${COMMON_CSS}</style>
</head><body><div class="wrap">
<header><h1>🏢 Tukuk-OS AI Data Center</h1>
<p class="tagline">Every application and every AI model — unified, live.</p></header>
<a class="back-link" href="/models">← Model inventory</a>
<div id="app"><p>Loading data center telemetry…</p></div>
<script>
(function () {
  var el = document.getElementById('app');
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt(n) { return Number(n || 0).toLocaleString('en'); }
  fetch('/api/datacenter').then(function (r) { return r.json(); }).then(function (d) {
    var m = d.models || {}, b = m.backend || {}, html = '';
    // Tiada kad "Compute" — maklumat perkakasan (CPU/RAM/load/uptime) tidak didedahkan.
    html += '<div class="post-card"><h2>🧠 AI stack</h2>';
    html += '<p>Provider: <strong>' + esc(b.provider) + '</strong>' + (b.localFirst ? ' · local-first' : '') + '</p>';
    html += '<p>Chain: ' + (b.chain || []).map(esc).join(' → ') + ' → cloud: ' + (((b.cloudFallback || []).length) ? b.cloudFallback.map(esc).join(', ') : 'none') + '</p>';
    html += '<p>Own model: ' + (m.ownModel && m.ownModel.loaded ? '<strong>' + esc(m.ownModel.name) + '</strong> (rescues ' + esc(m.ownModel.regexGapsRescued || '') + ' regex gaps)' : 'not trained yet') + '</p>';
    html += '<p>Local LLMs: ' + ((m.ollamaModels || []).length ? m.ollamaModels.map(function (x) { return esc(x.name); }).join(', ') : 'ollama offline') + '</p>';
    html += '<p>Reranker: ' + (m.reranker && m.reranker.enabled ? 'enabled' : 'off') + ' · Answer cache: ' + fmt((m.answerCache || {}).entries) + ' entries</p>' + (d.offline ? '<p style="color:#e0a94a">Offline — brain runs in offline mode.</p>' : '') + '</div>';
    html += '<div class="post-card"><h2>📊 Activity</h2>';
    html += '<p>Searches: ' + fmt(d.activity.searches) + ' · Questions asked: ' + fmt(d.activity.asks) + ' · Crawls: ' + fmt(d.activity.crawls) + ' · Events: ' + fmt(d.activity.events) + '</p></div>';
    html += '<div class="post-card"><h2>📱 Unified app fabric (' + d.apps.routerEntries + ' routable surfaces · ' + fmt(d.apps.storeItems) + ' store items)</h2><div style="display:flex;flex-wrap:wrap;gap:8px">';
    d.apps.catalog.forEach(function (a) {
      html += '<a href="' + esc(a.url) + '" style="display:inline-flex;gap:6px;align-items:center;padding:6px 10px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:inherit">' + esc(a.ic) + ' ' + esc(a.title) + '</a>';
    });
    html += '</div><p style="color:var(--muted);margin-top:10px">Ask anything on <a href="/">the search page</a> — answers arrive with the app that can act on them. Example: <a href="/api/apps/route?q=remove+background+from+photo">remove background from photo</a>.</p></div>';
    el.innerHTML = html;
  }).catch(function () { el.innerHTML = '<p>Could not load /api/datacenter.</p>'; });
})();
</script>
<footer>Tukuk-OS · AI Data Center · <a href="/models">models</a> · <a href="/store">store</a> · <a href="/docs">docs</a></footer>
</div></body></html>`);
});

app.get('/models', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Data Center - Tukuk-OS</title>
<meta name="description" content="Inventory of AI models running on this Tukuk-OS server: local LLMs, the self-trained intent model, and fallback providers.">
<link rel="canonical" href="https://tukuk.org/models">
<style>${COMMON_CSS}</style>
</head><body><div class="wrap">
<header><h1>🧠 AI Data Center</h1>
<p class="tagline">Every AI model this server runs — local inference, the self-trained brain, and emergency fallbacks.</p></header>
<a class="back-link" href="/">← Back to search</a>
<div id="app"><p>Loading model inventory…</p></div>
<script>
(function () {
  var el = document.getElementById('app');
  fetch('/api/models').then(function (r) { return r.json(); }).then(function (d) {
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    var html = '';
    html += '<div class="post-card"><h2>Self-trained model</h2>';
    if (d.ownModel && d.ownModel.loaded) {
      var m = d.ownModel;
      html += '<p><strong>' + esc(m.name) + ' ' + esc(m.version) + '</strong> — ' + esc(m.purpose) + '</p>';
      html += '<p>Classes: ' + (m.classes || []).map(esc).join(', ') + '</p>';
      if (m.accuracy != null) html += '<p>Holdout accuracy: ' + (m.accuracy * 100).toFixed(1) + '%' + (m.probeAccuracy != null ? ' · unseen-phrase probe: ' + (m.probeAccuracy * 100).toFixed(0) + '%' : '') + (m.regexGapsRescued ? ' · regex gaps rescued: ' + esc(m.regexGapsRescued) : '') + '</p>';
      html += '<p>Trained: ' + esc(m.trainedAt || '').slice(0, 10) + ' on <code>' + esc(m.host || '') + '</code> from ' + (m.sources ? (m.sources.seed + ' curated + ' + m.sources.productionLog + ' production-log samples') : 'local data') + '</p>';
      html += '<p style="color:var(--muted)">Retrain any time: <code>node scripts/train-brain.js</code></p>';
    } else {
      html += '<p>No self-trained model found. Run <code>node scripts/train-brain.js</code> on the server, then restart the service.</p>';
    }
    html += '</div>';
    html += '<div class="post-card"><h2>Local LLMs (Ollama)</h2>';
    if ((d.ollamaModels || []).length) {
      html += '<table style="width:100%;border-collapse:collapse">';
      d.ollamaModels.forEach(function (mo) {
        html += '<tr><td style="padding:6px 0;border-bottom:1px solid var(--line)">' + esc(mo.name) + '</td>'
          + '<td style="border-bottom:1px solid var(--line)">' + esc(mo.parameters || '') + '</td>'
          + '<td style="border-bottom:1px solid var(--line)">' + mo.sizeMb + ' MB</td></tr>';
      });
      html += '</table>';
    } else { html += '<p>Ollama offline — no local models reachable.</p>'; }
    html += '</div>';
    html += '<div class="post-card"><h2>Routing</h2>';
    html += '<p>Active provider: <strong>' + esc(d.backend.provider) + '</strong>' + (d.backend.localFirst ? ' (local-first)' : '') + '</p>';
    html += '<p>Chain order: ' + (d.backend.chain || []).map(esc).join(' → ') + '</p>';
    html += '<p>Emergency cloud: ' + ((d.backend.cloudFallback || []).length ? d.backend.cloudFallback.map(esc).join(', ') : 'none configured') + '</p>';
    html += '</div>';
    el.innerHTML = html;
  }).catch(function () { el.innerHTML = '<p>Could not load /api/models.</p>'; });
})();
</script>
<footer>Tukuk-OS · AI Data Center · <a href="/docs">docs</a> · <a href="/about">about</a></footer>
</div></body></html>`);
});

app.get('/sitemap.xml', async (req, res) => {
  const host = req.get('host') || 'tukuk.org';
  const base = host.includes('tukuk.org') ? `https://${host}` : `${req.protocol}://${host}`;
  // Hanya halaman HIDUP (yang balas 200) — buang yang sudah dibuang (/store, /explore,
  // /studio, /builder, /editor*, /movie, /design, /3d, /bg-remover, /collage, /converter,
  // /apps→301, /play, /models, /datacenter, /bingbot) supaya sitemap tak sarat 404.
  const staticPages = ['', '/nasa', '/nasa/archive', '/nasa/sky', '/nasa/iss', '/nasa/asteroids', '/nasa/space-weather', '/nasa/mars', '/nasa/earth', '/nasa/exoplanets', '/nasa/sounds', '/nasa/satellites', '/cuaca', '/cuaca/peta', '/cuaca/ekstrem', '/cuaca/kod', '/cuaca/awan', '/cuaca/angin', '/gempa', '/gempa/penjelasan', '/cuti', '/cuti/dunia/asia', '/cuti/dunia/europe', '/cuti/dunia/americas', '/cuti/dunia/africa', '/cuti/dunia/oceania', '/cuti/2026', '/cuti/2027', '/cuti/hujung-minggu-panjang', '/cuti/penjelasan', '/negara', '/negara/asia', '/negara/europe', '/negara/africa', '/statistik', '/bencana', '/wiki', '/blog', '/learn', '/study', '/study/science', '/study/geography', '/study/history', '/study/experiments', '/study/riddles', '/study/facts', '/study/math', '/study/alarm', '/udara', '/udara/oxygen', '/udara/breath', '/udara/carbon', '/docs', '/about', '/privacy', '/terms', '/contact', '/access', '/download', '/rekomendasi', '/os', '/apps/chat'];
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

// ── SITEMAP NASA — klaster APOD harian ──────────────────────────────────────
// NASA telah menerbitkan SATU gambar + penjelasan setiap hari sejak 16 Jun 1995.
// Kita mirrorkan sebagai ±11,000 halaman unik (/nasa/apod/YYYY-MM-DD) — setiap
// satu berbeza kandungan, berindeks, dan beriklan. Dipotong ikut tahun supaya
// satu fail nie lebih kecil daripada had 50,000 URL Google dan jana kekal ringan
// (dijana semasa permintaan, O(366) string, tiada API dipanggil).
function apodDatesInYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1995 || y > new Date().getUTCFullYear()) return null;
  const first = Date.parse(`${APOD_FIRST_DAY}T00:00:00Z`);
  const start = Math.max(first, Date.UTC(y, 0, 1));
  const end = Math.min(Date.UTC(y, 11, 31), Date.now());
  const out = [];
  for (let t = start; t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

app.get('/sitemap-nasa.xml', (req, res) => {
  const thisYear = new Date().getUTCFullYear();
  const years = [];
  for (let y = 1995; y <= thisYear; y += 1) years.push(y);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + years.map((y) => `  <sitemap>\n    <loc>https://tukuk.org/sitemap-nasa-${y}.xml</loc>\n  </sitemap>`).join('\n')
    + '\n</sitemapindex>\n'
  );
});

// Laluan bertailkan `.xml` ditulis sebagai regex — bentuk `:year.xml` tidak
// boleh dipercayai merentas versi path-to-regexp.
app.get(/^\/sitemap-nasa-(\d{4})\.xml$/, (req, res) => {
  const dates = apodDatesInYear(req.params[0]);
  if (!dates) return res.status(404).type('text/plain').send('Unknown APOD year');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + dates.map((d) => `  <url>\n    <loc>https://tukuk.org/nasa/apod/${d}</loc>\n    <lastmod>${d}</lastmod>\n    <changefreq>yearly</changefreq>\n    <priority>0.6</priority>\n  </url>`).join('\n')
    + '\n</urlset>\n'
  );
});

// ── SITEMAP CUACA — setiap kota DB × 3 halaman (kota, udara, surya) + statik ──
// Kota geokoding dinamik TIDAK tersenarai (tiada senarai tetap) tetapi sentiasa
// ditemui melalui hab pautan hub /cuaca + pautan silang halaman kota.
app.get('/sitemap-cuaca.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const special = ['/cuaca', '/cuaca/peta', '/cuaca/ekstrem', '/cuaca/kod', '/cuaca/awan', '/cuaca/angin']
    .map((p) => `  <url>\n    <loc>https://tukuk.org${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>${p === '/cuaca' ? '0.9' : '0.7'}</priority>\n  </url>`).join('\n');
  const cities = wx.CITIES.map((c) => (
    `  <url>\n    <loc>https://tukuk.org/cuaca/${c.slug}</loc>\n    <changefreq>hourly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`
    + `  <url>\n    <loc>https://tukuk.org/cuaca/${c.slug}/udara</loc>\n    <changefreq>hourly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`
    + `  <url>\n    <loc>https://tukuk.org/cuaca/${c.slug}/surya</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`
  )).join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + special + '\n' + cities + '\n</urlset>\n'
  );
});

// ── SITEMAP GEMPA — hub + 5 rantau (jamly) + penjelasan (bulanan) ──
app.get('/sitemap-gempa.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = ['/gempa']
    .concat(gp.REGIONS.map((r) => `/gempa/${r.slug}`))
    .map((p) => `  <url>\n    <loc>https://tukuk.org${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>${p === '/gempa' ? '0.9' : '0.7'}</priority>\n  </url>`)
    .join('\n');
  const explain = `  <url>\n    <loc>https://tukuk.org/gempa/penjelasan</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls + '\n' + explain + '\n</urlset>\n'
  );
});

// ── SITEMAP CUTI — hab dunia + 5 rantau + semua negara disokong + seksyen Malaysia ──
app.get('/sitemap-cuti.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const one = (p, prio, freq) => `  <url>\n    <loc>https://tukuk.org${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${freq || 'weekly'}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  const special = [one('/cuti', '0.9'), one('/cuti/hujung-minggu-panjang', '0.8'),
    one(`/cuti/${cu.YEAR_MIN}`, '0.7'), one(`/cuti/${cu.YEAR_MAX}`, '0.7'), one('/cuti/penjelasan', '0.6', 'monthly')].join('\n');
  const world = cd.REGIONS.map((r) => one(`/cuti/dunia/${r.slug}`, '0.7', 'monthly'))
    .concat(cd.COUNTRIES.map(([cca2]) => one(`/cuti/dunia/${cd.findCountry(cca2).slug}`, '0.6', 'monthly'))).join('\n');
  const states = cu.STATES.map((st) => `  <url>\n    <loc>https://tukuk.org/cuti/${st.slug}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n  <url>\n    <loc>https://tukuk.org/cuti/${st.slug}?tahun=${cu.YEAR_MAX}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.5</priority>\n  </url>`).join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + special + '\n' + world + '\n' + states + '\n</urlset>\n'
  );
});

// ── SITEMAP NEGARA — hab + 6 rantau + ±250 negara (daripada cache gabungan) ──
// Negara masuk sitemap hanya bila dataset berjaya dimuat; jika sumber luar lambat,
// fallback hab + rantau sahaja supaya fail XML tetap sah & boleh diindeks.
app.get('/sitemap-negara.xml', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const one = (p, prio) => `  <url>\n    <loc>https://tukuk.org${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  const special = ['/negara'].concat(ng.REGIONS.map((r) => `/negara/${r.slug}`))
    .map((p) => one(p, p === '/negara' ? '0.9' : '0.7')).join('\n');
  let countries = '';
  try {
    const rows = await ng.loadCountries();
    countries = rows.map((c) => one(`/negara/${c.slug}`, '0.6')).join('\n');
  } catch { /* sumber lambat → hab + rantau sahaja */ }
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + special + (countries ? '\n' + countries : '') + '\n</urlset>\n'
  );
});

// ── SITEMAP STATISTIK — hab + setiap indikator (senarai statik, sentiasa sah) ──
app.get('/sitemap-statistik.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const one = (p, prio) => `  <url>\n    <loc>https://tukuk.org${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  const urls = [one('/statistik', '0.9')].concat(st.INDICATORS.map((i) => one(`/statistik/${i.slug}`, '0.7'))).join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
});

// ── SITEMAP BENCANA — hab + kategori + acara masih dibuka (had 900 URL) ──
// Suapan langsung: jika EONET lambat, hab + kategori tetap dihantar supaya XML sah.
app.get('/sitemap-bencana.xml', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const one = (p, prio) => `  <url>\n    <loc>https://tukuk.org${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  const urls = [one('/bencana', '0.9')].concat(bc.CATS.map((c) => one(`/bencana/${c.slug}`, '0.7')));
  try {
    const all = await bc.loadAllOpen();
    let budget = 900;
    for (const block of all) {
      if (!block.events || !budget) continue;
      for (const ev of block.events.slice(0, budget)) urls.push(one(`/bencana/${block.cat.slug}/${encodeURIComponent(ev.id)}`, '0.6'));
      budget -= Math.min(block.events.length, budget);
    }
  } catch { /* suapan gagal → hab + kategori sahaja */ }
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
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
  /* Site chrome — bar atas penuh, hero, grid feed, footer berbilang lajur. */
  .site-top { position:sticky; top:0; z-index:50; background:var(--panel); border-bottom:1px solid var(--line); }
  .wrap-w { max-width:1080px; margin:0 auto; padding:0 20px; }
  .topbar { display:flex; align-items:center; gap:16px; flex-wrap:wrap; padding:11px 0; }
  .brand { display:inline-flex; align-items:center; gap:9px; font-weight:700; font-size:1.08rem; letter-spacing:-.3px; color:var(--text); }
  .brand:hover { text-decoration:none; }
  .brand .logo { width:26px; height:26px; border-radius:6px; display:block; }
  .topnav { display:flex; gap:4px; flex-wrap:wrap; margin-left:auto; align-items:center; }
  .topnav a { color:var(--muted); padding:7px 11px; border-radius:8px; font-weight:500; font-size:.95rem; }
  .topnav a:hover { color:var(--text); background:var(--bg); text-decoration:none; }
  .topnav a.active { color:var(--text); background:var(--bg); }
  .hero { padding:44px 0 28px; border-bottom:1px solid var(--line); background:linear-gradient(180deg,var(--panel),var(--bg)); }
  .hero h1 { font-size:2.4rem; margin:0 0 12px; }
  .hero p { color:var(--muted); font-size:1.12rem; max-width:64ch; margin:0; line-height:1.6; }
  .hero .cta { margin-top:22px; display:flex; gap:12px; flex-wrap:wrap; }
  .btn { display:inline-block; padding:10px 18px; border-radius:10px; font-weight:600; }
  .btn.primary { background:var(--accent); color:#fff; } .btn.primary:hover { text-decoration:none; filter:brightness(1.08); }
  .btn.ghost { border:1px solid var(--line); color:var(--text); } .btn.ghost:hover { border-color:var(--accent); text-decoration:none; }
  .section-title { margin:34px 0 6px; font-size:1.35rem; }
  .feed { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; }
  .feed .post-card { margin:0; }
  @media (max-width:680px){ .feed { grid-template-columns:1fr; } .hero h1 { font-size:1.9rem; } }
  .site-foot { margin-top:54px; border-top:1px solid var(--line); background:var(--panel); }
  .foot-cols { display:grid; grid-template-columns:1.5fr repeat(4,1fr); gap:26px; padding:38px 0 22px; }
  @media (max-width:900px){ .foot-cols { grid-template-columns:1fr 1fr; } .brand-foot { grid-column:1 / -1; } }
  .foot-cols h4 { margin:0 0 12px; font-size:.82rem; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); }
  .foot-cols h4 + h4, .foot-cols ul + h4 { margin-top:18px; }
  .foot-cols ul { list-style:none; margin:0; padding:0; }
  .foot-cols li { margin:0 0 9px; }
  .foot-cols a { color:var(--text); opacity:.85; font-size:.94rem; } .foot-cols a:hover { opacity:1; color:var(--accent); text-decoration:none; }
  .brand-foot p { color:var(--muted); font-size:.92rem; line-height:1.6; max-width:40ch; margin:10px 0 0; }
  .foot-bottom { border-top:1px solid var(--line); padding:16px 0 30px; color:var(--muted); font-size:.86rem; display:flex; gap:8px; flex-wrap:wrap; justify-content:space-between; }
`;

// Blog routes
// AdSense: hanya papar unit bila AKTIF + client `ca-pub-…` sah + slot numerik.
// `2206273113` dah disahkan unit SEBENAR ("test banner", akaun ini) — guard
// placeholder lama dibuang; slot kosong bukan-numerik tetap ditolak.
function adsenseClient() {
  const c = String(store.getSetting('adsClient', config.adsense.client) || '').trim();
  return /^ca-pub-\d+$/.test(c) ? c : '';
}
function adsenseOn() {
  // Togel Admin (`adsEnabled`) menjadi tuan bila pernah disentuh; jika belum,
  // ikut config/env (default ON). Ini memastikan halaman utama (klien) & blog/app
  // (pelayan) memakai SATU punca kebenaran yang sama.
  const toggle = store.getSetting('adsEnabled', null);
  const enabled = (toggle === null) ? config.adsense.enabled : Boolean(toggle);
  return enabled && adsenseClient();
}
function realSlot(slot) {
  const s = String(slot || '').trim();
  return /^\d+$/.test(s) ? s : '';
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

// Rangkaian iklan PANTAS (Adsterra / PropellerAds / HilltopAds, dll): Admin tampal
// SATU URL skrip universal + aktifkan togel. Bila aktif, ia GANTIKAN AdSense pada
// halaman yang sama — elak "mixed/competing ad networks" yang boleh buat akaun
// AdSense di-BAN. AdSense auto-resume bila togel ini dimatikan.
function thirdPartyAdTag() {
  if (!store.getSetting('thirdPartyAdEnabled', false)) return '';
  const src = String(store.getSetting('thirdPartyAdSrc', '')).trim();
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(src)) return '';
  return `<script async src="${escapeHtml(src)}"></script>`;
}
// Skrip <head> untuk halaman dilayar pelayan (blog/artikel): third-party ATAU AdSense.
function pageAdScript() {
  return thirdPartyAdTag() || adsenseLoader();
}
// Microsoft Clarity (analitik penggunaan) — sudah didedahkan dalam /privacy. ID projek
// Clarity bersifat awam (tersemat dalam URL tag), jadi fallback lalai selamat. Togel
// Admin `clarityEnabled` (lalai HIDUP) mematikannya serta-merta pada semua halaman.
const DEFAULT_CLARITY_ID = 'ytshvg0zer';
function clarityIdValue() {
  return String(store.getSetting('clarityId', process.env.CLARITY_PROJECT_ID || DEFAULT_CLARITY_ID) || '').trim();
}
function clarityEnabledValue() {
  // Lalai HIDUP (sudah didedahkan dalam /privacy); boleh dimatikan melalui
  // env CLARITY_ENABLED atau togel Admin (yang menyimpan store `clarityEnabled`).
  const envDefault = typeof process.env.CLARITY_ENABLED !== 'undefined'
    ? /^(1|true|yes|on)$/i.test(process.env.CLARITY_ENABLED)
    : true;
  return Boolean(store.getSetting('clarityEnabled', envDefault));
}
function clarityScript() {
  if (!clarityEnabledValue()) return '';
  const id = clarityIdValue();
  if (!/^[a-z0-9]+$/i.test(id)) return '';
  return `<script async src="https://www.clarity.ms/tag/${escapeHtml(id)}"></script>`;
}
// Unit dalam-kandungan: jika third-party ON, jangan susun <ins> AdSense pada halaman sama.
function adUnitGuarded(slot, label) {
  return thirdPartyAdTag() ? '' : adUnit(slot, label);
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

// Chrome laman dikongsi: bar atas (brand + nav + togel tema) dan footer berlapis penuh.
// `active` menandakan pautan halaman semasa (home|blog|nasa|learn|docs|about).
function siteHeader(active) {
  const a = String(active || '');
  const link = (href, label, key) => `<a href="${href}"${a === key ? ' class="active" aria-current="page"' : ''}>${label}</a>`;
  return `<div class="site-top"><div class="wrap-w"><div class="topbar">
    <a class="brand" href="/"><img class="logo" src="/icon.svg" alt="" width="26" height="26">Tukuk-OS</a>
    <nav class="topnav" aria-label="Primary">
      ${link('/', 'Home', 'home')}
      ${link('/cari', 'Search', 'cari')}
      ${link('/blog', 'Blog', 'blog')}
      ${link('/wiki', 'Wiki', 'wiki')}
      ${link('/nasa', 'NASA', 'nasa')}
      ${link('/cuaca', 'Weather', 'cuaca')}
      ${link('/learn', 'Learn', 'learn')}
      ${link('/docs', 'Docs', 'docs')}
      ${link('/about', 'About', 'about')}
      <span class="theme-tools">
        <button type="button" id="theme-toggle" class="tk-btn" aria-label="Colour theme">\u25d0</button>
        <span class="tk-accents" role="group" aria-label="Accent colour">
          <button type="button" data-accent-set="blue" class="tk-dot" aria-label="Blue"></button>
          <button type="button" data-accent-set="green" class="tk-dot" aria-label="Green"></button>
          <button type="button" data-accent-set="violet" class="tk-dot" aria-label="Violet"></button>
          <button type="button" data-accent-set="amber" class="tk-dot" aria-label="Amber"></button>
          <button type="button" data-accent-set="rose" class="tk-dot" aria-label="Rose"></button>
        </span>
      </span>
    </nav>
  </div></div></div>`;
}

function siteFooter() {
  return `<footer class="site-foot"><div class="wrap-w">
  <div class="foot-cols">
    <div class="brand-foot">
      <a class="brand" href="/"><img class="logo" src="/icon.svg" alt="" width="26" height="26">Tukuk-OS</a>
      <p>Independent articles, guides and reference on technology, privacy, servers, astronomy and the open web \u2014 free to read, no account required.</p>
    </div>
    <div><h4>Explore</h4><ul>
      <li><a href="/">Home</a></li>
      <li><a href="/cari">Search</a></li>
      <li><a href="/blog">Blog</a></li>
      <li><a href="/wiki">Wiki</a></li>
      <li><a href="/learn">Learn</a></li>
      <li><a href="/study">General Knowledge</a></li>
      <li><a href="/udara">Air & Oxygen</a></li>
      <li><a href="/docs">Docs</a></li>
    </ul></div>
    <div><h4>NASA Space</h4><ul>
      <li><a href="/nasa">Picture of the Day</a></li>
      <li><a href="/nasa/archive">APOD Archive</a></li>
      <li><a href="/nasa/sky">Sky Tonight</a></li>
      <li><a href="/nasa/iss">ISS Live</a></li>
      <li><a href="/nasa/asteroids">Asteroid Watch</a></li>
      <li><a href="/nasa/exoplanets">Exoplanets</a></li>
    </ul></div>
    <div><h4>Weather</h4><ul>
      <li><a href="/cuaca">World Weather</a></li>
      <li><a href="/cuaca/peta">Weather map</a></li>
      <li><a href="/cuaca/ekstrem">World extremes</a></li>
      <li><a href="/cuaca/awan">Cloud types</a></li>
      <li><a href="/cuaca/angin">Beaufort wind scale</a></li>
      <li><a href="/cuaca/kod">Weather codes</a></li>
      <li><a href="/gempa">World Earthquakes</a></li>
      <li><a href="/gempa/dunia">Major Quakes M4.5+</a></li>
      <li><a href="/negara">World countries</a></li>
      <li><a href="/statistik">World statistics</a></li>
      <li><a href="/bencana">Live disaster watch</a></li>
      <li><a href="/cuti">World public holidays</a></li>
    </ul></div>
    <div><h4>Site</h4><ul>
      <li><a href="/about">About</a></li>
      <li><a href="/contact">Contact</a></li>
      <li><a href="/download">Download</a></li>
      <li><a href="/rekomendasi">Recommended</a></li>
      <li><a href="/access">Global Access</a></li>
    </ul>
    <h4>Legal</h4><ul>
      <li><a href="/privacy">Privacy</a></li>
      <li><a href="/terms">Terms</a></li>
    </ul></div>
  </div>
  <div class="foot-bottom">
    <span>&copy; 2026 Tukuk-OS. All rights reserved.</span>
    <span>A free, open, privacy-friendly knowledge site.</span>
  </div>
</div></footer>
<script src="/read-aloud.js" defer></script>`;
}

// Hab konten — senarai artikel. asHome=true bila dihidang di '/' (tukuk.org = konten, bukan carian).
function renderBlogListPage(req, asHome) {
  const posts = store.getAllPosts(100);
  const selfUrl = asHome ? 'https://tukuk.org/' : 'https://tukuk.org/blog';
  const titleText = asHome
    ? 'Tukuk-OS \u2014 Articles, Guides & Tech Knowledge'
    : 'Blog & Tech Knowledge Base \u2014 Tukuk-OS';
  const pageDesc = asHome
    ? 'In-depth articles, how-to guides and analysis on technology, privacy, Android, servers and the open web.'
    : 'Articles, tutorials and analysis on search engine technology, data privacy and artificial intelligence from Tukuk-OS.';
  const jsonLdBlog = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": "https://tukuk.org/blog#blog",
    "name": "Blog & Tech Knowledge Base \u2014 Tukuk-OS",
    "description": pageDesc,
    "url": selfUrl,
    "inLanguage": "en",
    "publisher": { "@type": "Organization", "name": "Tukuk-OS", "url": "https://tukuk.org" },
    "blogPost": posts.slice(0, 30).map((p) => ({
      "@type": "BlogPosting",
      "headline": p.title,
      "url": `https://tukuk.org/blog/${p.slug}`,
      "datePublished": p.createdAt
    }))
  }).replace(/</g, '\\u003c');
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleText)}</title>
<meta name="description" content="${escapeHtml(pageDesc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(titleText)}">
<meta property="og:description" content="${escapeHtml(pageDesc)}">
<meta property="og:url" content="${selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(titleText)}">
<meta name="twitter:description" content="${escapeHtml(pageDesc)}">
<meta name="twitter:image" content="https://tukuk.org/og.png">
<link rel="canonical" href="${selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<link rel="alternate" type="application/rss+xml" title="Tukuk-OS Blog" href="/blog/rss.xml">
<script type="application/ld+json">${jsonLdBlog}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${COMMON_CSS}</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader(asHome ? 'home' : 'blog')}
<div class="wrap">
  ${asHome
    ? `<section class="hero"><h1>Tukuk-OS &mdash; Knowledge &amp; How-To Library</h1><p>Original, in-depth articles and guides on technology, privacy, servers, astronomy and the open web \u2014 free to read, no account needed.</p><div class="cta"><a class="btn primary" href="/blog">Browse all articles</a><a class="btn ghost" href="/nasa">Today\u2019s NASA picture</a></div></section>`
    : `<header><h1>Blog &amp; Knowledge Archive</h1><p class="tagline">In-depth articles on search engine technology, cybersecurity, semantic AI and web privacy.</p></header>`}
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}${asHome ? '<h2 class="section-title">Latest articles</h2><div class="feed">' : ''}`;

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

  html += `${asHome ? '</div>' : ''}
  ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
  return html;
}

// Halaman NASA APOD sebagai KANDUNGAN yang boleh di-index + beriklan (bukan SPA noindex lama).
// Teks penjelasan dihantar dari pelayan = bahan SEO sebenar; imej domain-awam = trafik gambar
// global. Ni-astronomi ialah ceruk CPC sederhana yang sesuai untuk AdSense.
function renderNasaApodPage(req, apod) {
  const a = apod && typeof apod === 'object' ? apod : {};
  const title = String(a.title || 'Astronomy Picture of the Day').trim();
  const dateStr = String(a.date || new Date().toISOString().slice(0, 10)).trim();
  const explanation = String(a.explanation || '').trim();
  const mediaType = String(a.media_type || 'image').toLowerCase();
  const selfUrl = 'https://tukuk.org/nasa';
  const isVideo = mediaType === 'video';
  const img = isVideo
    ? (nasaVideoPoster(a) || (Array.isArray(a.thumbs) && a.thumbs.length ? String(a.thumbs[a.thumbs.length - 1].url || '') : ''))
    : String(a.hdurl || a.url || '');
  const ogImage = /^https?:\/\//i.test(img) ? img : 'https://tukuk.org/og.png';
  const desc = (explanation.replace(/\s+/g, ' ').slice(0, 155)).trim() || 'Today\u2019s Astronomy Picture of the Day \u2014 a space image and explanation from NASA, mirrored at Tukuk-OS.';
  const dateLabel = (() => { const d = new Date(dateStr); return isNaN(d) ? dateStr : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }); })();
  const jsonLd = JSON.stringify(isVideo
    ? {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      'name': title,
      'description': String(explanation || '').replace(/\s+/g, ' ').slice(0, 300),
      'contentUrl': /^https?:\/\//i.test(String(a.url || '')) ? String(a.url) : undefined,
      'thumbnailUrl': /^https?:\/\//i.test(img) ? img : undefined,
      'datePublished': dateStr,
      'publisher': { '@type': 'Organization', 'name': 'NASA' },
      'url': selfUrl,
    }
    : {
      '@context': 'https://schema.org',
      '@type': 'ImageObject',
      'name': title,
      'caption': title,
      'contentUrl': /^https?:\/\//i.test(img) ? img : undefined,
      'datePublished': dateStr,
      'creditText': 'NASA',
      'creator': { '@type': 'Organization', 'name': 'NASA' },
      'url': selfUrl,
    }).replace(/</g, '\\u003c');
  const explanationHtml = explanation
    ? explanation.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')
    : '<p>NASA has not published an explanation for today\u2019s picture yet.</p>';
  const imgHtml = isVideo
    ? nasaVideoPlayer(a.url, title, true)
    : /^https?:\/\//i.test(img)
    ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(title)} \u2014 Astronomy Picture of the Day" width="1280" height="800" loading="eager" decoding="async" style="max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line)">`
    : `<p><a href="${escapeHtml(String(a.url || selfUrl))}" rel="noopener" target="_blank">View today\u2019s media on NASA</a></p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} \u2014 Astronomy Picture of the Day (${escapeHtml(dateStr)}) | Tukuk-OS</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${selfUrl}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="canonical" href="${selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${jsonLd}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${COMMON_CSS}</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('nasa')}
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="tagline">Astronomy Picture of the Day &middot; ${escapeHtml(dateLabel)} &middot; Image &amp; explanation courtesy of NASA (public domain).</p>
  </header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    <p class="back-link"><a href="/">&larr; Back to Tukuk-OS</a></p>
    ${imgHtml}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    <article>${explanationHtml}</article>
    <p class="meta">Source: NASA APOD. Mirror for search &amp; reading convenience at Tukuk-OS. Browse <a href="/nasa/archive">three decades of archive</a> or more in the <a href="/blog">knowledge base</a>.</p>
    ${nasaSpaceNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

// ── TUKUK-OS SPACE COMPLEX — banyak halaman konten SEO di atas data NASA live ──
// Semua data diambil ATAS PERMINTAAN melalui src/nasa.js (cache 2–12 jam +
// circuit-breaker sedia ada) → tiada kerja latar baru, server kekal ringan.
// Setiap halaman: index,follow + 3 unit iklan + JSON-LD + nasaSpaceNav() sebagai
// hab pautan-silang (internal link mengukuhkan seluruh kluster NASA di Google).
const NASA_SECTIONS = [
  { href: '/nasa', icon: '\uD83C\uDF20', name: 'Picture of the Day', blurb: "Today's Astronomy Picture of the Day, with NASA's own explanation." },
  { href: '/nasa/archive', icon: '\uD83D\uDDC4', name: 'APOD Archive', blurb: 'Three decades of universe — browse and search every picture we hold.' },
  { href: '/nasa/sky', icon: '\uD83C\uDF19', name: 'Sky Tonight', blurb: 'Moon phase, illumination and twilight times for tonight\u2019s stargazing.' },
  { href: '/nasa/iss', icon: '\uD83D\uDEF8', name: 'ISS Live', blurb: 'Where the Space Station orbits right now — and who is aboard.' },
  { href: '/nasa/asteroids', icon: '\u2604\uFE0F', name: 'Asteroid Watch', blurb: 'This week\u2019s close approaches plus the JPL Sentry risk table.' },
  { href: '/nasa/space-weather', icon: '\uD83C\uDF1E', name: 'Space Weather', blurb: 'Solar flares, sunspot number and what the Sun is doing this week.' },
  { href: '/nasa/mars', icon: '\uD83D\uDD34', name: 'Mars Rovers', blurb: 'Latest surface photos from Curiosity and Perseverance.' },
  { href: '/nasa/earth', icon: '\uD83C\uDF0D', name: 'EPIC Earth', blurb: 'The whole planet in one frame, imaged a million miles away by DSCOVR.' },
  { href: '/nasa/exoplanets', icon: '\uD83E\uDEF5', name: 'Exoplanets', blurb: 'Worlds around other stars — the nearest ones, ranked by distance.' },
  { href: '/nasa/sounds', icon: '\uD83D\uDD0A', name: 'Sounds of Space', blurb: 'Apollo chatter, planets and rockets — free NASA audio, playable here.' },
  { href: '/nasa/satellites', icon: '\uD83D\uDCE1', name: 'Satellites', blurb: 'Who is up there: stations, weather birds and the navigation fleet.' },
];

function nasaSpaceNav() {
  return `<nav aria-label="NASA sections"><h2 class="section-title">Explore the Tukuk-OS Space Complex</h2><div class="feed">`
    + NASA_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${s.name}</a></h2><p>${s.blurb}</p></div>`).join('')
    + `</div></nav>`;
}

function nasaImg(url, alt, eager) {
  if (!/^https?:\/\//i.test(String(url || ''))) return '';
  // width/height + CSS height:auto → nisbah rizab (CLS); kotak sebenar tetap CSS yang tentukan.
  return `<img class="nasa-img" src="${escapeHtml(url)}" alt="${escapeHtml(alt || 'NASA space image (public domain)')}" width="1280" height="720" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
}

// APOD media_type=video (termasuk entri "Sonified:") — URL YouTube BUKAN untuk <img>.
// ID video → player iframe (CSP frame-src meluluskan youtube-nocookie) + poster untuk og:.
function nasaVideoId(url) {
  const m = String(url || '').match(/(?:[?&]v=|youtu\.be\/|embed\/)([\w-]{6,20})/);
  return m ? m[1] : null;
}
function nasaVideoPlayer(url, title, eager) {
  const id = nasaVideoId(url);
  if (!id) {
    const u = /^https?:\/\//i.test(String(url || '')) ? String(url) : 'https://apod.nasa.gov';
    return `<p><a href="${escapeHtml(u)}" rel="noopener" target="_blank">▶ Watch today’s video on the source</a></p>`;
  }
  return `<iframe class="nasa-img" style="aspect-ratio:16/9;width:100%;max-width:853px;max-height:480px" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}" title="${escapeHtml(String(title || 'NASA video'))}" loading="${eager ? 'eager' : 'lazy'}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
}
function nasaVideoPoster(a) {
  const t = String((a && a.thumbnail_url) || '');
  if (/^https?:\/\//i.test(t)) return t;
  const id = nasaVideoId(a && a.url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

function nasaParas(text, limit) {
  return String(text || '').split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, limit || 6)
    .map((s) => `<p>${escapeHtml(s)}</p>`).join('');
}

function nasaFmt(n) { return Number(n || 0).toLocaleString('en-US'); }

// Pelukan halaman standard seksyen NASA: head SEO penuh + chrome situs + unit
// iklan top / in-article / bottom + nav silang. `body` dari pemanggil ialah HTML
// yang sudah selamat (panggil escapeHtml sendiri untuk data dinamik).
function nasaDoc(o) {
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ogImage = o.image || 'https://tukuk.org/og.png';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
.nasa-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.nasa-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21)}
.nasa-card h3{margin:0 0 6px;font-size:.9rem;color:var(--muted,#9aa3b2);font-weight:600}
.nasa-card .big{font-size:1.45rem;font-weight:700}
.nasa-img{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line);display:block;margin:0 auto}
table.nasa-table{width:100%;border-collapse:collapse;font-size:.9rem;margin:14px 0}
.nasa-table th,.nasa-table td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.nasa-table th{background:var(--panel,#171a21)}
.nasa-daynav{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.nasa-haz{color:#e5534b;font-weight:700}
.nasa-ok{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21);margin:14px 0}
.nasa-photos{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}
.nasa-photos figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel,#171a21)}
.nasa-photos img{width:100%;height:170px;object-fit:cover;display:block}
.nasa-photos figcaption{padding:8px 10px;font-size:.82rem;color:var(--muted,#9aa3b2)}
.nasa-map{width:100%;max-width:760px;height:auto;border:1px solid var(--line);border-radius:10px;display:block;margin:16px auto;background:#0a1020}
.nasa-bar{height:10px;border-radius:6px;background:var(--accent,#4c8dff);margin-top:4px}
.nasa-barwrap{border:1px solid var(--line);border-radius:6px;background:var(--panel,#171a21);padding:6px 10px;margin:6px 0}
.nasa-strip{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
.nasa-strip button{border:1px solid var(--line);background:var(--panel,#171a21);color:var(--text);border-radius:8px;padding:6px 10px;font-size:.82rem;cursor:pointer}
.nasa-strip button.on{border-color:var(--accent,#4c8dff);color:var(--accent,#4c8dff)}
.nasa-audio{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0;background:var(--panel,#171a21)}
.nasa-audio h3{margin:0 0 6px;font-size:1rem}
.nasa-audio p{color:var(--muted,#9aa3b2);font-size:.88rem;margin:0 0 10px}
.nasa-audio audio{width:100%}
@media(max-width:680px){.nasa-grid{grid-template-columns:1fr}.nasa-photos{grid-template-columns:1fr}table.nasa-table{display:block;overflow-x:auto}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('nasa')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${nasaSpaceNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

// Gagal data → halaman mesra-CARI (503) tanpa menjejaskan indeks halaman lain.
function nasaBusy(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escapeHtml(msg)} | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>${escapeHtml(msg)}</h1><p>The NASA feed is briefly unreachable. Please try again in a few minutes.</p><p><a href="/nasa">Back to the Space Complex</a></p></body>`;
}

// APOD ikut tarikh — /nasa/apod/1997-08-26 dan seterusnya. Ini penjana halaman
// SEO terbesar kita: NASA menerbitkan APOD sejak 16 Jun 1995 = ±11,000 halaman
// unik berindeks, satu per hari, tanpa penulisan manual.
function nasaApodDatePage(req, apod, dateStr) {
  const a = Array.isArray(apod) ? apod[0] : (apod || {});
  const title = String(a.title || 'APOD').slice(0, 120);
  const selfUrl = `https://tukuk.org/nasa/apod/${dateStr}`;
  const day = 86400000;
  const shift = (n) => { const d = new Date(Date.parse(dateStr + 'T12:00:00Z') + n * day); return d.toISOString().slice(0, 10); };
  const prev = shift(-1); const next = shift(1);
  const isVideo = String(a.media_type || '') === 'video';
  const imgHtml = isVideo
    ? nasaVideoPlayer(a.url, title, true)
    : nasaImg(a.hdurl || a.url, `${title} — APOD for ${dateStr}`, true);
  const poster = isVideo ? nasaVideoPoster(a) : '';
  const jsonLd = JSON.stringify(isVideo ? {
    '@context': 'https://schema.org', '@type': 'VideoObject', name: title, description: String(a.explanation || '').slice(0, 300),
    contentUrl: String(a.url || ''), thumbnailUrl: /^https?:\/\//i.test(poster) ? poster : undefined, datePublished: dateStr,
    publisher: { '@type': 'Organization', name: 'NASA' },
  } : {
    '@context': 'https://schema.org', '@type': 'ImageObject', name: title, description: String(a.explanation || '').slice(0, 300),
    contentUrl: String(a.hdurl || a.url || ''), datePublished: dateStr,
    license: 'https://www.nasa.gov/multimedia/guidelines/index.html', producer: { '@type': 'Organization', name: 'NASA' },
  }).replace(/</g, '\\u003c');
  const body = `<p class="back-link"><a href="/nasa">&larr; Space Complex</a> &middot; <a href="/nasa/archive">Archive</a></p>`
    + `<div class="nasa-daynav"><a class="btn ghost" href="/nasa/apod/${prev}">&larr; ${prev}</a>`
    + `<a class="btn ghost" href="/nasa/apod/${next}">${next} &rarr;</a></div>`
    + imgHtml
    + `<article>${nasaParas(a.explanation, 12)}</article>`
    + (a.copyright ? `<p class="meta">Copyright: ${escapeHtml(String(a.copyright).slice(0, 120))}</p>` : '')
    + `<p class="meta">Astronomy Picture of the Day for ${dateStr} — image &amp; explanation courtesy of NASA (public domain), mirrored at Tukuk-OS for reading and search convenience.</p>`;
  return nasaDoc({
    title: `${title} — APOD ${dateStr} | Tukuk-OS`, desc: String(a.explanation || '').slice(0, 155) || `NASA's Astronomy Picture of the Day for ${dateStr}.`,
    selfUrl, heroTitle: title, heroSub: `Astronomy Picture of the Day \u00b7 ${dateStr} \u00b7 NASA (public domain)`,
    image: (isVideo ? (/^https?:\/\//i.test(poster) ? poster : undefined) : (a.hdurl || a.url)) || undefined, ld: jsonLd, body,
  });
}

// Arkib APOD setempat (cakerakan) + carian teks — tidak guna kuot API.
function nasaArchivePage(req, items, q) {
  const cards = items.map((e) => {
    const isImg = String(e.media_type || 'image') === 'image' && !/^https:\/\/www\.youtube\./i.test(String(e.url || ''));
    const poster = isImg ? '' : nasaVideoPoster(e);
    const thumb = isImg
      ? nasaImg(e.url, String(e.title || 'APOD'))
      : (poster ? nasaImg(poster, `▶ ${String(e.title || 'APOD video')}`) : '<div class="nasa-card" style="text-align:center">\uD83C\uDFAC Video</div>');
    return `<div class="post-card"><h2><a href="/nasa/apod/${encodeURIComponent(String(e.date || ''))}">${escapeHtml(String(e.title || e.date || 'APOD'))}</a></h2>`
      + `<div class="meta">${escapeHtml(String(e.date || ''))}</div>${thumb}</div>`;
  }).join('');
  const body = `<form action="/nasa/archive" method="get" role="search" style="margin:14px 0">`
    + `<input type="search" name="q" value="${escapeHtml(q)}" placeholder="Search 30 years of APOD — nebula, mars, aurora\u2026" aria-label="Search APOD archive" style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;min-width:260px;background:var(--panel,#171a21);color:inherit">`
    + `<button class="btn primary" type="submit" style="margin-left:8px">Search</button></form>`
    + `<p>NASA has published one original image with an explanation every day since <b>16 June 1995</b>. This mirror keeps them searchable \u2014 each picture has its own permanent page, ideal for classes, night skies and pure browsing curiosity. Feeling adventurous? <a href="/nasa/random">Take a random trip through the archive</a>.</p>`
    + `<h2 class="section-title">${items.length} pictures${q ? ` matching \u201C${escapeHtml(q)}\u201D` : ' (newest first)'}</h2><div class="feed">${cards || '<p>No archived pictures match yet — try a broader word.</p>'}</div>`;
  return nasaDoc({
    title: q ? `APOD archive search: ${q} | Tukuk-OS` : 'NASA APOD Archive 1995\u2013today \u2014 every Astronomy Picture of the Day | Tukuk-OS',
    desc: 'Browse and search NASA\u2019s Astronomy Picture of the Day archive \u2014 three decades of universe, one page per date, free and public domain.',
    selfUrl: q ? `https://tukuk.org/nasa/archive?q=${encodeURIComponent(q)}` : 'https://tukuk.org/nasa/archive',
    robots: q ? 'noindex,follow' : 'index,follow,max-image-preview:large',
    heroTitle: 'The APOD Archive', heroSub: 'Every Astronomy Picture of the Day since 1995 \u00b7 image & explanation courtesy of NASA',
    body,
  });
}

function nasaSkyPage(req, sky, useQuery) {
  const m = sky.moon || {};
  const sun = sky.sun || null;
  const loc = sky.location || { lat: 3.139, lng: 101.687 };
  const locLabel = `${Math.abs(Number(loc.lat) || 0).toFixed(2)}\u00b0${Number(loc.lat) >= 0 ? 'N' : 'S'}, ${Math.abs(Number(loc.lng) || 0).toFixed(2)}\u00b0${Number(loc.lng) >= 0 ? 'E' : 'W'}`;
  const hhmm = (iso) => { try { return new Date(iso).toISOString().slice(11, 16) + ' UTC'; } catch { return '--:--'; } };
  const cards = `<div class="nasa-grid">`
    + `<div class="nasa-card"><h3>Moon phase</h3><div class="big">${m.emoji || ''} ${escapeHtml(m.name || 'Unknown')}</div></div>`
    + `<div class="nasa-card"><h3>Illumination</h3><div class="big">${Number(m.illum_percent) || 0}%</div></div>`
    + `<div class="nasa-card"><h3>Age of Moon</h3><div class="big">${Number(m.age_days) || 0} days</div></div>`
    + `<div class="nasa-card"><h3>Next Full Moon</h3><div class="big">in ${Number(m.next_full_days) || 0} nights</div></div>`
    + `<div class="nasa-card"><h3>Next New Moon</h3><div class="big">in ${Number(m.next_new_days) || 0} nights</div></div>`
    + (sun ? `<div class="nasa-card"><h3>Sun</h3><div class="big" style="font-size:1rem">\u2197 ${hhmm(sun.sunrise)} &middot; \u2198 ${hhmm(sun.sunset)}</div></div>` : '')
    + `</div>`;
  const twRows = sun ? ['civil', 'nautical', 'astronomical'].map((k) =>
    `<tr><td>${k[0].toUpperCase() + k.slice(1)} twilight</td><td>${hhmm((sun[k] || [])[0])}</td><td>${hhmm((sun[k] || [])[1])}</td></tr>`).join('') : '';
  const finder = `<form action="/nasa/sky" method="get" role="search" class="nasa-ok">`
    + `<h3>See tonight\u2019s sky for your own coordinates</h3><p>Enter any place on Earth \u2014 the moon phase is global, twilight times are local.</p>`
    + `<label>Latitude <input type="number" step="0.01" min="-90" max="90" name="lat" value="${(Number(loc.lat) || 0).toFixed(2)}" style="padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:inherit"></label> `
    + `<label>Longitude <input type="number" step="0.01" min="-180" max="180" name="lng" value="${(Number(loc.lng) || 0).toFixed(2)}" style="padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:inherit"></label> `
    + `<button class="btn primary" type="submit" style="margin-left:8px">Update</button></form>`;
  const body = `<p>Tonight for <b>${escapeHtml(locLabel)}</b>: moon phase, illumination and the twilight windows that decide when the sky is actually dark enough to observe. The moon figures are computed locally (exact), the twilight times come from the U.S. Naval Observatory\u2019s public sunrise\u2013sunset service.</p>`
    + finder + cards
    + (sun ? `<table class="nasa-table"><tr><th>Twilight stage</th><th>Begins</th><th>Ends</th></tr>${twRows}</table><p class="meta">Day length today: ${Number(sun.day_length_hours) || 0} h. Times are UTC; your browser clock may differ.</p>` : '')
    + (sky.note ? `<p class="meta">${escapeHtml(sky.note)}</p>` : '')
    + `<h2 class="section-title">Astronomical darkness \u2014 the number that matters</h2><p>Civil twilight ends when the Sun is 6\u00b0 below the horizon (you can see Venus and Jupiter), nautical at 12\u00b0 (the horizon and bright stars appear), and <b>astronomical twilight</b> at 18\u00b0 \u2014 only after that does the sky reach true dark, letting faint galaxies, the zodiacal light and the Milky Way show themselves. Near the equator this happens fast (Malaysia gets about 90 minutes of full night all year round); at high latitudes summer can never reach it at all.</p>`
    + `<h2 class="section-title">What to observe tonight</h2><p>Under a ${escapeHtml(m.name || '')} sky, try: the Moon\u2019s terminator line (best crater detail), Jupiter and Saturn when above the horizon after midnight, and the Milky Way core season from southern latitudes. Check the <a href="/nasa/space-weather">space-weather page</a> for aurora chances and the <a href="/nasa/iss">ISS page</a> for pass timings.</p>`;
  return nasaDoc({
    title: 'Sky Tonight \u2014 Moon Phase, Twilight & Observing Guide | Tukuk-OS',
    desc: 'Tonight\u2019s moon phase, illumination, twilight windows and what to observe \u2014 free, computed live, any coordinate on Earth.',
    selfUrl: 'https://tukuk.org/nasa/sky', heroTitle: 'Sky Tonight', heroSub: 'Moon \u00b7 twilight \u00b7 observing \u2014 updated automatically',
    robots: useQuery ? 'noindex,follow' : 'index,follow,max-image-preview:large',
    body,
  });
}

// ── ISS LANGSUNG — peta kanvas sendiri (tiada pustaka luar) + krew antarabangsa ──
// wheretheiss.at (tanpa kunci) bagi telemetri, open-notify bagi krew. Halaman ini
// menghasilkan data "live" yang buat orang kembali setiap hari → sinyal SEO kuat.
function nasaIssPage(req, iss, crew) {
  const hasPos = Boolean(iss && iss.source && iss.source !== 'unavailable');
  const lat = Math.round((Number(iss && iss.latitude) || 0) * 100) / 100;
  const lng = Math.round((Number(iss && iss.longitude) || 0) * 100) / 100;
  const alt = Number(iss && iss.altitude_km) || 418;
  const vel = Number(iss && iss.velocity_kmh) || 27600;
  const rawVis = /^[a-z]+$/.test(String((iss && iss.visibility) || 'daylight')) ? String(iss.visibility) : 'daylight';
  const vis = rawVis === 'eclipsed' ? 'in Earth\u2019s shadow' : rawVis;
  const tsSec = Number(iss && iss.timestamp) || Math.floor(Date.now() / 1000);
  const seenAt = new Date(tsSec * 1000).toUTCString();
  // Titik subsolar (Matahari di zenit) → pemisah siang/malam SEBENAR pada peta.
  let subLat = Number(iss && iss.solar_lat);
  let subLng = Number(iss && iss.solar_lon);
  if (!Number.isFinite(subLat) || !Number.isFinite(subLng)) {
    const d = new Date((Number(iss && iss.timestamp) || Math.floor(Date.now() / 1000)) * 1000);
    const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    subLng = ((12 - utcH) * 15 + 180) % 360; if (subLng < 0) subLng += 360; subLng -= 180;
    const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
    subLat = -23.44 * Math.cos((360 / 365.24) * (doy + 10) * Math.PI / 180);
  } else {
    subLng = ((subLng + 180) % 360 + 360) % 360 - 180; // normalisasi kepada -180..180
  }
  subLat = Math.round(subLat * 100) / 100;
  subLng = Math.round(subLng * 100) / 100;
  const stations = crew && Array.isArray(crew.stations) ? crew.stations : [];
  const inSpace = Number(crew && crew.inSpace) || stations.reduce((s, x) => s + (Number(x.count) || 0), 0);
  const hemi = (v, k) => `${Math.abs(v).toFixed(2)}\u00b0 ${v >= 0 ? (k === 'ns' ? 'N' : 'E') : (k === 'ns' ? 'S' : 'W')}`;
  const cards = `<div class="nasa-grid">`
    + `<div class="nasa-card"><h3>Sub-station point</h3><div class="big" id="iss-lat">${hasPos ? hemi(lat, 'ns') + ', ' + hemi(lng, 'ew') : '\u2014'}</div></div>`
    + `<div class="nasa-card"><h3>Altitude</h3><div class="big" id="iss-alt">${hasPos ? `${alt} km` : '\u2014'}</div></div>`
    + `<div class="nasa-card"><h3>Ground speed</h3><div class="big" id="iss-vel">${hasPos ? `${nasaFmt(vel)} km/h` : '\u2014'}</div></div>`
    + `<div class="nasa-card"><h3>Sunlight</h3><div class="big" id="iss-sun">${hasPos ? escapeHtml(vis) : '\u2014'}</div></div>`
    + `<div class="nasa-card"><h3>Humans in space</h3><div class="big">${inSpace}</div></div>`
    + `<div class="nasa-card"><h3>Orbits per day</h3><div class="big">\u2248 15.5</div></div>`
    + `</div>`;
  // Peta SATELIT sebenar: NASA Blue Marble equirektangular sebagai latar, kanvas
  // lutsinar di atas melukis grid + pemisah siang/malam (dari titik subsolar) +
  // landasan tanah 51.6° + penanda ISS semasa. Tiada pustaka luar, tiada CDN.
  const daymap = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Blue_Marble_2002.png/1280px-Blue_Marble_2002.png';
  const map = `<div style="position:relative;max-width:720px;margin:16px auto;border:1px solid var(--line);border-radius:12px;overflow:hidden;line-height:0;background:#0a1020">`
    + `<img id="issbase" src="${daymap}" width="1280" height="640" alt="NASA Blue Marble true-colour satellite image of the whole Earth (equirectangular world map)" loading="eager" decoding="async" style="width:100%;height:auto;display:block">`
    + `<canvas id="issmap" width="720" height="360" role="img" aria-label="Satellite map of Earth showing the current position of the International Space Station at ${hemi(lat, 'ns')}, ${hemi(lng, 'ew')}, its ground track and the day/night terminator" style="position:absolute;left:0;top:0;width:100%;height:100%"></canvas>`
    + `</div>`
    + `<p class="meta" id="iss-age">${hasPos ? 'Live \u2014 position first read ' + escapeHtml(seenAt) + ' \u00b7 this map refreshes itself every 15 seconds, no reload needed.' : 'ISS telemetry is briefly unavailable \u2014 the night line below is computed straight from the Sun; the position marker returns automatically when the feed recovers.'}</p>`
    + `<script>(function(){var c=document.getElementById('issmap');if(!c||!c.getContext)return;`
    + `var g=c.getContext('2d'),W=c.width,H=c.height,rad=Math.PI/180;`
    + `var st={live:${hasPos ? 'true' : 'false'},SL:${subLng},SD:${subLat},lat:${lat},lng:${lng},alt:${alt},vel:${vel},vis:'${rawVis}',ts:${tsSec},src:'${String((iss && iss.source) || 'unavailable')}'};`
    + `function norm(x){return ((x+180)%360+360)%360-180;}`
    + `function hemi(v,k){return Math.abs(v).toFixed(2)+'\u00b0 '+(v>=0?(k==='ns'?'N':'E'):(k==='ns'?'S':'W'));}`
    + `function draw(){var cd=Math.cos(st.SD*rad),sd=Math.sin(st.SD*rad);g.clearRect(0,0,W,H);`
    + `g.strokeStyle='rgba(255,255,255,.16)';g.lineWidth=1;`
    + `for(var gx=0;gx<=W;gx+=W/12){g.beginPath();g.moveTo(gx,0);g.lineTo(gx,H);g.stroke();}`
    + `for(var gy=0;gy<=H;gy+=H/6){g.beginPath();g.moveTo(0,gy);g.lineTo(W,gy);g.stroke();}`
    + `g.fillStyle='rgba(4,8,24,.5)';`
    + `for(var cx=0;cx<W;cx+=3){var lo=-180+(cx+1.5)/W*360,dl=(lo-st.SL)*rad,ft=Math.atan(-cd*Math.cos(dl)/sd)/rad,yt=(90-ft)/180*H;`
    + `if(sd>1e-6)g.fillRect(cx,yt,3,H-yt);else if(sd<-1e-6)g.fillRect(cx,0,3,yt);else if(Math.cos(dl)<0)g.fillRect(cx,0,3,H);}`
    + `g.strokeStyle='rgba(255,255,255,.6)';g.lineWidth=2;g.beginPath();var ic=51.6*rad;`
    + `for(var d=0;d<=360;d+=3){var th=d*rad,la=Math.asin(Math.sin(ic)*Math.sin(th))/rad,px=((d*2)%360)/360*W,py=(90-la)/180*H;if(d===0)g.moveTo(px,py);else g.lineTo(px,py);}`
    + `g.stroke();if(!st.live)return;var ix=(st.lng+180)/360*W,iy=(90-st.lat)/180*H;`
    + `g.fillStyle='rgba(255,183,3,.25)';g.beginPath();g.arc(ix,iy,20,0,6.2832);g.fill();`
    + `g.fillStyle='rgba(255,183,3,.55)';g.beginPath();g.arc(ix,iy,11,0,6.2832);g.fill();`
    + `g.fillStyle='#ffb703';g.beginPath();g.arc(ix,iy,6,0,6.2832);g.fill();`
    + `g.strokeStyle='#fff';g.lineWidth=1.5;g.beginPath();g.arc(ix,iy,6,0,6.2832);g.stroke();`
    + `g.strokeStyle='rgba(255,183,3,.65)';g.lineWidth=1;g.beginPath();g.moveTo(ix-16,iy);g.lineTo(ix+16,iy);g.moveTo(ix,iy-16);g.lineTo(ix,iy+16);g.stroke();}`
    + `function setTxt(id,s){var e=document.getElementById(id);if(e)e.textContent=s;}`
    + `function apply(){draw();if(!st.live)return;`
    + `setTxt('iss-lat',hemi(st.lat,'ns')+', '+hemi(st.lng,'ew'));`
    + `setTxt('iss-alt',st.alt+' km');setTxt('iss-vel',Number(st.vel).toLocaleString('en-US')+' km/h');`
    + `setTxt('iss-sun',st.vis==='eclipsed'?'in Earth\u2019s shadow':st.vis);`
    + `var age=Math.max(0,Math.round(Date.now()/1000)-st.ts);`
    + `setTxt('iss-age',st.src==='last-known'?'Live feed briefly busy \u2014 holding the last real position ('+age+'s old). Auto-retry every 15 s.':'Live \u2014 position read '+age+'s ago \u00b7 map refreshes automatically every 15 seconds.');}`
    + `var fb=['https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg','https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'];var fi=0;`
    + `var base=document.getElementById('issbase');if(base){base.addEventListener('error',function(){if(fi<fb.length){base.src=fb[fi++];}});}`
    + `function poll(){fetch('/nasa/iss/live.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('http');return r.json();}).then(function(d){`
    + `if(!d||d.source==='unavailable'){setTxt('iss-age','Telemetry briefly unavailable \u2014 the map holds what it last saw; retrying automatically.');return;}`
    + `if(!Number.isFinite(d.latitude)||!Number.isFinite(d.longitude))return;`
    + `st.live=true;st.lat=d.latitude;st.lng=d.longitude;st.alt=d.altitude_km;st.vel=d.velocity_kmh;st.vis=String(d.visibility||'daylight');st.ts=d.timestamp;st.src=d.source;`
    + `if(Number.isFinite(d.solar_lat)&&Number.isFinite(d.solar_lon)){st.SL=norm(d.solar_lon);st.SD=d.solar_lat;}`
    + `apply();}).catch(function(){setTxt('iss-age','Reconnecting to the live feed\u2026');});}`
    + `apply();setInterval(poll,15000);})();</script>`;
  const crewHtml = stations.length
    ? `<h2 class="section-title">Who is up there right now</h2>` + stations.map((st) => {
      const list = Array.isArray(st.crew) ? st.crew : [];
      return `<div class="nasa-ok"><h3>${escapeHtml(String(st.craft || 'Station'))} \u00b7 ${Number(st.count) || list.length} aboard</h3>`
        + `<p>${list.map((p) => escapeHtml(String(p.name || 'Unknown'))).join(' &middot; ') || 'Crew roster unavailable'}</p></div>`;
    }).join('')
    : '<p class="meta">The crew roster feed is briefly quiet \u2014 telemetry above is still live.</p>';
  const body = `<p>The International Space Station has been continuously crewed since <b>2 November 2000</b>, orbiting at about 400 km altitude and travelling at ${nasaFmt(vel)} km/h \u2014 fast enough to circle the Earth every ~92 minutes, roughly <b>15.5 orbits a day</b>. The map below is real NASA Blue Marble satellite imagery of the whole planet: the glowing dot is the station\u2019s <b>live position</b> (first read ${escapeHtml(seenAt)}), the white curve is an idealised ground track for its 51.6\u00b0 inclination, and the dimmed half is Earth\u2019s night side computed from the live subsolar point. The page updates itself \u2014 leave it open and the marker keeps moving across the sky.</p>`
    + cards + map + crewHtml
    + `<h2 class="section-title">How to see it with your own eyes</h2><p>The ISS is the <b>sixth-brightest object in the night sky</b> and needs no telescope. Best chances: within a couple of hours after dusk or before dawn, when you are in darkness but the station is still sunlit. Look for a steady, fast, non-blinking point crossing the whole sky in 3\u20136 minutes. Free pass alerts for your town are published by NASA\u2019s "Spot the Station" service.</p>`
    + `<h2 class="section-title">Why it matters</h2><p>Microgravity research aboard the ISS covers protein crystallography, combustion, fluid physics, biology and human physiology \u2014 the evidence base for every future Moon and Mars mission. It is a jointly operated laboratory by five space agencies.</p>`
    + `<p class="meta">Position and solar-terminator data: wheretheiss.at \u00b7 crew data: open-notify.org \u00b7 both key-free public services. Base map: NASA Blue Marble (public domain); station imagery and facts courtesy of NASA.</p>`;
  return nasaDoc({
    title: 'ISS Live Position \u2014 Where the Space Station Is Right Now | Tukuk-OS',
    desc: 'Where the International Space Station is at this second, how fast it is travelling, and exactly who is aboard \u2014 live, free, no app.',
    selfUrl: 'https://tukuk.org/nasa/iss', heroTitle: 'ISS Live Tracking', heroSub: 'Position, speed and crew \u00b7 live map, auto-refreshed every 15 seconds',
    body,
  });
}

// ── ASTEROID WATCH — pendekatan minggu ini + meja risiko Sentry + trend 4 minggu ──
function nasaAsteroidsPage(req, week, trend, sentry) {
  const rows = (week.asteroids || []).slice(0, 60).map((a) => {
    const dmin = Number(a.estimated_diameter_meters && a.estimated_diameter_meters.min) || 0;
    const dmax = Number(a.estimated_diameter_meters && a.estimated_diameter_meters.max) || 0;
    const ld = Math.round((Number(a.miss_distance_km) || 0) / 384400 * 100) / 100;
    return `<tr><td><a href="${escapeHtml(String(a.nasa_jpl_url || '#'))}" rel="noopener">${escapeHtml(String(a.name || a.id || 'NEO'))}</a></td>`
      + `<td>${escapeHtml(String(a.close_approach_date || '')).slice(0, 24)}</td>`
      + `<td>${nasaFmt(dmin)}\u2013${nasaFmt(dmax)} m</td>`
      + `<td>${nasaFmt(a.velocity_kmh)} km/h</td>`
      + `<td>${nasaFmt(a.miss_distance_km)} km (${ld} LD)</td>`
      + `<td>${a.is_potentially_hazardous ? '<span class="nasa-haz">Hazardous</span>' : 'No'}</td></tr>`;
  }).join('');
  const b = trend && trend.buckets ? trend.buckets : [];
  const maxCount = Math.max(1, ...b.map((x) => Number(x.count) || 0));
  const bars = b.map((x) => `<div class="nasa-barwrap"><span>${escapeHtml(String(x.start))} \u2192 ${escapeHtml(String(x.end))}: <b>${nasaFmt(x.count)}</b> objects, ${nasaFmt(x.hazardous)} hazardous</span>`
    + `<div class="nasa-bar" style="width:${Math.round(((Number(x.count) || 0) / maxCount) * 100)}%"></div></div>`).join('');
  const risks = sentry && Array.isArray(sentry.risks) ? sentry.risks : [];
  const sentryHtml = risks.length
    ? `<h2 class="section-title">JPL Sentry risk table</h2><table class="nasa-table"><tr><th>Object</th><th>Possible years</th><th>Diameter</th><th>Cumulative probability</th><th>Torino</th></tr>`
      + risks.slice(0, 15).map((r) => `<tr><td>${escapeHtml(String(r.name))}</td><td>${escapeHtml(String(r.impact_years || '\u2014'))}</td>`
        + `<td>${r.diameter_km ? Math.round(r.diameter_km * 1000) + ' m' : '\u2014'}</td>`
        + `<td>1 in ${nasaFmt(Math.max(1, Math.round(1 / (Number(r.cum_prob) || 1))))}</td><td>${Number(r.torino) || 0}</td></tr>`).join('')
      + `</table><p class="meta">Sentry tracks every catalogued object with a non-zero impact probability. These are monitoring entries, <b>not predictions of an impact</b> \u2014 most are removed within months as arcs improve.</p>`
    : `<div class="nasa-ok"><h3>All clear</h3><p>JPL\u2019s Sentry table currently lists no object with a significant impact probability. NASA\u2019s Planetary Defense Coordination Office tracks >35,000 near-Earth objects and none of the known large ones threaten Earth for at least the next 100 years.</p></div>`;
  const nearest = trend && trend.nearest
    ? `<div class="nasa-grid"><div class="nasa-card"><h3>Closest in the window</h3><div class="big">${escapeHtml(String(trend.nearest.name))}</div></div>`
      + `<div class="nasa-card"><h3>Miss distance</h3><div class="big">${nasaFmt(trend.nearest.miss_distance_km)} km</div></div>`
      + `<div class="nasa-card"><h3>In lunar distances</h3><div class="big">${Number(trend.nearest.moonDistances) || 0} \u00d7 Moon</div></div></div>`
    : '';
  const dir = trend && trend.trend ? trend.trend.direction : 'flat';
  // Kejujuran sumber: tiada nombor rekaan pernah dipaparkan — jika suapan JPL
  // sibuk, arkib tarikan nyata hidang dengan notis yang jelas.
  const srcNote = week && week.source === 'archive'
    ? `<div class="nasa-ok"><h3>Live feed briefly busy — showing real archived approaches</h3><p>NASA\u2019s NeoWs endpoint is not answering this moment, so the table lists <b>genuine close approaches from the last successful JPL fetch</b>${week.archivedAt ? ` (recorded ${escapeHtml(String(week.archivedAt).slice(0, 10))})` : ''}. Nothing below is simulated; the live list repopulates automatically the moment the feed recovers.</p></div>`
    : week && week.source === 'unavailable'
    ? `<div class="nasa-ok"><h3>Live feed unreachable right now</h3><p>NASA\u2019s NeoWs endpoint and this server\u2019s archive are both between reads. The trend history and Sentry table below come from independent sources. We never publish invented approach numbers \u2014 check back shortly.</p></div>`
    : '';
  const body = `<p>"Near-Earth object" means any asteroid or comet whose orbit brings it within <b>1.3 times</b> the Earth\u2013Sun distance. Almost every one passes at millions of kilometres \u2014 an "encounter" is an astronomical event, not a hazard. One lunar distance (LD) equals 384,400 km, the average Earth\u2013Moon gap.</p>`
    + srcNote
    + `<div class="nasa-grid"><div class="nasa-card"><h3>Objects in window</h3><div class="big">${nasaFmt(trend && trend.totals ? trend.totals.asteroids : (week.element_count || 0))}</div></div>`
    + `<div class="nasa-card"><h3>Potentially hazardous</h3><div class="big">${nasaFmt(trend && trend.totals ? trend.totals.hazardous : 0)}</div></div>`
    + `<div class="nasa-card"><h3>4-week trend</h3><div class="big">${dir === 'up' ? '\u2197 rising' : dir === 'down' ? '\u2198 easing' : '\u2194 steady'} (${Number(trend && trend.trend ? trend.trend.changePercent : 0)}%)</div></div></div>`
    + nearest + sentryHtml
    + `<h2 class="section-title">Close approaches this week</h2>`
    + (rows ? `<table class="nasa-table"><tr><th>Object</th><th>Approach</th><th>Diameter</th><th>Speed</th><th>Miss distance</th><th>Hazardous</th></tr>${rows}</table>`
      : '<p>No radar-confirmed close approaches were returned for this window \u2014 quiet weeks are normal, and the list repopulates daily from JPL.</p>')
    + `<h2 class="section-title">Activity by week</h2>${bars || '<p class="meta">Trend history is still accumulating.</p>'}`
    + `<h2 class="section-title">How Earth is defended</h2><p>NASA\u2019s <b>DART</b> mission successfully altered the orbit of the asteroid Dimorphos in 2022, proving a kinetic impactor can deflect a body given years of warning. Survey missions such as <b>NEO Surveyor</b> aim to find the dark objects still hiding inside Venus\u2019s orbit.</p>`
    + `<p class="meta">Approach data: NASA CNEOS NeoWs \u00b7 risk data: JPL Sentry \u00b7 public domain.</p>`;
  return nasaDoc({
    title: 'Asteroid Watch \u2014 Live Close Approaches & Sentry Risk Table | Tukuk-OS',
    desc: 'Every near-Earth asteroid passing this week with distance, speed and size, plus NASA\u2019s Sentry impact-risk table \u2014 updated live.',
    selfUrl: 'https://tukuk.org/nasa/asteroids', heroTitle: 'Asteroid Watch', heroSub: 'Real numbers from NASA\u2019s Planetary Defence radar \u00b7 no hype, just data',
    body,
  });
}

// ── CUACA ANGKASA — flares NOAA GOES + fluks radio F10.7 + panduan aurora ──
function nasaSpaceWeatherPage(req, solar) {
  const f = (solar && solar.flares) || { classes: {}, buckets: [], total: 0, strongest: null };
  const fx = (solar && solar.flux) || { avg: 0, min: 0, max: 0, buckets: [], direction: 'flat', changePercent: 0, days: 0 };
  const classes = f.classes || {};
  const maxCls = Math.max(1, ...Object.values(classes).map((v) => Number(v) || 0));
  const clsBars = ['X', 'M', 'C', 'B', 'A'].map((k) => `<div class="nasa-barwrap"><span><b>${k}-class</b> \u00b7 ${Number(classes[k]) || 0} flare${Number(classes[k]) === 1 ? '' : 's'} in the last 7 days</span>`
    + `<div class="nasa-bar" style="width:${Math.round(((Number(classes[k]) || 0) / maxCls) * 100)}%"></div></div>`).join('');
  const dayRows = (f.buckets || []).map((d) => `<tr><td>${escapeHtml(String(d.day))}</td><td>${Number(d.flares) || 0}</td><td>${escapeHtml(String(d.maxClass || '\u2014'))}</td></tr>`).join('');
  const maxFlux = Math.max(1, ...(fx.buckets || []).map((x) => Number(x.flux) || 0));
  const fluxBars = (fx.buckets || []).map((x) => `<div class="nasa-barwrap"><span>${escapeHtml(String(x.label))} (${escapeHtml(String(x.start))}\u2013${escapeHtml(String(x.end))}): F10.7 <b>${nasaFmt(x.flux)}</b> sfu</span>`
    + `<div class="nasa-bar" style="width:${Math.round(((Number(x.flux) || 0) / maxFlux) * 100)}%"></div></div>`).join('');
  const strong = f.strongest && f.strongest.classType
    ? `<div class="nasa-ok"><h3>Strongest flare this week: ${escapeHtml(String(f.strongest.classType))}</h3><p>Peak ${escapeHtml(String(f.strongest.peakTime || f.strongest.time || 'reported by NOAA SWPC'))}. An X-class flare can trigger radio blackouts on the daylight side of Earth within 8 minutes; M-class events give brief polar fadeouts; C-class are routine.</p></div>`
    : '<div class="nasa-ok"><h3>A quiet Sun this week</h3><p>No X or M flare of note in the reporting window \u2014 conditions favourable for satellite operations and HF radio.</p></div>';
  const body = `<p>Space weather is what the Sun does to our technology. Solar flares arrive at the speed of light (8 minutes), radiation storms within hours to days, and coronal mass ejections \u2014 the drivers of aurora and geomagnetic storms \u2014 in one to three days. Numbers below come from NOAA\u2019s GOES X-ray sensor and the F10.7 radio flux index, the two classic live measures of solar activity.</p>`
    + `<div class="nasa-grid">`
    + `<div class="nasa-card"><h3>Flares (7 days)</h3><div class="big">${nasaFmt(f.total)}</div></div>`
    + `<div class="nasa-card"><h3>Avg F10.7 flux</h3><div class="big">${nasaFmt(fx.avg)} sfu</div></div>`
    + `<div class="nasa-card"><h3>Flux range</h3><div class="big">${nasaFmt(fx.min)}\u2013${nasaFmt(fx.max)}</div></div>`
    + `<div class="nasa-card"><h3>30-day trend</h3><div class="big">${fx.direction === 'up' ? '\u2197 active' : fx.direction === 'down' ? '\u2198 calming' : '\u2194 steady'} (${Number(fx.changePercent) || 0}%)</div></div>`
    + `<div class="nasa-card"><h3>Reporting window</h3><div class="big">${Number(fx.days) || 0} days</div></div>`
    + `<div class="nasa-card"><h3>Source</h3><div class="big" style="font-size:1rem">NOAA SWPC / GOES</div></div></div>`
    + strong
    + `<h2 class="section-title">Flare strength by class</h2>${clsBars}`
    + `<h2 class="section-title">Day by day</h2>`
    + (dayRows ? `<table class="nasa-table"><tr><th>Date (UTC)</th><th>Flares</th><th>Strongest class</th></tr>${dayRows}</table>` : '<p class="meta">No daily flare buckets returned.</p>')
    + `<h2 class="section-title">Radio flux, week by week</h2>${fluxBars || '<p class="meta">Flux history unavailable right now.</p>'}`
    + `<h2 class="section-title">Will there be aurora, and can you see it from Malaysia?</h2><p>Aurora needs a geomagnetic storm (Kp \u2265 5) plus a dark, clear sky near a magnetic pole \u2014 so from the tropics the answer is normally no, though exceptionally strong storms have produced equatorial sightings. What space weather <i>does</i> reach here with force: HF radio skip quality, GPS accuracy, and satellite drag. If you plan radio or GNSS work during a storm, NOAA\u2019s 3-day forecast is the operational reference.</p>`
    + `<h2 class="section-title">Reading the numbers</h2><p><b>F10.7 flux</b> (solar flux units, sfu) tracks the Sun\u2019s microwave output and rises with sunspot area: ~70 sfu at deep minimum, 200+ at cycle peak. <b>X-class</b> flares are numbered by their X-ray peak in watts per square metre at Earth \u2014 X1, X2, X10 (the 2003 Halloween storm was X28, the strongest ever measured).</p>`
    + `<p class="meta">Data: NOAA SWPC GOES X-ray &amp; F10.7 feeds \u00b7 public-domain U.S. government measurements, mirrored by Tukuk-OS.</p>`;
  return nasaDoc({
    title: 'Space Weather Today \u2014 Solar Flares, F10.7 Flux & Aurora Outlook | Tukuk-OS',
    desc: 'Live solar flare counts by class, 30-day radio-flux trend and what the current space weather means for radio, GPS and aurora.',
    selfUrl: 'https://tukuk.org/nasa/space-weather', heroTitle: 'Space Weather', heroSub: 'What the Sun is doing this week \u00b7 NOAA GOES live data',
    body,
  });
}

// ── MARS ROVERS — galeri permukaan tiap kenderaan, satu URL berbeza per rover ──
const MARS_ROVERS = [
  { slug: 'perseverance', name: 'Perseverance', site: 'Jezero Crater', since: 'Feb 2021', sol: 1500 },
  { slug: 'curiosity', name: 'Curiosity', site: 'Gale Crater', since: 'Aug 2012', sol: 4500 },
  { slug: 'opportunity', name: 'Opportunity', site: 'Meridiani Planum', since: 'Jan 2004 \u2013 Jun 2018', sol: 5100 },
  { slug: 'spirit', name: 'Spirit', site: 'Gusev Crater', since: 'Jan 2004 \u2013 Mar 2010', sol: 2100 },
];

function nasaMarsPage(req, data, rover) {
  const rv = MARS_ROVERS.find((r) => r.slug === rover) || MARS_ROVERS[0];
  const photos = Array.isArray(data && data.photos) ? data.photos : [];
  const selfUrl = `https://tukuk.org/nasa/mars${rv.slug === 'perseverance' ? '' : `/${rv.slug}`}`;
  const grid = photos.length
    ? `<div class="nasa-photos">` + photos.slice(0, 24).map((p) => `<figure>${nasaImg(p.img_src, `${rv.name} sol ${p.sol} \u2014 ${p.camera && p.camera.name ? p.camera.name : 'Mars surface'}`)}`
      + `<figcaption>Sol ${Number(p.sol) || 0}${p.earth_date ? ` \u00b7 ${escapeHtml(String(p.earth_date))}` : ''}${p.camera && p.camera.name ? ` \u00b7 ${escapeHtml(String(p.camera.name))}` : ''}</figcaption></figure>`).join('')
      + `</div>`
    : '<p>No frames could be retrieved for this rover right now \u2014 try the other rovers or reload in an hour.</p>';
  const switcher = `<p class="nasa-strip">` + MARS_ROVERS.map((r) => `<a class="btn ${r.slug === rv.slug ? 'primary' : 'ghost'}" href="/nasa/mars${r.slug === 'perseverance' ? '' : `/${r.slug}`}">${r.name}</a>`).join('') + `</p>`;
  const facts = photos[0] && photos[0].rover && photos[0].rover.landing_date
    ? `<div class="nasa-ok"><h3>${rv.name} \u2014 ${escapeHtml(String(rv.site))}</h3><p>Landed ${escapeHtml(String(photos[0].rover.landing_date))}${photos[0].rover.status ? `, status: ${escapeHtml(String(photos[0].rover.status))}` : ''}. Latest frame is sol ${Number(photos[0].sol) || 0} (${escapeHtml(String(photos[0].earth_date || ''))}).</p></div>`
    : `<div class="nasa-ok"><h3>${rv.name} \u2014 ${escapeHtml(String(rv.site))}</h3><p>Operating ${escapeHtml(String(rv.since))}. Every image below is an original NASA surface frame, public domain.</p></div>`;
  const body = `<p>These are not artistic impressions \u2014 each picture below was taken by a camera on a vehicle driving on another planet. A "sol" is a Martian day (24 h 39 min 35 s), so the sol number in every caption is the local date on Mars.</p>`
    + switcher + facts + grid
    + `<h2 class="section-title">Why we keep going back</h2><p>Mars once had rivers, lakes and a thicker atmosphere. ${rv.slug === 'perseverance' ? 'Perseverance is drilling rock cores from a delta built by an ancient river, and has already produced the first samples of another world sealed in tubes for a future return to Earth. Its helicopter Ingenuity proved powered flight is possible in 1% of Earth\u2019s air.' : rv.slug === 'curiosity' ? 'Curiosity found evidence that Gale Crater held a habitable lake, detected organic molecules and seasonal methane, and is climbing a mountain built from the sediments of a vanished lake system.' : 'The rover generation proved Mars was once wet: Opportunity found hematite \u201cblueberries\u201d formed in water, and Spirit found hot-spring silica at Home Plate.'}</p>`
    + `<h2 class="section-title">Reading a raw Mars image</h2><p>Frames arrive nearly monochrome from each individual detector; colour is assembled from repeated exposures through different filters, and hazard-avoidance cameras (Fishtail, Navcam) are wide-angle and slightly distorted. Dust storms and the distant sun make the sky butterscotch by day and occasionally blue at sunset \u2014 the reverse of Earth, caused by fine dust scattering red light.</p>`
    + `<h2 class="section-title">Time delay</h2><p>Radio takes 3\u201322 minutes each way depending on orbital positions, so no rover is driven live. Each mission day starts with a command upload built from overnight imagery, then the vehicle drives and observes autonomously until the next sol.</p>`
    + `<p class="meta">Imagery: NASA/JPL-Caltech Mars Assembl\u00e9 Camera archive \u00b7 public domain \u00b7 mirrored at Tukuk-OS.</p>`;
  return nasaDoc({
    title: `${rv.name} on Mars \u2014 Latest Rover Photos from ${escapeHtml(String(rv.site)).replace(/&[a-z]+;/g, ' ')} | Tukuk-OS`,
    desc: `Real surface photos from NASA's ${rv.name} rover on Mars, with sols, cameras and dates \u2014 updated from the JPL archive.`,
    selfUrl, image: photos.length ? String(photos[0].img_src || '') : undefined,
    heroTitle: `${rv.name} \u00b7 Mars Live Frames`, heroSub: `${rv.site} \u00b7 ${photos.length} of the latest surface images \u00b7 NASA public domain`,
    body,
  });
}

// ── EPIC EARTH — pelantang gambar planet penuh DSCOVR (1.6 juta km) ──
function nasaEarthPage(req, list) {
  const items = (Array.isArray(list) ? list : []).filter((e) => e && (e.url || e.thumb));
  const first = items[0] || {};
  const ld = first.url ? JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ImageObject', name: 'EPIC: Earth from a million miles',
    contentUrl: String(first.url), caption: String(first.caption || 'Whole-Earth disc imaged by DSCOVR EPIC'),
    creditText: 'NASA', creator: { '@type': 'Organization', name: 'NASA' }, license: 'https://www.nasa.gov/multimedia/guidelines/index.html',
  }).replace(/</g, '\\u003c') : undefined;
  const slides = items.map((e, i) => ({ src: String(e.url || e.thumb), cap: String(e.caption || 'Earth \u00b7 DSCOVR EPIC').slice(0, 200), date: String(e.date || '').slice(0, 10), i })).slice(0, 12);
  const payload = JSON.stringify(slides).replace(/</g, '\\u003c');
  const strip = slides.map((s, i) => `<button type="button" data-i="${i}" class="${i === 0 ? 'on' : ''}">${escapeHtml(s.date || ('#' + (i + 1)))}</button>`).join('');
  const player = slides.length ? `<p><img id="epicimg" class="nasa-img" src="${escapeHtml(slides[0].src)}" alt="Whole planet Earth photographed from the DSCOVR EPIC camera at the L1 point" width="1024" height="1024" loading="eager" decoding="async"></p>`
    + `<p class="meta" id="epiccap">${escapeHtml(slides[0].cap)}</p>`
    + `<div class="nasa-strip" id="epicstrip" role="group" aria-label="Choose an EPIC image by date">${strip}</div>`
    + `<script>(function(){var d=${payload};var im=document.getElementById('epicimg');var cp=document.getElementById('epiccap');var st=document.getElementById('epicstrip');if(!im||!st)return;`
    + `st.addEventListener('click',function(ev){var b=ev.target.closest('button');if(!b)return;var k=Number(b.getAttribute('data-i'))||0;var s=d[k];if(!s)return;im.src=s.src;im.alt=s.cap;cp.textContent=s.cap;`
    + `Array.prototype.forEach.call(st.children,function(x){x.classList.toggle('on',x===b);});});})();</script>`
    : '<p>EPIC has not returned a frame for this request yet \u2014 the instrument images Earth roughly once every two hours while sunlit.</p>';
  const thumbs = slides.length > 1 ? `<h2 class="section-title">Every frame in this set</h2><div class="nasa-photos">`
    + slides.map((s) => `<figure>${nasaImg(s.src, s.cap)}<figcaption>${escapeHtml(s.date || '')}</figcaption></figure>`).join('') + `</div>` : '';
  const body = `<p>The Earth seen whole and in real colour, from a satellite a <b>million miles</b> away. DSCOVR sits at the Sun\u2013Earth L1 gravity point, 1.6 million km sunward of us, and its EPIC camera takes one full-disc photograph every few hours \u2014 the only view that shows the entire sunlit half of the planet at once, clouds moving in daylight time-lapse.</p>`
    + player + thumbs
    + `<h2 class="section-title">What this view is for</h2><p>EPIC is a science instrument: by imaging the whole planet in eleven spectral bands it measures ozone, aerosols, cloud height, vegetation and water vapour simultaneously \u2014 the daily health check of the atmosphere that geostationary satellites can only do from one side.</p>`
    + `<h2 class="section-title">The pale blue dot, revisited</h2><p>In 1990 Voyager 1, 6 billion km out, turned its camera back and took the first portrait of Earth from beyond the Solar System. Carl Sagan\u2019s reflection on that pixel \u2014 \u201clook again at that dot. That\u2019s here. That\u2019s home.\u201d \u2014 is the reason whole-Earth imagery carries emotional weight: every national border, city and argument fits inside one cloud-wrapped speck.</p>`
    + `<h2 class="section-title">Try this</h2><p>Pick two frames a day apart and watch the cloud systems rotate westward with the trade winds; find the swirl of a tropical cyclone; notice that at any moment roughly half the planet in the picture is in daylight. EPIC\u2019s archive back to 2015 is free and public domain.</p>`
    + `<p class="meta">Imagery: NASA \u2013 NOAA DSCOVR/EPIC experiment \u00b7 public domain.</p>`;
  return nasaDoc({
    title: 'EPIC Earth \u2014 the Whole Planet Photographed from a Million Miles | Tukuk-OS',
    desc: 'NASA\u2019s DSCOVR EPIC camera images the entire sunlit Earth every few hours from 1.6 million km away. Today\u2019s frames, free and public domain.',
    selfUrl: 'https://tukuk.org/nasa/earth', heroTitle: 'Earth, Whole', heroSub: 'Imaged by DSCOVR EPIC from the L1 point \u00b7 NASA public domain',
    image: first.url || undefined, ld, body,
  });
}

// ── EKOPLANET — senarai dunia berdekatan, dari Arkib Eksoplanet NASA ──
function nasaExoplanetsPage(req, exo, withinPc) {
  const planets = exo && Array.isArray(exo.planets) ? exo.planets : [];
  const cut = Number(withinPc) || 0;
  const shown = cut ? planets.filter((p) => Number(p.dist_pc) <= cut) : planets;
  const nearest = planets[0] || null;
  const within10 = planets.filter((p) => Number(p.dist_pc) <= 10).length;
  const rocky = planets.filter((p) => p.radius_earth && Number(p.radius_earth) <= 1.6).length;
  const selfUrl = cut ? `https://tukuk.org/nasa/exoplanets?d=${cut}` : 'https://tukuk.org/nasa/exoplanets';
  const filters = `<p class="nasa-strip">` + [[0, 'Nearest 250'], [10, 'Within 10 pc'], [20, 'Within 20 pc'], [50, 'Within 50 pc']]
    .map(([v, label]) => `<a class="btn ${((Number(withinPc) || 0) === v) ? 'primary' : 'ghost'}" href="/nasa/exoplanets${v ? `?d=${v}` : ''}">${label}</a>`).join('') + `</p>`;
  const rows = shown.slice(0, 120).map((p) => `<tr><td>${escapeHtml(String(p.name))}</td>`
    + `<td>${Number(p.dist_pc) || 0} pc (${Math.round((Number(p.dist_pc) || 0) * 3.2616 * 10) / 10} ly)</td>`
    + `<td>${p.radius_earth ? `${p.radius_earth} \u2295` : '\u2014'}</td>`
    + `<td>${p.period_days ? `${p.period_days} d` : '\u2014'}</td>`
    + `<td>${p.star_temp_k ? nasaFmt(p.star_temp_k) + ' K' : '\u2014'}</td>`
    + `<td>${p.disc_year || '\u2014'}</td></tr>`).join('');
  const body = `<p>More than <b>5,800 planets</b> have now been confirmed around other stars \u2014 a catalogue that did not exist before 1992. Below are the closest confirmed worlds, sorted by distance, taken from the NASA Exoplanet Archive. A parsec (pc) is 3.26 light years; the nearest star system, Alpha Centauri, is 1.3 pc away.</p>`
    + `<div class="nasa-grid"><div class="nasa-card"><h3>Worlds listed here</h3><div class="big">${nasaFmt(shown.length)}</div></div>`
    + `<div class="nasa-card"><h3>Closest of all</h3><div class="big">${nearest ? escapeHtml(String(nearest.name)) : '\u2014'}</div></div>`
    + `<div class="nasa-card"><h3>Its distance</h3><div class="big">${nearest ? `${nearest.dist_pc} pc` : '\u2014'}</div></div>`
    + `<div class="nasa-card"><h3>Within 10 pc</h3><div class="big">${within10}</div></div>`
    + `<div class="nasa-card"><h3>Potentially rocky</h3><div class="big">${rocky} \u2264 1.6 \u2295</div></div>`
    + `<div class="nasa-card"><h3>Source</h3><div class="big" style="font-size:1rem">NASA Exoplanet Archive</div></div></div>`
    + filters
    + (rows ? `<table class="nasa-table"><tr><th>Planet</th><th>Distance</th><th>Radius</th><th>Orbital period</th><th>Star temp</th><th>Discovered</th></tr>${rows}</table>`
      : '<p>No planets match that distance window in the nearest-sample cache \u2014 the widest list is the default page.</p>')
    + `<h2 class="section-title">How a planet gets found at all</h2><p>Nearly every planet here was detected indirectly: by the <b>transit method</b> (a star dims for hours as a world crosses it \u2014 the technique of Kepler, TESS and CHEOPS), by <b>radial velocity</b> (the star\u2019s wobble measured in Doppler shifts), or by direct imaging and microlensing for the widest orbits. What looks like an impossible measurement is now routine precision: a Jupiter-sized world dims a Sun-like star by about 1%.</p>`
    + `<h2 class="section-title">The interesting shortlist</h2><p><b>Proxima Centauri b</b> (1.3 pc) orbits our nearest stellar neighbour. <b>TRAPPIST-1</b> (14 pc) packs seven Earth-sized worlds into a space smaller than Mercury\u2019s orbit, several in the temperate zone. <b>LHS 1140 b</b> and <b>K2-18 b</b> are the current priorities for atmospheric study with JWST \u2014 detection of water vapour, carbon dioxide or methane in a temperate rocky atmosphere would be the first real hint of a habitable world beyond the Sun.</p>`
    + `<h2 class="section-title">Why radius and star temperature matter</h2><p>A planet\u2019s radius in Earth radii (\u2295) hints at composition: below ~1.6 it is likely rocky, above ~2.5 it holds a thick gas envelope. Because red dwarfs are far cooler, their habitable zones sit so close in that planets are tidally locked \u2014 one permanent day side, one night side \u2014 which changes what \u201chabitable\u201d can even mean.</p>`
    + `<p class="meta">Data: NASA Exoplanet Archive (pscomppars), Caltech/JPL \u00b7 US government public data.</p>`;
  return nasaDoc({
    title: 'Exoplanets Nearest to Earth \u2014 Confirmed Worlds, Ranked by Distance | Tukuk-OS',
    desc: 'Every confirmed planet within the nearest parsecs, with radius in Earth units, orbital period and discovery year \u2014 live from the NASA archive.',
    selfUrl, robots: cut ? 'noindex,follow' : 'index,follow,max-image-preview:large',
    heroTitle: 'Other Worlds', heroSub: 'The nearest confirmed planets around other stars \u00b7 ranked by distance',
    body,
  });
}

// ── BUNYI ANGKASA — arkib audio NASA (domain awam) boleh main di halaman ──
const NASA_SOUND_TOPICS = [
  { slug: 'apollo', label: 'Apollo missions', blurb: 'Apollo-era mission audio and NASA\u2019s own historians on the landings.' },
  { slug: 'planets', label: 'Planets', blurb: 'Planetary science in NASA\u2019s own audio \u2014 what spacecraft measured across the Solar System.' },
  { slug: 'rockets', label: 'Rocket launches', blurb: 'Lift-off acoustics \u2014 from Saturn V to SLS and commercial boosters.' },
  { slug: 'mars', label: 'Mars', blurb: 'NASA has recorded sound on another planet \u2014 Perseverance\u2019s microphones did it.' },
  { slug: 'spacewalk', label: 'Spacewalks', blurb: 'EVA radio traffic, tool clanks and breathing outside the station.' },
  { slug: 'shuttle', label: 'Space Shuttle', blurb: 'Station construction era: deployments, docking calls and landings.' },
];

function nasaSoundsPage(req, audio, topic) {
  const t = NASA_SOUND_TOPICS.find((x) => x.slug === topic) || NASA_SOUND_TOPICS[0];
  const items = audio && Array.isArray(audio.items) ? audio.items : [];
  const selfUrl = `https://tukuk.org/nasa/sounds${t.slug === 'apollo' ? '' : `/${t.slug}`}`;
  const strip = `<p class="nasa-strip">` + NASA_SOUND_TOPICS.map((x) => `<a class="btn ${x.slug === t.slug ? 'primary' : 'ghost'}" href="/nasa/sounds${x.slug === 'apollo' ? '' : `/${x.slug}`}">${x.label}</a>`).join('') + `</p>`;
  const players = items.length
    ? items.map((a) => `<div class="nasa-audio"><h3>${escapeHtml(String(a.title || 'Untitled NASA recording'))}</h3>`
      + `<p>${escapeHtml(String(a.description || '').slice(0, 400)) || 'No description supplied by NASA for this asset.'}</p>`
      + `<audio controls preload="none" src="${escapeHtml(String(a.audio_url))}"></audio>`
      + `<p class="meta">${escapeHtml(String(a.date_created || '').slice(0, 10))} \u00b7 NASA audio asset ${escapeHtml(String(a.nasa_id || '')).slice(0, 30)} \u00b7 public domain</p></div>`).join('')
    : '<p>This collection returned no playable files right now \u2014 try another topic above.</p>';
  const body = `<p>${escapeHtml(t.blurb)} Every clip below is an original NASA recording released into the <b>public domain</b> \u2014 no account, no licence, playable straight here.</p>`
    + strip + players
    + `<h2 class="section-title">Why space has sound at all</h2><p>Space is a vacuum, so sound cannot travel through it \u2014 what you can hear here is of three kinds: microphones that worked inside a pressurised cabin or on a suit, engineering telemetry converted into audible ranges (\u201csonification\u201d of plasma waves and magnetic fields), and the acoustic record of launches on Earth. The Apollo crews recorded dust, static and their own breathing; the Voyagers and Cluster missions turned invisible plasma oscillations into pitch.</p>`
    + `<h2 class="section-title">Hearing Mars</h2><p>Perseverance carries microphones, and in 2021 humanity heard another planet for the first time: a light wind, a rover\u2019s own motor noise, and the Ingenuity helicopter overhead. Because Mars\u2019 thin CO\u2082 atmosphere absorbs high frequencies, distant sounds arrive hushed and dull \u2014 an actual acoustic signature of a different world.</p>`
    + `<h2 class="section-title">Using these recordings</h2><p>NASA imagery and audio are not copyrighted by NASA, so educators, podcasters and video makers may reuse them with attribution. The only usual limits are persona rights (astronaut faces and names in advertising) and \u201cDon\u2019s Dream\u201d style commercial-endorsement rules.</p>`
    + `<p class="meta">Audio: NASA Images API (images.nasa.gov, media_type=audio) \u00b7 served from NASA\u2019s own asset store.</p>`;
  return nasaDoc({
    title: `Sounds of Space \u2014 ${t.label} Recordings (NASA Audio) | Tukuk-OS`,
    desc: `Play real NASA audio: ${t.blurb} Free, public-domain recordings with no account required.`,
    selfUrl, heroTitle: 'Sounds of Space', heroSub: `${t.label} \u00b7 playable NASA archive audio \u00b7 public domain`,
    body,
  });
}

// ── SATELIT — elemen orbit CelesTrak (TLE) bagi armada yang benar-benar di atas ──
const SAT_GROUPS = [
  { slug: 'stations', label: 'Space stations', blurb: 'The crewed outposts: ISS, Tiangong and the crew vehicles visiting them.' },
  { slug: 'visual', label: 'Brightest payloads', blurb: 'The naked-eye fleet \u2014 station, Hubble and the big bright satellites.' },
  { slug: 'gps-ops', label: 'Navigation (GPS)', blurb: 'The medium-Earth constellation that your phone\u2019s position depends on.' },
  { slug: 'geostationary', label: 'Geostationary', blurb: 'Weather birds and comsats parked over one point of the equator.' },
  { slug: 'resource', label: 'Earth observation', blurb: 'Imaging, radar and science satellites watching the planet below.' },
];

function nasaSatellitesPage(req, data, group) {
  const g = SAT_GROUPS.find((x) => x.slug === group) || SAT_GROUPS[0];
  const sats = data && Array.isArray(data.satellites) ? data.satellites : [];
  const selfUrl = `https://tukuk.org/nasa/satellites${g.slug === 'stations' ? '' : `/${g.slug}`}`;
  const strip = `<p class="nasa-strip">` + SAT_GROUPS.map((x) => `<a class="btn ${x.slug === g.slug ? 'primary' : 'ghost'}" href="/nasa/satellites${x.slug === 'stations' ? '' : `/${x.slug}`}">${x.label}</a>`).join('') + `</p>`;
  const rows = sats.slice(0, 60).map((s) => `<tr><td>${escapeHtml(String(s.name))}</td>`
    + `<td>${escapeHtml(String(s.norad || '\u2014'))}</td><td>${escapeHtml(String(s.intl || '\u2014'))}</td>`
    + `<td>${s.incl_deg != null ? s.incl_deg + '\u00b0' : '\u2014'}</td>`
    + `<td>${s.period_min ? s.period_min + ' min' : '\u2014'}</td>`
    + `<td>${s.alt_km != null ? `${nasaFmt(s.alt_km)} km` : '\u2014'}</td></tr>`).join('');
  const alts = sats.map((s) => Number(s.alt_km)).filter((v) => Number.isFinite(v));
  const cards = `<div class="nasa-grid"><div class="nasa-card"><h3>Objects listed</h3><div class="big">${nasaFmt(sats.length)}</div></div>`
    + `<div class="nasa-card"><h3>Mean altitude</h3><div class="big">${alts.length ? Math.round(alts.reduce((a, b) => a + b, 0) / alts.length) : 0} km</div></div>`
    + `<div class="nasa-card"><h3>Fastest orbit</h3><div class="big">${sats.length ? Math.min(...sats.map((s) => Number(s.period_min) || 9999)) : 0} min</div></div></div>`;
  const body = `<p>${escapeHtml(g.blurb)} Each line below is a real object in orbit, decoded from its Two-Line Element set \u2014 the standard shorthand that describes an orbit: inclination, period and altitude are derived here from the mean motion in the second line.</p>`
    + strip + cards
    + (rows ? `<table class="nasa-table"><tr><th>Name</th><th>NORAD ID</th><th>International designator</th><th>Inclination</th><th>Period</th><th>Altitude</th></tr>${rows}</table>`
      : '<p>The element feed returned nothing for this group just now \u2014 CelesTrak refreshes several times a day.</p>')
    + `<h2 class="section-title">How orbits are measured</h2><p><b>Inclination</b> is the tilt of the orbit against the equator: the ISS\u2019 51.6\u00b0 is a compromise between crew-launch capability from Baikonur and fuel cost, while sun-synchronous Earth-imaging orbits sit near 97\u00b0 and pass over the same local time of day. <b>Period</b> follows altitude: low orbit circles Earth in 90\u2013100 minutes; a geostationary orbit needs 35,786 km and exactly 24 hours, which is why it stays parked over one spot.</p>`
    + `<h2 class="section-title">The congestion problem</h2><p>Over 10,000 active satellites now orbit Earth, most in the Starlink-style shells of the 400\u2013600 km band. Their combined brightness now affects ground-based astronomy, and every spent booster and collision fragment adds collision risk \u2014 the chain-reaction scenario called the Kessler syndrome. Deorbit rules (leave the orbit within five years, now tightening to 25\u21925) exist precisely for this.</p>`
    + `<h2 class="section-title">See one yourself</h2><p>On a clear night an hour after dusk, look for a steady bright light moving steadily across the sky \u2014 that is almost always a satellite, and the brightest are the station and the Iridium-style flares. Anything moving is in orbit; anything twinkling is a star.</p>`
    + `<p class="meta">Orbital elements: CelesTrak GP data (public TLE feed) \u00b7 catalogue identifiers: USSPACECOM NORAD.</p>`;
  return nasaDoc({
    title: `Satellites in Orbit \u2014 ${g.label}: Live Orbital Elements | Tukuk-OS`,
    desc: `Real orbit data for the ${g.label.toLowerCase()}: NORAD ID, inclination, period and altitude, decoded live from public TLE elements.`,
    selfUrl, heroTitle: `Orbiting Now \u00b7 ${g.label}`, heroSub: 'Decoded from public two-line elements \u00b7 refreshed on every visit',
    body,
  });
}

// ── TUKUK-OS WEATHER COMPLEX — OpenWeather tier PERCUMA, konten Bahasa Melayu ──
// Ceruk SEO berbeza daripada kluster NASA (en): carian "cuaca hari ini …" MY/ID
// bervolume tinggi & persaingan rendah. Semua halaman: index,follow + 3 unit iklan
// + cuacaNav() hab pautan-silang. Kuota API dijaga src/weather.js (bajet harian +
// cache 45m–30h) → server kekal ringan, halaman kota nyaris tanpa had (geokoding).
const CUACA_SECTIONS = [
  { href: '/cuaca', icon: '\uD83C\uDF24', name: 'Cuaca Hari Ini', blurb: 'Peta & senarai suhu langsung seluruh dunia — kemas kini setiap jam.' },
  { href: '/cuaca/peta', icon: '\uD83D\uDDFA', name: 'Peta Cuaca Langsung', blurb: 'Jubin OpenWeather pada peta interaktif: hujan, awan dan tekanan.' },
  { href: '/cuaca/ekstrem', icon: '\u2696', name: 'Rekod Suhu Dunia', blurb: 'Kota paling panas, paling sejuk & paling berangin sekarang.' },
  { href: '/cuaca/kod', icon: '\uD83D\uDCDC', name: 'Kod Cuaca', blurb: 'Makna setiap kod & ikon OpenWeather — dalam Bahasa Melayu.' },
  { href: '/cuaca/awan', icon: '\u2601', name: 'Jenis Awan', blurb: 'Cirrus sampai cumulonimbus — baca langit macam ahli meteorologi.' },
  { href: '/cuaca/angin', icon: '\uD83D\uDCA8', name: 'Skala Angin', blurb: 'Skala Beaufort 0–12 dan monsun Malaysia dijelaskan.' },
];

function cuacaNav() {
  return `<nav aria-label="Bahagian cuaca"><h2 class="section-title">Jelajahi Kompleks Cuaca Tukuk-OS</h2><div class="feed">`
    + CUACA_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${s.name}</a></h2><p>${s.blurb}</p></div>`).join('')
    + `</div></nav>`;
}

function cuacaDoc(o) {
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ogImage = o.image || 'https://tukuk.org/og.png';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:locale" content="ms_MY">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
.wx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.wx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21)}
.wx-card h3{margin:0 0 6px;font-size:.88rem;color:var(--muted,#9aa3b2);font-weight:600}
.wx-card .big{font-size:1.4rem;font-weight:700}
.wx-hero{display:flex;gap:22px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:16px 0;background:linear-gradient(135deg,#1e6fd9 0%,#123a6d 100%);color:#fff}
.wx-hero .temp{font-size:3.2rem;font-weight:800;line-height:1}
.wx-hero .wmeta{font-size:.92rem;opacity:.92;line-height:1.5}
.wx-hour{display:flex;gap:10px;overflow-x:auto;padding:6px 2px;margin:14px 0}
.wx-hour .hr{flex:0 0 auto;border:1px solid var(--line);border-radius:10px;padding:8px 12px;text-align:center;background:var(--panel,#171a21);min-width:76px}
.wx-hour .hr .t{font-weight:700}
.wx-hour .hr .lbl{font-size:.78rem;color:var(--muted,#9aa3b2)}
.wx-pill{display:inline-block;border-radius:999px;padding:3px 12px;font-weight:700;font-size:.85rem;color:#08121e}
table.wx-table{width:100%;border-collapse:collapse;font-size:.9rem;margin:14px 0}
.wx-table th,.wx-table td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.wx-table th{background:var(--panel,#171a21)}
.wx-citylinks{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
.wx-citylinks a{border:1px solid var(--line);border-radius:8px;padding:5px 10px;font-size:.85rem}
#wxmap{height:480px;border-radius:12px;border:1px solid var(--line);margin:16px 0}
@media(max-width:680px){.wx-grid{grid-template-columns:1fr}.wx-hero .temp{font-size:2.4rem}table.wx-table{display:block;overflow-x:auto}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('cuaca')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${cuacaNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

function weatherBusy(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escapeHtml(msg)} | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>${escapeHtml(msg)}</h1><p>Sumber data cuaca (OpenWeather) tidak sempat menjawab. Sila cuba lagi beberapa minit.</p><p><a href="/cuaca">Kembali ke Kompleks Cuaca</a></p></body>`;
}

// ——— Utiliti masa setempat (offset TZ dari API) + label Melayu ———
const WX_DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const WX_MONTHS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

function wxParts(unixSec, tzSec) {
  const d = new Date((Number(unixSec) + Number(tzSec || 0)) * 1000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), day: d.getUTCDate(), mon: d.getUTCMonth(), year: d.getUTCFullYear(), wday: d.getUTCDay() };
}

function wxHHMM(unixSec, tzSec) {
  const p = wxParts(unixSec, tzSec);
  return `${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}`;
}

function wxDateMs(p) { return `${WX_DAYS[p.wday]}, ${p.day} ${WX_MONTHS[p.mon]} ${p.year}`; }
function wxTempC(v) { return `${Math.round(Number(v) || 0)}\u00b0C`; }
function wxKmh(ms) { return Math.round((Number(ms) || 0) * 3.6); }
function isNightNow(cur) {
  if (!cur || !cur.sunrise || !cur.sunset || !cur.dt) return false;
  return !(cur.dt > cur.sunrise && cur.dt < cur.sunset);
}

// Halaman kota → kumpul hari setempat daripada ramalan 3-jam (dt + tz).
function wxDaily(fc, tzSec) {
  const byDay = new Map();
  for (const s of (fc && fc.list) || []) {
    const p = wxParts(s.dt, tzSec);
    const key = `${p.year}-${p.mon}-${p.day}`;
    const e = byDay.get(key) || { p, min: Infinity, max: -Infinity, pop: 0, ids: [], rainMm: 0 };
    e.min = Math.min(e.min, Number(s.main && s.main.temp_min) || Infinity);
    e.max = Math.max(e.max, Number(s.main && s.main.temp_max) || -Infinity);
    e.pop = Math.max(e.pop, Math.round((Number(s.pop) || 0) * 100));
    if (p.h >= 6 && p.h <= 18 && s.weather && s.weather[0]) e.ids.push(s.weather[0].id);
    if (s.rain && s.rain['3h']) e.rainMm += Number(s.rain['3h']) || 0;
    byDay.set(key, e);
  }
  return [...byDay.values()].map((e) => {
    const counts = {};
    for (const id of e.ids) counts[id] = (counts[id] || 0) + 1;
    const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      label: `${WX_DAYS[e.p.wday]} ${e.p.day}/${e.p.mon + 1}`,
      min: Number.isFinite(e.min) ? Math.round(e.min) : null,
      max: Number.isFinite(e.max) ? Math.round(e.max) : null,
      pop: e.pop, rainMm: Math.round(e.rainMm * 10) / 10,
      id: dom ? Number(dom[0]) : 800,
    };
  });
}

// ——— HAB /cuaca — snapshot kota featured + senarai semua kota (hab pautan) ———
function cuacaHubPage(req, snap) {
  const tz = snap[0] && snap[0].cur ? snap[0].cur.timezone : 0;
  const now = wxParts(Math.floor(Date.now() / 1000), tz);
  const cards = snap.map(({ city, cur }) => {
    const d = wx.describe(cur.weather && cur.weather[0] ? cur.weather[0].id : 800, isNightNow(cur));
    return `<div class="wx-card"><h3><a href="/cuaca/${city.slug}">${escapeHtml(city.name)}${city.cc ? ` \u00b7 ${city.cc}` : ''}</a></h3>`
      + `<div class="big">${d.emoji} ${wxTempC(cur.main.temp)}</div>`
      + `<div class="meta">${escapeHtml(d.ms)} \u00b7 ${wxKmh(cur.wind.speed)} km/j \u00b7 kelembapan ${Number(cur.main.humidity) || 0}%</div></div>`;
  }).join('');
  const grouped = {};
  for (const c of wx.CITIES) (grouped[c.country] = grouped[c.country] || []).push(c);
  const linkBoxes = Object.entries(grouped).map(([country, list]) => `<h3>${escapeHtml(country)}</h3><div class="wx-citylinks">`
    + list.map((c) => `<a href="/cuaca/${c.slug}">${escapeHtml(c.name)}</a>`).join('') + `</div>`).join('');
  const body = `<p>Kemas kini ${wxDateMs(now)} \u00b7 data langsung OpenWeather. Cari bandar anda: </p>`
    + `<form action="/cuaca/cari" method="get" role="search" style="margin:10px 0">`
    + `<input type="search" name="q" placeholder="cth: Kuching, Tokyo, London\u2026" aria-label="Cari bandar" style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;min-width:260px;background:var(--panel,#171a21);color:inherit">`
    + `<button class="btn primary" type="submit" style="margin-left:8px">Cari cuaca</button></form>`
    + `<h2 class="section-title">Suhu dunia sekarang</h2><div class="wx-grid">${cards}</div>`
    + `<h2 class="section-title">Ramalan penuh ikut bandar</h2>`
    + `<p>Setiap halaman bandar membawa semasa, 8 slot jam akan datang, ramalan 5\u20136 hari, kualiti udara (PM2.5), waktu matahari serta nasihat bersiap yang dijana automatik \u2014 semua daripada API OpenWeather tier percuma. Cuaca dunia \u2014 Tokyo, London, New York, Makkah dan ratusan kota lain tersenarai ikut negara di bawah; permulaan popular: <a href="/cuaca/tokyo">Tokyo</a>, <a href="/cuaca/london">London</a>, <a href="/cuaca/new-york">New York</a> atau <a href="/cuaca/makkah">Makkah</a>.</p>`
    + linkBoxes
    + `<h2 class="section-title">Kenapa cuaca penting untuk kita</h2><p>Malaysia duduk di laluan zon hujan khatulistiwa: monsun barat daya (Mei\u2013September) dan monsun timur laut (November\u2013Mac) silih berganti membawa hujan, dan jerebu rentas sempadan sesekali menentukan sama ada sekolah ditutup. Memahami bacaan \u2014 kelembapan, tekanan, kelajuan angin, indeks AQI \u2014 menukar ramalan daripada angka kepada keputusan: bila sesuai menanam, bila perlu bawa payung, bila paling bahaya memandu.</p>`
    + `<p class="meta">Untuk langit malam pula (fasa bulan & senja), lawati <a href="/nasa/sky">Langit Malam Ini di kompleks NASA</a> \u2014 satu keluarga data, dua sudut pandangan. Bumi bergegar? Semak <a href="/gempa">Kompleks Gempa</a> untuk senarai langsung USGS. Nak rancang percutian? Kalendar penuh <a href="/cuti">cuti umum dunia</a>. Nak kenal destinasi? Profil penuh di <a href="/negara">Kompleks Negara</a>.</p>`;
  return cuacaDoc({
    title: 'Cuaca Hari Ini \u2014 Suhu, Ramalan & Kualiti Udara Seluruh Dunia | Tukuk-OS',
    desc: 'Semak cuaca hari ini secara langsung: suhu, hujan, angin, kualiti udara PM2.5 dan ramalan 5 hari untuk Tokyo, London, New York, Makkah dan ratusan bandar lain di seluruh dunia.',
    selfUrl: 'https://tukuk.org/cuaca',
    heroTitle: 'Kompleks Cuaca Tukuk-OS', heroSub: 'Data langsung OpenWeather \u00b7 kemas kini setiap jam \u00b7 percuma tanpa log masuk',
    body,
  });
}

// ——— Halaman kota: semasa + 8 jam + 5 hari + AQI + nasihat dijana automatik ———
function cuacaCityPage(req, city, cur, fc, air) {
  const w = (cur.weather && cur.weather[0]) || { id: 800 };
  const night = isNightNow(cur);
  const d = wx.describe(w.id, night);
  const tz = Number(cur.timezone) || 0;
  const nowP = wxParts(cur.dt, tz);
  const main = cur.main || {};
  const selfUrl = `https://tukuk.org/cuaca/${city.slug}`;
  const aqi = air && air.list && air.list[0] ? air.list[0].main : null;
  const band = aqi ? wx.aqiBand(aqi.aqi) : null;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Place', name: `Cuaca di ${city.name}`,
    description: `Semakan langsung cuaca ${city.name}: ${d.ms}, ${wxTempC(main.temp)}, angin ${wxKmh(cur.wind.speed)} km/j.`,
    geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon },
    url: selfUrl,
  }).replace(/</g, '\\u003c');
  const hero = `<div class="wx-hero"><div class="temp">${d.emoji} ${wxTempC(main.temp)}</div><div class="wmeta">`
    + `<b>${escapeHtml(city.name)}</b>${city.country ? `, ${escapeHtml(String(city.country))}` : ''} \u00b7 ${escapeHtml(d.ms)}<br>`
    + `Rasa sebenar ${wxTempC(main.feels_like)} \u00b7 ${wxDateMs(nowP)} ${String(nowP.h).padStart(2, '0')}:${String(nowP.m).padStart(2, '0')} waktu setempat`
    + `</div></div>`;
  const bf = wx.beaufort(wxKmh(cur.wind.speed));
  const cards = `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Angin</h3><div class="big">${wxKmh(cur.wind.speed)} km/j</div><div class="meta">Skala Beaufort ${bf[0]} \u2014 ${escapeHtml(bf[2])}</div></div>`
    + `<div class="wx-card"><h3>Kelembapan</h3><div class="big">${Number(main.humidity) || 0}%</div></div>`
    + `<div class="wx-card"><h3>Tekanan</h3><div class="big">${Number(main.pressure) || 0} hPa</div></div>`
    + `<div class="wx-card"><h3>Jarak nampak</h3><div class="big">${cur.visibility ? (cur.visibility / 1000).toFixed(cur.visibility >= 10000 ? 0 : 1) + ' km' : '\u2014'}</div></div>`
    + `<div class="wx-card"><h3>Litupan awan</h3><div class="big">${Number(cur.clouds && cur.clouds.all) || 0}%</div></div>`
    + `<div class="wx-card"><h3>Matahari</h3><div class="big">${wxHHMM(cur.sunrise, tz)} \u2192 ${wxHHMM(cur.sunset, tz)}</div><div class="meta"><a href="/cuaca/${city.slug}/surya">panduan waktu keemasan \u2192</a></div></div>`
    + `</div>`;
  let hourHtml = '';
  if (fc && Array.isArray(fc.list)) {
    const soon = fc.list.filter((s) => s.dt >= cur.dt - 3600).slice(0, 8);
    if (soon.length) hourHtml = `<h2 class="section-title">Jam akan datang</h2><div class="wx-hour">`
      + soon.map((s) => { const dd = wx.describe(s.weather && s.weather[0] ? s.weather[0].id : 800, false); const p = wxParts(s.dt, tz); return `<div class="hr"><div class="lbl">${String(p.h).padStart(2, '0')}:00</div><div>${dd.emoji}</div><div class="t">${wxTempC(s.main.temp)}</div><div class="lbl">${Math.round((Number(s.pop) || 0) * 100)}% \uD83D\uDCA7</div></div>`; }).join('')
      + `</div>`;
  }
  let daysHtml = '';
  if (fc && Array.isArray(fc.list)) {
    const rows = wxDaily(fc, tz).slice(0, 6).map((e) => { const dd = wx.describe(e.id, false); return `<tr><td>${escapeHtml(e.label)}</td><td>${dd.emoji} ${escapeHtml(dd.ms)}</td><td>${e.min}\u00b0 \u2192 ${e.max}\u00b0C</td><td>${e.pop}%</td><td>${e.rainMm ? `${e.rainMm} mm` : '\u2014'}</td></tr>`; }).join('');
    daysHtml = rows ? `<h2 class="section-title">Ramalan 5\u20136 hari</h2><table class="wx-table"><tr><th>Hari</th><th>Keadaan</th><th>Suhu</th><th>Kebarangkalian hujan</th><th>Anggaran hujan</th></tr>${rows}</table>` : '';
  }
  const airBox = band
    ? `<h2 class="section-title">Kualiti udara</h2><p><span class="wx-pill" style="background:${band.color}">AQI ${Number(aqi.aqi)} \u2014 ${escapeHtml(band.label)}</span> \u00b7 ${escapeHtml(band.advice)} <a href="/cuaca/${city.slug}/udara">Butiran PM2.5 & ramalan pencemaran \u2192</a></p>`
    : '';
  const advice = wx.cityAdvice(cur, air).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  const body = `<p class="back-link"><a href="/cuaca">\u2190 Semua cuaca</a> \u00b7 <a href="/cuaca/peta">Peta langsung</a> \u00b7 <a href="/nasa/sky?lat=${city.lat}&lng=${city.lon}">Langit malam di sini (fasa bulan & senja)</a></p>`
    + hero + cards + hourHtml + daysHtml + airBox
    + (advice ? `<h2 class="section-title">Sedia hari ini</h2><ul>${advice}</ul>` : '')
    + `<h2 class="section-title">Bagaimana bacaan ini diperoleh</h2><p>Angka di atas ialah cerapan model raster OpenWeather untuk koordinat ${Number(city.lat).toFixed(3)}\u00b0, ${Number(city.lon).toFixed(3)}\u00b0 \u2014 dikemas kini setiap 45 minit dan dipaparkan dalam waktu setempat ${city.name} (UTC${tz >= 0 ? '+' : '\u2212'}${Math.abs(Math.round(tz / 3600))}). Kelembapan tinggi bersama suhu \u2265 31\u00b0C menjadikan "rasa sebenar" lebih panas daripada bacaan termometer; tekanan yang menurun perlahan biasanya isyarat hujan dalam 12\u201324 jam.</p>`
    + `<h2 class="section-title">Makna ikon & kod</h2><p>Keadaan <b>${escapeHtml(d.ms)}</b> sepadan dengan kod ${Number(w.id)} OpenWeather \u2014 keseluruhan senarai kod dijelaskan di <a href="/cuaca/kod">halaman kod cuaca</a>, jenis awan di <a href="/cuaca/awan">panduan awan</a> dan kelajuan angin di <a href="/cuaca/angin">skala Beaufort</a>.</p>`
    + `<p class="meta">Data: OpenWeather (tier percuma) \u00b7 halaman ini dijana langsung pada setiap kunjungan.</p>`;
  return cuacaDoc({
    title: `Cuaca Hari Ini di ${city.name}${city.country ? `, ${city.country}` : ''} \u2014 Suhu, Ramalan & Kualiti Udara | Tukuk-OS`,
    desc: `Semasa ${city.name}: ${wxTempC(main.temp)} (${d.ms}), angin ${wxKmh(cur.wind.speed)} km/j, kelembapan ${Number(main.humidity) || 0}% + ramalan 5 hari dan kualiti udara.`,
    selfUrl, heroTitle: `Cuaca di ${city.name}`, heroSub: `${d.emoji} ${escapeHtml(d.en)} \u00b7 dikemas kini ${wxHHMM(cur.dt, tz)} waktu setempat`,
    ld: jsonLd, body,
  });
}

// ——— /cuaca/:slug/udara — AQI + komponen + ramalan + panduan kesihatan ———
function cuacaAirPage(req, city, air, airFc) {
  const item = air && air.list && air.list[0] ? air.list[0] : null;
  if (!item) throw new Error('tiada data udara');
  const band = wx.aqiBand(item.main.aqi);
  const c = item.components || {};
  const selfUrl = `https://tukuk.org/cuaca/${city.slug}/udara`;
  const POLLUTANTS = [
    ['pm2_5', 'PM2.5', 'partikul halus < 2.5 μm — masuk ke dalam darah; risiko utama jerebu'],
    ['pm10', 'PM10', 'debu & debu halus — merangsang mata dan tekak'],
    ['o3', 'Ozon (O\u2083)', 'bagaimana baik di stratosfera, buruk di permukaan: terbentuk daripada panas + kenderaan'],
    ['no2', 'Nitrogen dioksida', 'asap enjin diesel & loji kuasa — penanda pencemaran trafik'],
    ['so2', 'Sulfur dioksida', 'peleburan & loji arang batu; juga gunung berapi'],
    ['co', 'Karbon monoksida', 'pembakaran tidak lengkap; berbahaya di ruang tertutup'],
    ['nh3', 'Amonia', 'penternakan & baja — jarang jadi isu bandar'],
  ];
  const WHO = { pm2_5: 15, pm10: 45, o3: 100, no2: 25, so2: 40, co: 4000, nh3: 22 };
  const rows = POLLUTANTS.map(([k, label, note]) => {
    const v = Math.round((Number(c[k]) || 0) * 100) / 100;
    const limit = WHO[k];
    const flag = v > limit ? `\u26A0\uFE0F melebihi panduan 24-jam WHO (${limit})` : '\u2713 di bawah panduan 24-jam WHO';
    return `<tr><td><b>${label}</b></td><td>${v} \u00b5g/m\u00b3</td><td>${escapeHtml(flag)}</td><td>${escapeHtml(note)}</td></tr>`;
  }).join('');
  let fcHtml = '';
  if (airFc && Array.isArray(airFc.list) && airFc.list.length) {
    const chips = airFc.list.slice(0, 16).map((s) => {
      const b = wx.aqiBand(s.main && s.main.aqi);
      return `<span class="wx-pill" style="background:${b.color}" title="${escapeHtml(b.label)}">${wxHHMM(s.dt, 0)} \u00b7 AQI ${Number(s.main && s.main.aqi) || '?'}</span>`;
    }).join(' ');
    fcHtml = `<h2 class="section-title">Ramaman pencemaran (slot 3-jam)</h2><p>${chips}</p>`;
  }
  const bandRows = wx.AQI_BANDS.map((b) => `<tr><td><span class="wx-pill" style="background:${b.color}">${b.n} \u00b7 ${escapeHtml(b.label)}</span></td><td>${escapeHtml(b.advice)}</td></tr>`).join('');
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Dataset', name: `Kualiti udara ${city.name}`,
    description: `AQI semasa ${Number(item.main.aqi)} (${band.label}) dengan komponen PM2.5, PM10, O\u2083, NO\u2082, SO\u2082, CO, NH\u2083.`,
    url: selfUrl,
  }).replace(/</g, '\\u003c');
  const body = `<p class="back-link"><a href="/cuaca/${city.slug}">\u2190 Cuaca ${escapeHtml(city.name)}</a> \u00b7 <a href="/cuaca/peta">Peta</a></p>`
    + `<div class="wx-hero"><div class="temp" style="font-size:2.6rem">AQI ${Number(item.main.aqi)}</div><div class="wmeta">`
    + `<span class="wx-pill" style="background:${band.color}">${escapeHtml(band.label)}</span><br>${escapeHtml(band.advice)}</div></div>`
    + `<h2 class="section-title">Komponen pencemar sekarang di ${escapeHtml(city.name)}</h2>`
    + `<table class="wx-table"><tr><th>Pencemar</th><th>Kepadan</th><th>Tahap</th><th>Makna</th></tr>${rows}</table>`
    + fcHtml
    + `<h2 class="section-title">Skala AQI OpenWeather (1\u20135)</h2><table class="wx-table"><tr><th>Jalur</th><th>Panduan kesihatan</th></tr>${bandRows}</table>`
    + `<h2 class="section-title">Kenapa PM2.5 penting di Asia Tenggara</h2><p>PM2.5 cukup kecil untuk menembusi sawar paru-paru dan mengalir ke darah. Puncanya di rantau ini bermusim: pembakaran lahan dan gambut untuk pembukaan ladang (Februari\u2013Oktober) menghantar jerebu rentas sempadan ke Semenanjung, Sabah dan Sarawak, dan indeks udara sekolah menjadi faktor penutupan. Di bandar, gabungan trafik + habuk pembinaan mengekalkan bacaan sederhana walaupun langit nampak cerah. Masker pembedahan kurang berkesan berbanding respirator N95/FFP2 yang menempel rapat.</p>`
    + `<h2 class="section-title">Tips dalaman</h2><p>Mengetat tingkap pada waktu puncak (6\u20139 pg, 6\u20139 ptg) mengurangkan pendedahan NO\u2083; menanam pokok dalaman tidak menapis PM2.5 secara bermakna \u2014 penapis HEPA bersaiz bilik jauh lebih berkesan. Jika AQI jalur 4\u20135, tukar senaman luar kepada waktu subuh atau petang lewat apabila bacaan biasanya lebih rendah.</p>`
    + `<p class="meta">Sumber: OpenWeather Air Pollution API (tier percuma) \u00b7 rujukan panduan: WHO 24-jam. Bukan pengganti peralatan pemantauan rasmi.</p>`;
  return cuacaDoc({
    title: `Kualiti Udara di ${city.name} Hari Ini \u2014 AQI, PM2.5 & Ramalan Pencemaran | Tukuk-OS`,
    desc: `AQI semasa ${city.name}: ${Number(item.main.aqi)} (${band.label}). Pecahan PM2.5, PM10, ozon, NO\u2082 + ramaman pencemaran dan panduan kesihatan berbahasa Melayu.`,
    selfUrl, heroTitle: `Udara di ${city.name}`, heroSub: `Indeks kualiti udara langsung \u00b7 skala OpenWeather 1\u20135`,
    ld: jsonLd, body,
  });
}

// ——— /cuaca/:slug/surya — terbit/terbenam/noon/golden hour (0 API tambahan) ———
function cuacaSunPage(req, city, cur) {
  const tz = Number(cur.timezone) || 0;
  const rise = Number(cur.sunrise) || 0;
  const set = Number(cur.sunset) || 0;
  const lenMin = Math.max(0, Math.round((set - rise) / 60));
  const lenH = Math.floor(lenMin / 60); const lenM = lenMin % 60;
  const noon = rise + (set - rise) / 2;
  const selfUrl = `https://tukuk.org/cuaca/${city.slug}/surya`;
  const rows = [
    ['Matahari terbit', wxHHMM(rise, tz), 'Langit mula berwarna; burung mula berkicau'],
    ['Waktu keemasan pagi', `${wxHHMM(rise + 15 * 60, tz)} \u2013 ${wxHHMM(rise + 45 * 60, tz)}`, 'Cahaya lembut condong \u2014 terbaik untuk potret & landskap'],
    ['Tengah hari suria', wxHHMM(noon, tz), 'Matahari paling tinggi; bayang paling pendek; UV memuncak'],
    ['Waktu keemasan petang', `${wxHHMM(set - 45 * 60, tz)} \u2013 ${wxHHMM(set - 5 * 60, tz)}`, 'Jam emas fotografer \u2014 warna keemasan & bayang panjang'],
    ['Matahari terbenam', wxHHMM(set, tz), 'Selepas ini 20\u201340 minit “blue hour” untuk bandar'],
  ].map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${escapeHtml(r[2])}</td></tr>`).join('');
  const absLat = Math.abs(Number(city.lat) || 0);
  const seasonNote = absLat < 10
    ? `Di ${escapeHtml(city.name)} (${absLat.toFixed(1)}\u00b0 lintang), panjang hari hampir tetap sepanjang tahun \u2014 sekitar ${lenH} jam ${lenM} minit, cuma berbeza \u00b1${Math.round(10 + absLat)} minit antara equinox dan soltis. Yang berubah ialah <em>waktu</em> terbit/terbenam, bukan jumlah cahaya.`
    : `Pada lintang ${absLat.toFixed(1)}\u00b0, panjang hari ${escapeHtml(city.name)} berubah dengan ketara antara musim \u2014 hari ini ${lenH} jam ${lenM} minit; di musim panas lintang ia boleh mencecah 16\u201318 jam dan di musim dingin menyusut bawah 8 jam.`;
  const body = `<p class="back-link"><a href="/cuaca/${city.slug}">\u2190 Cuaca ${escapeHtml(city.name)}</a> \u00b7 <a href="/nasa/sky?lat=${city.lat}&lng=${city.lon}">Fasa bulan & gelap astronomi di sini \u2192</a></p>`
    + `<div class="wx-hero"><div class="temp">\uD83C\uDF05 ${lenH}j ${lenM}m</div><div class="wmeta">panjang hari di ${escapeHtml(city.name)} \u00b7 ${wxDateMs(wxParts(cur.dt, tz))}</div></div>`
    + `<table class="wx-table"><tr><th>Peristiwa</th><th>Waktu setempat</th><th>Makna</th></tr>${rows}</table>`
    + `<h2 class="section-title">Mengapa panjang hari begitu</h2><p>${seasonNote} Penyebab musim ialah kecondongan paksi Bumi 23.4\u00b0 \u2014 bukan jarak ke matahari.Equinox (Mac & September) menyamakan siang dan malam di seluruh planet; soltis (Jun & Disember) memuncakkan perbezaan lintang.</p>`
    + `<h2 class="section-title">Cara guna waktu keemasan</h2><p>“Golden hour” berlaku apabila matahari di bawah \u22486\u00b0: cahaya diserakkan lebih panjang jalannya, membiaki baki warna jingga. Untuk selfie/motosikal: elak matahari tepat hadapan pada tengah hari suria \u2014 bayang topi akan menutup mata. Untuk panel suria rumah: tengah hari suria (bukan jam 12:00 pada jam!) ialah puncak produksi \u2014 di Malaysia selalunya 12:30\u201313:10 setempat bergantung lokasi bujur.</p>`
    + `<h2 class="section-title">Kaitan dengan cuaca</h2><p>Terbit/terbenam di halaman ini ialah kiraan astronomi; awan boleh “mencuri” 20\u201340 minit cahaya awal/akhir. Semak <a href="/cuaca/${city.slug}">ramalan awan ${escapeHtml(city.name)}</a> untuk litupan jam tersebut \u2014 litupan <20% menjanjikan matahari terbenam jelas, 40\u201370% ialah senario warna paling dramatik (awan menjadi kanvas pantulan).</p>`;
  return cuacaDoc({
    title: `Waktu Matahari di ${city.name} \u2014 Terbit, Terbenam & Waktu Keemasan | Tukuk-OS`,
    desc: `Matahari terbit ${wxHHMM(rise, tz)}, terbenam ${wxHHMM(set, tz)} waktu ${city.name} (${lenH}j ${lenM}m hari) + panduan golden hour untuk fotografer dan pemilik panel suria.`,
    selfUrl, heroTitle: `Matahari di ${city.name}`, heroSub: 'Waktu astronomi setempat \u00b7 golden hour & tengah hari suria',
    body,
  });
}

// ——— /cuaca/peta — Leaflet + jubin OpenWeather percuma (hujan/awan/tekanan) ———
function cuacaMapPage(req) {
  const layers = [
    ['weather_new', 'Hujan & ribut', true],
    ['clouds_new', 'Awan', false],
    ['pressure_new', 'Tekanan udara', false],
  ];
  const payload = JSON.stringify(layers.map(([l, label, def]) => ({ layer: l, label, def, url: wx.tileTemplateUrl(l) }))).replace(/</g, '\\u003c');
  const body = `<p>Peta langsung berlapis cuaca OpenWeather \u2014 toglayer hujan, awan dan tekanan di atas jalan raya/terrain. Jubin dimuat pada resolusi dunia; cari kota anda di mana-mana benua, atau zum ke Singapura, Mumbai atau Lagos untuk melihat sel hujan petang tropika yang terkenal itu.</p>`
    + `<div id="wxmap" role="application" aria-label="Peta cuaca langsung"></div>`
    + `<noscript><p>Javascript diperlukan untuk peta interaktif. Senarai teks ada di <a href="/cuaca">hab cuaca</a> dan <a href="/cuaca/ekstrem">rekod suhu</a>.</p></noscript>`
    + `<h2 class="section-title">Cara membaca</h2><p>Lapisan hujan mengikut skala warna: biru = hujan ringan, kuning\u2013merah = lebat/ribut. Corak “bintik-bintik” kecil di daratan Borneo pada waktu petang ialah konveksi setempat \u2014 awan guruh tumbuh dari panas tanah, bukan daripada front; sebab itu ramalan tropika cepat berubah dan nilai 45 minit cache kami sengaja pendek. Lapisan tekanan pula memaparkan isobar: jarak isobar rapat = angin kencang.</p>`
    + `<h2 class="section-title">Kongsi dengan langit malam</h2><p>Peta ini memaparkan <em>awan sekarang</em> \u2014 musuh pemerhati bintang. Jika lapisan awan kosong di lokasi anda, semak pula <a href="/nasa/sky">Langit Malam Ini</a> untuk fasa bulan dan waktu gelap astronomi sebelum membentangkan teleskop.</p>`
    + `<p class="meta">Jubin: \u00a9 <a href="https://openweathermap.org/" rel="noopener nofollow">OpenWeather</a> \u00b7 peta dasar: \u00a9 <a href="https://www.openstreetmap.org/copyright" rel="noopener nofollow">OpenStreetMap</a> contributors.</p>`;
  const script = `<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" defer></script>`
    + `<script>document.addEventListener('DOMContentLoaded',function(){var WXP=${payload};function boot(){if(!window.L){setTimeout(boot,300);return;}var m=L.map('wxmap').setView([3.8,107],5);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:12,attribution:'\\u00a9 OpenStreetMap'}).addTo(m);var ctl=[];WXP.forEach(function(o){var tl=L.tileLayer(o.url,{maxZoom:12,opacity:.8});if(o.def)tl.addTo(m);ctl.push({[o.label]:tl});});L.control.layers(null,ctl,{collapsed:false}).addTo(m);}boot();});</script>`;
  return cuacaDoc({
    title: 'Peta Cuaca Langsung \u2014 Hujan, Awan & Tekanan Seluruh Dunia (OpenWeather) | Tukuk-OS',
    desc: 'Peta interaktif percuma: lapiskan hujan, awan dan tekanan udara OpenWeather atas OpenStreetMap. Zum ke bandar anda dan lihat cuaca bergerak sekarang.',
    selfUrl: 'https://tukuk.org/cuaca/peta',
    heroTitle: 'Peta Cuaca Langsung', heroSub: 'Jubin OpenWeather \u00b7 hujan + awan + tekanan \u00b7 interaktif',
    heroHtml: 'Peta Cuaca Langsung \uD83D\uDDFA',
    body: body + script,
    ld: JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Map', name: 'Peta Cuaca Langsung Tukuk-OS',
      description: 'Slippy map hujan/awan/tekanan OpenWeather', url: 'https://tukuk.org/cuaca/peta',
      contentUrl: wx.tileTemplateUrl('weather_new').replace('{z}/{x}/{y}', '5/24/40'),
      license: 'https://openweathermap.org/terms-of-use',
    }).replace(/</g, '\\u003c'),
  });
}

// ——— /cuaca/ekstrem — daripada snapshot kota featured (sifar API tambahan) ———
function cuacaExtremesPage(req, snap) {
  const rowsOf = (list, cell) => list.map(({ city, cur }) => `<tr><td><a href="/cuaca/${city.slug}">${escapeHtml(city.name)}</a></td><td>${cell(cur)}</td></tr>`).join('');
  const byTemp = [...snap].sort((a, b) => b.cur.main.temp - a.cur.main.temp);
  const hot = byTemp.slice(0, 6); const cold = byTemp.slice(-6).reverse();
  const windy = [...snap].sort((a, b) => b.cur.wind.speed - a.cur.wind.speed).slice(0, 6);
  const humid = [...snap].sort((a, b) => (b.cur.main.humidity || 0) - (a.cur.main.humidity || 0)).slice(0, 6);
  const body = `<p>Daripada ${snap.length} kota pantauan langsung kami \u2014 senarai disusun daripada bacaan semasa OpenWeather, jadi nilai berubah setiap jam. Ini bukan rekod rasmi dunia (stesen gurun terpencil tidak dipantau di sini), tetapi cermin “dua dunia” iklim planet: kota tropika lembap, kota kontinental sejuk dan litar angin kutub.</p>`
    + `<h2 class="section-title">\uD83D\uDD25 Paling panas sekarang</h2><table class="wx-table"><tr><th>Kota</th><th>Suhu</th></tr>${rowsOf(hot, (c) => `${wxTempC(c.main.temp)} (rasa ${wxTempC(c.main.feels_like)})`)}</table>`
    + `<h2 class="section-title">\uD83E\uDD76 Paling sejuk</h2><table class="wx-table"><tr><th>Kota</th><th>Suhu</th></tr>${rowsOf(cold, (c) => `${wxTempC(c.main.temp)} (rasa ${wxTempC(c.main.feels_like)})`)}</table>`
    + `<h2 class="section-title">\uD83D\uDCA8 Paling berangin</h2><table class="wx-table"><tr><th>Kota</th><th>Angin</th></tr>${rowsOf(windy, (c) => `${wxKmh(c.wind.speed)} km/j \u00b7 Beaufort ${wx.beaufort(wxKmh(c.wind.speed))[0]}`)}</table>`
    + `<h2 class="section-title">\uD83D\uDCA7 Paling lembap</h2><table class="wx-table"><tr><th>Kota</th><th>Kelembapan</th></tr>${rowsOf(humid, (c) => `${Number(c.main.humidity) || 0}%`)}</table>`
    + `<h2 class="section-title">Bacaan silang: mengapa “rasa” berbeza</h2><p>Indeks heat (rasa sebenar) menggabungkan suhu + kelembapan: pada 35\u00b0C dengan 60% kelembapan, tubuh insan terasa seperti 45\u00b0C+ kerana peluh berhenti menyejat \u2014 mekanisme penyejukan semula jadi kita. Sebaliknya angin kencang menurunkan “wind chill” di kota sejuk. Dua sebab itu juga menjelaskan kenapa Kuala Lumpur (33\u00b0C, 60%+) lebih meletihkan daripada Dubai (40\u00b0C, 20%) walaupun nombornya lebih rendah.</p>`
    + `<h2 class="section-title">Rekod sebenar planet</h2><p>Tempat terpanas tercatat di Bumi: Death Valley, AS \u2014 56.7\u00b0C (1913, dipertikaikan) / 54.4\u00b0C (2020-21 diterima). Terdingin: stesen Vostok, Antartika \u2014 \u221289.2\u00b0C (1983). Angin paling kuat terpantau: Barrow Ridge, Antartika, ~400 km/j katabatik. Kota terbesar “terpanas berkembar” lazimnya di zon gurun Arab/Sahara; kota “terlembap” di delta khatulistiwa seperti our own Kuching dan Kolkata.</p>`;
  return cuacaDoc({
    title: 'Ekstrem Cuaca Dunia Sekarang \u2014 Kota Paling Panas & Sejuk | Tukuk-OS',
    desc: 'Susunan langsung kota terpanas, terdingin, berangin dan lembap di seluruh dunia, dikira setiap jam daripada OpenWeather + penjelasan indeks heat & rekod planet.',
    selfUrl: 'https://tukuk.org/cuaca/ekstrem',
    heroTitle: 'Ekstrem Dunia Sekarang', heroSub: `Disusun daripada ${snap.length} kota pantauan \u00b7 kemas kini setiap jam`,
    body,
  });
}

// ——— /cuaca/kod — jadual penuh 55 kod OpenWeather BM (statik, boleh indeks) ———
function cuacaCodesPage(req) {
  const GRUP = [
    [2, 'Ribut petir (2xx)', 'Guruh + kilat; paling berbahaya di tempat terbuka dan dekat air'],
    [3, 'Renyai (3xx)', 'titisan halus < 0.5 mm — nampak ringan tapi boleh licin lama'],
    [5, 'Hujan (5xx)', 'titisan > 0.5 mm; 520\u2013531 = renyai tropika singkat yang kita kenali'],
    [6, 'Salji & beku (6xx)', 'kristal ais, graupel dan hujan beku \u2014 sifar di Malaysia, ngeri di lintang tinggi'],
    [7, 'Atmosfera (7xx)', 'kabus, jerebu, debu, asap \u2014 pengurai jarak nampak, bukan hujan'],
    [8, 'Langit (8xx)', 'skala litupan awan 0\u2013100% \u2014 800 cerah sampai 804 awan penuh'],
  ];
  const sections = GRUP.map(([g, label, nota]) => {
    const rows = wx.OW_CODES.filter((c) => Math.floor(c.id / 100) === g)
      .map((c) => `<tr><td>${c.id}</td><td>${c.emoji}</td><td>${escapeHtml(c.ms)}</td><td>${escapeHtml(c.en)}</td></tr>`).join('');
    return `<h2 class="section-title">${label}</h2><p>${escapeHtml(nota)}</p>`
      + `<table class="wx-table"><tr><th>Kod</th><th>Ikon</th><th>Bahasa Melayu</th><th>English</th></tr>${rows}</table>`;
  }).join('');
  const body = `<p>Setiap bacaan di Kompleks Cuaca kami bermula daripada satu nombor kod keadaan OpenWeather. Ini terjemahan rasminya \u2014 guna untuk memahami API, aplikasi anda, atau sekadar ingin tahu apa beza 802 dengan 804.</p>`
    + sections
    + `<h2 class="section-title">Butiran teknikal</h2><p>Kod dikumpul dalam kumpulan 100 dan setiap kod juga ada deskripsi teks (contoh “light intensity shower rain”). Ikon cuaca OpenWeather (01d\u201350n) mengikuti kod yang sama dengan varian siang (<code>d</code>)/malam (<code>n</code>) \u2014 sebab itu 800 malam dilukis bulan, bukan matahari. Halaman kami menukar kedua-duanya kepada label Melayu + emoji supaya mudah dibaca tanpa log masuk.</p>`
    + `<h2 class="section-title">Lihat kod ini beraksi</h2><p>Nak bandingkan dengan langit sekarang? Buka <a href="/cuaca/peta">peta langsung</a> atau semak <a href="/cuaca">cuaca dunia di kota anda</a> \u2014 setiap halaman kota memaparkan kod aktifnya.</p>`;
  return cuacaDoc({
    title: 'Kod Cuaca OpenWeather \u2014 Maksud Setiap Ikon & Nombor (Bahasa Melayu) | Tukuk-OS',
    desc: 'Senarai penuh 55 kod keadaan OpenWeather dengan terjemahan Bahasa Melayu, emoji dan penjelasan \u2014 daripada ribut petir 2xx sampai awan penuh 804.',
    selfUrl: 'https://tukuk.org/cuaca/kod',
    heroTitle: 'Kamus Kod Cuaca', heroSub: '55 kod OpenWeather \u00b7 EN \u2194 BM \u00b7 ikon & makna',
    body,
  });
}

// ——— /cuaca/awan — panduan 10 jenis awan (statik) ———
function cuacaCloudPage(req) {
  const AWAN = [
    ['Cirrus', 'awan bulu halus tinggi (6\u201313 km)', 'hablur ais; isyarat perubahan cuaca 24\u201348 jam'],
    ['Cirrocumulus', 'corak “skala ikan” kecil tinggi', 'titisan superjuk; cantik bergambar, kadangkala petanda ribut petang'],
    ['Cirrostratus', 'selubung putih tipis, halo bulan/matahari', 'halo = cahaya bias melalui kristal ais; hujan mungkin dalam 12\u201324 jam'],
    ['Altocumulus', 'belon kelabu-sederhana 2\u20137 km', 'stabil pagi, boleh jadi ribut petang tropika'],
    ['Altostratus', 'kelabu rata separuh langit', 'hujan berterusan menghampiri; matahari nampak samar'],
    ['Nimbostratus', 'lapisan tebal kelabam 1\u20134 km', 'hujan/renyai tetap berjam-jam; penutup bumbung terbaik'],
    ['Stratocumulus', 'gumpal rendah bergaris', 'jenis awan paling biasa di dunia; jarang hujan lebat'],
    ['Stratus', 'lapisan rendah = kabus permukaan', 'drizzle halus, jarak nampak rendah'],
    ['Cumulus', 'gobok belon “cuaca baik” 0.5\u20132 km', 'pagi menawan; jika tumbuh tinggi lewat petang → calon ribut'],
    ['Cumulonimbus', 'menara ribut 1\u201315 km, landasan (incus)', 'guruh, kilat, hujan lebat, angin burst dan sesekali hujan batu (hail)'],
  ];
  const rows = AWAN.map((a) => `<tr><td><b>${a[0]}</b></td><td>${escapeHtml(a[1])}</td><td>${escapeHtml(a[2])}</td></tr>`).join('');
  const body = `<p>Klasifikasi awan moden dicipta Luke Howard pada 1803 \u2014 menggunakan Latin: <em>cirrus</em> (keriting), <em>cumulus</em> (bertimbun), <em>stratus</em> (berlapis) dan <em>nimbus</em> (hujan). Sepuluh genus hari ini masih anak kepada empat kata itu. Bila halaman kota kami memaparkan “Litupan awan 62%”, nombor itu gabungan genus-genus ini yang dikesan satelit + model.</p>`
    + `<table class="wx-table"><tr><th>Jenis</th><th>Rupa & ketinggian</th><th>Makna cuaca</th></tr>${rows}</table>`
    + `<h2 class="section-title">Senjang ribut di khatulistiwa</h2><p>Di Malaysia, kitaran harian lebih penting daripada front bermusim: pemanasan tanah pagi → cumulus membengkak tengah hari → cumulonimbus hujan ribut 4\u20137 petang → langit bersih malam. Ini sebab ramalan “hujan petang” hampir selalu tepat di Semenanjung, dan sebab <a href="/cuaca/kuching">cuaca Kuching</a> kami cache cuma 45 minit.</p>`
    + `<h2 class="section-title">Awan & astronomi</h2><p>Pemerhati bintang tahu litupan awan ialah penentu utama: 0% + bulan baru = malam terbaik. Semak <a href="/nasa/sky">Langit Malam Ini</a> untuk fasa bulan, kemudian <a href="/cuaca/peta">peta awan langsung</a> untuk memastikan langit anda benar-benar kosong sebelum memikul teleskop.</p>`;
  return cuacaDoc({
    title: 'Jenis-Jenis Awan \u2014 Panduan Membaca Langit (Cirrus sampai Cumulonimbus) | Tukuk-OS',
    desc: '10 genus awan dijelaskan dalam Bahasa Melayu: rupa, ketinggian dan apa masing-masing isyaratkan tentang cuaca 24 jam akan datang.',
    selfUrl: 'https://tukuk.org/cuaca/awan',
    heroTitle: 'Baca Langit: 10 Jenis Awan', heroSub: 'Klasifikasi Luke Howard 1803 \u00b7 panduan lapangan moden',
    body,
  });
}

// ——— /cuaca/angin — skala Beaufort + monsun (statik) ———
function cuacaWindPage(req) {
  const rows = wx.BEAUFORT.map((b) => `<tr><td>${b[0]}</td><td>${b[1]} km/j</td><td><b>${escapeHtml(b[2])}</b></td><td>${escapeHtml(b[3])}</td></tr>`).join('');
  const body = `<p>Sebelum anemometer tersebar, pelaut mengukur angin dengan mata \u2014 dan skala Beaufort (1805, Francis Beaufort) kekal cara terbaik “meras” nombor km/j. Setiap halaman kota kami memaparkan nombor Beaufort bersebelahan kelajuan angin; ini jadual penuhnya.</p>`
    + `<table class="wx-table"><tr><th>Tahap</th><th>Kelajuan</th><th>Nama</th><th>Cerita di laut & darat</th></tr>${rows}</table>`
    + `<h2 class="section-title">Dua monsun Malaysia</h2><p>Angin di rantau kita bertukak arah dua kali setahun. <b>Monsun Barat Daya</b> (Mei\u2013September) lebih kering di Semenanjung tapi membasahkan Sabah luar pesisir barat; <b>Monsun Timur Laut</b> (November\u2013Mac) menghantar hujan monsun ke pantai timur Semenanjung (Kelantan, Terengganu, Pahang) dan sering membanjiri Kota Bharu &\u00a0Kuantan, sementara KL dan Kuching kekal lebih kering. Angin lemah monsun + asap pembakaran = jerebu (kod 721) \u2014 sebab itu musim Jun\u2013September ialah musim AQI teruk, bukan musim hujan.</p>`
    + `<h2 class="section-title">Bahaya praktikal</h2><p>Beaufort 7+ = sukar menunggang motosikal dalam hujan ribut (daya samping + tayar licin). Beaufort 9+ = larat keluar rumah; pohon tumbang ialah pembunuh №1 ribut di subtropika. Nombor angin semasa di <a href="/cuaca/ekstrem">halaman ekstrem</a> kami sentiasa menunjukkan kota yang sudah mencecah tahap bahaya itu.</p>`
    + `<h2 class="section-title">Arah angin</h2><p>Bacaan “angin 240\u00b0” bermaksud angin <em>datang dari</em> 240\u00b0 (barat daya) \u2014 konvensyen meteorologi yang mengelirukan ramai. Bawah angin (leeward) ialah sisi yang dilindungi; sebab itu hujan orografik turun di sisi windward Sarawak dan kering di sisi lindung (leeward).</p>`;
  return cuacaDoc({
    title: 'Skala Angin Beaufort 0\u201312 & Monsun Malaysia \u2014 Panduan Kelajuan Angin | Tukuk-OS',
    desc: 'Jadual Beaufort penuh dalam Bahasa Melayu + penjelasan monsun barat daya/timur laut, bahaya angin untuk motosikal dan cara baca arah angin meteorologi.',
    selfUrl: 'https://tukuk.org/cuaca/angin',
    heroTitle: 'Angin: Skala Beaufort & Monsun', heroSub: '1805 sampai hari ini \u00b7 daripada angan-angan sampai badai',
    body,
  });
}

// ── TUKUK-OS GEMPA COMPLEX — halaman BM di atas suapan USGS (percuma, tanpa kunci) ──
// Data atas permintaan melalui src/gempa.js (cache 10 minit, gagal → 503 noindex).
// Greda magnitude, jadual terjemah, dan nasihat keselamatan — ceruk carian
// "gempa bumi hari ini" / "gempa sabah" yang pesaing BM-nya sangat sedikit.
const GEMPA_SECTIONS = [
  { href: '/gempa', icon: '\uD83C\uDF0D', name: 'Gempa Bumi Terkini', blurb: 'Senarai langsung gempa seluruh dunia — data USGS, kemas kini setiap 10 minit.' },
  { href: '/gempa/dunia', icon: '\uD83D\uDD2F', name: 'Dunia M4.5+', blurb: 'Semua gempa besar 4.5 ke atas dalam tujuh hari terakhir.' },
  { href: '/gempa/asia-tenggara', icon: '\uD83C\uDF34', name: 'Asia Tenggara', blurb: 'Indonesia, Filipina, PNG — lingkaran tektonik paling aktif di Asia.' },
  { href: '/gempa/jepun', icon: '\uD83D\uDDE5', name: 'Jepun & Pasifik Barat', blurb: 'Cincin Api barat: Jepun, Guam, Kamchatka dan parit Mariana.' },
  { href: '/gempa/pasifik-timur', icon: '\uD83C\uDFE5', name: 'Pasifik Timur', blurb: 'Pantai barat Amerika: California, Chile, Peru, Mexico, Alaska.' },
  { href: '/gempa/malaysia', icon: '\uD83C\uDDF9', name: 'Malaysia & Sabah', blurb: 'Zon Sabah, Sarawak & sempadan — 30 hari terakhir, dari magnitude kecil.' },
  { href: '/gempa/penjelasan', icon: '\uD83D\uDCD8', name: 'Cara Baca Data Gempa', blurb: 'Magnitude, kedalaman, tsunami dan apa perlu buat bila bumi bergegar.' },
];

function gempaNav() {
  return `<nav aria-label="Bahagian gempa"><h2 class="section-title">Jelajahi Kompleks Gempa Tukuk-OS</h2><div class="feed">`
    + GEMPA_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${s.name}</a></h2><p>${s.blurb}</p></div>`).join('')
    + `</div></nav>`;
}

function gempaBusy(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escapeHtml(msg)} | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>${escapeHtml(msg)}</h1><p>Sumber data gempa (USGS) tidak sempat menjawab. Sila cuba lagi beberapa minit.</p><p><a href="/gempa">Kembali ke Kompleks Gempa</a></p></body>`;
}

// Shell sama resipi cuacaDoc: lang ms, 3 slot iklan, nav silang, CSS wx-* digunakan
// semula supaya hab & jadual konsisten merentas kedua-dua kompleks bumi.
function gempaDoc(o) {
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="ms_MY">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
.wx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.wx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21)}
.wx-card h3{margin:0 0 6px;font-size:.88rem;color:var(--muted,#9aa3b2);font-weight:600}
.wx-card .big{font-size:1.4rem;font-weight:700}
.wx-hero{display:flex;gap:22px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:16px 0;background:linear-gradient(135deg,#8a3b12 0%,#3d1a08 100%);color:#fff}
.wx-hero .temp{font-size:2.6rem;font-weight:800;line-height:1}
.wx-hero .wmeta{font-size:.92rem;opacity:.92;line-height:1.5}
.wx-pill{display:inline-block;border-radius:999px;padding:3px 12px;font-weight:700;font-size:.85rem;color:#08121e}
table.wx-table{width:100%;border-collapse:collapse;font-size:.9rem;margin:14px 0}
.wx-table th,.wx-table td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.wx-table th{background:var(--panel,#171a21)}
@media(max-width:680px){.wx-grid{grid-template-columns:1fr}.wx-hero .temp{font-size:2rem}table.wx-table{display:block;overflow-x:auto}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('gempa')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${gempaNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

// ——— Utiliti paparan: masa MYT (UTC+8), cip magnitude, jadual ———
function gpWhen(t) {
  const p = wxParts(Math.floor(t / 1000), 8 * 3600);
  return `${WX_DAYS[p.wday]} ${p.day} ${WX_MONTHS[p.mon].slice(0, 3)} ${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}`;
}
function gpChip(m) {
  const bg = m >= 6 ? '#c0392b' : m >= 5 ? '#e67e22' : m >= 4 ? '#2980b9' : '#7f8c8d';
  return `<span class="wx-pill" style="background:${bg};color:#fff">M ${Number(m).toFixed(1)}</span>`;
}
function gpTable(rows, n) {
  if (!rows || !rows.length) return '<p>Belum ada rekod dalam tempoh ini.</p>';
  return `<table class="wx-table"><tr><th>Bila (UTC+8)</th><th>Kuasa</th><th>Lokasi</th><th>Kedalaman</th><th>Maklum balas</th></tr>`
    + rows.slice(0, n || rows.length).map((q) => `<tr><td>${gpWhen(q.time)}</td><td>${gpChip(q.mag)}</td>`
      + `<td><a href="${escapeHtml(q.url)}" target="_blank" rel="noopener">${escapeHtml(q.place)}</a>${q.tsunami ? ' <b style="color:#e5534b">\u26A0 potensi tsunami</b>' : ''}${q.status === 'reviewed' ? ' <span class="meta">(disemak)</span>' : ''}</td>`
      + `<td>${q.depth} km</td><td>${q.felt ? `${q.felt} laporan terasa` : (q.cdi ? `skala rasa ${q.cdi}` : '\u2014')}</td></tr>`).join('')
    + '</table>';
}
function gpStatCards(rows, my) {
  const s = gp.summarise(rows);
  return `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Gempa M4.5+ (7 hari)</h3><div class="big">${s.count}</div><div class="meta">di seluruh dunia</div></div>`
    + `<div class="wx-card"><h3>Paling kuat</h3><div class="big">M ${s.max.toFixed(1)}</div><div class="meta">${s.latest ? escapeHtml(s.latest.place) : '\u2014'}</div></div>`
    + `<div class="wx-card"><h3>Gempa terdekat Malaysia</h3><div class="big">${my ? my.length : 0}</div><div class="meta">30 hari terakhir, semua magnitud</div></div>`
    + `</div>`;
}

// ——— HAB /gempa — dunia ringkas + Malaysia penuh + kad wilayah ———
function gempaHubPage(req, rows, myRows) {
  const s = gp.summarise(rows);
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Kompleks Gempa Tukuk-OS',
    description: 'Senarai langsung gempa bumi seluruh dunia dan rantau Asia Tenggara daripada Survei Geologi AS (USGS).',
    url: 'https://tukuk.org/gempa', isPartOf: { '@type': 'WebSite', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  const regionCards = gp.REGIONS.map((r) => `<div class="wx-card"><h3><a href="/gempa/${r.slug}">${escapeHtml(r.name)}</a></h3><div class="meta">${escapeHtml(r.blurb)}</div></div>`).join('');
  const body = `<div class="wx-hero"><div class="temp">M ${s.max.toFixed(1)}</div><div class="wmeta">`
    + `Gempa paling kuat seminggu terakhir \u00b7 ${escapeHtml(s.latest ? s.latest.place : '')}<br>`
    + `${s.latest ? gpWhen(s.latest.time) + ' \u00b7 kedalaman ' + s.latest.depth + ' km' : ''} \u00b7 sumber: Survei Geologi Amerika Syarikat (USGS), data awam.</div></div>`
    + gpStatCards(rows, myRows)
    + `<h2 class="section-title">Sepuluh gempa terbaharu (M4.5+ dunia)</h2>${gpTable(rows, 10)}`
    + `<h2 class="section-title">Gempa di sekitar Malaysia (30 hari)</h2>${gpTable(myRows, 20)}`
    + `<p>Malaysia bukan di bawah Cincin Api, tetapi tidak bebas gegaran: zon seismik Sabah timur (runtuhan Lingkabau, Pitas dan Kota Belud) aktif dan pernah menggegarkan Gunung Kinabalu pada Jun 2015 (M6.0, 181 nyawa di pendakian), manakala gempa besar di Sumatera kerap terasa di Lembah Klang dan Pulau Pinang kerana tanah lembut mengampifikasi gelombang.</p>`
    + `<h2 class="section-title">Rantau pemantauan</h2><div class="wx-grid">${regionCards}</div>`
    + `<p class="meta">Baru nak fahami angka? Baca <a href="/gempa/penjelasan">cara baca data gempa</a>. Untuk cuaca semasa di lokasi anda, guna <a href="/cuaca">Kompleks Cuaca</a>; untuk langit malam, <a href="/nasa/sky">Langit Malam NASA</a>; profil negara tempat gempa berlaku? <a href="/negara">Kompleks Negara</a>.</p>`;
  return gempaDoc({
    title: 'Gempa Bumi Hari Ini — Senarai Langsung Seluruh Dunia | Tukuk-OS',
    desc: 'Semak gempa bumi terkini secara langsung merentasi dunia: magnitude, lokasi, kedalaman dan potensi tsunami daripada data awam USGS — kemas kini setiap 10 minit, dengan pemantauan khas Asia Tenggara, Jepun, Pasifik dan zon Sabah.',
    selfUrl: 'https://tukuk.org/gempa',
    heroTitle: 'Kompleks Gempa Tukuk-OS', heroSub: 'Data langsung USGS \u00b7 kemas kini 10 minit \u00b7 percuma tanpa log masuk',
    body, ld,
  });
}

// ——— Halaman wilayah ———
function gempaRegionPage(req, region, rows) {
  const s = gp.summarise(rows);
  const selfUrl = `https://tukuk.org/gempa/${region.slug}`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Gempa Bumi Terkini: ${region.name}`,
    description: region.blurb, url: selfUrl,
  }).replace(/</g, '\\u003c');
  const body = `<p>${escapeHtml(region.blurb)} Data dikemas kini setiap 10 minit daripada Survei Geologi AS (USGS); masa dipaparkan dalam UTC+8.</p>`
    + `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Jumlah dalam tempoh</h3><div class="big">${s.count}</div><div class="meta">magnitud minimum ${region.minMag.toFixed(1)}</div></div>`
    + `<div class="wx-card"><h3>Paling kuat</h3><div class="big">M ${s.max.toFixed(1)}</div><div class="meta">${s.latest ? escapeHtml(s.latest.place) : '\u2014'}</div></div>`
    + `<div class="wx-card"><h3>Dangkal (&lt;35 km)</h3><div class="big">${s.shallow}</div><div class="meta">gempa dangkal paling terasa di permukaan</div></div></div>`
    + gpTable(rows, 50)
    + (s.felt ? `<p><b>${s.felt}</b> daripada gempa tersenarai mempunyai laporan manusia yang merasakannya (butiran felt di USGS).</p>` : '')
    + `<h2 class="section-title">Apa perlu buat bila bumi bergegar</h2><p><b>Reda \u2014 Lindungi \u2014 Tahan</b>: menjatuhkan diri ke lantai, berlindung di bawah meja kukuh dan tahan sehingga gegaran berhenti. Jangan berlari ketika gegaran masih ada; jangan guna lif; selepas itu periksa wayar, paip gas dan amaran susulan. Panduan penuh dalam <a href="/gempa/penjelasan">halaman penjelasan</a>.</p>`
    + `<p class="meta">Lihat juga: <a href="/gempa">hab gempa dunia</a> \u00b7 <a href="/gempa/malaysia">zon Malaysia</a> \u00b7 <a href="/cuaca">cuaca semasa</a> \u00b7 <a href="/cuti">jadual cuti umum</a>.</p>`;
  return gempaDoc({
    title: `Gempa Bumi Terkini di ${region.name} — Magnitud, Lokasi & Kedalaman | Tukuk-OS`,
    desc: `Senarai langsung gempa ${region.name}: magnitud, kedalaman, lokasi dan laporan terasa — data USGS kemas kini setiap 10 minit, masa dalam Waktu Malaysia.`,
    selfUrl,
    heroTitle: `Gempa di ${region.name}`, heroSub: `Suapan langsung USGS \u00b7 ${s.count} rekod dalam tempoh pemantauan`,
    body, ld,
  });
}

// ——— Halaman penjelasan (statik, pendidikan) ———
function gempaExplainPage(req) {
  const magRows = [
    ['< 2.5', 'mikro', 'hanya alat seismograf dapat mengesan'],
    ['2.5 – 5.0', 'ringan', 'kerap terasa berhampiran pusat; kerosakan kecil'],
    ['5.0 – 6.0', 'sederhana', 'kerosakan serius di kawasan berpenduduk; Sabah 2015 = 6.0'],
    ['6.0 – 7.0', 'kuat', 'kemusnahan meluas dalam radius ~100 km'],
    ['7.0 – 8.0', 'besar', 'kemusnahan di kawasan luas; gempa Laut Sulawesi 2018 = 7.5 + likuifaksi + tsunami'],
    ['> 8.0', 'dahsyat', 'melintasi seluruh rantaian gunung berapi; Aceh 2004 = 9.1, tsunami merentasi samudera'],
  ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  const body = `<p>Setiap baris di <a href="/gempa">kompleks gempa</a> kami berasal daripada Survei Geologi AS (USGS), agensi sains awam yang merakam >20,000 gempa setahun dengan rangkaian seismograf global. Ini yang perlu anda tahu untuk membacanya.</p>`
    + `<h2 class="section-title">Magnitude: skala logaritma</h2><p>Setiap kenaikan 1 magnitud bermakna <b>10× amplitud</b> dan <b>~32× tenaga</b>. Gempa M6.0 melepaskan tenaga kira-kira 32 kali ganda M5.0 — sebab itu beza "6.1" dan "5.4" dalam berita bukan calang-calang.</p>`
    + `<table class="wx-table"><tr><th>Magnitud</th><th>Kelas</th><th>Kesan tipikal</th></tr>${magRows}</table>`
    + `<h2 class="section-title">Kedalaman: faktor penentu rasa</h2><p>Gempa 10 km jauh lebih terasa di permukaan daripada gempa 200 km yang bermagnitud sama. Zon Sabah biasanya dangkal (<20 km) sebab itu gegaran kecil pun dirasakan di Kota Kinabalu. Gempa dalam (>300 km) di bawah Laut Filipina pula jarang memudaratkan walaupun magnitudnya besar.</p>`
    + `<h2 class="section-title">Mengapa Sabah bergegar tetapi KL biasanya tidak</h2><p>Borneo duduk di atas plat Sunda yang agak stabil, tetapi tepi timurnya dihimpit plat Sulu dan Laut Filipina — lahirlah runtuhan aktif Lingkabau, Pitas dan Tambon. Semenanjung berada pada "litar belakang": kebanyakan gegaran yang dilaporkan di Klang atau Penang adalah gelombang jauh dari Sumatera yang diperkuat lapisan tanah lembut dan bangunan tinggi.</p>`
    + `<h2 class="section-title">Tsunami: bila amaran perlu serius</h2><p>Tanda amaran tsunami = gempa M7+ di zon sesaran laut dengan kedalaman &lt;30 km. Di Malaysia, pantai barat Sabah dan timur Sarawak paling terdedah kepada laut Sulawesi. Jika gegaran di tepi pantai bertahan lebih 20 saat, terus bergerak ke darat tinggi — jangan menunggu siren rasmi.</p>`
    + `<h2 class="section-title">Protokol emas: Reda, Lindungi, Tahan</h2><ul><li><b>Reda</b> — jatuhkan diri ke tangan dan lutut sebelum gegaran melemparkan anda.</li><li><b>Lindungi</b> — merangkak bawah meja; lindungi kepala & leher. Tiada meja? Di sudut dalaman, jauh dari cermin.</li><li><b>Tahan</b> — pegang tempat hingga gegaran berhenti; bergerak semasa bumi masih bergegar adalah punca kecederaan paling biasa.</li></ul>`
    + `<p class="meta">Untuk amaran rasmi Malaysia, rujuk Jabatan Meteorologi Malaysia (met.gov.my) dan Majlis Keselamatan Negara. Halaman ini untuk pendidikan & rujukan pantas — data mentah sentiasa di USGS. Semak juga <a href="/cuaca">Kompleks Cuaca</a> untuk keadaan langit semasa.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article', name: 'Cara Baca Data Gempa Bumi',
    description: 'Penjelasan Bahasa Melayu: magnitud, kedalaman, tsunami dan protokol Reda-Lindungi-Tahan.',
    url: 'https://tukuk.org/gempa/penjelasan', inLanguage: 'ms', publisher: { '@type': 'Organization', name: 'Tukuk-OS' },
  }).replace(/</g, '\\u003c');
  return gempaDoc({
    title: 'Cara Baca Data Gempa Bumi — Magnitud, Kedalaman & Tsunami | Tukuk-OS',
    desc: 'Fahami skala magnitud (setiap 1 = 32× tenaga), kedalaman, potensi tsunami dan protokol Reda-Lindungi-Tahan — penjelasan Bahasa Melayu untuk konteks Malaysia.',
    selfUrl: 'https://tukuk.org/gempa/penjelasan',
    heroTitle: 'Cara Baca Data Gempa', heroSub: 'Daripada angka seismograf hingga keputusan selamat dalam 60 saat',
    body, ld,
  });
}

// ── TUKUK-OS CUTI COMPLEX — kalendar cuti umum DUNIA (Nager.Date) + jadual MY ──
// Sumber dunia: Nager.Date v3 (open data, tanpa kunci) — senarai negara disokong, cache 30 hari.
// Sumber Malaysia: malaysia-holiday.dydxsoft.my (disemak admin terhadap dokumen
// rasmi kabinet.gov.my; 13 negeri + 3 wilayah). Kegagalan sumber → 503 noindex.
const CUTI_SECTIONS = [
  { href: '/cuti', icon: '\uD83D\uDDD3\uFE0F', name: 'Cuti Umum Dunia 2026', blurb: `Kalendar ${cd.COUNTRIES.length} buah negara — ranking paling banyak cuti, cuti terdekat sedunia dan jadual penuh setiap negara.` },
];
for (const rg of cd.REGIONS) CUTI_SECTIONS.push({ href: `/cuti/dunia/${rg.slug}`, icon: '\uD83C\uDF0E', name: `Cuti ${rg.bm} 2026`, blurb: `Senarai negara, jumlah kelepasan am dan cuti seterusnya di benua ${rg.bm}.` });
CUTI_SECTIONS.push({ href: '/cuti/hujung-minggu-panjang', icon: '\uD83C\uDFD6\uFE0F', name: 'Hujung Minggu Panjang Dunia', blurb: 'Gabungan cuti + hujung minggu 4 hari atau lebih di seluruh planet — dan bila 1 hari jambatan diperlukan.' });
CUTI_SECTIONS.push({ href: '/cuti/2026', icon: '\uD83D\uDCC5', name: 'Cuti Malaysia 2026', blurb: 'Jadual penuh 13 negeri + 3 wilayah, disemak terhadap dokumen rasmi kabinet.gov.my.' });
CUTI_SECTIONS.push({ href: '/cuti/2027', icon: '\uD83D\uDCC6', name: 'Cuti Malaysia 2027', blurb: 'Pelan awal percutian tahun hadapan — semua tarikh gazet yang diketahui.' });
CUTI_SECTIONS.push({ href: '/cuti/penjelasan', icon: '\uD83D\uDCD8', name: 'Cara Kalendar Cuti Berfungsi', blurb: 'Kalendar bulan, perayaan bergerak, prinsip ganti hari dan strategi cuti jambatan.' });

function cutiNav() {
  return `<nav aria-label="Bahagian cuti"><h2 class="section-title">Jelajahi Kompleks Cuti Dunia Tukuk-OS</h2><div class="feed">`
    + CUTI_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${s.name}</a></h2><p>${s.blurb}</p></div>`).join('')
    + `</div></nav>`;
}

function cutiBusy(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escapeHtml(msg)} | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>${escapeHtml(msg)}</h1><p>Sumber jadual cuti tidak sempat menjawab. Sila cuba lagi sebentar.</p><p><a href="/cuti">Kembali ke Kompleks Cuti</a></p></body>`;
}

// Shell sama resepi gempaDoc: lang ms, 3 slot iklan, nav silang, CSS wx-* dipakai
// semula; hero hijau-pesta bezakan kompleks cuti daripada cuaca/gempa.
function cutiDoc(o) {
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="ms_MY">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
.wx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.wx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21)}
.wx-card h3{margin:0 0 6px;font-size:.88rem;color:var(--muted,#9aa3b2);font-weight:600}
.wx-card .big{font-size:1.4rem;font-weight:700}
.wx-hero{display:flex;gap:22px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:16px 0;background:linear-gradient(135deg,#0e5b3a 0%,#06281b 100%);color:#fff}
.wx-hero .temp{font-size:2.2rem;font-weight:800;line-height:1.1}
.wx-hero .wmeta{font-size:.92rem;opacity:.92;line-height:1.5}
.wx-pill{display:inline-block;border-radius:999px;padding:3px 12px;font-weight:700;font-size:.85rem;color:#08121e}
table.wx-table{width:100%;border-collapse:collapse;font-size:.9rem;margin:14px 0}
.wx-table th,.wx-table td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.wx-table th{background:var(--panel,#171a21)}
.ct-fl{height:13px;width:20px;vertical-align:-2px;border-radius:2px;margin-right:7px;border:1px solid var(--line);display:inline-block}
@media(max-width:680px){.wx-grid{grid-template-columns:1fr}.wx-hero .temp{font-size:1.7rem}table.wx-table{display:block;overflow-x:auto}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('cuti')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${cutiNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

// ——— Utiliti paparan: tarikh BM penuh, ringkas, badge negeri ———
const CT_DATE_FMT = new Intl.DateTimeFormat('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const CT_SHORT_FMT = new Intl.DateTimeFormat('ms-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function ctDateFr(dateStr) { return CT_DATE_FMT.format(new Date(`${dateStr}T00:00:00Z`)); }
function ctShort(dateStr) { return CT_SHORT_FMT.format(new Date(`${dateStr}T00:00:00Z`)); }
function ctBadge(r) {
  if (!Array.isArray(r.state_codes)) return '<span class="wx-pill" style="background:#4c8dff;color:#fff">Persekutuan &amp; negeri</span>';
  if (r.state_codes.length >= 14) return '<span class="wx-pill" style="background:#4c8dff;color:#fff">Kebanyakan negeri</span>';
  const names = r.state_codes.map((c) => { const st = cu.STATES.find((x) => x.code === c); return st ? st.name : c; });
  return `<span class="wx-pill" style="background:#2f9e63;color:#fff">${escapeHtml(names.join(', '))}</span>`;
}
function ctTable(rows, n) {
  if (!rows || !rows.length) return '<p>Belum ada rekod cuti untuk tahun ini.</p>';
  return `<table class="wx-table"><tr><th>Tarikh</th><th>Hari</th><th>Perayaan</th><th>Negeri</th></tr>`
    + rows.slice(0, n || rows.length).map((r) => `<tr><td><b>${r.date}</b></td><td>${escapeHtml(ctDateFr(r.date).split(',')[0])}</td>`
      + `<td>${escapeHtml(r.name)}${r.is_subject_to_change ? ' <span class="meta">(tertakluk perubahan)</span>' : ''}</td><td>${ctBadge(r)}</td></tr>`).join('')
    + '</table>';
}
function ctLwHtml(list) {
  if (!list.length) return '<p>Tiada gabungan hujung minggu panjang yang pasti dalam tahun ini.</p>';
  return `<table class="wx-table"><tr><th>Tempoh</th><th>Jumlah hari</th><th>Cuti berkaitan</th><th>Keperluan</th></tr>`
    + list.map((w) => `<tr><td>${escapeHtml(ctShort(w.start))} – ${escapeHtml(ctShort(w.end))}</td><td><b>${w.spanDays} hari</b></td>`
      + `<td>${escapeHtml(w.holidays.map((h) => h.name).join(' + '))}</td>`
      + `<td>${w.auto ? '<span class="wx-pill" style="background:#2f9e63;color:#fff">Automatik</span>' : '<span class="wx-pill" style="background:#e67e22;color:#fff">1 hari cuti rehat</span>'}</td></tr>`).join('')
    + '</table>';
}

// ——— Utiliti paparan DUNIA (baris Nager.Date): nama BM, bendera, hari, jadual ———
const CT_DOW = new Intl.DateTimeFormat('ms-MY', { weekday: 'long', timeZone: 'UTC' });
const CT_WORLD_YEAR = 2026;
function ctDay(dateStr) { try { return CT_DOW.format(new Date(`${dateStr}T00:00:00Z`)); } catch { return ''; } }
function ctFlag(cca2) { return `https://flagcdn.com/w40/${String(cca2 || '').toLowerCase()}.png`; }
function ctBm(byCca2, rec) { const c = byCca2 && byCca2.get ? byCca2.get(rec.cca2) : null; return c && c.bm ? c.bm : rec.en; }
function ctRegionBm(region) { const r = cd.REGIONS.find((x) => x.en === region); return r ? r.bm : String(region || ''); }
function ctCutiHref(rec) { return `/cuti/dunia/${rec.slug}`; }
function ctNation(byCca2, rec) {
  return `<img class="ct-fl" src="${ctFlag(rec.cca2)}" alt="" width="20" height="13" loading="lazy" decoding="async">`
    + `<a href="${ctCutiHref(rec)}"><b>${escapeHtml(ctBm(byCca2, rec))}</b></a>`;
}
function ctNext(holidays, today) {
  return (holidays || []).filter((h) => String(h.date) > today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}
function ctWorldTable(holidays) {
  if (!Array.isArray(holidays) || !holidays.length) return '<p>Belum ada rekod cuti untuk tahun ini.</p>';
  const rows = [...holidays].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((h) => {
    const local = String(h.localName || h.name || '');
    const en = String(h.name || '');
    const scope = h.global
      ? '<span class="wx-pill" style="background:#4c8dff;color:#fff">Seluruh negara</span>'
      : `<span class="wx-pill" style="background:#2f9e63;color:#fff">${escapeHtml(Array.isArray(h.counties) && h.counties.length ? `Negeri/wilayah (${h.counties.length})` : 'Sebahagian negara')}</span>`;
    return `<tr><td><b>${escapeHtml(String(h.date))}</b></td><td>${escapeHtml(ctDay(h.date))}</td>`
      + `<td>${escapeHtml(local)}${en && en !== local ? ` <span class="meta">(${escapeHtml(en)})</span>` : ''}</td>`
      + `<td>${scope}</td><td class="meta">${escapeHtml((h.types || []).join(', '))}</td></tr>`;
  }).join('');
  return `<table class="wx-table"><tr><th>Tarikh</th><th>Hari</th><th>Perayaan</th><th>Skop</th><th>Jenis</th></tr>${rows}</table>`;
}
function ctWorldLwTable(list) {
  if (!Array.isArray(list) || !list.length) return '<p>Tiada gabungan hujung minggu panjang dilaporkan untuk tahun ini.</p>';
  return `<table class="wx-table"><tr><th>Tempoh</th><th>Bermula</th><th>Jumlah hari</th><th>Cuti jambatan</th></tr>`
    + list.map((w) => `<tr><td><b>${escapeHtml(ctShort(w.start))} \u2013 ${escapeHtml(ctShort(w.end))}</b></td>`
      + `<td>${escapeHtml(ctDay(w.start))}</td><td><b>${w.dayCount} hari</b></td>`
      + `<td>${w.needBridge ? `<span class="wx-pill" style="background:#e67e22;color:#fff">${escapeHtml((w.bridgeDays || []).join(', ') || '1 hari')}</span>` : '<span class="wx-pill" style="background:#2f9e63;color:#fff">Automatik</span>'}</td></tr>`).join('')
    + '</table>';
}
// Penulisan ringkas setiap benua — supaya halaman rantau bukan sekadar jadual.
const CT_REGION_NOTES = {
  asia: 'Asia ialah benua kalendar paling rumit: takwim surya (1 Januari), takwim bulan Islam (Aidilfitri & Aidiladha bergerak ±11 hari setiap tahun), takwim lunisolar (Tahun Baharu Cina, Vesak, Deepavali) dan takwim kerja (1 Mei) semuanya hidup serentak. Sebab itu negara seperti Indonesia, Malaysia, Singapura dan India menyenaraikan 15–20 kelepasan setahun, dan cuti besar sering diiringi cuti ganti apabila jatuh pada hujung minggu.',
  europe: 'Eropah bertapak pada takwim surya dengan lapisan Kristian: Good Friday, Easter Monday, Ascension dan Whit Monday bergerak mengikut Easter — bulan penuh pertama selepas ekuinoks. Kebanyakan negara Eropah Barat memberikan 10–14 cuti umum, tetapi yang menarik ialah cuti tempatan: negeri menambah hari keputeraan raja, santo pelindung atau hari penaklukan, jadi jadual Sepanyol dan Switzerland berbeza dari kota ke kota.',
  americas: 'Amerika Latin paling padat dengan perayaan Katolik bercampur hari kebangsaan: Semana Santa, hari kemerdekaan (rangkaian 1810–1826) dan hari adat pribumi (Inti Raymi, Día de los Muertos). Negara berbahasa Inggeris lebih «hemat»: Amerika Syarikat mempunyai 11 cuti persekutuan dan Kanada 5–9 cuti statutori mengikut wilayah, dengan tabiat memindahkan cuti ke Isnin terdekat (Memorial Day, Labour Day) supaya terbentuk hujung minggu panjang.',
  africa: 'Afrika mencampur takwim surya, Islam, Kristian dan hari kemerdekaan. Afrika Selatan ialah contoh klasik dasar ganti hari: jika cuti jatuh pada Ahad, Isnin berikutnya diganti. Nigeria dan Kenya menambah kelepasan negeri, manakala Ethiopia berjalan pada takwim sendiri (13 bulan) dengan perayaan seperti Enkutatash dan Timkat yang tidak sepadan dengan tarikh negara jiran.',
  oceania: 'Oseania kecil bilangannya tetapi luas geografinya: Australia menganut cuti negeri — hari yang sama boleh berbeza nama dan tarikh antara New South Wales dan Western Australia. New Zealand memindahkan cuti utama ke Isnin (King\'s Birthday, Labour Day) dan mempunyai minggu Waitangi sendiri. Negara pulau Pasifik banyak menyenaraikan hari adat dan hari pembebasan tempatan.',
};

// ——— HAB /cuti — DUNIA: ranking negara, cuti terdekat, rantau, seksyen MY ———
function cutiHubPage(req, world, rows) {
  const byCca2 = new Map((rows || []).map((c) => [c.cca2, c]));
  const rank = cd.worldRanking(world);
  const tot = cd.worldTotals(world);
  const yr = CT_WORLD_YEAR;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = cd.worldUpcoming(world, 60, today);
  const first = upcoming.length ? upcoming[0] : null;
  const sameDay = first ? upcoming.filter((u) => u.date === first.date) : [];
  const left = first ? Math.round((Date.parse(`${first.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : 0;
  const hero = first
    ? `<div class="wx-hero"><div class="temp">${escapeHtml(first.name)}</div><div class="wmeta">${escapeHtml(ctDateFr(first.date))}<br>`
      + `${sameDay.length} negara meraikan serentak \u00b7 ${left} hari lagi dari hari ini`
      + (sameDay.length ? ` \u00b7 ${escapeHtml(sameDay.slice(0, 8).map((u) => ctBm(byCca2, u)).join(', '))}${sameDay.length > 8 ? ' dll.' : ''}` : '')
      + '</div></div>'
    : '<p>Tiada cuti dunia dalam liputan data pada ketika ini.</p>';
  const cards = `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Negara berdata ${yr}</h3><div class="big">${tot.countries}</div><div class="meta">daripada ${cd.COUNTRIES.length} buah negara dalam liputan</div></div>`
    + `<div class="wx-card"><h3>Jumlah cuti umum ${yr}</h3><div class="big">${tot.total}</div><div class="meta">kelepasan direkodkan di seluruh planet</div></div>`
    + `<div class="wx-card"><h3>Purata setiap negara</h3><div class="big">${tot.avg.toFixed(1)}</div><div class="meta">cuti setahun${rank.length ? ` \u00b7 tertinggi ${escapeHtml(ctBm(byCca2, rank[0]))} (${rank[0].count})` : ''}</div></div>`
    + `</div>`;
  const rankRows = rank.map((r, i) => `<tr><td>${i + 1}</td><td>${ctNation(byCca2, r)}</td>`
    + `<td>${escapeHtml(ctRegionBm(r.region))}</td><td><b>${r.count}</b></td><td>${r.globals}</td></tr>`).join('');
  const upRows = upcoming.slice(0, 30).map((u) => `<tr><td><b>${escapeHtml(u.date)}</b></td><td>${escapeHtml(ctDay(u.date))}</td>`
    + `<td>${escapeHtml(u.name)}${u.nameEn && u.nameEn !== u.name ? ` <span class="meta">(${escapeHtml(u.nameEn)})</span>` : ''}</td>`
    + `<td>${ctNation(byCca2, u)}</td></tr>`).join('');
  const regionCards = cd.REGIONS.map((r) => {
    const list = cd.inRegion(world, r.slug).filter((x) => Array.isArray(x.holidays) && x.holidays.length);
    const sum = list.reduce((s, x) => s + x.holidays.length, 0);
    return `<div class="wx-card"><h3><a href="/cuti/dunia/${r.slug}">Cuti ${escapeHtml(r.bm)}</a></h3><div class="big">${list.length}</div><div class="meta">negara berdata \u00b7 ${sum} cuti ${yr}</div></div>`;
  }).join('');
  const stateCards = cu.STATES.map((st) => `<div class="wx-card"><h3><a href="/cuti/${st.slug}">${escapeHtml(st.name)}</a></h3><div class="meta">Hujung minggu ${escapeHtml(st.weekend)} \u00b7 jadual ${cu.YEAR_MIN} &amp; ${cu.YEAR_MAX}</div></div>`).join('');
  const body = hero
    + cards
    + `<h2 class="section-title">Negara paling banyak cuti ${yr}</h2><p>Semua ${tot.countries} negara dalam liputan, disusun dari paling banyak kelepasan am. Klik mana-mana negara untuk jadual tarikh penuh.</p>`
    + `<table class="wx-table"><tr><th>#</th><th>Negara</th><th>Benua</th><th>Jumlah cuti</th><th>Seluruh negara</th></tr>${rankRows}</table>`
    + `<h2 class="section-title">Cuti sedunia 60 hari akan datang</h2>`
    + (upRows ? `<table class="wx-table"><tr><th>Tarikh</th><th>Hari</th><th>Perayaan</th><th>Negara</th></tr>${upRows}</table>` : '<p>Belum ada cuti dalam tingkap 60 hari akan datang.</p>')
    + `<h2 class="section-title">Jelajahi ikut benua</h2><div class="wx-grid">${regionCards}</div>`
    + `<h2 class="section-title">Mengapa kalendar cuti dunia berbeza begitu jauh</h2>`
    + `<p>Ada empat punca utama. <b>Pertama</b>, takwim yang berlainan: negara majoriti Islam mengira Aidilfitri &amp; Aidiladha secara bulan (bergerak ±11 hari setiap tahun), India dan Asia Timur ikut takwim lunisolar, manakala dunia Barat ikut takwim surya dengan lapisan hari raya Kristian yang bergerak mengikut Easter. <b>Kedua</b>, dasar ganti hari: United Kingdom, Australia, Afrika Selatan dan Amerika Syarikat memindahkan cuti yang jatuh pada hujung minggu ke hari kerja terdekat, sementara banyak negara Asia membiarkannya «hilang». <b>Ketiga</b>, cuti tempatan: Sepanyol, Switzerland dan India mempunyai kelepasan negeri/munisipal yang tidak sama antara satu sama lain. <b>Keempat</b>, sejarah politik: negara yang meraih kemerdekaan pada abad ke-20 menandakan hari kemerdekaan, manakala Eropah Barat lebih banyak cuti keagamaan dan hari buruh.</p>`
    + `<h2 class="section-title">Malaysia — jadual penuh ikut negeri</h2><p>Untuk pembaca yang merancang cuti di tanah air, jadual <b>${cu.YEAR_MIN} &amp; ${cu.YEAR_MAX}</b> kami semak terhadap dokumen rasmi kabinet.gov.my dan dipecahkan mengikut 13 negeri + 3 wilayah persekutuan, termasuk beza hujung minggu Jumaat\u2013Sabtu (Johor, Kedah, Kelantan, Terengganu) dan prinsip ganti hari.</p>`
    + `<p><a href="/cuti/2026">Cuti Malaysia ${cu.YEAR_MIN}</a> \u00b7 <a href="/cuti/2027">Cuti Malaysia ${cu.YEAR_MAX}</a> \u00b7 <a href="/cuti/hujung-minggu-panjang">Hujung minggu panjang</a> \u00b7 <a href="/cuti/penjelasan">Cara kalendar cuti berfungsi</a></p>`
    + `<div class="wx-grid">${stateCards}</div>`
    + `<p class="meta">Sumber dunia: <a href="https://date.nager.at" rel="noopener nofollow">Nager.Date</a> (data terbuka, tanpa kunci). Rancang perjalanan ikut langit destinasi di <a href="/cuaca">Kompleks Cuaca</a>; kenal negara terlebih dahulu di <a href="/negara">Kompleks Negara</a>; bandingkan sosioekonomi di <a href="/statistik">Kompleks Statistik</a>; bencana langsung di <a href="/bencana">Kompleks Bencana</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Kompleks Cuti Dunia Tukuk-OS',
    description: `Kalendar cuti umum ${yr} untuk ${tot.countries} buah negara: ranking paling banyak kelepasan, cuti terdekat sedunia dan jadual penuh setiap negara.`,
    url: 'https://tukuk.org/cuti', inLanguage: 'ms',
    isPartOf: { '@type': 'WebSite', name: 'Tukuk-OS', url: 'https://tukuk.org' },
    temporalCoverage: String(yr),
  }).replace(/</g, '\\u003c');
  return cutiDoc({
    title: `Cuti Umum Dunia ${yr} \u2014 Kalendar ${cd.COUNTRIES.length} Negara & Ranking | Tukuk-OS`,
    desc: `Kalendar cuti umum ${yr} untuk ${cd.COUNTRIES.length} buah negara: ranking negara paling banyak kelepasan, cuti sedunia terdekat, gabungan hujung minggu panjang dan jadual tarikh penuh setiap negara.`,
    selfUrl: 'https://tukuk.org/cuti',
    heroTitle: 'Kompleks Cuti Dunia Tukuk-OS', heroSub: `Kalendar kelepasan am ${cd.COUNTRIES.length} negara \u00b7 sumber data terbuka Nager.Date \u00b7 percuma`,
    body, ld,
  });
}

// ——— /cuti/dunia/:rantau — indeks negara dalam satu benua ———
function cutiRegionPage(req, region, world, rows) {
  const byCca2 = new Map((rows || []).map((c) => [c.cca2, c]));
  const yr = CT_WORLD_YEAR;
  const all = cd.inRegion(world, region.slug);
  const list = all.filter((r) => Array.isArray(r.holidays) && r.holidays.length)
    .sort((a, b) => String(a.en).localeCompare(String(b.en)));
  const nodata = all.filter((r) => !Array.isArray(r.holidays) || !r.holidays.length);
  const today = new Date().toISOString().slice(0, 10);
  const total = list.reduce((s, r) => s + r.holidays.length, 0);
  const top = [...list].sort((a, b) => b.holidays.length - a.holidays.length)[0] || null;
  const rowsHtml = list.map((r) => {
    const nxt = ctNext(r.holidays, today);
    return `<tr><td>${ctNation(byCca2, r)}</td><td><b>${r.holidays.length}</b></td>`
      + `<td>${nxt ? `${escapeHtml(nxt.name)} \u00b7 ${escapeHtml(ctShort(nxt.date))}` : '<span class="meta">tahun selesai</span>'}</td></tr>`;
  }).join('');
  const cards = `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Negara berdata</h3><div class="big">${list.length}</div><div class="meta">dalam benua ${escapeHtml(region.bm)}${nodata.length ? ` \u00b7 ${nodata.length} belum tersedia` : ''}</div></div>`
    + `<div class="wx-card"><h3>Jumlah cuti ${yr}</h3><div class="big">${total}</div><div class="meta">purata ${(list.length ? total / list.length : 0).toFixed(1)} cuti setiap negara</div></div>`
    + `<div class="wx-card"><h3>Paling banyak cuti</h3><div class="big">${top ? escapeHtml(ctBm(byCca2, top)) : '—'}</div><div class="meta">${top ? `${top.holidays.length} kelepasan am ${yr}` : 'tiada data'}</div></div>`
    + `</div>`;
  const note = CT_REGION_NOTES[region.slug] || '';
  const otherRegions = cd.REGIONS.filter((r) => r.slug !== region.slug).map((r) => `<a href="/cuti/dunia/${r.slug}">${escapeHtml(r.bm)}</a>`).join(' \u00b7 ');
  const body = `<div class="wx-hero"><div class="temp">Cuti ${escapeHtml(region.bm)} ${yr}</div><div class="wmeta">${list.length} buah negara \u00b7 ${total} kelepasan am direkodkan \u00b7 data terbuka Nager.Date</div></div>`
    + cards
    + (note ? `<h2 class="section-title">Wajah kalendar ${escapeHtml(region.bm)}</h2><p>${escapeHtml(note)}</p>` : '')
    + `<h2 class="section-title">Semua negara \u2014 ${escapeHtml(region.bm)}</h2>`
    + `<table class="wx-table"><tr><th>Negara</th><th>Cuti ${yr}</th><th>Cuti seterusnya</th></tr>${rowsHtml}</table>`
    + (nodata.length ? `<p class="meta">Belum tersedia dalam sumber: ${escapeHtml(nodata.map((r) => ctBm(byCca2, r)).join(', '))}.</p>` : '')
    + `<p>Kalendar benua lain: ${otherRegions}. Kembali ke <a href="/cuti">hab cuti dunia</a> untuk ranking rentas benua dan jadual Malaysia penuh.</p>`
    + `<p class="meta">Profil geografi setiap negara (ibu negara, populasi, bendera, jiran) ada di <a href="/negara/${region.slug}">Kompleks Negara \u2014 ${escapeHtml(region.bm)}</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Cuti Umum ${region.bm} ${yr}`,
    description: `Senarai ${list.length} buah negara di ${region.bm} dengan jumlah cuti umum ${yr} dan tarikh kelepasan seterusnya.`,
    url: `https://tukuk.org/cuti/dunia/${region.slug}`, inLanguage: 'ms', temporalCoverage: String(yr),
  }).replace(/</g, '\\u003c');
  return cutiDoc({
    title: `Cuti Umum ${region.bm} ${yr} \u2014 Senarai Negara & Tarikh | Tukuk-OS`,
    desc: `Kalendar cuti umum ${yr} di ${region.bm}: ${list.length} buah negara, jumlah kelepasan am, cuti seterusnya dan pautan ke jadual penuh setiap negara.`,
    selfUrl: `https://tukuk.org/cuti/dunia/${region.slug}`,
    heroTitle: `Cuti ${region.bm} ${yr}`, heroSub: `${list.length} buah negara \u00b7 ${total} kelepasan am \u00b7 data terbuka`,
    body, ld,
  });
}

// ——— /cuti/dunia/:negara — jadual tarikh penuh satu negara ———
function cutiCountryPage(req, coun, holidays, lws, rows) {
  const byCca2 = new Map((rows || []).map((c) => [c.cca2, c]));
  const ngRow = byCca2.get(coun.cca2) || null;
  const bm = ngRow && ngRow.bm ? ngRow.bm : coun.en;
  const yr = CT_WORLD_YEAR;
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...holidays].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nationals = sorted.filter((h) => h.global).length;
  const next = ctNext(sorted, today);
  const perMonth = {};
  const perDay = {};
  for (const h of sorted) {
    const m = String(h.date).slice(5, 7); const d = new Date(`${h.date}T00:00:00Z`).getUTCDay();
    perMonth[m] = (perMonth[m] || 0) + 1; perDay[d] = (perDay[d] || 0) + 1;
  }
  const busyMonth = Object.keys(perMonth).sort((a, b) => perMonth[b] - perMonth[a])[0] || null;
  const busyLabel = busyMonth ? ctDateFr(`${yr}-${busyMonth}-01`).split(',').pop().trim() : '—';
  const topDay = Object.keys(perDay).sort((a, b) => perDay[b] - perDay[a])[0];
  const DAY_BM = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
  const nextLeft = next ? Math.round((Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : 0;
  const hero = `<div class="wx-hero"><div class="temp"><img class="ct-fl" style="height:34px;width:51px" src="${ctFlag(coun.cca2)}" alt="Bendera ${escapeHtml(bm)}">${escapeHtml(bm)}</div>`
    + `<div class="wmeta">${sorted.length} cuti umum ${yr} \u00b7 ${nationals} untuk seluruh negara`
    + (next ? `<br>Cuti seterusnya: <b>${escapeHtml(next.name)}</b> \u00b7 ${escapeHtml(ctDateFr(next.date))} \u00b7 ${nextLeft} hari lagi` : '<br>Tiada lagi baki cuti tahun ini')
    + '</div></div>';
  const cards = `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Jumlah kelepasan ${yr}</h3><div class="big">${sorted.length}</div><div class="meta">${nationals} nasional \u00b7 ${sorted.length - nationals} negeri/wilayah</div></div>`
    + `<div class="wx-card"><h3>Bulan paling padat</h3><div class="big">${escapeHtml(busyLabel)}</div><div class="meta">${busyMonth ? perMonth[busyMonth] : 0} cuti dalam satu bulan</div></div>`
    + `<div class="wx-card"><h3>Hari paling kerap</h3><div class="big">${topDay != null ? DAY_BM[Number(topDay)] : '—'}</div><div class="meta">${topDay != null ? `${perDay[topDay]} cuti jatuh pada hari ini` : 'tiada data'}</div></div>`
    + `</div>`;
  const siblings = cd.COUNTRIES
    .filter(([cca2, , reg]) => reg === coun.region && cca2 !== coun.cca2)
    .map(([cca2]) => cd.findCountry(cca2))
    .map((r) => `<a href="/cuti/dunia/${r.slug}">${escapeHtml(ctBm(byCca2, r))}</a>`).join(' \u00b7 ');
  const longest = Array.isArray(lws) && lws.length ? [...lws].sort((a, b) => b.dayCount - a.dayCount)[0] : null;
  const body = hero
    + cards
    + `<h2 class="section-title">Semua cuti umum ${escapeHtml(bm)} ${yr}</h2>${ctWorldTable(sorted)}`
    + `<h2 class="section-title">Hujung minggu panjang ${escapeHtml(bm)} ${yr}</h2>${ctWorldLwTable(lws)}`
    + `<h2 class="section-title">Merancang cuti di ${escapeHtml(bm)}</h2><p>${escapeHtml(bm)} memberikan <b>${sorted.length}</b> kelepasan am pada ${yr}${nationals !== sorted.length ? `, termasuk ${sorted.length - nationals} yang hanya diiktiraf di negeri atau wilayah tertentu` : ' — semuanya diiktiraf di seluruh negara'}. Gabungan hujung minggu ${longest ? `terpanjang tahun ini ialah <b>${longest.dayCount} hari</b> (${escapeHtml(ctShort(longest.start))} \u2013 ${escapeHtml(ctShort(longest.end))})` : 'belum dilaporkan untuk tahun ini'}. Bulan paling padat ialah <b>${escapeHtml(busyLabel)}</b>, dan cuti paling kerap jatuh pada hari <b>${topDay != null ? DAY_BM[Number(topDay)] : '—'}</b> \u2014 dua fakta yang cukup untuk memutuskan bila tiket perlu dibeli lebih awal.</p>`
    + `<p>Negara dengan kalendar berbilang agama biasanya mempunyai cuti «bergerak» (Aidilfitri, Easter, Tahun Baharu Cina, Diwali) yang berubah tarikh setiap tahun, jadi semak jadual setahun ke hadapan sebelum merancang cuti sekolah.</p>`
    + `<p class="meta">Profil penuh ${escapeHtml(bm)} (ibu negara, populasi, KDNK, jiran): <a href="/negara/${ngRow ? ngRow.slug : 'dunia'}">Kompleks Negara</a>${coun.cca2 === 'MY' ? ` \u00b7 jadual terperinci ikut negeri ada di <a href="/cuti/${cu.YEAR_MIN}">Cuti Malaysia ${cu.YEAR_MIN}</a>` : ''} \u00b7 ranking sosioekonomi: <a href="/statistik">Kompleks Statistik</a> \u00b7 acara alam aktif: <a href="/bencana">Kompleks Bencana</a>.</p>`
    + `<h2 class="section-title">Negara lain dalam ${escapeHtml(ctRegionBm(coun.region))}</h2><p>${siblings}</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Cuti Umum ${bm} ${yr}`,
    description: `Senarai penuh ${sorted.length} cuti umum ${bm} ${yr} bersama tarikh, hari, skop nasional/wilayah dan gabungan hujung minggu panjang.`,
    url: `https://tukuk.org/cuti/dunia/${coun.slug}`, inLanguage: 'ms', temporalCoverage: String(yr),
  }).replace(/</g, '\\u003c');
  return cutiDoc({
    title: `Cuti Umum ${bm} ${yr} \u2014 ${sorted.length} Tarikh Kelepasan | Tukuk-OS`,
    desc: `Jadual penuh cuti umum ${bm} ${yr}: ${sorted.length} tarikh (${nationals} nasional), cuti seterusnya ${next ? escapeHtml(ctShort(next.date)) : '—'}, gabungan hujung minggu panjang dan bulan paling padat.`,
    selfUrl: `https://tukuk.org/cuti/dunia/${coun.slug}`,
    heroTitle: `Cuti Umum ${bm} ${yr}`, heroSub: `${sorted.length} kelepasan am \u00b7 data terbuka Nager.Date \u00b7 dikemas kini automatik`,
    body, ld,
  });
}


// ——— Halaman tahun (/cuti/2026, /cuti/2027) — nasional penuh + LW 4 kawasan ———
function cutiYearPage(req, year, rows) {
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const selfUrl = `https://tukuk.org/cuti/${year}`;
  const areas = [['KUL', 'Kuala Lumpur &amp; Putrajaya'], ['SGR', 'Selangor'], ['JHR', 'Johor'], ['SBH', 'Sabah'], ['SWK', 'Sarawak']];
  const lwBlocks = areas.map(([code, label]) => {
    const list = cu.longWeekends(cu.forState(sorted, code));
    return `<h2 class="section-title">Hujung minggu panjang \u2014 ${label}</h2>${ctLwHtml(list)}`;
  }).join('');
  const stateCards = cu.STATES.map((st) => `<li><a href="/cuti/${st.slug}?tahun=${year}">${escapeHtml(st.name)}</a></li>`).join('');
  const body = `<p>Senarai penuh kelepasan am bagi tahun <b>${year}</b> \u2014 ${sorted.length} tarikh merentas semua negeri, disemak terhadap dokumen rasmi <a href="https://www.kabinet.gov.my/hari-kelepasan-am" rel="noopener nofollow">kabinet.gov.my</a>. Entri bertanda <i>tertakluk perubahan</i> ialah cuti yang masih boleh ditambah/dipotong kerajaan (biasanya cuti khas sambutan).</p>`
    + `<h2 class="section-title">Semua cuti ${year}</h2>${ctTable(sorted)}`
    + lwBlocks
    + `<h2 class="section-title">Jadual ikut negeri</h2><ul>${stateCards}</ul>`
    + `<p class="meta">Cuti keputeraan negeri mungkin dikekalkan pada tarikh lama sehingga istana umumkan; semak halaman negeri anda. <a href="/cuti/penjelasan">Fahami cara kalendar cuti Malaysia berfungsi</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Cuti Umum Malaysia ${year}`,
    description: `Senarai penuh cuti umum Malaysia ${year} mengikut tarikh dan negeri, dengan kiraan hujung minggu panjang.`,
    url: selfUrl,
  }).replace(/</g, '\\u003c');
  return cutiDoc({
    title: `Cuti Umum Malaysia ${year} \u2014 Senarai Penuh & Hujung Minggu Panjang | Tukuk-OS`,
    desc: `Kalendar lengkap cuti umum ${year}: ${sorted.length} tarikh disemak terhadap dokumen rasmi kerajaan, kiraan hujung minggu panjang KL, Selangor, Johor, Sabah dan Sarawak.`,
    selfUrl,
    heroTitle: `Cuti Umum ${year}`, heroSub: `${sorted.length} tarikh kelepasan am \u00b7 nasional & negeri \u00b7 dikemas kini serta-merta bila gazet berubah`,
    body, ld,
  });
}

// ——— /cuti/hujung-minggu-panjang — gabungan dunia + seksyen Malaysia ———
function cutiLongWeekendPage(req, rows26, rows27, worldLw, ngRows) {
  const byCca2 = new Map((ngRows || []).map((c) => [c.cca2, c]));
  const world = Array.isArray(worldLw) ? worldLw : [];
  const yr = CT_WORLD_YEAR;
  const big = world.filter((w) => Number(w.dayCount) >= 4);
  const auto = world.filter((w) => !w.needBridge && Number(w.dayCount) >= 4);
  const bridgeN = world.filter((w) => w.needBridge && Number(w.dayCount) >= 4);
  const longest = world.length ? world[0] : null;
  const nationCount = new Set(world.map((w) => w.cca2)).size;
  const lwPill = (w) => (w.needBridge
    ? `<span class="wx-pill" style="background:#e67e22;color:#fff">${escapeHtml((w.bridgeDays || []).length ? `${w.bridgeDays.length} hari jambatan` : '1 hari jambatan')}</span>`
    : '<span class="wx-pill" style="background:#2f9e63;color:#fff">Automatik</span>');
  const worldRows = big.slice(0, 60).map((w) => `<tr><td>${ctNation(byCca2, w)}</td>`
    + `<td>${escapeHtml(ctRegionBm(w.region))}</td>`
    + `<td><b>${escapeHtml(ctShort(w.start))} \u2013 ${escapeHtml(ctShort(w.end))}</b></td>`
    + `<td>${escapeHtml(ctDay(w.start))}</td><td><b>${w.dayCount} hari</b></td><td>${lwPill(w)}</td></tr>`).join('');
  // Bahagian Malaysia (litar lama): gabungan dikira daripada jadual negeri MY.
  const seen = new Map();
  for (const [code, rows, year] of [['KUL', rows26, cu.YEAR_MIN], ['SGR', rows26, cu.YEAR_MIN], ['JHR', rows26, cu.YEAR_MIN], ['SBH', rows26, cu.YEAR_MIN], ['SWK', rows26, cu.YEAR_MIN], ['KUL', rows27, cu.YEAR_MAX], ['SGR', rows27, cu.YEAR_MAX], ['JHR', rows27, cu.YEAR_MAX]]) {
    for (const w of cu.longWeekends(cu.forState(rows || [], code))) {
      const k = `${code}|${w.start}|${w.end}`;
      if (!seen.has(k)) seen.set(k, { ...w, area: code, year });
    }
  }
  const myAll = [...seen.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const myAuto = myAll.filter((w) => w.auto); const myBridge = myAll.filter((w) => !w.auto && w.bridge);
  const areaName = (code) => { const st = cu.STATES.find((x) => x.code === code); return st ? st.name : code; };
  const fmtMy = (w) => `<tr><td>${escapeHtml(areaName(w.area))} ${w.year}</td><td>${escapeHtml(ctShort(w.start))} \u2013 ${escapeHtml(ctShort(w.end))}</td><td><b>${w.spanDays} hari</b></td><td>${escapeHtml(w.holidays.map((h) => h.name).join(' + '))}</td></tr>`;
  const body = `<div class="wx-hero"><div class="temp">${big.length} hujung minggu panjang ${yr}</div><div class="wmeta">${auto.length} terbentuk automatik \u00b7 ${bridgeN.length} cukup 1 hari cuti rehat \u00b7 ${nationCount} negara dianalisis</div></div>`
    + `<p>Hujung minggu panjang ialah titik di mana cuti umum bersambung dengan hari tidak bekerja. Halaman ini menghimpunkan gabungan <b>4 hari atau lebih</b> daripada kalendar ${cd.COUNTRIES.length} buah negara (Nager.Date, data terbuka), dan memisahkan yang <b>automatik</b> daripada yang memerlukan <b>hari jambatan</b> — cuti rehat yang anda ambil sendiri.</p>`
    + `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Gabungan automatik</h3><div class="big">${auto.length}</div><div class="meta">4 hari atau lebih tanpa cuti rehat</div></div>`
    + `<div class="wx-card"><h3>Perlu hari jambatan</h3><div class="big">${bridgeN.length}</div><div class="meta">ambil 1\u20132 hari cuti, dapat 4\u20135 hari</div></div>`
    + `<div class="wx-card"><h3>Sambungan terpanjang</h3><div class="big">${longest ? `${longest.dayCount} hari` : '—'}</div><div class="meta">${longest ? `${escapeHtml(ctBm(byCca2, longest))} \u00b7 ${escapeHtml(ctShort(longest.start))} \u2013 ${escapeHtml(ctShort(longest.end))}` : 'tiada data'}</div></div>`
    + `</div>`
    + `<h2 class="section-title">Dunia — gabungan 4 hari atau lebih (${yr})</h2>`
    + (worldRows ? `<table class="wx-table"><tr><th>Negara</th><th>Benua</th><th>Tempoh</th><th>Bermula</th><th>Jumlah</th><th>Keperluan</th></tr>${worldRows}</table>` : '<p>Data hujung minggu dunia belum sempat dimuat. Cuba lagi sebentar.</p>')
    + `<p>Peraturan yang menghasilkan sambungan panjang: <b>ganti hari</b> (cuti Ahad dipindah ke Isnin — UK, Australia, Afrika Selatan, Amerika Syarikat), <b>cuti bersebelahan</b> (dua kelepasan dalam minggu yang sama, misalnya Good Friday + Easter Monday), dan <b>cuti tunggal pertengahan minggu</b> yang hanya menjadi 4 hari jika anda menambah satu hari jambatan. Negara dengan cuti keagamaan bergerak (Islam dan lunisolar) memberikan gabungan yang berbeza setiap tahun, jadi semak kalendar negara destinasi sebelum menempah tiket.</p>`
    + `<h2 class="section-title">Malaysia — gabungan automatik</h2>`
    + (myAuto.length ? `<table class="wx-table"><tr><th>Kawasan</th><th>Tempoh</th><th>Panjang</th><th>Cuti berkaitan</th></tr>${myAuto.map(fmtMy).join('')}</table>` : '<p>Belum ada data cuti Malaysia untuk dihitung.</p>')
    + `<h2 class="section-title">Malaysia — gabungan jambatan (1 hari cuti rehat)</h2>`
    + (myBridge.length ? `<table class="wx-table"><tr><th>Kawasan</th><th>Tempoh</th><th>Panjang</th><th>Cuti berkaitan</th></tr>${myBridge.map(fmtMy).join('')}</table>` : '<p>Tiada gabungan jambatan dalam data setakat ini.</p>')
    + `<p>Negeri ber-hujung-minggu Jumaat\u2013Sabtu (Johor, Kedah, Kelantan, Terengganu) mempunyai kiraan berbeza \u2014 buka halaman negeri masing-masing di <a href="/cuti">hab cuti dunia</a>.</p>`
    + `<p class="meta">Lihat juga: <a href="/cuti">kalendar ${cd.COUNTRIES.length} negara</a> \u00b7 <a href="/cuti/2026">Malaysia ${cu.YEAR_MIN}</a> \u00b7 <a href="/cuti/2027">Malaysia ${cu.YEAR_MAX}</a> \u00b7 <a href="/cuti/penjelasan">cara kalendar cuti berfungsi</a> \u00b7 <a href="/cuaca">cuaca destinasi</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Hujung Minggu Panjang Dunia ${yr}`,
    description: `Gabungan cuti umum dan hujung minggu 4 hari atau lebih untuk ${nationCount} negara (${yr}), serta kiraan automatik dan hari jambatan untuk Malaysia.`,
    url: 'https://tukuk.org/cuti/hujung-minggu-panjang', inLanguage: 'ms', temporalCoverage: String(yr),
  }).replace(/</g, '\\u003c');
  return cutiDoc({
    title: `Hujung Minggu Panjang Dunia ${yr} \u2014 Cuti Bersambung & Jambatan | Tukuk-OS`,
    desc: `${big.length} gabungan hujung minggu panjang ${yr} di ${nationCount} negara: yang automatik 4 hari ke atas dan yang cukup 1 hari cuti rehat (jambatan), termasuk kiraan khusus Malaysia ikut negeri.`,
    selfUrl: 'https://tukuk.org/cuti/hujung-minggu-panjang',
    heroTitle: 'Hujung Minggu Panjang Dunia', heroSub: `Bila cuti bersambung hujung minggu di ${nationCount} negara \u2014 tanpa atau dengan 1 hari cuti rehat`,
    body, ld,
  });
}

// ——— /cuti/:negeri — jadual satu negeri + LW ikut konvensyen hujung minggu negeri ———
function cutiStatePage(req, st, year, rows) {
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const selfUrl = `https://tukuk.org/cuti/${st.slug}${Number(year) === cu.YEAR_MIN ? '' : `?tahun=${year}`}`;
  const lw = cu.longWeekends(sorted);
  const next = cu.nextHoliday(sorted, new Date().toISOString().slice(0, 10));
  const otherYear = Number(year) === cu.YEAR_MIN ? cu.YEAR_MAX : cu.YEAR_MIN;
  const body = `<p>Jadual kelepasan am <b>${escapeHtml(st.name)}</b> tahun <b>${year}</b>: ${sorted.length} cuti. Hujung minggu rasmi ${escapeHtml(st.name)} ialah <b>${escapeHtml(st.weekend)}</b>${st.weekend === 'Jumaat\u2013Sabtu' ? ' \u2014 jadi cuti yang jatuh pada Jumaat sudah berada dalam hujung minggu negeri ini, dan cuti Ahad biasanya diganti pada Isnin.' : ''} Cuti keputeraan Sultan/Raja negeri disenaraikan di sini juga.</p>`
    + (next ? `<div class="wx-hero"><div class="temp">${escapeHtml(next.name)}</div><div class="wmeta">Cuti ${escapeHtml(st.name)} seterusnya<br>${escapeHtml(ctDateFr(next.date))}</div></div>` : '')
    + `<h2 class="section-title">Semua cuti ${escapeHtml(st.name)} ${year}</h2>${ctTable(sorted)}`
    + `<h2 class="section-title">Hujung minggu panjang di ${escapeHtml(st.name)}</h2>${ctLwHtml(lw)}`
    + `<p class="meta">Negeri ini ${sorted.length} cuti pada ${year}; bandingkan dengan <a href="/cuti/${st.slug}?tahun=${otherYear}">${otherYear}</a> atau lihat <a href="/cuti">perbandingan semua negeri</a>. Sebelum merancang aktiviti luar, semak <a href="/cuaca">cuaca ${escapeHtml(st.name)}</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Cuti Umum ${st.name} ${year}`,
    description: `Senarai cuti umum ${st.name} ${year} bersama kiraan hujung minggu panjang mengikut hari hujung minggu negeri.`,
    url: selfUrl,
  }).replace(/</g, '\\u003c');
  return cutiDoc({
    title: `Cuti Umum ${st.name} ${year} \u2014 Jadual & Hujung Minggu Panjang | Tukuk-OS`,
    desc: `Senarai penuh cuti umum ${st.name} ${year} (disemak terhadap dokumen kerajaan), hujung minggu ${st.weekend}, dan tarikh kelepasan berikutnya.`,
    selfUrl,
    heroTitle: `Cuti ${st.name} ${year}`, heroSub: `${sorted.length} kelepasan am \u00b7 hujung minggu ${st.weekend}`,
    body, ld,
  });
}

// ——— /cuti/penjelasan — statik, pendidikan (dunia + Malaysia) ———
function cutiExplainPage(req) {
  const body = `<p>Setiap negara mendefinisikan «hari tidak bekerja» dengan caranya sendiri. Apabila anda memahami lima mekanik di bawah, anda boleh membaca jadual cuti mana-mana negara di <a href="/cuti">kompleks ini</a> dan terus tahu bila tiket patut dibeli.</p>`
    + `<h2 class="section-title">1. Empat jenis takwim</h2><p><b>Surya</b> (1 Januari, 1 Mei, hari kemerdekaan) jatuh pada tarikh yang sama setiap tahun. <b>Bulan Islam</b> (Aidilfitri, Aidiladha, Maulidur Rasul, Awal Ramadan) bergerak lebih kurang <b>11 hari lebih awal</b> setiap tahun Masihi — kerana tahun hijriah hanya ±354 hari. <b>Lunisolar</b> (Tahun Baharu Cina, Vesak, Deepavali) bergantung pada fasa bulan dan kedudukan matahari serentak, jadi julat tarikhnya luas (Tahun Baharu Cina sentiasa antara 21 Jan–20 Feb). <b>Movable Christian</b> (Good Friday, Easter Monday, Ascension, Whit Monday) semua terkunci pada satu tarikh ibu: bulan penuh pertama selepas ekuinoks Mac.</p>`
    + `<h2 class="section-title">2. Dua lapis: nasional dan negeri</h2><p>Kira-kira separuh dunia mempunyai cuti bertingkat: kelepasan <b>persekutuan/nasional</b> ditambah <b>cuti negara bagian, provinsi atau munisipal</b>. Contoh ekstrem: India mengisytiharkan cuti negeri yang berbeza-beza (Pongal di Tamil Nadu, Onam di Kerala), Switzerland mempunyai cuti kanton, dan Sepanyol mempunyai cuti autonomi. Dalam jadual kami, baris bertanda <i>Sebahagian negara</i> bermaksud kelepasan itu hanya sah di wilayah tertentu.</p>`
    + `<h2 class="section-title">3. Prinsip ganti hari (substitute/observed)</h2><p>United Kingdom, Australia, New Zealand, Afrika Selatan, Amerika Syarikat dan Korea Selatan <b>memindahkan</b> cuti yang jatuh pada hujung minggu ke hari kerja terdekat; di AS ini dipanggil <i>observed</i> — Christmas 2027 jatuh pada Sabtu, jadi cuti federal dipindahkan ke Isnin 27 Dis. Sebaliknya, banyak negara Asia Tenggara dan Timur Tengah tidak menggantikan cuti Ahad secara automatik — cuti itu «hilang». Ini sebab utama bilangan hari cuti <i>efektif</i> anda berbeza daripada angka dalam jadual.</p>`
    + `<h2 class="section-title">4. Hujung minggu dua konvensyen</h2><p>Kebanyakan negara Islam di Timur Tengah dahulu bercuti <b>Jumaat–Sabtu</b>; sebahagian besar (termasuk UAE sejak 2022 dan Saudi Arabia untuk sektor swasta) telah bertukar ke <b>Sabtu–Ahad</b> atau <b>Ahad–Isnin</b> supaya dua hari rehat terpasang pada hujung minggu antarabangsa. Di Malaysia, Johor, Kedah, Kelantan dan Terengganu masih Jumaat–Sabtu — sebab yang sama cuti Ahad menjadi 3 hari di satu negeri tetapi hanya 2 hari di negeri lain.</p>`
    + `<h2 class="section-title">5. Cuti rehat &amp; strategi jambatan</h2><p>Cuti tunggal pada Selasa atau Khamis ialah peluang paling menguntungkan: tambah <b>1 hari cuti rehat</b>, dapat <b>4 hari</b> bercuti. Nager.Date menandakan gabungan sedemikian sebagai <i>needBridgeDay</i> dan kami memaparkannya dalam halaman <a href="/cuti/hujung-minggu-panjang">hujung minggu panjang</a>. Strategi popular: tempah tiket sejurus kalendar tahunan diwartakan (biasanya Oktober–November tahun sebelumnya) kerana cuti jambatan merebut kapasiti penerbangan dengan cepat.</p>`
    + `<h2 class="section-title">Malaysia: dua lapis + gazet lewat</h2><p>Jadual Malaysia mempunyai cuti persekutuan (Hari Merdeka 31 Ogos, Aidilfitri, Aidiladha, Tahun Baharu, Wesak, Deepavali, Krismas) ditambah <b>cuti keputeraan Sultan/Raja</b> dan cuti khas negeri (Hari Gawai di Sarawak, Pesta Kaamatan di Sabah). Entri bertanda <i>tertakluk perubahan</i> ialah cuti khas yang masih boleh ditambah atau dipotong kerajaan — semak <a href="/cuti/${cu.YEAR_MIN}">jadual ${cu.YEAR_MIN}</a> dan <a href="/cuti/${cu.YEAR_MAX}">${cu.YEAR_MAX}</a> sebelum membeli tiket.</p>`
    + `<h2 class="section-title">Dari mana data kami?</h2><p>Jadual dunia datang daripada <b>Nager.Date v3</b> (<a href="https://date.nager.at" rel="noopener nofollow">date.nager.at</a>) — projek sumber terbuka tanpa pendaftaran, diliputi ±180 negara; kami memilih ${cd.COUNTRIES.length} buah negara untuk halaman mendalam. Nama BM, bendera dan kedudukan negara dipinjam daripada <a href="/negara">Kompleks Negara</a> (world-countries + World Bank). Jadual Malaysia datang daripada API awam <b>malaysia-holiday.dydxsoft.my</b> yang disemak terhadap dokumen rasmi <a href="https://www.kabinet.gov.my/hari-kelepasan-am" rel="noopener nofollow">kabinet.gov.my</a>. Kami cache 30 hari dan kemas kini serta-merta bila sumber berubah. Langit ketika bercuti: <a href="/cuaca">Kompleks Cuaca</a>; tanah bergegar di destinasi: <a href="/gempa">Kompleks Gempa</a>; acara alam aktif: <a href="/bencana">Kompleks Bencana</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article', name: 'Cara Kalendar Cuti Dunia Berfungsi',
    description: 'Penjelasan Bahasa Melayu: takwim surya/bulan/lunisolar, cuti nasional vs negeri, prinsip ganti hari, konvensyen hujung minggu dan strategi cuti jambatan.',
    url: 'https://tukuk.org/cuti/penjelasan', inLanguage: 'ms', publisher: { '@type': 'Organization', name: 'Tukuk-OS' },
  }).replace(/</g, '\\u003c');
  return cutiDoc({
    title: 'Cara Kalendar Cuti Berfungsi \u2014 Takwim Bulan, Ganti Hari & Jambatan | Tukuk-OS',
    desc: 'Fahami lima mekanik kalendar cuti di seluruh dunia: takwim surya vs bulan/lunisolar, cuti nasional vs negeri, prinsip ganti hari, konvensyen hujung minggu dan strategi cuti jambatan.',
    selfUrl: 'https://tukuk.org/cuti/penjelasan',
    heroTitle: 'Cara Kalendar Cuti Berfungsi', heroSub: `Lima mekanik yang menjelaskan setiap jadual kelepasan am di ${cd.COUNTRIES.length} negara`,
    body, ld,
  });
}

// ── TUKUK-OS NEGARA COMPLEX — /negara* (profil ±250 negara, Bahasa Melayu) ──
// Sumber: world-countries (jsDelivr, tanpa kunci) + World Bank Open Data (populasi,
// KDNK, urbanisasi, jangka hayat 2023) + flagcdn.com untuk bendera. Shell resepi sama
// cutiDoc: lang ms, 3 slot iklan, nav silang; hero biru-nelayan bezakan kompleks ini.

const NEGARA_SECTIONS = [{ href: '/negara', icon: '\uD83D\uDDFA\uFE0F', name: 'Semua Negara', blurb: 'Profil setiap buah negara di dunia \u2014 ibu negara, populasi, KDNK, bendera dan jiran daratan.' }]
  .concat(ng.REGIONS.map((r) => ({ href: `/negara/${r.slug}`, icon: '\uD83E\uDDED', name: `Negara ${r.bm}`, blurb: `Senarai lengkap negara dalam benua ${r.bm}, disusun ikut abjad.` })));

function negaraNav() {
  return `<nav aria-label="Bahagian negara"><h2 class="section-title">Jelajahi Kompleks Negara Tukuk-OS</h2><div class="feed">`
    + NEGARA_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${s.name}</a></h2><p>${s.blurb}</p></div>`).join('')
    + `</div></nav>`;
}

function negaraBusy(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escapeHtml(msg)} | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>${escapeHtml(msg)}</h1><p>Sumber data negara (world-countries / World Bank) tidak sempat menjawab. Sila cuba lagi sebentar.</p><p><a href="/negara">Kembali ke Kompleks Negara</a></p></body>`;
}

// Terjemahan subregion (skema restcountries) untuk paparan mesra pembaca MY.
const NG_SUB_BM = {
  'South East Asia': 'Asia Tenggara', 'East Asia': 'Asia Timur', 'South Asia': 'Asia Selatan',
  'Central Asia': 'Asia Tengah', 'Western Asia': 'Asia Barat', 'Northern Africa': 'Afrika Utara',
  'Western Africa': 'Afrika Barat', 'Eastern Africa': 'Afrika Timur', 'Middle Africa': 'Afrika Tengah',
  'Southern Africa': 'Afrika Selatan', 'Northern Europe': 'Eropah Utara', 'Western Europe': 'Eropah Barat',
  'Eastern Europe': 'Eropah Timur', 'Southern Europe': 'Eropah Selatan', 'Central Europe': 'Eropah Tengah',
  'Caribbean': 'Karibia', 'Central America': 'Amerika Tengah', 'North America': 'Amerika Utara',
  'Northern America': 'Amerika Utara', 'South America': 'Amerika Selatan',
  'Australia and New Zealand': 'Australia &amp; New Zealand', 'Melanesia': 'Melanesia',
  'Micronesia': 'Mikronesia', 'Polynesia': 'Polinesia',
};

const NG_INT = new Intl.NumberFormat('ms-MY');
const NG_DEC = new Intl.NumberFormat('ms-MY', { maximumFractionDigits: 1 });
function ngNum(n) { return n == null || !Number.isFinite(n) ? '—' : NG_INT.format(Math.round(n)); }
function ngGdp(usd) { return usd == null ? '—' : `US$${NG_DEC.format(usd / 1e9)} bilion`; }
function ngSubBm(s) { return NG_SUB_BM[s] || s || ''; }
function ngThumb(cca2) { return `https://flagcdn.com/w160/${String(cca2 || '').toLowerCase()}.png`; }

function negaraDoc(o) {
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="ms_MY">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
.wx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.wx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21)}
.wx-card h3{margin:0 0 6px;font-size:.95rem;color:var(--muted,#9aa3b2);font-weight:600}
.wx-card .big{font-size:1.4rem;font-weight:700}
.wx-hero{display:flex;gap:22px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:16px 0;background:linear-gradient(135deg,#123a6d 0%,#0b0d12 100%);color:#fff}
.wx-hero .temp{font-size:2.2rem;font-weight:800;line-height:1.1}
.wx-hero .wmeta{font-size:.92rem;opacity:.92;line-height:1.5}
.wx-pill{display:inline-block;border-radius:999px;padding:3px 12px;font-weight:700;font-size:.85rem;color:#08121e}
table.wx-table{width:100%;border-collapse:collapse;font-size:.9rem;margin:14px 0}
.wx-table th,.wx-table td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.wx-table th{background:var(--panel,#171a21)}
.ng-az{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.95rem;margin:6px 0 14px}
.ng-fl{height:16px;width:auto;vertical-align:-2px;border-radius:2px;margin-right:7px;border:1px solid var(--line)}
@media(max-width:680px){.wx-grid{grid-template-columns:1fr}.wx-hero .temp{font-size:1.7rem}table.wx-table{display:block;overflow-x:auto}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('negara')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${negaraNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

// ─── HAB /negara — kiraan dunia, rantau, top-10 populasi & keluasan, grid A–Z ───
function negaraHubPage(req, rows) {
  const totalPop = rows.reduce((s, c) => s + (c.population || 0), 0);
  const byPop = [...rows].filter((c) => c.population).sort((a, b) => b.population - a.population);
  const byArea = [...rows].filter((c) => c.area).sort((a, b) => b.area - a.area);
  const regionCards = ng.REGIONS.map((r) => {
    const list = ng.inRegion(rows, r.slug);
    return `<div class="wx-card"><h3><a href="/negara/${r.slug}">${escapeHtml(r.bm)}</a></h3><div class="big">${list.length}</div><div class="meta">buah negara & wilayah dalam benua ini</div></div>`;
  }).join('');
  const topPop = byPop.slice(0, 10).map((c, i) => `<tr><td>${i + 1}</td><td><a href="/negara/${c.slug}"><img class="ng-fl" src="${ngThumb(c.cca2)}" alt="" loading="lazy" decoding="async"> ${escapeHtml(c.bm)}</a></td><td>${escapeHtml(c.capital || '—')}</td><td><b>${ngNum(c.population)}</b></td></tr>`).join('');
  const topArea = byArea.slice(0, 10).map((c) => `<tr><td><a href="/negara/${c.slug}"><img class="ng-fl" src="${ngThumb(c.cca2)}" alt="" loading="lazy" decoding="async"> ${escapeHtml(c.bm)}</a></td><td>${ngNum(c.area)} km²</td><td>${ngNum(c.population)}</td></tr>`).join('');
  // Grid A–Z — hab pautan crawlable ke kesemua ±250 halaman negara.
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const letters = new Map();
  for (const c of sorted) {
    const L = c.bm.charAt(0).toUpperCase();
    if (!letters.has(L)) letters.set(L, []);
    letters.get(L).push(`<a href="/negara/${c.slug}">${escapeHtml(c.bm)}</a>`);
  }
  const az = [...letters.entries()].map(([L, links]) => `<h3>${L}</h3><div class="ng-az">${links.join('')}</div>`).join('');
  const body = `<div class="wx-hero"><div class="temp">${rows.length} buah negara</div><div class="wmeta">Profil lengkap setiap negara dalam Bahasa Melayu \u00b7 populasi & KDNK World Bank (2023) \u00b7 bendera flagcdn \u00b7 data asas pakej open-data world-countries</div></div>`
    + `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Jumlah populasi terhimpun</h3><div class="big">${ngNum(totalPop)}</div><div class="meta">anggaran penduduk dunia (indikator World Bank 2023)</div></div>`
    + `<div class="wx-card"><h3>Negara paling padat</h3><div class="big">${byPop[0] ? `<a href="/negara/${byPop[0].slug}">${escapeHtml(byPop[0].bm)}</a>` : '—'}</div><div class="meta">${byPop[0] ? ngNum(byPop[0].population) : 0} orang</div></div>`
    + `<div class="wx-card"><h3>Negara paling luas</h3><div class="big">${byArea[0] ? `<a href="/negara/${byArea[0].slug}">${escapeHtml(byArea[0].bm)}</a>` : '—'}</div><div class="meta">${byArea[0] ? ngNum(byArea[0].area) : 0} km²</div></div>`
    + `</div>`
    + `<h2 class="section-title">Mengikut benua</h2><div class="wx-grid">${regionCards}</div>`
    + `<h2 class="section-title">10 negara terbanyak penduduk</h2><table class="wx-table"><tr><th>#</th><th>Negara</th><th>Ibu negara</th><th>Populasi</th></tr>${topPop}</table>`
    + `<h2 class="section-title">10 negara paling luas</h2><table class="wx-table"><tr><th>Negara</th><th>Keluasan</th><th>Populasi</th></tr>${topArea}</table>`
    + `<h2 class="section-title">Senarai semua negara (A–Z)</h2>${az}`
    + `<p class="meta">Merancang perjalanan? Semak <a href="/cuaca">Kompleks Cuaca</a> untuk keadaan langit, <a href="/gempa">Kompleks Gempa</a> untuk senarai langsung USGS, <a href="/bencana">Kompleks Bencana</a> untuk acara alam aktif dan <a href="/statistik">Kompleks Statistik</a> untuk ranking dunia. Jadual kelepasan Malaysia di <a href="/cuti">Kompleks Cuti</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Kompleks Negara Tukuk-OS',
    description: 'Profil Bahasa Melayu untuk lebih 250 buah negara: ibu negara, populasi, KDNK, keluasan, mata wang, bahasa dan jiran.',
    url: 'https://tukuk.org/negara', isPartOf: { '@type': 'WebSite', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return negaraDoc({
    title: 'Senarai Negara & Profil Dunia — Ibu Negara, Populasi, Bendera | Tukuk-OS',
    desc: `Profil lengkap ${rows.length} buah negara dalam Bahasa Melayu: ibu negara, populasi & KDNK World Bank, keluasan, mata wang, bahasa, kod panggilan dan negara jiran.`,
    selfUrl: 'https://tukuk.org/negara',
    heroTitle: 'Kompleks Negara Tukuk-OS', heroSub: `${rows.length} buah negara \u00b7 6 benua \u00b7 data World Bank & world-countries, percuma tanpa daftar`,
    body, ld,
  });
}

// ─── /negara/:rantau — satu benua, kad bendera + ibu + populasi ───
function negaraRegionPage(req, region, rows) {
  const selfUrl = `https://tukuk.org/negara/${region.slug}`;
  const totalPop = rows.reduce((s, c) => s + (c.population || 0), 0);
  const most = rows.filter((x) => x.population).sort((a, b) => b.population - a.population)[0];
  const cards = rows.map((c) => `<div class="wx-card"><h3><a href="/negara/${c.slug}"><img class="ng-fl" src="${ngThumb(c.cca2)}" alt="" loading="lazy" decoding="async"> ${escapeHtml(c.bm)}</a></h3>`
    + `<div class="meta">${escapeHtml(c.capital || 'Tiada ibu negara tetap')}${c.population ? ` \u00b7 ${ngNum(c.population)} orang` : ''}</div></div>`).join('');
  const body = `<div class="wx-grid">`
    + `<div class="wx-card"><h3>Jumlah entri ${escapeHtml(region.bm)}</h3><div class="big">${rows.length}</div><div class="meta">buah negara & wilayah tersenarai</div></div>`
    + `<div class="wx-card"><h3>Populasi terhimpun</h3><div class="big">${ngNum(totalPop)}</div><div class="meta">jumlah penduduk semua entri (World Bank 2023)</div></div>`
    + `<div class="wx-card"><h3>Paling padat di ${escapeHtml(region.bm)}</h3><div class="big">${most ? `<a href="/negara/${most.slug}">${escapeHtml(most.bm)}</a>` : '—'}</div><div class="meta">${most ? ngNum(most.population) : 0} orang</div></div>`
    + `</div>`
    + `<h2 class="section-title">Semua negara di ${escapeHtml(region.bm)}</h2><div class="wx-grid">${cards || '<p>Belum ada data untuk benua ini.</p>'}</div>`
    + `<p class="meta">Bandingkan dengan benua lain melalui <a href="/negara">senarai A–Z penuh</a>, atau semak <a href="/cuaca">cuaca</a> dan <a href="/gempa">aktiviti gempa</a> di rantau ini.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Negara di ${region.bm}`,
    description: `Senarai ${rows.length} buah negara di benua ${region.bm} dengan ibu negara dan populasi.`,
    url: selfUrl,
  }).replace(/</g, '\\u003c');
  return negaraDoc({
    title: `Senarai Negara di ${region.bm} — Profil, Ibu Negara & Populasi | Tukuk-OS`,
    desc: `Semua ${rows.length} buah negara di benua ${region.bm}: bendera, ibu negara dan populasi terkini (World Bank 2023), disusun ikut abjad.`,
    selfUrl,
    heroTitle: `Negara di ${region.bm}`, heroSub: `${rows.length} buah negara \u00b7 populasi terhimpun ${ngNum(totalPop)} orang`,
    body, ld,
  });
}

// ─── /negara/:slug — profil satu negara: hero bendera, jadual statistik, jiran ───
function negaraCountryPage(req, c, rows) {
  const selfUrl = `https://tukuk.org/negara/${c.slug}`;
  const bmBySlug = {}; for (const x of rows) bmBySlug[x.slug] = x.bm;
  const regionBm = ng.REGION_BM[c.region] || c.region || '';
  const popLine = c.population ? `${ngNum(c.population)} orang${c.popRank ? ` (kedudukan ${c.popRank} dunia)` : ''}` : 'Tiada data populasi';
  const curTxt = c.currencies.length ? c.currencies.map((x) => `${x.name}${x.symbol && x.symbol !== x.code ? ` (${x.symbol})` : ''} \u2014 ${x.code}`).join(', ') : '—';
  const langTxt = c.languages.length ? c.languages.join(', ') : '—';
  const hero = `<div class="wx-hero"><img src="${c.flag}" alt="Bendera ${escapeHtml(c.bm)}" width="320" loading="eager" decoding="async" style="max-width:280px;width:45%;height:auto;border-radius:8px;border:1px solid rgba(255,255,255,.25)">`
    + `<div><div class="temp">${escapeHtml(c.bm)}</div><div class="wmeta">${escapeHtml(c.official)}<br>${escapeHtml(regionBm)}${c.subregion ? ` \u00b7 ${ngSubBm(c.subregion)}` : ''}${c.capital ? ` \u00b7 Ibu negara: <b>${escapeHtml(c.capital)}</b>` : ''}</div></div></div>`;
  const baris = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const stats = `<h2 class="section-title">Maklumat ringkas ${escapeHtml(c.bm)}</h2><table class="wx-table">`
    + baris('Nama rasmi', escapeHtml(c.official))
    + baris('Ibu negara', c.capital ? escapeHtml(c.capital) : '—')
    + baris('Benua & subwilayah', `${escapeHtml(regionBm)}${c.subregion ? ` \u00b7 ${ngSubBm(c.subregion)}` : ''}`)
    + baris('Populasi', popLine)
    + baris('Keluasan', c.area ? `${ngNum(c.area)} km²` : '—')
    + baris('Kepadatan', c.population && c.area ? `${NG_INT.format(Math.round(c.population / c.area))} orang/km²` : '—')
    + baris('KDNK (nominal)', ngGdp(c.gdp))
    + baris('Urbanisasi', c.urban == null ? '—' : `${NG_DEC.format(c.urban)}% penduduk bandar`)
    + baris('Jangka hayat', c.life == null ? '—' : `${NG_DEC.format(c.life)} tahun`)
    + baris('Mata wang', escapeHtml(curTxt))
    + baris('Bahasa', escapeHtml(langTxt))
    + baris('Domain internet', c.tld ? `<code>${escapeHtml(c.tld)}</code>` : '—')
    + baris('Kod panggilan', c.calling ? escapeHtml(c.calling) : '—')
    + baris('Status', c.independent ? 'Negara berdaulat' : 'Wilayah bergantung')
    + `</table>`;
  const jiran = c.borderSlugs.length
    ? `<h2 class="section-title">Jiran (sempadan darat)</h2><div class="ng-az">${c.borderSlugs.map((s) => `<a href="/negara/${s}">${escapeHtml(bmBySlug[s] || s)}</a>`).join('')}</div>`
    : `<h2 class="section-title">Jiran (sempadan darat)</h2><p>Tiada sempadan darat \u2014 ${c.landlocked ? 'negara pedalan' : 'negara pulau atau wilayah terpencil'}.</p>`;
  const coord = c.latlng && c.latlng.length === 2 && (c.latlng[0] || c.latlng[1]) ? `<p>Posisi geografi kira-kira <b>${NG_DEC.format(c.latlng[0])}\u00b0, ${NG_DEC.format(c.latlng[1])}\u00b0</b>.</p>` : '';
  // Pautan silang ke halaman cuti negara ini ( Complex Cuti Dunia ) jika liputan ada.
  const cutiCoun = cd.findCountry(c.cca2);
  const cutiLink = cutiCoun ? `<a href="/cuti/dunia/${cutiCoun.slug}">jadual cuti umum ${c.bm} ${CT_WORLD_YEAR}</a>` : '<a href="/cuti">cuti umum dunia</a>';
  const body = hero + stats + jiran + coord
    + `<p>Bendera: flagcdn.com; populasi, KDNK, urbanisasi & jangka hayat: <b>World Bank Open Data</b> (indikator 2023); maklumat asas: pakej open-data <b>world-countries</b> \u2014 semuanya percuma, tanpa pendaftaran.</p>`
    + `<p class="meta">Semak juga: <a href="/cuaca">cuaca mengikut kota</a> · <a href="/gempa">gempa terkini</a> · <a href="/bencana">acara alam aktif</a> · <a href="/statistik">ranking indikator dunia</a> · ${cutiLink} · <a href="/negara">senarai semua negara</a>.</p>`;
  const descBits = [
    c.capital ? `ibu negara ${c.capital}` : null,
    c.population ? `populasi ${ngNum(c.population)} orang` : null,
    c.area ? `keluasan ${ngNum(c.area)} km²` : null,
    c.gdp != null ? `KDNK ${ngGdp(c.gdp)}` : null,
  ].filter(Boolean).join(', ');
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Country', name: c.bm,
    alternateName: [c.name, c.official].filter((x, i, arr) => x && arr.indexOf(x) === i),
    description: `${c.bm} (${c.official}) — ${descBits || 'profil ringkas'}.`,
    url: selfUrl,
  }).replace(/</g, '\\u003c');
  return negaraDoc({
    title: `${c.bm} — Profil Negara: Ibu Negara, Populasi, Bendera | Tukuk-OS`,
    desc: `${c.bm} (${c.official}): ${descBits || 'profil ringkas lengkap'} — mata wang, bahasa, kod panggilan, jiran dan data World Bank 2023.`,
    selfUrl,
    heroHtml: '', heroTitle: c.bm, heroSub: c.official === c.bm ? regionBm : `${escapeHtml(regionBm)} \u00b7 ${ngSubBm(c.subregion)}`.trim(),
    body, ld,
  });
}

// ── TUKUK-OS STATISTIK COMPLEX — /statistik* (ranking dunia, World Bank) ──
// Pinjam dataset + cache src/negara.js untuk nama BM/slug/bendera; indikator
// tambahan dimuat dari World Bank Open Data (2023). Shell sama negaraDoc, hero ungu.

function stFmt(ind, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = ind.dec === 0 ? NG_INT.format(Math.round(v)) : NG_DEC.format(v);
  if (ind.unit === 'USD') return `US$${n}`;
  if (ind.unit === '%') return `${n}%`;
  return `${n} ${ind.unit}`;
}
function bestOf(ind, list) { return ind.better === 'low' ? list[list.length - 1] : list[0]; }
function worstOf(ind, list) { return ind.better === 'low' ? list[0] : list[list.length - 1]; }

const STAT_SECTIONS = [{ href: '/statistik', icon: '📊', name: 'Semua Indikator', blurb: `Ranking ${st.INDICATORS.length} indikator World Bank untuk ±200 buah negara — pop, ekonomi, kesihatan & alam.` }]
  .concat(st.INDICATORS.map((i) => ({ href: `/statistik/${i.slug}`, icon: '📈', name: i.bm, blurb: i.intro })));

function statistikNav() {
  return `<nav aria-label="Bahagian statistik"><h2 class="section-title">Jelajahi Kompleks Statistik Tukuk-OS</h2><div class="feed">`
    + STAT_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${escapeHtml(s.name)}</a></h2><p>${escapeHtml(s.blurb)}</p></div>`).join('')
    + `</div></nav>`;
}

function statistikBusy(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escapeHtml(msg)} | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>${escapeHtml(msg)}</h1><p>World Bank Open Data tidak sempat menjawab. Sila cuba lagi sebentar.</p><p><a href="/statistik">Kembali ke Kompleks Statistik</a></p></body>`;
}

function statistikDoc(o) {
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="ms_MY">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
.wx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.wx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21)}
.wx-card h3{margin:0 0 6px;font-size:.95rem;color:var(--muted,#9aa3b2);font-weight:600}
.wx-card .big{font-size:1.4rem;font-weight:700}
.wx-hero{display:flex;gap:22px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:16px 0;background:linear-gradient(135deg,#4a1d6d 0%,#0b0d12 100%);color:#fff}
.wx-hero .temp{font-size:2rem;font-weight:800;line-height:1.1}
.wx-hero .wmeta{font-size:.92rem;opacity:.92;line-height:1.5}
table.wx-table{width:100%;border-collapse:collapse;font-size:.9rem;margin:14px 0}
.wx-table th,.wx-table td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.wx-table th{background:var(--panel,#171a21)}
.ng-fl{height:16px;width:auto;vertical-align:-2px;border-radius:2px;margin-right:7px;border:1px solid var(--line)}
.st-bar{height:8px;border-radius:5px;background:linear-gradient(90deg,#8d5fd6,#4c8dff);margin-top:3px}
.st-val{min-width:180px}
@media(max-width:680px){.wx-grid{grid-template-columns:1fr}.wx-hero .temp{font-size:1.6rem}table.wx-table{display:block;overflow-x:auto}.st-val{min-width:90px}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('statistik')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${statistikNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

// ─── HAB /statistik — kad peneraju setiap indikator + posisi Malaysia ───
async function statistikHubPage(req, rows) {
  const ranks = await Promise.all(st.INDICATORS.map((i) => st.loadRanking(i, rows).catch(() => null)));
  const cards = st.INDICATORS.map((ind, k) => {
    const rk = ranks[k];
    const best = rk && rk.list.length ? bestOf(ind, rk.list) : null;
    return `<div class="wx-card"><h3><a href="/statistik/${ind.slug}">${escapeHtml(ind.bm)}</a></h3>`
      + (best ? `<div class="big">${escapeHtml(best.name)}</div><div class="meta">${stVal(ind, best.value)}</div>` : '<div class="big">—</div>')
      + (rk ? `<div class="meta">${rk.stats.n} buah negara bernilai data</div>` : '<div class="meta">sumber belum sempat dimuat</div>') + '</div>';
  }).join('');
  const my = rows.find((c) => c.slug === 'malaysia');
  let myTable = '';
  if (my) {
    const baris = st.INDICATORS.map((ind, k) => {
      const rk = ranks[k];
      const e = rk ? rk.list.find((x) => x.cca3 === my.cca3) : null;
      return `<tr><td><a href="/statistik/${ind.slug}">${escapeHtml(ind.bm)}</a></td><td>${e ? stVal(ind, e.value) : '—'}</td><td>${e ? `#${e.rank} daripada ${rk.stats.n}` : '—'}</td><td>${ind.yr || 2023}</td></tr>`;
    }).join('');
    myTable = `<h2 class="section-title">Malaysia mengikut indikator</h2><table class="wx-table"><tr><th>Indikator</th><th>Nilai</th><th>Kedudukan dunia</th><th>Tahun data</th></tr>${baris}</table>`;
  }
  const okCount = ranks.filter((r) => r && r.list.length).length;
  const body = `<div class="wx-hero"><div class="temp">${st.INDICATORS.length} indikator &middot; ±${rows.length} buah negara</div><div class="wmeta">Ranking dunia dalam Bahasa Melayu — sumber World Bank Open Data (indikator 2023), percuma tanpa pendaftaran. ${okCount} indikator siap dimuat.</div></div>`
    + `<h2 class="section-title">Peneraju setiap indikator</h2><div class="wx-grid">${cards}</div>`
    + myTable
    + `<h2 class="section-title">Bagaimana data ini disusun</h2><p>World Bank mengumpulkan statistik rasmi setiap kerajaan ahli — penduduk, ekonomi, kesihatan, pendidikan dan alam sekitar — lalu menyiapkannya sebagai JSON awam tanpa kunci API. Kami memuatnya sekali sebulan, membandingkan nilai antarabangsa, dan memaparkan ranking yang paling bermakna untuk pembaca Malaysia. Nilai kosong bererti negara itu tidak melapor indikator berkenaan pada 2023.</p>`
    + `<p class="meta">Profil penuh setiap negara ada di <a href="/negara">Kompleks Negara</a>; perbandingan hujung-minggu cuti di <a href="/cuti">Kompleks Cuti</a>; keadaan langit langsung di <a href="/cuaca">Kompleks Cuaca</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Kompleks Statistik Tukuk-OS',
    description: 'Ranking World Bank bagi populasi, KDNK, jangka hayat, internet, literasi, CO2 dan lebih 10 indikator lain untuk ±200 buah negara.',
    url: 'https://tukuk.org/statistik',
  }).replace(/</g, '\\u003c');
  return statistikDoc({
    title: 'Statistik Dunia — Ranking 14 Indikator Negara (Populasi, KDNK, CO₂) | Tukuk-OS',
    desc: `Ranking ${st.INDICATORS.length} indikator World Bank 2023 untuk ±200 buah negara dalam Bahasa Melayu: populasi, KDNK sekepala, jangka hayat, internet, literasi, CO₂, hutan dan posisi Malaysia.`,
    selfUrl: 'https://tukuk.org/statistik',
    heroTitle: 'Kompleks Statistik Tukuk-OS', heroSub: 'World Bank Open Data 2023 · tanpa kunci · dikemas kini sebulan sekali',
    body, ld,
  });
}
function stVal(ind, v) { return stFmt(ind, v); }

// ─── /statistik/:indikator — jadual ranking penuh + bar + statistik taburan ───
function statistikIndPage(req, rk, rows) {
  const ind = rk.ind; const list = rk.list; const stats = rk.stats;
  const yr = ind.yr || 2023;
  const selfUrl = `https://tukuk.org/statistik/${ind.slug}`;
  const best = bestOf(ind, list); const worst = worstOf(ind, list);
  const bestLabel = ind.better === 'low' ? 'Paling rendah (baik)' : 'Paling tinggi';
  const worstLabel = ind.better === 'low' ? 'Paling tinggi (buruk)' : 'Paling rendah';
  const maxAbs = Math.max(Math.abs(stats.max || 0), Math.abs(stats.min || 0), 1e-9);
  const arahTxt = ind.better === 'low' ? 'nilai yang lebih rendah dianggap lebih baik' : ind.better === 'high' ? 'nilai yang lebih tinggi dianggap lebih baik' : 'indikator neutral — kedua-dua hujung ada ceritanya';
  const my = rows.find((c) => c.slug === 'malaysia');
  const myEntry = my ? list.find((x) => x.cca3 === my.cca3) : null;
  const top = list.slice(0, 50);
  const baris = top.map((x) => `<tr><td>${x.rank}</td><td class="st-val"><a href="/negara/${x.slug}"><img class="ng-fl" src="${ngThumb(x.cca2)}" alt="" loading="lazy" decoding="async"> ${escapeHtml(x.name)}</a><div class="st-bar" style="width:${Math.max(2, Math.round(Math.abs(x.value) / maxAbs * 100))}%"></div></td><td><b>${stVal(ind, x.value)}</b></td></tr>`).join('');
  const myNote = myEntry && myEntry.rank > 50 ? `<p class="meta">Posisi Malaysia: <b>#${myEntry.rank}</b> daripada ${stats.n} buah negara dengan nilai ${stVal(ind, myEntry.value)} — lihat jadual penuh peneraju di bawah.</p>` : '';
  const cards = `<div class="wx-grid">`
    + `<div class="wx-card"><h3>${escapeHtml(bestLabel)}</h3><div class="big">${escapeHtml(best.name)}</div><div class="meta">${stVal(ind, best.value)}</div></div>`
    + `<div class="wx-card"><h3>Purata dunia</h3><div class="big">${stVal(ind, stats.avg)}</div><div class="meta">median ${stVal(ind, stats.median)}</div></div>`
    + `<div class="wx-card"><h3>${escapeHtml(worstLabel)}</h3><div class="big">${escapeHtml(worst.name)}</div><div class="meta">${stVal(ind, worst.value)}</div></div>`
    + `</div>`;
  const body = `<div class="wx-hero"><div class="temp">${escapeHtml(best.name)}</div><div class="wmeta">Peneraju ${escapeHtml(ind.bm)} ${yr} · ${stVal(ind, best.value)} · ${stats.n} buah negara dilaporkan ke World Bank</div></div>`
    + `<p>${escapeHtml(ind.intro)}</p>`
    + cards + myNote
    + `<h2 class="section-title">50 negara — ${escapeHtml(ind.bm)}</h2><p class="meta">Disusun mengikut nilai tertinggi dahulu (${arahTxt}), tahun data ${yr}. Bendera: flagcdn; nama negara paut ke profil penuhnya.</p>`
    + `<table class="wx-table"><tr><th>#</th><th>Negara</th><th>Nilai</th></tr>${baris}</table>`
    + `<h2 class="section-title">Taburan global</h3><table class="wx-table"><tr><th>Statistik</th><th>Nilai</th></tr>`
    + `<tr><th>Bilangan negara</th><td>${stats.n}</td></tr>`
    + `<tr><th>Terendah</th><td>${stVal(ind, stats.min)} (${escapeHtml(list[list.length - 1].name)})</td></tr>`
    + `<tr><th>Tertinggi</th><td>${stVal(ind, stats.max)} (${escapeHtml(list[0].name)})</td></tr></table>`
    + `<p>Sumber: <b>World Bank Open Data</b>${ind.code ? ` (indikator <code>${escapeHtml(ind.code)}</code>, tahun ${yr})` : ' — pinjam daripada dataset Kompleks Negara'} — data awam tanpa kunci API, dillesen CC BY 4.0. Profil penuh setiap negara: <a href="/negara">Kompleks Negara</a> · berita alam langsung: <a href="/bencana">Kompleks Bencana</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Dataset', name: `${ind.bm} — ranking dunia ${yr}`,
    description: ind.intro, url: selfUrl,
    creator: { '@type': 'Organization', name: 'World Bank', url: 'https://data.worldbank.org' },
    temporalCoverage: String(yr), license: 'https://creativecommons.org/licenses/by/4.0/',
  }).replace(/</g, '\\u003c');
  return statistikDoc({
    title: `${ind.bm} — Ranking Dunia ${yr} (50 Negara Teratas) | Tukuk-OS`,
    desc: `Ranking ${ind.bm} ${yr}: ${escapeHtml(best.name)} di tangga pertama (${stVal(ind, best.value)}), purata dunia ${stVal(ind, stats.avg)}${myEntry ? `, Malaysia #${myEntry.rank}` : ''}. Data World Bank Open Data.`,
    selfUrl,
    heroTitle: `${ind.bm} — Ranking Dunia`, heroSub: `World Bank Open Data ${yr} · ${stats.n} buah negara · unit: ${ind.unit}`,
    body, ld,
  });
}

// ── TUKUK-OS BENCANA COMPLEX — /bencana* (pemantau acara alam NASA EONET) ──
// Shell sama, hero merah-lava; halaman kategori + setiap acara masih "open".

const BENCANA_SECTIONS = [{ href: '/bencana', icon: '🚨', name: 'Semua Peristiwa', blurb: 'Pantau semua acara alam yang sedang berlaku di planet ini — langsung dari satelit NASA EONET.' }]
  .concat(bc.CATS.map((c) => ({ href: `/bencana/${c.slug}`, icon: c.icon, name: c.bm, blurb: c.blurb })));

function bencanaNav() {
  return `<nav aria-label="Bahagian bencana"><h2 class="section-title">Jelajahi Kompleks Bencana Tukuk-OS</h2><div class="feed">`
    + BENCANA_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${escapeHtml(s.name)}</a></h2><p>${escapeHtml(s.blurb)}</p></div>`).join('')
    + `</div></nav>`;
}

function bencanaBusy(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escapeHtml(msg)} | Tukuk-OS</title><body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:64px auto;padding:20px;line-height:1.6"><h1>${escapeHtml(msg)}</h1><p>NASA EONET tidak sempat menjawab. Suapan ini di-cache beberapa jam — sila cuba lagi sebentar.</p><p><a href="/bencana">Kembali ke Kompleks Bencana</a></p></body>`;
}

function bencanaDoc(o) {
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta property="og:locale" content="ms_MY">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
.wx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.wx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel,#171a21)}
.wx-card h3{margin:0 0 6px;font-size:.95rem;color:var(--muted,#9aa3b2);font-weight:600}
.wx-card .big{font-size:1.4rem;font-weight:700}
.wx-hero{display:flex;gap:22px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:16px 0;background:linear-gradient(135deg,#6d1f12 0%,#0b0d12 100%);color:#fff}
.wx-hero .temp{font-size:2rem;font-weight:800;line-height:1.1}
.wx-hero .wmeta{font-size:.92rem;opacity:.92;line-height:1.5}
table.wx-table{width:100%;border-collapse:collapse;font-size:.9rem;margin:14px 0}
.wx-table th,.wx-table td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.wx-table th{background:var(--panel,#171a21)}
.bc-svg{width:100%;max-width:720px;height:auto;border:1px solid var(--line);border-radius:10px;display:block;margin:14px auto;background:#0a1020}
@media(max-width:680px){.wx-grid{grid-template-columns:1fr}.wx-hero .temp{font-size:1.6rem}table.wx-table{display:block;overflow-x:auto}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('bencana')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${bencanaNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

const BC_DATE_FMT = new Intl.DateTimeFormat('ms-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function bcDate(iso) { try { return BC_DATE_FMT.format(new Date(iso)); } catch { return '—'; } }
function bcLatest(ev) { return ev.updated || ev.created || (ev.geometries && ev.geometries.length ? ev.geometries[ev.geometries.length - 1].date : null) || null; }

// ─── HAB /bencana — kiraan langsung setiap kategori + acara terkini ───
function bencanaHubPage(req, all) {
  const totalOpen = all.reduce((s, x) => s + (x.events ? x.events.length : 0), 0);
  const cards = all.map((x) => {
    const latest = x.events && x.events.length ? [...x.events].sort((a, b) => String(bcLatest(b) || '').localeCompare(String(bcLatest(a) || '')))[0] : null;
    return `<div class="wx-card"><h3>${x.cat.icon} <a href="/bencana/${x.cat.slug}">${escapeHtml(x.cat.bm)}</a></h3>`
      + `<div class="big">${x.events ? x.events.length : '—'}</div>`
      + `<div class="meta">acara masih dibuka${latest ? ` · terkini: <a href="/bencana/${x.cat.slug}/${encodeURIComponent(latest.id)}">${escapeHtml(String(latest.title || '').slice(0, 48))}</a>` : ''}</div></div>`;
  }).join('');
  const flat = [];
  for (const x of all) if (x.events) for (const ev of x.events) flat.push({ cat: x.cat, ev });
  flat.sort((a, b) => String(bcLatest(b.ev) || '').localeCompare(String(bcLatest(a.ev) || '')));
  const rowsHtml = flat.slice(0, 15).map(({ cat, ev }) => {
    const g = ev.geometries && ev.geometries.length ? ev.geometries[ev.geometries.length - 1] : null;
    const loc = g ? bc.geoLabel(g.coordinates) : null;
    return `<tr><td>${bcDate(bcLatest(ev))}</td><td>${cat.icon} <a href="/bencana/${cat.slug}">${escapeHtml(cat.bm)}</a></td><td><a href="/bencana/${cat.slug}/${encodeURIComponent(ev.id)}">${escapeHtml(String(ev.title || ev.id))}</a></td><td>${loc ? escapeHtml(loc.text) : '—'}</td></tr>`;
  }).join('');
  const body = `<div class="wx-hero"><div class="temp">${totalOpen} acara alam sedang berlaku</div><div class="wmeta">Dipantau 24/7 oleh NASA EONET · ${bc.CATS.length} kategori · kemas kini beberapa kali sehari · tanpa pendaftaran</div></div>`
    + `<h2 class="section-title">Kategori pemantauan</h2><div class="wx-grid">${cards}</div>`
    + `<h2 class="section-title">15 acara paling terkini dikemas kini</h2><table class="wx-table"><tr><th>Kemas kini</th><th>Kategori</th><th>Peristiwa</th><th>Lokasi terakhir</th></tr>${rowsHtml}</table>`
    + `<h2 class="section-title">Apa itu EONET?</h2><p>EONET (Earth Observatory Natural Event Tracker) ialah suapan terbuka NASA yang merekod setiap peristiwa alam penting di dunia — letusan gunung berapi, taufan, kebakaran lahan, banjir, tanah runtuh dan lebih banyak lagi — dengan koordinat satelit dan laporan kurator manusia. Data ini awam, tanpa kunci API; kami memaparkannya dalam Bahasa Melayu dan memautkan setiap peristiwa ke halaman sendiri supaya boleh dirujuk.</p>`
    + `<p class="meta">Gempa bumi langsung ada di <a href="/gempa">Kompleks Gempa (USGS)</a>; langit kota anda di <a href="/cuaca">Kompleks Cuaca</a>; profil negara terjejas di <a href="/negara">Kompleks Negara</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Kompleks Bencana Tukuk-OS',
    description: 'Pemantau langsung gunung berapi, taufan, kebakaran lahan, banjir dan acara alam lain — suapan NASA EONET dalam Bahasa Melayu.',
    url: 'https://tukuk.org/bencana',
  }).replace(/</g, '\\u003c');
  return bencanaDoc({
    title: 'Bencana Dunia Langsung — Gunung Berapi, Taufan, Kebakaran (NASA EONET) | Tukuk-OS',
    desc: `${totalOpen} acara alam sedang berlaku di planet ini: pantau gunung berapi, taufan, kebakaran lahan, banjir, kemarau dan tanah runtuh — langsung dari NASA EONET, dalam Bahasa Melayu.`,
    selfUrl: 'https://tukuk.org/bencana',
    heroTitle: 'Kompleks Bencana Tukuk-OS', heroSub: `Suapan NASA EONET · ${totalOpen} acara dibuka · kemas kini ${bcDate(new Date().toISOString())}`,
    body, ld,
  });
}

// ─── /bencana/:kategori — semua acara dibuka dalam satu kategori ───
function bencanaCatPage(req, cat, events) {
  const selfUrl = `https://tukuk.org/bencana/${cat.slug}`;
  const sorted = [...events].sort((a, b) => String(bcLatest(b) || '').localeCompare(String(bcLatest(a) || '')));
  const rowsHtml = sorted.map((ev) => {
    const geo = ev.geometries || [];
    const last = geo.length ? bc.geoLabel(geo[geo.length - 1].coordinates) : null;
    return `<tr><td><a href="/bencana/${cat.slug}/${encodeURIComponent(ev.id)}">${escapeHtml(String(ev.title || ev.id))}</a></td><td>${bcDate(ev.created)}</td><td>${bcDate(bcLatest(ev))}</td><td>${geo.length}</td><td>${last ? escapeHtml(last.text) : '—'}</td></tr>`;
  }).join('');
  const body = `<div class="wx-hero"><div class="temp">${cat.icon} ${sorted.length} acara ${escapeHtml(cat.bm).toLowerCase()} sedang aktif</div><div class="wmeta">Kemas kini langsung NASA EONET · setiap acara ada halaman sendiri dengan koordinat &amp; garis masa</div></div>`
    + `<p>${escapeHtml(cat.blurb)}</p>`
    + (sorted.length
      ? `<h2 class="section-title">Senarai acara dibuka</h2><table class="wx-table"><tr><th>Peristiwa</th><th>Bermula</th><th>Kemas kini</th><th>Lokasi direkod</th><th>Koordinat terakhir</th></tr>${rowsHtml}</table>`
      : '<p>Tiada acara yang masih dibuka dalam kategori ini sekarang. Semak <a href="/bencana">hab semua kategori</a>.</p>')
    + `<p class="meta">Data mentah: <a rel="noopener" target="_blank" href="https://eonet.gsfc.nasa.gov">eonet.gsfc.nasa.gov</a> (domain awam NASA). Cuaca semasa di kawasan terjejas: <a href="/cuaca">Kompleks Cuaca</a>; gempa tektonik: <a href="/gempa">Kompleks Gempa</a>.</p>`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Acara ${cat.bm} — langsung`,
    description: cat.blurb.slice(0, 200), url: selfUrl,
  }).replace(/</g, '\\u003c');
  return bencanaDoc({
    title: `${cat.bm} Langsung — Acara Aktif Dunia Hari Ini | Tukuk-OS`,
    desc: sorted.length ? `${sorted.length} acara ${cat.bm.toLowerCase()} masih dibuka sekarang — kemas kini langsung NASA EONET dengan koordinat, tarikh dan pautan sumber rasmi.` : `Pantau berita ${cat.bm.toLowerCase()} langsung daripada NASA EONET — dengan koordinat dan garis masa setiap peristiwa.`,
    selfUrl,
    heroTitle: `${cat.icon} ${cat.bm}`, heroSub: `Suapan langsung NASA EONET · ${sorted.length} acara dibuka · dikemas kini ${bcDate(new Date().toISOString())}`,
    body, ld,
  });
}

// ─── /bencana/:kategori/:id — satu acara: peta SVG + garis masa koordinat ───
function bencanaEventPage(req, cat, ev) {
  const selfUrl = `https://tukuk.org/bencana/${cat.slug}/${encodeURIComponent(ev.id)}`;
  const geo = (ev.geometries || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const dots = geo.map((g) => {
    const loc = bc.geoLabel(g.coordinates);
    if (!loc) return '';
    const cx = ((loc.lng + 180) / 360) * 720; const cy = ((90 - loc.lat) / 180) * 360;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="#ff7043" opacity="0.85"><title>${escapeHtml(bcDate(g.date))} · ${escapeHtml(loc.text)}</title></circle>`;
  }).join('');
  const grid = [];
  for (let lng = -180; lng <= 180; lng += 60) grid.push(`<line x1="${((lng + 180) / 360) * 720}" y1="0" x2="${((lng + 180) / 360) * 720}" y2="360" stroke="#243044" stroke-width="1">`);
  for (let lat = -90; lat <= 90; lat += 30) grid.push(`<line x1="0" y1="${((90 - lat) / 180) * 360}" x2="720" y2="${((90 - lat) / 180) * 360}" stroke="#243044" stroke-width="1">`);
  const map = geo.length ? `<svg class="bc-svg" viewBox="0 0 720 360" role="img" aria-label="Peta lokasi ${escapeHtml(String(ev.title || ''))}">${grid.join('')}${dots}</svg>` : '';
  const timeline = geo.map((g) => {
    const loc = bc.geoLabel(g.coordinates);
    return `<tr><td>${bcDate(g.date)}</td><td>${loc ? escapeHtml(loc.text) : '—'}</td><td>${escapeHtml(String(g.type || 'point'))}</td></tr>`;
  }).join('');
  const srcs = (ev.sources || []).map((s) => `<li><a rel="noopener" target="_blank" href="${escapeHtml(String(s.url || '#'))}">${escapeHtml(String(s.id || 'sumber'))}</a></li>`).join('');
  const desc = ev.description ? `<p>${escapeHtml(String(ev.description))}</p>` : '';
  const first = geo.length ? geo[0] : null;
  const last = geo.length ? geo[geo.length - 1] : null;
  const body = `<p class="back-link"><a href="/bencana">&larr; Kompleks Bencana</a> · <a href="/bencana/${cat.slug}">${cat.icon} ${escapeHtml(cat.bm)}</a></p>`
    + `<div class="wx-hero"><div class="temp">${cat.icon} ${escapeHtml(String(ev.title || ev.id))}</div><div class="wmeta">${escapeHtml(cat.bm)} · bermula ${bcDate(ev.created)}${last ? ` · kemas kini terakhir ${bcDate(bcLatest(ev))}` : ''} · ${geo.length} lokasi direkod</div></div>`
    + desc + map
    + (first && last && first !== last ? `<p>Peristiwa ini bermula di ${escapeHtml((bc.geoLabel(first.coordinates) || {}).text || '—')} dan kini aktif di ${escapeHtml((bc.geoLabel(last.coordinates) || {}).text || '—')}.</p>` : (last ? `<p>Kedudukan terkini: <b>${escapeHtml((bc.geoLabel(last.coordinates) || {}).text || '—')}</b>.</p>` : ''))
    + (timeline ? `<h2 class="section-title">Garis masa lokasi</h2><table class="wx-table"><tr><th>Tarikh</th><th>Koordinat</th><th>Jenis</th></tr>${timeline}</table>` : '')
    + (srcs ? `<h2 class="section-title">Sumber laporan</h2><ul>${srcs}</ul>` : '')
    + `<p class="meta">Data: NASA EONET (domain awam) · ${escapeHtml(cat.blurb.split('.')[0])}. Semak keadaan langit di kawasan terjejas: <a href="/cuaca">Kompleks Cuaca</a>; aktiviti tektonik: <a href="/gempa">Kompleks Gempa</a>; negara berkenaan: <a href="/negara">Kompleks Negara</a>.</p>`;
  const lastLoc = last ? bc.geoLabel(last.coordinates) : null;
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Event', name: String(ev.title || ev.id),
    description: String(ev.description || cat.blurb).slice(0, 300), url: selfUrl,
    startDate: ev.created || undefined, endDate: ev.closed || undefined,
    eventStatus: ev.closed ? 'EventCancelled' : 'EventOngoing',
    location: lastLoc ? { '@type': 'Place', name: `${cat.bm} — ${lastLoc.text}`, geo: { '@type': 'GeoCoordinates', latitude: lastLoc.lat, longitude: lastLoc.lng } } : undefined,
  }).replace(/</g, '\\u003c');
  return bencanaDoc({
    title: `${String(ev.title || ev.id)} — Status Langsung ${cat.bm} | Tukuk-OS`,
    desc: `${ev.title || cat.bm}: koordinat, tarikh bermula dan garis masa lokasi langsung daripada NASA EONET — ${geo.length} rekod, dikemas kini ${bcDate(bcLatest(ev))}.`,
    selfUrl,
    heroTitle: String(ev.title || ev.id), heroSub: `${escapeHtml(cat.bm)} · suapan langsung NASA EONET`,
    body, ld,
  });
}

// ── TUKUK-OS WIKI — gaya Ensiklopedia (MediaWiki-esque)) ────────────────────
// Portal pengetahuan bergaya Wikipedia: bar sisi navigasi, Jadual Kandungan (TOC)
// auto, infobox, bar kategori & carian dalaman. Artikel wiki memaparkan semula post
// blog sedia ada dalam rupa wiki — halaman konten yang boleh di-index + beriklan.
// Rupa sengaja CAHAYA (tidak ikut togel tema gelap) untuk imej ensiklopedia tulen.
const WIKI_CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#fff;color:#202122;font:15px/1.6 -apple-system,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:#3366cc;text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1280px;margin:0 auto;padding:0 16px}
  .wiki-topbar{display:flex;align-items:center;gap:14px;border-bottom:1px solid #a2a9b1;padding:10px 0;flex-wrap:wrap}
  .wiki-wordmark{font-family:Georgia,"Times New Roman",serif;font-size:1.3rem;color:#202122;letter-spacing:-.3px}
  .wiki-wordmark:hover{text-decoration:none}
  .wiki-wordmark b{font-weight:700}
  .wiki-search{margin-left:auto;display:flex}
  .wiki-search input{padding:7px 10px;border:1px solid #a2a9b1;border-radius:2px 0 0 2px;font:inherit;min-width:230px;background:#fff;color:#202122}
  .wiki-search button{padding:7px 14px;border:1px solid #a2a9b1;border-left:0;border-radius:0 2px 2px 0;background:#f8f9fa;color:#202122;cursor:pointer}
  .wiki-body{display:flex;gap:28px;margin:20px 0;align-items:flex-start}
  .wiki-side{flex:0 0 190px;font-size:.86rem;position:sticky;top:12px}
  .wiki-side h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;color:#54595d;margin:16px 0 6px;border-bottom:1px solid #c8ccd1;padding-bottom:4px}
  .wiki-side ul{list-style:none;margin:0;padding:0}
  .wiki-side li{margin:0 0 6px}
  .wiki-content{flex:1 1 auto;min-width:0}
  .wiki-content h1{font-family:Georgia,serif;font-weight:400;font-size:1.95rem;border-bottom:1px solid #a2a9b1;padding-bottom:6px;margin:0 0 4px}
  .wiki-from{color:#54595d;font-size:.92rem;margin:0 0 18px}
  .wiki-content h2{font-family:Georgia,serif;font-weight:400;font-size:1.45rem;border-bottom:1px solid #c8ccd1;padding-bottom:4px;margin:28px 0 12px}
  .wiki-content h3{font-size:1.12rem;font-weight:700;margin:18px 0 8px}
  .wiki-content p{line-height:1.7;margin:0 0 14px}
  .wiki-content ul,.wiki-content ol{line-height:1.7;padding-left:26px;margin:0 0 14px}
  .wiki-toc{background:#f8f9fa;border:1px solid #c8ccd1;padding:12px 18px;display:inline-block;min-width:240px;margin:6px 0 20px;font-size:.9rem}
  .wiki-toc .toc-title{font-weight:700;text-align:center;display:block;margin-bottom:8px}
  .wiki-toc ol{margin:0;padding-left:22px}
  .wiki-toc li{margin:3px 0}
  .infobox{float:right;clear:right;width:260px;margin:0 0 14px 22px;border:1px solid #a2a9b1;border-collapse:collapse;background:#f8f9fa;font-size:.85rem}
  .infobox caption,.infobox .ib-title{background:#eaecf0;font-weight:700;text-align:center;padding:9px;font-size:.95rem;border-bottom:1px solid #a2a9b1}
  .infobox th{text-align:left;color:#54595d;padding:6px 9px;border-top:1px solid #eaecf0;vertical-align:top;width:38%}
  .infobox td{padding:6px 9px;border-top:1px solid #eaecf0}
  .wiki-catbar{border:1px solid #c8ccd1;background:#f8f9fa;padding:9px 13px;margin-top:26px;font-size:.88rem;clear:both}
  .wiki-catbar b{color:#54595d}
  .wiki-featured{border:1px solid #c8ccd1;background:#f8f9fa;padding:16px 18px;margin:18px 0}
  .wiki-featured h2{border:0;font-size:1.15rem;margin:0 0 8px}
  .wiki-sections{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
  .wiki-topic{border:1px solid #c8ccd1;border-radius:3px;padding:14px 16px;background:#fff}
  .wiki-topic h3{margin:0 0 8px;font-size:1rem}
  .wiki-topic ul{margin:0;padding-left:18px}
  .wiki-topic li{margin:3px 0;font-size:.92rem}
  @media(max-width:860px){.wiki-body{flex-direction:column}.wiki-side{position:static;flex-basis:auto;width:100%}.infobox{float:none;width:100%;margin:0 0 16px}.wiki-sections{grid-template-columns:1fr}}
`;

function wikiHead(title, selfUrl, desc, jsonLd, robots) {
  const rb = robots || 'index,follow';
  const ld = jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(desc)}">` +
    `<meta name="robots" content="${rb}">` +
    `<meta property="og:type" content="article"><meta property="og:site_name" content="Tukuk-OS Wiki">` +
    `<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(desc)}">` +
    `<meta property="og:url" content="${selfUrl}"><meta property="og:image" content="https://tukuk.org/og.png">` +
    `<link rel="canonical" href="${selfUrl}">` +
    `<meta name="google-adsense-account" content="ca-pub-8954948214333501">` +
    `<link rel="icon" href="/icon.svg" type="image/svg+xml">` +
    `<link rel="alternate" type="application/rss+xml" title="Tukuk-OS Blog" href="/blog/rss.xml">` +
    ld + `<style>${WIKI_CSS}</style>${pageAdScript()}${clarityScript()}</head><body>`;
}

function wikiTopbar() {
  return `<div class="wrap"><div class="wiki-topbar">` +
    `<a class="wiki-wordmark" href="/wiki"><b>Tukuk-OS</b> Wiki</a>` +
    `<form class="wiki-search" action="/wiki" method="get" role="search">` +
    `<input type="search" name="q" placeholder="Search the wiki" aria-label="Search the wiki">` +
    `<button type="submit">Search</button></form></div>`;
}

function wikiSidebar() {
  const posts = store.getAllPosts(300);
  const subjects = [...new Set(posts.flatMap((p) => p.tags || []))].slice(0, 9);
  return `<nav class="wiki-side" aria-label="Wiki navigation">` +
    `<h3>Navigation</h3><ul>` +
    `<li><a href="/wiki">Main page</a></li>` +
    `<li><a href="/wiki/random">Random article</a></li>` +
    `<li><a href="/blog">All articles</a></li>` +
    `<li><a href="/learn">Learning path</a></li>` +
    `<li><a href="/about">About</a></li>` +
    `<li><a href="/contact">Contact</a></li></ul>` +
    `<h3>Subjects</h3><ul>` +
    (subjects.length ? subjects.map((s) => `<li><a href="/wiki?q=${encodeURIComponent(s)}">${escapeHtml(s)}</a></li>`).join('') : '<li><a href="/wiki">General</a></li>') +
    `</ul><h3>Tools</h3><ul>` +
    `<li><a href="/sitemap.xml">Sitemap</a></li>` +
    `<li><a href="/blog/rss.xml">RSS feed</a></li>` +
    `<li><a href="/nasa">Today\u2019s NASA picture</a></li></ul></nav>`;
}

function wikiFooter() {
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="wrap"><footer class="wiki-catbar" style="border:0;border-top:1px solid #c8ccd1;text-align:center;margin:30px 0 40px">` +
    `<div>This page was last edited on ${today}. Written for the Tukuk-OS Wiki \u2014 free, no account needed. See our <a href="/privacy">privacy</a> &amp; <a href="/terms">terms</a>.</div>` +
    `<div style="margin-top:8px"><a href="/">Home</a> \u00b7 <a href="/wiki">Wiki</a> \u00b7 <a href="/blog">Blog</a> \u00b7 <a href="/learn">Learn</a> \u00b7 <a href="/docs">Docs</a> \u00b7 <a href="/about">About</a></div>` +
    `</footer></div>`;
}

// Tambah id pada <h2>/<h3> dalam HTML artikel + bina Jadual Kandungan (TOC).
function wikiTocify(html) {
  const headings = [];
  let idx = 0;
  const withIds = String(html).replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (m, tag, text) => {
    idx += 1;
    const id = 'sec-' + idx;
    const label = String(text).replace(/<[^>]*>/g, '').trim();
    if (label) headings.push({ id, label });
    return '<' + tag + ' id="' + id + '">' + text + '</' + tag + '>';
  });
  if (!headings.length) return { html: withIds, toc: '' };
  const items = headings.map((h, i) => `<li><a href="#${h.id}">${i + 1}. ${escapeHtml(h.label)}</a></li>`).join('');
  return { html: withIds, toc: `<div class="wiki-toc"><span class="toc-title">Contents</span><ol>${items}</ol></div>` };
}

function wikiMainPage(req) {
  const posts = store.getAllPosts(300);
  const featured = posts[0];
  const byTag = {};
  for (const p of posts) { const k = (p.tags && p.tags[0]) || 'General'; (byTag[k] = byTag[k] || []).push(p); }
  const topics = Object.entries(byTag).slice(0, 8).map(([tag, list]) =>
    `<div class="wiki-topic"><h3><a href="/wiki?q=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a></h3>` +
    `<ul>${list.slice(0, 6).map((p) => `<li><a href="/wiki/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></li>`).join('')}</ul></div>`).join('');
  const feat = featured
    ? `<div class="wiki-featured"><h2>Featured article</h2><p><a href="/wiki/${encodeURIComponent(featured.slug)}"><b>${escapeHtml(featured.title)}</b></a> \u2014 ${escapeHtml(featured.excerpt || '')}</p></div>` : '';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebSite', 'name': 'Tukuk-OS Wiki', 'url': 'https://tukuk.org/wiki',
    'description': 'A free, wiki-style knowledge base on technology, privacy, astronomy and the open web.',
    'publisher': { '@type': 'Organization', 'name': 'Tukuk-OS', 'url': 'https://tukuk.org' },
    'potentialAction': { '@type': 'SearchAction', 'target': 'https://tukuk.org/wiki?q={query}', 'query-input': 'required name=query' }
  }).replace(/</g, '&lt;');
  return wikiHead('Tukuk-OS Wiki \u2014 the free knowledge base', 'https://tukuk.org/wiki',
    'Encyclopedic articles on technology, privacy, servers, astronomy and the open web, in a classic wiki layout \u2014 free to read, no account needed.', jsonLd)
    + wikiTopbar() + `<div class="wrap"><div class="wiki-body">${wikiSidebar()}<main class="wiki-content">` +
    `<h1>Welcome to the Tukuk-OS Wiki</h1>` +
    `<p class="wiki-from">From Tukuk-OS, the free knowledge base \u2014 ${posts.length} articles you can read without an account.</p>` +
    `<p>The Tukuk-OS Wiki is a growing encyclopedia of practical knowledge: how search engines really work, running your own server, privacy without tracking, astronomy, programming and the open web \u2014 written in plain language and freely readable.</p>` +
    feat + `${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}` +
    `<h2>Subject areas</h2><div class="wiki-sections">${topics}</div>` +
    `${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}` +
    `<h2>Good to know</h2><p>Perlu data langsung? <a href="/cuaca">Cuaca hari ini</a> untuk ratusan bandar dan <a href="/nasa">NASA Picture of the Day</a> untuk langit — kedua-duanya kemas kini automatik. Litar pembelajaran tersusun ada di <a href="/learn">Tukuk-OS Academy</a>.</p>` +
    `${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}` +
    `</main></div>${wikiFooter()}</body></html>`;
}

function wikiArticlePage(req, post) {
  const url = 'https://tukuk.org/wiki/' + encodeURIComponent(post.slug);
  const tags = post.tags || [];
  const dateLabel = new Date(post.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const revised = post.updatedAt ? new Date(post.updatedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const t = wikiTocify(renderMarkdown(post.content));
  const infobox = `<table class="infobox"><caption>${escapeHtml(post.title)}</caption>` +
    `<tr><th>Type</th><td>Encyclopedia article</td></tr>` +
    `<tr><th>Subject</th><td>${tags.length ? escapeHtml(tags[0]) : 'General knowledge'}</td></tr>` +
    `<tr><th>Author</th><td>${escapeHtml(post.author || 'Fevian Donald')}</td></tr>` +
    `<tr><th>Published</th><td>${dateLabel}</td></tr>` +
    (revised ? `<tr><th>Revised</th><td>${revised}</td></tr>` : '') +
    `<tr><th>License</th><td>Free to read &amp; cite</td></tr></table>`;
  const related = store.getAllPosts(300)
    .filter((p) => p.slug !== post.slug && (p.tags || []).some((tg) => tags.includes(tg)))
    .slice(0, 6);
  const seeAlso = related.length
    ? `<h2>See also</h2><ul>${related.map((p) => `<li><a href="/wiki/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></li>`).join('')}</ul>` : '';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article', 'headline': post.title, 'description': post.excerpt,
    'author': { '@type': 'Person', 'name': post.author || 'Fevian Donald' }, 'datePublished': post.createdAt,
    'dateModified': post.updatedAt || post.createdAt, 'inLanguage': 'en',
    'publisher': { '@type': 'Organization', 'name': 'Tukuk-OS Wiki', 'url': 'https://tukuk.org' },
    'mainEntityOfPage': url, 'isPartOf': { '@type': 'WebSite', 'name': 'Tukuk-OS Wiki', 'url': 'https://tukuk.org/wiki' }
  }).replace(/</g, '&lt;');
  return wikiHead(post.title + ' \u2014 Tukuk-OS Wiki', url, post.excerpt || post.title, jsonLd)
    + wikiTopbar() + `<div class="wrap"><div class="wiki-body">${wikiSidebar()}<main class="wiki-content">` +
    `<h1>${escapeHtml(post.title)}</h1>` +
    `<p class="wiki-from">From <a href="/wiki">Tukuk-OS Wiki</a>, the free knowledge base.</p>` +
    infobox + `<p>${escapeHtml(post.excerpt || '')}</p>${t.toc}` +
    `${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}` +
    t.html +
    `${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}` + seeAlso +
    `<div class="wiki-catbar"><b>Categories:</b> ${tags.length ? tags.map((tg) => `<a href="/wiki?q=${encodeURIComponent(tg)}">${escapeHtml(tg)}</a>`).join(' \u00b7 ') : '<a href="/wiki">Knowledge</a>'}</div>` +
    `${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}` +
    `</main></div>${wikiFooter()}</body></html>`;
}

function wikiSearchPage(req, q) {
  const ql = String(q).toLowerCase();
  const hits = store.getAllPosts(400).filter((p) => (String(p.title || '') + ' ' + String(p.excerpt || '') + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(ql));
  const list = hits.length
    ? `<ul style="line-height:1.9">${hits.slice(0, 50).map((p) => `<li><a href="/wiki/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a><br><span style="color:#54595d;font-size:.9rem">${escapeHtml(p.excerpt || '')}</span></li>`).join('')}</ul>`
    : `<p>No articles match “${escapeHtml(q)}”. Try a broader term, or browse the <a href="/wiki">main page</a> and <a href="/blog">all articles</a>.</p>`;
  return wikiHead('"' + q + '" \u2014 Search results \u2014 Tukuk-OS Wiki', 'https://tukuk.org/wiki?q=' + encodeURIComponent(q),
    'Wiki search results.', '', 'noindex,follow')
    + wikiTopbar() + `<div class="wrap"><div class="wiki-body">${wikiSidebar()}<main class="wiki-content">` +
    `<h1>Search results</h1><p class="wiki-from">${hits.length} result${hits.length === 1 ? '' : 's'} for “${escapeHtml(q)}”.</p>${list}` +
    `</main></div>${wikiFooter()}</body></html>`;
}

// ── Laluan Wiki. 'random' (literal) DIDAHULUIKAN sebelum '/wiki/:slug' ──────
app.get('/wiki/random', (req, res) => {
  const posts = store.getAllPosts(300);
  if (!posts.length) return res.redirect(302, '/wiki');
  const p = posts[Math.floor(Math.random() * posts.length)];
  res.redirect(302, `/wiki/${encodeURIComponent(p.slug)}`);
});
app.get('/wiki', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q) { res.type('html').send(wikiSearchPage(req, q)); return; }
  res.type('html').send(wikiMainPage(req));
});
app.get('/wiki/:slug', (req, res) => {
  const post = store.getPostBySlug(req.params.slug);
  if (!post) {
    const r = blogRedirects[req.params.slug];
    if (r) return res.redirect(301, `/wiki/${encodeURIComponent(r)}`);
    res.status(404).type('html').send(wikiHead('Article not found \u2014 Tukuk-OS Wiki', 'https://tukuk.org/wiki', 'Not found.', '', 'noindex,follow')
      + wikiTopbar() + `<div class="wrap"><div class="wiki-body">${wikiSidebar()}<main class="wiki-content"><h1>Article not found</h1><p class="wiki-from">This wiki article does not exist yet.</p><p><a href="/wiki">&larr; Wiki main page</a> \u00b7 <a href="/blog">All articles</a></p></main></div>${wikiFooter()}</body></html>`);
    return;
  }
  res.type('html').send(wikiArticlePage(req, post));
});

app.get('/blog', (req, res) => res.type('html').send(renderBlogListPage(req, false)));

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
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
${pageAdScript()}${clarityScript()}
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
</head>
<body>
${siteHeader('learn')}
<div class="wrap">
  ${adUnitGuarded(config.adsense.slotTop, 'top')}
  <header>
    <h1>Tukuk-OS Academy<span class="badge-count" id="lesson-count"></span></h1>
    <p class="tagline">Zero to Hero: one free curriculum from your first terminal command to running, defending and growing your own search engine.</p>
    <p class="learn-intro">Follow the stages in order \u2014 each lesson assumes only what came before it. Stuck at any point? Start at <a href="/learn">Stage 0</a> and keep the <a href="/blog">full archive</a> within reach.</p>
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
  ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}
</div>
${siteFooter()}
<script>document.getElementById('lesson-count').textContent='${lessonNo} lessons';</script>
</body>
</html>`;
  res.send(html);
});

// ══ KOMPLEKS ILMU (/study) — sains, geografi, sejarah, eksperimen, teka-teki,
// fakta, matematik, alarm. Shell sama seperti nasaDoc: chrome penuh + 3 unit
// iklan + nav silang. Data kurasi setempat (src/study.js) — tiada API luar.
const STUDY_SECTIONS = [
  { href: '/study', icon: '\uD83C\uDF1F', name: 'Today\u2019s Picks', blurb: 'One fact, one riddle, one experiment and one history moment \u2014 fresh every day.' },
  { href: '/study/science', icon: '\uD83E\uDD2C', name: 'Science', blurb: 'The core ideas of physics, chemistry and biology, explained in plain language.' },
  { href: '/study/geography', icon: '\uD83C\uDF0D', name: 'Geography', blurb: 'World records, population rankings and a daily capital-city quiz.' },
  { href: '/study/history', icon: '\uD83D\uDCDC', name: 'History', blurb: 'Thirty-nine milestones that shaped the world \u2014 from cuneiform to CRISPR.' },
  { href: '/study/experiments', icon: '\uD83E\uDEBA', name: 'Experiments', blurb: 'Safe kitchen science with real explanations \u2014 materials you already own.' },
  { href: '/study/riddles', icon: '\uD83E\uDD14', name: 'Riddles', blurb: 'Classic brain-teasers; guess first, then unfold the answer.' },
  { href: '/study/facts', icon: '\uD83D\uDCA1', name: 'Facts', blurb: 'Verified, checkable fun facts across science, history, body and world.' },
  { href: '/study/math', icon: '\u2795', name: 'Math', blurb: 'A mental-math sprint trainer plus the formulas and stories behind numbers.' },
  { href: '/study/alarm', icon: '\u23F0', name: 'Alarm & Timer', blurb: 'A browser alarm clock and pomodoro timer \u2014 no install, no account.' },
];

function studyNav() {
  return `<nav aria-label="Study sections"><h2 class="section-title">Explore the Tukuk-OS Knowledge Complex</h2><div class="feed">`
    + STUDY_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${s.name}</a></h2><p>${s.blurb}</p></div>`).join('')
    + `</div></nav>`;
}

// Pelukan standard seksyen /study — cermin nasaDoc (chrome penuh + iklan berkawal).
function studyDoc(o) {
  const robots = o.robots || 'index,follow';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#4c8dff">
<style>${COMMON_CSS}
.study-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:18px 0}
.study-card{border:1px solid var(--line);border-radius:10px;padding:16px 18px;background:var(--panel,#171a21);margin:0}
.study-card h3{margin:0 0 8px;font-size:1.05rem}
.study-card p{margin:6px 0;font-size:.95rem}
.study-table{width:100%;border-collapse:collapse;font-size:.92rem;margin:14px 0}
.study-table th,.study-table td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
.study-table th{background:var(--panel,#171a21)}
.study-step{margin:4px 0 4px 0;padding-left:2px}
.qopt{display:inline-block;border:1px solid var(--line);background:var(--panel,#171a21);color:var(--text);border-radius:8px;padding:7px 13px;margin:4px 6px 4px 0;font-size:.92rem;cursor:pointer}
.qopt:hover{border-color:var(--accent,#4c8dff)}
.qopt.ok{border-color:#3fb950;color:#3fb950;font-weight:700}
.qopt.no{border-color:#e5534b;color:#e5534b}
.quiz-block{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;background:var(--panel,#171a21)}
details.study-q{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:10px 0;background:var(--panel,#171a21)}
details.study-q summary{cursor:pointer;font-weight:600}
details.study-q p{margin:10px 0 0;color:var(--accent,#4c8dff)}
#bigclock{font-size:2.6rem;font-weight:700;letter-spacing:1px;margin:10px 0}
@media(max-width:680px){.study-grid{grid-template-columns:1fr}.study-table{display:block;overflow-x:auto}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('learn')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${studyNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

// ── /study — hab: pilihan harian deterministik (tiada kandungan berulang) ────
function studyHubPage() {
  const seed = study.dayIndex();
  const fact = study.pickDaily(study.FACTS, seed);
  const riddle = study.pickDaily(study.RIDDLES, seed);
  const exp = study.pickDaily(study.EXPERIMENTS, seed);
  const hist = study.pickDaily(study.HISTORY, seed);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const body = `<p class="learn-intro">One place for curiosity: verified facts, real experiments and quick brain training \u2014 every section is free, needs no account, and rotates its daily picks on the calendar. For deeper structured learning try the <a href="/learn">Zero-to-Hero Academy</a> or the <a href="/nasa">NASA Space Complex</a>.</p>
  <div class="study-grid">
    <div class="study-card"><h3>\uD83D\uDCC5 Today\u2019s fact</h3><p>${escapeHtml(fact.s)}</p><p class="meta">Topic: ${escapeHtml(fact.t)} \u00b7 ${today}</p></div>
    <div class="study-card"><h3>\uD83E\uDD14 Riddle of the day</h3><p>${escapeHtml(riddle.q)}</p><details class="study-q" style="border:0;padding:0;margin:6px 0 0;background:none"><summary style="font-size:.9rem">Show answer</summary><p>${escapeHtml(riddle.a)}</p></details></div>
    <div class="study-card"><h3>\uD83E\uDEBA Experiment of the day</h3><p><b>${escapeHtml(exp.name)}</b> \u2014 about ${escapeHtml(exp.time)}.</p><p>${escapeHtml(exp.why.split('.')[0])}.</p><p><a class="btn ghost" href="/study/experiments">Full instructions &rarr;</a></p></div>
    <div class="study-card"><h3>\uD83D\uDCDC History moment</h3><p><b>${escapeHtml(hist.y)}</b> \u2014 ${escapeHtml(hist.t)}</p><p>${escapeHtml(hist.d)}</p><p><a class="btn ghost" href="/study/history">See the full timeline &rarr;</a></p></div>
  </div>
  <h2 class="section-title">Nine ways to explore</h2>
  <p>Each section below is a full standalone page \u2014 read it, play with it, or use it for classroom and family curiosity.</p>`;
  return studyDoc({
    title: 'General Knowledge \u2014 Science, Geography, History, Riddles & More | Tukuk-OS',
    desc: 'A free knowledge hub: daily facts, brain riddles, safe kitchen experiments, world geography quizzes, history milestones, math drills and a browser alarm clock.',
    selfUrl: 'https://tukuk.org/study',
    heroTitle: 'The Knowledge Complex', heroSub: 'Daily facts, riddles, experiments, geography, history, math and tools \u2014 free, no account, every day fresh',
    body,
  });
}

// ── /study/science — penerangan konsep kurasi ───────────────────────────────
function studySciencePage() {
  const cards = study.SCIENCE.map((c) => `<div class="study-card"><h3>${escapeHtml(c.title)}</h3>${c.paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`).join('');
  const body = `<p class="learn-intro">Seventeen core ideas that school curricula usually scatter across five subjects \u2014 collected here in plain language, each in three short paragraphs. Read one a day; they stand alone. Pair them with the <a href="/study/experiments">hands-on experiments</a> to see the ideas move.</p>
  <div class="study-grid">${cards}</div>`;
  return studyDoc({
    title: 'Science Explained \u2014 17 Core Ideas of Physics, Chemistry & Biology | Tukuk-OS',
    desc: 'Plain-language explanations of gravity, energy, electricity, light, atoms, DNA, evolution, plate tectonics, climate and more \u2014 free science reference.',
    selfUrl: 'https://tukuk.org/study/science',
    heroTitle: 'Science, in Plain Language', heroSub: 'The ideas behind everything \u2014 accurate, short and free',
    body,
  });
}

// ── /study/history — kronologi mercu tanda ──────────────────────────────────
function studyHistoryPage() {
  const rows = study.HISTORY.map((h) => `<tr><td><b>${escapeHtml(h.y)}</b></td><td>${escapeHtml(h.t)}</td><td>${escapeHtml(h.d)}</td></tr>`).join('');
  const body = `<p class="learn-intro">Thirty-nine moments, evenly told: what happened, when, and why it still matters. Dates given as "c." are scholarly approximations. For the cosmos side of the story, see the <a href="/nasa">NASA Space Complex</a>.</p>
  <table class="study-table"><thead><tr><th>When</th><th>Moment</th><th>Why it mattered</th></tr></thead><tbody>${rows}</tbody></table>`;
  return studyDoc({
    title: 'World History in 39 Milestones \u2014 From Sumer to CRISPR | Tukuk-OS',
    desc: 'A chronological timeline of the events that shaped the world: writing, empires, the printing press, revolutions, flight, penicillin, DNA and the internet.',
    selfUrl: 'https://tukuk.org/study/history',
    heroTitle: 'History \u2014 The Short Long Story', heroSub: 'Thirty-nine milestones that made the world you are reading this on',
    body,
  });
}

// Bina 8 soalan kapital deterministik daripada data negara REBENAR (bukan rekaan).
function studyGeoQuiz(rows, seed) {
  const withCap = rows.filter((c) => c.capital && /^[\w .'-]+$/.test(String(c.capital)) && c.population);
  if (withCap.length < 20) return null;
  const picks = study.shuffleSeeded(withCap, seed).slice(0, 8);
  const allCaps = withCap.map((c) => c.capital);
  return picks.map((c) => {
    const wrong = study.shuffleSeeded(allCaps.filter((x) => x !== c.capital), seed + c.cca3.length).slice(0, 3);
    const opts = study.shuffleSeeded([c.capital, ...wrong], seed + c.slug.length);
    return { country: c.name, flag: c.flag, options: opts.map((o) => ({ t: o, ok: o === c.capital })) };
  });
}

// ── /study/geography — rekod + ranking populasi + kuiz kapital harian ──────
function studyGeographyPage(rows) {
  const seed = study.dayIndex();
  const records = study.GEO_RECORDS.map((r) => `<tr><td><b>${escapeHtml(r[0])}</b></td><td>${escapeHtml(r[1])}</td></tr>`).join('');
  let rankHtml = '';
  if (rows && rows.length) {
    const top = rows.filter((c) => c.population).sort((a, b) => b.population - a.population).slice(0, 12);
    rankHtml = `<h2 class="section-title">The ten-biggest, right now</h2><p>Live from the same United Nations / World Bank figures the <a href="/negara">country directory</a> uses — population, land area and capital.</p><table class="study-table"><thead><tr><th>#</th><th>Country</th><th>Population</th><th>Area (km²)</th><th>Capital</th></tr></thead><tbody>`
      + top.map((c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(c.name)}</td><td>${Number(c.population).toLocaleString('en-US')}</td><td>${c.area ? Number(c.area).toLocaleString('en-US') : '—'}</td><td>${escapeHtml(c.capital || '—')}</td></tr>`).join('')
      + `</tbody></table>`;
  }
  const quiz = rows && rows.length ? studyGeoQuiz(rows, seed) : null;
  let quizHtml = '';
  if (quiz) {
    quizHtml = `<h2 class="section-title">Capital quiz of the day</h2><p>Eight countries, four choices each — the same eight for everyone today. Click a capital to check yourself; the score updates as you go.</p><div id="quizscore" class="meta" aria-live="polite"></div>`
      + quiz.map((q) => `<div class="quiz-block"><p><b>${escapeHtml(q.country)}</b> — what is its capital?</p>`
        + q.options.map((o) => `<button type="button" class="qopt" data-ok="${o.ok ? '1' : '0'}">${escapeHtml(o.t)}</button>`).join('')
        + `</div>`).join('');
  } else {
    quizHtml = `<h2 class="section-title">Capital quiz of the day</h2><p>The live country feed is briefly unavailable, so today's quiz is resting. The world records below are always accurate — and reload this page in a few minutes for the quiz.</p>`;
  }
  const body = `<p class="learn-intro">Geography is the study of where things are and why. Below: the planet's outright records, the current population giants, and a daily capital quiz built from real country data. For every country's full profile — flags, languages, borders and statistics — see the <a href="/negara">World Countries directory</a>.</p>
  <h2 class="section-title">Planetary records</h2>
  <table class="study-table"><thead><tr><th>Category</th><th>The record holder</th></tr></thead><tbody>${records}</tbody></table>
  ${rankHtml}
  ${quizHtml}
  <script>(function(){var s=document.getElementById('quizscore');var blocks=document.querySelectorAll('.quiz-block');var done=0,right=0;if(s){s.textContent='Score: 0 / '+blocks.length+' answered';}Array.prototype.forEach.call(blocks,function(b){var btns=b.querySelectorAll('.qopt');Array.prototype.forEach.call(btns,function(btn){btn.addEventListener('click',function(){if(b.getAttribute('data-done')==='1')return;var good=btn.getAttribute('data-ok')==='1';btn.className='qopt '+(good?'ok':'no');if(good){right++;}else{Array.prototype.forEach.call(btns,function(o){if(o.getAttribute('data-ok')==='1')o.className='qopt ok';});}b.setAttribute('data-done','1');done++;if(s){s.textContent='Score: '+right+' correct of '+done+' answered';}});});});})();</script>`;
  return studyDoc({
    title: 'World Geography \u2014 Records, Population & Daily Capital Quiz | Tukuk-OS',
    desc: 'Geographic records of the world, live top-country population rankings and a free daily capital-city quiz built from real country data.',
    selfUrl: 'https://tukuk.org/study/geography',
    heroTitle: 'Geography \u2014 Where the World Is', heroSub: 'Planetary records, population giants and a daily capital quiz',
    body,
  });
}

// ── /study/experiments — sains dapur selamat ─────────────────────────
function studyExperimentsPage() {
  const cards = study.EXPERIMENTS.map((e) => `<div class="study-card"><h3>${escapeHtml(e.name)}</h3><p class="meta">${escapeHtml(e.level)} \u00b7 ${escapeHtml(e.time)}</p><p><b>You need:</b> ${escapeHtml(e.materials)}</p><ol>${e.steps.map((s) => `<li class="study-step">${escapeHtml(s)}</li>`).join('')}</ol><p><b>Why it happens:</b> ${escapeHtml(e.why)}</p></div>`).join('');
  const body = `<p class="learn-intro">Twelve safe, low-cost experiments using things already in most kitchens. Each lists materials, ordered steps and the real science behind the result. Items marked <b>medium</b> need an adult for a hot-water or boiling step. The concepts connect directly to the <a href="/study/science">science explainers</a>.</p>
  <div class="study-grid">${cards}</div>`;
  return studyDoc({
    title: '12 Safe Home Science Experiments \u2014 With Real Explanations | Tukuk-OS',
    desc: 'Kitchen science you can do today: density towers, invisible ink, cabbage pH indicator, a homemade compass, DNA from a strawberry and more, each with the why.',
    selfUrl: 'https://tukuk.org/study/experiments',
    heroTitle: 'Experiments \u2014 Science You Can Touch', heroSub: 'Safe, cheap, hands-on \u2014 and every one has a real explanation',
    body,
  });
}

// ── /study/riddles — teka-teki klasik (details reveal tanpa JS) ───────────
function studyRiddlesPage() {
  const items = study.RIDDLES.map((r) => `<details class="study-q"><summary>${escapeHtml(r.q)}</summary><p>${escapeHtml(r.a)}</p></details>`).join('');
  const body = `<p class="learn-intro">Thirty-six classic brain-teasers, mostly centuries old and in the public domain. Read the question, sit with it a moment, then tap to unfold the answer. Great for car rides, classrooms and keeping the mind limber.</p>
  ${items}`;
  return studyDoc({
    title: '36 Best Riddles With Answers \u2014 Brain Teasers for All Ages | Tukuk-OS',
    desc: 'A free collection of classic riddles with hidden answers \u2014 the more you have, the less you see; many keys but no locks; and thirty-five more.',
    selfUrl: 'https://tukuk.org/study/riddles',
    heroTitle: 'Riddles \u2014 Think Twice', heroSub: 'Guess before you unfold \u2014 the answer is one tap away',
    body,
  });
}

// ── /study/facts — fakta tertapis ikut topik ────────────────────────────
function studyFactsPage() {
  const byTopic = {};
  for (const f of study.FACTS) { (byTopic[f.t] = byTopic[f.t] || []).push(f.s); }
  const sections = Object.keys(byTopic).map((t) => `<h2 class="section-title">${escapeHtml(t)}</h2>` + byTopic[t].map((s) => `<p>&bull; ${escapeHtml(s)}</p>`).join('')).join('');
  const body = `<p class="learn-intro">Forty-two facts chosen to be surprising <em>and</em> checkable \u2014 each is grouped by topic and phrased so you can verify it yourself. Numbers are best public estimates; where experts disagree (river lengths, for instance) we say so. Today's single fact lives on the <a href="/study">Knowledge hub</a>.</p>
  ${sections}`;
  return studyDoc({
    title: '42 Verified Fun Facts \u2014 Science, History, Space & the World | Tukuk-OS',
    desc: 'A curated, checkable list of fascinating facts about space, the Earth, animals, the human body, history, geography and mathematics \u2014 grouped by topic.',
    selfUrl: 'https://tukuk.org/study/facts',
    heroTitle: 'Facts \u2014 True and Verifiable', heroSub: 'Surprising things you can actually check',
    body,
  });
}

// ── /study/math — jurulatih sprint kiraan mental + formula + cerita ─────────
function studyMathPage() {
  const formulas = [
    ['Circle', 'C = 2\u03c0r   \u00b7   A = \u03c0r\u00b2'],
    ['Rectangle', 'Perimeter = 2(l + w)   \u00b7   Area = l \u00d7 w'],
    ['Triangle area', 'A = \u00bd \u00d7 base \u00d7 height'],
    ['Pythagoras', 'a\u00b2 + b\u00b2 = c\u00b2 (right triangles)'],
    ['Volume of a box', 'V = l \u00d7 w \u00d7 h'],
    ['Sphere', 'V = \u2044\u2083 \u03c0r\u00b3   \u00b7   A = 4\u03c0r\u00b2'],
    ['Quadratic formula', 'x = (\u2212b \u00b1 \u221a(b\u00b2 \u2212 4ac)) / 2a'],
    ['Simple interest', 'I = P \u00d7 r \u00d7 t'],
    ['Percentage change', '(new \u2212 old) / old \u00d7 100%'],
    ['Average (mean)', 'sum of values \u00f7 number of values'],
    ['Speed', 'speed = distance \u00f7 time'],
    ['Density', 'density = mass \u00f7 volume'],
  ].map((f) => `<tr><td><b>${escapeHtml(f[0])}</b></td><td>${escapeHtml(f[1])}</td></tr>`).join('');
  const body = `<p class="learn-intro">Maths is a muscle: quick daily drills build the number sense that makes everything else easier. Use the sprint trainer below for two minutes a day, keep the formula sheet for reference, and read the stories to see why the numbers matter. Pair with the <a href="/study/science">science explainers</a> for the physics that uses these tools.</p>
  <h2 class="section-title">Mental-math sprint \u2014 60 seconds</h2>
  <p>Pick a level, press Start, and answer as many as you can before the clock runs out. Every problem is generated fresh in your browser.</p>
  <div class="quiz-block">
    <label for="mathlevel">Level:</label>
    <select id="mathlevel"><option value="add">Addition (easy)</option><option value="sub">Subtraction (easy)</option><option value="mul">Multiplication (medium)</option><option value="mix">Mixed (hard)</option></select>
    <button type="button" class="btn primary" id="mathstart">Start</button>
  </div>
  <div class="quiz-block" id="mathplay" style="display:none">
    <p class="meta">Time left: <b id="mathtime">60</b>s \u00b7 Score: <b id="mathscore">0</b></p>
    <p style="font-size:1.6rem;font-weight:700" id="mathq">\u2014</p>
    <input id="mathans" type="number" inputmode="numeric" aria-label="Your answer" style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel,#171a21);color:inherit;font-size:1.1rem;width:140px">
    <button type="button" class="btn primary" id="mathcheck">Check</button>
    <span id="mathfb" class="meta" aria-live="polite"></span>
  </div>
  <h2 class="section-title">The formula sheet</h2>
  <table class="study-table"><thead><tr><th>Thing</th><th>Formula</th></tr></thead><tbody>${formulas}</tbody></table>
  <h2 class="section-title">Numbers with a story</h2>
  <p>&bull; Zero became a number in India by the 7th century \u2014 before that, "nothing" was not something you could count with.</p>
  <p>&bull; A shuffled deck of 52 cards has about 8\u00d710<sup>67</sup> possible orders \u2014 more than the seconds since the Big Bang, so your shuffle has almost certainly never happened before.</p>
  <p>&bull; The Babylonians knew the Pythagorean relationship over a thousand years before Pythagoras; a clay tablet (Plimpton 322, c. 1800 BC) lists correct triples.</p>
  <p>&bull; Every map ever drawn needs at most four colours \u2014 the Four Colour Theorem, proven with a computer in 1976.</p>
  <script>(function(){var level=document.getElementById('mathlevel');var startBtn=document.getElementById('mathstart');var play=document.getElementById('mathplay');var qEl=document.getElementById('mathq');var ans=document.getElementById('mathans');var checkBtn=document.getElementById('mathcheck');var fb=document.getElementById('mathfb');var timeEl=document.getElementById('mathtime');var scoreEl=document.getElementById('mathscore');var current=0,left=60,score=0,timer=null;function rint(n){return Math.floor(Math.random()*n);}function make(){var t=level.value;if(t==='mix'){t=['add','sub','mul'][rint(3)];}var a,b;if(t==='add'){a=rint(50)+1;b=rint(50)+1;current=a+b;qEl.textContent=a+' + '+b+' =';}else if(t==='sub'){a=rint(80)+20;b=rint(a);current=a-b;qEl.textContent=a+' \u2212 '+b+' =';}else{a=rint(12)+2;b=rint(12)+2;current=a*b;qEl.textContent=a+' \u00d7 '+b+' =';}ans.value='';fb.textContent='';ans.focus();}function stop(){if(timer){clearInterval(timer);timer=null;}}startBtn.addEventListener('click',function(){play.style.display='block';left=60;score=0;scoreEl.textContent='0';timeEl.textContent='60';stop();make();timer=setInterval(function(){left--;timeEl.textContent=String(left);if(left<=0){stop();qEl.textContent="Time! You scored "+score;fb.textContent='';play.style.display='none';}},1000);});function judge(){var v=parseInt(ans.value,10);if(String(v)===String(current)){score++;scoreEl.textContent=String(score);fb.textContent='Correct';}else{fb.textContent='Not quite \u2014 it was '+current;}make();}checkBtn.addEventListener('click',judge);ans.addEventListener('keydown',function(e){if(e.key==='Enter'){judge();}});})();</script>`;
  return studyDoc({
    title: 'Mental Math Trainer \u2014 60-Second Sprint, Formulas & Number Facts | Tukuk-OS',
    desc: 'A free in-browser mental-math sprint game with addition, subtraction, multiplication and mixed levels, plus a formula sheet and the stories behind the numbers.',
    selfUrl: 'https://tukuk.org/study/math',
    heroTitle: 'Math \u2014 Fast and Faithful', heroSub: 'Drill your number sense, keep the formulas, meet the stories',
    body,
  });
}

// ── /study/alarm — jam + alarm + pomodoro (honest: tab mesti kekal terbuka) ──
function studyAlarmPage() {
  const body = `<p class="learn-intro">A no-install alarm clock and study timer that run entirely in your browser \u2014 nothing leaves this page. <b>Keep this tab open</b> for an alarm or countdown to fire; browsers do not let a closed tab ring. For the pomodoro technique, run a 25-minute focus block, take a 5-minute break, repeat.</p>
  <div class="quiz-block" style="text-align:center">
    <div id="bigclock" aria-live="off">--:--:--</div>
    <p class="meta" id="clockdate"></p>
    <button type="button" class="btn ghost" id="soundbtn">\uD83D\uDD0A Enable sound</button>
    <span class="meta" id="soundstate"> (click so the alarm can play)</span>
  </div>
  <div class="study-grid">
    <div class="study-card"><h3>\u23F0 Alarm</h3>
      <label for="alarmtime">Wake at:</label>
      <input id="alarmtime" type="time" style="padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--panel,#171a21);color:inherit">
      <p><button type="button" class="btn primary" id="alarmtoggle">Set alarm</button> <span class="meta" id="alarmstate">Off</span></p>
    </div>
    <div class="study-card"><h3>\uD83C\uDF45 Pomodoro / countdown</h3>
      <p><button type="button" class="qbtn qopt" id="p25">25 min focus</button> <button type="button" class="qopt" id="p5">5 min break</button></p>
      <div style="font-size:1.8rem;font-weight:700" id="pdisplay">--:--</div>
      <p><button type="button" class="btn ghost" id="pstop">Stop</button></p>
    </div>
  </div>
  <p class="meta">Tip: set your device to keep the screen awake while studying. This tool never sends your data anywhere \u2014 see <a href="/privacy">Privacy</a>.</p>
  <script>(function(){var ac=null;var clk=document.getElementById('bigclock');var cdate=document.getElementById('clockdate');function pad(n){return (n<10?'0':'')+n;}var alarmOn=false,alarmAt='',alarmFired=false;function two(x){return x<10?'0'+x:''+x;}function tick(){var d=new Date();if(clk){clk.textContent=two(d.getHours())+':'+two(d.getMinutes())+':'+two(d.getSeconds());}if(cdate){cdate.textContent=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});}var now=two(d.getHours())+':'+two(d.getMinutes());if(alarmOn&&alarmAt&&now===alarmAt&&!alarmFired){alarmFired=true;beepLoop();var s=document.getElementById('alarmstate');if(s){s.textContent='Ringing \u2014 dismiss to stop';}}}function beepLoop(){var n=0;var iv=setInterval(function(){beep();n++;if(n>40){clearInterval(iv);}},700);window.__stopbeep=function(){clearInterval(iv);};}function beep(){if(!ac)return;try{var o=ac.createOscillator();var g=ac.createGain();o.connect(g);g.connect(ac.destination);o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(0.001,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.2,ac.currentTime+0.02);g.gain.exponentialRampToValueAtTime(0.0001,ac.currentTime+0.4);o.start();o.stop(ac.currentTime+0.45);}catch(e){}}var sb=document.getElementById('soundbtn');if(sb){sb.addEventListener('click',function(){if(!ac){try{ac=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}if(ac&&ac.resume){ac.resume();}document.getElementById('soundstate').textContent=' \u2713 ready';});}var tt=document.getElementById('alarmtoggle');if(tt){tt.addEventListener('click',function(){var inp=document.getElementById('alarmtime');var st=document.getElementById('alarmstate');if(alarmOn){alarmOn=false;st.textContent='Off';if(window.__stopbeep){window.__stopbeep();}return;}if(!inp.value){st.textContent='Pick a time first';return;}alarmAt=inp.value;alarmOn=true;alarmFired=false;st.textContent='On for '+alarmAt+' (keep this tab open)';});}var pdisp=document.getElementById('pdisplay');var pleft=0,ptimer=null;function pstop(){if(ptimer){clearInterval(ptimer);ptimer=null;}if(window.__stopbeep){window.__stopbeep();}}function render(){var m=Math.floor(pleft/60);var s=pleft%60;pdisp.textContent=(m<10?'0':'')+m+':'+(s<10?'0':'')+s;}function startP(secs){pstop();pleft=secs;render();ptimer=setInterval(function(){pleft--;render();if(pleft<=0){pstop();beep();beep();pdisp.textContent='Done!';}},1000);}var b25=document.getElementById('p25');if(b25){b25.addEventListener('click',function(){startP(25*60);});}var b5=document.getElementById('p5');if(b5){b5.addEventListener('click',function(){startP(5*60);});}var pstopBtn=document.getElementById('pstop');if(pstopBtn){pstopBtn.addEventListener('click',function(){pstop();pdisp.textContent='--:--';});}tick();setInterval(tick,1000);})();</script>`;
  return studyDoc({
    title: 'Alarm Clock & Pomodoro Timer \u2014 Free Browser Tool | Tukuk-OS',
    desc: 'A no-install alarm clock and 25/5 pomodoro study timer that runs in your browser with sound. Set a wake time, start a focus block, keep your data on-device.',
    selfUrl: 'https://tukuk.org/study/alarm',
    heroTitle: 'Alarm & Timer', heroSub: 'Wake-up alarm and pomodoro study timer \u2014 private, in-browser, no install',
    body,
  });
}

// ── Laluan /study — semua literal; geografi async (data negara REBENAR). ────
app.get('/study', (req, res) => res.type('html').send(studyHubPage()));
app.get('/study/science', (req, res) => res.type('html').send(studySciencePage()));
app.get('/study/history', (req, res) => res.type('html').send(studyHistoryPage()));
app.get('/study/experiments', (req, res) => res.type('html').send(studyExperimentsPage()));
app.get('/study/riddles', (req, res) => res.type('html').send(studyRiddlesPage()));
app.get('/study/facts', (req, res) => res.type('html').send(studyFactsPage()));
app.get('/study/math', (req, res) => res.type('html').send(studyMathPage()));
app.get('/study/alarm', (req, res) => res.type('html').send(studyAlarmPage()));
app.get('/study/geography', async (req, res) => {
  let rows = null;
  try { rows = await ng.loadCountries(); } catch (e) { rows = null; }
  res.type('html').send(studyGeographyPage(Array.isArray(rows) && rows.length >= 20 ? rows : null));
});

// ══ KOMPLEKS UDARA /udara — bacaan AQI dunia + CO2 langsung + edukasi oksigen ══
const UDARA_SECTIONS = [
  { href: '/udara', icon: '\uD83C\uDF0D', name: 'World Air Ranking', blurb: 'Live air quality for 70+ cities — the cleanest and dirtiest spots on Earth right now.' },
  { href: '/udara/carbon', icon: '\uD83D\uDDA2', name: 'Carbon Dioxide Live', blurb: 'Today\u2019s actual CO2 reading from NOAA\u2019s Mauna Loa observatory, with the 65-year climb.' },
  { href: '/udara/oxygen', icon: '\uD83E\uDEE9', name: 'Oxygen Explained', blurb: 'Where your oxygen really comes from, why it is falling, and what altitude does to a breath.' },
  { href: '/udara/breath', icon: '\uD83E\uDEC1', name: 'Breathing Life', blurb: 'From blue whales to houseflies: how every creature moves air, and what your own breath is doing.' },
];

function udaraNav() {
  return `<nav aria-label="Air and oxygen sections"><h2 class="section-title">Explore the Air & Oxygen Complex</h2><div class="feed">`
    + UDARA_SECTIONS.map((s) => `<div class="post-card"><h2><a href="${s.href}">${s.icon} ${s.name}</a></h2><p>${s.blurb}</p></div>`).join('')
    + `</div></nav>`;
}

// Pelukan standard /udara — cermin studyDoc (chrome penuh + iklan berkawal).
function udaraDoc(o) {
  const robots = o.robots || 'index,follow';
  const ld = o.ld || JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: o.title,
    description: o.desc, url: o.selfUrl,
    publisher: { '@type': 'Organization', name: 'Tukuk-OS', url: 'https://tukuk.org' },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.desc)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tukuk-OS">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.desc)}">
<meta property="og:url" content="${o.selfUrl}">
<meta property="og:image" content="https://tukuk.org/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${o.selfUrl}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#4c8dff">
<style>${COMMON_CSS}
.air-table{width:100%;border-collapse:collapse;font-size:.92rem;margin:14px 0}
.air-table th,.air-table td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
.air-table th{background:var(--panel,#171a21)}
.aqi-chip{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:.82rem;color:#0f1115}
.aqi-chip.good{background:#3fb950}
.aqi-chip.moderate{background:#d29922}
.aqi-chip.usg{background:#f0883e}
.aqi-chip.unhealthy{background:#e5534b;color:#fff}
.aqi-chip.very{background:#a371f7;color:#fff}
.aqi-chip.hazardous{background:#8e1f2c;color:#fff}
.air-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:18px 0}
.air-card{border:1px solid var(--line);border-radius:10px;padding:16px 18px;background:var(--panel,#171a21);margin:0}
.air-card h3{margin:0 0 8px;font-size:1.05rem}
.air-card p{margin:6px 0;font-size:.95rem}
.big-readout{font-size:3rem;font-weight:800;letter-spacing:1px;margin:12px 0 4px}
.bar-row{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:.86rem}
.bar-row .bl{min-width:44px;text-align:right;color:var(--muted,#9aa3b2)}
.bar-row .bv{min-width:70px}
.bar-row .bt{height:14px;border-radius:4px;background:var(--accent,#4c8dff);opacity:.85}
@media(max-width:680px){.air-grid{grid-template-columns:1fr}.air-table{display:block;overflow-x:auto}.big-readout{font-size:2.2rem}}
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('learn')}
<div class="wrap">
  <header><h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1><p class="tagline">${escapeHtml(o.heroSub || '')}</p></header>
  <main>${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    ${o.body}
    ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
    ${udaraNav()}
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
</body>
</html>`;
}

function aqiChip(v) {
  const c = udara.aqiCategory(v);
  if (!c) return '<span class="meta">\u2014</span>';
  return `<span class="aqi-chip ${c.cls}">${Math.round(v)} \u00b7 ${c.label}</span>`;
}
function airRow(r) {
  const n = (x, unit) => (x == null ? '\u2014' : x + (unit || ''));
  return `<tr><td><b>${escapeHtml(r.name)}</b>, ${escapeHtml(r.country)}</td><td>${escapeHtml(r.region)}</td><td>${aqiChip(r.usAqi)}</td><td>${n(r.pm25, ' \u00b5g/m\u00b3')}</td><td>${n(r.o3, ' \u00b5g/m\u00b3')}</td><td>${n(r.no2, ' \u00b5g/m\u00b3')}</td></tr>`;
}

// ── /udara — ranking langsung; jujur dengan source:'unavailable' bila mati ──
function udaraHubPage(air, co2) {
  const scale = `<h2 class="section-title">Reading the scale (US AQI)</h2>
  <table class="air-table"><thead><tr><th>Number</th><th>What it means</th></tr></thead><tbody>
  <tr><td>0\u201350</td><td>${aqiChip(30)} \u2014 air quality satisfactory for everyone.</td></tr>
  <tr><td>51\u2013100</td><td>${aqiChip(75)} \u2014 acceptable; unusually sensitive people should mind long outdoor effort.</td></tr>
  <tr><td>101\u2013150</td><td>${aqiChip(130)} \u2014 children, older adults and lung/heart conditions feel it first.</td></tr>
  <tr><td>151\u2013200</td><td>${aqiChip(170)} \u2014 everyone starts to notice; sensitive groups clearly affected.</td></tr>
  <tr><td>201\u2013300</td><td>${aqiChip(250)} \u2014 health effects likely; postpone hard outdoor exercise.</td></tr>
  <tr><td>301+</td><td>${aqiChip(350)} \u2014 emergency conditions; nearly everyone is affected.</td></tr>
  </tbody></table>`;
  const co2Card = co2 && co2.source && co2.source !== 'unavailable'
    ? `<div class="air-card"><h3>\uD83D\uDDA2 Carbon dioxide, right now</h3><p style="font-size:1.9rem;font-weight:800">${co2.ppm.toFixed(1)} ppm</p><p class="meta">NOAA ${escapeHtml(co2.site)} reading, ${escapeHtml(co2.date)} \u00b7 <a href="/udara/carbon">the full carbon story &rarr;</a></p></div>`
    : `<div class="air-card"><h3>\uD83D\uDDA2 Carbon dioxide, right now</h3><p style="font-size:1.9rem;font-weight:800">\u2014</p><p class="meta">The NOAA feed is briefly resting \u2014 the <a href="/udara/carbon">carbon page</a> explains and retries.</p></div>`;
  let data = '';
  if (air && air.rows && air.rows.length) {
    const rows = air.rows;
    const mid = Math.round(rows[Math.floor(rows.length / 2)].usAqi);
    const clean = rows.slice(0, 10).map(airRow).join('');
    const dirty = rows.slice(-10).reverse().map(airRow).join('');
    const all = rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${escapeHtml(r.name)}</b>, ${escapeHtml(r.country)}</td><td>${escapeHtml(r.region)}</td><td>${aqiChip(r.usAqi)}</td><td>${r.pm25 == null ? '\u2014' : r.pm25 + ' \u00b5g/m\u00b3'}</td></tr>`).join('');
    const note = air.source === 'last-known'
      ? `<p class="meta">\u26A0 The live feed is briefly unavailable \u2014 these are the last good readings, taken ${new Date(air.staleSince || air.fetchedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.</p>`
      : (air.source === 'partial' ? `<p class="meta">\u26A0 ${air.failedCount} of ${udara.CITIES.length} city readings failed this round; the rest are current.</p>` : '');
    data = `<div class="air-grid">
      <div class="air-card"><h3>\uD83C\uDF3F Cleanest spot right now</h3><p style="font-size:1.4rem;font-weight:800">${escapeHtml(rows[0].name)}, ${escapeHtml(rows[0].country)}</p><p>${aqiChip(rows[0].usAqi)}</p></div>
      <div class="air-card"><h3>\uD83D\uDD25 Dirtiest spot right now</h3><p style="font-size:1.4rem;font-weight:800">${escapeHtml(rows[rows.length - 1].name)}, ${escapeHtml(rows[rows.length - 1].country)}</p><p>${aqiChip(rows[rows.length - 1].usAqi)}</p></div>
      ${co2Card}
      <div class="air-card"><h3>Middle of the pack</h3><p style="font-size:1.4rem;font-weight:800">median AQI ${mid}</p><p class="meta">across ${rows.length} monitored world cities</p></div>
    </div>
    ${note}
    <h2 class="section-title">The ten cleanest points on Earth (of our network)</h2>
    <table class="air-table"><thead><tr><th>City</th><th>Region</th><th>US AQI</th><th>PM2.5</th><th>Ozone</th><th>NO2</th></tr></thead><tbody>${clean}</tbody></table>
    <h2 class="section-title">The ten dirtiest</h2>
    <table class="air-table"><thead><tr><th>City</th><th>Region</th><th>US AQI</th><th>PM2.5</th><th>Ozone</th><th>NO2</th></tr></thead><tbody>${dirty}</tbody></table>
    <details><summary style="cursor:pointer;font-weight:600;margin:10px 0">Full ranking \u2014 all ${rows.length} cities, cleanest to dirtiest</summary>
    <table class="air-table"><thead><tr><th>#</th><th>City</th><th>Region</th><th>US AQI</th><th>PM2.5</th></tr></thead><tbody>${all}</tbody></table></details>`;
  } else {
    data = `<div class="air-grid">${co2Card}</div>
    <p class="meta">\u26A0 The live world feed is resting right now \u2014 we would rather show you nothing than show you invented numbers. Reload in a few minutes; the scale below and every explainer on this complex always work.</p>`;
  }
  const body = `<p class="learn-intro">Live air-quality readings for over seventy world cities, modelled by the Copernicus Atmosphere Monitoring Service and delivered through the free Open-Meteo API, refreshed on our side every 45 minutes. These are model estimates for each city\u2019s coordinates \u2014 your street can differ; treat them as a global pulse, not a personal sensor. Weather for any of these cities lives at <a href="/cuaca">World Weather</a>.</p>
  ${data}
  ${scale}`;
  return udaraDoc({
    title: 'World Air Quality Live \u2014 Cleanest and Most Polluted Places on Earth | Tukuk-OS',
    desc: 'Live US AQI, PM2.5, ozone and NO2 readings for 70+ world cities ranked cleanest to dirtiest, plus today\u2019s real CO2 level from the NOAA Mauna Loa observatory.',
    selfUrl: 'https://tukuk.org/udara',
    heroTitle: 'The Air We Breathe \u2014 Live', heroSub: 'Clean spots, dirty spots and the carbon in the sky, updated from free open sources',
    body,
  });
}

// ── /udara/carbon — bacaan CO2 langsung NOAA ───────────────────────
function udaraCarbonPage(co2) {
  let readout = '';
  if (co2 && co2.source && co2.source !== 'unavailable') {
    const vmin = co2.annual[0] ? co2.annual[0].v - 2 : 400;
    const vmax = co2.annual[co2.annual.length - 1] ? co2.annual[co2.annual.length - 1].v + 2 : 430;
    const bars = co2.annual.map((a) => {
      const w = Math.max(4, Math.round(((a.v - vmin) / (vmax - vmin)) * 100));
      return `<div class="bar-row"><span class="bl">${a.year}</span><span class="bt" style="width:${w}%"></span><span class="bv">${a.v.toFixed(1)}</span></div>`;
    }).join('');
    const stale = co2.source === 'last-known' ? '<p class="meta">\u26A0 The NOAA feed is briefly unreachable \u2014 showing the last reading we successfully fetched.</p>' : '';
    readout = `<div class="air-grid">
      <div class="air-card"><h3>Today\u2019s reading</h3><p class="big-readout">${co2.ppm.toFixed(1)} <span style="font-size:1.1rem">ppm</span></p><p class="meta">Daily mean CO\u2082, NOAA ${escapeHtml(co2.site)} \u00b7 ${escapeHtml(co2.date)} \u00b7 refreshed every 12 h</p></div>
      <div class="air-card"><h3>The climb per year</h3><p class="big-readout">${co2.growth == null ? '\u2014' : '+' + co2.growth} <span style="font-size:1.1rem">ppm/yr</span></p><p class="meta">Latest global annual-mean step (NOAA). A natural year is about +1; fossil years run +2 to +3.</p></div>
    </div>
    ${stale}
    <h2 class="section-title">Fifteen years of the global annual mean</h2>
    <p>Parts per million of carbon dioxide in the whole-world surface atmosphere, year by year \u2014 straight from NOAA\u2019s global monitoring averages.</p>
    <div>${bars}</div>`;
  } else {
    readout = `<p class="meta">\u26A0 The NOAA carbon feed is resting right now and we keep no invented placeholder \u2014 reload in a few minutes for the real number.</p>`;
  }
  const body = `<p class="learn-intro">Carbon dioxide is the gas of breath and fire: every animal exhales it, every flame turns air into it, and for two centuries humans have been doing so at an industrial scale. This page shows the actual measurement \u2014 no model, no estimate: flasks and analysers at NOAA\u2019s Mauna Loa observatory in Hawaii and a global network, published freely.</p>
  ${readout}
  <h2 class="section-title">What the number means</h2>
  <div class="air-grid">
    <div class="air-card"><h3>280 \u2192 420+ in 170 years</h3><p>Before the industrial revolution the world\u2019s air held about 280 ppm of CO\u2082. NOAA\u2019s global annual means began in 1959 at roughly ${co2 && co2.base1958 ? co2.base1958.toFixed(1) : '316'} ppm and now pass 420 \u2014 a level at least three million years older than any human ancestor.</p></div>
    <div class="air-card"><h3>Why the sawtooth is not noise</h3><p>Northern forests and grasslands inhale CO\u2082 each summer and exhale it each winter, so the curve breathes seasonally by a handful of ppm while its baseline only climbs. The trend is the fingerprint of fossil carbon; the wobble is the living planet.</p></div>
    <div class="air-card"><h3>Your own contribution</h3><p>A person exhales air that is about 4 percent CO\u2082 \u2014 roughly 40,000 ppm against the outdoor 420. Every breath you have ever taken added carbon the food chain just captured from the air; the industrial loop is the same loop, run too fast.</p></div>
    <div class="air-card"><h3>Where to argue with the number</h3><p>CO\u2082 itself is not a poison at outdoor levels \u2014 it is 0.04 percent of air. Its weight is radiative: more of it holds more of the Earth\u2019s outgoing heat. That physics, not toxicity, is why this dial matters to every country on the coast.</p></div>
  </div>
  <h2 class="section-title">Related</h2>
  <p>How living things move this gas day by day: <a href="/udara/breath">Breathing Life</a>. The oxygen side of the same reaction: <a href="/udara/oxygen">Oxygen Explained</a>. City-by-city particulate and ozone readings: <a href="/udara">the world air ranking</a>.</p>`;
  return udaraDoc({
    title: 'CO2 Level Today, Live \u2014 The Real Mauna Loa Reading | Tukuk-OS',
    desc: 'Today\u2019s actual atmospheric carbon dioxide reading from NOAA\u2019s Mauna Loa observatory and global annual means, with plain-language context on the 280-to-420 ppm climb.',
    selfUrl: 'https://tukuk.org/udara/carbon',
    heroTitle: 'Carbon Dioxide, Read Directly', heroSub: 'The live number from NOAA \u2014 what it says and what it does not',
    body,
  });
}

// ── /udara/oxygen — edukasi O2 (kurasi statik) ─────────────────────
function udaraOxygenPage() {
  const cards = udara.OXYGEN.map((c) => `<div class="air-card"><h3>${escapeHtml(c.h)}</h3>${c.paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`).join('');
  const myths = udara.MYTHS.map((m) => `<div class="air-card"><h3>Myth: ${escapeHtml(m.m)}</h3><p>${escapeHtml(m.f)}</p></div>`).join('');
  const body = `<p class="learn-intro">Oxygen is the most consequential chemical argument on Earth: it lets fires spread, lets animals run hot and lets brains afford to think. Below \u2014 where it comes from, where it is going, and how the planet has breathed differently across deep time. The live side of this story is the <a href="/udara">world air ranking</a> and the <a href="/udara/carbon">CO2 readout</a>.</p>
  <div class="air-grid">${cards}</div>
  <h2 class="section-title">Claims worth un-learning</h2>
  <div class="air-grid">${myths}</div>`;
  return udaraDoc({
    title: 'Oxygen Explained \u2014 Where It Comes From and Where It Is Going | Tukuk-OS',
    desc: 'Plain-language oxygen science: 20.9 percent air, phytoplankton as the real oxygen factory, the measured slow decline, altitude physiology and ocean oxygen minimum zones.',
    selfUrl: 'https://tukuk.org/udara/oxygen',
    heroTitle: 'Oxygen \u2014 The Argument Air Won', heroSub: 'The gas behind every flame, breath and giant insect in Earth history',
    body,
  });
}

// ── /udara/breath — pernafasan makhluk hidup ───────────────────────
function udaraBreathPage() {
  const human = udara.HUMAN_BREATH.map((r) => `<tr><td><b>${escapeHtml(r.k)}</b></td><td>${escapeHtml(r.v)}</td><td>${escapeHtml(r.note)}</td></tr>`).join('');
  const animals = udara.ANIMAL_BREATH.map((r) => `<tr><td><b>${escapeHtml(r.a)}</b></td><td>${escapeHtml(r.rr)}</td><td>${escapeHtml(r.note)}</td></tr>`).join('');
  const ways = udara.OTHER_WAYS.map((c) => `<div class="air-card"><h3>${escapeHtml(c.h)}</h3>${c.paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`).join('');
  const indoor = udara.INDOOR_CO2.map((r) => `<tr><td><b>${escapeHtml(r.v)}</b></td><td>${escapeHtml(r.t)}</td><td>${escapeHtml(r.d)}</td></tr>`).join('');
  const body = `<p class="learn-intro">A breath looks simple and is one of the most negotiated transactions in biology: oxygen in, carbon dioxide out, paid for in energy. Here is what your own breathing budget looks like, how the animal kingdom solved the same problem, and where the air in your room sits on that ledger. Respiratory rates below are commonly cited resting ranges \u2014 individuals, sizes and temperatures move them.</p>
  <h2 class="section-title">Your breathing, by the numbers</h2>
  <table class="air-table"><thead><tr><th>Measure</th><th>Typical value</th><th>The human note</th></tr></thead><tbody>${human}</tbody></table>
  <h2 class="section-title">Resting breath across the animal kingdom</h2>
  <table class="air-table"><thead><tr><th>Animal</th><th>Resting breaths / pattern</th><th>Why it is interesting</th></tr></thead><tbody>${animals}</tbody></table>
  <h2 class="section-title">Other engineering for the same job</h2>
  <div class="air-grid">${ways}</div>
  <h2 class="section-title">The CO2 in the room you are reading this in</h2>
  <p>Air at ~420 ppm outdoors climbs in closed rooms simply because of the occupants. If a classroom feels dim by mid-morning, the ventilation \u2014 not the lesson \u2014 is usually the suspect: crack a window and watch the room wake up.</p>
  <table class="air-table"><thead><tr><th>Level</th><th>Where you are</th><th>What it does</th></tr></thead><tbody>${indoor}</tbody></table>`;
  return udaraDoc({
    title: 'How Living Things Breathe \u2014 Humans, Whales, Gills and Insects | Tukuk-OS',
    desc: 'Breathing explained across species: human respiratory numbers, resting rates of animals, whale dives, fish gills, insect tracheae, bird lungs and indoor CO2 levels.',
    selfUrl: 'https://tukuk.org/udara/breath',
    heroTitle: 'Breathing Life', heroSub: 'Twenty thousand times a day, without one decision \u2014 the engineering of a breath',
    body,
  });
}

app.get('/udara', async (req, res) => {
  const [air, co2] = await Promise.allSettled([udara.getAirRanking(), udara.getCo2()]);
  res.type('html').send(udaraHubPage(air.status === 'fulfilled' ? air.value : null, co2.status === 'fulfilled' ? co2.value : null));
});
app.get('/udara/oxygen', (req, res) => res.type('html').send(udaraOxygenPage()));
app.get('/udara/breath', (req, res) => res.type('html').send(udaraBreathPage()));
app.get('/udara/carbon', async (req, res) => {
  let co2 = null;
  try { co2 = await udara.getCo2(); } catch (e) { co2 = null; }
  res.type('html').send(udaraCarbonPage(co2));
});

app.get('/blog/rss.xml', (req, res) => {
  const host = req.get('host') || 'tukuk.org';
  const base = host.includes('tukuk.org') ? `https://${host}` : `${req.protocol}://${host}`;
  const x = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const posts = store.getAllPosts(50);
  const items = posts.map((p) => {
    const link = `${base}/blog/${encodeURIComponent(p.slug)}`;
    const date = (p.updatedAt || p.createdAt || new Date().toISOString());
    return `  <item>
    <title>${x(p.title)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
    <description>${x(p.excerpt || '')}</description>
    <dc:creator>${x(p.author || 'Fevian Donald')}</dc:creator>
    <pubDate>${new Date(date).toUTCString()}</pubDate>
  </item>`;
  }).join('\n');
  res.type('application/rss+xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `<channel>\n` +
    `  <title>Tukuk-OS — Blog &amp; Knowledge Archive</title>\n` +
    `  <link>${base}/blog</link>\n` +
    `  <atom:link href="${base}/blog/rss.xml" rel="self" type="application/rss+xml"/>\n` +
    `  <description>Articles, tutorials and analysis about search technology, web privacy, AI and Tukuk-OS apps.</description>\n` +
    `  <language>en</language>\n` +
    items + `\n</channel>\n</rss>\n`
  );
});

app.get('/blog/:slug', (req, res) => {
  const post = store.getPostBySlug(req.params.slug);
  if (!post) {
    const redirectTo = blogRedirects[req.params.slug];
    if (redirectTo) return res.redirect(301, `/blog/${encodeURIComponent(redirectTo)}`);
    return res.status(404).type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Article Not Found &mdash; Tukuk-OS</title><meta name="robots" content="noindex"><link rel="icon" href="/icon.svg" type="image/svg+xml"><style>${COMMON_CSS}</style><script src="/theme.js"></script><link rel="stylesheet" href="/theme.css"></head><body>${siteHeader('blog')}<div class="wrap"><main><h1>404 &mdash; Article not found</h1><p>Sorry, that article doesn&rsquo;t exist or has moved. Browse the <a href="/blog">full archive</a> or <a href="/">return home</a>.</p></main></div>${siteFooter()}</body></html>`);
  }

  const postDate = new Date(post.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const renderedContent = renderMarkdown(post.content);

  // Nilai lolos-HTML untuk mengelakkan XSS dalam kepala/meta & badan.
  const eTitle = escapeHtml(post.title);
  const eTitleAttr = escapeHtml(post.title);
  const eExcerptAttr = escapeHtml(post.excerpt || '');
  const eAuthor = escapeHtml(post.author || 'Fevian Donald');

  const ogImage = 'https://tukuk.org/og.png';
  const postUrl = `https://tukuk.org/blog/${post.slug}`;
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": postUrl,
        "headline": post.title,
        "description": post.excerpt,
        "image": [ogImage],
        "inLanguage": "en",
        "author": {
          "@type": "Person",
          "name": post.author || "Fevian Donald",
          "url": "https://tukuk.org"
        },
        "datePublished": post.createdAt,
        "dateModified": post.updatedAt || post.createdAt,
        "mainEntityOfPage": { "@type": "WebPage", "@id": postUrl },
        "isPartOf": { "@type": "Blog", "@id": "https://tukuk.org/blog#blog" },
        "publisher": {
          "@type": "Organization",
          "name": "Tukuk-OS",
          "url": "https://tukuk.org",
          "logo": { "@type": "ImageObject", "url": "https://tukuk.org/logo.png", "width": 512, "height": 512 }
        }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://tukuk.org/" },
          { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://tukuk.org/blog" },
          { "@type": "ListItem", "position": 3, "name": post.title, "item": postUrl }
        ]
      }
    ]
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
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ms_MY">
<meta property="article:published_time" content="${escapeHtml(post.createdAt)}">
<meta property="article:modified_time" content="${escapeHtml(post.updatedAt || post.createdAt)}">
<meta property="article:author" content="${eAuthor}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${eTitleAttr}">
<meta name="twitter:description" content="${eExcerptAttr}">
<meta name="twitter:image" content="${ogImage}">
<link rel="alternate" type="application/rss+xml" title="Tukuk-OS Blog" href="/blog/rss.xml">
<link rel="canonical" href="https://tukuk.org/blog/${encodeURIComponent(post.slug)}">
<meta name="google-adsense-account" content="ca-pub-8954948214333501">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${jsonLd}</script>
<style>${COMMON_CSS}</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
${pageAdScript()}${clarityScript()}
</head>
<body>
${siteHeader('blog')}
<div class="wrap">
  <header>
    <a href="/blog" class="back-link">&larr; Back to all articles</a>
    <h1>${eTitle}</h1>
    <div class="meta">Published: ${postDate} &middot; Author: ${eAuthor}</div>
  </header>
  <main>
    ${adUnitGuarded(config.adsense.slotTop, 'top')}${msAdUnit('top')}
    <article>
      ${renderedContent}
      ${adUnitGuarded(config.adsense.slotInArticle, 'in-article')}${msAdUnit('in-article')}
      ${post.tags && post.tags.length ? `<div class="tags" style="margin-top:28px; padding-top:16px; border-top:1px solid var(--line);">${post.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </article>
    ${adUnitGuarded(config.adsense.slotBottom, 'bottom')}${msAdUnit('bottom')}
  </main>
</div>
${siteFooter()}
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
      { method: 'GET', path: '/api/nasa/sky', description: 'Moon phase & twilight times for lat/lng (sunrise-sunset.org + local math)' },
      { method: 'GET', path: '/api/nasa/exoplanets', description: 'Nearest confirmed exoplanets (NASA Exoplanet Archive TAP)' },
      { method: 'GET', path: '/api/nasa/sentry', description: 'Planetary-defense risk objects (NASA/JPL Sentry table)' },
      { method: 'GET', path: '/api/nasa/satellites', description: 'Satellite orbital elements by group (CelesTrak TLE)' },
      { method: 'GET', path: '/api/nasa/archive', description: 'Local NASA archive DB: kind=apod|asteroids|epic, q, limit' },
      { method: 'GET', path: '/api/nasa/archive/stats', description: 'Archive row counts (apod/asteroids/epic)' },
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
    <nav><a href="/">Home</a><a href="/blog">Blog</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></nav>
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

// Social finder — semak kewujudan nama akaun AWAM di platform publik (status
// HTTP profil awam sahaja; tiada login, tiada data peribadi). Diproksikan di
// pelayan kerana pelayar tidak boleh membaca respons silang-asal.
app.get('/api/social', limiter.search, async (req, res) => {
  try {
    res.json(await social.lookup(String(req.query.u || '')));
  } catch (error) {
    res.status(500).json({ error: 'Social lookup failed', details: safeError(error) });
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
    const region = String(req.query.region || '').trim().toLowerCase();
    res.json(await mediaSearch.searchRadio(String(req.query.q || ''), { skip, country, tag, region }));
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

// ── Proksi aliran radio sama-asal (same-origin) ─────────────────────────────
// Pelayar BLOK stream http:// pada halaman https:// ("mixed content"), dan sesetengah
// stesen Asia memblok ikut Referrer/CORS. Muncul ralat "Mixed Content or CORS" semasa main
// Radio. Endpoint ini fetch upstream (HTTP atau HTTPS) di PELAYAN lalu pipe balik byte
// mentah sebagai https://tukuk.org same-origin — selesaikan mixed-content + CORS +
// hotlink-referrer serentak. Tiada ICY metadata dipinta (audio tulen, mudah di-pipe).
// Aliran HIDUP (tak tamat) — jadi tiada timeout body; hanya timeout sambungan + abort
// bila klien putuskan hubungan.
app.get('/radio/stream', limiter.search, async (req, res) => {
  const target = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(target)) return res.status(400).end();
  let upstreamUrl;
  try {
    upstreamUrl = await assertPublicUrl(target); // sekat SSRF alamat dalaman
  } catch {
    return res.status(400).end();
  }
  const controller = new AbortController();
  const abort = () => { try { controller.abort(); } catch { /* sudah tamat */ } };
  req.on('close', abort);
  res.on('close', abort);
  const connectTimer = setTimeout(abort, 10000); // hanya had masa SAMBUNG, bukan body
  try {
    const upstream = await fetch(upstreamUrl.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer': upstreamUrl.origin + '/',
        'Accept': '*/*',
      },
    });
    clearTimeout(connectTimer); // kepala diterima — jangan bunuh badan stream hidup
    if (!upstream.ok && upstream.status !== 200 && upstream.status !== 206) {
      if (!res.headersSent) res.status(502).end();
      return;
    }
    const ct = upstream.headers.get('content-type') || 'audio/mpeg';
    res.status(200);
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // matikan buffering nginx/edge jika ada
    if (!upstream.body) { res.end(); return; }
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => { try { res.end(); } catch { /* sudah tamat */ } });
    nodeStream.pipe(res);
  } catch (err) {
    clearTimeout(connectTimer);
    if (!res.headersSent) res.status(502).end();
    else { try { res.end(); } catch { /* sudah tamat */ } }
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

// Bulan & langit malam ini — fasa bulan setempat + waktu senja ikut lokasi (lat/lng, lalai KL)
app.get('/api/nasa/sky', async (req, res) => {
  try {
    res.json(await nasa.getSkyTonight({ lat: req.query.lat, lng: req.query.lng }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read sky data', details: safeError(error) });
  }
});

// Pemburu eksoplanet — katalog archive NASA (had 10–500 baris paling dekat)
app.get('/api/nasa/exoplanets', async (req, res) => {
  try {
    res.json(await nasa.getExoplanets({ limit: req.query.limit }));
  } catch (error) {
    res.status(502).json({ error: 'Exoplanet archive unreachable or busy — try again shortly', details: safeError(error) });
  }
});

// Pertahanan planet — jadual risiko impak Sentry (JPL)
app.get('/api/nasa/sentry', async (req, res) => {
  try {
    res.json(await nasa.getSentryRisk());
  } catch (error) {
    res.status(502).json({ error: 'JPL Sentry service unreachable — try again shortly', details: safeError(error) });
  }
});

// Ceruk satelit — elemen orbit TLE dari CelesTrak ikut kumpulan
app.get('/api/nasa/satellites', async (req, res) => {
  try {
    res.json(await nasa.getSatellites({ group: req.query.group }));
  } catch (error) {
    res.status(502).json({ error: 'CelesTrak unreachable — try again shortly', details: safeError(error) });
  }
});

// Pangkalan data arkib NASA setempat — dibaca terus dari cakera (tanpa API NASA),
// jadi pantas & sentiasa ada walaupun api.nasa.gov down. q menapis tajuk/penjelasan.
app.get('/api/nasa/archive', (req, res) => {
  const kind = String(req.query.kind || 'apod').toLowerCase();
  if (kind === 'apod') {
    return res.json({ source: 'local-archive', items: nasa.store.listApod({ limit: req.query.limit, q: req.query.q }) });
  }
  if (kind === 'asteroids') {
    return res.json({
      source: 'local-archive',
      items: nasa.store.searchAsteroids({ q: req.query.q, limit: req.query.limit, hazardousOnly: req.query.hazardous === '1' })
    });
  }
  if (kind === 'epic') {
    return res.json({ source: 'local-archive', items: nasa.store.listEpic({ limit: req.query.limit }) });
  }
  res.status(400).json({ error: "kind must be one of: apod | asteroids | epic" });
});

// Statistik arkib (jumlah rekod setiap koleksi) untuk papan pemuka & AI.
app.get('/api/nasa/archive/stats', (req, res) => {
  res.json({ source: 'local-archive', ...nasa.store.stats() });
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

// Meta pemilikan per-app (kunci edit + tajuk) — fail berasingan, TIDAK dilayan web.
function metaPath(slug) { return path.join(PUBLISH_DIR, `${slug}.meta.json`); }
function readMeta(slug) {
  if (!publish.isSlug(slug)) return null;
  try { return JSON.parse(fs.readFileSync(metaPath(slug), 'utf8')); } catch { return null; }
}
function writeMeta(slug, obj) {
  try { fs.writeFileSync(metaPath(slug), JSON.stringify(obj), 'utf8'); } catch { /* meta best-effort */ }
}
function newEditKey() { return require('crypto').randomBytes(16).toString('hex'); }
function verifyKey(stored, provided) {
  try {
    const a = Buffer.from(String(stored || '')), b = Buffer.from(String(provided || ''));
    return a.length === b.length && require('crypto').timingSafeEqual(a, b);
  } catch { return false; }
}

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
  if (!html) return res.status(400).json({ error: 'No content to publish' });
  if (html.length > publish.PUBLISH_MAX_BYTES) return res.status(413).json({ error: 'App too large (max ~1.5MB)' });
  if (!publish.looksLikeHtml(html)) return res.status(400).json({ error: 'Not a valid HTML document' });
  try {
    fs.mkdirSync(PUBLISH_DIR, { recursive: true });
    // Slug: hormati permintaan eksplisit pengguna (jika sah & kosong), jika tidak jana unik daripada nama.
    let slug;
    const want = String(body.slug || '').trim().toLowerCase();
    if (want) {
      if (!publish.isSlug(want)) return res.status(400).json({ error: 'Invalid slug — lowercase letters/digits/hyphen, 3–40 chars' });
      if (fs.existsSync(path.join(PUBLISH_DIR, `${want}.html`))) return res.status(409).json({ error: 'That link is already taken — try another name' });
      slug = want;
    } else {
      slug = uniqueSlug(publish.slugify(body.name || 'app'));
    }
    if (!slug) return res.status(500).json({ error: 'Failed to generate unique link' });
    const tmp = path.join(PUBLISH_DIR, `${slug}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, html, 'utf8');
    fs.renameSync(tmp, path.join(PUBLISH_DIR, `${slug}.html`));
    const editKey = newEditKey();
    // kind: 'game' hanya bila dihantar eksplisit (Pembina tahu kandungan kanvas); selainnya 'app'.
    const kind = String(body.kind || '').toLowerCase() === 'game' ? 'game' : 'app';
    writeMeta(slug, { key: editKey, title: publish.extractTitle(html, truncate(String(body.name || ''), 80)), created: Date.now(), updated: Date.now(), kind });
    const url = `${publish.publicOrigin(req)}/a/${slug}`;
    const srcTag = truncate(String(body.source || '').replace(/[^a-z0-9_-]/g, ''), 24);
    store.event('publish', `Aplikasi diterbitkan: /a/${slug}${srcTag ? ' [' + srcTag + ']' : ''}`, { name: truncate(String(body.name || ''), 120), bytes: html.length, source: srcTag || 'manual' });
    notifyIndexNow(url); // pautan awam → indeks (opt-in)
    res.json({ ok: true, slug, url, editKey });
  } catch (error) {
    res.status(500).json({ error: 'Publish failed', details: safeError(error) });
  }
});

// Terbit semula ke slug yang sama (bukti pemilikan via editKey).
app.post('/api/publish/update', publishLimiter, (req, res) => {
  const body = req.body || {};
  const slug = String(body.slug || '');
  const html = String(body.html || '');
  if (!publish.isSlug(slug)) return res.status(400).json({ error: 'Invalid slug' });
  if (!publish.isEditKey(body.editKey)) return res.status(400).json({ error: 'Invalid edit key' });
  if (!html) return res.status(400).json({ error: 'No content to publish' });
  if (html.length > publish.PUBLISH_MAX_BYTES) return res.status(413).json({ error: 'App too large (max ~1.5MB)' });
  if (!publish.looksLikeHtml(html)) return res.status(400).json({ error: 'Not a valid HTML document' });
  const meta = readMeta(slug);
  if (!meta || !verifyKey(meta.key, body.editKey)) return res.status(403).json({ error: 'Forbidden — edit key does not match' });
  const file = path.join(PUBLISH_DIR, `${slug}.html`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'App not found' });
  try {
    const tmp = path.join(PUBLISH_DIR, `${slug}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, html, 'utf8');
    fs.renameSync(tmp, file);
    meta.title = publish.extractTitle(html, meta.title || 'Aplikasi');
    meta.updated = Date.now();
    if (body.kind === 'game' || body.kind === 'app') meta.kind = String(body.kind);
    writeMeta(slug, meta);
    store.event('publish', `Aplikasi dikemas kini: /a/${slug}`, { bytes: html.length });
    res.json({ ok: true, slug, url: `${publish.publicOrigin(req)}/a/${slug}` });
  } catch (error) {
    res.status(500).json({ error: 'Update failed', details: safeError(error) });
  }
});

// Buang/nyahterbit app secara selamat (bukti pemilikan via editKey). Fail .html + .meta dipadam.
app.post('/api/publish/delete', publishLimiter, (req, res) => {
  const body = req.body || {};
  const slug = String(body.slug || '');
  if (!publish.isSlug(slug)) return res.status(400).json({ error: 'Invalid slug' });
  if (!publish.isEditKey(body.editKey)) return res.status(400).json({ error: 'Invalid edit key' });
  const meta = readMeta(slug);
  if (!meta || !verifyKey(meta.key, body.editKey)) return res.status(403).json({ error: 'Forbidden — edit key does not match' });
  try {
    fs.rmSync(path.join(PUBLISH_DIR, `${slug}.html`), { force: true });
    fs.rmSync(metaPath(slug), { force: true });
    store.event('publish', `Aplikasi dibuang: /a/${slug}`, {});
    res.json({ ok: true, slug });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed', details: safeError(error) });
  }
});

// Kiraan "dilihat" untuk /store — in-memory, disatukan ke fail dengan debounce supaya
// setiap permintaan /a/<slug> hanya tulis cakera sekali sekala (bukan setiap hit).
const VIEWS_PATH = path.join(path.dirname(config.store.path), 'publish-views.json');
let pubViews = {};
try { pubViews = JSON.parse(fs.readFileSync(VIEWS_PATH, 'utf8')) || {}; } catch { pubViews = {}; }
let viewsTimer = null;
function flushViews() { viewsTimer = null; try { fs.writeFileSync(VIEWS_PATH, JSON.stringify(pubViews)); } catch { /* best-effort */ } }
function bumpViews(slug) {
  pubViews[slug] = (pubViews[slug] || 0) + 1;
  if (!viewsTimer) { viewsTimer = setTimeout(flushViews, 5000); if (viewsTimer.unref) viewsTimer.unref(); }
}

// Kata kunci game untuk terbitan klasik (meta tanpa kind) — tekaan berdasarkan tajuk.
const GAME_TITLE_RE = /tic[- ]?tac|arked|battle[- ]?royale|\bfps\b|runner|padanan[- ]memori|tikus[- ]pukul|teka[- ]nombor|batu[- ]kertas|lari[- ]tanpa|\bgame\b/i;

// Kiraan "main" untuk halaman /play (gaya web-games.io) — sama corak dengan publish-views:
// in-memory + tulis cakera berdebounce supaya setiap sesi main tidak menulis fail seorang.
const PLAYS_PATH = path.join(path.dirname(config.store.path), 'plays.json');
let playsMap = {};
try { playsMap = JSON.parse(fs.readFileSync(PLAYS_PATH, 'utf8')) || {}; } catch { playsMap = {}; }
let playsTimer = null;
function flushPlays() { playsTimer = null; try { fs.writeFileSync(PLAYS_PATH, JSON.stringify(playsMap)); } catch { /* best-effort */ } }
function bumpPlays(id) {
  playsMap[id] = (playsMap[id] || 0) + 1;
  if (!playsTimer) { playsTimer = setTimeout(flushPlays, 5000); if (playsTimer.unref) playsTimer.unref(); }
}

// Genre game (gaya web-games.io) — chip /store & kad berkaitan /play dibina daripada
// nilai ini sahaja. Store arked guna genre eksplisit; sumber lain dinormalisasi/tekaan.
const GAME_GENRES = new Set(['arkad', 'teki-teki', 'refleks', 'kuiz', 'tindakan', 'penembakan', 'santai', 'kereta', 'sukan', 'klik', 'io', 'board', 'cards']);
const GENRE_SYNONYM = { arkade: 'arkad', arcade: 'arkad', action: 'tindakan', shooter: 'penembakan', puzzle: 'teki-teki', reflex: 'refleks', casual: 'santai', racing: 'kereta', car: 'kereta', sport: 'sukan', clicker: 'klik', quiz: 'kuiz', board: 'board', card: 'cards', cards: 'cards' };
// Display labels for internal (Malay-keyed) genres — user-facing surfaces are English.
const GENRE_UI = { arkad: 'Arcade', 'teki-teki': 'Puzzle', refleks: 'Reflex', kuiz: 'Quiz', tindakan: 'Action', penembakan: 'Shooter', santai: 'Casual', kereta: 'Racing', sukan: 'Sports', klik: 'Clicker', io: 'IO', board: 'Board', cards: 'Cards' };
function normalizeGenre(g) {
  const s = String(g || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (GAME_GENRES.has(s)) return s;
  return GAME_GENRES.has(GENRE_SYNONYM[s]) ? GENRE_SYNONYM[s] : null;
}
// Tebakan genre berasaskan kata kunci (komuniti / satu kata) — default 'arkad' supaya
// setiap game pasti ada genre (tiada kad tersesat dari penapis chip).
function guessGameGenre(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  if (/\.io\b|\bio\b/.test(t)) return 'io';
  if (/(kereta|\bcar\b|racing|lumba|drift)/.test(t)) return 'kereta';
  if (/(sukan|footbal|bola|basket|sokker)/.test(t)) return 'sukan';
  if (/(klik|clicker|idle)/.test(t)) return 'klik';
  if (/(penembak|tembak|shooter|shooting|\bfps\b)/.test(t)) return 'penembakan';
  if (/(tindakan|action|battle|royale|\brpg\b)/.test(t)) return 'tindakan';
  if (/(kuiz|quiz|trivia)/.test(t)) return 'kuiz';
  if (/(refleks|reflex|reaksi|tikus|\bmola\b)/.test(t)) return 'refleks';
  if (/(teki|puzzle|memori|2048|sudoku|jigsaw|ambang|rambau|blok|jajar)/.test(t)) return 'teki-teki';
  if (/(santai|casual|lari|runner)/.test(t)) return 'santai';
  return 'arkad';
}

// Senarai app awam (slug terbaru) — ringan, untuk indeks /a + katalog /store.
function listPublished(limit = 200) {
  try {
    return fs.readdirSync(PUBLISH_DIR)
      .filter((f) => f.endsWith('.html'))
      .map((f) => {
        const s = f.slice(0, -5); let t = 0; try { t = fs.statSync(path.join(PUBLISH_DIR, f)).mtimeMs; } catch {}
        const meta = readMeta(s);
        const title = (meta && meta.title) ? meta.title : s;
        const kind = (meta && meta.kind) ? meta.kind : (GAME_TITLE_RE.test(title) ? 'game' : 'app');
        return { slug: s, t, title, kind, created: (meta && meta.created) || t, views: pubViews[s] || 0 };
      })
      .sort((a, b) => b.t - a.t)
      .slice(0, limit);
  } catch { return []; }
}

// JSON senarai app awam — untuk panel "Pameran" dalam /builder + katalog /store.
app.get('/api/published', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const items = listPublished(limit).map((x) => ({ slug: x.slug, title: truncate(x.title, 80), url: `/a/${x.slug}`, updated: x.t, created: x.created, kind: x.kind, views: x.views }));
  res.json({ ok: true, count: items.length, items });
});

// ── Tukuk Store (/store): katalog 4 sumber — Bawaan + Satu Kata + Arked + Komuniti. ────
// Bawaan = app mini di public/apps (hanya yang failnya benar-benar wujud supaya /store
// tak benjol pautan 404 — tambah fail HTML baru + entri meta, ia muncul sendiri).
const STORE_APP_META = {
  notes: { ic: '📝', title: 'Notes', desc: 'Local notes with autosave, tags & search — nothing ever leaves your device.' },
  calc: { ic: '🧮', title: 'Calculator', desc: 'Scientific calculator with history, parentheses & copy result.' },
  todo: { ic: '✅', title: 'To-Do', desc: 'Task list with priorities, filters & local storage.' },
  convert: { ic: '📐', title: 'Unit Converter', desc: 'Convert length, mass, temperature, volume, speed & many more.' },
  timer: { ic: '⏱️', title: 'Timer & Pomodoro', desc: 'Stopwatch, timer & scheduled breaks with sound.' },
  color: { ic: '🎨', title: 'Color Picker', desc: 'HEX/RGB/HSL, shades/tints, complementary palettes & contrast ratios.' },
  password: { ic: '🔐', title: 'Password Generator', desc: 'Cryptographic random passwords + hard-to-guess passphrases.' },
  text: { ic: '🔡', title: 'Text Tools', desc: 'Word count, case conversion, Base64, sort, dedupe & URL encode.' },
  linux: { ic: '🐧', title: 'Linux Utils', desc: 'Safe terminal toolbox in the browser: htop-style system monitor, sha256sum, base64, jq-style JSON formatter, grep-style regex tester, uuidgen & a chmod calculator. Runs fully offline — no server, no shell.' },
  netsec: { ic: '🛡️', title: 'Cyber Security', desc: 'Everyone\'s cyber-safety hub with Kali-style safe tools: hashing & file digests, codecs, ciphers, IP/CIDR/IPv6/MAC + any-IP geolocation, phone number finder (line type, region & local time, one-tap WhatsApp/Telegram links), public username finder (trace fake accounts), DNS-over-HTTPS, RDAP/WHOIS, password strength + HIBP breach check + crack-time math, local TOTP 2FA, phishing link triage, email header SPF/DKIM/DMARC, JWT decoder, port guide, browser-leak scan, EXIF photo cleaner, diceware passphrases & a safety checklist. All on-device — no scanning, no exploits.' },
  map: { ic: '🗺️', title: 'Map', desc: 'Full world map inside Tukuk OS — OpenStreetMap powered, no API key. Search any place, switch to satellite, drop pins, get live GPS position and measure distances.' },
  pixel: { ic: '🟩', title: 'Pixel Studio', desc: 'Draw 16×16 pixel art with palette, buckets and PNG export — in the browser.' },
  piano: { ic: '🎹', title: 'Synth Piano', desc: 'Play 2 octaves with keyboard, 4 waveforms & audio recording.' },
  spiro: { ic: '🌀', title: 'Spiro Mandala', desc: 'Animated symmetric spirograph art — tune parameters, export PNG.' },
  orbit: { ic: '🪐', title: 'Orbit Simulator', desc: 'Real gravity physics — drag to launch planets, binary-star & chaotic-system presets.' },
  fractal: { ic: '🔮', title: 'Fractal Explorer', desc: 'Limitless Mandelbrot zoom with progressive rendering, 4 palettes & PNG export.' },
  drum: { ic: '🥁', title: 'Rhythm Machine', desc: '16-step drum machine: WebAudio-synthesised kick/snare/hihat/clap, play & record patterns.' },
  // ── Hit game ports (Android classics rebuilt as in-browser HTML5) ──
  candy: { ic: '🍬', title: 'Candy Blast', desc: 'The famous match-3 puzzle: swap sweets, break cascades, chain combos for a high score.', game: true, genre: 'teki-teki' },
  flappy: { ic: '🐦', title: 'Flappy Dash', desc: 'The legendary one-tap flying game — squeeze the bird through endless pipes.', game: true, genre: 'refleks' },
  subway: { ic: '🚇', title: 'Subway Dash 3D', desc: 'A premium pseudo-3D endless runner: swipe to dodge trains, jump hurdles, slide under signs, grab coin combos, ride hoverboards, magnets & jetpacks. Speed multiplier, day/night runs and a global high-score leaderboard.', game: true, genre: 'arkad' },
  slice: { ic: '🍉', title: 'Fruit Slice', desc: 'Ninja swipe action — slice the flying fruit, dodge the bombs, chase combo cuts.', game: true, genre: 'refleks' },
  roadhop: { ic: '🐸', title: 'Road Hop', desc: 'Hop across endless traffic and rivers — the cozy crossing puzzle that took over mobile.', game: true, genre: 'santai' },
  bubble: { ic: '🫧', title: 'Bubble Pop', desc: 'Classic bubble shooter — match 3+ colours, drop orphan clusters before the ceiling reaches you.', game: true, genre: 'teki-teki' },
  ludo: { ic: '🎲', title: 'Ludo', desc: 'The four-color board game famous on Android — you (Red) vs three computers. Roll, capture, race home.', game: true, genre: 'board' },
  solitaire: { ic: '🃏', title: 'Solitaire', desc: 'Klondike — the card game that ships with every phone. Tap to move, auto-finish when you can.', game: true, genre: 'cards' },
  number2048: { ic: '🧊', title: '2048', desc: 'The legendary sliding-tile puzzle: swipe to merge matching numbers and reach the 2048 tile.', game: true, genre: 'teki-teki' },
  blockdrop: { ic: '🧩', title: 'Block Drop', desc: 'The timeless falling-block game — slide, rotate and clear rows before the stack tops out.', game: true, genre: 'teki-teki' },
  snake: { ic: '🐍', title: 'Snake', desc: 'The Nokia-era classic that never dies: steer, eat, grow longer and don\'t crash into yourself.', game: true, genre: 'arkad' },
  mines: { ic: '💣', title: 'Minesweeper', desc: 'The pre-installed puzzle: open every safe square and flag the hidden mines. Tap to open, hold to flag.', game: true, genre: 'teki-teki' },
  connect4: { ic: '🔴', title: 'Connect Four', desc: 'The famous drop-disc game — line up four before the computer blocks you and wins.', game: true, genre: 'board' },
  breakout: { ic: '🧱', title: 'Breakout', desc: 'The original brick-breaker: bounce the ball, smash every block across faster levels.', game: true, genre: 'arkad' },
  invaders: { ic: '👾', title: 'Space Invaders', desc: 'The arcade shooter legend — blast the descending alien formation and dodge their bombs.', game: true, genre: 'penembakan' },
  doodle: { ic: '🦘', title: 'Doodle Jump', desc: 'One of the most-downloaded phone games ever: auto-bounce upward and steer onto every platform.', game: true, genre: 'refleks' },
  pong: { ic: '🏓', title: 'Pong', desc: 'The original 1972 duel: drag your paddle, out-rally the CPU to 7. Rally speeds up every hit.', game: true, genre: 'arkad' },
  stack: { ic: '🗼', title: 'Stack Tower', desc: 'The viral one-tap tower: time each drop, shave the overhang, chain PERFECTs. How high?', game: true, genre: 'santai' },
  simon: { ic: '🎼', title: 'Simon Tones', desc: 'Watch the colour-tone sequence, echo it back. Every round adds one more — how far does your memory go?', game: true, genre: 'teki-teki' },
  muncher: { ic: '🟡', title: 'Maze Muncher', desc: 'Munch every dot while a ghost hunts you; power pellets turn the hunter into prey.', game: true, genre: 'arkad' },
  puzzle15: { ic: '🔢', title: 'Slide 15', desc: 'The classic 4×4 sliding-number puzzle — always solvable, count your moves.', game: true, genre: 'teki-teki' },
  tictactoe: { ic: '❎', title: 'Tic-Tac-Toe', desc: 'Three-in-a-row against a minimax CPU with Easy/Medium/Unbeatable levels.', game: true, genre: 'board' },
  memory: { ic: '🧠', title: 'Memory Match', desc: 'Flip and match eight emoji pairs on the 4×4 board in as few moves as you can.', game: true, genre: 'teki-teki' },
  whack: { ic: '🔨', title: 'Whack-a-Mole', desc: '25 seconds, nine holes: moles +1, golden +3, bombs −5. Faster every second.', game: true, genre: 'refleks' },
  calendar: { ic: '📅', title: 'Calendar', desc: 'Month view with today highlighted, ISO week numbers and quick month hopping — fully offline.' },
  dice: { ic: '🪙', title: 'Dice & Coin', desc: 'Crypto-random d4–d100 dice, coin flips and a who-pays decider. No internet needed.' },
  tip: { ic: '💵', title: 'Tip Split', desc: 'Bill, tip percent and heads-count — instant per-person split at the dinner table.' },
  bmi: { ic: '⚖️', title: 'BMI Check', desc: 'Body mass index with colour gauge and healthy-weight range, metric or imperial.' },
  chat: { ic: '/icons/apps/chat.svg?v=3', title: 'T Chat', desc: 'A real messenger in your browser that keeps working on weak networks (2G/3G/4G/GPRS). Install as an app on Android, iOS, Windows, Linux & Huawei, or download the native Android APK directly (beta — stable coming soon). Name + password signup, permanent Tukuk ID, public room, 1-to-1 DMs and groups, video & voice calls (WebRTC) with TukuCaller-style caller ID, fake-call prank mode (no network needed), voice messages, offline outbox (auto-resend), data-saving mode (tap-to-load media), read receipts ✓✓, photo & video sending, reply, forward, reactions, edit, pin messages, search, friends & blocking, wallpapers & sounds.' }
};
// Arked = templat game Pembina; dibuka dengan ?tpl=<nama> → /builder muat & terus main.
// genre = label penapis /store (gaya web-games.io).
const STORE_ARCADE = [
  { tpl: 'arcade', genre: 'arkad', ic: '🕹️', title: 'Mini Arcade', desc: 'Tic-Tac-Toe + Memory Match + Whack-a-Mole + Reaction Time on one page.' },
  { tpl: 'tttpl', genre: 'teki-teki', ic: '⭕', title: 'Tic-Tac-Toe', desc: 'The classic two-player game — line up three to win.' },
  { tpl: 'brtpl', genre: 'tindakan', ic: '🔫', title: 'Battle Royale Arena', desc: 'WASD/mouse or touch joystick — dodge the blue zone, stay alive.' },
  { tpl: 'fpstpl', genre: 'penembakan', ic: '🎯', title: 'FPS Arena 3D', desc: 'Lightweight 3D first-person shooter, straight in the browser.' },
  { tpl: 'runtpl', genre: 'santai', ic: '🏃', title: 'Endless Runner', desc: 'Click / tap / Space to jump — dodge obstacles as far as you can.' },
  { tpl: 'memtpl', genre: 'teki-teki', ic: '🧠', title: 'Memory Match', desc: 'Flip cards and match every pair as fast as possible.' },
  { tpl: 'moletpl', genre: 'refleks', ic: '🐹', title: 'Whack-a-Mole', desc: 'Just 20 of them — whack the moles as fast as you can.' },
  { tpl: 'rpstpl', genre: 'teki-teki', ic: '✊', title: 'Rock-Paper-Scissors', desc: 'Pick your hand, go up against the CPU head-to-head.' },
  { tpl: 'reacttpl', genre: 'refleks', ic: '⚡', title: 'Reaction Time', desc: 'Wait for green, click as fast as possible — measure your milliseconds.' },
  { tpl: 'guesstpl', genre: 'teki-teki', ic: '🔢', title: 'Number Guess', desc: 'A number 1–100 has been picked — guess it with higher/lower hints.' },
  { tpl: 'quiztpl', genre: 'kuiz', ic: '💡', title: 'Quick Quiz', desc: 'Multiple-choice questions with instant green/red answers.' },
  { tpl: 'astrotpl', genre: 'penembakan', ic: '☄️', title: 'Asteroids', desc: 'Vector classic: turn, thrust, shoot — big asteroids split in two.' }
];
function storeBawaan() {
  return Object.entries(STORE_APP_META)
    .filter(([name]) => fs.existsSync(path.join(PUBLIC_DIR, 'apps', `${name}.html`)))
    .map(([name, m]) => ({ id: 'bv-' + name, kind: m.game ? 'game' : 'app', src: 'bawaan', genre: m.game ? m.genre : null, icon: m.ic, title: m.title, desc: m.desc, url: `/apps/${name}`, updated: 0 }));
}
// Satu Kata = pasangan app+game dijana CI (generated/manifest.json → /satu-kata/<slug>/{app,game}/).
// Dikache ikut mtime manifest; fail HTML disahkan wujud sebelum disenaraikan.
const SK_DIR = path.join(__dirname, '..', 'generated');
let skCache = { mtime: -1, entries: [] };
function storeSatuKata() {
  let mtime = 0;
  try { mtime = fs.statSync(path.join(SK_DIR, 'manifest.json')).mtimeMs; } catch { return []; }
  if (skCache.mtime !== mtime) {
    skCache = { mtime, entries: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SK_DIR, 'manifest.json'), 'utf8'));
      skCache.entries = (Array.isArray(raw.entries) ? raw.entries : [])
        .filter((e) => e && e.slug && publish.isSlug(String(e.slug)) && String(e.word || '').trim());
    } catch { /* manifest rosak → katalog tetap hidup tanpa Satu Kata */ }
  }
  const out = [];
  for (const e of skCache.entries) {
    const dir = path.join(SK_DIR, 'public', e.slug);
    const t = Date.parse(e.createdAt) || 0;
    const word = String(e.word).trim();
    if (fs.existsSync(path.join(dir, 'app', 'index.html'))) out.push({ id: 'sk-' + e.slug, kind: 'app', src: 'satukata', icon: e.emoji || '⚡', title: 'App ' + word, desc: `One-word app «${word}» — ${e.tagline || 'auto-generated'}`, url: `/satu-kata/${e.slug}/app/`, updated: t });
    if (e.game && fs.existsSync(path.join(dir, 'game', 'index.html'))) out.push({ id: 'skg-' + e.slug, kind: 'game', src: 'satukata', genre: normalizeGenre(e.genre) || guessGameGenre(word + ' ' + (e.genre || '')), icon: e.emoji || '🎮', title: 'Game ' + word, desc: `Game «${word}» (${GENRE_UI[e.genre] || e.genre || 'Arcade'}) — ${e.tagline || ''}`, url: `/satu-kata/${e.slug}/game/`, updated: t });
  }
  return out;
}
function storeCatalog() {
  const arked = STORE_ARCADE.map((g) => ({ id: 'ak-' + g.tpl, kind: 'game', src: 'arked', genre: g.genre, icon: g.ic, title: g.title, desc: g.desc, url: '/builder?tpl=' + g.tpl + '&play=1', updated: 0 }));
  const komuniti = listPublished(200).map((x) => ({ id: 'km-' + x.slug, kind: x.kind, src: 'komuniti', genre: x.kind === 'game' ? guessGameGenre(x.title) : null, icon: x.kind === 'game' ? '🎮' : '📱', title: truncate(x.title, 80), desc: 'Community publish from the Studio Builder.', url: `/a/${x.slug}`, views: x.views, updated: x.t }));
  const items = storeBawaan().concat(storeSatuKata(), arked, komuniti);
  // Kiraan "main" — komuniti belum ada riwayat main → jatuh kepada "dilihat" supaya
  // bahagian Trending kekal bermakna sejak hari pertama.
  for (const it of items) it.plays = playsMap[it.id] || (it.src === 'komuniti' ? (it.views || 0) : 0);
  return items;
}
app.get('/api/store', (req, res) => {
  try {
    const items = storeCatalog();
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({ ok: true, count: items.length, items });
  } catch (error) {
    res.status(500).json({ error: 'Failed to build catalog', details: safeError(error) });
  }
});

// Kiraan sesi main — dipanggil sekali setiap kali game dimuat dalam /play. Data awam
// ringan (seperti skor); had-kadar longgar tapi cukup untuk elak pembaziran tulis fail.
const playLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 60 * 60 * 1000, max: 300, keyPrefix: 'play:' })
  : (req, res, next) => next();
app.post('/api/play/:id', playLimiter, (req, res) => {
  try {
    const known = storeCatalog().some((x) => x.id === String(req.params.id));
    if (!known) return res.status(404).json({ error: 'Unknown store item' });
    bumpPlays(String(req.params.id));
    res.json({ ok: true, plays: playsMap[String(req.params.id)] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to count play sessions', details: safeError(error) });
  }
});

// Landing games /play — paparan senarai (fail play.html). Tanpa ini `/play` 404
// kerana statik tidak henti-ekstensi & `/play/:id` hanya capai id store.
app.get('/play', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'play.html'), (error) => {
    if (error) res.status(404).json({ error: 'Play page not found', path: req.originalUrl });
  });
});

// Halaman pemain /play/<item-id> (gaya web-games.io) — fail statik yang sama untuk semua
// id; JS halaman cari item dalam /api/store & menempek URL-nya. Hanya id WUJUD dilayan.
app.get('/play/:id', (req, res) => {
  const item = storeCatalog().find((x) => x.id === String(req.params.id));
  if (!item) {
    return res.status(404).type('html').send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Not found — Tukuk Store</title><style>body{font:16px system-ui;padding:40px;background:#0f1115;color:#e6e9ef}a{color:#4c8dff}</style></head><body><h1>404</h1><p>That store item does not exist.</p><p><a href="/store">← Back to Store</a></p></body></html>');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'play.html'), (error) => {
    if (error) res.status(404).json({ error: 'Play page not found', path: req.originalUrl });
  });
});

// ── APK atas-permintaan (tukuk.org = gedung apl, gaya APKPure) ─────────────────
//   Setiap item katalog /store (bawaan / arked / satu kata / komuniti) boleh
//   dijadikan APK pembungkus WebView yang membuka URL apl itu. Pembina memanggil
//   scripts/build-apk.sh (aapt2/d8/apksigner) dengan env per-apl. Semua APK
//   ditandatangani dengan kunci Tukuk yang sama (apk/tukuk-chat-release.jks) supaya
//   satu pengenal-penerbit & kemas kini berjalan lancar. Output dikache di
//   public/downloads — permintaan seterusnya hidang fail cache (tiada bina semula).
//   Keselamatan: hanya id yang WUJUD dalam storeCatalog dilayan (URL sentiasa milik
//   tukuk.org sendiri — tiada SSRF/pembungkusan laman luar); label & slug disanitasi.
const APK_ORIGIN = process.env.APK_ORIGIN || 'https://tukuk.org';
const APK_REPO = path.join(__dirname, '..');
const APK_OUT_DIR = path.join(APK_REPO, 'public', 'downloads');
const APK_BUILD_SH = path.join(APK_REPO, 'scripts', 'build-apk.sh');
const APK_ICON_DEFAULT = 'public/icons/launcher-default.png';
const apkBuildLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 60 * 1000, max: 6, keyPrefix: 'apkbuild:' })
  : (req, res, next) => next();

// Slug paket/fail stabil & sah (alfanumerik kecil, bermula huruf) daripada id item.
// bv-/ak- buang tag sumber → padan APK statik sedia ada (tukuk-calc.apk, org.tukuk.calc);
// sk-/skg-/km- kekalkan prefix → tiada pertindihan silang-sumber (km-chat ≠ chat).
function apkSlug(id) {
  const s = String(id || '');
  let base = s;
  if (s.startsWith('bv-')) base = s.slice(3);
  else if (s.startsWith('ak-')) base = s.slice(3);
  const cleaned = base.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!cleaned) return 'app';
  return (/^[a-z]/.test(cleaned) ? cleaned : 'a' + cleaned).slice(0, 40);
}
// Label selamat untuk heredoc strings.xml: buang aksara shell (<>&"'`$\) & XML.
function apkLabel(title) {
  const clean = String(title || '').replace(/[<>&"'`$\\]/g, '').replace(/\s+/g, ' ').trim();
  return (clean || 'Tukuk App').slice(0, 30);
}
// SDK untuk proses anak (root tiada $HOME/Android/Sdk pada VPS → cari calon).
function findAndroidSdk() {
  const cands = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    '/home/tukuk/Android/Sdk', path.join(process.env.HOME || '/root', 'Android/Sdk'), '/root/Android/Sdk'];
  for (const c of cands) { if (c && fs.existsSync(path.join(c, 'build-tools'))) return c; }
  return null;
}
// id item store → spesifikasi binaan, atau null jika tak dikenali.
function apkSpec(id) {
  const item = storeCatalog().find((x) => x.id === id);
  if (!item) return null;
  const slug = apkSlug(item.id);
  const rel = String(item.url || '/');
  const url = APK_ORIGIN + (rel.startsWith('/') ? rel : '/' + rel);
  const isChat = item.id === 'bv-chat';
  let icon = APK_ICON_DEFAULT;
  if (item.src === 'bawaan') {
    const name = rel.replace(/^\/apps\//, '');
    const special = path.join(APK_REPO, 'public', 'icons', 'apps', `${name}-512.png`);
    if (fs.existsSync(special)) icon = `public/icons/apps/${name}-512.png`;
  }
  return { id: item.id, slug, pkg: `org.tukuk.${slug}`, label: apkLabel(item.title),
    url, icon, media: isChat ? 1 : 0, vc: isChat ? 3 : 1, vn: isChat ? '1.0.1' : '1.0.0',
    file: `tukuk-${slug}.apk` };
}

// Bina APK (kunci in-flight per-slug supaya permintaan serentak tak bina berganda).
const apkInflight = new Map();
function buildApk(spec) {
  const absOut = path.join(APK_OUT_DIR, spec.file);
  if (fs.existsSync(absOut)) return Promise.resolve({ ok: true, cached: true });
  if (apkInflight.has(spec.slug)) return apkInflight.get(spec.slug);
  const sdk = findAndroidSdk();
  if (!sdk) return Promise.resolve({ ok: false, error: 'Android SDK (build-tools) not found on the server' });
  const env = { ...process.env, ANDROID_HOME: sdk,
    APP_SLUG: spec.slug, APP_PKG: spec.pkg, APP_LABEL: spec.label, APP_URL: spec.url,
    APP_ICON: spec.icon, APP_MEDIA: String(spec.media), APP_VC: String(spec.vc),
    APP_VN: spec.vn, BUILD_AAB: '0' };
  const p = new Promise((resolve) => {
    require('child_process').execFile('bash', [APK_BUILD_SH],
      { env, cwd: APK_REPO, timeout: 90000, maxBuffer: 8 * 1024 * 1024 }, (err) => {
        apkInflight.delete(spec.slug);
        if (err) return resolve({ ok: false, error: String(err.stderr || err.message || 'build failed').slice(0, 400) });
        if (!fs.existsSync(absOut)) return resolve({ ok: false, error: 'APK was not produced' });
        resolve({ ok: true, cached: false });
      });
  });
  apkInflight.set(spec.slug, p);
  return p;
}

// GET /api/apk/<item-id> → jana atau ambil cache APK, lalu alihkan ke fail muat turun.
app.get('/api/apk/:id', apkBuildLimiter, async (req, res) => {
  try {
    const spec = apkSpec(req.params.id);
    if (!spec) return res.status(404).json({ error: 'Unknown store item' });
    const r = await buildApk(spec);
    if (!r.ok) return res.status(500).json({ error: 'Failed to build APK', details: r.error });
    return res.redirect(302, '/downloads/' + spec.file);
  } catch (error) {
    res.status(500).json({ error: 'On-demand APK build failed', details: safeError(error) });
  }
});

// ── Papan pendahulu komuniti (skor game terbitan). Data AWAM, tanpa pengesahan, had-kadar.
//    Games dalam sandbox hantar skor (GET /api/score) & baca (GET /api/scores) melalui
//    connect-src host-sendiri (lihat publishCspFor). opaque-origin = tiada cookie dihantar.
const LB_PATH = path.join(path.dirname(config.store.path), 'leaderboard.json');
const scoreLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 60 * 60 * 1000, max: 200, keyPrefix: 'score:' })
  : (req, res, next) => next();
function readLB() { try { return JSON.parse(fs.readFileSync(LB_PATH, 'utf8')) || {}; } catch { return {}; } }
function writeLB(o) { try { fs.writeFileSync(LB_PATH, JSON.stringify(o)); } catch { /* best-effort */ } }
function lbKey(g) { const s = String(g || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24); return s || 'br'; }
function lbName(n) { return truncate(String(n || '').replace(/[\r\n\t]/g, ' ').trim(), 20) || 'Anon'; }

app.get('/api/score', scoreLimiter, (req, res) => {
  try {
    const g = lbKey(req.query.g); const n = lbName(req.query.n);
    let s = Math.round(Number(req.query.s)); if (!isFinite(s) || s < 0) s = 0; if (s > 1e9) s = 1e9;
    const db = readLB(); const arr = Array.isArray(db[g]) ? db[g] : [];
    const entry = { n, s, t: Date.now() }; arr.push(entry);
    arr.sort((a, b) => b.s - a.s); db[g] = arr.slice(0, 100); writeLB(db);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save score', details: safeError(error) });
  }
});

app.get('/api/scores', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const g = lbKey(req.query.g);
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
  const db = readLB();
  const items = (Array.isArray(db[g]) ? db[g] : []).slice(0, limit).map((x) => ({ n: truncate(String(x.n), 20), s: Number(x.s) || 0 }));
  res.json({ ok: true, game: g, items });
});

// ── Papan komen komuniti (app terbitan /a/<slug>). Data AWAM, tanpa pengesahan,
//    had-kadar lebih ketat daripada skor (teks = risiko salah guna lebih tinggi).
//    Corak sama: connect-src host-sendiri (publishCspFor) benarkan app dalam sandbox
//    baca/tulis; opaque-origin = tiada cookie dihantar. UI disuntik pada /a/:slug.
const COMMENTS_PATH = path.join(path.dirname(config.store.path), 'comments.json');
const commentLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyPrefix: 'cmt:' })
  : (req, res, next) => next();
function readComments() { try { return JSON.parse(fs.readFileSync(COMMENTS_PATH, 'utf8')) || {}; } catch { return {}; } }
function writeComments(o) { try { fs.writeFileSync(COMMENTS_PATH, JSON.stringify(o)); } catch { /* best-effort */ } }
const cmtSlug = publish.cmtSlug, cmtName = publish.cmtName, cmtText = publish.cmtText;

app.get('/api/comments', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const slug = cmtSlug(req.query.slug);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
  const db = slug ? readComments() : {};
  const items = slug && Array.isArray(db[slug]) ? db[slug] : [];
  res.json({ ok: true, slug, items: items.slice(0, limit).map((x) => ({ n: truncate(String(x.n), 20), c: truncate(String(x.c), 300), t: Number(x.t) || 0 })) });
});

app.post('/api/comments', commentLimiter, (req, res) => {
  const body = req.body || {};
  const slug = cmtSlug(body.slug);
  if (!slug) return res.status(400).json({ error: 'Invalid slug' });
  if (!fs.existsSync(path.join(PUBLISH_DIR, `${slug}.html`))) return res.status(404).json({ error: 'App not found' });
  const text = cmtText(body.text);
  if (text.length < 2) return res.status(400).json({ error: 'Comment too short' });
  try {
    const db = readComments(); const arr = Array.isArray(db[slug]) ? db[slug] : [];
    arr.unshift({ n: cmtName(body.name), c: text, t: Date.now() });
    db[slug] = arr.slice(0, 100); writeComments(db);
    store.event('comment', `Komen baharu: /a/${slug}`, { slug, len: text.length });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save comment', details: safeError(error) });
  }
});

// ── T Chat: akaun + bilik/DM multi-pengguna untuk app /apps/chat. ─────────
// Data awam berdaftar (nama + hash scrypt, tiada e-mel), disimpan di data/chat.json.
// Had-kadar per-IP pada daftar/login/kiriman; poll mesej = bacaan ringan sahaja.
chat.mount(app, {
  rateLimit: config.rateLimit.enabled ? rateLimit : null,
  store,
  path: path.join(path.dirname(config.store.path), 'chat.json'),
});

// Gerbang SMS (paired-Android relay, dua hala + inbox). Admin di /sms.
sms.mount(app, {
  auth,
  rateLimit: config.rateLimit.enabled ? rateLimit : null,
  path: path.join(path.dirname(config.store.path), 'sms.json'),
});

// Jambatan Chat ⇄ Sel: DM yang diterima kawan semasa dia LUAR TALIAN (dan sudah
// menaut nombor) dihantar sebagai SMS melalui gerbang Android yang dipasangkan;
// balasan SMS masuk disalur kembali ke dalam DM asal. Hanya aktif bila relay
// dipasangkan — tanpa peranti, mesej kekal dalam T Chat seperti biasa.
chat.setSmsSender((payload) => (sms.isPaired() ? sms.enqueue(payload.to, payload.body) : { error: 'No SMS device paired.' }));
sms.onInbound((evt) => { try { chat.ingestSms(evt.from, evt.body); } catch { /* jambatan gagal — inbox SMS tidak terjejas */ } });

// Tukuk Agent: proksi OpenAI-compatible (tool-calling) untuk pelanjutan agen Cline
// dalam code-server + build API kepala-tanpa (/api/agent/build).
agent.mount(app, {
  auth,
  rateLimit: config.rateLimit.enabled ? rateLimit : null,
  config,
  store,
});

// /login dan /logout (tanpa prefix /agent) dipaut semula ke editor.
// Browser lama mungkin cache 302 ke '/login' daripada sebelum fix prefix.
// Express redirect supaya pautan itu berfungsi lagi.
app.get('/login',  (req, res) => res.redirect(302, '/agent/login' + (req._parsedUrl.search || '')));
app.get('/logout', (req, res) => res.redirect(302, '/agent/logout' + (req._parsedUrl.search || '')));

// Editor Tukuk Agent (code-server tempatan) dinaung di tukuk.org/agent —
// guna tunnel sedia ada; tanpa perubahan Cloudflare. WS dipasang di index.js.
agentEditor.mount(app, { config });


// ── Jana auto: SATU kata/huraian → app + game (/builder ✨ Jana). ──────────────
// AI bila brain tersedia (rotasi cloud → ollama); JATUH kepada heuristik deterministik
// supaya sentiasa ada hasil walau AI tak dikonfigurasi/tiada rangkaian. Output disanitasi.
const builderGenLimiter = config.rateLimit.enabled
  ? rateLimit({ windowMs: 60 * 60 * 1000, max: 40, keyPrefix: 'bgen:' })
  : (req, res, next) => next();

app.post('/api/builder/generate', builderGenLimiter, async (req, res) => {
  const idea = truncate(String((req.body && req.body.idea) || '').trim(), 160);
  if (!idea) return res.status(400).json({ error: 'Type an idea or a word first.' });
  const style = truncate(String((req.body && req.body.style) || '').replace(/\s+/g, ' ').trim(), 40);
  const seed = Math.max(0, Math.floor(Number(req.body && req.body.seed) || 0));
  const color = builderGen.isHexColor(req.body && req.body.color) ? String(req.body.color).trim() : '';
  const lang = truncate(String((req.body && req.body.lang) || '').replace(/\s+/g, ' ').trim(), 24);
  const opts = { color, lang };
  const brief = `App idea: ${idea}${style ? ', style ' + style : ''}${color ? ', main colour ' + color : ''}`;
  const sysPrompt = builderGen.SYSTEM_PROMPT + (lang ? ` Content language: ${lang}.` : '');
  const want = Math.min(3, Math.max(1, Number(req.body && req.body.count) || 3));
  const apps = [];
  const seen = new Set();
  // Tandatangan untuk elak kad pendua (nama + aksen + set game).
  const sigOf = (a) => a.appName + '|' + (a.theme && a.theme.accent) + '|' + a.widgets.filter((w) => builderGen.GAMES.includes(w.type)).map((w) => w.type).join(',');
  const pushApp = (a, src) => { if (!a || !Array.isArray(a.widgets) || !a.widgets.length) return; const k = sigOf(a); if (seen.has(k)) return; seen.add(k); a._src = src || 'auto'; apps.push(a); };
  let aiHit = false;
  if (config.brain.enabled) {
    try {
      let text = '';
      try {
        const r = await brain.generateCloudRotation(brief, { system: sysPrompt, temperature: 0.85, maxTokens: 900 });
        text = (r && r.response) || '';
      } catch { /* cuba ollama */ }
      if (!text) {
        try {
          const r = await brain.generate(brief, { system: sysPrompt, numPredict: 900, temperature: 0.85 });
          text = (r && r.response) || '';
        } catch { /* jatuh ke heuristik */ }
      }
      const parsed = builderGen.parseGenJson(text);
      if (parsed) { const s = builderGen.sanitizeApp(parsed); if (s.widgets.length) { pushApp(s, 'ai'); aiHit = true; } }
    } catch { /* noop — heuristik di bawah */ }
  }
  // Lengkapkan hingga `want` dengan varian heuristik (palet + game berbeza).
  if (apps.length < want) for (const v of builderGen.heuristicVariants(idea, want, style, seed, opts)) pushApp(v, 'auto');
  const finalApps = apps.slice(0, want);
  if (!finalApps.length) { const fb = builderGen.heuristicBuild(idea, style, opts); fb._src = 'auto'; finalApps.push(fb); } // sentiasa ada >=1
  const source = aiHit ? 'ai' : 'auto';
  store.event('builder', `Jana auto (${source}): ${truncate(idea, 60)}`, { source, count: finalApps.length });
  res.json({ ok: true, source, apps: finalApps, app: finalApps[0] });
});

// Senarai kata satu-kata untuk 🎲 Rambang + cadangan idea (/builder). Dimuat sekali, ringan.
const WORDS_PATH = path.join(__dirname, '..', 'scripts', 'satu-kata', 'words.txt');
function loadBuilderWords() {
  try {
    return fs.readFileSync(WORDS_PATH, 'utf8').split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => { const p = l.split('|').map((x) => (x || '').trim()); return { word: p[0], emoji: p[1] || '✨', tagline: p[2] || '' }; })
      .filter((w) => w.word);
  } catch { return []; }
}
const BUILDER_WORDS = loadBuilderWords();

app.get('/api/builder/dice', (req, res) => {
  if (!BUILDER_WORDS.length) return res.json({ ok: true, word: null });
  const w = BUILDER_WORDS[Math.floor(Math.random() * BUILDER_WORDS.length)];
  res.json({ ok: true, word: w.word, emoji: w.emoji, tagline: w.tagline });
});

app.get('/api/builder/suggest', (req, res) => {
  const idea = truncate(String(req.query.idea || '').trim(), 60);
  const items = builderGen.matchWords(BUILDER_WORDS, idea, 6).map((w) => ({ word: w.word, emoji: w.emoji, tagline: truncate(w.tagline, 80) }));
  res.json({ ok: true, items });
});

// Indeks /a — senarai aplikasi yang diterbitkan komuniti (pautan sahaja, nama disanitasi).
app.get('/a', (req, res) => {
  const items = listPublished();
  const rows = items.length
    ? items.map((x) => `<li><a href="/a/${encodeURIComponent(x.slug)}">${escapeHtml(x.title)}</a> <span style="color:#6b7280">/ ${escapeHtml(x.slug)}</span></li>`).join('\n')
    : '<li>No apps yet. Build one in the <a href="/builder">Builder</a> and press 🚀 Publish.</li>';
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Published Apps — Tukuk Studio</title><meta name="robots" content="noindex"><style>body{font:16px/1.6 system-ui;margin:0;padding:40px 20px;background:#0f1115;color:#e6e9ef}a{color:#4c8dff}main{max-width:720px;margin:0 auto}h1{font-size:1.6rem}ul{list-style:none;padding:0}li{padding:6px 0;border-bottom:1px solid #262b36}</style></head><body><main><h1>🧩 Published Apps</h1><p style="color:#9aa3b2">Built with Tukuk Studio — the no-code Builder. Pages run sandboxed (separate origin).</p><ul>\n${rows}\n</ul><p style="margin-top:24px"><a href="/builder">→ Open Builder</a></p></main></body></html>`);
});

// Hidangkan satu app terbitan dalam sandbox opaque-origin.
app.get('/a/:slug', (req, res) => {
  const slug = String(req.params.slug || '');
  if (!publish.isSlug(slug)) return res.status(400).type('html').send('Invalid slug');
  const file = path.join(PUBLISH_DIR, `${slug}.html`);
  let html;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch { return res.status(404).type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Not found — Tukuk Studio</title><style>body{font:16px system-ui;padding:40px;background:#0f1115;color:#e6e9ef}a{color:#4c8dff}</style></head><body><h1>404</h1><p>App <code>/${escapeHtml(slug)}</code> does not exist or has been removed.</p><p><a href="/a">← All apps</a> · <a href="/builder">Build your own</a></p></body></html>`); }
  bumpViews(slug); // kiraan "dilihat" untuk katalog /store
  // ?embed=1 → dibenarkan menempek dalam pemain /play kita (frame-ancestors 'self');
  // laman luar tetap disekat 'none' seperti sebelumnya (anti-clickjacking silang-origin).
  const embed = req.query.embed === '1';
  res.setHeader('Content-Security-Policy', publish.publishCspFor(req.get('host'), (req.headers['x-forwarded-proto'] === 'https' || req.secure) ? 'https' : 'http', embed));
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(publish.injectComments(html, slug));
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
    return res.status(401).json({ error: 'Invalid bootstrap password.' });
  }
  auth.startRegistration(req.body.email)
    .then((options) => res.json(options))
    .catch((error) => res.status(500).json({ error: 'Failed to start registration', details: safeError(error) }));
});

// Langkah 2 daftar: sahkan attestasi, simpan passkey, keluarkan sesi.
app.post('/api/admin/auth/register/finish', adminLoginLimiter, auth.requireAllowedEmail, async (req, res) => {
  try {
    const credential = req.body && req.body.credential;
    if (!credential) return res.status(400).json({ error: 'Credential required' });
    const result = await auth.finishRegistration(req.body.email, credential, requestOrigin(req));
    const token = auth.issueSession(req.body.email);
    res.json({ ok: true, registered: result, token });
  } catch (error) {
    console.error('[webauthn register/finish]', error && error.message, 'origin=', requestOrigin(req));
    res.status(error.statusCode || 500).json({ error: 'Passkey registration failed', details: safeError(error) });
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
    res.status(500).json({ error: 'Failed to start login', details: safeError(error) });
  }
});

// Langkah 2 login: sahkan assertasi passkey, keluarkan token sesi.
app.post('/api/admin/auth/login/finish', adminLoginLimiter, auth.requireAllowedEmail, async (req, res) => {
  try {
    const credential = req.body && req.body.credential;
    if (!credential) return res.status(400).json({ error: 'Credential required' });
    const token = await auth.finishAuthentication(req.body.email, credential, requestOrigin(req));
    res.json({ ok: true, token });
  } catch (error) {
    console.error('[webauthn login/finish]', error && error.message, 'origin=', requestOrigin(req));
    res.status(error.statusCode || 500).json({ ok: false, error: 'Passkey login failed', details: safeError(error) });
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
  if (!id) return res.status(400).json({ error: 'id required' });
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

// Produk disyorkan (afiliasi) — default supaya /rekomendasi tak kosong. Admin ganti
// dengan link affiliate sebenar (Shopee/Amazon/Hostinger/NordVPN dll). JSON array.
const DEFAULT_AFFILIATE = JSON.stringify([
  { name: 'Hostinger', blurb: 'Affordable, fast web hosting for your side projects.', price: 'from RM10/mo', url: 'https://www.hostinger.com', cta: 'View Plans' },
  { name: 'Namecheap', blurb: 'Get a .com domain for your personal brand.', price: 'from $5.98', url: 'https://www.namecheap.com', cta: 'Check Domain' },
  { name: 'NordVPN', blurb: 'Protect your privacy while browsing.', price: '2-year discount', url: 'https://nordvpn.com', cta: 'Get the Deal' },
  { name: 'Vultr Cloud VPS', blurb: 'VPS for hosting your apps, bots & websites.', price: 'from $6/mo', url: 'https://www.vultr.com', cta: 'Sign Up' },
  { name: 'Mechanical Keyboard', blurb: 'More comfortable gear for writing and coding.', price: 'RM60+', url: 'https://shopee.com.my/search?keyword=mechanical%20keyboard', cta: 'Buy on Shopee' }
]);

app.get('/api/public/settings', (req, res) => {
  res.json({
    adsEnabled: Boolean(adsenseOn()),
    adsClient: store.getSetting('adsClient', 'ca-pub-8954948214333501'),
    adsSlotTop: store.getSetting('adsSlotTop', ''),
    adsSlotBottom: store.getSetting('adsSlotBottom', ''),
    msAdsEnabled: Boolean(store.getSetting('msAdsEnabled', false)),
    msAdsTagId: store.getSetting('msAdsTagId', ''),
    msAdsUsmSrc: store.getSetting('msAdsUsmSrc', ''),
    thirdPartyAdEnabled: Boolean(store.getSetting('thirdPartyAdEnabled', false)),
    thirdPartyAdSrc: store.getSetting('thirdPartyAdSrc', ''),
    affiliateProducts: store.getSetting('affiliateProducts', DEFAULT_AFFILIATE),
    clarityEnabled: clarityEnabledValue(),
    clarityId: clarityIdValue(),
    bgMode: store.getSetting('bgMode', 'default'),
    customBgUrl: store.getSetting('customBgUrl', ''),
    siteTitle: store.getSetting('siteTitle', 'Tukuk-OS'),
    siteTagline: store.getSetting('siteTagline', 'Search, AI, apps & games — free, no account, works even on 2G')
  });
});

app.get('/api/admin/settings', auth.requireAdmin, (req, res) => {
  const rawKey = String(store.getSetting('aiApiKey', '') || '');
  res.json({
    // Google Ads
    adsEnabled: Boolean(adsenseOn()),
    adsClient: store.getSetting('adsClient', 'ca-pub-8954948214333501'),
    adsSlotTop: store.getSetting('adsSlotTop', ''),
    adsSlotInArticle: store.getSetting('adsSlotInArticle', ''),
    adsSlotBottom: store.getSetting('adsSlotBottom', ''),
    // Microsoft Ads
    msAdsEnabled: Boolean(store.getSetting('msAdsEnabled', false)),
    msAdsTagId: store.getSetting('msAdsTagId', ''),
    msAdsSlotTop: store.getSetting('msAdsSlotTop', ''),
    msAdsSlotBottom: store.getSetting('msAdsSlotBottom', ''),
    msAdsUsmSrc: store.getSetting('msAdsUsmSrc', ''),
    // Produk afiliasi (JSON array) untuk halaman /rekomendasi
    affiliateProducts: store.getSetting('affiliateProducts', DEFAULT_AFFILIATE),
    thirdPartyAdEnabled: Boolean(store.getSetting('thirdPartyAdEnabled', false)),
    thirdPartyAdSrc: store.getSetting('thirdPartyAdSrc', ''),
    // Snippet penuh (HTML/JS) ditampal dari pembekal. Renderer inject apa adanya.
    msAdsSnippetTop: store.getSetting('msAdsSnippetTop', ''),
    msAdsSnippetInArticle: store.getSetting('msAdsSnippetInArticle', ''),
    msAdsSnippetBottom: store.getSetting('msAdsSnippetBottom', ''),
    // Microsoft Clarity (analytics)
    clarityEnabled: clarityEnabledValue(),
    clarityId: clarityIdValue(),
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
    siteTagline: store.getSetting('siteTagline', 'Search, AI, apps & games — free, no account, works even on 2G'),
    defaultTheme: store.getSetting('defaultTheme', 'dark'),
    defaultAccent: store.getSetting('defaultAccent', 'blue')
  });
});

app.post('/api/admin/settings', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  // Validas awal: produk afiliasi mesti JSON array yang sah (atau kosong).
  if (typeof b.affiliateProducts !== 'undefined') {
    const raw = String(b.affiliateProducts).trim();
    if (raw) {
      try { const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) throw new Error('not array'); }
      catch { return res.status(400).json({ error: 'Affiliate products must be a valid JSON array (e.g. [{"name":"...","url":"https://..."}])' }); }
    }
  }
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
  if (typeof b.msAdsUsmSrc !== 'undefined') store.setSetting('msAdsUsmSrc', String(b.msAdsUsmSrc).trim());
  if (typeof b.affiliateProducts !== 'undefined') store.setSetting('affiliateProducts', String(b.affiliateProducts).trim());
  if (typeof b.thirdPartyAdEnabled !== 'undefined') store.setSetting('thirdPartyAdEnabled', Boolean(b.thirdPartyAdEnabled));
  if (typeof b.thirdPartyAdSrc !== 'undefined') store.setSetting('thirdPartyAdSrc', String(b.thirdPartyAdSrc).trim());
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
<title>404 — Page not found — Tukuk-OS</title>
<meta name="description" content="The page you were looking for on Tukuk-OS was not found. Try a search, visit the game store, or head back home.">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="https://tukuk.org/">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${COMMON_CSS}
  .oops { text-align:center; padding:40px 0 8px; }
  .oops .code { font-size:5rem; font-weight:800; color:var(--accent); line-height:1; letter-spacing:-2px; }
  .hint { color:var(--muted); margin:6px 0 26px; }
  .actions { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin:24px 0; }
  .actions a { background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:10px 18px; text-decoration:none; color:var(--text); font-size:.92rem; }
  .actions a:hover { border-color:var(--accent); color:var(--accent); }
  .oops form { margin:0 auto 6px; max-width:420px; display:flex; gap:8px; }
  .oops form input { flex:1; padding:10px 14px; border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--text); }
  .oops form button { padding:10px 18px; border:0; border-radius:10px; background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }
</style>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/theme.css">
</head>
<body>
<div class="wrap">
  <div class="oops">
    <div class="code">404</div>
    <h1>This page doesn't exist</h1>
    <p class="hint"><code>${escapeHtml(req.path)}</code> was not found — the address may be wrong or the page was moved.</p>
    <form action="/cari" method="get" role="search">
      <input type="search" name="q" placeholder="Search anything on the web…" aria-label="Search query" required>
      <button type="submit">Search</button>
    </form>
    <div class="actions">
      <a href="/">🏠 Home</a>
      <a href="/play">🎮 Play Games</a>
      <a href="/negara">🗺️ World Countries</a>
      <a href="/apps/chat">💬 T Chat</a>
      <a href="/blog">📝 Blog</a>
      <a href="/contact">✉️ Contact</a>
    </div>
  </div>
  <footer><p>&copy; 2026 Tukuk-OS &mdash; Your free, account-free internet portal: search, AI, apps &amp; games. <a href="/">Home</a> <a href="/about">About</a> <a href="/privacy">Privacy</a></p></footer>
</div>
</body>
</html>`);
});

app.use((error, req, res, next) => {
  errorCount += 1;
  if (res.headersSent) return next(error);
  res.status(error.statusCode || 500).json({ error: 'Server error', details: safeError(error) });
});

module.exports = { app, TCHAT_HOST, TCHAT_ALLOWED, CSP_TCHAT };