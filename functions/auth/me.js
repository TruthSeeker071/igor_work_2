import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  getSessionEmail,
} from '../_lib/auth.js';
import { resolveEntitlement } from '../_lib/entitlements.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  try {
    const email = await getSessionEmail(request, env);
    if (!email) {
      return authJsonResponse(401, { error: 'Not signed in.' }, origin);
    }
    // FW2.0 0.3 — surface the user's entitlement (ship-dark: premium until paywall on).
    const ent = await resolveEntitlement(env, email);
    return authJsonResponse(200, { email, plan: ent.effective, planRaw: ent.plan, paywall: ent.paywall }, origin);
  } catch (err) {
    console.error('auth/me failed', err);
    return authErrorResponse(err, origin);
  }
}
