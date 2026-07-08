(function () {
  var STORAGE_KEY = 'flightway-theme';
  var root = document.documentElement;

  function getStored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function updateToggles(theme) {
    document.querySelectorAll('.fw-theme-toggle').forEach(function (btn) {
      var isDark = theme === 'dark';
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      var icon = btn.querySelector('.fw-theme-icon');
      if (icon) {
        icon.innerHTML = isDark
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      }
    });
  }

  function readToken(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function asRgb(tokenName) {
    var v = readToken(tokenName);
    if (!v) return '';
    return v.indexOf('rgb') === 0 ? v : 'rgb(' + v + ')';
  }

  /** Safari/WebKit: fixed layers + animated transforms cache old token colors until repainted. */
  function paintThemeSurfaces() {
    var body = document.body;
    if (!body) return;

    var bg = asRgb('--bg');
    var text = asRgb('--text');
    var textMuted = asRgb('--text-muted');
    var primary = asRgb('--primary');
    var navBg = readToken('--nav-bg');
    if (!navBg || navBg.indexOf('rgb') !== 0) navBg = bg;

    body.style.setProperty('background-color', bg);
    body.style.setProperty('color', text);

    document.querySelectorAll('.fw-nav, nav, #topbar, .fw-mobile-menu').forEach(function (el) {
      el.style.setProperty('background-color', navBg);
      el.style.setProperty('color', text);
    });

    document.querySelectorAll('.fw-mask-inner').forEach(function (el) {
      el.style.setProperty('color', el.classList.contains('peach') ? primary : text);
      el.style.setProperty('transform', 'none');
      el.style.setProperty('opacity', '1');
    });

    document.querySelectorAll('.fw-hero-fade').forEach(function (el) {
      el.style.setProperty('opacity', '1');
      el.style.setProperty('transform', 'none');
    });

    document.querySelectorAll('.fw-hero-sub, .fw-eyebrow, .fw-proof').forEach(function (el) {
      el.style.setProperty('color', textMuted);
    });

    document.querySelectorAll('.fw-text-link, .fw-btn-ghost').forEach(function (el) {
      el.style.setProperty('color', textMuted);
    });

    document.querySelectorAll(
      '.fw-brand, .fw-brand-text, .fw-menu-btn, .fw-theme-toggle, ' +
      '.fw-nav-links a:not(.fw-btn-primary), .nav-links a:not(.app-nav-tab):not(.nav-cta)'
    ).forEach(function (el) {
      el.style.setProperty('color', text);
    });

    var canvas = document.getElementById('fw-data-field');
    if (canvas) {
      canvas.style.setProperty('opacity', readToken('--canvas-opacity') || '1');
    }
  }

  function beginThemeSwitch() {
    root.classList.add('theme-switching');
    void root.offsetHeight;
  }

  function finishThemeSwitch() {
    requestAnimationFrame(function () {
      root.classList.remove('theme-switching');
      void root.offsetHeight;
    });
  }

  function apply(theme, opts) {
    opts = opts || {};
    var prev = root.getAttribute('data-theme');
    if (prev === theme) {
      updateToggles(theme);
      return;
    }

    beginThemeSwitch();

    root.setAttribute('data-theme', theme);
    if (document.body) document.body.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;

    void root.offsetHeight;
    paintThemeSurfaces();
    void root.offsetHeight;

    updateToggles(theme);
    finishThemeSwitch();

    if (!opts.silent) {
      window.dispatchEvent(new CustomEvent('flightway-theme-change', { detail: { theme: theme } }));
    }
  }

  function enableTransitions() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add('theme-ready');
      });
    });
  }

  function init() {
    var theme = getStored() || 'light';
    apply(theme, { silent: true });
    enableTransitions();

    document.querySelectorAll('.fw-theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
        apply(next);
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      beginThemeSwitch();
      paintThemeSurfaces();
      finishThemeSwitch();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
