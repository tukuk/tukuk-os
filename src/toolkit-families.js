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
const CZ = require('./city-zones');

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

// ── family 4 — the clock difference between two places ─────────────────────────────────────
// Why this one is keyed on behaviour instead of on city pairs: distance is a property of two
// points, but an offset is a property of a LAW. Cairo and Alexandria are different cities with
// one answer, and so are London and Dublin — a family built from city pairs would print 57,970
// pages, most of them the same arithmetic under two different place names, which is precisely the
// thin content the crawl-budget policy exists to refuse. So the unit here is the PAIR OF OFFSET
// BEHAVIOURS: 341 cities collapse to forty rules, forty rules to 780 pairs, and every city that
// shares a rule is named on the pages of that rule instead of getting a page of its own.
//
// The boundary of the economy is where the arithmetic stops being identical, and it is finer than
// it looks. Two rule pairs can share their whole difference table, their working window and even
// their clock-change instants — Lagos–Mexico City and Accra–Phoenix do exactly that, seven hours
// apart all year in both cases — and still print different absolute offsets, which are the first
// two rows and the lead sentence of every card. Merging those would tell a visitor looking up
// Accra that its clock reads an hour ahead of where it actually reads. So nothing is merged past
// the pair of behaviours, and the absorbed cities a page does claim are provable members of its
// two classes rather than neighbours of a similar-looking table.
//
// Every figure comes from Intl.DateTimeFormat reading the time-zone database that is already
// inside Node and inside the visitor's browser — no API, no lookup table of abbreviations, and
// the copy says plainly that a stale tzdb gives a stale answer.

// The day of the year a daily-signature index refers to, as ISO text.
function segDate(year, dayIndex) {
  const t = new Date(Date.UTC(year, 0, 1 + dayIndex));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0')
    + '-' + String(t.getUTCDate()).padStart(2, '0');
}

// Runs of the year over which (A − B) is one constant number. Two zones that change on the same
// day cancel out and the run continues; that is the whole reason this is worth computing, because
// it is what tells a visitor that London–New York is 5 hours in August and 4 in June.
function diffSegments(sigA, sigB, year) {
  const out = [];
  let cur = sigA[0] - sigB[0], start = 0;
  for (let d = 1; d <= sigA.length; d += 1) {
    const v = d < sigA.length ? sigA[d] - sigB[d] : null;
    if (d === sigA.length || v !== cur) {
      out.push({ from: segDate(year, start), to: segDate(year, d - 1), minutes: cur });
      cur = v; start = d;
    }
  }
  return out;
}

// "the next day", "the same day", "two days ahead" — the dateline answer a plain hour
// subtraction hides.
function dayPhrase(delta) {
  if (delta === 0) return 'the same day';
  if (delta === 1) return 'the next day';
  if (delta === -1) return 'the previous day';
  return (delta > 0 ? delta + ' days later' : (-delta) + ' days earlier');
}

