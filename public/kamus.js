'use strict';
// ── TUKUK-OS /alat/kamus — Dictionary & Translator + playful code encoders ──
// Human languages: definitions + translation come from our server (/api/kamus/*, which
// proxies the free Dictionary API + MyMemory with a cache — see src/kamus.js). Ancient/
// animal/alien/sound modes are pure client-side letter→signal maps, so they cost the
// server nothing. Pronunciation uses the browser's own speechSynthesis. No eval /
// new Function / inline handlers — everything is addEventListener, so the page CSP holds.
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // code (ISO 639 / MyMemory) → English name. A broad, international set of living
  // languages; the free dictionary holds English + several others, translation covers most.
  var LANGS = [
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
    ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
    ['tr', 'Turkish'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['fa', 'Persian'], ['hi', 'Hindi'],
    ['bn', 'Bengali'], ['ur', 'Urdu'], ['pa', 'Punjabi'], ['ta', 'Tamil'], ['te', 'Telugu'],
    ['ml', 'Malayalam'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['si', 'Sinhala'], ['th', 'Thai'],
    ['lo', 'Lao'], ['vi', 'Vietnamese'], ['id', 'Indonesian'], ['ms', 'Malay'], ['jv', 'Javanese'],
    ['tl', 'Tagalog'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['mn', 'Mongolian'],
    ['km', 'Khmer'], ['my', 'Burmese'], ['el', 'Greek'], ['la', 'Latin'], ['sw', 'Swahili'],
    ['am', 'Amharic'], ['yo', 'Yoruba'], ['ig', 'Igbo'], ['ha', 'Hausa'], ['zu', 'Zulu'],
    ['xh', 'Xhosa'], ['af', 'Afrikaans'], ['ro', 'Romanian'], ['hu', 'Hungarian'], ['cs', 'Czech'],
    ['sk', 'Slovak'], ['sr', 'Serbian'], ['hr', 'Croatian'], ['bg', 'Bulgarian'], ['da', 'Danish'],
    ['sv', 'Swedish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['is', 'Icelandic'], ['et', 'Estonian'],
    ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['ga', 'Irish'], ['cy', 'Welsh'], ['eu', 'Basque'],
    ['ca', 'Catalan'], ['sq', 'Albanian'], ['hy', 'Armenian'], ['ka', 'Georgian'], ['az', 'Azerbaijani'],
    ['kk', 'Kazakh'], ['uz', 'Uzbek'], ['ne', 'Nepali'], ['ps', 'Pashto'], ['ku', 'Kurdish'],
  ];
  var NAME = {};
  LANGS.forEach(function (l) { NAME[l[0]] = l[1]; });

  // ── Ancient scripts: real transliterations, Latin letter → attested sign ──
  var SCRIPTS = {
    rune: { name: 'Elder Futhark (runes)', map:
      { a: 'ᚨ', b: 'ᛒ', c: 'ᚲ', d: 'ᛞ', e: 'ᛖ', f: 'ᚠ', g: 'ᚷ', h: 'ᚺ', i: 'ᛁ', j: 'ᛃ',
        k: 'ᚲ', l: 'ᛚ', m: 'ᛗ', n: 'ᚾ', o: 'ᛟ', p: 'ᛈ', q: 'ᚲ', r: 'ᚱ', s: 'ᛊ', t: 'ᛏ',
        u: 'ᚢ', v: 'ᚹ', w: 'ᚹ', x: 'ᛊᛊ', y: 'ᛁ', z: 'ᛉ' } },
    hiero: { name: 'Egyptian hieroglyphs', map:
      { a: '𓄿', b: '𓃀', c: '𓍯', d: '𓂧', e: '𓇋', f: '𓆑', g: '𓎡', h: '𓉔', i: '𓇋', j: '𓆓',
        k: '𓎡', l: '𓃭', m: '𓅓', n: '𓈖', o: '𓍯', p: '𓊪', q: '𓎼', r: '𓂋', s: '𓋴', t: '𓏏',
        u: '𓅱', v: '𓆑', w: '𓏌', x: '𓎡', y: '𓇌', z: '𓊃' } },
    cune: { name: 'Sumerian cuneiform', map:
      { a: '𒀀', b: '𒁍', c: '𒆪', d: '𒁕', e: '𒂊', f: '𒄷', g: '𒄀', h: '𒄩', i: '𒄿', j: '𒄿',
        k: '𒆠', l: '𒇷', m: '𒈠', n: '𒉌', o: '𒄥', p: '𒉺', q: '𒆖', r: '𒊏', s: '𒊓', t: '𒌅',
        u: '𒌑', v: '𒄿', w: '𒉿', x: '𒍅', y: '𒅁', z: '𒊍' } },
    ogham: { name: 'Ogham (Celtic tree alphabet)', map:
      { a: 'ᚚ', b: 'ᚁ', c: 'ᚐ', d: 'ᚉ', e: 'ᚓ', f: 'ᚃ', g: 'ᚌ', h: 'ᚈ', i: 'ᚔ', j: 'ᚔ',
        k: 'ᚐ', l: 'ᚂ', m: 'ᚋ', n: 'ᚅ', o: 'ᚑ', p: 'ᚎ', q: 'ᚎ', r: 'ᚏ', s: 'ᚄ', t: 'ᚐ',
        u: 'ᚒ', v: 'ᚃ', w: 'ᚒ', x: 'ᚄ', y: 'ᚔ', z: '᚜' } },
  };

  // ── Playful fixed codes (same word always encodes the same way) ──
  var ANIMAL = ['oink', 'baa', 'meow', 'woof', 'moo', 'quack', 'cluck', 'neigh', 'chirp', 'ribbit',
    'caw', 'howl', 'bleat', 'snort', 'mew', 'baaa', 'quack', 'roar', 'hiss', 'tweet',
    'gurgle', 'growl', 'woof', 'squeak', 'yelp', 'buzz'];
  var ALIEN = ['✦', '✧', '★', '☆', '⚡', '⚛', '☄', '✵', '✶', '✷',
    '✸', '✹', '✺', '✻', '✼', '✽', '✾', '✿', '❀', '❁',
    '❂', '❆', '❇', '❈', '❉', '☈'];
  var SOUND = ['beep', 'boop', 'click', 'ding', 'bzz', 'fizz', 'grr', 'hiss', 'pip', 'jingle',
    'knock', 'lull', 'hum', 'naw', 'honk', 'pop', 'quack', 'rattle', 'shhh', 'tick',
    'boom', 'vrrm', 'whoosh', 'kshhh', 'yelp', 'zizz'];

  function letterIndex(ch) { return ch.charCodeAt(0) - 97; }         // a=0 … z=25
  // Map Latin letters through an array/table; leave spaces, punctuation and case as-is.
  function mapWord(text, arr) {
    return String(text).split('').map(function (ch) {
      var low = ch.toLowerCase(), i = letterIndex(low);
      return (i >= 0 && i < 26) ? arr[i] : ch;
    }).join('');
  }
  // Ancient scripts: signs of one word are spaced apart for readability, and a real
  // word gap becomes a double space (letter spacing alone must not blur words together).
  function mapTable(text, table) {
    return String(text).split(/\s+/).filter(Boolean).map(function (word) {
      return word.split('').map(function (ch) {
        var low = ch.toLowerCase();
        return Object.prototype.hasOwnProperty.call(table, low) ? table[low] : ch;
      }).join(' ');
    }).join('  ');
  }
  // One token per letter (for word-valued codes like animal/sound), joined with spaces so
  // it reads; an original word-gap becomes “ / ” so the source words stay visible.
  function codeWords(text, arr) {
    var out = [];
    String(text).split('').forEach(function (ch) {
      var low = ch.toLowerCase(), i = letterIndex(low);
      if (i >= 0 && i < 26) out.push(arr[i]);
      else if (ch === ' ') out.push('/');
      else if (/[^\s]/.test(ch)) out.push(ch);
    });
    return out.join(' ');
  }

  // ── Speech (Web Speech API) — the device's own voices, so it is free & offline ──
  var synth = window.speechSynthesis || null;
  var voices = [];
  function refreshVoices() { voices = synth ? synth.getVoices().filter(function (v) { return v.lang; }) : []; }
  if (synth) {
    refreshVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = refreshVoices;
    setTimeout(refreshVoices, 1200);
  }
  function speak(text, lang) {
    if (!synth || !window.SpeechSynthesisUtterance) { flash($('km-out'), '⚠ No speech engine in this browser. Android: Settings → Sound → TTS. Linux: install speech-dispatcher + espeak-ng.'); return; }
    text = String(text || '').trim();
    if (!text) return;
    synth.cancel();
    var u = new SpeechSynthesisUtterance(text);
    var pre = String(lang || 'en').slice(0, 2).toLowerCase();
    refreshVoices();
    var v = null;
    for (var i = 0; i < voices.length; i++) if (voices[i].lang.toLowerCase().indexOf(pre) === 0) { v = voices[i]; break; }
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = lang || 'en'; }
    u.rate = 0.95;
    synth.speak(u);
  }
  function flash(node, msg) { if (node) { node.textContent = msg; } }

  // ── Language dropdowns ──
  function fillLang(sel, value) {
    var html = '';
    for (var i = 0; i < LANGS.length; i++) html += '<option value="' + LANGS[i][0] + '">' + LANGS[i][1] + '</option>';
    sel.innerHTML = html;
    sel.value = value;
  }
  var fromSel = $('km-from'), toSel = $('km-to');
  if (!fromSel) return;                                   // page skeleton missing → stop
  fillLang(fromSel, 'en');
  fillLang(toSel, 'es');

  var scriptSel = $('km-script');
  (function fillScripts() {
    if (!scriptSel) return;
    var html = '';
    Object.keys(SCRIPTS).forEach(function (k) { html += '<option value="' + k + '">' + SCRIPTS[k].name + '</option>'; });
    scriptSel.innerHTML = html;
    scriptSel.value = 'rune';
  })();

  var mode = 'human';
  var lastSpeak = { text: '', lang: 'en' };

  // ── Human: define ──
  function doDefine() {
    var w = $('km-text').value.trim();
    if (!w) { flash($('km-out'), 'Type a word first.'); return; }
    var lang = fromSel.value;
    lastSpeak = { text: w, lang: lang };
    $('km-out').textContent = '…';
    fetch('/api/kamus/define?word=' + encodeURIComponent(w) + '&lang=' + encodeURIComponent(lang))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.found) {
          $('km-out').innerHTML = 'No dictionary entry for <b>' + esc(w) + '</b> in ' + esc(NAME[lang] || lang) +
            ' (the free dictionary is richest in English). Try <b>Translate</b>, or pick English.';
          return;
        }
        var out = '<div class="tl-big">' + esc(d.word) +
          (d.phonetic ? '<span class="km-phon">' + esc(d.phonetic) + '</span>' : '') +
          '<button class="tl-btn km-say" type="button" id="km-said">🔊</button></div>';
        if (d.audio) out += '<p class="km-note"><a href="' + esc(d.audio) + '" rel="noopener" target="_blank">⬇ native audio clip</a></p>';
        d.meanings.forEach(function (m) {
          out += '<div class="km-def"><span class="pos">' + esc(m.partOfSpeech) + '</span><ul>' +
            m.defs.map(function (x) { return '<li>' + esc(x.def) + (x.example ? ' <i class="km-note">“' + esc(x.example) + '”</i>' : '') + '</li>'; }).join('') +
            '</ul></div>';
        });
        $('km-out').innerHTML = out;
        var b = $('km-said'); if (b) b.addEventListener('click', function () { speak(d.word, lang); });
      })
      .catch(function () { $('km-out').textContent = '⚠ Dictionary is briefly unavailable — try again shortly.'; });
  }

  // ── Human: translate ──
  function doTranslate() {
    var t = $('km-text').value.trim();
    if (!t) { flash($('km-out'), 'Type a word or phrase first.'); return; }
    var from = fromSel.value, to = toSel.value;
    $('km-out').textContent = '…';
    fetch('/api/kamus/translate?text=' + encodeURIComponent(t) + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { $('km-out').textContent = '⚠ ' + (d.error === 'empty' ? 'Nothing to translate.' : 'Translation unavailable right now.'); return; }
        lastSpeak = { text: d.text, lang: to };
        $('km-out').innerHTML = '<div class="tl-big">' + esc(d.text) +
          '<button class="tl-btn km-say" type="button" id="km-said">🔊</button></div>' +
          '<p class="km-note">' + esc(NAME[from] || from) + ' → ' + esc(NAME[to] || to) +
          (d.cached ? ' · from cache' : '') + '</p>';
        var b = $('km-said'); if (b) b.addEventListener('click', function () { speak(d.text, to); });
      })
      .catch(function () { $('km-out').textContent = '⚠ The translation service is busy — try again in a moment.'; });
  }

  // ── Encoders (ancient / animal / alien / sound) — all local ──
  function encodeNow() {
    var t = $('km-enc-in').value;
    var out = $('km-enc-out'), note = $('km-enc-note');
    if (!t.trim()) { out.textContent = '—'; note.textContent = ''; return; }
    if (mode === 'ancient') {
      var key = scriptSel.value, sp = SCRIPTS[key] || SCRIPTS.rune;
      out.textContent = mapTable(t, sp.map);
      note.textContent = sp.name + ' — each Latin letter is mapped to its closest sign (a transliteration).';
      lastSpeak = { text: t, lang: 'en' };
    } else if (mode === 'animal') {
      var words = codeWords(t, ANIMAL);
      out.textContent = words;
      note.textContent = 'A fixed letter→animal-sound code ( / marks a word break). The result is real words, so 🔊 reads them aloud.';
      lastSpeak = { text: words.replace(/\s*\/\s*/g, ', '), lang: 'en' };
    } else if (mode === 'alien') {
      out.textContent = mapWord(t, ALIEN);
      note.textContent = 'A fixed letter→glyph space-alphabet. No speech for symbols, but the word itself is below.';
      lastSpeak = { text: t, lang: 'en' };
    } else if (mode === 'sound') {
      var snd = codeWords(t, SOUND);
      out.textContent = snd;
      note.textContent = 'A fixed letter→sound-effect code ( / marks a word break). 🔊 plays the sounds back.';
      lastSpeak = { text: snd.replace(/\s*\/\s*/g, ', '), lang: 'en' };
    }
  }

  // ── Tab switching ──
  function setMode(m) {
    mode = m;
    var tabs = document.querySelectorAll('.km-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-mode') === m ? 'true' : 'false');
    var human = m === 'human';
    $('km-human').style.display = human ? '' : 'none';
    $('km-enc').style.display = human ? 'none' : '';
    $('km-script-wrap').style.display = m === 'ancient' ? '' : 'none';
    if (!human) { var pre = $('km-text').value; if (pre && !$('km-enc-in').value) $('km-enc-in').value = pre; encodeNow(); }
  }

  // ── Tiny HTML-escape for the injected result strings ──
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }

  // ── Wire up (no inline handlers) ──
  var tabs = document.querySelectorAll('.km-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener('click', function (e) { setMode(e.currentTarget.getAttribute('data-mode')); });
  $('km-define').addEventListener('click', doDefine);
  $('km-translate').addEventListener('click', doTranslate);
  $('km-speak').addEventListener('click', function () { speak($('km-text').value, fromSel.value); });
  $('km-text').addEventListener('keydown', function (e) { if (e.key === 'Enter') doDefine(); });
  $('km-enc-in').addEventListener('input', encodeNow);
  if (scriptSel) scriptSel.addEventListener('change', encodeNow);
  $('km-enc-speak').addEventListener('click', function () { speak(lastSpeak.text, lastSpeak.lang); });
})();
