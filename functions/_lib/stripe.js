// FlightWay — Stripe billing, no SDK (free/paid merge §3).
//
// The repo has zero runtime npm dependencies on purpose (vanilla JS, no build
// step — see CLAUDE.md), so this talks to Stripe the same way _lib/gemini-json.js
// talks to Gemini: raw fetch() against the REST API, plus Web Crypto for the
// webhook signature. Adding the `stripe` package would break that invariant for
// nothing — the surface we need is four endpoints and one HMAC.
//
// Everything here that decides *what entitlement a payment grants* is a pure
// function (sprintGrant / subscriptionGrant / lifetimeGrant) so scripts/test-stripe.mjs
// can prove the money paths without a network or a database.

import { normalizePlan } from './entitlements.js';

const API_BASE = 'https://api.stripe.com/v1';
const DEFAULT_TIMEOUT_MS = 15000;

/** Interview Sprint = two weeks of full premium on the existing columns (§9). */
export const SPRINT_DAYS = 14;
/** "Start free trial" is live copy on the subscription CTA — honour it (§9). */
export const TRIAL_DAYS = 14;
/** Renewal slack: a late/lost renewal webhook must not lock out a paying user. */
export const RENEWAL_GRACE_DAYS = 3;

/** The four SKUs pricing.html already sells (its data-tier values). */
export const SKUS = {
  monthly: {
    mode: 'subscription', priceEnv: 'STRIPE_PRICE_MONTHLY',
    trialDays: TRIAL_DAYS, label: 'Flight Plan (monthly)',
  },
  annual: {
    mode: 'subscription', priceEnv: 'STRIPE_PRICE_ANNUAL',
    trialDays: TRIAL_DAYS, label: 'Flight Plan (annual)',
  },
  lifetime: {
    mode: 'payment', priceEnv: 'STRIPE_PRICE_LIFETIME',
    label: 'Lifetime — Founding 100',
  },
  sprint: {
    mode: 'payment', priceEnv: 'STRIPE_PRICE_SPRINT',
    grantDays: SPRINT_DAYS, label: 'Interview Sprint',
  },
};

export function stripeConfigured(env) {
  return !!String((env && env.STRIPE_SECRET_KEY) || '').trim();
}

/**
 * True while the configured key is a test-mode key.
 *
 * Matches restricted keys (`rk_test_…`) as well as standard ones (`sk_test_…`):
 * a scoped restricted key is the normal way to be handed API access to someone
 * else's Stripe account, and missing it here is worse than cosmetic — /config
 * surfaces this flag so the UI can say "test mode" out loud, and an unrecognised
 * test key makes a fake charge look exactly like a real one during the
 * pre-launch validation run.
 */
export function stripeTestMode(env) {
  return /^(sk|rk)_test_/.test(String((env && env.STRIPE_SECRET_KEY) || '').trim());
}

/**
 * The price id for a tier, in the mode the configured key actually operates in.
 *
 * Both Pages projects build from ONE wrangler.toml, but they hold different
 * Stripe keys: `flightway` (-> flightway.ai) has the live key, and
 * `flightwayprototype` (-> pages.dev) has the test key. A single set of price
 * ids therefore cannot be right for both — Stripe keeps test and live objects
 * in separate namespaces, so a live price id under a test key fails with
 * "No such price", and the prototype could not exercise checkout at all.
 *
 * So the mode of the key selects the price: a test key looks for
 * `STRIPE_PRICE_<TIER>_TEST` first. The live vars stay the unsuffixed ones, so
 * production is unaffected and a missing `_TEST` var degrades to the old
 * behaviour instead of breaking.
 */
export function priceIdFor(env, tier) {
  const sku = SKUS[tier];
  if (!sku || !env) return '';
  if (stripeTestMode(env)) {
    const testId = String(env[`${sku.priceEnv}_TEST`] || '').trim();
    if (testId) return testId;
  }
  return String(env[sku.priceEnv] || '').trim();
}

// --------------------------------------------------------------- wire format

/** Stripe's form encoding: nested objects become a[b]=c, arrays a[0][b]=c. */
export function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') formEncode(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      formEncode(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out.join('&');
}

/**
 * One call to Stripe. Always bounded by a timeout — Workers fetch has none, and
 * an unbounded upstream call has already cost this codebase a production
 * incident once (see PRODUCTION_LAUNCH_REVIEW).
 */
export async function stripeFetch(env, path, opts = {}) {
  const key = String((env && env.STRIPE_SECRET_KEY) || '').trim();
  if (!key) { const e = new Error('Stripe is not configured.'); e.status = 503; throw e; }

  const method = opts.method || 'POST';
  const headers = {
    Authorization: `Bearer ${key}`,
    'Stripe-Version': '2024-06-20',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = String(opts.idempotencyKey);
  let body;
  if (opts.form) {
    body = formEncode(opts.form);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
    ? AbortSignal.timeout(timeoutMs) : undefined;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body, signal });
  } catch (err) {
    const e = new Error('Could not reach Stripe. Try again in a moment.');
    e.status = 504; e.cause = err;
    throw e;
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = json && json.error ? json.error : {};
    const e = new Error(detail.message || `Stripe ${res.status}`);
    e.status = res.status;
    e.stripeCode = detail.code || detail.type || '';
    throw e;
  }
  return json;
}

// ------------------------------------------------------------------ requests

export async function createCheckoutSession(env, params) {
  return stripeFetch(env, '/checkout/sessions', { form: params, idempotencyKey: params && params.__idem });
}

export async function createPortalSession(env, params) {
  return stripeFetch(env, '/billing_portal/sessions', { form: params });
}

