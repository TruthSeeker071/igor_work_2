/**
 * FlightWay V2 S17 — Network mapper D1 layer (migration 0025).
 *
 * Every read and write of the `contacts` table goes through here. Pure shaping,
 * archetype generation and draft validation live in contact-core.js; nothing in
 * this file talks to Gemini, KV or the vector pipeline.
 *
 * Two rules, both the same ones S9/S12/S16 settled on:
 *
 *  1. **Every read and write is scoped `WHERE user_id = ?`**, and a miss is 404
 *     rather than 403 at the caller. This table names people a student is trying
 *     to get a job through; ids are unguessable, but "unguessable" is a property
 *     of the id generator and "impossible" is a property of the query.
 *  2. **Every function degrades to an empty answer rather than throwing** when
 *     0025 has not been applied. The panel then says "not switched on yet" out
 *     loud, which is the only honest shape — "not switched on" and "your save
 *     failed" look identical from outside and only one is actionable.
 */

import { MAX_CONTACTS_PER_USER } from './contact-core.js';

const SELECT_COLS = 'id, user_id, archetype, label, org_type, how_to_find, name, org, channel, '
  + 'status, draft_subject, draft_body, notes, career_slug, step_id, created_at, updated_at, status_at';

function normUser(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Is migration 0025 applied? Asked so the surface can say "not switched on yet"
 * instead of showing an empty list that silently rejects every write.
 */
export async function contactsTableReady(env) {
  if (!env || !env.DB) return false;
  try {
    await env.DB.prepare('SELECT 1 FROM contacts LIMIT 1').first();
    return true;
  } catch (_) {
    return false;
  }
}

/** One account's whole list, newest first. */
export async function listContacts(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return [];
  try {
    const r = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM contacts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).bind(userId, MAX_CONTACTS_PER_USER).all();
    return r.results || [];
  } catch (err) {
    console.warn('contacts list failed', err && err.message ? err.message : err);
    return [];
  }
}

