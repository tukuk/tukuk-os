/* Cookie preference centre (self-hosted; CSP `script-src 'self'` safe — no inline script).
   It reads and writes the SAME single source of truth the banner and the loaders already use:
   localStorage['tk-adconsent'] = 'granted' | 'denied' | (unset). Changing it here takes effect
   on the next page you open, because consentBootstrap() (server-rendered pages) and
   adsense-loader.js (static pages) both read this key and set the Google Consent Mode v2
   default from it BEFORE any ad/analytics tag fires. We also push a live consent `update` so a
   Google tag already running on this very page upgrades or downgrades immediately. */
(function () {
  'use strict';
  var KEY = 'tk-adconsent';

  function get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function set(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {} }

  // Push a Consent Mode update for the four v2 signals. Prefer the gtag stub if a Google tag
  // is present on the page; otherwise drop the raw command on the dataLayer for it to consume.
  function pushUpdate(granted) {
    var v = granted ? 'granted' : 'denied';
    var sig = { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v };
    if (typeof window.gtag === 'function') {
      try { window.gtag('consent', 'update', sig); return; } catch (e) {}
    }
    (window.dataLayer = window.dataLayer || []).push(['consent', 'update', sig]);
  }

  function statusText(state) {
    if (state === 'granted') return 'Saved choice: accepted — personalised ads and usage analytics are allowed.';
    if (state === 'denied') return 'Saved choice: rejected — only non-personalised ads, no usage analytics.';
    return 'No choice saved yet — the site treats you as rejected until you decide.';
  }

  function syncUI() {
    var state = get();
    var radios = document.querySelectorAll('input[name="cp-choice"]');
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i];
      r.checked = (r.value === 'granted' && state === 'granted') || (r.value === 'denied' && state !== 'granted');
    }
    var s = document.getElementById('cp-status');
    if (s) s.textContent = statusText(state);
  }

  function msg(text, ok) {
    var m = document.getElementById('cp-msg');
    if (!m) return;
    m.textContent = text;
    m.className = 'cp-msg' + (ok ? ' ok' : '');
  }

  function applyChoice(granted) {
    set(granted ? 'granted' : 'denied');
    pushUpdate(granted);
    syncUI();
    msg('Saved. Your choice applies from the next page you open.', true);
  }

  function wire() {
    var form = document.getElementById('cp-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var chosen = document.querySelector('input[name="cp-choice"]:checked');
      applyChoice(!!chosen && chosen.value === 'granted');
    });
    var reset = document.getElementById('cp-reset');
    if (reset) reset.addEventListener('click', function () {
      set('');
      syncUI();
      msg('Cleared. The cookie banner will ask you again on your next visit.', false);
    });
    syncUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
