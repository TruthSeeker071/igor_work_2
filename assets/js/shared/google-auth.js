/**
 * FlightWay V2 S5 — Google OAuth client glue.
 *
 * Three jobs, all page-agnostic (loaded on auth.html for the buttons and on
 * portal.html for the landing so the funnel event fires wherever the callback
 * lands):
 *
 *   mount()   — reveal + wire any [data-google-auth] button, but ONLY when
 *               /config says googleAuthEnabled. The buttons ship hidden so a
 *               flag-off deploy shows a plain email form, never a dead button.
 *   landing() — after the server callback redirects back with ?fw_oauth=google,
 *               fire signup_complete|login (method:'google') + identify — the
 *               same events the password path fires in auth.js, so the funnel is
 *               counted once, client-side, with the anon_id present — then strip
 *               the one-shot params so a refresh cannot re-fire them.
 *   error()   — if the callback bounced back with ?goauth_err=…, show one line.
 *
 * Exposes FWGoogleAuth.startUrl(returnPath) so the S6 gate card can reuse the
 * exact same entry point without duplicating any of this.
 */
(function (global) {
  var doc = global.document;
  var configPromise = null;

  function getConfig() {
    if (configPromise) return configPromise;
    configPromise = global.fetch('/config')
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; });
    return configPromise;
  }

  function startUrl(returnPath) {
    var q = returnPath ? ('?return=' + encodeURIComponent(returnPath)) : '';
    return '/auth/google/start' + q;
  }

  function logEvent(name, props) {
    try { if (global.FWEvents) FWEvents.log(name, props || {}); } catch (_) { /* beacon absent */ }
  }

  // Rewrite the URL to drop a set of one-shot query params, preserving the rest
  // of the query and the hash.
  function stripParams(params, keys) {
    keys.forEach(function (k) { params.delete(k); });
    var qs = params.toString();
    var next = global.location.pathname + (qs ? '?' + qs : '') + global.location.hash;
    try { global.history.replaceState(null, '', next); } catch (_) { /* ignore */ }
  }

  function landing() {
    var params;
    try { params = new URLSearchParams(global.location.search); } catch (_) { return; }
    if (params.get('fw_oauth') !== 'google') return;
    var created = params.get('created') === '1';
    logEvent(created ? 'signup_complete' : 'login', { method: 'google' });
    // Marker only — the server already joins anon_id -> user_id off the session
    // cookie the callback set. Mirror of the password path's identify.
    logEvent('identify', {});
    // S15 (D24): parity with the password path. The callback binds the fw_ref
    // cookie server-side on a NEW account only and reports it back on the
    // redirect, because a browser cannot see an HttpOnly cookie being consumed.
    if (created && params.get('referred') === '1') logEvent('referral_signup', {});
    stripParams(params, ['fw_oauth', 'created', 'referred']);
  }

  function showError() {
    var params;
    try { params = new URLSearchParams(global.location.search); } catch (_) { return; }
    var reason = params.get('goauth_err');
    if (!reason) return;
    var el = doc && doc.getElementById('signin-error');
    if (el) {
      el.textContent = reason === 'unverified'
        ? 'Your Google account’s email isn’t verified, so we can’t sign you in with it. Use email and password instead.'
        : 'Google sign-in didn’t complete. Please try again, or use email and password.';
    }
    stripParams(params, ['goauth_err']);
  }

  function wireButton(btn, enabled) {
    if (!enabled) return; // leaves the wrapper hidden -> plain email form
    var wrap = btn.closest ? btn.closest('.auth-oauth') : null;
    if (wrap) wrap.hidden = false; else btn.hidden = false;
    btn.addEventListener('click', function () {
      var ret = btn.getAttribute('data-return') || '/portal.html';
      if (ret.charAt(0) !== '/') ret = '/' + ret;
      global.location.assign(startUrl(ret));
    });
  }

  function mount() {
    if (!doc) return;
    var btns = doc.querySelectorAll('[data-google-auth]');
    if (!btns.length) return;
    getConfig().then(function (cfg) {
      var enabled = !!(cfg && cfg.googleAuthEnabled);
      Array.prototype.forEach.call(btns, function (b) { wireButton(b, enabled); });
    });
  }

  function init() {
    landing();
    showError();
    mount();
  }

  global.FWGoogleAuth = { startUrl: startUrl, mount: mount };

  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
