/**
 * NASA open-data client for /nasa + the Astronomy hub.
 *
 * Covers APOD (Astronomy Picture of the Day), live ISS position + crew, Mars rover
 * photos, EPIC Earth imagery, Near-Earth Object feed (Feeling), and the DSO/Sentry
 * risk table. Every endpoint is cached for 1 h to stay inside the DEMO_KEY rate limit,
 * and APOD responses are mirrored to disk (`data/apod-last.json`) so we can serve
 * labelled archived records when NASA is down or half-failing (see memory rules on
 * stale-archive fallbacks and the api.nasa.gov LB backend issue).
 *
 * The `NasaAwareAgent` in this file rotates through every resolved IPv6+IPv4 address
 * on each connection and black-lists sockets that error at the transport layer — a
 * workaround for NASA's LB that sometimes routes a whole backend to a broken pool.
 */
const axios = require('axios');
const { attachGuard } = require('./outbound');
const fs = require('fs');
const https = require('https');
const dns = require('dns');
const path = require('path');
const config = require('./config');
const store = require('./nasa-store');
const apodbank = require('./apodbank');

// ——— IP rotation for api.nasa.gov ———
// One of NASA's LB backends is often broken (500/timeout); observations show record A
// (IPv4) is far more broken than record AAAA (IPv6). Node's default sticks to one IP,
// so this agent rotates through ALL IPv6+IPv4 addresses per connection and blacklists the IP
// that errors at socket level for a while; keep-alive makes healthy sockets get reused.
const NASA_HOST = (() => { try { return new URL(config.nasa.baseUrl).hostname; } catch { return 'api.nasa.gov'; } })();
let nasaIps = [];
let nasaIpAt = 0;
const nasaIpBadUntil = new Map();

function refreshNasaIps() {
  let v4 = [];
  let v6 = [];
  let pending = 2;
  const done = () => {
    if (--pending > 0) return;
    const merged = [...v6, ...v4]; // IPv6 first (the IPv4 backend is more broken)
    if (merged.length) nasaIps = merged;
  };
  dns.resolve4(NASA_HOST, (err, addrs) => { if (!err && Array.isArray(addrs)) v4 = addrs; done(); });
  dns.resolve6(NASA_HOST, (err, addrs) => { if (!err && Array.isArray(addrs)) v6 = addrs; done(); });
}
refreshNasaIps();
setInterval(refreshNasaIps, 5 * 60 * 1000).unref();

function pickNasaIp() {
  const now = Date.now();
  for (const [ip, until] of nasaIpBadUntil) if (until <= now) nasaIpBadUntil.delete(ip);
  const pool = nasaIps.filter(ip => !nasaIpBadUntil.has(ip));
  const usable = pool.length ? pool : nasaIps;
  if (!usable.length) return null;
  return usable[(nasaIpAt++) % usable.length];
}

class NasaAwareAgent extends https.Agent {
  createConnection(options, cb) {
    const hostname = options.servername || options.host;
    if (hostname !== NASA_HOST) return super.createConnection(options, cb);
    const ip = pickNasaIp();
    if (!ip) return super.createConnection(options, cb);
    const isV6 = ip.includes(':');
    const socket = super.createConnection(
      { ...options, host: ip, hostname: ip, family: isV6 ? 6 : 4, servername: hostname, path: undefined },
      cb
    );
    if (socket && typeof socket.once === 'function') {
      socket.once('error', () => nasaIpBadUntil.set(ip, Date.now() + 10 * 60 * 1000));
    }
    return socket;
  }
}

const http = axios.create({
  timeout: 20000,
  httpsAgent: new NasaAwareAgent({ keepAlive: true, maxSockets: 12 }),
  headers: {
    'User-Agent': 'TukukOS-NASA-Client/1.0 (+https://tukuk.org)'
  }
});

// api.nasa.gov only: NO keep-alive so every attempt gets a brand-new
// connection (and LB backend). NASA now half-answers with HTTP 200 "broken payload"
// (title "NASA Science" + logo) and 500; a reused socket would stay stuck on the same broken
// backend — retries would be pointless. IP rotation + a new connection = the best chance.
const apiHttp = axios.create({
  timeout: 20000,
  httpsAgent: new NasaAwareAgent({ keepAlive: false, maxSockets: 12 }),
  headers: {
    'User-Agent': 'TukukOS-NASA-Client/1.0 (+https://tukuk.org)'
  }
});

// NASA owns its own outage policy — the `apodApiDownUntil` breaker below, the deliberate
// three-attempt retry (a reused socket stays stuck on the same broken backend, so each attempt
// must be a real new call) and the 2-minute degraded caches. So the guard is attached here
// WITHOUT a cooldown (`cooldownMs: 0`) and without a shorter budget than any declared timeout:
// what NASA has no protection against is a crawler burst for the same date opening twenty
// identical requests, and that is exactly what the dedupe removes (src/outbound.js).
attachGuard(http, { name: 'nasa-assets', budgetMs: 25000, cooldownMs: 0 });
attachGuard(apiHttp, { name: 'nasa-api', budgetMs: 25000, cooldownMs: 0 });

// Small in-memory cache to stay under the rate limit
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// NOAA Space Weather Prediction Center — free space-weather data, no key
const NOAA_SWPC = 'https://services.swpc.noaa.gov/json';

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (cache.size > 200) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const APOD_FALLBACK_FILE = process.env.APOD_FALLBACK_PATH || path.join(path.dirname(config.store.path), 'apod-last.json');

// Circuit breaker: when the NASA APOD API fails, don't waste time retrying over and over
let apodApiDownUntil = 0;

