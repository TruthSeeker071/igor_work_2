/**
 * FlightWay 2.0 — Pillar B1 "Weekly Flight Plan" card.
 *
 * The habit loop: this week's 3 concrete tasks (auto-selected from the current
 * roadmap waypoint). Checking one marks the underlying roadmap step done, which
 * feeds the receipts card. Injected after FWPortal.render() from portal.html's
 * boot — deliberately out of portal.js to stay off Jacob's file (mirrors
 * sim-portal-card.js).
 *
 * S7 (IA flip): ONE module, two surfaces, chosen by whichever host element the
 * page provides — `#flightplan-hero` on flightplan.html (hero: the page's whole
 * point) and `#portal-thisweek` on portal.html (mirror: compact, links over).
 * Deliberately not two modules: the check-off POST writes the roadmap tree AND
 * merges objectiveVector/objectiveAiPatch back into local quiz state, which is
 * the hydration→vector-merge path — it gets exactly one writer.
 *
 * The filename still says "portal" because renaming it would churn the buster
 * across two pages for no behavioural gain; the mount is no longer portal-only.
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

  // The one dated opportunity the weekly generator already looked at (server
  // recomputes daysOut on every GET, so this never goes stale mid-week). It is
  // both the "next deadline" chip and the "live opportunity tease" the S7 spec
  // asks for, because in today's data model they are the same record — the
  // Opportunity Finder's grounded results ARE where a real date comes from.
  function deadlineChip(d) {
    if (!d || !d.title) return '';
    var n = d.daysOut;
    var when = n === 0 ? 'Closes today' : n === 1 ? 'Closes tomorrow' : 'Closes in ' + n + ' days';
    var body = '<span class="fw-fp-dl-when">' + esc(when) + '</span>'
      + '<span class="fw-fp-dl-title">' + esc(d.title) + (d.org ? ' &middot; ' + esc(d.org) : '') + '</span>';
    if (d.url && /^https?:\/\//i.test(d.url)) {
      return '<a class="fw-fp-deadline" href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">'
        + body + '<span class="fw-fp-dl-go" aria-hidden="true">&nearr;</span></a>';
    }
    return '<div class="fw-fp-deadline">' + body + '</div>';
  }

  function render(card, data, mode) {
    var isHero = mode === 'hero';
    if (data && data.empty) {
      card.innerHTML = '<div class="fw-fp-head"><h3>Your weekly Flight Plan</h3></div>'
        + '<p class="fw-fp-empty">Generate your roadmap and your tasks for the week land here.</p>'
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
      + '<div class="fw-fp-head-txt"><h3>' + (isHero ? 'This week' : 'This week’s flight plan') + '</h3>'
      + '<p class="fw-fp-week">' + esc(weekOfLabel()) + '</p></div>'
      + '<span class="fw-fp-chip">' + prog.done + ' of ' + prog.total + ' done</span></div>'
      + '<div class="fw-fp-tasks">' + rows + '</div>'
      + deadlineChip(data && data.nextDeadline)
      // Minimal provenance note (fix plan 2.5): tasks may reference live
      // deadlines, so show when they were checked.
      + (data && data.grounding && data.grounding.fetchedAt
        ? '<p class="fw-fp-asof">Opportunities checked as of ' + esc(String(data.grounding.fetchedAt).slice(0, 10)) + '</p>'
        : '')
      + (isHero
        ? '<div class="fw-fp-foot" id="flightplan-notify-slot"></div>'
        : '<a class="fw-fp-cta" href="flightplan.html">Open my Flight Plan &rarr;</a>');
    // The weekly-email toggle renders into the hero's footer slot
    // (notify-optin.js). The portal mirror deliberately has no slot: two copies
    // of a toggle bound to the same prefs would be two sources of truth, and
    // every email footer deep-links to the hero's #notifications anchor.
    if (isHero && global.FWNotifyOptin && typeof FWNotifyOptin.inject === 'function') FWNotifyOptin.inject();

    card.querySelectorAll('.fw-fp-check').forEach(function (box) {
      box.addEventListener('change', function () {
        var id = box.getAttribute('data-task-id');
        var done = box.checked;
        var label = box.closest('.fw-fp-task');
        if (label) label.classList.toggle('is-done', done);
        // One event for one action, with the surface as a prop — a second
        // `thisweek_task_done` name would double-count the same check-off.
        try { if (global.FWEvents) FWEvents.log('flightplan_done', { id: id, done: done, surface: mode }); } catch (_) {}
        // S19: one of the three NPS moments. Only on the way TO done — asking
        // somebody how they feel about the product at the instant they un-tick
        // something is asking at the one moment they are annoyed with it.
        // FWNps decides nothing itself; the server owns the 30-day cap.
        if (done) { try { if (global.FWNps) FWNps.maybeAsk('flightplan_done'); } catch (_) {} }
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

  // Host resolution decides the surface. flightplan.html offers the hero mount;
  // portal.html offers the This-Week mirror above its action cards. The two
  // legacy portal hosts stay as a fallback so an older page still renders.
  function resolveHost() {
    var hero = document.getElementById('flightplan-hero');
    if (hero) return { host: hero, mode: 'hero' };
    var mirror = document.getElementById('portal-thisweek');
    if (mirror) return { host: mirror, mode: 'mirror' };
    var legacy = document.getElementById('portal-fw2-stack') || document.getElementById('portal-actions');
    return legacy ? { host: legacy, mode: 'mirror' } : null;
  }

  function inject() {
    var slot = resolveHost();
    if (!slot || document.getElementById('portal-card-flightplan')) return;
    var host = slot.host;
    var mode = slot.mode;
    var card = document.createElement('div');
    card.id = 'portal-card-flightplan';
    card.className = 'fw-flightplan-card' + (mode === 'hero' ? ' fw-flightplan-card--hero' : '');
    card.innerHTML = '<div class="fw-fp-head"><h3>This week’s flight plan</h3></div><p class="fw-fp-empty">Loading…</p>';
    host.appendChild(card);
    afetch('/weekly-plan').then(function (r) { return r.json(); }).then(function (data) {
      // V2 §4 (D1): the Weekly Flight Plan is free forever, so `upgrade` can no
      // longer arrive for a plan reason — /weekly-plan has no requirePlan left.
      // If one somehow does, it is a BUG, not a tier, so say so honestly rather
      // than rendering a paywall on a feature we promise is free (and rather
      // than logging a paywall_view for a wall that does not exist).
      if (data && data.upgrade) {
        card.innerHTML = '<div class="fw-fp-head"><h3>This week</h3></div>'
          + '<p class="fw-fp-empty">Your plan didn’t load. Refresh the page to try again.</p>';
        return;
      }
      render(card, data, mode);
      try { if (global.FWEvents) FWEvents.log('flightplan_view', { n: (data && data.tasks || []).length, surface: mode }); } catch (_) {}
    }).catch(function () {
      // The mirror can vanish (Home has plenty else on it); the hero cannot —
      // a permanent "Loading…" on the page the tab is named after is worse
      // than saying the request failed.
      if (mode !== 'hero') { card.remove(); return; }
      card.innerHTML = '<div class="fw-fp-head"><h3>This week</h3></div>'
        + '<p class="fw-fp-empty">Your plan didn’t load. Refresh the page to try again.</p>';
    });
  }

  global.FWFlightPlanCard = { inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
