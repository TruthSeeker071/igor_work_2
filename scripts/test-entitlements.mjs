// FlightWay 2.0 — entitlements (0.3) server-logic invariants.
//   run: npm run test:entitlements
import {
  normalizePlan, planSatisfies, isPlanActive, effectivePlan, paywallEnabled,
  requirePlan, getPlan,
} from '../functions/_lib/entitlements.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };
const now = Date.parse('2026-07-08T00:00:00Z');
const fakeDb = (plan, exp) => ({ prepare: () => ({ bind: () => ({ first: async () => ({ plan, plan_expires_at: exp }) }) }) });

console.log('plan basics:');
assert(normalizePlan('PREMIUM') === 'premium', 'normalizePlan lowercases known plan');
assert(normalizePlan('bogus') === 'free', 'unknown plan → free');
assert(planSatisfies('premium', 'premium'), 'premium satisfies premium');
assert(!planSatisfies('free', 'premium'), 'free does not satisfy premium');
assert(planSatisfies('lifetime', 'premium'), 'lifetime satisfies premium');

console.log('activity + expiry:');
assert(isPlanActive('premium', '2026-08-01T00:00:00Z', now), 'future expiry → active');
assert(!isPlanActive('premium', '2026-06-01T00:00:00Z', now), 'past expiry → inactive');
assert(isPlanActive('lifetime', '2000-01-01T00:00:00Z', now), 'lifetime always active');
assert(isPlanActive('premium', null, now), 'premium with no expiry → active (beta grant)');
assert(effectivePlan('premium', '2026-06-01T00:00:00Z', now) === 'free', 'expired premium → free');
assert(effectivePlan('premium', '2026-08-01T00:00:00Z', now) === 'premium', 'active premium stays premium');

console.log('paywall flag:');
assert(paywallEnabled({ PAYWALL_ENABLED: 'true' }) === true, 'PAYWALL_ENABLED "true" → on');
assert(paywallEnabled({ PAYWALL_ENABLED: 'false' }) === false, '"false" → off');
assert(paywallEnabled({}) === false, 'unset → off');

console.log('requirePlan (async):');
const off = await requirePlan({}, 'a@b.com', 'premium');
assert(off.ok && off.beta, 'paywall off → allowed (beta), no DB needed');
const onFree = await requirePlan({ PAYWALL_ENABLED: 'true', DB: fakeDb('free', null) }, 'a@b.com', 'premium');
assert(!onFree.ok && onFree.upgrade, 'paywall on + free → upgrade required');
const onPrem = await requirePlan({ PAYWALL_ENABLED: 'true', DB: fakeDb('premium', null) }, 'a@b.com', 'premium');
assert(onPrem.ok, 'paywall on + premium → allowed');
const p = await getPlan({ PAYWALL_ENABLED: 'true', DB: fakeDb('premium', '2000-01-01T00:00:00Z') }, 'a@b.com');
assert(p === 'free', 'getPlan downgrades expired premium to free');

process.exit(fail ? 1 : 0);
