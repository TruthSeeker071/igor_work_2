/**
 * FlightWay V2 S12 — Application Tracker D1 layer (migration 0022).
 *
 * Every read and write of the `applications` table goes through here, so the
 * ownership rule has exactly one implementation. Pure validation lives in
 * application-core.js; nothing in this file talks to Gemini, KV or the vector
 * pipeline.
 *
 * **The rule this file exists to make structural, not procedural: every write is
 * scoped `WHERE id = ? AND user_id = ?`.** Ids are random tokens, so a
 * cross-user write is already unguessable — but "unguessable" is a property of
 * the id generator and "impossible" is a property of the query, and only the
 * second one survives someone changing the id generator. A write that matches no
 * row returns false and the endpoint answers 404, deliberately not 403: telling
 * an attacker that a row exists but is not theirs is itself a disclosure (same
 * call S9's radar made).
 */

import {
  MAX_APPLICATIONS, normalizeStatus, isAdvance,
} from './application-core.js';

const SELECT_COLS = 'id, user_id, source, opportunity_ref, company, role, career_slug, '
  + 'status, url, notes, deadline_id, created_at, updated_at, status_at';

function normUser(email) {
  return String(email || '').trim().toLowerCase();
}

function isoAt(nowMs) {
  return new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
}

/**
 * Everything this user is tracking, most recently touched first. Unlike the
 * Deadline Radar (which hides what has passed), the board shows every row
 * including `closed`: a pipeline you cannot look back over is a to-do list, and
 * the closed column is where "I applied to 30 places" becomes visible.
 */
export async function listApplications(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return [];
  try {
    const r = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM applications WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${MAX_APPLICATIONS}`,
    ).bind(userId).all();
    return r.results || [];
  } catch (err) {
    // The table may not exist yet (migration 0022 pending). An empty board is
    // the honest degradation — the same shape S9 chose while 0020 was pending.
    console.warn('applications list failed', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * Is migration 0022 applied? The board asks so it can say "not switched on yet"
 * out loud instead of showing a generic save failure — those two states look
 * identical from outside and only one of them is actionable by the student.
 * (S11 made the same call for the broadcast composer while 0021 was pending.)
 */
export async function applicationsTableReady(env) {
  if (!env || !env.DB) return false;
  try {
    await env.DB.prepare('SELECT id FROM applications LIMIT 1').first();
    return true;
  } catch (_) {
    return false;
  }
}

export async function countApplications(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return 0;
  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM applications WHERE user_id = ?',
    ).bind(userId).first();
    return Number(row && row.n) || 0;
  } catch (_) {
    return 0;
  }
}

export async function getApplication(env, email, id) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId || !id) return null;
  try {
    return await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM applications WHERE id = ? AND user_id = ?`,
    ).bind(String(id).slice(0, 64), userId).first();
  } catch (_) {
    return null;
  }
}

