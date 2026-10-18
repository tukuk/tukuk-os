const axios = require('axios');
const fs = require('fs');
const https = require('https');
const dns = require('dns');
const path = require('path');
const config = require('./config');
const store = require('./nasa-store');

// ——— Rotasi IP untuk api.nasa.gov ———
// Salah satu backend LB NASA sering rosak (500/timeout); pemerhatian menunjukkan rekod A
// (IPv4) jauh lebih rosak daripada rekod AAAA (IPv6). Node default tersekat pada satu IP,
// jadi agen ini pusing SEMUA IPv6+IPv4 setiap sambungan dan blacklist sementara IP yang
// error di peringkat soket; keep-alive memastikan soket sihat diulang-pakai.
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
    const merged = [...v6, ...v4]; // IPv6 didahulukan (backend IPv4 lebih rosak)
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

// Khusus api.nasa.gov: TANPA keep-alive supaya setiap percubaan mendapat sambungan
// (dan backend LB) baharu. NASA kini Separuh balas dengan HTTP 200 "payload rosak"
// (title "NASA Science" + logo) dan 500; soket diulang-pakai akan tersepit pada backend
// rosak yang sama — retry jadi sia-sia. Rotasi IP + sambungan baru = peluang terbaik.
const apiHttp = axios.create({
  timeout: 20000,
  httpsAgent: new NasaAwareAgent({ keepAlive: false, maxSockets: 12 }),
  headers: {
    'User-Agent': 'TukukOS-NASA-Client/1.0 (+https://tukuk.org)'
  }
});

// Cache ringkas dalam memori untuk elak had kadar (rate limit)
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

// NOAA Space Weather Prediction Center — data cuaca angkasa percuma tanpa kunci
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

const APOD_FALLBACK_FILE = path.join(path.dirname(config.store.path), 'apod-last.json');

// Pemutus litar: jika API APOD NASA gagal, jangan bazir masa mencuba berulang-ulang
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
    // sandaran gagal tulis bukan masalah kritikal
  }
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
 * Sumber sandaran rasmi: laman APOD NASA Science (science.nasa.gov) menyimpan
 * arkib penuh mengikut tarikh — dipanggil apabila api.nasa.gov gagal.
 * Halaman mesti sah: tajuk mesti bermula "APOD: <tarikh yang diminta>".
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
  const titleTag = page.match(/<title>APOD:\s*(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})\s*-\s*([\s\S]*?)\s*-\s*NASA Science<\/title>/i);
  if (!titleTag) return null;

  const monthNum = MONTH_NUM[titleTag[2]] || '';
  const pageDate = `${titleTag[1]}-${monthNum}-${String(titleTag[3]).padStart(2, '0')}`;
  if (monthNum && pageDate !== dateStr) return null; // tarikh berbeza = halaman tiada lagi

  const title = stripTags(titleTag[4]);
  if (!title) return null;

  const explIdx = page.indexOf('<strong>Explanation:</strong>');
  let explanation = '';
  if (explIdx >= 0) {
    const end = page.indexOf('</p>', explIdx);
    const seg = page.slice(explIdx + '<strong>Explanation:</strong>'.length, end > explIdx ? end : explIdx + 6000);
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

// Semak payload APOD: API NASA pernah menghantar tajuk/logo rosak semasa penghijrahan
function isValidApodPayload(data, acceptedDates) {
  if (!data || typeof data !== 'object') return false;
  // Payload list (parameter count>1): NASA hantar array — sah jika sekurang-kurangnya
  // satu entri di dalamnya sah. Tanpa cabang ini, array gagal semakan dan count rosak.
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
 *    API NASA kadang-kadang503 (upstream) — cuba beberapa kali, kemudian
 *    jatuh ke arkib rasmi science.nasa.gov, kemudian cakera tempatan.
 */
async function getAPOD({ date, count, force } = {}) {
  const cacheKey = `apod:${date || 'today'}:${count || 1}`;
  if (force) apodApiDownUntil = 0; // "Try live again" / auto-update: cabut pemutus litar dulu
  const cached = force ? null : getCache(cacheKey);
  if (cached && isValidApodPayload(cached, null)) return cached;

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
          store.saveApod(res.data); // kekalkan jejak ke pangkalan data arkib
          setCache(cacheKey, res.data, 4 * 60 * 60 * 1000);
          if (!date && !count) writeApodFallback(res.data);
          return res.data;
        }
        lastError = new Error('invalid APOD payload from the NASA API');
        if (process.env.NASA_DEBUG === '1') console.error('[apod] attempt' , attempt, 'tak sah:', JSON.stringify(res.data).slice(0, 120));
      } catch (err) {
        lastError = err;
        if (process.env.NASA_DEBUG === '1') console.error('[apod] attempt', attempt, err.response?.status || err.code || err.message);
      }
      await sleep(500 * (attempt + 1));
    }

    // Jika tarikh hari ini belum wujud (rupa API NASA), cuba semalam
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

    // Semua percubaan gagal → aktifkan pemutus litar selama10 minit
    apodApiDownUntil = Date.now() + 10 * 60 * 1000;
  }

  if (count) {
    throw lastError || new Error('NASA APOD API temporarily unavailable');
  }

  // Sandaran A: arkib rasmi science.nasa.gov (tarikh diminta, kemudian semalam)
  for (const tryDate of date ? [date] : [targetDate, yesterday]) {
    try {
      const apod = await getApodFromScienceSite(tryDate);
      if (apod && isValidApodPayload(apod, [tryDate])) {
        const payload = { ...apod, api_down: true };
        store.saveApod(apod); // arkib rasmi juga disimpan ke DB
        setCache(cacheKey, payload, 30 * 60 * 1000);
        if (!date) writeApodFallback(payload);
        return payload;
      }
    } catch (err) {
      lastError = lastError || err;
    }
  }

  // Sandaran B: APOD terakhir yang berjaya disimpan dalam cakera (jika masih sah)
  const stored = readApodFallback();
  if (stored && isValidApodPayload(stored, null)) {
    return { ...stored, stale: true, staleNote: 'NASA APOD services are offline — showing the last successful picture.' };
  }

  // Sandaran C: pangkalan data arkib setempat — entri APOD terakhir yang pernah disimpan
  const archived = store.latestApod(targetDate);
  if (archived) {
    return { ...archived, stale: true, fromArchive: true, staleNote: 'NASA APOD services are offline — showing the latest archived picture.' };
  }

  throw lastError || new Error('NASA APOD temporarily unavailable');
}

