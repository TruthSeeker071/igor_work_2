/**
 * FlightWay V2 S16 — Live-posting readiness scorecard, client half (D13).
 *
 * Server contract lives in functions/scorecard.js (finished, not touched
 * here). Mounts into #flightplan-scorecard on flightplan.html: score + band,
 * a trend sparkline once there is a second read, the requirement checklist,
 * up to three "turn this into a roadmap step" actions, and up to five live
 * postings with a save-to-tracker button.
 *
 * Idiom: afetch()/IIFE/mount-guard copied from deadline-radar.js. The HTML
 * assembly itself follows opportunity-finder.js instead (innerHTML strings
 * built through a local esc(), one delegated click listener on the host) —
 * deadline-radar.js's own body is pure createElement/textContent and this
 * panel has too many nested, re-rendering pieces (due-date pickers, per-card
 * busy/error state, a sparkline) for that to stay readable. Every server
 * string still goes through esc() before it reaches innerHTML; postings'
 * `url` is additionally required to match /^https:\/\//. Errors are read
 * straight off the response body's own `error`/`message` field with a plain
 * fallback string, exactly like deadline-radar.js's submitAdd() and
 * commitments-panel.js's postCommitment() actually do (neither one, nor
 * opportunity-finder.js, routes through FWErr).
 *
 * Cap numbers are never computed here — FWPlanSurface (backed by /config) owns
 * every "N left" and the cap-hit card, per house rule (§3 rule 11).
 */
