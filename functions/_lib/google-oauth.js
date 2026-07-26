// FlightWay V2 S5 — SDK-free Google OAuth 2.0 (Authorization Code + PKCE).
//
// Why no SDK / no googleapis: same discipline as the SDK-free Stripe layer.
// This is a Cloudflare Worker, runtime npm deps are banned (§3.1), and the whole
// flow is two fetches and a JWT decode. Everything here is Web Crypto + fetch.
//
// ID-TOKEN VERIFICATION — the choice, documented (plan §5 S5 asks for this):
// The id_token is received DIRECTLY from Google's token endpoint over a
// server-to-server TLS channel, in response to our authenticated code exchange
// (client_id + client_secret + PKCE code_verifier). Per Google's own guidance,
// a token obtained this way does not require signature verification: there is no
// browser-side injection point, and we never accept an id_token that arrived
// through the redirect. So we DECODE the JWT payload and validate its claims
// (iss, aud, exp, nonce, email_verified) but do not fetch JWKS or verify the
// RS256 signature. That avoids a JWKS-fetch + KV-cache + crypto-verify path whose
// only job would be to re-check what the TLS channel already guarantees. If a
// future flow ever accepts an id_token from an untrusted channel, this must gain
// signature verification.
//
// The cross-request transaction (state + PKCE verifier + nonce + return path) is
// carried in a short-lived HttpOnly cookie set at /start and read at /callback,
// HMAC-sealed with the session pepper so a client cannot forge it. State is the
// CSRF token (the value echoed by Google must equal the sealed one); PKCE binds
// the code to this client; nonce binds the id_token to this request.

import { generateToken } from './auth.js';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const TXN_COOKIE = 'fw_goauth';
export const TXN_TTL_SEC = 600; // 10 minutes to complete the Google round-trip

export function googleAuthConfigured(env) {
  return !!(env && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

// The seal secret is the session pepper — the same per-project secret session
// tokens are hashed with, so there is one secret to rotate, not two. Its absence
// on a preview host is already a 503 (see functions/_middleware.js), so this
// fallback is only ever reached in local/dev.
function txnPepper(env) {
  return String((env && (env.SESSION_PEPPER || env.GEMINI_API_KEY)) || 'flightway-dev-pepper');
}

// --- base64url over bytes and utf-8 strings -------------------------------
function bytesToB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64UrlToBytes(s) {
  const str = String(s);
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function strToB64Url(str) {
  return bytesToB64Url(new TextEncoder().encode(str));
}
function b64UrlToStr(s) {
  return new TextDecoder().decode(b64UrlToBytes(s));
}

async function sha256Bytes(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return new Uint8Array(digest);
}

export async function sha256Base64Url(str) {
  return bytesToB64Url(await sha256Bytes(str));
}

async function hmacB64Url(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return bytesToB64Url(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// --- transaction cookie (state/nonce/verifier/return), HMAC-sealed --------
export async function sealTxn(env, obj) {
  const payload = strToB64Url(JSON.stringify(obj));
  const sig = await hmacB64Url(txnPepper(env), payload);
  return `${payload}.${sig}`;
}

export async function openTxn(env, cookieVal) {
  if (!cookieVal || typeof cookieVal !== 'string') return null;
  const dot = cookieVal.indexOf('.');
  if (dot <= 0) return null;
  const payload = cookieVal.slice(0, dot);
  const sig = cookieVal.slice(dot + 1);
  const expected = await hmacB64Url(txnPepper(env), payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try { return JSON.parse(b64UrlToStr(payload)); } catch { return null; }
}

/**
 * Mint a fresh OAuth transaction: random state, nonce and PKCE verifier, the
 * S256 challenge derived from the verifier, and the sealed cookie carrying all
 * of it plus the post-auth return path. `generateToken(32)` is a 43-char
 * base64url string — a valid PKCE code_verifier (43–128 unreserved chars).
 */
export async function beginTransaction(env, ret) {
  const state = generateToken(24);
  const nonce = generateToken(24);
  const codeVerifier = generateToken(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const cookie = await sealTxn(env, { state, nonce, codeVerifier, ret });
  return { state, nonce, codeVerifier, codeChallenge, cookie };
}

/**
 * Constrain a post-auth `return` to a same-origin RELATIVE path so the OAuth
 * flow can never be turned into an open redirect. Must be a single leading
 * slash (not `//` scheme-relative, not `/\`), no scheme, no whitespace.
 * Anything else falls back to the Home page.
 */
export function safeReturnPath(raw) {
  const r = String(raw || '');
  if (!r || r[0] !== '/') return '/portal.html';
  if (r[1] === '/' || r[1] === '\\' || r[1] === '\t') return '/portal.html';
  if (/[\s\\]/.test(r) || /^\/+https?:/i.test(r)) return '/portal.html';
  return r;
}

export function txnCookieHeader(value, maxAgeSec) {
  return `${TXN_COOKIE}=${value}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}; Secure`;
}
export function clearTxnCookieHeader() {
  return `${TXN_COOKIE}=; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

// --- the Google endpoints -------------------------------------------------
export function buildAuthUrl({ clientId, redirectUri, state, nonce, codeChallenge }) {
  const p = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // A returning user with several Google accounts gets to choose, instead of
    // being silently signed in as whichever one Google defaulted to.
    prompt: 'select_account',
    access_type: 'online',
  });
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

export async function exchangeCode({ env, code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: String(env.GOOGLE_CLIENT_ID),
    client_secret: String(env.GOOGLE_CLIENT_SECRET),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  // Workers fetch has NO default timeout (§3.7); an 8s budget keeps a hung
  // Google token endpoint from holding the redirect open indefinitely.
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  };
  try {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(8000);
  } catch (_) { /* environments without AbortSignal.timeout just skip it */ }
  const resp = await fetch(GOOGLE_TOKEN_URL, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`google token exchange failed: ${resp.status} ${text.slice(0, 200)}`);
    err.code = 'exchange_failed';
    throw err;
  }
  return resp.json();
}

export function decodeIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try { return JSON.parse(b64UrlToStr(parts[1])); } catch { return null; }
}

const ISS_OK = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Validate the id_token CLAIMS (not the signature — see the header note).
 * Returns { ok, reason }. `nonce` is compared when provided.
 */
export function validateIdClaims(claims, { clientId, nonce, nowSec } = {}) {
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'no_claims' };
  if (!ISS_OK.has(String(claims.iss))) return { ok: false, reason: 'iss' };
  if (String(claims.aud) !== String(clientId)) return { ok: false, reason: 'aud' };
  const exp = Number(claims.exp);
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, reason: 'expired' };
  if (nonce != null && String(claims.nonce || '') !== String(nonce)) return { ok: false, reason: 'nonce' };
  return { ok: true };
}

// Google sends email_verified as a real boolean on the id_token, but tolerate
// the string form some legacy responses use.
export function emailVerified(claims) {
  return !!claims && (claims.email_verified === true || claims.email_verified === 'true');
}