let apodRefreshTimer = null;

// Satu tarikan APOD "hari ini" dari luar (lintasi cache & pemutus litar) untuk auto-update
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

// Jadual diri: API hidup → selang biasa; API rosak/timeout → cuba lebih awal (5 min)
// supaya paparan kembali ke sumber hidup sendiri sebaik NASA pulih.
function scheduleApodRefresh(delayMs) {
  apodRefreshTimer = setTimeout(async () => {
    const data = await refreshApodNow();
    const healthy = data && !data.api_down && !data.stale;
    scheduleApodRefresh(healthy ? apodRefreshIntervalMs() : 5 * 60 * 1000);
  }, delayMs);
  apodRefreshTimer.unref();
}

/**
 * Auto-update APOD: tarikan latar belakang berkala (NASA_APOD_REFRESH_MIN minit, lalai 30;
 * 5 min apabila API masih rosak) — API hidup→cache + cakera dikemas kini,
 * API down→arkib science.nasa.gov. Pengguna sentiasa hidang data terbaharu tanpa
 * perlu menunggu permintaan pertama, dan pemutus litar diuji semula setiap pusingan.
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
 * Dilengkapi dengan fallback pintar ke NASA Media Library jika pelayan lama mars-photos tidak tersedia.
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
    // Teruskan ke fallback NASA Image Library
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
 * 3. NeoWs - Asteroid & Objek Berdekatan Bumi
 */
