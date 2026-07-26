/**
 * FlightWay 2.0 — Pillar B3 artifacts (portfolio evidence) UI + gap bridge.
 *
 * Portal "Your evidence" lists D1 artifacts. Completing a waypoint (Flight Plan)
 * or promoting a gap note opens a modal. Optional gap link stamps high-weight
 * evidence on the skill-gap tracker so the objective vector moves.
 *
 * RE-WIRED 2026-07-21. This file was orphaned (not retired) from the
 * 2026-07-10 streamlining until now: no page loaded it, so FWArtifacts was
 * undefined and both call sites — skill-gap-tracker.js (promoteFromNote) and
 * portal-flightplan.js (logModal) — took their guarded no-op branch while
 * three live consumers kept reading what it writes (functions/artifacts.js
 * GET/POST, the D1 `artifacts` table purged by account deletion, and
 * resume-builder.js, which loads that table as server-side resume evidence).
 * It is now loaded by portal.html, which reaches it two ways: injectCard()
 * from the boot block, and portal-flightplan.js:111 logModal() on waypoint
 * completion. Keep the tag on portal.html or the table goes empty again.
 *
 * NOT loaded by roadmap.html, deliberately. Its only consumer there is
 * skill-gap-tracker.js:1642 (promoteFromNote), and that button never renders:
 * all three .sgt-log-promote emitters sit in orphaned subtrees — 1329/1370 via
 * renderGapRows <- renderHomePanel (exported, zero callers) and 1422 via
 * gapLogsHtml <- renderGapExpandBody <- renderGapCollapsedRow (zero refs).
 * The live focus view renders renderGapMeterRow, which has no log UI at all.
 * Loading this file there would buy a request for an unreachable path; restore
 * the gap-log UI first, then add the tag back.
 *
 * The card mounts into #portal-fw2-stack, which renderActions() does not
 * touch — unlike #portal-actions, whose occupants must be re-mounted from
 * portal.js reinjectPortalActionExtras(). Same arrangement as FWFlightPlanCard.
 *
 * The modal is held to the feature-intro.js standard: role="dialog",
 * aria-modal, aria-labelledby, a focus trap that wraps both ways, Escape,
 * and focus restored to whatever opened it.
 *
 * S12 — two render modes off one `resolveHost()` (mirrors
 * portal-flightplan.js:170): #flightplan-evidence is the Evidence Locker
 * (full grid, fetched with `?attribution=1`); #portal-fw2-stack / #portal-actions
 * stay the compact mirror (unchanged rendering, no attribution fetch — Home must
 * not pay a roadmap read for a three-title card). The locker grid is built with
 * createElement/textContent only, never innerHTML with artifact data: titles,
 * notes and links are student-typed free text. The modal gained an optional
 * https-only link field and an edit mode (logModal({editId, ...})) that hides
 * the gap select — re-pointing evidence at a different skill is a delete-and-
 * re-add, never an edit, so the gap link itself is never editable here.
 */
