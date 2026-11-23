/* Tukuk-OS — the global mini-player.
   Music/radio started on the search page (index) KEEPS PLAYING on the other
   pages (studio, editor, nasa, blog…) so people can work while listening.
   The state is shared with the index bar through the localStorage key
   'tk-player-state'. On the index page the full player takes over — this
   script stays out of the way whenever #mediaAudio exists. */
(function () {
  var KEY = 'tk-player-state';
  var MAX_AGE = 12 * 3600 * 1000; // state older than this is stale

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
    if (document.getElementById('mediaAudio')) return; // the index page has its own bar
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
      '<button type="button" class="tkgp-ghost" data-act="prev" title="Previous" aria-label="Previous">&#9198;</button>' +
      '<button type="button" data-act="toggle" title="Play / Pause" aria-label="Play or pause">&#9654;</button>' +
      '<button type="button" class="tkgp-ghost" data-act="next" title="Next" aria-label="Next">&#9197;</button>' +
      '<button type="button" class="tkgp-ghost" data-act="loop" title="Repeat this track" aria-label="Repeat">&#8635;</button>' +
      '<a class="tkgp-link tkgp-ghost" href="/cari?mode=radio" title="Pick music / radio">&#9834;+</a>' +
      '<button type="button" class="tkgp-stop" data-act="stop" title="Stop" aria-label="Stop">&#10005;</button>';
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
    var autoNext = st.auto !== false; // follows the index bar's Auto‑next toggle (default: keep going)
    var wantPlay = true;
    var resumePending = true;
    var retries = 0;
    var retryTimer = null;
    var startedAt = 0;
    // The iTunes ±30s preview is repeated until the full track length (queue[].dur from the card) is covered.
    var playedSec = Math.max(0, Math.round((st.played || 0) - (st.pos || 0)));

    function cur() { return queue[qi] || queue[0] || { src: st.src, title: st.title || '' }; }

    function paint() {
      var c = cur();
      elTitle.textContent = c.title || 'Media';
      var playing = !audio.paused && !audio.ended;
      var sub = live ? 'Radio \u00b7 live broadcast'
        : 'Music \u00b7 ' + (queue.length > 1 ? 'playlist' : (cur().dur ? 'preview \u00b7 repeats to the full length' : '30s preview'));
      elSub.textContent = (resumePending && !playing) ? 'Press \u25b6 to resume playback' : sub;
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
        played: live ? 0 : Math.round(playedSec + (audio.currentTime || 0)),
        queue: queue, qi: qi, auto: autoNext, ts: Date.now()
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

    // Autoplay after a navigation may be blocked by the browser — resume on the first gesture.
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
      // Radio: keep retrying at length (the station may come back); music: skip fast when it is dead.
      var maxTry = live ? 25 : 3;
      if (retries > maxTry) { (live || !autoNext) ? softStop() : next(); return; }
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
      playedSec = 0; // a new track → the repeat count starts from zero
      load(true);
    }

    function softStop() {
      wantPlay = false;
      try { audio.pause(); } catch (e) {}
      paint();
      save(false);
      elSub.textContent = 'Disconnected — press ▶ to try again';
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
      if (Date.now() - startedAt < 3000) { reconnect(); return; } // a broken clip — don't jump straight away
      if (live) { reconnect(); return; }                          // a dropped radio stream → reconnect, don't change station
      if (loop) { audio.currentTime = 0; audio.play().catch(reconnect); return; }
      // Repeat the preview clip until the full track length shown to the user is covered, then move on or stop.
      var durSec = cur().dur || 0;
      if (!live && durSec > 0) {
        playedSec += Math.round(audio.duration) || 30;
        if (playedSec < durSec) { audio.currentTime = 0; audio.play().catch(reconnect); return; }
        playedSec = 0; // length covered → the next cycle starts from the top
      }
      // Auto‑next OFF → stop (only a user action resumes); ON → go on to the next track.
      if (!autoNext) { softStop(); return; }
      if (queue.length > 1) { next(); } else { audio.currentTime = 0; audio.play().catch(reconnect); }
    });
    var tick = 0;
    audio.addEventListener('timeupdate', function () {
      if (audio.paused) return;
      if (++tick % 20 !== 0) return; // save only every ~20 events (~1 second)
      save(true);
    });

    // Another tab/page changed the state → follow it, so two audios never play at once.
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      if (!e.newValue) { stopAll(); return; }
      var ns = null; try { ns = JSON.parse(e.newValue); } catch (err) { return; }
      if (ns && typeof ns.auto !== 'undefined') autoNext = !!ns.auto; // follow the Auto‑next toggle from the other tab
      if (ns && ns.src && ns.src !== cur().src) {
        queue = ns.queue && ns.queue.length ? ns.queue.slice(0, 60) : queue;
        qi = Math.max(0, Math.min(queue.length - 1, ns.qi || 0));
        live = !!ns.live;
        if (ns.playing) { st.pos = 0; playedSec = 0; load(true); } else { try { audio.pause(); } catch (err2) {} }
      }
    });

    load(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
