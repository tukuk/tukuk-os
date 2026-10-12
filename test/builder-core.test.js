'use strict';
// Ujian enjin Pembina Aplikasi (/builder). `widgetMarkup` (penjana HTML setiap
// widget) + `runtimeJS` (skrip kecil dalam fail eksport) + `esc` + `TYPES`
// Diekstrak terus daripada public/builder.html — sumber sebenar yang dihantar ke
// pelayar — lalu dijalankan dalam sandbox. Menguji output eksport tanpa pelayar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'builder.html'), 'utf8');

// Ambil satu `function NAMA(...) { ... }` lengkap dengan pengiraan kurung berantai.
function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('fungsi tidak ditemui: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('kurung tak seimbang: ' + name);
}
// Ambil satu baris `const NAMA = ...;`
function extractLine(src, prefix) {
  const line = src.split('\n').find((l) => l.trim().startsWith(prefix));
  if (!line) throw new Error('baris tidak ditemui: ' + prefix);
  return line.trim();
}
// Ambil satu `const NAMA = { ... };` objek berbilang baris (padan '\n};').
function extractObj(src, decl) {
  const s = src.indexOf(decl);
  if (s < 0) throw new Error('objek tidak ditemui: ' + decl);
  const e = src.indexOf('\n};', s);
  if (e < 0) throw new Error('penutup tidak ditemui: ' + decl);
  return src.slice(s, e + 3);
}

const codeMarkup = extractFn(html, 'widgetMarkup');
const codeRuntime = extractFn(html, 'runtimeJS');
const codeGameBox = extractFn(html, 'gameBox');
const esc = new Function(extractLine(html, 'const esc =') + '; return esc;')();
const TYPES = new Function(extractObj(html, 'const TYPES = {') + '; return TYPES;')();

const THEME = { accent:'#4c8dff', bg:'#ffffff', fg:'#111111', dark:false, radius:14, font:'system-ui', sub:'s' };

// Bind widgetMarkup pada tema (theme, esc, gameBox disuntik sebagai param).
function markup(w, theme = THEME) {
  const gb = new Function('esc', 'theme', codeGameBox + '; return gameBox;')(esc, theme);
  const f = new Function('theme', 'esc', 'gameBox', codeMarkup + '; return widgetMarkup;');
  return f(theme, esc, gb)(w);
}
// runtimeJS merujuk initGames (global); suntik stub agar boleh diuji tanpa enjin penuh.
function runtime() { return new Function('initGames', codeRuntime + '; return runtimeJS;')(function initGames(){})(); }

test('esc: escape HTML (tiada XSS tembus ke eksport)', () => {
  assert.equal(esc('<b>&"x"'), '&lt;b&gt;&amp;&quot;x&quot;');
  assert.equal(esc(null), '');
});

test('heading: tahap & jajar dihormati, teks di-escape', () => {
  const out = markup({ type:'heading', text:'<i>Hi</i>', level:3, align:'center' });
  assert.match(out, /^<h3 /);
  assert.ok(out.includes('text-align:center'));
  assert.ok(out.includes('&lt;i&gt;Hi&lt;/i&gt;'));
  assert.ok(!out.includes('<i>Hi'), 'teks mentah tidak boleh tembus');
});

test('button: dengan href → <a target=_blank>; tanpa href → <button noop>', () => {
  const withHref = markup({ type:'button', label:'Buka', href:'https://tukuk.org', variant:'primary', fullWidth:false });
  assert.ok(withHref.includes('<a href="https://tukuk.org"'));
  assert.ok(withHref.includes('rel="noopener"'));
  const noHref = markup({ type:'button', label:'Klik', href:'', fullWidth:true });
  assert.ok(noHref.includes('<button') && noHref.includes('data-act="noop"'));
  assert.ok(noHref.includes('width:100%'), 'fullWidth wajar CSS lebar penuh');
});

test('image: src kosong → placeholder; src dataURL → <img> + radius', () => {
  assert.ok(markup({ type:'image', src:'', alt:'a', radius:12, caption:'' }).includes('Imej (belum dipilih)'));
  const real = markup({ type:'image', src:'data:image/png;base64,AAAA', alt:'kucing', radius:20, caption:'saya' });
  assert.ok(real.includes('<img src="data:image/png;base64,AAAA"'));
  assert.ok(real.includes('border-radius:20px'));
  assert.ok(real.includes('saya'));
});

