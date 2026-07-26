// FlightWay V2 S9 — Deadline Radar (D12).
//
//   GET  /deadlines                          → the radar: upcoming tracked/done rows
//   POST /deadlines {action:'refresh'}       → one grounded extraction (metered §4)
//   POST /deadlines {action:'add', ...}      → a manually typed deadline (free)
//   POST /deadlines {action:'status', id, s} → track / dismiss / done
//
// House patterns: session-gated, IP rate-limited, the §4 meter on the ONE action
// that spends money. Viewing and alerts are free on every plan (§4) — the meter
// is on `refresh` alone, because a grounded refresh is three live web calls plus
// a shaping call and nothing else here costs anything.
//
// Strictly additive to the roadmap/vector world: this endpoint never reads or
// writes objectiveVector, objectiveAiPatch or the gap-progress-sync chain. It
// reads the roadmap only to learn which career the student is aiming at.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, loadRoadmap } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { resolveSchool } from './_lib/school.js';
import { resolveEntitlement } from './_lib/entitlements.js';
import { checkFeatureLimit, refundFeatureUse } from './_lib/plan-limits.js';
import { groundingEnabled } from './_lib/gemini-grounded.js';
import { logServerError } from './_lib/events.js';
import {
  DEADLINE_KINDS, sanitizeManualDeadline, toClientDeadline, normalizeStatus,
} from './_lib/deadline-core.js';
import { listUpcoming, insertManual, setStatus } from './_lib/deadline-store.js';
import { refreshDeadlinesForUser, resolveCareer } from './_lib/deadline-refresh.js';

const RATE_LIMIT_MAX = 60;

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  const ent = await resolveEntitlement(env, email);
  return { origin, email, env, request, plan: ent.effective };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `dlradar:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

/** The allowance, peeked (never spent) — what the client renders its meter from. */
async function capState(env, email, plan) {
  const cap = await checkFeatureLimit(env, email, 'deadline-refresh', { spend: false, plan });
  return {
    limit: cap.limit === undefined ? null : cap.limit,
    remaining: cap.unlimited ? null : cap.remaining,
    resetPeriod: cap.resetPeriod || 'week',
    unlimited: !!cap.unlimited,
    ok: !!cap.ok,
  };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  try {
    const now = Date.now();
    const [rows, cap] = await Promise.all([
      listUpcoming(env, email, { now }),
      capState(env, email, plan),
    ]);
    const grounded = groundingEnabled(env);
    return jsonResponse(200, {
      deadlines: rows.map((r) => toClientDeadline(r, now)),
      kinds: DEADLINE_KINDS,
      grounded,
      // Both halves matter to the UI: with grounding dark there is nothing to
      // refresh FROM, which is a different sentence than "you have used your
      // one this week", and a button that silently does nothing is the worst
      // of the three.
      canRefresh: grounded && cap.ok,
      cap,
    }, origin);
  } catch (err) {
    await logServerError(env, 'deadlines', err);
    console.warn('deadlines GET failed', err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not load your deadlines.' }, origin);
  }
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const action = String((body && body.action) || '').trim().toLowerCase();

  try {
    if (action === 'refresh') return await handleRefresh(context, { env, email, origin, plan });
    if (action === 'add') return await handleAdd({ env, email, origin, body });
    if (action === 'status') return await handleStatus({ env, email, origin, body });
    return jsonResponse(400, { error: 'Unknown action.' }, origin);
  } catch (err) {
    await logServerError(env, 'deadlines', err);
    console.warn('deadlines POST failed', err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not update your deadlines.' }, origin);
  }
}

async function handleRefresh(context, { env, email, origin, plan }) {
  const now = Date.now();
  const list = async () => (await listUpcoming(env, email, { now })).map((r) => toClientDeadline(r, now));

  if (!groundingEnabled(env)) {
    return jsonResponse(200, { ok: false, reason: 'grounding-off', deadlines: await list(), cap: await capState(env, email, plan) }, origin);
  }

  // §4: one grounded refresh a week on free, on demand for paid. Spent BEFORE
  // the work (three live web calls are billed whether or not we like the
  // answer) and handed back below on the two failures the student did not cause.
  const cap = await checkFeatureLimit(env, email, 'deadline-refresh', { plan });
  if (!cap.ok) {
    return jsonResponse(200, {
      ok: false,
      reason: 'capped',
      deadlines: await list(),
      cap: {
        limit: cap.limit, remaining: 0, resetPeriod: cap.resetPeriod || 'week',
        unlimited: false, ok: false, message: cap.message, upgrade: !!cap.upgrade,
      },
    }, origin);
  }

  const school = await resolveSchool(env, email).catch(() => '');
  const res = await refreshDeadlinesForUser(env, email, { school, now });
  if (res.reason === 'no-results' || res.reason === 'shape-failed') {
    // Nothing was produced. An exhausted grounding budget or a failed shaping
    // call must not cost the student their one refresh of the week.
    await refundFeatureUse(env, email, 'deadline-refresh', { plan });
  }

  const after = Date.now();
  return jsonResponse(200, {
    ok: !!res.ok,
    reason: res.reason || null,
    added: res.added,
    updated: res.updated,
    found: res.found,
    fetchedAt: res.fetchedAt,
    deadlines: (await listUpcoming(env, email, { now: after })).map((r) => toClientDeadline(r, after)),
    cap: await capState(env, email, plan),
  }, origin);
}

async function handleAdd({ env, email, origin, body }) {
  const now = Date.now();
  const parsed = sanitizeManualDeadline(body, { now });
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error }, origin);

  const [quiz, roadmap] = await Promise.all([
    loadUserBlob(env, email).catch(() => null),
    loadRoadmap(env, email).catch(() => null),
  ]);
  const saved = await insertManual(env, email, parsed.value, {
    careerSlug: resolveCareer(quiz, roadmap).slug, now,
  });
  if (!saved.ok) return jsonResponse(400, { error: saved.error }, origin);
  return jsonResponse(200, {
    ok: true,
    merged: !!saved.merged,
    deadline: saved.row ? toClientDeadline(saved.row, now) : null,
    deadlines: (await listUpcoming(env, email, { now })).map((r) => toClientDeadline(r, now)),
  }, origin);
}

async function handleStatus({ env, email, origin, body }) {
  const status = normalizeStatus(body && body.status);
  const id = String((body && body.id) || '').slice(0, 64);
  if (!status || !id) return jsonResponse(400, { error: 'Bad status update.' }, origin);
  const changed = await setStatus(env, email, id, status);
  if (!changed) return jsonResponse(404, { error: 'Deadline not found.' }, origin);
  return jsonResponse(200, { ok: true, id, status }, origin);
}
