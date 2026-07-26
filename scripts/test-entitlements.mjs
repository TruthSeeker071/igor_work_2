// FlightWay 2.0 — entitlements (0.3) server-logic invariants.
//   run: npm run test:entitlements
import {
  normalizePlan, planSatisfies, isPlanActive, effectivePlan, paywallEnabled,
  requirePlan, getPlan, resolveEntitlement, isDevTester,
} from '../functions/_lib/entitlements.js';
import {
  FEATURE_LIMITS, featureLimit, upgradeHelps, featureKvKey, resetPeriodFor,
  checkFeatureLimit, remainingForUser, publicFeatureLimits, refundFeatureUse,
} from '../functions/_lib/plan-limits.js';
import { checkRateLimit, refundRateLimit, RATE_LIMIT_CHAT_MAX, RATE_LIMIT_MAX } from '../functions/_lib/auth.js';

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

// The V2 §4 cap table. Every row here is a product decision recorded in
// docs/V2_MASTERPLAN_2026-07-23.md §4 — if one of these fails, the table moved
// and someone has to decide whether the plan moved with it.
console.log('feature-limit table (V2 §4):');
assert(featureLimit('marco-chat', 'free') === 10, 'free Marco cap is 10/day (§4: 5 was too thin to form the habit)');
assert(featureLimit('marco-chat', 'premium') === null, 'premium Marco is unlimited');
assert(featureLimit('marco-thread', 'free') === 2, 'free gets 2 Marco topic suggestions a day');
assert(featureLimit('roadmap-generate', 'free') === 1, 'free tier gets one AI roadmap generation per month');
assert(featureLimit('mock-interview', 'free') === 1, '§4: free gets ONE lifetime mock-interview taste, not zero');
assert(featureLimit('mock-interview', 'premium') === 3, 'premium keeps the pre-existing 3 sessions/day cap');
assert(featureLimit('career-sim', 'free') === 1 && featureLimit('career-sim', 'premium') === null,
  '§4: career sims are 1/month on free, unlimited paid (they were fully ungated)');
assert(featureLimit('opportunity-search', 'free') === 1, '§4: one grounded opportunity search a week on free');
assert(featureLimit('resume-draft', 'free') === 1, '§4: one whole-resume AI draft a month on free');
assert(featureLimit('resume-tailor', 'free') === 1, '§4: AI tailoring is a one-off lifetime taste on free');
assert(FEATURE_LIMITS['mock-interview'].keyPrefix === 'mockivday', 'live KV prefix preserved (no allowance reset)');
assert(FEATURE_LIMITS['roadmap-generate'].keyPrefix === 'roadmapgen', 'live KV prefix preserved');
assert(upgradeHelps('marco-chat', 'free') && !upgradeHelps('mock-interview', 'premium'),
  'upgradeHelps is true only when a higher plan actually gets more');

console.log('reset windows and key shapes:');
{
  const T = Date.parse('2026-07-19T23:00:00Z'); // a Sunday — the hard case for weeks
  assert(featureKvKey('marco-chat', 'A@B.com', T) === 'marcochatday:a@b.com:2026-07-19',
    'day-scoped key is lowercased and UTC-day stamped');
  assert(featureKvKey('roadmap-generate', 'a@b.com', T) === 'roadmapgen:a@b.com:2026-07',
    'month-scoped key carries YYYY-MM');
  assert(featureKvKey('opportunity-search', 'a@b.com', T) === 'oppsearchwk:a@b.com:2026-07-13',
    'week-scoped key names the UTC MONDAY — Sunday belongs to the week that started six days earlier');
  assert(featureKvKey('opportunity-search', 'a@b.com', Date.parse('2026-07-20T00:00:00Z')) === 'oppsearchwk:a@b.com:2026-07-20',
    'the next Monday opens a new week key');
  assert(featureKvKey('resume-tailor', 'a@b.com', T) === 'rtailorlife:a@b.com',
    'lifetime-scoped key carries no window segment');
  // §4's only per-plan window: the free taste never resets, the paid cap is daily.
  assert(resetPeriodFor('mock-interview', 'free') === 'lifetime'
    && resetPeriodFor('mock-interview', 'premium') === 'day',
    'mock-interview resolves a DIFFERENT window per plan');
  assert(featureKvKey('mock-interview', 'a@b.com', T, 'free') === 'mockivday:a@b.com',
    "the free taste keys on the undated form");
  assert(featureKvKey('mock-interview', 'a@b.com', T, 'premium') === 'mockivday:a@b.com:2026-07-19',
    'premium keeps the live dated counter — the two can never collide');
}

