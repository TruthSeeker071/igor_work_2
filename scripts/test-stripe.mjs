// FlightWay — Stripe money-path invariants (free/paid merge §6).
//   run: npm run stripe:check
//
// Covers the two things a bug would cost real money or real trust:
//   1. webhook signature verification (forged / tampered / stale / rolled secret)
//   2. what each SKU grants, incl. the never-shorten rule and idempotent replay
// No network and no D1 — the Stripe API is stubbed and D1 is an in-memory fake.

import {
  formEncode, verifyWebhookSignature, signWebhookPayload,
  sprintGrant, subscriptionGrant, lifetimeGrant,
  SKUS, SPRINT_DAYS, TRIAL_DAYS, RENEWAL_GRACE_DAYS,
  stripeConfigured, stripeTestMode, priceIdFor,
} from '../functions/_lib/stripe.js';
import { onRequestPost as webhookPost } from '../functions/stripe/webhook.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };
const SECRET = 'whsec_test_flightway_secret';
const DAY = 86400000;

console.log('form encoding:');
assert(formEncode({ mode: 'payment', metadata: { email: 'a@b.com' } })
  === 'mode=payment&metadata%5Bemail%5D=a%40b.com', 'nested objects use Stripe bracket notation');
assert(formEncode({ line_items: [{ price: 'price_1', quantity: 1 }] })
  === 'line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1', 'arrays are indexed');
assert(formEncode({ a: 1, b: null, c: undefined }) === 'a=1', 'null/undefined are omitted');

console.log('SKU config:');
assert(Object.keys(SKUS).join(',') === 'monthly,annual,lifetime,sprint', 'the four pricing.html data-tier values');
assert(SKUS.monthly.mode === 'subscription' && SKUS.lifetime.mode === 'payment', 'recurring vs one-time modes');
assert(SKUS.monthly.trialDays === 14 && SKUS.annual.trialDays === 14, '14-day trial on both subscription cadences (§9)');
assert(SPRINT_DAYS === 14 && TRIAL_DAYS === 14, 'Sprint and trial are both 14 days (§9)');
assert(!SKUS.lifetime.trialDays && !SKUS.sprint.trialDays, 'one-time SKUs never carry a trial');
assert(stripeConfigured({ STRIPE_SECRET_KEY: 'sk_test_x' }) && !stripeConfigured({}), 'stripeConfigured reads the key');
assert(stripeTestMode({ STRIPE_SECRET_KEY: 'sk_test_x' }) && !stripeTestMode({ STRIPE_SECRET_KEY: 'sk_live_x' }),
  'test-mode detection distinguishes sk_test_ from sk_live_');
assert(priceIdFor({ STRIPE_PRICE_SPRINT: 'price_s' }, 'sprint') === 'price_s' && priceIdFor({}, 'nope') === '',
  'price ids come from per-SKU env vars');

console.log('webhook signature (Web Crypto, no SDK):');
{
  const body = JSON.stringify({ id: 'evt_1', type: 'x' });
  const nowSec = Math.floor(Date.now() / 1000);
  const header = await signWebhookPayload(body, SECRET, nowSec);
  assert((await verifyWebhookSignature(body, header, SECRET, { nowSec })).ok, 'a genuine signature verifies');
  assert(!(await verifyWebhookSignature(body + ' ', header, SECRET, { nowSec })).ok, 'a tampered body is rejected');
  assert((await verifyWebhookSignature(body, header, 'whsec_wrong', { nowSec })).reason === 'signature',
    'the wrong endpoint secret is rejected');
  assert((await verifyWebhookSignature(body, header, SECRET, { nowSec: nowSec + 600 })).reason === 'timestamp',
    'a replayed request outside the 5-minute tolerance is rejected');
  assert((await verifyWebhookSignature(body, 't=1', SECRET, { nowSec })).reason === 'malformed',
    'a header with no v1 is rejected');
  assert((await verifyWebhookSignature(body, '', SECRET, { nowSec })).reason === 'missing', 'no header → rejected');
  const rolled = `${header},v1=${'0'.repeat(64)}`;
  assert((await verifyWebhookSignature(body, rolled, SECRET, { nowSec })).ok,
    'during a secret roll, any one matching v1 is enough');
}

