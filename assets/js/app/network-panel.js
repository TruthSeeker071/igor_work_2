/**
 * FlightWay V2 S17 — Network mapper, client half (D13).
 *
 * Server contract lives in functions/outreach.js (finished, not touched here).
 * Mounts into #flightplan-network on flightplan.html: the archetype cards we
 * suggest, the list the student keeps, a drafted message per person, and the
 * status they report back.
 *
 * Idiom: afetch()/IIFE/mount-guard/esc()-into-innerHTML/one delegated listener,
 * copied wholesale from scorecard-panel.js — same page, same shape of surface,
 * and two panels on one page disagreeing about how to render an error is worse
 * than either choice. Errors are read off the response body's own
 * `error`/`message` with a plain fallback, as deadline-radar.js and
 * commitments-panel.js both actually do.
 *
 * **Two copy rules are product requirements, not decoration** (§5 S17):
 *   1. FlightWay never sends anything and never scrapes anyone. The panel says
 *      so where the student is about to act, not in a footnote — because a
 *      product that drafts a message is one a student can reasonably assume
 *      sends it, and finding out otherwise a week later costs them the contact.
 *   2. Every "find them here" line is a directory they open themselves. There is
 *      no lookup button in this panel, and there is nothing to add one to.
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

  var HOST_ID = 'flightplan-network';
  var FEATURE = 'outreach-draft';

  /**
   * The draft POST needs longer than authFetch's 30s default is comfortable
   * with but nothing like the scorecard's 60s: one draft is a single 20s-budget
   * Gemini call with no grounding in front of it. 30s leaves the server's own
   * timeout room to fire first, which matters because the server refunds the
   * allowance on its own failures and a client abort collects no refund.
   */
  var DRAFT_TIMEOUT_MS = 30000;

  var STATUS_LABEL = {
    suggested: 'On my list', drafted: 'Draft ready', sent: 'Sent', replied: 'Replied', met: 'Met',
  };
  var ORG_TYPE_LABEL = {
    university: 'On campus', employer: 'At an employer', program: 'Program', community: 'Community',
  };
  var CHANNEL_LABEL = { email: 'Email', linkedin: 'LinkedIn', 'in-person': 'In person' };

  // Reasons that will fail again identically until the student does something
  // OFF this panel — no point offering a button that reproduces the refusal.
  var NO_RETRY_REASONS = { 'no-career': 1, 'no-record': 1 };

  var host = null;
  var state = {
    loaded: false,
    ready: true,
    contacts: [],
    suggestions: [],
    networkSteps: [],
    statuses: ['suggested', 'drafted', 'sent', 'replied', 'met'],
    cap: null,
    full: false,
    reason: '',
    message: '',
    addOpen: false,
    addError: '',
    capLogged: false,
    rowUi: {},   // contactId -> { busy, error, copied, failure:{reason,message} }
    sugUi: {},   // archetype  -> { busy, error }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rowUi(id) {
    if (!state.rowUi[id]) state.rowUi[id] = {};
    return state.rowUi[id];
  }

  /**
   * §4: every wall emits `plan_cap_hit`. This panel renders its cap card from
   * `FWPlanSurface.capCardHtml()` (a string, because the body is one innerHTML
   * pass) rather than `capCard()`, which is the helper that logs the event
   * itself — so the event fires here or this would be a metered surface whose
   * wall is invisible in the funnel. Once per mount, not per render.
   */
  function logCapHit() {
    if (state.capLogged) return;
    state.capLogged = true;
    try { if (global.FWEvents) FWEvents.log('plan_cap_hit', { feature: FEATURE }); } catch (_) { /* fire-and-forget */ }
  }

  // ---- the standing promise ------------------------------------------------

  /**
   * The sentence that makes this feature honest, rendered next to the drafts
   * rather than at the bottom of the panel. §5 S17 asks for exactly this
   * expectation to be set in UI copy.
   */
  function promiseHtml() {
    return '<p class="nw-promise">FlightWay writes the draft. <strong>You send it</strong> — from your own '
      + 'email or LinkedIn, after you have edited it so it sounds like you. We never message anyone on your '
      + 'behalf, and we never scrape LinkedIn or anywhere else: every suggestion below is a directory you '
      + 'open yourself.</p>';
  }

  // ---- run control (draft allowance / cap card) ----------------------------

  function allowanceHtml() {
    if (!global.FWPlanSurface || typeof FWPlanSurface.allowance !== 'function') return '';
    var a = FWPlanSurface.allowance(FEATURE);
    if (!a) return '';
    return '<span class="nw-allowance">' + esc(FWPlanSurface.allowanceText(a)) + '</span>';
  }

  function capCardHtml() {
    if (!state.cap || state.cap.ok !== false) return '';
    return (global.FWPlanSurface && typeof FWPlanSurface.capCardHtml === 'function')
      ? FWPlanSurface.capCardHtml(FEATURE, state.cap.message)
      : '<p class="nw-note">' + esc(state.cap.message || 'No drafts left right now.') + '</p>';
  }

  // ---- suggestions ---------------------------------------------------------

  function suggestionCardHtml(s) {
    var ui = state.sugUi[s.archetype] || {};
    return '<div class="nw-sug-card">'
      + '<p class="nw-sug-label">' + esc(s.label) + '</p>'
      + (s.orgType ? '<span class="nw-chip">' + esc(ORG_TYPE_LABEL[s.orgType] || s.orgType) + '</span>' : '')
      + '<p class="nw-sug-why">' + esc(s.why) + '</p>'
      + '<p class="nw-sug-how"><span class="nw-sug-how-label">Find one:</span> ' + esc(s.howToFind) + '</p>'
      + '<div class="nw-sug-foot">'
      + '<button type="button" class="nw-sug-add" data-nw-add-sug="' + esc(s.archetype) + '"'
      + (ui.busy || state.full ? ' disabled' : '') + '>Add to my list</button>'
      + (ui.error ? '<span class="nw-row-error">' + esc(ui.error) + '</span>' : '')
      + '</div></div>';
  }

  function suggestionsHtml() {
    if (!state.suggestions.length) return '';
    var stepNote = '';
    if (state.networkSteps.length) {
      stepNote = '<p class="nw-step-note">From your roadmap: &ldquo;'
        + esc(state.networkSteps[0].text) + '&rdquo;</p>';
    }
    return '<div class="nw-sugs"><h3 class="nw-subhead">Who to contact</h3>'
      + stepNote
      + '<div class="nw-sug-list">' + state.suggestions.map(suggestionCardHtml).join('') + '</div></div>';
  }

  // ---- one contact row ----------------------------------------------------

  function statusSelectHtml(c) {
    // Built from the SERVER's own statuses array, never a hardcoded ladder —
    // the S12 discipline, so a ladder change is a one-file change.
    var opts = state.statuses.map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === c.status ? ' selected' : '') + '>'
        + esc(STATUS_LABEL[s] || s) + '</option>';
    }).join('');
    return '<label class="nw-status"><span class="nw-status-label">Status</span>'
      + '<select class="nw-status-select" data-nw-status="' + esc(c.id) + '">' + opts + '</select></label>';
  }

  function draftHtml(c) {
    var ui = rowUi(c.id);
    if (!c.draft || !c.draft.body) {
      var blocked = state.cap && state.cap.ok === false;
      return '<div class="nw-draft-empty">'
        + (blocked ? '' : '<button type="button" class="nw-draft-btn" data-nw-draft="' + esc(c.id) + '"'
          + (ui.busy ? ' disabled' : '') + '>Draft the message</button>' + allowanceHtml())
        + (ui.failure ? '<p class="nw-row-error">' + esc(ui.failure.message) + '</p>' : '')
        + (ui.error ? '<p class="nw-row-error">' + esc(ui.error) + '</p>' : '')
        + '</div>';
    }
    return '<div class="nw-draft">'
      + (c.draft.subject ? '<p class="nw-draft-subject"><span class="nw-draft-key">Subject</span> ' + esc(c.draft.subject) + '</p>' : '')
      // textContent-safe: a <pre> keeps the paragraph breaks the server's
      // cleanBody deliberately preserved, and esc() still runs over it.
      + '<pre class="nw-draft-body">' + esc(c.draft.body) + '</pre>'
      + '<div class="nw-draft-foot">'
      + '<button type="button" class="nw-copy" data-nw-copy="' + esc(c.id) + '">'
      + (ui.copied ? 'Copied' : 'Copy') + '</button>'
      + '<button type="button" class="nw-redraft" data-nw-draft="' + esc(c.id) + '"'
      + (ui.busy ? ' disabled' : '') + '>Rewrite</button>'
      + allowanceHtml()
      + '</div>'
      + (ui.failure ? '<p class="nw-row-error">' + esc(ui.failure.message) + '</p>' : '')
      + (ui.error ? '<p class="nw-row-error">' + esc(ui.error) + '</p>' : '')
      + '</div>';
  }

  function contactRowHtml(c) {
    var who = c.name ? c.name + (c.org ? ' — ' + c.org : '') : '';
    return '<li class="nw-row nw-row--' + esc(c.status) + '" data-nw-row="' + esc(c.id) + '">'
      + '<div class="nw-row-head">'
      + '<div class="nw-row-who">'
      + (who ? '<p class="nw-row-name">' + esc(who) + '</p>' : '')
      + '<p class="nw-row-label">' + esc(c.label) + '</p>'
      + (c.channel ? '<span class="nw-chip">' + esc(CHANNEL_LABEL[c.channel] || c.channel) + '</span>' : '')
      + '</div>'
      + statusSelectHtml(c)
      + '</div>'
      + (c.howToFind ? '<p class="nw-row-how">' + esc(c.howToFind) + '</p>' : '')
      + draftHtml(c)
      + '<div class="nw-row-foot">'
      + '<button type="button" class="nw-name-edit" data-nw-name="' + esc(c.id) + '">'
      + (c.name ? 'Edit name' : 'Add their name') + '</button>'
      + '<button type="button" class="nw-remove" data-nw-remove="' + esc(c.id) + '">Remove</button>'
      + '</div>'
      + '</li>';
  }

  function contactsHtml() {
    if (!state.contacts.length) return '';
    return '<div class="nw-list-wrap"><h3 class="nw-subhead">Your list</h3>'
      + promiseHtml()
      + capCardHtml()
      + '<ul class="nw-list">' + state.contacts.map(contactRowHtml).join('') + '</ul></div>';
  }

  // ---- add-manually form --------------------------------------------------

  function addFormHtml() {
    if (!state.addOpen) {
      return '<div class="nw-add-wrap"><button type="button" class="nw-add-open" data-nw-add-open'
        + (state.full ? ' disabled' : '') + '>Add someone yourself</button>'
        + (state.full ? '<span class="nw-note">Your list is full.</span>' : '') + '</div>';
    }
    return '<div class="nw-add-wrap nw-add-wrap--open">'
      + '<p class="nw-add-title">Someone you already know about</p>'
      + '<input type="text" class="nw-add-name" placeholder="Their name (optional)" maxlength="60">'
      + '<input type="text" class="nw-add-org" placeholder="Where they are (optional)" maxlength="80">'
      + '<input type="text" class="nw-add-label" placeholder="Who they are, in one line" maxlength="160">'
      + '<div class="nw-add-btns">'
      + '<button type="button" class="nw-add-go" data-nw-add-go>Add to my list</button>'
      + '<button type="button" class="nw-add-cancel" data-nw-add-cancel>Cancel</button>'
      + '</div>'
      + (state.addError ? '<p class="nw-row-error">' + esc(state.addError) + '</p>' : '')
      + '</div>';
  }

  // ---- shell --------------------------------------------------------------

  function degradedHtml(reason, message) {
    var link = '';
    if (reason === 'no-career') link = '<a class="fp-empty-cta" href="roadmap.html">Build my roadmap &rarr;</a>';
    else if (reason === 'no-record') link = '<a class="fp-empty-cta" href="resume.html">Add my resume &rarr;</a>';
    return '<p class="fp-empty">' + esc(message) + '</p>' + link;
  }

  function introHtml() {
    return '<p class="fp-empty">Networking is the one roadmap step nobody knows how to start. '
      + 'These are the people worth contacting for your target career, how to find each of them, '
      + 'and a first message you can edit and send yourself.</p>'
      + promiseHtml();
  }

  function renderBody() {
    if (!state.loaded) return '<p class="fp-empty">Loading your network list&hellip;</p>';
    if (!state.ready) return degradedHtml(state.reason, state.message);
    if (!state.contacts.length && !state.suggestions.length) {
      return degradedHtml('no-career',
        'Pick a target career and build your roadmap first — who is worth contacting depends on where you are headed.');
    }
    if (!state.contacts.length) return introHtml() + suggestionsHtml() + addFormHtml();
    return contactsHtml() + suggestionsHtml() + addFormHtml();
  }

  function render() {
    if (!host) return;
    host.innerHTML = renderBody();
  }

  // ---- actions ------------------------------------------------------------

  function applyGetData(data) {
    state.ready = !!data.ready;
    state.contacts = Array.isArray(data.contacts) ? data.contacts : [];
    state.suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    state.networkSteps = Array.isArray(data.networkSteps) ? data.networkSteps : [];
    if (Array.isArray(data.statuses) && data.statuses.length) state.statuses = data.statuses;
    state.cap = data.cap || null;
    state.full = !!data.full;
    state.reason = data.reason || '';
    state.message = data.message || '';
    // An already-spent allowance is a wall the student meets on arrival, not
    // only one they walk into by pressing a button.
    if (state.ready && state.cap && state.cap.ok === false) logCapHit();
  }

  /** Fold one server-returned contact back into the list, in place. */
  function upsertContact(c) {
    if (!c || !c.id) return;
    var i = state.contacts.findIndex(function (x) { return x.id === c.id; });
    if (i === -1) state.contacts.unshift(c);
    else state.contacts[i] = c;
  }

  function refetch() {
    return afetch('/outreach').then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      if (data) applyGetData(data);
      render();
    }).catch(function () { render(); });
  }

  function doAddSuggestion(archetype, btn) {
    if (!archetype) return;
    var ui = state.sugUi[archetype] || (state.sugUi[archetype] = {});
    if (ui.busy) return;
    ui.busy = true;
    ui.error = '';
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Adding…' }) : function () {};
    afetch('/outreach', 'POST', { action: 'add', archetype: archetype })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        restore();
        ui.busy = false;
        if (!data || !data.ok) {
          ui.error = (data && (data.error || data.message)) || 'Could not add that.';
          render();
          return;
        }
        // The server recomputes the suggestion list against what is now on the
        // list, so a refetch is the only way the card disappears correctly.
        refetch();
      })
      .catch(function () {
        restore();
        ui.busy = false;
        ui.error = 'Could not add that. Try again.';
        render();
      });
  }

  function doAddManual() {
    var nameEl = host.querySelector('.nw-add-name');
    var orgEl = host.querySelector('.nw-add-org');
    var labelEl = host.querySelector('.nw-add-label');
    var name = nameEl ? nameEl.value.trim() : '';
    var label = labelEl ? labelEl.value.trim() : '';
    if (!name && !label) {
      state.addError = 'Give them a name, or one line saying who they are.';
      render();
      return;
    }
    state.addError = '';
    afetch('/outreach', 'POST', {
      action: 'add', name: name, org: orgEl ? orgEl.value.trim() : '', label: label,
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          state.addError = (data && (data.error || data.message)) || 'Could not add that.';
          render();
          return;
        }
        state.addOpen = false;
        upsertContact(data.contact);
        // The list ceiling is the SERVER's number (contact-core's
        // MAX_CONTACTS_PER_USER) and is never recomputed here — §3 rule 11. A
        // refetch is also how the suggestion cards re-filter against the new row.
        refetch();
      })
      .catch(function () {
        state.addError = 'Could not add that. Try again.';
        render();
      });
  }

  function doDraft(id, btn) {
    var ui = rowUi(id);
    if (ui.busy) return;
    ui.busy = true;
    ui.error = '';
    ui.failure = null;
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Writing…' }) : function () {};
    afetch('/outreach', 'POST', { action: 'draft', id: id }, DRAFT_TIMEOUT_MS)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        restore();
        ui.busy = false;
        if (data && data.ok) {
          upsertContact(data.contact);
          if (state.cap) {
            var rem = data.remaining;
            state.cap = Object.assign({}, state.cap, { remaining: rem, ok: rem === null ? true : rem > 0 });
          }
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
        var reason = (data && data.reason) || 'error';
        ui.failure = {
          reason: reason,
          message: (data && (data.message || data.error)) || 'Could not write that draft just now.',
        };
        // A profile-state refusal is a whole-panel fact, not a per-row one:
        // every other row would fail identically, so say it once at the top.
        if (NO_RETRY_REASONS[reason]) {
          state.ready = false;
          state.reason = reason;
          state.message = ui.failure.message;
        }
        render();
      })
      .catch(function () {
        restore();
        ui.busy = false;
        ui.error = 'Could not write that draft just now. Try again.';
        render();
      });
  }

  function doStatus(id, status, selectEl) {
    var ui = rowUi(id);
    ui.error = '';
    afetch('/outreach', 'POST', { action: 'status', id: id, status: status })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          ui.error = (data && (data.error || data.message)) || 'Could not save that.';
          render();
          return;
        }
        upsertContact(data.contact);
        // The two client-side events of the three §5 S17 names. They are the
        // student's own report — FlightWay never sends anything, so there is no
        // server-side observation of either one to log instead. 'met' rides
        // `outreach_replied` with a status prop rather than a fourth name.
        try {
          if (global.FWEvents) {
            if (status === 'sent') {
              FWEvents.log('outreach_sent', { archetype: (data.contact && data.contact.archetype) || 'manual', from: data.from || '' });
            } else if (status === 'replied' || status === 'met') {
              FWEvents.log('outreach_replied', { status: status, archetype: (data.contact && data.contact.archetype) || 'manual' });
            }
          }
        } catch (_) { /* fire-and-forget */ }
        render();
      })
      .catch(function () {
        ui.error = 'Could not save that. Try again.';
        // Put the select back where the server still thinks it is, rather than
        // leaving the UI claiming a state that was never stored.
        if (selectEl) {
          var c = state.contacts.find(function (x) { return x.id === id; });
          if (c) selectEl.value = c.status;
        }
        render();
      });
  }

  function doName(id) {
    var c = state.contacts.find(function (x) { return x.id === id; });
    if (!c) return;
    // A one-field prompt, deliberately: the alternative is an inline edit form
    // per row on a panel that already has a draft, a status and two buttons in
    // every row, and the name is the only field that changes what the DRAFT says.
    var next = global.prompt('Their name (leave blank to clear it):', c.name || '');
    if (next === null) return;
    var ui = rowUi(id);
    ui.error = '';
    afetch('/outreach', 'POST', { action: 'update', id: id, name: String(next).slice(0, 60) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          ui.error = (data && (data.error || data.message)) || 'Could not save that.';
          render();
          return;
        }
        upsertContact(data.contact);
        render();
      })
      .catch(function () { ui.error = 'Could not save that. Try again.'; render(); });
  }

  function doRemove(id, btn) {
    // Second-click confirm, the applications-board idiom: a modal for one row is
    // heavier than the action, and an unconfirmed single click would delete a
    // drafted message.
    if (btn.getAttribute('data-nw-armed') !== '1') {
      btn.setAttribute('data-nw-armed', '1');
      btn.textContent = 'Really remove?';
      return;
    }
    afetch('/outreach', 'POST', { action: 'delete', id: id })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          rowUi(id).error = (data && (data.error || data.message)) || 'Could not remove that.';
          render();
          return;
        }
        state.contacts = state.contacts.filter(function (x) { return x.id !== id; });
        delete state.rowUi[id];
        // Removing a row frees its archetype, so the suggestion should come back
        // — and `full` is the server's number to revise, not ours.
        refetch();
      })
      .catch(function () { rowUi(id).error = 'Could not remove that. Try again.'; render(); });
  }

  function doCopy(id, btn) {
    var c = state.contacts.find(function (x) { return x.id === id; });
    if (!c || !c.draft || !c.draft.body) return;
    var text = (c.draft.subject ? 'Subject: ' + c.draft.subject + '\n\n' : '') + c.draft.body;
    var done = function () {
      rowUi(id).copied = true;
      render();
    };
    try {
      if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          rowUi(id).error = 'Could not copy — select the text and copy it manually.';
          render();
        });
        return;
      }
    } catch (_) { /* fall through */ }
    rowUi(id).error = 'Could not copy — select the text and copy it manually.';
    render();
    if (btn) btn.blur();
  }

  // ---- event delegation (wired once; render() only replaces innerHTML) -----

  function wireEvents() {
    if (!host || host._nwWired) return;
    host._nwWired = true;

    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;

      var addSug = t.closest('[data-nw-add-sug]');
      if (addSug) { doAddSuggestion(addSug.getAttribute('data-nw-add-sug'), addSug); return; }

      if (t.closest('[data-nw-add-open]')) { state.addOpen = true; state.addError = ''; render(); return; }
      if (t.closest('[data-nw-add-cancel]')) { state.addOpen = false; state.addError = ''; render(); return; }
      if (t.closest('[data-nw-add-go]')) { doAddManual(); return; }

      var draftBtn = t.closest('[data-nw-draft]');
      if (draftBtn) { doDraft(draftBtn.getAttribute('data-nw-draft'), draftBtn); return; }

      var copyBtn = t.closest('[data-nw-copy]');
      if (copyBtn) { doCopy(copyBtn.getAttribute('data-nw-copy'), copyBtn); return; }

      var nameBtn = t.closest('[data-nw-name]');
      if (nameBtn) { doName(nameBtn.getAttribute('data-nw-name')); return; }

      var rmBtn = t.closest('[data-nw-remove]');
      if (rmBtn) { doRemove(rmBtn.getAttribute('data-nw-remove'), rmBtn); return; }
    });

    host.addEventListener('change', function (ev) {
      var sel = ev.target;
      if (!sel || !sel.getAttribute) return;
      var id = sel.getAttribute('data-nw-status');
      if (!id) return;
      doStatus(id, sel.value, sel);
    });
  }

  // ---- mount --------------------------------------------------------------

  function mount() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no network module — no-op
    if (host.getAttribute('data-fp-network-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-fp-network-mounted', '1');
    wireEvents();
    render(); // "Loading your network list…"

    afetch('/outreach').then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (data) {
      state.loaded = true;
      if (!data) {
        state.ready = false;
        state.reason = 'error';
        state.message = 'Could not load your network list just now.';
        render();
        return;
      }
      applyGetData(data);
      render();
    }).catch(function () {
      state.loaded = true;
      state.ready = false;
      state.reason = 'error';
      state.message = 'Could not load your network list just now.';
      render();
    });
  }

  global.FWNetwork = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
