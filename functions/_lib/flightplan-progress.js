// Persistent Flight-Plan progress state — the durable memory that lets each
// week's AI-generated plan build on what actually happened instead of
// restarting. One KV doc per user:
//   fpprog:<email> = {
//     fractions: { "<waypointId>:<stepId>": 0..1 },   // partial step credit
//     notes:     [{ t, at }],                          // Marco-logged progress
//     lastWeek:  "2026-W28",                           // previous plan's key
//   }
// Fractions are the rules-engine half of the hybrid: weekly tasks carry an
// `advance` weight; accruing to 1.0 flips the underlying roadmap step done,
// which drives the objective vector through gap-progress-sync (the existing
// single-writer). Notes are the chat half: Marco appends when the user
// reports progress in conversation; the next generation reads them.

const KEY_PREFIX = 'fpprog:';
const NOTES_MAX = 12;

export function emptyProgressState() {
  return { fractions: {}, notes: [], lastWeek: '' };
}

export async function loadProgressState(env, email) {
  if (!env.COACH_KV || !email) return emptyProgressState();
  try {
    const raw = await env.COACH_KV.get(KEY_PREFIX + email);
    if (!raw) return emptyProgressState();
    const parsed = JSON.parse(raw);
    return {
      fractions: parsed && typeof parsed.fractions === 'object' && parsed.fractions ? parsed.fractions : {},
      notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
      lastWeek: typeof parsed?.lastWeek === 'string' ? parsed.lastWeek : '',
    };
  } catch {
    return emptyProgressState();
  }
}

export async function saveProgressState(env, email, state) {
  if (!env.COACH_KV || !email) return;
  await env.COACH_KV.put(KEY_PREFIX + email, JSON.stringify({
    fractions: state.fractions || {},
    notes: (state.notes || []).slice(-NOTES_MAX),
    lastWeek: state.lastWeek || '',
  }));
}

/** Marco-side manual logging: record a progress mention from chat. */
export async function appendProgressNote(env, email, text) {
  const t = String(text || '').trim().slice(0, 240);
  if (!t) return;
  const state = await loadProgressState(env, email);
  state.notes = (state.notes || []).concat([{ t, at: new Date().toISOString() }]).slice(-NOTES_MAX);
  await saveProgressState(env, email, state);
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * Pure accrual rule: toggling a weekly task adjusts its step's fraction by
 * the task's advance weight; crossing 1.0 marks the roadmap step done (and
 * dropping back below un-marks it, but only when the step's credit came from
 * this accrual — a step done directly on the roadmap page keeps fraction 1).
 * Returns { fraction, stepDone } — the caller applies stepDone to the tree.
 */
export function accrueTaskToggle(state, task, done) {
  if (!task || !task.stepId || !task.waypointId) return null;
  const key = `${task.waypointId}:${task.stepId}`;
  const advance = Math.max(0.05, Math.min(1, Number(task.advance) || 0.34));
  const prev = clamp01(state.fractions[key]);
  const next = clamp01(done ? prev + advance : prev - advance);
  state.fractions[key] = Math.round(next * 1000) / 1000;
  return { fraction: state.fractions[key], stepDone: state.fractions[key] >= 0.999 };
}

/** Seed fractions from the live tree so directly-completed steps read as 1. */
export function reconcileFractionsWithTree(state, tree) {
  (tree?.nodes || []).forEach((n) => {
    if (!n?.id || !Array.isArray(n.steps)) return;
    n.steps.forEach((s) => {
      if (!s?.id) return;
      const key = `${n.id}:${s.id}`;
      if (s.done) state.fractions[key] = 1;
      else if (state.fractions[key] >= 0.999) state.fractions[key] = 0.9;
    });
  });
  return state;
}
