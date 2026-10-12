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
const esc = new Function(extractLine(html, 'const esc =') + '; return esc;')();
const TYPES = new Function(extractObj(html, 'const TYPES = {') + '; return TYPES;')();

const THEME = { accent:'#4c8dff', bg:'#ffffff', fg:'#111111', dark:false, radius:14, font:'system-ui', sub:'s' };

// Bind widgetMarkup pada tema tertentu (theme & esc disuntik sebagai param).
function markup(w, theme = THEME) {
  const f = new Function('theme', 'esc', codeMarkup + '; return widgetMarkup;');
  return f(theme, esc)(w);
}
function runtime() { return new Function(codeRuntime + '; return runtimeJS;')()(); }

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

test('TYPES: 14 jenis, setiap make() kembalikan objek ber-`type` padan', () => {
  const keys = Object.keys(TYPES);
  assert.equal(keys.length, 14);
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
