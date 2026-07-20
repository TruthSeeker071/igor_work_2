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

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "Week of {Mon DD}" — Monday of the current week, computed client-side.
  function weekOfLabel() {
    var d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return 'Week of ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function ring(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    var r = 15, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return '<svg class="fw-fp-ring" viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">'
      + '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="rgb(var(--border))" stroke-width="3"/>'
      + '<circle cx="18" cy="18" r="' + r + '" fill="none" stroke="rgb(var(--primary))" stroke-width="3"'
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
      // Checkbox stays inside its own label; the task text is a link to the
      // roadmap focus view so clicking it doesn't toggle the checkbox.
      return '<div class="fw-fp-task' + (t.done ? ' is-done' : '') + '">'
        + '<label class="fw-fp-checkwrap">'
        + '<input type="checkbox" class="fw-fp-check" data-task-id="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + '>'
        + '<span class="fw-fp-box" aria-hidden="true"></span>'
        + '</label>'
        + '<a class="fw-fp-txt" href="roadmap.html?focus=1"><span class="fw-fp-label">' + esc(t.label)
        + (t.weeks ? ' <span class="fw-fp-weeks">' + esc(t.weeks) + '</span>' : '')
        + (t.carried ? ' <span class="fw-fp-weeks">carried over</span>' : '') + '</span>'
        + (t.waypointTitle ? '<span class="fw-fp-src">' + esc(t.waypointTitle) + '</span>' : '')
        + '</a></div>';
    }).join('');
    card.innerHTML = '<div class="fw-fp-head">' + ring(prog.done, prog.total)
      + '<div class="fw-fp-head-txt"><h3>This week’s flight plan</h3>'
      + '<p class="fw-fp-week">' + esc(weekOfLabel()) + '</p></div>'
      + '<span class="fw-fp-chip">' + prog.done + ' of ' + prog.total + ' done</span></div>'
      + '<div class="fw-fp-tasks">' + rows + '</div>'
      // Minimal provenance note (fix plan 2.5): tasks may reference live
      // deadlines, so show when they were checked.
      + (data && data.grounding && data.grounding.fetchedAt
        ? '<p class="fw-fp-asof">Opportunities checked as of ' + esc(String(data.grounding.fetchedAt).slice(0, 10)) + '</p>'
        : '')
      + '<div class="fw-fp-foot" id="flightplan-notify-slot"></div>';
    // The weekly-email toggle renders into the footer slot (notify-optin.js).
    if (global.FWNotifyOptin && typeof FWNotifyOptin.inject === 'function') FWNotifyOptin.inject();

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
            if (res && res.roadmap && global.FWAuth && typeof FWAuth.cacheRoadmap === 'function') {
              FWAuth.cacheRoadmap(res.roadmap);
            }
            if (res && (res.objectiveVector || res.objectiveAiPatch)
              && global.FWAuth && typeof FWAuth.readLocalQuiz === 'function'
              && typeof FWAuth.writeLocalQuiz === 'function') {
              var quiz = FWAuth.readLocalQuiz();
              if (quiz) {
                if (res.objectiveVector) quiz.objectiveVector = res.objectiveVector;
                if (res.objectiveAiPatch) quiz.objectiveAiPatch = res.objectiveAiPatch;
                quiz.objectiveSkipped = false;
                FWAuth.writeLocalQuiz(quiz);
              }
            }
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
    var chip = card.querySelector('.fw-fp-chip');
    if (chip) chip.textContent = prog.done + ' of ' + prog.total + ' done';
  }

  function inject() {
    var host = document.getElementById('portal-fw2-stack') || document.getElementById('portal-actions');
    if (!host || document.getElementById('portal-card-flightplan')) return;
    var card = document.createElement('div');
    card.id = 'portal-card-flightplan';
    card.className = 'fw-flightplan-card';
    card.innerHTML = '<div class="fw-fp-head"><h3>This week’s flight plan</h3></div><p class="fw-fp-empty">Loading…</p>';
    host.appendChild(card);
    afetch('/weekly-plan').then(function (r) { return r.json(); }).then(function (data) {
      // Free/paid merge §1: the Weekly Flight Plan is the paid tier's namesake.
      // The server already refused, so lock() unconditionally rather than
      // re-deciding locally and racing the entitlements boot.
      if (data && data.upgrade) {
        if (global.FWEnt && typeof FWEnt.lock === 'function') FWEnt.lock(card, 'weekly-plan');
        else card.remove();
        return;
      }
      render(card, data);
      try { if (global.FWEvents) FWEvents.log('flightplan_view', { n: (data && data.tasks || []).length }); } catch (_) {}
    }).catch(function () { card.remove(); });
  }

  global.FWFlightPlanCard = { inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
