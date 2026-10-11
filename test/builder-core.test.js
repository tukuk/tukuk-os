'use strict';
// Ujian enjin Pembina Aplikasi (/builder). `widgetMarkup` (penjana HTML setiap
// widget) + `runtimeJS` (skrip kecil dalam fail eksport) + `esc` Diekstrak terus
// daripada public/builder.html — sumber sebenar yang dihantar ke pelayar — lalu
// dijalankan dalam sandbox. Ini menguji BETULnya output yang dieksport tanpa pelayar.
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

const codeMarkup = extractFn(html, 'widgetMarkup');
const codeRuntime = extractFn(html, 'runtimeJS');
const escSrc = extractLine(html, 'const esc =');
const esc = new Function(escSrc + '; return esc;')();

const THEME = { accent:'#4c8dff', bg:'#ffffff', fg:'#111111', dark:false, radius:14, font:'system-ui', sub:'s' };

// Bind widgetMarkup pada tema tertentu (theme & esc disuntik sebagai param).
function markup(w, theme = THEME) {
  const f = new Function('theme', 'esc', codeMarkup + '; return widgetMarkup;');
  return f(theme, esc)(w);
}

test('esc:Neutral HTML (tiada XSS dalam eksport)', () => {
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
  assert.ok(withHref.includes('Buka'));
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
  const out = markup({ type:'counter', label:'Bilangan', value:7, step:3 });
  assert.ok(out.includes('data-step="3"'), 'langkah mesti tertanam untuk JS eksport');
  assert.ok(out.includes('data-w='));
  assert.ok(/>7</.test(out), 'nilai awal muncul');
});

test('list: item jadi <li>, benartambah → form data-list, padam → listdel', () => {
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

test('runtimeJS: parse bersih & urus kaunter/list-del/submit', () => {
  const js = new Function(codeRuntime + '; return runtimeJS;')()();
  new Function(js); // mesti JS yang sah
  assert.ok(js.includes('listdel'));
  assert.ok(js.includes('data-act="inc"'));
  assert.ok(js.includes("addEventListener('submit'"));
});
