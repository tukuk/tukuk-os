// The site is English-only, and that includes the addresses. Every content section
// that used to live under a Malay path now has an English home, and the old address
// answers 301 with its parameters intact — a city, a region, an event id or a state.
// This file pins both halves of that promise: the redirect and the live route.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

// [old Malay address, English address it must lead to]
const PAIRS = [
  ['/cuaca', '/weather'],
  ['/cuaca/peta', '/weather/map'],
  ['/cuaca/ekstrem', '/weather/extremes'],
  ['/gempa', '/earthquakes'],
  ['/gempa/penjelasan', '/earthquakes/explained'],
  ['/gempa/asia-tenggara', '/earthquakes/southeast-asia'],
  ['/cuti', '/holidays'],
  ['/cuti/hujung-minggu-panjang', '/holidays/long-weekends'],
  ['/cuti/dunia', '/holidays/world'],
  ['/cuti/selangor', '/holidays/selangor'],
  ['/negara', '/countries'],
  ['/statistik', '/statistics'],
  ['/bencana', '/disasters'],
  ['/peta', '/maps'],
  ['/peta/langit', '/maps/sky'],
  ['/muzik', '/charts'],
  ['/bendera', '/flags'],
  ['/bendera/teka', '/flags/quiz'],
  ['/teknologi', '/technology'],
  ['/udara', '/air-quality'],
  ['/udara/carbon', '/air-quality/carbon'],
  ['/akademi', '/academy'],
  ['/wang', '/money'],
  ['/wang/kadar', '/money/rates'],
  ['/seni', '/art'],
  ['/hidupan', '/life'],
  ['/unsur', '/elements'],
  ['/buruj', '/constellations'],
  ['/pepatah', '/proverbs'],
  ['/rekod', '/records'],
  ['/sejarah', '/history'],
  ['/kota', '/cities'],
  ['/warisan', '/heritage'],
];

for (const [oldPath, newPath] of PAIRS) {
  test(`GET ${oldPath} redirects permanently to ${newPath}`, async () => {
    const res = await fetch(base + oldPath, { redirect: 'manual' });
    assert.equal(res.status, 301, `${oldPath} must answer 301, not ${res.status}`);
    assert.equal(res.headers.get('location'), newPath, `${oldPath} must land on ${newPath}`);
  });
}

// A parameter must survive the hop: dropping it would silently strand the visitor
// on a hub page instead of the city / region / state they asked for.
test('redirects carry their parameters across', async () => {
  const cases = [
    ['/cuaca/tokyo', '/weather/tokyo'],
    ['/cuaca/tokyo/surya', '/weather/tokyo/sun'],
    ['/cuaca/tokyo/udara', '/weather/tokyo/air'],
    ['/gempa/jepun', '/earthquakes/japan'],
    ['/gempa/pasifik-timur', '/earthquakes/east-pacific'],
    ['/bencana/banjir', '/disasters/floods'],
    ['/bencana/gunung-berapi/EONET_1', '/disasters/volcanoes/EONET_1'],
    ['/bendera/malaysia', '/flags/malaysia'],
    ['/pepatah/negara/jepun', '/proverbs/country/jepun'],
    ['/sejarah/08/31', '/history/08/31'],
  ];
  for (const [oldPath, newPath] of cases) {
    const res = await fetch(base + oldPath, { redirect: 'manual' });
    assert.equal(res.status, 301, `${oldPath} must answer 301`);
    assert.equal(res.headers.get('location'), newPath, `${oldPath} → ${newPath}`);
  }
});

// The other half: the English address is a live route in the server, not a 301 of
// its own. A slug page is served by its parameterised sibling (/countries/:slug), so
// either the literal path or that sibling has to be registered.
test('every English section address is a registered route', async () => {
  for (const [, newPath] of PAIRS) {
    const exact = serverSrc.includes(`app.get('${newPath}'`);
    const [root, second] = newPath.split('/').slice(1);
    const sibling = Boolean(second) && serverSrc.includes(`app.get('/${root}/:`);
    assert.ok(exact || sibling, `${newPath} is registered with app.get (or its :param sibling)`);
  }
});

