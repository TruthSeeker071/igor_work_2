/**
 * FlightWay V2 S18 — Semester Loop D1 layer (migration 0026).
 *
 * Every read and write of the `terms` table. Pure term arithmetic lives in
 * term-core.js; nothing here talks to Gemini, KV or the vector pipeline.
 *
 * **`resolveTerm` is the single reader**, and the precedence is the point of the
 * whole file. A term can reach this product two ways:
 *
 *   1. the student ran the start-of-term ritual → a `terms` ROW, which also
 *      holds the outcomes, what was seeded, the review and the regen grant;
 *   2. the student only ever told Marco "my quarter ends March 20" →
 *      `syncUserFromDossier` wrote `identity.termStart` / `termEnd` /
 *      `termSystem` on the user object, and nothing else exists.
 *
 * The row wins where there is one, because it is the record of a deliberate act;
 * the mirror answers where there is not, because a student who stated their
 * dates should get a term-aware digest without being made to fill in a wizard
 * first. Neither path ever writes the other's home — the ritual writes the
 * mirror through `setUserField` (the registry's own explicit-set direction), and
 * that is the only crossing there is.
 *
 * Every function degrades to an empty answer rather than throwing when 0026 has
 * not been applied.
 */

import { getUserField } from './user-model.js';
import { normalizeTermSystem, cleanTermLabel, termWeek, defaultTermLabel } from './term-core.js';
import { utcDate, isIsoDate } from './deadline-core.js';

/** Terms kept per account — about four years of them. */
export const MAX_TERMS_PER_USER = 12;
/** How many candidate rows `currentTermRow` looks at before choosing. */
const CANDIDATES = 4;

const SELECT_COLS = 'id, user_id, system, label, start_date, end_date, outcomes_json, seeded_json, '
  + 'review_json, regen_granted_at, reviewed_at, created_at, updated_at';

function normUser(email) {
  return String(email || '').trim().toLowerCase();
}

function parseJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

function parseTerm(row) {
  if (!row) return null;
  const outcomes = parseJson(row.outcomes_json, null) || {};
  return {
    id: row.id,
    source: 'row',
    system: row.system,
    label: row.label || '',
    startDate: row.start_date,
    endDate: row.end_date,
    outcomes: Array.isArray(outcomes.outcomes) ? outcomes.outcomes : [],
    anchors: outcomes.anchors || { courses: [], clubs: [], deliverable: '' },
    seeded: parseJson(row.seeded_json, []) || [],
    review: parseJson(row.review_json, null),
    regenGrantedAt: row.regen_granted_at || '',
    reviewedAt: row.reviewed_at || '',
    createdAt: row.created_at,
  };
}

/**
 * Is migration 0026 applied? Asked so the surface can say "not switched on yet"
 * instead of showing a generic failure.
 */
