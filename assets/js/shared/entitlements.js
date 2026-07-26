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
  // limits: the enforced cap table, served whole by /config (WS-G). Read it —
  // never hand-write a cap in UI copy, or it drifts the first time one is retuned.
  var state = { plan: 'free', paywall: false, loaded: false, dev: false, remaining: {}, limits: {} };
  var bootPromise = null;
  // Features whose paywall_view we've already logged this page load. A data-*
  // flag on the gated element cannot do this job: opportunity-finder's
  // renderGate() and portal-flightplan both build a FRESH node every rerender,
  // so the flag is never there to see and the funnel would count renders, not
  // views. Null-proto so a slug like 'constructor' can't read as already-seen.
  var loggedGates = Object.create(null);

  function rank(p) { return RANK[String(p == null ? 'free' : p).toLowerCase()] || 0; }

  /**
   * Is this element actually on screen? getClientRects() is empty for anything
   * display:none or under a `hidden` ancestor, and non-empty for position:fixed
   * overlays (which is why offsetParent is the wrong test here).
   */
  function isRendered(el) {
    try {
      return !!(el && typeof el.getClientRects === 'function' && el.getClientRects().length);
    } catch (_) { return true; } // can't tell → count it; under-counting is worse
  }

  /**
   * Record that a paywall was SEEN, once per feature per page load. Exported
   * because a surface can be gated long before it is revealed (the mock-interview
   * overlay), and only that surface knows the moment it becomes visible.
   */
  function notePaywallView(featureKey) {
    try {
      var fk = featureKey || 'premium';
      if (loggedGates[fk] || !global.FWEvents) return false;
      loggedGates[fk] = 1;
      FWEvents.log('paywall_view', { feature: fk });
      return true;
    } catch (_) { return false; }
  }

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
      // Before the dark-paywall early return: pricing.html quotes free-plan caps
      // whether or not the paywall is live, so the table must always land.
      if (cfg && cfg.featureLimits && typeof cfg.featureLimits === 'object') state.limits = cfg.featureLimits;
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
    // Instrument here, not in gate(): gate() is just lock() behind has(), so
    // one emit covers both entry points — but ONLY if the student can see it.
    // interview-mode.js pre-gates the body of a hidden overlay on every
    // coach.html load, which would make the denominator "free page loads"
    // rather than "paywalls seen", and would then suppress the real view when
    // the panel finally opens. A surface nobody saw is not a paywall view.
    if (isRendered(el)) notePaywallView(featureKey || 'premium');
    el.innerHTML = '<div class="fw-ent-gate">'
      + '<p class="fw-ent-gate-title">A Flight Plan feature</p>'
      + '<p class="fw-ent-gate-sub">Unlock interview prep, the resume builder, unlimited sims and weekly plans.</p>'
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

  /**
   * The enforced cap for a feature on a plan: a number, null for unlimited, or
   * undefined when /config hasn't answered yet (or names no such feature).
   * Defaults to the CURRENT plan, so a caller that wants the free-tier number
   * for marketing copy must pass 'free' explicitly.
   */
  function limitFor(featureKey, plan) {
    var f = state.limits[featureKey];
    if (!f || !f.limits) return undefined;
    var v = f.limits[String(plan == null ? state.plan : plan).toLowerCase()];
    return v === undefined ? undefined : v;
  }

  /**
   * The cap table's own label for a feature ("Marco messages"), or ''. Pass a
   * count to get the singular where the table declares one — every V2 §4 taste
   * is a 1, and "1 free career simulations" reads like a bug.
   */
  function featureLabel(featureKey, count) {
    var f = state.limits[featureKey];
    if (!f) return '';
    if (count === 1 && f.one) return f.one;
    return f.label || '';
  }

  /**
   * 'day' | 'week' | 'month' | 'lifetime' | undefined — when this cap reopens.
   * The served value may be a per-PLAN map (§4's mock interview: a lifetime
   * taste on free, 3/day on premium), so resolve it against a plan; defaults to
   * the current one.
   */
  function resetPeriod(featureKey, plan) {
    var f = state.limits[featureKey];
    var rp = f && f.resetPeriod;
    if (!rp || typeof rp === 'string') return rp;
    return rp[String(plan == null ? state.plan : plan).toLowerCase()] || rp.free;
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
    notePaywallView: notePaywallView,
    refresh: refresh,
    remaining: remaining,
    setRemaining: setRemaining,
    limitFor: limitFor,
    featureLabel: featureLabel,
    resetPeriod: resetPeriod,
    isDev: function () { return !!state.dev; },
    plan: function () { return state.plan; },
    paywallEnabled: function () { return state.paywall; },
  };

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})(typeof window !== 'undefined' ? window : globalThis);
