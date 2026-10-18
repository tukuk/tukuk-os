'use strict';
// ── TUKUK-OS WEATHER COMPLEX — OpenWeather API (tier PERCUMA sahaja) ──────────
// Endpoint guna: /data/2.5/weather (semasa), /data/2.5/forecast (5 hari/3 jam),
// /data/2.5/air_pollution (+ /forecast), /geo/1.0/direct (geokoding), dan jubin
// peta /map/{layer}/{z}/{x}/{y}.png?appid. Sejarah + OneCall = berbayar → dielak.
// Pelindung kuota: pemfailan >1x429 → breaker 15 minit; kiraan panggilan harian
// dipagari config.weather.dailyBudget — lebih bajet hanya hidang cache (stale).
const axios = require('axios');
const config = require('./config');

const http = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': 'TukukOS-Weather-Client/1.0 (+https://tukuk.org)' },
});

const cache = new Map();
const DEFAULT_TTL = 45 * 60 * 1000;

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) return { data: item.data, stale: true };
  return { data: item.data, stale: false };
}

function setCache(key, data, ttlMs = DEFAULT_TTL) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (cache.size > 400) {
    // Buang entri TAMAT TEMPOH paling lama supaya kota popular kekal panas.
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// ——— Kiraan bajet harian (UTC) + pemutus litar ———
let callDay = '';
let callCount = 0;
let breakerUntil = 0;

function budgetLeft() {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== callDay) { callDay = day; callCount = 0; }
  return Math.max(0, (config.weather.dailyBudget || 950) - callCount);
}

class WeatherDownError extends Error {}

async function owGet(pathname, params) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== callDay) { callDay = day; callCount = 0; }
  if (Date.now() < breakerUntil) throw new WeatherDownError('OpenWeather breaker aktif');
  if (callCount >= (config.weather.dailyBudget || 950)) throw new WeatherDownError('Bajet API harian habis');
  callCount += 1;
  const res = await http.get(`${config.weather.baseUrl}${pathname}`, {
    params: { ...params, appid: config.weather.apiKey, units: 'metric' },
  });
  return res.data;
}

function markBreaker(err) {
  const status = err && err.response && err.response.status;
  // 429 = had kadar; 401 = kunci tidak dibenarkan endpoint → rehat seketika
  if (status === 429 || status === 401 || status === 403) {
    breakerUntil = Date.now() + 15 * 60 * 1000;
  }
}