function readApodFallback() {
  try {
    return JSON.parse(fs.readFileSync(APOD_FALLBACK_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeApodFallback(data) {
  try {
    fs.mkdirSync(path.dirname(APOD_FALLBACK_FILE), { recursive: true });
    fs.writeFileSync(APOD_FALLBACK_FILE, JSON.stringify(data));
  } catch {
    // a failing fallback write is not a critical problem
  }
}

// ── Cold start: the picture we already have on disk ─────────────────────────
// After every restart the first /nasa render waited on api.nasa.gov before anything was
// drawn — 10 s, measured after the 24 Oct 2026 restart — for a picture that was already
// sitting on disk from the last successful fetch. The snapshot is now served at once and
// the live request runs behind the response, so the next visitor gets today's.
//
// The guards are the point: only the plain "current picture" read takes this path (a dated
// or counted request asked for something specific and must be live), only once per process,
// and only while the snapshot is under a week old — every payload is dated and the page
// prints that date, so a four-day-old picture shown as 2026-10-22 is honest. A blank week
// or more is not a slow API, it is a broken one, and then the live path with its three
// attempts is the only thing worth waiting for.
const APOD_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let apodColdStartHandled = false;
let apodRefreshing = false;

/** The disk snapshot, if it is a valid APOD and still recent enough to stand in. */
function apodFromDiskIfFresh() {
  const stored = readApodFallback();
  if (!stored || !isValidApodPayload(stored, null)) return null;
  const at = Date.parse(String(stored.date || ''));
  if (!Number.isFinite(at) || Date.now() - at > APOD_SNAPSHOT_MAX_AGE_MS) return null;
  return stored;
}

/** Fetch the live picture behind an already-sent response. One at a time, failures ignored. */
function refreshApodBehind() {
  if (apodRefreshing) return;
  apodRefreshing = true;
  getAPOD()
    .catch(() => {})
    .finally(() => { apodRefreshing = false; });
}

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8217;/g, '’')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '');
}

function stripTags(htmlStr) {
  return decodeEntities(String(htmlStr).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

const MONTH_NUM = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };

/**
 * The official fallback source: the NASA Science APOD page (science.nasa.gov) keeps
 * a full archive by date — called when api.nasa.gov fails.
 * The page must be valid: the title has to start with "APOD: <the requested date>".
 */
async function getApodFromScienceSite(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const legacy = `ap${String(y).slice(2)}${m}${d}.html`;
  const { data: html } = await http.get('https://science.nasa.gov/apod/', {
    params: { date: legacy },
    timeout: 25000,
    responseType: 'text'
  });

  const page = String(html);
  // NASA serves multiple <title> dialects: "2026 October 27", "29 October 2026" (day first) and
  // en-dash separators. Anchor on "- NASA Science", parse the date part in either order.
  // (tools/apod_build.py in tukuk-devops mirrors this exact tolerance — keep them in step.)
  const tm = page.match(/<title>APOD:\s*(.+?)\s*[-\u2013\u2014]\s*(.*?)\s*-\s*NASA Science<\/title>/i);
  if (!tm) return null;
  const dm = String(tm[1]).trim().match(/^(?:(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})|(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}))$/);
  if (!dm) return null;
  const [py, pmo, pd] = dm[1] ? [dm[1], dm[2], dm[3]] : [dm[6], dm[5], dm[4]];
  const monthNum = MONTH_NUM[pmo] || '';
  const pageDate = `${py}-${monthNum}-${String(pd).padStart(2, '0')}`;
  if (monthNum && pageDate !== dateStr) return null; // a different date = the page is gone

  const title = stripTags(tm[2]);
  if (!title) return null;

  // New article pages write "<strong>Explanation: </strong>" (a space INSIDE the tag) while the
  // legacy /apod/ pages had none; the old exact indexOf silently lost the explanation on every
  // new page — a regex covers both shapes. (tools/apod_build.py in tukuk-devops mirrors this.)
  const explM = page.match(/<strong>Explanation:\s*<\/strong>/i);
  let explanation = '';
  if (explM) {
    const explIdx = explM.index + explM[0].length;
    const end = page.indexOf('</p>', explIdx);
    const seg = page.slice(explIdx, end > explIdx ? end : explIdx + 6000);
    explanation = stripTags(seg);
  }

  const imgMatches = page.match(/https:\/\/assets\.science\.nasa\.gov\/content\/dam\/science\/cds\/apod\/[^"'\s>]+/g) || [];
  const imgs = [...new Set(imgMatches.map(u => decodeEntities(u)))];
  const photoUrl = imgs.find(u => /\.(jpg|jpeg|png)(\?|$)/i.test(u)) || imgs[0] || '';

  const iframe = page.match(/<iframe[^>]+src="(https:\/\/www\.youtube-nocookie\.com\/embed\/[^"]+|https:\/\/www\.youtube\.com\/embed\/[^"]+)"/i);

  let mediaUrl = photoUrl;
  let mediaType = 'image';
  if (!photoUrl && iframe) {
    mediaUrl = decodeEntities(iframe[1]);
    mediaType = 'video';
  }
  if (!mediaUrl) return null;

  const credits = page.match(/<div class="hds-credits">([\s\S]*?)<\/div>/i);

  return {
    date: dateStr,
    title,
    explanation,
    media_type: mediaType,
    url: mediaUrl,
    hdurl: mediaType === 'image' ? mediaUrl : '',
    copyright: credits ? stripTags(credits[1]) : '',
    source: 'science.nasa.gov'
  };
}

// Validate the APOD payload: the NASA API once served broken titles/logos during its migration
function isValidApodPayload(data, acceptedDates) {
  if (!data || typeof data !== 'object') return false;
  // List payloads (parameter count>1): NASA sends an array — valid if at least
  // one entry inside it is valid. Without this branch the array fails the check and count breaks.
  if (Array.isArray(data)) return data.some((e) => isValidApodPayload(e, null));
  const title = String(data.title || '').trim();
  const explanation = String(data.explanation || '').trim();
  const media = String(data.url || data.hdurl || '').trim();
  if (!title || /^(nasa science|astronomy picture of the day)$/i.test(title)) return false;
  if (!explanation || explanation.length < 80) return false;
  if (!media || /nasa-logo|logo\.(png|svg|gif|jpg)/i.test(media)) return false;
  if (acceptedDates && acceptedDates.length && data.date && !acceptedDates.includes(data.date)) return false;
  return true;
}

/**
 * 1. APOD - Astronomy Picture of the Day
 *    The NASA API sometimes answers 503 (upstream) — try a few times, then
 *    drop to the official science.nasa.gov archive, then the local disk.
 */
async function getAPOD({ date, count, force } = {}) {
  const cacheKey = `apod:${date || 'today'}:${count || 1}`;
  if (force) apodApiDownUntil = 0; // "Try live again" / auto-update: clear the circuit breaker first
  const cached = force ? null : getCache(cacheKey);
  if (cached && isValidApodPayload(cached, null)) return cached;

  // Bank first (pipeline 4: science.nasa.gov pages archived daily by apodbank-build.yml in the
  // public tukuk/tukuk-devops repo, loaded into the `apod` Meilisearch index by wordbank-sync).
  // The banked rows are the official pages' own content, so the broken-payload API is not even
  // asked when they exist. Any miss — index absent, date not banked, Meili down — falls through
  // to the untouched live chain below (API → page → disk → archive DB), which stays the fallback.
  if (!count) {
    const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
    const wantedDates = date ? [date] : [isoDay(Date.now()), isoDay(Date.now() - 24 * 60 * 60 * 1000)];
    for (const wd of wantedDates) {
      const row = await apodbank.byDate(wd);
      if (row && isValidApodPayload(row, [wd])) {
        const payload = { ...row, banked: true };
        setCache(cacheKey, payload, 4 * 60 * 60 * 1000);
        if (!date) writeApodFallback(payload);
        return payload;
      }
    }
  }

  if (!date && !count && !force && !apodColdStartHandled) {
    apodColdStartHandled = true;
    const snapshot = apodFromDiskIfFresh();
    if (snapshot) {
      refreshApodBehind();
      return { ...snapshot, refreshing: true };
    }
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const acceptedApiDates = date ? [date] : [targetDate, yesterday];
  const params = { api_key: config.nasa.apiKey };
  if (date) params.date = date;
  if (count) params.count = Math.min(Number(count) || 1, 10);

  const url = `${config.nasa.baseUrl}/planetary/apod`;
  let lastError = null;
  const apiUsable = Date.now() >= apodApiDownUntil;

  if (apiUsable) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await apiHttp.get(url, { params, timeout: 18000 });
        if (res.data && isValidApodPayload(res.data, acceptedApiDates)) {
          apodApiDownUntil = 0;
          store.saveApod(res.data); // keep a trace in the archive database
          setCache(cacheKey, res.data, 4 * 60 * 60 * 1000);
          if (!date && !count) writeApodFallback(res.data);
          return res.data;
        }
        lastError = new Error('invalid APOD payload from the NASA API');
        if (process.env.NASA_DEBUG === '1') console.error('[apod] attempt' , attempt, 'not valid:', JSON.stringify(res.data).slice(0, 120));
      } catch (err) {
        lastError = err;
        if (process.env.NASA_DEBUG === '1') console.error('[apod] attempt', attempt, err.response?.status || err.code || err.message);
      }
      await sleep(500 * (attempt + 1));
    }

    // If today's date does not exist yet (a NASA API quirk), try yesterday
    if (!date && !count) {
      try {
        const fallbackRes = await apiHttp.get(url, { params: { api_key: config.nasa.apiKey, date: yesterday }, timeout: 18000 });
        if (fallbackRes.data && isValidApodPayload(fallbackRes.data, [yesterday])) {
          apodApiDownUntil = 0;
          store.saveApod(fallbackRes.data);
          setCache(cacheKey, fallbackRes.data, 4 * 60 * 60 * 1000);
          writeApodFallback(fallbackRes.data);
          return fallbackRes.data;
        }
      } catch (e2) {
        lastError = lastError || e2;
      }
    }

    // Every attempt failed → trip the circuit breaker for 10 minutes
    apodApiDownUntil = Date.now() + 10 * 60 * 1000;
  }

  if (count) {
    throw lastError || new Error('NASA APOD API temporarily unavailable');
  }

  // Fallback A: the official science.nasa.gov archive (requested date, then yesterday)
  for (const tryDate of date ? [date] : [targetDate, yesterday]) {
    try {
      const apod = await getApodFromScienceSite(tryDate);
      if (apod && isValidApodPayload(apod, [tryDate])) {
        const payload = { ...apod, api_down: true };
        store.saveApod(apod); // the official archive is stored in the DB too
        setCache(cacheKey, payload, 30 * 60 * 1000);
        if (!date) writeApodFallback(payload);
        return payload;
      }
    } catch (err) {
      lastError = lastError || err;
    }
  }

  // Fallback B: the last APOD successfully written to disk (if still valid)
  const stored = readApodFallback();
  if (stored && isValidApodPayload(stored, null)) {
    return { ...stored, stale: true, staleNote: 'NASA APOD services are offline — showing the last successful picture.' };
  }

  // Fallback C: the local archive database — the last APOD entry ever stored
  const archived = store.latestApod(targetDate);
  if (archived) {
    return { ...archived, stale: true, fromArchive: true, staleNote: 'NASA APOD services are offline — showing the latest archived picture.' };
  }

  throw lastError || new Error('NASA APOD temporarily unavailable');
}

