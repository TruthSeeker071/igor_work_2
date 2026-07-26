// GET /auth/google/start — begin the Google OAuth flow (S5, D6).
//
// Top-level browser navigation (not fetch): sets the sealed transaction cookie
// and 302s to Google's consent screen. Flag-gated — if GOOGLE_CLIENT_ID/SECRET
// are unset the buttons never render (client reads /config.googleAuthEnabled),
// but if the route is hit anyway it bounces to the sign-in page rather than 500.

import { checkRateLimit, hashedIpKey } from '../../_lib/auth.js';
import {
  googleAuthConfigured, beginTransaction, buildAuthUrl,
  txnCookieHeader, TXN_TTL_SEC, safeReturnPath,
} from '../../_lib/google-oauth.js';

function redirect(location, setCookies) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  (setCookies || []).forEach((c) => headers.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!googleAuthConfigured(env)) {
    return redirect('/auth.html?goauth_err=failed#signin');
  }

  // Cheap abuse control on an unauthenticated, redirect-minting endpoint. Not a
  // user budget, so no refund path — a throttled caller just bounces back.
  try {
    await checkRateLimit(env, `google-start:${await hashedIpKey(env, request)}`, { max: 30 });
  } catch (_) {
    return redirect('/auth.html?goauth_err=failed#signin');
  }

  const ret = safeReturnPath(url.searchParams.get('return'));
  // The redirect_uri MUST match exactly what Jacob registered in the Google
  // console for this origin (§7): derive it from the real request host so the
  // prototype, production and localhost each send their own registered value.
  const redirectUri = `${url.origin}/auth/google/callback`;

  const { state, nonce, codeChallenge, cookie } = await beginTransaction(env, ret);
  const authUrl = buildAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID, redirectUri, state, nonce, codeChallenge,
  });
  return redirect(authUrl, [txnCookieHeader(cookie, TXN_TTL_SEC)]);
}
