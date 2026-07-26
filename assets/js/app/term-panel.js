/**
 * FlightWay V2 S18 — the Semester Loop, client half (D14).
 *
 * Server contract lives in functions/semester.js (finished, not touched here).
 * Mounts into #flightplan-term on flightplan.html and is two moments in one
 * panel: the start-of-term ritual (dates, three outcomes, the courses and clubs
 * they hang off, one deliverable) and the end-of-term review.
 *
 * Idiom: afetch()/IIFE/mount-guard/esc()-into-innerHTML/one delegated listener,
 * copied from network-panel.js. Free on every plan — §4 puts no meter on this,
 * and metering the thing that makes a student plan their term would meter the
 * loop the whole cap table exists to protect.
 *
 * **The wizard is one form, not a carousel.** Three outcomes, two anchor lists
 * and a deliverable fit on one screen, and a student who can see all of it at
 * once writes better outcomes than one being walked through a slide at a time.
 * The form state lives in the DOM between renders — every input carries a
 * `data-tm-field`, and `readForm()` reads them back before any re-render, so a
 * validation error never costs the student what they typed.
 *
 * **Nothing here computes a date.** The seeding schedule is the server's
 * (term-core.js `seedSchedule`), so the dates a student sees on their roadmap are
 * the dates the server actually wrote.
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

  var HOST_ID = 'flightplan-term';
  var SYSTEM_LABEL = { semester: 'Semester', quarter: 'Quarter', trimester: 'Trimester' };

  var host = null;
  var state = {
    loaded: false,
    ready: true,
    term: null,
    review: null,
    canReview: false,
    headline: '',
    systems: ['semester', 'quarter', 'trimester'],
    maxOutcomes: 3,
    message: '',
    // The wizard, and the form values it is holding. `form` survives a re-render
    // because readForm() copies the DOM into it before every render() that a
    // user action triggers.
    wizardOpen: false,
    form: { system: 'semester', label: '', startDate: '', endDate: '', outcomes: ['', '', ''], courses: '', clubs: '', deliverable: '' },
    busy: false,
    error: '',
    seeded: null,       // { seeded:[], requested:n, message:'' } from the last setup
    grantLine: '',
    reviewOpen: false,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- form state -----------------------------------------------------------

  function readForm() {
    if (!host) return;
    var f = state.form;
    var get = function (name) {
      var el = host.querySelector('[data-tm-field="' + name + '"]');
      return el ? String(el.value || '') : '';
    };
    if (!host.querySelector('[data-tm-field="startDate"]')) return; // wizard not rendered
    f.system = get('system') || f.system;
    f.label = get('label');
    f.startDate = get('startDate');
    f.endDate = get('endDate');
    f.courses = get('courses');
    f.clubs = get('clubs');
    f.deliverable = get('deliverable');
    for (var i = 0; i < state.maxOutcomes; i += 1) f.outcomes[i] = get('outcome' + i);
  }

  // ---- pieces ---------------------------------------------------------------

  function progressHtml(t) {
    if (!t || !t.total || (t.status !== 'active' && t.status !== 'ending')) return '';
    var pct = Math.round((t.week / t.total) * 100);
    return '<div class="tm-bar" role="img" aria-label="' + esc('Week ' + t.week + ' of ' + t.total) + '">'
      + '<span class="tm-bar-fill" style="width:' + pct + '%"></span></div>';
  }

  function seededHtml() {
    var t = state.term;
    var rows = (state.seeded && state.seeded.seeded) || (t && t.seeded) || [];
    if (!rows.length) return '';
    return '<p class="tm-label">Dated onto your roadmap</p>'
      + '<ul class="tm-seeded">'
      + rows.map(function (s) {
        return '<li><span class="tm-seeded-text">' + esc(s.text) + '</span>'
          + '<span class="tm-seeded-due">' + esc(s.dueAt) + '</span></li>';
      }).join('')
      + '</ul>';
  }

  function outcomesHtml() {
    var t = state.term;
    if (!t || !t.outcomes || !t.outcomes.length) return '';
    return '<p class="tm-label">What you said this term is for</p>'
      + '<ol class="tm-outcomes">' + t.outcomes.map(function (o) {
        return '<li>' + esc(o) + '</li>';
      }).join('') + '</ol>';
  }

  function anchorsHtml() {
    var a = state.term && state.term.anchors;
    if (!a) return '';
    var bits = [];
    if (a.courses && a.courses.length) bits.push('<span class="tm-anchor-k">Courses</span> ' + esc(a.courses.join(', ')));
    if (a.clubs && a.clubs.length) bits.push('<span class="tm-anchor-k">Clubs</span> ' + esc(a.clubs.join(', ')));
    if (a.deliverable) bits.push('<span class="tm-anchor-k">Deliverable</span> ' + esc(a.deliverable));
    if (!bits.length) return '';
    return '<p class="tm-anchors">' + bits.join(' · ') + '</p>';
  }

  function wizardHtml() {
    var f = state.form;
    var opts = state.systems.map(function (s) {
      return '<option value="' + esc(s) + '"' + (f.system === s ? ' selected' : '') + '>'
        + esc(SYSTEM_LABEL[s] || s) + '</option>';
    }).join('');
    var outcomeInputs = '';
    for (var i = 0; i < state.maxOutcomes; i += 1) {
      outcomeInputs += '<input class="tm-input" type="text" data-tm-field="outcome' + i + '"'
        + ' value="' + esc(f.outcomes[i] || '') + '" maxlength="120"'
        + ' placeholder="' + esc(i === 0 ? 'e.g. finish the trading project and put it on my resume' : 'Outcome ' + (i + 1)) + '"'
        + ' aria-label="' + esc('Outcome ' + (i + 1)) + '">';
    }
    return '<div class="tm-wizard">'
      + '<div class="tm-row">'
      + '<label class="tm-field"><span class="tm-field-k">System</span>'
      + '<select class="tm-input" data-tm-field="system">' + opts + '</select></label>'
      + '<label class="tm-field"><span class="tm-field-k">Name it</span>'
      + '<input class="tm-input" type="text" data-tm-field="label" value="' + esc(f.label) + '" maxlength="40" placeholder="Fall 2026"></label>'
      + '</div>'
      + '<div class="tm-row">'
      + '<label class="tm-field"><span class="tm-field-k">First day</span>'
      + '<input class="tm-input" type="date" data-tm-field="startDate" value="' + esc(f.startDate) + '"></label>'
      + '<label class="tm-field"><span class="tm-field-k">Last day</span>'
      + '<input class="tm-input" type="date" data-tm-field="endDate" value="' + esc(f.endDate) + '"></label>'
      + '</div>'
      + '<p class="tm-label">Three things you want to be true by the last day</p>'
      + '<div class="tm-outcome-inputs">' + outcomeInputs + '</div>'
      + '<div class="tm-row">'
      + '<label class="tm-field"><span class="tm-field-k">Courses</span>'
      + '<input class="tm-input" type="text" data-tm-field="courses" value="' + esc(f.courses) + '" maxlength="320" placeholder="CS 154, Stats 244"></label>'
      + '<label class="tm-field"><span class="tm-field-k">Clubs</span>'
      + '<input class="tm-input" type="text" data-tm-field="clubs" value="' + esc(f.clubs) + '" maxlength="320" placeholder="Trading club, UCTC"></label>'
      + '</div>'
      + '<label class="tm-field"><span class="tm-field-k">One thing you will have built or shipped</span>'
      + '<input class="tm-input" type="text" data-tm-field="deliverable" value="' + esc(f.deliverable) + '" maxlength="120" placeholder="A backtest I can show someone"></label>'
      + '<p class="tm-fine">FlightWay dates these across the term and puts them on your roadmap as commitments. '
      + 'Nothing lands in the past, and nothing lands after your last day.</p>'
      + (state.error ? '<p class="tm-error">' + esc(state.error) + '</p>' : '')
      + '<div class="tm-actions">'
      + '<button type="button" class="tm-go" data-tm-save' + (state.busy ? ' disabled' : '') + '>'
      + (state.busy ? 'Setting up…' : 'Set up my term') + '</button>'
      + '<button type="button" class="tm-cancel" data-tm-cancel>Cancel</button>'
      + '</div></div>';
  }

  function reviewHtml() {
    var r = state.review;
    if (!r) return '';
    var section = function (title, rows, fmt) {
      if (!rows || !rows.length) return '';
      return '<p class="tm-label">' + esc(title) + '</p><ul class="tm-review-list">'
        + rows.map(function (x) { return '<li>' + fmt(x) + '</li>'; }).join('') + '</ul>';
    };
    var out = '<div class="tm-review">';
    if (r.headline) out += '<p class="tm-review-headline">' + esc(r.headline) + '</p>';
    if (state.grantLine) out += '<p class="tm-grant">' + esc(state.grantLine) + '</p>';
    out += section('Commitments you kept', r.commitmentsKept, function (c) { return esc(c.text); });
    out += section('Commitments that slipped', r.commitmentsSlipped, function (c) {
      return esc(c.text) + ' <span class="tm-muted">— was due ' + esc(c.dueAt) + '</span>';
    });
    out += section('Proof you added', r.evidence, function (e) {
      return esc(e.title) + (e.type ? ' <span class="tm-muted">— ' + esc(e.type) + '</span>' : '');
    });
    out += section('Applications you moved', r.applications, function (a) {
      return esc(a.role) + (a.company ? ' <span class="tm-muted">— ' + esc(a.company) + '</span>' : '')
        + ' <span class="tm-muted">&rarr; ' + esc(a.status) + '</span>';
    });
    if (r.movement && r.movement.measured && (r.movement.up || r.movement.down)) {
      out += '<p class="tm-label">Your coordinates</p><p class="tm-note">'
        + esc('Moved on ' + (r.movement.up + r.movement.down) + ' dimension'
          + ((r.movement.up + r.movement.down) === 1 ? '' : 's')
          + ' (' + r.movement.up + ' up, ' + r.movement.down + ' down) across ' + r.movement.weeks + ' weekly snapshots.')
        + '</p>';
    }
    out += '</div>';
    return out;
  }

  function renderBody() {
    if (!state.loaded) return '<p class="tm-note">Loading your term…</p>';
    if (!state.ready) return '<p class="tm-note">' + esc(state.message || 'The semester loop is not switched on yet.') + '</p>';

    var t = state.term;
    var parts = [];
    if (state.headline) parts.push('<p class="tm-headline">' + esc(state.headline) + '</p>');

    if (state.wizardOpen || !t) {
      if (!state.wizardOpen) {
        parts.push('<button type="button" class="tm-go" data-tm-open>Set up my term</button>');
        return parts.join('');
      }
      parts.push(wizardHtml());
      return parts.join('');
    }

    // The student's own name for the term leads the line. It is what the digest
    // and both term emails call it, and a card that omits it makes the student
    // wonder which term the emails are about.
    parts.push('<p class="tm-dates">'
      + (t.label ? '<span class="tm-term-name">' + esc(t.label) + '</span> · ' : '')
      + esc(SYSTEM_LABEL[t.system] || 'Term') + ' · '
      + esc(t.startDate) + ' &rarr; ' + esc(t.endDate) + '</p>');
    parts.push(progressHtml(t));
    parts.push(outcomesHtml());
    parts.push(anchorsHtml());
    parts.push(seededHtml());

    if (state.seeded && state.seeded.message) {
      parts.push('<p class="tm-note tm-note--warn">' + esc(state.seeded.message) + '</p>');
    }
    // A term whose dates came from a conversation rather than the ritual: it can
    // drive the digest and this card, and nothing else, so say what is missing
    // instead of showing an empty outcomes list.
    if (t.source === 'mirror') {
      parts.push('<p class="tm-note">These dates came from something you told Marco. Run the ritual to turn them into three dated outcomes.</p>');
    }

    parts.push(reviewHtml());

    parts.push('<div class="tm-actions">');
    if (state.canReview && !state.review) {
      parts.push('<button type="button" class="tm-go" data-tm-review' + (state.busy ? ' disabled' : '') + '>'
        + (state.busy ? 'Working…' : (t.reviewedAt ? 'Reopen my term review' : 'Run my term review')) + '</button>');
    }
    parts.push('<button type="button" class="tm-cancel" data-tm-open>'
      + (t.source === 'mirror' || !t.outcomes.length ? 'Set up my term' : 'Change my term') + '</button>');
    parts.push('</div>');
    if (state.error) parts.push('<p class="tm-error">' + esc(state.error) + '</p>');
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
    state.term = data.term || null;
    state.review = data.review || null;
    state.canReview = !!data.canReview;
    state.headline = data.headline || '';
    state.systems = data.systems || state.systems;
    state.maxOutcomes = Number(data.maxOutcomes) || state.maxOutcomes;
    state.message = data.message || '';
    if (state.term) {
      state.form.system = state.term.system || state.form.system;
      state.form.label = state.term.label || '';
      state.form.startDate = state.term.startDate || '';
      state.form.endDate = state.term.endDate || '';
      var outs = state.term.outcomes || [];
      for (var i = 0; i < state.maxOutcomes; i += 1) state.form.outcomes[i] = outs[i] || '';
      var a = state.term.anchors || {};
      state.form.courses = (a.courses || []).join(', ');
      state.form.clubs = (a.clubs || []).join(', ');
      state.form.deliverable = a.deliverable || '';
    }
  }

  function doSave(btn) {
    if (state.busy) return;
    readForm();
    var f = state.form;
    var outcomes = f.outcomes.filter(function (o) { return String(o || '').trim(); });
    // The only check this panel makes on its own, and it is here because the
    // server's answer to it would cost a round-trip to say something the form
    // can see. Every other rule (span, ordering, how far ahead) is the server's,
    // because those are product rules and this file is not where they live.
    if (!f.startDate || !f.endDate) { state.error = 'Both term dates are needed.'; render(); return; }
    if (!outcomes.length) { state.error = 'Name at least one outcome — that is the whole ritual.'; render(); return; }

    state.busy = true;
    state.error = '';
    render();
    var release = (global.FWButtonBusy && FWButtonBusy.hold) ? FWButtonBusy.hold(btn) : null;
    afetch('/semester', 'POST', {
      action: 'setup',
      system: f.system,
      label: f.label,
      startDate: f.startDate,
      endDate: f.endDate,
      outcomes: outcomes,
      anchors: { courses: f.courses, clubs: f.clubs, deliverable: f.deliverable },
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      state.busy = false;
      if (release) release();
      if (!data || data.ok === false) {
        state.error = (data && (data.message || data.error)) || 'Could not save your term just now.';
        render();
        return;
      }
      state.term = data.term || null;
      state.headline = data.headline || '';
      state.seeded = { seeded: data.seeded || [], requested: Number(data.requested) || 0, message: data.message || '' };
      state.wizardOpen = false;
      try {
        if (global.FWEvents) {
          FWEvents.log('semester_setup', {
            system: f.system,
            outcomes: outcomes.length,
            seeded: (data.seeded || []).length,
            weeks: (data.term && data.term.total) || 0,
          });
        }
      } catch (_) { /* fire-and-forget */ }
      render();
    }).catch(function () {
      state.busy = false;
      if (release) release();
      state.error = 'Could not save your term just now.';
      render();
    });
  }

  function doReview(btn) {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    var release = (global.FWButtonBusy && FWButtonBusy.hold) ? FWButtonBusy.hold(btn) : null;
    afetch('/semester', 'POST', { action: 'review' }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      state.busy = false;
      if (release) release();
      if (!data || data.ok === false) {
        state.error = (data && (data.message || data.error)) || 'Could not build your term review just now.';
        render();
        return;
      }
      state.review = data.review || null;
      state.term = data.term || state.term;
      state.headline = data.headline || state.headline;
      state.grantLine = data.grantLine || '';
      try {
        if (global.FWEvents) {
          FWEvents.log('semester_review', {
            granted: data.granted ? 1 : 0,
            weeks: (data.term && data.term.total) || 0,
            kept: ((data.review && data.review.totals && data.review.totals.commitmentsKept) || 0),
            evidence: ((data.review && data.review.totals && data.review.totals.evidence) || 0),
          });
        }
      } catch (_) { /* fire-and-forget */ }
      // The bonus regeneration lands on the account, so the meters on this page
      // are now stale by one.
      try { if (global.FWPlanSurface) FWPlanSurface.refresh(); } catch (_) {}
      render();
    }).catch(function () {
      state.busy = false;
      if (release) release();
      state.error = 'Could not build your term review just now.';
      render();
    });
  }

  function wireEvents() {
    if (!host || host._tmWired) return;
    host._tmWired = true;
    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;
      // Same rule as season-panel.js: the interstitial belongs at the moment of
      // entry, which for a panel is the first press of its button. `maybeShow`
      // resolves null once it has been seen, so it never stops a returning
      // student — and 'skip' leaves them where they were rather than dropping a
      // six-field form on someone who just said "later".
      if (t.closest('[data-tm-open]')) {
        var intro = (global.FWFeatureIntro && typeof FWFeatureIntro.maybeShow === 'function')
          ? FWFeatureIntro.maybeShow('semester')
          : null;
        if (intro && typeof intro.then === 'function') {
          intro.then(function (how) {
            if (how === 'skip') return;
            state.wizardOpen = true; state.error = ''; render();
          });
          return;
        }
        state.wizardOpen = true; state.error = ''; render();
        return;
      }
      if (t.closest('[data-tm-cancel]')) { readForm(); state.wizardOpen = false; state.error = ''; render(); return; }
      if (t.closest('[data-tm-save]')) { doSave(t.closest('[data-tm-save]')); return; }
      if (t.closest('[data-tm-review]')) { doReview(t.closest('[data-tm-review]')); return; }
    });
  }

  function mount() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no term module — no-op
    if (host.getAttribute('data-fp-term-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-fp-term-mounted', '1');
    wireEvents();
    render(); // "Loading your term…"

    afetch('/semester').then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      state.loaded = true;
      if (!data) {
        state.ready = false;
        state.message = 'Could not load your term just now.';
        render();
        return;
      }
      applyGetData(data);
      render();
    }).catch(function () {
      state.loaded = true;
      state.ready = false;
      state.message = 'Could not load your term just now.';
      render();
    });
  }

  global.FWTerm = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
