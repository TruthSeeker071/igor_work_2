/**
 * FlightWay 2.0 — Pillar B3 artifacts (portfolio evidence) UI + gap bridge.
 *
 * Portal "Your evidence" lists D1 artifacts. Completing a waypoint (Flight Plan)
 * or promoting a gap note opens a modal. Optional gap link stamps high-weight
 * evidence on the skill-gap tracker so the objective vector moves.
 */
(function (global) {
  'use strict';

  var TYPES = [['repo', 'Repo / code'], ['doc', 'Doc / memo'], ['analysis', 'Analysis'], ['design', 'Design'], ['other', 'Other']];
  var TYPE_LABEL = { repo: 'Repo', doc: 'Doc', analysis: 'Analysis', design: 'Design', other: 'Other' };

  var card = null, modal = null, artifacts = [];
  var pending = { waypointId: null, gapId: null, dimIndex: null, notePrefill: '', replaceLogId: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      + '<button type="button" class="fw-art-add" id="fw-art-add">+ Add</button></div>' + list;
    var add = card.querySelector('#fw-art-add');
    if (add) add.addEventListener('click', function () { logModal({}); });
  }

  function load() {
    afetch('/artifacts').then(function (r) { return r.json(); }).then(function (d) {
      artifacts = (d && d.artifacts) || [];
      renderCard();
    }).catch(function () { renderCard(); });
  }

  function injectCard() {
    var host = document.getElementById('portal-fw2-stack') || document.getElementById('portal-actions');
    if (!host || document.getElementById('portal-card-evidence')) return;
    card = document.createElement('div');
    card.id = 'portal-card-evidence';
    card.className = 'fw-receipts-card';
    card.innerHTML = '<div class="fw-art-head"><h3>Your evidence</h3></div><p class="fw-art-empty">Loading…</p>';
    host.appendChild(card);
    load();
  }

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'fw-iv-overlay';
    modal.id = 'fw-art-overlay';
    modal.hidden = true;
    modal.innerHTML = ''
      + '<div class="fw-iv-modal" role="dialog" aria-modal="true" aria-labelledby="fw-art-title">'
      + '<button type="button" class="fw-iv-close" id="fw-art-close" aria-label="Close">&times;</button>'
      + '<h3 id="fw-art-title">Log your artifact</h3>'
      + '<p class="fw-iv-sub" id="fw-art-sub">Something showable you built — a repo, memo, 1-pager, or sim review.</p>'
      + '<div class="fw-art-form">'
      + '<div class="fw-art-types" id="fw-art-types">' + TYPES.map(function (t, i) {
        return '<button type="button" class="fw-art-type-btn' + (i === 0 ? ' is-on' : '') + '" data-type="' + t[0] + '">' + esc(t[1]) + '</button>';
      }).join('') + '</div>'
      + '<input type="text" id="fw-art-title-in" class="fw-iv-input" maxlength="120" placeholder="Title, e.g. Fraud-detection notebook" style="width:100%;margin:10px 0">'
      + '<textarea id="fw-art-note" class="fw-iv-answer" rows="3" maxlength="200" placeholder="One line on what it shows (optional)"></textarea>'
      + '<label class="fw-art-gap-label" id="fw-art-gap-wrap" hidden>Which skill did this build?'
      + '<select id="fw-art-gap" class="fw-iv-input" style="width:100%;margin-top:6px"><option value="">Skip — portfolio only</option></select>'
      + '</label>'
      + '<button type="button" id="fw-art-save" class="fw-iv-btn fw-iv-btn--primary">Save to my evidence</button>'
      + '<p id="fw-art-error" class="fw-iv-error" hidden></p>'
      + '</div></div>';
    document.body.appendChild(modal);

    var chosen = 'repo';
    modal.querySelectorAll('.fw-art-type-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        chosen = b.getAttribute('data-type');
        modal.querySelectorAll('.fw-art-type-btn').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      });
    });
    modal.getChosen = function () { return chosen; };
    modal.setChosen = function (t) {
      chosen = t || 'repo';
      modal.querySelectorAll('.fw-art-type-btn').forEach(function (x) {
        x.classList.toggle('is-on', x.getAttribute('data-type') === chosen);
      });
    };
    modal.querySelector('#fw-art-close').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#fw-art-save').addEventListener('click', save);
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
   * @param {string} [opts.type]
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
    };
    var sub = modal.querySelector('#fw-art-sub');
    if (sub) {
      if (opts.waypointTitle) {
        sub.textContent = 'You just finished “' + opts.waypointTitle + '”. Log what you built — it becomes your portfolio.';
      } else if (opts.gapId) {
        sub.textContent = 'Promote this note into showable evidence — it stays on your portfolio and closes the skill gap.';
      } else {
        sub.textContent = 'Something showable you built — a repo, memo, 1-pager, or sim review.';
      }
    }
    modal.querySelector('#fw-art-title-in').value = opts.title || '';
    modal.querySelector('#fw-art-note').value = opts.note || '';
    modal.setChosen(opts.type || 'repo');
    fillGapSelect(opts.gapId || null);
    modal.querySelector('#fw-art-error').hidden = true;
    modal.hidden = false;
    setTimeout(function () { modal.querySelector('#fw-art-title-in').focus(); }, 60);
    try { if (global.FWEvents) FWEvents.log('artifact_modal', { waypoint: !!opts.waypointId, gap: !!opts.gapId }); } catch (_) {}
  }

  function close() { if (modal) modal.hidden = true; }

  function save() {
    var title = (modal.querySelector('#fw-art-title-in').value || '').trim();
    var note = (modal.querySelector('#fw-art-note').value || '').trim();
    var type = modal.getChosen();
    var err = modal.querySelector('#fw-art-error');
    if (title.length < 2) { err.textContent = 'Give your artifact a title.'; err.hidden = false; return; }

    var gapId = pending.gapId;
    var dimIndex = pending.dimIndex;
    var sel = modal.querySelector('#fw-art-gap');
    if (sel && sel.value) {
      gapId = sel.value;
      var opt = sel.options[sel.selectedIndex];
      var d = opt && opt.getAttribute('data-dim');
      dimIndex = d !== '' && d != null ? Number(d) : dimIndex;
    }

    var body = { type: type, title: title, note: note, waypointId: pending.waypointId };
    if (gapId) body.gapId = gapId;
    if (dimIndex != null && Number.isFinite(dimIndex)) body.dimIndex = dimIndex;
    if (pending.replaceLogId) body.replaceLogId = pending.replaceLogId;

    var btn = modal.querySelector('#fw-art-save');
    var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Saving…' }) : function () {};
    afetch('/artifacts', body)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        restore();
        if (!res.ok || !res.d.artifact) { err.textContent = (res.d && res.d.error) || 'Could not save.'; err.hidden = false; return; }
        artifacts.unshift(res.d.artifact);
        if (card) renderCard();
        mergeStampIntoLocal(res.d);
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
