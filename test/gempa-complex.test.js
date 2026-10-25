'use strict';
// Earthquake Complex invariants: keyless USGS feed + 7 English sections + sitemap-earthquakes + cross links.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const gempaSrc = fs.readFileSync(path.join(ROOT, 'src', 'gempa.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/earthquakes', '/earthquakes/malaysia', '/earthquakes/southeast-asia', '/earthquakes/japan',
  '/earthquakes/east-pacific', '/earthquakes/world', '/earthquakes/explained'];

test('GEMPA_SECTIONS + REGIONS list 7 sections (6 regions + explanation)', () => {
  for (const p of SECTIONS) assert.ok(serverSrc.includes(`'${p}'`), `section ${p} present in the nav`);
  assert.match(gempaSrc, /slug: 'malaysia'/, 'the malaysia region is defined in the module');
  assert.match(gempaSrc, /slug: 'world'/, 'the world feed is defined');
});

test('the quake renderers are defined and wrapped through gempaDoc (3 slots + nav + lang en)', () => {
  for (const fn of ['gempaHubPage', 'gempaRegionPage', 'gempaExplainPage', 'gempaDoc', 'gempaNav', 'gempaBusy']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} is defined`);
  }
  const idx = serverSrc.indexOf('function gempaDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) assert.ok(doc.includes(slot), `gempaDoc renders ${slot}`);
  assert.ok(doc.includes('gempaNav()'), 'gempaDoc embeds the earthquake nav (hub links)');
  assert.ok(doc.includes('<html lang="en">'), 'quake pages are lang="en"');
});

test('the /earthquakes* routes register in order: hub, literal explanation, then :region', () => {
  const hub = serverSrc.indexOf("app.get('/earthquakes'");
  const pen = serverSrc.indexOf("app.get('/earthquakes/explained'");
  const reg = serverSrc.indexOf("app.get('/earthquakes/:region'");
  assert.ok(hub > -1 && pen > hub && reg > pen, 'registration order: /earthquakes < explained < :region');
  assert.match(serverSrc, /gp\.findRegion\(req\.params\.region\)/, 'the region slug is validated INSIDE the handler (no TDZ)');
  assert.doesNotMatch(serverSrc, /for \(const r of gp\.REGIONS\)\s*app\.get/, 'looping over REGIONS to register routes is forbidden');
});

test('feed failure → 503, wrong region → 404, both through noindex gempaBusy', () => {
  const busy = serverSrc.slice(serverSrc.indexOf('function gempaBusy'), serverSrc.indexOf('function gempaBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'gempaBusy is noindex,follow');
  assert.ok(busy.includes('Back to the Earthquake Complex'), 'gempaBusy escape hatch is in English');
  assert.match(serverSrc, /status\(503\)\.type\('html'\)\.send\(gempaBusy/, 'the 503 path uses gempaBusy');
  assert.match(serverSrc, /status\(404\)\.type\('html'\)\.send\(gempaBusy/, 'the bad-region 404 uses gempaBusy');
});

test('USGS: no API key, valid FDSN parameters, 10-minute cache', () => {
  assert.ok(gempaSrc.includes('earthquake.usgs.gov/fdsnws/event/1/query'), 'the FDSN query endpoint');
  assert.doesNotMatch(gempaSrc, /apikey|api_key|appid|token/, 'no key required (public data)');
  assert.ok(gempaSrc.includes('minlongitude') && gempaSrc.includes('maxlatitude'), 'bbox sent in FDSN form (not "bbox")');
  assert.doesNotMatch(gempaSrc, /params\.bbox\b/, 'the wrong "bbox" parameter is not used');
  assert.match(gempaSrc, /TTL = 10 \* 60 \* 1000/, 'cached for 10 minutes');
  assert.match(gempaSrc, /function timeBucket\(/, 'the window is rounded to the TTL boundary, so the same question has one key');
  assert.doesNotMatch(gempaSrc, /endtime: new Date\(\)\.toISOString\(\)/, 'a window written to the millisecond is a key that never repeats (the cache never hits)');
  assert.match(gempaSrc, /const MIRROR_FILE = process\.env\.GEMPA_MIRROR_PATH/, 'the last feed of each region is mirrored to disk');
});

test('the quake copy is English: labels and slugs both translated', () => {
  const pages = serverSrc.slice(serverSrc.indexOf('function gempaRegionPage'), serverSrc.indexOf('const CUTI_SECTIONS'));
  assert.ok(pages.includes("inLanguage: 'en'"), 'the explanation article declares inLanguage en');
  assert.ok(pages.includes('Drop, Cover, Hold') || pages.includes('Drop \\u2014 Cover'), 'the safety protocol uses the English wording');
  assert.doesNotMatch(pages, /Reda|Lindungi|Tahan|Bahasa Melayu/, 'no Malay safety wording remains on the quake pages');
  assert.match(gempaSrc, /slug: 'southeast-asia', name: 'Southeast Asia'/, 'region label and URL slug are both English');
});

test('sitemap-earthquakes.xml + robots + weather↔quake cross links & footer', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-earthquakes\.xml'/, 'the sitemap-earthquakes route exists');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-earthquakes.xml'"), serverSrc.indexOf("app.get('/sitemap-earthquakes.xml'") + 1300);
  assert.ok(sm.includes('gp.REGIONS.map'), 'every region goes into the sitemap');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-earthquakes\.xml/, 'robots advertises sitemap-earthquakes');
  assert.ok(serverSrc.includes('<li><a href="/earthquakes">World Earthquakes</a></li>'), 'the footer links to the world quake hub');
  assert.ok(serverSrc.includes('<a href="/earthquakes">Earthquake Complex</a>'), 'the weather hub cross-links to the earthquake complex');
  assert.ok(serverSrc.includes("'/earthquakes', '/earthquakes/explained'"), 'the main sitemap lists /earthquakes');
});

// A slug rename inside REGIONS does not touch the call sites that pass a literal, and
// findRegion returns null for an unknown slug — which used to surface as a bare
// TypeError inside regionFeed and take the /earthquakes hub down with a 503.
test('every findRegion() call site names a region that REGIONS declares', () => {
  const declared = new Set([...gempaSrc.matchAll(/slug: '([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(declared.has('world'), 'the world region is declared');
  const callers = { 'src/server.js': serverSrc, 'index.js': indexSrc };
  const bad = [];
  for (const [file, src] of Object.entries(callers)) {
    for (const m of src.matchAll(/findRegion\('([^']+)'\)/g)) {
      if (!declared.has(m[1])) bad.push(`${file} → ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], 'no call site asks for a slug that REGIONS does not define');
  assert.match(serverSrc, /gp\.regionFeed\(gp\.findRegion\('world'\)\)/, 'the main hub feeds the world region');
  assert.match(gempaSrc, /if \(!r\) throw new Error\('regionFeed needs a known region'\)/, 'regionFeed rejects null instead of dereferencing it');
});

