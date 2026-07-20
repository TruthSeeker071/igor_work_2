// FlightWay — per-feature usage limits (free/paid merge §2).
//
// One table, one helper. Every metered feature declares its caps here instead of
// hardcoding a number at its call site, so retuning a cap is a one-line change in
// one file. checkFeatureLimit() is the generalized form of the atomic COACH_KV
// daily counter mock-interview.js pioneered (26h expirationTtl, keyed per
// user+day) — same pattern, one extra key segment per feature.
//
//   limits[plan]  null = unlimited · 0 = not on that plan at all (hard gate)
//   resetPeriod   'day' = per-UTC-day counter · 'lifetime' = never resets
//   keyPrefix     the COACH_KV key segment. NEVER rename one that is already
//                 live — it hands every existing user a fresh allowance.
//
// Dev testers (§3.5) short-circuit to unlimited before any KV read.

import { PLAN_RANK, normalizePlan, resolveEntitlement, isDevTester } from './entitlements.js';

export const FEATURE_LIMITS = {
  'marco-chat': {
    keyPrefix: 'marcochatday',
    resetPeriod: 'day',
    label: 'Marco messages',
    limits: { free: 5, premium: null, lifetime: null },
  },
  'roadmap-generate': {
    keyPrefix: 'roadmapgen',
    resetPeriod: 'lifetime',
    label: 'AI roadmap generations',
    limits: { free: 1, premium: null, lifetime: null },
  },
  'mock-interview': {
    // Live since the mock-interview ship — the prefix must stay `mockivday`.
    keyPrefix: 'mockivday',
    resetPeriod: 'day',
    label: 'mock interview sessions',
    limits: { free: 0, premium: 3, lifetime: 3 },
  },
};

const DAY_TTL_SECONDS = 60 * 60 * 26;

function capitalize(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

/** The cap for a feature on a plan: a number, or null for unlimited. */
export function featureLimit(featureKey, plan) {
  const feature = FEATURE_LIMITS[featureKey];
  if (!feature) return null;
  const v = feature.limits[normalizePlan(plan)];
  return v === undefined ? null : v;
}

/** True when some plan above `plan` gets a strictly better allowance for this feature. */
export function upgradeHelps(featureKey, plan) {
  if (!FEATURE_LIMITS[featureKey]) return false;
  const mine = featureLimit(featureKey, plan);
  if (mine === null) return false;
  const myRank = PLAN_RANK[normalizePlan(plan)] || 0;
  return Object.keys(PLAN_RANK).some((p) => {
    if ((PLAN_RANK[p] || 0) <= myRank) return false;
    const v = featureLimit(featureKey, p);
    return v === null || v > mine;
  });
}

/** COACH_KV key for a user's counter. Day-scoped features roll over at UTC midnight. */
export function featureKvKey(featureKey, email, now = Date.now()) {
  const feature = FEATURE_LIMITS[featureKey];
  if (!feature) return '';
  const who = String(email || '').trim().toLowerCase();
  if (feature.resetPeriod === 'day') {
    return `${feature.keyPrefix}:${who}:${new Date(now).toISOString().slice(0, 10)}`;
  }
  return `${feature.keyPrefix}:${who}`;
}

/**
 * Spend (or peek at) one unit of a metered feature.
 *
 * opts: { spend = true, plan, now }  — pass `plan` when the caller already
 * resolved the entitlement, to skip a duplicate D1 read.
 * Returns { ok, plan, limit, used, remaining, unlimited?, upgrade?, dev?, message? }.
 * Never throws: a missing KV binding fails OPEN so a binding outage can't lock
 * paying users out of the product.
 */
export async function checkFeatureLimit(env, email, featureKey, opts = {}) {
  const feature = FEATURE_LIMITS[featureKey];
  const label = (feature && feature.label) || featureKey;
  const base = { feature: featureKey, label };

  if (isDevTester(env, email)) {
    return { ...base, ok: true, plan: 'lifetime', limit: null, used: 0, remaining: null, unlimited: true, dev: true };
  }
  if (!feature) {
    return { ...base, ok: true, plan: 'free', limit: null, used: 0, remaining: null, unlimited: true };
  }

  const plan = opts.plan ? normalizePlan(opts.plan) : (await resolveEntitlement(env, email)).effective;
  const limit = featureLimit(featureKey, plan);
  if (limit === null) {
    return { ...base, ok: true, plan, limit: null, used: 0, remaining: null, unlimited: true };
  }
  if (limit <= 0) {
    return {
      ...base, ok: false, plan, limit: 0, used: 0, remaining: 0, upgrade: true,
      message: `${capitalize(label)} are a Flight Plan feature.`,
    };
  }
  if (!env || !env.COACH_KV) {
    return { ...base, ok: true, plan, limit, used: 0, remaining: limit, degraded: true };
  }

  const spend = opts.spend !== false;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const key = featureKvKey(featureKey, email, now);
  const used = Number(await env.COACH_KV.get(key)) || 0;

  if (used >= limit) {
    const upgrade = upgradeHelps(featureKey, plan);
    const message = upgrade
      ? `You've used your ${limit} free ${label} — Flight Plan lifts the cap.`
      : (feature.resetPeriod === 'day'
        ? `Daily limit reached (${limit} ${label}). Come back tomorrow.`
        : `Limit reached (${limit} ${label}).`);
    return { ...base, ok: false, plan, limit, used, remaining: 0, upgrade, message };
  }

  if (spend) {
    const put = feature.resetPeriod === 'day' ? { expirationTtl: DAY_TTL_SECONDS } : {};
    await env.COACH_KV.put(key, String(used + 1), put);
  }
  const nowUsed = spend ? used + 1 : used;
  return { ...base, ok: true, plan, limit, used: nowUsed, remaining: Math.max(0, limit - nowUsed) };
}

/**
 * Every metered feature's remaining allowance for one user, for GET /auth/me.
 * null = unlimited on this plan. Peeks only — never spends.
 */
export async function remainingForUser(env, email, plan) {
  const keys = Object.keys(FEATURE_LIMITS);
  if (isDevTester(env, email)) {
    const out = {};
    for (const k of keys) out[k] = null;
    return out;
  }
  const resolved = plan ? normalizePlan(plan) : (await resolveEntitlement(env, email)).effective;
  const results = await Promise.all(
    keys.map((k) => checkFeatureLimit(env, email, k, { spend: false, plan: resolved })
      .catch(() => ({ unlimited: true }))),
  );
  const out = {};
  keys.forEach((k, i) => {
    const r = results[i];
    out[k] = r.unlimited ? null : Math.max(0, Number(r.remaining) || 0);
  });
  return out;
}
