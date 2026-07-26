/**
 * FlightWay V2 S10 — Commitments panel (D-whatever, sibling of deadline-radar.js).
 *
 * Mounts into #flightplan-commitments on flightplan.html: the open
 * commitments a student has put dates on inside the roadmap tree (dueAt on a
 * step), grouped Overdue / This week / Later, with Done and Reschedule
 * actions. Reads via its own GET /weekly-plan call — deliberately not coupled
 * to portal-flightplan.js, which owns a different card on a different host.
 *
 * Idiom copied from deadline-radar.js: same afetch() (FWAuth.authFetch when
 * present, credentialed fetch otherwise), same IIFE wrapper, same
 * createElement/textContent discipline (never innerHTML with interpolated
 * data) because commitment text and waypoint titles come out of AI-generated
 * roadmap content and are exactly as untrusted as deadline-radar's titles.
 *
 * Unlike deadline-radar.js this module does not self-mount on
 * DOMContentLoaded — it follows the portal-flightplan.js / artifacts.js
 * pattern instead and is invoked explicitly from flightplan.html's boot
 * block via FWCommitmentsPanel.mount().
 *
 * Server rule lives in functions/_lib/commitments.js; the shared client
 * mirror is assets/js/shared/commitments.js (FWCommitments) — this file only
 * renders and posts, it never re-derives buckets/labels/tiers itself.
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

  var HOST_ID = 'flightplan-commitments';
  var GROUPS = [
    { key: 'overdue', label: 'Overdue' },
    { key: 'thisWeek', label: 'This week' },
    { key: 'later', label: 'Later' }
  ];

  var host = null;
  var state = { commitments: [], busyKey: null, errorKey: null, errorText: '', openReschedule: null };

  function rowKey(c) { return c.nodeId + '::' + c.stepId; }

  // ---- date math ------------------------------------------------------
  // "+1 week" is seven days after the row's CURRENT dueAt, never seven days
  // after today. Prefer the shared mirror's shiftDate; fall back to the same
  // UTC-safe arithmetic inline if a future FWCommitments build drops it.
  function plusOneWeek(iso) {
    if (global.FWCommitments && typeof FWCommitments.shiftDate === 'function') {
      return FWCommitments.shiftDate(iso, 7);
    }
    var t = Date.parse(String(iso) + 'T00:00:00Z');
    if (isNaN(t)) return '';
    return new Date(t + 7 * 86400000).toISOString().slice(0, 10);
  }

  // ---- posting ----------------------------------------------------------

  /**
   * The one event emitter. Names are written out in full rather than built as
   * `'commitment_' + action`: the action strings are the SERVER's vocabulary
   * (`set`/`done`), the event names are the analytics vocabulary
   * (`commitment_rescheduled`, `commitment_done`), and concatenating one into
   * the other silently invents names that are not in REGISTERED_EVENTS and
   * that docs/EVENTS.md does not describe. A concatenated name also slips past
   * `test:events`' literal-name lint, so nothing would have caught it.
   *
   * `before` is the row as it was BEFORE the write; `after` is the server's
   * fresh copy of the same row (absent once a commitment is cleared).
   */
  function logCommitmentEvent(action, before, after) {
    if (!global.FWEvents) return;
    try {
      if (action === 'done') {
        FWEvents.log('commitment_done', {
          overdue: before.overdue ? 1 : 0,
          days: typeof before.daysOut === 'number' ? before.daysOut : 0
        });
        return;
      }
      // Later than it was = a slip, which is what the honesty counter counts.
      // Pulling a date earlier is a plain re-set and says so.
      if (after && before.dueAt && after.dueAt > before.dueAt) {
        FWEvents.log('commitment_rescheduled', { moves: Number(after.dueMoves) || 0 });
      } else {
        FWEvents.log('commitment_set', {
          effort: (after && after.effort) || 'none',
          days: (after && typeof after.daysOut === 'number') ? after.daysOut : 0,
          moved: Number(before.dueMoves) || 0
        });
      }
    } catch (_) { /* fire-and-forget */ }
  }

  function postCommitment(c, action, dueAt) {
    var key = rowKey(c);
    if (state.busyKey) return;
    state.busyKey = key;
    state.errorKey = null;
    // The busy state IS the re-render: every button on the row reads
    // `state.busyKey` and disables itself. No FWButtonBusy here — render()
    // rebuilds the list from scratch, so any element handed to it would be
    // detached from the document before it ever painted a spinner.
    render();

    var body = { nodeId: c.nodeId, stepId: c.stepId, action: action };
    if (dueAt) body.dueAt = dueAt;

    afetch('/weekly-plan', 'POST', { commitment: body })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        state.busyKey = null;
        if (!res.ok || !res.data || !res.data.ok) {
          state.errorKey = key;
          state.errorText = (res.data && res.data.error) || 'Could not save that. Try again.';
          render();
          return;
        }
        state.commitments = Array.isArray(res.data.commitments) ? res.data.commitments : [];
        state.openReschedule = null;
        if (res.data.changed !== false) logCommitmentEvent(action, c, res.data.commitment);
        render();
      })
      .catch(function () {
        state.busyKey = null;
        state.errorKey = key;
        state.errorText = 'Could not save that. Try again.';
        render();
      });
  }

  // ---- one row ------------------------------------------------------------

  function buildChip(c) {
    var chip = document.createElement('span');
    chip.className = 'fp-commit-chip fp-commit-chip--' + FWCommitments.urgencyTier(c);
    chip.textContent = FWCommitments.dueLabel(c);
    return chip;
  }

  function buildMeta(c) {
    var meta = document.createElement('div');
    meta.className = 'fp-commit-meta';

    var wp = document.createElement('span');
    wp.className = 'fp-commit-waypoint';
    wp.textContent = c.waypointTitle || '';
    meta.appendChild(wp);

    if (c.effort && FWCommitments.EFFORT_LABELS[c.effort]) {
      var eff = document.createElement('span');
      eff.className = 'fp-commit-effort';
      eff.textContent = FWCommitments.EFFORT_LABELS[c.effort];
      meta.appendChild(eff);
    }

    if (c.dueMoves > 0) {
      var moved = document.createElement('span');
      moved.className = 'fp-commit-moved';
      moved.textContent = 'moved ' + c.dueMoves + 'x';
      meta.appendChild(moved);
    }

    return meta;
  }

  function buildRescheduleBox(c) {
    var box = document.createElement('div');
    box.className = 'fp-commit-reschedule';

    var plusWeekBtn = document.createElement('button');
    plusWeekBtn.type = 'button';
    plusWeekBtn.className = 'fp-commit-btn fp-commit-btn--quick';
    plusWeekBtn.textContent = '+1 week';
    plusWeekBtn.addEventListener('click', function () {
      var next = plusOneWeek(c.dueAt);
      if (next) postCommitment(c, 'set', next);
    });
    box.appendChild(plusWeekBtn);

    var dateWrap = document.createElement('label');
    dateWrap.className = 'fp-commit-date-wrap';
    var dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'fp-commit-date-input';
    dateInput.min = FWCommitments.quickDates().today;
    dateWrap.appendChild(dateInput);
    var goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'fp-commit-btn fp-commit-btn--quick';
    goBtn.textContent = 'Set date';
    goBtn.addEventListener('click', function () {
      if (dateInput.value) postCommitment(c, 'set', dateInput.value);
    });
    dateWrap.appendChild(goBtn);
    box.appendChild(dateWrap);

    return box;
  }

  function buildRow(c) {
    var key = rowKey(c);
    var row = document.createElement('div');
    row.className = 'fp-commit-row';
    row.setAttribute('data-commit-key', key);

    var top = document.createElement('div');
    top.className = 'fp-commit-row-top';
    top.appendChild(buildChip(c));
    var text = document.createElement('span');
    text.className = 'fp-commit-text';
    text.textContent = c.text || '';
    top.appendChild(text);
    row.appendChild(top);

    row.appendChild(buildMeta(c));

    var actions = document.createElement('div');
    actions.className = 'fp-commit-actions';

    var doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'fp-commit-btn fp-commit-btn--done';
    doneBtn.textContent = 'Done';
    doneBtn.disabled = state.busyKey === key;
    doneBtn.addEventListener('click', function () { postCommitment(c, 'done', null); });
    actions.appendChild(doneBtn);

    var reschedBtn = document.createElement('button');
    reschedBtn.type = 'button';
    reschedBtn.className = 'fp-commit-btn fp-commit-btn--reschedule';
    reschedBtn.textContent = 'Reschedule';
    reschedBtn.disabled = state.busyKey === key;
    reschedBtn.addEventListener('click', function () {
      state.openReschedule = state.openReschedule === key ? null : key;
      render();
    });
    actions.appendChild(reschedBtn);

    row.appendChild(actions);

    if (state.openReschedule === key) {
      row.appendChild(buildRescheduleBox(c));
    }

    if (state.errorKey === key) {
      var errP = document.createElement('p');
      errP.className = 'fp-commit-error';
      errP.textContent = state.errorText;
      row.appendChild(errP);
    }

    if (state.busyKey === key) row.setAttribute('data-fp-commit-busy', '1');

    return row;
  }

  // ---- empty state --------------------------------------------------------

  function buildEmptyState() {
    var wrap = document.createElement('div');
    var p = document.createElement('p');
    p.className = 'fp-empty';
    p.textContent = 'Nothing due. When you put a date on a roadmap step, it shows up here and we chase it.';
    wrap.appendChild(p);
    var cta = document.createElement('a');
    cta.className = 'fp-empty-cta';
    cta.setAttribute('href', 'roadmap.html?focus=1');
    cta.textContent = 'Open my roadmap →';
    wrap.appendChild(cta);
    return wrap;
  }

  // ---- shell --------------------------------------------------------------

  function buildGroup(groupLabel, list) {
    var section = document.createElement('div');
    section.className = 'fp-commit-group';
    var heading = document.createElement('h3');
    heading.className = 'fp-commit-group-title';
    heading.textContent = groupLabel;
    section.appendChild(heading);
    var list_ = document.createElement('div');
    list_.className = 'fp-commit-list';
    list.forEach(function (c) { list_.appendChild(buildRow(c)); });
    section.appendChild(list_);
    return section;
  }

  function render() {
    if (!host) return;
    host.textContent = '';

    if (!state.commitments.length) {
      host.appendChild(buildEmptyState());
      return;
    }

    var buckets = FWCommitments.buckets(state.commitments);
    GROUPS.forEach(function (g) {
      var list = buckets[g.key];
      if (list && list.length) host.appendChild(buildGroup(g.label, list));
    });
  }

  // ---- mount --------------------------------------------------------------

  function mount() {
    host = document.getElementById(HOST_ID);
    if (!host) return; // page has no commitments module — no-op
    if (!global.FWCommitments) return; // shared mirror not loaded — leave existing empty state
    if (host.getAttribute('data-fp-commit-mounted') === '1') return; // don't double-mount
    host.setAttribute('data-fp-commit-mounted', '1');

    afetch('/weekly-plan').then(function (r) {
      // 401 (signed out) or any other failure: leave the page's existing
      // empty-state copy in place and return quietly.
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      if (!data) return;
      state.commitments = Array.isArray(data.commitments) ? data.commitments : [];
      render();
    }).catch(function () { /* leave the existing empty-state copy in place */ });
  }

  global.FWCommitmentsPanel = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
