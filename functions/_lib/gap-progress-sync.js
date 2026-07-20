// Single source of truth for "roadmap progress → objective vector".
// Step done-state on the tree drives each v3 coordinate gap to an ABSOLUTE
// value from its immutable vBase, so every save path (roadmap page, portal,
// weekly Flight Plan) converges to the same vector regardless of order or
// repetition. Supersedes the per-event boost patches (complete-step /
// revert-step / weekly-plan patchObjectiveForStep) and the checklist-driven
// gap-progress client flow.

import { loadUser, saveUser } from './user.js';
import { mergeObjectiveAiPatch, applyObjectiveAiPatch } from './onet/objective-patch.js';

const EVIDENCE_CAP_PCT = 30;
const STEP_WEIGHT = 0.6; // steps can close up to 60% of a gap's span
const PROGRESS_CAP = 0.9; // real-world verification owns the last 10%

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function ratio(done, total) {
  return total > 0 ? done / total : 0;
}

/**
 * Recompute the absolute per-dimension values implied by the tree's CURRENT
 * state. Pure — same tree in, same dims out. Per gap:
 *   value = base + span * min(0.9, 0.6·stepRatio + evidencePct/100)
 * where stepRatio comes from steps on active-path waypoints addressing the
 * gap (falling back to the whole active path), legacy checklist completion
 * is honored via max() so past credit never regresses, and manualComplete
 * pins at least 90% of the span.
 */
export function computeGapProgressDims(tree) {
  const gaps = (tree?.focusTracker?.skillGaps || [])
    .filter((g) => g && Number.isInteger(g.dimIndex) && g.dimIndex >= 0 && g.dimIndex < 161);
  if (!gaps.length) return [];

  const byId = new Map((tree.nodes || []).map((n) => [n?.id, n]));
  const pathNodes = (Array.isArray(tree.activePath) ? tree.activePath : [])
    .filter((id) => id !== 'trunk')
    .map((id) => byId.get(id))
    .filter(Boolean);
  const pool = pathNodes.length ? pathNodes : (tree.nodes || []).filter(Boolean);

  let allDone = 0;
  let allTotal = 0;
  for (const n of pool) {
    for (const s of (n.steps || [])) {
      if (!s) continue;
      allTotal += 1;
      if (s.done) allDone += 1;
    }
  }

  return gaps.map((g) => {
    const label = norm(g.label);
    let done = 0;
    let total = 0;
    for (const n of pool) {
      if (!(n.addressedGaps || []).some((a) => norm(a) === label)) continue;
      for (const s of (n.steps || [])) {
        if (!s) continue;
        total += 1;
        if (s.done) done += 1;
      }
    }
    let stepRatio = total > 0 ? ratio(done, total) : ratio(allDone, allTotal);
    const checklist = Array.isArray(g.checklist) ? g.checklist : [];
    if (checklist.length) {
      stepRatio = Math.max(stepRatio, ratio(checklist.filter((c) => c && c.done).length, checklist.length));
    }
    const evidencePct = Math.min(
      EVIDENCE_CAP_PCT,
      (g.logs || []).reduce((sum, l) => sum + (Number(l?.w) || 0), 0),
    );

    const b = Math.max(0, Math.min(100, Number(g.vBase != null ? g.vBase : g.user) || 0));
    const t = Math.max(0, Math.min(100, Number(g.target) || 0));
    const span = Math.max(0, t - b);
    let value = b + span * Math.min(PROGRESS_CAP, STEP_WEIGHT * stepRatio + evidencePct / 100);
    if (g.manualComplete === true) value = Math.max(value, b + span * PROGRESS_CAP);
    value = Math.round(Math.max(b, Math.min(100, value)));
    return { index: g.dimIndex, value };
  });
}

/**
 * Sync the quiz profile's objective vector to the tree's progress state.
 * No-op (returns null, saves nothing) when every dim already holds its
 * computed value — so routine tree saves don't churn vector timestamps
 * and downstream staleness hashes.
 */
export async function syncGapProgressToQuiz(env, email, tree) {
  const dims = computeGapProgressDims(tree);
  if (!dims.length) return null;
  const user = await loadUser(env, email);
  if (!user) return null;

  const current = new Map(
    (user.vectors.objectiveAiPatch?.dimensions || []).map((d) => [Number(d.index), Math.round(Number(d.value != null ? d.value : d.to))]),
  );
  if (dims.every((d) => current.get(d.index) === d.value)) return null;

  const objectiveAiPatch = mergeObjectiveAiPatch(user.vectors.objectiveAiPatch, dims, 'gap-progress-sync');
  const objectiveVector = applyObjectiveAiPatch(user.vectors.objective, objectiveAiPatch);
  user.vectors.objective = objectiveVector;
  user.vectors.objectiveAiPatch = objectiveAiPatch;
  user.vectors.objectiveSkipped = false;
  await saveUser(env, email, user);
  return { objectiveVector, objectiveAiPatch };
}