console.log('checkFeatureLimit (daily counter):');
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  let last;
  for (let i = 0; i < 10; i++) last = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'free' });
  assert(last.ok && last.used === 10 && last.remaining === 0, 'free user spends exactly 10 Marco messages');
  const eleventh = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'free' });
  assert(!eleventh.ok && eleventh.upgrade && /Flight Plan/.test(eleventh.message), '11th message blocked with an upgrade nudge');
  assert(kv.ttls.get(featureKvKey('marco-chat', 'a@b.com')) === 60 * 60 * 26, 'daily counter carries the 26h TTL');
  const prem = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'premium' });
  assert(prem.ok && prem.unlimited && prem.remaining === null, 'premium Marco is unlimited and never touches KV');
}
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const peek = await checkFeatureLimit(env, 'a@b.com', 'marco-chat', { plan: 'free', spend: false });
  assert(peek.ok && peek.remaining === 10 && kv.map.size === 0, 'spend:false peeks without writing a counter');
}
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const first = await checkFeatureLimit(env, 'a@b.com', 'roadmap-generate', { plan: 'free' });
  const second = await checkFeatureLimit(env, 'a@b.com', 'roadmap-generate', { plan: 'free' });
  assert(first.ok && !second.ok && second.upgrade, 'one free roadmap generation a month, then upgrade required');
  assert(first.resetPeriod === 'month', 'the roadmap allowance reports its window to the caller');
  assert(kv.ttls.get(featureKvKey('roadmap-generate', 'a@b.com')) === 60 * 60 * 24 * 32,
    'month counter TTL outlives the longest month it can be written into');
  // §4 "1 active + 1 regen/month" — the SAME allowance next month, not a
  // lifetime wall. This is the assertion the whole re-tier exists for.
  const nextMonth = await checkFeatureLimit(env, 'a@b.com', 'roadmap-generate', {
    plan: 'free', now: Date.now() + 40 * 864e5,
  });
  assert(nextMonth.ok, 'the free roadmap allowance reopens next month');
  const prem = await checkFeatureLimit(env, 'a@b.com', 'roadmap-generate', { plan: 'premium' });
  assert(prem.ok && prem.unlimited, 'premium regenerates the roadmap freely');
}
{
  // §4's weekly window, and the refund that protects it. A search that returned
  // nothing must not cost the student their week.
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const monday = Date.parse('2026-07-20T09:00:00Z');
  const first = await checkFeatureLimit(env, 'a@b.com', 'opportunity-search', { plan: 'free', now: monday });
  assert(first.ok && first.resetPeriod === 'week', 'one grounded search a week on free');
  const again = await checkFeatureLimit(env, 'a@b.com', 'opportunity-search', { plan: 'free', now: monday + 3 * 864e5 });
  assert(!again.ok, 'a second search the same week is refused');
  await refundFeatureUse(env, 'a@b.com', 'opportunity-search', { plan: 'free', now: monday + 3 * 864e5 });
  const refunded = await checkFeatureLimit(env, 'a@b.com', 'opportunity-search', { plan: 'free', now: monday + 3 * 864e5 });
  assert(refunded.ok, 'a refund inside the same week hands the search back');
  const nextWeek = await checkFeatureLimit(env, 'a@b.com', 'opportunity-search', { plan: 'free', now: monday + 7 * 864e5 });
  assert(nextWeek.ok, 'the window reopens the following Monday');
  assert(kv.ttls.get(featureKvKey('opportunity-search', 'a@b.com', monday)) === 60 * 60 * 24 * 8,
    'week counter carries the 8-day TTL');
}
{
  // WS-D D3: the free tier gets one proactive thread card a day. This is a cap
  // on interruption, not on a feature, so exhausting it must stay silent —
  // never an upgrade nag mid-conversation.
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const first = await checkFeatureLimit(env, 'a@b.com', 'marco-thread', { plan: 'free' });
  await checkFeatureLimit(env, 'a@b.com', 'marco-thread', { plan: 'free' });
  const third = await checkFeatureLimit(env, 'a@b.com', 'marco-thread', { plan: 'free' });
  assert(first.ok && !third.ok, 'two free Marco thread cards per day');
  assert(kv.ttls.get(featureKvKey('marco-thread', 'a@b.com')) === 60 * 60 * 26,
    'thread counter is day-scoped with the 26h TTL');
  const prem = await checkFeatureLimit(env, 'a@b.com', 'marco-thread', { plan: 'premium' });
  assert(prem.ok && prem.unlimited, 'paid plans are not rationed on topic suggestions');
}
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  // §4's per-plan window in action: the free taste is spent ONCE, ever, while
  // premium's daily counter is a separate key that the taste cannot touch.
  const free = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', { plan: 'free' });
  assert(free.ok && free.remaining === 0 && free.resetPeriod === 'lifetime', 'free gets one mock interview, ever');
  const free2 = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', { plan: 'free' });
  assert(!free2.ok && free2.upgrade, 'the second is refused with an upgrade nudge');
  const nextMonth = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', {
    plan: 'free', now: Date.now() + 400 * 864e5,
  });
  assert(!nextMonth.ok, 'a lifetime taste never reopens, not even a year later');
  let last;
  for (let i = 0; i < 3; i++) last = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', { plan: 'premium' });
  const fourth = await checkFeatureLimit(env, 'a@b.com', 'mock-interview', { plan: 'premium' });
  assert(last.ok && !fourth.ok, 'premium still capped at 3 mock interviews/day (pre-existing behaviour preserved)');
  assert(!fourth.upgrade && /tomorrow/.test(fourth.message), 'top-plan exhaustion says come back tomorrow, not upgrade');
  assert(/1 free mock interview\b/.test(free2.message),
    'a cap of 1 states the SINGULAR label — "1 free mock interview sessions" reads like a bug');
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
  assert(lapsed.ok && lapsed.plan === 'free' && lapsed.remaining === 9, 'lapsed Sprint falls back to free caps');
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
  assert(free['marco-chat'] === 10 && free['roadmap-generate'] === 1 && free['mock-interview'] === 1,
    'free counters reported for every metered feature');
  assert(free['career-sim'] === 1 && free['opportunity-search'] === 1
    && free['resume-draft'] === 1 && free['resume-tailor'] === 1,
    'every §4 row S8 added reports its allowance to the client');
  const prem = await remainingForUser(env, 'a@b.com', 'premium');
  assert(prem['marco-chat'] === null && prem['mock-interview'] === 3, 'null means unlimited on this plan');
  assert(prem['career-sim'] === null && prem['opportunity-search'] === null
    && prem['resume-draft'] === null && prem['resume-tailor'] === null,
    'paying accounts are uncapped on every newly-metered tool');
  const dev = await remainingForUser(devEnv(ON), 'dev@flightway.ai');
  assert(Object.values(dev).every((v) => v === null), 'dev tester reports unlimited everywhere');
}

