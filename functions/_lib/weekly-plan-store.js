// FlightWay — the weekly plan's KV doc: key shape, read, write, input signature.
//
// Extracted in V2 S11 because there are now TWO writers. The Flight Plan page
// has always generated the week lazily on first visit; the Monday digest now
// generates it on send (§5 S11, "generate-on-send if stale"), which is the
// earlier of the two on any Monday. If the two disagreed about the key or about
// `sig` by one character, the student would pay for a second Gemini generation
// the moment they opened the page — the digest would have written a doc the
// page refuses to trust. One module, one definition, no drift.
//
// Same split as deadline-core / deadline-store: `weeklyInputSig` is pure and
// the two async functions are the only things that touch KV.

import { trackedWaypointNodes } from './weekly-plan-gen.js';

/** ~3 weeks: the prev-week carry-forward reads exactly one back. */
export const WEEK_DOC_TTL_SEC = 60 * 60 * 24 * 21;

export const weekDocKey = (email, week) => `wkplan2:${email}:${week}`;

export async function loadWeekDoc(env, email, week) {
  if (!env || !env.COACH_KV) return null;
  try {
    const raw = await env.COACH_KV.get(weekDocKey(email, week));
    if (!raw) return null;
    const doc = JSON.parse(raw);
    return doc && Array.isArray(doc.tasks) ? doc : null;
  } catch {
    return null;
  }
}

export async function saveWeekDoc(env, email, doc) {
  if (!env || !env.COACH_KV) return;
  await env.COACH_KV.put(weekDocKey(email, doc.week), JSON.stringify(doc), { expirationTtl: WEEK_DOC_TTL_SEC });
}

/**
 * A task is done if it was checked this week OR its underlying step got
 * completed elsewhere (roadmap page, Marco, the Flight Plan module). Shared
 * with the digest because "you closed 2 of 3 last week" must count the same
 * things the card counted — reading the stored flag alone under-reports every
 * student who ticked the step off on the roadmap instead of the weekly card.
 */
export function refreshDoneState(doc, tree) {
  const stepDone = {};
  (tree?.nodes || []).forEach((n) => {
    if (!n?.id || !Array.isArray(n.steps)) return;
    n.steps.forEach((s) => { if (s?.id) stepDone[`${n.id}:${s.id}`] = !!s.done; });
  });
  doc.tasks = doc.tasks.map((t) => ({
    ...t,
    done: !!t.done || !!(t.stepId && stepDone[`${t.waypointId}:${t.stepId}`]),
  }));
  return doc;
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Signature of the inputs the weekly plan is generated FROM — every tracked
 * waypoint (spine plus any tracked branches, per trackedWaypointNodes) with its
 * step text and semester-plan class content.
 *
 * When a Semester Plan edit changes a class (e.g. STAT 24400 → MATH 16100) or a
 * step, OR the tracked set itself changes (a branch gets tracked or untracked),
 * the sig changes and the cached week doc is regenerated so the Flight Plan
 * stays in lockstep. Step DONE-toggles don't change text (handled by
 * refreshDoneState), so they never force a wasteful regen.
 */
export function weeklyInputSig(tree) {
  const nodes = trackedWaypointNodes(tree);
  if (!nodes.length) return 'none';
  const parts = nodes.map((node) => {
    const steps = (node.steps || []).map((s) => `${s.id}=${String(s.text || '').trim()}`).join('|');
    const phases = node.semesterPlan && node.semesterPlan.plan && node.semesterPlan.plan.phases;
    const plan = Array.isArray(phases)
      ? phases.map((p) => `${p.title || ''}:${(p.items || []).map((it) => it.text || '').join(',')}`).join('|')
      : '';
    return `${node.id}#${steps}#${plan}`;
  });
  return hashStr(parts.join('~'));
}
