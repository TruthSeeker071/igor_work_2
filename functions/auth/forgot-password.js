import { originFromEnv, isValidEmail, normalizeEmail } from '../_lib.js';
import { authPreflight, authJsonResponse, authErrorResponse, findUserByEmail, createPasswordResetToken, checkRateLimit, hashedIpKey } from '../_lib/auth.js';
import { sendMail, renderEmail, transactionalFooter, siteBase } from '../_lib/email-template.js';

function resetEmail(resetUrl) {
  const body = 'Click the button below to choose a new password. This link expires in one hour. '
    + 'If you didn’t request this, you can safely ignore this email.';
  return renderEmail({
    preheader: 'Reset your FlightWay password (this link expires in one hour).',
    heading: 'Reset your password',
    bodyHtml: `<p style="font-size:15px;line-height:1.65;color:#c3ccea;margin:0 0 16px">${body}</p>`,
    bodyText: body,
    cta: { label: 'Reset password', url: resetUrl },
    footer: transactionalFooter(),
  });
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
  const generic = { ok: true, message: 'If that email is registered, we sent a reset link.' };

  if (!isValidEmail(email)) {
    return authJsonResponse(200, generic, origin);
  }

  try {
    await checkRateLimit(env, `forgot:${await hashedIpKey(env, request)}`);
    await checkRateLimit(env, `forgot:${email}`);

    const user = await findUserByEmail(env, email);
    if (user) {
      const token = await createPasswordResetToken(env, email);
      const siteOrigin = origin !== '*' ? origin : siteBase(env);
      const resetUrl = `${siteOrigin}/auth.html#reset-password?token=${encodeURIComponent(token)}`;
      const { html, text } = resetEmail(resetUrl);
      // sendMail never throws and stays silent on failure, so the response is the
      // generic 200 below whether or not the email actually sent — a Resend error
      // must not leak (via a 500) that this address is registered.
      await sendMail(env, { to: email, subject: 'Reset your FlightWay password', html, text, type: 'password_reset' });
    }

    return authJsonResponse(200, generic, origin);
  } catch (err) {
    console.error('auth/forgot-password failed', err);
    return authErrorResponse(err, origin);
  }
}
