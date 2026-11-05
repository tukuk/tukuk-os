'use strict';
// toolkit-families.js — the data-driven families behind the third wave of /alat (Nov 2026).
//
// Why families instead of ninety-five more hand-written objects: a position tool is the one
// cluster where the VISITOR'S question is already a slug — "distance from Lagos to Abuja",
// "coordinates of Kyoto", "what is on the other side of the Earth from São Paulo". The maths
// engine is written once per family and proven once per family; the members differ by real
// data taken from src/kota-data.json (341 cities with WGS84 coordinates), so every page
// answers a question no other page on the site answers, which is the line the crawl-budget
// policy in server.js draws between a reference shelf and near-identical filler.
//
// House rules still apply to every generated entry:
//   • the whole answer is arithmetic the visitor's browser can verify — no API, no upload;
//   • the method is named on the page (haversine on the IUGG mean radius, WGS84 meridian arc
//     integrated by Simpson's rule, standard base-32 geohash);
//   • English-first copy, script strings are ES5 concatenation — no backticks, no ${ —
//     because the builder embeds them inside a JS template literal;
//   • every form ID the script binds to exists in the form, and the default inputs come from
//     the member's own data, so the page answers correctly before a single keystroke.
//
// Coordinates are baked from the dataset at require time — nothing here is invented, and the
// distances/antipodes a page states are the ones its own script recomputes in the browser.

const CITIES = require('./kota-data.json');

// ── WGS84 / spherical geometry, shared by the builders and the browser scripts ──────
const R_MEAN = 6371.0088;            // IUGG mean Earth radius, km
const WGS_A = 6378.137;              // semi-major axis, km
const WGS_F = 1 / 298.257223563;     // flattening
const WGS_E2 = WGS_F * (2 - WGS_F);  // first eccentricity squared

function toRad(deg) { return deg * Math.PI / 180; }

