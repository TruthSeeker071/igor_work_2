// FlightWay 2.0 — Pillar B1 weekly Flight Plan: pure, deterministic selection.
// No AI — this is *selection*, not generation. Shared by functions/weekly-plan.js
// (and, later, the nudge cron worker) so the "3 tasks" a user sees are identical
// everywhere. Kept dependency-light: only the roadmap-tree step helpers.

import { syncNodeDoneFromSteps } from './roadmap-tree.js';

/** ISO-8601 week key, e.g. "2026-W28" (UTC, Monday-based). Stable within a week. */
export function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;          // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);    // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Pick up to `limit` concrete tasks for this week: the earliest incomplete steps
 * on the active roadmap path (current waypoint first, then the next ones). Purely
 * deterministic given a tree — same input → same 3 tasks, in the same order.
 * Each task id is "waypointId:stepId" so completion maps straight back to the tree.
 */
export function selectWeeklyTasks(tree, opts = {}) {
  const limit = opts.limit || 3;
  const out = [];
  if (!tree || !Array.isArray(tree.nodes)) return out;

  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const path = Array.isArray(tree.activePath) ? tree.activePath : [];
  const ordered = [];
  for (const id of path) {
    if (id === 'trunk') continue;
    const n = byId.get(id);
    if (n) ordered.push(n);
  }
  // Fall back to node order if there's no usable active path.
  const pool = ordered.length ? ordered : tree.nodes;

  for (const n of pool) {
    if (!n || n.done || !Array.isArray(n.steps)) continue;
    for (const s of n.steps) {
      if (!s || s.done || !s.id) continue;
      out.push({
        id: `${n.id}:${s.id}`,
        label: String(s.text || '').slice(0, 100),
        source: 'waypoint',
        waypointId: n.id,
        waypointTitle: String(n.shortTitle || n.title || '').slice(0, 80),
        stepId: s.id,
        done: false,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Re-derive done-state for a saved selection from the live tree (labels stay stable). */
export function applyDoneState(tasks, tree) {
  if (!Array.isArray(tasks)) return [];
  const done = {};
  (tree?.nodes || []).forEach((n) => {
    if (!n?.id || !Array.isArray(n.steps)) return;
    n.steps.forEach((s) => { if (s?.id) done[`${n.id}:${s.id}`] = !!s.done; });
  });
  return tasks.map((t) => ({ ...t, done: !!done[t.id] }));
}

/** Mark one step done/undone in the tree and re-sync its waypoint. Returns true if found. */
export function markStepDone(tree, waypointId, stepId, done) {
  if (!tree || !Array.isArray(tree.nodes)) return false;
  const node = tree.nodes.find((n) => n && n.id === waypointId);
  if (!node || !Array.isArray(node.steps)) return false;
  const step = node.steps.find((s) => s && s.id === stepId);
  if (!step) return false;
  step.done = !!done;
  syncNodeDoneFromSteps(node);
  return true;
}

/** {done,total} across the selected tasks (for the card's progress ring). */
export function planProgress(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  return { done: list.filter((t) => t.done).length, total: list.length };
}