let apodRefreshTimer = null;

// One outside pull of "today's" APOD (bypassing cache & circuit breaker) for the auto-update
async function refreshApodNow() {
  try {
    return await getAPOD({ force: true });
  } catch {
    return null;
  }
}

function apodRefreshIntervalMs() {
  return Math.max(Number(config.nasa.apodRefreshMinutes) || 30, 5) * 60 * 1000;
}

// Self-scheduling: API alive → the normal interval; API broken/timeout → retry sooner (5 min)
// so the display returns to the live source by itself as soon as NASA recovers.
function scheduleApodRefresh(delayMs) {
  apodRefreshTimer = setTimeout(async () => {
    const data = await refreshApodNow();
    const healthy = data && !data.api_down && !data.stale;
    scheduleApodRefresh(healthy ? apodRefreshIntervalMs() : 5 * 60 * 1000);
  }, delayMs);
  apodRefreshTimer.unref();
}

/**
 * APOD auto-update: a periodic background pull (NASA_APOD_REFRESH_MIN minutes, default 30;
 * 5 min while the API is still broken) — API alive → cache + disk get refreshed,
 * API down → the science.nasa.gov archive. Users are always served the freshest data without
 * having to wait for the first request, and the circuit breaker is re-tested every round.
 */
function startApodAutoUpdate() {
  if (apodRefreshTimer) return;
  scheduleApodRefresh(5000);
}

function stopApodAutoUpdate() {
  if (apodRefreshTimer) {
    clearTimeout(apodRefreshTimer);
    apodRefreshTimer = null;
  }
}

/**
 * 2. Mars Rover Photos (Curiosity, Perseverance, Opportunity, Spirit)
 * Equipped with a smart fallback to the NASA Media Library when the old mars-photos server is unavailable.
 */
async function getMarsPhotos({ rover = 'curiosity', sol = 1000, earth_date, camera, page = 1 } = {}) {
  const cleanRover = String(rover).toLowerCase().trim() || 'curiosity';
  const cacheKey = `mars:${cleanRover}:${sol}:${earth_date || ''}:${camera || ''}:${page}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const params = { api_key: config.nasa.apiKey, page };
    if (earth_date) {
      params.earth_date = earth_date;
    } else {
      params.sol = sol;
    }
    if (camera) params.camera = camera;

    const res = await apiHttp.get(`${config.nasa.baseUrl}/mars-photos/api/v1/rovers/${cleanRover}/photos`, { params });
    if (res.data?.photos?.length) {
      const data = {
        source: 'mars-photos-api',
        rover: cleanRover,
        sol: params.sol,
        earth_date: params.earth_date,
        totalPhotos: res.data.photos.length,
        photos: res.data.photos.slice(0, 24).map(p => ({
          id: p.id,
          sol: p.sol,
          camera: { name: p.camera.name, full_name: p.camera.full_name },
          img_src: p.img_src,
          earth_date: p.earth_date,
          rover: { name: p.rover.name, status: p.rover.status, launch_date: p.rover.launch_date, landing_date: p.rover.landing_date }
        }))
      };
      setCache(cacheKey, data, 2 * 60 * 60 * 1000);
      return data;
    }
  } catch (err) {
    // Fall through to the NASA Image Library fallback
  }

  // Fallback: NASA Image and Video Library
  const searchTerms = `mars ${cleanRover} rover surface`;
  const media = await searchNASAMedia(searchTerms, { mediaType: 'image' });
  const fallbackData = {
    source: 'nasa-images-library',
    rover: cleanRover,
    sol: sol,
    totalPhotos: media.items.length,
    photos: media.items.map((m, idx) => ({
      id: m.nasa_id || idx,
      sol: sol,
      camera: { name: 'MAST/NAVCAM', full_name: 'Rover Surface Camera' },
      img_src: m.thumb,
      title: m.title,
      description: m.description,
      earth_date: m.date_created?.slice(0, 10) || '2026',
      rover: { name: cleanRover.toUpperCase(), status: 'active' }
    }))
  };
  setCache(cacheKey, fallbackData, 2 * 60 * 60 * 1000);
  return fallbackData;
}

/**
 * 3. NeoWs - Asteroids & Near-Earth Objects
 */
async function getNearEarthObjects({ startDate, endDate } = {}) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = startDate || yesterdayStr;
  const end = endDate || todayStr;
  const cacheKey = `asteroids:${start}:${end}`;
  const cached = getCache(cacheKey);
  // 'unavailable' verdicts are not cached so the next attempt stays valid
  if (cached && cached.source !== 'unavailable') return cached;

  try {
    const params = {
      api_key: config.nasa.apiKey,
      start_date: start,
      end_date: end
    };

    const res = await apiHttp.get(`${config.nasa.baseUrl}/neo/rest/v1/feed`, { params, timeout: 8000 });
    if (!res.data || !res.data.near_earth_objects) throw new Error('invalid NeoWs payload');
    const rawObjects = res.data.near_earth_objects || {};
    const formatted = [];

    for (const [date, list] of Object.entries(rawObjects)) {
      for (const item of list) {
        const closeApproach = item.close_approach_data?.[0] || {};
        formatted.push({
          id: item.id,
          name: item.name,
          nasa_jpl_url: item.nasa_jpl_url || `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${item.id}`,
          is_potentially_hazardous: Boolean(item.is_potentially_hazardous_asteroid),
          estimated_diameter_meters: {
            min: Math.round(item.estimated_diameter?.meters?.estimated_diameter_min || 10),
            max: Math.round(item.estimated_diameter?.meters?.estimated_diameter_max || 25)
          },
          close_approach_date: closeApproach.close_approach_date_full || date,
          velocity_kmh: Math.round(Number(closeApproach.relative_velocity?.kilometers_per_hour || 35000)),
          miss_distance_km: Math.round(Number(closeApproach.miss_distance?.kilometers || 2000000))
        });
      }
    }

    // A VALID response — including an empty window (element_count 0) — is served honestly;
    // never invented data.
    if (formatted.length > 0) store.saveAsteroids(formatted); // gather NEO records into the archive DB
    const result = {
      element_count: res.data?.element_count || formatted.length,
      start_date: start,
      end_date: end,
      source: 'nasa-neows',
      asteroids: formatted.sort((a, b) => a.miss_distance_km - b.miss_distance_km)
    };
    setCache(cacheKey, result, 2 * 60 * 60 * 1000);
    return result;
  } catch (err) {
    // The live feed failed → archive of REAL records from the last successful pull.
  }

  const archived = store.latestAsteroids({ limit: 60 });
  if (archived.length) {
    const archivedAt = archived.map(a => String(a.lastSeen || '')).sort().pop();
    const result = {
      element_count: archived.length,
      start_date: start,
      end_date: end,
      source: 'archive',
      archivedAt,
      asteroids: archived.sort((a, b) => a.miss_distance_km - b.miss_distance_km)
    };
    setCache(cacheKey, result, 5 * 60 * 1000); // 5 min — try the live path again soon
    return result;
  }

  return {
    element_count: 0,
    start_date: start,
    end_date: end,
    source: 'unavailable',
    asteroids: []
  };
}

async function getEPIC({ date } = {}) {
  const cacheKey = `epic:${date || 'latest'}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const url = date 
      ? `${config.nasa.baseUrl}/EPIC/api/natural/date/${date}`
      : `${config.nasa.baseUrl}/EPIC/api/natural`;

    const res = await apiHttp.get(url, { params: { api_key: config.nasa.apiKey }, timeout: 7000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      const list = res.data.slice(0, 12);
      const formatted = list.map(item => {
        const d = item.date ? item.date.slice(0, 10).split('-') : ['2026', '01', '01'];
        const imageArchiveUrl = `https://epic.gsfc.nasa.gov/archive/natural/${d[0]}/${d[1]}/${d[2]}/png/${item.image}.png`;
        const imageThumbUrl = `https://epic.gsfc.nasa.gov/archive/natural/${d[0]}/${d[1]}/${d[2]}/thumbs/${item.image}.jpg`;
        return {
          identifier: item.identifier,
          caption: item.caption || 'Planet Earth - DSCOVR EPIC',
          image: item.image,
          date: item.date,
          url: imageArchiveUrl,
          thumb: imageThumbUrl,
          centroid_coordinates: item.centroid_coordinates,
          dscovr_j2000_position: item.dscovr_j2000_position
        };
      });
      store.saveEpic(formatted); // save the daily Earth image into the archive
      setCache(cacheKey, formatted, 6 * 60 * 60 * 1000);
      return formatted;
    }
  } catch (err) {
    // Fall through to the NASA Image Library fallback
  }

  // Fall back to the NASA Media Library when the EPIC GSFC server times out
  try {
    const earthMedia = await searchNASAMedia('DSCOVR EPIC Earth full disc', { mediaType: 'image' });
    if (earthMedia.items && earthMedia.items.length) {
      const fallbackList = earthMedia.items.slice(0, 12).map((item, idx) => ({
        identifier: item.nasa_id || `epic-earth-${idx}`,
        caption: item.title || 'DSCOVR EPIC full-disc Earth photograph',
        image: item.nasa_id,
        date: item.date_created?.slice(0, 10) || '2026',
        url: item.thumb,
        thumb: item.thumb,
        source: 'nasa-media-archive'
      }));
      setCache(cacheKey, fallbackList, 6 * 60 * 60 * 1000);
      return fallbackList;
    }
  } catch (err) {
    // fallback
  }

  return [];
}