// Great-circle distance on the mean sphere (haversine) — numerically stable at small
// separations, which matters because several pairs in this dataset are city-to-suburb.
function gcKm(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = p2 - p1, dl = toRad(lon2 - lon1);
  const h = Math.sin(dp / 2) * Math.sin(dp / 2)
    + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * R_MEAN * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial bearing (forward azimuth) from point 1 toward point 2, degrees from true north.
function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Meridian arc length from the equator to a latitude, in km, on the WGS84 ellipsoid:
// M(φ) = a(1−e²) ∫₀^φ (1 − e² sin²t)^(−3/2) dt, evaluated by Simpson's rule with enough
// panels that the error is well under a metre. Exact integrand, no fitted polynomial.
function meridianKm(latDeg) {
  const phi = Math.abs(toRad(latDeg));
  const n = 2000, h = phi / n;
  const f = (t) => Math.pow(1 - WGS_E2 * Math.pow(Math.sin(t), 2), -1.5);
  let s = f(0) + f(phi);
  for (let i = 1; i < n; i += 1) s += f(i * h) * (i % 2 ? 4 : 2);
  return WGS_A * (1 - WGS_E2) * (s * h / 3);
}

// Radius of the parallel at a latitude (N φ cos φ) — the east–west distance is along a
// small circle, so the page says so instead of passing it off as a straight line.
function parallelRadiusKm(latDeg) {
  const s = WGS_E2 * Math.pow(Math.sin(toRad(latDeg)), 2);
  return (WGS_A / Math.sqrt(1 - s)) * Math.cos(toRad(latDeg));
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW',
  'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compass(bearing) { return COMPASS[Math.round(bearing / 22.5) % 16]; }

// Thousands separator on the INTEGER part only — running the regex over "2.5400" would
// produce "2.5,400", which is how a formatted number quietly becomes a wrong number.
function fix(n, d) {
  if (!Number.isFinite(n)) return '—';
  const parts = n.toFixed(d === undefined ? 0 : d).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function signedDeg(v) { return v.toFixed(4) + '°'; }

// Degrees/minutes/seconds with the hemisphere letter — the format pilots, survey markers
// and cadastral records still use, and the one people search a city for.
function dms(v, pos, neg) {
  const hemi = v >= 0 ? pos : neg, a = Math.abs(v);
  const d = Math.floor(a), m = Math.floor((a - d) * 60), s = (a - d - m / 60) * 3600;
  return d + '° ' + String(m).padStart(2, '0') + '′ ' + s.toFixed(1) + '″ ' + hemi;
}

// Standard base-32 geohash: alternate longitude/latitude bits, longitude first, MOST
// significant bit first within each group of five, written in a thirty-two symbol alphabet
// with a/i/l/o removed so an OCR slip cannot invent a cell. (0, 0) must come out 's0000000'.
function geohash(lat, lon, chars) {
  const ALPHA = '0123456789bcdefghjkmnpqrstuvwxyz';
  let lonMin = -180, lonMax = 180, latMin = -90, latMax = 90;
  let out = '', idx = 0, bit = 0, lonStep = true;
  while (out.length < chars) {
    if (lonStep) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { idx |= 1 << (4 - bit); lonMin = mid; } else lonMax = mid;
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx |= 1 << (4 - bit); latMin = mid; } else latMax = mid;
    }
    lonStep = !lonStep;
    if (bit < 4) bit += 1; else { out += ALPHA[idx]; idx = 0; bit = 0; }
  }
  return out;
}

function normLon(lon) { let l = lon; while (l > 180) l -= 360; while (l < -180) l += 360; return l; }

// Diacritics folded out of the URL, kept in the prose: Bogotá is /alat/coords-bogota and
// still spells itself correctly on the page.
function slugify(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const CITY_SLUG = (() => {
  const used = {};
  return CITIES.map((c) => {
    let s = slugify(c.name) || 'city';
    if (used[s]) { let k = 2; while (used[s + '-' + k]) k += 1; s = s + '-' + k; }
    used[s] = true;
    return s;
  });
})();

function nearestOf(lat, lon, notName) {
  let best = null;
  for (const c of CITIES) {
    if (c.name === notName) continue;
    const km = gcKm(lat, lon, c.lat, c.lng);
    if (!best || km < best.km) best = { city: c, km };
  }
  return best;
}

// Degrees + decimal minutes, the format GPS receivers type.
function dm(v, pos, neg) {
  const a = Math.abs(v);
  let d = Math.floor(a), m = (a - d) * 60;
  if (m >= 60) { d += 1; m -= 60; }
  return d + '° ' + m.toFixed(4) + '′ ' + (v >= 0 ? pos : neg);
}

// The ES5 bodies are written once per family and shared by every member; the member only
// supplies the defaults baked into the form and the prose in the static result card.
const SCRIPT_DISTANCE = `
var $=function(id){return document.getElementById(id);};
function num(id){var v=parseFloat($(id).value);return v;}
function fx(n,d){if(!isFinite(n))return '—';var p=n.toFixed(d===undefined?0:d).split('.');
 p[0]=p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');return p.join('.');}
function rd(d){return d*Math.PI/180;}
function hav(la1,lo1,la2,lo2){var p1=rd(la1),p2=rd(la2),dp=p2-p1,dl=rd(lo2-lo1);
 var s=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
 return 2*6371.0088*Math.asin(Math.min(1,Math.sqrt(s)));}
function brg(la1,lo1,la2,lo2){var p1=rd(la1),p2=rd(la2),dl=rd(lo2-lo1);
 var y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
 return (Math.atan2(y,x)*180/Math.PI+360)%360;}
var COMPASS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function bad(m){$('ds-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+m
 +' — latitude is −90 to 90, longitude is −180 to 180, west and south are negative.';}
function render(){var a1=num('ds-la1'),o1=num('ds-lo1'),a2=num('ds-la2'),o2=num('ds-lo2');
 if([a1,o1,a2,o2].some(function(v){return isNaN(v);}))return bad('A coordinate is not a number');
 if(Math.abs(a1)>90||Math.abs(a2)>90)return bad('Latitude must be between −90 and 90');
 if(Math.abs(o1)>180||Math.abs(o2)>180)return bad('Longitude must be between −180 and 180');
 var km=hav(a1,o1,a2,o2),mi=km*0.621371,nm=km/1.852,b=brg(a1,o1,a2,o2);
 var dLa=a2-a1,dLo=o2-o1;
 var html='<div class="tl-big">'+fx(km)+' km · '+fx(mi)+' mi</div><table class="tl-tab"><tbody>';
 html+='<tr><td>Great-circle (haversine, R = 6371.0088 km)</td><td>'+fx(km,1)+' km</td></tr>';
 html+='<tr><td>Miles (international)</td><td>'+fx(mi,1)+' mi</td></tr>';
 html+='<tr><td>Nautical miles</td><td>'+fx(nm,1)+' nmi</td></tr>';
 html+='<tr><td>Initial true bearing</td><td>'+fx(b,1)+'° '+COMPASS[Math.round(b/22.5)%16]+'</td></tr>';
 html+='<tr><td>Flight at 900 km/h (no climb, taxi or wind)</td><td>'+fx(km/900*60,0)+' min</td></tr>';
 html+='<tr><td>Drive at 80 km/h, non-stop</td><td>'+fx(km/80,1)+' h</td></tr>';
 html+='<tr><td>Latitude change</td><td>'+fx(dLa,4)+'°</td></tr>';
 html+='<tr><td>Longitude change</td><td>'+fx(dLo,4)+'°</td></tr>';
 html+='</tbody></table><p class="meta">This is the straight line through the air: the great-circle arc on a sphere with the IUGG mean Earth radius. Roads, rails and flight paths are longer — a real drive is usually 1.2 to 1.4 times this figure, and airlines add routing and winds on top.</p>';
 $('ds-out').innerHTML=html;}
$('ds-go').onclick=render;$('ds-la1').oninput=render;$('ds-lo1').oninput=render;
$('ds-la2').oninput=render;$('ds-lo2').oninput=render;render();`;

const SCRIPT_COORDS = `
var $=function(id){return document.getElementById(id);};
function fx(n,d){if(!isFinite(n))return '—';var p=n.toFixed(d===undefined?0:d).split('.');
 p[0]=p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');return p.join('.');}
function dms(v,pos,neg){var h=v>=0?pos:neg,a=Math.abs(v);var d=Math.floor(a),m=Math.floor((a-d)*60),
 s=(a-d-m/60)*3600;var mm=(m<10?'0':'')+m;return d+'° '+mm+'′ '+s.toFixed(1)+'″ '+h;}
function dm(v,pos,neg){var a=Math.abs(v),d=Math.floor(a),m=(a-d)*60;if(m>=60){d+=1;m-=60;}
 return d+'° '+m.toFixed(4)+'′ '+(v>=0?pos:neg);}
function geo(lat,lon,chars){var A='0123456789bcdefghjkmnpqrstuvwxyz';var lo0=-180,lo1=180,la0=-90,la1=90;
 var out='',idx=0,bit=0,lonStep=true;
 while(out.length<chars){if(lonStep){var m1=(lo0+lo1)/2;if(lon>=m1){idx|=1<<(4-bit);lo0=m1;}else lo1=m1;}
  else{var m2=(la0+la1)/2;if(lat>=m2){idx|=1<<(4-bit);la0=m2;}else la1=m2;}
  lonStep=!lonStep;if(bit<4)bit++;else{out+=A[idx];idx=0;bit=0;}}
 return out;}
function merkm(lat){var a=6378.137,f=1/298.257223563,e2=f*(2-f),phi=Math.abs(lat)*Math.PI/180,n=2000,h=phi/n;
 function g(t){var s=Math.sin(t);return Math.pow(1-e2*s*s,-1.5);}
 var s=g(0)+g(phi);for(var i=1;i<n;i++)s+=g(i*h)*(i%2?4:2);return a*(1-e2)*s*h/3;}
 function parR(lat){var a=6378.137,f=1/298.257223563,e2=f*(2-f);
  var s=e2*Math.pow(Math.sin(lat*Math.PI/180),2);return a/Math.sqrt(1-s)*Math.cos(lat*Math.PI/180);}
function bad(m){$('cd-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+m;}
function render(){var la=parseFloat($('cd-la').value),lo=parseFloat($('cd-lo').value);
 if(isNaN(la)||isNaN(lo))return bad('Type two numbers, for example 6.52 and 3.38');
 if(Math.abs(la)>90)return bad('Latitude must be between −90 and 90');
 if(Math.abs(lo)>180)return bad('Longitude must be between −180 and 180');
 var eq=merkm(la),pole=merkm(90)-eq,pmR=parR(la),pm=Math.abs(((lo+540)%360)-180)*Math.PI/180*pmR;
 var html='<div class="tl-big">'+dms(la,'N','S')+' · '+dms(lo,'E','W')+'</div><table class="tl-tab"><tbody>';
 html+='<tr><td>Decimal degrees (WGS84)</td><td>'+la.toFixed(6)+', '+lo.toFixed(6)+'</td></tr>';
 html+='<tr><td>Degrees, minutes, seconds</td><td>'+dms(la,'N','S')+' '+dms(lo,'E','W')+'</td></tr>';
 html+='<tr><td>Degrees and decimal minutes</td><td>'+dm(la,'N','S')+' · '+dm(lo,'E','W')+'</td></tr>';
 html+='<tr><td>GeoHash (9 characters)</td><td><code>'+geo(la,lo,9)+'</code></td></tr>';
 html+='<tr><td>Signed easting/northing as degrees</td><td>'+la.toFixed(4)+'°, '+lo.toFixed(4)+'°</td></tr>';
 html+='<tr><td>Distance to the equator (along a meridian)</td><td>'+fx(eq)+' km</td></tr>';
 html+='<tr><td>Distance to the nearest pole</td><td>'+fx(pole)+' km</td></tr>';
 html+='<tr><td>Distance to the prime meridian (along the parallel)</td><td>'+fx(pm)+' km</td></tr>';
 html+='<tr><td>Antipodal point (the other side of the Earth)</td><td>'+(-la).toFixed(4)+', '+(((lo+180+540)%360)-180).toFixed(4)+'</td></tr>';
 html+='</tbody></table><p class="meta">Coordinates are unprojected WGS84 — the datum GPS and every web map use. Meridian distances come from the WGS84 ellipsoid (Simpson integration of the exact meridian integral), so a kilometre here is a real kilometre, not 111 km per degree.</p>';
 $('cd-out').innerHTML=html;}
$('cd-go').onclick=render;$('cd-la').oninput=render;$('cd-lo').oninput=render;render();`;

const SCRIPT_ANTIPODE = `
var $=function(id){return document.getElementById(id);};
function fx(n,d){if(!isFinite(n))return '—';var p=n.toFixed(d===undefined?0:d).split('.');
 p[0]=p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');return p.join('.');}
function dms(v,pos,neg){var h=v>=0?pos:neg,a=Math.abs(v);var d=Math.floor(a),m=Math.floor((a-d)*60),
 s=(a-d-m/60)*3600;var mm=(m<10?'0':'')+m;return d+'° '+mm+'′ '+s.toFixed(1)+'″ '+h;}
function hav(la1,lo1,la2,lo2){var p1=la1*Math.PI/180,p2=la2*Math.PI/180,dp=p2-p1,dl=(lo2-lo1)*Math.PI/180;
 var s=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
 return 2*6371.0088*Math.asin(Math.min(1,Math.sqrt(s)));}
function bad(m){$('ap-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+m;}
function render(){var la=parseFloat($('ap-la').value),lo=parseFloat($('ap-lo').value);
 if(isNaN(la)||isNaN(lo))return bad('Type two numbers');
 if(Math.abs(la)>90)return bad('Latitude must be between −90 and 90');
 if(Math.abs(lo)>180)return bad('Longitude must be between −180 and 180');
 var ala=-la,alo=((lo+180+540)%360)-180;
 var html='<div class="tl-big">'+dms(ala,'N','S')+' · '+dms(alo,'E','W')+'</div><table class="tl-tab"><tbody>';
 html+='<tr><td>Your point</td><td>'+la.toFixed(4)+', '+lo.toFixed(4)+'</td></tr>';
 html+='<tr><td>Antipode (sign-flipped latitude, longitude + 180°)</td><td>'+ala.toFixed(4)+', '+alo.toFixed(4)+'</td></tr>';
 html+='<tr><td>Through the centre of the Earth (mean diameter)</td><td>12,742 km</td></tr>';
 html+='<tr><td>Surface arc to the antipode (half a great circle)</td><td>'+fx(hav(la,lo,ala,alo))+' km</td></tr>';
 html+='<tr><td>Antipode in DMS</td><td>'+dms(ala,'N','S')+' '+dms(alo,'E','W')+'</td></tr>';
 html+='</tbody></table><p class="meta">An antipode is the exact opposite point on the sphere: flip the latitude sign and add 180° of longitude. Because about 86 per cent of the surface is water, the antipode of most land is ocean — so a place with a neighbour on the other side is genuinely unusual.</p>';
 $('ap-out').innerHTML=html;}
$('ap-go').onclick=render;$('ap-la').oninput=render;$('ap-lo').oninput=render;render();`;

// ── family 1 — city-to-city distance ────────────────────────────────────────────────
// Members: every pair among the twelve dataset cities listed first in each region
// (5 regions × C(12,2) = 330). Those are the pairs people actually type into a search
// box — a country's capital plus its other major cities, and their regional neighbours.
function buildDistances() {
  const byRegion = {};
  CITIES.forEach((c) => { (byRegion[c.region] = byRegion[c.region] || []).push(c); });
  const out = [];
  Object.keys(byRegion).forEach((region) => {
    const list = byRegion[region].slice(0, 12);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i], b = list[j];
        const km = gcKm(a.lat, a.lng, b.lat, b.lng);
        const mi = km * 0.621371, nmi = km / 1.852;
        const br = bearingDeg(a.lat, a.lng, b.lat, b.lng);
        const slug = 'distance-' + CITY_SLUG[CITIES.indexOf(a)] + '-' + CITY_SLUG[CITIES.indexOf(b)];
        const dLat = b.lat - a.lat, dLon = normLon(b.lng - a.lng);
        const pair = a.name + ' and ' + b.name;
        out.push({
          slug, ic: '📏', cat: 'distances',
          name: a.name + ' ↔ ' + b.name + ' Distance',
          title: 'Distance from ' + a.name + ' to ' + b.name + ' — km, Miles, Bearing & Flight Time | Tukuk-OS',
          desc: 'Straight-line distance between ' + a.name + ' and ' + b.name + ': ' + fix(km)
            + ' km (' + fix(mi) + ' mi), with bearing, nautical miles and flight time, computed in your browser.',
          hero: a.name + ' to ' + b.name,
          sub: fix(km) + ' km · ' + fix(mi) + ' mi · bearing ' + br.toFixed(1) + '° ' + compass(br),
          navBlurb: 'The great-circle distance from ' + a.name + ' to ' + b.name + ' — ' + fix(km)
            + ' km with the maths, the bearing and the honest note that roads are longer.',
          hubBlurb: fix(km) + ' km / ' + fix(mi) + ' mi straight-line between ' + pair
            + ', plus bearing, nautical miles and flight time',
          lead: 'The air line between the two is <b>' + fix(km) + ' km</b> (' + fix(mi) + ' statute miles, '
            + fix(nmi) + ' nautical miles). It comes from the <b>haversine formula</b> on the two coordinate '
            + 'pairs the page carries — ' + a.name + ' at ' + signedDeg(a.lat) + (a.lat >= 0 ? ' N' : ' S') + ', '
            + signedDeg(a.lng) + (a.lng >= 0 ? ' E' : ' W') + ' and ' + b.name + ' at ' + signedDeg(b.lat)
            + (b.lat >= 0 ? ' N' : ' S') + ', ' + signedDeg(b.lng) + (b.lng >= 0 ? ' E' : ' W')
            + ' — using the IUGG mean Earth radius of 6371.0088 km. Leaving ' + a.name
            + ' toward ' + b.name + ' you start on a true bearing of <b>' + br.toFixed(1) + '°</b> ('
            + compass(br) + '); because the Earth curves, that heading drifts as you go.',
          form: `<div class="tl-form">
  <label>Latitude A <input id="ds-la1" type="text" inputmode="decimal" value="${a.lat}" autocomplete="off" spellcheck="false"></label>
  <label>Longitude A <input id="ds-lo1" type="text" inputmode="decimal" value="${a.lng}" autocomplete="off" spellcheck="false"></label>
  <label>Latitude B <input id="ds-la2" type="text" inputmode="decimal" value="${b.lat}" autocomplete="off" spellcheck="false"></label>
  <label>Longitude B <input id="ds-lo2" type="text" inputmode="decimal" value="${b.lng}" autocomplete="off" spellcheck="false"></label>
  <button class="tl-btn primary" id="ds-go" type="button">Measure</button>
</div>
<div class="tl-res" id="ds-out"><div class="tl-big">${fix(km)} km · ${fix(mi)} mi</div>
<table class="tl-tab"><tbody>
<tr><td>Great-circle (haversine, R = 6371.0088 km)</td><td>${fix(km, 1)} km</td></tr>
<tr><td>Miles (international)</td><td>${fix(mi, 1)} mi</td></tr>
<tr><td>Nautical miles</td><td>${fix(nmi, 1)} nmi</td></tr>
<tr><td>Initial true bearing</td><td>${br.toFixed(1)}° ${compass(br)}</td></tr>
<tr><td>Flight at 900 km/h (no climb, taxi or wind)</td><td>${fix(km / 900 * 60)} min</td></tr>
<tr><td>Drive at 80 km/h, non-stop</td><td>${fix(km / 80, 1)} h</td></tr>
<tr><td>Latitude change</td><td>${fix(dLat, 4)}°</td></tr>
<tr><td>Longitude change</td><td>${fix(dLon, 4)}°</td></tr>
</tbody></table></div>`,
          script: SCRIPT_DISTANCE,
          seo: `<h2 class="section-title">How the ${pair} distance is worked out</h2>
  <p>Two points on a sphere are separated by the shorter arc of the great circle that passes through both of them, and the haversine formula is the numerically stable way to get its length: it converts the latitude difference and the longitude difference into a single chord ratio, takes its square root, and multiplies by twice the radius. Written that way it stays accurate even for pairs a few kilometres apart, which is why it is still the standard in navigation code. The radius used here is 6371.0088 km, the IUGG mean radius; on the true WGS84 ellipsoid the same ${a.name}–${b.name} arc differs by a few tenths of a per cent depending on the route's orientation, which is well inside the error of a city-centre coordinate.</p>
  <h2 class="section-title">What that number means for an actual trip</h2>
  <p>It is the distance a bird flies. A ${fix(km)} km line becomes roughly ${fix(km * 1.3)} km of road once hills, borders, river crossings and bypasses are counted — the 1.2 to 1.4 multiplier is the usual empirical range, and this page does not pretend to know the road you would take. Air distance is closer to the figure above, though airline routings, wind and holding add time to the ${fix(km / 900 * 60)} minutes a perfect 900 km/h cruise would take. Rail sits between the two. The latitude and longitude changes in the table show why the line is not simply "north" or "east": a ${fix(Math.abs(dLat), 2)}° shift in latitude is about ${fix(Math.abs(dLat) * 111.132)} km, while the same number of degrees in longitude shrinks with the cosine of the latitude.</p>
  <h2 class="section-title">Both positions, exactly</h2>
  <p>${a.name}, ${a.country} (${a.region}): ${dms(a.lat, 'N', 'S')}, ${dms(a.lng, 'E', 'W')} — decimal ${a.lat}, ${a.lng}, GeoHash <code>${geohash(a.lat, a.lng, 9)}</code>. ${b.name}, ${b.country} (${b.region}): ${dms(b.lat, 'N', 'S')}, ${dms(b.lng, 'E', 'W')} — decimal ${b.lat}, ${b.lng}, GeoHash <code>${geohash(b.lat, b.lng, 9)}</code>. Those two pairs are all this page needs, and everything above is derived from them; nothing is fetched, and the coordinates you can edit in the form are recalculated by your own browser, so a different pair costs nothing and stays on your device.</p>`,
        });
      }
    }
  });
  return out;
}