console.log('grants — what each SKU buys:');
{
  const now = Date.parse('2026-07-19T00:00:00Z');
  assert(lifetimeGrant().plan === 'lifetime' && lifetimeGrant().expiresAt === null, 'lifetime never expires');

  const s = sprintGrant('free', null, now);
  assert(s.plan === 'premium' && Date.parse(s.expiresAt) === now + 14 * DAY,
    'Sprint = 14 days of premium on the existing columns (no new dimension)');
  assert(sprintGrant('lifetime', null, now).skip, 'Sprint never demotes a lifetime holder');
  assert(sprintGrant('premium', null, now).skip, 'Sprint never shortens an open-ended premium (beta grant)');
  assert(sprintGrant('premium', new Date(now + 60 * DAY).toISOString(), now).skip,
    'Sprint never shortens a longer runway');
  const extend = sprintGrant('premium', new Date(now + 3 * DAY).toISOString(), now);
  assert(extend.plan === 'premium' && Date.parse(extend.expiresAt) === now + 14 * DAY,
    'Sprint does extend a shorter runway');

  const end = Math.floor((now + 30 * DAY) / 1000);
  const active = subscriptionGrant({ status: 'active', current_period_end: end }, 'free');
  assert(active.plan === 'premium'
    && Date.parse(active.expiresAt) === end * 1000 + RENEWAL_GRACE_DAYS * DAY,
    'an active subscription grants premium through period end + a renewal grace window');
  assert(subscriptionGrant({ status: 'trialing', current_period_end: end }, 'free').plan === 'premium',
    'a trialing subscription is premium (the free trial actually works)');
  assert(subscriptionGrant({ status: 'past_due', current_period_end: end }, 'premium').plan === 'premium',
    'past_due does NOT downgrade — Stripe dunning retries first (§3)');
  assert(subscriptionGrant({ status: 'canceled' }, 'premium').plan === 'free', 'canceled downgrades to free');
  assert(subscriptionGrant({ status: 'unpaid' }, 'premium').plan === 'free', 'unpaid downgrades to free');
  assert(subscriptionGrant({ status: 'canceled' }, 'lifetime').skip, 'a lifetime holder is never downgraded');
}