async function getNearEarthObjects({ startDate, endDate } = {}) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = startDate || yesterdayStr;
  const end = endDate || todayStr;
  const cacheKey = `asteroids:${start}:${end}`;
  const cached = getCache(cacheKey);
  // Keputusan 'unavailable' tidak disimpan supaya percubaan seterusnya kekal sah
  if (cached && cached.source !== 'unavailable') return cached;

  try {
    const params = {
      api_key: config.nasa.apiKey,
      start_date: start,
      end_date: end
    };

    const res = await apiHttp.get(`${config.nasa.baseUrl}/neo/rest/v1/feed`, { params, timeout: 8000 });
    if (!res.data || !res.data.near_earth_objects) throw new Error('payload NeoWs tidak sah');
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

    // Respons SAH — termasuk tingkap kosong (element_count 0) — hidang jujur;
    // tiada pernah data rekaan.
    if (formatted.length > 0) store.saveAsteroids(formatted); // kumpul rekod NEO ke dalam DB arkib
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
    // Suapan langsung gagal → arkib rekod NYATA dari tarikan berjaya terakhir.
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
    setCache(cacheKey, result, 5 * 60 * 1000); // 5 min — cuba langsung semula dengan cepat
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
      store.saveEpic(formatted); // simpan bola bumi harian ke arkib
      setCache(cacheKey, formatted, 6 * 60 * 60 * 1000);
      return formatted;
    }
  } catch (err) {
    // Teruskan ke fallback NASA Image Library
  }

  // Fallback ke NASA Media Library jika pelayan EPIC GSFC mengalami timeout
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
 * 5. DONKI - Cuaca Angkasa (Solar Flares & Ribut Geomagnetik)
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
    // DONKI/CCMC berpindah pada2026-10 — sandaran rasmi: NOAA GOES X-ray flares
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
 * Cache 12s (halaman + poll live.json berkongsi); jujur tentang sumber:
 * 'live' → bacaan semasa · 'last-known' → feed sibuk, posisi nyata terakhir
 * (max 24 jam) · 'unavailable' → tiada data sama sekali (TIADA 0,0 rekaan).
 */
async function getISSTelemetry() {
  const cacheKey = 'iss:telemetry';
  const cached = getCache(cacheKey);
  if (cached && cached.source && cached.source !== 'unavailable') return cached;
  try {
    const res = await http.get('https://api.wheretheiss.at/v1/satellites/25544', { timeout: 6000 });
    const d = res.data || {};
    if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) throw new Error('payload ISS tidak sah');
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
// URL aset NASA kadang mengandungi ruang dan skema http — paksa https + encode setiap segmen
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

// Topik audio → carian + kata kunci kaitan. Carian NASA SDK kadangkala hidang
// podcast HWHAP/NASA TV yang tidak disebut topik — hanya item yang menyebut
// kata kuncinya dalam tajuk/penjelasan dipaparkan (kualiti > kuantiti).
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
    // Tapis kaitan dulu (murah — metadata sahaja), nyahpendua liputan berbilang
    // saluran acara yang sama ("... - Pad 1 (CH1)"), baru selesaikan manifest aset.
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
          // skip item ini
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
 * 7a2. Direct media asset (mp4/poster) untuk sesuatu nasa_id — dibaca dari manifest aset.
 *      Dipakai modal "Live Space TV" supaya klip planet main dalam-app, bukan pautan luar.
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
 * 7b. Live crew — siapa yang sedang berada di angkasa lepas sekarang.
 *     open-notify.org (tiada kunci, percuma) SANGAT tidak stabil — kadang TCP
 *     connect menggantung puluhan saat. Strategi 'stale-while-revalidate':
 *     hidang data terakhir yang baik serta-merta (dari cakera), dan segar semula
 *     di latar belakang. Endpoint jadi tidak pernah menyekat pengguna.
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
    /* sandaran tulis gagal — bukan kritikal */
  }
}

// Fetch open-notify (blocking) — bina result, simpan ke memory + cakera.
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
  setCache('crew:live', result, 10 * 60 * 1000); // 10 minit — krew jarang berubah
  return result;
}

