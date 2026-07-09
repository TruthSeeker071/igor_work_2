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
  var state = { plan: 'free', paywall: false, loaded: false };
  var bootPromise = null;

  function rank(p) { return RANK[String(p == null ? 'free' : p).toLowerCase()] || 0; }

  function afetch(url) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') return FWAuth.authFetch(url, { method: 'GET' });
    return fetch(url, { method: 'GET', credentials: 'include' });
  }

  function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = fetch('/config').then(function (r) { return r.json(); }).then(function (cfg) {
      state.paywall = !!(cfg && cfg.paywallEnabled);
      if (!state.paywall) { state.plan = 'premium'; state.loaded = true; return state; }
      return afetch('/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
        state.plan = (me && me.plan) || 'free';
        state.loaded = true;
        return state;
      }).catch(function () { state.loaded = true; return state; });
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

  /** Swap a locked element's content for an upgrade CTA. Returns true if it gated. */
  function gate(el, featureKey) {
    if (!el || has('premium')) return false;
    el.setAttribute('data-fw-gated', featureKey || 'premium');
    el.innerHTML = '<div class="fw-ent-gate">'
      + '<p class="fw-ent-gate-title">A Flight Plan feature</p>'
      + '<p class="fw-ent-gate-sub">Unlock interview prep, the resume builder, unlimited sims, weekly plans and receipts.</p>'
      + '<a class="fw-ent-gate-cta" href="pricing.html">See Flight Plan &rarr;</a>'
      + '</div>';
    return true;
  }

  global.FWEnt = {
    boot: boot,
    has: has,
    gate: gate,
    plan: function () { return state.plan; },
    paywallEnabled: function () { return state.paywall; },
  };

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})(typeof window !== 'undefined' ? window : globalThis);
