/* Tukuk-OS theme controller — load early in <head>, no defer. */
(function () {
  var KEY_THEME = 'tk-theme';
  var KEY_ACCENT = 'tk-accent';
  var KEY_BG = 'tk-bg';
  var KEY_CUSTOM_BG = 'tk-custom-bg';
  var ORDER = ['system', 'light', 'dark'];
  var DEFAULT_ACCENT = 'blue';

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function preference() {
    var value = read(KEY_THEME);
    return ORDER.indexOf(value) >= 0 ? value : 'system';
  }
  function systemIsLight() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }
  function isDark() {
    var pref = preference();
    return pref === 'dark' || (pref === 'system' && !systemIsLight());
  }

  function apply() {
    var dark = isDark();
    var pref = preference();
    var accent = read(KEY_ACCENT) || DEFAULT_ACCENT;
    var bg = read(KEY_BG) || (window.__TK_DEFAULT_BG || 'default');
    var customBg = read(KEY_CUSTOM_BG) || (window.__TK_CUSTOM_BG || '');
    
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-pref', pref);
    root.setAttribute('data-accent', accent);

    if (document.body) {
      document.body.setAttribute('data-bg', bg);
    }
    if (bg === 'custom' && customBg) {
      root.style.setProperty('--custom-bg-img', 'url(' + customBg + ')');
    } else {
      root.style.removeProperty('--custom-bg-img');
    }

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f1115' : '#f7f8fa');

    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.textContent = pref === 'system' ? '◐' : (dark ? '☾' : '☀');
      toggle.setAttribute('aria-label', 'Colour theme: ' + pref);
      toggle.setAttribute('title', 'Theme: ' + pref + ' (click to change)');
    }

    var dots = document.querySelectorAll('[data-accent-set]');
    for (var i = 0; i < dots.length; i += 1) {
      dots[i].setAttribute(
        'aria-pressed',
        dots[i].getAttribute('data-accent-set') === accent ? 'true' : 'false'
      );
    }
  }

  function cycleTheme() {
    var next = ORDER[(ORDER.indexOf(preference()) + 1) % ORDER.length];
    write(KEY_THEME, next);
    apply();
  }

  function setTheme(pref) {
    write(KEY_THEME, ORDER.indexOf(pref) >= 0 ? pref : 'system');
    apply();
  }

  function setBg(bgMode, customUrl) {
    write(KEY_BG, bgMode);
    if (customUrl !== undefined) write(KEY_CUSTOM_BG, customUrl);
    apply();
  }

  function setAccent(color) {
    write(KEY_ACCENT, color);
    apply();
  }

  function bind() {
    var toggle = document.getElementById('theme-toggle');
    if (toggle && !toggle.dataset.tkBound) {
      toggle.dataset.tkBound = '1';
      toggle.addEventListener('click', cycleTheme);
    }
    var dots = document.querySelectorAll('[data-accent-set]');
    for (var i = 0; i < dots.length; i += 1) {
      if (dots[i].dataset.tkBound) continue;
      dots[i].dataset.tkBound = '1';
      (function (dot) {
        dot.addEventListener('click', function () {
          setAccent(dot.getAttribute('data-accent-set'));
        });
      })(dots[i]);
    }
    apply();
  }

  apply();

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (preference() === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
  document.addEventListener('DOMContentLoaded', bind);

  window.tkTheme = { 
    apply: apply, 
    cycle: cycleTheme, 
    bind: bind,
    setTheme: setTheme,
    setBg: setBg,
    setAccent: setAccent,
    getTheme: function () { return preference(); },
    getAccent: function () { return read(KEY_ACCENT) || DEFAULT_ACCENT; },
    getBg: function () { return read(KEY_BG) || 'default'; },
    getCustomBg: function () { return read(KEY_CUSTOM_BG) || ''; }
  };
})();