function longDate(d) {
  if (!d) return null;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return days[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
    + ' at ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UTC';
}

// The ES5 twin of the build-time maths. It has to produce byte-identical text for the default
// inputs, which is what test/toolkit-families.test.js checks, so the two implementations follow
// the same steps in the same order and only the host of the clock differs.
const SCRIPT_CLOCK = `
var $=function(id){return document.getElementById(id);};
var ZA=__ZONEA__,ZB=__ZONEB__,NA=__CITYA__,NB=__CITYB__;
function pad(n){return n<10?'0'+n:''+n;}
// One DateTimeFormat per zone, cached exactly as city-zones.js caches it. Without the cache this
// loop builds 730 formatters per render — a third of a second of jank on a mid-range phone every
// time anybody types a date, for the same object over and over.
var FP={};
function parts(t,tz){var f=FP[tz];if(!f)f=FP[tz]=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hourCycle:'h23',year:'numeric',
 month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});var o={},a=f.formatToParts(t);
 for(var i=0;i<a.length;i++){if(a[i].type!=='literal')o[a[i].type]=a[i].value;}
 o.y=+o.year;o.mo=+o.month;o.d=+o.day;o.h=(+o.hour)%24;o.mi=+o.minute;o.s=+o.second;return o;}
function wall(t,tz){var p=parts(t,tz);return Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi,p.s);}
function off(tz,t){return Math.round((wall(t,tz)-t.getTime())/60000);}
function at(tz,y,mo,d,hh,mi){var want=Date.UTC(y,mo,d,hh,mi),t=want-off(tz,new Date(want))*60000,k,p,got;
 for(k=0;k<3;k++){p=parts(new Date(t),tz);got=Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi);if(got===want)break;t-=got-want;}
 return t;}
function gmt(m){var s=m<0?'\u2212':'+';var a=Math.abs(m),h=Math.floor(a/60),mm=a%60;
 return 'GMT'+(mm?s+h+':'+(mm<10?'0'+mm:mm):s+h);}
function dlabel(m){var a=Math.abs(m),h=Math.floor(a/60),mm=Math.round(a%60);
 if(!mm)return h+(h===1?' hour':' hours');if(!h)return mm+(mm===1?' minute':' minutes');return h+' h '+mm+' min';}
function clk(m){var x=((m%1440)+1440)%1440;return pad(Math.floor(x/60))+':'+pad(x%60);}
function shift(n){if(n===0)return 'the same day';if(n===1)return 'the next day';if(n===-1)return 'the previous day';
 return n>0?n+' days later':(-n)+' days earlier';}
function nextChange(tz,from){var end=from+200*86400000,base=off(tz,new Date(from));
 if(off(tz,new Date(end))===base)return null;var lo=from,hi=end,mid;
 while(hi-lo>1000){mid=Math.floor((lo+hi)/2);if(off(tz,new Date(mid))===base)lo=mid;else hi=mid;}
 return Math.floor(hi/60000)*60000;}
var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAY=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function longDate(t){if(t===null)return null;var d=new Date(t);
 return DAY[d.getUTCDay()]+' '+d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+d.getUTCFullYear()
 +' at '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+' UTC';}
function iso(y,mo,d){return y+'-'+pad(mo+1)+'-'+pad(d);}
function doy(y,i){var t=new Date(Date.UTC(y,0,1+i));return t.getUTCFullYear()+'-'+pad(t.getUTCMonth()+1)+'-'+pad(t.getUTCDate());}
function segments(y,za,zb){var out=[],start=0,cur=off(za,new Date(Date.UTC(y,0,1,12)))-off(zb,new Date(Date.UTC(y,0,1,12))),
 days=((y%4===0&&y%100!==0)||y%400===0)?366:365,v,d;
 for(d=1;d<=days;d++){v=d<days?off(za,new Date(Date.UTC(y,0,1+d,12)))-off(zb,new Date(Date.UTC(y,0,1+d,12))):null;
  if(d===days||v!==cur){out.push({from:doy(y,start),to:doy(y,d-1),minutes:cur});cur=v;start=d;}}
 return out;}
function bad(m){$('cl-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+m;}
function render(){var v=$('cl-date').value,hv=$('cl-time').value;
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(v))return bad('Pick a date in the form 2026-07-15.');
 if(!/^([01]?\\d|2[0-3]):[0-5]\\d$/.test(hv))return bad('The time must be HH:MM on a 24-hour clock.');
 var y=+v.slice(0,4),mo=+v.slice(5,7)-1,d=+v.slice(8,10),h=+hv.slice(0,2),mi=+hv.slice(3,5);
 var noon=Date.UTC(y,mo,d,12),oa=off(ZA,new Date(noon)),ob=off(ZB,new Date(noon)),diff=oa-ob;
 var tA=at(ZA,y,mo,d,h,mi),pb=parts(new Date(tA),ZB),pa=parts(new Date(tA),ZA);
 var want=clk(h*60+mi),got=clk(pa.h*60+pa.mi),oaA=off(ZA,new Date(tA)),obB=off(ZB,new Date(tA)),note='';
 if(want!==got){note='<span class="tl-badge tl-no">that time did not exist</span> '+want+' is not a time '+NA+'’s clock showed on '+iso(y,mo,d)+' — that clock jumped forward past it — so the rows below are worked from '+got+' instead.';}
 else{var bfr=parts(new Date(tA-3600000),ZA),aft=parts(new Date(tA+3600000),ZA);
  var sb=clk(bfr.h*60+bfr.mi)===want,sa=clk(aft.h*60+aft.mi)===want;
  if(sb||sa)note='<span class="tl-badge tl-no">that time happened twice</span> '+want+' is a time '+NA+'’s clock showed twice on '+iso(y,mo,d)+' — that clock fell back — so the rows below are worked from the '+(sb?'second':'first')+' of the two readings.';}
 var dayDelta=Math.round((Date.UTC(pb.y,pb.mo-1,pb.d)-Date.UTC(pa.y,pa.mo-1,pa.d))/86400000);
 var Bpb=pb.h*60+pb.mi,ov=[],x;
 for(x=9;x<17;x++){var inB=((x*60+ob-oa)%1440+1440)%1440;if(inB>=540&&inB<1020)ov.push(x);}
 var segs=segments(y,ZA,ZB),ca=nextChange(ZA,noon),cb=nextChange(ZB,noon),n=segs.length,i,nowSeg=null;
 for(i=0;i<n;i++){if(segs[i].from<=v&&v<=segs[i].to)nowSeg=segs[i];}
 var fixed=diff===0&&segs.length===1&&segs[0].minutes===0;
 var head=fixed?NA+' and '+NB+' are on the same clock, all year':(diff===0?NA+' and '+NB+' show the same time on '+iso(y,mo,d):(diff>0?NA+' is '+dlabel(diff)+' ahead of '+NB:NB+' is '+dlabel(-diff)+' ahead of '+NA));
 var html=note+'<div class="tl-big">'+head+'</div><table class="tl-tab"><tbody>';
 html+='<tr><td>'+NA+' on '+iso(y,mo,d)+'</td><td>'+got+' ('+gmt(oaA)+')</td></tr>';
 html+='<tr><td>'+NB+' at that instant</td><td>'+clk(Bpb)+' '+shift(dayDelta)+' ('+gmt(obB)+')</td></tr>';
 html+='<tr><td>Difference on this date</td><td>'+(diff===0?'none':dlabel(diff))+(nowSeg?' ('+nowSeg.from+' to '+nowSeg.to+')':'')+'</td></tr>';
 for(i=0;i<n;i+=1)html+='<tr><td>'+segs[i].from+' to '+segs[i].to+'</td><td>'+(segs[i].minutes===0?'same clock':dlabel(segs[i].minutes))+'</td></tr>';
 html+='<tr><td>Next clock change, '+NA+'</td><td>'+(longDate(ca)||'none in the next 200 days')+'</td></tr>';
 html+='<tr><td>Next clock change, '+NB+'</td><td>'+(longDate(cb)||'none in the next 200 days')+'</td></tr>';
 html+='<tr><td>09:00 in '+NA+' is</td><td>'+clk((((9*60+ob-oa)%1440)+1440)%1440)+' in '+NB+'</td></tr>';
 html+='<tr><td>12:00 in '+NA+' is</td><td>'+clk((((12*60+ob-oa)%1440)+1440)%1440)+' in '+NB+'</td></tr>';
 html+='<tr><td>18:00 in '+NA+' is</td><td>'+clk((((18*60+ob-oa)%1440)+1440)%1440)+' in '+NB+'</td></tr>';
 html+='<tr><td>Shared 09:00–17:00 working window</td><td>'+(ov.length?clk(ov[0]*60)+'–'+clk((ov[ov.length-1]+1)*60)+' in '+NA+', '+clk(ov[0]*60+ob-oa)+'–'+clk((ov[ov.length-1]+1)*60+ob-oa)+' in '+NB:'none — there is no hour that is inside 09:00–17:00 in both')+'</td></tr>';
 html+='</tbody></table><p class="meta">Computed from the IANA zones '+ZA+' and '+ZB+' by this device’s own time-zone database, so nothing is fetched and nothing is sent. A database older than the last rule change gives the old answer; governments do move these dates at short notice.</p>';
 $('cl-out').innerHTML=html;}
$('cl-go').onclick=render;$('cl-date').oninput=render;$('cl-time').oninput=render;render();`;

// The four families are built once at require time. The clock family also takes a reference date,
// which the tests pin so a published figure never depends on when the suite ran; production passes
// nothing and gets today.
function buildClock(refDate) {
  // Normalised to noon UTC of the reference day. The baked card and the browser script must read
  // every offset at the same instant, and a boot at 23:50Z on a day some zone changes at 01:00Z
  // would otherwise bake a winter offset over a date whose noon is already summer.
  const seed = refDate || new Date();
  const ref = new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth(), seed.getUTCDate(), 12));
  const year = ref.getUTCFullYear();

  // behaviour class = the whole year's daily offset sequence, memoised per zone id
  const sigOf = {};
  const classes = [];
  const indexByKey = {};
  CITIES.forEach((c, i) => {
    const zone = CZ.zoneFor(c);
    if (!sigOf[zone]) sigOf[zone] = CZ.yearSignature(zone, year);
    const key = sigOf[zone].join(',');
    if (indexByKey[key] === undefined) {
      const sig = sigOf[zone];
      // Whether this rule moves its clocks at all, which the prose on the page turns on: "both
      // sides step together" and "nothing moves here" are different explanations of the same
      // flat difference table, and picking the wrong one is the kind of confident paragraph a
      // generator writes when nobody reads it.
      let changes = false;
      for (let d = 1; d < sig.length; d += 1) if (sig[d] !== sig[d - 1]) changes = true;
      indexByKey[key] = classes.length;
      classes.push({ zone, sig, changes, rep: c, repIndex: i, members: [c] });
    } else {
      classes[indexByKey[key]].members.push(c);
    }
  });

  // Every pair of behaviours is a page, and this order is what decides which of them a visitor
  // reaches first: the hub lists sixty to a page and a tool page chips six of its neighbours, so
  // without a ranking the front of the shelf would be whatever dataset order happened to put
  // there. The famous cities are ranked and a pair is ordered by the rank of its representatives,
  // with dataset order behind it as the tie-break.
  const CLOCK_RANK = {};
  ['New York City', 'London', 'Tokyo', 'Paris', 'Dubai', 'Sydney', 'Toronto', 'Los Angeles', 'Chicago',
    'Berlin', 'Madrid', 'Rome', 'Mumbai', 'New Delhi', 'Singapore', 'Shanghai', 'Beijing', 'Istanbul',
    'Cairo', 'Lagos', 'Johannesburg', 'Mexico City', 'São Paulo', 'Buenos Aires', 'Moscow', 'Riyadh',
    'Karachi', 'Dhaka', 'Bangkok', 'Seoul', 'Auckland', 'Miami', 'Dublin', 'Amsterdam', 'Lisbon',
    'Athens', 'Warsaw', 'Prague', 'Kyiv', 'Casablanca', 'Nairobi', 'Addis Ababa', 'Jakarta',
    'Kuala Lumpur', 'Manila', 'Hanoi', 'Osaka', 'Doha', 'Abu Dhabi', 'Tel Aviv', 'Frankfurt',
    'Melbourne', 'Cape Town'].forEach((n, i) => { CLOCK_RANK[n] = i + 1; });
  // A typo in the ranking list would silently push that city to the back of the shelf, so every
  // name in it has to be one the dataset actually holds. Checked per build rather than once at
  // require time because the tests build the family against a pinned date.
  const inDataset = {};
  CITIES.forEach((c) => { inDataset[c.name] = true; });
  Object.keys(CLOCK_RANK).forEach((n) => {
    if (!inDataset[n]) throw new Error('buildClock: ranked city "' + n + '" is not in kota-data.json');
  });
  const rankOf = (cls) => CLOCK_RANK[cls.rep.name] || 999;

  const pairs = [];
  for (let i = 0; i < classes.length; i += 1) {
    for (let j = i + 1; j < classes.length; j += 1) pairs.push([i, j]);
  }
  pairs.sort((p, q) => (rankOf(classes[p[0]]) + rankOf(classes[p[1]])
    - rankOf(classes[q[0]]) - rankOf(classes[q[1]])) || (p[0] - q[0]) || (p[1] - q[1]));

  return pairs.map((p) => {
    const A = classes[p[0]], B = classes[p[1]];
    const oa = CZ.offsetMinutes(A.zone, ref), ob = CZ.offsetMinutes(B.zone, ref);
    return clockEntry(A, B, diffSegments(A.sig, B.sig, year), oa, ob,
      CZ.nextChange(A.zone, ref), CZ.nextChange(B.zone, ref), CZ.workingOverlap(oa, ob), ref, year);
  });
}

