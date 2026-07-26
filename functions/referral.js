// FlightWay V2 S15 — GET /referral, what every invite surface reads (plan §5 S15).
//
// One endpoint for the account panel, the Flight Plan invite card and the
// /invite outreach kit, so none of them hand-writes a link, a count or the
// yearly credit ceiling (§3 rule 11: the client never carries a limit number).
//
// The code is minted lazily on first read — most accounts never share, and a
// code minted for everyone is a unique index full of rows nobody will use.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, isEmailVerified } from './_lib/auth.js';
import {
  MAX_CREDITS_PER_YEAR, ensureReferralCode, referralLink, referralStats,
} from './_lib/referral.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Sign in to get your invite link.' }, origin);

  const code = await ensureReferralCode(env, email);
  if (!code) {
    // Pre-0023 schema. Say so plainly rather than rendering a broken copy
    // button — same contract S9/S11/S12 used for their un-applied migrations.
    return jsonResponse(200, {
      enabled: false,
      note: 'Invites are not switched on for this deployment yet.',
      maxPerYear: MAX_CREDITS_PER_YEAR,
    }, origin);
  }

  const site = new URL(request.url).origin;
  const [stats, verified] = await Promise.all([
    referralStats(env, email),
    isEmailVerified(env, email),
  ]);

  return jsonResponse(200, {
    enabled: true,
    code,
    link: referralLink(site, code),
    // Whether a credit can actually be issued to this account today. The invite
    // card shows the link either way — hiding it would be worse — but it says
    // out loud that credits need a confirmed address (D24's first guard).
    verified,
    signedUp: stats.signedUp,
    converted: stats.converted,
    credited: stats.credited,
    creditCents: stats.creditCents,
    maxPerYear: stats.maxPerYear,
    // Whether the referee's free month is actually configured on this
    // deployment. Drives honest copy: no promo id means the invite still works
    // and still credits the referrer, but the friend does not get a free month.
    promoConfigured: !!String((env && env.STRIPE_REFERRAL_PROMO_ID) || '').trim(),
  }, origin);
}