test('counter: bawa data-step & nilai awal (runtime eksport bergantung padanya)', () => {
  const out = markup({ type:'counter', id:'c1', label:'Bilangan', value:7, step:3 });
  assert.ok(out.includes('data-step="3"'), 'langkah mesti tertanam untuk JS eksport');
  assert.ok(out.includes('data-w="c1"'));
  assert.ok(/>7</.test(out), 'nilai awal muncul');
});

test('list: item jadi <li>, benar tambah → form data-list, padam → listdel', () => {
  const out = markup({ type:'list', items:['a','b'], allowAdd:true });
  assert.equal((out.match(/<li/g) || []).length, 2);
  assert.ok(out.includes('data-list'));
  assert.ok(out.includes('data-act="listdel"'));
  const noAdd = markup({ type:'list', items:['x'], allowAdd:false });
  assert.ok(!noAdd.includes('data-list'), 'tiada form bila allowAdd mati');
});

test('toggle & input: keadaan awal & jenis dipantul', () => {
  assert.match(markup({ type:'toggle', label:'On', on:true }), /type="checkbox" checked/);
  assert.doesNotMatch(markup({ type:'toggle', label:'Off', on:false }), /checked/);
  assert.ok(markup({ type:'input', label:'Umur', placeholder:'n', kind:'number' }).includes('type="number"'));
});

test('faq: setiap item → soalan boleh klik + jawapan tersembunyi (class ans)', () => {
  const out = markup({ type:'faq', items:[{q:'Soal 1', a:'Jawab 1'}, {q:'Soal 2', a:'Jawab 2'}] });
  assert.equal((out.match(/data-act="faq"/g) || []).length, 2);
  assert.equal((out.match(/class="ans"/g) || []).length, 2);
  assert.ok(out.includes('display:none'), 'jawapan mesti tersembunyi mula-mula');
  assert.ok(out.includes('Soal 1') && out.includes('Jawab 2'));
});

test('steps: senarai bernombor <ol> ikut bilangan langkah + tajuk', () => {
  const out = markup({ type:'steps', title:'Cara', items:['Satu', 'Dua', 'Tiga'] });
  assert.match(out, /<ol/);
  assert.equal((out.match(/<li/g) || []).length, 3);
  assert.ok(out.includes('Cara'));
});

test('quiz: container bawa data-answer; setiap pilihan button data-i', () => {
  const out = markup({ type:'quiz', q:'Ibukota?', options:['KL', 'SG', 'BKK'], answer:1 });
  assert.ok(out.includes('data-quiz'));
  assert.ok(out.includes('data-answer="1"'));
  assert.equal((out.match(/data-act="quiz"/g) || []).length, 3);
  assert.ok(out.includes('data-i="2"'));
});

test('runtimeJS: parse bersih & urus kaunter/list-del/faq/quiz/submit', () => {
  const js = runtime();
  new Function(js); // mesti JS yang sah
  assert.ok(js.includes('listdel'));
  assert.ok(js.includes('data-act="inc"'));
  assert.ok(js.includes('[data-act="faq"]'), 'handler faq perlu ada');
  assert.ok(js.includes('[data-quiz]'), 'handler quiz perlu ada');
  assert.ok(js.includes("addEventListener('submit'"));
});

test('TYPES: 23 jenis, setiap make() kembalikan objek ber-`type` padan', () => {
  const keys = Object.keys(TYPES);
  assert.equal(keys.length, 23);
  for (const t of keys) assert.equal(TYPES[t].make().type, t);
});

// ── Paparan KOD: penyorak sintaks `highlight()` + struktur editor ──
const escHtml = new Function(extractLine(html, 'const escHtml=') + '; return escHtml;')();
const highlight = new Function('escHtml', extractFn(html, 'highlight') + '; return highlight;')(escHtml);

test('highlight: escape HTML (tiada tembus) & balut token dengan span kelas', () => {
  const out = highlight('<div class="x">&</div>');
  assert.ok(out.includes('&lt;div'), 'kurungan sudu di-escape');
  assert.ok(!out.includes('<div class="x">'), 'tag mentah tidak boleh tembus sebagai HTML hidup');
  assert.ok(out.includes('<span class="t">'), 'tag dibalut span t');
  const kw = highlight('function foo(){}');
  assert.ok(kw.includes('<span class="k">function</span>'), 'kata kunci JS disorak');
  const cm = highlight('<!-- nota -->');
  assert.ok(cm.includes('<span class="c">'), 'komen disorak kelas c');
});

