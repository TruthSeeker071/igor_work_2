// FlightWay — admin console core (migration 0016).
//
// Three ideas hold this together:
//
// 1. ROOT lives in an env var, never in D1. `ROOT_ADMIN_EMAIL` is set per
//    project in the Cloudflare dashboard and is never committed. No SQL write
//    — not even one made by a compromised sub-admin — can mint or remove the
//    root admin, and every mutation below refuses a target equal to it.
// 2. A comp grant writes the SAME users.plan / users.plan_expires_at columns a
//    purchase writes. getPlan() therefore picks a comp up with ZERO new reads,
//    and resolveEntitlement / requirePlan / checkFeatureLimit stay untouched.
//    `plan_source` records who wrote those columns so revoke can be surgical
//    and the Stripe webhook knows not to trample a comp.
// 3. Comped users are REAL users. No `dev:true` is ever attached to them, so
//    they stay in analytics, digests and funnel counts — unlike DEV_TEST_EMAILS
//    (§3.5), which is a different mechanism for a different purpose.
//
// Elevation (a 15-minute COACH_KV lease bought with the admin's own password)
// gates every mutation. It fails CLOSED when KV is missing: unlike the usage
// counters in plan-limits.js, a binding outage here must not open the console.

import { normalizeEmail, isValidEmail, jsonResponse } from '../_lib.js';
import { normalizePlan } from './entitlements.js';
import { getSessionEmail } from './auth.js';

export const ELEVATION_TTL_SEC = 15 * 60;
export const PLAN_SOURCE_COMP = 'comp';
export const PLAN_SOURCE_STRIPE = 'stripe';
/** Free is not a comp — a grant that grants nothing would just be a downgrade. */
export const COMP_PLANS = ['premium', 'lifetime'];
const NOTE_MAX = 300;
const AUDIT_DETAIL_MAX = 2000;

function nowIso() { return new Date().toISOString(); }

// ------------------------------------------------------------------ identity

export function rootAdminEmail(env) {
  return normalizeEmail((env && env.ROOT_ADMIN_EMAIL) || '');
}

export function isRootAdmin(env, email) {
  const root = rootAdminEmail(env);
  return !!root && normalizeEmail(email) === root;
}

/** The root admin is never a valid target of any mutation (grant, revoke, demote). */
export function isProtectedTarget(env, email) {
  return isRootAdmin(env, email);
}

/**
 * Env-var check first (no I/O for root), then at most ONE admin_roles read.
 * Returns { ok, root } — callers 404 when !ok so the console's existence is
 * not discoverable by a signed-in non-admin.
 */
export async function requireAdmin(env, email) {
  const who = normalizeEmail(email);
  if (!who) return { ok: false, root: false };
  if (isRootAdmin(env, who)) return { ok: true, root: true, email: who };
  if (!env || !env.DB) return { ok: false, root: false };
  try {
    const row = await env.DB.prepare('SELECT email FROM admin_roles WHERE email = ?').bind(who).first();
    return row ? { ok: true, root: false, email: who } : { ok: false, root: false };
  } catch (err) {
    console.error('admin: admin_roles read failed', err?.message || err);
    return { ok: false, root: false };
  }
}

/** Session + admin gate. Returns null when the caller must answer 404. */
export async function adminGate(request, env) {
  let email = null;
  try {
    email = await getSessionEmail(request, env);
  } catch (_) { return null; }
  if (!email || !isValidEmail(email)) return null;
  const who = await requireAdmin(env, email);
  if (!who.ok) return null;
  return { email: normalizeEmail(email), root: who.root };
}

/**
 * The single answer every admin endpoint gives to a caller who is not an
 * admin — including one who is not signed in at all. A 401/403 would confirm
 * the console exists; 404 says nothing.
 */
export function adminNotFound(origin) {
  return jsonResponse(404, { error: 'Not found.' }, origin);
}

/**
 * Mutations must be sent as JSON. Requiring the header (not just parsing the
 * body) is what stops a cross-site form POST — forms can only send
 * form-urlencoded/plain-text, so they can never satisfy this check.
 */
export async function readJsonBody(request) {
  const ct = String((request.headers && request.headers.get('Content-Type')) || '').toLowerCase();
  if (ct.indexOf('application/json') < 0) {
    return { ok: false, status: 415, error: 'Content-Type must be application/json.' };
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'Invalid JSON body.' };
    return { ok: true, body };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body.' };
  }
}

// ----------------------------------------------------------------- elevation

export function elevationKey(email) {
  return `admin_elev:${normalizeEmail(email)}`;
}

export async function grantElevation(env, email) {
  if (!env || !env.COACH_KV) return false;
  await env.COACH_KV.put(elevationKey(email), nowIso(), { expirationTtl: ELEVATION_TTL_SEC });
  return true;
}

/** Fails CLOSED: no KV binding, no elevation, no mutations. */
export async function requireElevation(env, email) {
  if (!env || !env.COACH_KV) return false;
  try {
    return (await env.COACH_KV.get(elevationKey(email))) != null;
  } catch (err) {
    console.error('admin: elevation read failed', err?.message || err);
    return false;
  }
}

