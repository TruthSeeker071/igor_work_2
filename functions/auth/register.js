import {
  originFromEnv,
  isValidEmail,
  normalizeEmail,
  buildSeedDossier,
  loadDossier,
  saveDossier,
} from '../_lib.js';
import { authPreflight, authJsonResponse, authErrorResponse, hashPassword, verifyPassword, isValidPassword, createUser, findUserByEmail, createSession, sessionCookieHeader, SESSION_DAYS, checkRateLimit, hashedIpKey, quizProfileToSeed, createVerifyToken } from '../_lib/auth.js';
import { saveUserBlob, normalizeUser, denormalizeUser } from '../_lib/user.js';
import { consumePendingGrant } from '../_lib/admin.js';
import { sendMail, siteBase } from '../_lib/email-template.js';
import { verifyEmail, welcomeEmail } from '../_lib/emails.js';
import { logServerEvent } from '../_lib/events.js';
import { bindReferral, clearReferralCookieHeader, readReferralCookie } from '../_lib/referral.js';

// Soft-verify (D7) + welcome (S4): issue a 48h verification link and send the
// verify + welcome emails immediately, in waitUntil so the signup response is
// never blocked on Resend. Entirely best-effort — a mail failure, or a pre-0019
// schema without the verify columns, must never fail (or slow) account creation.
async function sendSignupEmails(env, email, origin) {
  const base = origin && origin !== '*' ? origin : siteBase(env);
  try {
    const token = await createVerifyToken(env, email);
    const verifyUrl = `${base}/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const v = verifyEmail(env, email, verifyUrl);
    const res = await sendMail(env, { to: email, subject: v.subject, html: v.html, text: v.text, type: 'verify' });
    if (res.ok) await logServerEvent(env, 'verify_sent', { userId: email, props: { reason: 'register' } });
  } catch (err) {
    console.error('register: verify email failed', err?.message || err);
  }
  try {
    const w = await welcomeEmail(env, email);
    await sendMail(env, { to: email, subject: w.subject, html: w.html, text: w.text, type: 'welcome', listUnsubscribe: w.listUnsubscribe });
  } catch (err) {
    console.error('register: welcome email failed', err?.message || err);
  }
}

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
    await checkRateLimit(env, `register:${await hashedIpKey(env, request)}`);
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

    // S15 (D24): bind the referral this browser is carrying. The code comes from
    // the fw_ref cookie /r/<code> set — deliberately NOT from the request body,
    // because a client-supplied referrer is a client-chosen referrer and this
    // row is what eventually moves money. bindReferral never throws.
    const refCode = readReferralCookie(request);
    let referred = false;
    if (refCode) {
      const bind = await bindReferral(env, {
        code: refCode,
        refereeEmail: email,
        ipHash: await hashedIpKey(env, request),
      });
      referred = !!bind.bound;
    }

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
    // Fire-and-forget the verify + welcome emails so signup returns instantly.
    context.waitUntil(sendSignupEmails(env, email, origin));
    // `referred` is what lets the CLIENT fire `referral_signup` (§6 lists it as
    // a client event) — the bind itself happens here, so the browser has no
    // other way to know it happened. Two Set-Cookie headers need append(), not a
    // second key on the object literal.
    const response = authJsonResponse(200, { email, created: true, referred }, origin, {
      'Set-Cookie': sessionCookieHeader(session.token, SESSION_DAYS * 86400),
    });
    if (refCode) response.headers.append('Set-Cookie', clearReferralCookieHeader());
    return response;
  } catch (err) {
    console.error('auth/register failed', err);
    return authErrorResponse(err, origin);
  }
}
