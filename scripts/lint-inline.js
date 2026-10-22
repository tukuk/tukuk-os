// Scope checker for INLINE scripts inside HTML (and plain JS files).
//
// Why: a browser only drops the ball when the user actually presses something — e.g.
// `openView(msg, …)` referring to a variable outside its scope, so `node --check`
// passes while the button is dead. This tool finds names that are used but never
// declared anywhere in the scope chain.
//
// Use:   node scripts/lint-inline.js public/apps/chat.html public/*.html
//        (exits non-zero when there are dangling variables)
'use strict';
const fs = require('fs');
const path = require('path');

// acorn + eslint-scope exist in the Debian packages (/usr/share/nodejs) and also as
// indirect ESLint dependencies; try to resolve both ways.
const acorn = (() => { try { return require('acorn'); } catch { return require('/usr/share/nodejs/acorn/dist/acorn.js'); } })();
const { analyze } = (() => { try { return require('eslint-scope'); } catch { return require('/usr/share/nodejs/eslint-scope/lib/index.js'); } })();

// Valid browser globals — the list is deliberately long; better to miss one warning
// than to drown the real signal.
const GLOBALS = new Set((`window document console localStorage sessionStorage navigator location history fetch XMLHttpRequest
  Image Audio Blob File FileList FileReader URL URLSearchParams ImageData MediaRecorder DataView ArrayBuffer SharedArrayBuffer createImageBitmap
  Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array BigInt
  Math JSON Date RegExp Promise Error TypeError RangeError SyntaxError Object Array String Number Boolean Symbol Map Set
  WeakMap WeakSet Proxy Reflect globalThis Infinity NaN undefined isNaN isFinite parseInt parseFloat
  setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame cancelAnimationFrame
  encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape alert confirm prompt open close stop
  scroll scrollBy scrollTo getComputedStyle matchMedia mediaQueryList crypto performance screen devicePixelRatio
  innerWidth innerHeight outerWidth outerHeight pageXOffset pageYOffset documentFragment
  Notification IntersectionObserver MutationObserver ResizeObserver ReportingObserver WebSocket Worker SharedWorker
  Event EventTarget CustomEvent AbortController AbortSignal TextEncoder TextDecoder DOMParser XMLSerializer
  KeyboardEvent MouseEvent TouchEvent PointerEvent DragEvent ClipboardEvent ProgressEvent MessageEvent StorageEvent
  FormData Headers Request Response Cache caches serviceWorker serviceWorkers navigator
  HTMLElement Element Node NodeList HTMLImageElement HTMLCanvasElement HTMLVideoElement HTMLInputElement SVGElement
  CanvasRenderingContext2D Path2D OffscreenCanvas AudioContext webkitAudioContext RTCPeerConnection
  RTCSessionDescription RTCIceCandidate MediaStream speechSynthesis SpeechSynthesisUtterance
  atob btoa onload onerror structuredClone cloneNode Intl BigInt localeCompare THREE L GoogleAnalytics
  ga dataLayer fbq chrome browser self top parent frames addEventListener removeEventListener dispatchEvent
  event clients windowWidth windowHeight origin location`).split(/\s+/));

// Extra names that are legal in CommonJS files (the server).
const NODE_GLOBALS = new Set(('require module exports __dirname __filename process Buffer global globalThis ' +
  'URL URLSearchParams fetch FormData Headers Request Response AbortController AbortSignal ' +
  'setImmediate clearImmediate TextEncoder TextDecoder BigInt Function eval').split(/\s+/));

