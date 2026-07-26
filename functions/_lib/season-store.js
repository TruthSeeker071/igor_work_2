/**
 * FlightWay V2 S18 — Interview Season D1 layer (migration 0026).
 *
 * Every read and write of `interview_seasons`, plus the two-column read/write on
 * `interview_sessions` that links a scored session to the week it belonged to.
 * Pure program construction lives in season-core.js; nothing here talks to
 * Gemini, KV or the vector pipeline.
 *
 * Three rules worth stating out loud:
 *
 *  1. **`seasonsTableReady` proves the COLUMNS too.** The two `ALTER TABLE
 *     interview_sessions` statements ship in the same migration as the table, so
 *     one probe answers both questions. That matters more than it looks: the
 *     debrief INSERT in mock-interview.js has to choose between two column lists,
 *     and choosing wrong turns a successful interview into a lost transcript.
 *  2. **The week is stamped by the SERVER at debrief time**, from the season row
 *     and the clock — never from the request body. Same authorization story as
 *     S16's commit path and S17's archetype key: the client cannot name a week.
 *  3. **Every read and write is scoped `WHERE user_id = ?`** (and the session
 *     reads `WHERE email = ?`, which is 0012's column name for the same fact).
 *
 * Every function degrades to an empty answer rather than throwing when 0026 has
 * not been applied — the panel then says "not switched on yet" out loud, which is
 * the shape S9/S11/S12/S16/S17 all settled on.
 */

import { currentWeek, SEASON_WEEKS } from './season-core.js';

/** Seasons kept per account. Six weeks each, so this is roughly two years of them. */
export const MAX_SEASONS_PER_USER = 12;

const SELECT_COLS = 'id, user_id, career_slug, career_name, family, status, start_date, end_date, '
  + 'program_json, format_src, created_at, updated_at, ended_at';

function normUser(email) {
  return String(email || '').trim().toLowerCase();
}

function parseSeason(row) {
  if (!row) return null;
  let program = null;
  try { program = JSON.parse(row.program_json); } catch (_) { program = null; }
  return {
    id: row.id,
    careerSlug: row.career_slug || '',
    careerName: row.career_name || '',
    family: row.family || '',
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    formatSource: row.format_src || 'playbook',
    createdAt: row.created_at,
    endedAt: row.ended_at || '',
    program,
  };
}

/**
 * Is migration 0026 applied? Asked so the surface can say "not switched on yet"
 * instead of showing a generic failure — those two states look identical from
 * outside and only one of them is actionable by the student.
 */
export async function seasonsTableReady(env) {
  if (!env || !env.DB) return false;
  try {
    await env.DB.prepare('SELECT 1 FROM interview_seasons LIMIT 1').first();
    return true;
  } catch (_) {
    return false;
  }
}

/** The one active season for an account, parsed, or null. */
export async function activeSeason(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM interview_seasons WHERE user_id = ? AND status = 'active' LIMIT 1`,
    ).bind(userId).first();
    return parseSeason(row);
  } catch (err) {
    console.warn('interview_seasons active failed', err && err.message ? err.message : err);
    return null;
  }
}

/** Random id, same generator shape as the rest of the V2 tables. */
function newId() {
  try {
    const b = new Uint8Array(9);
    crypto.getRandomValues(b);
    return 'is' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
  } catch (_) {
    return 'is' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Start a season. Returns `{ ok, id, reason }`.
 *
 * The partial unique index on `(user_id) WHERE status = 'active'` is what makes
 * "one active season" true rather than merely intended, so a double-submit lands
 * as a constraint violation here and is reported as `already-active` rather than
 * creating a second program the student would then have two of.
 */
export async function insertSeason(env, email, { program, careerSlug, careerName, family, formatSource, now } = {}) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId || !program) return { ok: false, id: '', reason: 'not-ready' };
  const id = newId();
  const at = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO interview_seasons
         (id, user_id, career_slug, career_name, family, status, start_date, end_date, program_json, format_src, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, userId, String(careerSlug || '').slice(0, 80), String(careerName || '').slice(0, 120),
      String(family || 'general').slice(0, 40), program.startDate, program.endDate,
      JSON.stringify(program), formatSource === 'web' ? 'web' : 'playbook', at, at,
    ).run();
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/UNIQUE|constraint/i.test(msg)) return { ok: false, id: '', reason: 'already-active' };
    console.warn('interview_seasons insert failed', msg);
    return { ok: false, id: '', reason: 'save-failed' };
  }
  try {
    await env.DB.prepare(
      `DELETE FROM interview_seasons WHERE user_id = ? AND status != 'active' AND id NOT IN (
         SELECT id FROM interview_seasons WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
    ).bind(userId, userId, MAX_SEASONS_PER_USER).run();
  } catch (err) {
    console.warn('interview_seasons prune failed', err && err.message ? err.message : err);
  }
  return { ok: true, id, reason: '' };
}

