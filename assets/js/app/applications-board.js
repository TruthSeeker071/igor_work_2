/**
 * FlightWay V2 S12 — Application Tracker board UI (D13).
 *
 * Mounts into #applications-board on applications.html. Client half of
 * assets/js/shared/applications.js (FWApplications) — this file only renders
 * and posts, it never talks to /tracker directly.
 *
 * Idiom copied from commitments-panel.js / deadline-radar.js: same IIFE
 * wrapper, invoked explicitly via FWApplicationsBoard.mount() from
 * applications.html's boot block (the commitments-panel.js / artifacts.js
 * pattern, not deadline-radar.js's self-mount-on-DOMContentLoaded one, since
 * this page's boot block already gates on FWPageBoot.requireAuth first).
 *
 * Every row is built with createElement + textContent, never innerHTML with
 * interpolated data: role/company/notes/url arrive via the Opportunity
 * Finder's Save button off arbitrary web pages, so they are exactly as
 * untrusted as deadline-radar.js's deadline titles. A url is only ever
 * rendered as a real <a href> when it starts with https://.
 *
 * Two different "busy" idioms are used on purpose, matching whichever call
 * site does or doesn't re-render before the request resolves:
 *   - the status <select> and the second ("Remove?") click use
 *     `state.rowBusyId` to disable controls through a normal render() —
 *     FWButtonBusy cannot own a button that render() is about to detach
 *     mid-flight (see commitments-panel.js's postCommitment() comment for the
 *     exact failure mode).
 *   - the add-form's Save button and the error card's Retry button never
 *     trigger a render() until the request resolves, so FWButtonBusy can
 *     safely own those elements directly (the deadline-radar.js
 *     submitAdd() pattern).
 */