// ——— Data kota tetap (sumber slug yang boleh diramal + hab pautan) ———
// [slug, nama, cc, negara, lat, lon, featured(0/1)]
const CITY_ROWS = [
  // Malaysia — semua ibu negeri + bandar utama (Serian = kampung halaman ✦)
  ['serian', 'Serian', 'MY', 'Malaysia', 1.1333, 110.5667, 1],
  ['kuching', 'Kuching', 'MY', 'Malaysia', 1.58, 110.31, 1],
  ['sibu', 'Sibu', 'MY', 'Malaysia', 5.18, 111.82, 0],
  ['miri', 'Miri', 'MY', 'Malaysia', 4.42, 113.98, 0],
  ['sarikei', 'Sarikei', 'MY', 'Malaysia', 2.1, 111.52, 0],
  ['betong', 'Betong', 'MY', 'Malaysia', 2.5, 111.75, 0],
  ['limbang', 'Limbang', 'MY', 'Malaysia', 4.75, 115.0, 0],
  ['kota-kinabalu', 'Kota Kinabalu', 'MY', 'Malaysia', 5.975, 116.072, 1],
  ['sandakan', 'Sandakan', 'MY', 'Malaysia', 5.84, 117.9, 0],
  ['tawau', 'Tawau', 'MY', 'Malaysia', 4.25, 117.89, 0],
  ['labuan', 'Labuan', 'MY', 'Malaysia', 5.28, 115.24, 0],
  ['kuala-lumpur', 'Kuala Lumpur', 'MY', 'Malaysia', 3.139, 101.6869, 1],
  ['putrajaya', 'Putrajaya', 'MY', 'Malaysia', 2.925, 101.68, 0],
  ['shah-alam', 'Shah Alam', 'MY', 'Malaysia', 3.073, 101.5185, 0],
  ['johor-bahru', 'Johor Bahru', 'MY', 'Malaysia', 1.4927, 103.7414, 1],
  ['penang', 'George Town', 'MY', 'Malaysia', 5.414, 100.329, 1],
  ['ipoh', 'Ipoh', 'MY', 'Malaysia', 4.5975, 101.0901, 0],
  ['melaka', 'Melaka', 'MY', 'Malaysia', 2.196, 102.248, 0],
  ['kuantan', 'Kuantan', 'MY', 'Malaysia', 3.806, 103.328, 0],
  ['kota-bharu', 'Kota Bharu', 'MY', 'Malaysia', 6.125, 102.238, 0],
  ['kuala-terengganu', 'Kuala Terengganu', 'MY', 'Malaysia', 5.33, 103.14, 0],
  ['alor-setar', 'Alor Setar', 'MY', 'Malaysia', 6.117, 100.368, 0],
  ['langkawi', 'Langkawi', 'MY', 'Malaysia', 6.35, 99.8, 0],
  ['taiping', 'Taiping', 'MY', 'Malaysia', 4.85, 100.74, 0],
  // Asia
  ['singapore', 'Singapore', 'SG', 'Singapura', 1.2897, 103.8501, 1],
  ['jakarta', 'Jakarta', 'ID', 'Indonesia', -6.2088, 106.8456, 1],
  ['bandung', 'Bandung', 'ID', 'Indonesia', -6.9175, 107.6191, 0],
  ['surabaya', 'Surabaya', 'ID', 'Indonesia', -7.2575, 112.7521, 0],
  ['denpasar', 'Denpasar', 'ID', 'Indonesia', -8.6705, 115.2126, 0],
  ['manila', 'Manila', 'PH', 'Filipina', 14.5995, 120.9842, 1],
  ['cebu', 'Cebu City', 'PH', 'Filipina', 10.3157, 123.8854, 0],
  ['bangkok', 'Bangkok', 'TH', 'Thailand', 13.7563, 100.5018, 1],
  ['chiang-mai', 'Chiang Mai', 'TH', 'Thailand', 18.7883, 98.9853, 0],
  ['hanoi', 'Hanoi', 'VN', 'Vietnam', 21.0329, 105.854, 0],
  ['ho-chi-minh-city', 'Ho Chi Minh City', 'VN', 'Vietnam', 10.8231, 106.63, 0],
  ['phnom-penh', 'Phnom Penh', 'KH', 'Kemboja', 11.5564, 104.9282, 0],
  ['vientiane', 'Vientiane', 'LA', 'Laos', 17.9667, 102.6, 0],
  ['yangon', 'Yangon', 'MM', 'Myanmar', 16.8667, 96.1833, 0],
  ['tokyo', 'Tokyo', 'JP', 'Jepun', 35.6895, 139.6917, 1],
  ['osaka', 'Osaka', 'JP', 'Jepun', 34.6937, 135.5023, 0],
  ['seoul', 'Seoul', 'KR', 'Korea Selatan', 37.5665, 126.978, 1],
  ['taipei', 'Taipei', 'TW', 'Taiwan', 25.033, 121.5654, 0],
  ['hong-kong', 'Hong Kong', 'HK', 'Hong Kong', 22.3193, 114.1694, 0],
  ['shanghai', 'Shanghai', 'CN', 'China', 31.2304, 121.4737, 1],
  ['beijing', 'Beijing', 'CN', 'China', 39.9042, 116.4074, 0],
  ['new-delhi', 'New Delhi', 'IN', 'India', 28.6139, 77.209, 1],
  ['mumbai', 'Mumbai', 'IN', 'India', 19.076, 72.8777, 1],
  ['karachi', 'Karachi', 'PK', 'Pakistan', 24.8607, 67.0011, 0],
  ['dhaka', 'Dhaka', 'BD', 'Bangladesh', 23.8103, 90.4125, 0],
  ['colombo', 'Colombo', 'LK', 'Sri Lanka', 6.9271, 79.8612, 0],
  ['kathmandu', 'Kathmandu', 'NP', 'Nepal', 27.7172, 85.324, 0],
  // Timur Tengah & Mesir
  ['dubai', 'Dubai', 'AE', 'UEA', 25.2048, 55.2708, 1],
  ['abu-dhabi', 'Abu Dhabi', 'AE', 'UEA', 24.4539, 54.3773, 0],
  ['doha', 'Doha', 'QA', 'Qatar', 25.2854, 51.531, 0],
  ['riyadh', 'Riyadh', 'SA', 'Arab Saudi', 24.7136, 46.6753, 0],
  ['jeddah', 'Jeddah', 'SA', 'Arab Saudi', 21.4858, 39.1925, 0],
  ['makkah', 'Makkah', 'SA', 'Arab Saudi', 21.4225, 39.8262, 0],
  ['madinah', 'Madinah', 'SA', 'Arab Saudi', 24.5247, 39.5692, 0],
  ['istanbul', 'Istanbul', 'TR', 'Turkiye', 41.0082, 28.9784, 1],
  ['cairo', 'Cairo', 'EG', 'Mesir', 30.0444, 31.2357, 1],
  ['amman', 'Amman', 'JO', 'Jordan', 31.9539, 35.9106, 0],
  ['beirut', 'Beirut', 'LB', 'Lubnan', 33.8938, 35.5018, 0],
  ['baghdad', 'Baghdad', 'IQ', 'Iraq', 33.3152, 44.3661, 0],
  ['tehran', 'Tehran', 'IR', 'Iran', 35.6892, 51.389, 0],
  // Eropah
  ['london', 'London', 'GB', 'United Kingdom', 51.5074, -0.1278, 1],
  ['manchester', 'Manchester', 'GB', 'United Kingdom', 53.4808, -2.2426, 0],
  ['paris', 'Paris', 'FR', 'Perancis', 48.8566, 2.3522, 1],
  ['berlin', 'Berlin', 'DE', 'Jerman', 52.52, 13.405, 1],
  ['munich', 'Munich', 'DE', 'Jerman', 48.1351, 11.582, 0],
  ['madrid', 'Madrid', 'ES', 'Sepanyol', 40.4168, -3.7038, 0],
  ['barcelona', 'Barcelona', 'ES', 'Sepanyol', 41.3874, 2.1686, 0],
  ['rome', 'Rome', 'IT', 'Itali', 41.9028, 12.4964, 0],
  ['amsterdam', 'Amsterdam', 'NL', 'Belanda', 52.3676, 4.9041, 0],
  ['vienna', 'Vienna', 'AT', 'Austria', 48.2082, 16.3738, 0],
  ['zurich', 'Zurich', 'CH', 'Switzerland', 47.3769, 8.5417, 0],
  ['moscow', 'Moscow', 'RU', 'Rusia', 55.7558, 37.6173, 1],
  ['kyiv', 'Kyiv', 'UA', 'Ukraine', 50.4501, 30.5234, 0],
  ['warsaw', 'Warsaw', 'PL', 'Poland', 52.2297, 21.0122, 0],
  ['prague', 'Prague', 'CZ', 'Czech', 50.0755, 14.4378, 0],
  ['budapest', 'Budapest', 'HU', 'Hungary', 47.4979, 19.0402, 0],
  ['stockholm', 'Stockholm', 'SE', 'Sweden', 59.3293, 18.0686, 0],
  ['oslo', 'Oslo', 'NO', 'Norway', 59.9139, 10.7522, 0],
  ['copenhagen', 'Copenhagen', 'DK', 'Denmark', 55.6761, 12.5683, 0],
  ['helsinki', 'Helsinki', 'FI', 'Finland', 60.1699, 24.9384, 0],
  ['dublin', 'Dublin', 'IE', 'Ireland', 53.3498, -6.2603, 0],
  ['lisbon', 'Lisbon', 'PT', 'Portugal', 38.7223, -9.1393, 0],
  ['athens', 'Athens', 'GR', 'Greece', 37.9838, 23.7275, 0],
  ['belgrade', 'Belgrade', 'RS', 'Serbia', 44.7866, 20.4489, 0],
  // Amerika
  ['new-york', 'New York', 'US', 'Amerika Syarikat', 40.7128, -74.006, 1],
  ['los-angeles', 'Los Angeles', 'US', 'Amerika Syarikat', 34.0522, -118.2437, 1],
  ['chicago', 'Chicago', 'US', 'Amerika Syarikat', 41.8781, -87.6298, 0],
  ['houston', 'Houston', 'US', 'Amerika Syarikat', 29.7604, -95.3698, 0],
  ['miami', 'Miami', 'US', 'Amerika Syarikat', 25.7617, -80.1918, 0],
  ['washington', 'Washington DC', 'US', 'Amerika Syarikat', 38.9072, -77.0369, 0],
  ['honolulu', 'Honolulu', 'US', 'Amerika Syarikat', 21.3069, -157.8583, 0],
  ['toronto', 'Toronto', 'CA', 'Kanada', 43.6532, -79.3832, 1],
  ['vancouver', 'Vancouver', 'CA', 'Kanada', 49.2827, -123.1207, 0],
  ['montreal', 'Montreal', 'CA', 'Kanada', 45.5017, -73.5673, 0],
  ['mexico-city', 'Mexico City', 'MX', 'Mexico', 19.4326, -99.1332, 1],
  ['cancun', 'Cancun', 'MX', 'Mexico', 21.1619, -86.8515, 0],
  ['havana', 'Havana', 'CU', 'Cuba', 23.1136, -82.3666, 0],
  ['kingston', 'Kingston', 'JM', 'Jamaica', 17.977, -76.783, 0],
  ['bogota', 'Bogota', 'CO', 'Colombia', 4.711, -74.0721, 0],
  ['lima', 'Lima', 'PE', 'Peru', -12.0464, -77.0428, 0],
  ['caracas', 'Caracas', 'VE', 'Venezuela', 10.4806, -66.9036, 0],
  ['sao-paulo', 'Sao Paulo', 'BR', 'Brazil', -23.5505, -46.6333, 1],
  ['rio-de-janeiro', 'Rio de Janeiro', 'BR', 'Brazil', -22.9068, -43.1729, 1],
  ['brasilia', 'Brasilia', 'BR', 'Brazil', -15.7942, -47.8822, 0],
  ['buenos-aires', 'Buenos Aires', 'AR', 'Argentina', -34.6037, -58.3816, 0],
  ['santiago', 'Santiago', 'CL', 'Chile', -33.4489, -70.6693, 0],
  ['quito', 'Quito', 'EC', 'Ecuador', -0.1807, -78.4678, 0],
  ['la-paz', 'La Paz', 'BO', 'Bolivia', -16.4897, -68.1193, 0],
  // Afrika
  ['lagos', 'Lagos', 'NG', 'Nigeria', 6.5244, 3.3792, 1],
  ['abuja', 'Abuja', 'NG', 'Nigeria', 9.0765, 7.3986, 0],
  ['nairobi', 'Nairobi', 'KE', 'Kenya', -1.2921, 36.8219, 1],
  ['addis-ababa', 'Addis Ababa', 'ET', 'Ethiopia', 9.02, 38.7469, 0],
  ['dar-es-salaam', 'Dar es Salaam', 'TZ', 'Tanzania', -6.7924, 39.2083, 0],
  ['kampala', 'Kampala', 'UG', 'Uganda', 0.3476, 32.5825, 0],
  ['accra', 'Accra', 'GH', 'Ghana', 5.6037, -0.187, 0],
  ['dakar', 'Dakar', 'SN', 'Senegal', 14.7167, -17.4677, 0],
  ['casablanca', 'Casablanca', 'MA', 'Maghrib', 33.5731, -7.5898, 0],
  ['algiers', 'Algiers', 'DZ', 'Algeria', 36.7538, 3.0588, 0],
  ['tunis', 'Tunis', 'TN', 'Tunisia', 36.8065, 10.1815, 0],
  ['johannesburg', 'Johannesburg', 'ZA', 'Afrika Selatan', -26.2041, 28.0473, 1],
  ['cape-town', 'Cape Town', 'ZA', 'Afrika Selatan', -33.9249, 18.4241, 0],
  ['durban', 'Durban', 'ZA', 'Afrika Selatan', -29.8587, 31.0218, 0],
  ['maputo', 'Maputo', 'MZ', 'Mozambik', -25.9653, 32.5892, 0],
  ['antananarivo', 'Antananarivo', 'MG', 'Madagascar', -18.8792, 47.5079, 0],
  ['luanda', 'Luanda', 'AO', 'Angola', -8.839, 13.2894, 0],
  // Oceania & Pasifik
  ['sydney', 'Sydney', 'AU', 'Australia', -33.8688, 151.2093, 1],
  ['melbourne', 'Melbourne', 'AU', 'Australia', -37.8136, 144.9631, 1],
  ['brisbane', 'Brisbane', 'AU', 'Australia', -27.4698, 153.0251, 0],
  ['perth', 'Perth', 'AU', 'Australia', -31.9505, 115.8605, 0],
  ['adelaide', 'Adelaide', 'AU', 'Australia', -34.9285, 138.6007, 0],
  ['darwin', 'Darwin', 'AU', 'Australia', -12.4634, 130.8456, 0],
  ['auckland', 'Auckland', 'NZ', 'New Zealand', -36.8485, 174.7633, 1],
  ['wellington', 'Wellington', 'NZ', 'New Zealand', -41.2866, 174.7756, 0],
  ['christchurch', 'Christchurch', 'NZ', 'New Zealand', -43.5321, 172.6362, 0],
  ['nadi', 'Nadi', 'FJ', 'Fiji', -17.7765, 177.9661, 0],
  ['suva', 'Suva', 'FJ', 'Fiji', -18.1416, 178.4419, 0],
  ['port-moresby', 'Port Moresby', 'PG', 'Papua New Guinea', -9.4438, 147.1803, 0],
  ['honiara', 'Honiara', 'SB', 'Kepulauan Solomon', -9.4333, 159.95, 0],
];

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const CITIES = CITY_ROWS.map(([slug, name, cc, country, lat, lon, featured]) => ({
  slug: slugify(slug), name, cc, country, lat, lon, featured: featured === 1,
}));
const CITY_BY_SLUG = new Map(CITIES.map((c) => [c.slug, c]));