/* Error handler — suppress uninformative cross-origin Script errors and report actionable errors */
(function () {
  var sent = 0;
  var MAX = 8;

  function isThirdPartyOrScriptError(msg, src) {
    if (!msg || msg === 'Script error.' || msg.indexOf('Script error') !== -1) return true;
    if (src && (/clarity\.ms|fundingchoices|googlesyndication|doubleclick|pagead/i).test(src)) return true;
    return false;
  }

  window.onerror = function (msg, url) {
    if (isThirdPartyOrScriptError(msg, url)) {
      return true; // Suppress from window unhandled error reporting
    }
  };

  if (!window.fetch || !navigator.sendBeacon) return;

  function report(kind, message, source, line, col) {
    if (!message || sent >= MAX || isThirdPartyOrScriptError(message, source)) return;
    sent += 1;
    try {
      navigator.sendBeacon('/api/js-error', new Blob([JSON.stringify({
        kind: kind,
        message: String(message).slice(0, 400),
        source: String(source || '').slice(0, 300),
        line: line | 0,
        col: col | 0,
        page: location.pathname + location.search
      })], { type: 'application/json' }));
    } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    if (isThirdPartyOrScriptError(e.message, e.filename)) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      return;
    }
    if (e && e.target && e.target !== window && (e.target.src || e.target.href)) {
      report('resource', (e.target.tagName || 'RESOURCE') + ' failed to load: ' + (e.target.src || e.target.href), '', 0, 0);
      return;
    }
    report('error', e.message, e.filename, e.lineno, e.colno);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var msg = (r && (r.message || r.name)) || String(r) || '';
    if (isThirdPartyOrScriptError(msg, '')) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      return;
    }
    report('promise', msg || 'unhandled rejection', '', 0, 0);
  });
})();

/* Global mini-player — music/radio keeps playing on pages other than index
   (studio, editor, nasa, blog…). player.js disables itself when the index bar exists. */
(function () {
  try {
    if (/^\/admin/.test(location.pathname)) return;
    if (document.querySelector('script[data-tk-player]')) return;
    var s = document.createElement('script');
    s.src = '/player.js';
    s.defer = true;
    s.setAttribute('data-tk-player', '1');
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

/* Microsoft Clarity — injected ONLY when the admin enables it and sets a Project ID.
   Safe no-op when clarityEnabled=false / clarityId is empty (no outbound requests). */
(function () {
  try {
    if (/^\/admin/.test(location.pathname)) return;
    if (!window.fetch) return;
    fetch('/api/public/settings', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.clarityEnabled || !s.clarityId || window.clarity) return;
        var id = String(s.clarityId).trim();
        if (!/^[A-Za-z0-9]+$/.test(id)) return;
        (function (c, l, a, r, i, t, y) {
          c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
          t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
          y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
        })(window, document, 'clarity', 'script', id);
      })
      .catch(function () {});
  } catch (e) {}
})();

/* Tukuk ID — one identity for every app on tukuk.org.
   T Chat gives each account a permanent number (e.g. 100042). The chat session
   token is stored in localStorage on the same origin, so any app can ask
   "who is logged in?" without a new login form.
   Both functions below ONLY send a request when an app calls them —
   there is no automatic call while the page loads. */
window.tukukWhoami = function (force) {
  if (!force && window.__tukukWho) return Promise.resolve(window.__tukukWho);
  var kosong = { id: null, name: null, bio: '', joined: null }, tk = '';
  try { tk = localStorage.getItem('tukuk-chat-token') || ''; } catch (e) {}
  if (!tk || !window.fetch) return Promise.resolve(kosong);
  return fetch('/api/whoami', { headers: { Authorization: 'Bearer ' + tk }, cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var out = (j && j.id) ? { id: j.id, name: j.name, bio: j.bio || '', joined: j.joined || null } : kosong;
      window.__tukukWho = out;
      return out;
    })
    .catch(function () { return kosong; });
};

/* "Who owns this ID/name?" — T Chat directory lookup (needs a chat session). */
window.tukukLookup = function (q) {
  var tk = '';
  try { tk = localStorage.getItem('tukuk-chat-token') || ''; } catch (e) {}
  if (!tk || !window.fetch || !q) return Promise.resolve(null);
  return fetch('/api/chat/user?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + tk }, cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j && j.profile ? j.profile : null; })
    .catch(function () { return null; });
};
