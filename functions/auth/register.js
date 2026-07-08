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
  saveQuizProfile,
  quizProfileToSeed,
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

    const quizProfile = payload.quizProfile && typeof payload.quizProfile === 'object'
      ? payload.quizProfile
      : null;
    if (quizProfile) {
      await saveQuizProfile(env, email, quizProfile);
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