(function (global) {
  'use strict';

  var HOST_ID = 'applications-board';
  var REMOVE_CONFIRM_MS = 4000;

  var host = null;
  var removeConfirmTimer = null;
  var state = {
    loaded: false,
    signedOut: false,
    netError: false,
    // false only when migration 0022 has not been applied to this database. It
    // is a DIFFERENT state from "no applications yet" and from "the request
    // failed", and the only one of the three the student cannot act on — so it
    // says so rather than showing an empty board that refuses every save.
    unavailable: false,
    errorText: '',
    applications: [],
    statuses: [],
    counts: null,
    rowBusyId: null,
    removeConfirmId: null,
    rowErrors: {},
  };

  function isHttpsUrl(v) { return typeof v === 'string' && /^https:\/\//.test(v); }

  function replaceApp(updated) {
    if (!updated || !updated.id) return;
    state.applications = state.applications.map(function (a) { return a.id === updated.id ? updated : a; });
  }

  // ---- one card -------------------------------------------------------

  function buildCard(app) {
    var card = document.createElement('div');
    card.className = 'app-card';
    card.setAttribute('data-app-id', app.id);

    var role = document.createElement('p');
    role.className = 'app-card-role';
    role.textContent = app.role || '';
    card.appendChild(role);

    if (app.company) {
      var company = document.createElement('p');
      company.className = 'app-card-company';
      company.textContent = app.company;
      card.appendChild(company);
    }

    var busy = state.rowBusyId === app.id;

    var select = document.createElement('select');
    select.className = 'app-card-status';
    select.setAttribute('aria-label', 'Move ' + (app.role ? app.role : 'this application'));
    select.disabled = busy;
    state.statuses.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      if (s.id === app.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () { handleStatusChange(app, select.value); });
    card.appendChild(select);

    if (app.notes) {
      var notes = document.createElement('p');
      notes.className = 'app-card-notes';
      notes.textContent = app.notes;
      card.appendChild(notes);
    }

    if (isHttpsUrl(app.url)) {
      var link = document.createElement('a');
      link.className = 'app-card-link';
      link.href = app.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View posting ↗';
      card.appendChild(link);
    }

    var actions = document.createElement('div');
    actions.className = 'app-card-actions';

    var tailor = document.createElement('a');
    tailor.className = 'app-card-action';
    tailor.href = global.FWApplications ? FWApplications.tailorUrl(app) : 'resume.html';
    tailor.textContent = 'Tailor resume →';
    tailor.addEventListener('click', function () {
      try { if (global.FWEvents) FWEvents.log('tracker_tailor_click', { status: app.status }); } catch (_) { /* fire-and-forget */ }
    });
    actions.appendChild(tailor);

    var practice = document.createElement('a');
    practice.className = 'app-card-action';
    practice.href = global.FWApplications ? FWApplications.practiceUrl(app) : 'coach.html#practice';
    practice.textContent = 'Practice →';
    practice.addEventListener('click', function () {
      try { if (global.FWEvents) FWEvents.log('tracker_practice_click', { status: app.status }); } catch (_) { /* fire-and-forget */ }
    });
    actions.appendChild(practice);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'app-card-action app-card-action--remove';
    removeBtn.textContent = state.removeConfirmId === app.id ? 'Remove?' : 'Remove';
    removeBtn.disabled = busy;
    removeBtn.addEventListener('click', function () { handleRemoveClick(app, removeBtn); });
    actions.appendChild(removeBtn);

    card.appendChild(actions);

    if (state.rowErrors[app.id]) {
      var err = document.createElement('p');
      err.className = 'app-card-error';
      err.textContent = state.rowErrors[app.id];
      card.appendChild(err);
    }

    return card;
  }

  // ---- status / remove actions -----------------------------------------

  function handleStatusChange(app, nextStatus) {
    if (!nextStatus || nextStatus === app.status) return;
    var prevStatus = app.status;
    replaceApp(Object.assign({}, app, { status: nextStatus }));
    state.rowBusyId = app.id;
    delete state.rowErrors[app.id];
    render();

    FWApplications.setStatus(app.id, nextStatus).then(function (res) {
      state.rowBusyId = null;
      if (!res.ok) {
        replaceApp(Object.assign({}, app, { status: prevStatus }));
        state.rowErrors[app.id] = res.error || 'Could not update that application.';
        render();
        return;
      }
      if (res.application) replaceApp(res.application);
      render();
    });
  }

  function handleRemoveClick(app, btn) {
    if (state.removeConfirmId !== app.id) {
      state.removeConfirmId = app.id;
      clearTimeout(removeConfirmTimer);
      removeConfirmTimer = setTimeout(function () {
        if (state.removeConfirmId === app.id) { state.removeConfirmId = null; render(); }
      }, REMOVE_CONFIRM_MS);
      render();
      return;
    }

    clearTimeout(removeConfirmTimer);
    // No render() between here and the response landing, so FWButtonBusy can
    // safely own this exact button (see the file header note).
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Removing…' }) : function () {};
    FWApplications.remove(app.id).then(function (res) {
      restore();
      state.removeConfirmId = null;
      if (!res.ok) {
        state.rowErrors[app.id] = res.error || 'Could not remove that application.';
        render();
        return;
      }
      state.applications = res.applications;
      state.counts = res.counts || state.counts;
      delete state.rowErrors[app.id];
      render();
    });
  }

  // ---- columns ----------------------------------------------------------

  /** Built entirely from the server's `statuses` array — never a hardcoded list. */
  function buildColumns() {
    var grid = document.createElement('div');
    grid.className = 'app-board-grid';

    var byStatus = {};
    state.applications.forEach(function (a) {
      if (!byStatus[a.status]) byStatus[a.status] = [];
      byStatus[a.status].push(a);
    });

    state.statuses.forEach(function (s) {
      var items = byStatus[s.id] || [];

      var col = document.createElement('div');
      col.className = 'app-col';
      col.setAttribute('data-status', s.id);

      var head = document.createElement('div');
      head.className = 'app-col-head';
      var label = document.createElement('h2');
      label.className = 'app-col-label';
      label.textContent = s.label;
      head.appendChild(label);
      var count = document.createElement('span');
      count.className = 'app-col-count';
      count.textContent = String(items.length);
      head.appendChild(count);
      col.appendChild(head);

      var list = document.createElement('div');
      list.className = 'app-col-list';
      if (!items.length) {
        var hint = document.createElement('p');
        hint.className = 'app-col-hint';
        hint.textContent = s.hint || '';
        list.appendChild(hint);
      } else {
        items.forEach(function (a) { list.appendChild(buildCard(a)); });
      }
      col.appendChild(list);

      grid.appendChild(col);
    });

    return grid;
  }

  // ---- add-manually form --------------------------------------------------

  function formField(id, labelText, required) {
    var wrap = document.createElement('label');
    wrap.className = 'app-add-field';
    wrap.setAttribute('for', id);
    var span = document.createElement('span');
    span.className = 'app-add-label';
    span.textContent = labelText;
    wrap.appendChild(span);
    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'app-add-input';
    if (required) input.required = true;
    wrap.appendChild(input);
    return wrap;
  }

  function submitAddForm(form, submitBtn, errorP) {
    var roleEl = form.querySelector('#app-add-role');
    var companyEl = form.querySelector('#app-add-company');
    var urlEl = form.querySelector('#app-add-url');
    var notesEl = form.querySelector('#app-add-notes');

    errorP.hidden = true;
    errorP.textContent = '';

    var restore = global.FWButtonBusy ? FWButtonBusy.start(submitBtn, { label: 'Saving…' }) : function () {};
    FWApplications.save({
      source: 'manual',
      role: roleEl ? roleEl.value : '',
      company: companyEl ? companyEl.value : '',
      url: urlEl ? urlEl.value : '',
      notes: notesEl ? notesEl.value : '',
    }).then(function (res) {
      restore();
      if (!res.ok) {
        errorP.textContent = res.error || 'Could not save that application.';
        errorP.hidden = false;
        return;
      }
      state.applications = res.applications.length ? res.applications : state.applications;
      if (res.statuses.length) state.statuses = res.statuses;
      state.counts = res.counts || state.counts;
      render();
    });
  }

  function buildAddForm() {
    var form = document.createElement('form');
    form.className = 'app-add-form';
    form.setAttribute('novalidate', '');
    form.setAttribute('aria-label', 'Add an application manually');

    form.appendChild(formField('app-add-role', 'Role', true));
    form.appendChild(formField('app-add-company', 'Company (optional)', false));
    form.appendChild(formField('app-add-url', 'Link (optional, https://)', false));
    form.appendChild(formField('app-add-notes', 'Notes (optional)', false));

    var errorP = document.createElement('p');
    errorP.className = 'app-add-error';
    errorP.hidden = true;
    form.appendChild(errorP);

    var actionsRow = document.createElement('div');
    actionsRow.className = 'app-add-actions';
    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'app-add-save';
    submitBtn.textContent = 'Add';
    actionsRow.appendChild(submitBtn);
    form.appendChild(actionsRow);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitAddForm(form, submitBtn, errorP);
    });

    return form;
  }

  // ---- empty / error / signed-out states -----------------------------------

  function buildEmptyState() {
    var wrap = document.createElement('div');
    wrap.className = 'app-empty';
    var p = document.createElement('p');
    p.className = 'app-empty-text';
    p.textContent = 'Save something worth chasing from the Opportunity Finder, or add one by hand, and it lands here. Move it along as it moves in real life, and tailor a resume or practise the interview from the same card.';
    wrap.appendChild(p);
    var cta = document.createElement('a');
    cta.className = 'app-empty-cta';
    cta.setAttribute('href', 'roadmap.html?focus=1');
    cta.textContent = 'Find opportunities →';
    wrap.appendChild(cta);
    return wrap;
  }

  function buildSignedOutCard() {
    var card = document.createElement('div');
    card.className = 'app-state-card';
    var p = document.createElement('p');
    p.className = 'app-state-text';
    p.textContent = 'Sign in to track your applications.';
    card.appendChild(p);
    var a = document.createElement('a');
    a.className = 'app-state-cta';
    a.setAttribute('href', 'auth.html');
    a.textContent = 'Sign in →';
    card.appendChild(a);
    return card;
  }

  function buildErrorCard() {
    var card = document.createElement('div');
    card.className = 'app-state-card';
    var p = document.createElement('p');
    p.className = 'app-state-text';
    p.textContent = state.errorText || 'Could not load your applications.';
    card.appendChild(p);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-state-retry';
    btn.textContent = 'Retry';
    btn.addEventListener('click', function () {
      var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Retrying…' }) : function () {};
      FWApplications.list().then(function (res) {
        restore();
        applyListResult(res);
      });
    });
    card.appendChild(btn);
    return card;
  }

  function buildLoadingState() {
    var p = document.createElement('p');
    p.className = 'app-loading';
    p.textContent = 'Loading your applications…';
    return p;
  }

  /** Migration 0022 pending. Honest, not an error — nothing is broken yet. */
  function buildUnavailableCard() {
    var card = document.createElement('div');
    card.className = 'app-notice';
    var h = document.createElement('h2');
    h.className = 'app-notice-title';
    h.textContent = 'The tracker is not switched on yet';
    var p = document.createElement('p');
    p.className = 'app-notice-body';
    p.textContent = 'Applications you save from the Opportunity Finder will appear here as soon as it is. '
      + 'Nothing you have done is lost — there is just nowhere to put it right now.';
    var a = document.createElement('a');
    a.className = 'app-notice-link';
    a.href = 'flightplan.html';
    a.textContent = 'Back to your Flight Plan →';
    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(a);
    return card;
  }

  // ---- shell --------------------------------------------------------------

  function render() {
    if (!host) return;
    host.textContent = '';

    if (state.signedOut) { host.appendChild(buildSignedOutCard()); return; }
    if (state.netError) { host.appendChild(buildErrorCard()); return; }
    if (!state.loaded) { host.appendChild(buildLoadingState()); return; }
    if (state.unavailable) { host.appendChild(buildUnavailableCard()); return; }

    host.appendChild(buildAddForm());

    if (!state.counts || !state.counts.total) {
      host.appendChild(buildEmptyState());
      return;
    }

    host.appendChild(buildColumns());
  }

  function applyListResult(res) {
    if (!res.ok) {
      if (res.status === 401) {
        state.signedOut = true;
        state.netError = false;
        render();
        return;
      }
      state.netError = true;
      state.errorText = res.error || 'Could not load your applications.';
      render();
      return;
    }
    state.loaded = true;
    state.signedOut = false;
    state.netError = false;
    state.unavailable = res.available === false;
    state.applications = res.applications;
    state.statuses = res.statuses;
    state.counts = res.counts;
    render();
  }

  function mount() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no board — no-op
    if (host.getAttribute('data-app-board-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-app-board-mounted', '1');

    render(); // loading skeleton

    if (!global.FWApplications) {
      state.netError = true;
      state.errorText = 'Could not load your applications.';
      render();
      return;
    }
    FWApplications.list().then(applyListResult);
  }

  global.FWApplicationsBoard = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
