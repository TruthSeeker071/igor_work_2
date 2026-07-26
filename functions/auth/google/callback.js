// GET /auth/google/callback — finish the Google OAuth flow (S5, D6).
//
// Google 302s the browser here with ?code&state. We verify state against the
// sealed transaction cookie (CSRF), exchange the code for an id_token over the
// back-channel, validate its claims + nonce, require email_verified, then:
//   existing email -> link google_sub + sign in (a LOGIN)
//   new email      -> create a verified free account + sign in (a SIGNUP)
// and 302 to the return path with ?fw_oauth=google&created=… so the client
// fires signup_complete|login (method:'google') — mirroring the password path,
// which also emits those events client-side (funnel-attribution parity).
//
// Session parity: same createSession + sessionCookieHeader as password login,
// so the cookie is byte-for-byte identical (HttpOnly/Secure/SameSite=Lax/30d).
//
// DEPENDS ON MIGRATION 0019 (google_sub + verified_at columns). The flag gate
// means this route is inert until Jacob sets GOOGLE_CLIENT_ID/SECRET, by which
// point 0019 is applied (both are on the same §7 checklist step); a Google
// account cannot exist without those columns, so — unlike the notify defaults —
// this does not degrade to a pre-0019 schema.

import { normalizeEmail, isValidEmail } from '../../_lib.js';
import {
  parseCookies, checkRateLimit, hashedIpKey,
  findUserByEmail, createGoogleUser, linkGoogleAccount,
  createSession, sessionCookieHeader, SESSION_DAYS,
} from '../../_lib/auth.js';
import { consumePendingGrant } from '../../_lib/admin.js';
import { bindReferral, clearReferralCookieHeader, readReferralCookie } from '../../_lib/referral.js';
import {
  googleAuthConfigured, openTxn, exchangeCode, decodeIdToken,
  validateIdClaims, emailVerified, clearTxnCookieHeader,
  safeReturnPath, TXN_COOKIE,
} from '../../_lib/google-oauth.js';

function redirect(location, setCookies) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  (setCookies || []).forEach((c) => headers.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers });
}

// Every failure exit clears the transaction cookie and lands on the sign-in
// card with a reason the client turns into one friendly line.
function fail(reason) {
  return redirect(`/auth.html?goauth_err=${reason}#signin`, [clearTxnCookieHeader()]);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!googleAuthConfigured(env)) return fail('failed');

  try {
    await checkRateLimit(env, `google-cb:${await hashedIpKey(env, request)}`, { max: 30 });
  } catch (_) {
    return fail('failed');
  }

  // User dismissed the consent screen (or Google errored): quiet return, no card.
  if (url.searchParams.get('error')) {
    return redirect('/auth.html#signin', [clearTxnCookieHeader()]);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('failed');

  const txn = await openTxn(env, parseCookies(request)[TXN_COOKIE]);
  if (!txn || !txn.state || !txn.codeVerifier) return fail('failed');
  // CSRF: the state Google echoes MUST equal the one sealed at /start.
  if (String(state) !== String(txn.state)) return fail('failed');

  const redirectUri = `${url.origin}/auth/google/callback`;

  let claims;
  try {
    const tokens = await exchangeCode({ env, code, codeVerifier: txn.codeVerifier, redirectUri });
    claims = decodeIdToken(tokens && tokens.id_token);
  } catch (err) {
    console.error('google callback: token exchange failed', err?.message || err);
    return fail('failed');
  }

  const check = validateIdClaims(claims, { clientId: env.GOOGLE_CLIENT_ID, nonce: txn.nonce });
  if (!check.ok) {
    console.error('google callback: id token rejected', check.reason);
    return fail('failed');
  }
  // Deny linking on an unverified Google email — it is not proof of ownership,
  // so linking it to an existing FlightWay account would be a takeover vector.
  if (!emailVerified(claims)) return fail('unverified');

  const email = normalizeEmail(claims.email);
  const sub = String(claims.sub || '');
  if (!isValidEmail(email) || !sub) return fail('failed');

  let created = false;
  try {
    const existing = await findUserByEmail(env, email);
    if (existing) {
      await linkGoogleAccount(env, email, sub);
    } else {
      await createGoogleUser(env, email, sub);
      // Parity with register.js: a comp granted before this email had an account
      // is pending; apply it now. Never throws.
      await consumePendingGrant(env, email);
      created = true;
    }
    // S15 (D24): parity with register.js — bind the referral this browser is
    // carrying, but only on a genuinely NEW account. An existing user signing in
    // with Google is not a referral, and binding one would credit a referrer for
    // someone who was already here.
    let referred = false;
    const refCode = created ? readReferralCookie(request) : '';
    if (refCode) {
      const bind = await bindReferral(env, {
        code: refCode,
        refereeEmail: email,
        ipHash: await hashedIpKey(env, request),
      });
      referred = !!bind.bound;
    }
    const session = await createSession(env, email);
    const ret = safeReturnPath(txn.ret);
    const dest = `${ret}${ret.includes('?') ? '&' : '?'}fw_oauth=google&created=${created ? 1 : 0}`
      + (referred ? '&referred=1' : '');
    const cookies = [
      sessionCookieHeader(session.token, SESSION_DAYS * 86400),
      clearTxnCookieHeader(),
    ];
    if (refCode) cookies.push(clearReferralCookieHeader());
    return redirect(dest, cookies);
  } catch (err) {
    console.error('google callback: account/session failed', err?.message || err);
    return fail('failed');
  }
}
