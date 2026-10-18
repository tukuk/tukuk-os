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
    ms: { play: '▶ Baca', pause: '⏸ Jeda', resume: '▶ Sambung', stop: '⏹ Berhenti', title: 'Baca Kuat', hint: 'Klik ▶ Baca untuk dengar halaman ini dibacakan.', voice: 'Suara', rate: 'Kelajuan', reading: 'Membaca', done: 'Selesai', off: 'Tiada suara sintetik dalam bahasa Melayu — digunakan voice sistem.', end: 'Bacaan selesai', novoice: 'Tiada suara sintetik dalam sistem ini. Android: Tetapan → Suara → Keluaran TTS. Linux (Chrome/Firefox): pasang pakej speech-dispatcher + espeak-ng, kemudian mula semula pelayar.', fail: 'Enjin suara sistem tidak bertindak — tiada voice TTS tersedia.' },
    en: { play: '▶ Read', pause: '⏸ Pause', resume: '▶ Resume', stop: '⏹ Stop', title: 'Read Aloud', hint: 'Click ▶ Read to listen to this page.', voice: 'Voice', rate: 'Speed', reading: 'Reading', done: 'Done', off: 'No synthetic voice in your language — using the system voice.', end: 'Reading finished', novoice: 'No synthetic voice is installed on this device. Android: Settings → Sound → TTS output. Linux (Chrome/Firefox): install the speech-dispatcher + espeak-ng packages, then restart the browser.', fail: 'The system speech engine did not respond — no TTS voice available.' }
  };
  var T = I18N[LANG2] || I18N.en;

  // ── Kumpulkan teks boleh-baca: buang nav/footer/iklan/kawalan ──
  function collectSentences() {
    var clone = main.cloneNode(true);
    var kill = 'script,style,nav,footer,form,button,input,select,textarea,ins,.ad-slot,.site-top,.site-foot,.ra-btn,.ra-tip,aside,noscript';
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

  // ── UI: SATU butang kecil sahaja (kanan-bawah) ──
  var st = document.createElement('style');
  st.textContent = '.ra-btn{position:fixed;right:14px;bottom:14px;z-index:9999;width:44px;height:44px;border-radius:50%;border:1px solid var(--line,#262b36);background:var(--panel,#171a21);color:var(--text,#e6e9ef);cursor:pointer;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.3);transition:border-color .15s}'
    + '.ra-btn:hover{border-color:var(--accent,#4c8dff)}'
    + '.ra-btn[data-state="reading"]{background:var(--accent,#4c8dff);color:#fff;border-color:transparent;animation:ra-pulse 1.8s ease-in-out infinite}'
    + '.ra-btn[data-state="paused"]{color:var(--accent,#4c8dff)}'
    + '@keyframes ra-pulse{0%,100%{box-shadow:0 0 0 0 rgba(76,141,255,.45)}50%{box-shadow:0 0 0 7px rgba(76,141,255,0)}}'
    + '.ra-tip{position:fixed;right:14px;bottom:66px;z-index:9999;max-width:min(260px,72vw);background:var(--panel,#171a21);color:var(--text,#e6e9ef);border:1px solid var(--line,#262b36);border-radius:10px;padding:8px 10px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s;pointer-events:none}'
    + '.ra-tip.show{opacity:1;transform:translateY(0)}'
    + '@media(max-width:480px){.ra-btn{right:10px;bottom:10px}.ra-tip{right:10px;bottom:62px}}';
  document.head.appendChild(st);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ra-btn';
  btn.setAttribute('data-state', 'idle');
  btn.setAttribute('aria-label', T.title);
  btn.setAttribute('aria-pressed', 'false');
  btn.title = T.title + ' — ' + T.hint;
  btn.textContent = '🔊';
  document.body.appendChild(btn);

  var tip = document.createElement('div');
  tip.className = 'ra-tip';
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');
  document.body.appendChild(tip);
  var tipTimer = null;
  function say(msg, ms) {
    tip.textContent = msg;
    tip.classList.add('show');
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { tip.classList.remove('show'); }, ms || 4000);
  }

  // ── Voice: utamakan bahasa halaman (ms), hormati pilihan tersimpan ──
  var voices = [];
  function pref() { return (LANG2 === 'ms' ? 'ms' : LANG2); }
  function fillVoices() {
    var all = synth.getVoices().filter(function (v) { return !!v.lang; });
    if (!all.length) all = synth.getVoices();
    voices = all.slice().sort(function (a, b) {
      var ap = a.lang.toLowerCase().indexOf(pref()) === 0 ? 0 : 1;
      var bp = b.lang.toLowerCase().indexOf(pref()) === 0 ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
  }
  fillVoices();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = fillVoices;
  // Voice tiba lewat (Chrome/Linux): semak semula supaya klik pertama tidak terlepas.
  if (!voices.length) { setTimeout(fillVoices, 1500); setTimeout(fillVoices, 4500); }

  function pickVoice() {
    var want = '';
    try { want = localStorage.getItem('ra-voice') || ''; } catch (e) {}
    var i;
    if (want) for (i = 0; i < voices.length; i++) if (voices[i].name === want) return voices[i];
    for (i = 0; i < voices.length; i++) if (voices[i].lang.toLowerCase().indexOf(pref()) === 0) return voices[i];
    for (i = 0; i < voices.length; i++) if (voices[i].lang.toLowerCase().indexOf('en') === 0) return voices[i];
    return voices[0] || null;
  }
  function rateVal() {
    var r = '';
    try { r = localStorage.getItem('ra-rate') || ''; } catch (e) {}
    return ['0.75', '1', '1.25', '1.5'].indexOf(r) > -1 ? Number(r) : 1;
  }

  // ── Enjin baca: satu queue ayat, indeks simpan kedudukan ──
  // PENTING: tanpa voice, synth.speak() melempar onerror SINKRON — kemajuan
  // queue wajib ditangguhkan (setTimeout), jika tidak rekursi segerak
  // meletupkan stack (RangeError) dan bacaan mati senyap.
  var idx = 0, state = 'idle', keepAlive = null, errStreak = 0;
  function setUI() {
    btn.setAttribute('data-state', state);
    btn.setAttribute('aria-pressed', state === 'reading' ? 'true' : 'false');
    btn.textContent = state === 'reading' ? '⏸' : (state === 'paused' ? '▶' : '🔊');
  }
  function stopAll(toast) {
    synth.cancel();
    idx = 0; state = 'idle'; errStreak = 0;
    if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    setUI();
    if (toast) say(toast, 5000);
  }
  function speakCur() {
    if (state !== 'reading') return;
    if (idx >= sentences.length) { stopAll(T.end + ' ✓'); return; }
    var u = new SpeechSynthesisUtterance(sentences[idx]);
    var v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = LANG2 === 'ms' ? 'ms-MY' : 'en'; }
    u.rate = rateVal();
    var started = false;
    u.onstart = function () { started = true; errStreak = 0; };
    u.onend = function () { if (state !== 'reading') return; idx++; setTimeout(speakCur, 40); };
    u.onerror = function () {
      if (state !== 'reading') return;
      if (!started) errStreak++;
      if (errStreak >= 3) { stopAll(voices.length ? T.fail : T.novoice); return; }
      idx++; setTimeout(speakCur, 40);
    };
    synth.speak(u);
  }
  // Bug Chrome: queue panjang berhenti sendiri selepas ~15s — pacu resume berkala.
  function armKeepAlive() {
    if (keepAlive) return;
    keepAlive = setInterval(function () {
      if (state === 'reading' && synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
    }, 10000);
  }

  setUI();
  // Klik: idle→baca · baca→jeda · jeda→sambung. Klik-kanan/penahan: berhenti.
  btn.addEventListener('click', function () {
    if (state === 'idle') {
      if (!voices.length) fillVoices();
      if (!voices.length) { say(T.novoice, 6000); return; } // jujur: jangan berlakon membaca
      synth.cancel();
      if (idx >= sentences.length) idx = 0;
      state = 'reading'; errStreak = 0;
      armKeepAlive();
      setUI();
      speakCur();
    } else if (state === 'reading') {
      synth.pause(); state = 'paused'; setUI();
    } else { // paused → sambung
      synth.resume(); state = 'reading'; setUI();
    }
  });
  btn.addEventListener('contextmenu', function (e) { e.preventDefault(); if (state !== 'idle') stopAll(T.done); });
  window.addEventListener('beforeunload', function () { synth.cancel(); });
})();
