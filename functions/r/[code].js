// FlightWay V2 S15 — GET /r/<code>, the referral entry point (plan §5 S15, D24).
//
// Stamps the fw_ref cookie and 302s onward. The cookie — not a localStorage
// value the page would have to send back — is what register.js reads at signup,
// and that choice is load-bearing: a code the CLIENT supplies at registration is
// a referrer the client chose, which makes the whole credit path forgeable by
// anyone with a console. See the DRIFT note in the S15 ledger entry.
//
// The visit is recorded as an EVENT, not a `referrals` row. A row per anonymous
// hit would be unbounded free writes for anyone with a terminal.

import { classifyUa, logServerEvent } from '../_lib/events.js';
import {
  emailForReferralCode, normalizeReferralCode, referralCookieHeader,
} from '../_lib/referral.js';

/** Where a referral link may land. Allowlisted — `to` comes off a query string. */
const DESTINATIONS = {
  '': '/',
  home: '/',
  quiz: '/quiz',
  pricing: '/pricing',
};

const UTM = 'utm_source=referral&utm_medium=invite&utm_campaign=friend';

/**
 * Per-channel attribution. `?c=dm` becomes `utm_content=dm`, which is how the
 * /invite outreach kit tells a group-chat paste apart from an Instagram bio —
 * the one number that makes manual outreach improvable. Allowlisted by SHAPE
 * rather than by value so a new channel needs no code change, and clamped hard
 * because it lands in a URL the beacon stores.
 */
function utmContent(raw) {
  const s = String(raw || '').toLowerCase();
  return /^[a-z][a-z0-9-]{0,15}$/.test(s) ? `&utm_content=${s}` : '';
}

function redirect(url, cookie) {
  const headers = { Location: url, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet(context) {
  const { request, env, params, waitUntil } = context;
  const url = new URL(request.url);
  const dest = DESTINATIONS[String(url.searchParams.get('to') || '').toLowerCase()] || '/';
  const target = `${url.origin}${dest}${dest.includes('?') ? '&' : '?'}${UTM}${utmContent(url.searchParams.get('c'))}`;

  const code = normalizeReferralCode((params && params.code) || '');
  if (!code) return redirect(target, '');

  // Only a code that belongs to somebody gets a cookie. An unknown code lands
  // the visitor on a normal page rather than an error — they did nothing wrong,
  // and a 404 here is a dead end for a link someone was excited to send.
  const referrer = await emailForReferralCode(env, code);
  if (!referrer) return redirect(target, '');

  if (classifyUa(request.headers.get('User-Agent')) !== 'bot') {
    const log = logServerEvent(env, 'referral_visit', {
      userId: referrer, path: '/r', props: { code, to: dest },
    });
    if (typeof waitUntil === 'function') waitUntil(log); else await log;
  }

  return redirect(target, referralCookieHeader(code));
}
