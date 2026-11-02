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
        // Clarity sets its own cookies, so it loads only once consent is granted: it is not a
        // Google property, it is not Consent-Mode aware, and /privacy discloses it as a
        // granted-consent tool.
        if (granted && s.clarityEnabled) {
          var cid = String(s.clarityId || '');
          if (/^[a-z0-9]+$/i.test(cid)) {
            var cl = document.createElement('script');
            cl.async = true;
            cl.src = 'https://www.clarity.ms/tag/' + cid;
            head.appendChild(cl);
          }
        }
        // The Google tag is NOT behind the grant, and that is Google's own design, not a loophole:
        // Consent Mode means the tag is always present and Google decides what the declared state
        // permits — under `denied` it writes no cookie and sends at most a cookieless hit, under
        // `granted` it measures normally. Gating the loader instead measures nobody at all, so the
        // property cannot even see the consent split (and tukuk.org's GA4 stream looked empty for
        // exactly this reason on 2026-11-02). The `consent default` push above runs before this in
        // the same synchronous block, so no hit is ever sent under an undeclared state. Server-
        // rendered pages already behaved this way (googleTagHead() ignores `granted`), which is why
        // the blog reported traffic while the homepage did not — the two paths now agree.
        if (s.gtmEnabled) {
          var gid = String(s.gtmId || '').toUpperCase();
          if (/^G-[A-Z0-9]+$/.test(gid)) {
            // A GA4 measurement ID pasted in Admin → Google's "install manually" incantation,
            // exactly what googleTagHead() emits on server-rendered pages. Without this branch
            // the SPA pages (home, search, store…) silently dropped the measurement ID, so the
            // property looked dead while the blog pages reported traffic.
            var gs = document.createElement('script');
            gs.async = true;
            gs.src = 'https://www.googletagmanager.com/gtag/js?id=' + gid;
            head.appendChild(gs);
            var gc = document.createElement('script');
            gc.text = "gtag('js',new Date());gtag('config','" + gid + "');";
            head.appendChild(gc);
          } else if (/^(GTM|GT)-[A-Z0-9]+$/.test(gid)) { // classic GTM container (GTM-) or the new Google tag (GT-)
            var gt = document.createElement('script');
            gt.text = "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" + gid + "');";
            head.appendChild(gt);
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
          // The feed now returns the canonical `ca-pub-…` form (normalized on read AND on save),
          // so a `pub-…` pasted into Admin still reaches the homepage loader.
          if (/^pub-\d+$/.test(c)) c = 'ca-' + c;
          if (/^ca-pub-\d+$/.test(c)) {
            var g = document.createElement('script');
            g.async = true;
            g.crossOrigin = 'anonymous';
            g.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + c;
            head.appendChild(g);
            firedAd = true;
            // Google ad-block-recovery base tag (Funding Choices), keyed to the same publisher.
            var fcs = document.createElement('script');
            fcs.async = true;
            fcs.src = 'https://fundingchoicesmessages.google.com/i/' + c.replace(/^ca-/, '') + '?ers=1';
            head.appendChild(fcs);
            (function sig() {
              if (!window.frames['googlefcPresent']) {
                if (document.body) {
                  var f = document.createElement('iframe');
                  f.style.cssText = 'width:0;height:0;border:none;z-index:-1000;left:-1000px;top:-1000px;display:none';
                  f.name = 'googlefcPresent';
                  document.body.appendChild(f);
                } else setTimeout(sig, 0);
              }
            })();
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
