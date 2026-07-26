// FlightWay V2 S15 — the referral loop (plan §5 S15, D24: "give a month, get a
// month").
//
// Shape of the whole thing, because it is spread over five request paths:
//
//   GET /r/<code>          → sets the fw_ref cookie, 302s home, logs referral_visit
//   POST /auth/register    → bindReferral() writes the `referrals` row (status
//                            signed_up) from that cookie. The client never sends
//                            the code, so it cannot be forged per-request.
//   POST /stripe/checkout  → refereePromoFor() attaches the referee's free-month
//                            promotion code to the Checkout Session
//   POST /stripe/webhook   → creditReferrer() on the referee's first successful
//                            payment: claim → guard → Stripe customer-balance
//                            credit → mark credited → mail both sides
//   /admin/referrals       → list / void / retry
//
// Everything that DECIDES something is a pure function (referralFlags,
// normalizeReferralCode, creditDescription) so scripts/test-referral.mjs can
// prove the money and fraud paths with no network and no database — the same
// split _lib/stripe.js uses for its grants.
//
// Money-safety invariant, stated once: the `signed_up → converted` transition is
// claimed in D1 with a conditional UPDATE *before* a single Stripe call, and the
// Stripe call itself carries an idempotency key derived from the referral id. A
// webhook replay therefore finds `changes === 0` and returns, and a retry that
// races past that still cannot issue a second balance credit.

import { priceIdFor, stripeConfigured, stripeFetch } from './stripe.js';
import { logServerEvent } from './events.js';

/** Unambiguous alphabet: no 0/O, no 1/I/L. A code gets read aloud and typed. */
export const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERRAL_CODE_LEN = 7;
export const REFERRAL_COOKIE = 'fw_ref';
/** 30 days from click to signup. Longer and the attribution stops being honest. */
export const REFERRAL_COOKIE_DAYS = 30;

/**
 * D24's abuse ceiling. Twelve credited referrals a year is a genuinely great
 * advocate and also exactly one free year — past that a human should look at
 * the account before more money moves. Not a plan cap (nothing in §4 meters
 * it), so it lives here rather than in plan-limits.js; the invite surface reads
 * it from GET /referral instead of hard-coding it, per §3 rule 11.
 */
export const MAX_CREDITS_PER_YEAR = 12;

/** How many referrals may share one signup IP hash before it looks like a farm. */
export const IP_CLUSTER_WARN = 2;

export const REFERRAL_STATUSES = ['signed_up', 'converted', 'credited', 'void'];

const YEAR_MS = 365 * 86400000;

function nowIso() { return new Date().toISOString(); }