/** The row already holding this opportunity, if the student saved it before. */
export async function findByRef(env, email, opportunityRef) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId || !opportunityRef) return null;
  try {
    return await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM applications WHERE user_id = ? AND opportunity_ref = ?`,
    ).bind(userId, String(opportunityRef).slice(0, 80)).first();
  } catch (_) {
    return null;
  }
}

/**
 * Create one row. A finder save that names an opportunity already tracked is a
 * SUCCESS that returns the existing row (`duplicate: true`) rather than an
 * error: from the student's side "save this" and "this is already saved" want
 * the same outcome on screen, and the partial UNIQUE index makes the insert
 * fail anyway.
 * @returns {Promise<{ok:boolean, row?:object, duplicate?:boolean, error?:string}>}
 */
export async function createApplication(env, email, value, opts = {}) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return { ok: false, error: 'Could not save that application.' };

  if (value.opportunityRef) {
    const existing = await findByRef(env, email, value.opportunityRef);
    if (existing) return { ok: true, row: existing, duplicate: true };
  }

  const count = await countApplications(env, email);
  if (count >= MAX_APPLICATIONS) {
    return { ok: false, error: `You are tracking ${MAX_APPLICATIONS} applications already. Close a few first.` };
  }

  const nowIso = isoAt(opts.now);
  const id = String(opts.id || '').slice(0, 64);
  if (!id) return { ok: false, error: 'Could not save that application.' };

  try {
    await env.DB.prepare(
      'INSERT INTO applications (id, user_id, source, opportunity_ref, company, role, career_slug, '
      + 'status, url, notes, deadline_id, created_at, updated_at, status_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      id, userId, value.source, value.opportunityRef || null, value.company || null,
      value.role, value.careerSlug || null, value.status, value.url || null,
      value.notes || null, value.deadlineId || null, nowIso, nowIso,
      // status_at is NULL on creation. Saving something is not moving it — a
      // digest that said "3 applications moved stage" the week a student saved
      // three would be counting the opposite of progress.
      null,
    ).run();
  } catch (err) {
    // The UNIQUE index is the concurrency backstop behind the read above.
    if (value.opportunityRef) {
      const existing = await findByRef(env, email, value.opportunityRef);
      if (existing) return { ok: true, row: existing, duplicate: true };
    }
    console.warn('applications insert failed', err && err.message ? err.message : err);
    return { ok: false, error: 'Could not save that application.' };
  }
  return { ok: true, row: await getApplication(env, email, id), duplicate: false };
}

/**
 * Move one row along the ladder. `status_at` is written ONLY here, which is what
 * lets the digest and the Month in Review count real stage changes instead of
 * note edits. A no-op (same status) still returns the row but writes nothing.
 * @returns {Promise<{ok:boolean, row?:object, advanced?:boolean, changed?:boolean}>}
 */
export async function setApplicationStatus(env, email, id, status, opts = {}) {
  const userId = normUser(email);
  const clean = normalizeStatus(status);
  if (!env || !env.DB || !userId || !clean || !id) return { ok: false };
  const before = await getApplication(env, email, id);
  if (!before) return { ok: false };
  if (before.status === clean) return { ok: true, row: before, advanced: false, changed: false };

  const nowIso = isoAt(opts.now);
  try {
    const res = await env.DB.prepare(
      'UPDATE applications SET status = ?, updated_at = ?, status_at = ? WHERE id = ? AND user_id = ?',
    ).bind(clean, nowIso, nowIso, String(id).slice(0, 64), userId).run();
    if (!(res && res.meta && res.meta.changes)) return { ok: false };
  } catch (err) {
    console.warn('applications status failed', err && err.message ? err.message : err);
    return { ok: false };
  }
  return {
    ok: true,
    row: await getApplication(env, email, id),
    advanced: isAdvance(before.status, clean),
    changed: true,
    from: before.status,
  };
}

/** Column name per patch key. Anything not in here can never be written. */
const PATCH_COLUMNS = {
  role: 'role',
  company: 'company',
  notes: 'notes',
  url: 'url',
  deadlineId: 'deadline_id',
};

/**
 * Partial field edit. Status is deliberately NOT patchable here — it has its own
 * function because it is the only field with a side effect (`status_at`, which
 * two email surfaces count off).
 */
export async function updateApplication(env, email, id, patch, opts = {}) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId || !id) return { ok: false };
  const keys = Object.keys(patch || {}).filter((k) => PATCH_COLUMNS[k]);
  if (!keys.length) return { ok: false };
  const nowIso = isoAt(opts.now);
  const sets = keys.map((k) => `${PATCH_COLUMNS[k]} = ?`).concat('updated_at = ?');
  const binds = keys.map((k) => (patch[k] === '' ? null : patch[k])).concat(nowIso);
  try {
    const res = await env.DB.prepare(
      `UPDATE applications SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    ).bind(...binds, String(id).slice(0, 64), userId).run();
    if (!(res && res.meta && res.meta.changes)) return { ok: false };
  } catch (err) {
    console.warn('applications update failed', err && err.message ? err.message : err);
    return { ok: false };
  }
  return { ok: true, row: await getApplication(env, email, id) };
}

export async function deleteApplication(env, email, id) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId || !id) return false;
  try {
    const res = await env.DB.prepare(
      'DELETE FROM applications WHERE id = ? AND user_id = ?',
    ).bind(String(id).slice(0, 64), userId).run();
    return !!(res && res.meta && res.meta.changes);
  } catch (err) {
    console.warn('applications delete failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * How many applications each user moved since `sinceIso`, for the WHOLE table in
 * ONE query. The weekly digest walks every opted-in recipient, so this follows
 * S11's `capHitsByUser` shape: one aggregate per run, not one read per user.
 * @returns {Promise<Map<string, number>>}
 */
export async function countMovedByUser(env, sinceIso) {
  const out = new Map();
  if (!env || !env.DB || !sinceIso) return out;
  try {
    const r = await env.DB.prepare(
      'SELECT user_id, COUNT(*) AS n FROM applications WHERE status_at IS NOT NULL AND status_at >= ? GROUP BY user_id',
    ).bind(String(sinceIso)).all();
    (r.results || []).forEach((row) => {
      if (row && row.user_id) out.set(String(row.user_id), Number(row.n) || 0);
    });
  } catch (err) {
    // 0022 not applied yet — no applications is the correct answer, not a
    // failed digest run.
    console.warn('applications countMovedByUser failed', err && err.message ? err.message : err);
  }
  return out;
}

/**
 * Rows whose STATUS moved inside a window, for one user. Used by the Month in
 * Review, which reads one user at a time.
 */
export async function listMovedSince(env, email, sinceIso, untilIso) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId || !sinceIso) return [];
  try {
    const r = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM applications WHERE user_id = ? AND status_at IS NOT NULL `
      + 'AND status_at >= ? AND status_at < ? ORDER BY status_at DESC LIMIT 50',
    ).bind(userId, String(sinceIso), String(untilIso || '9999')).all();
    return r.results || [];
  } catch (_) {
    return [];
  }
}