// ---------------------------------------------------------------- WS-G public cap table
console.log('publicFeatureLimits (served on /config):');
{
  const pub = publicFeatureLimits();
  assert(Object.keys(pub).length === Object.keys(FEATURE_LIMITS).length,
    'every metered feature is published — a new cap cannot stay invisible to the UI');
  assert(Object.keys(pub).every((k) => pub[k].label && pub[k].resetPeriod),
    'each entry carries the label and reset period the UI has to render');
  assert(Object.keys(pub).every((k) => pub[k].keyPrefix === undefined),
    'the KV key prefix is never published');
  // §4's per-plan window has to survive the trip: a client told 'day' for a
  // free mock-interview taste would promise the student it comes back tomorrow.
  assert(typeof pub['mock-interview'].resetPeriod === 'object'
    && pub['mock-interview'].resetPeriod.free === 'lifetime'
    && pub['mock-interview'].resetPeriod.premium === 'day',
    'a per-plan reset window is published as the map, not flattened to one value');
  assert(pub['career-sim'].one === 'career simulation' && pub['mock-interview'].one === 'mock interview',
    'the singular label ships too — every §4 taste is a cap of 1');
  assert(Object.keys(pub).every((k) => Object.keys(pub[k].limits)
    .every((p) => pub[k].limits[p] === featureLimit(k, p))),
    'published caps are the enforced caps, plan for plan (no drift possible)');
  pub['marco-chat'].limits.free = 999;
  assert(featureLimit('marco-chat', 'free') === 10, 'the published table is a copy — mutating it cannot loosen a real cap');
}

