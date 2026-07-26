// AI-generated weekly Flight Plan (v2). Generation is Gemini's job — turning
// every TRACKED waypoint's steps + semester plan + the user's actual progress
// state into 3-4 concretely scoped one-week tasks ("read ch. 4", "send 3
// emails"), with at least one task guaranteed per tracked waypoint.
// Everything around the call stays deterministic and testable: tracked-
// waypoint selection, prompt assembly inputs, response sanitizing (which also
// enforces the one-per-waypoint floor), and the fallback (the old step-lift
// selection, scoped to the tracked set) when Gemini is unavailable.

import { callGeminiJson } from './gemini-json.js';
// School reaches this prompt through buildSurfacePrompt (invariant 0.2).
import { groundedJson, GROUNDING_TTL } from './gemini-grounded.js';
import { waypointDisplayTitle } from './weekly-plan-core.js';
import { buildSurfacePrompt } from './marco-persona.js';

const TASKS_MIN = 3;
// Multi-track focus (up to 4 branches + spine): cap how many tracked
// waypoints feed one week's plan so the prompt and the task list stay bounded.
const MAX_TRACKED = 6;

/** First not-done waypoint on the active path (the user's current focus). */
export function currentWaypoint(tree) {
  if (!tree || !Array.isArray(tree.nodes)) return null;
  const byId = new Map(tree.nodes.map((n) => [n?.id, n]));
  const path = (Array.isArray(tree.activePath) ? tree.activePath : []).filter((id) => id !== 'trunk');
  const ordered = path.map((id) => byId.get(id)).filter(Boolean);
  const pool = ordered.length ? ordered : tree.nodes.filter(Boolean);
  return pool.find((n) => n && !n.done && Array.isArray(n.steps) && n.steps.length) || null;
}

const hasSteps = (n) => !!n && Array.isArray(n.steps) && n.steps.length > 0;
const isActionable = (n) => !!n && !n.done && hasSteps(n);

/**
 * First not-done, steps-bearing descendant of `anchorId` reached by walking
 * `pathRole: 'branch'` children (BFS via parentId). Used when a tracked
 * branchFocus's waypointId has gone stale (done, pruned, or a stepless
 * junction node) — keep walking that branch instead of dropping it.
 */
function firstActionableDescendant(tree, anchorId) {
  if (!anchorId) return null;
  const childrenByParent = new Map();
  (tree.nodes || []).forEach((n) => {
    if (n && n.parentId && n.pathRole === 'branch') {
      const list = childrenByParent.get(n.parentId) || [];
      list.push(n);
      childrenByParent.set(n.parentId, list);
    }
  });
  const queue = [...(childrenByParent.get(anchorId) || [])];
  const seen = new Set();
  while (queue.length) {
    const n = queue.shift();
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    if (isActionable(n)) return n;
    queue.push(...(childrenByParent.get(n.id) || []));
  }
  return null;
}

/**
 * Every waypoint the user is currently tracking (multi-track focus): the
 * spine's current waypoint (unless explicitly untracked via
 * focusTracker.spineTracked === false) plus one waypoint per tracked branch
 * in focusTracker.branchFocuses — spine first, deduped by node id, capped at
 * MAX_TRACKED. This is the aggregation universe for the whole Flight Plan:
 * generation, sanitize and the fallback all operate over exactly this set.
 */