// A cold cache plus a burst of readers opened one USGS query per request; when the upstream
// call timed out the hub answered 503 even though a retry a moment later succeeds. One shared
// promise per feed plus a single retry removes that window.
test('gempa.js: one upstream call per feed (single-flight) and one retry on a cold start', () => {
  assert.match(gempaSrc, /const inflight = new Map\(\)/, 'the in-flight registry exists');
  assert.match(gempaSrc, /const running = inflight\.get\(key\)/, 'a concurrent caller reuses the running fetch');
  assert.match(gempaSrc, /inflight\.set\(key, p\)/, 'the promise is registered before it settles');
  assert.match(gempaSrc, /async function fetchOnce\(key, params, attempt\)/, 'the single attempt is extracted');
  assert.match(gempaSrc, /if \(attempt < 1\) return fetchOnce\(key, params, attempt \+ 1\)/, 'a failed attempt is retried once');
});

// The cache key is the feed window, and the window used to end at `now` — written to the
// millisecond. Measured on this box (24 Oct 2026): three page views in a row produced three
// distinct keys and three USGS queries, so the ten-minute cache above had never served a single
// hit, every visitor paid the full 7-9 s round-trip, and the sitemap crawler found /earthquakes
// answering 503. A key that repeats is the whole difference between a cache and a decoration.
test('three page views of one region share a single USGS call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-gempa-'));
  const probe = `
    process.env.GEMPA_MIRROR_PATH = ${JSON.stringify(path.join(dir, 'gempa-last.json'))};
    const axios = require('axios');
    const seen = [];
    const realCreate = axios.create;
    axios.create = (opts) => {
      const inst = realCreate.call(axios, opts);
      inst.defaults.adapter = async (config) => {
        seen.push(JSON.stringify(config.params));
        return { data: { features: [{ id: 'us1', properties: { mag: 5.4, place: 'Kobe, Japan', time: 1700000000000, url: 'https://example.invalid/us1' }, geometry: { coordinates: [135, 34.7, 12.3] } }] },
          status: 200, statusText: 'OK', headers: {}, config };
      };
      return inst;
    };
    const gp = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'gempa.js'))});
    (async () => {
      const w = gp.findRegion('world');
      const views = [await gp.regionFeed(w), await gp.regionFeed(w), await gp.regionFeed(w)];
      const params = JSON.parse(seen[0]);
      const mirror = gp.readMirror();
      console.log(JSON.stringify({
        upstream: seen.length,
        distinctWindows: new Set(seen).size,
        rows: views.map((r) => r.length),
        mag: gp.summarise(views[0]).max,
        params,
        mirrorKeys: Object.keys(mirror).length,
        mirrorRows: (mirror[Object.keys(mirror)[0]] || {}).rows.length,
      }));
    })();
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', cwd: path.join(__dirname, '..') }));

  assert.strictEqual(out.upstream, 1, 'three views, one upstream query (before: three queries and three keys)');
  assert.strictEqual(out.distinctWindows, 1, 'the window is identical for the whole ten minutes');
  assert.deepStrictEqual(out.rows, [1, 1, 1], 'every view is served, from the shared entry');
  assert.strictEqual(out.mag, 5.4, 'and it is the real feed, not a placeholder');
  // The boundary has to be a TTL edge, or the key is stable only by luck.
  assert.match(out.params.endtime, /:(00|10|20|30|40|50):00\.000Z$/, `the window ends on a ten-minute boundary, got ${out.params.endtime}`);
  assert.ok(Date.parse(out.params.endtime) <= Date.now(), 'the bucket is in the past, never a window of its own');
  assert.strictEqual(out.params.minmagnitude, 4.5, 'the region rules still reach USGS');
  assert.strictEqual(out.mirrorKeys, 1, 'the mirror files the region, not one entry per window');
  assert.strictEqual(out.mirrorRows, 1, 'with the rows that were just fetched');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The mirror is what keeps a restart from being a 503: the memory cache is empty in a new
// process, so the first visitor of a deploy would otherwise wait on USGS and get an error page
// if it was slow. Yesterday's list is a correct answer to "what happened" and the page renders
// in milliseconds while the refresh happens behind it.
test('a restart answers from the last feed on disk while USGS is unreachable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-gempa-mirror-'));
  const params = { starttime: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), endtime: new Date().toISOString(), minmagnitude: 4.5, limit: 80 };
  const probe = `
    process.env.GEMPA_MIRROR_PATH = ${JSON.stringify(path.join(dir, 'gempa-last.json'))};
    let attempts = 0;
    const axios = require('axios');
    const realCreate = axios.create;
    axios.create = (opts) => {
      const inst = realCreate.call(axios, opts);
      inst.defaults.adapter = async () => { attempts += 1; throw new Error('USGS unreachable (probe)'); };
      return inst;
    };
    const fs = require('node:fs');
    const path = require('node:path');
    const gp = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'gempa.js'))});
    const key = gp.mirrorKey(${JSON.stringify(params)});
    fs.mkdirSync(path.dirname(gp.MIRROR_FILE), { recursive: true });
    fs.writeFileSync(gp.MIRROR_FILE, JSON.stringify({ [key]: { at: '2026-10-24T00:00:00.000Z',
      rows: [{ id: 'old1', mag: 6.1, place: 'Yesterday, offshore', time: 1700000000000, depth: 10, lat: 1, lon: 2, url: 'https://example.invalid/old1', tsunami: false, felt: 0, cdi: 0, status: 'reviewed', sig: 500 }] } }));
    (async () => {
      try {
        const rows = await gp.regionFeed(gp.findRegion('world'));
        console.log(JSON.stringify({ rows: rows.length, mag: gp.summarise(rows).max, place: rows[0].place, attempts }));
      } catch (err) {
        console.log(JSON.stringify({ threw: err.message, attempts }));
      }
    })();
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', cwd: path.join(__dirname, '..') }));

  assert.strictEqual(out.threw, undefined, 'the page is served, not a 503, while the upstream is down');
  assert.strictEqual(out.rows, 1, 'the mirrored feed answers in full');
  assert.strictEqual(out.mag, 6.1, 'with its own numbers');
  assert.strictEqual(out.place, 'Yesterday, offshore', 'and its own rows');
  assert.ok(out.attempts >= 1, 'the network was still tried — the mirror is a fallback, not a substitute');
  fs.rmSync(dir, { recursive: true, force: true });
});
