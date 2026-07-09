/**
 * FlightWay 2.0 — Pillar B1 "Weekly Flight Plan" portal card.
 *
 * The habit loop: this week's 3 concrete tasks (auto-selected from the current
 * roadmap waypoint). Checking one marks the underlying roadmap step done, which
 * feeds the receipts card. Injected after FWPortal.render() from portal.html's
 * boot — deliberately out of portal.js to stay off Jacob's file (mirrors
 * sim-portal-card.js). Top slot of #portal-actions.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

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

  function ring(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    var r = 15, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return '<svg class="fw-fp-ring" viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">'
      + '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="rgba(127,140,175,.25)" stroke-width="3"/>'
      + '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="var(--fw2-accent)" stroke-width="3"'
      + ' stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"'
      + ' transform="rotate(-90 18 18)"/></svg>';
  }

  function render(card, data) {
    if (data && data.empty) {
      card.innerHTML = '<div class="fw-fp-head"><h3>Your weekly Flight Plan</h3></div>'
        + '<p class="fw-fp-empty">Generate your roadmap and your 3 tasks for the week land here.</p>'
        + '<a class="fw-fp-cta" href="roadmap.html">Build my roadmap &rarr;</a>';
      return;
    }
    var tasks = (data && data.tasks) || [];
    var prog = (data && data.progress) || { done: 0, total: tasks.length };
    var rows = tasks.map(function (t) {
      return '<label class="fw-fp-task' + (t.done ? ' is-done' : '') + '">'
        + '<input type="checkbox" class="fw-fp-check" data-task-id="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + '>'
        + '<span class="fw-fp-box" aria-hidden="true"></span>'
        + '<span class="fw-fp-txt"><span class="fw-fp-label">' + esc(t.label) + '</span>'
        + (t.waypointTitle ? '<span class="fw-fp-src">' + esc(t.waypointTitle) + '</span>' : '')
        + '</span></label>';
    }).join('');
    card.innerHTML = '<div class="fw-fp-head">' + ring(prog.done, prog.total)
      + '<div><h3>This week’s Flight Plan</h3>'
      + '<p class="fw-fp-sub">' + prog.done + ' of ' + prog.total + ' done · finish these to move your coordinates</p></div></div>'
      + '<div class="fw-fp-tasks">' + rows + '</div>';

    card.querySelectorAll('.fw-fp-check').forEach(function (box) {
      box.addEventListener('change', function () {
        var id = box.getAttribute('data-task-id');
        var done = box.checked;
        var label = box.closest('.fw-fp-task');
        if (label) label.classList.toggle('is-done', done);
        try { if (global.FWEvents) FWEvents.log('flightplan_done', { id: id, done: done }); } catch (_) {}
        afetch('/weekly-plan', 'POST', { taskId: id, done: done })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.progress) refreshRing(card, res.progress);
            // B3 — completing the last step of a waypoint prompts logging an artifact.
            if (res && res.waypointDone && done && global.FWArtifacts && typeof FWArtifacts.logModal === 'function') {
              FWArtifacts.logModal(res.waypointId, res.waypointTitle);
            }
          })
          .catch(function () { /* optimistic UI already updated */ });
      });
    });
  }

  function refreshRing(card, prog) {
    var head = card.querySelector('.fw-fp-head');
    if (!head) return;
    var oldRing = head.querySelector('.fw-fp-ring');
    if (oldRing) oldRing.outerHTML = ring(prog.done, prog.total);
    var sub = card.querySelector('.fw-fp-sub');
    if (sub) sub.textContent = prog.done + ' of ' + prog.total + ' done · finish these to move your coordinates';
  }

  function inject() {
    var host = document.getElementById('portal-actions');
    if (!host || document.getElementById('portal-card-flightplan')) return;
    var card = document.createElement('div');
    card.id = 'portal-card-flightplan';
    card.className = 'fw-flightplan-card';
    card.innerHTML = '<div class="fw-fp-head"><h3>This week’s Flight Plan</h3></div><p class="fw-fp-empty">Loading…</p>';
    host.insertBefore(card, host.firstChild);
    afetch('/weekly-plan').then(function (r) { return r.json(); }).then(function (data) {
      render(card, data);
      try { if (global.FWEvents) FWEvents.log('flightplan_view', { n: (data && data.tasks || []).length }); } catch (_) {}
    }).catch(function () { card.remove(); });
  }

  global.FWFlightPlanCard = { inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