/**
 * 5. DONKI - Space Weather (Solar Flares & Geomagnetic Storms)
 */
async function getSpaceWeather({ type = 'FLR', startDate, endDate } = {}) {
  const today = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = startDate || thirtyDaysAgo;
  const end = endDate || today.toISOString().slice(0, 10);

  const cleanType = ['FLR', 'GST', 'CME'].includes(type) ? type : 'FLR';
  const cacheKey = `donki:${cleanType}:${start}:${end}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const res = await apiHttp.get(`${config.nasa.baseUrl}/DONKI/${cleanType}`, {
      params: {
        api_key: config.nasa.apiKey,
        startDate: start,
        endDate: end
      }
    });

    const data = Array.isArray(res.data) ? res.data.slice(0, 20) : [];
    setCache(cacheKey, data, 2 * 60 * 60 * 1000);
    return data;
  } catch {
    // DONKI/CCMC moved in 2026-10 — the official fallback: NOAA GOES X-ray flares
    if (cleanType !== 'FLR') return [];
    try {
      const res = await http.get(`${NOAA_SWPC}/goes/primary/xray-flares-7-day.json`, { timeout: 12000 });
      const list = Array.isArray(res.data) ? res.data.slice(0, 20) : [];
      const mapped = list.map(f => ({
        flrID: `NOAA-${f.time_tag || f.begin_time}`,
        beginTime: f.begin_time,
        peakTime: f.max_time,
        classType: f.max_class,
        source: 'NOAA-SWPC'
      }));
      setCache(cacheKey, mapped, 2 * 60 * 60 * 1000);
      return mapped;
    } catch {
      return [];
    }
  }
}

/**
 * 6. NASA Image and Video Library Search (images.nasa.gov)
 */
async function searchNASAMedia(query, { mediaType = 'image' } = {}) {
  if (!query || !query.trim()) return { total: 0, items: [] };
  const cleanQ = String(query).trim();
  const cacheKey = `nasa-media:${cleanQ}:${mediaType}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await http.get('https://images-api.nasa.gov/search', {
    params: {
      q: cleanQ,
      media_type: mediaType
    }
  });

  const rawItems = res.data?.collection?.items || [];
  const items = rawItems.slice(0, 24).map(item => {
    const data = item.data?.[0] || {};
    const link = item.links?.[0]?.href || '';
    return {
      nasa_id: data.nasa_id,
      title: data.title,
      description: data.description,
      date_created: data.date_created,
      keywords: data.keywords || [],
      media_type: data.media_type,
      thumb: link,
      asset_url: data.nasa_id ? `https://images.nasa.gov/details/${data.nasa_id}` : '',
      center: data.center
    };
  });

  const result = {
    query: cleanQ,
    total: res.data?.collection?.metadata?.total_hits || items.length,
    items
  };

  setCache(cacheKey, result, 4 * 60 * 60 * 1000);
  return result;
}

/**
 * 7. Live ISS (International Space Station) Telemetry
 * Cache 12s (the page + the live.json poll share it); honest about the source:
 * 'live' → a current reading · 'last-known' → feed busy, the real last position
 * (max 24 hours) · 'unavailable' → no data at all (NO invented 0,0).
 */
async function getISSTelemetry() {
  const cacheKey = 'iss:telemetry';
  const cached = getCache(cacheKey);
  if (cached && cached.source && cached.source !== 'unavailable') return cached;
  try {
    const res = await http.get('https://api.wheretheiss.at/v1/satellites/25544', { timeout: 6000 });
    const d = res.data || {};
    if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) throw new Error('invalid ISS payload');
    const data = {
      name: 'iss',
      latitude: d.latitude,
      longitude: d.longitude,
      altitude_km: Math.round(d.altitude * 10) / 10,
      velocity_kmh: Math.round(d.velocity),
      visibility: d.visibility || 'daylight',
      timestamp: d.timestamp,
      solar_lat: d.solar_lat,
      solar_lon: d.solar_lon,
      source: 'live',
    };
    setCache(cacheKey, data, 12 * 1000);
    setCache('iss:last-good', data, 24 * 60 * 60 * 1000);
    return data;
  } catch (err) {
    const good = getCache('iss:last-good');
    if (good) return Object.assign({}, good, { source: 'last-known' });
    return { source: 'unavailable' };
  }
}

/**
 * 8. NASA Audio & Space Sounds (Apollo, Shuttles, Planets, Rockets)
 */
// NASA asset URLs sometimes contain spaces and an http scheme — force https + encode each segment
function safeAssetUrl(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const u = new URL(raw);
    u.protocol = 'https:';
    u.pathname = u.pathname
      .split('/')
      .map(seg => {
        try { return encodeURIComponent(decodeURIComponent(seg)); } catch { return encodeURIComponent(seg); }
      })
      .join('/');
    return u.toString();
  } catch {
    return raw.replace(/^http:/, 'https:');
  }
}

// Audio topic → search + related keywords. The NASA SDK search sometimes serves
// HWHAP/NASA TV podcasts that never mention the topic — only items that say
// the keyword in the title/description are shown (quality > quantity).
const AUDIO_TOPICS = {
  apollo: { q: 'apollo', words: ['apollo'] },
  planets: { q: 'planets', words: ['planet', 'sonif', 'plasma', 'magnetic'], reject: ['launch coverage'] },
  rockets: { q: 'rocket launch', words: ['rocket', 'launch'] },
  mars: { q: 'mars', words: ['mars'] },
  spacewalk: { q: 'spacewalk', words: ['spacewalk', 'eva'] },
  shuttle: { q: 'space shuttle', words: ['shuttle'] }
};

