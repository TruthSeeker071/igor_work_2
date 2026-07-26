// FlightWay V2 S12 — Application Tracker (plan §5 S12, D13).
//
//   GET  /tracker                              → the board
//   POST /tracker {action:'save', ...}         → track one (finder or manual)
//   POST /tracker {action:'status', id, s}     → move it along the ladder
//   POST /tracker {action:'update', id, ...}   → edit notes / link / company
//   POST /tracker {action:'delete', id}        → untrack it
//
// **The route is `/tracker`, not `/applications`, and that is load-bearing.**
// S2 established that a Pages Function SHADOWS a static asset at the same path
// (it is how `functions/robots.txt.js` beat the old static robots.txt), and
// Pages 308s `/applications.html` to `/applications`. A Function at
// `/applications` would therefore make `applications.html` unreachable — the
// page would answer 401 JSON. S11 hit the identical trap and resolved it the
// same way round: the PAGE keeps the natural name, the ENDPOINT is qualified
// (there, `/review` the page and `/month-review` the endpoint).
//
// FREE on every plan (§4: "Commitments / Evidence Locker / Application Tracker
// (basic) — Free"). There is no `checkFeatureLimit` in this file on purpose: the
// LIST of opportunities is what costs money and `opportunities.js` already meters
// it, so saving something the student has already been shown costs nothing and
// metering it would wall off the one surface that deepens the user graph.
//
// Strictly additive to the roadmap/vector world: this endpoint never reads or
// writes objectiveVector, objectiveAiPatch or the gap-progress-sync chain.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, generateToken, loadRoadmap } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { logServerError } from './_lib/events.js';
import {
  APPLICATION_STATUSES, STATUS_LABELS, STATUS_HINTS, MAX_APPLICATIONS,
  sanitizeApplication, sanitizeApplicationPatch, toClientApplication,
  applicationCounts, normalizeStatus,
} from './_lib/application-core.js';
import {
  listApplications, createApplication, setApplicationStatus,
  updateApplication, deleteApplication, applicationsTableReady,
} from './_lib/application-store.js';
import { sanitizeManualDeadline } from './_lib/deadline-core.js';
import { insertManual } from './_lib/deadline-store.js';
import { resolveCareer } from './_lib/deadline-refresh.js';