function findCity(slug) {
  return CITY_BY_SLUG.get(slugify(slug)) || null;
}

function featuredCities() {
  return CITIES.filter((c) => c.featured);
}

// Geokoding — sebarang nama bandar di dunia → halaman baharu. Cache 30 hari.
async function geocode(query) {
  const key = `geo:${slugify(query)}`;
  const hit = getCache(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const data = await owGet('/geo/1.0/direct', { q: String(query).slice(0, 80), limit: 1 });
    const r = Array.isArray(data) ? data[0] : null;
    if (!r) return hit ? hit.data : null;
    const city = {
      slug: slugify(r.name || query), name: r.name || String(query).slice(0, 60),
      cc: r.country || '', country: r.country || '', lat: r.lat, lon: r.lon, featured: false,
      admin1: Array.isArray(r.state) ? r.state.join(', ') : '',
    };
    setCache(key, city, 30 * 24 * 60 * 60 * 1000);
    return city;
  } catch (err) {
    markBreaker(err);
    return hit ? hit.data : null; // stale lebih baik daripada tiada
  }
}

// SLUG kota boleh jadi nama geokoding terdahulu — simpan hasil geokoding yang
// pernah berjaya supaya /cuaca/<slug> kekal laju & tak bazir API.
const geoSlugCache = new Map();
async function resolveCity(slug) {
  const known = findCity(slug);
  if (known) return known;
  const s = slugify(slug);
  if (geoSlugCache.has(s)) return geoSlugCache.get(s);
  const city = await geocode(s.replace(/-/g, ' '));
  if (city) {
    geoSlugCache.set(s, city);
    if (geoSlugCache.size > 500) geoSlugCache.delete(geoSlugCache.keys().next().value);
  }
  return city;
}

