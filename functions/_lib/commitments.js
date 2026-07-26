// FlightWay — Commitments (V2 §5 S10).
//
// A commitment is a roadmap step the student put a DATE on. That is the whole
// idea: a checkbox is a suggestion, a checkbox with "by Friday" on it is a
// promise, and a promise is the thing a coach can chase. Nothing here is
// persisted separately — `dueAt` / `effort` / `committedAt` / `dueMoves` live on
// the step inside the roadmap JSON doc (no migration), and survive every
// normalize/merge path via `collectStepMetaMap` in roadmap-tree.js.
//
// This module is the READ model plus the one mutation. It is pure — no D1, no
// KV, no fetch — so the gate drives it directly, and so the same rule serves
// the Flight Plan module, Marco's memory and (S11) the weekly digest without
// three subtly different definitions of "overdue".
//
// Dates: a commitment is a CALENDAR DAY. `daysUntil` is S9's, UTC-anchored on
// both sides, which is what stops "due today" from reading as "1 day overdue"
// to anyone west of Greenwich after lunch.

import { daysUntil, utcDate, shiftDate, isIsoDate } from './deadline-core.js';
import {
  STEP_EFFORTS,
  MAX_DUE_MOVES,
  ROADMAP_TREE_VERSION,
  sanitizeUntrustedText,
  syncNodeDoneFromSteps,
} from './roadmap-tree.js';

export { STEP_EFFORTS, MAX_DUE_MOVES };

/** How many open commitments any one prompt block will ever name. */
export const PROMPT_COMMITMENT_LIMIT = 3;
/** The look-back window for "did last week land?". */
export const COMPLETION_WINDOW_DAYS = 7;

export const EFFORT_LABELS = { S: 'Quick', M: 'Half a day', L: 'A week' };

export function normalizeEffort(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return STEP_EFFORTS.includes(s) ? s : null;
}

export function normalizeDueAt(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 10);
  return isIsoDate(s) ? s : null;
}

function waypointLabel(node) {
  return sanitizeUntrustedText(node?.shortTitle || node?.title || '', 60);
}

/**
 * Every step carrying a due date, newest obligation first.
 *
 * Order is deliberate and is the same everywhere this list is shown: overdue
 * before upcoming, then soonest first, then a stable tiebreak on ids so two
 * things due the same day never swap places between renders.
 *
 * `done` commitments are EXCLUDED by default. A finished promise is not
 * something to chase, and leaving them in would make the Flight Plan module
 * grow forever. `includeDone` exists for the completion summary.
 */
export function collectCommitments(roadmap, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const includeDone = !!opts.includeDone;
  if (!roadmap || roadmap.version !== ROADMAP_TREE_VERSION || !Array.isArray(roadmap.nodes)) return [];

  const out = [];
  roadmap.nodes.forEach((n) => {
    if (!n?.id || !Array.isArray(n.steps)) return;
    n.steps.forEach((s) => {
      if (!s?.id || !isIsoDate(s.dueAt)) return;
      const done = !!s.done;
      if (done && !includeDone) return;
      // Truncated for the same reason normalizeSteps truncates: isIsoDate
      // accepts a full instant, and every comparison below is a string compare
      // on a bare day.
      const dueAt = String(s.dueAt).slice(0, 10);
      const daysOut = daysUntil(dueAt, now);
      out.push({
        nodeId: n.id,
        stepId: s.id,
        text: sanitizeUntrustedText(s.text, 160),
        waypointTitle: waypointLabel(n),
        dueAt: s.dueAt,
        effort: normalizeEffort(s.effort),
        committedAt: s.committedAt || '',
        dueMoves: Number.isFinite(Number(s.dueMoves)) ? Math.min(MAX_DUE_MOVES, Math.max(0, Math.floor(Number(s.dueMoves)))) : 0,
        daysOut,
        overdue: !done && Number.isFinite(daysOut) && daysOut < 0,
        done,
      });
    });
  });

  return out.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
    if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
    return a.stepId < b.stepId ? -1 : 1;
  });
}

/** The three buckets every surface renders: late, this week, later. */
export function commitmentBuckets(list) {
  const overdue = [];
  const thisWeek = [];
  const later = [];
  (list || []).forEach((c) => {
    if (c.overdue) overdue.push(c);
    else if (Number.isFinite(c.daysOut) && c.daysOut <= 7) thisWeek.push(c);
    else later.push(c);
  });
  return { overdue, thisWeek, later };
}

/**
 * Did last week land? Counts commitments whose due date fell inside the window
 * ending today, done vs total. Derived from the steps themselves rather than a
 * stored weekly tally: there is no second record to fall out of sync, and a
 * date the student moved forward correctly stops counting against them.
 */
export function recentCompletion(roadmap, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const days = Number.isFinite(opts.days) ? opts.days : COMPLETION_WINDOW_DAYS;
  const today = utcDate(now);
  const from = shiftDate(today, -days);
  const all = collectCommitments(roadmap, { now, includeDone: true });
  const inWindow = all.filter((c) => c.dueAt >= from && c.dueAt <= today);
  return {
    windowDays: days,
    total: inWindow.length,
    done: inWindow.filter((c) => c.done).length,
  };
}

