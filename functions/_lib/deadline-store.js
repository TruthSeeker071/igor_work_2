/**
 * FlightWay V2 S9 — Deadline Radar D1 layer.
 *
 * Every read and write of the `deadlines` table (migration 0020) goes through
 * here, so the dedupe rule has exactly one implementation: the endpoint, the
 * cron refresh and the gate all call the same function. Pure validation lives
 * in deadline-core.js; nothing in this file talks to Gemini or KV.
 *
 * The one rule worth stating out loud, because a refresh runs weekly and
 * forever: **an upsert never changes `status`.** A row the student dismissed
 * stays dismissed no matter how many times the web hands it back, and a row
 * they marked done stays done. Without that, "dismiss" would mean "hide until
 * Tuesday" and the radar would nag with the same item until they gave up on it.
 */

import {
  MERGE_WINDOW_DAYS, MAX_USER_ROWS, DAY_MS,
  utcDate, daysUntil, deadlineId, normalizeStatus, ALERT_TIERS,
} from './deadline-core.js';

const VISIBLE_STATUSES = ['tracked', 'done'];
const ALERT_COLUMNS = new Set(ALERT_TIERS.map((t) => t.column));

const SELECT_COLS = 'id, user_id, title, org, kind, due_date, url, source, career_slug, status, title_key, dedupe_key, created_at, refreshed_at';

function dayGap(a, b) {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(Math.round((ta - tb) / DAY_MS));
}

function normUser(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * The radar list: this user's tracked + done rows that have not passed yet,
 * soonest first. Deliberately excludes both dismissed rows (the student said
 * no) and past dates — the radar answers "what is coming at me", and a list
 * that accumulates history stops being scannable within one semester. The rows
 * stay in D1 either way: dismissed ones are what stop a refresh re-adding them.
 */
export async function listUpcoming(env, email, opts = {}) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return [];
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
  try {
    const r = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM deadlines
        WHERE user_id = ? AND status IN ('tracked','done') AND due_date >= ?
        ORDER BY due_date ASC LIMIT ?`,
    ).bind(userId, utcDate(now), limit).all();
    return r.results || [];
  } catch (err) {
    console.warn('deadlines listUpcoming failed', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * The single soonest TRACKED deadline, in the shape the weekly plan, Marco's
 * prompt block and the This Week chip already speak. One indexed row read —
 * cheap enough to run on the /weekly-plan GET so the hero chip and the radar
 * below it can never disagree about what is closing next.
 */
export async function nextTracked(env, email, nowMs) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const row = await env.DB.prepare(
      `SELECT title, org, url, due_date FROM deadlines
        WHERE user_id = ? AND status = 'tracked' AND due_date >= ?
        ORDER BY due_date ASC LIMIT 1`,
    ).bind(userId, utcDate(now)).first();
    if (!row) return null;
    return {
      title: row.title,
      org: row.org || '',
      url: row.url || '',
      deadline: row.due_date,
      daysOut: daysUntil(row.due_date, now),
    };
  } catch (err) {
    console.warn('deadlines nextTracked failed', err && err.message ? err.message : err);
    return null;
  }
}

/** How many rows this account already holds (all statuses) — the MAX_USER_ROWS gate. */
export async function countRows(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return 0;
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM deadlines WHERE user_id = ?').bind(userId).first();
    return Number(row && row.c) || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Insert-or-merge one validated item. Returns 'added' | 'updated' | 'skipped'.
 *
 * The merge match is `title_key` plus a +/-MERGE_WINDOW_DAYS date window, NOT
 * the unique `dedupe_key` — because the case that actually produces duplicates
 * is a refresh correcting a date across a month boundary (Nov 30 → Dec 2),
 * which the month-keyed unique index would happily let through. The unique
 * index is the concurrency backstop; this is the real dedupe.
 */
async function upsertOne(env, userId, item, meta) {
  const { source, careerSlug, nowIso, allowInsert } = meta;
  let existing = [];
  try {
    const r = await env.DB.prepare(
      'SELECT id, due_date, status FROM deadlines WHERE user_id = ? AND title_key = ?',
    ).bind(userId, item.titleKey).all();
    existing = r.results || [];
  } catch (_) {
    existing = [];
  }
  const match = existing.find((row) => dayGap(row.due_date, item.dueDate) <= MERGE_WINDOW_DAYS);

  if (match) {
    try {
      // status is deliberately absent from this SET clause — see the file header.
      await env.DB.prepare(
        `UPDATE deadlines SET title = ?, org = ?, kind = ?, due_date = ?, url = ?,
                dedupe_key = ?, refreshed_at = ?
          WHERE id = ? AND user_id = ?`,
      ).bind(
        item.title, item.org || '', item.kind, item.dueDate, item.url || '',
        item.dedupeKey, nowIso, match.id, userId,
      ).run();
      return 'updated';
    } catch (err) {
      // A dedupe_key collision with a THIRD row of the same title in another
      // month. Leaving the row as it stands is correct — it is already tracked.
      console.warn('deadlines upsert update failed', err && err.message ? err.message : err);
      return 'skipped';
    }
  }

  if (!allowInsert) return 'skipped';
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO deadlines
         (id, user_id, title, org, kind, due_date, url, source, career_slug, status,
          title_key, dedupe_key, created_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'tracked', ?, ?, ?, ?)`,
    ).bind(
      deadlineId(userId, item.dedupeKey), userId, item.title, item.org || '', item.kind,
      item.dueDate, item.url || '', source, careerSlug || '', item.titleKey, item.dedupeKey,
      nowIso, nowIso,
    ).run();
    return (res && res.meta && res.meta.changes) ? 'added' : 'skipped';
  } catch (err) {
    console.warn('deadlines upsert insert failed', err && err.message ? err.message : err);
    return 'skipped';
  }
}

