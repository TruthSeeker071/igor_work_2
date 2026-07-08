// FlightWay 2.0 — fake-door pricing capture (Monetization validation).
// POST { tier, source?, email? } → row in pricing_intents. Follows the house
// pattern: originFromEnv + checkRateLimit + schema validation. No Stripe here —
// this only measures pricing-page intent so we can gate real payment work on
// >=5% CTR. Never stores a raw IP (peppered hash only).

import { originFromEnv, jsonResponse, preflightResponse, normalizeEmail, isValidEmail } from './_lib.js';
import { checkRateLimit, clientIp, sha256Hex, generateToken } from './_lib/auth.js';

const ALLOWED_TIERS = new Set(['monthly', 'annual', 'lifetime', 'sprint']);
const RATE_LIMIT_MAX = 20; // per IP per hour

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

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
    await checkRateLimit(env, `intent:${ip}`, { max: RATE_LIMIT_MAX });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
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
