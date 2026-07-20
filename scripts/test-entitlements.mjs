// FlightWay 2.0 — entitlements (0.3) server-logic invariants.
//   run: npm run test:entitlements
import {
  normalizePlan, planSatisfies, isPlanActive, effectivePlan, paywallEnabled,
  requirePlan, getPlan, resolveEntitlement, isDevTester,
} from '../functions/_lib/entitlements.js';
import {
  FEATURE_LIMITS, featureLimit, upgradeHelps, featureKvKey,
  checkFeatureLimit, remainingForUser,
} from '../functions/_lib/plan-limits.js';

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

// ---------------------------------------------------------------- §3.5 dev allowlist
const DEV = ' Dev@Flightway.AI , other@x.com';
const devEnv = (extra = {}) => ({ DEV_TEST_EMAILS: DEV, ...extra });

console.log('dev-tester allowlist (§3.5):');
assert(isDevTester(devEnv(), 'dev@flightway.ai'), 'listed email matches (case + whitespace insensitive)');
assert(isDevTester(devEnv(), '  DEV@flightway.ai '), 'input email is trimmed and lowercased too');
assert(!isDevTester(devEnv(), 'stranger@x.com'), 'unlisted email does not match');
assert(!isDevTester({ DEV_TEST_EMAILS: '' }, 'dev@flightway.ai'), 'empty var → global no-op');
assert(!isDevTester({}, 'dev@flightway.ai'), 'unset var → global no-op');
assert(!isDevTester(devEnv(), ''), 'no email → never a dev tester');

const devEnt = await resolveEntitlement(devEnv({ PAYWALL_ENABLED: 'true' }), 'dev@flightway.ai');
assert(devEnt.effective === 'lifetime' && devEnt.dev === true, 'chokepoint 1: resolveEntitlement → lifetime + dev, no DB');
const devReq = await requirePlan(devEnv({ PAYWALL_ENABLED: 'true', DB: fakeDb('free', null) }), 'dev@flightway.ai');
assert(devReq.ok && devReq.dev, 'chokepoint 2: requirePlan passes a dev tester whose real plan is free');
const nonDevReq = await requirePlan(devEnv({ PAYWALL_ENABLED: 'true', DB: fakeDb('free', null) }), 'stranger@x.com');
assert(!nonDevReq.ok && nonDevReq.upgrade, 'a non-allowlisted free account is still blocked (gates stay honest)');

// ------------------------------------------------- comp grants (admin console)
// A comp writes the SAME users.plan / plan_expires_at columns a purchase writes
// (migration 0016 adds only plan_source, which records who wrote them). These
// cases pin the consequence: the three chokepoints need no comp-specific reads,
// and a comped account is a REAL user — never flagged dev, so it stays in
// analytics and digests, unlike a DEV_TEST_EMAILS account.
console.log('comp grants ride the existing plan columns:');
{
  const compEnv = { PAYWALL_ENABLED: 'true', DB: fakeDb('lifetime', null) };
  const ent = await resolveEntitlement(compEnv, 'comped@x.com');
  assert(ent.effective === 'lifetime' && ent.dev === undefined,
    'a comped account resolves as a real lifetime user, with no dev marker');
  const compReq = await requirePlan(compEnv, 'comped@x.com', 'premium');
  assert(compReq.ok && !compReq.dev, 'requirePlan passes a comped user without marking them dev');
  const lapsed = { PAYWALL_ENABLED: 'true', DB: fakeDb('premium', '2000-01-01T00:00:00Z') };
  assert(await getPlan(lapsed, 'comped@x.com') === 'free',
    'an expired comp degrades exactly like an expired purchase — one expiry rule, not two');
}

// ------------------------------------------------------------- §2 feature limits
function fakeKv() {
  const map = new Map(); const ttls = new Map();
  return {
    map, ttls,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    put: async (k, v, opts) => { map.set(k, v); if (opts && opts.expirationTtl) ttls.set(k, opts.expirationTtl); },
  };
}
const ON = { PAYWALL_ENABLED: 'true' };

console.log('feature-limit table:');
assert(featureLimit('marco-chat', 'free') === 5, 'free Marco cap is 5/day');
assert(featureLimit('marco-chat', 'premium') === null, 'premium Marco is unlimited');
assert(featureLimit('roadmap-generate', 'free') === 1, 'free tier gets one AI roadmap generation');
assert(featureLimit('mock-interview', 'free') === 0, 'mock interviews are not on the free plan at all');
assert(featureLimit('mock-interview', 'premium') === 3, 'premium keeps the pre-existing 3 sessions/day cap');
assert(FEATURE_LIMITS['mock-interview'].keyPrefix === 'mockivday', 'live KV prefix preserved (no allowance reset)');
assert(upgradeHelps('marco-chat', 'free') && !upgradeHelps('mock-interview', 'premium'),
  'upgradeHelps is true only when a higher plan actually gets more');