function duePhrase(c) {
  if (!Number.isFinite(c.daysOut)) return `due ${c.dueAt}`;
  if (c.daysOut < 0) return `due ${c.dueAt} — ${Math.abs(c.daysOut)} day${Math.abs(c.daysOut) === 1 ? '' : 's'} OVERDUE`;
  if (c.daysOut === 0) return `due TODAY (${c.dueAt})`;
  if (c.daysOut === 1) return `due tomorrow (${c.dueAt})`;
  return `due in ${c.daysOut} days (${c.dueAt})`;
}

/**
 * Marco's follow-through context. Returns '' when there is nothing to chase —
 * an empty block is what stops Marco opening with a callback he invented.
 *
 * The "never scold" line is not decoration. A student who missed a date is the
 * single most likely person to stop opening the product, and the difference
 * between a coach and a nag is entirely in this paragraph.
 */
export function commitmentsPromptBlock(list, opts = {}) {
  const completion = opts.completion || null;
  const open = (list || []).filter((c) => !c.done).slice(0, PROMPT_COMMITMENT_LIMIT);
  if (!open.length && !(completion && completion.total)) return '';

  const lines = [];
  if (open.length) {
    lines.push('They put dates on these roadmap steps themselves:');
    open.forEach((c) => {
      lines.push(`- "${c.text}" (${c.waypointTitle || 'roadmap'}) — ${duePhrase(c)}`
        + (c.dueMoves ? ` · already moved ${c.dueMoves}x` : ''));
    });
  }
  if (completion && completion.total) {
    lines.push(`Last ${completion.windowDays} days: ${completion.done} of ${completion.total} dated steps completed.`);
  }
  lines.push('');
  lines.push('If this is the first message of a conversation and something above is due, overdue or'
    + ' just finished, open by asking about it by name — one sentence, then move on. Never scold, never'
    + ' moralise about a missed date, and never repeat the callback later in the same conversation.'
    + ' If something slipped, the useful reply is "what got in the way, and what is the smallest'
    + ' version you could finish this week?" Offer to move the date rather than letting it rot.');

  return `## Their open commitments\n${lines.join('\n')}\n`;
}

/**
 * The one mutation. Returns `{ roadmap, changed, commitment }` — a NEW roadmap
 * object when something changed, the same reference when nothing did, so a
 * caller can skip the save (and the vector re-sync) on a no-op.
 *
 * actions:
 *   set        — put/replace a date (+ optional effort). First date stamps
 *                committedAt; a LATER date on an existing commitment counts as
 *                a reschedule and increments dueMoves. Pulling a date EARLIER
 *                is not a slip and is not counted — honesty cuts one way here.
 *   clear      — remove the commitment entirely (dueAt/effort/committedAt/dueMoves).
 *   done/undone— toggle the underlying step, which is the same state the drawer
 *                and the weekly card write. Commitments never get a private
 *                completion flag; there is exactly one "is this finished".
 */
export function applyCommitment(roadmap, nodeId, stepId, patch = {}) {
  const unchanged = { roadmap, changed: false, commitment: null, doneChanged: false };
  if (!roadmap || roadmap.version !== ROADMAP_TREE_VERSION || !Array.isArray(roadmap.nodes)) return unchanged;
  const node = roadmap.nodes.find((n) => n && n.id === nodeId);
  if (!node || !Array.isArray(node.steps)) return unchanged;
  const step = node.steps.find((s) => s && s.id === stepId);
  if (!step) return unchanged;

  const action = String(patch.action || '').toLowerCase();
  let next = null;
  let doneChanged = false;

  if (action === 'set') {
    const dueAt = normalizeDueAt(patch.dueAt);
    if (!dueAt) return unchanged;
    const effort = normalizeEffort(patch.effort);
    const had = isIsoDate(step.dueAt);
    const movedLater = had && dueAt > step.dueAt;
    next = {
      ...step,
      dueAt,
      committedAt: had ? (step.committedAt || new Date().toISOString()) : new Date().toISOString(),
    };
    if (effort) next.effort = effort;
    else if (!had) delete next.effort;
    const prevMoves = Number(step.dueMoves) || 0;
    const moves = movedLater ? Math.min(MAX_DUE_MOVES, prevMoves + 1) : prevMoves;
    if (moves > 0) next.dueMoves = moves;
    else delete next.dueMoves;
    if (next.dueAt === step.dueAt && (next.effort || null) === (step.effort || null)) return unchanged;
  } else if (action === 'clear') {
    if (!isIsoDate(step.dueAt)) return unchanged;
    // Explicit nulls, not deletes: this object travels to normalizeSteps, and
    // an own property set to null is the tombstone that beats the preserved
    // value. A bare delete would work on the save path and quietly fail on a
    // regen, which is the worst kind of half-working.
    next = { ...step, dueAt: null, effort: null, committedAt: null, dueMoves: null };
  } else if (action === 'done' || action === 'undone') {
    const done = action === 'done';
    if (!!step.done === done) return unchanged;
    next = { ...step, done };
    doneChanged = true;
  } else {
    return unchanged;
  }

  const nextNode = { ...node, steps: node.steps.map((s) => (s.id === stepId ? next : s)) };
  if (doneChanged) syncNodeDoneFromSteps(nextNode);
  const out = {
    ...roadmap,
    nodes: roadmap.nodes.map((n) => (n.id === nodeId ? nextNode : n)),
    updatedAt: new Date().toISOString(),
  };
  const commitment = collectCommitments(out, { now: patch.now, includeDone: true })
    .find((c) => c.nodeId === nodeId && c.stepId === stepId) || null;
  return { roadmap: out, changed: true, commitment, doneChanged };
}
