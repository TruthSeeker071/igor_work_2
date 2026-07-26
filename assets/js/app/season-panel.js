/**
 * FlightWay V2 S18 — Interview Season Mode, client half (D13).
 *
 * Server contract lives in functions/interview-season.js (finished, not touched
 * here). Mounts into #flightplan-season on flightplan.html: the six-week arc,
 * which week it is, what each week is pointed at, the score trend across the
 * program, and the one button that starts this week's session.
 *
 * Idiom: afetch()/IIFE/mount-guard/esc()-into-innerHTML/one delegated listener,
 * copied from scorecard-panel.js and network-panel.js — three panels on one page
 * disagreeing about how to render an error is worse than any single choice.
 *
 * **The locked state renders the student's OWN six weeks**, not a description of
 * somebody's. The server builds the arc from their career family either way and
 * truncates weeks 2–6 before serialization, so `lockedWeeks` counts things that
 * are genuinely absent from the payload — §5 S8's locked-tail contract, and the
 * reason there is nothing here to un-blur in devtools.
 *
 * **This panel never runs an interview.** Every session goes through the mock
 * interview on coach.html, which is where the meter, the persona and the debrief
 * already live. The week's button is a link that carries the week's persona, so
 * a student lands in the right room rather than being told which switch to flip.
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

  var HOST_ID = 'flightplan-season';
  var FEATURE = 'mock-interview';

  /**
   * Starting a season can make ONE grounded read plus a shaping call before it
   * writes the row (functions/interview-season.js loadRoleFormat). authFetch
   * defaults to 30s and that budget is 8s + 15s plus the insert, so 40s leaves
   * the server's own timeouts room to fire first — a client abort here would
   * leave a season that exists on the server and not on the screen.
   */
  var START_TIMEOUT_MS = 40000;

  var AXIS_LABEL = {
    communication: 'Communication', structure: 'Structure', specificity: 'Specificity',
    technical: 'Technical', composure: 'Composure', fit: 'Fit',
  };
  var PERSONA_LABEL = { coach: 'Coach', pressure: 'Pressure' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var host = null;
  var state = {
    loaded: false,
    ready: true,
    locked: false,
    season: null,
    program: null,
    lockedWeeks: 0,
    weekNow: 0,
    progress: null,
    trend: [],
    headline: '',
    careerName: '',
    stale: false,
    reason: '',
    message: '',
    busy: false,
    error: '',
    openWeek: 0,
    capLogged: false,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * §4: every wall emits `plan_cap_hit`. The locked card is rendered from
   * `FWPlanSurface.lockedTailHtml()` (a string — the whole body is one innerHTML
   * pass), which is not the helper that logs the paywall view itself, so this
   * panel fires its own. Once per mount, not per render: `render()` rebuilds the
   * card on every state change while the lock stays shut.
   */
  function logLock() {
    if (state.capLogged) return;
    state.capLogged = true;
    try {
      if (global.FWEnt && typeof FWEnt.notePaywallView === 'function') FWEnt.notePaywallView(FEATURE);
    } catch (_) { /* fire-and-forget */ }
  }

  function monthYear(iso) {
    var d = new Date(String(iso || ''));
    if (isNaN(d.getTime())) return '';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // ---- trend: sparkline + delta line ----------------------------------------
  // Copied from scorecard-panel.js, rescaled: an interview overall is 1–5, not a
  // percentage, so the baseline is 1 and the span is 4. Plotting a 1–5 score on
  // a 0–100 axis would flatten a real two-point gain into a twitch.

  function sparklineSvg(trend) {
    var W = 120, H = 28, pad = 3;
    var vals = trend.map(function (t) { return Math.max(1, Math.min(5, Number(t.overall) || 1)); });
    var n = vals.length;
    var stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
    var pts = vals.map(function (v, i) {
      var x = pad + i * stepX;
      var y = pad + (H - pad * 2) * (1 - (v - 1) / 4);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="sz-spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" focusable="false">'
      + '<polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      + '</svg>';
  }

  function trendHtml() {
    var trend = state.trend || [];
    if (trend.length < 2) return '';
    var first = trend[0];
    var last = trend[trend.length - 1];
    var delta = Math.round((last.overall - first.overall) * 10) / 10;
    var since = monthYear(first.at);
    var text = (delta > 0 ? '+' + delta : String(delta))
      + ' overall' + (since ? ' since ' + since : '') + ' · ' + trend.length + ' scored sessions';
    return '<div class="sz-trend">' + sparklineSvg(trend)
      + '<span class="sz-trend-text">' + esc(text) + '</span></div>';
  }

  // ---- weeks ----------------------------------------------------------------

  function weekStateClass(w) {
    if (w.locked) return 'sz-week--locked';
    if (w.done) return 'sz-week--done';
    if (state.weekNow && w.week === state.weekNow) return 'sz-week--now';
    if (state.weekNow && w.week < state.weekNow) return 'sz-week--missed';
    return '';
  }

  function weekStatusText(w) {
    if (w.locked) return '';
    if (w.done) {
      return w.best == null ? 'Run' : ('Scored ' + w.best + '/5' + (w.count > 1 ? ' · best of ' + w.count : ''));
    }
    if (!state.weekNow) return '';
    if (w.week === state.weekNow) return 'This week';
    if (w.week < state.weekNow) return 'Missed';
    return '';
  }

  /**
   * The link into the mock interview. It carries the week's persona so the
   * student lands ready rather than being told which toggle to find — and it
   * carries nothing else, because every other input (career, resume, company) is
   * already the coach page's own.
   *
   * `?ivPersona=…#practice`, in that order, and the order is load-bearing:
   * interview-mode.js `openFromHash` matches `location.hash` EXACTLY, so putting
   * the persona in the fragment would stop the panel opening at all — a deep
   * link that looks broken with nothing in the console to explain it. Same shape
   * as S12's `?ivRole=…&ivCompany=…#practice`.
   */
  function weekCtaHtml(w) {
    if (w.locked || !state.season) return '';
    if (state.weekNow !== w.week) return '';
    return '<a class="sz-week-cta" href="coach.html?ivPersona='
      + encodeURIComponent(w.persona || 'coach') + '#practice">'
      + (w.done ? 'Run it again' : 'Start week ' + w.week) + ' &rarr;</a>';
  }

  function weekHtml(w) {
    var open = state.openWeek === w.week || (!state.openWeek && w.week === state.weekNow);
    if (w.locked) {
      return '<li class="sz-week ' + weekStateClass(w) + '">'
        + '<div class="sz-week-head">'
        + '<span class="sz-week-n">' + esc(String(w.week)) + '</span>'
        + '<span class="sz-week-title">' + esc(w.title) + '</span>'
        + '<span class="sz-week-lock"><i data-lucide="lock" aria-hidden="true"></i></span>'
        + '</div></li>';
    }
    var focus = (w.focus || []).map(function (f) {
      return '<li>' + esc(f) + '</li>';
    }).join('');
    var axes = (w.axes || []).map(function (a) {
      return '<span class="sz-axis">' + esc(AXIS_LABEL[a] || a) + '</span>';
    }).join('');
    var status = weekStatusText(w);
    return '<li class="sz-week ' + weekStateClass(w) + (open ? ' sz-week--open' : '') + '">'
      + '<button type="button" class="sz-week-head" data-sz-week="' + esc(String(w.week)) + '"'
      + ' aria-expanded="' + (open ? 'true' : 'false') + '">'
      + '<span class="sz-week-n">' + esc(String(w.week)) + '</span>'
      + '<span class="sz-week-title">' + esc(w.title) + '</span>'
      + (status ? '<span class="sz-week-status">' + esc(status) + '</span>' : '')
      + '<span class="sz-week-chev" aria-hidden="true"><i data-lucide="chevron-down"></i></span>'
      + '</button>'
      + (open
        ? '<div class="sz-week-body">'
          + '<p class="sz-week-why">' + esc(w.why) + '</p>'
          + (w.ask ? '<p class="sz-week-ask">' + esc(w.ask) + '</p>' : '')
          + (focus ? '<p class="sz-week-label">What this week is about</p><ul class="sz-focus">' + focus + '</ul>' : '')
          + (axes ? '<p class="sz-week-label">Scored on</p><div class="sz-axes">' + axes + '</div>' : '')
          + weekCtaHtml(w)
          + '</div>'
        : '')
      + '</li>';
  }

  function weeksHtml() {
    var weeks = (state.progress && state.progress.weeks) || (state.program && state.program.weeks) || [];
    if (!weeks.length) return '';
    return '<ol class="sz-weeks">' + weeks.map(weekHtml).join('') + '</ol>';
  }

  // ---- rounds (the grounded half) -------------------------------------------

  function roundsHtml() {
    var p = state.program;
    if (!p || !p.rounds || !p.rounds.length) return '';
    return '<div class="sz-rounds">'
      + '<p class="sz-week-label">The real process for this role</p>'
      + '<ol class="sz-round-list">'
      + p.rounds.map(function (r) {
        return '<li><span class="sz-round-name">' + esc(r.name) + '</span>'
          + (r.what ? '<span class="sz-round-what">' + esc(r.what) + '</span>' : '') + '</li>';
      }).join('')
      + '</ol></div>';
  }

  // ---- body -----------------------------------------------------------------

  function progressBarHtml() {
    var p = state.progress;
    if (!p || !p.total) return '';
    var pct = Math.round((p.done / p.total) * 100);
    return '<div class="sz-bar" role="img" aria-label="' + esc(p.done + ' of ' + p.total + ' weeks run') + '">'
      + '<span class="sz-bar-fill" style="width:' + pct + '%"></span></div>';
  }

  function renderBody() {
    if (!state.loaded) return '<p class="sz-note">Loading your season…</p>';
    if (!state.ready) return '<p class="sz-note">' + esc(state.message || 'Interview Season is not switched on yet.') + '</p>';
    if (state.reason === 'no-career') return '<p class="sz-note">' + esc(state.message) + '</p>';

    var parts = [];

    if (state.locked) {
      logLock();
      parts.push('<p class="sz-note">Six weeks, one scored mock interview each, built around '
        + (state.careerName ? esc(state.careerName) : 'your target role')
        + ' — and the gap between week 1 and week 6 is the whole point.</p>');
      parts.push(weeksHtml());
      if (global.FWPlanSurface && FWPlanSurface.lockedTailHtml) {
        parts.push(FWPlanSurface.lockedTailHtml(FEATURE, state.lockedWeeks, {
          line: 'more weeks, each pointed at a different part of the rubric',
        }));
      }
      return parts.join('');
    }

    if (!state.season) {
      parts.push('<p class="sz-note">Six weeks, one scored mock interview each, built around '
        + (state.careerName ? esc(state.careerName) : 'your target role') + '.</p>');
      parts.push(weeksHtml());
      parts.push(roundsHtml());
      if (state.error) parts.push('<p class="sz-error">' + esc(state.error) + '</p>');
      parts.push('<button type="button" class="sz-start" data-sz-start' + (state.busy ? ' disabled' : '') + '>'
        + (state.busy ? 'Building your season…' : 'Start a six-week season') + '</button>');
      return parts.join('');
    }

    if (state.headline) parts.push('<p class="sz-headline">' + esc(state.headline) + '</p>');
    if (state.stale) {
      parts.push('<p class="sz-note sz-note--warn">This season was built for '
        + esc(state.season.careerName || 'a different career')
        + ', and your target has changed since. End it and start a new one so the weeks match where you are actually headed.</p>');
    }
    parts.push(progressBarHtml());
    parts.push(trendHtml());
    parts.push(weeksHtml());
    parts.push(roundsHtml());
    parts.push('<p class="sz-source">' + esc(state.program && state.program.formatSource === 'web'
      ? 'Round list from live sources; the weekly focus areas are FlightWay’s own for this field.'
      : 'Built from FlightWay’s playbook for this field.') + '</p>');
    if (state.error) parts.push('<p class="sz-error">' + esc(state.error) + '</p>');
    parts.push('<button type="button" class="sz-end" data-sz-end' + (state.busy ? ' disabled' : '') + '>End this season</button>');
    return parts.join('');
  }

  function render() {
    if (!host) return;
    host.innerHTML = renderBody();
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      try { lucide.createIcons({ nameAttr: 'data-lucide' }); } catch (_) { /* icons are decoration */ }
    }
  }

  // ---- actions --------------------------------------------------------------

  function applyGetData(data) {
    state.ready = data.ready !== false;
    state.locked = !!data.locked;
    state.season = data.season || null;
    state.program = data.program || null;
    state.lockedWeeks = Number(data.lockedWeeks) || 0;
    state.weekNow = Number(data.weekNow) || 0;
    state.progress = data.progress || null;
    state.trend = data.trend || [];
    state.headline = data.headline || '';
    state.careerName = data.careerName || '';
    state.stale = !!data.stale;
    state.reason = data.reason || '';
    state.message = data.message || '';
  }

  /**
   * The interstitial belongs at the moment of ENTRY, and for a panel that moment
   * is the first press of its button rather than the page load that happened to
   * include it (feature-intro.js `auto()`'s own note). `maybeShow` resolves null
   * when it has already been seen, so a returning student is never stopped.
   */
  function doStart(btn) {
    if (state.busy) return;
    var intro = (global.FWFeatureIntro && typeof FWFeatureIntro.maybeShow === 'function')
      ? FWFeatureIntro.maybeShow('interview-season')
      : null;
    if (intro && typeof intro.then === 'function') {
      intro.then(function (how) { if (how !== 'skip') startNow(btn); });
      return;
    }
    startNow(btn);
  }

  function startNow(btn) {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    var release = (global.FWButtonBusy && FWButtonBusy.hold) ? FWButtonBusy.hold(btn) : null;
    afetch('/interview-season', 'POST', { action: 'start' }, START_TIMEOUT_MS).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      state.busy = false;
      if (release) release();
      if (!data || data.ok === false) {
        state.error = (data && (data.message || data.error)) || 'Could not start your season just now.';
        render();
        return;
      }
      state.season = data.season || null;
      state.program = data.program || null;
      state.weekNow = Number(data.weekNow) || 1;
      state.progress = data.progress || null;
      state.trend = data.trend || [];
      state.headline = data.headline || '';
      state.openWeek = 1;
      try { if (global.FWPlanSurface) FWPlanSurface.refresh(); } catch (_) {}
      render();
    }).catch(function () {
      state.busy = false;
      if (release) release();
      state.error = 'Could not start your season just now.';
      render();
    });
  }

  function doEnd(btn) {
    if (state.busy) return;
    // Second click confirms. Ending a season throws away the schedule (never the
    // scores — those are `interview_sessions` rows and outlive it), so it is
    // reversible in substance and does not warrant a modal.
    if (btn && btn.getAttribute('data-sz-armed') !== '1') {
      btn.setAttribute('data-sz-armed', '1');
      btn.textContent = 'End it — click again';
      return;
    }
    state.busy = true;
    render();
    afetch('/interview-season', 'POST', { action: 'end' }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function () {
      state.busy = false;
      state.season = null;
      state.progress = null;
      state.trend = [];
      state.headline = '';
      state.openWeek = 0;
      render();
    }).catch(function () {
      state.busy = false;
      state.error = 'Could not end your season just now.';
      render();
    });
  }

  function wireEvents() {
    if (!host || host._szWired) return;
    host._szWired = true;
    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('[data-sz-start]')) { doStart(t.closest('[data-sz-start]')); return; }
      if (t.closest('[data-sz-end]')) { doEnd(t.closest('[data-sz-end]')); return; }
      var wk = t.closest('[data-sz-week]');
      if (wk) {
        var n = Number(wk.getAttribute('data-sz-week')) || 0;
        state.openWeek = (state.openWeek === n) ? -1 : n;
        render();
      }
    });
  }

  function mount() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no season module — no-op
    if (host.getAttribute('data-fp-season-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-fp-season-mounted', '1');
    wireEvents();
    render(); // "Loading your season…"

    afetch('/interview-season').then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      state.loaded = true;
      if (!data) {
        state.ready = false;
        state.message = 'Could not load your season just now.';
        render();
        return;
      }
      applyGetData(data);
      render();
    }).catch(function () {
      state.loaded = true;
      state.ready = false;
      state.message = 'Could not load your season just now.';
      render();
    });
  }

  global.FWSeason = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