async function getCurrent(city) {
  const key = `cur:${city.slug}`;
  const hit = getCache(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const data = await owGet('/data/2.5/weather', { lat: city.lat, lon: city.lon });
    setCache(key, data, 45 * 60 * 1000);
    return data;
  } catch (err) {
    markBreaker(err);
    if (hit) return hit.data;
    throw err;
  }
}

async function getForecast(city) {
  const key = `fc:${city.slug}`;
  const hit = getCache(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const data = await owGet('/data/2.5/forecast', { lat: city.lat, lon: city.lon, cnt: 40 });
    setCache(key, data, 60 * 60 * 1000);
    return data;
  } catch (err) {
    markBreaker(err);
    if (hit) return hit.data;
    throw err;
  }
}

async function getAir(city) {
  const key = `air:${city.slug}`;
  const hit = getCache(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const data = await owGet('/data/2.5/air_pollution', { lat: city.lat, lon: city.lon });
    setCache(key, data, 60 * 60 * 1000);
    return data;
  } catch (err) {
    markBreaker(err);
    if (hit) return hit.data;
    throw err;
  }
}

async function getAirForecast(city) {
  const key = `airfc:${city.slug}`;
  const hit = getCache(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const data = await owGet('/data/2.5/air_pollution/forecast', { lat: city.lat, lon: city.lon });
    setCache(key, data, 12 * 60 * 60 * 1000);
    return data;
  } catch (err) {
    markBreaker(err);
    if (hit) return hit.data;
    throw err;
  }
}

