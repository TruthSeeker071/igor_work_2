// FlightWay 2.0 — one-click unsubscribe (Pillar B2, CAN-SPAM).
//   GET /unsubscribe?email=..&token=..  → verify token (constant-time), set
//   notify_optin = 0, show a plain confirmation page. No auth by design (it must
//   work from an email link); the peppered token is the credential.

import { unsubToken, timingSafeEqualHex } from './_lib/notify-token.js';

function page(title, bodyHtml) {
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + title + '</title><style>'
    + 'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#e8edff;'
    + 'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:20px}'
    + '.card{max-width:460px;text-align:center}h1{font-size:22px;margin:0 0 10px}p{opacity:.85;line-height:1.5}'
    + 'a{color:#6ea8ff}</style></head><body><div class="card">' + bodyHtml + '</div></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = String(url.searchParams.get('email') || '').toLowerCase().trim();
  const token = String(url.searchParams.get('token') || '');

  if (!email || !token) {
    return page('Unsubscribe', '<h1>Invalid link</h1><p>This unsubscribe link is missing information.</p>');
  }
  const expected = await unsubToken(email, env);
  if (!timingSafeEqualHex(token, expected)) {
    return page('Unsubscribe', '<h1>Invalid or expired link</h1><p>We couldn’t verify this unsubscribe link.</p>');
  }
  try {
    await env.DB.prepare('UPDATE users SET notify_optin = 0 WHERE email = ?').bind(email).run();
  } catch (err) {
    console.error('unsubscribe update failed', err?.message || err);
  }
  return page('Unsubscribed',
    '<h1>You’re unsubscribed</h1><p>You won’t get weekly Flight Plan nudges anymore. '
    + 'You can turn them back on anytime from your portal.</p><p><a href="/portal.html">Back to FlightWay</a></p>');
}