export async function clearElevation(env, email) {
  if (!env || !env.COACH_KV || typeof env.COACH_KV.delete !== 'function') return;
  try { await env.COACH_KV.delete(elevationKey(email)); } catch (_) { /* best effort */ }
}

// --------------------------------------------------------------------- audit

/**
 * Append one row to admin_audit_log. Never throws and never blocks the action
 * it is recording — a failed audit write is logged and swallowed, because the
 * alternative (a 500 after the mutation already landed) is strictly worse.
 */
export async function audit(env, actor, action, target, detail) {
  if (!env || !env.DB) return;
  let json = null;
  if (detail != null) {
    try { json = JSON.stringify(detail).slice(0, AUDIT_DETAIL_MAX); } catch { json = null; }
  }
  try {
    await env.DB.prepare(
      'INSERT INTO admin_audit_log (id, actor_email, action, target_email, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      normalizeEmail(actor) || null,
      String(action || '').slice(0, 60),
      normalizeEmail(target) || null,
      json,
      nowIso(),
    ).run();
  } catch (err) {
    console.error('admin: audit write failed', action, err?.message || err);
  }
}

export async function listAudit(env, opts = {}) {
  if (!env || !env.DB) return { rows: [], limit: 0, offset: 0 };
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const res = await env.DB.prepare(
    'SELECT id, actor_email, action, target_email, detail, created_at FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
  ).bind(limit, offset).all();
  return { rows: (res && res.results) || [], limit, offset };
}

// -------------------------------------------------------------- comp grants

/** Validate + normalize a grant request body. Returns { ok, error? } shape. */
export function normalizeGrantInput(env, body) {
  const email = normalizeEmail(body && body.email);
  if (!isValidEmail(email)) return { ok: false, error: 'Please provide a valid email address.' };
  if (isProtectedTarget(env, email)) return { ok: false, error: 'The root admin cannot be a grant target.' };

  const plan = normalizePlan(body && body.plan);
  if (!COMP_PLANS.includes(plan)) return { ok: false, error: 'Plan must be premium or lifetime.' };

  let expiresAt = null;
  if (plan === 'premium') {
    const days = Number(body && body.days);
    const raw = String((body && body.expiresAt) || '').trim();
    if (Number.isFinite(days) && days > 0) {
      expiresAt = new Date(Date.now() + Math.min(days, 3650) * 86400000).toISOString();
    } else if (raw) {
      const t = Date.parse(raw);
      if (!Number.isFinite(t)) return { ok: false, error: 'Expiry date is not a valid date.' };
      expiresAt = new Date(t).toISOString();
    }
  }

  const note = String((body && body.note) || '').trim().slice(0, NOTE_MAX);
  return { ok: true, email, plan, expiresAt, note: note || null };
}

/**
 * Write the plan columns for a comp. This is the ONLY place a comp touches
 * users — and it writes exactly what a purchase writes, which is why the
 * entitlement chokepoints need no changes.
 */
async function writeCompPlan(env, email, plan, expiresAt) {
  const res = await env.DB.prepare(
    'UPDATE users SET plan = ?, plan_expires_at = ?, plan_source = ? WHERE email = ?',
  ).bind(plan, expiresAt || null, PLAN_SOURCE_COMP, email).run();
  return ((res && res.meta && res.meta.changes) || 0) > 0;
}

async function userExists(env, email) {
  const row = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  return !!row;
}

/**
 * Create (or overwrite) a comp grant and apply it immediately when the email
 * already has an account. An unregistered email leaves a PENDING row that
 * consumePendingGrant() picks up at signup.
 */
