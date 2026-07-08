import { originFromEnv } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
} from './_lib/auth.js';
import { loadFullProfile } from './_lib/profile.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

// GET /profile -> aggregate of every profile sub-resource for the signed-in user.
// One authenticated round trip in place of separate /auth/me + /profile/quiz calls.
export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  try {
    const { email } = await requireSession(request, env);
    const profile = await loadFullProfile(env, email);
    return authJsonResponse(200, profile, origin);
  } catch (err) {
    console.error('profile GET failed', err && err.stack ? err.stack : err);
    return authErrorResponse(err, origin);
  }
}
