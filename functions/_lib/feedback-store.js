/**
 * FlightWay V2 S19 — NPS + testimonials D1 layer (migration 0027).
 *
 * Same two rules S9/S12/S16/S17 settled on and this file follows without
 * exception:
 *
 *  1. **Every per-user read and write is scoped `WHERE user_id = ?`.** Ids are
 *     unguessable, but unguessable is a property of the generator and
 *     impossible is a property of the query.
 *  2. **Every function degrades to an empty answer rather than throwing** when
 *     0027 has not been applied, so the surface can say "not switched on yet"
 *     out loud. The one exception is the write path in `recordNps` /
 *     `createTestimonial`, which reports failure to the caller: a student who
 *     typed a quote and pressed the button must never see a success screen over
 *     a row that does not exist.
 *
 * The public read is the only query in the codebase that serves one user's text
 * to a different user, so it lives here in one place, filters on status in SQL
 * (not in JS after the fact), and hands its rows straight to `publicQuote`.
 */

import { PUBLIC_STATUSES, MAX_PENDING_PER_USER } from './feedback-core.js';

const QUOTE_COLS = 'id, user_id, nps_id, score, quote, display_name, school, '
  + 'consent_name, consent_school, status, created_at, reviewed_at, reviewed_by';

function normUser(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Is migration 0027 applied? Both tables ship in one migration, so one probe
 * per table and an AND: a half-applied migration is a state nothing else in the
 * product can reason about, and answering "ready" on it would put a student's
 * quote into a table that is not there.
 */
export async function feedbackTablesReady(env) {
  if (!env || !env.DB) return false;
  try {
    await env.DB.prepare('SELECT 1 FROM nps_responses LIMIT 1').first();
    await env.DB.prepare('SELECT 1 FROM testimonials LIMIT 1').first();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * When we last put the card in front of this person, of ANY status. Null means
 * never asked. A read failure also returns null — see the note on `npsEligible`
 * about which way a cap should fail; here the endpoint pairs this with a
 * `tablesReady` check, so a missing table refuses before it ever asks.
 */
export async function lastNpsAsk(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT created_at FROM nps_responses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    ).bind(userId).first();
    return row?.created_at || null;
  } catch (err) {
    console.warn('nps last-ask failed', err && err.message ? err.message : err);
    return null;
  }
}

/** Write the response (or the dismissal). Throws on failure — see the header. */
export async function recordNps(env, email, { id, moment, status, score, comment }, nowIso) {
  const userId = normUser(email);
  await env.DB.prepare(
    'INSERT INTO nps_responses (id, user_id, moment, status, score, comment, created_at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, userId, moment, status, score === null ? null : score, comment || '', nowIso).run();
  return id;
}

/** How many quotes this account already has waiting for review. */
export async function pendingTestimonialCount(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return 0;
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM testimonials WHERE user_id = ? AND status = 'pending'",
    ).bind(userId).first();
    return Number(row?.n || 0);
  } catch (err) {
    console.warn('testimonial pending count failed', err && err.message ? err.message : err);
    return MAX_PENDING_PER_USER; // unreadable → treat as full, never as empty
  }
}

/** Create a pending quote. Throws on failure — see the header. */
export async function createTestimonial(env, email, row, nowIso) {
  const userId = normUser(email);
  await env.DB.prepare(
    'INSERT INTO testimonials (id, user_id, nps_id, score, quote, display_name, school, '
    + "consent_name, consent_school, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
  ).bind(
    row.id, userId, row.npsId || '', row.score === undefined ? null : row.score,
    row.quote, row.displayName || '', row.school || '',
    row.consentName ? 1 : 0, row.consentSchool ? 1 : 0, nowIso,
  ).run();
  return row.id;
}

/**
 * The public read. Status is filtered in SQL rather than in JS afterwards, so a
 * later refactor that forgets a `.filter()` cannot start serving the pending
 * queue to the internet.
 */
export async function listPublicQuotes(env, limit = 6) {
  if (!env || !env.DB) return [];
  const n = Math.max(1, Math.min(24, Number(limit) || 6));
  const marks = PUBLIC_STATUSES.map(() => '?').join(', ');
  try {
    const r = await env.DB.prepare(
      `SELECT id, quote, display_name, school, status, created_at FROM testimonials `
      + `WHERE status IN (${marks}) ORDER BY created_at DESC LIMIT ?`,
    ).bind(...PUBLIC_STATUSES, n).all();
    return r.results || [];
  } catch (err) {
    console.warn('public quotes failed', err && err.message ? err.message : err);
    return [];
  }
}

/** The admin queue: everything, newest first, pending sorted to the top. */
export async function listTestimonialQueue(env, limit = 60) {
  if (!env || !env.DB) return null;
  const n = Math.max(1, Math.min(200, Number(limit) || 60));
  try {
    const r = await env.DB.prepare(
      `SELECT ${QUOTE_COLS} FROM testimonials `
      + "ORDER BY (status = 'pending') DESC, created_at DESC LIMIT ?",
    ).bind(n).all();
    return r.results || [];
  } catch (err) {
    console.warn('testimonial queue failed', err && err.message ? err.message : err);
    return null; // null = "could not read", which the console renders differently from []
  }
}

/**
 * Move a row's status. Returns the number of rows actually changed, so the
 * caller can tell "approved it" from "that id does not exist" — a console that
 * reports success on a no-op teaches its operator to trust a button that did
 * nothing.
 */
export async function reviewTestimonial(env, id, status, actor, nowIso) {
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !key) return 0;
  const res = await env.DB.prepare(
    'UPDATE testimonials SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?',
  ).bind(status, nowIso, String(actor || '').slice(0, 200), key).run();
  return Number(res?.meta?.changes || 0);
}

/** Every NPS row since `sinceIso`, dismissals included (the denominator). */
export async function npsRowsSince(env, sinceIso, limit = 2000) {
  if (!env || !env.DB) return [];
  const n = Math.max(1, Math.min(5000, Number(limit) || 2000));
  try {
    const r = await env.DB.prepare(
      'SELECT id, moment, status, score, comment, created_at FROM nps_responses '
      + 'WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?',
    ).bind(String(sinceIso || ''), n).all();
    return r.results || [];
  } catch (err) {
    console.warn('nps rows failed', err && err.message ? err.message : err);
    return [];
  }
}
