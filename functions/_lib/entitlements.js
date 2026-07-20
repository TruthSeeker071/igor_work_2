// FlightWay 2.0 — entitlements (Pillar 0.3). Server-side plan gating.
//
// Ships DARK: until the Pages var PAYWALL_ENABLED === "true", everyone is treated
// as premium (beta users see everything; gates are wired but inert). Client gates
// (assets/js/shared/entitlements.js) are UX only — premium endpoints call
// requirePlan() so gating is always enforced here too.

export const PLAN_RANK = { free: 0, premium: 1, lifetime: 2 };

export function normalizePlan(p) {
  const s = String(p == null ? 'free' : p).toLowerCase();
  return PLAN_RANK[s] != null ? s : 'free';
}

export function planSatisfies(plan, need) {
  return (PLAN_RANK[normalizePlan(plan)] || 0) >= (PLAN_RANK[normalizePlan(need)] || 0);
}

/** A paid plan is active unless it has an expiry in the past. Free/lifetime never expire. */
export function isPlanActive(plan, expiresAt, now = Date.now()) {
  const p = normalizePlan(plan);
  if (p === 'free' || p === 'lifetime') return true;
  if (!expiresAt) return true; // premium with no expiry = active (e.g. beta grant)
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) ? t > now : true;
}

/** The plan a user effectively has right now (expired premium → free). */
export function effectivePlan(plan, expiresAt, now = Date.now()) {
  const p = normalizePlan(plan);
  if (p === 'free') return 'free';
  return isPlanActive(p, expiresAt, now) ? p : 'free';
}

export function paywallEnabled(env) {
  return String((env && env.PAYWALL_ENABLED) || '').toLowerCase() === 'true';
}

/**
 * Developer/tester full access (free/paid merge §3.5). DEV_TEST_EMAILS is a
 * comma-separated Pages env var set per environment in the Cloudflare dashboard
 * — never committed, empty/unset on production at launch, so this is a no-op
 * unless Jacob populates it. It rides on each dev's own authenticated login
 * (emails here are session-verified), so it grants nothing to anyone who can't
 * already sign in as that address, and it is revocable without a DB write.
 *
 * Wired at exactly three chokepoints — resolveEntitlement(), requirePlan() and
 * checkFeatureLimit() — because every gate in the product routes through one of
 * them. Callers must carry the resulting `dev:true` through so dev traffic stays
 * out of funnel analytics and out of gate-verification runs.
 */
export function isDevTester(env, email) {
  if (!email || !env || !env.DEV_TEST_EMAILS) return false;
  return String(env.DEV_TEST_EMAILS).toLowerCase().split(',')
    .map((s) => s.trim()).filter(Boolean).includes(String(email).toLowerCase().trim());
}

/** Read a user's real, unexpired plan from D1. Defaults to 'free' on any failure. */
export async function getPlan(env, email) {
  if (!email || !env || !env.DB) return 'free';
  try {
    const row = await env.DB.prepare('SELECT plan, plan_expires_at FROM users WHERE email = ?')
      .bind(email).first();
    if (!row) return 'free';
    return effectivePlan(row.plan, row.plan_expires_at);
  } catch {
    return 'free';
  }
}

/** What the client should treat the user as. Ship-dark: premium for all until paywall on. */
export async function resolveEntitlement(env, email) {
  const paywall = paywallEnabled(env);
  // Chokepoint 1 of 3 for the dev allowlist — before any D1 read.
  if (isDevTester(env, email)) return { plan: 'lifetime', effective: 'lifetime', paywall, dev: true };
  const plan = await getPlan(env, email);
  return { plan, effective: paywall ? plan : 'premium', paywall };
}

/**
 * Guard for premium endpoints. Returns { ok:true, ... } when allowed, or
 * { ok:false, upgrade:true, ... } when the paywall is on and the plan is short.
 * With the paywall off, always allows (beta).
 */
export async function requirePlan(env, email, need = 'premium') {
  // Chokepoint 2 of 3 — checked ahead of the paywall flag so `dev` is marked
  // even while the paywall is dark (analytics exclusion depends on it).
  if (isDevTester(env, email)) return { ok: true, plan: 'lifetime', dev: true };
  if (!paywallEnabled(env)) return { ok: true, plan: 'premium', beta: true };
  const plan = await getPlan(env, email);
  if (planSatisfies(plan, need)) return { ok: true, plan };
  return { ok: false, plan, need, upgrade: true };
}