assert(featureKvKey('marco-chat', 'A@B.com', Date.parse('2026-07-19T23:00:00Z')) === 'marcochatday:a@b.com:2026-07-19',
  'day-scoped key is lowercased and UTC-day stamped');
assert(featureKvKey('roadmap-generate', 'a@b.com') === 'roadmapgen:a@b.com',
  'lifetime-scoped key carries no day segment');

console.log('checkFeatureLimit (daily counter):');
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  let last;
  for (let i = 0; i < 5; i++) last = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'free' });
  assert(last.ok && last.used === 5 && last.remaining === 0, 'free user spends exactly 5 Marco messages');
  const sixth = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'free' });
  assert(!sixth.ok && sixth.upgrade && /Flight Plan/.test(sixth.message), '6th message blocked with an upgrade nudge');
  assert(kv.ttls.get(featureKvKey('marco-chat', 'a@b.com')) === 60 * 60 * 26, 'daily counter carries the 26h TTL');
  const prem = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'premium' });
  assert(prem.ok && prem.unlimited && prem.remaining === null, 'premium Marco is unlimited and never touches KV');
}
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const peek = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'free', spend: false });
  assert(peek.ok && peek.remaining === 5 && kv.map.size === 0, 'spend:false peeks without writing a counter');
}
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const first = await checkFeatureLimit(env, 'a@b.com', 'roadmap-generate', { plan: 'free' });
  const second = await checkFeatureLimit(env, 'a@b.com', 'roadmap-generate', { plan: 'free' });
  assert(first.ok && !second.ok && second.upgrade, 'one free roadmap generation, then upgrade required');
  assert(kv.ttls.size === 0, 'lifetime counter is written without an expiry');
  const prem = await checkFeatureLimit(env, 'a@b.com', 'roadmap-generate', { plan: 'premium' });
  assert(prem.ok && prem.unlimited, 'premium regenerates the roadmap freely');
}
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const free = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', { plan: 'free' });
  assert(!free.ok && free.limit === 0 && free.upgrade, 'limit 0 → hard gate, no counter spent');
  let last;
  for (let i = 0; i < 3; i++) last = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', { plan: 'premium' });
  const fourth = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', { plan: 'premium' });
  assert(last.ok && !fourth.ok, 'premium still capped at 3 mock interviews/day (pre-existing behaviour preserved)');
  assert(!fourth.upgrade && /tomorrow/.test(fourth.message), 'top-plan exhaustion says come back tomorrow, not upgrade');
}
{
  // Sprint = 14 days of premium (§9): the SAME plan column, so the caps a Sprint
  // buyer sees are premium's, and they revert to free caps once it lapses.
  const kv = fakeKv();
  const sprintEnv = { ...ON, COACH_KV: kv, DB: fakeDb('premium', new Date(Date.now() + 6 * 864e5).toISOString()) };
  const live = await checkFeatureLimit(sprintEnv, 's@b.com', 'marco-chat');
  assert(live.ok && live.unlimited && live.plan === 'premium', 'un-lapsed Sprint resolves to premium caps via D1');
  const lapsedEnv = { ...ON, COACH_KV: fakeKv(), DB: fakeDb('premium', '2000-01-01T00:00:00Z') };
  const lapsed = await checkFeatureLimit(lapsedEnv, 's@b.com', 'marco-chat');
  assert(lapsed.ok && lapsed.plan === 'free' && lapsed.remaining === 4, 'lapsed Sprint falls back to free caps');
}
{
  const kv = fakeKv();
  const env = devEnv({ ...ON, COACH_KV: kv });
  const dev = await checkFeatureLimit(env, 'dev@flightway.ai', 'marco-chat');
  assert(dev.ok && dev.unlimited && dev.dev && kv.map.size === 0, 'chokepoint 3: dev tester is uncapped and never touches KV');
  const noKv = await checkFeatureLimit({ ...ON }, 'a@b.com', 'marco-chat', { plan: 'free' });
  assert(noKv.ok && noKv.degraded, 'missing COACH_KV binding fails OPEN, never locks the product');
}

console.log('remainingForUser (served on /auth/me):');
{
  const env = { ...ON, COACH_KV: fakeKv() };
  const free = await remainingForUser(env, 'a@b.com', 'free');
  assert(free['marco-chat'] === 5 && free['roadmap-generate'] === 1 && free['mock-interview'] === 0,
    'free counters reported for every metered feature');
  const prem = await remainingForUser(env, 'a@b.com', 'premium');
  assert(prem['marco-chat'] === null && prem['mock-interview'] === 3, 'null means unlimited on this plan');
  const dev = await remainingForUser(devEnv(ON), 'dev@flightway.ai');
  assert(Object.values(dev).every((v) => v === null), 'dev tester reports unlimited everywhere');
}

process.exit(fail ? 1 : 0);