// Snapshot kota featured untuk hab + ekstrem (sejam sahaja; muatan paralel).
let snapshotCache = null;
let snapshotAt = 0;
async function getFeaturedSnapshot() {
  if (snapshotCache && Date.now() - snapshotAt < 60 * 60 * 1000) return snapshotCache;
  const list = await Promise.all(featuredCities().map(async (city) => {
    try {
      const cur = await getCurrent(city);
      return { city, cur };
    } catch {
      return null;
    }
  }));
  const ok = list.filter(Boolean);
  if (ok.length >= 6) { snapshotCache = ok; snapshotAt = Date.now(); }
  return snapshotCache || ok;
}

// ——— Kod keadaan OpenWeather → label Melayu + emoji (untuk halaman /cuaca/kod) ———
// [id, en, ms, emoji]
const OW_CODE_ROWS = [
  [200, 'thunderstorm with light rain', 'ribut petir dengan hujan ringan', '\u26C8\uFE0F'],
  [201, 'thunderstorm with rain', 'ribut petir dengan hujan', '\u26C8\uFE0F'],
  [202, 'thunderstorm with heavy rain', 'ribut petir dengan hujan lebat', '\u26C8\uFE0F'],
  [210, 'light thunderstorm', 'ribut petir ringan', '\u26C8\uFE0F'],
  [211, 'thunderstorm', 'ribut petir', '\u26C8\uFE0F'],
  [212, 'heavy thunderstorm', 'ribut petir kencang', '\u26C8\uFE0F'],
  [221, 'ragged thunderstorm', 'ribut petir berselang-seli', '\u26C8\uFE0F'],
  [230, 'thunderstorm with light drizzle', 'ribut dengan renyai ringan', '\u26C8\uFE0F'],
  [231, 'thunderstorm with drizzle', 'ribut dengan renyai', '\u26C8\uFE0F'],
  [232, 'thunderstorm with heavy drizzle', 'ribut dengan renyai lebat', '\u26C8\uFE0F'],
  [300, 'light intensity drizzle', 'renyai ringan', '\uD83C\uDF26\uFE0F'],
  [301, 'drizzle', 'renyai', '\uD83C\uDF26\uFE0F'],
  [302, 'heavy intensity drizzle', 'renyai lebat', '\uD83C\uDF26\uFE0F'],
  [310, 'light intensity shower rain', 'hujan renyai ringan', '\uD83C\uDF27\uFE0F'],
  [311, 'shower rain', 'hujan renyai', '\uD83C\uDF27\uFE0F'],
  [312, 'heavy intensity shower rain', 'hujan renyai lebat', '\uD83C\uDF27\uFE0F'],
  [313, 'shower rain and thunder', 'hujan renyai + ribut', '\u26C8\uFE0F'],
  [314, 'shower rain and heavy thunder', 'hujan renyai + ribut kencang', '\u26C8\uFE0F'],
  [321, 'shower snow', 'renyai salji', '\uD83C\uDF28\uFE0F'],
  [500, 'light rain', 'hujan ringan', '\uD83C\uDF27\uFE0F'],
  [501, 'moderate rain', 'hujan sederhana', '\uD83C\uDF27\uFE0F'],
  [502, 'heavy intensity rain', 'hujan lebat', '\uD83C\uDF27\uFE0F'],
  [503, 'very heavy rain', 'hujan sangat lebat', '\uD83C\uDF27\uFE0F'],
  [504, 'extreme rain', 'hujan ekstrem', '\uD83C\uDF27\uFE0F'],
  [511, 'freezing rain', 'hujan beku', '\u2744\uFE0F'],
  [520, 'light intensity shower rain', 'hujan renyai ringkas', '\uD83C\uDF27\uFE0F'],
  [521, 'shower rain', 'hujan renyai petir singkat', '\uD83C\uDF27\uFE0F'],
  [522, 'shower rain with hail', 'hujan renyai + graupel', '\uD83C\uDF27\uFE0F'],
  [531, 'complex shower rain', 'hujan renyai kompleks', '\uD83C\uDF27\uFE0F'],
  [600, 'light snow', 'salji ringan', '\uD83C\uDF28\uFE0F'],
  [601, 'snow', 'salji', '\uD83C\uDF28\uFE0F'],
  [602, 'heavy snow', 'salji lebat', '\uD83C\uDF28\uFE0F'],
  [611, 'sleet', 'hujan salji bercampur', '\uD83C\uDF28\uFE0F'],
  [612, 'light shower sleet', 'sleet renyai ringan', '\uD83C\uDF28\uFE0F'],
  [613, 'shower sleet', 'sleet renyai', '\uD83C\uDF28\uFE0F'],
  [616, 'rain and snow mixed', 'hujan bercampur salji', '\uD83C\uDF28\uFE0F'],
  [620, 'light shower snow', 'salji renyai ringan', '\uD83C\uDF28\uFE0F'],
  [621, 'shower snow', 'salji renyai', '\uD83C\uDF28\uFE0F'],
  [622, 'heavy shower snow', 'salji renyai lebat', '\uD83C\uDF28\uFE0F'],
  [701, 'mist', 'jelaga nipis', '\uD83C\uDF2B\uFE0F'],
  [711, 'smoke', 'asap', '\uD83D\uDEA1'],
  [721, 'haze', 'jerebu', '\uD83C\uDF2B\uFE0F'],
  [731, 'sand/dust whirls', 'pusaran pasir/debu', '\uD83C\uDF2A\uFE0F'],
  [741, 'fog', 'kabus tebal', '\uD83C\uDF2B\uFE0F'],
  [751, 'sand', 'pasir terbang', '\uD83C\uDFDC\uFE0F'],
  [761, 'dust', 'debu', '\uD83C\uDFDC\uFE0F'],
  [762, 'volcanic ash', 'abu gunung berapi', '\uD83C\uDF0B'],
  [771, 'squalls', 'angin kuat tiba-tiba', '\uD83D\uDCA8'],
  [781, 'tornado', 'tornado', '\uD83C\uDF00'],
  [800, 'clear sky', 'cerah', '\u2600\uFE0F'],
  [801, 'few clouds', 'awan sedikit', '\uD83C\uDF24\uFE0F'],
  [802, 'scattered clouds', 'awan bertaburan', '\u26C5\uFE0F'],
  [803, 'broken clouds', 'awan pecah', '\u26C5\uFE0F'],
  [804, 'overcast clouds', 'awan penuh', '\u2601\uFE0F'],
];
const OW_CODES = OW_CODE_ROWS.map(([id, en, ms, emoji]) => ({ id, en, ms, emoji }));
const CODE_BY_ID = new Map(OW_CODES.map((c) => [c.id, c]));

