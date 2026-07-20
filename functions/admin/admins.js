// FlightWay — GET/POST/DELETE /admin/admins (sub-admin roster).
//
// ROOT-ONLY, on every method: a sub-admin cannot see, create or remove admins,
// so compromising one sub-admin cannot escalate into a second one. Root itself
// lives in the ROOT_ADMIN_EMAIL env var and is never a row here — addAdmin and
// removeAdmin both refuse it as a target.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { checkRateLimit, clientIp } from '../_lib/auth.js';
import {
  adminGate, adminNotFound, readJsonBody, requireElevation,
  listAdmins, addAdmin, removeAdmin,
} from '../_lib/admin.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

/** Root gate. Returns null when the caller must get a 404 (non-admin OR sub-admin). */
async function rootGate(request, env) {
  const who = await adminGate(request, env);
  if (!who || !who.root) return null;
  return who;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await rootGate(request, env);
  if (!who) return adminNotFound(origin);

  try {
    return jsonResponse(200, { admins: await listAdmins(env) }, origin, { credentials: true });
  } catch (err) {
    console.error('admin/admins list failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not load admins.' }, origin, { credentials: true });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await rootGate(request, env);
  if (!who) return adminNotFound(origin);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResponse(parsed.status, { error: parsed.error }, origin, { credentials: true });

  const guard = await mutationGuard(env, request, who);
  if (guard) return guard;

  try {
    const result = await addAdmin(env, who.email, parsed.body.email);
    if (!result.ok) return jsonResponse(400, { error: result.error }, origin, { credentials: true });
    return jsonResponse(200, result, origin, { credentials: true });
  } catch (err) {
    console.error('admin/admins add failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not add the admin.' }, origin, { credentials: true });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await rootGate(request, env);
  if (!who) return adminNotFound(origin);

  const guard = await mutationGuard(env, request, who);
  if (guard) return guard;

  let email = '';
  try { email = new URL(request.url).searchParams.get('email') || ''; } catch (_) { email = ''; }

  try {
    const result = await removeAdmin(env, who.email, email);
    if (!result.ok) return jsonResponse(400, { error: result.error }, origin, { credentials: true });
    return jsonResponse(200, result, origin, { credentials: true });
  } catch (err) {
    console.error('admin/admins remove failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not remove the admin.' }, origin, { credentials: true });
  }
}

/** Elevation + rate limit, shared by POST and DELETE. Returns a Response on refusal. */
async function mutationGuard(env, request, who) {
  const origin = originFromEnv(env, request);
  if (!(await requireElevation(env, who.email))) {
    return jsonResponse(403, { error: 'Confirm your password to make changes.', elevate: true }, origin, { credentials: true });
  }
  try {
    await checkRateLimit(env, `adminrole:${who.email}`, { max: 30 });
    await checkRateLimit(env, `adminrole:${clientIp(request)}`, { max: 30 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin, { credentials: true });
  }
  return null;
}
