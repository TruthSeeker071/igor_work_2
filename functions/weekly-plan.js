// Weekly Flight Plan endpoint (v2 — AI-generated, progress-aware).
//   GET  → this week's tasks: generated ONCE per ISO week from the current
//          waypoint + real progress state (fractions, last week's outcomes,
//          Marco-logged notes), then served from the stored week doc.
//   POST { taskId, done } → toggle a weekly task. Tasks accrue fractional
//          credit onto their roadmap step (rules engine in
//          _lib/flightplan-progress.js); a step crossing 1.0 flips done on
//          the tree, which drives the objective vector through
//          gap-progress-sync — the same single writer every save path uses.
//   POST { commitment: {nodeId, stepId, action, dueAt?, effort?} } → S10.
//          Set/move/clear a date on a roadmap step, or tick it off, from the
//          Flight Plan page. Same endpoint rather than a new one because this
//          handler already holds the loaded tree, the save, and the vector
//          re-sync — the three things a commitment write needs.
// Legacy "waypointId:stepId" task ids from stale clients still work.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { resolveSchool } from './_lib/school.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, loadRoadmap, saveRoadmap } from './_lib/auth.js';
import { isoWeek, markStepDone, planProgress, waypointDisplayTitle } from './_lib/weekly-plan-core.js';
import { generateWeeklyPlan } from './_lib/weekly-plan-gen.js';
// S11: the week doc's key/read/write/signature moved to a shared store because
// the Monday digest now generates the same doc on send. Two definitions of
// `sig` would mean the page regenerating (and re-paying for) the week the
// digest just built.
import { loadWeekDoc, saveWeekDoc, weeklyInputSig, refreshDoneState } from './_lib/weekly-plan-store.js';
import {
  loadProgressState, saveProgressState, accrueTaskToggle, reconcileFractionsWithTree,
} from './_lib/flightplan-progress.js';
import { syncGapProgressToQuiz } from './_lib/gap-progress-sync.js';
import { loadUpcomingDeadlines } from './_lib/deadlines.js';
import { nextTracked } from './_lib/deadline-store.js';
import { daysUntil } from './_lib/deadline-core.js';
import { collectCommitments, applyCommitment } from './_lib/commitments.js';
import { loadUserBlob } from './_lib/user.js';

const RATE_LIMIT_MAX = 40;
// Not a plan cap (commitments are free and unmetered, §4) — a response-size
// bound, so a student who dated forty steps does not ship forty rows to a
// module that shows the next handful. The list is sorted, so the cut is always
// from the far end of the future.
const MAX_COMMITMENTS_OUT = 25;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  try {
    return await buildWeeklyPlanResponse(context, origin);
  } catch (err) {
    // Without this the runtime turns any exception here into a bare 500 with
    // no log line — the exact shape of both production outages. Status maps
    // the way chat.js does: an exhausted upstream cascade already carries 429
    // (load) or 503 (down); anything else is ours, and is ours to own as 500.
    console.error('weekly-plan GET failed', err && err.stack ? err.stack : err);
    const status = err && (err.status === 429 || err.status === 503) ? err.status : 500;
    return jsonResponse(status, {
      error: err && err._userFacing ? err.message : 'Could not load your weekly plan.',
    }, origin);
  }
}

async function buildWeeklyPlanResponse(context, origin) {
  const { request, env } = context;
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  // V2 §4 (D1): the weekly loop is FREE forever — it is the habit the whole
  // product is built around, and S7 made it a primary nav tab. Deliberately
  // unmetered: one generation per user per WEEK is the cheapest recurring
  // Gemini call in the product, and metering the core habit is self-harm.

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
    // D4: the same cached deadlines Marco's rail and chat context read — one
    // KV get, [] when the finder has never run. The prompt uses at most one.
    const deadlines = await loadUpcomingDeadlines(env, email, {
      quiz: await loadUserBlob(env, email).catch(() => null),
      roadmap: tree,
      limit: 1,
    }).catch(() => []);
    const { tasks, generated, grounding } = await generateWeeklyPlan(env, tree, {
      week,
      fractions: state.fractions,
      prevTasks: prevDoc ? prevDoc.tasks.map((t) => ({ label: t.label, done: !!t.done, stepId: t.stepId })) : [],
      notes: state.notes,
      school: await resolveSchool(env, email).catch(() => ''),
      deadlines,
    });
    doc = {
      week,
      sig,
      tasks,
      generated,
      generatedAt: new Date().toISOString(),
      ...(grounding ? { grounding } : {}),
      // S7: the This Week hero's deadline chip. Captured HERE, on the once-a-week
      // regeneration path, rather than read on every GET — the lookup costs a D1
      // blob read plus a KV get, and the Flight Plan page is now a nav tab that
      // gets hit on every visit. `daysOut` is deliberately NOT stored: it is
      // recomputed from `deadline` at response time, so a doc written on Monday
      // still says the right thing on Friday.
      ...(deadlines[0] ? { nextDeadline: stripDaysOut(deadlines[0]) } : {}),
    };
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
    // S9: the Deadline Radar wins when it has a tracked row. One small indexed
    // D1 read on a page that already loads the roadmap blob — cheap, and it is
    // what stops the hero chip and the radar list directly beneath it from
    // quoting different "next" deadlines at the same student. The week doc's
    // snapshot stays as the fallback for accounts whose radar is still empty.
    nextDeadline: (await nextTracked(env, email).catch(() => null)) || freshDeadline(doc.nextDeadline),
    // S10: read straight off the tree this handler already loaded — zero extra
    // reads, and recomputed per GET so `daysOut`/`overdue` are never a stale
    // snapshot the way a stored copy would be by Friday. Deliberately NOT fed
    // into the generation prompt: that would put commitments into
    // `weeklyInputSig`, and every date change would then burn a Gemini
    // regeneration of a week the student is already living in.
    commitments: collectCommitments(tree).slice(0, MAX_COMMITMENTS_OUT),
  }, origin);
}