// The geo/place clusters moved too. Their hubs are registered by the geoRoutes()
// factory with a bare segment, so the route check looks for that form as well.
const GEO_PAIRS = `cagar:conservation-areas gunung:mountains danau:lakes pulau:islands sungai:rivers
air-terjun:waterfalls gua:caves gletser:glaciers teluk:bays lembah:valleys semenanjung:peninsulas
gunung-berapi:volcanoes selat:straits kepulauan:archipelagos ngarai:gorges bukit:hills
celah:mountain-gaps tanjung:capes lagun:lagoons danau-garam:salt-lakes laut:seas waduk:reservoirs
tanah-basah:wetlands air-panas:hot-springs terumbu-karang:coral-reefs kaldera:calderas
bendungan:dams pencakar-langit:skyscrapers jambatan:bridges mercu-suar:lighthouses terusan:canals
menara:towers pelabuhan:ports terowong:tunnels gereja:churches museum:museums
lapangan-terbang:airports istana:palaces universiti:universities stadium:stadiums
kastil:castles masjid:mosques monumen:monuments katedral:cathedrals hospital:hospitals
hotel:hotels taman-botani:botanical-gardens taman:parks sinagog:synagogues perpustakaan:libraries
kubu:fortifications balai-cerap:astronomical-observatories akuarium:aquariums banjaran:mountain-ranges
tanah-kubur:cemeteries biara:monasteries patung:statues rumah-opera:opera-houses gurun:deserts
akueduk:aqueducts`
  .split(/\s+/).filter(Boolean).map((pair) => pair.split(':')).map(([a, b]) => [`/${a}`, `/${b}`]);

for (const [oldPath, newPath] of GEO_PAIRS) {
  test(`GET ${oldPath} redirects permanently to ${newPath}`, async () => {
    const res = await fetch(base + oldPath, { redirect: 'manual' });
    assert.equal(res.status, 301, `${oldPath} must answer 301, not ${res.status}`);
    assert.equal(res.headers.get('location'), newPath, `${oldPath} must land on ${newPath}`);
  });
}

test('geo detail pages keep their slug through the redirect', async () => {
  for (const [oldPath, newPath] of [['/gunung/asia', '/mountains/asia'], ['/teluk/asia', '/bays/asia'], ['/cagar/asia', '/conservation-areas/asia']]) {
    const res = await fetch(base + oldPath, { redirect: 'manual' });
    assert.equal(res.status, 301, `${oldPath} must answer 301`);
    assert.equal(res.headers.get('location'), newPath, `${oldPath} → ${newPath}`);
  }
});

test('every English geo address is registered (geoRoutes or app.get)', () => {
  for (const [, newPath] of GEO_PAIRS) {
    const root = newPath.split('/')[1];
    const routed = serverSrc.includes(`geoRoutes('${root}'`) || serverSrc.includes(`app.get('/${root}'`);
    assert.ok(routed, `${newPath} is registered`);
  }
});


// robots.txt lists the sitemap files, so their names are public addresses too.
test('old sitemap file names redirect to the English ones', async () => {
  const pairs = [['/sitemap-cuaca.xml', '/sitemap-weather.xml'], ['/sitemap-gempa.xml', '/sitemap-earthquakes.xml'],
    ['/sitemap-cuti.xml', '/sitemap-holidays.xml'], ['/sitemap-negara.xml', '/sitemap-countries.xml'],
    ['/sitemap-statistik.xml', '/sitemap-statistics.xml'], ['/sitemap-bencana.xml', '/sitemap-disasters.xml'],
    ['/sitemap-akademi.xml', '/sitemap-academy.xml'], ['/sitemap-wang.xml', '/sitemap-money.xml'],
    ['/sitemap-seni.xml', '/sitemap-art.xml'], ['/sitemap-hidupan.xml', '/sitemap-life.xml'],
    ['/sitemap-unsur.xml', '/sitemap-elements.xml'], ['/sitemap-pepatah.xml', '/sitemap-proverbs.xml'],
    ['/sitemap-rekod.xml', '/sitemap-records.xml'], ['/sitemap-sejarah.xml', '/sitemap-history.xml'],
    ['/sitemap-kota.xml', '/sitemap-cities.xml'], ['/sitemap-warisan.xml', '/sitemap-heritage.xml']];
  for (const [oldPath, newPath] of pairs) {
    const res = await fetch(base + oldPath, { redirect: 'manual' });
    assert.equal(res.status, 301, `${oldPath} must answer 301`);
    assert.equal(res.headers.get('location'), newPath, `${oldPath} → ${newPath}`);
  }
});

test('no page or content file still links to a Malay section path', async () => {
  const oldRoots = [...PAIRS, ...GEO_PAIRS].map(([p]) => p.split('/')[1]).filter((v, i, a) => a.indexOf(v) === i);
  const offenders = [];
  for (const file of ['public/index.html', 'public/os.html', 'public/llms.txt']) {
    const body = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const root of oldRoots) {
      const re = new RegExp(`(href="|\\]\\()/?${root}(?=[/"'#? )])`, 'g');
      if (re.test(body)) offenders.push(`${file} → /${root}`);
    }
  }
  assert.deepEqual(offenders, [], 'no published page hands out a redirected address');
});