// ---------------------------------------------------------- webhook end-to-end
function fakeDb(seedUsers = []) {
  const users = new Map(seedUsers.map((u) => [u.email, { plan: 'free', plan_expires_at: null, plan_source: null, stripe_customer_id: null, ...u }]));
  const events = new Map();
  return {
    users,
    events,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            async first() {
              if (/FROM users WHERE stripe_customer_id/.test(sql)) {
                for (const u of users.values()) if (u.stripe_customer_id === a[0]) return u;
                return null;
              }
              if (/FROM users WHERE email/.test(sql)) return users.get(a[0]) || null;
              return null;
            },
            async run() {
              if (/INSERT OR IGNORE INTO stripe_events/.test(sql)) {
                if (events.has(a[0])) return { meta: { changes: 0 } };
                events.set(a[0], a[1]);
                return { meta: { changes: 1 } };
              }
              if (/DELETE FROM stripe_events/.test(sql)) { events.delete(a[0]); return { meta: { changes: 1 } }; }
              if (/UPDATE users SET stripe_customer_id/.test(sql)) {
                const u = users.get(a[1]); if (u) u.stripe_customer_id = a[0];
                return { meta: { changes: u ? 1 : 0 } };
              }
              // Since migration 0016 the bind order is (plan, expiry, source, email),
              // and the downgrade variant carries the comp guard in its WHERE.
              if (/UPDATE users SET plan =/.test(sql)) {
                const u = users.get(a[3]);
                if (u && /!= 'comp'/.test(sql) && u.plan_source === 'comp') return { meta: { changes: 0 } };
                if (u) { u.plan = a[0]; u.plan_expires_at = a[1]; u.plan_source = a[2]; }
                return { meta: { changes: u ? 1 : 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

async function deliver(env, event, opts = {}) {
  const raw = JSON.stringify(event);
  const sig = opts.badSignature
    ? await signWebhookPayload(raw, 'whsec_someone_else')
    : await signWebhookPayload(raw, SECRET);
  const request = new Request('https://flightwayjacobprototype.pages.dev/stripe/webhook', {
    method: 'POST', body: raw, headers: { 'Stripe-Signature': sig, 'Content-Type': 'application/json' },
  });
  const res = await webhookPost({ request, env });
  return { status: res.status, body: await res.json() };
}

const checkoutEvent = (id, mode, tier, extra = {}) => ({
  id, type: 'checkout.session.completed',
  data: { object: { id: 'cs_' + id, mode, payment_status: 'paid', customer: 'cus_1', metadata: { email: 'buyer@x.com', tier }, ...extra } },
});

console.log('webhook end-to-end (fake D1, stubbed Stripe API):');
{
  const baseEnv = () => ({ STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_test_x', DB: fakeDb([{ email: 'buyer@x.com' }]) });

  const forged = await deliver(baseEnv(), checkoutEvent('evt_forged', 'payment', 'lifetime'), { badSignature: true });
  assert(forged.status === 400, 'a forged signature is rejected before any DB write');

  const envL = baseEnv();
  const lt = await deliver(envL, checkoutEvent('evt_lt', 'payment', 'lifetime'));
  const buyerL = envL.DB.users.get('buyer@x.com');
  assert(lt.status === 200 && buyerL.plan === 'lifetime' && buyerL.plan_expires_at === null, 'lifetime SKU → plan=lifetime, no expiry');
  assert(buyerL.stripe_customer_id === 'cus_1', 'the Stripe customer id is recorded for the portal link');

  const envS = baseEnv();
  const sp = await deliver(envS, checkoutEvent('evt_sp', 'payment', 'sprint'));
  const buyerS = envS.DB.users.get('buyer@x.com');
  const days = Math.round((Date.parse(buyerS.plan_expires_at) - Date.now()) / DAY);
  assert(sp.status === 200 && buyerS.plan === 'premium' && days === SPRINT_DAYS, 'sprint SKU → premium for 14 days');

  // Replay: Stripe delivers at least once, so the same event id must be a no-op.
  const replay = await deliver(envS, checkoutEvent('evt_sp', 'payment', 'sprint'));
  assert(replay.status === 200 && replay.body.duplicate === true, 'a replayed event id no-ops');

  // Never-shorten, delivered as a real event: a lifetime holder buys a Sprint.
  const envLS = { ...baseEnv(), DB: fakeDb([{ email: 'buyer@x.com', plan: 'lifetime' }]) };
  await deliver(envLS, checkoutEvent('evt_ls', 'payment', 'sprint'));
  const buyerLS = envLS.DB.users.get('buyer@x.com');
  assert(buyerLS.plan === 'lifetime', 'a Sprint bought by a lifetime holder does not demote them');

  // Subscription checkout: the handler retrieves the subscription for its real status.
  const periodEnd = Math.floor((Date.now() + 30 * DAY) / 1000);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/subscriptions/')) {
      return new Response(JSON.stringify({ id: 'sub_1', status: 'trialing', current_period_end: periodEnd }), { status: 200 });
    }
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const envSub = baseEnv();
    const sub = await deliver(envSub, checkoutEvent('evt_sub', 'subscription', 'monthly', { subscription: 'sub_1' }));
    const buyerSub = envSub.DB.users.get('buyer@x.com');
    assert(sub.status === 200 && buyerSub.plan === 'premium', 'subscription checkout → premium (while trialing)');
    assert(Date.parse(buyerSub.plan_expires_at) === periodEnd * 1000 + RENEWAL_GRACE_DAYS * DAY,
      'expiry tracks the trial/period end plus the grace window');

    // …and a later cancellation, resolved by customer id rather than metadata.
    const cancel = await deliver(envSub, {
      id: 'evt_cancel', type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: {} } },
    });
    assert(cancel.status === 200 && envSub.DB.users.get('buyer@x.com').plan === 'free',
      'subscription.deleted downgrades the user found via stripe_customer_id');
  } finally {
    globalThis.fetch = realFetch;
  }

  const ignored = await deliver(baseEnv(), { id: 'evt_ig', type: 'invoice.payment_failed', data: { object: {} } });
  assert(ignored.status === 200 && ignored.body.ignored === 'invoice.payment_failed',
    'invoice.payment_failed is acknowledged but never downgrades (§3)');
}

process.exit(fail ? 1 : 0);
