// FlightWay V2 S4 — resend the email verification link (D7).
//   POST /auth/resend-verification  (session-gated, 3/day per account)
// Idempotent: an already-verified account gets a 200 no-op. Best-effort send.

import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  getSessionEmail,
  createVerifyToken,
  isEmailVerified,
  checkRateLimit,
} from '../_lib/auth.js';
import { sendMail, siteBase } from '../_lib/email-template.js';
import { verifyEmail } from '../_lib/emails.js';
import { logServerEvent } from '../_lib/events.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const email = await getSessionEmail(request, env);
  if (!email) return authJsonResponse(401, { error: 'Not signed in.' }, origin);

  // Already verified → no-op success (don't send, don't spend the rate budget).
  if (await isEmailVerified(env, email)) {
    return authJsonResponse(200, { ok: true, verified: true }, origin);
  }

  // 3/day per account (keyed on the account, not the IP — the cap is per user).
  try {
    await checkRateLimit(env, `verifyresend:${email}`, { max: 3, windowSec: 86400 });
  } catch (err) {
    return authJsonResponse(err.status || 429, { error: 'You’ve requested this a few times — try again tomorrow.' }, origin);
  }

  try {
    const token = await createVerifyToken(env, email);
    const base = origin !== '*' ? origin : siteBase(env);
    const verifyUrl = `${base}/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const v = verifyEmail(env, email, verifyUrl);
    const res = await sendMail(env, { to: email, subject: v.subject, html: v.html, text: v.text, type: 'verify' });
    if (res.ok) await logServerEvent(env, 'verify_sent', { userId: email, props: { reason: 'resend' } });
    return authJsonResponse(200, { ok: true, sent: res.ok }, origin);
  } catch (err) {
    console.error('resend-verification failed', err?.message || err);
    return authJsonResponse(500, { error: 'Could not resend the verification email.' }, origin);
  }
}