/**
 * Upsert a batch of validated items. Existing rows are refreshed even once the
 * account is at MAX_USER_ROWS — only NEW inserts are refused there, so a full
 * radar keeps getting corrected dates instead of freezing.
 */
export async function upsertDeadlines(env, email, items, opts = {}) {
  const userId = normUser(email);
  const out = { added: 0, updated: 0, skipped: 0 };
  if (!env || !env.DB || !userId || !Array.isArray(items) || !items.length) return out;
  const nowIso = new Date(Number.isFinite(opts.now) ? opts.now : Date.now()).toISOString();
  let count = await countRows(env, email);
  for (const item of items) {
    const result = await upsertOne(env, userId, item, {
      source: opts.source || 'grounded',
      careerSlug: opts.careerSlug || '',
      nowIso,
      allowInsert: count < MAX_USER_ROWS,
    });
    out[result] += 1;
    if (result === 'added') count += 1;
  }
  return out;
}

/**
 * One manually-added row. Returns the stored row, or null when the account is
 * full or the same thing is already tracked (an "add" that silently merged is a
 * success from the student's point of view — the date they wanted is on the
 * radar either way).
 */
export async function insertManual(env, email, value, opts = {}) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return { ok: false, error: 'Could not save that deadline.' };
  const count = await countRows(env, email);
  const nowIso = new Date(Number.isFinite(opts.now) ? opts.now : Date.now()).toISOString();
  const result = await upsertOne(env, userId, value, {
    source: 'manual',
    careerSlug: opts.careerSlug || '',
    nowIso,
    allowInsert: count < MAX_USER_ROWS,
  });
  if (result === 'skipped' && count >= MAX_USER_ROWS) {
    return { ok: false, error: `You are tracking ${MAX_USER_ROWS} deadlines already. Mark a few done first.` };
  }
  const row = await env.DB.prepare(
    `SELECT ${SELECT_COLS} FROM deadlines WHERE user_id = ? AND title_key = ? ORDER BY due_date ASC LIMIT 1`,
  ).bind(userId, value.titleKey).first().catch(() => null);
  return { ok: true, merged: result === 'updated', row: row || null };
}

/**
 * Flip one row's status. Scoped by user_id as well as id — the id is derived
 * from the owner's email so it is not guessable, but a cross-user write must be
 * impossible by construction, not by obscurity.
 * @returns {Promise<boolean>} true when a row actually changed.
 */
export async function setStatus(env, email, id, status) {
  const userId = normUser(email);
  const clean = normalizeStatus(status);
  if (!env || !env.DB || !userId || !clean || !id) return false;
  try {
    const res = await env.DB.prepare(
      'UPDATE deadlines SET status = ? WHERE id = ? AND user_id = ?',
    ).bind(clean, String(id).slice(0, 64), userId).run();
    return !!(res && res.meta && res.meta.changes);
  } catch (err) {
    console.warn('deadlines setStatus failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * Every tracked row landing in one alert tier's day window, for users who are
 * verified AND opted into the deadline category — the gate is in the SQL rather
 * than a per-row check so an unverified or unsubscribed account is never even
 * loaded. Ordered by user so the caller can send ONE email per person listing
 * all of their deadlines in that tier, not one email per row.
 */
export async function selectAlertBatch(env, tier, opts = {}) {
  const spec = ALERT_TIERS.find((t) => t.tier === tier);
  if (!env || !env.DB || !spec) return [];
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const today = utcDate(now);
  const lo = new Date(Date.parse(`${today}T00:00:00Z`) + spec.minDays * DAY_MS).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(`${today}T00:00:00Z`) + spec.maxDays * DAY_MS).toISOString().slice(0, 10);
  const limit = Math.max(1, Math.min(2000, Number(opts.limit) || 500));
  // spec.column comes from the frozen ALERT_TIERS literal, never from a caller.
  if (!ALERT_COLUMNS.has(spec.column)) return [];
  try {
    const r = await env.DB.prepare(
      `SELECT d.id, d.user_id, d.title, d.org, d.url, d.kind, d.due_date
         FROM deadlines d JOIN users u ON u.email = d.user_id
        WHERE d.status = 'tracked'
          AND d.due_date >= ? AND d.due_date <= ?
          AND d.${spec.column} IS NULL
          AND u.verified_at IS NOT NULL
          AND u.notify_deadlines = 1
        ORDER BY d.user_id ASC, d.due_date ASC
        LIMIT ?`,
    ).bind(lo, hi, limit).all();
    return r.results || [];
  } catch (err) {
    // Pre-0019 (no verified_at/notify_deadlines) or pre-0020 (no table): skip
    // the tier rather than emailing everyone. The safe direction, and it heals
    // itself the moment the migration lands.
    console.warn('deadlines selectAlertBatch skipped', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * Mark rows alerted. Called ONLY after a successful send: a Resend outage must
 * leave the rows selectable tomorrow rather than burning the one warning.
 */
export async function markAlerted(env, tier, ids, nowMs) {
  const spec = ALERT_TIERS.find((t) => t.tier === tier);
  const list = (ids || []).filter(Boolean).slice(0, 200);
  if (!env || !env.DB || !spec || !ALERT_COLUMNS.has(spec.column) || !list.length) return 0;
  const nowIso = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  try {
    const holes = list.map(() => '?').join(',');
    const res = await env.DB.prepare(
      `UPDATE deadlines SET ${spec.column} = ? WHERE id IN (${holes})`,
    ).bind(nowIso, ...list).run();
    return (res && res.meta && res.meta.changes) || 0;
  } catch (err) {
    console.warn('deadlines markAlerted failed', err && err.message ? err.message : err);
    return 0;
  }
}

export { VISIBLE_STATUSES };