function describe(codeId, isNight) {
  const c = CODE_BY_ID.get(Number(codeId)) || null;
  if (!c) return { ms: 'keadaan langit berubah-ubah', emoji: '\uD83C\uDF21\uFE0F', en: 'variable' };
  let emoji = c.emoji;
  if (c.id === 800) emoji = isNight ? '\uD83C\uDF19' : '\u2600\uFE0F';
  if (c.id === 801 || c.id === 802) emoji = isNight ? '\uD83C\uDF19' : emoji;
  return { ms: c.ms, en: c.en, emoji };
}

// Skala Beaufort (0–12) — untuk halaman /cuaca/angin + label kelajuan angin.
const BEAUFORT = [
  [0, '< 1', 'Angan-angan', 'Asap naik tegak; daun tidak berganjak'],
  [1, '1–5', 'Angin lemah', 'Arah angin hanya diketahui melalui asap'],
  [2, '6–11', 'Angin ringan', 'Daun dan anak dahan bergoyang'],
  [3, '12–19', 'Angin sederhana', 'Dahan kecil bergerak, bendera mula terkibar'],
  [4, '20–28', 'Angin bertenaga', 'Debu dan kertas terbang; dahan tipis bergoyang'],
  [5, '29–38', 'Angin kencang', 'Dahan sederhana bergerak; buih ombak'],
  [6, '39–49', 'Kencang sangat', 'Dahan besar bergoyang; sukar memakai payung'],
  [7, '50–61', 'Ribut kecil', 'Pohon seluruhnya bergoyang; sukar berjalan menentang angin'],
  [8, '62–74', 'Ribut', 'Ranting patah; penutup bumbung tercabut'],
  [9, '75–88', 'Ribut kuat', 'Pohon tersedak; kerosakan bangunan sederhana'],
  [10, '89–102', 'Ribut sangat kuat', 'Pohon tumbang; binaaan rosak serius'],
  [11, '103–112', 'Badai', 'Kerosakan meluas di kawasan penduduk'],
  [12, '> 112', 'Badai luar biasa', 'Kemusnahan menyeluruh; gelombang laut luar biasa'],
];