export function trackedWaypointNodes(tree) {
  const out = [];
  const seen = new Set();
  const push = (n) => { if (n && n.id && !seen.has(n.id)) { seen.add(n.id); out.push(n); } };
  if (!tree || !Array.isArray(tree.nodes)) return out;
  const byId = new Map(tree.nodes.map((n) => [n?.id, n]));

  if (tree.focusTracker?.spineTracked !== false) push(currentWaypoint(tree));

  for (const entry of tree.focusTracker?.branchFocuses || []) {
    if (out.length >= MAX_TRACKED) break;
    const wpId = entry?.waypointId;
    let node = wpId ? byId.get(wpId) : null;
    if (!isActionable(node)) node = wpId ? firstActionableDescendant(tree, wpId) : null;
    if (node) push(node);
  }

  if (!out.length) push(currentWaypoint(tree));
  return out.slice(0, MAX_TRACKED);
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

/** One prompt block per tracked waypoint: title, why-it-matters, steps, plan sequence. */
function waypointBlock({ node, stepLines, planPhases }, i) {
  const stepsBlock = (stepLines || []).map((s) => `- [${s.id}] ${s.text} — ${s.state}`).join('\n');
  const planBlock = (planPhases || []).map((p) => `- ${p.weeks || ''} ${p.title}: ${(p.items || []).map((it) => it.text).join('; ')}`).join('\n');
  return `Waypoint ${i + 1} — waypointId "${node.id}": "${String(node.title || '').slice(0, 120)}"
Why it matters: ${String(node.whyItMatters || '').slice(0, 200)}

Steps with CURRENT progress:
${stepsBlock || '(no steps left)'}

Semester plan sequence (context for pacing):
${planBlock || '(none)'}`;
}

export function buildWeeklyPlanPrompt({ careerName, waypoints, prevTasks, notes, week, school, deadlines }) {
  const list = Array.isArray(waypoints) ? waypoints : [];
  const blocks = list.map((w, i) => waypointBlock(w, i)).join('\n\n---\n\n');
  const prevBlock = (prevTasks || []).map((t) => `- [${t.done ? 'DONE' : 'MISSED'}] ${t.label}`).join('\n');
  const notesBlock = (notes || []).map((n) => `- ${n.t}`).join('\n');
  // WS-D D4: at most ONE urgent date, and only when the roadmap work can
  // actually be pointed at it. A weekly plan that becomes a deadline list stops
  // being a plan.
  const nextDeadline = (deadlines || []).find((d) => d && d.title && d.deadline);
  const count = list.length;
  return `${buildSurfacePrompt('weekly-plan', { school })}

You are building ONE WEEK of concrete tasks (week ${week}) for a student working toward "${careerName}". They are actively tracking ${count} roadmap waypoint${count === 1 ? '' : 's'} at once — every one below needs forward motion this week. Return STRICT JSON only.

${blocks}

Last week's plan:
${prevBlock || '(first week — no prior plan)'}

Upcoming deadline (mention at most this ONE, and only if a task can genuinely move them toward it):
${nextDeadline ? `- ${nextDeadline.title} closes ${nextDeadline.deadline}` : '(none known — never invent one)'}

Progress the user reported in conversation recently:
${notesBlock || '(none)'}

Rules:
- Produce exactly ONE task for EACH waypoint listed above — its single most actionable next action. If that gives fewer than 3 tasks total, add the next-most-actionable tasks (from any waypoint's remaining steps) until you reach 3-4 tasks total. Never give one waypoint a second task while another listed waypoint still has zero.
- Each task is sized to genuinely FIT IN ONE WEEK alongside classes ("read ch. 4 of X", "send 3 networking emails", "complete lessons 2-3 of the course") — never a whole step verbatim unless it truly is a week of work.
- Build on progress: continue IN PROGRESS steps from where they are, never restart them. Skip DONE steps.
- Carry forward last week's MISSED tasks first (rescoped smaller if they were too big), then advance to new work in step/plan order.
- Each task carries "waypointId" (the bracketed waypointId above for the waypoint it advances) and "stepId" (the bracketed step id it advances; null only for glue work like scheduling or outreach).
- "advance": the fraction of that step this task completes (0.1-1.0, honest estimate).
- "carried": true when the task continues a MISSED task from last week.
- Plain, specific language. Name the object of every task. No markdown.

Return:
{"tasks":[{"label":"...","stepId":"id-or-null","waypointId":"id","advance":0.35,"carried":false}]}`;
}

/**
 * Clamp a model (or fallback) task list into the stored week-doc shape,
 * validating each task against the tracked waypoint it names. After
 * ingesting the model's tasks, ENFORCES the multi-track guarantee: any
 * tracked waypoint left with zero tasks gets its single most-actionable
 * not-done step lifted in deterministically — Gemini missing a waypoint
 * never means the user sees zero progress on it.
 */
export function sanitizeWeeklyTasks(rawTasks, trackedNodes, week) {
  const nodes = (Array.isArray(trackedNodes) ? trackedNodes : []).filter(Boolean);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const targetMax = Math.max(4, nodes.length);
  const out = [];

  (Array.isArray(rawTasks) ? rawTasks : []).forEach((t) => {
    if (out.length >= targetMax) return;
    const node = t?.waypointId != null ? nodesById.get(String(t.waypointId)) : null;
    if (!node) return; // must advance one of the tracked waypoints
    const label = String(t?.label || '').trim().slice(0, 120);
    if (!label) return;
    const stepIds = new Set((node.steps || []).map((s) => s?.id).filter(Boolean));
    const doneSteps = new Set((node.steps || []).filter((s) => s?.done).map((s) => s.id));
    let stepId = t?.stepId && stepIds.has(String(t.stepId)) ? String(t.stepId) : null;
    if (stepId && doneSteps.has(stepId)) return; // never re-issue a finished step
    out.push({
      id: `${week}-t${out.length + 1}`,
      label,
      stepId,
      waypointId: node.id,
      waypointTitle: waypointDisplayTitle(node),
      advance: Math.max(0.05, Math.min(1, Number(t?.advance) || 0.34)),
      carried: t?.carried === true,
      done: false,
      source: 'ai-week',
    });
  });

  // The guarantee: a tracked waypoint the model skipped still gets a task.
  // This can push the list past targetMax — covering every tracked waypoint
  // outranks the cap.
  const covered = new Set(out.map((t) => t.waypointId));
  nodes.forEach((node) => {
    if (covered.has(node.id)) return;
    const step = (node.steps || []).find((s) => s && s.id && !s.done);
    if (!step) return; // nothing left to lift for this waypoint
    out.push({
      id: `${week}-t${out.length + 1}`,
      label: String(step.text || '').slice(0, 120) || waypointDisplayTitle(node),
      stepId: step.id,
      waypointId: node.id,
      waypointTitle: waypointDisplayTitle(node),
      advance: 1,
      carried: false,
      done: false,
      source: 'waypoint',
    });
    covered.add(node.id);
  });

  return out;
}

/**
 * Deterministic fallback: lift each tracked waypoint's top not-done step
 * (the floor), then round-robin more of the SAME tracked waypoints' steps up
 * toward TASKS_MIN — never wanders into an untracked node. Old step-lift
 * selection, scoped to the tracked set, mapped into the v2 task shape.
 */
export function fallbackWeeklyTasks(tree, week) {
  const nodes = trackedWaypointNodes(tree);
  if (!nodes.length) return [];
  const targetMax = Math.max(4, nodes.length);
  const remaining = nodes.map((node) => (node.steps || []).filter((s) => s && s.id && !s.done));
  const out = [];
  const lift = (node, step) => out.push({
    id: `${week}-t${out.length + 1}`,
    label: String(step.text || '').slice(0, 100),
    stepId: step.id,
    waypointId: node.id,
    waypointTitle: waypointDisplayTitle(node),
    advance: 1,
    carried: false,
    done: false,
    source: 'waypoint',
  });

  // Floor: every tracked waypoint's top not-done step first.
  nodes.forEach((node, i) => {
    const step = remaining[i].shift();
    if (step) lift(node, step);
  });

  // Top up toward TASKS_MIN, round-robin across the same tracked waypoints so
  // no single one hogs the extra slots.
  let addedThisRound = true;
  while (out.length < TASKS_MIN && out.length < targetMax && addedThisRound) {
    addedThisRound = false;
    for (let i = 0; i < nodes.length; i++) {
      if (out.length >= TASKS_MIN || out.length >= targetMax) break;
      const step = remaining[i].shift();
      if (step) { lift(nodes[i], step); addedThisRound = true; }
    }
  }
  return out;
}

/**
 * Generate this week's plan across every tracked waypoint in ONE prompt.
 * Bounded degradation: a Gemini failure or a too-thin sanitized result falls
 * back to the fully deterministic selection — the card always renders
 * something, and every tracked waypoint always gets at least one task.
 */
export async function generateWeeklyPlan(env, tree, { week, fractions, prevTasks, notes, school, deadlines }) {
  const trackedNodes = trackedWaypointNodes(tree);
  if (!trackedNodes.length) return { tasks: fallbackWeeklyTasks(tree, week), generated: false };
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
        waypoints: trackedNodes.map((node) => ({
          node,
          stepLines: describeStepProgress(node, fractions),
          planPhases: node.semesterPlan?.plan?.phases || [],
        })),
        prevTasks: (prevTasks || []).slice(0, 6),
        notes: (notes || []).slice(-6),
        week,
        school,
        deadlines,
      }),
      temperature: 0.5,
      maxTokens: 1200,
      jsonMode: true,
      label: 'weekly-plan-gen',
      softFail: true,
      timeoutMs: 25000,
    });
    const tasks = sanitizeWeeklyTasks(raw?.tasks, trackedNodes, week);
    const totalRemaining = trackedNodes.reduce((sum, n) => sum + (n.steps || []).filter((s) => !s.done).length, 0);
    if (tasks.length >= TASKS_MIN || (tasks.length && tasks.length >= totalRemaining)) {
      // Provenance travels with the plan (fix plan 2.5): budget was spent on
      // a deadlines brief, so the student gets to see the "as of" date.
      return { tasks, generated: true, grounding: grounded ? { sources: sources || [], fetchedAt: fetchedAt || null } : null };
    }
  } catch (err) {
    console.warn('weekly-plan generation failed, using fallback', err?.message || err);
  }
  return { tasks: fallbackWeeklyTasks(tree, week), generated: false };
}