// The stored record minus the volatile field (see the doc comment at the write).
function stripDaysOut(d) {
  return { title: d.title, org: d.org || '', url: d.url || '', deadline: d.deadline };
}

// Re-dates a stored deadline against now, and drops it once it has passed —
// a chip that says "closes in -3 days" is worse than no chip. daysUntil is
// UTC-midnight-anchored on both sides (see the note in _lib/deadlines.js): the
// arithmetic this replaced drifted with the time of day and hid a deadline
// closing TODAY from every afternoon reader.
function freshDeadline(d) {
  if (!d || !d.deadline || !d.title) return null;
  const daysOut = daysUntil(d.deadline, Date.now());
  if (!Number.isFinite(daysOut) || daysOut < 0) return null;
  return { ...stripDaysOut(d), daysOut };
}

const COMMITMENT_ACTIONS = new Set(['set', 'clear', 'done', 'undone']);

/**
 * Set / move / clear a date on a roadmap step, or tick it off, from the Flight
 * Plan page. Free and unmetered: §4 says the weekly loop is the habit and the
 * habit is never metered, and a commitment is the habit's whole point.
 *
 * Authorization is structural rather than a check: the tree is loaded BY EMAIL
 * from the session, so a nodeId/stepId belonging to someone else simply is not
 * in it and `applyCommitment` returns unchanged. There is no id space in which
 * one user can name another user's step.
 *
 * The vector re-sync runs only when the DONE state actually moved. Putting a
 * date on a step changes no progress, and `syncGapProgressToQuiz` is the single
 * writer for the objective vector — calling it on a no-op would churn vector
 * timestamps on every date picker click.
 */
async function handleCommitmentWrite(env, email, raw, origin) {
  const nodeId = String(raw.nodeId || '').trim().slice(0, 48);
  const stepId = String(raw.stepId || '').trim().slice(0, 48);
  const action = String(raw.action || '').trim().toLowerCase();
  if (!nodeId || !stepId) return jsonResponse(400, { error: 'Missing nodeId or stepId.' }, origin);
  if (!COMMITMENT_ACTIONS.has(action)) return jsonResponse(400, { error: 'Unknown commitment action.' }, origin);

  const tree = await loadRoadmap(env, email);
  if (!tree) return jsonResponse(404, { error: 'No roadmap yet.' }, origin);

  const result = applyCommitment(tree, nodeId, stepId, {
    action,
    dueAt: raw.dueAt,
    effort: raw.effort,
  });
  if (!result.changed) {
    // Two different nothings — a step that is not on your tree, and a click
    // that asked for the state it already had. The second is not an error.
    const known = (tree.nodes || []).some((n) => n?.id === nodeId
      && (n.steps || []).some((s) => s?.id === stepId));
    if (!known) return jsonResponse(404, { error: 'That step is not on your roadmap.' }, origin);
    return jsonResponse(200, { ok: true, changed: false, commitments: collectCommitments(tree).slice(0, MAX_COMMITMENTS_OUT) }, origin);
  }

  await saveRoadmap(env, email, result.roadmap);

  const out = {
    ok: true,
    changed: true,
    commitment: result.commitment,
    commitments: collectCommitments(result.roadmap).slice(0, MAX_COMMITMENTS_OUT),
  };
  if (result.doneChanged) {
    try {
      const objective = await syncGapProgressToQuiz(env, email, result.roadmap);
      if (objective) {
        out.objectivePatched = true;
        out.objectiveVector = objective.objectiveVector;
        out.objectiveAiPatch = objective.objectiveAiPatch;
      }
    } catch (err) {
      console.warn('commitment vector sync failed', err?.message || err);
    }
    out.roadmap = result.roadmap;
  }
  return jsonResponse(200, out, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  // V2 §4 (D1): the weekly loop is FREE forever — it is the habit the whole
  // product is built around, and S7 made it a primary nav tab. Deliberately
  // unmetered: one generation per user per WEEK is the cheapest recurring
  // Gemini call in the product, and metering the core habit is self-harm.

  try {
    await checkRateLimit(env, `wkplan:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }

  // S10 commitment write. Branches before the task path because it shares only
  // the session, the tree and the save — none of the week-doc machinery.
  if (body && body.commitment && typeof body.commitment === 'object') {
    return await handleCommitmentWrite(env, email, body.commitment, origin);
  }

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
    waypointTitle: node ? waypointDisplayTitle(node) : '',
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
