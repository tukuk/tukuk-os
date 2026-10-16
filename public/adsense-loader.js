// AdSense auto-ads loader (klien). "Tampal-dan-jalan" + ada kill-switch Admin.
// Hanya jalankan pada halaman selamat-iklan. Keputusan carian (/cari), panel
// Admin, dan ruang T Chat (tchat.* / /apps/chat) TIDAK sekali-kali menyuntik
// iklan — mematuhi dasar Google (no ads on web-search result pages) & reka
// bentuk Tukuk. Kami baca /api/public/settings (adsEnabled = keadaan sebenar),
// jadi togel "Enable AdSense" di Admin serta-merta menghidupkan/mematikan.
(function () {
  'use strict';
  try {
    var p = location.pathname;
    if (p === '/cari' || p === '/admin' || p.indexOf('/apps/chat') === 0) return;
    if (location.hostname.indexOf('tchat.') === 0) return;
    fetch('/api/public/settings', { cache: 'no-store' })
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.adsEnabled) return;
        var c = String(s.adsClient || '');
        if (!/^ca-pub-\d+$/.test(c)) return;
        var sc = document.createElement('script');
        sc.async = true;
        sc.crossOrigin = 'anonymous';
        sc.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + c;
        (document.head || document.documentElement).appendChild(sc);
      })
      .catch(function () {});
  } catch (e) {}
})();
