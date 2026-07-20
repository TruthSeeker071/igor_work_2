import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  getSessionEmail,
} from '../_lib/auth.js';
import { resolveEntitlement } from '../_lib/entitlements.js';
import { remainingForUser } from '../_lib/plan-limits.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  try {
    const email = await getSessionEmail(request, env);
    if (!email) {
      return authJsonResponse(401, { error: 'Not signed in.' }, origin);
    }
    // FW2.0 0.3 — surface the user's entitlement (ship-dark: premium until paywall on).
    // Free/paid merge §2: plus per-feature counters, so the client can say
    // "3 of 5 left" instead of only hard-blocking. null = unlimited on this plan.
    const ent = await resolveEntitlement(env, email);
    const remaining = await remainingForUser(env, email, ent.effective).catch(() => ({}));
    const payload = { email, plan: ent.effective, planRaw: ent.plan, paywall: ent.paywall, remaining };
    if (ent.dev) payload.dev = true;
    return authJsonResponse(200, payload, origin);
  } catch (err) {
    console.error('auth/me failed', err);
    return authErrorResponse(err, origin);
  }
}
