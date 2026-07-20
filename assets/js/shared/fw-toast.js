/**
 * Shared toast (v2) — fixed bottom-center, slide-up + fade, one-at-a-time (replace).
 *
 * Global: FWFwToast.show(message, opts?)
 *   opts.kind:     'success' | 'error' | 'info'  (default 'info')
 *   opts.duration: auto-dismiss ms (default 4200)
 * Back-compat: FWFwToast.show(message) is unchanged — every existing call site
 * (portal, roadmap, skill-gap, artifacts, career-target, advisor) keeps working.
 * a11y: role="status" + aria-live="polite" preserved; reduced motion drops the slide.
 */
(function (global) {
  var toastTimer = null;
  var HIDE_MS = 4200;

  function ensureToastEl() {
    var el = document.getElementById('fw-toast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fw-toast';
    el.className = 'fw-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function show(message, opts) {
    if (!message) return;
    opts = opts || {};
    var el = ensureToastEl();
    el.textContent = message;
    // stacking cap of 1: replace content, reset variant, replay entrance
    el.className = 'fw-toast fw-toast--' + (opts.kind || 'info');
    void el.offsetWidth; // force reflow so re-adding is-in replays the transition
    el.classList.add('is-in');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, opts.duration || HIDE_MS);
  }

  function hide() {
    var el = document.getElementById('fw-toast');
    if (el) el.classList.remove('is-in'); // CSS transition fades it out; stays in DOM
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  }

  global.FWFwToast = { show: show, hide: hide };
})(typeof window !== 'undefined' ? window : globalThis);
