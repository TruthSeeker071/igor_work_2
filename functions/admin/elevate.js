// FlightWay — POST /admin/elevate { password }.
//
// Buys a 15-minute elevation lease with the admin's OWN password, so a stolen
// session cookie alone cannot grant plans or mint admins. Both outcomes are
// audited: a run of admin.elevate_fail rows is the signal that a session was
// taken.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { checkRateLimit, clientIp, verifyPassword, DUMMY_PASSWORD_HASH } from '../_lib/auth.js';
import { adminGate, adminNotFound, readJsonBody, grantElevation, audit, ELEVATION_TTL_SEC } from '../_lib/admin.js';

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

  try {
    await checkRateLimit(env, `adminelev:${who.email}`, { max: 10 });
    await checkRateLimit(env, `adminelev:${clientIp(request)}`, { max: 20 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin, { credentials: true });
  }

  const password = String(parsed.body.password || '');
  let row = null;
  try {
    row = await env.DB.prepare('SELECT password_hash FROM users WHERE email = ?').bind(who.email).first();
  } catch (err) {
    console.error('admin/elevate: user read failed', err?.message || err);
    return jsonResponse(500, { error: 'Something went wrong. Please try again.' }, origin, { credentials: true });
  }

  // Always run a real PBKDF2 pass so a missing row can't be timed apart.
  const ok = await verifyPassword(password, (row && row.password_hash) || DUMMY_PASSWORD_HASH);
  if (!ok) {
    await audit(env, who.email, 'admin.elevate_fail', who.email, { ip: clientIp(request) });
    return jsonResponse(401, { error: 'Password is incorrect.' }, origin, { credentials: true });
  }

  const leased = await grantElevation(env, who.email);
  if (!leased) {
    // Elevation fails closed (see requireElevation) — say so rather than let
    // the console show an unlocked UI that every mutation would then reject.
    return jsonResponse(503, { error: 'Elevation store unavailable.' }, origin, { credentials: true });
  }
  await audit(env, who.email, 'admin.elevate', who.email, { ttlSec: ELEVATION_TTL_SEC });
  return jsonResponse(200, { ok: true, elevated: true, elevationTtlSec: ELEVATION_TTL_SEC }, origin, { credentials: true });
}
