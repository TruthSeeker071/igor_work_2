// FlightWay V2 S15 — GET /s/<id>, the public share page (plan §5 S15).
//
// Unauthenticated by design: the id IS the capability (22 base62 chars from
// crypto randomness). Revoked and never-existed answer the SAME 404, so a live
// link cannot be distinguished from a dead one by probing.
//
// Rendered from the STORED snapshot, never from the sharer's live account — see
// the rule at the top of _lib/share.js. `noindex` is deliberate: these are
// user-generated pages on the marketing domain, and link unfurlers read Open
// Graph tags without needing the page indexed.

import { classifyUa, logServerEvent } from '../_lib/events.js';
import { isShareId, sharePageHtml, shareMissingHtml } from '../_lib/share.js';
import { referralLink } from '../_lib/referral.js';

const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, follow' };

function notFound() {
  return new Response(shareMissingHtml(), {
    status: 404,
    headers: { ...HTML, 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { request, env, params, waitUntil } = context;
  const id = String((params && params.id) || '');
  if (!isShareId(id) || !env || !env.DB) return notFound();

  let row;
  try {
    row = await env.DB.prepare(
      'SELECT id, user_id, payload, img_key, revoked_at FROM shares WHERE id = ?',
    ).bind(id).first();
  } catch {
    return notFound(); // pre-0023 schema
  }
  if (!row || row.revoked_at) return notFound();

  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* corrupt row renders empty */ }

  // The CTA doubles as the sharer's referral link (D24) — the whole point of
  // "every proud user becomes distribution". `to=quiz` is validated against an
  // allowlist by /r/<code>; a share with no code falls back to a plain quiz link.
  const origin = new URL(request.url).origin;
  let code = '';
  try {
    const owner = await env.DB.prepare('SELECT referral_code FROM users WHERE email = ?')
      .bind(row.user_id).first();
    code = (owner && owner.referral_code) || '';
  } catch { /* pre-0023 users table */ }
  const ctaUrl = code
    ? `${referralLink(origin, code)}?to=quiz`
    : `${origin}/quiz?utm_source=share&utm_medium=card&utm_campaign=career-map`;

  const html = sharePageHtml({ id, payload, origin, ctaUrl });

  // A crawler's unfurl is not a visit. Same rule the beacon applies at
  // functions/events.js:63 — counting Slackbot as a viewer would make every
  // share look twice as good as it is.
  if (classifyUa(request.headers.get('User-Agent')) !== 'bot') {
    const bump = (async () => {
      try {
        await env.DB.prepare('UPDATE shares SET views = views + 1 WHERE id = ?').bind(id).run();
      } catch { /* a view counter is never worth failing a page render for */ }
      await logServerEvent(env, 'share_view', {
        userId: row.user_id, path: '/s', props: { id },
      });
    })();
    if (typeof waitUntil === 'function') waitUntil(bump); else await bump;
  }

  return new Response(html, {
    status: 200,
    headers: {
      ...HTML,
      // Short and shared: the page content never changes for a live share, but
      // a revoke has to take effect in minutes, not hours.
      'Cache-Control': 'public, max-age=0, s-maxage=300',
    },
  });
}