async function getSpaceAudio(query = 'apollo') {
  const slug = AUDIO_TOPICS[String(query).trim().toLowerCase()] ? String(query).trim().toLowerCase() : 'apollo';
  const cfg = AUDIO_TOPICS[slug];
  const cacheKey = `nasa-audio:${slug}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get('https://images-api.nasa.gov/search', {
      params: { q: cfg.q, media_type: 'audio', year_start: 1960 },
      timeout: 15000
    });

    const rawItems = res.data?.collection?.items || [];
    // Filter for relevance first (cheap — metadata only), de-duplicate the multi
    // coverage of the same event channel ("... - Pad 1 (CH1)"), then resolve the asset manifest.
    const seenKey = new Map();
    const relevant = rawItems.filter(item => {
      const d = item.data?.[0] || {};
      const blob = `${d.title || ''} ${d.description || ''}`.toLowerCase();
      if (!cfg.words.some(w => blob.includes(w))) return false;
      if ((cfg.reject || []).some(w => blob.includes(w))) return false;
      const key = String(d.title || '').toLowerCase().split(/\s+[-–]\s+/)[0].replace(/\(.*?\)|[^a-z0-9 ]/g, '').trim().slice(0, 48);
      const n = seenKey.get(key) || 0;
      if (n >= 2) return false;
      seenKey.set(key, n + 1);
      return true;
    }).slice(0, 12);
    const items = [];

    for (const item of relevant) {
      const data = item.data?.[0] || {};
      const jsonHref = safeAssetUrl(item.href);
      let audioUrl = '';
      if (jsonHref) {
        try {
          const mediaRes = await http.get(jsonHref, { timeout: 8000 });
          const files = (Array.isArray(mediaRes.data) ? mediaRes.data : [])
            .filter(u => typeof u === 'string')
            .map(safeAssetUrl);
          audioUrl = files.find(f => f.endsWith('~128k.mp3')) || files.find(f => f.endsWith('.mp3')) || '';
        } catch {
          // skip this item
        }
      }

      if (audioUrl && data.title) {
        items.push({
          nasa_id: data.nasa_id,
          title: data.title,
          description: (data.description || '').slice(0, 500),
          date_created: data.date_created,
          audio_url: audioUrl
        });
      }
    }

    const result = { query: cfg.q, topic: slug, items };
    setCache(cacheKey, result, 6 * 60 * 60 * 1000);
    return result;
  } catch {
    return { query: cfg.q, topic: slug, items: [] };
  }
}

/**
 * 7a2. Direct media asset (mp4/poster) for a nasa_id — read from the asset manifest.
 *      Used by the "Live Space TV" modal so planet clips play in-app instead of an outside link.
 */
async function getNasaAssetUrl(nasaId) {
  const clean = String(nasaId || '').trim();
  if (!clean) return { video_url: '', poster: '' };
  const cacheKey = `nasa-asset:${clean}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const res = await http.get(`https://images-api.nasa.gov/asset/${encodeURIComponent(clean)}`, { timeout: 10000 });
    const groups = res.data?.collection?.items || [];
    const urls = [];
    for (const g of groups) {
      const h = g && g.href;
      if (typeof h === 'string') urls.push(safeAssetUrl(h));
      else if (Array.isArray(h)) h.forEach((l) => { if (typeof l === 'string') urls.push(safeAssetUrl(l)); });
    }
    const video_url =
      urls.find((u) => u.endsWith('~mobile.mp4')) ||
      urls.find((u) => u.endsWith('~small.mp4')) ||
      urls.find((u) => u.endsWith('.mp4')) ||
      urls.find((u) => u.includes('.mp4')) ||
      '';
    const poster = urls.find((u) => /~thumb|poster|~mediumjpg/.test(u)) || '';
    const result = { video_url, poster };
    setCache(cacheKey, result, 24 * 60 * 60 * 1000);
    return result;
  } catch {
    return { video_url: '', poster: '' };
  }
}

/**
 * 7b. Live crew — who is in outer space right now.
 *     open-notify.org (no key, free) is VERY unstable — sometimes a TCP
 *     connect hangs for dozens of seconds. The 'stale-while-revalidate' strategy:
 *     serve the last good data immediately (from disk) and refresh it
 *     in the background. The endpoint therefore never blocks a user.
 */
const CREW_FILE = path.join(path.dirname(config.store.path), 'crew-last.json');

function readCrewFallback() {
  try {
    const j = JSON.parse(fs.readFileSync(CREW_FILE, 'utf8'));
    return j && j.result ? j : null;
  } catch {
    return null;
  }
}

function writeCrewFallback(result) {
  try {
    fs.mkdirSync(path.dirname(CREW_FILE), { recursive: true });
    fs.writeFileSync(CREW_FILE, JSON.stringify({ savedAt: Date.now(), result }));
  } catch {
    /* the fallback write failed — not critical */
  }
}

// Fetch open-notify (blocking) — build the result, store it in memory + on disk.
async function refreshCrew() {
  const res = await http.get('http://api.open-notify.org/astros.json', { timeout: 6000 });
  const people = Array.isArray(res.data?.people) ? res.data.people : [];
  const byCraft = {};
  for (const p of people) {
    const craft = p.craft || 'Unknown';
    (byCraft[craft] = byCraft[craft] || []).push({ name: p.name, craft });
  }
  const result = {
    source: 'open-notify.org',
    inSpace: Number(res.data?.number) || people.length,
    people,
    stations: Object.entries(byCraft).map(([craft, list]) => ({ craft, count: list.length, crew: list }))
  };
  writeCrewFallback(result);
  setCache('crew:live', result, 10 * 60 * 1000); // 10 min — the crew rarely changes
  return result;
}

