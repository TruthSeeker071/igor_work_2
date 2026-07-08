import { originFromEnv, isValidEmail, normalizeEmail } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  verifyPassword,
  isValidPassword,
  findUserByEmail,
  createSession,
  sessionCookieHeader,
  SESSION_DAYS,
  checkRateLimit,
  clientIp,
} from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');

  if (!isValidEmail(email) || !isValidPassword(password)) {
    return authJsonResponse(401, { error: 'Invalid email or password.' }, origin);
  }

  try {
    await checkRateLimit(env, `login:${clientIp(request)}`);
    await checkRateLimit(env, `login:${email}`);

    const user = await findUserByEmail(env, email);
    if (!user) {
      return authJsonResponse(401, { error: 'Invalid email or password.' }, origin);
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return authJsonResponse(401, { error: 'Invalid email or password.' }, origin);
    }

    const session = await createSession(env, email);
    return authJsonResponse(200, { email }, origin, {
      'Set-Cookie': sessionCookieHeader(session.token, SESSION_DAYS * 86400),
    });
  } catch (err) {
    console.error('auth/login failed', err);
    return authErrorResponse(err, origin);
  }
}
