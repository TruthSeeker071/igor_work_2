// FlightWay — GET /admin/whoami. The admin console's boot probe.
// Answers 404 to everyone who is not an admin (including signed-out callers),
// so the console's existence is not discoverable.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { adminGate, adminNotFound, requireElevation, ELEVATION_TTL_SEC } from '../_lib/admin.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  const elevated = await requireElevation(env, who.email);
  return jsonResponse(200, {
    email: who.email,
    admin: true,
    root: who.root,
    elevated,
    elevationTtlSec: ELEVATION_TTL_SEC,
  }, origin, { credentials: true });
}
