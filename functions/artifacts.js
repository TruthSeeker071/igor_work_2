// FlightWay 2.0 — Pillar B3 artifacts (portfolio evidence) + gap evidence bridge.
//   GET  → the user's logged artifacts (newest first)
//   POST { type, title, note?, waypointId?, gapId?, dimIndex? } → log one
// When gapId is set, also stamps a high-weight evidence log on that skill gap
// and applies gap-progress to the objective vector (canonical evidence pipeline).

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { loadUserBlob, saveUserBlob } from './_lib/user.js';
import {
  getSessionEmail,
  checkRateLimit,
  clientIp,
  generateToken,
  loadRoadmap,
  saveRoadmap,
} from './_lib/auth.js';
import { mergeObjectiveAiPatch, applyObjectiveAiPatch } from './_lib/onet/objective-patch.js';

const TYPES = new Set(['repo', 'doc', 'analysis', 'design', 'other']);
/** Fixed high weight for portfolio artifacts (typed notes max at 12; artifacts sit near the top). */
const ARTIFACT_WEIGHT = { repo: 10, analysis: 10, design: 9, doc: 8, other: 8 };

function gapEvidencePct(gap) {
  const logs = (gap && gap.logs) || [];
  if (!logs.length) return 0;
  let sum = 0;
  logs.forEach((l) => { sum += (l && Number(l.w)) || 2; });
  return Math.min(30, Math.round(sum));
}

function syncGapProgress(gap) {
  const checklist = gap.checklist || [];
  const cl = checklist.length
    ? Math.round((checklist.filter((c) => c && c.done).length / checklist.length) * 100)
    : 0;
  const ev = gapEvidencePct(gap);
  const manual = gap.manualComplete ? 100 : 0;
  const progress = Math.min(100, Math.max(Math.min(100, cl + ev), manual));
  const status = progress >= 100 ? 'closed' : progress > 0 ? 'in_progress' : 'open';
  return { ...gap, progress, status };
}

