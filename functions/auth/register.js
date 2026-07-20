import {
  originFromEnv,
  isValidEmail,
  normalizeEmail,
  buildSeedDossier,
  loadDossier,
  saveDossier,
} from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  hashPassword,
  verifyPassword,
  isValidPassword,
  createUser,
  findUserByEmail,
  createSession,
  sessionCookieHeader,
  SESSION_DAYS,
  checkRateLimit,
  clientIp,
  quizProfileToSeed,
} from '../_lib/auth.js';
import { saveUserBlob, normalizeUser, denormalizeUser } from '../_lib/user.js';
import { consumePendingGrant } from '../_lib/admin.js';

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

  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');

  if (!isValidEmail(email)) {
    return authJsonResponse(400, { error: 'Please provide a valid email address.' }, origin);
  }
  if (!isValidPassword(password)) {
    return authJsonResponse(400, { error: 'Password must be at least 8 characters.' }, origin);
  }

  try {
    await checkRateLimit(env, `register:${clientIp(request)}`);
    await checkRateLimit(env, `register:${email}`);

    const existing = await findUserByEmail(env, email);
    if (existing) {
      return authJsonResponse(409, { error: 'An account with this email already exists. Try signing in.' }, origin);
    }

    const passwordHash = await hashPassword(password);
    await createUser(env, email, passwordHash);

    // A comp granted before this email had an account is pending in
    // comp_grants; apply it now that the users row exists. Never throws — a
    // comp that fails to land stays pending and an admin can re-apply it, but
    // it must not fail the signup itself.
    await consumePendingGrant(env, email);

    // The slim register payload may arrive v1 (old tabs) or v2 (post-rollout
    // quiz); normalize once and work on the v1 view everywhere below.
    const quizProfile = payload.quizProfile && typeof payload.quizProfile === 'object'
      ? denormalizeUser(normalizeUser(payload.quizProfile))
      : null;
    if (quizProfile) {
      await saveUserBlob(env, email, quizProfile);
    }

    const seed = buildSeedDossier(quizProfileToSeed(quizProfile || payload.quizResults || {}));
    const priorDossier = await loadDossier(env, email);
    if (!priorDossier) {
      await saveDossier(env, email, seed);
    }

    const session = await createSession(env, email);
    return authJsonResponse(200, { email, created: true }, origin, {
      'Set-Cookie': sessionCookieHeader(session.token, SESSION_DAYS * 86400),
    });
  } catch (err) {
    console.error('auth/register failed', err);
    return authErrorResponse(err, origin);
  }
}