async function getCrew() {
  const cached = getCache('crew:live');
  if (cached) return cached;
  try {
    return await refreshCrew();
  } catch {
    // open-notify slow/failed → serve the last copy (if any), never block.
    const disk = readCrewFallback();
    if (disk && disk.result && Date.now() - disk.savedAt < 6 * 60 * 60 * 1000) {
      const stale = {
        ...disk.result,
        stale: true,
        savedAt: disk.savedAt,
        note: 'Live feed is congested — showing the last crew read on ' + new Date(disk.savedAt).toUTCString()
      };
      setCache('crew:live', stale, 2 * 60 * 1000); // short cache, try to refresh after 2 min
      // Retry in the background so the next request gets fresh data.
      refreshCrew().catch(() => {});
      return stale;
    }
    return { source: 'unavailable', inSpace: 0, people: [], stations: [], note: 'Crew feed (open-notify.org) is temporarily unreachable. Please retry in a minute.' };
  }
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * 9. Experiment: asteroid-approach trend for the last N weeks (NeoWs aggregate)
 */
async function getAsteroidTrend({ weeks = 4 } = {}) {
  const cleanWeeks = Math.min(Math.max(Math.round(Number(weeks) || 4), 1), 8);
  const cacheKey = `exp:neo-trend:${cleanWeeks}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const DAY = 86400000;
  const today = Date.now();
  const windows = [];
  for (let i = cleanWeeks - 1; i >= 0; i--) {
    windows.push({
      start: isoDate(today - (i * 7 + 6) * DAY),
      end: isoDate(today - i * 7 * DAY)
    });
  }

  const results = await Promise.all(
    windows.map(async w => {
      // Try twice: the NeoWs feed occasionally misses in the middle of 4 concurrent calls
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await getNearEarthObjects({ startDate: w.start, endDate: w.end });
          if (attempt === 0 && data?.source === 'fallback') {
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }
          return { window: w, data };
        } catch {
          if (attempt === 1) return { window: w, data: null };
        }
      }
      return { window: w, data: null };
    })
  );

  const buckets = results.map((r, idx) => {
    const list = r.data?.asteroids || [];
    const closest = list.reduce((m, a) => (!m || a.miss_distance_km < m.miss_distance_km ? a : m), null);
    return {
      week: idx + 1,
      label: `W${idx + 1}`,
      start: r.window.start,
      end: r.window.end,
      count: list.length,
      hazardous: list.filter(a => a.is_potentially_hazardous).length,
      closestKm: closest ? closest.miss_distance_km : null,
      fastestKmh: list.reduce((m, a) => Math.max(m, a.velocity_kmh), 0),
      maxDiameterMeters: list.reduce((m, a) => Math.max(m, a.estimated_diameter_meters.max), 0),
      source: r.data?.source || 'unknown'
    };
  });

  const all = results.flatMap(r => r.data?.asteroids || []);
  const nearest = all.reduce((m, a) => (!m || a.miss_distance_km < m.miss_distance_km ? a : m), null);
  const split = Math.floor(cleanWeeks / 2);
  const early = buckets.slice(0, split).reduce((s, b) => s + b.count, 0);
  const late = buckets.slice(split).reduce((s, b) => s + b.count, 0);
  const changePercent = early > 0 ? Math.round(((late - early) / early) * 100) : (late > 0 ? 100 : 0);
  const direction = changePercent > 5 ? 'up' : changePercent < -5 ? 'down' : 'flat';

  const result = {
    weeks: cleanWeeks,
    generatedAt: new Date().toISOString(),
    buckets,
    totals: {
      asteroids: all.length,
      hazardous: all.filter(a => a.is_potentially_hazardous).length,
      avgPerWeek: Math.round(all.length / cleanWeeks)
    },
    nearest: nearest ? {
      name: nearest.name,
      nasa_jpl_url: nearest.nasa_jpl_url,
      miss_distance_km: nearest.miss_distance_km,
      moonDistances: Math.round((nearest.miss_distance_km / 384400) * 100) / 100,
      velocity_kmh: nearest.velocity_kmh,
      estimated_diameter_meters: nearest.estimated_diameter_meters,
      is_potentially_hazardous: nearest.is_potentially_hazardous,
      close_approach_date: nearest.close_approach_date
    } : null,
    trend: { changePercent, direction },
    degraded: buckets.some(b => b.source === 'fallback')
  };

  // Partial (fallback) data is kept only briefly so the next attempt can improve it
  setCache(cacheKey, result, result.degraded ? 2 * 60 * 1000 : 6 * 60 * 60 * 1000);
  return result;
}

const CLASS_RANK = { X: 5, M: 4, C: 3, B: 2, A: 1 };

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 10. Experiment: solar activity (NOAA GOES X-ray flares + F10.7 radio flux)
 *     Donki/CCMC moved in 2026-10, so NOAA SWPC is now the space-weather reference.
 */
async function getSolarActivity({ days = 30 } = {}) {
  const cleanDays = Math.min(Math.max(Math.round(Number(days) || 30), 14), 42);
  const cacheKey = `exp:solar:${cleanDays}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const [flaresRes, fluxRes] = await Promise.all([
    http.get(`${NOAA_SWPC}/goes/primary/xray-flares-7-day.json`, { timeout: 12000 }).catch(() => ({ data: [] })),
    http.get(`${NOAA_SWPC}/f107_cm_flux.json`, { timeout: 12000 }).catch(() => ({ data: [] }))
  ]);

  const flares = Array.isArray(flaresRes.data) ? flaresRes.data : [];
  const fluxRecords = Array.isArray(fluxRes.data) ? fluxRes.data : [];
  const DAY = 86400000;
  const today = Date.now();

  // 1. X-ray flares → count & strongest class per day (last 7 days)
  const flareBuckets = new Map();
  for (let i = 6; i >= 0; i--) {
    const day = isoDate(today - i * DAY);
    flareBuckets.set(day, { day, label: day.slice(5), flares: 0, maxClass: null });
  }
  const classes = { X: 0, M: 0, C: 0, B: 0, A: 0 };
  let strongest = null;

  for (const f of flares) {
    const day = String(f.begin_time || f.time_tag || '').slice(0, 10);
    const cls = String(f.max_class || f.begin_class || '').toUpperCase();
    const rank = CLASS_RANK[cls[0]] || 0;
    const bucket = flareBuckets.get(day);
    if (bucket) {
      bucket.flares += 1;
      if (!bucket.maxClass || rank > (CLASS_RANK[bucket.maxClass[0]] || 0)) bucket.maxClass = cls || null;
    }
    if (Object.prototype.hasOwnProperty.call(classes, cls[0])) classes[cls[0]] += 1;
    if (!strongest || rank > (CLASS_RANK[String(strongest.classType || '')[0]] || 0)) {
      strongest = { classType: cls || null, time: f.begin_time || f.time_tag || null, peakTime: f.max_time || null };
    }
  }

  // 2. F10.7 radio flux → daily average for the selected window
  const fluxByDay = new Map();
  for (const record of fluxRecords) {
    const day = String(record.time_tag || '').slice(0, 10);
    const value = Number(record.flux);
    if (!day || !Number.isFinite(value)) continue;
    const values = fluxByDay.get(day) || [];
    values.push(value);
    fluxByDay.set(day, values);
  }
  const fluxDays = [...fluxByDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, values]) => ({ day, flux: Math.round(avg(values)) }))
    .slice(-cleanDays);

  const fluxValues = fluxDays.map(d => d.flux);
  const split = Math.floor(fluxDays.length / 2);
  const earlyAvg = avg(fluxDays.slice(0, split).map(d => d.flux));
  const lateAvg = avg(fluxDays.slice(split).map(d => d.flux));
  const changePercent = earlyAvg ? Math.round(((lateAvg - earlyAvg) / earlyAvg) * 100) : 0;

  const weeklyFlux = [];
  for (let i = 0; i < fluxDays.length; i += 7) {
    const chunk = fluxDays.slice(i, i + 7);
    weeklyFlux.push({
      label: `W${weeklyFlux.length + 1}`,
      start: chunk[0].day,
      end: chunk[chunk.length - 1].day,
      flux: Math.round(avg(chunk.map(c => c.flux)))
    });
  }

  const result = {
    days: cleanDays,
    generatedAt: new Date().toISOString(),
    source: 'NOAA SWPC — GOES X-ray flares & F10.7 radio flux',
    flares: {
      windowDays: 7,
      total: flares.length,
      classes,
      strongest,
      buckets: [...flareBuckets.values()]
    },
    flux: {
      days: fluxDays.length,
      window: fluxDays.length ? { start: fluxDays[0].day, end: fluxDays[fluxDays.length - 1].day } : null,
      avg: Math.round(avg(fluxValues)),
      min: fluxValues.length ? Math.min(...fluxValues) : 0,
      max: fluxValues.length ? Math.max(...fluxValues) : 0,
      changePercent,
      direction: changePercent > 3 ? 'up' : changePercent < -3 ? 'down' : 'flat',
      buckets: weeklyFlux
    }
  };

  setCache(cacheKey, result, 6 * 60 * 60 * 1000);
  return result;
}

/**
 * 11. 🌙 Moon & Tonight's Sky — the moon phase is computed locally (zero dependency
 *     on outside APIs) + dusk/night times from sunrise-sunset.org (free, no key).
 *     Times are returned in ISO UTC; the browser converts them to the user's time zone.
 */
const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // the proven reference new moon

function moonPhaseInfo(nowMs) {
  const days = (nowMs - KNOWN_NEW_MOON) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const illum = Math.round(((1 - Math.cos(2 * Math.PI * (age / SYNODIC))) / 2) * 100);
  let name, emoji;
  if (age < 1 || age > 28.5) { name = 'New Moon'; emoji = '🌑'; }
  else if (age < 6.4) { name = 'Waxing Crescent'; emoji = '🌒'; }
  else if (age < 8.5) { name = 'First Quarter'; emoji = '🌓'; }
  else if (age < 13.8) { name = 'Waxing Gibbous'; emoji = '🌔'; }
  else if (age < 15.8) { name = 'Full Moon'; emoji = '🌕'; }
  else if (age < 21.1) { name = 'Waning Gibbous'; emoji = '🌖'; }
  else if (age < 23.2) { name = 'Last Quarter'; emoji = '🌗'; }
  else { name = 'Waning Crescent'; emoji = '🌘'; }
  return {
    age_days: Math.round(age * 10) / 10,
    illum_percent: illum,
    name,
    emoji,
    next_full_days: Math.round(((SYNODIC / 2) - age + SYNODIC) % SYNODIC),
    next_new_days: Math.round((SYNODIC - age) % SYNODIC)
  };
}

