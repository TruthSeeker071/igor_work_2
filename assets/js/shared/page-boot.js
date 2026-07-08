/**
 * Cross-page URLs and auth gate helpers for split HTML entry points.
 */
(function (global) {
  const URLS = {
    portal: 'portal.html',
    roadmap: 'roadmap.html',
    coach: 'coach.html',
    quiz: 'quiz.html',
    auth: 'auth.html',
    hub: 'dashboard.html',
    profile: 'profile-build.html',
    career: 'career.html',
    index: 'index.html',
    legacy: 'Flightway.html',
  };

  function authEmail() {
    return global.FWAuth && typeof FWAuth.authEmail === 'function' ? FWAuth.authEmail() : null;
  }

  function parseNext() {
    try {
      return new URLSearchParams(location.search).get('next') || '';
    } catch (_) {
      return '';
    }
  }

  function safeNext(raw) {
    const next = String(raw || '').trim();
    if (!next || next.indexOf('://') >= 0 || next.indexOf('..') >= 0) return '';
    if (next.charAt(0) === '/') return next.slice(1);
    return next;
  }

  function redirectAfterAuth() {
    const next = safeNext(parseNext());
    location.replace(next || URLS.portal);
  }

  function authSignInUrl(next) {
    const n = safeNext(next);
    return n ? URLS.auth + '#signin?next=' + encodeURIComponent(n) : URLS.auth + '#signin';
  }

  function requireAuth(next) {
    if (authEmail()) return true;
    location.replace(authSignInUrl(next || (location.pathname.split('/').pop() || '') + location.search));
    return false;
  }

  function authBootThen(fn) {
    const run = function () {
      if (typeof fn === 'function') fn();
    };
    if (global.FWAuth && typeof FWAuth.authBoot === 'function') {
      return FWAuth.authBoot().then(run).catch(function (err) {
        console.warn('auth boot failed', err);
        run();
      });
    }
    run();
    return Promise.resolve();
  }

  global.FWPageBoot = {
    URLS: URLS,
    authEmail: authEmail,
    parseNext: parseNext,
    safeNext: safeNext,
    redirectAfterAuth: redirectAfterAuth,
    authSignInUrl: authSignInUrl,
    requireAuth: requireAuth,
    authBootThen: authBootThen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
