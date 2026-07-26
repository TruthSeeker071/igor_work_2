// FlightWay V2 S4 — one-click unsubscribe (CAN-SPAM + RFC 8058).
//   GET  /unsubscribe?email=..&token=..&cat=..  → verify token, turn the category
//        (or 'all') off, show a plain confirmation page with a manage-prefs link.
//   POST /unsubscribe?email=..&token=..&cat=..  → the RFC 8058 one-click endpoint
//        that Gmail/Yahoo POST to from the List-Unsubscribe header (body:
//        "List-Unsubscribe=One-Click"). Same effect, 200 with no page.
// No auth by design — it must work from an email link; the peppered token is the
// credential. `cat` ∈ {weekly,deadlines,review,product,all}; missing → 'all'.

import { unsubToken, timingSafeEqualHex } from './_lib/notify-token.js';
import { logServerEvent } from './_lib/events.js';

const CATEGORY_COLUMN = {
  weekly: 'notify_optin',
  deadlines: 'notify_deadlines',
  review: 'notify_review',
  product: 'notify_product',
};
const ALL_CATEGORIES = Object.keys(CATEGORY_COLUMN);

function normCat(raw) {
  const c = String(raw || '').toLowerCase().trim();
  if (c === 'all' || !c) return 'all';
  return CATEGORY_COLUMN[c] ? c : 'all';
}

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

// Verify the token, then turn the requested category (or all) off. Returns the
// list of category keys switched off, or null if the token doesn't verify.
// Defensive against a pre-0019 schema: falls back to notify_optin alone.
async function applyUnsub(env, email, cat, token) {
  const expected = await unsubToken(email, env);
  if (!timingSafeEqualHex(token, expected)) return null;

  const cats = cat === 'all' ? ALL_CATEGORIES : [cat];
  const sets = cats.map((c) => `${CATEGORY_COLUMN[c]} = 0`);
  try {
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE email = ?`).bind(email).run();
  } catch (err) {
    // Category columns may be absent (pre-0019). Turn off weekly at least, which
    // exists since 0009, so an unsubscribe always does *something*.
    if (cats.includes('weekly') || cat === 'all') {
      try { await env.DB.prepare('UPDATE users SET notify_optin = 0 WHERE email = ?').bind(email).run(); }
      catch (e2) { console.error('unsubscribe fallback failed', e2?.message || e2); }
    } else {
      console.error('unsubscribe update failed', err?.message || err);
    }
  }
  try { await logServerEvent(env, 'email_unsub', { userId: email, props: { category: cat } }); } catch (_) { /* best-effort */ }
  return cats;
}

function parse(request) {
  const url = new URL(request.url);
  return {
    email: String(url.searchParams.get('email') || '').toLowerCase().trim(),
    token: String(url.searchParams.get('token') || ''),
    cat: normCat(url.searchParams.get('cat')),
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { email, token, cat } = parse(request);
  if (!email || !token) {
    return page('Unsubscribe', '<h1>Invalid link</h1><p>This unsubscribe link is missing information.</p>');
  }
  const cats = await applyUnsub(env, email, cat, token);
  if (!cats) {
    return page('Unsubscribe', '<h1>Invalid or expired link</h1><p>We couldn’t verify this unsubscribe link.</p>');
  }
  const what = cat === 'all' ? 'all FlightWay emails' : `${cat} emails`;
  return page('Unsubscribed',
    `<h1>You’re unsubscribed</h1><p>You won’t get ${what} anymore.</p>`
    + '<p>Changed your mind, or want to keep just some? '
    + '<a href="/flightplan.html#notifications">Manage your email preferences</a>.</p>');
}

export async function onRequestPost(context) {
  // RFC 8058 one-click: mail clients POST here with the exact List-Unsubscribe
  // URL (params in the query string). No page — just confirm the action.
  const { request, env } = context;
  const { email, token, cat } = parse(request);
  if (!email || !token) return new Response('Bad Request', { status: 400 });
  const cats = await applyUnsub(env, email, cat, token);
  if (!cats) return new Response('Forbidden', { status: 403 });
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