function randomId(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --------------------------------------------------------------------- codes

/** A fresh code. Rejection sampling so the alphabet stays uniform. */
export function generateReferralCode(len = REFERRAL_CODE_LEN) {
  const out = [];
  const n = REFERRAL_ALPHABET.length;
  const limit = 256 - (256 % n);
  while (out.length < len) {
    const buf = new Uint8Array(len * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (out.length >= len) break;
      if (b >= limit) continue;
      out.push(REFERRAL_ALPHABET[b % n]);
    }
  }
  return out.join('');
}

/**
 * Normalize a code as typed. Uppercases and drops the separators people add on
 * their own ("fw-2k9pq4t", "2K9 PQ4T"), then demands exactly REFERRAL_CODE_LEN
 * characters that are all in the alphabet.
 *
 * Deliberately NO look-alike repair. 0/1/I/L/O are excluded from the alphabet
 * precisely so they never appear in a real code, which means a code containing
 * one is a typo — and "repairing" it would resolve to a DIFFERENT real user's
 * code. An unknown-code redirect is the safe failure; a silently reassigned
 * referral is not.
 */
export function normalizeReferralCode(raw) {
  const candidate = String(raw == null ? '' : raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (candidate.length !== REFERRAL_CODE_LEN) return '';
  for (const ch of candidate) if (!REFERRAL_ALPHABET.includes(ch)) return '';
  return candidate;
}

export function referralCookieHeader(code) {
  return [
    `${REFERRAL_COOKIE}=${encodeURIComponent(code)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${REFERRAL_COOKIE_DAYS * 86400}`, 'Secure',
  ].join('; ');
}

export function clearReferralCookieHeader() {
  return `${REFERRAL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

/** The public link for a code. Absolute, because it is pasted into chat apps. */
export function referralLink(base, code) {
  return `${String(base || '').replace(/\/+$/, '')}/r/${encodeURIComponent(code)}`;
}

/**
 * Read the code a /r/<code> visit stamped. Deliberately NOT taken from the
 * request body anywhere: a client-supplied referrer is a client-chosen referrer.
 */
export function readReferralCookie(request) {
  const header = (request && request.headers && request.headers.get('Cookie')) || '';
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== REFERRAL_COOKIE) continue;
    try { return normalizeReferralCode(decodeURIComponent(part.slice(i + 1).trim())); } catch { return ''; }
  }
  return '';
}

/** The code for this account, minting one on first use. '' when D1 has no column yet. */
export async function ensureReferralCode(env, email) {
  if (!env || !env.DB || !email) return '';
  try {
    const row = await env.DB.prepare('SELECT referral_code FROM users WHERE email = ?').bind(email).first();
    if (row && row.referral_code) return String(row.referral_code);
  } catch {
    return ''; // pre-0023 schema — every invite surface degrades to "not on yet"
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();
    try {
      const res = await env.DB.prepare(
        'UPDATE users SET referral_code = ? WHERE email = ? AND referral_code IS NULL',
      ).bind(code, email).run();
      if (res && res.meta && res.meta.changes === 1) return code;
      // Someone else minted one between the SELECT and here — read it back.
      const again = await env.DB.prepare('SELECT referral_code FROM users WHERE email = ?').bind(email).first();
      if (again && again.referral_code) return String(again.referral_code);
    } catch {
      // UNIQUE collision on idx_users_referral_code — try another code.
    }
  }
  console.error('referral: could not mint a code for', email);
  return '';
}

export async function emailForReferralCode(env, code) {
  const clean = normalizeReferralCode(code);
  if (!clean || !env || !env.DB) return '';
  try {
    const row = await env.DB.prepare('SELECT email FROM users WHERE referral_code = ?').bind(clean).first();
    return (row && row.email) || '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- fraud rules

/**
 * The whole guard set, as one pure function over facts the caller gathered.
 *
 * `blocking` means no money moves — the referral stays visible at `converted`
 * with its flags so an admin can look and, if it is legitimate, retry it. Only
 * a human (or a void) ends it. `warning` is recorded and does not stop a credit:
 * a shared campus IP is normal and refusing it would punish exactly the users
 * this loop is for.
 */
export function referralFlags(facts = {}) {
  const f = facts || {};
  const eq = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  const blocking = [];
  const warning = [];

  if (eq(f.referrerEmail, f.refereeEmail)) blocking.push('self_email');
  if (eq(f.referrerCustomerId, f.refereeCustomerId)) blocking.push('self_customer');
  if (eq(f.refereeIpHash, f.referrerSignupIpHash)) blocking.push('self_ip');
  if (!f.referrerVerified) blocking.push('referrer_unverified');
  if (!f.refereeVerified) blocking.push('referee_unverified');

  const cap = Number.isFinite(f.maxCreditsPerYear) ? f.maxCreditsPerYear : MAX_CREDITS_PER_YEAR;
  if (Number(f.creditsThisYear || 0) >= cap) blocking.push('credit_cap');

  if (Number(f.sameIpReferralCount || 0) >= IP_CLUSTER_WARN) warning.push('ip_cluster');

  return { ok: blocking.length === 0, blocking, warning };
}

/** The description Stripe shows on the credit. Pure so the gate can pin it. */
export function creditDescription(refereeEmail) {
  const who = String(refereeEmail || '').split('@')[0].slice(0, 24) || 'a friend';
  return `FlightWay referral credit — ${who} subscribed`;
}

// --------------------------------------------------------------------- bind

/**
 * Bind a signup to the code its browser is carrying. Called from register (and
 * the Google callback) inside the same try that creates the account, but it can
 * never fail one: every path returns instead of throwing.
 *
 * Bind-once is enforced by idx_referrals_referee (UNIQUE), not by a read —
 * two tabs finishing signup at once must not produce two rows.
 */
export async function bindReferral(env, { code, refereeEmail, ipHash } = {}) {
  const clean = normalizeReferralCode(code);
  if (!clean || !env || !env.DB || !refereeEmail) return { bound: false };
  try {
    const referrer = await emailForReferralCode(env, clean);
    if (!referrer) return { bound: false, reason: 'unknown_code' };
    if (String(referrer).toLowerCase() === String(refereeEmail).toLowerCase()) {
      return { bound: false, reason: 'self_referral' };
    }
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO referrals
         (id, code, referrer_id, referee_id, status, signup_ip_hash, created_at)
       VALUES (?, ?, ?, ?, 'signed_up', ?, ?)`,
    ).bind(randomId(), clean, referrer, refereeEmail, ipHash || null, nowIso()).run();
    const bound = !!(res && res.meta && res.meta.changes === 1);
    return { bound, referrer, reason: bound ? '' : 'already_bound' };
  } catch (err) {
    // Pre-0023 schema, or a UNIQUE race. Neither is a signup failure.
    console.warn('referral bind skipped', err && err.message);
    return { bound: false, reason: 'unavailable' };
  }
}

