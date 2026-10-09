/**
 * media-search.js — Carian imej dan video web.
 *
 * Sumber utama (disokong dari pelayan ini):
 *   1. Imej : Bing Images  (parse atribut m="…murl…")
 *   2. Video: YouTube      (parse ytInitialData → videoRenderer)
 *
 * Fallback: carian web biasa, kemudian cari URL imej / pautan
 * platform video dalam keputusan tersebut.
 */

const https = require('https');
const http = require('http');
const config = require('../config');
const websearch = require('./websearch');

const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function request(url, ua, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      timeout: timeoutMs || config.websearch.timeout,
      headers: {
        'User-Agent': ua || config.websearch.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function cacheKey(type, query) {
  return `${type}:${query.toLowerCase().trim()}`;
}

function cacheGet(type, query) {
  const entry = CACHE.get(cacheKey(type, query));
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL) {
    CACHE.delete(cacheKey(type, query));
    return null;
  }
  return entry.value;
}

function cacheSet(type, query, value) {
  CACHE.set(cacheKey(type, query), { at: Date.now(), value });
}

function decodeAttr(str) {
  return String(str)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function extractImageUrls(text) {
  const urls = [];
  const regex = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s"'<>]*)?/gi;
  let match;
  while ((match = regex.exec(text)) !== null && urls.length < config.websearch.maxResults) {
    const url = match[0];
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function extractVideoUrls(text) {
  const platforms = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'bilibili.com'];
  const urls = [];
  const regex = /https?:\/\/[^\s"'<>]+/gi;
  let match;
  while ((match = regex.exec(text)) !== null && urls.length < config.websearch.maxResults) {
    const url = match[0];
    if (platforms.some((p) => url.includes(p)) && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
}

/* ---------- Sumber utama: Bing Images (sokong paging) ---------- */
const BING_PAGE_SIZE = 35;

async function searchImagesBing(query, page = 1) {
  const first = (Math.max(1, page) - 1) * BING_PAGE_SIZE + 1;
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=${first}&count=${BING_PAGE_SIZE}`;
  const { status, body } = await request(url, BROWSER_UA);
  if (status !== 200 || !body) return [];

  const limit = Math.max(config.websearch.maxResults, 36);
  const hits = [];
  const seen = new Set();
  const attrRe = /\sm="([^"]+)"/g;
  let m;
  while ((m = attrRe.exec(body)) !== null && hits.length < limit) {
    let data;
    try { data = JSON.parse(decodeAttr(m[1])); } catch { continue; }
    if (!data || !data.murl) continue;
    const image = data.murl;
    if (!image || seen.has(image)) continue;
    seen.add(image);
    const pageUrl = data.purl && /^https?:\/\//.test(data.purl) ? data.purl : image;
    hits.push({
      type: 'image',
      title: data.t || `${query} — image ${hits.length + 1}`,
      url: pageUrl,
      image,
      thumbnail: data.turl || image,
      width: data.w || 0,
      height: data.h || 0,
      source: hostOf(pageUrl),
      description: `Image result for "${query}".`
    });
  }
  return hits;
}

/* ---------- Sumber utama: YouTube ---------- */
function walkJson(node, key, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const v of node) walkJson(v, key, out);
    return;
  }
  if (node[key]) out.push(node[key]);
  for (const v of Object.values(node)) walkJson(v, key, out);
}

async function searchVideosYouTube(query, sp = '') {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${sp ? `&sp=${encodeURIComponent(sp)}` : ''}`;
  const { status, body } = await request(url, BROWSER_UA);
  if (status !== 200 || !body) return { hits: [], nextSp: '' };

  const m = body.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return { hits: [], nextSp: '' };

  let data;
  try { data = JSON.parse(m[1]); } catch { return { hits: [], nextSp: '' }; }

  const renderers = [];
  walkJson(data, 'videoRenderer', renderers);
  const compact = [];
  walkJson(data, 'compactVideoRenderer', compact);

  // Token sambungan untuk halaman seterusnya
  let nextSp = '';
  const conts = [];
  walkJson(data, 'continuationItemRenderer', conts);
  for (const c of conts) {
    const token = c?.continuationCommand?.token || c?.continuationEndpoint?.continuationCommand?.token;
    if (token) { nextSp = token; break; }
  }

  const limit = Math.max(config.websearch.maxResults, 36);
  const hits = [];
  const seenIds = new Set();
  for (const v of [...renderers, ...compact]) {
    if (hits.length >= limit) break;
    if (v.videoId && seenIds.has(v.videoId)) continue;
    if (v.videoId) seenIds.add(v.videoId);
    const id = v.videoId;
    if (!id) continue;
    const title = (v.title && ((v.title.runs || []).map(r => r.text).join('') || v.title.simpleText)) || '';
    if (!title) continue;
    const channel = (v.ownerText && (v.ownerText.runs || []).map(r => r.text).join('')) || '';
    const views = (v.viewCountText && (v.viewCountText.simpleText || (v.shortViewCountText || {}).simpleText)) || '';
    const length = (v.lengthText && v.lengthText.simpleText) || '';
    hits.push({
      type: 'video',
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      channel,
      views,
      length,
      source: 'youtube.com',
      description: [channel, views, length].filter(Boolean).join(' · ')
    });
  }
  return { hits, nextSp };
}

async function searchImages(query, { page = 1 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { hits: [], total: 0, query: q, page: 1 };

  const cacheKeyPage = `image:${q}:p${page}`;
  const cached = CACHE.get(cacheKeyPage);
  if (cached && Date.now() - cached.at <= CACHE_TTL) return cached.value;

  try {
    const hits = await searchImagesBing(q, page);
    if (hits.length) {
      const result = {
        hits, total: hits.length, query: q, provider: 'bing', page,
        nextPage: hits.length >= 20 ? page + 1 : 0
      };
      // Keputusan lemah (respons separuh siap) tidak disimpan supaya boleh dicuba semula
      if (hits.length >= 5) CACHE.set(cacheKeyPage, { at: Date.now(), value: result });
      return result;
    }
    if (page > 1) return { hits: [], total: 0, query: q, page, nextPage: 0 };
  } catch { /* jatuh ke fallback */ }

  // Fallback: carian web + cari URL imej dalam ringkasan.
  try {
    const webResults = await websearch.search(q);
    const imageUrls = extractImageUrls(webResults.hits.map((h) => `${h.title} ${h.description}`).join(' '));

    const hits = imageUrls.map((url, position) => ({
      type: 'image',
      title: `${q} — imej ${position + 1}`,
      url,
      thumbnail: url,
      image: url,
      source: hostOf(url),
      description: `Imej untuk "${q}" dari carian web.`
    }));

    const result = { hits, total: hits.length, query: q, provider: webResults.provider || 'web' };
    cacheSet('image', q, result);
    return result;
  } catch {
    return { hits: [], total: 0, query: q };
  }
}

async function searchVideos(query, { sp = '' } = {}) {
  const q = String(query || '').trim();
  if (!q) return { hits: [], total: 0, query: q, nextSp: '' };

  const cacheKeyVideo = `video:${q}:${sp || 'p1'}`;
  const cachedV = CACHE.get(cacheKeyVideo);
  if (cachedV && Date.now() - cachedV.at <= CACHE_TTL) return cachedV.value;

  try {
    const { hits, nextSp } = await searchVideosYouTube(q, sp);
    if (hits.length) {
      const result = { hits, total: hits.length, query: q, provider: 'youtube', nextSp };
      if (hits.length >= 3) CACHE.set(cacheKeyVideo, { at: Date.now(), value: result });
      return result;
    }
    if (sp) return { hits: [], total: 0, query: q, nextSp: '' };
  } catch { /* jatuh ke fallback */ }

  // Fallback: carian web + cari pautan platform video.
  try {
    const webResults = await websearch.search(q);
    const videoUrls = extractVideoUrls(webResults.hits.map((h) => `${h.title} ${h.description} ${h.url}`).join(' '));

    const hits = videoUrls.map((url, position) => ({
      type: 'video',
      title: `${q} — video ${position + 1}`,
      url,
      thumbnail: '',
      source: hostOf(url),
      description: `Video untuk "${q}" dari carian web.`
    }));

    const result = { hits, total: hits.length, query: q, provider: webResults.provider || 'web' };
    cacheSet('video', q, result);
    return result;
  } catch {
    return { hits: [], total: 0, query: q };
  }
}


/* ---------- Muzik: iTunes Search API (Apple, rasmi, tanpa kunci) ---------- */
async function fetchJson(url) {
  const { status, body } = await request(url, BROWSER_UA, 8000);
  if (status !== 200 || !body) throw new Error(`HTTP ${status}`);
  return JSON.parse(body);
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function searchMusicItunes(q, offset = 0) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=40&offset=${offset}`;
  const data = await fetchJson(url);
  const hits = (data.results || []).map((r) => ({
    type: 'music',
    title: r.trackName || r.collectionName || q,
    artist: r.artistName || '',
    album: r.collectionName || '',
    artwork: String(r.artworkUrl100 || '').replace('100x100bb', '400x400bb'),
    preview: r.previewUrl || '',
    duration: fmtDuration(r.trackTimeMillis),
    url: r.trackViewUrl || r.collectionViewUrl || '',
    source: 'itunes.apple.com',
    description: [r.artistName, r.collectionName].filter(Boolean).join(' \u00b7 ')
  })).filter((h) => h.title);
  const nextOffset = data.resultCount === 40 ? offset + 40 : 0;
  return { hits, nextOffset };
}

/* ---------- Radio: Radio Browser API (komuniti, tanpa kunci) ---------- */
const RADIO_BASES = ['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];

async function fetchRadioJson(path) {
  let data = null;
  for (let round = 0; round < 2 && !Array.isArray(data); round++) {
    for (const base of RADIO_BASES) {
      try { data = await fetchJson(base + path); break; } catch { /* cuba cermin seterusnya */ }
    }
    if (!Array.isArray(data) && round === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return data;
}

// q = nama, country = nama penuh negara, tag = genre. Semua ini filter radio-browser.
async function searchRadioStations(q, skip = 0, { country = '', tag = '' } = {}) {
  let path;
  if (tag || country) {
    const params = new URLSearchParams({ hidebroken: 'true', is_https: 'true', limit: '40', offset: String(skip), order: 'clickcount', reverse: 'true' });
    if (tag) params.set('tag_exact', tag.toLowerCase());
    if (country) params.set('country', country);
    if (q) params.set('name', q);
    path = `/json/stations/search?${params}`;
  } else if (q) {
    path = `/json/stations/search?name=${encodeURIComponent(q)}&is_https=true&hidebroken=true&order=votes&reverse=true&limit=40&skip=${skip}`;
  } else {
    path = `/json/stations/topvote/40?is_https=true&hidebroken=true&offset=${skip}`;
  }
  const data = await fetchRadioJson(path);
  if (!Array.isArray(data)) throw new Error('radio-browser tidak dapat dihubungi');
  const hits = data.map((s) => ({
    type: 'radio',
    title: s.name || 'Radio',
    url: s.url_resolved || s.url || '',
    favicon: /^https:\/\//.test(s.favicon || '') ? s.favicon : '',
    country: s.country || '',
    codec: s.codec || '',
    bitrate: s.bitrate || 0,
    tags: String(s.tags || '').split(',').filter(Boolean).slice(0, 3),
    votes: s.votes || 0,
    source: 'radio-browser.info',
    description: [s.country, s.codec, s.bitrate ? `${s.bitrate} kbps` : ''].filter(Boolean).join(' \u00b7 ')
  })).filter((h) => h.url);
  const nextSkip = data.length === 40 ? skip + 40 : 0;
  return { hits, nextSkip };
}

// Senarai negara (untuk pemilih "semua radio di dunia"). Di-cache sehari.
async function listRadioCountries() {
  const cached = CACHE.get('radio:countries');
  if (cached && Date.now() - cached.at <= 24 * 3600 * 1000) return cached.value;
  const data = await fetchRadioJson('/json/countries?hidebroken=true&order=stationcount&reverse=true');
  const list = Array.isArray(data)
    ? data
        .filter((c) => c && (c.name || c.country))
        .map((c) => ({ name: c.name || c.country, code: c.iso_3166_1 || c.countrycode || '', count: c.stationcount || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 250)
    : [];
  if (list.length) CACHE.set('radio:countries', { at: Date.now(), value: list });
  return list;
}

const FALLBACK_STATIONS = [
  { type: 'radio', title: 'BBC World Service', url: 'https://stream.live.vc.bbcwebcast.co.uk/bbc_world_service', country: 'United Kingdom', codec: 'MP3', bitrate: 128, tags: ['news', 'global', 'talk'], description: 'United Kingdom · MP3 · 128 kbps · news, global' },
  { type: 'radio', title: 'Jazz Radio', url: 'https://jazz-webradio.net/jazz', country: 'France', codec: 'MP3', bitrate: 192, tags: ['jazz', 'smooth', 'classic'], description: 'France · MP3 · 192 kbps · jazz, smooth' },
  { type: 'radio', title: 'Classical Piano', url: 'https://stream.classicalradio.com/classical_piano', country: 'United States', codec: 'MP3', bitrate: 128, tags: ['classical', 'piano', 'relax'], description: 'United States · MP3 · 128 kbps · classical, piano' },
  { type: 'radio', title: 'Ambient Sleeping Pill', url: 'https://radiostream.ambientsleepingpill.com/stream', country: 'Sweden', codec: 'OGG', bitrate: 96, tags: ['ambient', 'chill', 'sleep'], description: 'Sweden · OGG · 96 kbps · ambient, chill' },
  { type: 'radio', title: 'Electronic Dance Experience', url: 'https://hd.clubbersradio.com/live.mp3', country: 'Germany', codec: 'MP3', bitrate: 320, tags: ['edm', 'dance', 'club'], description: 'Germany · MP3 · 320 kbps · edm, dance' },
  { type: 'radio', title: 'Smooth Lounge', url: 'https://lounge.stream.popradiodigital.com/lounge.mp3', country: 'Italy', codec: 'MP3', bitrate: 192, tags: ['lounge', 'chillout', 'jazz'], description: 'Italy · MP3 · 192 kbps · lounge, chill' }
];

const FALLBACK_MUSIC = [
  { type: 'music', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/7b/0a/61/7b0a6125-f481-f2f6-3c22-b4c6e1c26b20/20UMGIM08914.rgb.jpg/400x400bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/c3/86/e8/c386e828-5a02-5339-16e7-142b94f1be0e/mza_10795551221764654065.128.m4a', duration: '3:20', url: 'https://music.apple.com', description: 'The Weeknd · After Hours' },
  { type: 'music', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷', artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/65/1c/3e/651c3e38-6b87-2856-b049-598bc6cd1120/00602557434771.rgb.jpg/400x400bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/21/51/9d/21519d0a-9d97-3932-5a44-884812a64c57/mza_7223048037168864756.128.m4a', duration: '3:53', url: 'https://music.apple.com', description: 'Ed Sheeran · ÷' },
  { type: 'music', title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/91/b6/4f/91b64f43-410a-3a56-829d-4729f63567df/20UMGIM10787.rgb.jpg/400x400bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/d5/4b/32/d54b321a-e9fa-f273-02f8-06a1c8f41334/mza_16386375089312686161.128.m4a', duration: '3:23', url: 'https://music.apple.com', description: 'Dua Lipa · Future Nostalgia' },
  { type: 'music', title: 'Starboy', artist: 'The Weeknd ft. Daft Punk', album: 'Starboy', artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/71/66/9e/71669e26-2582-7e87-0b1a-289568936997/16UMGIM36766.rgb.jpg/400x400bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/2a/3b/bc/2a3bbc8e-7e90-c1e4-3996-276941604a11/mza_9519139049443573887.128.m4a', duration: '3:50', url: 'https://music.apple.com', description: 'The Weeknd · Starboy' },
  { type: 'music', title: 'Bad Guy', artist: 'Billie Eilish', album: 'When We All Fall Asleep, Where Do We Go?', artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/a5/d5/08/a5d508e6-993d-425b-2a62-63b782987114/19UMGIM03058.rgb.jpg/400x400bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/8b/6e/f8/8b6ef844-3d12-1f7c-54a7-02058ea8d867/mza_4812304958046714088.128.m4a', duration: '3:14', url: 'https://music.apple.com', description: 'Billie Eilish · When We All Fall Asleep' },
  { type: 'music', title: 'As It Was', artist: 'Harry Styles', album: "Harry's House", artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/4a/1c/29/4a1c29e6-0be6-f368-e56d-e089201a0709/22UMGIM26786.rgb.jpg/400x400bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview112/v4/c7/2b/9d/c72b9dc9-e48f-cd32-58e1-512595f9c470/mza_10332851443657757049.128.m4a', duration: '2:47', url: 'https://music.apple.com', description: "Harry Styles · Harry's House" }
];

async function searchMusic(query, { offset = 0 } = {}) {
  const q = String(query || '').trim();
  const key = `music:${q}:${offset}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at <= CACHE_TTL) return cached.value;

  let hits = [];
  let nextOffset = 0;
  try {
    const res = await searchMusicItunes(q || 'pop', offset);
    hits = res.hits;
    nextOffset = res.nextOffset;
  } catch {
    hits = FALLBACK_MUSIC.filter(m => !q || m.title.toLowerCase().includes(q.toLowerCase()) || m.artist.toLowerCase().includes(q.toLowerCase()));
  }

  if (!hits || hits.length === 0) {
    hits = FALLBACK_MUSIC;
  }

  const result = { hits, total: hits.length, query: q, provider: 'itunes/fallback', nextOffset };
  if (hits.length >= 3) CACHE.set(key, { at: Date.now(), value: result });
  return result;
}

async function searchRadio(query, { skip = 0, country = '', tag = '' } = {}) {
  const q = String(query || '').trim();
  const key = `radio:${q}:${country}:${tag}:${skip}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at <= CACHE_TTL) return cached.value;

  let hits = [];
  let nextSkip = 0;
  try {
    const res = await searchRadioStations(q, skip, { country, tag });
    hits = res.hits;
    nextSkip = res.nextSkip;
  } catch {
    hits = FALLBACK_STATIONS.filter(s => !q || s.title.toLowerCase().includes(q.toLowerCase()) || s.tags.some(t => t.toLowerCase().includes(q.toLowerCase())));
  }

  if (!hits || hits.length === 0) {
    hits = FALLBACK_STATIONS;
  }

  const result = { hits, total: hits.length, query: q, country, tag, provider: 'radio-browser/fallback', nextSkip };
  if (hits.length >= 3) CACHE.set(key, { at: Date.now(), value: result });
  return result;
}

module.exports = { searchImages, searchVideos, searchMusic, searchRadio, listRadioCountries };
