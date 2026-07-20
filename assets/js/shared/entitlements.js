/**
 * FlightWay 2.0 — client entitlements (Pillar 0.3). UX only — real gating is
 * enforced server-side by functions/_lib/entitlements.js on every premium endpoint.
 *
 * Ships DARK: /config reports paywallEnabled=false until we flip it, so FWEnt.has()
 * returns true for everyone and gates never render. When the paywall is on, plan
 * comes from /auth/me. FWEnt.gate(el, key) swaps a locked element for an upgrade CTA.
 */
(function (global) {
  'use strict';

  var RANK = { free: 0, premium: 1, lifetime: 2 };
  // remaining: per-feature allowance left today. null = unlimited on this plan,
  // undefined (absent key) = not known yet. Free/paid merge §2.
  var state = { plan: 'free', paywall: false, loaded: false, dev: false, remaining: {} };
  var bootPromise = null;

  function rank(p) { return RANK[String(p == null ? 'free' : p).toLowerCase()] || 0; }

  function afetch(url) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') return FWAuth.authFetch(url, { method: 'GET' });
    return fetch(url, { method: 'GET', credentials: 'include' });
  }

  /** Pull plan + feature counters from /auth/me. Never rejects. */
  function pullMe() {
    return afetch('/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
      if (me) {
        state.plan = me.plan || 'free';
        state.dev = !!me.dev;
        if (me.remaining && typeof me.remaining === 'object') state.remaining = me.remaining;
      } else if (!state.loaded) {
        state.plan = 'free';
      }
      state.loaded = true;
      return state;
    }).catch(function () { state.loaded = true; return state; });
  }

  function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = fetch('/config').then(function (r) { return r.json(); }).then(function (cfg) {
      state.paywall = !!(cfg && cfg.paywallEnabled);
      if (!state.paywall) { state.plan = 'premium'; state.loaded = true; return state; }
      return pullMe().then(function () { return state; });
    }).catch(function () {
      // /config unreachable → assume dark so we never wrongly lock beta users.
      state.paywall = false; state.plan = 'premium'; state.loaded = true; return state;
    });
    return bootPromise;
  }

  function has(feature) {
    if (!state.paywall) return true;           // ship dark
    return rank(state.plan) >= rank(feature || 'premium');
  }

  /**
   * Render the upgrade CTA into an element unconditionally. Use when the server
   * has ALREADY refused (a 402 with upgrade:true) — the plan question is settled,
   * so a local has() check would only race the boot fetch. One lock style for
   * every gated surface (free/paid merge §4).
   */
  function lock(el, featureKey) {
    if (!el) return false;
    el.setAttribute('data-fw-gated', featureKey || 'premium');
    el.innerHTML = '<div class="fw-ent-gate">'
      + '<p class="fw-ent-gate-title">A Flight Plan feature</p>'
      + '<p class="fw-ent-gate-sub">Unlock interview prep, the resume builder, unlimited sims, weekly plans and receipts.</p>'
      + '<a class="fw-ent-gate-cta" href="pricing.html">See Flight Plan &rarr;</a>'
      + '</div>';
    return true;
  }

  /** Swap a locked element's content for an upgrade CTA. Returns true if it gated. */
  function gate(el, featureKey) {
    if (!el || has('premium')) return false;
    return lock(el, featureKey);
  }

  /**
   * Allowance left for a metered feature: a number, null when the plan has no
   * cap, or undefined when we haven't been told yet (boot skips /auth/me while
   * the paywall is dark — call refresh() on pages that actually show a counter).
   */
  function remaining(featureKey) {
    var v = state.remaining[featureKey];
    return v === undefined ? undefined : v;
  }

  /** Endpoints echo their post-spend counter back; feed it in so the UI updates without a refetch. */
  function setRemaining(featureKey, n) {
    if (!featureKey) return;
    state.remaining[featureKey] = (n === null || typeof n === 'number') ? n : undefined;
  }

  /** Force a fresh /auth/me read (plan + counters). Resolves to the state object. */
  function refresh() {
    return boot().then(pullMe);
  }

  global.FWEnt = {
    boot: boot,
    has: has,
    gate: gate,
    lock: lock,
    refresh: refresh,
    remaining: remaining,
    setRemaining: setRemaining,
    isDev: function () { return !!state.dev; },
    plan: function () { return state.plan; },
    paywallEnabled: function () { return state.paywall; },
  };

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})(typeof window !== 'undefined' ? window : globalThis);