export async function termsTableReady(env) {
  if (!env || !env.DB) return false;
  try {
    await env.DB.prepare('SELECT 1 FROM terms LIMIT 1').first();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * The term row this student is "in" right now, in preference order:
 *   1. one whose window contains today,
 *   2. the soonest one still ahead of them,
 *   3. the newest finished one that was never reviewed — so an end-of-term
 *      review stays reachable after the term is over, which is when they will
 *      actually run it,
 *   4. the newest row at all.
 *
 * Chosen in JS over four candidate rows rather than in SQL, because the order is
 * a product rule with four clauses and a CASE expression encoding it is a place
 * for the rule to be wrong silently.
 */
export async function currentTermRow(env, email, now = Date.now()) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return null;
  let rows = [];
  try {
    const r = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM terms WHERE user_id = ? ORDER BY start_date DESC LIMIT ?`,
    ).bind(userId, CANDIDATES).all();
    rows = (r.results || []).map(parseTerm).filter(Boolean);
  } catch (err) {
    console.warn('terms read failed', err && err.message ? err.message : err);
    return null;
  }
  if (!rows.length) return null;
  const today = utcDate(now);
  return rows.find((t) => t.startDate <= today && t.endDate >= today)
    || rows.filter((t) => t.startDate > today).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0]
    || rows.find((t) => !t.reviewedAt)
    || rows[0];
}

/** One term by id, account-scoped. */
export async function getTerm(env, email, id) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM terms WHERE id = ? AND user_id = ?`,
    ).bind(key, userId).first();
    return parseTerm(row);
  } catch (err) {
    console.warn('terms get failed', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * THE reader. A term for this account from whichever home has one, or null.
 *
 * `opts.user` is the already-normalized user object when the caller holds it
 * (every one of them does), so the mirror fallback costs no extra read.
 */
export async function resolveTerm(env, email, opts = {}) {
  const row = (await termsTableReady(env)) ? await currentTermRow(env, email, opts.now) : null;
  if (row) return row;
  const user = opts.user;
  if (!user) return null;
  const system = normalizeTermSystem(getUserField(user, 'identity.termSystem'));
  const startDate = String(getUserField(user, 'identity.termStart') || '').slice(0, 10);
  const endDate = String(getUserField(user, 'identity.termEnd') || '').slice(0, 10);
  if (!system || !isIsoDate(startDate) || !isIsoDate(endDate) || endDate <= startDate) return null;
  return {
    id: '',
    // The card and the digest both branch on this: a mirror term knows the dates
    // and nothing else, so "run the ritual" is the only thing worth offering.
    source: 'mirror',
    system,
    label: defaultTermLabel(system, startDate),
    startDate,
    endDate,
    outcomes: [],
    anchors: { courses: [], clubs: [], deliverable: '' },
    seeded: [],
    review: null,
    regenGrantedAt: '',
    reviewedAt: '',
    createdAt: '',
  };
}

function newId() {
  try {
    const b = new Uint8Array(9);
    crypto.getRandomValues(b);
    return 'tm' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
  } catch (_) {
    return 'tm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Create or replace this student's term.
 *
 * "Replace" is by (user, start_date): re-running the ritual for the SAME term
 * rewrites its outcomes rather than stacking a second row, because a student who
 * changes their mind in week two has one term, not two. A different start date
 * is a different term and gets its own row — which is what makes the review of
 * the previous one survive the setup of the next.
 */
export async function upsertTerm(env, email, term, now = Date.now()) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return { ok: false, id: '' };
  const at = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  const outcomesJson = JSON.stringify({
    outcomes: term.outcomes || [],
    anchors: term.anchors || { courses: [], clubs: [], deliverable: '' },
  });
  try {
    const existing = await env.DB.prepare(
      'SELECT id FROM terms WHERE user_id = ? AND start_date = ?',
    ).bind(userId, term.startDate).first();
    if (existing && existing.id) {
      await env.DB.prepare(
        `UPDATE terms SET system = ?, label = ?, end_date = ?, outcomes_json = ?, seeded_json = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`,
      ).bind(
        term.system, cleanTermLabel(term.label), term.endDate, outcomesJson,
        JSON.stringify(term.seeded || []), at, existing.id, userId,
      ).run();
      return { ok: true, id: existing.id, replaced: true };
    }
    const id = newId();
    await env.DB.prepare(
      `INSERT INTO terms (id, user_id, system, label, start_date, end_date, outcomes_json, seeded_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, userId, term.system, cleanTermLabel(term.label), term.startDate, term.endDate,
      outcomesJson, JSON.stringify(term.seeded || []), at, at,
    ).run();
    try {
      await env.DB.prepare(
        `DELETE FROM terms WHERE user_id = ? AND id NOT IN (
           SELECT id FROM terms WHERE user_id = ? ORDER BY start_date DESC LIMIT ?
         )`,
      ).bind(userId, userId, MAX_TERMS_PER_USER).run();
    } catch (err) {
      console.warn('terms prune failed', err && err.message ? err.message : err);
    }
    return { ok: true, id, replaced: false };
  } catch (err) {
    console.warn('terms upsert failed', err && err.message ? err.message : err);
    return { ok: false, id: '' };
  }
}

/** Store the end-of-term review, whole (0024's rule: a record, never recomputed). */
export async function saveTermReview(env, email, id, review, now = Date.now()) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return false;
  const at = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  try {
    const r = await env.DB.prepare(
      'UPDATE terms SET review_json = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    ).bind(JSON.stringify(review || {}), at, at, key, userId).run();
    return !!(r && r.meta && r.meta.changes);
  } catch (err) {
    console.warn('terms review save failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * Claim the term's one bonus roadmap regeneration. Returns true exactly once.
 *
 * The check and the write are ONE statement — `WHERE ... AND regen_granted_at IS
 * NULL` — because this is an entitlement, and a read-then-write would hand two
 * concurrent review requests two grants. `meta.changes` is the claim: 1 means
 * this call won it, 0 means it was already spent.
 */
export async function claimTermRegen(env, email, id, now = Date.now()) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return false;
  try {
    const r = await env.DB.prepare(
      'UPDATE terms SET regen_granted_at = ? WHERE id = ? AND user_id = ? AND regen_granted_at IS NULL',
    ).bind(new Date(Number.isFinite(now) ? now : Date.now()).toISOString(), key, userId).run();
    return !!(r && r.meta && r.meta.changes);
  } catch (err) {
    console.warn('terms regen claim failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * Every account's live term, in ONE query — the digest's term line.
 *
 * The `staleDraftsByUser` / `capHitsByUser` / `countMovedByUser` shape: one
 * grouped read per cron RUN, never one per recipient. Returns a Map keyed by the
 * normalized email.
 */
export async function activeTermsByUser(env, todayIso) {
  const out = new Map();
  if (!env || !env.DB) return out;
  const today = String(todayIso || '').slice(0, 10);
  if (!today) return out;
  try {
    const r = await env.DB.prepare(
      `SELECT user_id, system, label, start_date, end_date FROM terms
        WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC`,
    ).bind(today, today).all();
    (r.results || []).forEach((row) => {
      // A student with two overlapping rows (they set up a term twice with
      // different dates) gets the newest; the ORDER BY makes that the first one
      // seen, so the guard keeps it rather than the last row scanned.
      if (out.has(row.user_id)) return;
      out.set(row.user_id, {
        id: '', system: row.system, label: row.label || '',
        startDate: row.start_date, endDate: row.end_date,
      });
    });
  } catch (err) {
    console.warn('terms digest sweep skipped', err && err.message ? err.message : err);
  }
  return out;
}

/**
 * Terms that have ended and were never reviewed — the cron's "your review is
 * ready" mail.
 *
 * Bounded on BOTH sides: a term that ended eight months ago is not a
 * retrospective anyone wants, and mailing about it the first night this code
 * ships would be the worst possible introduction to the feature.
 */
export async function termsAwaitingReview(env, { now = Date.now(), withinDays = 45, limit = 200 } = {}) {
  if (!env || !env.DB) return [];
  const today = utcDate(now);
  const floor = utcDate(now - Math.max(1, Number(withinDays) || 45) * 86400000);
  try {
    const r = await env.DB.prepare(
      `SELECT id, user_id, system, label, start_date, end_date FROM terms
        WHERE end_date < ? AND end_date >= ? AND reviewed_at IS NULL
        ORDER BY end_date DESC LIMIT ?`,
    ).bind(today, floor, Math.max(1, Math.min(500, Number(limit) || 200))).all();
    return r.results || [];
  } catch (err) {
    console.warn('terms review sweep skipped', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * Terms that have started but whose ritual was never completed — the "pick three
 * outcomes" nudge.
 *
 * `outcomes_json IS NULL OR ...` is deliberately not a JSON query: a row with an
 * empty outcomes array is the state this looks for, and comparing against the
 * two literal shapes an empty ritual writes is cheaper and more legible than
 * asking SQLite to parse JSON. The window is the first fortnight of the term —
 * after that the moment has passed and the nudge is a nag.
 */
export async function termsAwaitingRitual(env, { now = Date.now(), withinDays = 14, limit = 200 } = {}) {
  if (!env || !env.DB) return [];
  const today = utcDate(now);
  const floor = utcDate(now - Math.max(1, Number(withinDays) || 14) * 86400000);
  try {
    const r = await env.DB.prepare(
      `SELECT id, user_id, system, label, start_date, end_date, outcomes_json FROM terms
        WHERE start_date <= ? AND start_date >= ? AND end_date >= ?
        ORDER BY start_date DESC LIMIT ?`,
    ).bind(today, floor, today, Math.max(1, Math.min(500, Number(limit) || 200))).all();
    return (r.results || []).filter((row) => {
      const parsed = parseJson(row.outcomes_json, null);
      return !parsed || !Array.isArray(parsed.outcomes) || !parsed.outcomes.length;
    });
  } catch (err) {
    console.warn('terms ritual sweep skipped', err && err.message ? err.message : err);
    return [];
  }
}

export { termWeek };
