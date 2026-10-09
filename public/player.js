/* Tukuk-OS — mini-pemain global.
   Muzik/radio yang dimainkan dari halaman carian (index) SAMBUNG bermain di
   halaman lain (studio, editor, nasa, blog…) supaya orang boleh bekerja
   sambil mendengar. State dikongsi dengan bar index melalui localStorage
   'tk-player-state'. Di halaman index pemain penuh mengambil alih — skrip ini
   sen diri bila ada #mediaAudio. */
(function () {
  var KEY = 'tk-player-state';
  var MAX_AGE = 12 * 3600 * 1000; // state lebih lama daripada ini dianggap basi

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  var st = read();
  if (!st || !st.src || !st.playing || Date.now() - (st.ts || 0) > MAX_AGE) return;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var CSS = '' +
    '.tkgp{position:fixed;left:16px;bottom:16px;z-index:90;display:flex;align-items:center;gap:7px;' +
    'background:var(--panel,#151a23);border:1px solid var(--line,#262b36);border-radius:999px;' +
    'padding:7px 9px 7px 14px;box-shadow:0 6px 20px rgba(0,0,0,.35);max-width:min(420px,92vw);' +
    'font:inherit;color:var(--text,#e6e6e6);}' +
    '.tkgp[hidden]{display:none;}' +
    '.tkgp-note{font-size:1rem;opacity:.85;flex:none;animation:tkgp-spin 3.2s linear infinite;}' +
    '.tkgp.paused .tkgp-note{animation:none;opacity:.4;}' +
    '@keyframes tkgp-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}' +
    '.tkgp-meta{min-width:0;flex:1;}' +
    '.tkgp-title{font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;}' +
    '.tkgp-sub{font-size:.7rem;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.tkgp button,.tkgp a.tkgp-link{border:0;background:var(--accent-fill,#2a6edb);color:#fff;' +
    'width:28px;height:28px;border-radius:50%;cursor:pointer;flex:none;display:inline-flex;' +
    'align-items:center;justify-content:center;font-size:.8rem;text-decoration:none;line-height:1;}' +
    '.tkgp .tkgp-ghost{background:transparent;border:1px solid var(--line,#262b36);color:inherit;}' +
    '.tkgp .tkgp-ghost.on{border-color:var(--accent-fill,#2a6edb);color:var(--accent-fill,#2a6edb);}' +
    '.tkgp .tkgp-stop{background:transparent;border:1px solid var(--line,#262b36);color:inherit;}' +
    '@media (max-width:520px){.tkgp-sub{display:none;}}';

  function boot() {
    if (document.getElementById('mediaAudio')) return; // index punya bar sendiri
    if (/^\/admin/.test(location.pathname)) return;
    if (document.getElementById('tkGlobalPlayer')) return;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'tkGlobalPlayer';
    bar.className = 'tkgp paused';
    bar.innerHTML =
      '<span class="tkgp-note">&#9835;</span>' +
      '<div class="tkgp-meta"><div class="tkgp-title"></div><div class="tkgp-sub"></div></div>' +
      '<button type="button" class="tkgp-ghost" data-act="prev" title="Sebelumnya" aria-label="Sebelumnya">&#9198;</button>' +
      '<button type="button" data-act="toggle" title="Main / Jeda" aria-label="Main atau jeda">&#9654;</button>' +
      '<button type="button" class="tkgp-ghost" data-act="next" title="Seterusnya" aria-label="Seterusnya">&#9197;</button>' +
      '<button type="button" class="tkgp-ghost" data-act="loop" title="Ulang lagu ini" aria-label="Ulang">&#8635;</button>' +
      '<a class="tkgp-link tkgp-ghost" href="/cari?mode=radio" title="Pilih muzik / radio">&#9834;+</a>' +
      '<button type="button" class="tkgp-stop" data-act="stop" title="Berhenti" aria-label="Berhenti">&#10005;</button>';
    document.body.appendChild(bar);

    var elTitle = bar.querySelector('.tkgp-title');
    var elSub = bar.querySelector('.tkgp-sub');
    var btnToggle = bar.querySelector('[data-act="toggle"]');
    var btnLoop = bar.querySelector('[data-act="loop"]');

    var audio = new Audio();
    audio.preload = 'auto';

    var queue = Array.isArray(st.queue) ? st.queue.slice(0, 60) : [];
    var qi = 0;
    for (var i = 0; i < queue.length; i++) { if (queue[i] && queue[i].src === st.src) { qi = i; break; } }
    if (!queue.length || !queue[qi]) queue = [{ src: st.src, title: st.title || 'Media' }], qi = 0;

    var live = !!st.live;
    var loop = false;
    var wantPlay = true;
    var resumePending = true;
    var retries = 0;
    var retryTimer = null;
    var startedAt = 0;

    function cur() { return queue[qi] || queue[0] || { src: st.src, title: st.title || '' }; }

    function paint() {
      var c = cur();
      elTitle.textContent = c.title || 'Media';
      var playing = !audio.paused && !audio.ended;
      var sub = live ? 'Radio \u00b7 siaran langsung'
        : 'Muzik \u00b7 ' + (queue.length > 1 ? 'senarai main' : 'pratinjau 30s');
      elSub.textContent = (resumePending && !playing) ? 'Tekan \u25b6 untuk sambung bermain' : sub;
      bar.classList.toggle('paused', !playing);
      btnToggle.innerHTML = playing ? '&#9208;' : '&#9654;';
      btnLoop.classList.toggle('on', loop);
      document.title = playing ? '\u25b6 ' + (c.title || '') + ' — Tukuk-OS' : document.title.replace(/^\u25b6\s/, '');
    }

    function save(playing) {
      var c = cur();
      write({
        src: c.src, title: c.title, live: live, playing: !!playing,
        pos: live ? 0 : (audio.currentTime || 0),
        queue: queue, qi: qi, ts: Date.now()
      });
    }

    function load(autoplay) {
      var c = cur();
      live = !!c.live;
      retries = 0;
      audio.src = c.src;
      wantPlay = true;
      var go = function () {
        audio.play().then(function () { resumePending = false; startedAt = Date.now(); paint(); save(true); })
          .catch(function () { paint(); awaitGesture(); });
      };
      if (!live && st.pos) {
        var seek = function () { try { audio.currentTime = st.pos; } catch (e) {} st.pos = 0; go(); };
        audio.addEventListener('loadedmetadata', seek, { once: true });
        audio.load();
      } else { go(); }
      if (autoplay === false) { try { audio.pause(); } catch (e) {} paint(); }
    }

    // Autoplay selepas navigasi mungkin disekat pelayar — sambung pada gestures pertama.
    function awaitGesture() {
      var once = function () {
        document.removeEventListener('pointerdown', once);
        document.removeEventListener('keydown', once);
        if (resumePending) load(true);
      };
      document.addEventListener('pointerdown', once);
      document.addEventListener('keydown', once);
    }

    function reconnect() {
      if (!wantPlay) return;
      if (retryTimer) clearTimeout(retryTimer);
      retries++;
      // Radio: cuba sambung semula panjang (stesen hidup lagi); muzik: skip cepat bila mati.
      var maxTry = live ? 25 : 3;
      if (retries > maxTry) { live ? softStop() : next(); return; }
      retryTimer = setTimeout(function () {
        retryTimer = null;
        if (!wantPlay) return;
        audio.src = cur().src;
        audio.play().then(function () { startedAt = Date.now(); paint(); save(true); }).catch(reconnect);
      }, Math.min(700 * retries, 5000));
    }

    function next() { step(1); }
    function prev() { step(-1); }
    function step(d) {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (queue.length < 2) { load(true); return; }
      qi = (qi + d + queue.length) % queue.length;
      st.pos = 0;
      load(true);
    }

    function softStop() {
      wantPlay = false;
      try { audio.pause(); } catch (e) {}
      paint();
      save(false);
      elSub.textContent = 'Terputus — tekan ▶ untuk cuba lagi';
    }

    function stopAll() {
      wantPlay = false;
      resumePending = false;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
      clear();
      bar.remove();
    }

    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'toggle') {
        if (audio.paused) { wantPlay = true; if (resumePending) { load(true); } else { audio.play().then(paint).catch(reconnect); } }
        else { wantPlay = false; audio.pause(); paint(); save(false); }
      } else if (act === 'next') next();
      else if (act === 'prev') prev();
      else if (act === 'loop') { loop = !loop; paint(); }
      else if (act === 'stop') stopAll();
    });

    audio.addEventListener('play', paint);
    audio.addEventListener('pause', function () { paint(); if (!resumePending) save(false); });
    audio.addEventListener('playing', function () { retries = 0; startedAt = Date.now(); resumePending = false; paint(); save(true); });
    audio.addEventListener('error', function () { if (wantPlay) reconnect(); });
    audio.addEventListener('stalled', function () { if (wantPlay) setTimeout(function () { if (wantPlay && audio.paused) reconnect(); }, 1200); });
    audio.addEventListener('ended', function () {
      if (!wantPlay) return;
      if (Date.now() - startedAt < 3000) { reconnect(); return; } // klip rosak — jangan lompat serta-merta
      if (live) { reconnect(); return; }                          // radio terputus → sambung, bukan tukar stesen
      if (loop) { audio.currentTime = 0; audio.play().catch(reconnect); return; }
      if (queue.length > 1) next(); else { softStop(); }
    });
    var tick = 0;
    audio.addEventListener('timeupdate', function () {
      if (audio.paused) return;
      if (++tick % 20 !== 0) return; // simpan setiap ~20 event (~1 saat) sahaja
      save(true);
    });

    // Tab/halaman lain mengubah state → ikut supaya tak main dua audio serentak.
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      if (!e.newValue) { stopAll(); return; }
      var ns = null; try { ns = JSON.parse(e.newValue); } catch (err) { return; }
      if (ns && ns.src && ns.src !== cur().src) {
        queue = ns.queue && ns.queue.length ? ns.queue.slice(0, 60) : queue;
        qi = Math.max(0, Math.min(queue.length - 1, ns.qi || 0));
        live = !!ns.live;
        if (ns.playing) { st.pos = 0; load(true); } else { try { audio.pause(); } catch (err2) {} }
      }
    });

    load(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