/**
 * Close the active season. `completed` when the six weeks ran out, `abandoned`
 * when the student ended it early — two different facts, and the headline says
 * different things about them.
 */
export async function endSeason(env, email, id, status, now = Date.now()) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  const next = status === 'completed' ? 'completed' : 'abandoned';
  if (!env || !env.DB || !userId || !key) return false;
  try {
    const r = await env.DB.prepare(
      `UPDATE interview_seasons SET status = ?, ended_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'active'`,
    ).bind(next, new Date(now).toISOString(), new Date(now).toISOString(), key, userId).run();
    return !!(r && r.meta && r.meta.changes);
  } catch (err) {
    console.warn('interview_seasons end failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * The stamp a debrief should carry: which season and which week, decided here
 * from the row and the clock.
 *
 * Returns null when 0026 is pending, when there is no active season, or when
 * today falls outside the six weeks. That last case is deliberate: a session run
 * three weeks after the program ended is a real session and belongs in the
 * history, but it is not week 9 of a six-week program and inventing a number for
 * it would put a point on the trend line the program never scheduled.
 */
export async function seasonStampFor(env, email, now = Date.now()) {
  if (!(await seasonsTableReady(env))) return null;
  const season = await activeSeason(env, email);
  if (!season) return null;
  const week = currentWeek(season.startDate, now);
  if (!(week >= 1 && week <= SEASON_WEEKS)) return null;
  return { seasonId: season.id, week, season };
}

/**
 * Scored sessions for one season, oldest first — the trend line's raw material.
 *
 * `interview_sessions` is `email`-keyed (0012, before the `user_id` convention),
 * and is left that way on purpose: renaming a column on a live table to win a
 * naming argument is the worst trade available in this schema.
 */
export async function sessionsForSeason(env, email, seasonId) {
  const who = normUser(email);
  const key = String(seasonId || '').slice(0, 64);
  if (!env || !env.DB || !who || !key) return [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, season_week, scores_json, created_at FROM interview_sessions
        WHERE email = ? AND season_id = ? ORDER BY created_at ASC LIMIT ?`,
    ).bind(who, key, SEASON_WEEKS * 4).all();
    return (r.results || []).map((row) => {
      let scores = null;
      try { scores = JSON.parse(row.scores_json); } catch (_) { scores = null; }
      return { id: row.id, week: Number(row.season_week) || 0, at: row.created_at, scores };
    });
  } catch (err) {
    console.warn('interview_seasons sessions failed', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * Seasons whose six weeks have run out but whose row still says 'active'.
 *
 * Read by the cron so a finished program stops presenting itself as a live one.
 * Not filtered by plan for the same reason `selectQuarterlyBatch` is not:
 * entitlement is `resolveEntitlement`'s job, and restating it as SQL would be a
 * second copy of the rule.
 */
export async function seasonsPastEnd(env, todayIso, limit = 200) {
  if (!env || !env.DB) return [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, user_id, end_date FROM interview_seasons
        WHERE status = 'active' AND end_date < ? ORDER BY end_date ASC LIMIT ?`,
    ).bind(String(todayIso || ''), Math.max(1, Math.min(500, Number(limit) || 200))).all();
    return r.results || [];
  } catch (err) {
    console.warn('interview_seasons sweep skipped', err && err.message ? err.message : err);
    return [];
  }
}
