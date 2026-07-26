/**
 * FWPageVeil — full-page boot veil + one-shot entrance choreography gate.
 *
 * Pages that re-render several times while booting (portal, roadmap, coach)
 * keep an opaque #fw-page-veil over the content until the render storm goes
 * quiet, then reveal once. Reveal adds body.fw-revealed — CSS entrance
 * animations are scoped to `body.fw-revealed:not(.fw-settled)` so they play
 * exactly once from that moment. A beat later (or immediately, if another
 * render lands mid-choreography) body.fw-settled turns entrance animations
 * off, so later re-renders swap content in place instead of replaying the
 * staggered rise-in — the replay is what made cards/bars flash on and off
 * during load.
 *
 * Pages call FWPageVeil.notifyRender() from their render paths. When a page
 * has async work whose result re-renders visible content (e.g. the portal's
 * /portal-snapshot fetch), it wraps that work in hold()/release() so the veil
 * stays up until the data lands — the fetch shows as a loading screen instead
 * of the content jittering in after the veil already lifted. Everything else
 * (quiet-window detection, hard deadline, load failsafe) is handled here.
 */
(function (global) {
  var QUIET_MS = 280;      // reveal after no renders for this long
  var MIN_VEIL_MS = 120;   // never show the veil for less than this (anti-blink)
  var MAX_VEIL_MS = 4000;  // hard deadline — reveal no matter what, even if held
  var ENTRANCE_MS = 1200;  // entrance choreography window after reveal

  // The veil's contents are injected here rather than pasted into seven pages:
  // one silhouette, one place to change it. The veil element itself stays in
  // the HTML so it covers the page from first paint.
  function fillVeil() {
    var el = document.getElementById('fw-page-veil');
    if (!el || el.firstElementChild) return;
    el.innerHTML =
      '<div class="fw-veil-skeleton" aria-hidden="true">'
      + '<span class="fw-skeleton fw-veil-bar fw-veil-bar--nav"></span>'
      + '<span class="fw-skeleton fw-veil-bar fw-veil-bar--title"></span>'
      + '<span class="fw-skeleton fw-veil-bar fw-veil-bar--block"></span>'
      + '<span class="fw-skeleton fw-veil-bar fw-veil-bar--block"></span>'
      + '</div><span class="fw-vh">Loading…</span>';
  }

  var bootAt = Date.now();
  var revealed = false;
  var settled = false;
  var quietTimer = null;
  var settleTimer = null;
  var holdCount = 0;       // >0 while a page's async content is still loading
  var revealSubs = [];     // onReveal callbacks, fired once, after the reveal

  // Anything that must not appear over the veil (the feature interstitial)
  // waits here instead of guessing a timeout. Subscribing after the reveal
  // fires on the next tick, so a late subscriber behaves like an early one.
  function flushRevealSubs() {
    var subs = revealSubs;
    revealSubs = [];
    subs.forEach(function (fn) {
      try { fn(); } catch (_) { /* a subscriber must not break the reveal */ }
    });
  }

  function onReveal(fn) {
    if (typeof fn !== 'function') return;
    if (revealed) { setTimeout(fn, 0); return; }
    revealSubs.push(fn);
  }

  function settle() {
    if (settled) return;
    settled = true;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (document.body) document.body.classList.add('fw-settled');
  }

  function doReveal() {
    if (revealed) return;
    revealed = true;
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = null; }
    var run = function () {
      var body = document.body;
      if (!body) { settle(); return; }
      body.classList.add('fw-revealed');
      var el = document.getElementById('fw-page-veil');
      if (el) {
        el.classList.add('is-hidden');
        el.setAttribute('aria-busy', 'false');
      }
      settleTimer = setTimeout(settle, ENTRANCE_MS);
      flushRevealSubs();
    };
    var wait = MIN_VEIL_MS - (Date.now() - bootAt);
    if (wait > 0) setTimeout(run, wait); else run();
  }

  // Reveal only when nothing is holding the veil (async content still loading).
  function maybeReveal() {
    if (revealed || holdCount > 0) return;
    doReveal();
  }

  function scheduleReveal() {
    if (revealed) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(maybeReveal, QUIET_MS);
  }

  function notifyRender() {
    if (revealed) {
      // A re-render landed mid-choreography: snap to settled rather than let
      // freshly-created nodes replay the entrance stagger (the flicker bug).
      settle();
      return;
    }
    scheduleReveal();
  }

  function hold() {
    if (revealed) return;
    holdCount++;
  }

  function release() {
    if (holdCount > 0) holdCount--;
    if (revealed) return;
    // Give the just-resolved render one quiet window to paint, then reveal.
    scheduleReveal();
  }

  // Failsafes: the hard deadline force-reveals even while held (never trap the
  // user behind a hung request); the load fallback respects holds.
  fillVeil();
  setTimeout(doReveal, MAX_VEIL_MS);
  global.addEventListener('load', function () { setTimeout(maybeReveal, 600); });

  global.FWPageVeil = {
    notifyRender: notifyRender,
    reveal: doReveal,
    hold: hold,
    release: release,
    onReveal: onReveal,
  };
})(typeof window !== 'undefined' ? window : globalThis);