async function getCrew() {
  const cached = getCache('crew:live');
  if (cached) return cached;
  try {
    return await refreshCrew();
  } catch {
    // open-notify lambat/gagal → hidang salinan terakhir (jika ada), jangan sekat.
    const disk = readCrewFallback();
    if (disk && disk.result && Date.now() - disk.savedAt < 6 * 60 * 60 * 1000) {
      const stale = {
        ...disk.result,
        stale: true,
        savedAt: disk.savedAt,
        note: 'Live feed is congested — showing the last crew read on ' + new Date(disk.savedAt).toUTCString()
      };
      setCache('crew:live', stale, 2 * 60 * 1000); // cache pendek, cuba segar semula lepas 2 min
      // Cuba lagi di latar belakang supaya permintaan seterusnya dapat data segar.
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
 * 9. Eksperimen: trend pendekatan asteroid N minggu lepas (agregat NeoWs)
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
      // Cuba dua kali: feed NeoWs kadang kala tersasar di tengah4 serentak
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

  // Data separa (fallback) disimpan sebentar sahaja supaya percubaan seterusnya membaikinya
  setCache(cacheKey, result, result.degraded ? 2 * 60 * 1000 : 6 * 60 * 60 * 1000);
  return result;
}

const CLASS_RANK = { X: 5, M: 4, C: 3, B: 2, A: 1 };

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 10. Eksperimen: aktiviti matahari (NOAA GOES X-ray flares + pancuran radio F10.7)
 *     Donki/CCMC dipindahkan pada2026-10, jadi rujukan cuaca angkasa kini NOAA SWPC.
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

  //1. Flare X-ray → bilangan & kelas terkuat setiap hari (7 hari terakhir)
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

  //2. Pancuran radio F10.7 → purata harian untuk tetingkap terpilih
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
 * 11. 🌙 Bulan & Langit Malam Ini — fasa bulan dikira setempat (sifar kebergantungan
 *     API luar) + waktu senja/malam dari sunrise-sunset.org (percuma, tiada kunci).
 *     Waktu dikembalikan dalam UTC ISO; pelayar menukar ke zon waktu pengguna.
 */
const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // bulan baru rujukan yang terbukti

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

async function getSkyTonight({ lat, lng } = {}) {
  const la = Number.isFinite(Number(lat)) ? Math.min(Math.max(Number(lat), -90), 90) : 3.139;   // lalai: Kuala Lumpur
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
        day_length_hours: Math.round(((Number(r.day_length) || 0) / 3600) * 10) / 10, // API sepulangkan SAAT
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
 * 12. 🪐 Pemburu Eksoplanet — NASA Exoplanet Archive TAP (percuma, tiada kunci).
 *     pscomppars = parameter lalai setiap planet disahkan; susun ikut jarak paling dekat.
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
    if (!planets.length) throw new Error('arkib tidak mengembalikan sebarang baris');
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
    // Kontrak kejujuran: hidangkan snapshot terakhir DILABEL bila arkib NASA
    // tidak dapat dicapai (cx_Oracle di pihak mereka pernah runtuh berjam-jam).
    const good = cache.get('exo:last-good');
    if (good && good.data && Array.isArray(good.data.planets) && good.data.planets.length) {
      return Object.assign({}, good.data, { stale: true, staleAt: good.data.generatedAt });
    }
    throw err;
  }
}

/**
 * 13. ☄️ Pertahanan Planet — JPL Sentry: objek dengan risiko impak yang dikenal pasti.
 *     Senarai kosong = berita baik (tiada objek dipantau dengan kebarangkalian impak signifikan).
 */
async function getSentryRisk() {
  const cacheKey = 'defense:sentry';
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const res = await http.get('https://ssd-api.jpl.nasa.gov/sentry.api', { timeout: 15000 });
  // Medan sebenar API: ip = kebarangkalian impak kumulatif, ps_cum = skala Palermo,
  // ts_max = skala Torino, diameter dalam KM, range = julat tahun impak, n_imp = virtual impactors.
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
 * 14. 🛰 Ceruk Satelit — CelesTrak TLE (elemen orbit), percuma, tiada kunci.
 *     TLE dibaca & dipotong di pelayan (cache 6 jam) supaya pelanggan dapat JSON ringkas.
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
 * 15. Backfill arkib — kumpul data NASA ke pangkalan data setempat secara berkala.
 *     APOD: tujuh tarikan satu-tarikh melalui getAPOD (retry + sandaran arkib sudah
 *     terbina dalam; laluan `count` sering hidang halaman rosak "NASA Science").
 *     NEO sehari + EPIC menyumbang baki koleksi. Ralat sehari diabaikan.
 */
async function backfillArchive() {
  const hasil = { apod: 0, asteroids: 0, epic: 0 };
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    try {
      const apod = await getAPOD({ date: d });
      if (apod && !apod.api_down && !apod.stale && store.getApod(d)) hasil.apod += 1;
    } catch { /* cuba hari seterusnya */ }
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

/** Jadual backfill: kali pertama lewat 20 saat (selepas boot), kemudian setiap 6 jam. */
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
  getSkyTonight,
  getExoplanets,
  getSentryRisk,
  getSatellites
};