/** One row by id, email-scoped. Returns null for someone else's row. */
export async function getContact(env, email, id) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return null;
  try {
    return await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM contacts WHERE id = ? AND user_id = ?`,
    ).bind(key, userId).first() || null;
  } catch (err) {
    console.warn('contacts get failed', err && err.message ? err.message : err);
    return null;
  }
}

/** How many rows this account holds, for the MAX_CONTACTS_PER_USER wall. */
export async function countContacts(env, email) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return 0;
  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM contacts WHERE user_id = ?',
    ).bind(userId).first();
    return Number(row && row.n) || 0;
  } catch (_) {
    return 0;
  }
}

/** Random id, same generator shape as the rest of the V2 tables. */
function newId() {
  try {
    const b = new Uint8Array(9);
    crypto.getRandomValues(b);
    return 'ct' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
  } catch (_) {
    return 'ct' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Create one row. Returns `{ ok, id, reason? }`.
 *
 * `status_at` is deliberately NOT written here: it is NULL until the first real
 * status change, so the digest's stale-draft sweep can never mistake a row that
 * was merely created for a draft that was written. Same column semantics as
 * `applications.status_at` (0022).
 */
export async function insertContact(env, email, row = {}) {
  const userId = normUser(email);
  if (!env || !env.DB || !userId) return { ok: false, id: '', reason: 'not-ready' };
  if ((await countContacts(env, email)) >= MAX_CONTACTS_PER_USER) {
    return { ok: false, id: '', reason: 'list-full' };
  }
  const id = newId();
  const at = new Date(Number.isFinite(row.now) ? row.now : Date.now()).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO contacts
         (id, user_id, archetype, label, org_type, how_to_find, name, org, channel, status,
          draft_subject, draft_body, notes, career_slug, step_id, created_at, updated_at, status_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      id, userId,
      String(row.archetype || ''), String(row.label || ''), String(row.orgType || ''),
      String(row.howToFind || ''), String(row.name || ''), String(row.org || ''),
      String(row.channel || 'email'), 'suggested',
      String(row.notes || ''), String(row.careerSlug || ''), String(row.stepId || ''),
      at, at,
    ).run();
  } catch (err) {
    console.warn('contacts insert failed', err && err.message ? err.message : err);
    return { ok: false, id: '', reason: 'save-failed' };
  }
  return { ok: true, id };
}

/**
 * Attach a draft and move the row to 'drafted'.
 *
 * `status_at` moves here because writing the draft IS the status change, and it
 * is what the stale-draft nudge measures from. Re-drafting an already-drafted row
 * re-stamps it, which is correct: a student who rewrote the message yesterday has
 * not been sitting on it for a week.
 */
export async function saveDraft(env, email, id, { subject, body, now } = {}) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return false;
  const at = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  try {
    const res = await env.DB.prepare(
      `UPDATE contacts SET draft_subject = ?, draft_body = ?, status = 'drafted',
              status_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`,
    ).bind(String(subject || ''), String(body || ''), at, at, key, userId).run();
    return !!(res && res.meta && res.meta.changes);
  } catch (err) {
    console.warn('contacts saveDraft failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * Move one row along the ladder. `status_at` moves ONLY on a real change, so a
 * student re-selecting the status they are already on does not reset the clock
 * the nudge reads.
 */
export async function setStatus(env, email, id, status, { now } = {}) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return { ok: false, changed: false };
  const at = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  try {
    const res = await env.DB.prepare(
      `UPDATE contacts
          SET status = ?,
              status_at = CASE WHEN status = ? THEN status_at ELSE ? END,
              updated_at = ?
        WHERE id = ? AND user_id = ?`,
    ).bind(String(status), String(status), at, at, key, userId).run();
    return { ok: !!(res && res.meta && res.meta.changes), changed: true };
  } catch (err) {
    console.warn('contacts setStatus failed', err && err.message ? err.message : err);
    return { ok: false, changed: false };
  }
}

/**
 * Edit the student's own fields. Metadata only — never the draft, and never the
 * status: those have their own paths so that "I renamed this person" can never be
 * the request that silently marks a message sent.
 */
export async function updateContact(env, email, id, patch = {}) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return false;
  const sets = [];
  const binds = [];
  for (const [col, val] of [['name', patch.name], ['org', patch.org], ['notes', patch.notes], ['channel', patch.channel]]) {
    if (val === undefined) continue;
    sets.push(`${col} = ?`);
    binds.push(String(val || ''));
  }
  if (!sets.length) return false;
  sets.push('updated_at = ?');
  binds.push(new Date(Number.isFinite(patch.now) ? patch.now : Date.now()).toISOString());
  try {
    const res = await env.DB.prepare(
      `UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    ).bind(...binds, key, userId).run();
    return !!(res && res.meta && res.meta.changes);
  } catch (err) {
    console.warn('contacts update failed', err && err.message ? err.message : err);
    return false;
  }
}

/** Remove one row. Email-scoped, so a miss is indistinguishable from a wrong id. */
export async function deleteContact(env, email, id) {
  const userId = normUser(email);
  const key = String(id || '').slice(0, 64);
  if (!env || !env.DB || !userId || !key) return false;
  try {
    const res = await env.DB.prepare(
      'DELETE FROM contacts WHERE id = ? AND user_id = ?',
    ).bind(key, userId).run();
    return !!(res && res.meta && res.meta.changes);
  } catch (err) {
    console.warn('contacts delete failed', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * How many drafts each account has been sitting on, for the weekly digest.
 *
 * ONE aggregate for the whole cron run rather than a read per recipient — the
 * `capHitsByUser`/`countMovedByUser` shape S11 and S12 established. Reads
 * `status_at`, never `updated_at`: a student who fixed a typo has not re-drafted
 * anything, and treating that as fresh is how a nudge stops nudging.
 *
 * Returns an empty Map when 0025 is unapplied, so a pending migration costs the
 * digest one line rather than the whole send.
 */
export async function staleDraftsByUser(env, beforeIso) {
  const out = new Map();
  if (!env || !env.DB) return out;
  try {
    const r = await env.DB.prepare(
      `SELECT user_id, COUNT(*) AS n FROM contacts
        WHERE status = 'drafted' AND status_at IS NOT NULL AND status_at < ?
        GROUP BY user_id`,
    ).bind(String(beforeIso || '')).all();
    for (const row of (r.results || [])) {
      const n = Number(row && row.n) || 0;
      if (row && row.user_id && n > 0) out.set(row.user_id, n);
    }
  } catch (err) {
    console.warn('contacts staleDraftsByUser skipped', err && err.message ? err.message : err);
  }
  return out;
}
