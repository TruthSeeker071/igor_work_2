/**
 * FlightWay V2 S9 — Deadline Radar UI (D12).
 *
 * Client half of functions/deadlines.js. Mounts into #flightplan-radar on
 * flightplan.html: the tracked/done list (soonest first, exactly as the
 * server orders it), a metered grounded Refresh button, and a manual
 * "Add a deadline" form for the always-free path.
 *
 * Idiom copied from portal-flightplan.js: same afetch() (FWAuth.authFetch
 * when present, credentialed fetch otherwise), same IIFE wrapper, same
 * "no host, no-op" boot. Diverges on one point deliberately: every row is
 * built with createElement/textContent, never innerHTML — deadline titles,
 * orgs and urls are extracted from arbitrary web pages by the grounded
 * refresh pipeline (deadline-refresh.js) and are therefore untrusted, same
 * as admin-console.js treats analytics rows. Every refresh-allowance number
 * shown here comes straight off the server's `cap` object; nothing is
 * hand-computed client-side.
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

  var HOST_ID = 'flightplan-radar';
  var DEFAULT_KINDS = ['internship', 'fellowship', 'competition', 'club', 'application-window'];
  var KIND_LABELS = {
    internship: 'Internship',
    fellowship: 'Fellowship',
    competition: 'Competition',
    club: 'Club',
    'application-window': 'Application window',
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var host = null;
  var listEl = null;
  var state = { grounded: false, kinds: DEFAULT_KINDS, cap: null, deadlines: [], formOpen: false, lastResult: '' };

  function kindLabel(kind) { return KIND_LABELS[kind] || String(kind || ''); }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    var mon = MONTHS[Number(m[2]) - 1];
    return (mon || m[2]) + ' ' + Number(m[3]) + ', ' + m[1];
  }

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  function urgencyTier(daysOut) {
    var n = Number(daysOut);
    if (!Number.isFinite(n) || n <= 3) return 'urgent';
    if (n <= 14) return 'soon';
    return 'normal';
  }

  function urgencyLabel(daysOut) {
    var n = Number(daysOut);
    if (n === 0) return 'Closes today';
    if (n === 1) return 'Closes tomorrow';
    if (!Number.isFinite(n) || n < 0) return 'Closes soon';
    return 'Closes in ' + n + ' days';
  }

  /** lucide.svg() markup here is always static: the icon name is a hardcoded
   * literal in this file, never a value read from the server, so setting it
   * is "static chrome with no interpolation" under the no-innerHTML rule. */
  function iconSpan(name) {
    var span = document.createElement('span');
    span.className = 'fp-radar-refresh-icon';
    span.setAttribute('aria-hidden', 'true');
    try {
      if (global.lucide && typeof global.lucide.svg === 'function') {
        var markup = global.lucide.svg(name);
        if (markup) span.innerHTML = markup;
      }
    } catch (_) { /* icon is decorative; degrade to no icon */ }
    return span;
  }

  /** Every number here reads straight off the server's cap object. */
  function capNote(cap) {
    if (!cap || cap.unlimited) return '';
    if (cap.ok) {
      var rem = cap.remaining;
      if (rem == null) return '';
      return rem + (rem === 1 ? ' refresh left this week' : ' refreshes left this week');
    }
    return cap.resetPeriod === 'week'
      ? 'No refreshes left this week — resets Monday'
      : 'No refreshes left right now';
  }

  function refreshResultMessage(res) {
    if (res && res.ok) {
      var added = Number(res.added) || 0;
      var updated = Number(res.updated) || 0;
      if (!added && !updated) return 'Nothing new — you’re already tracking everything we found.';
      var parts = [];
      if (added) parts.push(added + (added === 1 ? ' new deadline' : ' new deadlines'));
      if (updated) parts.push(updated + (updated === 1 ? ' update' : ' updates'));
      return 'Found ' + parts.join(', ') + '.';
    }
    var reason = res && res.reason;
    if (reason === 'capped') return (res.cap && res.cap.message) || 'No refreshes left this week.';
    if (reason === 'no-career') return 'Build your roadmap first and we’ll scan for deadlines in that field.';
    if (reason === 'no-results' || reason === 'shape-failed') return 'Nothing new came back this time. Try again later.';
    // Never surface a raw reason string — any other/unexpected reason gets the
    // same honest, non-alarming fallback.
    return 'Nothing new came back this time. Try again later.';
  }

  // ---- one row --------------------------------------------------------

  function buildTitleNode(d) {
    var isLink = typeof d.url === 'string' && /^https:\/\//.test(d.url);
    var node = document.createElement(isLink ? 'a' : 'span');
    node.className = 'fp-radar-title';
    node.textContent = d.title || 'Untitled';
    if (isLink) {
      node.setAttribute('href', d.url);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    return node;
  }

  function buildChip(daysOut) {
    var chip = document.createElement('span');
    chip.className = 'fp-radar-chip fp-radar-chip--' + urgencyTier(daysOut);
    chip.textContent = urgencyLabel(daysOut);
    return chip;
  }

  function buildRow(d) {
    var row = document.createElement('div');
    row.className = 'fp-radar-row' + (d.status === 'done' ? ' fp-radar-row--done' : '');
    row.setAttribute('data-deadline-id', String(d.id || ''));

    var top = document.createElement('div');
    top.className = 'fp-radar-row-top';
    top.appendChild(buildChip(d.daysOut));
    top.appendChild(buildTitleNode(d));
    row.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'fp-radar-meta';
    var metaText = document.createElement('span');
    metaText.className = 'fp-radar-meta-text';
    metaText.textContent = d.org ? (d.org + ' · ' + kindLabel(d.kind)) : kindLabel(d.kind);
    meta.appendChild(metaText);
    var dateEl = document.createElement('span');
    dateEl.className = 'fp-radar-date';
    dateEl.textContent = formatDate(d.deadline);
    meta.appendChild(dateEl);
    row.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'fp-radar-actions';
    if (d.status === 'done') {
      var undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'fp-radar-btn fp-radar-btn--undo';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', function () { changeStatus(d, 'tracked'); });
      actions.appendChild(undoBtn);
    } else {
      var doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'fp-radar-btn fp-radar-btn--done';
      doneBtn.textContent = 'Done';
      doneBtn.addEventListener('click', function () { changeStatus(d, 'done'); });
      var dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'fp-radar-btn fp-radar-btn--dismiss';
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.addEventListener('click', function () { dismissRow(d); });
      actions.appendChild(doneBtn);
      actions.appendChild(dismissBtn);
    }
    row.appendChild(actions);
    return row;
  }

  function changeStatus(d, status) {
    d.status = status;
    renderList();
    if (status === 'done') {
      try { if (global.FWEvents) FWEvents.log('deadline_done', { kind: d.kind }); } catch (_) { /* fire-and-forget */ }
    }
    afetch('/deadlines', 'POST', { action: 'status', id: d.id, status: status })
      .catch(function () { /* optimistic UI already updated */ });
  }

  function dismissRow(d) {
    state.deadlines = state.deadlines.filter(function (x) { return x.id !== d.id; });
    renderList();
    try { if (global.FWEvents) FWEvents.log('deadline_dismissed', { kind: d.kind }); } catch (_) { /* fire-and-forget */ }
    afetch('/deadlines', 'POST', { action: 'status', id: d.id, status: 'dismissed' })
      .catch(function () { /* optimistic UI already updated; dismiss does not come back */ });
  }

  function renderList() {
    if (!listEl) return;
    listEl.textContent = '';
    if (!state.deadlines.length) {
      var p = document.createElement('p');
      p.className = 'fp-empty';
      p.textContent = 'No tracked deadlines yet. Once your roadmap is built, we scan for real application windows in your field and the ones that matter land here.';
      listEl.appendChild(p);
      var cta = document.createElement('a');
      cta.className = 'fp-empty-cta';
      cta.setAttribute('href', 'roadmap.html');
      cta.textContent = 'Build my roadmap →';
      listEl.appendChild(cta);
      return;
    }
    var list = document.createElement('div');
    list.className = 'fp-radar-list';
    state.deadlines.forEach(function (d) { list.appendChild(buildRow(d)); });
    listEl.appendChild(list);
  }

  // ---- refresh ----------------------------------------------------------

  function handleRefresh(btn) {
    if (btn.disabled) return;
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Refreshing…' }) : function () {};
    afetch('/deadlines', 'POST', { action: 'refresh' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        state.deadlines = (res && res.deadlines) || state.deadlines;
        state.cap = (res && res.cap) || state.cap;
        state.lastResult = refreshResultMessage(res);
        try {
          if (global.FWEvents) {
            FWEvents.log('radar_refresh', {
              source: 'manual',
              added: Number(res && res.added) || 0,
              updated: Number(res && res.updated) || 0,
              reason: (res && res.reason) || 'ok',
            });
          }
        } catch (_) { /* fire-and-forget */ }
        render();
      })
      .catch(function () {
        state.lastResult = 'Could not refresh right now. Try again in a moment.';
        render();
      })
      .finally(function () { restore(); });
  }

  // ---- manual add ---------------------------------------------------------

  function formField(type, id, labelText) {
    var wrap = document.createElement('label');
    wrap.className = 'fp-radar-form-field';
    wrap.setAttribute('for', id);
    var span = document.createElement('span');
    span.className = 'fp-radar-form-label';
    span.textContent = labelText;
    wrap.appendChild(span);
    var input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.className = 'fp-radar-input';
    if (type === 'date') input.min = todayIso();
    wrap.appendChild(input);
    return wrap;
  }

  function submitAdd(form, submitBtn, errorP) {
    var titleEl = form.querySelector('#fp-radar-f-title');
    var dateEl = form.querySelector('#fp-radar-f-date');
    var orgEl = form.querySelector('#fp-radar-f-org');
    var urlEl = form.querySelector('#fp-radar-f-url');
    var kindEl = form.querySelector('#fp-radar-f-kind');
    var kind = kindEl ? kindEl.value : '';

    errorP.hidden = true;
    errorP.textContent = '';

    var restore = global.FWButtonBusy ? FWButtonBusy.start(submitBtn, { label: 'Saving…' }) : function () {};
    afetch('/deadlines', 'POST', {
      action: 'add',
      title: titleEl ? titleEl.value : '',
      dueDate: dateEl ? dateEl.value : '',
      kind: kind,
      org: orgEl ? orgEl.value : '',
      url: urlEl ? urlEl.value : '',
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) {
          errorP.textContent = (res.data && res.data.error) || 'Could not save that deadline.';
          errorP.hidden = false;
          return;
        }
        state.deadlines = (res.data && res.data.deadlines) || state.deadlines;
        state.formOpen = false;
        try { if (global.FWEvents) FWEvents.log('deadline_saved', { kind: kind, source: 'manual' }); } catch (_) { /* fire-and-forget */ }
        render();
      })
      .catch(function () {
        errorP.textContent = 'Could not save that deadline. Try again.';
        errorP.hidden = false;
      })
      .finally(function () { restore(); });
  }

  function buildAddForm() {
    var wrap = document.createElement('div');
    wrap.className = 'fp-radar-form-wrap';
    if (!state.formOpen) { wrap.hidden = true; return wrap; }

    var form = document.createElement('form');
    form.className = 'fp-radar-form';
    form.setAttribute('novalidate', '');

    form.appendChild(formField('text', 'fp-radar-f-title', 'Title'));
    form.appendChild(formField('date', 'fp-radar-f-date', 'Due date'));
    form.appendChild(formField('text', 'fp-radar-f-org', 'Organization (optional)'));
    form.appendChild(formField('text', 'fp-radar-f-url', 'Link (optional, https://)'));

    var kindWrap = document.createElement('label');
    kindWrap.className = 'fp-radar-form-field';
    kindWrap.setAttribute('for', 'fp-radar-f-kind');
    var kindSpan = document.createElement('span');
    kindSpan.className = 'fp-radar-form-label';
    kindSpan.textContent = 'Kind';
    kindWrap.appendChild(kindSpan);
    var select = document.createElement('select');
    select.id = 'fp-radar-f-kind';
    select.className = 'fp-radar-input';
    (state.kinds.length ? state.kinds : DEFAULT_KINDS).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = kindLabel(k);
      select.appendChild(opt);
    });
    kindWrap.appendChild(select);
    form.appendChild(kindWrap);

    var errorP = document.createElement('p');
    errorP.className = 'fp-radar-form-error';
    errorP.hidden = true;
    form.appendChild(errorP);

    var actionsRow = document.createElement('div');
    actionsRow.className = 'fp-radar-form-actions';
    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'fp-radar-form-save';
    submitBtn.textContent = 'Save';
    actionsRow.appendChild(submitBtn);
    form.appendChild(actionsRow);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitAdd(form, submitBtn, errorP);
    });

    wrap.appendChild(form);
    return wrap;
  }

  // ---- shell --------------------------------------------------------------

  function buildToolbar() {
    var toolbar = document.createElement('div');
    toolbar.className = 'fp-radar-toolbar';

    // grounded === false: no control, no explanation — the flag is invisible
    // to students by design (see functions/deadlines.js GET comment).
    if (state.grounded) {
      var refreshWrap = document.createElement('div');
      refreshWrap.className = 'fp-radar-refresh-wrap';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fp-radar-refresh';
      btn.appendChild(iconSpan('repeat'));
      var label = document.createElement('span');
      label.textContent = 'Refresh';
      btn.appendChild(label);
      var canRefresh = !!(state.cap && state.cap.ok);
      btn.disabled = !canRefresh;
      btn.addEventListener('click', function () { handleRefresh(btn); });
      refreshWrap.appendChild(btn);

      var note = capNote(state.cap);
      if (note) {
        var noteEl = document.createElement('p');
        noteEl.className = 'fp-radar-refresh-note';
        noteEl.textContent = note;
        refreshWrap.appendChild(noteEl);
      }
      toolbar.appendChild(refreshWrap);
    }

    var addToggle = document.createElement('button');
    addToggle.type = 'button';
    addToggle.className = 'fp-radar-add-toggle';
    addToggle.textContent = state.formOpen ? 'Cancel' : 'Add a deadline';
    addToggle.addEventListener('click', function () {
      state.formOpen = !state.formOpen;
      render();
    });
    toolbar.appendChild(addToggle);

    return toolbar;
  }

  function render() {
    if (!host) return;
    host.textContent = '';
    host.appendChild(buildToolbar());
    host.appendChild(buildAddForm());
    if (state.lastResult) {
      var resultP = document.createElement('p');
      resultP.className = 'fp-radar-result';
      resultP.textContent = state.lastResult;
      host.appendChild(resultP);
    }
    listEl = document.createElement('div');
    listEl.className = 'fp-radar-list-wrap';
    host.appendChild(listEl);
    renderList();
  }

  function inject() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no radar module — no-op
    if (host.getAttribute('data-fp-radar-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-fp-radar-mounted', '1');

    afetch('/deadlines').then(function (r) {
      // 401 (signed out) or any other failure: leave the page's existing
      // empty-state copy in place and return quietly.
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      if (!data) return;
      state.grounded = !!data.grounded;
      state.kinds = Array.isArray(data.kinds) && data.kinds.length ? data.kinds : DEFAULT_KINDS;
      state.cap = data.cap || null;
      state.deadlines = Array.isArray(data.deadlines) ? data.deadlines : [];
      render();
    }).catch(function () { /* leave the existing empty-state copy in place */ });
  }

  global.FWDeadlineRadar = { inject: inject };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})(typeof window !== 'undefined' ? window : globalThis);