function clockEntry(A, B, segs, oa, ob, ca, cb, ov, ref, year) {
  const a = A.rep, b = B.rep;
  const slug = 'time-difference-' + CITY_SLUG[A.repIndex] + '-' + CITY_SLUG[B.repIndex];
  const diff = oa - ob;
  const refDate = ref.toISOString().slice(0, 10);
  // Two zones can agree today without agreeing all year — a fixed +02:00 and a +01:00/+02:00 zone
  // do exactly that in July. The headline has to say which of the two the visitor is looking at,
  // because "same clock" unqualified would be a lie for half the calendar. The first branch cannot
  // be reached by a published page: classes are keyed on their whole-year offset sequence, so two
  // zones that never differ are one class and never form a pair. It stays because the browser
  // script computes the same condition for a date the visitor picks, and the two sides have to
  // agree row for row.
  const sameAllYear = segs.length === 1 && segs[0].minutes === 0;
  // Direction comes from the signed difference: an earlier draft printed the absolute value and
  // told Lagos it was ahead of Tokyo.
  const headLine = sameAllYear ? a.name + ' and ' + b.name + ' are on the same clock, all year'
    : diff === 0 ? a.name + ' and ' + b.name + ' show the same time on ' + refDate
    : diff > 0 ? a.name + ' is ' + dlabelFor(diff) + ' ahead of ' + b.name
    : b.name + ' is ' + dlabelFor(-diff) + ' ahead of ' + a.name;
  const relation = diff === 0
    ? (sameAllYear ? 'identical, and they stay identical all year' : 'identical on this date, though not on every date of ' + year)
    : 'apart by ' + dlabelFor(diff) + ', with ' + (diff > 0 ? a.name : b.name) + ' ahead';
  // The cities this pair absorbs. Naming them is what makes the economy an improvement rather than
  // a loss: a visitor after Alexandria gets the answer on the page that carries it, because
  // Alexandria's clock is the same law Cairo's is, and the shelf does not have to mint a second
  // page of identical arithmetic to cover the query.
  const others = A.members.length + B.members.length - 2;
  const otherNames = A.members.concat(B.members).filter((c) => c !== a && c !== b).slice(0, 5).map((c) => c.name);
  // B-local of the instant that is h:00 A-local: the two readings of one instant differ by
  // offB − offA, so the difference is subtracted. Getting this sign the other way round mirrors
  // every published window through midday and still looks right, which is why the card's own
  // "at that instant" row and test/city-zones.test.js both check it against a real conversion.
  const anchor = (h) => ((((h * 60 - diff) % 1440) + 1440) % 1440);
  const ovText = ov.length
    ? clockText(ov[0] * 60) + '–' + clockText((ov[ov.length - 1] + 1) * 60) + ' in ' + a.name
      + ', ' + clockText(anchor(ov[0])) + '–' + clockText(anchor(ov[ov.length - 1] + 1)) + ' in ' + b.name
    : 'none — there is no hour that is inside 09:00–17:00 in both';
  const segText = segs.map((s) => s.from + ' → ' + s.to + ': ' + (s.minutes === 0 ? 'same clock' : dlabelFor(s.minutes))).join('; ');
  const changeA = ca ? longDate(ca) : 'none in the next 200 days';
  const changeB = cb ? longDate(cb) : 'none in the next 200 days';
  // The instant the card describes: noon in A on the reference date, read out in both zones — the
  // same three calls SCRIPT_CLOCK makes, in the same order.
  const tA = CZ.instantFor(A.zone, year, ref.getUTCMonth(), ref.getUTCDate(), 12, 0);
  const pa = CZ.partsIn(A.zone, new Date(tA));
  const pb = CZ.partsIn(B.zone, new Date(tA));
  const dayDelta = Math.round((Date.UTC(pb.year, pb.month - 1, pb.day)
    - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000);
  const nowSeg = segs.filter((s) => s.from <= refDate && refDate <= s.to).pop() || null;
  // A wall clock can skip an hour (spring forward) or repeat one (fall back), so the time that was
  // asked for is not always the time the conversion is worked from. Both notes are computed on this
  // side too rather than assumed away: the baked card asks for noon, which no rule in the table
  // jumps over, but the browser script answers whatever a visitor types, and the two strings have
  // to be produced by the same logic for the two pages to be the same page.
  const wantHm = clockText(12 * 60);
  const gotHm = clockText(pa.hour * 60 + pa.minute);
  const oaAt = CZ.offsetMinutes(A.zone, new Date(tA));
  const obAt = CZ.offsetMinutes(B.zone, new Date(tA));
  let noteHm = '';
  if (wantHm !== gotHm) {
    noteHm = '<span class="tl-badge tl-no">that time did not exist</span> ' + wantHm + ' is not a time '
      + a.name + '’s clock showed on ' + refDate + ' — that clock jumped forward past it — so the rows'
      + ' below are worked from ' + gotHm + ' instead.';
  } else {
    const bfr = CZ.partsIn(A.zone, new Date(tA - 3600000));
    const aft = CZ.partsIn(A.zone, new Date(tA + 3600000));
    const sb = clockText(bfr.hour * 60 + bfr.minute) === wantHm;
    const sa = clockText(aft.hour * 60 + aft.minute) === wantHm;
    if (sb || sa) {
      noteHm = '<span class="tl-badge tl-no">that time happened twice</span> ' + wantHm + ' is a time '
        + a.name + '’s clock showed twice on ' + refDate + ' — that clock fell back — so the rows below'
        + ' are worked from the ' + (sb ? 'second' : 'first') + ' of the two readings.';
    }
  }
  // Baked twin of render(). test/toolkit-families.test.js runs the script in a stub DOM and
  // requires the two strings to be equal for every member, so a row cannot be added on one side
  // alone and the page can never show one answer before interaction and another after.
  const card = noteHm + '<div class="tl-big">' + headLine + '</div><table class="tl-tab"><tbody>'
    + '<tr><td>' + a.name + ' on ' + refDate + '</td><td>' + gotHm + ' (' + gmtLabel(oaAt) + ')</td></tr>'
    + '<tr><td>' + b.name + ' at that instant</td><td>' + clockText(pb.hour * 60 + pb.minute) + ' '
      + dayPhrase(dayDelta) + ' (' + gmtLabel(obAt) + ')</td></tr>'
    + '<tr><td>Difference on this date</td><td>' + (diff === 0 ? 'none' : dlabelFor(diff))
      + (nowSeg ? ' (' + nowSeg.from + ' to ' + nowSeg.to + ')' : '') + '</td></tr>'
    + segs.map((s) => '<tr><td>' + s.from + ' to ' + s.to + '</td><td>'
      + (s.minutes === 0 ? 'same clock' : dlabelFor(s.minutes)) + '</td></tr>').join('')
    + '<tr><td>Next clock change, ' + a.name + '</td><td>' + changeA + '</td></tr>'
    + '<tr><td>Next clock change, ' + b.name + '</td><td>' + changeB + '</td></tr>'
    + '<tr><td>09:00 in ' + a.name + ' is</td><td>' + clockText(anchor(9)) + ' in ' + b.name + '</td></tr>'
    + '<tr><td>12:00 in ' + a.name + ' is</td><td>' + clockText(anchor(12)) + ' in ' + b.name + '</td></tr>'
    + '<tr><td>18:00 in ' + a.name + ' is</td><td>' + clockText(anchor(18)) + ' in ' + b.name + '</td></tr>'
    + '<tr><td>Shared 09:00–17:00 working window</td><td>' + ovText + '</td></tr>'
    + '</tbody></table>' + clockMeta(A.zone, B.zone);
  // The prose has to follow the arithmetic, not the other way round: a shelf that told every pair
  // "the gap changes during the year" would be wrong for the majority of the world, where the gap
  // is fixed because neither side moves its clocks.
  const gapPhrase = diff === 0 ? 'the same clock' : dlabelFor(diff) + ' apart';
  const whyHeading = segs.length > 1
    ? 'Why the gap between ' + a.name + ' and ' + b.name + ' changes during ' + year
    : 'Why ' + a.name + ' and ' + b.name + ' keep a fixed gap all year';
  const whyPara = segs.length > 1
    ? `<p>Two places drift apart and come back again whenever one of them changes its clocks and the other does not — which is the situation between a place that observes daylight saving and one that does not, or between two that pick different Sundays for it. In ${year} the difference between ${a.name} and ${b.name} runs: ${segText}. A meeting arranged in the middle of one of those runs is safe; one arranged across a boundary is the classic four-hours-late call, so the table names the boundaries instead of leaving you to remember them.</p>`
    : (A.changes && B.changes
      ? `<p>Both places do change their clocks, and the gap still never moves, because the two moves are the same size on the same instant — ${a.name} and ${b.name} sit under rules that step together, which is what keeps them <b>${gapPhrase}</b> through ${year}. It is the most common arrangement inside a single bloc: the whole of the European Union, for example, turns its clocks at the same UTC moment, so no pair inside it ever has a moving difference despite both sides observing daylight saving.</p>`
      : `<p>Nothing moves here. ${a.name} keeps ${gmtLabel(oa)} and ${b.name} keeps ${gmtLabel(ob)} the whole year round, because neither jurisdiction changes its clocks — the arrangement most of the world's population lives under, since daylight saving has been abandoned or never adopted across much of Asia, Africa and the Americas outside the United States and Canada, and near the equator there is little daylight to shift in the first place. So the two are <b>${gapPhrase}</b> in January and in July alike, and choosing a date on this page changes the arithmetic, not the answer.</p>`);
  const changeSentence = (c, city, zone) => (c
    ? city + ' uses the zone <code>' + zone + '</code>, and its next change after ' + refDate + ' is <b>' + longDate(c) + '</b>'
    : city + ' uses the zone <code>' + zone + '</code>, which does not change its clocks');
  const overlapPara = ov.length
    ? `Both places are inside their own 09:00–17:00 on <b>${ov.length} hour${ov.length === 1 ? '' : 's'}</b> of the day: ${ovText} — outside those hours somebody is starting early, finishing late or taking the call at midnight.`
    : `There is <b>no hour</b> that falls inside 09:00–17:00 on both sides — ${ovText} — so any call is somebody’s out-of-hours and the honest thing is to rotate it.`;
  return {
    slug, ic: '🕒', cat: 'clock',
    name: a.name + ' ↔ ' + b.name + ' Time Difference',
    title: a.name + ' vs ' + b.name + ' Time Difference — Clock Change Dates & Best Call Window | Tukuk-OS',
    desc: (sameAllYear
      ? a.name + ' and ' + b.name + ' keep one clock (' + gmtLabel(oa) + ') all year. '
      : diff === 0
        ? a.name + ' and ' + b.name + ' show the same time on ' + refDate + ', but not on every date. '
        : (diff > 0 ? a.name + ' is ' + dlabelFor(diff) + ' ahead of ' + b.name
          : b.name + ' is ' + dlabelFor(-diff) + ' ahead of ' + a.name) + ' on ' + refDate + '. ')
      + 'Change dates, call window and any date you pick, in your browser.',
    hero: a.name + ' to ' + b.name + ' time',
    sub: headLine + ' · ' + gmtLabel(oa) + ' vs ' + gmtLabel(ob),
    navBlurb: 'The clock difference between ' + a.name + ' and ' + b.name + ' on any date, with both change dates and the shared working hours.',
    hubBlurb: headLine + ' — the instant each side changes its clocks and the hours they overlap',
    lead: 'On <b>' + refDate + '</b> the two clocks are <b>' + relation + '</b>. ' + a.name + ' runs on <b>'
      + gmtLabel(oa) + '</b> and ' + b.name + ' on <b>' + gmtLabel(ob) + '</b>. Across '
      + year + ' the difference runs: ' + segText + '. Pick any date and time below and the page reworks the whole table from your own device.',
    form: `<div class="tl-form">
  <label>Date in ${a.name} <input id="cl-date" type="date" value="${refDate}"></label>
  <label>Time in ${a.name} <input id="cl-time" type="text" inputmode="numeric" value="12:00" autocomplete="off" spellcheck="false"></label>
  <button class="tl-btn primary" id="cl-go" type="button">Convert</button>
</div>
<div class="tl-res" id="cl-out">${card}</div>`,
    script: SCRIPT_CLOCK
      .replace('__ZONEA__', JSON.stringify(A.zone)).replace('__ZONEB__', JSON.stringify(B.zone))
      .replace('__CITYA__', JSON.stringify(a.name)).replace('__CITYB__', JSON.stringify(b.name)),
    seo: `<h2 class="section-title">${whyHeading}</h2>
  ${whyPara}
  <h2 class="section-title">The clock changes, and who decides them</h2>
  <p>${changeSentence(ca, a.name, A.zone)}. ${changeSentence(cb, b.name, B.zone)}. Neither figure is a physical fact: an offset is legislation, and the same fifteen degrees of longitude can sit under three zones because a border runs through it. That is why this page reads its offsets out of the time-zone database built into your own browser instead of hardcoding a table of abbreviations — it is the database your operating system already keeps current, and it is what puts ${a.name} and ${b.name} in the right relation even when a government moves a date at short notice. A device whose database predates the last change gets the old answer, which is the one caveat worth knowing.</p>
  <h2 class="section-title">What it is actually like to work across the two</h2>
  <p>${overlapPara} ${others > 0 ? 'The two clock rules here are not unique to these two places: ' + others + ' other cities in our dataset keep the same clock as one of them, including ' + otherNames.join(', ') + ', so looking any of those up against the city on the other side of the pair gives this page’s answers.' : 'No other city in our dataset keeps either of these two clock rules, which is why this pair stands on its own.'} The arithmetic is the three lines the page runs in front of you: read each zone’s offset for the date you picked, subtract, and let the modulo handle the dateline.</p>`,
  };
}

// Text helpers kept here so the baked card and the browser script cannot drift into two formats.
function dlabelFor(minutes) { return CZ.diffLabel(minutes); }
function gmtLabel(minutes) { return CZ.gmtLabel(minutes); }
function clockText(minutes) { return CZ.clockText(minutes); }

// The disclosure line, identical to the one SCRIPT_CLOCK appends inside the same result card.
function clockMeta(zoneA, zoneB) {
  return '<p class="meta">Computed from the IANA zones ' + zoneA + ' and ' + zoneB
    + ' by this device’s own time-zone database, so nothing is fetched and nothing is sent. A database older than the last rule change gives the old answer; governments do move these dates at short notice.</p>';
}

const DISTANCES = buildDistances();
const COORDS = buildCoords();
const ANTIPODES = buildAntipodes();
const CLOCK = buildClock();

module.exports = {
  FAMILY_ENTRIES: DISTANCES.concat(COORDS, ANTIPODES, CLOCK),
  COUNTS: {
    distances: DISTANCES.length,
    coordinates: COORDS.length,
    antipodes: ANTIPODES.length,
    clock: CLOCK.length,
    cities: CITIES.length,
  },
  // exposed for the tests so the maths is provable independently of the pages
  _internals: { gcKm, bearingDeg, meridianKm, parallelRadiusKm, geohash, dms, slugify, CITIES, normLon,
    buildClock, buildDistances, diffSegments, segDate, longDate, dayPhrase, clockMeta, CITY_SLUG,
    SCRIPT_CLOCK },
};
