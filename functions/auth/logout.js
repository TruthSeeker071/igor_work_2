import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  parseCookies,
  SESSION_COOKIE,
  destroySession,
  clearSessionCookieHeader,
} from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);
  const token = parseCookies(request)[SESSION_COOKIE];

  try {
    if (token) await destroySession(env, token);
    return authJsonResponse(200, { ok: true }, origin, {
      'Set-Cookie': clearSessionCookieHeader(),
    });
  } catch (err) {
    console.error('auth/logout failed', err);
    return authErrorResponse(err, origin);
  }
}