export async function createGrant(env, actor, input) {
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO comp_grants (email, plan, expires_at, granted_by, created_at, applied_at, revoked_at, note)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(email) DO UPDATE SET
       plan = excluded.plan, expires_at = excluded.expires_at, granted_by = excluded.granted_by,
       created_at = excluded.created_at, applied_at = NULL, revoked_at = NULL, note = excluded.note`,
  ).bind(input.email, input.plan, input.expiresAt, normalizeEmail(actor), ts, input.note).run();

  const exists = await userExists(env, input.email);
  let applied = false;
  if (exists) {
    applied = await writeCompPlan(env, input.email, input.plan, input.expiresAt);
    if (applied) {
      await env.DB.prepare('UPDATE comp_grants SET applied_at = ? WHERE email = ?').bind(ts, input.email).run();
    }
  }

  await audit(env, actor, applied ? 'grant.create_apply' : 'grant.create_pending', input.email, {
    plan: input.plan, expiresAt: input.expiresAt, note: input.note, applied,
  });

  return { ok: true, applied, pending: !applied, email: input.email, plan: input.plan, expiresAt: input.expiresAt };
}

/**
 * Revoke a comp. The users write is guarded by plan_source = 'comp', so a user
 * who bought a real plan after being comped keeps what they paid for.
 */
export async function revokeGrant(env, actor, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: 'Please provide a valid email address.' };
  if (isProtectedTarget(env, email)) return { ok: false, error: 'The root admin cannot be a revoke target.' };

  const ts = nowIso();
  const res = await env.DB.prepare(
    'UPDATE comp_grants SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL',
  ).bind(ts, email).run();
  const hadGrant = ((res && res.meta && res.meta.changes) || 0) > 0;

  const reset = await env.DB.prepare(
    'UPDATE users SET plan = ?, plan_expires_at = NULL, plan_source = NULL WHERE email = ? AND plan_source = ?',
  ).bind('free', email, PLAN_SOURCE_COMP).run();
  const resetPlan = ((reset && reset.meta && reset.meta.changes) || 0) > 0;

  await audit(env, actor, 'grant.revoke', email, { hadGrant, resetPlan });
  return { ok: true, hadGrant, resetPlan, email };
}

/**
 * Consume a pending comp at signup. Called from functions/auth/register.js
 * right after createUser(). Never throws — a comp that fails to apply must not
 * fail the registration; it stays pending and can be re-applied by an admin.
 */
export async function consumePendingGrant(env, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!env || !env.DB || !isValidEmail(email)) return { applied: false };
  try {
    const row = await env.DB.prepare(
      'SELECT plan, expires_at FROM comp_grants WHERE email = ? AND applied_at IS NULL AND revoked_at IS NULL',
    ).bind(email).first();
    if (!row) return { applied: false };

    // Applied as-is even if the expiry is already past: effectivePlan() in
    // entitlements.js degrades an expired premium to free on read, so there is
    // exactly one place that decides what an expiry means.
    const plan = normalizePlan(row.plan);
    if (!COMP_PLANS.includes(plan)) return { applied: false };
    const applied = await writeCompPlan(env, email, plan, row.expires_at);
    if (!applied) return { applied: false };

    await env.DB.prepare('UPDATE comp_grants SET applied_at = ? WHERE email = ?').bind(nowIso(), email).run();
    await audit(env, 'system', 'grant.apply_at_signup', email, { plan, expiresAt: row.expires_at || null });
    return { applied: true, plan, expiresAt: row.expires_at || null };
  } catch (err) {
    console.error('admin: pending comp apply failed', err?.message || err);
    return { applied: false };
  }
}

export async function listGrants(env, opts = {}) {
  if (!env || !env.DB) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const res = await env.DB.prepare(
    `SELECT g.email, g.plan, g.expires_at, g.granted_by, g.created_at, g.applied_at, g.revoked_at, g.note,
            u.plan AS user_plan, u.plan_expires_at AS user_plan_expires_at, u.plan_source AS user_plan_source
       FROM comp_grants g LEFT JOIN users u ON u.email = g.email
      ORDER BY g.created_at DESC LIMIT ?`,
  ).bind(limit).all();
  return (res && res.results) || [];
}

// -------------------------------------------------------------- admin roles

export async function listAdmins(env) {
  if (!env || !env.DB) return [];
  const res = await env.DB.prepare(
    'SELECT email, granted_by, created_at FROM admin_roles ORDER BY created_at DESC',
  ).all();
  return (res && res.results) || [];
}

export async function addAdmin(env, actor, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: 'Please provide a valid email address.' };
  // Root already has access via the env var; a D1 row for it would be a lie
  // (and a demotion target). Refuse rather than silently no-op.
  if (isProtectedTarget(env, email)) return { ok: false, error: 'The root admin is set by env var, not by this table.' };

  await env.DB.prepare(
    'INSERT INTO admin_roles (email, granted_by, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING',
  ).bind(email, normalizeEmail(actor), nowIso()).run();
  await audit(env, actor, 'admin.add', email, null);
  return { ok: true, email };
}

export async function removeAdmin(env, actor, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: 'Please provide a valid email address.' };
  if (isProtectedTarget(env, email)) return { ok: false, error: 'The root admin cannot be demoted.' };

  const res = await env.DB.prepare('DELETE FROM admin_roles WHERE email = ?').bind(email).run();
  const removed = ((res && res.meta && res.meta.changes) || 0) > 0;
  await clearElevation(env, email);
  await audit(env, actor, 'admin.remove', email, { removed });
  return { ok: true, removed, email };
}

// --------------------------------------------------- stripe interop (§4)

/**
 * The users-row write a Stripe grant should make, as data so it is unit
 * testable without a webhook delivery.
 *
 *   null            → write nothing
 *   skipComp: true  → the UPDATE must carry `AND plan_source != 'comp'`, so a
 *                     cancellation/expiry never strips a comp off a user who
 *                     also happened to have a subscription.
 *
 * A purchase always stamps 'stripe' and MAY overwrite a comp — money wins.
 */
export function stripePlanWrite(grant) {
  if (!grant || grant.skip || !grant.plan) return null;
  if (normalizePlan(grant.plan) === 'free') {
    return { plan: 'free', expiresAt: null, source: null, skipComp: true };
  }
  return { plan: grant.plan, expiresAt: grant.expiresAt || null, source: PLAN_SOURCE_STRIPE, skipComp: false };
}