test('codeView: editor + pratonton + butang ada dalam DOM builder', () => {
  for (const id of ['codeView','edTA','edPre','edCode','edGutter','edPreview','viewCode','viewDesign','codeRegen','codeCopy','codeDl','codeRun','codeRunChk','codeFmt'])
    assert.ok(html.includes('id="' + id + '"'), 'elemen hilang: #' + id);
  assert.ok(/iframe[^>]*sandbox="allow-scripts/.test(html), 'iframe pratonton mesti sandboxed');
});

test('codetabs: tiga tab HTML/CSS/JS wujud', () => {
  for (const t of ['html','css','js'])
    assert.ok(html.includes('data-ctab="' + t + '"'), 'tab hilang: ' + t);
});

// ── Auto-lengkap pasangan `applyKey()` (murni, diuji headless) ──
const NL = String.fromCharCode(10);
const ak = new Function(extractFn(html, 'applyKey') + '; return applyKey;')();

test('applyKey: buka pasangan → sisip penutup, caret di tengah', () => {
  const r = ak('ab', 1, 1, '(');
  assert.equal(r.text, 'a()b');
  assert.equal(r.caret, 2);
});

test('applyKey: taip penutup bersebelahan → skip-over (tiada sisipan)', () => {
  const r = ak('()', 1, 1, ')');
  assert.equal(r.text, '()');
  assert.equal(r.caret, 2);
});

test('applyKey: taip > pada tag buka → auto-tutup penuh', () => {
  const r = ak('<div', 4, 4, '>');
  assert.equal(r.text, '<div></div>');
  assert.equal(r.caret, 5);
});

test('applyKey: tag void / self-closing > → tiada auto-tutup (null)', () => {
  assert.equal(ak('<input', 6, 6, '>'), null);
  assert.equal(ak('<br/', 4, 4, '>'), null);
});

test('applyKey: ada pilihan + taip petik → balut pilihan, inner kekal terpilih', () => {
  const r = ak('hello', 0, 5, '"');
  assert.equal(r.text, '"hello"');
  assert.equal(r.caret, 1);
  assert.equal(r.selEnd, 6);
});

test('applyKey: Enter dalam {} → blok ber-indent, caret di baris tengah', () => {
  const r = ak('{}', 1, 1, 'Enter');
  assert.equal(r.text, '{' + NL + '  ' + NL + '}');
  assert.equal(r.caret, 4);
});

test('applyKey: Backspace antara pasangan → padam kedua-dua', () => {
  const r = ak('()', 1, 1, 'Backspace');
  assert.equal(r.text, '');
  assert.equal(r.caret, 0);
});

test('applyKey: aksara biasa / Backspace tak berpasangan → null (biar default)', () => {
  assert.equal(ak('a', 1, 1, 'x'), null);
  assert.equal(ak('ab', 1, 1, 'Backspace'), null);
});

test('exportCSS/buildDoc: komposisi fail berdiri sendiri sah & parameter dipatuhi', () => {
  const T = { dark:false, bg:'#fff', fg:'#111', font:'x', accent:'#abc', sub:'ss' };
  const exportCSS = new Function('theme','device', extractFn(html,'exportCSS') + '; return exportCSS;')(T,'phone')();
  assert.ok(exportCSS.includes('color-scheme:light'));
  assert.ok(exportCSS.includes('max-width:480px'), 'telefon max-width 480');
  const cssDesktop = new Function('theme','device', extractFn(html,'exportCSS') + '; return exportCSS;')(T,'desktop')();
  assert.ok(cssDesktop.includes('max-width:880px'), 'desktop max-width 880');
  const buildDoc = new Function('esc','theme', extractFn(html,'buildDoc') + '; return buildDoc;')(esc, T);
  const doc = buildDoc('<p>HI</p>', '.x{}', 'var a=1;', 'Namaku');
  assert.ok(doc.startsWith('<!DOCTYPE html>'));
  assert.ok(doc.includes('<style>.x{}</style>'), 'css disisip dalam <style>');
  assert.ok(doc.includes('<div class="appbar">Namaku</div>'), 'appbar guna nama');
  assert.ok(doc.includes('<p>HI</p>'), 'body disisip mentah');
  assert.ok(doc.includes('<script>var a=1;<') && doc.includes('/script></body></html>'), 'js disisip dalam <script>');
});

// ── Enjin permainan + ZIP ──
test('widgetMarkup: shell permainan benar (data-game + config)', () => {
  assert.ok(markup({ type:'ttt' }).includes('data-game="ttt"'));
  const mem = markup({ type:'memory', pairs:8 });
  assert.ok(mem.includes('data-game="memory"') && mem.includes('data-pairs="8"'));
  assert.ok(markup({ type:'guess', max:50 }).includes('data-max="50"'));
  assert.ok(markup({ type:'mole', duration:15 }).includes('data-duration="15"'));
  const br = markup({ type:'br', enemies:8, zoneSpeed:12, mapSize:900 });
  assert.ok(br.includes('data-game="br"') && br.includes('data-enemies="8"') && br.includes('data-zonespeed="12"') && br.includes('data-mapsize="900"'), 'br shell attrs');
  const fps = markup({ type:'fps', enemies:5, zoneSpeed:30 });
  assert.ok(fps.includes('data-game="fps"') && fps.includes('data-enemies="5"') && fps.includes('data-zonespeed="30"'), 'fps shell attrs');
  assert.ok(markup({ type:'runner' }).includes('data-game="runner"'), 'runner shell');
});

test('gameBox: placeholder Mod Cuba + data-acc tema', () => {
  const out = markup({ type:'rps' });
  assert.ok(out.includes('Mod Cuba'), 'perlua petunjuk Mod Cuba');
  assert.ok(out.includes('data-acc="' + THEME.accent + '"'), 'accent tema tertanam');
});

test('initGames: parse bersih + 9 cabang game', () => {
  const code = extractFn(html, 'initGames');
  new Function(code); // mesti JS sah
  for (const g of ['gTTT','gMemory','gMole','gRPS','gReaction','gGuess','gBR','gFPS','gRunner'])
    assert.ok(code.includes(g), 'cabang game hilang: ' + g);
});

test('runtimeJS: sertai enjin game (initGames) ke dalam eksport', () => {
  const js = runtime();
  new Function(js);
  assert.ok(js.includes('initGames'), 'runtime perlu muat initGames');
  assert.ok(js.includes('(document)'), 'initGames dipanggil atas document');
});

test('crc32: nilai piawai "123456789" = 0xCBF43926', () => {
  const crc = new Function(extractFn(html, 'crc32') + '; return crc32;')();
  assert.equal(crc(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('buildZip: tandatangan PK + nama fail + eocd hadir', () => {
  const crc = new Function(extractFn(html, 'crc32') + '; return crc32;')();
  const bz = new Function('crc32', extractFn(html, 'buildZip') + '; return buildZip;')(crc);
  const bytes = bz([{ name:'a.txt', data:'hello' }]);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([bytes[0], bytes[1], bytes[2], bytes[3]], [0x50, 0x4b, 0x03, 0x04], 'LFH signature');
  const s = new TextDecoder().decode(bytes);
  assert.ok(s.includes('a.txt'), 'nama fail tertanam');
  const e = bytes.length - 22; assert.deepEqual([bytes[e], bytes[e+1], bytes[e+2], bytes[e+3]], [0x50, 0x4b, 0x05, 0x06], 'EOCD signature (22 bait terakhir)');
});

// ── Kemudahan: auto-check, kongsi base64, meta SEO, sunting terus ──
const checkProject = new Function(
  extractFn(html, 'hexLum') + '\n' + extractFn(html, 'contrast') + '\n' + extractFn(html, 'checkProject') + '; return checkProject;'
)();
const contrastFn = new Function(extractFn(html, 'hexLum') + '\n' + extractFn(html, 'contrast') + '; return contrast;')();
const encodeProj = new Function(extractFn(html, 'encodeProj') + '; return encodeProj;')();
const decodeProj = new Function(extractFn(html, 'decodeProj') + '; return decodeProj;')();

test('checkProject: imej tanpa alt + pautan butang tak sah dikesan (dengan id widget)', () => {
  const iss = checkProject([{ id:'w1', type:'image', src:'data:x', alt:'' }, { id:'w2', type:'button', href:'javascript:x' }], { bg:'#ffffff', fg:'#000000' }, 'App');
  assert.ok(iss.some((x)=>x.id==='w1' && /alt/.test(x.msg)), 'alt hilang dikesan');
  assert.ok(iss.some((x)=>x.id==='w2' && /Pautan/.test(x.msg)), 'href tak sah dikesan');
});

test('checkProject: nama kosong + kontras rendah + projek kemas', () => {
  assert.ok(checkProject([], { bg:'#ffffff', fg:'#eeeeee' }, '').length >= 2, 'nama kosong + kontras rendah');
  const clean = checkProject([{ id:'w1', type:'heading', text:'Hi' }], { bg:'#ffffff', fg:'#000000' }, 'Ok');
  assert.equal(clean.length, 0, 'projik bersih → tiada isu');
});

test('contrast: hitam/putih ≈ 21; warna sama = 1', () => {
  assert.ok(contrastFn('#000000', '#ffffff') > 20.5, 'kontras maksimum');
  assert.equal(contrastFn('#777777', '#777777'), 1);
});

test('encodeProj/decodeProj: pusingan lengkap projek (unicode selamat)', () => {
  const obj = { appName:'Accióné 中文', theme:{ accent:'#abc' }, widgets:[{ id:'w1', type:'text', text:'hai' }] };
  assert.deepEqual(decodeProj(encodeProj(obj)), obj);
});

test('buildDoc: sisip meta description + og:title/og:description untuk SEO', () => {
  const T2 = { dark:false, bg:'#fff', fg:'#111', font:'x', accent:'#abc', sub:'ss', desc:'penerangan saya' };
  const bd = new Function('esc','theme', extractFn(html,'buildDoc') + '; return buildDoc;')(esc, T2);
  const doc = bd('<p>x</p>', '.y{}', 'z=1;', 'Nama');
  assert.ok(doc.startsWith('<!DOCTYPE html>'));
  assert.ok(doc.includes('name="description" content="penerangan saya"'), 'meta description');
  assert.ok(doc.includes('property="og:title" content="Nama"'), 'og:title');
  assert.ok(doc.includes('property="og:description"'), 'og:description');
  assert.ok(doc.includes('name="twitter:card" content="summary"'), 'twitter:card untuk pratonton sosial');
});

test('widgetMarkup: tanda data-edit hadir untuk suntingan terus (heading/text/card)', () => {
  assert.ok(markup({ type:'heading', text:'T', level:2, align:'left' }).includes('data-edit="text"'));
  assert.ok(markup({ type:'text', text:'x', align:'left' }).includes('data-edit="text"'));
  const card = markup({ type:'card', title:'tt', body:'bb' });
  assert.ok(card.includes('data-edit="title"') && card.includes('data-edit="body"'));
});

test('UI kemudahan: butang + modal + penunjuk simpan wujud dalam DOM', () => {
  for (const id of ['shareBtn','auditBtn','keysBtn','saveState','modal'])
    assert.ok(html.includes('id="' + id + '"'), 'elemen hilang: #' + id);
  assert.ok(html.includes('class="insSel"') || html.includes('insSel'), 'selit ＋ (insSel) perlu ada');
});

test('Terbitan: butang 🚀 + slug pilihan + 📦 Aplikasi Saya (kemas kini/buang) + hormati builderAssemble', () => {
  assert.ok(html.includes('id="pubBtn"'), 'butang Terbitkan wujud');
  assert.ok(html.includes('id="pubSlug"'), 'input slug pilihan wujud');
  assert.ok(html.includes("slug:($('pubSlug').value||'').trim().toLowerCase()||undefined"), 'pubBtn hantar body.slug');
  assert.ok(html.includes('id="myBtn"'), 'butang Aplikasi Saya wujud');
  assert.ok(html.includes("fetch('/api/publish'"), 'handler POST ke /api/publish');
  assert.ok(html.includes("fetch('/api/publish/update'"), 'kemas kini ke slug sama');
  assert.ok(html.includes("fetch('/api/publish/delete'"), 'buang/nyahterbit');
  assert.ok(html.includes('window.builderAssemble=assemble'), 'paparan Kod dedahkan assemble untuk terbitan');
});

// ── Game baru: Battle Royale + FPS Arena ──
test('gBR: fungsi wujud + raycast/canvas/DOM sah (parse sah sahaja)', () => {
  const code = extractFn(html, 'initGames');
  assert.ok(code.includes('function gBR'), 'gBR dalam initGames');
  assert.ok(code.includes("gBR(box,acc)"), 'dispatch gBR ada');
  assert.ok(code.includes("cvs.addEventListener('click'"), 'gBR guna canvas click');
  new Function(code); // parse sah (tiada syntax error)
});

test('gFPS: fungsi wujud + castRay/wallD/DOM sah (parse sah sahaja)', () => {
  const code = extractFn(html, 'initGames');
  assert.ok(code.includes('function gFPS'), 'gFPS dalam initGames');
  assert.ok(code.includes('function castRay'), 'castRay helper dalam gFPS');
  assert.ok(code.includes('wallD'), 'wallD untuk oklusi sprite');
  new Function(code);
});

test('gRunner: fungsi wujud + graviti/lompat/skor tertinggi (parse sah)', () => {
  const code = extractFn(html, 'initGames');
  assert.ok(code.includes('function gRunner'), 'gRunner dalam initGames');
  assert.ok(code.includes("gRunner(box,acc)"), 'dispatch gRunner ada');
  assert.ok(code.includes("function setBest"), 'helper skor tertinggi wujud');
  assert.ok(code.includes("function getBest"), 'helper baca rekod wujud');
  new Function(code);
});

test('Papan pendahulu: helper submit/top/draw + dipanggil untuk br/fps/runner', () => {
  const code = extractFn(html, 'initGames');
  assert.ok(code.includes('function lbSubmit'), 'helper hantar skor');
  assert.ok(code.includes('function lbTop'), 'helper baca papan');
  assert.ok(code.includes('function drawLb'), 'helper gamabar papan');
  for (const g of ['br', 'fps', 'runner']) assert.ok(code.includes("lbSubmit('" + g + "'"), 'submit dipanggil untuk ' + g);
  assert.ok(code.includes('/api/scores'), 'baca daripada /api/scores');
  new Function(code);
});

test('Templat brtpl + fpstpl + runtpl ada widget br/fps/runner sah', () => {
  const tplSrc = extractObj(html, 'const TEMPLATES = {');
  const T = new Function('TYPES','DEF_THEME', tplSrc + '; return TEMPLATES;')(TYPES,{});
  assert.ok(T.brtpl && T.brtpl.widgets.some((w)=>w.type==='br'), 'brtpl ada widget br');
  assert.ok(T.fpstpl && T.fpstpl.widgets.some((w)=>w.type==='fps'), 'fpstpl ada widget fps');
  assert.ok(T.runtpl && T.runtpl.widgets.some((w)=>w.type==='runner'), 'runtpl ada widget runner');
});

// ── ✨ Jana auto (idea → app+game) ──
test('Jana auto: input/butang + fetch /api/builder/generate + applyGenerated tapis types', () => {
  assert.ok(html.includes('id="genIdea"'), 'input idea wujud');
  assert.ok(html.includes('id="genBtn"'), 'butang Jana wujud');
  assert.ok(html.includes("fetch('/api/builder/generate'"), 'panggil endpoint jana');
  const code = extractFn(html, 'applyGenerated');
  assert.ok(code.includes('TYPES[w.type]'), 'buang types tak diketahui');
  assert.ok(code.includes('renderStage()') && code.includes('applyTheme()'), 'render selepas jana');
  new Function(code); // parse sah
});

test('Jana auto: banyak calon (apps[]) + kad Pakai/Terbitkan + Auto-terbit', () => {
  assert.ok(html.includes('id="genAutoPub"'), 'checkbox auto-terbit wujud');
  assert.ok(html.includes('Array.isArray(res.j.apps)'), 'baca apps[] daripada respons');
  assert.ok(html.includes("dataset.gact === 'pub'"), 'butang Publish memicu pubBtn');
  const card = extractFn(html, 'genCardHtml');
  assert.ok(card.includes('data-gact="use"') && card.includes('data-gact="pub"'), 'kad ada Pakai & Terbitkan');
  assert.ok(card.includes('GAME_SET'), 'khusus game ditandakan pada kad');
  new Function(card); // parse sah
});
