/**
 * Session-aware auth chrome: nav Sign in ↔ Go to home.
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

  function goPortal() {
    location.href = portalUrl();
  }

  function guardAuthPage(page) {
    if (AUTH_PAGES.indexOf(page) < 0) return false;
    if (!isSignedIn()) return false;
    goPortal();
    return true;
  }

  function syncQuizTab() {
    var tab = document.querySelector('.app-nav-tab[data-app-nav="quiz"]');
    if (tab) tab.style.display = isSignedIn() ? 'none' : '';
  }

  function syncNavLink() {
    var link = document.getElementById('nav-signin-link');
    if (!link) return;

    if (isSignedIn()) {
      link.textContent = 'Go to home';
      link.href = portalUrl();
      link.className = 'app-nav-tab app-nav-tab--home nav-signin-link';
      link.setAttribute('aria-label', 'Go to your home');
      link.onclick = null;
    } else {
      link.textContent = 'Sign in';
      link.href = authUrl('signin');
      link.className = 'app-nav-tab nav-signin-link';
      link.setAttribute('aria-label', 'Sign in');
      link.onclick = null;
    }
  }

  function sync() {
    syncNavLink();
    syncQuizTab();
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