(function (global) {
  'use strict';

  var TYPES = [['repo', 'Repo / code'], ['doc', 'Doc / memo'], ['analysis', 'Analysis'], ['design', 'Design'], ['other', 'Other']];
  var TYPE_LABEL = { repo: 'Repo', doc: 'Doc', analysis: 'Analysis', design: 'Design', other: 'Other' };

  var card = null, modal = null, artifacts = [];
  // Locker-only: the server's per-artifact vector attribution and the mode
  // this mount resolved to. Mirror mode never populates `attribution` — it
  // never asks for it (see `load`).
  var attribution = null;
  var mode = null;
  // evidence_viewed de-dupe, same convention as skill-gap-tracker.js's
  // lastGapViewSig: module scope because renderLocker() re-runs on every
  // edit/delete/create, and only the first render of this mount is a "view".
  var lockerViewedLogged = false;
  var lastFocused = null;
  var pending = { waypointId: null, gapId: null, dimIndex: null, notePrefill: '', replaceLogId: null, editId: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Server enforces this set; a legacy/unknown type falls back to 'other' rather than a raw string in the class name. */
  function typeClass(t) {
    return Object.prototype.hasOwnProperty.call(TYPE_LABEL, t) ? t : 'other';
  }
  function typeLabel(t) {
    return Object.prototype.hasOwnProperty.call(TYPE_LABEL, t) ? TYPE_LABEL[t] : (t || 'Other');
  }

  /** Mirrors evidence-locker.js's attributionPhrase() exactly — same wording, same never-invent-a-number rule. */
  function attributionPhrase(info) {
    if (!info || !info.linked) return '';
    var label = info.gapLabel || 'a tracked skill';
    if (Number.isFinite(info.delta) && info.delta > 0) return 'Moved ' + label + ' +' + info.delta;
    return 'Filed under ' + label;
  }

  /** The one line above the grid. Only ever built from the server's linkedCount/totalDelta. */
  function lockerSummaryText(attr) {
    var n = attr.linkedCount;
    var pieces = n === 1 ? '1 piece of evidence is' : n + ' pieces of evidence are';
    if (Number.isFinite(attr.totalDelta) && attr.totalDelta > 0) {
      return pieces + ' tied to a skill gap — together they moved your coordinates +' + attr.totalDelta + '.';
    }
    return pieces + ' tied to a skill gap.';
  }

  /** lucide.svg() already carries aria-hidden; a missing icon degrades to text. */
  function icon(name) {
    try {
      if (global.lucide && typeof global.lucide.svg === 'function') return global.lucide.svg(name);
    } catch (_) { /* fall through */ }
    return '';
  }

  function afetch(url, bodyObj) {
    var useAuth = global.FWAuth && typeof FWAuth.authFetch === 'function';
    if (useAuth) { var o = { method: bodyObj ? 'POST' : 'GET' }; if (bodyObj) o.body = bodyObj; return FWAuth.authFetch(url, o); }
    var f = { method: bodyObj ? 'POST' : 'GET', credentials: 'include' };
    if (bodyObj) { f.headers = { 'Content-Type': 'application/json' }; f.body = JSON.stringify(bodyObj); }
    return fetch(url, f);
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (_) { return ''; }
  }

  function focusGaps() {
    try {
      var tree = null;
      if (global.FWAuth && typeof FWAuth.readLocalRoadmap === 'function') tree = FWAuth.readLocalRoadmap();
      if (!tree && global.localStorage) {
        var raw = localStorage.getItem('fw_roadmap_v1');
        if (raw) tree = JSON.parse(raw);
      }
      var gaps = tree && tree.focusTracker && tree.focusTracker.skillGaps;
      return Array.isArray(gaps) ? gaps.filter(function (g) { return g && g.id; }) : [];
    } catch (_) { return []; }
  }

  function renderCard() {
    if (!card) return;
    var list = artifacts.length
      ? '<ul class="fw-art-list">' + artifacts.map(function (a) {
        return '<li class="fw-art-item"><span class="fw-art-type fw-art-type--' + esc(a.type) + '">' + esc(TYPE_LABEL[a.type] || a.type) + '</span>'
          + '<span class="fw-art-body"><span class="fw-art-title">' + esc(a.title) + '</span>'
          + (a.note ? '<span class="fw-art-note">' + esc(a.note) + '</span>' : '') + '</span>'
          + '<span class="fw-art-date">' + esc(fmtDate(a.createdAt)) + '</span></li>';
      }).join('') + '</ul>'
      : '<p class="fw-art-empty">Completed a waypoint? Log what you built — it becomes your portfolio and can close skill gaps.</p>';
    card.innerHTML = '<div class="fw-art-head"><h3>Your evidence</h3>'
      + '<button type="button" class="fw-art-add" id="fw-art-add">+ Add</button></div>' + list
      + '<a class="fw-art-seeall" href="flightplan.html#evidence">See all evidence &rarr;</a>';
    var add = card.querySelector('#fw-art-add');
    if (add) add.addEventListener('click', function () { logModal({}); });
  }

  function renderCurrent() {
    if (!card) return;
    if (mode === 'locker') renderLocker(); else renderCard();
  }

  /** Builds one locker card. createElement/textContent only — title, note and
   *  url are free text the student typed, and this must never touch innerHTML
   *  with any of it. A url is an <a> only when it is already https:// (the
   *  server already enforces this; re-checking here is what keeps the
   *  guarantee true even against a stale/legacy row). */
  function buildLockerCard(a) {
    var info = attribution && attribution.byId ? attribution.byId[a.id] : null;
    var el = document.createElement('div');
    el.className = 'fw-locker-card';

    var top = document.createElement('div');
    top.className = 'fw-locker-card-top';
    var chip = document.createElement('span');
    chip.className = 'fw-locker-chip fw-locker-chip--' + typeClass(a.type);
    chip.textContent = typeLabel(a.type);
    top.appendChild(chip);
    var date = document.createElement('span');
    date.className = 'fw-locker-date';
    date.textContent = fmtDate(a.createdAt);
    top.appendChild(date);
    el.appendChild(top);

    var title = document.createElement('h4');
    title.className = 'fw-locker-title';
    title.textContent = a.title;
    el.appendChild(title);

    if (a.note) {
      var note = document.createElement('p');
      note.className = 'fw-locker-note';
      note.textContent = a.note;
      el.appendChild(note);
    }

    if (a.url && /^https:\/\//i.test(a.url)) {
      var link = document.createElement('a');
      link.className = 'fw-locker-link';
      link.href = a.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = a.url;
      el.appendChild(link);
    }

    var phrase = attributionPhrase(info);
    if (phrase) {
      var attr = document.createElement('p');
      attr.className = 'fw-locker-attribution';
      attr.textContent = phrase;
      el.appendChild(attr);
    }

    var actions = document.createElement('div');
    actions.className = 'fw-locker-actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'fw-locker-edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', function () {
      logModal({ editId: a.id, type: a.type, title: a.title, note: a.note, url: a.url });
    });
    actions.appendChild(editBtn);
    actions.appendChild(buildRemoveButton(a.id));
    el.appendChild(actions);
    return el;
  }

  /** Second click, not window.confirm. Reverts to "Remove" on its own after a
   *  few seconds so a card left mid-confirm doesn't fire on a much later click. */
  function buildRemoveButton(id) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fw-locker-remove';
    btn.textContent = 'Remove';
    var confirming = false;
    var revertTimer = null;
    btn.addEventListener('click', function () {
      if (!confirming) {
        confirming = true;
        btn.textContent = 'Remove?';
        btn.classList.add('is-confirm');
        revertTimer = setTimeout(function () {
          confirming = false;
          btn.textContent = 'Remove';
          btn.classList.remove('is-confirm');
        }, 4000);
        return;
      }
      clearTimeout(revertTimer);
      doDelete(id, btn);
    });
    return btn;
  }

  /** One inline line under the card's actions. A failed delete that restores
   *  the button and says nothing is indistinguishable from a dead button — the
   *  exact failure S9 called out on the radar's Refresh. */
  function showCardError(btn, message) {
    var host = btn && btn.closest ? btn.closest('.fw-locker-card') : null;
    if (!host) return;
    var line = host.querySelector('.fw-locker-err');
    if (!line) {
      line = document.createElement('p');
      line.className = 'fw-locker-err';
      line.setAttribute('role', 'alert');
      host.appendChild(line);
    }
    line.textContent = message;
  }

  function doDelete(id, btn) {
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Removing…' }) : function () {};
    afetch('/artifacts', { action: 'delete', id: id })
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
      })
      .then(function (res) {
        restore();
        if (!res.ok || !res.d.ok) {
          showCardError(btn, global.FWErr
            ? FWErr.forUser(FWErr.fromResponse(res.status, res.d, 'Could not remove that — try again.'), 'Could not remove that — try again.')
            : 'Could not remove that — try again.');
          return;
        }
        mergeStampIntoLocal(res.d);
        try { if (global.FWEvents) FWEvents.log('evidence_deleted', {}); } catch (_) {}
        // Deleting un-credits a gap and can move attribution.totalDelta, so the
        // locker re-fetches with attribution rather than patching the old
        // numbers locally — patching would risk showing a stale total.
        load('locker');
      })
      .catch(function () { restore(); showCardError(btn, 'Could not remove that — check your connection.'); });
  }

  function renderLocker() {
    if (!card) return;
    while (card.firstChild) card.removeChild(card.firstChild);

    var head = document.createElement('div');
    head.className = 'fw-locker-head';
    if (attribution && attribution.linkedCount > 0) {
      var summary = document.createElement('p');
      summary.className = 'fw-locker-summary';
      summary.textContent = lockerSummaryText(attribution);
      head.appendChild(summary);
    }
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'fw-locker-add';
    addBtn.id = 'fw-locker-add';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', function () { logModal({}); });
    head.appendChild(addBtn);
    card.appendChild(head);

    if (!artifacts.length) {
      var empty = document.createElement('div');
      empty.className = 'fw-locker-empty';
      var p1 = document.createElement('p');
      p1.textContent = 'Your evidence locker is empty. A logged artifact — a repo, a memo, a working analysis — is proof you can point a recruiter at directly, not just a line on a resume.';
      var p2 = document.createElement('p');
      p2.textContent = 'Tag one to a skill gap and it does more than sit there: it measurably moves your career coordinates.';
      empty.appendChild(p1);
      empty.appendChild(p2);
      card.appendChild(empty);
    } else {
      var grid = document.createElement('div');
      grid.className = 'fw-locker-grid';
      artifacts.forEach(function (a) { grid.appendChild(buildLockerCard(a)); });
      card.appendChild(grid);
    }

    if (!lockerViewedLogged) {
      lockerViewedLogged = true;
      try {
        if (global.FWEvents) {
          FWEvents.log('evidence_viewed', { count: artifacts.length, linked: (attribution && attribution.linkedCount) || 0 });
        }
      } catch (_) {}
    }
  }

  /** Host resolution decides the surface, same pattern as
   *  portal-flightplan.js:169 resolveHost(). flightplan.html's static
   *  #evidence section offers the Locker slot; portal keeps its stack slot
   *  (with #portal-actions as the legacy fallback for an older page). */
  function resolveHost() {
    var locker = document.getElementById('flightplan-evidence');
    if (locker) return { host: locker, mode: 'locker' };
    var mirror = document.getElementById('portal-fw2-stack') || document.getElementById('portal-actions');
    return mirror ? { host: mirror, mode: 'mirror' } : null;
  }

  function load(m) {
    if (m) mode = m;
    var url = mode === 'locker' ? '/artifacts?attribution=1' : '/artifacts';
    afetch(url).then(function (r) { return r.json(); }).then(function (d) {
      artifacts = (d && d.artifacts) || [];
      attribution = mode === 'locker' ? ((d && d.attribution) || { byId: {}, totalDelta: 0, linkedCount: 0 }) : null;
      renderCurrent();
    }).catch(function () { renderCurrent(); });
  }

  function injectCard() {
    var slot = resolveHost();
    if (!slot || document.getElementById('portal-card-evidence')) return;
    mode = slot.mode;
    card = document.createElement('div');
    card.id = 'portal-card-evidence';
    if (mode === 'locker') {
      card.className = 'fw-locker';
      var loading = document.createElement('p');
      loading.className = 'fw-locker-empty';
      loading.textContent = 'Loading…';
      card.appendChild(loading);
    } else {
      card.className = 'fw-receipts-card';
      card.innerHTML = '<div class="fw-art-head"><h3>Your evidence</h3></div><p class="fw-art-empty">Loading…</p>';
    }
    slot.host.appendChild(card);
    load(mode);
  }

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'fw-iv-overlay';
    modal.id = 'fw-art-overlay';
    modal.hidden = true;
    modal.innerHTML = ''
      + '<div class="fw-iv-modal" role="dialog" aria-modal="true" aria-labelledby="fw-art-title">'
      + '<button type="button" class="fw-iv-close" id="fw-art-close" aria-label="Close">'
      + (icon('x') || '<span aria-hidden="true">&times;</span>') + '</button>'
      + '<h3 id="fw-art-title">Log your artifact</h3>'
      + '<p class="fw-iv-sub" id="fw-art-sub">Something showable you built — a repo, memo, 1-pager, or sim review.</p>'
      + '<div class="fw-art-form">'
      + '<div class="fw-art-types" id="fw-art-types" role="group" aria-label="Artifact type">' + TYPES.map(function (t, i) {
        return '<button type="button" class="fw-art-type-btn' + (i === 0 ? ' is-on' : '') + '" data-type="' + t[0] + '"'
          + ' aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + esc(t[1]) + '</button>';
      }).join('') + '</div>'
      + '<input type="text" id="fw-art-title-in" class="fw-iv-input" maxlength="120" placeholder="Title, e.g. Fraud-detection notebook" style="width:100%;margin:10px 0">'
      + '<textarea id="fw-art-note" class="fw-iv-answer" rows="3" maxlength="200" placeholder="One line on what it shows (optional)"></textarea>'
      + '<input type="url" id="fw-art-url" class="fw-iv-input" maxlength="400" placeholder="Link (optional) — https://…" style="width:100%;margin:0 0 10px">'
      + '<label class="fw-art-gap-label" id="fw-art-gap-wrap" hidden>Which skill did this build?'
      + '<select id="fw-art-gap" class="fw-iv-input" style="width:100%;margin-top:6px"><option value="">Skip — portfolio only</option></select>'
      + '</label>'
      + '<button type="button" id="fw-art-save" class="fw-iv-btn fw-iv-btn--primary">Save to my evidence</button>'
      + '<p id="fw-art-error" class="fw-iv-error" role="alert" hidden></p>'
      + '</div></div>';
    document.body.appendChild(modal);

    var chosen = 'repo';
    modal.getChosen = function () { return chosen; };
    modal.setChosen = function (t) {
      chosen = t || 'repo';
      modal.querySelectorAll('.fw-art-type-btn').forEach(function (x) {
        var on = x.getAttribute('data-type') === chosen;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    modal.querySelectorAll('.fw-art-type-btn').forEach(function (b) {
      b.addEventListener('click', function () { modal.setChosen(b.getAttribute('data-type')); });
    });
    modal.querySelector('#fw-art-close').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#fw-art-save').addEventListener('click', save);
  }

  /** Tabbable, in DOM order, skipping the gap select while its label is hidden. */
  function focusables() {
    var out = [];
    if (!modal) return out;
    modal.querySelectorAll('button, input, select, textarea, [href]').forEach(function (n) {
      if (n.disabled || n.hidden) return;
      if (n.offsetParent === null && !n.getClientRects().length) return;
      out.push(n);
    });
    return out;
  }

  // Capture phase, same as feature-intro.js: Escape must close this modal
  // before a page-level Escape handler acts on the surface behind it.
  function onKey(e) {
    if (!modal || modal.hidden) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    var nodes = focusables();
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function fillGapSelect(preselectId) {
    var wrap = modal.querySelector('#fw-art-gap-wrap');
    var sel = modal.querySelector('#fw-art-gap');
    var gaps = focusGaps();
    if (!gaps.length) {
      wrap.hidden = true;
      sel.innerHTML = '<option value="">Skip — portfolio only</option>';
      return;
    }
    wrap.hidden = false;
    sel.innerHTML = '<option value="">Skip — portfolio only</option>' + gaps.map(function (g) {
      var label = g.label || ('Dimension ' + g.dimIndex);
      return '<option value="' + esc(g.id) + '" data-dim="' + (g.dimIndex != null ? g.dimIndex : '') + '">' + esc(label) + '</option>';
    }).join('');
    if (preselectId) sel.value = preselectId;
  }

  /**
   * @param {object} opts
   * @param {string} [opts.waypointId]
   * @param {string} [opts.waypointTitle]
   * @param {string} [opts.gapId]
   * @param {number} [opts.dimIndex]
   * @param {string} [opts.title]
   * @param {string} [opts.note]
   * @param {string} [opts.url]
   * @param {string} [opts.type]
   * @param {string} [opts.editId] S12 — edit mode: Save issues an update for
   *   this artifact id instead of a create, and the gap select hides (the gap
   *   link is not editable — re-pointing evidence at a different skill is a
   *   delete-and-re-add).
   */
  function logModal(opts) {
    opts = opts || {};
    // Back-compat: logModal(waypointId, waypointTitle)
    if (typeof opts === 'string') {
      opts = { waypointId: opts, waypointTitle: arguments[1] || '' };
    }
    if (!modal) buildModal();
    pending = {
      waypointId: opts.waypointId || null,
      gapId: opts.gapId || null,
      dimIndex: opts.dimIndex != null ? opts.dimIndex : null,
      notePrefill: opts.note || '',
      replaceLogId: opts.replaceLogId || null,
      editId: opts.editId || null,
    };
    var titleEl = modal.querySelector('#fw-art-title');
    var sub = modal.querySelector('#fw-art-sub');
    var saveBtn = modal.querySelector('#fw-art-save');
    if (pending.editId) {
      if (titleEl) titleEl.textContent = 'Edit your evidence';
      if (saveBtn) saveBtn.textContent = 'Save changes';
      if (sub) sub.textContent = 'Update the title, note or link. To point this evidence at a different skill, delete it and log a new one.';
    } else {
      if (titleEl) titleEl.textContent = 'Log your artifact';
      if (saveBtn) saveBtn.textContent = 'Save to my evidence';
      if (sub) {
        if (opts.waypointTitle) {
          sub.textContent = 'You just finished “' + opts.waypointTitle + '”. Log what you built — it becomes your portfolio.';
        } else if (opts.gapId) {
          sub.textContent = 'Promote this note into showable evidence — it stays on your portfolio and closes the skill gap.';
        } else {
          sub.textContent = 'Something showable you built — a repo, memo, 1-pager, or sim review.';
        }
      }
    }
    modal.querySelector('#fw-art-title-in').value = opts.title || '';
    modal.querySelector('#fw-art-note').value = opts.note || '';
    modal.querySelector('#fw-art-url').value = opts.url || '';
    modal.setChosen(opts.type || 'repo');
    fillGapSelect(opts.gapId || null);
    var gapWrap = modal.querySelector('#fw-art-gap-wrap');
    if (pending.editId && gapWrap) gapWrap.hidden = true;
    modal.querySelector('#fw-art-error').hidden = true;
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.addEventListener('keydown', onKey, true);
    setTimeout(function () { modal.querySelector('#fw-art-title-in').focus(); }, 60);
    try { if (global.FWEvents) FWEvents.log('artifact_modal', { waypoint: !!opts.waypointId, gap: !!opts.gapId }); } catch (_) {}
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.removeEventListener('keydown', onKey, true);
    // Back to whatever opened it — the waypoint checkbox, the promote button
    // or the card's + Add — so a keyboard user is not dropped at the top.
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (_) { /* node may be gone */ }
    }
    lastFocused = null;
  }

  function save() {
    var title = (modal.querySelector('#fw-art-title-in').value || '').trim();
    var note = (modal.querySelector('#fw-art-note').value || '').trim();
    var urlIn = modal.querySelector('#fw-art-url');
    var url = urlIn ? (urlIn.value || '').trim() : '';
    var type = modal.getChosen();
    var err = modal.querySelector('#fw-art-error');
    if (title.length < 2) { err.textContent = 'Give your artifact a title.'; err.hidden = false; return; }
    if (url && !/^https:\/\//i.test(url)) { err.textContent = 'Links must start with https://.'; err.hidden = false; return; }

    var btn = modal.querySelector('#fw-art-save');
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Saving…' }) : function () {};

    // S12 edit mode: the gap link is never part of this body — re-pointing
    // evidence at a different skill is a delete-and-re-add, not an edit.
    if (pending.editId) {
      afetch('/artifacts', { action: 'update', id: pending.editId, type: type, title: title, note: note, url: url })
        .then(function (r) {
          return r.json().catch(function () { return {}; })
            .then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
        })
        .then(function (res) {
          restore();
          if (!res.ok || !res.d.ok) {
            err.textContent = global.FWErr
              ? FWErr.forUser(FWErr.fromResponse(res.status, res.d, 'Could not update your evidence.'), 'Could not update your evidence.')
              : 'Could not update your evidence.';
            err.hidden = false;
            return;
          }
          if (mode === 'locker') {
            load('locker');
          } else if (res.d.artifacts) {
            artifacts = res.d.artifacts;
            if (card) renderCard();
          }
          try { if (global.FWEvents) FWEvents.log('evidence_edited', { type: type }); } catch (_) {}
          close();
        })
        .catch(function () { restore(); err.textContent = 'Could not update — try again.'; err.hidden = false; });
      return;
    }

    var gapId = pending.gapId;
    var dimIndex = pending.dimIndex;
    var sel = modal.querySelector('#fw-art-gap');
    if (sel && sel.value) {
      gapId = sel.value;
      var opt = sel.options[sel.selectedIndex];
      var d = opt && opt.getAttribute('data-dim');
      dimIndex = d !== '' && d != null ? Number(d) : dimIndex;
    }

    var body = { type: type, title: title, note: note, url: url, waypointId: pending.waypointId };
    if (gapId) body.gapId = gapId;
    if (dimIndex != null && Number.isFinite(dimIndex)) body.dimIndex = dimIndex;
    if (pending.replaceLogId) body.replaceLogId = pending.replaceLogId;

    afetch('/artifacts', body)
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
      })
      .then(function (res) {
        restore();
        if (!res.ok || !res.d.artifact) {
          // Through FWErr: the server's 400s are product copy and survive, a
          // 5xx collapses to one friendly line rather than leaking our detail.
          err.textContent = global.FWErr
            ? FWErr.forUser(FWErr.fromResponse(res.status, res.d, 'Could not save your evidence.'), 'Could not save your evidence.')
            : 'Could not save your evidence.';
          err.hidden = false;
          return;
        }
        if (mode === 'locker') {
          // A new artifact can carry a gap stamp that shifts totalDelta, so the
          // locker re-fetches with attribution instead of unshifting locally.
          mergeStampIntoLocal(res.d);
          load('locker');
        } else {
          artifacts.unshift(res.d.artifact);
          if (card) renderCard();
          mergeStampIntoLocal(res.d);
        }
        try { if (global.FWEvents) FWEvents.log('artifact_saved', { type: type, gap: !!(res.d.gapStamp && res.d.gapStamp.stamped) }); } catch (_) {}
        if (res.d.gapStamp && res.d.gapStamp.stamped && global.FWFwToast && typeof FWFwToast.show === 'function') {
          FWFwToast.show('Evidence saved — skill gap updated');
        }
        close();
      })
      .catch(function () { restore(); err.textContent = 'Could not save — try again.'; err.hidden = false; });
  }

  function mergeStampIntoLocal(d) {
    if (!d || !global.FWAuth) return;
    if (d.roadmap && typeof FWAuth.cacheRoadmap === 'function') {
      FWAuth.cacheRoadmap(d.roadmap);
    }
    if ((d.objectiveVector || d.objectiveAiPatch) && typeof FWAuth.readLocalQuiz === 'function' && typeof FWAuth.writeLocalQuiz === 'function') {
      var quiz = FWAuth.readLocalQuiz();
      if (quiz) {
        if (d.objectiveVector) quiz.objectiveVector = d.objectiveVector;
        if (d.objectiveAiPatch) quiz.objectiveAiPatch = d.objectiveAiPatch;
        quiz.objectiveSkipped = false;
        FWAuth.writeLocalQuiz(quiz);
      }
    }
  }

  /** Open modal prefilled from a typed gap note (promote-to-artifact). */
  function promoteFromNote(gapId, text, dimIndex, replaceLogId) {
    logModal({
      gapId: gapId,
      dimIndex: dimIndex,
      title: String(text || '').trim().slice(0, 80),
      note: String(text || '').trim().slice(0, 200),
      type: 'other',
      replaceLogId: replaceLogId || null,
    });
  }

  global.FWArtifacts = {
    injectCard: injectCard,
    logModal: logModal,
    promoteFromNote: promoteFromNote,
    list: function () { return artifacts.slice(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
