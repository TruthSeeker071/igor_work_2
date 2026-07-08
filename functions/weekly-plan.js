// FlightWay 2.0 — Pillar B1 weekly Flight Plan endpoint.
//   GET  → this week's 3 tasks (stable per ISO week; done-state live from the roadmap)
//   POST { taskId, done } → mark the underlying roadmap step done/undone
// House pattern: originFromEnv + session-gated + schema-validated. Selection is
// deterministic (functions/_lib/weekly-plan-core.js); completion is single-sourced
// through the roadmap store so vector/progress stay consistent with Jacob's flow.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, clientIp } from './_lib/auth.js';
import { loadRoadmap, saveRoadmap } from './_lib/auth.js';
import {
  isoWeek, selectWeeklyTasks, applyDoneState, markStepDone, planProgress,
} from './_lib/weekly-plan-core.js';

const KV_TTL_SEC = 60 * 60 * 24 * 14; // keep a week's selection ~2 weeks
const RATE_LIMIT_MAX = 40;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const week = isoWeek();
  const tree = await loadRoadmap(env, email);
  if (!tree || !Array.isArray(tree.nodes) || !tree.nodes.length) {
    return jsonResponse(200, { week, tasks: [], progress: { done: 0, total: 0 }, empty: true }, origin);
  }

  const key = `wkplan:${email}:${week}`;
  let tasks = null;
  if (env.COACH_KV) {
    const saved = await env.COACH_KV.get(key);
    if (saved) { try { tasks = JSON.parse(saved); } catch { tasks = null; } }
  }
  if (!Array.isArray(tasks) || !tasks.length) {
    tasks = selectWeeklyTasks(tree, { limit: 3 });
    if (tasks.length && env.COACH_KV) {
      await env.COACH_KV.put(key, JSON.stringify(tasks), { expirationTtl: KV_TTL_SEC });
    }
  }
  tasks = applyDoneState(tasks, tree);
  return jsonResponse(200, { week, tasks, progress: planProgress(tasks), empty: tasks.length === 0 }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, `wkplan:${clientIp(request)}`, { max: RATE_LIMIT_MAX });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const taskId = String(body?.taskId || '');
  const done = !!body?.done;
  const sep = taskId.indexOf(':');
  if (sep <= 0) return jsonResponse(400, { error: 'Bad taskId.' }, origin);
  const waypointId = taskId.slice(0, sep);
  const stepId = taskId.slice(sep + 1);

  const tree = await loadRoadmap(env, email);
  if (!tree) return jsonResponse(404, { error: 'No roadmap yet.' }, origin);
  if (!markStepDone(tree, waypointId, stepId, done)) {
    return jsonResponse(404, { error: 'Task not found on your roadmap.' }, origin);
  }
  await saveRoadmap(env, email, tree);

  // Recompute the card's progress from the saved week selection.
  let tasks = [];
  if (env.COACH_KV) {
    const saved = await env.COACH_KV.get(`wkplan:${email}:${isoWeek()}`);
    if (saved) { try { tasks = applyDoneState(JSON.parse(saved), tree); } catch { tasks = []; } }
  }
  return jsonResponse(200, { ok: true, progress: planProgress(tasks) }, origin);
}