// Mean lunar phase events for one calendar year, computed from the same reference
// new moon as moonPhaseInfo — pure local maths, zero API calls. MEAN phases: the
// Moon's eccentric orbit moves the true moment by up to ~14 h, so callers label
// the dates approximate and never promise an exact time.
function moonCalendar(year) {
  const y = Math.min(Math.max(Number(year) || 0, 1996), 2100);
  if (!Number.isFinite(Number(year))) return [];
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  const PHASES = [['New Moon', '\uD83C\uDF11', 0], ['First Quarter', '\uD83C\uDF13', 0.25], ['Full Moon', '\uD83C\uDF15', 0.5], ['Last Quarter', '\uD83C\uDF17', 0.75]];
  const out = [];
  const kStart = Math.floor((start - KNOWN_NEW_MOON) / (SYNODIC * 86400000)) - 1;
  const kEnd = Math.ceil((end - KNOWN_NEW_MOON) / (SYNODIC * 86400000)) + 1;
  for (let k = kStart; k <= kEnd; k++) {
    for (const [name, emoji, frac] of PHASES) {
      const t = KNOWN_NEW_MOON + (k + frac) * SYNODIC * 86400000;
      if (t >= start && t < end) out.push({ date: new Date(t).toISOString().slice(0, 10), name, emoji });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function getSkyTonight({ lat, lng } = {}) {
  const la = Number.isFinite(Number(lat)) ? Math.min(Math.max(Number(lat), -90), 90) : 3.139;   // default: Kuala Lumpur
  const ln = Number.isFinite(Number(lng)) ? Math.min(Math.max(Number(lng), -180), 180) : 101.687;
  const cacheKey = `sky:${la.toFixed(2)}:${ln.toFixed(2)}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  let sun = null;
  let note = '';
  try {
    const res = await http.get('https://api.sunrise-sunset.org/json', {
      params: { lat: la, lng: ln, formatted: '0' },
      timeout: 10000
    });
    const r = res.data && res.data.results;
    if (r && r.sunrise) {
      sun = {
        sunrise: r.sunrise, sunset: r.sunset, solar_noon: r.solar_noon,
        day_length_hours: Math.round(((Number(r.day_length) || 0) / 3600) * 10) / 10, // the API returns SECONDS
        civil: [r.civil_twilight_begin, r.civil_twilight_end],
        nautical: [r.nautical_twilight_begin, r.nautical_twilight_end],
        astronomical: [r.astronomical_twilight_begin, r.astronomical_twilight_end]
      };
    } else {
      note = 'Sun-time service returned no data — moon phase is still exact (computed locally).';
    }
  } catch {
    note = 'Sun-time service (sunrise-sunset.org) unreachable — moon phase is still exact (computed locally).';
  }
  const result = { location: { lat: la, lng: ln }, sun, moon: moonPhaseInfo(Date.now()), note, source: 'sunrise-sunset.org + local lunar math' };
  setCache(cacheKey, result, 30 * 60 * 1000);
  return result;
}

/**
 * 12. 🪐 Exoplanet Hunter — NASA Exoplanet Archive TAP (free, no key).
 *     pscomppars = the default parameters per confirmed planet; sorted by closest distance.
 */
async function getExoplanets({ limit = 250 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 250, 10), 500);
  const cacheKey = `exo:nearest:${n}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const q = 'select pl_name,sy_dist,pl_rade,st_teff,disc_year,pl_orbper from pscomppars order by sy_dist asc';
  try {
    const res = await http.get('https://exoplanetarchive.ipac.caltech.edu/TAP/sync', {
      params: { query: q, format: 'json', maxrec: String(n) },
      timeout: 25000
    });
    const rows = Array.isArray(res.data) ? res.data : [];
    const planets = rows.map(r => ({
      name: String(r.pl_name || ''),
      dist_pc: Math.round((Number(r.sy_dist) || 0) * 1000) / 1000,
      radius_earth: Number(r.pl_rade) ? Math.round(r.pl_rade * 100) / 100 : null,
      star_temp_k: Math.round(Number(r.st_teff) || 0),
      disc_year: Number(r.disc_year) || null,
      period_days: Number(r.pl_orbper) ? Math.round(r.pl_orbper * 1000) / 1000 : null
    })).filter(p => p.name);
    if (!planets.length) throw new Error('the archive returned no rows');
    const result = {
      count: planets.length,
      generatedAt: new Date().toISOString(),
      source: 'NASA Exoplanet Archive (pscomppars)',
      planets
    };
    setCache(cacheKey, result, 12 * 60 * 60 * 1000);
    setCache('exo:last-good', result, 7 * 24 * 60 * 60 * 1000);
    return result;
  } catch (err) {
    // Honesty contract: serve the last snapshot LABELLED when the NASA archive
    // is unreachable (their cx_Oracle has been down for hours before).
    const good = cache.get('exo:last-good');
    if (good && good.data && Array.isArray(good.data.planets) && good.data.planets.length) {
      return Object.assign({}, good.data, { stale: true, staleAt: good.data.generatedAt });
    }
    throw err;
  }
}

/**
 * 13. ☄️ Planetary Defense — JPL Sentry: objects with an identified impact risk.
 *     An empty list = good news (no tracked object has a significant impact probability).
 */
async function getSentryRisk() {
  const cacheKey = 'defense:sentry';
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const res = await http.get('https://ssd-api.jpl.nasa.gov/sentry.api', { timeout: 15000 });
  // The API's real fields: ip = cumulative impact probability, ps_cum = Palermo scale,
  // ts_max = Torino scale, diameter in KM, range = the impact-year span, n_imp = virtual impactors.
  const raw = Array.isArray(res.data && res.data.data) ? res.data.data : [];
  const risks = raw.map(o => ({
    id: o.id || '',
    name: o.fullname || o.des || 'Unknown',
    diameter_km: Number(o.diameter) || null,
    abs_mag: Number(o.h) || null,
    impact_years: o.range || '',
    virtual_impactors: Number(o.n_imp) || 0,
    cum_prob: Number(o.ip) || 0,
    palermo: Number(o.ps_cum) || 0,
    torino: Number(o.ts_max) || 0,
    url: 'https://ssd.jpl.nasa.gov/tools/sentry_data.html'
  })).filter(r => r.cum_prob > 0).sort((a, b) => b.cum_prob - a.cum_prob).slice(0, 40);
  const result = {
    count: risks.length,
    highest_prob: risks.length ? risks[0].cum_prob : 0,
    generatedAt: new Date().toISOString(),
    source: 'NASA/JPL Sentry Risk Table',
    risks
  };
  setCache(cacheKey, result, 6 * 60 * 60 * 1000);
  return result;
}

/**
 * 14. 🛰 Satellite Corner — CelesTrak TLE (orbital elements), free, no key.
 *     TLEs are read & trimmed on the server (6-hour cache) so clients get compact JSON.
 */
const SAT_GROUP_KEYS = ['stations', 'visual', 'gps-ops', 'geostationary', 'resource'];

function parseTleBlocks(text, max) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 2 < lines.length && out.length < max; i += 3) {
    const name = String(lines[i] || '').trim();
    const l1 = String(lines[i + 1] || '').trim();
    const l2 = String(lines[i + 2] || '').trim();
    if (!/^1\s\d{5}/.test(l1) || !/^2\s\d{5}/.test(l2)) continue;
    const norad = l1.slice(2, 7).trim();
    const intl = l1.slice(7, 14).trim();
    const incl = parseFloat(l2.slice(8, 16));
    const mm = parseFloat(l2.slice(52, 63));
    let alt_km = null, period_min = null;
    if (mm > 0) {
      period_min = Math.round((1440 / mm) * 10) / 10;
      const tSec = 86400 / mm;
      const aKm = Math.cbrt(398600.4418 * Math.pow(tSec / (2 * Math.PI), 2));
      alt_km = Math.round((aKm - 6371) * 10) / 10;
    }
    out.push({ name, norad, intl: intl || '—', incl_deg: Number.isFinite(incl) ? Math.round(incl * 100) / 100 : null, period_min, alt_km });
  }
  return out;
}

async function getSatellites({ group = 'stations' } = {}) {
  const g = SAT_GROUP_KEYS.includes(String(group)) ? String(group) : 'stations';
  const cacheKey = `sats:${g}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const res = await http.get('https://celestrak.org/NORAD/elements/gp.php', {
    params: { GROUP: g, FORMAT: 'tle' },
    timeout: 15000
  });
  const satellites = parseTleBlocks(res.data, 80);
  const result = { group: g, count: satellites.length, source: 'CelesTrak (TLE elements)', generatedAt: new Date().toISOString(), satellites };
  setCache(cacheKey, result, 6 * 60 * 60 * 1000);
  return result;
}

/**
 * 15. 🚀 Launch Schedule — Launch Library 2 (thespacedevs.com), keyless & anonymous.
 *     Cached 2 hours; when the feed refuses (anonymous quota is tight), the last good
 *     copy is served labelled as stale rather than an error page. Attribution kept.
 */
let lastGoodLaunches = null;

async function getLaunches() {
  const cacheKey = 'launches:upcoming';
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const res = await http.get('https://ll.thespacedevs.com/2.2.0/launch/upcoming/', {
      params: { limit: 30 },
      timeout: 15000,
      headers: { Accept: 'application/json' },
    });
    const rows = Array.isArray(res.data && res.data.results) ? res.data.results : [];
    const launches = rows.map((l) => {
      const pad = l.pad || {};
      const loc = pad.location || {};
      const agencies = (l.mission && Array.isArray(l.mission.agencies)) ? l.mission.agencies : [];
      return {
        name: String(l.name || '').slice(0, 160),
        net: String(l.net || ''),
        probability: Number.isFinite(Number(l.probability)) ? Number(l.probability) : null,
        status: String((l.status && l.status.name) || ''),
        statusDesc: String((l.status && l.status.description) || ''),
        mission: String((l.mission && l.mission.name) || '').slice(0, 160),
        missionDesc: String((l.mission && l.mission.description) || '').slice(0, 500),
        agency: String(agencies.length ? agencies[0].name : ''),
        location: String(loc.name || (l.country && l.country.name) || '').slice(0, 120),
        pad: String(pad.name || '').slice(0, 120),
        trajectory: String((l.trajectory && l.trajectory.name) || '').slice(0, 120),
        image: String((l.image && l.image.url) || '').slice(0, 300),
        web: String((l.url || (l.mission && l.mission.web_url)) || ''),
      };
    }).filter((l) => l.net);
    if (!launches.length) throw new Error('empty launch feed');
    const result = {
      count: launches.length,
      generatedAt: new Date().toISOString(),
      source: 'Launch Library 2 (thespacedevs.com)',
      sourceUrl: 'https://thespacedevs.com',
      launches,
    };
    lastGoodLaunches = result;
    setCache(cacheKey, result, 2 * 60 * 60 * 1000);
    return result;
  } catch (err) {
    if (lastGoodLaunches) {
      const stale = { ...lastGoodLaunches, stale: true };
      setCache(cacheKey, stale, 10 * 60 * 1000); // ten minutes' grace before re-trying live
      return stale;
    }
    throw err;
  }
}

/**
 * 16. 🛰 ISS Pass Predictions — SGP4 on our own box, no third-party pass API.
 *     The ISS TLE comes from CelesTrak (six-hour cache, last-good kept in memory),
 *     is propagated with satellite.js for the next 36 hours, and every window with
 *     elevation ≥ 10° becomes a pass. A pass is called visible only when the Sun is
 *     a few degrees below the horizon while the station is above it — dark sky is
 *     the whole trick to seeing the ISS, so the solar position is computed here with
 *     the standard low-precision formula (~0.01°, noise beside TLE uncertainty).
 */
const SATJS = require('satellite.js');
let lastGoodIssTle = null;

async function getISSTle() {
  const cacheKey = 'iss:tle';
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const res = await http.get('https://celestrak.org/NORAD/elements/gp.php', {
      params: { CATNR: '25544', FORMAT: 'tle' },
      timeout: 15000,
    });
    const sats = parseTleBlocks(res.data, 1);
    const lines = String(res.data || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const l1 = lines.find((l) => l.startsWith('1 '));
    const l2 = lines.find((l) => l.startsWith('2 '));
    if (!sats.length || !l1 || !l2) throw new Error('no ISS TLE');
    const tle = { name: sats[0].name, l1, l2, epoch: new Date().toISOString() };
    lastGoodIssTle = tle;
    setCache(cacheKey, tle, 6 * 60 * 60 * 1000);
    return tle;
  } catch (err) {
    if (lastGoodIssTle) return lastGoodIssTle; // old elements still propagate for hours
    throw err;
  }
}

// Low-precision solar right ascension/declination + elevation for an observer.
function sunPosition(dateMs, latDeg, lonDeg) {
  const n = (dateMs - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const d = (x) => (x * Math.PI) / 180;
  const L = d(280.46 + 0.9856474 * n);
  const g = d(357.528 + 0.9856003 * n);
  const lambda = L + d(1.915) * Math.sin(g) + d(0.02) * Math.sin(2 * g);
  const eps = d(23.439 - 0.0000004 * n);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gst = SATJS.gstime(new Date(dateMs)) * (180 / Math.PI);
  const lst = ((gst + lonDeg) % 360 + 360) % 360;
  const H = d(lst - ra * (180 / Math.PI));
  const alt = Math.asin(Math.sin(d(latDeg)) * Math.sin(dec) + Math.cos(d(latDeg)) * Math.cos(dec) * Math.cos(H));
  return { altDeg: alt * (180 / Math.PI) };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compass(azDeg) { return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16]; }

async function getISSPasses({ lat, lng } = {}) {
  const la = Number(lat); const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new Error('bad coordinates');
  }
  const cacheKey = `iss:pass:${la.toFixed(2)},${lo.toFixed(2)}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const tle = await getISSTle();
  const satrec = SATJS.twoline2satrec(tle.l1, tle.l2);
  // satellite.js v7 names the field `height` (km) — passing `altitude` silently
  // produces null look angles, which is how this whole function once returned 0 passes.
  const obs = { latitude: (la * Math.PI) / 180, longitude: (lo * Math.PI) / 180, height: 0.05 };
  const STEP = 20000; const HOURS = 36;
  const t0 = Date.now(); const t1 = t0 + HOURS * 3600000;
  const passes = [];
  let cur = null;
  for (let t = t0; t <= t1; t += STEP) {
    const date = new Date(t);
    const pv = SATJS.propagate(satrec, date);
    if (!pv || !pv.position) continue;
    const gmst = SATJS.gstime(date);
    const ecf = SATJS.eciToEcf(pv.position, gmst);
    const look = SATJS.ecfToLookAngles(obs, ecf);
    const el = look.elevation * (180 / Math.PI);
    const az = look.azimuth * (180 / Math.PI);
    const sunAlt = sunPosition(t, la, lo).altDeg;
    if (el >= 10) {
      if (!cur) cur = { start: t, end: t, peak: t, maxEl: el, azIn: az, azOut: az, darkSec: sunAlt <= -3 ? STEP : 0 };
      else {
        cur.end = t;
        cur.azOut = az;
        if (el > cur.maxEl) { cur.maxEl = el; cur.peak = t; }
        if (sunAlt <= -3) cur.darkSec += STEP;
      }
    } else if (cur) {
      // A pass counts as visually promising only if a decent dark slice overlaps it.
      passes.push({
        start: new Date(cur.start).toISOString(),
        peak: new Date(cur.peak).toISOString(),
        end: new Date(cur.end).toISOString(),
        maxEl: Math.round(cur.maxEl),
        durMin: Math.max(1, Math.round((cur.end - cur.start) / 60000)),
        azIn: compass(cur.azIn), azOut: compass(cur.azOut),
        visible: cur.darkSec >= 120000,
      });
      cur = null;
    }
  }
  const result = {
    lat: Math.round(la * 100) / 100, lng: Math.round(lo * 100) / 100,
    generatedAt: new Date(t0).toISOString(), windowHours: HOURS,
    tleEpoch: tle.epoch,
    source: 'CelesTrak TLE + SGP4 (satellite.js), computed on our server',
    passes: passes.slice(0, 12),
  };
  setCache(cacheKey, result, 30 * 60 * 1000);
  return result;
}

/**
 * 17. Archive backfill — gather NASA data into the local database periodically.
 *     APOD: seven single-date pulls through getAPOD (retry + archive fallback are already
 *     built in; the `count` path often serves the broken "NASA Science" page).
 *     One NEO day + EPIC contribute the rest of the collection. A one-day error is ignored.
 */
async function backfillArchive() {
  const hasil = { apod: 0, asteroids: 0, epic: 0 };
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    try {
      const apod = await getAPOD({ date: d });
      if (apod && !apod.api_down && !apod.stale && store.getApod(d)) hasil.apod += 1;
    } catch { /* try the next day */ }
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const neo = await getNearEarthObjects({ startDate: today, endDate: today });
    hasil.asteroids = (neo.asteroids || []).length;
  } catch { /* skip */ }
  try {
    const epic = await getEPIC({});
    hasil.epic = Array.isArray(epic) ? epic.length : 0;
  } catch { /* skip */ }
  return hasil;
}

