/**
 * Session-aware auth chrome: nav Sign in tab, hidden once signed in.
 */
(function (global) {
  var AUTH_PAGES = ['signin', 'register'];

  function portalUrl() {
    return (global.FWPageBoot && FWPageBoot.URLS.portal) || 'portal.html';
  }

  function authUrl(hash) {
    var base = (global.FWPageBoot && FWPageBoot.URLS.auth) || 'auth.html';
    return hash ? base + '#' + hash : base;
  }

  function isSignedIn() {
    return !!(global.FWAuth && FWAuth.authEmail && FWAuth.authEmail());
  }

  // ── Signed-out nav variant ──────────────────────────────────────────────
  // The 11 app-nav pages carry a shared app-nav block with the 5 S7 tabs
  // (Home/Flight Plan/Roadmap/Marco/Explore) as `.app-nav-tab[data-app-nav]`.
  // Signed-out visitors should see a marketing nav instead.
  //
  // The selector is `.app-nav`, not `.nav-links.app-nav`: dashboard.html — now
  // the Explore tab, and the one app page a signed-out visitor is meant to
  // browse — carries `.app-nav.hub-app-nav` inside its fixed topbar, so the
  // narrower selector silently skipped it and left five signed-in-only tabs
  // (each of which bounces to /auth) as a visitor's only navigation.
  var PUBLIC_TABS = [
    { href: 'index.html#how-it-works', label: 'How it works' },
    { href: 'pricing.html', label: 'Pricing' }
  ];

  // Deliberately WITHOUT data-app-nav: app-nav.js's active-state sync queries
  // `[data-app-nav]` broadly, and these links aren't one of its known pages.
  function buildPublicTab(entry) {
    var a = document.createElement('a');
    a.className = 'app-nav-tab';
    a.href = entry.href;
    var span = document.createElement('span');
    span.className = 'app-nav-label';
    span.textContent = entry.label;
    a.appendChild(span);
    return a;
  }

  function buildGetStartedCta() {
    var a = document.createElement('a');
    a.href = 'quiz.html';
    a.className = 'fw-btn fw-btn-primary fw-btn-sm app-nav-cta';
    a.textContent = 'Get started';
    return a;
  }

  // Captured once, from the pristine DOM, the first time applyNavVariant()
  // runs — the signed-in ("app") tab set to restore later. currentManagedNodes
  // tracks whichever set (app or public) is presently inserted so the next
  // call knows what to remove, regardless of how many times the variant flips.
  var appTabNodesCache = null;
  var currentManagedNodes = null;

  function applyNavVariant() {
    var nav = document.querySelector('.app-nav');
    if (!nav) return;

    var variant = isSignedIn() ? 'app' : 'public';
    if (nav.getAttribute('data-fw-nav-variant') === variant) return; // idempotent

    if (appTabNodesCache === null) {
      appTabNodesCache = Array.prototype.slice.call(nav.querySelectorAll('.app-nav-tab[data-app-nav]'));
      currentManagedNodes = appTabNodesCache;
    }

    for (var i = 0; i < currentManagedNodes.length; i++) {
      var old = currentManagedNodes[i];
      if (old.parentNode) old.parentNode.removeChild(old);
    }

    var signinLink = document.getElementById('nav-signin-link');
    var themeToggle = nav.querySelector('.fw-theme-toggle');
    var nextNodes;

    if (variant === 'app') {
      nextNodes = appTabNodesCache;
      for (var a = 0; a < nextNodes.length; a++) {
        nav.insertBefore(nextNodes[a], signinLink || themeToggle || null);
      }
    } else {
      var tabs = PUBLIC_TABS.map(buildPublicTab);
      for (var b = 0; b < tabs.length; b++) {
        nav.insertBefore(tabs[b], signinLink || themeToggle || null);
      }
      var cta = buildGetStartedCta();
      // Inserted after the (untouched) sign-in link, before the (untouched)
      // theme toggle — mirrors index.html's [links][Sign in][Get started] order.
      nav.insertBefore(cta, themeToggle || null);
      nextNodes = tabs.concat([cta]);
    }

    currentManagedNodes = nextNodes;
    nav.setAttribute('data-fw-nav-variant', variant);
  }

  // ── Soft-verify banner (D7) ────────────────────────────────────────────
  // Signed in + explicitly unverified only (FWAuth.isVerified() defaults to
  // true when unknown, so a pre-migration account never sees this). Dismissal
  // is per-session (sessionStorage) so it returns next time the tab reopens.
  var VERIFY_BANNER_ID = 'fw-verify-banner';
  var VERIFY_DISMISS_KEY = 'fw_verify_banner_dismissed';
  var VERIFY_STYLE_ID = 'fw-verify-banner-style';

  function verifyBannerDismissed() {
    try { return sessionStorage.getItem(VERIFY_DISMISS_KEY) === '1'; } catch (_) { return false; }
  }

  function injectVerifyBannerStyle() {
    if (document.getElementById(VERIFY_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = VERIFY_STYLE_ID;
    // Self-contained dark plate — deliberately not theme-tokened so it reads
    // the same in light and dark rather than depend on every host page's CSS.
    style.textContent = ''
      + '.fw-verify-banner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;'
      + ' padding: 10px 20px; background: #111834; color: #e8edff; font-size: 13px; line-height: 1.4; }'
      + '.fw-verify-banner-text { flex: 1 1 auto; min-width: 200px; }'
      + '.fw-verify-banner-resend { font: inherit; cursor: pointer; background: none;'
      + ' border: 1px solid #6ea8ff; color: #6ea8ff; border-radius: 999px; padding: 4px 14px; white-space: nowrap; }'
      + '.fw-verify-banner-resend:hover:not(:disabled) { background: rgba(110,168,255,0.14); }'
      + '.fw-verify-banner-resend:disabled { opacity: 0.65; cursor: default; }'
      + '.fw-verify-banner-close { font: inherit; cursor: pointer; background: none; border: none;'
      + ' color: #e8edff; opacity: 0.65; font-size: 14px; line-height: 1; padding: 4px; }'
      + '.fw-verify-banner-close:hover { opacity: 1; }';
    document.head.appendChild(style);
  }

  function removeVerifyBanner() {
    var el = document.getElementById(VERIFY_BANNER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function verifyResendFetch() {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') {
      return FWAuth.authFetch('/auth/resend-verification', { method: 'POST' });
    }
    return fetch('/auth/resend-verification', { method: 'POST', credentials: 'include' });
  }

  function buildVerifyBanner() {
    var el = document.createElement('div');
    el.id = VERIFY_BANNER_ID;
    el.className = 'fw-verify-banner';
    el.setAttribute('role', 'note');

    var text = document.createElement('span');
    text.className = 'fw-verify-banner-text';
    text.textContent = 'Confirm your email to turn on your weekly Flight Plan and reminders.';

    var resend = document.createElement('button');
    resend.type = 'button';
    resend.className = 'fw-verify-banner-resend';
    resend.textContent = 'Resend';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'fw-verify-banner-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';

    resend.addEventListener('click', function () {
      if (resend.disabled) return;
      var restore = global.FWButtonBusy
        ? FWButtonBusy.start(resend, { label: 'Sending…' })
        : (function () { resend.disabled = true; return function () { resend.disabled = false; }; })();
      verifyResendFetch().then(function (resp) {
        return resp.json().catch(function () { return {}; }).then(function (data) {
          return { status: resp.status, data: data || {} };
        });
      }).then(function (res) {
        restore();
        if (res.data.verified) { removeVerifyBanner(); return; } // raced the email link — done
        if (res.status === 429) { resend.textContent = 'Try again tomorrow.'; resend.disabled = true; return; }
        if (res.data.ok) { resend.textContent = 'Sent — check your inbox.'; resend.disabled = true; }
      }).catch(function () { restore(); });
    });

    close.addEventListener('click', function () {
      try { sessionStorage.setItem(VERIFY_DISMISS_KEY, '1'); } catch (_) { /* ignore */ }
      removeVerifyBanner();
    });

    el.appendChild(text);
    el.appendChild(resend);
    el.appendChild(close);
    return el;
  }

  function syncVerifyBanner() {
    var shouldShow = isSignedIn()
      && global.FWAuth && typeof FWAuth.isVerified === 'function'
      && FWAuth.isVerified() === false
      && !verifyBannerDismissed();

    if (!shouldShow) { removeVerifyBanner(); return; }
    if (document.getElementById(VERIFY_BANNER_ID)) return; // already showing
    var nav = document.querySelector('nav');
    if (!nav) return;
    injectVerifyBannerStyle();
    nav.insertAdjacentElement('afterend', buildVerifyBanner());
  }

  function goPortal() {
    location.href = portalUrl();
  }

  function guardAuthPage(page) {
    if (AUTH_PAGES.indexOf(page) < 0) return false;
    if (!isSignedIn()) return false;
    goPortal();
    return true;
  }

  function syncNavLink() {
    var link = document.getElementById('nav-signin-link');
    if (!link) return;

    if (isSignedIn()) {
      // Every app page already carries a Home tab (data-app-nav="home"), so the
      // signed-in state hides this link outright instead of turning it into a
      // second Home affordance. .app-nav-tab's display:inline-flex beats the UA
      // [hidden] rule, hence the inline display too.
      link.textContent = '';
      link.removeAttribute('href');
      link.className = 'nav-signin-link';
      link.hidden = true;
      link.style.display = 'none';
      link.setAttribute('aria-hidden', 'true');
      link.setAttribute('tabindex', '-1');
      link.removeAttribute('aria-label');
      link.onclick = null;
    } else {
      link.textContent = 'Sign in';
      link.href = authUrl('signin');
      link.className = 'app-nav-tab nav-signin-link';
      link.hidden = false;
      link.style.display = '';
      link.removeAttribute('aria-hidden');
      link.removeAttribute('tabindex');
      link.setAttribute('aria-label', 'Sign in');
      link.onclick = null;
    }
  }

  function sync() {
    // S7 removed the signed-in Quiz tab outright (the quiz lives under Explore
    // and on Home), so the old syncQuizTab() hide-when-signed-in is gone with it.
    applyNavVariant();
    syncNavLink();
    syncVerifyBanner();
    if (global.FWPortal && typeof FWPortal.syncSignOutFooter === 'function') {
      FWPortal.syncSignOutFooter();
    }
  }

  function patchShowPage() {
    if (typeof showPage !== 'function' || showPage._fwAuthNavPatched) return;
    var orig = showPage;
    global.showPage = function (page) {
      if (guardAuthPage(page)) return;
      return orig.apply(this, arguments);
    };
    global.showPage._fwAuthNavPatched = true;
  }

  function onHashChange() {
    if (!document.body.classList.contains('auth-page')) return;
    var h = (global.location.hash || '').replace(/^#/, '').split('?')[0];
    guardAuthPage(h);
  }

  function init() {
    patchShowPage();
    sync();
    global.addEventListener('fw-auth-change', sync);
    global.addEventListener('hashchange', onHashChange);
    if (global.FWAuth && typeof FWAuth.authBoot === 'function') {
      FWAuth.authBoot().then(sync).catch(sync);
    }
  }

  global.FWAuthNav = {
    sync: sync,
    guardAuthPage: guardAuthPage,
    goPortal: goPortal,
    init: init,
  };

  patchShowPage();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
