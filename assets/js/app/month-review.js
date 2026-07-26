/**
 * FlightWay V2 S11 — Month in Review page (D13).
 *
 * Mounts into #month-review on review.html: one GET /month-review?m=YYYY-MM
 * fetch, rendered as a stack of fact sections. What each field means and
 * where it comes from lives in functions/_lib/month-review.js — this file
 * only renders what the server already composed, it never re-derives a
 * count or a label itself.
 *
 * Idiom copied from commitments-panel.js: same afetch() (FWAuth.authFetch
 * when present, credentialed fetch otherwise), same IIFE wrapper, same
 * createElement/textContent discipline — never innerHTML with server data.
 * Deadline titles come from arbitrary web pages (deadline-refresh.js) and
 * commitment text comes from AI-generated roadmap content; both are exactly
 * as untrusted as commitments-panel's rows.
 *
 * Unlike commitments-panel.js this page owns the whole viewport rather than
 * a module slot, so it also drives the month picker and the URL's `?m=`
 * param (history.replaceState, never pushState — picking a month is not a
 * new page in the browser's history sense).
 */
(function (global) {
  'use strict';

  function afetch(url, method, bodyObj) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') {
      var opts = { method: method || 'GET' };
      if (bodyObj) opts.body = bodyObj;
      return FWAuth.authFetch(url, opts);
    }
    var o = { method: method || 'GET', credentials: 'include' };
    if (bodyObj) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(bodyObj); }
    return fetch(url, o);
  }

  // Display gate (house rule, same helper pair as roadmap.js/auth.js): only
  // FWErr-marked copy ever reaches the page. Server dev-speak, raw fetch
  // errors and JSON parse failures all fall back to `fallback` instead.
  function fwRespError(status, data, fallback) {
    return global.FWErr ? FWErr.fromResponse(status, data, fallback) : new Error(fallback);
  }
  function fwErr(err, fallback) {
    return global.FWErr ? FWErr.forUser(err, fallback) : fallback;
  }

  var HOST_ID = 'month-review';
  var FALLBACK_ERROR = 'Could not load your review. Try again in a moment.';

  var host = null;
  var state = {
    status: 'loading',   // 'loading' | 'ready' | 'error'
    months: [],
    review: null,
    month: '',
    errorText: '',
    triedDefault: false, // one auto-retry against the server default on a 400
    loggedMonth: null    // guards the one review_viewed per rendered month
  };

  // ---- small helpers --------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** "in 3 days" / "today" / "tomorrow" / "2 days ago" — no library, this is
   *  the only date math this page needs and the server already did the
   *  subtraction (daysUntil), so this only turns a number into words. */
  function dayWord(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n < 0) return Math.abs(n) + ' days ago';
    return 'in ' + n + ' days';
  }

  function monthFromUrl() {
    try {
      var m = new URLSearchParams(location.search || '').get('m');
      return /^\d{4}-\d{2}$/.test(String(m || '')) ? m : '';
    } catch (_) { return ''; }
  }

  function updateUrl(month) {
    try {
      history.replaceState(null, '', location.pathname + '?m=' + encodeURIComponent(month));
    } catch (_) { /* URL sync is a nicety, never fatal */ }
  }

  // ---- section building blocks -----------------------------------------

  function icon(name) {
    var span = document.createElement('span');
    span.className = 'fp-module-icon';
    span.setAttribute('aria-hidden', 'true');
    var i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    span.appendChild(i);
    return span;
  }

  // A "module" card matches flightplan.html's own section shell exactly —
  // .fp-module/.fp-module-head/.fp-module-title/.fp-module-icon are shared
  // classes in flightway-2.css, not flightplan-specific, so this page reads
  // as the same product for free.
  function buildSection(iconName, title, bodyNodes) {
    var section = document.createElement('section');
    section.className = 'fp-module';
    var head = document.createElement('div');
    head.className = 'fp-module-head';
    head.appendChild(icon(iconName));
    head.appendChild(el('h2', 'fp-module-title', title));
    section.appendChild(head);
    var body = el('div', 'fp-module-body');
    bodyNodes.forEach(function (node) { body.appendChild(node); });
    section.appendChild(body);
    return section;
  }

  function buildListRow(titleText, metaText) {
    var row = el('div', 'mr-row');
    row.appendChild(el('span', 'mr-row-title', titleText));
    if (metaText) row.appendChild(el('span', 'mr-row-meta', metaText));
    return row;
  }

  function buildList(rows) {
    var list = el('div', 'mr-list');
    rows.forEach(function (r) { list.appendChild(r); });
    return list;
  }

  // ---- the nine possible sections, in display order ----------------------
  // Each returns null when its source array/object is empty so the caller
  // can filter — a section that would say "0 deadlines hit" never renders.

  function activitySection(review) {
    var items = review.activity || [];
    if (!items.length) return null;
    var rows = items.map(function (a) {
      var text = a.count === 1 ? a.one : (a.count + ' ' + a.label);
      return buildListRow(text, null);
    });
    return buildSection('sparkles', 'What you did', [buildList(rows)]);
  }

  function deadlinesHitSection(review) {
    var items = review.deadlinesHit || [];
    if (!items.length) return null;
    var rows = items.map(function (d) {
      return buildListRow(d.title, [d.org, d.date].filter(Boolean).join(' · '));
    });
    return buildSection('calendar-days', 'Deadlines you hit', [buildList(rows)]);
  }

  function deadlinesMissedSection(review) {
    var items = review.deadlinesMissed || [];
    if (!items.length) return null;
    var rows = items.map(function (d) {
      return buildListRow(d.title, [d.org, d.date].filter(Boolean).join(' · '));
    });
    return buildSection('triangle-alert', 'Deadlines that passed', [buildList(rows)]);
  }

  function commitmentsKeptSection(review) {
    var items = review.commitmentsKept || [];
    if (!items.length) return null;
    var rows = items.map(function (c) {
      return buildListRow(c.text, [c.waypointTitle, c.dueAt].filter(Boolean).join(' · '));
    });
    return buildSection('target', 'Commitments you kept', [buildList(rows)]);
  }

  function commitmentsSlippedSection(review) {
    var items = review.commitmentsSlipped || [];
    if (!items.length) return null;
    var rows = items.map(function (c) {
      return buildListRow(c.text, [c.waypointTitle, c.dueAt].filter(Boolean).join(' · '));
    });
    return buildSection('repeat', 'Commitments that slipped', [buildList(rows)]);
  }

  // The 161 vector dimensions have no human-readable name anywhere on the
  // server (see functions/_lib/month-review.js) — this reports MOVEMENT only
  // and never invents a dimension name.
  function coordinatesSection(review) {
    var m = review.movement;
    if (!m || !m.measured || !(m.up || m.down)) return null;
    var n = m.up + m.down;
    var text = 'Moved on ' + n + ' dimension' + (n === 1 ? '' : 's')
      + ' (' + m.up + ' up, ' + m.down + ' down) across ' + m.weeks
      + ' weekly snapshot' + (m.weeks === 1 ? '' : 's') + '.';
    return buildSection('compass', 'Your coordinates', [el('p', 'mr-coordinates', text)]);
  }

  // S12 — the two sections S11 left present-and-empty. Same shape as the rest,
  // so a month with neither still renders nothing extra.
  function evidenceSection(review) {
    var items = review.evidence || [];
    if (!items.length) return null;
    var rows = items.map(function (e) {
      return buildListRow(e.title, [e.type, (e.at || '').slice(0, 10)].filter(Boolean).join(' \u00b7 '));
    });
    return buildSection('scroll-text', 'Proof you added', [buildList(rows)]);
  }

  function applicationsSection(review) {
    var items = review.applications || [];
    if (!items.length) return null;
    var rows = items.map(function (a) {
      return buildListRow(
        a.company ? (a.role + ' \u2014 ' + a.company) : a.role,
        ['moved to ' + a.status, (a.at || '').slice(0, 10)].filter(Boolean).join(' \u00b7 '),
      );
    });
    return buildSection('clipboard-list', 'Applications you moved', [buildList(rows)]);
  }

  // S20 — the three sections S16/S17/S18 shipped without. Same null-when-empty
  // contract as the rest; the server composed every number and sentence part.
  function outreachSection(review) {
    var o = review.outreach;
    if (!o || !o.advanced) return null;
    var bits = [
      o.drafted ? o.drafted + ' drafted' : '',
      o.sent ? o.sent + ' sent' : '',
      o.replied ? o.replied + ' replied' : '',
      o.met ? o.met + ' met' : ''
    ].filter(Boolean).join(', ');
    var text = o.advanced + ' contact' + (o.advanced === 1 ? '' : 's') + ' moved forward'
      + (bits ? ' — ' + bits : '') + '.';
    return buildSection('users', 'Your outreach', [el('p', 'mr-coordinates', text)]);
  }

  function readinessSection(review) {
    var rd = review.readiness;
    if (!rd || !rd.measured) return null;
    var text = rd.from == null
      ? 'Your live-posting readiness stands at ' + rd.score + '%.'
      : (rd.delta === 0
        ? 'Your live-posting readiness held at ' + rd.score + '%.'
        : 'Your live-posting readiness moved from ' + rd.from + '% to ' + rd.score + '%.');
    return buildSection('briefcase', 'Job-posting readiness', [el('p', 'mr-coordinates', text)]);
  }

  function termSection(review) {
    var t = review.term;
    if (!t || !t.present) return null;
    var name = t.label || 'Your term';
    var text = t.ended
      ? name + ' wrapped up on ' + t.endDate + '.'
      : name + ' — you closed the month at week ' + t.week + ' of ' + t.total + '.';
    return buildSection('graduation-cap', 'Your term', [el('p', 'mr-coordinates', text)]);
  }

  function focusCard(f) {
    var card = el('div', 'mr-focus');
    card.appendChild(el('p', 'mr-focus-text', f.text));
    var meta = typeof f.daysOut === 'number' ? ('Due ' + dayWord(f.daysOut))
      : (f.dueAt ? ('Due ' + f.dueAt) : '');
    if (meta) card.appendChild(el('p', 'mr-focus-meta', meta));
    return card;
  }

  function focusSection(review) {
    var f = review.nextFocus;
    if (!f || !f.text) return null;
    return buildSection('map', 'One focus', [focusCard(f)]);
  }

  function headlineNode(review) {
    return el('p', 'mr-headline', review.headline || '');
  }

  // hasContent === false: one honest empty state (the headline already says
  // "a quiet month") plus, if there is one, the single forward-looking item —
  // never a stack of section headers over empty lists.
  function emptyStateNode(review) {
    var wrap = el('div', 'mr-empty');
    wrap.appendChild(headlineNode(review));
    var focus = focusSection(review);
    if (focus) wrap.appendChild(focus);
    return wrap;
  }

  // ---- month picker ------------------------------------------------------

  function buildToolbar() {
    var bar = el('div', 'mr-toolbar');
    var label = document.createElement('label');
    label.className = 'mr-select-label';
    label.appendChild(document.createTextNode('Month'));
    var select = document.createElement('select');
    select.className = 'mr-select';
    (state.months || []).forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.month;
      opt.textContent = m.label;
      if (m.month === state.month) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      var next = select.value;
      if (!next || next === state.month) return;
      state.month = next;
      state.status = 'loading';
      state.triedDefault = false;
      render();
      load(next);
    });
    label.appendChild(select);
    bar.appendChild(label);
    return bar;
  }

  // ---- skeleton / error ---------------------------------------------------

  function buildSkeleton() {
    var wrap = el('div', 'mr-skeleton');
    for (var i = 0; i < 4; i++) wrap.appendChild(el('div', 'mr-skel-line'));
    return wrap;
  }

  function buildError() {
    return el('p', 'mr-error', state.errorText || FALLBACK_ERROR);
  }

  // ---- render --------------------------------------------------------

  function render() {
    if (!host) return;
    host.textContent = '';
    host.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');

    if (state.months.length) host.appendChild(buildToolbar());

    if (state.status === 'loading') {
      host.appendChild(buildSkeleton());
      return;
    }

    if (state.status === 'error') {
      host.appendChild(buildError());
      return;
    }

    var review = state.review;
    if (!review) return;

    if (!review.hasContent) {
      host.appendChild(emptyStateNode(review));
    } else {
      host.appendChild(headlineNode(review));
      var sections = el('div', 'mr-sections');
      [
        activitySection(review),
        deadlinesHitSection(review),
        deadlinesMissedSection(review),
        commitmentsKeptSection(review),
        commitmentsSlippedSection(review),
        evidenceSection(review),
        applicationsSection(review),
        outreachSection(review),
        readinessSection(review),
        coordinatesSection(review),
        termSection(review),
        focusSection(review)
      ].forEach(function (s) { if (s) sections.appendChild(s); });
      host.appendChild(sections);
    }

    // Icons above were just added to the DOM — createIcons() has to run again
    // for this batch (same pattern as portal.js/roadmap.js/admin-console.js).
    if (global.lucide && typeof global.lucide.createIcons === 'function') global.lucide.createIcons();
  }

  // ---- fetch -----------------------------------------------------------

  function maybeLogView(review) {
    if (!global.FWEvents || state.loggedMonth === review.month) return;
    state.loggedMonth = review.month;
    try { FWEvents.log('review_viewed', { month: review.month }); } catch (_) { /* fire-and-forget */ }
    // S19: the third NPS moment, and the most informative of the three — a
    // student reading a retrospective has just been shown a month of their own
    // evidence, which is the moment they can actually answer the question.
    // Guarded by `loggedMonth` above, so a month-picker change never re-asks.
    try { if (global.FWNps) FWNps.maybeAsk('month_review'); } catch (_) { /* never block the render */ }
  }

  function load(month) {
    var url = '/month-review' + (month ? ('?m=' + encodeURIComponent(month)) : '');
    afetch(url)
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); })
      .then(function (res) {
        if (res.ok && res.data && res.data.review) {
          state.months = Array.isArray(res.data.months) ? res.data.months : [];
          state.review = res.data.review;
          state.month = res.data.review.month;
          state.status = 'ready';
          updateUrl(state.month);
          render();
          maybeLogView(state.review);
          return;
        }

        // 400 = the requested month is outside the 12-month window (a hand-
        // edited URL, or a stale bookmark once the window has rolled past
        // it). The server still hands back the valid list, so retry once
        // against its own default rather than leaving the page dead on a
        // bad query param.
        if (res.status === 400 && res.data && Array.isArray(res.data.months)) {
          state.months = res.data.months;
          if (!state.triedDefault) {
            state.triedDefault = true;
            load('');
            return;
          }
        }

        state.status = 'error';
        state.errorText = fwErr(fwRespError(res.status, res.data, FALLBACK_ERROR), FALLBACK_ERROR);
        render();
      })
      .catch(function (err) {
        state.status = 'error';
        state.errorText = fwErr(err, FALLBACK_ERROR);
        render();
      });
  }

  // ---- mount -----------------------------------------------------------

  function mount() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no review container — no-op
    if (host.getAttribute('data-fw-review-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-fw-review-mounted', '1');

    state.month = monthFromUrl();
    state.status = 'loading';
    render();
    load(state.month);
  }

  global.FWMonthReview = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