// Every <script> block without a src attribute (an inline script inside HTML).
function inlineScripts(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    if (/type\s*=\s*["']?(application\/json|text\/template)/.test(m[1])) continue;
    out.push({ offset: html.slice(0, m.index).split('\n').length, code: m[2] });
  }
  return out;
}

function patternNames(pat, set) {
  if (!pat) return set;
  if (pat.type === 'Identifier') set.add(pat.name);
  else if (pat.type === 'ObjectPattern') pat.properties.forEach(p => patternNames(p.value || p.argument, set));
  else if (pat.type === 'ArrayPattern') pat.elements.forEach(e => patternNames(e, set));
  else if (pat.type === 'AssignmentPattern') patternNames(pat.left, set);
  else if (pat.type === 'RestElement') patternNames(pat.argument, set);
  return set;
}

// Top-level names from the external JS files a page references (<script src="/theme.js">)
// are also globals at run time.
function externalNames(html, dir) {
  const names = new Set();
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
    const ref = m[1].split('?')[0];
    if (/^https?:/.test(ref)) continue;
    const p = [path.resolve(dir, ref.replace(/^\//, '')), path.resolve(dir, ref), path.resolve('public', ref.replace(/^\//, ''))]
      .find(x => fs.existsSync(x) && fs.statSync(x).isFile());
    if (!p) continue;
    try {
      const a = acorn.parse(fs.readFileSync(p, 'utf8'), { ecmaVersion: 2022, sourceType: 'script', allowHashBang: true });
      for (const n of a.body) {
        if (n.type === 'FunctionDeclaration' && n.id) names.add(n.id.name);
        else if (n.type === 'VariableDeclaration') n.declarations.forEach(d => patternNames(d.id, names));
        else if (n.type === 'ClassDeclaration' && n.id) names.add(n.id.name);
      }
    } catch { /* unreadable file — leave it alone */ }
  }
  return names;
}

let total = 0;
const files = process.argv.slice(2);
if (!files.length) { console.error('Use: node scripts/lint-inline.js <file.html|file.js> [...]'); process.exit(2); }

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const isHtml = /\.html?$/i.test(file);
  // All inline blocks share the same global scope at run time, so merge them first;
  // `map` returns the real HTML line number.
  let src = raw, map = null;
  if (isHtml) {
    const parts = []; map = [];
    for (const b of inlineScripts(raw)) {
      parts.push(b.code);
      for (let i = 0; i < b.code.split('\n').length + 2; i++) map.push(b.offset + i);
    }
    src = parts.join('\n;\n');
  }
  const extra = isHtml ? externalNames(raw, path.dirname(file)) : NODE_GLOBALS;

  let ast;
  // ESM is detected roughly; if parsing fails as a plain script, retry as a module.
  const asModule = /^\s*(import|export)\s/m.test(src);
  const parseAs = (type) => acorn.parse(src, { ecmaVersion: 2022, sourceType: type, locations: true, ranges: true, allowHashBang: true });
  try { ast = parseAs(asModule ? 'module' : 'script'); }
  catch (e) {
    try { ast = parseAs(asModule ? 'script' : 'module'); }
    catch (e2) { console.log(file + ': PARSE_FAIL ' + e2.message); total++; continue; }
  }

  const sm = analyze(ast, { sourceType: asModule ? 'module' : 'script' });
  // eslint-scope does not mark `resolved` for top-level `function`/`var` declarations
  // in a plain script (they resolve dynamically), so collect them ourselves.
  const topDecl = new Set([].concat(sm.globalScope.variables, (sm.globalScope.childScopes[0] || { variables: [] }).variables || [])
    .map(v => v.name));
  const lines = src.split('\n');
  let bad = 0;
  (function walk(scope) {
    for (const ref of scope.references) {
      const name = ref.identifier && ref.identifier.name;
      if (!name || ref.resolved || GLOBALS.has(name) || topDecl.has(name) || extra.has(name)) continue;
      const ln = ref.identifier.loc ? ref.identifier.loc.start.line
        : src.slice(0, ref.identifier.range[0]).split('\n').length;
      console.log(file + ':' + (map ? map[ln - 1] : ln) + '  ' + name + '  [' + scope.type + ']  '
        + (lines[ln - 1] || '').trim().slice(0, 96));
      bad++;
    }
    for (const c of scope.childScopes) walk(c);
  })(sm.globalScope);
  total += bad;
}
console.log(total ? 'FAIL — ' + total + ' dangling variables' : 'CLEAN — no dangling variables');
process.exit(total ? 1 : 0);