(function (global) {
  'use strict';

  function afetch(url, method, bodyObj, timeoutMs) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') {
      var opts = { method: method || 'GET' };
      if (bodyObj) opts.body = bodyObj;
      if (timeoutMs) opts.timeoutMs = timeoutMs;
      return FWAuth.authFetch(url, opts);
    }
    var o = { method: method || 'GET', credentials: 'include' };
    if (bodyObj) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(bodyObj); }
    return fetch(url, o);
  }

  var HOST_ID = 'flightplan-scorecard';
  var FEATURE = 'scorecard-run';

  /**
   * The run POST needs its own timeout, and it is the most important number in
   * this file. `authFetch` defaults to 30s; one server-side run is three
   * researchWeb calls (8s each, one retryable) plus a 25s shaping call, so a
   * slow-but-successful run can land past 30 seconds. Aborting it at the default
   * would be the worst possible outcome: the allowance is spent server-side
   * BEFORE the model work starts, so a free student would lose their one
   * lifetime run to a report that was written and saved and that they never saw.
   * 60s matches what opportunity-finder.js uses for the same three-research
   * shape. The panel adds no timeout of its own on top of it.
   */
  var RUN_TIMEOUT_MS = 60000;

  // Reasons that will fail again identically until the student does something
  // OFF this panel (build a roadmap, add a resume) — no point re-showing a
  // button that will just re-produce the same refusal.
  var NO_RETRY_REASONS = { 'no-career': 1, 'no-resume': 1 };

  // GET never explains a groundingOn:false/no-report resting state on its own
  // (that reason string only exists on the POST /run refusal) — this mirrors
  // that endpoint's own REASON_COPY['grounding-off'] so the copy agrees.
  var GROUNDING_OFF_COPY = 'Live posting search is off right now, so there is nothing to score against yet.';

  var STATUS_LABEL = { met: 'Met', partial: 'Partial', missing: 'Missing' };
  var KIND_LABEL = {
    skill: 'Skill', tool: 'Tool', experience: 'Experience', credential: 'Credential', coursework: 'Coursework',
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var host = null;
  var state = {
    loaded: false,
    ready: true,
    groundingOn: true,
    id: '',
    at: null,
    report: null,
    trend: [],
    cap: null,
    reason: '',
    message: '',
    lastRunFailure: null, // { reason, message } from a failed POST run, kept until the next run
    running: false,
    viewedLogged: false,
    capLogged: false,
    actionsUi: {},   // actionId -> { pickerOpen, busy, error, result:{duplicate,waypointTitle} }
    postingsUi: {},  // index    -> { busy, done, duplicate, error }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isHttpsUrl(u) { return /^https:\/\//.test(String(u || '')); }

  /**
   * §4: every wall emits `plan_cap_hit`. This panel renders its cap card from
   * `FWPlanSurface.capCardHtml()` (a string, because the whole body is one
   * innerHTML pass) rather than `capCard()`, which is the helper that logs the
   * event itself — so the event has to be fired here or this would be the one
   * metered surface in the product whose wall is invisible in the funnel.
   *
   * Once per mount, not per render: `renderBody()` rebuilds the card on every
   * state change while the cap stays spent. Same reason roadmap.js keeps its own
   * `capCardLogged` flag.
   */
  function logCapHit() {
    if (state.capLogged) return;
    state.capLogged = true;
    try { if (global.FWEvents) FWEvents.log('plan_cap_hit', { feature: FEATURE }); } catch (_) { /* fire-and-forget */ }
  }

  function monthYear(iso) {
    var d = new Date(String(iso || ''));
    if (isNaN(d.getTime())) return '';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // ---- run control (the button / allowance line / cap card / off-note) ----
  // The one place that decides whether a working Run control can be shown at
  // all — every render path (intro, degraded-with-retry, full report) calls
  // this instead of building its own button, so "never show a button that
  // cannot work" only has to be true in one function.

  function renderRunControl() {
    if (!state.ready) return '';
    if (!state.groundingOn) return '<p class="sc-run-note">' + esc(GROUNDING_OFF_COPY) + '</p>';
    if (state.cap && state.cap.ok === false) {
      return (global.FWPlanSurface && typeof FWPlanSurface.capCardHtml === 'function')
        ? FWPlanSurface.capCardHtml(FEATURE, state.cap.message)
        : '<p class="sc-run-note">' + esc(state.cap.message || 'No runs left right now.') + '</p>';
    }
    var allowanceHtml = '';
    if (global.FWPlanSurface && typeof FWPlanSurface.allowance === 'function') {
      var a = FWPlanSurface.allowance(FEATURE);
      if (a) allowanceHtml = '<span class="sc-run-allowance">' + esc(FWPlanSurface.allowanceText(a)) + '</span>';
    }
    var label = state.report ? 'Run again' : 'Run my scorecard';
    return '<div class="sc-run-wrap"><button type="button" class="sc-run-btn" data-sc-run>' + esc(label) + '</button>' + allowanceHtml + '</div>';
  }

  // ---- degraded / empty / loading -----------------------------------------

  function degradedHtml(reason, message, showControl) {
    var link = '';
    if (reason === 'no-career') link = '<a class="fp-empty-cta" href="roadmap.html">Build my roadmap &rarr;</a>';
    else if (reason === 'no-resume') link = '<a class="fp-empty-cta" href="resume.html">Add my resume &rarr;</a>';
    return '<p class="fp-empty">' + esc(message) + '</p>' + link + (showControl ? renderRunControl() : '');
  }

  function introHtml() {
    return '<p class="fp-empty">See how you stack up against real, live postings for your target career — what is met, partial and missing, backed by your own record.</p>'
      + renderRunControl();
  }

  // ---- header: score, band, scan count, run control ------------------------

  function headerHtml(r) {
    return '<div class="sc-header">'
      + '<div class="sc-score-row">'
      // The unit is not decoration: "63" beside a band chip reads as a count of
      // something (requirements? postings?). The plan's own wording is "% ready",
      // and `N + '%'` inline is the same idiom career-target.js, roadmap.js and
      // skill-gap-tracker.js all use for a score.
      + '<span class="sc-score-num">' + esc(String(r.score)) + '%</span>'
      + '<div class="sc-score-text">'
      + '<span class="sc-band sc-band--' + esc(r.band) + '">' + esc(r.bandLabel) + '</span>'
      + '<p class="sc-blurb">' + esc(r.bandBlurb) + '</p>'
      + '</div></div>'
      + '<p class="sc-scanned">Scanned ' + (Array.isArray(r.postings) ? r.postings.length : 0) + ' live postings for ' + esc(r.careerName) + '</p>'
      + (state.lastRunFailure ? '<p class="sc-run-result">' + esc(state.lastRunFailure.message) + '</p>' : '')
      + renderRunControl()
      + '</div>';
  }

  // ---- trend: sparkline + delta line ---------------------------------------

  function sparklineSvg(trend) {
    var W = 120, H = 28, pad = 3;
    var scores = trend.map(function (t) { return Math.max(0, Math.min(100, Number(t.score) || 0)); });
    var n = scores.length;
    var stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
    var pts = scores.map(function (s, i) {
      var x = pad + i * stepX;
      var y = pad + (H - pad * 2) * (1 - s / 100);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="sc-spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" focusable="false">'
      + '<polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      + '</svg>';
  }

  function trendHtml() {
    var trend = state.trend || [];
    if (trend.length < 2) return '';
    var newest = trend[trend.length - 1];
    var prev = trend[trend.length - 2];
    var deltaText;
    if (newest.delta === null || newest.delta === undefined) {
      deltaText = 'your first read';
    } else {
      var d = Number(newest.delta) || 0;
      if (d === 0) deltaText = 'no change';
      else {
        var since = monthYear(prev && prev.at);
        deltaText = (d > 0 ? '+' + d : String(d)) + (since ? ' since ' + since : '');
      }
    }
    return '<div class="sc-trend">' + sparklineSvg(trend) + '<span class="sc-trend-text">' + esc(deltaText) + '</span></div>';
  }

  // ---- requirements ---------------------------------------------------------

  function requirementRowHtml(req) {
    var status = STATUS_LABEL[req.status] || req.status || '';
    var kind = KIND_LABEL[req.kind] || req.kind || '';
    var chip = (req.evidenceIds && req.evidenceIds.length)
      ? '<span class="sc-req-evidence">Backed by your record</span>' : '';
    return '<li class="sc-req-row sc-req-row--' + esc(req.status) + '">'
      + '<span class="sc-req-status">' + esc(status) + '</span>'
      + '<span class="sc-req-text">' + esc(req.text) + '</span>'
      + '<span class="sc-req-kind">' + esc(kind) + '</span>'
      + chip
      + '</li>';
  }

  function requirementsHtml(r) {
    var reqs = Array.isArray(r.requirements) ? r.requirements : [];
    if (!reqs.length) return '';
    var core = reqs.filter(function (q) { return q && q.importance === 'core'; });
    var preferred = reqs.filter(function (q) { return q && q.importance !== 'core'; });
    var html = '<div class="sc-requirements"><h3 class="sc-subhead">Requirements</h3>';
    if (core.length) {
      html += '<h4 class="sc-group-title">Core</h4><ul class="sc-req-list">' + core.map(requirementRowHtml).join('') + '</ul>';
    }
    if (preferred.length) {
      html += '<h4 class="sc-group-title">Preferred</h4><ul class="sc-req-list">' + preferred.map(requirementRowHtml).join('') + '</ul>';
    }
    html += '</div>';
    return html;
  }

  // ---- actions: commit-to-roadmap cards, each with an inline due picker ----

  function duePickerHtml(actionId) {
    var FWC = global.FWCommitments;
    var qd = (FWC && typeof FWC.quickDates === 'function') ? FWC.quickDates() : null;
    var quick = qd
      ? '<button type="button" class="sc-due-quick-btn" data-sc-due="' + esc(qd.thisWeek) + '">This week</button>'
        + '<button type="button" class="sc-due-quick-btn" data-sc-due="' + esc(qd.nextWeek) + '">Next week</button>'
      : '';
    var minAttr = qd ? ' min="' + esc(qd.today) + '"' : '';
    return '<div class="sc-due-picker" data-sc-due-picker="' + esc(actionId) + '">'
      + (quick ? '<div class="sc-due-quick">' + quick + '</div>' : '')
      + '<input type="date" class="sc-due-input"' + minAttr + '>'
      + '<button type="button" class="sc-due-go" data-sc-due-go="' + esc(actionId) + '">Set date</button>'
      + '</div>';
  }

  function actionCardHtml(a) {
    var ui = state.actionsUi[a.id] || {};
    var html = '<div class="sc-action-card" data-sc-action="' + esc(a.id) + '">'
      + '<p class="sc-action-text">' + esc(a.text) + '</p>'
      + '<p class="sc-action-req">Closes: ' + esc(a.requirement) + '</p>';
    if (ui.result) {
      html += '<p class="sc-action-confirm">' + (ui.result.duplicate
        ? 'Already on your roadmap.'
        : ('Added to your roadmap: ' + esc(ui.result.waypointTitle) + '.')) + '</p>';
    } else {
      html += '<div class="sc-action-btns">'
        + '<button type="button" class="sc-action-commit" data-sc-commit="' + esc(a.id) + '"' + (ui.busy ? ' disabled' : '') + '>Commit to this</button>'
        + '<button type="button" class="sc-action-nodate" data-sc-nodate="' + esc(a.id) + '"' + (ui.busy ? ' disabled' : '') + '>Add without a date</button>'
        + '</div>';
      if (ui.pickerOpen) html += duePickerHtml(a.id);
      if (ui.error) html += '<p class="sc-action-error">' + esc(ui.error) + '</p>';
    }
    html += '</div>';
    return html;
  }

  function actionsHtml(r) {
    var actions = Array.isArray(r.actions) ? r.actions : [];
    if (!actions.length) return '';
    return '<div class="sc-actions"><h3 class="sc-subhead">Next actions</h3><div class="sc-actions-list">'
      + actions.map(actionCardHtml).join('') + '</div></div>';
  }

  // ---- postings ---------------------------------------------------------

  function postingRowHtml(p, idx) {
    var url = String(p.url || '');
    var titleHtml = isHttpsUrl(url)
      ? '<a class="sc-posting-title" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(p.title) + '</a>'
      : '<span class="sc-posting-title">' + esc(p.title) + '</span>';
    var metaParts = [];
    if (p.org) metaParts.push(esc(p.org));
    if (p.location) metaParts.push(esc(p.location));
    var metaHtml = metaParts.length ? '<span class="sc-posting-meta">' + metaParts.join(' &middot; ') + '</span>' : '';

    var ui = state.postingsUi[idx] || {};
    var trackHtml;
    if (ui.done) {
      trackHtml = '<span class="sc-posting-tracked">' + (ui.duplicate ? 'Already tracked' : 'Tracking') + '</span>';
    } else {
      trackHtml = '<button type="button" class="sc-posting-track" data-sc-track="' + idx + '"' + (ui.busy ? ' disabled' : '') + '>Track this</button>';
    }
    var errHtml = ui.error ? '<span class="sc-posting-error">' + esc(ui.error) + '</span>' : '';

    return '<li class="sc-posting-row">'
      + titleHtml + metaHtml
      + '<div class="sc-posting-foot">' + trackHtml + errHtml + '</div>'
      + '</li>';
  }

  function postingsHtml(r) {
    var postings = Array.isArray(r.postings) ? r.postings : [];
    if (!postings.length) return '';
    return '<div class="sc-postings"><h3 class="sc-subhead">Live postings</h3><ul class="sc-postings-list">'
      + postings.map(postingRowHtml).join('') + '</ul></div>';
  }

  // ---- shell --------------------------------------------------------------

  function reportHtml() {
    var r = state.report;
    return headerHtml(r) + trendHtml() + requirementsHtml(r) + actionsHtml(r) + postingsHtml(r);
  }

  function renderBody() {
    if (!state.loaded) return '<p class="fp-empty">Loading your scorecard&hellip;</p>';
    if (!state.ready) return degradedHtml(state.reason, state.message, false);
    if (!state.report) {
      if (state.lastRunFailure) {
        var reason = state.lastRunFailure.reason;
        return degradedHtml(reason, state.lastRunFailure.message, !NO_RETRY_REASONS[reason]);
      }
      if (!state.groundingOn) return degradedHtml('grounding-off', GROUNDING_OFF_COPY, false);
      return introHtml();
    }
    return reportHtml();
  }

  function render() {
    if (!host) return;
    host.innerHTML = renderBody();
    if (state.report && !state.viewedLogged) {
      state.viewedLogged = true;
      try { if (global.FWEvents) FWEvents.log('scorecard_viewed', { band: state.report.band }); } catch (_) { /* fire-and-forget */ }
    }
  }

  // ---- actions: run --------------------------------------------------------

  function handleRun(btn) {
    if (state.running) return;
    state.running = true;
    state.lastRunFailure = null;
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Reading live postings…' }) : function () {};
    afetch('/scorecard', 'POST', { action: 'run' }, RUN_TIMEOUT_MS)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.running = false;
        restore();
        if (data && data.ok) {
          state.report = data.report;
          state.id = data.id;
          state.at = data.at;
          state.trend = Array.isArray(data.trend) ? data.trend : state.trend;
          if (state.cap) {
            var rem = data.remaining;
            state.cap = Object.assign({}, state.cap, { remaining: rem, ok: rem === null ? true : rem > 0 });
          }
          state.actionsUi = {};
          state.postingsUi = {};
          state.viewedLogged = false; // a freshly run report is a fresh view
          if (global.FWPlanSurface && typeof FWPlanSurface.refresh === 'function') FWPlanSurface.refresh();
          render();
          return;
        }
        if (data && data.reason === 'capped' && data.cap && state.cap) {
          state.cap = Object.assign({}, state.cap, {
            ok: false, message: data.cap.message, upgrade: !!data.cap.upgrade,
            resetPeriod: data.cap.resetPeriod, limit: data.cap.limit,
          });
          logCapHit();
        }
        state.lastRunFailure = {
          reason: (data && data.reason) || 'error',
          message: (data && data.message) || 'Could not build your scorecard just now.',
        };
        render();
      })
      .catch(function () {
        state.running = false;
        restore();
        state.lastRunFailure = { reason: 'error', message: 'Could not build your scorecard just now. Try again.' };
        render();
      });
  }

  // ---- actions: commit ------------------------------------------------------

  function togglePicker(actionId) {
    if (!actionId) return;
    var ui = state.actionsUi[actionId] || (state.actionsUi[actionId] = {});
    ui.pickerOpen = !ui.pickerOpen;
    render();
  }

  function doCommit(actionId, dueAt, triggerBtn) {
    if (!actionId) return;
    var ui = state.actionsUi[actionId] || (state.actionsUi[actionId] = {});
    if (ui.busy) return;
    ui.busy = true;
    ui.error = '';
    var restore = global.FWButtonBusy ? FWButtonBusy.start(triggerBtn, { label: 'Adding…' }) : function () {};
    var body = { action: 'commit', actionId: actionId };
    if (dueAt) body.dueAt = dueAt;
    afetch('/scorecard', 'POST', body)
      .then(function (r) { return r.json().then(function (data) { return { data: data }; }); })
      .then(function (res) {
        restore();
        ui.busy = false;
        var data = res.data || {};
        if (!data.ok) {
          ui.error = data.error || 'Could not add that to your roadmap.';
          render();
          return;
        }
        ui.result = { duplicate: !!data.duplicate, waypointTitle: data.waypointTitle || '' };
        ui.pickerOpen = false;
        try { if (global.FWEvents) FWEvents.log('scorecard_action_committed', { dated: !!dueAt }); } catch (_) { /* fire-and-forget */ }
        render();
      })
      .catch(function () {
        restore();
        ui.busy = false;
        ui.error = 'Could not add that to your roadmap. Try again.';
        render();
      });
  }

  // ---- actions: track a posting -------------------------------------------

  function doTrack(idx, btn) {
    var r = state.report;
    var p = r && Array.isArray(r.postings) ? r.postings[idx] : null;
    if (!p) return;
    var ui = state.postingsUi[idx] || (state.postingsUi[idx] = {});
    if (ui.busy || ui.done) return;
    // The tracker module is a separate script tag. If it failed to load, saying
    // so beats an uncaught TypeError that leaves the button spinning forever.
    if (!global.FWApplications || typeof FWApplications.save !== 'function') {
      ui.error = 'The application tracker is not available on this page right now.';
      render();
      return;
    }
    ui.busy = true;
    ui.error = '';
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Tracking…' }) : function () {};
    FWApplications.save({
      source: 'finder',
      role: p.title,
      company: p.org || '',
      url: p.url || '',
      careerSlug: r.careerSlug || '',
    }).then(function (res) {
      restore();
      ui.busy = false;
      if (!res || !res.ok) {
        ui.error = (res && res.error) || 'Could not track that.';
        render();
        return;
      }
      ui.done = true;
      ui.duplicate = !!res.duplicate;
      render();
    }).catch(function () {
      // FWApplications.save resolves its own failures, so reaching here means
      // something unexpected threw — release the button rather than stranding it.
      restore();
      ui.busy = false;
      ui.error = 'Could not track that. Try again.';
      render();
    });
  }

  // ---- event delegation (wired once; render() only replaces innerHTML) -----

  function wireEvents() {
    if (!host || host._scWired) return;
    host._scWired = true;
    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;

      var runBtn = t.closest('[data-sc-run]');
      if (runBtn) { handleRun(runBtn); return; }

      var commitBtn = t.closest('[data-sc-commit]');
      if (commitBtn) { togglePicker(commitBtn.getAttribute('data-sc-commit')); return; }

      var noDateBtn = t.closest('[data-sc-nodate]');
      if (noDateBtn) { doCommit(noDateBtn.getAttribute('data-sc-nodate'), null, noDateBtn); return; }

      var dueQuick = t.closest('[data-sc-due]');
      if (dueQuick) {
        var picker = dueQuick.closest('[data-sc-due-picker]');
        var actionId = picker && picker.getAttribute('data-sc-due-picker');
        doCommit(actionId, dueQuick.getAttribute('data-sc-due'), dueQuick);
        return;
      }

      var dueGo = t.closest('[data-sc-due-go]');
      if (dueGo) {
        var pickerBox = dueGo.closest('[data-sc-due-picker]');
        var input = pickerBox && pickerBox.querySelector('.sc-due-input');
        var actionId2 = dueGo.getAttribute('data-sc-due-go');
        if (input && input.value) doCommit(actionId2, input.value, dueGo);
        return;
      }

      var trackBtn = t.closest('[data-sc-track]');
      if (trackBtn) { doTrack(Number(trackBtn.getAttribute('data-sc-track')), trackBtn); return; }
    });
  }

  // ---- mount --------------------------------------------------------------

  function applyGetData(data) {
    state.ready = !!data.ready;
    state.groundingOn = !!data.groundingOn;
    state.id = data.id || '';
    state.at = data.at || null;
    state.report = data.report || null;
    state.trend = Array.isArray(data.trend) ? data.trend : [];
    state.cap = data.cap || null;
    state.reason = data.reason || '';
    state.message = data.message || '';
    state.actionsUi = {};
    state.postingsUi = {};
    // An already-spent allowance is a wall the student sees on arrival, not only
    // one they walk into by pressing the button.
    if (state.ready && state.groundingOn && state.cap && state.cap.ok === false) logCapHit();
  }

  function mount() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no scorecard module — no-op
    if (host.getAttribute('data-fp-scorecard-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-fp-scorecard-mounted', '1');
    wireEvents();
    render(); // "Loading your scorecard…"

    afetch('/scorecard').then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      state.loaded = true;
      if (!data) {
        state.ready = false;
        state.reason = 'error';
        state.message = 'Could not load your scorecard just now.';
        render();
        return;
      }
      applyGetData(data);
      render();
    }).catch(function () {
      state.loaded = true;
      state.ready = false;
      state.reason = 'error';
      state.message = 'Could not load your scorecard just now.';
      render();
    });
  }

  global.FWScorecard = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
