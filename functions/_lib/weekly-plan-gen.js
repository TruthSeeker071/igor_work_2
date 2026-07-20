// AI-generated weekly Flight Plan (v2). Generation is Gemini's job — turning
// a waypoint's steps + semester plan + the user's actual progress state into
// 3-5 concretely scoped one-week tasks ("read ch. 4", "send 3 emails").
// Everything around the call stays deterministic and testable: current-
// waypoint selection, prompt assembly inputs, response sanitizing, and the
// fallback (the old step-lift selection) when Gemini is unavailable.

import { callGeminiJson } from './gemini-json.js';
import { schoolPromptBlock } from './school.js';
import { groundedJson, GROUNDING_TTL } from './gemini-grounded.js';
import { selectWeeklyTasks } from './weekly-plan-core.js';

const TASKS_MIN = 3;
const TASKS_MAX = 5;

/** First not-done waypoint on the active path (the user's current focus). */
export function currentWaypoint(tree) {
  if (!tree || !Array.isArray(tree.nodes)) return null;
  const byId = new Map(tree.nodes.map((n) => [n?.id, n]));
  const path = (Array.isArray(tree.activePath) ? tree.activePath : []).filter((id) => id !== 'trunk');
  const ordered = path.map((id) => byId.get(id)).filter(Boolean);
  const pool = ordered.length ? ordered : tree.nodes.filter(Boolean);
  return pool.find((n) => n && !n.done && Array.isArray(n.steps) && n.steps.length) || null;
}

/** Compact progress description per step: done / fraction / not started. */
export function describeStepProgress(node, fractions) {
  return (node?.steps || []).map((s) => {
    const key = `${node.id}:${s.id}`;
    const f = Number(fractions?.[key]) || 0;
    const state = s.done ? 'DONE' : f > 0 ? `IN PROGRESS (~${Math.round(f * 100)}%)` : 'not started';
    return { id: s.id, text: String(s.text || '').slice(0, 140), state };
  });
}

export function buildWeeklyPlanPrompt({ careerName, node, stepLines, planPhases, prevTasks, notes, week, school }) {
  const stepsBlock = stepLines.map((s) => `- [${s.id}] ${s.text} — ${s.state}`).join('\n');
  const planBlock = (planPhases || []).map((p) => `- ${p.weeks || ''} ${p.title}: ${(p.items || []).map((it) => it.text).join('; ')}`).join('\n');
  const prevBlock = (prevTasks || []).map((t) => `- [${t.done ? 'DONE' : 'MISSED'}] ${t.label}`).join('\n');
  const notesBlock = (notes || []).map((n) => `- ${n.t}`).join('\n');
  return `You are a career coach building ONE WEEK of concrete tasks (week ${week}) for a student working toward "${careerName}". Their roadmap waypoint and real progress are below. Return STRICT JSON only.

${schoolPromptBlock(school)}

Waypoint: "${String(node.title || '').slice(0, 120)}"
Why it matters: ${String(node.whyItMatters || '').slice(0, 200)}

Waypoint steps with CURRENT progress:
${stepsBlock}

Semester plan sequence (context for pacing):
${planBlock || '(none)'}

Last week's plan:
${prevBlock || '(first week — no prior plan)'}

Progress the user reported in conversation recently:
${notesBlock || '(none)'}

Rules:
- 3-5 tasks, each sized to genuinely FIT IN ONE WEEK alongside classes ("read ch. 4 of X", "send 3 networking emails", "complete lessons 2-3 of the course") — never a whole step verbatim unless it truly is a week of work.
- Build on progress: continue IN PROGRESS steps from where they are, never restart them. Skip DONE steps.
- Carry forward last week's MISSED tasks first (rescoped smaller if they were too big), then advance to new work in step/plan order.
- Each task maps to the step it advances via "stepId" (use the bracketed ids; null only for glue work like scheduling or outreach).
- "advance": the fraction of that step this task completes (0.1-1.0, honest estimate).
- "carried": true when the task continues a MISSED task from last week.
- Plain, specific language. Name the object of every task. No markdown.

Return:
{"tasks":[{"label":"...","stepId":"id-or-null","advance":0.35,"carried":false}]}`;
}

