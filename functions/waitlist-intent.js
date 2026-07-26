// FlightWay 2.0 — fake-door pricing capture (Monetization validation).
// POST { tier, source?, email? } → row in pricing_intents. Follows the house
// pattern: originFromEnv + checkRateLimit + schema validation. No Stripe here —
// this only measures pricing-page intent so we can gate real payment work on
// >=5% CTR. Never stores a raw IP (peppered hash only).

import { originFromEnv, jsonResponse, preflightResponse, normalizeEmail, isValidEmail } from './_lib.js';
import { checkRateLimit, clientIp, hashedIpKey, sha256Hex, generateToken, getSessionEmail } from './_lib/auth.js';
import { isDevTester } from './_lib/entitlements.js';

/** The four things somebody can actually buy. A row with one of these is a
 *  PRICING signal and its count is a business number, never served publicly. */
export const PRICING_TIERS = [
  'monthly', 'annual', 'lifetime', 'sprint',
  // S19 (D16): the two Jacob-gated proposals. They are pricing signals — a
  // click here is somebody saying they would pay for a thing that does not
  // exist, which is the single most useful number a proposal can produce — so
  // they belong in this list and not the waitlist one, and their counts stay
  // private for the same reason the other four's do.
  'semester', 'gift',
];

/** S19 (D14): non-purchase interest lists that reuse this endpoint rather than
 *  growing a second table with the same three columns and the same IP-hash
 *  discipline. They are kept in their own list — not folded into the set above —
 *  so a future funnel query can never mistake "wants the forum" for "clicked
 *  Buy". Only these tiers have a public count (see onRequestGet). */
export const WAITLIST_TIERS = ['community'];

const ALLOWED_TIERS = new Set([...PRICING_TIERS, ...WAITLIST_TIERS]);
const RATE_LIMIT_MAX = 20; // per IP per hour
const COUNT_CACHE_SEC = 300;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

/**
 * S19 — the seed-interest counter on /community.
 *
 * `GET /waitlist-intent?tier=community` → `{ tier, count }`. Deliberately
 * narrow in three ways:
 *
 *  - **Waitlist tiers only.** How many people clicked "Claim a founding seat"
 *    is a business number; a page that leaks it is a page that tells a
 *    competitor the conversion rate. A pricing tier here is a 400, not a count.
 *  - **A count, never a list.** No emails, no timestamps, nothing joinable.
 *  - **KV-cached, and a cache miss on a broken DB is `null`, not `0`.** A page
 *    that renders "0 students" because D1 hiccuped tells the visitor the
 *    opposite of the truth, so the client is handed no number at all and says
 *    nothing rather than something false.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const tier = String(new URL(request.url).searchParams.get('tier') || '').trim().toLowerCase();
  if (!WAITLIST_TIERS.includes(tier)) {
    return jsonResponse(400, { error: 'Unknown waitlist.' }, origin);
  }

  const cacheKey = `waitcount:${tier}`;
  try {
    if (env.COACH_KV) {
      const hit = await env.COACH_KV.get(cacheKey);
      if (hit !== null && hit !== undefined) {
        return jsonResponse(200, { tier, count: Number(hit) }, origin);
      }
    }
  } catch (_) { /* cache miss on error — fall through to the real count */ }

  let count = null;
  try {
    if (env.DB) {
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM pricing_intents WHERE tier = ?',
      ).bind(tier).first();
      count = Number(row?.n || 0);
    }
  } catch (err) {
    console.warn('waitlist count failed', err?.message || err);
  }

  if (count !== null) {
    try {
      if (env.COACH_KV) {
        await env.COACH_KV.put(cacheKey, String(count), { expirationTtl: COUNT_CACHE_SEC });
      }
    } catch (_) { /* the count is still correct without a cache */ }
  }

  return jsonResponse(200, { tier, count }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const tier = String(body?.tier || '').trim().toLowerCase();
  if (!ALLOWED_TIERS.has(tier)) {
    return jsonResponse(400, { error: 'Unknown plan tier.' }, origin);
  }
  const source = String(body?.source || 'pricing').slice(0, 60);
  const email = body?.email ? normalizeEmail(body.email) : '';
  if (email && !isValidEmail(email)) {
    return jsonResponse(400, { error: 'That email address looks off.' }, origin);
  }

  const ip = clientIp(request);
  try {
    // Rate-limit bucket keyed by a peppered hash, never the raw IP (the stored
    // ip_hash column below is separately hashed; both keep the address out of KV).
    await checkRateLimit(env, `intent:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  // Dev/tester traffic must not pollute the funnel (free/paid merge §3.5): a CTR
  // reading is only worth having if the clicks came from real prospects.
  const sessionEmail = await getSessionEmail(request, env).catch(() => '');
  if (isDevTester(env, email) || isDevTester(env, sessionEmail)) {
    return jsonResponse(200, { ok: true, dev: true }, origin);
  }

  // Persist. The fake door must never hard-fail the UX, so DB errors degrade to ok.
  try {
    if (env.DB) {
      const pepper = env.INTENT_PEPPER || env.SESSION_PEPPER || 'flightway';
      const ipHash = (await sha256Hex(ip + '|' + pepper)).slice(0, 32);
      const ua = String(request.headers.get('User-Agent') || '').slice(0, 200);
      await env.DB.prepare(
        'INSERT INTO pricing_intents (id, email, tier, source, ip_hash, user_agent, created_at) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(generateToken(12), email || null, tier, source, ipHash, ua, new Date().toISOString()).run();
    }
  } catch (err) {
    console.error('pricing_intents insert failed', err?.message || err);
    // fall through — still report success to the visitor
  }

  return jsonResponse(200, { ok: true }, origin);
}