// ------------------------------------------------------------- referee promo

/**
 * The referee half of D24. Returns the promotion-code id to attach to a
 * Checkout Session, or '' when this buyer is not owed one.
 *
 * Deliberately checks `status = 'signed_up'`: the discount is for the FIRST
 * purchase. Someone who already converted (and whose referrer was already
 * credited) resubscribing later pays list price.
 */
export async function refereePromoFor(env, email) {
  const promo = String((env && env.STRIPE_REFERRAL_PROMO_ID) || '').trim();
  if (!promo || !env || !env.DB || !email) return '';
  try {
    const row = await env.DB.prepare(
      "SELECT id FROM referrals WHERE referee_id = ? AND status = 'signed_up' LIMIT 1",
    ).bind(email).first();
    return row ? promo : '';
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------- credit

/**
 * One month's price, in the smallest currency unit.
 *
 * Read from Stripe rather than from a constant, because "one month free" has
 * exactly one correct value and it is whatever the monthly price actually is
 * today. Cached in KV for a day so the webhook path costs one extra round trip
 * per day, not per payment. `REFERRAL_CREDIT_CENTS` overrides it outright (for
 * a deployment that wants a fixed credit); `MRR_MONTHLY_CENTS` is the fallback
 * the admin Overview already uses. Null means "we do not know" — and a credit
 * of an unknown size is never issued.
 */
export async function creditAmount(env) {
  const override = Number((env && env.REFERRAL_CREDIT_CENTS) || 0);
  if (Number.isFinite(override) && override > 0) return { cents: Math.round(override), currency: 'usd' };

  const priceId = stripeConfigured(env) ? priceIdFor(env, 'monthly') : '';
  if (priceId && env.COACH_KV) {
    try {
      const hit = await env.COACH_KV.get(`refprice:${priceId}`, 'json');
      if (hit && Number(hit.cents) > 0) return { cents: Number(hit.cents), currency: String(hit.currency || 'usd') };
    } catch { /* cache miss is not an error */ }
  }
  if (priceId) {
    try {
      const price = await stripeFetch(env, `/prices/${encodeURIComponent(priceId)}`, { method: 'GET', timeoutMs: 8000 });
      const cents = Number(price && price.unit_amount);
      if (Number.isFinite(cents) && cents > 0) {
        const out = { cents: Math.round(cents), currency: String((price && price.currency) || 'usd') };
        if (env.COACH_KV) {
          try { await env.COACH_KV.put(`refprice:${priceId}`, JSON.stringify(out), { expirationTtl: 86400 }); } catch { /* best effort */ }
        }
        return out;
      }
    } catch (err) {
      console.error('referral: monthly price lookup failed', err && err.message);
    }
  }
  const mrr = Number((env && env.MRR_MONTHLY_CENTS) || 0);
  if (Number.isFinite(mrr) && mrr > 0) return { cents: Math.round(mrr), currency: 'usd' };
  return { cents: 0, currency: 'usd' };
}

/**
 * The referrer needs a Stripe customer before a balance credit can sit on it,
 * and most referrers have never paid. Creating one here is what makes the
 * credit real: functions/stripe/checkout.js already reuses
 * `users.stripe_customer_id` when it exists, so the money is waiting the moment
 * they subscribe.
 */
export async function ensureStripeCustomer(env, email) {
  try {
    const row = await env.DB.prepare('SELECT stripe_customer_id FROM users WHERE email = ?').bind(email).first();
    if (row && row.stripe_customer_id) return String(row.stripe_customer_id);
  } catch { /* fall through to create */ }
  const customer = await stripeFetch(env, '/customers', {
    form: { email, metadata: { email, created_by: 'referral_credit' } },
    idempotencyKey: `fwrefcust:${email}`,
    timeoutMs: 10000,
  });
  const id = String((customer && customer.id) || '');
  if (!id) throw new Error('Stripe returned a customer with no id');
  try {
    await env.DB.prepare(
      'UPDATE users SET stripe_customer_id = ? WHERE email = ? AND stripe_customer_id IS NULL',
    ).bind(id, email).run();
  } catch (err) {
    console.warn('referral: could not store customer id', err && err.message);
  }
  return id;
}

async function creditsThisYear(env, referrer) {
  try {
    const since = new Date(Date.now() - YEAR_MS).toISOString();
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ? AND status = 'credited' AND credited_at >= ?",
    ).bind(referrer, since).first();
    return Number((row && row.n) || 0);
  } catch {
    return 0;
  }
}

async function sameIpCount(env, referrer, ipHash) {
  if (!ipHash) return 0;
  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ? AND signup_ip_hash = ?',
    ).bind(referrer, ipHash).first();
    return Number((row && row.n) || 0);
  } catch {
    return 0;
  }
}

