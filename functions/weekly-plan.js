// Weekly Flight Plan endpoint (v2 — AI-generated, progress-aware).
//   GET  → this week's tasks: generated ONCE per ISO week from the current
//          waypoint + real progress state (fractions, last week's outcomes,
//          Marco-logged notes), then served from the stored week doc.
//   POST { taskId, done } → toggle a weekly task. Tasks accrue fractional
//          credit onto their roadmap step (rules engine in
//          _lib/flightplan-progress.js); a step crossing 1.0 flips done on
//          the tree, which drives the objective vector through
//          gap-progress-sync — the same single writer every save path uses.
// Legacy "waypointId:stepId" task ids from stale clients still work.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { resolveSchool } from './_lib/school.js';
import {
  getSessionEmail, checkRateLimit, clientIp,
  loadRoadmap, saveRoadmap,
} from './_lib/auth.js';
import { requirePlan } from './_lib/entitlements.js';
import { isoWeek, markStepDone, planProgress } from './_lib/weekly-plan-core.js';
import { generateWeeklyPlan, currentWaypoint } from './_lib/weekly-plan-gen.js';
import {
  loadProgressState, saveProgressState, accrueTaskToggle, reconcileFractionsWithTree,
} from './_lib/flightplan-progress.js';
import { syncGapProgressToQuiz } from './_lib/gap-progress-sync.js';

const KV_TTL_SEC = 60 * 60 * 24 * 21; // keep week docs ~3 weeks (prev-week carry-forward reads one back)
const RATE_LIMIT_MAX = 40;

const weekKey = (email, week) => `wkplan2:${email}:${week}`;

async function loadWeekDoc(env, email, week) {
  if (!env.COACH_KV) return null;
  try {
    const raw = await env.COACH_KV.get(weekKey(email, week));
    if (!raw) return null;
    const doc = JSON.parse(raw);
    return doc && Array.isArray(doc.tasks) ? doc : null;
  } catch {
    return null;
  }
}

async function saveWeekDoc(env, email, doc) {
  if (!env.COACH_KV) return;
  await env.COACH_KV.put(weekKey(email, doc.week), JSON.stringify(doc), { expirationTtl: KV_TTL_SEC });
}

// Signature of the inputs the weekly plan is generated FROM — the current
// waypoint plus its step text and semester-plan class content. When a Semester
// Plan edit changes a class (e.g. STAT 24400 → MATH 16100) or a step, the sig
// changes and the cached week doc is regenerated so the Flight Plan stays in
// lockstep. Step DONE-toggles don't change text (handled by refreshDoneState),
// so they never force a wasteful regen.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function weeklyInputSig(tree) {
  const node = currentWaypoint(tree);
  if (!node) return 'none';
  const steps = (node.steps || []).map((s) => `${s.id}=${String(s.text || '').trim()}`).join('|');
  const phases = node.semesterPlan && node.semesterPlan.plan && node.semesterPlan.plan.phases;
  const plan = Array.isArray(phases)
    ? phases.map((p) => `${p.title || ''}:${(p.items || []).map((it) => it.text || '').join(',')}`).join('|')
    : '';
  return hashStr(`${node.id}#${steps}#${plan}`);
}

