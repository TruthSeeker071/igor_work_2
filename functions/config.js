// FlightWay 2.0 — public rollout config for the client (Pillar 0.3).
// GET /config → { paywallEnabled }. Lets assets/js/shared/entitlements.js know
// whether to render upgrade gates. No auth, no secrets.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { paywallEnabled } from './_lib/entitlements.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env));
}

export async function onRequestGet(context) {
  const { env } = context;
  return jsonResponse(200, { paywallEnabled: paywallEnabled(env) }, originFromEnv(env));
}