async function accountFacts(env, email) {
  try {
    const row = await env.DB.prepare(
      'SELECT email, verified_at, stripe_customer_id FROM users WHERE email = ?',
    ).bind(email).first();
    return row || null;
  } catch {
    return null;
  }
}

/** The signup IP hash of the REFERRER, when they were themselves referred. The
 *  one self-referral signal available without storing an IP against an account. */
async function referrerSignupIpHash(env, referrer) {
  try {
    const row = await env.DB.prepare(
      'SELECT signup_ip_hash FROM referrals WHERE referee_id = ? LIMIT 1',
    ).bind(referrer).first();
    return (row && row.signup_ip_hash) || '';
  } catch {
    return '';
  }
}

async function setFlags(env, id, flags) {
  try {
    await env.DB.prepare('UPDATE referrals SET flags = ? WHERE id = ?')
      .bind(JSON.stringify(flags), id).run();
  } catch { /* advisory only */ }
}

/**
 * The referee just paid for the first time. Convert, guard, credit.
 *
 * Returns a small result object rather than throwing, and the CALLER decides
 * whether to care — the Stripe webhook must never 500 over a referral, because
 * a 500 sends Stripe into a retry loop over an entitlement that was already
 * written correctly.
 *
 * `opts.retry` lets the admin panel re-run a referral that is stuck at
 * `converted` (a guard that has since been satisfied — usually the referrer
 * finally verifying their email).
 */
