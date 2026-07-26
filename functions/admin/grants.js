// FlightWay — GET/POST /admin/grants (comp plan grants).
//
// A grant writes users.plan / users.plan_expires_at / plan_source='comp' — the
// same columns a purchase writes — so getPlan() picks it up with zero new
// reads and nothing in the entitlement chokepoints changes. An email with no
// account yet leaves a pending row that auth/register.js consumes at signup.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { checkRateLimit, hashedIpKey } from '../_lib/auth.js';
import {
  adminGate, adminNotFound, readJsonBody, requireElevation,
  normalizeGrantInput, createGrant, listGrants,
} from '../_lib/admin.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  let limit = 100;
  try { limit = Number(new URL(request.url).searchParams.get('limit')) || 100; } catch (_) { /* default */ }

  try {
    return jsonResponse(200, { grants: await listGrants(env, { limit }) }, origin, { credentials: true });
  } catch (err) {
    console.error('admin/grants list failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not load grants.' }, origin, { credentials: true });
  }
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
    await checkRateLimit(env, `admingrant:${await hashedIpKey(env, request)}`, { max: 60 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin, { credentials: true });
  }

  const input = normalizeGrantInput(env, parsed.body);
  if (!input.ok) return jsonResponse(400, { error: input.error }, origin, { credentials: true });

  try {
    const result = await createGrant(env, who.email, input);
    return jsonResponse(200, result, origin, { credentials: true });
  } catch (err) {
    console.error('admin/grants create failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not save the grant.' }, origin, { credentials: true });
  }
}
