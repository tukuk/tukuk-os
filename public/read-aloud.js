'use strict';
// ── TUKUK-OS READ ALOUD — baca kuat dengan Web Speech API pelayar ──
// Percuma, tanpa kunci/API pelayan: teks halaman dibaca oleh suara sintetik OS
// (ms-MY di Android/Windows jika voice ada, selainnya bahasa sistem). Muncul
// hanya pada halaman KANDUNGAN yang ada <main> — bukan SPA (/os, /cari, /apps,
// /admin, editor) dan bukan bila pelayar tak sokong speechSynthesis.
// Tiada eval/new Function (lulus CSP ketat) — semua guna addEventListener.
(function () {
  var synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance) return;
  var path = location.pathname;
  // SPA/alat interaktif: baca kuat tiada makna di sini.
  if (/^\/(os|admin|cari|apps|editor|editor-video|movie|design|collage|converter|bg-remover|builder|store|play|playstore|terminal|dev|sms|health|stats|download-apk)/.test(path)) return;
  var main = document.querySelector('main') || document.querySelector('article') || document.querySelector('.wrap') || document.querySelector('.container');
  if (!main) return;

  var LANG2 = (document.documentElement.getAttribute('lang') || 'en').slice(0, 2);
  var I18N = {
    ms: { play: '▶ Baca', pause: '⏸ Jeda', resume: '▶ Sambung', stop: '⏹ Berhenti', title: 'Baca Kuat', hint: 'Klik ▶ Baca untuk dengar halaman ini dibacakan.', voice: 'Suara', rate: 'Kelajuan', reading: 'Membaca', done: 'Selesai', off: 'Tiada suara sintetik dalam bahasa Melayu — digunakan voice sistem.', end: 'Bacaan selesai' },
    en: { play: '▶ Read', pause: '⏸ Pause', resume: '▶ Resume', stop: '⏹ Stop', title: 'Read Aloud', hint: 'Click ▶ Read to listen to this page.', voice: 'Voice', rate: 'Speed', reading: 'Reading', done: 'Done', off: 'No synthetic voice in your language — using the system voice.', end: 'Reading finished' }
  };
  var T = I18N[LANG2] || I18N.en;

  // ── Kumpulkan teks boleh-baca: buang nav/footer/iklan/kawalan ──
  function collectSentences() {
    var clone = main.cloneNode(true);
    var kill = 'script,style,nav,footer,form,button,input,select,textarea,ins,.ad-slot,.site-top,.site-foot,.ra-box,aside,noscript';
    var dead = clone.querySelectorAll(kill);
    for (var i = 0; i < dead.length; i++) dead[i].parentNode.removeChild(dead[i]);
    var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    // Ayat ~≤240 aksara: pemisah . ! ? … ; pemotong paksa ayat panjang.
    var raw = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text];
    var out = [];
    for (var j = 0; j < raw.length; j++) {
      var s = raw[j].trim();
      while (s.length > 240) { out.push(s.slice(0, 240)); s = s.slice(240); }
      if (s) out.push(s);
    }
    return out;
  }

  var sentences = collectSentences();
  if (!sentences.length) return;

  // ── UI: kotak kecil kanan-bawah ──
  var st = document.createElement('style');
  st.textContent = '.ra-box{position:fixed;right:14px;bottom:14px;z-index:9999;background:var(--panel,#171a21);color:var(--text,#e6e9ef);border:1px solid var(--line,#262b36);border-radius:12px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px/1.5 system-ui,sans-serif;max-width:290px}'
    + '.ra-box button{border:1px solid var(--line,#262b36);background:var(--bg,#0f1115);color:inherit;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:13px}'
    + '.ra-box button:hover{border-color:var(--accent,#4c8dff)}'
    + '.ra-box select{max-width:130px;border:1px solid var(--line,#262b36);border-radius:6px;background:var(--bg,#0f1115);color:inherit;padding:3px 4px;font-size:12px}'
    + '.ra-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap}'
    + '.ra-lab{font-weight:700;font-size:.85rem;letter-spacing:.3px}'
    + '.ra-status{margin-top:6px;color:var(--muted,#9aa3b2);font-size:.82rem;min-height:1.4em;word-break:break-word}'
    + '.ra-row{margin-top:6px;display:flex;gap:6px;align-items:center;font-size:.8rem;color:var(--muted,#9aa3b2)}'
    + '@media(max-width:480px){.ra-box{right:8px;left:8px;bottom:8px;max-width:none}}';
  document.head.appendChild(st);

  var box = document.createElement('div');
  box.className = 'ra-box';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', T.title);
  box.innerHTML = '<div class="ra-top"><span class="ra-lab">🔊 ' + T.title + '</span>'
    + '<button type="button" id="ra-play">' + T.play + '</button>'
    + '<button type="button" id="ra-stop" hidden>' + T.stop + '</button></div>'
    + '<div class="ra-row"><span>' + T.voice + '</span><select id="ra-voice" aria-label="' + T.voice + '"></select>'
    + '<span>' + T.rate + '</span><select id="ra-rate" aria-label="' + T.rate + '">'
    + '<option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></div>'
    + '<div class="ra-status" id="ra-status" aria-live="polite">' + T.hint + '</div>';
  document.body.appendChild(box);

  var btnPlay = box.querySelector('#ra-play');
  var btnStop = box.querySelector('#ra-stop');
  var selVoice = box.querySelector('#ra-voice');
  var selRate = box.querySelector('#ra-rate');
  var statusEl = box.querySelector('#ra-status');

  // ── Voice: utamakan bahasa halaman (ms), simpan pilihan ──
  var voices = [];
  function pref() { return (LANG2 === 'ms' ? 'ms' : LANG2); }
  function fillVoices() {
    voices = synth.getVoices().filter(function (v) { return !!v.lang; });
    if (!voices.length) voices = synth.getVoices();
    var sorted = voices.slice().sort(function (a, b) {
      var ap = a.lang.toLowerCase().indexOf(pref()) === 0 ? 0 : 1;
      var bp = b.lang.toLowerCase().indexOf(pref()) === 0 ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    selVoice.innerHTML = '';
    var saved = '';
    try { saved = localStorage.getItem('ra-voice') || ''; } catch (e) {}
    for (var i = 0; i < sorted.length; i++) {
      var o = document.createElement('option');
      o.value = sorted[i].name;
      o.textContent = sorted[i].name + ' (' + sorted[i].lang + ')';
      if (sorted[i].name === saved) o.selected = true;
      selVoice.appendChild(o);
    }
    if (!saved && sorted.length) statusEl.textContent = sorted[0].lang.indexOf('ms') !== 0 ? T.off : T.hint;
  }
  fillVoices();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = fillVoices;
  try {
    var rSaved = localStorage.getItem('ra-rate');
    if (rSaved && ['0.75', '1', '1.25', '1.5'].indexOf(rSaved) > -1) selRate.value = rSaved;
  } catch (e) {}

  function pickVoice() {
    var want = '';
    try { want = localStorage.getItem('ra-voice') || ''; } catch (e) {}
    var i;
    if (want) for (i = 0; i < voices.length; i++) if (voices[i].name === want) return voices[i];
    for (i = 0; i < voices.length; i++) if (voices[i].lang.toLowerCase().indexOf(pref()) === 0) return voices[i];
    for (i = 0; i < voices.length; i++) if (voices[i].lang.toLowerCase().indexOf('en') === 0) return voices[i];
    return voices[0] || null;
  }

  // ── Enjin baca: satu queue ayat, indeks simpan status ──
  var idx = 0, playing = false, keepAlive = null;
  function reset() { idx = 0; playing = false; if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }
  function speakCur() {
    if (idx >= sentences.length) { finish(); return; }
    var u = new SpeechSynthesisUtterance(sentences[idx]);
    var v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = LANG2 === 'ms' ? 'ms-MY' : 'en'; }
    u.rate = Number(selRate.value) || 1;
    u.onend = function () { if (!playing) return; idx++; speakCur(); };
    u.onerror = function () { if (!playing) return; idx++; speakCur(); };
    synth.speak(u);
    statusEl.textContent = T.reading + ' ' + (idx + 1) + '/' + sentences.length + ': ' + sentences[idx].slice(0, 70) + '…';
  }
  function finish() {
    reset();
    btnPlay.textContent = T.play;
    btnStop.hidden = true;
    statusEl.textContent = T.end + ' ✓';
  }
  // Bug Chrome: queue panjang berhenti sendiri selepas ~15s — pacu resume berkala.
  function armKeepAlive() {
    if (keepAlive) return;
    keepAlive = setInterval(function () {
      if (playing && synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
    }, 10000);
  }

  btnPlay.addEventListener('click', function () {
    if (!playing) {
      synth.cancel();
      if (idx === 0 || idx >= sentences.length) idx = 0;
      playing = true;
      armKeepAlive();
      speakCur();
      btnPlay.textContent = T.pause;
      btnStop.hidden = false;
    } else {
      if (synth.paused) { synth.resume(); btnPlay.textContent = T.pause; }
      else { synth.pause(); btnPlay.textContent = T.resume; }
    }
  });
  btnStop.addEventListener('click', function () {
    synth.cancel();
    reset();
    btnPlay.textContent = T.play;
    btnStop.hidden = true;
    statusEl.textContent = T.done;
  });
  selVoice.addEventListener('change', function () {
    try { localStorage.setItem('ra-voice', selVoice.value); } catch (e) {}
  });
  selRate.addEventListener('change', function () {
    try { localStorage.setItem('ra-rate', selRate.value); } catch (e) {}
    if (playing) { synth.cancel(); speakCur(); }
  });
  window.addEventListener('beforeunload', function () { synth.cancel(); });
})();
