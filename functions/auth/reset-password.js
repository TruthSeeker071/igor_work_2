import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  isValidPassword,
  hashPassword,
  updateUserPassword,
  consumePasswordResetToken,
  destroyAllSessions,
} from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const token = String(payload.token || '').trim();
  const newPassword = String(payload.newPassword || payload.password || '');

  if (!token) {
    return authJsonResponse(400, { error: 'Missing reset token.' }, origin);
  }
  if (!isValidPassword(newPassword)) {
    return authJsonResponse(400, { error: 'Password must be at least 8 characters.' }, origin);
  }

  try {
    const email = await consumePasswordResetToken(env, token);
    if (!email) {
      return authJsonResponse(400, { error: 'This reset link is invalid or expired.' }, origin);
    }

    const passwordHash = await hashPassword(newPassword);
    await updateUserPassword(env, email, passwordHash);
    await destroyAllSessions(env, email);

    return authJsonResponse(200, { ok: true, message: 'Password updated. Please sign in.' }, origin);
  } catch (err) {
    console.error('auth/reset-password failed', err);
    return authErrorResponse(err, origin);
  }
}