function beaufort(kmh) {
  const v = Number(kmh) || 0;
  for (const b of BEAUFORT) {
    const range = b[1].replace('>', '').split('\u2013').map((x) => parseInt(x, 10));
    const lo = Number.isFinite(range[0]) ? range[0] : 0;
    const hi = Number.isFinite(range[1]) ? range[1] : Infinity;
    if (b[0] === 0 && v <= 1) return b;
    if (v >= lo && v <= hi && b[0] !== 0) return b;
  }
  return BEAUFORT[12];
}

// Jalur AQI OpenWeather (1–5) — panduan kesihatan berbahasa Melayu.
const AQI_BANDS = [
  { n: 1, label: 'Baik', color: '#2ecc71', advice: 'Udara bersih — sesuai untuk semua aktiviti luar, termasuk senaman dan jogging.' },
  { n: 2, label: 'Sederhana', color: '#a2d94e', advice: 'Boleh diterima. Golongan sangat sensitif (asma, jantung) mungkin rasa sedikit gangguan.' },
  { n: 3, label: 'Tidak sihat untuk golongan sensitif', color: '#f1c40f', advice: 'Pesakit asma/jantung dan kanak-kanak patut kurangkan aktiviti luar yang berpanjangan.' },
  { n: 4, label: 'Tidak sihat', color: '#e67e22', advice: 'Semua orang patut hadkan masa luar; pakai pelindung PM2.5 jika perlu.' },
  { n: 5, label: 'Sangat tidak sihat', color: '#e74c3c', advice: 'Elakkan aktiviti luar. Tutup tingkap; guna penapis udara jika ada.' },
];

