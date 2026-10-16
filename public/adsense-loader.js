// Loader monetisasi (klien): Google AdSense auto-ads + Microsoft USM.
// "Tampal-dan-jalan" + kill-switch Admin. Hanya jalankan pada halaman
// selamat-iklan. Keputusan carian (/cari), panel Admin, dan ruang T Chat
// (tchat.* / /apps/chat) TIDAK sekali-kali menyuntik iklan — mematuhi dasar
// Google (no ads on web-search result pages) & reka bentuk Tukuk. Kami baca
// /api/public/settings, jadi togel Admin serta-merta hidup/mati kedua-duanya.
(function () {
  'use strict';
  try {
    var p = location.pathname;
    if (p === '/cari' || p === '/admin' || p.indexOf('/apps/chat') === 0) return;
    if (location.hostname.indexOf('tchat.') === 0) return;
    fetch('/api/public/settings', { cache: 'no-store' })
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (s) {
        if (!s) return;
        var head = document.head || document.documentElement;
        // Google AdSense auto-ads
        if (s.adsEnabled) {
          var c = String(s.adsClient || '');
          if (/^ca-pub-\d+$/.test(c)) {
            var g = document.createElement('script');
            g.async = true;
            g.crossOrigin = 'anonymous';
            g.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + c;
            head.appendChild(g);
          }
        }
        // Microsoft USM (Universal Site Monetization) — satu <script src> di head.
        if (s.msAdsEnabled) {
          var u = String(s.msAdsUsmSrc || '');
          if (/^https:\/\/[a-z0-9.-]+\//i.test(u)) {
            var m = document.createElement('script');
            m.async = true;
            m.src = u;
            head.appendChild(m);
          }
        }
      })
      .catch(function () {});
  } catch (e) {}
})();