async function stampGapEvidence(env, email, { gapId, dimIndex, type, title, note, artifactId, replaceLogId }) {
  const tree = await loadRoadmap(env, email).catch(() => null);
  if (!tree || !tree.focusTracker || !Array.isArray(tree.focusTracker.skillGaps)) {
    return { stamped: false };
  }
  const gaps = tree.focusTracker.skillGaps;
  let gap = gaps.find((g) => g && g.id === gapId);
  if (!gap && Number.isInteger(dimIndex)) {
    gap = gaps.find((g) => g && g.dimIndex === dimIndex);
  }
  if (!gap) return { stamped: false };

  const w = ARTIFACT_WEIGHT[type] || 8;
  const text = `[artifact:${type}] ${title}${note ? ' — ' + note : ''}`.slice(0, 280);
  const log = {
    id: 'art-' + (artifactId || generateToken(8)),
    text,
    at: new Date().toISOString(),
    w,
    artifactId: artifactId || null,
  };
  const replaceId = replaceLogId ? String(replaceLogId) : null;
  const nextGaps = gaps.map((g) => {
    if (g !== gap && g.id !== gap.id) return g;
    let prior = g.logs || [];
    if (replaceId) {
      prior = prior.filter((l, i) => {
        const id = (l && l.id) || ('log-legacy-' + g.id + '-' + i);
        return id !== replaceId;
      });
    }
    const logs = [log, ...prior].slice(0, 12);
    return syncGapProgress({ ...g, logs });
  });
  const updated = {
    ...tree,
    focusTracker: {
      ...tree.focusTracker,
      skillGaps: nextGaps,
      updatedAt: new Date().toISOString(),
    },
  };
  await saveRoadmap(env, email, updated);

  const stamped = nextGaps.find((g) => g.id === gap.id) || gap;
  let objectiveVector = null;
  let objectiveAiPatch = null;
  // Move objective vector the same way gap-progress does.
  try {
    const quiz = await loadUserBlob(env, email);
    if (quiz && Number.isInteger(stamped.dimIndex)) {
      const checklist = stamped.checklist || [];
      const doneCount = checklist.filter((c) => c && c.done).length;
      const totalCount = Math.max(1, checklist.length);
      const b = Math.max(0, Math.min(100, Number(stamped.vBase != null ? stamped.vBase : stamped.user) || 0));
      const t = Math.max(0, Math.min(100, Number(stamped.target) || 0));
      const span = Math.max(0, t - b);
      const evidencePct = gapEvidencePct(stamped);
      let value = b + span * Math.min(0.9, 0.6 * (doneCount / totalCount) + evidencePct / 100);
      if (stamped.manualComplete) value = Math.max(value, b + span * 0.9);
      value = Math.round(Math.max(b, Math.min(100, value)));
      objectiveAiPatch = mergeObjectiveAiPatch(quiz.objectiveAiPatch, [{
        index: stamped.dimIndex, value,
      }], 'artifact-evidence');
      objectiveVector = applyObjectiveAiPatch(quiz.objectiveVector, objectiveAiPatch);
      await saveUserBlob(env, email, {
        ...quiz,
        objectiveVector,
        objectiveAiPatch,
        objectiveSkipped: false,
      });
      return {
        stamped: true,
        gapId: stamped.id,
        dimIndex: stamped.dimIndex,
        value,
        roadmap: updated,
        objectiveVector,
        objectiveAiPatch,
      };
    }
  } catch (err) {
    console.warn('artifact gap-progress failed', err?.message || err);
  }
  return {
    stamped: true,
    gapId: stamped.id,
    dimIndex: stamped.dimIndex,
    roadmap: updated,
    objectiveVector,
    objectiveAiPatch,
  };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  let artifacts = [];
  try {
    const r = await env.DB.prepare(
      'SELECT id, waypoint_id, gap_id, dim_index, type, title, note, created_at FROM artifacts WHERE email = ? ORDER BY created_at DESC LIMIT 50',
    ).bind(email).all();
    artifacts = (r.results || []).map((a) => ({
      id: a.id,
      waypointId: a.waypoint_id,
      gapId: a.gap_id,
      dimIndex: a.dim_index,
      type: a.type,
      title: a.title,
      note: a.note,
      createdAt: a.created_at,
    }));
  } catch (err) {
    console.error('artifacts list failed', err?.message || err);
  }
  return jsonResponse(200, { artifacts }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, `artifact:${clientIp(request)}`, { max: 30 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const type = String(body?.type || '').toLowerCase();
  const title = String(body?.title || '').trim().slice(0, 120);
  const note = String(body?.note || '').trim().slice(0, 200);
  const waypointId = (String(body?.waypointId || '').slice(0, 64)) || null;
  const gapId = (String(body?.gapId || '').slice(0, 64)) || null;
  const dimRaw = body?.dimIndex;
  const dimIndex = dimRaw === null || dimRaw === undefined || dimRaw === ''
    ? null
    : Number(dimRaw);
  const replaceLogId = body?.replaceLogId ? String(body.replaceLogId).slice(0, 64) : null;

  if (!TYPES.has(type)) return jsonResponse(400, { error: 'Pick an artifact type.' }, origin);
  if (title.length < 2) return jsonResponse(400, { error: 'Give your artifact a title.' }, origin);
  if (dimIndex != null && (!Number.isInteger(dimIndex) || dimIndex < 0 || dimIndex >= 161)) {
    return jsonResponse(400, { error: 'Invalid dimIndex.' }, origin);
  }

  const id = generateToken(12);
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO artifacts (id, email, waypoint_id, gap_id, dim_index, type, title, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, email, waypointId, gapId, dimIndex, type, title, note || null, createdAt).run();
  } catch (err) {
    console.error('artifact insert failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not save your artifact.' }, origin);
  }

  let gapStamp = { stamped: false };
  if (gapId || dimIndex != null) {
    try {
      gapStamp = await stampGapEvidence(env, email, {
        gapId, dimIndex, type, title, note, artifactId: id, replaceLogId,
      });
    } catch (err) {
      console.warn('stampGapEvidence failed', err?.message || err);
    }
  }

  const out = {
    ok: true,
    artifact: { id, waypointId, gapId, dimIndex, type, title, note, createdAt },
    gapStamp: {
      stamped: !!gapStamp.stamped,
      gapId: gapStamp.gapId,
      dimIndex: gapStamp.dimIndex,
      value: gapStamp.value,
    },
  };
  if (gapStamp.roadmap) out.roadmap = gapStamp.roadmap;
  if (gapStamp.objectiveVector) out.objectiveVector = gapStamp.objectiveVector;
  if (gapStamp.objectiveAiPatch) out.objectiveAiPatch = gapStamp.objectiveAiPatch;
  return jsonResponse(200, out, origin);
}
