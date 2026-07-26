/**
 * FlightWay — Commitments, client mirror (V2 §5 S10).
 *
 * The server copy is `functions/_lib/commitments.js` and it is authoritative.
 * This file exists because two surfaces need the rule with no round trip: the
 * roadmap drawer (which mutates the tree locally and lets FWRoadmapSync save)
 * and the Flight Plan module (which renders what the server already sent).
 *
 * It is a MIRROR, not a variant. `scripts/test-commitments.mjs` runs both
 * copies over the same fixtures and fails on any disagreement — same discipline
 * as the client/server KEY_MAP pair. If you change a rule here, change it
 * there in the same commit.
 *
 * Dates are bare `YYYY-MM-DD` calendar days and are parsed with a regex, never
 * `new Date(iso)` — constructing a Date from a date-only string and reading it
 * back in local time is how a Friday deadline renders as Thursday for anyone
 * west of UTC. Same idiom as deadline-radar.js.
 */
(function (global) {
  'use strict';

  var EFFORTS = ['S', 'M', 'L'];
  var EFFORT_LABELS = { S: 'Quick', M: 'Half a day', L: 'A week' };
  var MAX_DUE_MOVES = 99;
  var DAY_MS = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isIsoDate(v) {
    var s = String(v == null ? '' : v).trim().slice(0, 10);
    if (!ISO_RE.test(s)) return false;
    var t = Date.parse(s + 'T00:00:00Z');
    if (isNaN(t)) return false;
    return new Date(t).toISOString().slice(0, 10) === s;
  }

  function utcToday(nowMs) {
    return new Date(typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now())
      .toISOString().slice(0, 10);
  }

  function shiftDate(iso, days) {
    var t = Date.parse(String(iso) + 'T00:00:00Z');
    if (isNaN(t)) return '';
    return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
  }

  /** UTC-anchored on both sides — see the server copy's note. */
  function daysUntil(iso, nowMs) {
    var t = Date.parse(String(iso || '').slice(0, 10) + 'T00:00:00Z');
    if (isNaN(t)) return null;
    var today = Date.parse(utcToday(nowMs) + 'T00:00:00Z');
    return Math.round((t - today) / DAY_MS);
  }

  function normalizeEffort(v) {
    var s = String(v == null ? '' : v).trim().toUpperCase();
    return EFFORTS.indexOf(s) >= 0 ? s : null;
  }

  function normalizeDueAt(v) {
    var s = String(v == null ? '' : v).trim().slice(0, 10);
    return isIsoDate(s) ? s : null;
  }

  function clean(s, max) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 160);
  }

  /** Mirror of the server's collectCommitments, including the sort. */
  function collect(tree, opts) {
    var o = opts || {};
    var now = typeof o.now === 'number' && isFinite(o.now) ? o.now : Date.now();
    var includeDone = !!o.includeDone;
    var out = [];
    if (!tree || tree.version !== 2 || !Array.isArray(tree.nodes)) return out;

    tree.nodes.forEach(function (n) {
      if (!n || !n.id || !Array.isArray(n.steps)) return;
      n.steps.forEach(function (s) {
        if (!s || !s.id || !isIsoDate(s.dueAt)) return;
        var done = !!s.done;
        if (done && !includeDone) return;
        // Truncated: isIsoDate accepts a full ISO instant, and every comparison
        // below is a string compare on a bare calendar day.
        var dueAt = String(s.dueAt).slice(0, 10);
        var daysOut = daysUntil(dueAt, now);
        var moves = Number(s.dueMoves);
        out.push({
          nodeId: n.id,
          stepId: s.id,
          text: clean(s.text, 160),
          waypointTitle: clean(n.shortTitle || n.title || '', 60),
          dueAt: dueAt,
          effort: normalizeEffort(s.effort),
          committedAt: s.committedAt || '',
          dueMoves: isFinite(moves) ? Math.min(MAX_DUE_MOVES, Math.max(0, Math.floor(moves))) : 0,
          daysOut: daysOut,
          overdue: !done && daysOut !== null && daysOut < 0,
          done: done
        });
      });
    });

    return out.sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
      if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
      return a.stepId < b.stepId ? -1 : 1;
    });
  }

  function buckets(list) {
    var overdue = [], thisWeek = [], later = [];
    (list || []).forEach(function (c) {
      if (c.overdue) overdue.push(c);
      else if (c.daysOut !== null && c.daysOut <= 7) thisWeek.push(c);
      else later.push(c);
    });
    return { overdue: overdue, thisWeek: thisWeek, later: later };
  }

  /** The commitment on one step, or null. Used by the drawer to render state. */
  function forStep(tree, nodeId, stepId) {
    var list = collect(tree, { includeDone: true });
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].nodeId === nodeId && list[i].stepId === stepId) return list[i];
    }
    return null;
  }

  /**
   * Quick-pick dates the drawer offers. "This week" is the coming Sunday (the
   * end of the week they are standing in, never a date already past); "Next
   * week" is seven days after that.
   */
  function quickDates(nowMs) {
    var today = utcToday(nowMs);
    var dow = new Date(Date.parse(today + 'T00:00:00Z')).getUTCDay(); // 0 = Sun
    var toSunday = dow === 0 ? 0 : 7 - dow;
    var endOfWeek = shiftDate(today, toSunday);
    return { today: today, thisWeek: endOfWeek, nextWeek: shiftDate(endOfWeek, 7) };
  }

  function formatDate(iso) {
    var m = ISO_RE.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return (MONTHS[Number(m[2]) - 1] || m[2]) + ' ' + Number(m[3]);
  }

  function dueLabel(c) {
    if (!c) return '';
    var n = c.daysOut;
    if (c.done) return 'Done · was due ' + formatDate(c.dueAt);
    if (n === null) return 'Due ' + formatDate(c.dueAt);
    if (n < 0) return Math.abs(n) === 1 ? '1 day overdue' : Math.abs(n) + ' days overdue';
    if (n === 0) return 'Due today';
    if (n === 1) return 'Due tomorrow';
    if (n <= 7) return 'Due in ' + n + ' days';
    return 'Due ' + formatDate(c.dueAt);
  }

  function urgencyTier(c) {
    if (!c) return 'normal';
    if (c.done) return 'done';
    if (c.overdue) return 'overdue';
    if (c.daysOut !== null && c.daysOut <= 2) return 'urgent';
    if (c.daysOut !== null && c.daysOut <= 7) return 'soon';
    return 'normal';
  }

  // ---- mutations (mirror of the server's applyCommitment) -----------------
  // Each returns a NEW tree, or null when nothing changed — so a caller can
  // skip the save on a no-op instead of churning updatedAt and re-syncing
  // vectors for a click that did nothing.

  function replaceStep(tree, nodeId, stepId, nextStep) {
    var nodes = tree.nodes.map(function (n) {
      if (n.id !== nodeId) return n;
      var steps = n.steps.map(function (s) { return s.id === stepId ? nextStep : s; });
      var out = Object.assign({}, n, { steps: steps });
      return out;
    });
    return Object.assign({}, tree, { nodes: nodes, updatedAt: new Date().toISOString() });
  }

  function findStep(tree, nodeId, stepId) {
    if (!tree || tree.version !== 2 || !Array.isArray(tree.nodes)) return null;
    var node = null;
    for (var i = 0; i < tree.nodes.length; i += 1) {
      if (tree.nodes[i] && tree.nodes[i].id === nodeId) { node = tree.nodes[i]; break; }
    }
    if (!node || !Array.isArray(node.steps)) return null;
    for (var j = 0; j < node.steps.length; j += 1) {
      if (node.steps[j] && node.steps[j].id === stepId) return node.steps[j];
    }
    return null;
  }

  /**
   * Put (or move) a date on a step. A LATER date on an existing commitment is
   * a reschedule and bumps dueMoves — that count is the honesty in "moved 2x".
   * Pulling a date earlier is not a slip and is not counted.
   */
  function setCommitment(tree, nodeId, stepId, dueAt, effort) {
    var step = findStep(tree, nodeId, stepId);
    if (!step) return null;
    var due = normalizeDueAt(dueAt);
    if (!due) return null;
    var eff = normalizeEffort(effort);
    var had = isIsoDate(step.dueAt);
    if (due === step.dueAt && (eff || null) === (normalizeEffort(step.effort) || null)) return null;

    var next = Object.assign({}, step, {
      dueAt: due,
      committedAt: had ? (step.committedAt || new Date().toISOString()) : new Date().toISOString()
    });
    if (eff) next.effort = eff;
    else if (!had) delete next.effort;
    var prevMoves = Number(step.dueMoves) || 0;
    var moves = (had && due > step.dueAt) ? Math.min(MAX_DUE_MOVES, prevMoves + 1) : prevMoves;
    if (moves > 0) next.dueMoves = moves;
    else delete next.dueMoves;
    return replaceStep(tree, nodeId, stepId, next);
  }

  /**
   * Drop the commitment. Writes explicit NULLS rather than deleting the keys:
   * this object is about to travel to the server's normalizeSteps, where an own
   * property set to null is the tombstone that beats the preserved value. A
   * bare delete works on the save path and silently fails on a regeneration.
   */
  function clearCommitment(tree, nodeId, stepId) {
    var step = findStep(tree, nodeId, stepId);
    if (!step || !isIsoDate(step.dueAt)) return null;
    var next = Object.assign({}, step, {
      dueAt: null, effort: null, committedAt: null, dueMoves: null
    });
    return replaceStep(tree, nodeId, stepId, next);
  }

  global.FWCommitments = {
    EFFORTS: EFFORTS.slice(),
    EFFORT_LABELS: EFFORT_LABELS,
    MAX_DUE_MOVES: MAX_DUE_MOVES,
    isIsoDate: isIsoDate,
    utcToday: utcToday,
    shiftDate: shiftDate,
    daysUntil: daysUntil,
    normalizeEffort: normalizeEffort,
    normalizeDueAt: normalizeDueAt,
    collect: collect,
    buckets: buckets,
    forStep: forStep,
    quickDates: quickDates,
    formatDate: formatDate,
    dueLabel: dueLabel,
    urgencyTier: urgencyTier,
    setCommitment: setCommitment,
    clearCommitment: clearCommitment
  };
}(typeof window !== 'undefined' ? window : globalThis));
