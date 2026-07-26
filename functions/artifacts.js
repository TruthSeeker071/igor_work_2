// FlightWay 2.0 — Pillar B3 artifacts (portfolio evidence) + gap evidence bridge.
//   GET  ?attribution=1                                    → the Evidence Locker
//   POST { type, title, note?, url?, waypointId?, gapId? }  → log one
//   POST { action:'update', id, ... }                       → edit its metadata
//   POST { action:'delete', id }                            → remove it
// When gapId is set, also stamps a high-weight evidence log on that skill gap
// and applies gap-progress to the objective vector (canonical evidence pipeline).
//
// S12 (plan §5): `?attribution=1` loads the roadmap and asks
// `_lib/evidence-locker.js` how much of the student's objective vector each
// artifact is responsible for. That module is READ-ONLY.
//
// VECTOR WRITES: this file has no formula of its own. Logging, editing and
// deleting evidence all mutate the roadmap tree and then hand it to
// `syncGapProgressToQuiz` — the single writer of the objective vector since the
// 2026-07-10 streamlining. Both directions matter: logging proof moves a
// coordinate and deleting proof moves it back, and both land on the same number
// because both are an absolute recomputation of the same tree.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, generateToken, loadRoadmap, saveRoadmap } from './_lib/auth.js';
// No `loadUserBlob`/`saveUserBlob` and no `mergeObjectiveAiPatch`/
// `applyObjectiveAiPatch` here on purpose: this file writes the objective
// vector through gap-progress-sync.js and nowhere else, and the absence of
// those imports is what makes that checkable at a glance.
import { syncGapProgressToQuiz, computeGapProgressDims } from './_lib/gap-progress-sync.js';
import { attributeArtifacts } from './_lib/evidence-locker.js';
// One https-only URL sanitizer for the whole product; an artifact link and an
// application link are the same kind of untrusted string.
import { sanitizeUrl } from './_lib/application-core.js';

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
  const out = {
    stamped: true,
    gapId: stamped.id,
    dimIndex: stamped.dimIndex,
    roadmap: updated,
    objectiveVector: null,
    objectiveAiPatch: null,
  };

  // The objective vector moves through the SINGLE WRITER, never a second copy
  // of the formula (the 2026-07-10 invariant).
  //
  // Until 2026-07-24 this block computed the value itself, and it computed a
  // DIFFERENT one: `0.6 * (checklistDone / checklistTotal)` where the canonical
  // `computeGapProgressDims` uses a step ratio over the active-path waypoints
  // that address the gap, taking `max(stepRatio, checklistRatio)` and falling
  // back to whole-path completion when no waypoint names the gap. So logging an
  // artifact wrote value A and the very next roadmap or weekly-plan save
  // converged the same dimension to value B. Nothing was corrupted — absolute
  // recomputation is self-healing, which is exactly why the divergence could
  // live here unnoticed — but the student could watch a coordinate they had
  // just been shown change a minute later for no reason they could see.
  //
  // Two consequences of the switch, both intended:
  //   * a redundant write is now a no-op. `syncGapProgressToQuiz` returns null
  //     when every dimension already holds its computed value, so an artifact
  //     logged against a gap already at the 30-point evidence cap no longer
  //     churns the vector's timestamp — and the locker's attribution line
  //     already says that artifact moved nothing.
  //   * every gap's dimension converges, not just this one. That is what all
  //     four other callers of this function do on every save; the only change
  //     is that the artifact path stopped being the exception.
  try {
    if (Number.isInteger(stamped.dimIndex)) {
      const synced = await syncGapProgressToQuiz(env, email, updated);
      if (synced) {
        out.objectiveVector = synced.objectiveVector;
        out.objectiveAiPatch = synced.objectiveAiPatch;
      }
      // Reported whether or not a write happened: a no-op means the coordinate
      // is ALREADY where the tree implies, which is the same fact.
      const dim = computeGapProgressDims(updated).find((d) => d.index === stamped.dimIndex);
      if (dim) out.value = dim.value;
    }
  } catch (err) {
    // The artifact row and the evidence log are already saved, and that is what
    // the student asked for. A failed vector sync is a stale coordinate that
    // the next roadmap save corrects, not a failed save.
    console.warn('artifact gap-progress failed', err?.message || err);
  }
  return out;
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

const LIST_COLS_V2 = 'id, waypoint_id, gap_id, dim_index, type, title, note, url, created_at, updated_at';
const LIST_COLS_V1 = 'id, waypoint_id, gap_id, dim_index, type, title, note, created_at';