let archiveTimer = null;

/** Backfill schedule: the first run 20 s late (after boot), then every 6 hours. */
function startArchiveBackfill() {
  if (archiveTimer) return;
  setTimeout(() => { backfillArchive().catch(() => {}); }, 20 * 1000).unref();
  archiveTimer = setInterval(() => { backfillArchive().catch(() => {}); }, 6 * 60 * 60 * 1000);
  archiveTimer.unref();
}

function stopArchiveBackfill() {
  if (archiveTimer) { clearInterval(archiveTimer); archiveTimer = null; }
}

module.exports = {
  getAPOD,
  apodFromDiskIfFresh,
  APOD_SNAPSHOT_MAX_AGE_MS,
  startApodAutoUpdate,
  stopApodAutoUpdate,
  backfillArchive,
  startArchiveBackfill,
  stopArchiveBackfill,
  store,
  getMarsPhotos,
  getNearEarthObjects,
  getEPIC,
  getSpaceWeather,
  searchNASAMedia,
  getISSTelemetry,
  getCrew,
  getSpaceAudio,
  getNasaAssetUrl,
  getAsteroidTrend,
  getSolarActivity,
  moonPhaseInfo,
  moonCalendar,
  getSkyTonight,
  getExoplanets,
  getSentryRisk,
  getSatellites,
  getLaunches,
  getISSPasses
};