export async function creditReferrer(env, refereeEmail, opts = {}) {
  if (!env || !env.DB || !refereeEmail) return { ok: false, reason: 'unavailable' };

  let row;
  try {
    row = await env.DB.prepare(
      'SELECT id, code, referrer_id, referee_id, status, signup_ip_hash FROM referrals WHERE referee_id = ?',
    ).bind(refereeEmail).first();
  } catch {
    return { ok: false, reason: 'unavailable' }; // pre-0023 schema
  }
  if (!row) return { ok: false, reason: 'not_referred' };
  if (row.status === 'credited') return { ok: false, reason: 'already_credited' };
  if (row.status === 'void') return { ok: false, reason: 'void' };

  // THE CLAIM. Conditional on the status we read, so a webhook replay (or two
  // deliveries racing) finds changes === 0 and stops here, before Stripe.
  if (row.status === 'signed_up') {
    const claim = await env.DB.prepare(
      "UPDATE referrals SET status = 'converted', converted_at = ? WHERE id = ? AND status = 'signed_up'",
    ).bind(nowIso(), row.id).run();
    if (!claim || !claim.meta || claim.meta.changes !== 1) return { ok: false, reason: 'raced' };
    await logServerEvent(env, 'referral_converted', {
      userId: row.referrer_id, path: '/stripe/webhook', props: { stage: 'converted' },
    });
  } else if (!opts.retry) {
    // Already `converted` and this is not a deliberate retry: a previous run
    // held it on a guard. Do not silently try again on every later webhook.
    return { ok: false, reason: 'held' };
  }

  const [referrer, referee] = await Promise.all([
    accountFacts(env, row.referrer_id),
    accountFacts(env, row.referee_id),
  ]);
  const [credits, ipCount, refIpHash] = await Promise.all([
    creditsThisYear(env, row.referrer_id),
    sameIpCount(env, row.referrer_id, row.signup_ip_hash),
    referrerSignupIpHash(env, row.referrer_id),
  ]);

  const verdict = referralFlags({
    referrerEmail: row.referrer_id,
    refereeEmail: row.referee_id,
    referrerVerified: !!(referrer && referrer.verified_at),
    refereeVerified: !!(referee && referee.verified_at),
    referrerCustomerId: referrer && referrer.stripe_customer_id,
    refereeCustomerId: referee && referee.stripe_customer_id,
    refereeIpHash: row.signup_ip_hash,
    referrerSignupIpHash: refIpHash,
    sameIpReferralCount: ipCount,
    creditsThisYear: credits,
    maxCreditsPerYear: MAX_CREDITS_PER_YEAR,
  });
  await setFlags(env, row.id, verdict.blocking.concat(verdict.warning));
  if (!verdict.ok) {
    console.log(JSON.stringify({ type: 'referral_held', id: row.id, flags: verdict.blocking }));
    return { ok: false, reason: 'guarded', flags: verdict.blocking, id: row.id };
  }

  if (!stripeConfigured(env)) return { ok: false, reason: 'stripe_unconfigured', id: row.id };
  const { cents, currency } = await creditAmount(env);
  if (!cents) {
    await setFlags(env, row.id, verdict.blocking.concat(verdict.warning, ['no_price']));
    return { ok: false, reason: 'no_price', id: row.id };
  }

  let customerId;
  try {
    customerId = await ensureStripeCustomer(env, row.referrer_id);
  } catch (err) {
    console.error('referral: could not resolve a Stripe customer', err && err.message);
    return { ok: false, reason: 'no_customer', id: row.id };
  }

  try {
    await stripeFetch(env, `/customers/${encodeURIComponent(customerId)}/balance_transactions`, {
      form: { amount: -Math.abs(cents), currency, description: creditDescription(row.referee_id) },
      idempotencyKey: `fwrefcredit:${row.id}`,
      timeoutMs: 10000,
    });
  } catch (err) {
    console.error('referral: balance credit failed', err && err.status, err && err.message);
    return { ok: false, reason: 'stripe_failed', id: row.id };
  }

  try {
    await env.DB.prepare(
      "UPDATE referrals SET status = 'credited', credited_at = ?, credit_cents = ? WHERE id = ?",
    ).bind(nowIso(), cents, row.id).run();
  } catch (err) {
    // The money moved and the row did not. Say so loudly — the idempotency key
    // means a retry cannot double-credit, so this is recoverable by hand.
    console.error('referral: credited in Stripe but the row did not update', row.id, err && err.message);
  }
  await logServerEvent(env, 'referral_converted', {
    userId: row.referrer_id, path: '/stripe/webhook', props: { stage: 'credited', cents },
  });
  return { ok: true, id: row.id, cents, currency, referrer: row.referrer_id, referee: row.referee_id };
}

// -------------------------------------------------------------------- reads

/** What the invite card shows. Never throws — a missing table reads as zeroes. */
export async function referralStats(env, email) {
  const out = {
    signedUp: 0, converted: 0, credited: 0, creditCents: 0, maxPerYear: MAX_CREDITS_PER_YEAR,
  };
  if (!env || !env.DB || !email) return out;
  try {
    const res = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(credit_cents), 0) AS cents
         FROM referrals WHERE referrer_id = ? GROUP BY status`,
    ).bind(email).all();
    for (const r of (res && res.results) || []) {
      const n = Number(r.n || 0);
      if (r.status === 'signed_up') out.signedUp = n;
      else if (r.status === 'converted') out.converted = n;
      else if (r.status === 'credited') { out.credited = n; out.creditCents = Number(r.cents || 0); }
    }
  } catch { /* pre-0023 schema */ }
  return out;
}

export async function listReferrals(env, { limit = 100, offset = 0, status = '' } = {}) {
  const clauses = [];
  const binds = [];
  if (status && REFERRAL_STATUSES.includes(status)) { clauses.push('status = ?'); binds.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const res = await env.DB.prepare(
    `SELECT id, code, referrer_id, referee_id, status, flags, credit_cents,
            created_at, converted_at, credited_at, voided_at, void_reason
       FROM referrals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...binds, Math.min(Number(limit) || 100, 200), Math.max(Number(offset) || 0, 0)).all();
  return (res && res.results) || [];
}

/** Admin kill switch. Terminal: a voided referral is never retried or credited. */
export async function voidReferral(env, id, reason) {
  const res = await env.DB.prepare(
    "UPDATE referrals SET status = 'void', voided_at = ?, void_reason = ? WHERE id = ? AND status != 'credited'",
  ).bind(nowIso(), String(reason || '').slice(0, 200), id).run();
  return !!(res && res.meta && res.meta.changes === 1);
}
