'use strict';
// Read Aloud invariants: a Web Speech widget with no API (the only voice source),
// a single-point injection through siteFooter for every SSR shell + 9 static pages,
// and no eval/new Function (passes the strict CSP script-src 'self').
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const raSrc = fs.readFileSync(path.join(ROOT, 'public', 'read-aloud.js'), 'utf8');

test('read-aloud.js: native Web Speech API, no key/eval (CSP-safe)', () => {
  assert.ok(raSrc.includes('window.speechSynthesis'), 'uses the browser speechSynthesis');
  assert.ok(raSrc.includes('SpeechSynthesisUtterance'), 'the W3C standard utterance');
  assert.ok(!/\beval\(|new Function\(/.test(raSrc), 'no eval/new Function');
  assert.ok(!/https?:\/\/(?!tukuk\.org)[a-z]/i.test(raSrc.replace(/\+https:\/\/tukuk\.org/g, '')), 'no external network');
  assert.ok(raSrc.includes("if (!synth || !window.SpeechSynthesisUtterance) return;"), 'the features are checked first');
  assert.ok(raSrc.includes('armKeepAlive'), 'the Chrome workaround for long queues stopping');
  assert.ok(raSrc.includes("'ms'") && raSrc.includes('ms-MY'), 'a Bahasa Melayu voice is preferred');
  // Regression October 2026: without a TTS voice, a synchronous onerror → speakCur() recursed,
  // blew the stack (RangeError) and the reading died silently. Progress MUST be deferred.
  assert.ok(/setTimeout\(speakCur, \d+\)/.test(raSrc), 'queue progress is deferred, not synchronous recursion');
  assert.ok(raSrc.includes('errStreak'), 'a consecutive-error guard (an honest fail-out)');
  assert.ok(!/onerror = function \(\) \{[^}]*speakCur\(\);/.test(raSrc), 'onerror must not call speakCur directly');
  assert.ok(raSrc.includes('novoice') && raSrc.includes('speech-dispatcher'), 'an honest no-voice message (Android/Linux)');
});

test('read-aloud.js: skips SPAs/tools, only content pages', () => {
  assert.ok(/\/\^\?/.test('/') || raSrc.includes('location.pathname'), 'filters by path');
  assert.ok(raSrc.includes('(os|admin|cari|apps'), 'the SPA exclusion list');
  assert.ok(raSrc.includes("querySelector('main')"), 'targets the page main container');
  // The spoken text drops nav/footer/ads so the voice never reads junk.
  assert.ok(raSrc.includes('.ad-slot'), 'ad slots are dropped from the reading');
  assert.ok(raSrc.includes('nav,footer'), 'nav + footer are dropped');
});

test('server.js: siteFooter injects the widget into every SSR shell', () => {
  const footerBlock = serverSrc.slice(serverSrc.indexOf('function siteFooter()'));
  const end = footerBlock.indexOf('\n}\n');
  assert.ok(end > 0, 'the siteFooter block was found');
  assert.ok(footerBlock.slice(0, end).includes('<script src="/read-aloud.js" defer></script>'), 'a single-point injection in the footer');
  // 10 shells (blog/hub/nasa/cuaca/gempa/cuti/negara/wiki/post/404) use siteFooter → covered automatically.
  const uses = (serverSrc.match(/\$\{siteFooter\(\)\}/g) || []).length;
  assert.ok(uses >= 9, `SSR shells using siteFooter (found ${uses})`);
});

test('static pages: the 9 content pages load read-aloud.js', () => {
  for (const f of ['index', 'about', 'docs', 'rekomendasi', 'contact', 'privacy', 'terms', 'access', 'download']) {
    const html = fs.readFileSync(path.join(ROOT, 'public', `${f}.html`), 'utf8');
    assert.ok(html.includes('<script src="/read-aloud.js" defer></script>'), `${f}.html injects the widget`);
  }
  // SPAs must not get the widget directly (apart from the path exclusion).
  const osHtml = fs.readFileSync(path.join(ROOT, 'public', 'os.html'), 'utf8');
  assert.ok(!osHtml.includes('/read-aloud.js'), 'os.html is free of the widget');
});
