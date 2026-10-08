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
    setBg: setBg,
    setAccent: setAccent,
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
