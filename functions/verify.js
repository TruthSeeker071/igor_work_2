// FlightWay V2 S4 — email verification landing (D7, soft-verify).
//   GET /verify?token=..&email=..  → consume the one-time token, set verified_at,
//   show a plain confirmation page. No auth by design (it must work from an email
//   link, possibly in a different browser); the token is the credential.

import { consumeVerifyToken } from './_lib/auth.js';
import { logServerEvent } from './_lib/events.js';
import { siteBase } from './_lib/email-template.js';

function page(title, bodyHtml) {
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + title + '</title><style>'
    + 'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#e8edff;'
    + 'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:20px}'
    + '.card{max-width:460px;text-align:center}h1{font-size:22px;margin:0 0 10px}p{opacity:.85;line-height:1.5}'
    + 'a{color:#6ea8ff}.btn{display:inline-block;margin-top:14px;background:#6ea8ff;color:#06122b;font-weight:700;'
    + 'text-decoration:none;padding:12px 22px;border-radius:10px}</style></head><body><div class="card">'
    + bodyHtml + '</div></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '');
  const base = siteBase(env);

  if (!token) {
    return page('Verify email', '<h1>Invalid link</h1><p>This verification link is missing its token. '
      + 'Sign in and use the “resend” button in the banner to get a fresh one.</p>'
      + `<p><a class="btn" href="${base}/portal.html">Back to FlightWay</a></p>`);
  }

  let result = null;
  try {
    result = await consumeVerifyToken(env, token);
  } catch (err) {
    console.error('verify failed', err?.message || err);
  }

  if (!result) {
    return page('Verify email', '<h1>Link expired or already used</h1>'
      + '<p>Verification links work for 48 hours and can only be used once. '
      + 'Sign in and use the “resend” button in the banner to get a new one.</p>'
      + `<p><a class="btn" href="${base}/auth.html#signin">Sign in</a></p>`);
  }

  if (!result.already) {
    try { await logServerEvent(env, 'verify_done', { userId: result.email }); } catch (_) { /* best-effort */ }
  }

  return page('Email confirmed', '<h1>You’re verified ✓</h1>'
    + '<p>Your email is confirmed. Your weekly Flight Plan and reminders are on — '
    + 'manage them anytime in your preferences.</p>'
    + `<p><a class="btn" href="${base}/portal.html">Open your Flight Plan</a></p>`);
}