/** Clamp a model (or fallback) task list into the stored week-doc shape. */
export function sanitizeWeeklyTasks(rawTasks, node, week) {
  const stepIds = new Set((node?.steps || []).map((s) => s?.id).filter(Boolean));
  const doneSteps = new Set((node?.steps || []).filter((s) => s?.done).map((s) => s.id));
  const out = [];
  (Array.isArray(rawTasks) ? rawTasks : []).forEach((t) => {
    if (out.length >= TASKS_MAX) return;
    const label = String(t?.label || '').trim().slice(0, 120);
    if (!label) return;
    let stepId = t?.stepId && stepIds.has(String(t.stepId)) ? String(t.stepId) : null;
    if (stepId && doneSteps.has(stepId)) return; // never re-issue a finished step
    out.push({
      id: `${week}-t${out.length + 1}`,
      label,
      stepId,
      waypointId: node.id,
      waypointTitle: String(node.shortTitle || node.title || '').slice(0, 80),
      advance: Math.max(0.05, Math.min(1, Number(t?.advance) || 0.34)),
      carried: t?.carried === true,
      done: false,
      source: 'ai-week',
    });
  });
  return out.length >= 1 ? out : [];
}

/** Deterministic fallback: old step-lift selection mapped into v2 shape. */
export function fallbackWeeklyTasks(tree, week) {
  return selectWeeklyTasks(tree, { limit: 3 }).map((t, i) => ({
    id: `${week}-t${i + 1}`,
    label: t.label,
    stepId: t.stepId,
    waypointId: t.waypointId,
    waypointTitle: t.waypointTitle,
    advance: 1,
    carried: false,
    done: false,
    source: 'waypoint',
  }));
}

/**
 * Generate this week's plan. Bounded degradation: a Gemini failure or an
 * empty sanitize falls back to the deterministic selection — the card always
 * renders something.
 */
export async function generateWeeklyPlan(env, tree, { week, fractions, prevTasks, notes, school }) {
  const node = currentWaypoint(tree);
  if (!node) return { tasks: fallbackWeeklyTasks(tree, week), generated: false };
  const careerName = tree.targetCareerName || 'your target career';
  try {
    // Pillar W (Tier B): current opportunities/deadlines brief, globally
    // cached per career. Flag off → byte-identical ungrounded call.
    // VOLATILE tier: this is the one caller where freshness matters most —
    // a lapsed deadline served for 14 days (SEMI_STABLE) is actively harmful.
    const { result: raw, sources, fetchedAt, grounded } = await groundedJson(env, {
      research: tree.targetCareerName
        ? [`programs, competitions and opportunities with upcoming deadlines for students pursuing ${careerName}`]
        : [],
      freshnessTtl: GROUNDING_TTL.VOLATILE,
      researchTimeoutMs: 6000,
      prompt: buildWeeklyPlanPrompt({
        careerName,
        node,
        stepLines: describeStepProgress(node, fractions),
        planPhases: node.semesterPlan?.plan?.phases || [],
        prevTasks: (prevTasks || []).slice(0, 6),
        notes: (notes || []).slice(-6),
        week,
        school,
      }),
      temperature: 0.5,
      maxTokens: 1200,
      jsonMode: true,
      label: 'weekly-plan-gen',
      softFail: true,
      timeoutMs: 25000,
    });
    const tasks = sanitizeWeeklyTasks(raw?.tasks, node, week);
    if (tasks.length >= TASKS_MIN || (tasks.length && tasks.length >= (node.steps || []).filter((s) => !s.done).length)) {
      // Provenance travels with the plan (fix plan 2.5): budget was spent on
      // a deadlines brief, so the student gets to see the "as of" date.
      return { tasks, generated: true, grounding: grounded ? { sources: sources || [], fetchedAt: fetchedAt || null } : null };
    }
  } catch (err) {
    console.warn('weekly-plan generation failed, using fallback', err?.message || err);
  }
  return { tasks: fallbackWeeklyTasks(tree, week), generated: false };
}