// The numbers WS-G's UI copy quotes. These assertions exist so retuning a cap
// fails HERE, loudly, instead of silently making pricing.html lie.
console.log('UI-facing caps (WS-G surfaces quote these):');
{
  assert(featureLimit('marco-chat', 'free') === 10, 'free Marco messages a day = 10');
  assert(featureLimit('marco-chat', 'premium') === null, 'Flight Plan Marco is unlimited');
  assert(featureLimit('roadmap-generate', 'free') === 1, 'free AI roadmap generations = 1 (a month)');
  assert(featureLimit('mock-interview', 'free') === 1, 'free mock interviews = 1 (a lifetime taste)');
  assert(featureLimit('mock-interview', 'premium') === 3, 'Flight Plan mock interviews = 3 a day, not unlimited');
  assert(featureLimit('career-sim', 'free') === 1, 'free career simulations = 1 a month');
  assert(featureLimit('opportunity-search', 'free') === 1, 'free opportunity searches = 1 a week');
  assert(featureLimit('resume-draft', 'free') === 1, 'free AI resume drafts = 1 a month');
  assert(featureLimit('resume-tailor', 'free') === 1, 'free AI resume tailorings = 1 (a lifetime taste)');
}


// ------------------------------------------------- §5 refunds: our faults are free
// A turn that fails server-side must not charge the user. This is not a
// nicety: while Marco was throwing a ReferenceError on every request, each
// retry still spent one of ten hourly attempts, so fixing the crash surfaced a
// rate limit instead of a reply. The spend stays up front (abuse control); the
// refund is what makes a failure cost the user nothing.
console.log('failure refunds:');
{
  const kv = fakeKv();
  const env = { ...ON, COACH_KV: kv };
  const EMAIL = 'refund@x.com';

  for (let i = 0; i < 3; i++) await checkFeatureLimit(env, EMAIL, 'marco-chat', { plan: 'free' });
  await refundFeatureUse(env, EMAIL, 'marco-chat', { plan: 'free' });
  const after = await checkFeatureLimit(env, EMAIL, 'marco-chat', { spend: false, plan: 'free' });
  assert(after.used === 2, 'a refunded Marco message goes back on the daily counter');
  assert(kv.ttls.get(featureKvKey('marco-chat', EMAIL)) === 60 * 60 * 26,
    'a refund preserves the daily TTL — it must not turn a day counter into a permanent one');

  // Never below zero, and never throws on a counter that was never spent.
  const fresh = fakeKv();
  await refundFeatureUse({ ...ON, COACH_KV: fresh }, 'nobody@x.com', 'marco-chat', { plan: 'free' });
  const zeroed = await checkFeatureLimit({ ...ON, COACH_KV: fresh }, 'nobody@x.com', 'marco-chat', { spend: false, plan: 'free' });
  assert(zeroed.used === 0, 'refunding an unspent counter cannot drive it negative');

  // Unlimited plans counted nothing, so there is nothing to give back.
  const premKv = fakeKv();
  await refundFeatureUse({ ...ON, COACH_KV: premKv }, EMAIL, 'marco-chat', { plan: 'premium' });
  assert(premKv.map.size === 0, 'an unlimited plan writes no counter on refund');

  // A refund must never throw — a failing refund inside a catch would turn a
  // handled error into an unhandled one.
  let threw = false;
  try { await refundFeatureUse({ ...ON, COACH_KV: null }, EMAIL, 'marco-chat', { plan: 'free' }); } catch { threw = true; }
  try { await refundRateLimit({ COACH_KV: null }, 'chat:x'); } catch { threw = true; }
  assert(!threw, 'refunds swallow their own failures');
}

console.log('chat rate-limit ceiling:');
{
  const kv = fakeKv();
  const env = { COACH_KV: kv };
  assert(RATE_LIMIT_CHAT_MAX > RATE_LIMIT_MAX,
    'conversation gets its own ceiling, not the login-attempt default');
  assert(RATE_LIMIT_CHAT_MAX >= 40,
    'the ceiling clears a real conversation — the business cap is marco-chat, not this');

  // Spend to the ceiling, confirm it blocks, refund one, confirm it opens again.
  for (let i = 0; i < RATE_LIMIT_CHAT_MAX; i++) {
    await checkRateLimit(env, 'chat:a@b.com', { max: RATE_LIMIT_CHAT_MAX });
  }
  let blocked = false;
  try { await checkRateLimit(env, 'chat:a@b.com', { max: RATE_LIMIT_CHAT_MAX }); }
  catch (e) { blocked = e.status === 429; }
  assert(blocked, 'the ceiling still blocks once genuinely reached');
  await refundRateLimit(env, 'chat:a@b.com');
  let openedAgain = true;
  try { await checkRateLimit(env, 'chat:a@b.com', { max: RATE_LIMIT_CHAT_MAX }); }
  catch { openedAgain = false; }
  assert(openedAgain, 'one refunded attempt lets the next real message through');
}

process.exit(fail ? 1 : 0);
