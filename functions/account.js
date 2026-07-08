import { originFromEnv } from './_lib.js';
import { authPreflight, authJsonResponse } from './_lib/auth.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequestPost(context) {
  const origin = originFromEnv(context.env);
  return authJsonResponse(410, {
    error: 'This endpoint is deprecated. Use POST /auth/register instead.',
  }, origin);
}
