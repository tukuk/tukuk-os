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
        // Google Consent Mode v2 — read the stored choice and set the default BEFORE any tag
        // is injected. Nothing that drops a personalisation/analytics cookie may fire until the
        // visitor grants it. AdSense is the one exception Google blesses: it serves
        // non-personalised ads even under a denied state, so it can still run. This mirrors the
        // server-rendered pages, where consentBootstrap() emits the same default inline.
        var state = 'unset';
        try { state = localStorage.getItem('tk-adconsent') || 'unset'; } catch (e) {}
        var granted = state === 'granted';
        var dataLayer = window.dataLayer = window.dataLayer || [];
        var gtag = window.gtag = window.gtag || function () { dataLayer.push(arguments); };
        gtag('consent', 'default', granted
          ? { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' }
          : { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
        // First visit: bring in the visible banner (self-hosted) so the choice can be made; it
        // stores the answer and pushes a consent `update`, which is honoured on the next load.
        if (state === 'unset') {
          var cb = document.createElement('script');
          cb.defer = true;
          cb.src = '/consent.js';
          head.appendChild(cb);
        }
        // Analytics (Clarity + GTM/GA) set cookies, so they only load once consent is granted.
        if (granted) {
          if (s.clarityEnabled) {
            var cid = String(s.clarityId || '');
            if (/^[a-z0-9]+$/i.test(cid)) {
              var cl = document.createElement('script');
              cl.async = true;
              cl.src = 'https://www.clarity.ms/tag/' + cid;
              head.appendChild(cl);
            }
          }
          if (s.gtmEnabled) {
            var gid = String(s.gtmId || '').toUpperCase();
            if (/^(GTM|GT)-[A-Z0-9]+$/.test(gid)) { // classic GTM container (GTM-) or the new Google tag (GT-)
              var gt = document.createElement('script');
              gt.text = "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" + gid + "');";
              head.appendChild(gt);
            }
          }
        }
        // Non-Google networks (FAST / Microsoft USM) are not Consent-Mode aware, so they wait
        // for a grant too. AdSense still covers the ungranted visitor with compliant
        // non-personalised ads; when only a third-party network is configured the page simply
        // shows no ad until the visitor accepts.
        var firedAd = false;
        if (granted && s.thirdPartyAdEnabled) {
          var t = String(s.thirdPartyAdSrc || '');
          if (/^https:\/\/[a-z0-9.-]+\//i.test(t)) {
            var tp = document.createElement('script');
            tp.async = true;
            tp.src = t;
            head.appendChild(tp);
            firedAd = true;
          }
        }
        if (s.adsEnabled && !firedAd) {
          var c = String(s.adsClient || '');
          if (/^ca-pub-\d+$/.test(c)) {
            var g = document.createElement('script');
            g.async = true;
            g.crossOrigin = 'anonymous';
            g.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + c;
            head.appendChild(g);
            firedAd = true;
          }
        }
        if (granted && s.msAdsEnabled && !firedAd) {
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
