// Monetization loader (client): Google AdSense auto-ads + Microsoft USM.
// "Paste-and-run" plus an Admin kill-switch. Only run it on
// ad-safe pages. Search results (/cari), the Admin panel and the T Chat
// rooms (tchat.* / /apps/chat) NEVER inject ads — complying with the
// Google policy (no ads on web-search result pages) & the Tukuk design. We read
// /api/public/settings, so the Admin toggle instantly turns both on/off.
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
        // Microsoft Clarity (usage analytics — disclosed on /privacy). It is FREE
        // of the ad toggle, so it is loaded early to stay alive even when the
        // third-party ad networks below `return` (replacing AdSense).
        if (s.clarityEnabled) {
          var cid = String(s.clarityId || '');
          if (/^[a-z0-9]+$/i.test(cid)) {
            var cl = document.createElement('script');
            cl.async = true;
            cl.src = 'https://www.clarity.ms/tag/' + cid;
            head.appendChild(cl);
          }
        }
        // Google Tag Manager — the single Google tag (GA4 is configured inside the
        // container). Like Clarity it is analytics, NOT an ad, so it loads even when the
        // third-party network below `return` replaces AdSense. Container ID is public.
        if (s.gtmEnabled) {
          var gid = String(s.gtmId || '').toUpperCase();
          if (/^GTM-[A-Z0-9]+$/.test(gid)) {
            var gt = document.createElement('script');
            gt.text = "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" + gid + "');";
            head.appendChild(gt);
          }
        }
        // FAST ad networks (Adsterra / PropellerAds / etc.) — when enabled they
        // REPLACE AdSense on the same page (avoids "mixed networks" → protects the
        // AdSense account from a ban). AdSense auto-resumes when this toggle is off.
        if (s.thirdPartyAdEnabled) {
          var t = String(s.thirdPartyAdSrc || '');
          if (/^https:\/\/[a-z0-9.-]+\//i.test(t)) {
            var tp = document.createElement('script');
            tp.async = true;
            tp.src = t;
            head.appendChild(tp);
            return;
          }
        }
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
        // Microsoft USM (Universal Site Monetization) — one <script src> in the head.
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
