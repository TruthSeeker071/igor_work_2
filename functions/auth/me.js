import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  getSessionEmail,
} from '../_lib/auth.js';

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
    return authJsonResponse(200, { email }, origin);
  } catch (err) {
    console.error('auth/me failed', err);
    return authErrorResponse(err, origin);
  }
}