// ── family 2 — coordinates of a city, in every format ───────────────────────────────
// Members: all 341 cities. Each page carries that city's own DMS, geohash and dateline
// geometry, which no other city shares.
function buildCoords() {
  return CITIES.map((c, i) => {
    const eq = meridianKm(c.lat), pole = meridianKm(90) - eq;
    const pm = Math.abs(normLon(c.lng)) * Math.PI / 180 * parallelRadiusKm(c.lat);
    const hemi = (c.lat >= 0 ? 'Northern' : 'Southern') + ' and ' + (c.lng >= 0 ? 'Eastern' : 'Western') + ' Hemisphere';
    const slug = 'coords-' + CITY_SLUG[i];
    return {
      slug, ic: '🧭', cat: 'coordinates',
      name: c.name + ' Coordinates',
      title: c.name + ' Coordinates — Latitude, Longitude, DMS & GeoHash | Tukuk-OS',
      desc: c.name + ' sits at ' + c.lat + ', ' + c.lng + ' (' + dms(c.lat, 'N', 'S') + ', '
        + dms(c.lng, 'E', 'W') + '). Convert it, any point, to DMS, geohash and distances — in your browser.',
      hero: 'Coordinates of ' + c.name,
      sub: dms(c.lat, 'N', 'S') + ' · ' + dms(c.lng, 'E', 'W') + ' · GeoHash ' + geohash(c.lat, c.lng, 9),
      navBlurb: c.name + ' in decimal degrees, degrees-minutes-seconds and GeoHash, with its distance to the equator, the pole and the prime meridian.',
      hubBlurb: 'the exact position of ' + c.name + ' — ' + c.lat + ', ' + c.lng + ' as DMS, GeoHash and meridian distances',
      lead: '<b>' + c.name + '</b> is at <b>' + c.lat + ', ' + c.lng + '</b> in WGS84 decimal degrees, which is <b>'
        + dms(c.lat, 'N', 'S') + ', ' + dms(c.lng, 'E', 'W') + '</b> in degrees, minutes and seconds. It lies in the '
        + hemi + ', <b>' + fix(eq) + ' km</b> from the equator along its meridian, <b>' + fix(pole)
        + ' km</b> from the nearest pole and <b>' + fix(pm) + ' km</b> from the prime meridian measured along its own parallel. Exchange the numbers in the form for any other position and the page reworks every one of them.',
      form: `<div class="tl-form">
  <label>Latitude <input id="cd-la" type="text" inputmode="decimal" value="${c.lat}" autocomplete="off" spellcheck="false"></label>
  <label>Longitude <input id="cd-lo" type="text" inputmode="decimal" value="${c.lng}" autocomplete="off" spellcheck="false"></label>
  <button class="tl-btn primary" id="cd-go" type="button">Convert</button>
</div>
<div class="tl-res" id="cd-out"><div class="tl-big">${dms(c.lat, 'N', 'S')} · ${dms(c.lng, 'E', 'W')}</div>
<table class="tl-tab"><tbody>
<tr><td>Decimal degrees (WGS84)</td><td>${Number(c.lat).toFixed(6)}, ${Number(c.lng).toFixed(6)}</td></tr>
<tr><td>GeoHash (9 characters)</td><td><code>${geohash(c.lat, c.lng, 9)}</code></td></tr>
<tr><td>Distance to the equator (along a meridian)</td><td>${fix(eq)} km</td></tr>
<tr><td>Distance to the nearest pole</td><td>${fix(pole)} km</td></tr>
<tr><td>Distance to the prime meridian (along the parallel)</td><td>${fix(pm)} km</td></tr>
</tbody></table></div>`,
      script: SCRIPT_COORDS,
      seo: `<h2 class="section-title">Reading ${c.name}'s position</h2>
  <p>Latitude runs from 0° at the equator to 90° at each pole and is written with the hemisphere letter or a sign — south is negative. Longitude runs from the prime meridian through Greenwich to ±180°, east positive. ${c.name} at ${c.lat}, ${c.lng} therefore sits ${fix(eq)} km of meridian arc from the equator and ${fix(pm)} km of parallel arc from Greenwich. The two numbers are not the same kind of distance: a degree of latitude is roughly constant (about 111 km, and the ellipsoid makes it 110.57 km at the equator, 111.69 km at the poles), while a degree of longitude shrinks with the cosine of the latitude, until it is nothing at all on poles. That is why this page gives the parallel distance separately instead of multiplying degrees by a single factor.</p>
  <h2 class="section-title">Why DMS, and what a GeoHash is for</h2>
  <p>Degrees-minutes-seconds is the format of charts, survey markers and aviation logs, because a minute of latitude is by definition close to one nautical mile. A GeoHash is something else entirely: it interleaves the longitude bits and latitude bits of a position and writes each group of five in a thirty-two symbol alphabet, so a cell that starts <code>${geohash(c.lat, c.lng, 6)}</code> is a rectangle about 1.2 km by 0.6 km containing ${c.name}. Two points that share a longer GeoHash prefix are near each other, which makes the string useful for indexing, grouping and typing a position into a map without entering two numbers.</p>
  <h2 class="section-title">The datum matters</h2>
  <p>Every figure here is WGS84, the same reference GPS broadcasts and web maps display. Older local datums (OSGB, Potsdam, and the various regional surveys) can put the same street corner hundreds of metres away on paper, so a coordinate quoted without its datum is incomplete. Conversions on this page touch no service: the meridian arc is Simpson integration of the exact WGS84 meridian integral, and the parallel radius comes from the ellipsoid's prime-vertical radius of curvature — both run in your browser, so the numbers are checkable and nothing you type leaves the device.</p>`,
    };
  });
}

