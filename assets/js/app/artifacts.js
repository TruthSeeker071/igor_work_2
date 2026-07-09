/**
 * FlightWay 2.0 — Pillar B3 artifacts (portfolio evidence) UI.
 *
 * An "Evidence" card on the portal lists what the student has built; completing a
 * waypoint (from the Flight Plan card) opens a modal to log an artifact. Turns the
 * roadmap from a checklist into a portfolio — our answer to Forage certificates.
 * Self-mounts like the other portal cards; no portal.js edits.
 */
(function (global) {
  'use strict';

  var TYPES = [['repo', 'Repo / code'], ['doc', 'Doc / memo'], ['analysis', 'Analysis'], ['design', 'Design'], ['other', 'Other']];
  var TYPE_LABEL = { repo: 'Repo', doc: 'Doc', analysis: 'Analysis', design: 'Design', other: 'Other' };

  var card = null, modal = null, artifacts = [], pendingWaypoint = null;

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

  function renderCard() {
    if (!card) return;
    var list = artifacts.length
      ? '<ul class="fw-art-list">' + artifacts.map(function (a) {
        return '<li class="fw-art-item"><span class="fw-art-type fw-art-type--' + esc(a.type) + '">' + esc(TYPE_LABEL[a.type] || a.type) + '</span>'
          + '<span class="fw-art-body"><span class="fw-art-title">' + esc(a.title) + '</span>'
          + (a.note ? '<span class="fw-art-note">' + esc(a.note) + '</span>' : '') + '</span>'
          + '<span class="fw-art-date">' + esc(fmtDate(a.createdAt)) + '</span></li>';
      }).join('') + '</ul>'
      : '<p class="fw-art-empty">Completed a waypoint? Log what you built — it becomes your portfolio.</p>';
    card.innerHTML = '<div class="fw-art-head"><h3>Your evidence</h3>'
      + '<button type="button" class="fw-art-add" id="fw-art-add">+ Add</button></div>' + list;
    var add = card.querySelector('#fw-art-add');
    if (add) add.addEventListener('click', function () { logModal(null, ''); });
  }

  function load() {
    afetch('/artifacts').then(function (r) { return r.json(); }).then(function (d) {
      artifacts = (d && d.artifacts) || [];
      renderCard();
    }).catch(function () { renderCard(); });
  }

  function injectCard() {
    var host = document.getElementById('portal-actions');
    if (!host || document.getElementById('portal-card-evidence')) return;
    card = document.createElement('div');
    card.id = 'portal-card-evidence';
    card.className = 'fw-receipts-card';
    card.innerHTML = '<div class="fw-art-head"><h3>Your evidence</h3></div><p class="fw-art-empty">Loading…</p>';
    host.parentNode.appendChild(card);
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
    modal.querySelector('#fw-art-close').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#fw-art-save').addEventListener('click', save);
  }

  function logModal(waypointId, waypointTitle) {
    if (!modal) buildModal();
    pendingWaypoint = waypointId || null;
    var sub = modal.querySelector('#fw-art-sub');
    if (sub) sub.textContent = waypointTitle
      ? 'You just finished “' + waypointTitle + '”. Log what you built — it becomes your portfolio.'
      : 'Something showable you built — a repo, memo, 1-pager, or sim review.';
    modal.querySelector('#fw-art-title-in').value = '';
    modal.querySelector('#fw-art-note').value = '';
    modal.hidden = false;
    setTimeout(function () { modal.querySelector('#fw-art-title-in').focus(); }, 60);
    try { if (global.FWEvents) FWEvents.log('artifact_modal', { waypoint: !!waypointId }); } catch (_) {}
  }

  function close() { if (modal) modal.hidden = true; }

  function save() {
    var title = (modal.querySelector('#fw-art-title-in').value || '').trim();
    var note = (modal.querySelector('#fw-art-note').value || '').trim();
    var type = modal.getChosen();
    var err = modal.querySelector('#fw-art-error');
    if (title.length < 2) { err.textContent = 'Give your artifact a title.'; err.hidden = false; return; }
    var btn = modal.querySelector('#fw-art-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    afetch('/artifacts', { type: type, title: title, note: note, waypointId: pendingWaypoint })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.disabled = false; btn.textContent = 'Save to my evidence';
        if (!res.ok || !res.d.artifact) { err.textContent = (res.d && res.d.error) || 'Could not save.'; err.hidden = false; return; }
        artifacts.unshift(res.d.artifact);
        if (card) renderCard();
        try { if (global.FWEvents) FWEvents.log('artifact_saved', { type: type }); } catch (_) {}
        close();
      })
      .catch(function () { btn.disabled = false; btn.textContent = 'Save to my evidence'; err.textContent = 'Could not save — try again.'; err.hidden = false; });
  }

  global.FWArtifacts = { injectCard: injectCard, logModal: logModal };
})(typeof window !== 'undefined' ? window : globalThis);
