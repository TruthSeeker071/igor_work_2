import { originFromEnv, isValidEmail, normalizeEmail, resendConfigFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  findUserByEmail,
  createPasswordResetToken,
  checkRateLimit,
  clientIp,
} from '../_lib/auth.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resetEmailHtml(resetUrl) {
  return `<!doctype html><html><body style="font-family:sans-serif;color:#0f172a;padding:32px;">
    <h1 style="font-size:22px;">Reset your Flightway password</h1>
    <p>Click the button below to choose a new password. This link expires in one hour.</p>
    <p><a href="${esc(resetUrl)}" style="display:inline-block;padding:12px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:8px;">Reset password</a></p>
    <p style="font-size:12px;color:#64748b;">If you didn't request this, you can ignore this email.</p>
  </body></html>`;
}

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
  const generic = { ok: true, message: 'If that email is registered, we sent a reset link.' };

  if (!isValidEmail(email)) {
    return authJsonResponse(200, generic, origin);
  }

  try {
    await checkRateLimit(env, `forgot:${clientIp(request)}`);
    await checkRateLimit(env, `forgot:${email}`);

    const user = await findUserByEmail(env, email);
    if (user) {
      const token = await createPasswordResetToken(env, email);
      const siteOrigin = origin !== '*' ? origin : 'https://flightway-prototype.pages.dev';
      const resetUrl = `${siteOrigin}/auth.html#reset-password?token=${encodeURIComponent(token)}`;

      const { apiKey, fromEmail } = resendConfigFromEnv(env);
      if (apiKey) {
        await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [email],
            subject: 'Reset your Flightway password',
            html: resetEmailHtml(resetUrl),
            text: `Reset your password: ${resetUrl}`,
          }),
        });
      }
    }

    return authJsonResponse(200, generic, origin);
  } catch (err) {
    console.error('auth/forgot-password failed', err);
    return authErrorResponse(err, origin);
  }
}
