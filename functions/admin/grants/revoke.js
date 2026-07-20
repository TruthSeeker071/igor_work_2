// FlightWay — POST /admin/grants/revoke { email }.
//
// Resets the plan to free ONLY when plan_source = 'comp' (the guard lives in
// revokeGrant's SQL), so revoking a comp from someone who has since paid never
// strips the plan they bought.

import { originFromEnv, jsonResponse, preflightResponse } from '../../_lib.js';
import { checkRateLimit, clientIp } from '../../_lib/auth.js';
import { adminGate, adminNotFound, readJsonBody, requireElevation, revokeGrant } from '../../_lib/admin.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResponse(parsed.status, { error: parsed.error }, origin, { credentials: true });

  if (!(await requireElevation(env, who.email))) {
    return jsonResponse(403, { error: 'Confirm your password to make changes.', elevate: true }, origin, { credentials: true });
  }

  try {
    await checkRateLimit(env, `admingrant:${who.email}`, { max: 60 });
    await checkRateLimit(env, `admingrant:${clientIp(request)}`, { max: 60 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin, { credentials: true });
  }

  try {
    const result = await revokeGrant(env, who.email, parsed.body.email);
    if (!result.ok) return jsonResponse(400, { error: result.error }, origin, { credentials: true });
    return jsonResponse(200, result, origin, { credentials: true });
  } catch (err) {
    console.error('admin/grants/revoke failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not revoke the grant.' }, origin, { credentials: true });
  }
}