const RATE_LIMIT_MAX = 90;

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  return { origin, email, env, request };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `apptrack:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

/**
 * The board payload. `statuses` ships from the server so the client builds its
 * columns and its status `<select>` from one definition — the same discipline
 * S9's radar used for its `kinds` list.
 */
async function boardPayload(env, email) {
  const [rows, available] = await Promise.all([
    listApplications(env, email),
    applicationsTableReady(env),
  ]);
  return {
    applications: rows.map(toClientApplication),
    statuses: APPLICATION_STATUSES.map((s) => ({ id: s, label: STATUS_LABELS[s], hint: STATUS_HINTS[s] })),
    counts: applicationCounts(rows),
    max: MAX_APPLICATIONS,
    // false = migration 0022 is not applied on this database yet. The board
    // renders an honest "not switched on yet" notice rather than an empty board
    // that silently refuses every save.
    available,
  };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  try {
    return jsonResponse(200, await boardPayload(env, email), origin);
  } catch (err) {
    await logServerError(env, 'tracker', err);
    console.warn('tracker GET failed', err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not load your applications.' }, origin);
  }
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const action = String((body && body.action) || '').trim().toLowerCase();

  try {
    if (action === 'save') return await handleSave({ env, email, origin, body });
    if (action === 'status') return await handleStatus({ env, email, origin, body });
    if (action === 'update') return await handleUpdate({ env, email, origin, body });
    if (action === 'delete') return await handleDelete({ env, email, origin, body });
    return jsonResponse(400, { error: 'Unknown action.' }, origin);
  } catch (err) {
    await logServerError(env, 'tracker', err);
    console.warn('tracker POST failed', err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not update your applications.' }, origin);
  }
}

/**
 * A dated opportunity becomes a Deadline Radar row too (§5 S12: "link to
 * deadline if dated"). Best-effort in both directions: a date the radar refuses
 * (already passed, or beyond its 18-month horizon) leaves the application
 * perfectly usable, and `insertManual` merges rather than duplicating, so
 * saving the same program twice does not double the radar.
 */
async function linkDeadline(env, email, { role, company, url, deadline }, opts = {}) {
  if (!deadline) return '';
  const parsed = sanitizeManualDeadline(
    { title: role, org: company, dueDate: deadline, url, kind: 'application-window' },
    { now: opts.now },
  );
  if (!parsed.ok) return '';
  try {
    const saved = await insertManual(env, email, parsed.value, { careerSlug: opts.careerSlug || '', now: opts.now });
    return (saved && saved.ok && saved.row && saved.row.id) || '';
  } catch (_) {
    return '';
  }
}

async function handleSave({ env, email, origin, body }) {
  const parsed = sanitizeApplication(body);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error }, origin);
  if (!(await applicationsTableReady(env))) {
    return jsonResponse(503, {
      error: 'The application tracker is not switched on yet. Nothing you do here is lost — try again shortly.',
      unavailable: true,
    }, origin);
  }
  const now = Date.now();

  let careerSlug = parsed.value.careerSlug;
  let deadlineId = parsed.value.deadlineId;
  if (!deadlineId && body && body.deadline) {
    if (!careerSlug) {
      const [quiz, roadmap] = await Promise.all([
        loadUserBlob(env, email).catch(() => null),
        loadRoadmap(env, email).catch(() => null),
      ]);
      careerSlug = resolveCareer(quiz, roadmap).slug || '';
    }
    deadlineId = await linkDeadline(env, email, {
      role: parsed.value.role, company: parsed.value.company,
      url: parsed.value.url, deadline: body.deadline,
    }, { now, careerSlug });
  }

  const saved = await createApplication(env, email, {
    ...parsed.value, careerSlug, deadlineId,
  }, { now, id: generateToken(12) });
  if (!saved.ok) return jsonResponse(400, { error: saved.error }, origin);

  return jsonResponse(200, {
    ok: true,
    duplicate: !!saved.duplicate,
    application: toClientApplication(saved.row),
    ...(await boardPayload(env, email)),
  }, origin);
}

async function handleStatus({ env, email, origin, body }) {
  const status = normalizeStatus(body && body.status);
  const id = String((body && body.id) || '').slice(0, 64);
  if (!status || !id) return jsonResponse(400, { error: 'Bad status update.' }, origin);
  const res = await setApplicationStatus(env, email, id, status, { now: Date.now() });
  // 404, not 403 — see the ownership note in application-store.js.
  if (!res.ok) return jsonResponse(404, { error: 'Application not found.' }, origin);
  return jsonResponse(200, {
    ok: true, id, status, from: res.from || null,
    advanced: !!res.advanced, changed: !!res.changed,
    application: toClientApplication(res.row),
  }, origin);
}

async function handleUpdate({ env, email, origin, body }) {
  const id = String((body && body.id) || '').slice(0, 64);
  if (!id) return jsonResponse(400, { error: 'Bad update.' }, origin);
  const parsed = sanitizeApplicationPatch(body);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error }, origin);
  const res = await updateApplication(env, email, id, parsed.value, { now: Date.now() });
  if (!res.ok) return jsonResponse(404, { error: 'Application not found.' }, origin);
  return jsonResponse(200, { ok: true, application: toClientApplication(res.row) }, origin);
}

async function handleDelete({ env, email, origin, body }) {
  const id = String((body && body.id) || '').slice(0, 64);
  if (!id) return jsonResponse(400, { error: 'Bad delete.' }, origin);
  const gone = await deleteApplication(env, email, id);
  if (!gone) return jsonResponse(404, { error: 'Application not found.' }, origin);
  return jsonResponse(200, { ok: true, id, ...(await boardPayload(env, email)) }, origin);
}
