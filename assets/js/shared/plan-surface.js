/**
 * FlightWay — plan surfaces (overhaul WS-G). The view layer over FWEnt: every
 * place the product tells a student what their plan gives them lives here, so
 * the copy, the numbers and the upgrade moments can't diverge page by page.
 *
 * Two declarative slots, filled wherever they appear:
 *   <div data-fw-plan-panel>            → plan badge + what's left (portal)
 *   <span data-fw-plan-chip="feature">  → one feature's allowance (roadmap)
 * plus one imperative card, capCard(), for the moment a cap is actually hit.
 *
 * Numbers come from FWEnt: the caps from /config (the table the server
 * enforces) and the counters from /auth/me. NOTHING here hand-writes a limit.
 *
 * WS-G G2 — the complete upgrade-moment inventory, and there are no others:
 *   1. a cap hit            → capCard() (Marco daily, roadmap lifetime)
 *   2. a locked feature     → FWEnt.gate() / FWEnt.lock()
 *   3. a locked feature's onboarding interstitial → FWFeatureIntro's plan CTA
 *   4. the pricing nav item + the portal billing row
 * An exhausted meter row carries the cap-hit link because an exhausted meter
 * IS moment 1, seen early. Nothing else nags: a paying student never meets one.
 */
(function (global) {
  'use strict';

  // Which meters the portal panel shows, in order. Deliberately not "every
  // metered feature": `marco-thread` caps how often the product interrupts
  // (WS-D D3), not something the student spends, and `mock-interview` is 0 on
  // free — a locked feature, which is moment 2's job, not a 0-of-0 meter.
  var PANEL_METERS = [
    'marco-chat', 'roadmap-generate', 'career-sim', 'opportunity-search', 'resume-draft',
    // S9. Appended, not inserted: the panel's order is asserted by index in
    // plan:ui-check, and a new row in the middle would silently re-point every
    // one of those assertions at a different feature.
    'deadline-refresh',
    // S16. Appended for the same reason. Unlike `mock-interview` this one DOES
    // belong on the panel even though it is a lifetime taste: free is 1 rather
    // than 0, so there is a real allowance to spend and "1 left" is information,
    // not a 0-of-0 wall wearing a meter's clothes.
    'scorecard-run',
    // S17. Appended, same reason as the two above — plan:ui-check asserts this
    // panel's order by index, so an insertion re-points every one of those
    // assertions at a different feature.
    'outreach-draft',
  ];

  // What upgrading actually buys, per feature. Copy, not caps — the numbers in
  // the sentence around it always come from FWEnt.
  var CAP_COPY = {
    'marco-chat': {
      sub: 'Flight Plan lifts the cap: unlimited Marco, every day.',
      fine: 'Your free messages come back tomorrow.',
    },
    'roadmap-generate': {
      sub: 'Flight Plan lifts the cap: rebuild your roadmap whenever your target moves.',
      fine: 'The roadmap you already built stays yours either way.',
    },
    'mock-interview': {
      sub: 'Flight Plan lifts the cap: three scored sessions a day, every day.',
      fine: 'Your practice session and its debrief stay in your history.',
    },
    'career-sim': {
      sub: 'Flight Plan lifts the cap: fly any career in the catalog, whenever you want.',
      fine: 'Simulations other students have already built stay free to fly.',
    },
    'opportunity-search': {
      sub: 'Flight Plan lifts the cap: search whenever your gaps change, and see every match.',
      fine: 'Your last set of matches stays here either way.',
    },
    'resume-draft': {
      sub: 'Flight Plan lifts the cap: redraft as often as your experience changes.',
      fine: 'Writing and editing your resume by hand is always free.',
    },
    'resume-tailor': {
      sub: 'Flight Plan lifts the cap: tailor a version for every posting you apply to.',
      fine: 'The version you already tailored stays saved.',
    },
    'deadline-refresh': {
      sub: 'Flight Plan lifts the cap: rescan for new deadlines whenever you want.',
      fine: 'Your radar, its alerts, and dates you add yourself are free forever.',
    },
    'scorecard-run': {
      sub: 'Flight Plan lifts the cap: rescore against live postings whenever you want, plus an automatic read every quarter.',
      fine: 'The scorecard you already ran stays here, and so does its trend.',
    },
    'outreach-draft': {
      sub: 'Flight Plan lifts the cap: a drafted message for every person worth contacting.',
      fine: 'Your list, your notes and the drafts you already have stay here either way.',
    },
  };

  // §4/D18: what a locked PREVIEW says — one line of value, never a nag. The
  // count in front of it is always the server's own lockedCount.
  var LOCK_COPY = {
    'opportunity-search': 'more matches for your exact skill gaps',
  };

  var PLAN_BADGE = {
    free: 'Free plan',
    premium: 'Flight Plan',
    lifetime: 'Lifetime',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ent() {
    return (global.FWEnt && typeof global.FWEnt.limitFor === 'function') ? global.FWEnt : null;
  }

  /**
   * What we can say about one feature right now:
   *   null           → say nothing (unlimited, unknown, or not a real feature)
   *   { left, limit } → a real allowance on this plan
   */
  function allowance(featureKey) {
    var e = ent();
    if (!e || !e.paywallEnabled()) return null;
    var limit = e.limitFor(featureKey);
    if (limit === null || limit === undefined || limit <= 0) return null;
    var left = e.remaining(featureKey);
    if (left === null || left === undefined || !isFinite(Number(left))) return null;
    return { left: Math.max(0, Number(left)), limit: limit, key: featureKey };
  }

  // §4 windows. A lifetime cap gets the bare "left" — there is no "this ever".
  var PERIOD_SUFFIX = { day: ' left today', week: ' left this week', month: ' left this month' };

  function periodSuffix(featureKey) {
    var e = ent();
    return PERIOD_SUFFIX[e && e.resetPeriod(featureKey)] || ' left';
  }

  function label(featureKey, count) {
    var e = ent();
    return (e && e.featureLabel(featureKey, count)) || featureKey;
  }

  /** "3 of 10 left today" · "None left this month" — the sentence a meter states. */
  function allowanceText(a) {
    var suffix = periodSuffix(a.key);
    if (a.left <= 0) return 'None' + suffix;
    // S18. `left` comes from the server's counter and `limit` from /config, and
    // an end-of-term bonus (plan-limits.js grantFeatureBonus) can legitimately
    // put the first above the second. "2 of 1 left" reads as a bug in the
    // product rather than a gift from it, so an over-allowance drops the
    // denominator and states the number it can actually stand behind.
    if (a.left > a.limit) return a.left + suffix;
    return a.left + ' of ' + a.limit + suffix;
  }

  /* ─── The cap-hit card (upgrade moment 1) ─────────────────────────── */

  /**
   * Markup for the one card every cap hit renders. `message` is the server's
   * own line from plan-limits.js (`checkFeatureLimit().message`) — pass it
   * through so the wall the student is told about is the wall that was
   * enforced. Escaped, always: it is server text on an innerHTML path.
   */
  function capCardHtml(featureKey, message) {
    var copy = CAP_COPY[featureKey] || { sub: 'Flight Plan lifts the cap.', fine: '' };
    var e = ent();
    var limit = e ? e.limitFor(featureKey, 'free') : null;
    var title = message || (limit
      ? 'You’ve used your ' + limit + ' free ' + label(featureKey, limit) + '.'
      : capitalizeFirst(label(featureKey)) + ' are a Flight Plan feature.');
    return '<div class="fw-plan-cap" role="status" data-fw-plan-cap="' + esc(featureKey) + '">'
      + '<p class="fw-plan-cap-title">' + esc(title) + '</p>'
      + '<p class="fw-plan-cap-sub">' + esc(copy.sub) + '</p>'
      + '<a class="fw-plan-cap-cta" href="pricing.html">See Flight Plan &rarr;</a>'
      + (copy.fine ? '<p class="fw-plan-cap-fine">' + esc(copy.fine) + '</p>' : '')
      + '</div>';
  }

  function capitalizeFirst(s) {
    return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  }

  /** Append the cap card to a host and return it. One per host, never stacked. */
  function capCard(host, featureKey, message) {
    if (!host) return null;
    var existing = host.querySelector('[data-fw-plan-cap="' + featureKey + '"]');
    if (existing) existing.parentNode.removeChild(existing);
    host.insertAdjacentHTML('beforeend', capCardHtml(featureKey, message));
    var card = host.querySelector('[data-fw-plan-cap="' + featureKey + '"]');
    if (global.FWEvents && typeof FWEvents.log === 'function') {
      try { FWEvents.log('plan_cap_hit', { feature: featureKey }); } catch (_) {}
    }
    return card;
  }

  /* ─── The locked preview tail (upgrade moment 2, inline) ──────────── */

  /**
   * §5 S8's shared lock, for a list a free plan only half-sees: N placeholder
   * rows behind a blur, one line of value, one Unlock link. D18 — inline,
   * never a modal.
   *
   * The rows are EMPTY on purpose. The server truncated the payload before it
   * was serialized, so there is nothing here to un-blur in devtools; this
   * renders a count the server sent, not content the CSS is hiding.
   */
  function lockedTailHtml(featureKey, count, opts) {
    var n = Math.max(0, Number(count) || 0);
    if (!n) return '';
    var o = opts || {};
    var line = n + ' ' + (o.line || LOCK_COPY[featureKey] || 'more on Flight Plan');
    var rows = '';
    for (var i = 0; i < Math.min(n, 3); i++) rows += '<div class="fw-lock-row" aria-hidden="true"></div>';
    return '<div class="fw-lock-tail" data-fw-gated="' + esc(featureKey) + '">'
      + '<div class="fw-lock-rows" aria-hidden="true">' + rows + '</div>'
      + '<div class="fw-lock-body">'
      + '<span class="fw-lock-chip">Locked</span>'
      + '<p class="fw-lock-line">' + esc(line) + '</p>'
      + '<a class="fw-lock-cta" href="pricing.html">Unlock with Flight Plan &rarr;</a>'
      + '</div></div>';
  }

  /** Append the locked tail to a host and count the paywall view. */
  function lockedTail(host, featureKey, count, opts) {
    var html = lockedTailHtml(featureKey, count, opts);
    if (!host || !html) return null;
    host.insertAdjacentHTML('beforeend', html);
    var el = host.querySelector('.fw-lock-tail[data-fw-gated="' + featureKey + '"]');
    // A locked preview IS a paywall the student saw. FWEnt dedupes per feature
    // per page load, so a re-render of the same list counts once.
    if (el && global.FWEnt && typeof FWEnt.notePaywallView === 'function') {
      try { FWEnt.notePaywallView(featureKey); } catch (_) {}
    }
    return el;
  }

  /* ─── Declarative slots ───────────────────────────────────────────── */

  /** One chip: "1 of 1 left". Hidden whenever there is nothing true to say. */
  function fillChip(el) {
    var key = el.getAttribute('data-fw-plan-chip');
    var a = allowance(key);
    if (!a) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = allowanceText(a);
    el.classList.toggle('is-low', a.left <= 1);
    el.classList.toggle('is-out', a.left === 0);
    el.setAttribute('title', label(key));
  }

  function meterRow(a) {
    var pct = a.limit > 0 ? Math.round((a.left / a.limit) * 100) : 0;
    var out = a.left === 0;
    return '<li class="fw-plan-meter' + (out ? ' is-out' : '') + '">'
      + '<span class="fw-plan-meter-label">' + esc(capitalizeFirst(label(a.key))) + '</span>'
      + '<span class="fw-plan-meter-track" aria-hidden="true">'
      + '<span class="fw-plan-meter-fill" style="width:' + pct + '%"></span></span>'
      + '<span class="fw-plan-meter-value">' + esc(allowanceText(a)) + '</span>'
      // Upgrade moment 1, met early: only an exhausted row says anything.
      + (out ? '<a class="fw-plan-meter-cta" href="pricing.html">Flight Plan lifts the cap &rarr;</a>' : '')
      + '</li>';
  }

  /**
   * The portal panel. Three shapes, and only three:
   *   preview (paywall dark) → one badge, no meters, because nothing is capped
   *   unlimited plan          → one badge, no meters, because nothing is capped
   *   free                    → badge + a meter per spendable allowance
   */
  function fillPanel(el) {
    var e = ent();
    if (!e) { el.hidden = true; return; }
    var badge, note, rows = '';

    if (!e.paywallEnabled()) {
      badge = 'Preview access';
      note = 'Every Flight Plan feature is unlocked while FlightWay is in preview.';
    } else if (e.isDev()) {
      badge = 'Developer access';
      note = 'Every Flight Plan feature is unlocked on this account.';
    } else {
      var plan = e.plan();
      badge = PLAN_BADGE[plan] || PLAN_BADGE.free;
      rows = PANEL_METERS.map(allowance).filter(Boolean).map(meterRow).join('');
      note = rows
        ? 'What’s left on your plan'
        : 'Nothing here is capped on your plan.';
    }

    el.hidden = false;
    el.innerHTML = '<div class="fw-plan-panel">'
      + '<div class="fw-plan-panel-head">'
      + '<span class="fw-plan-badge">' + esc(badge) + '</span>'
      + '<span class="fw-plan-note">' + esc(note) + '</span>'
      + '</div>'
      + (rows ? '<ul class="fw-plan-meters">' + rows + '</ul>' : '')
      + '</div>';
  }

  /** Fill every slot under `root`. Safe to call on every render — idempotent. */
  function sync(root) {
    var scope = root || global.document;
    if (!scope || typeof scope.querySelectorAll !== 'function') return;
    var chips = scope.querySelectorAll('[data-fw-plan-chip]');
    for (var i = 0; i < chips.length; i++) fillChip(chips[i]);
    var panels = scope.querySelectorAll('[data-fw-plan-panel]');
    for (var j = 0; j < panels.length; j++) fillPanel(panels[j]);
  }

  /** Pull fresh counters, then re-fill. Use after an endpoint spends one. */
  function refresh() {
    var e = ent();
    if (!e) return Promise.resolve();
    return e.refresh().then(function () { sync(); }).catch(function () { sync(); });
  }

  function boot() {
    sync();
    var e = ent();
    if (!e) return Promise.resolve();
    return e.boot().then(function () { sync(); }).catch(function () { /* slots stay hidden */ });
  }

  /* ─── Which upgrade moment a click came from ──────────────────────── */

  /** Feature keys are our own slugs; clamp anyway so only enum-ish text ships. */
  function sourceSlug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unknown';
  }

  /**
   * Name the moment (G2's list above) a pricing link sits in. Read only from
   * the enclosing container's own slug attributes — never the link's text,
   * which is copy and would put free text in the event stream.
   */
  function upgradeSource(a) {
    if (!a || typeof a.closest !== 'function') return 'nav';
    var cap = a.closest('[data-fw-plan-cap]');
    if (cap) return 'cap:' + sourceSlug(cap.getAttribute('data-fw-plan-cap'));
    var gate = a.closest('[data-fw-gated]');
    if (gate) return 'gate:' + sourceSlug(gate.getAttribute('data-fw-gated'));
    if (a.closest('.fw-plan-meter')) return 'meter';
    if (a.closest('#portal-billing')) return 'portal_billing';
    return 'nav';
  }

  // Module scope, wired once: boot() is exported and pages re-call it, so
  // wiring this inside boot() would attach twice and double every click.
  // Delegated, so CTAs rendered later (cap cards, gates, meters) count for
  // free; capture phase, so a stopPropagation() upstream can't swallow one.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var a = (t && typeof t.closest === 'function') ? t.closest('a[href^="pricing.html"]') : null;
      if (!a) return;
      try { if (global.FWEvents) FWEvents.log('upgrade_click', { source: upgradeSource(a) }); } catch (_) {}
    }, true);
  }

  global.FWPlanSurface = {
    boot: boot,
    sync: sync,
    refresh: refresh,
    capCard: capCard,
    capCardHtml: capCardHtml,
    lockedTail: lockedTail,
    lockedTailHtml: lockedTailHtml,
    allowance: allowance,
    allowanceText: allowanceText,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
})(typeof window !== 'undefined' ? window : globalThis);