function toClientArtifact(a) {
  return {
    id: a.id,
    waypointId: a.waypoint_id,
    gapId: a.gap_id,
    dimIndex: a.dim_index,
    type: a.type,
    title: a.title,
    note: a.note,
    url: a.url || '',
    createdAt: a.created_at,
    updatedAt: a.updated_at || null,
  };
}

/**
 * Newest first. Falls back to the pre-0022 column list when `url`/`updated_at`
 * do not exist yet: the locker degrades to what it showed before the migration
 * rather than going empty, which is what a bare `SELECT url` would have done to
 * every existing user between this deploy and Jacob applying 0022.
 */
async function listArtifacts(env, email) {
  try {
    const r = await env.DB.prepare(
      `SELECT ${LIST_COLS_V2} FROM artifacts WHERE email = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(email).all();
    return (r.results || []).map(toClientArtifact);
  } catch (_) {
    try {
      const r = await env.DB.prepare(
        `SELECT ${LIST_COLS_V1} FROM artifacts WHERE email = ? ORDER BY created_at DESC LIMIT 50`,
      ).bind(email).all();
      return (r.results || []).map(toClientArtifact);
    } catch (err) {
      console.error('artifacts list failed', err?.message || err);
      return [];
    }
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const artifacts = await listArtifacts(env, email);
  const out = { artifacts };

  // The Evidence Locker asks for attribution; the portal's compact mirror does
  // not, so Home never pays a roadmap read for a card that shows three titles.
  let wantAttribution = false;
  try { wantAttribution = new URL(request.url).searchParams.get('attribution') === '1'; } catch (_) { /* non-URL test doubles */ }
  if (wantAttribution && artifacts.length) {
    const tree = await loadRoadmap(env, email).catch(() => null);
    out.attribution = attributeArtifacts(tree, artifacts);
  }
  return jsonResponse(200, out, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, `artifact:${await hashedIpKey(env, request)}`, { max: 30 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }

  const action = String(body?.action || '').trim().toLowerCase();
  if (action === 'update') return handleArtifactUpdate({ env, email, origin, body });
  if (action === 'delete') return handleArtifactDelete({ env, email, origin, body });

  const type = String(body?.type || '').toLowerCase();
  const title = String(body?.title || '').trim().slice(0, 120);
  const note = String(body?.note || '').trim().slice(0, 200);
  const url = sanitizeUrl(body?.url);
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
      'INSERT INTO artifacts (id, email, waypoint_id, gap_id, dim_index, type, title, note, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, email, waypointId, gapId, dimIndex, type, title, note || null, url || null, createdAt, createdAt).run();
  } catch (_) {
    // Pre-0022 schema: no `url`/`updated_at` columns yet. Save the artifact
    // without them rather than losing the student's evidence to a pending
    // migration — the link is the only thing missing, and only until 0022 lands.
    try {
      await env.DB.prepare(
        'INSERT INTO artifacts (id, email, waypoint_id, gap_id, dim_index, type, title, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, email, waypointId, gapId, dimIndex, type, title, note || null, createdAt).run();
    } catch (err) {
      console.error('artifact insert failed', err?.message || err);
      return jsonResponse(500, { error: 'Could not save your artifact.' }, origin);
    }
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
    artifact: { id, waypointId, gapId, dimIndex, type, title, note, url, createdAt },
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

/**
 * S12 — edit an artifact's metadata. Deliberately NOT the gap link: re-pointing
 * an artifact at a different skill would mean unstamping one gap and stamping
 * another, which is a vector write dressed as a text edit. Changing what a piece
 * of evidence proves is a delete-and-re-add.
 */
async function handleArtifactUpdate({ env, email, origin, body }) {
  const id = String(body?.id || '').slice(0, 64);
  if (!id) return jsonResponse(400, { error: 'Bad update.' }, origin);

  const sets = [];
  const binds = [];
  if (body.type !== undefined) {
    const type = String(body.type || '').toLowerCase();
    if (!TYPES.has(type)) return jsonResponse(400, { error: 'Pick an artifact type.' }, origin);
    sets.push('type = ?'); binds.push(type);
  }
  if (body.title !== undefined) {
    const title = String(body.title || '').trim().slice(0, 120);
    if (title.length < 2) return jsonResponse(400, { error: 'Give your artifact a title.' }, origin);
    sets.push('title = ?'); binds.push(title);
  }
  if (body.note !== undefined) {
    sets.push('note = ?'); binds.push(String(body.note || '').trim().slice(0, 200) || null);
  }
  if (body.url !== undefined) {
    const url = sanitizeUrl(body.url);
    if (!url && String(body.url || '').trim()) return jsonResponse(400, { error: 'Links must start with https://.' }, origin);
    sets.push('url = ?'); binds.push(url || null);
  }
  if (!sets.length) return jsonResponse(400, { error: 'Nothing to update.' }, origin);

  const run = async (extra) => {
    const res = await env.DB.prepare(
      `UPDATE artifacts SET ${sets.concat(extra).join(', ')} WHERE id = ? AND email = ?`,
    ).bind(...binds, ...(extra.length ? [new Date().toISOString()] : []), id, email).run();
    return !!(res && res.meta && res.meta.changes);
  };
  let changed = false;
  try {
    changed = await run(['updated_at = ?']);
  } catch (_) {
    // Pre-0022: no `updated_at`, and `url = ?` in the SET list would also fail.
    const urlAt = sets.indexOf('url = ?');
    if (urlAt >= 0) { sets.splice(urlAt, 1); binds.splice(urlAt, 1); }
    if (!sets.length) return jsonResponse(400, { error: 'Nothing to update.' }, origin);
    try { changed = await run([]); } catch (err) {
      console.warn('artifact update failed', err?.message || err);
      return jsonResponse(500, { error: 'Could not update your evidence.' }, origin);
    }
  }
  // 404, not 403 — a row that is not yours is a row that does not exist.
  if (!changed) return jsonResponse(404, { error: 'Evidence not found.' }, origin);
  return jsonResponse(200, { ok: true, artifacts: await listArtifacts(env, email) }, origin);
}

/**
 * S12 — remove an artifact, and with it the credit it earned.
 *
 * Deleting the proof has to move the coordinate back down, or the locker would
 * be showing an attribution for evidence that no longer exists. The tree's
 * evidence log goes with the row, and then the canonical single writer
 * (`syncGapProgressToQuiz`) recomputes the objective vector from the tree's
 * CURRENT state. That is deliberately not a second writer and not an inverse
 * patch: absolute recomputation is the whole point of the 2026-07-10 design, so
 * "add then delete" converges on the value the tree implies rather than on
 * whatever arithmetic the add happened to do.
 */
async function handleArtifactDelete({ env, email, origin, body }) {
  const id = String(body?.id || '').slice(0, 64);
  if (!id) return jsonResponse(400, { error: 'Bad delete.' }, origin);

  let gone = false;
  try {
    const res = await env.DB.prepare('DELETE FROM artifacts WHERE id = ? AND email = ?').bind(id, email).run();
    gone = !!(res && res.meta && res.meta.changes);
  } catch (err) {
    console.warn('artifact delete failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not remove that evidence.' }, origin);
  }
  if (!gone) return jsonResponse(404, { error: 'Evidence not found.' }, origin);

  const out = { ok: true, id };
  try {
    const tree = await loadRoadmap(env, email).catch(() => null);
    const gaps = tree?.focusTracker?.skillGaps;
    if (Array.isArray(gaps)) {
      let touched = false;
      const nextGaps = gaps.map((g) => {
        if (!g || !Array.isArray(g.logs)) return g;
        const logs = g.logs.filter((l) => !(l && (String(l.artifactId || '') === id || String(l.id || '') === `art-${id}`)));
        if (logs.length === g.logs.length) return g;
        touched = true;
        return { ...g, logs };
      });
      if (touched) {
        const updated = {
          ...tree,
          focusTracker: { ...tree.focusTracker, skillGaps: nextGaps, updatedAt: new Date().toISOString() },
        };
        await saveRoadmap(env, email, updated);
        out.roadmap = updated;
        const synced = await syncGapProgressToQuiz(env, email, updated);
        if (synced) {
          out.objectiveVector = synced.objectiveVector;
          out.objectiveAiPatch = synced.objectiveAiPatch;
        }
      }
    }
  } catch (err) {
    // The row is already gone and that is what the student asked for. A failure
    // to un-credit is a stale coordinate, not a failed delete.
    console.warn('artifact delete gap-unstamp failed', err?.message || err);
  }
  out.artifacts = await listArtifacts(env, email);
  return jsonResponse(200, out, origin);
}