// ── family 3 — the antipode of a city ───────────────────────────────────────────────
// Members: all 341 cities, each with its own opposite point and, computed from the same
// dataset, the named place nearest to it. That last figure is real data, not a claim: the
// page says "nearest of the places we hold coordinates for", because most antipodes are sea.
function buildAntipodes() {
  return CITIES.map((c, i) => {
    const ala = -c.lat, alo = normLon(c.lng + 180);
    const near = nearestOf(ala, alo, c.name);
    const slug = 'antipode-' + CITY_SLUG[i];
    return {
      slug, ic: '🌏', cat: 'antipodes',
      name: 'Antipode of ' + c.name,
      title: 'What Is on the Other Side of the Earth from ' + c.name + '? | Tukuk-OS',
      desc: 'The antipode of ' + c.name + ' is ' + ala.toFixed(4) + ', ' + alo.toFixed(4) + ' — ' + fix(gcKm(c.lat, c.lng, ala, alo))
        + ' km away through the air. The nearest mapped place to it is ' + near.city.name + '. Any point works in-browser.',
      hero: 'The other side of the Earth from ' + c.name,
      sub: 'antipode ' + ala.toFixed(4) + ', ' + alo.toFixed(4) + ' · nearest place ' + near.city.name
        + ' (' + fix(near.km) + ' km away)',
      navBlurb: 'Flip ' + c.name + ' through the centre of the Earth: its exact antipodal point, what is nearest to it, and the maths to do any pair.',
      hubBlurb: 'the point on the far side of the planet from ' + c.name + ', with the nearest town to it and the 20,015 km arc',
      lead: 'Drop a line from <b>' + c.name + '</b> straight through the centre of the planet and it comes out at <b>'
        + ala.toFixed(4) + ', ' + alo.toFixed(4) + '</b> — the antipode. Flip the latitude sign and add 180° of longitude; '
        + 'the surface distance between the two points is half of a great circle, <b>20,015 km</b>, which is the longest '
        + 'possible separation anywhere on Earth, and the line through the planet itself is the mean diameter, '
        + '12,742 km. Of the places we hold coordinates for, the one nearest to that '
        + 'antipode is <b>' + near.city.name + '</b> (' + near.city.country + '), ' + fix(near.km) + ' km away — which '
        + (near.km < 200 ? 'means this point has a real neighbour opposite.' : 'usually means the other side is open ocean.'),
      form: `<div class="tl-form">
  <label>Latitude <input id="ap-la" type="text" inputmode="decimal" value="${c.lat}" autocomplete="off" spellcheck="false"></label>
  <label>Longitude <input id="ap-lo" type="text" inputmode="decimal" value="${c.lng}" autocomplete="off" spellcheck="false"></label>
  <button class="tl-btn primary" id="ap-go" type="button">Find the antipode</button>
</div>
<div class="tl-res" id="ap-out"><div class="tl-big">${dms(ala, 'N', 'S')} · ${dms(alo, 'E', 'W')}</div>
<table class="tl-tab"><tbody>
<tr><td>Your point (${c.name})</td><td>${c.lat}, ${c.lng}</td></tr>
<tr><td>Antipode</td><td>${ala.toFixed(4)}, ${alo.toFixed(4)}</td></tr>
<tr><td>Surface arc to the antipode</td><td>${fix(gcKm(c.lat, c.lng, ala, alo))} km</td></tr>
<tr><td>Nearest place in our dataset to the antipode</td><td>${near.city.name} — ${fix(near.km)} km</td></tr>
</tbody></table></div>`,
      script: SCRIPT_ANTIPODE,
      seo: `<h2 class="section-title">How an antipode is calculated</h2>
  <p>Two antipodal points are related by a single rule: the latitude keeps its size and changes hemisphere, and the longitude moves half a turn around, so east becomes west and the figure is folded back into the −180° to +180° range if it crosses the dateline. For ${c.name} at ${c.lat}, ${c.lng} that gives ${ala.toFixed(4)}, ${alo.toFixed(4)}. The distance between the pair does not depend on where you start: measured along the surface it is always half of a great circle, about 20,015 km, and measured through the planet it is the diameter, about 12,742 km. Any straight line you draw through the centre of the Earth and out the other side ends at the antipode, which is also why the two points see opposite seasons and roughly opposite clock times.</p>
  <h2 class="section-title">Why almost everyone's other side is water</h2>
  <p>About 86 per cent of the surface is ocean and land clusters in the north, so the antipode of a random land point is almost always sea. The rare land-on-land pairs are a standing curiosity: much of the Americas sits opposite the Indian Ocean and east Asia, which is why ${c.name} in ${c.country} resolves to ${near.city.name}, ${near.km < 200 ? 'close enough to call it a true opposite' : 'and the antipode itself is water'}. The nearest place quoted here is the closest of the 341 positions this site carries coordinates for — a useful, honest bound rather than a claim about every village on Earth.</p>
  <h2 class="section-title">Try any position</h2>
  <p>The form accepts any latitude and longitude and returns the antipode in decimal and degrees-minutes-seconds, the surface arc and the through-Earth diameter, all from the two lines of arithmetic above. It runs on your device: no request leaves the page, so an edit is answered instantly and offline, and the same maths works for a hill you were standing on as for a capital city. Flight planners use the figure for the longest sectors on the board, and geography teachers use it for the question above.</p>`,
    };
  });
}

const DISTANCES = buildDistances();
const COORDS = buildCoords();
const ANTIPODES = buildAntipodes();

module.exports = {
  FAMILY_ENTRIES: DISTANCES.concat(COORDS, ANTIPODES),
  COUNTS: {
    distances: DISTANCES.length,
    coordinates: COORDS.length,
    antipodes: ANTIPODES.length,
    cities: CITIES.length,
  },
  // exposed for the tests so the maths is provable independently of the pages
  _internals: { gcKm, bearingDeg, meridianKm, parallelRadiusKm, geohash, dms, slugify, CITIES, normLon },
};
