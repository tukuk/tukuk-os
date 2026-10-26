/* Cookie / consent banner for Google Consent Mode v2 (self-hosted, no inline script).
   Loaded by server.js consentBootstrap() on pages that actually drop third-party cookies
   (AdSense, a FAST network, Clarity or GTM/GA). The inline default is already `denied`
   before this runs; here we only ASK the visitor and, on a choice, push a consent `update`
   so Google upgrades (or keeps) the signals. The answer is remembered in localStorage, so a
   returning visitor never sees the banner again — until they click “Manage cookies”, which
   calls window.tkConsent.open() to re-ask. It never blocks the page and degrades silently if
   localStorage or dataLayer is unavailable. */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  if (/^\/admin/.test(location.pathname)) return;
  var KEY = 'tk-adconsent';

  function stored() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function layer() { return (window.dataLayer = window.dataLayer || []); }

  // Push a Consent Mode update. If the gtag stub from consentBootstrap exists use it, else
  // push the raw command onto the dataLayer (the Google tag consumes it when it loads).
  function apply(state) {
    var v = state === 'granted' ? 'granted' : 'denied';
    var sig = { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v };
    if (typeof window.gtag === 'function') { try { window.gtag('consent', 'update', sig); } catch (e) { layer().push(['consent', 'update', sig]); } }
    else layer().push(['consent', 'update', sig]);
  }

  // Stand down if a Google-certified CMP (AdSense "Privacy & Messaging" / Funding Choices) is
  // already on the page — otherwise the visitor would see two consent prompts. We look for the
  // framework globals and its script/iframe hosts, which are specific to Google's CMP.
  function googleCmp() {
    try {
      if (window.__fcconfig || window.fundingChoices || window.__fc) return true;
      var sc = document.getElementsByTagName('script');
      for (var i = 0; i < sc.length; i++) {
        if (/fundingchoicesmessages\.google\.com|consent\.google\.com\//i.test(sc[i].src || '')) return true;
      }
      var fr = document.getElementsByTagName('iframe');
      for (var j = 0; j < fr.length; j++) {
        if (/fundingchoicesmessages\.google\.com|consent\.google\.com/i.test(fr[j].src || '')) return true;
      }
    } catch (e) {}
    return false;
  }

  var bar = null;
  function close() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }

  function decide(v) { apply(v); save(v); close(); }

  function build() {
    if (bar || googleCmp()) return;
    bar = document.createElement('div');
    bar.id = 'tk-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-modal', 'false');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#12151b;color:#e6e9ef;' +
      'border-top:1px solid #2a2f3a;padding:14px 16px;font:14px/1.5 system-ui,-apple-system,Arial,sans-serif;' +
      'box-shadow:0 -6px 24px rgba(0,0,0,.35)';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:960px;margin:0 auto;display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between';
    var msg = document.createElement('p');
    msg.style.cssText = 'margin:0;flex:1 1 300px';
    msg.innerHTML = 'We use cookies for advertising and analytics — including Google — to keep Tukuk-OS free to read. ' +
      'You can accept or reject; either way the site still works. <a href="/privacy" style="color:#8ab4ff;text-decoration:underline">Privacy&nbsp;Policy</a>';
    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
    var rej = document.createElement('button');
    rej.type = 'button'; rej.textContent = 'Reject';
    rej.style.cssText = 'cursor:pointer;border:1px solid #454b57;border-radius:9px;padding:9px 16px;font:inherit;background:transparent;color:#cfd6e2';
    var acc = document.createElement('button');
    acc.type = 'button'; acc.textContent = 'Accept all';
    acc.style.cssText = 'cursor:pointer;border:0;border-radius:9px;padding:9px 16px;font:inherit;font-weight:700;background:#4c8dff;color:#fff';
    rej.onclick = function () { decide('denied'); };
    acc.onclick = function () { decide('granted'); };
    btns.appendChild(rej); btns.appendChild(acc);
    wrap.appendChild(msg); wrap.appendChild(btns); bar.appendChild(wrap);
    document.documentElement.appendChild(bar);
  }

  // Only ask when no choice has been recorded yet. Google's CMP can inject a beat after our
  // deferred script, so re-check shortly after load: build only if theirs is still absent, and
  // tear our bar down if theirs appears later.
  function standDown() { if (bar && googleCmp()) close(); }
  if (!stored()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
    setTimeout(function () { if (!googleCmp()) build(); standDown(); }, 1500);
    setTimeout(standDown, 3200);
  }

  // Let a “Manage cookies” link (or the console) re-open the banner without clearing storage.
  window.tkConsent = {
    open: function () { save(''); build(); },
    state: function () { return stored() || 'unset'; },
    reset: function () { save(''); }
  };

  // Wire any [data-tk-consent] link in the footer so a visitor can withdraw or change their
  // choice later. It still points at /privacy as the href, so without JS it lands somewhere
  // valid and it is never a dead link.
  function bindManage(el) {
    el.addEventListener('click', function (e) { e.preventDefault(); window.tkConsent.open(); });
  }
  var manage = document.querySelectorAll('[data-tk-consent]');
  for (var i = 0; i < manage.length; i++) bindManage(manage[i]);
})();
