// FlightWay 2.0 — public rollout config for the client (Pillar 0.3).
// GET /config → { paywallEnabled, stripeEnabled }. Lets
// assets/js/shared/entitlements.js know whether to render upgrade gates, and
// assets/js/shared/billing.js whether real checkout exists on this deployment
// (it doesn't wherever the Stripe keys aren't set — pricing.html then keeps its
// fake-door intent modal). Booleans only: no auth, no secrets, no key material.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { paywallEnabled } from './_lib/entitlements.js';
import { stripeConfigured, stripeTestMode } from './_lib/stripe.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const stripeEnabled = stripeConfigured(env);
  return jsonResponse(200, {
    paywallEnabled: paywallEnabled(env),
    stripeEnabled,
    // Surfaced so the UI can say "test mode" out loud instead of looking like a
    // real charge during the pre-launch validation run.
    stripeTestMode: stripeEnabled && stripeTestMode(env),
  }, originFromEnv(env, request));
}