function aqiBand(n) {
  return AQI_BANDS[Math.min(Math.max((Number(n) || 1) - 1, 0), 4)];
}

// Cuaca harian → nasihat bersiap (unik setiap halaman kota).
function cityAdvice(cur, air) {
  const w = (cur && cur.weather && cur.weather[0]) || {};
  const id = Number(w.id) || 800;
  const temp = Number(cur && cur.main && cur.main.temp) || 25;
  const out = [];
  if (id >= 200 && id < 300) out.push('Bawa payung dan elakkan tempat terbuka semasa ribut petir — kilat paling bahaya 30 minit sebelum dan selepas guruh.');
  else if (id >= 300 && id < 600) out.push('Bawa payung dan sandal — jalan basah bermakna jarak membrek bertambah; brek awal di permukaan licin.');
  else if (id >= 600) out.push('Cuaca beku/salji: pakai pakaian berlapis, sarung tangan dan kasut bercekam.');
  else if (id >= 700 && id < 800) out.push('Jarak nampak rendah (kabus/jerebu): guna lampu rendah, perlahanankan kenderaan; kurangkan aktiviti luar berat jika anda ada masalah salur nafas.');
  else if (temp >= 34) out.push('Cuaca terik: minum air sebelum dahaga, elakkan matahari 12–3 tengah hari, pakai topi & pelindung suria SPF.');
  else if (temp <= 5) out.push('Cuaca sejuk: pakai pakaian berlapis dan lindungi hujung jari/telinga.');
  else out.push('Langit menyeronokkan untuk aktiviti luar — sesuai untuk fotografi waktu keemasan dan berkelah petang.');
  const wind = Number(cur && cur.wind && cur.wind.speed) || 0;
  if (wind >= 10.8) out.push(`Angin ${Math.round(wind * 3.6)} km/j — ikat barang terpacak di halaman dan beri perhatian kepada penunggang motosikal.`);
  if (air && air.list && air.list[0]) {
    const aqi = Number(air.list[0].main && air.list[0].main.aqi) || 1;
    if (aqi >= 4) out.push('Indeks udara pada jalur tidak sihat — kurangkan masa luar dan pantau kanak-kanak serta warga emas.');
  }
  return out;
}

function tileTemplateUrl(layer) {
  return `${config.weather.tileBase}/${layer}/{z}/{x}/{y}.png?appid=${config.weather.apiKey}`;
}

module.exports = {
  CITIES,
  featuredCities,
  findCity,
  resolveCity,
  geocode,
  getCurrent,
  getForecast,
  getAir,
  getAirForecast,
  getFeaturedSnapshot,
  OW_CODES,
  describe,
  BEAUFORT,
  beaufort,
  AQI_BANDS,
  aqiBand,
  cityAdvice,
  tileTemplateUrl,
  slugify,
  budgetLeft,
  WeatherDownError,
};