// A task is done if checked this week OR its underlying step got completed
// elsewhere (roadmap page, Marco) — the card never nags about finished work.
function refreshDoneState(doc, tree) {
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

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  // Free/paid merge §1: the Weekly Flight Plan (plus its receipts and email
  // digest) is the paid tier's namesake feature.
  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) {
    return jsonResponse(402, { error: 'The Weekly Flight Plan is a Flight Plan feature.', upgrade: true, feature: 'weekly-plan' }, origin);
  }

  const week = isoWeek();
  const tree = await loadRoadmap(env, email);
  if (!tree || !Array.isArray(tree.nodes) || !tree.nodes.length) {
    return jsonResponse(200, { week, tasks: [], progress: { done: 0, total: 0 }, empty: true }, origin);
  }

  const sig = weeklyInputSig(tree);
  let doc = await loadWeekDoc(env, email, week);
  // Regenerate when there's no doc for the week OR the Semester Plan inputs the
  // last plan was built from have since changed (keeps the Flight Plan in sync).
  if (!doc || doc.sig !== sig) {
    const state = reconcileFractionsWithTree(await loadProgressState(env, email), tree);
    const prevDoc = state.lastWeek && state.lastWeek !== week
      ? await loadWeekDoc(env, email, state.lastWeek)
      : null;
    const { tasks, generated, grounding } = await generateWeeklyPlan(env, tree, {
      week,
      fractions: state.fractions,
      prevTasks: prevDoc ? prevDoc.tasks.map((t) => ({ label: t.label, done: !!t.done, stepId: t.stepId })) : [],
      notes: state.notes,
      school: await resolveSchool(env, email).catch(() => ''),
    });
    doc = { week, sig, tasks, generated, generatedAt: new Date().toISOString(), ...(grounding ? { grounding } : {}) };
    if (tasks.length) await saveWeekDoc(env, email, doc);
    state.lastWeek = week;
    await saveProgressState(env, email, state);
  }
  doc = refreshDoneState(doc, tree);
  return jsonResponse(200, {
    week,
    tasks: doc.tasks,
    progress: planProgress(doc.tasks),
    empty: doc.tasks.length === 0,
    generated: !!doc.generated,
    grounding: doc.grounding || null,
  }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  // Free/paid merge §1: the Weekly Flight Plan (plus its receipts and email
  // digest) is the paid tier's namesake feature.
  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) {
    return jsonResponse(402, { error: 'The Weekly Flight Plan is a Flight Plan feature.', upgrade: true, feature: 'weekly-plan' }, origin);
  }

  try {
    await checkRateLimit(env, `wkplan:${clientIp(request)}`, { max: RATE_LIMIT_MAX });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const taskId = String(body?.taskId || '');
  const done = !!body?.done;
  if (!taskId) return jsonResponse(400, { error: 'Bad taskId.' }, origin);

  const tree = await loadRoadmap(env, email);
  if (!tree) return jsonResponse(404, { error: 'No roadmap yet.' }, origin);

  const week = isoWeek();
  let doc = await loadWeekDoc(env, email, week);
  const task = doc ? doc.tasks.find((t) => t.id === taskId) : null;

  let treeChanged = false;
  let waypointId = '';

  if (task) {
    task.done = done;
    await saveWeekDoc(env, email, doc);
    waypointId = task.waypointId || '';
    if (task.stepId) {
      const state = await loadProgressState(env, email);
      const accrued = accrueTaskToggle(state, task, done);
      await saveProgressState(env, email, state);
      if (accrued) {
        const node = tree.nodes.find((n) => n && n.id === task.waypointId);
        const step = node && (node.steps || []).find((s) => s && s.id === task.stepId);
        if (step && !!step.done !== accrued.stepDone) {
          treeChanged = markStepDone(tree, task.waypointId, task.stepId, accrued.stepDone);
        }
      }
    }
  } else {
    // Legacy path: "waypointId:stepId" ids from a stale client or old week doc.
    const sep = taskId.indexOf(':');
    if (sep <= 0) return jsonResponse(404, { error: 'Task not found on your plan.' }, origin);
    waypointId = taskId.slice(0, sep);
    if (!markStepDone(tree, waypointId, taskId.slice(sep + 1), done)) {
      return jsonResponse(404, { error: 'Task not found on your roadmap.' }, origin);
    }
    treeChanged = true;
  }

  let objective = null;
  if (treeChanged) {
    await saveRoadmap(env, email, tree);
    try {
      objective = await syncGapProgressToQuiz(env, email, tree);
      if (objective) objective.objectivePatched = true;
    } catch (err) {
      console.warn('weekly-plan vector sync failed', err?.message || err);
    }
  }

  const node = tree.nodes.find((n) => n && n.id === waypointId);
  const out = {
    ok: true,
    progress: doc ? planProgress(refreshDoneState(doc, tree).tasks) : { done: 0, total: 0 },
    waypointDone: !!(node && node.done),
    waypointTitle: node ? String(node.shortTitle || node.title || '') : '',
    waypointId,
    roadmap: treeChanged ? tree : undefined,
  };
  if (objective) {
    out.objectivePatched = objective.objectivePatched;
    out.objectiveVector = objective.objectiveVector;
    out.objectiveAiPatch = objective.objectiveAiPatch;
  }
  return jsonResponse(200, out, origin);
}