export async function retrieveSubscription(env, id) {
  return stripeFetch(env, `/subscriptions/${encodeURIComponent(id)}`, { method: 'GET' });
}

// ------------------------------------------------------- webhook signature

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent constant-time compare over two hex strings. */
function timingSafeEqualHex(a, b) {
  const x = String(a || ''); const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * Stripe's documented `Stripe-Signature` scheme, reproduced without the SDK:
 * header is `t=<unix>,v1=<hex hmac>` (possibly several v1s during a secret
 * roll), and the signed payload is `${t}.${rawBody}` keyed by the whole
 * `whsec_…` string. The timestamp check is what makes a captured request
 * unreplayable; the event-id table in webhook.js covers Stripe's own retries.
 */
export async function verifyWebhookSignature(rawBody, sigHeader, secret, opts = {}) {
  if (!rawBody || !sigHeader || !secret) return { ok: false, reason: 'missing' };
  const toleranceSec = Number.isFinite(opts.toleranceSec) ? opts.toleranceSec : 300;
  const nowSec = Number.isFinite(opts.nowSec) ? opts.nowSec : Math.floor(Date.now() / 1000);

  let t = '';
  const v1 = [];
  for (const part of String(sigHeader).split(',')) {
    const raw = part.trim();
    const i = raw.indexOf('=');
    if (i < 0) continue;
    const k = raw.slice(0, i);
    const v = raw.slice(i + 1);
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  const ts = Number(t);
  if (!Number.isFinite(ts) || !v1.length) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSec - ts) > toleranceSec) return { ok: false, reason: 'timestamp' };

  const expected = await hmacSha256Hex(String(secret), `${t}.${rawBody}`);
  const matched = v1.some((sig) => timingSafeEqualHex(sig, expected));
  return matched ? { ok: true, timestamp: ts } : { ok: false, reason: 'signature' };
}

/** Test/dev helper: build the header Stripe would have sent. Also used by stripe:check. */
export async function signWebhookPayload(rawBody, secret, timestampSec) {
  const t = String(Math.floor(timestampSec ?? Date.now() / 1000));
  return `t=${t},v1=${await hmacSha256Hex(String(secret), `${t}.${rawBody}`)}`;
}

// --------------------------------------------------- what a payment grants
//
// Pure functions: given the user's CURRENT entitlement and the Stripe object,
// return the row write to make (or { skip } to make none). No I/O, so every
// money path is unit-testable.

/** Subscription statuses that should keep a user premium. `past_due` stays in
 *  because Stripe's own dunning retries first — we only act on the real
 *  transition to canceled/unpaid (§3). */
export const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function lifetimeGrant() {
  return { plan: 'lifetime', expiresAt: null };
}

/**
 * Interview Sprint: two weeks of premium on the existing columns. Must NEVER
 * shorten an entitlement the user already has (§9) — a lifetime holder or
 * someone with a longer runway keeps what they have.
 */
export function sprintGrant(currentPlan, currentExpiresAt, now = Date.now()) {
  const plan = normalizePlan(currentPlan);
  const targetMs = now + SPRINT_DAYS * 86400000;
  if (plan === 'lifetime') return { skip: true, reason: 'lifetime' };
  if (plan === 'premium' && !currentExpiresAt) return { skip: true, reason: 'longer-entitlement' };
  const cur = currentExpiresAt ? Date.parse(currentExpiresAt) : NaN;
  if (Number.isFinite(cur) && cur >= targetMs) return { skip: true, reason: 'longer-entitlement' };
  return { plan: 'premium', expiresAt: new Date(targetMs).toISOString() };
}

/**
 * Subscription created/updated/deleted. Expiry tracks the paid period end plus
 * a grace window, so a dropped renewal webhook degrades (user keeps access a
 * few extra days) instead of failing hard (paying user locked out).
 */
/**
 * The paid-period end, in Stripe's unix seconds, across BOTH payload shapes.
 *
 * API version 2025-03-31 (Basil) removed `current_period_end` from the
 * Subscription object and moved it onto each subscription item. We read both
 * because the two code paths that call subscriptionGrant() do not share an API
 * version: retrieveSubscription() goes out under the version stripeFetch pins,
 * while a webhook payload arrives under whatever version its event destination
 * is configured with. Reading only the old shape meant a modern destination
 * silently produced `expiresAt: null` — premium that never expires — on every
 * subscription.updated, while the initial purchase looked perfect.
 *
 * Items are maxed rather than taking the first: a multi-item subscription can
 * carry different periods, and §9's never-shorten rule says access ends at the
 * last one.
 */
export function subscriptionPeriodEnd(sub) {
  const top = Number(sub && sub.current_period_end);
  if (Number.isFinite(top) && top > 0) return top;
  const items = (sub && sub.items && sub.items.data) || [];
  let latest = 0;
  for (const item of items) {
    const v = Number(item && item.current_period_end);
    if (Number.isFinite(v) && v > latest) latest = v;
  }
  return latest;
}

export function subscriptionGrant(sub, currentPlan) {
  if (normalizePlan(currentPlan) === 'lifetime') return { skip: true, reason: 'lifetime' };
  const status = String((sub && sub.status) || '');
  if (!ACTIVE_SUB_STATUSES.has(status)) return { plan: 'free', expiresAt: null };
  const end = subscriptionPeriodEnd(sub);
  // Neither shape present is genuinely anomalous; grant open-ended premium
  // rather than an instant expiry, so a Stripe payload change can't lock out
  // someone who just paid. The status events still downgrade them correctly.
  const expiresAt = end > 0
    ? new Date(end * 1000 + RENEWAL_GRACE_DAYS * 86400000).toISOString()
    : null;
  return { plan: 'premium', expiresAt };
}
