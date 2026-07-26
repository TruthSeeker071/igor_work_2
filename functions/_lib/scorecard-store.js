/**
 * FlightWay V2 S16 — readiness scorecard D1 layer (migration 0024).
 *
 * Every read and write of the `scorecards` table goes through here. Pure
 * validation and scoring live in scorecard-core.js; nothing in this file talks
 * to Gemini, KV or the vector pipeline.
 *
 * Two rules worth stating out loud:
 *
 *  1. **A report is append-only and is never rewritten.** The trend line is the
 *     product; a table that updated the newest row in place could not draw one,
 *     and a report edited after the fact would no longer be a record of what the
 *     web said that week. Retention is a prune of the OLDEST rows, never an
 *     overwrite of the newest.
 *  2. **Every read and write is scoped `WHERE user_id = ?`.** Same call S9 and
 *     S12 made: ids are unguessable, but "unguessable" is a property of the id
 *     generator and "impossible" is a property of the query.
 *
 * Every function degrades to an empty answer rather than throwing when the
 * migration has not been applied yet — the panel then says "not switched on
 * yet" out loud, which is the honest shape S9/S11/S12 all settled on.
 */

/** Reports kept per account: 3 years of quarterly runs, plus room for manual ones. */
export const MAX_REPORTS_PER_USER = 12;
/** How stale a premium account's newest report must be before the cron re-runs it. */
export const QUARTER_DAYS = 85;

const SELECT_COLS = 'id, user_id, career_slug, career_name, score, met, partial, missing, '
  + 'postings, source, report, created_at';
const TREND_COLS = 'id, score, source, created_at';

function normUser(email) {
  return String(email || '').trim().toLowerCase();
}

function parseReport(row) {
  if (!row) return null;
  let report = null;
  try { report = JSON.parse(row.report); } catch (_) { report = null; }
  return report;
}

/**
 * Is migration 0024 applied? Asked so the surface can say "not switched on yet"
 * instead of showing a generic failure — those two states look identical from
 * outside and only one of them is actionable by the student.
 */
export async function scorecardsTableReady(env) {
  if (!env || !env.DB) return false;
  try {
    await env.DB.prepare('SELECT 1 FROM scorecards LIMIT 1').first();
    return true;
  } catch (_) {
    return false;
  }
}

/** The newest report for one account, parsed, or null. */
export async function latestScorecard(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM scorecards WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(userId).first();
    if (!row) return null;
    return { id: row.id, at: row.created_at, score: Number(row.score) || 0, source: row.source, report: parseReport(row) };
  } catch (err) {
    console.warn('scorecards latest failed', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * The trend rows (id/score/source/created_at only — the reports themselves are
 * megabytes of JSON and the chart plots integers).
 */
export async function listTrend(env, email, limit = MAX_REPORTS_PER_USER) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return [];
  const n = Math.max(1, Math.min(MAX_REPORTS_PER_USER, Number(limit) || MAX_REPORTS_PER_USER));
  try {
    const r = await env.DB.prepare(
      `SELECT ${TREND_COLS} FROM scorecards WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).bind(userId, n).all();
    return r.results || [];
  } catch (err) {
    console.warn('scorecards trend failed', err && err.message ? err.message : err);
    return [];
  }
}

/** One stored report by id, email-scoped. Used by the action→commitment path. */
export async function getScorecard(env, email, id) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM scorecards WHERE id = ? AND user_id = ?`,
    ).bind(key, userId).first();
    if (!row) return null;
    return { id: row.id, at: row.created_at, score: Number(row.score) || 0, source: row.source, report: parseReport(row) };
  } catch (err) {
    console.warn('scorecards get failed', err && err.message ? err.message : err);
    return null;
  }
}

/** Random id, same generator shape as the rest of the V2 tables. */
function newId() {
  try {
    const b = new Uint8Array(9);
    crypto.getRandomValues(b);
    return 'sc' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
  } catch (_) {
    return 'sc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Persist one run. Returns `{ ok, id }`.
 *
 * The prune runs AFTER the insert and only ever deletes rows outside the newest
 * MAX_REPORTS_PER_USER — so a failed prune costs disk, never a report.
 */
export async function insertScorecard(env, email, { report, scored, careerName, careerSlug, source, now } = {}) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId || !report) return { ok: false, id: '' };
  const id = newId();
  const createdAt = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO scorecards
         (id, user_id, career_slug, career_name, score, met, partial, missing, postings, source, report, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, userId, String(careerSlug || '').slice(0, 80), String(careerName || '').slice(0, 120),
      scored.score, scored.met, scored.partial, scored.missing,
      (report.postings || []).length, source === 'auto' ? 'auto' : 'manual',
      JSON.stringify(report), createdAt,
    ).run();
  } catch (err) {
    console.warn('scorecards insert failed', err && err.message ? err.message : err);
    return { ok: false, id: '' };
  }
  try {
    await env.DB.prepare(
      `DELETE FROM scorecards WHERE user_id = ? AND id NOT IN (
         SELECT id FROM scorecards WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
    ).bind(userId, userId, MAX_REPORTS_PER_USER).run();
  } catch (err) {
    console.warn('scorecards prune failed', err && err.message ? err.message : err);
  }
  return { ok: true, id };
}

/**
 * The quarterly cron sweep's candidate list: verified accounts that have been
 * ACTIVE recently and whose newest report is older than a quarter (or who have
 * none at all).
 *
 * Deliberately NOT filtered by plan. §4 gives the quarterly auto-run to premium
 * only, but entitlement is `resolveEntitlement` — it reads `plan_expires_at`,
 * comp grants and the dev allowlist — and restating any of that as a SQL `IN`
 * list would be a second, silently-drifting copy of the rule. The caller
 * resolves each candidate properly; the candidate list is small enough that the
 * extra reads are free.
 *
 * "Active" is the same signal S9's nightly radar uses — a `user_id` on a recent
 * events row — so the two scheduled jobs cannot disagree about who is around.
 *
 * Ordered oldest-report-first, so a night that hits the cap serves whoever has
 * waited longest and no account can monopolise the budget two nights running.
 *
 * Returns `[]` rather than throwing when 0024 (or 0019's `verified_at`, or
 * 0017's `events`) is missing: a sweep that cannot tell who is due must run for
 * nobody, not for everybody.
 */
export async function selectQuarterlyBatch(env, opts = {}) {
  if (!env || !env.DB) return [];
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 20));
  const staleBefore = new Date(now - QUARTER_DAYS * 86400000).toISOString();
  const activeSince = new Date(now - (Number(opts.activeDays) || 21) * 86400000).toISOString();
  try {
    const r = await env.DB.prepare(
      `SELECT u.email AS email, MAX(s.created_at) AS last_at
         FROM users u
         JOIN (SELECT DISTINCT user_id FROM events
                WHERE user_id IS NOT NULL AND ts >= ?) a ON a.user_id = u.email
         LEFT JOIN scorecards s ON s.user_id = u.email
        WHERE u.verified_at IS NOT NULL
        GROUP BY u.email
       HAVING last_at IS NULL OR last_at < ?
        ORDER BY COALESCE(last_at, '') ASC
        LIMIT ?`,
    ).bind(activeSince, staleBefore, limit).all();
    return r.results || [];
  } catch (err) {
    console.warn('scorecards quarterly batch skipped', err && err.message ? err.message : err);
    return [];
  }
}
