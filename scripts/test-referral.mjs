// test:referral — the S15 share + referral gate (plan §5 S15, D24).
//
// This one exists because the referral loop is the only path in the product
// where a bug MOVES MONEY. Everything else fails visibly (a page renders wrong,
// a generation returns nothing); a double-credit fails silently and in our
// favour-losing direction, and nobody finds out until a Stripe balance is
// wrong. So the four things asserted hardest are:
//
//   1. CODE INTEGRITY — a mistyped code never resolves to a different real user.
//   2. BIND-ONCE — a referee can be bound to exactly one referrer, ever, and a
//      self-referral is not a bind at all.
//   3. CREDIT IDEMPOTENCY — a webhook replay (Stripe delivers at-least-once)
//      issues exactly ONE Stripe balance transaction, and the claim happens in
//      D1 BEFORE Stripe is called.
//   4. GUARDS — unverified accounts, self-referral by customer or IP, and the
//      12-a-year ceiling each hold the credit at `converted` rather than paying.
//
// Plus the share half: the payload sanitizer is driven with hostile input,
// because the only thing standing between a crafted POST and arbitrary text on
// a flightway.ai page is that function.
//
// Run: npm run test:referral


import {
  MAX_CREDITS_PER_YEAR, REFERRAL_ALPHABET, REFERRAL_CODE_LEN, REFERRAL_COOKIE,
  bindReferral, creditDescription, creditReferrer, ensureReferralCode, generateReferralCode,
  normalizeReferralCode, readReferralCookie, referralCookieHeader, referralFlags, referralLink,
  referralStats, refereePromoFor, voidReferral,
} from '../functions/_lib/referral.js';
import {
  MAX_PNG_BYTES, SHARE_ID_LEN, TIER_LABELS, decodePngBase64, generateShareId, isShareId,
  sanitizeFirstName, sanitizeShareRequest, shareImageKey, shareImageUrl, sharePageHtml,
  shareMissingHtml,
} from '../functions/_lib/share.js';
import { onRequestGet as refRoute } from '../functions/r/[code].js';
import { onRequestGet as sharePage } from '../functions/s/[id].js';
import { onRequestGet as shareImg } from '../functions/s/img/[id].js';
import { onRequestGet as inviteRoute } from '../functions/invite.js';
import { onRequestGet as referralRoute } from '../functions/referral.js';
import {
  onRequestPost as shareCreate, onRequestDelete as shareRevoke, onRequestGet as shareList,
} from '../functions/share.js';

let fail = 0;
const ok = (c, m) => { if (c) console.log('  PASS', m); else { fail += 1; console.error('  FAIL', m); } };

const BASE = 'https://flightwayjacobprototype.pages.dev';
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// A small in-memory D1 over three tables. Purpose-built rather than generic:
// every SQL string this suite exercises is matched explicitly, so a query that
// CHANGES shape fails loudly here instead of silently answering "no rows" — the
// failure mode that makes a fake database worse than no test at all.

function makeDb(seed = {}) {
  const users = new Map(); // email -> row
  for (const u of seed.users || []) users.set(u.email, { ...u });
  let referrals = (seed.referrals || []).map((r) => ({ ...r }));
  const shares = new Map();
  for (const s of seed.shares || []) shares.set(s.id, { ...s });
  const log = [];

  function run(sql, b) {
    log.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80));
    const s = sql.replace(/\s+/g, ' ').trim();

    // ---- users
    if (/^SELECT referral_code FROM users WHERE email = \?$/.test(s)) {
      const u = users.get(b[0]);
      return { first: u ? { referral_code: u.referral_code || null } : null };
    }
    if (/^UPDATE users SET referral_code = \? WHERE email = \? AND referral_code IS NULL$/.test(s)) {
      const u = users.get(b[1]);
      if (!u || u.referral_code) return { changes: 0 };
      if ([...users.values()].some((x) => x.referral_code === b[0])) throw new Error('UNIQUE constraint failed');
      u.referral_code = b[0];
      return { changes: 1 };
    }
    if (/^SELECT email FROM users WHERE referral_code = \?$/.test(s)) {
      const u = [...users.values()].find((x) => x.referral_code === b[0]);
      return { first: u ? { email: u.email } : null };
    }
    if (/^SELECT email, verified_at, stripe_customer_id FROM users WHERE email = \?$/.test(s)) {
      const u = users.get(b[0]);
      return { first: u ? { email: u.email, verified_at: u.verified_at || null, stripe_customer_id: u.stripe_customer_id || null } : null };
    }
    if (/^SELECT stripe_customer_id FROM users WHERE email = \?$/.test(s)) {
      const u = users.get(b[0]);
      return { first: u ? { stripe_customer_id: u.stripe_customer_id || null } : null };
    }
    if (/^UPDATE users SET stripe_customer_id = \? WHERE email = \? AND stripe_customer_id IS NULL$/.test(s)) {
      const u = users.get(b[1]);
      if (!u || u.stripe_customer_id) return { changes: 0 };
      u.stripe_customer_id = b[0];
      return { changes: 1 };
    }
    if (/^SELECT verified_at FROM users WHERE email = \?$/.test(s)) {
      const u = users.get(b[0]);
      return { first: u ? { verified_at: u.verified_at || null } : null };
    }

    // ---- referrals
    if (/^INSERT OR IGNORE INTO referrals/.test(s)) {
      const [id, code, referrer, referee, ipHash, created] = [b[0], b[1], b[2], b[3], b[4], b[5]];
      if (referrals.some((r) => r.referee_id === referee)) return { changes: 0 }; // UNIQUE index
      referrals.push({
        id, code, referrer_id: referrer, referee_id: referee, status: 'signed_up',
        flags: null, signup_ip_hash: ipHash, credit_cents: null, created_at: created,
        converted_at: null, credited_at: null, voided_at: null, void_reason: null,
      });
      return { changes: 1 };
    }
    if (/^SELECT id, code, referrer_id, referee_id, status, signup_ip_hash FROM referrals WHERE referee_id = \?$/.test(s)) {
      return { first: referrals.find((r) => r.referee_id === b[0]) || null };
    }
    if (/^SELECT referee_id, status FROM referrals WHERE id = \?$/.test(s)) {
      return { first: referrals.find((r) => r.id === b[0]) || null };
    }
    if (/^UPDATE referrals SET status = 'converted', converted_at = \? WHERE id = \? AND status = 'signed_up'$/.test(s)) {
      const r = referrals.find((x) => x.id === b[1] && x.status === 'signed_up');
      if (!r) return { changes: 0 };
      r.status = 'converted'; r.converted_at = b[0];
      return { changes: 1 };
    }
    if (/^UPDATE referrals SET status = 'credited', credited_at = \?, credit_cents = \? WHERE id = \?$/.test(s)) {
      const r = referrals.find((x) => x.id === b[2]);
      if (!r) return { changes: 0 };
      r.status = 'credited'; r.credited_at = b[0]; r.credit_cents = b[1];
      return { changes: 1 };
    }
    if (/^UPDATE referrals SET flags = \? WHERE id = \?$/.test(s)) {
      const r = referrals.find((x) => x.id === b[1]);
      if (r) r.flags = b[0];
      return { changes: r ? 1 : 0 };
    }
    if (/^UPDATE referrals SET status = 'void'/.test(s)) {
      const r = referrals.find((x) => x.id === b[2] && x.status !== 'credited');
      if (!r) return { changes: 0 };
      r.status = 'void'; r.voided_at = b[0]; r.void_reason = b[1];
      return { changes: 1 };
    }
    if (/^SELECT COUNT\(\*\) AS n FROM referrals WHERE referrer_id = \? AND status = 'credited' AND credited_at >= \?$/.test(s)) {
      return { first: { n: referrals.filter((r) => r.referrer_id === b[0] && r.status === 'credited' && r.credited_at >= b[1]).length } };
    }
    if (/^SELECT COUNT\(\*\) AS n FROM referrals WHERE referrer_id = \? AND signup_ip_hash = \?$/.test(s)) {
      return { first: { n: referrals.filter((r) => r.referrer_id === b[0] && r.signup_ip_hash === b[1]).length } };
    }
    if (/^SELECT signup_ip_hash FROM referrals WHERE referee_id = \? LIMIT 1$/.test(s)) {
      const r = referrals.find((x) => x.referee_id === b[0]);
      return { first: r ? { signup_ip_hash: r.signup_ip_hash } : null };
    }
    if (/^SELECT id FROM referrals WHERE referee_id = \? AND status = 'signed_up' LIMIT 1$/.test(s)) {
      const r = referrals.find((x) => x.referee_id === b[0] && x.status === 'signed_up');
      return { first: r ? { id: r.id } : null };
    }
    if (/^SELECT status, COUNT\(\*\) AS n, COALESCE\(SUM\(credit_cents\), 0\) AS cents FROM referrals WHERE referrer_id = \? GROUP BY status$/.test(s)) {
      const mine = referrals.filter((r) => r.referrer_id === b[0]);
      const byStatus = new Map();
      for (const r of mine) {
        const cur = byStatus.get(r.status) || { status: r.status, n: 0, cents: 0 };
        cur.n += 1; cur.cents += Number(r.credit_cents || 0);
        byStatus.set(r.status, cur);
      }
      return { results: [...byStatus.values()] };
    }

    // ---- shares
    if (/^SELECT COUNT\(\*\) AS n FROM shares WHERE user_id = \? AND revoked_at IS NULL$/.test(s)) {
      return { first: { n: [...shares.values()].filter((x) => x.user_id === b[0] && !x.revoked_at).length } };
    }
    if (/^INSERT INTO shares/.test(s)) {
      shares.set(b[0], {
        id: b[0], user_id: b[1], payload: b[2], img_key: b[3], views: 0, created_at: b[4], revoked_at: null,
      });
      return { changes: 1 };
    }
    if (/^SELECT id, user_id, payload, img_key, revoked_at FROM shares WHERE id = \?$/.test(s)) {
      return { first: shares.get(b[0]) || null };
    }
    if (/^SELECT user_id, img_key, revoked_at FROM shares WHERE id = \?$/.test(s)) {
      const x = shares.get(b[0]);
      return { first: x ? { user_id: x.user_id, img_key: x.img_key, revoked_at: x.revoked_at } : null };
    }
    if (/^SELECT id, payload, img_key, views, created_at FROM shares WHERE user_id = \? AND revoked_at IS NULL/.test(s)) {
      return { results: [...shares.values()].filter((x) => x.user_id === b[0] && !x.revoked_at) };
    }
    if (/^UPDATE shares SET revoked_at = \? WHERE id = \? AND user_id = \? AND revoked_at IS NULL$/.test(s)) {
      const x = shares.get(b[1]);
      if (!x || x.user_id !== b[2] || x.revoked_at) return { changes: 0 };
      x.revoked_at = b[0];
      return { changes: 1 };
    }
    if (/^UPDATE shares SET views = views \+ 1 WHERE id = \?$/.test(s)) {
      const x = shares.get(b[0]);
      if (x) x.views += 1;
      return { changes: x ? 1 : 0 };
    }

    // ---- catalog + sessions + analytics
    if (/^SELECT soc, title FROM onet_careers WHERE soc IN/.test(s)) {
      return { results: b.filter((soc) => (seed.titles || {})[soc]).map((soc) => ({ soc, title: seed.titles[soc] })) };
    }
    if (/^SELECT soc, title FROM derived_careers WHERE soc IN/.test(s)) return { results: [] };
    if (/^INSERT INTO events/i.test(s)) return { changes: 1 };
    if (/FROM sessions/i.test(s)) return { first: { email: seed.sessionEmail || null } };

    throw new Error(`fakeDb: unhandled SQL -> ${s.slice(0, 120)}`);
  }

  return {
    users, shares, log,
    get referrals() { return referrals; },
    set referrals(v) { referrals = v; },
    prepare(sql) {
      const st = {
        bind: (...b) => ({
          first: async () => (run(sql, b).first ?? null),
          all: async () => ({ results: run(sql, b).results || [] }),
          run: async () => ({ meta: { changes: run(sql, b).changes || 0 } }),
        }),
        first: async () => (run(sql, []).first ?? null),
        all: async () => ({ results: run(sql, []).results || [] }),
        run: async () => ({ meta: { changes: run(sql, []).changes || 0 } }),
      };
      return st;
    },
    async batch(list) { const out = []; for (const s of list || []) out.push(await s.run()); return out; },
  };
}

function makeKv() {
  const map = new Map();
  return {
    map,
    get: async (k, type) => {
      if (!map.has(k)) return null;
      const v = map.get(k);
      if (type === 'json') return JSON.parse(v);
      if (type === 'arrayBuffer') return v instanceof Uint8Array ? v.buffer : v;
      return v;
    },
    put: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
    list: async () => ({ keys: [], list_complete: true }),
  };
}

/** Stripe, faked at the fetch boundary. Records every call so "exactly one
 *  balance transaction" is a countable assertion rather than a hopeful one. */
function withStripe(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? String(init.body) : '', idem: init && init.headers && init.headers['Idempotency-Key'] });
    const res = await handler(String(url), init, calls);
    return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = real; });
}

const stripeOk = (url) => {
  if (/\/prices\//.test(url)) return { body: { id: 'price_x', unit_amount: 1200, currency: 'usd' } };
  if (/\/customers\/[^/]+\/balance_transactions$/.test(url)) return { body: { id: 'cbtxn_1', amount: -1200 } };
  if (/\/customers$/.test(url)) return { body: { id: 'cus_new' } };
  return { body: {} };
};

const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_MONTHLY_TEST: 'price_x' };

/**
 * `waitUntil` work is where the view counter and the analytics rows live, so a
 * fake that drops the promise would make every "it was counted" assertion pass
 * vacuously. These are collected and drained by settle() instead.
 */
const pending = [];
const settle = () => Promise.all(pending.splice(0)).catch(() => {});

/**
 * A real browser always sends a User-Agent, and `classifyUa()` deliberately
 * calls a MISSING one a bot ("no UA at all is a script, not a student"). A
 * fetch-API Request built in Node has none, so without this default every
 * "a human was counted" assertion would silently test the crawler path.
 */
const HUMAN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function ctx({ url, method = 'GET', body, headers = {}, env = {}, params = {} }) {
  const init = { method, headers: { 'User-Agent': HUMAN_UA, ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  return {
    request: new Request(url, init),
    env,
    params,
    waitUntil: (p) => { pending.push(Promise.resolve(p)); },
  };
}

// ===========================================================================
console.log('code integrity:');

{
  const seen = new Set();
  let shaped = true;
  for (let i = 0; i < 3000; i += 1) {
    const c = generateReferralCode();
    if (c.length !== REFERRAL_CODE_LEN || [...c].some((ch) => !REFERRAL_ALPHABET.includes(ch))) shaped = false;
    seen.add(c);
  }
  ok(shaped, `3000 generated codes are ${REFERRAL_CODE_LEN} chars from the alphabet`);
  ok(seen.size >= 2995, `and near-unique across 3000 draws (${seen.size})`);
  ok(!/[01ILO]/.test(REFERRAL_ALPHABET), 'the alphabet excludes 0/1/I/L/O — the characters people mistype');
}

{
  const code = generateReferralCode();
  ok(normalizeReferralCode(code.toLowerCase()) === code, 'lowercase input normalizes to the real code');
  ok(normalizeReferralCode(`fw-${code.slice(0, 3)} ${code.slice(3)}`.replace('fw-', '')) === code,
    'separators people add on their own are stripped');
  ok(normalizeReferralCode('') === '', 'empty is not a code');
  ok(normalizeReferralCode(`${code}X`) === '', 'a too-long string is not a code');
  ok(normalizeReferralCode(code.slice(0, 6)) === '', 'a too-short string is not a code');
  // The load-bearing one: no look-alike repair. Repairing an O into a 0 (or an
  // I into a 1) would resolve a TYPO to a different real user's code.
  const withO = `O${code.slice(1)}`;
  ok(normalizeReferralCode(withO) === '', 'a code containing an excluded look-alike is rejected, never "repaired"');
  ok(normalizeReferralCode('<script>') === '', 'markup is not a code');
}

ok(referralLink('https://x.dev/', 'ABC2345') === 'https://x.dev/r/ABC2345', 'referralLink builds an absolute /r/ url');
ok(referralCookieHeader('ABC2345').includes('HttpOnly')
  && referralCookieHeader('ABC2345').includes('SameSite=Lax')
  && referralCookieHeader('ABC2345').includes('Secure'),
'the referral cookie is HttpOnly + SameSite=Lax + Secure');
{
  const req = new Request(BASE, { headers: { Cookie: `${REFERRAL_COOKIE}=ABC2345; other=1` } });
  ok(readReferralCookie(req) === 'ABC2345', 'the cookie round-trips through readReferralCookie');
  ok(readReferralCookie(new Request(BASE, { headers: { Cookie: `${REFERRAL_COOKIE}=nope` } })) === '',
    'a malformed cookie value reads as no code, not as a partial one');
}
ok(creditDescription('alex@school.edu').includes('alex') && !creditDescription('alex@school.edu').includes('@'),
  'the Stripe credit description names the referee without carrying their full address');

// ===========================================================================
console.log('\nfraud guards (pure):');

const GOOD = {
  referrerEmail: 'a@x.com', refereeEmail: 'b@x.com',
  referrerVerified: true, refereeVerified: true,
  referrerCustomerId: 'cus_a', refereeCustomerId: 'cus_b',
  refereeIpHash: 'ip-b', referrerSignupIpHash: 'ip-a',
  sameIpReferralCount: 0, creditsThisYear: 0, maxCreditsPerYear: MAX_CREDITS_PER_YEAR,
};
ok(referralFlags(GOOD).ok, 'a clean referral passes every guard');
ok(referralFlags({ ...GOOD, refereeEmail: 'A@X.com' }).blocking.includes('self_email'),
  'self-referral by email is blocked, case-insensitively');
ok(referralFlags({ ...GOOD, refereeCustomerId: 'cus_a' }).blocking.includes('self_customer'),
  'self-referral by Stripe customer is blocked');
ok(referralFlags({ ...GOOD, refereeIpHash: 'ip-a' }).blocking.includes('self_ip'),
  'a referee signing up from the referrer’s own signup IP hash is blocked');
ok(!referralFlags({ ...GOOD, refereeIpHash: '', referrerSignupIpHash: '' }).blocking.includes('self_ip'),
  'two MISSING ip hashes are not "the same ip" (the empty-equals-empty trap)');
ok(referralFlags({ ...GOOD, referrerVerified: false }).blocking.includes('referrer_unverified'),
  'an unverified referrer cannot be credited (D24)');
ok(referralFlags({ ...GOOD, refereeVerified: false }).blocking.includes('referee_unverified'),
  'an unverified referee cannot trigger a credit (D24)');
ok(referralFlags({ ...GOOD, creditsThisYear: MAX_CREDITS_PER_YEAR }).blocking.includes('credit_cap'),
  `the ${MAX_CREDITS_PER_YEAR}-a-year ceiling holds`);
ok(referralFlags({ ...GOOD, creditsThisYear: MAX_CREDITS_PER_YEAR - 1 }).ok,
  'and the credit one BELOW the ceiling still pays (an off-by-one here costs a real advocate a month)');
{
  const v = referralFlags({ ...GOOD, sameIpReferralCount: 3 });
  ok(v.ok && v.warning.includes('ip_cluster'),
    'an IP cluster is a WARNING, not a block — a shared campus network must not punish honest invites');
}

// ===========================================================================
console.log('\nbind-once:');

await (async () => {
  const db = makeDb({ users: [{ email: 'ref@x.com', referral_code: 'AAA2345', verified_at: nowIso() }, { email: 'new@x.com' }] });
  const env = { DB: db };

  const first = await bindReferral(env, { code: 'AAA2345', refereeEmail: 'new@x.com', ipHash: 'ip1' });
  ok(first.bound === true && first.referrer === 'ref@x.com', 'a valid code binds the signup');

  const again = await bindReferral(env, { code: 'AAA2345', refereeEmail: 'new@x.com', ipHash: 'ip1' });
  ok(again.bound === false && again.reason === 'already_bound',
    'a second bind for the same referee is a no-op (UNIQUE idx_referrals_referee)');
  ok(db.referrals.length === 1, 'and leaves exactly one row');

  const self = await bindReferral(env, { code: 'AAA2345', refereeEmail: 'ref@x.com' });
  ok(self.bound === false && self.reason === 'self_referral', 'a user cannot bind their own code');

  const unknown = await bindReferral(env, { code: 'ZZZ9999', refereeEmail: 'other@x.com' });
  ok(unknown.bound === false && unknown.reason === 'unknown_code', 'an unknown code binds nothing');

  const noSchema = await bindReferral({ DB: { prepare() { throw new Error('no such table: referrals'); } } },
    { code: 'AAA2345', refereeEmail: 'x@x.com' });
  ok(noSchema.bound === false && !!noSchema.reason,
    'a pre-0023 schema degrades to "not bound" with a reason — it must never THROW and fail a signup');
})();

await (async () => {
  const db = makeDb({ users: [{ email: 'u@x.com' }] });
  const env = { DB: db };
  const a = await ensureReferralCode(env, 'u@x.com');
  const b = await ensureReferralCode(env, 'u@x.com');
  ok(a && a === b, 'a code is minted once and read back on every later call');
  ok(await ensureReferralCode({ DB: { prepare() { throw new Error('no such column'); } } }, 'u@x.com') === '',
    'no referral_code column reads as "" rather than throwing');
})();

// ===========================================================================
console.log('\ncredit path (the money):');

const creditSeed = () => makeDb({
  users: [
    { email: 'ref@x.com', referral_code: 'AAA2345', verified_at: nowIso(), stripe_customer_id: 'cus_ref' },
    { email: 'new@x.com', verified_at: nowIso(), stripe_customer_id: 'cus_new' },
  ],
  referrals: [{
    id: 'r1', code: 'AAA2345', referrer_id: 'ref@x.com', referee_id: 'new@x.com',
    status: 'signed_up', signup_ip_hash: 'ip-b', created_at: nowIso(),
  }],
});

await (async () => {
  const db = creditSeed();
  const env = { DB: db, COACH_KV: makeKv(), ...STRIPE_ENV };
  await withStripe(stripeOk, async (calls) => {
    const res = await creditReferrer(env, 'new@x.com');
    ok(res.ok && res.cents === 1200, 'a clean referral credits one month, read from the live Stripe price');
    ok(db.referrals[0].status === 'credited' && db.referrals[0].credit_cents === 1200, 'and the row records it');
    const txns = calls.filter((c) => /balance_transactions/.test(c.url));
    ok(txns.length === 1, 'exactly one Stripe balance transaction was issued');
    ok(/amount=-1200/.test(txns[0].body), 'as a NEGATIVE amount (a customer-balance credit, not a charge)');
    ok(txns[0].idem === 'fwrefcredit:r1', 'carrying an idempotency key derived from the referral id');
  });
})();

await (async () => {
  const db = creditSeed();
  const env = { DB: db, COACH_KV: makeKv(), ...STRIPE_ENV };
  await withStripe(stripeOk, async (calls) => {
    await creditReferrer(env, 'new@x.com');
    const replay = await creditReferrer(env, 'new@x.com');
    ok(!replay.ok && replay.reason === 'already_credited', 'a webhook REPLAY re-credits nothing');
    ok(calls.filter((c) => /balance_transactions/.test(c.url)).length === 1,
      'and issues no second balance transaction (Stripe delivers at-least-once)');
  });
})();

await (async () => {
  // The claim must land in D1 BEFORE Stripe is called: that is what makes two
  // concurrent deliveries safe, and it is invisible from the happy path.
  const db = creditSeed();
  const env = { DB: db, COACH_KV: makeKv(), ...STRIPE_ENV };
  let statusAtStripeCall = null;
  await withStripe((url) => {
    if (/balance_transactions/.test(url)) statusAtStripeCall = db.referrals[0].status;
    return stripeOk(url);
  }, async () => {
    await creditReferrer(env, 'new@x.com');
  });
  ok(statusAtStripeCall === 'converted',
    'the D1 claim (signed_up → converted) happens BEFORE the Stripe call, not after');
})();

await (async () => {
  const db = creditSeed();
  db.users.get('ref@x.com').verified_at = null;
  const env = { DB: db, COACH_KV: makeKv(), ...STRIPE_ENV };
  await withStripe(stripeOk, async (calls) => {
    const res = await creditReferrer(env, 'new@x.com');
    ok(!res.ok && res.reason === 'guarded' && res.flags.includes('referrer_unverified'),
      'an unverified referrer holds the credit');
    ok(!calls.some((c) => /balance_transactions/.test(c.url)), 'and no money moves');
    ok(db.referrals[0].status === 'converted', 'the row stays at converted so an admin can see and retry it');
    ok(JSON.parse(db.referrals[0].flags).includes('referrer_unverified'), 'with the reason recorded on the row');
  });
})();

await (async () => {
  const db = creditSeed();
  const env = { DB: db, COACH_KV: makeKv(), ...STRIPE_ENV };
  await withStripe(stripeOk, async (calls) => {
    await creditReferrer(env, 'new@x.com');           // holds? no — clean, so it credits
    ok(db.referrals[0].status === 'credited', 'setup: credited');
    // A HELD row must not silently retry on every later webhook — only on an
    // explicit admin retry.
    db.referrals[0].status = 'converted';
    const passive = await creditReferrer(env, 'new@x.com');
    ok(!passive.ok && passive.reason === 'held', 'a held referral is not retried by an ordinary webhook');
    const before = calls.filter((c) => /balance_transactions/.test(c.url)).length;
    const retried = await creditReferrer(env, 'new@x.com', { retry: true });
    ok(retried.ok, 'but an explicit admin retry does run it');
    ok(calls.filter((c) => /balance_transactions/.test(c.url)).length === before + 1,
      'and issues exactly one more transaction');
  });
})();

await (async () => {
  const db = creditSeed();
  db.users.get('ref@x.com').stripe_customer_id = null;
  const env = { DB: db, COACH_KV: makeKv(), ...STRIPE_ENV };
  await withStripe(stripeOk, async (calls) => {
    const res = await creditReferrer(env, 'new@x.com');
    ok(res.ok, 'a referrer who has never paid still gets credited');
    ok(calls.some((c) => /\/customers$/.test(c.url)), 'because a Stripe customer is created for them');
    ok(db.users.get('ref@x.com').stripe_customer_id === 'cus_new',
      'and the id is stored, so checkout.js reuses it and the credit actually applies');
  });
})();

await (async () => {
  const db = creditSeed();
  const env = { DB: db, COACH_KV: makeKv() }; // no Stripe key at all
  const res = await creditReferrer(env, 'new@x.com');
  ok(!res.ok && res.reason === 'stripe_unconfigured', 'no Stripe config holds the credit instead of throwing');
  ok(db.referrals[0].status === 'converted', 'and the conversion is still recorded');
})();

await (async () => {
  const db = creditSeed();
  const env = { DB: db, COACH_KV: makeKv(), STRIPE_SECRET_KEY: 'sk_test_x' }; // no price id, no MRR
  await withStripe(stripeOk, async (calls) => {
    const res = await creditReferrer(env, 'new@x.com');
    ok(!res.ok && res.reason === 'no_price', 'an unknown month price never issues a credit of a guessed size');
    ok(!calls.some((c) => /balance_transactions/.test(c.url)), 'and moves no money');
  });
})();

await (async () => {
  const db = creditSeed();
  const env = { DB: db, COACH_KV: makeKv(), STRIPE_SECRET_KEY: 'sk_test_x', REFERRAL_CREDIT_CENTS: '999' };
  await withStripe(stripeOk, async (calls) => {
    const res = await creditReferrer(env, 'new@x.com');
    ok(res.ok && res.cents === 999, 'REFERRAL_CREDIT_CENTS overrides the Stripe price outright');
    ok(!calls.some((c) => /\/prices\//.test(c.url)), 'and skips the price lookup entirely');
  });
})();

await (async () => {
  const db = creditSeed();
  const kv = makeKv();
  const env = { DB: db, COACH_KV: kv, ...STRIPE_ENV };
  await withStripe(stripeOk, async (calls) => {
    await creditReferrer(env, 'new@x.com');
    db.referrals[0].status = 'signed_up'; db.referrals[0].credited_at = null;
    await creditReferrer(env, 'new@x.com');
    ok(calls.filter((c) => /\/prices\//.test(c.url)).length === 1,
      'the monthly price is fetched once and served from KV after that');
  });
})();

await (async () => {
  const db = creditSeed();
  db.referrals[0].status = 'void';
  const env = { DB: db, COACH_KV: makeKv(), ...STRIPE_ENV };
  await withStripe(stripeOk, async (calls) => {
    const res = await creditReferrer(env, 'new@x.com');
    ok(!res.ok && res.reason === 'void', 'a voided referral never credits');
    ok(!calls.length, 'and never touches Stripe');
  });
  ok(await voidReferral(env, 'r1', 'looks like a farm') === false || db.referrals[0].status === 'void',
    'voiding is terminal');
})();

await (async () => {
  const db = creditSeed();
  db.referrals[0].status = 'credited';
  const env = { DB: db };
  ok(await voidReferral(env, 'r1', 'too late') === false,
    'a CREDITED referral cannot be voided — voiding it would not take the money back');
})();

await (async () => {
  const db = creditSeed();
  const env = { DB: db };
  ok(await refereePromoFor({ ...env, STRIPE_REFERRAL_PROMO_ID: 'promo_1' }, 'new@x.com') === 'promo_1',
    'a bound referee gets the free-month promotion code at checkout');
  ok(await refereePromoFor(env, 'new@x.com') === '',
    'and no promo id configured means no discount is attached');
  db.referrals[0].status = 'credited';
  ok(await refereePromoFor({ ...env, STRIPE_REFERRAL_PROMO_ID: 'promo_1' }, 'new@x.com') === '',
    'a referee who already converted does not get the first-purchase discount again');
})();

await (async () => {
  const db = makeDb({
    users: [{ email: 'ref@x.com', referral_code: 'AAA2345' }],
    referrals: [
      { id: 'a', referrer_id: 'ref@x.com', referee_id: '1@x.com', status: 'signed_up', created_at: nowIso() },
      { id: 'b', referrer_id: 'ref@x.com', referee_id: '2@x.com', status: 'credited', credit_cents: 1200, credited_at: nowIso() },
      { id: 'c', referrer_id: 'ref@x.com', referee_id: '3@x.com', status: 'converted', created_at: nowIso() },
    ],
  });
  const s = await referralStats({ DB: db }, 'ref@x.com');
  ok(s.signedUp === 1 && s.converted === 1 && s.credited === 1 && s.creditCents === 1200,
    'referralStats counts each status and sums the credited cents');
  ok(s.maxPerYear === MAX_CREDITS_PER_YEAR, 'and carries the ceiling so no client hard-writes it');
  const none = await referralStats({ DB: { prepare() { throw new Error('no such table'); } } }, 'x@x.com');
  ok(none.signedUp === 0 && none.maxPerYear === MAX_CREDITS_PER_YEAR, 'a missing table reads as zeroes');
})();

// ===========================================================================
console.log('\nshare payload (hostile input):');

ok(isShareId('a'.repeat(SHARE_ID_LEN)) && !isShareId('a'.repeat(SHARE_ID_LEN - 1))
  && !isShareId(`${'a'.repeat(SHARE_ID_LEN - 1)}/`), 'share ids are shape-checked before they reach D1');
{
  const ids = new Set();
  for (let i = 0; i < 2000; i += 1) ids.add(generateShareId());
  ok(ids.size === 2000, '2000 generated share ids are all distinct (the id IS the capability)');
}
ok(shareImageKey('a@b.com', 'x').split(':').includes('a@b.com'),
  'the share image KV key carries the owner email as a SEGMENT, so the account-purge sweep finds it');

ok(sanitizeFirstName('  Alex Rivera ') === 'Alex', 'only the first name is kept');
{
  const nasty = sanitizeFirstName('<script>alert(1)</script>');
  ok(!/[<>()/0-9]/.test(nasty), 'every markup and punctuation character is stripped from a name');
}
ok(sanitizeFirstName('A') === '', 'a one-character name is dropped rather than shown');
ok(sanitizeFirstName('x'.repeat(80)).length === 24, 'a name is length-capped');
ok(sanitizeFirstName('José') === 'José' && sanitizeFirstName('Ní-Bhriain') === 'Ní-Bhriain',
  'accents, hyphens and non-ASCII letters survive (the naive [a-z] filter would mangle real names)');

{
  const good = sanitizeShareRequest({
    firstName: 'Alex',
    careers: [
      { soc: '13-2011.00', score: 82, tier: 'LEGENDARY' },
      { soc: '15-2051.00', score: 71.4, tier: 'GREAT' },
    ],
  });
  ok(good.ok && good.payload.careers.length === 2, 'a well-formed request parses');
  ok(good.payload.careers[1].score === 71, 'scores are rounded to whole percents');
  ok(!('title' in good.payload.careers[0]) && !('name' in good.payload.careers[0]),
    'NO title comes from the client — the server resolves it from the catalog');
}
ok(!sanitizeShareRequest({ careers: [] }).ok, 'an empty card is refused');
ok(!sanitizeShareRequest({ careers: [{ soc: 'not-a-soc', score: 50, tier: 'GREAT' }] }).ok,
  'a malformed SOC is refused');
ok(!sanitizeShareRequest({ careers: [{ soc: '13-2011.00', score: 50, tier: 'BEST EVER' }] }).ok,
  'an invented tier is refused (the label vocabulary is the server’s, not the client’s)');
ok(!sanitizeShareRequest({ careers: [{ soc: '13-2011.00', score: 900, tier: 'GREAT' }] }).ok,
  'an out-of-range score is refused');
{
  const many = sanitizeShareRequest({
    careers: Array.from({ length: 9 }, (_, i) => ({ soc: `13-20${11 + i}.00`, score: 50, tier: 'GREAT' })),
  });
  ok(many.ok && many.payload.careers.length === 3, 'at most three careers make it onto a card');
  const dup = sanitizeShareRequest({
    careers: [{ soc: '13-2011.00', score: 80, tier: 'GREAT' }, { soc: '13-2011.00', score: 40, tier: 'SOLID' }],
  });
  ok(dup.ok && dup.payload.careers.length === 1, 'a duplicated SOC is collapsed');
}

{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
  ok(decodePngBase64(`data:image/png;base64,${png}`).ok, 'a real PNG data URL decodes');
  ok(decodePngBase64(png).ok, 'and so does bare base64');
  ok(!decodePngBase64(Buffer.from('GIF89a-not-a-png').toString('base64')).ok,
    'a non-PNG is refused — the endpoint is not free file hosting on our domain');
  ok(!decodePngBase64('!!!!not base64!!!!').ok, 'garbage is refused');
  const huge = `data:image/png;base64,${'A'.repeat(Math.ceil(MAX_PNG_BYTES / 3) * 4 + 400)}`;
  ok(!decodePngBase64(huge).ok, 'an oversize image is refused before it is allocated');
}

// ===========================================================================
console.log('\nthe public share page:');

{
  const html = sharePageHtml({
    id: 'a'.repeat(SHARE_ID_LEN),
    origin: BASE,
    ctaUrl: `${BASE}/r/AAA2345?to=quiz`,
    payload: {
      firstName: 'Alex',
      careers: [{ soc: '13-2011.00', title: 'Accountants & Auditors', score: 82, tier: 'LEGENDARY' }],
    },
  });
  ok(/name="robots" content="noindex/.test(html),
    'a user-generated page on the marketing domain is noindex — always');
  ok(!/rel="canonical"/.test(html), 'and carries no canonical (a noindex page with one is a mixed signal)');
  ok(html.includes(`<meta property="og:image" content="${shareImageUrl(BASE, 'a'.repeat(SHARE_ID_LEN))}">`),
    'og:image is the absolute URL of this share’s own PNG');
  ok(/twitter:card" content="summary_large_image/.test(html), 'and the card type unfurls large');
  ok(html.includes('Accountants &amp; Auditors'), 'the catalog title is escaped into the page');
  ok(html.includes(TIER_LABELS.LEGENDARY), 'the tier label comes from the server vocabulary');
  ok(html.includes(`${BASE}/r/AAA2345?to=quiz`), 'the CTA is the sharer’s referral link (a share IS a referral)');

  const hostile = sharePageHtml({
    id: 'b'.repeat(SHARE_ID_LEN), origin: BASE, ctaUrl: `${BASE}/quiz`,
    payload: { firstName: '"><img src=x onerror=alert(1)>', careers: [{ title: '<b>x</b>', score: 1, tier: 'EARLY' }] },
  });
  ok(!/<img src=x/.test(hostile) && !/<b>x<\/b>/.test(hostile),
    'a hostile stored payload cannot inject markup into the page');
  ok(/This link is no longer available/.test(shareMissingHtml()), 'a revoked link has its own honest page');
}

// ===========================================================================
console.log('\nroutes execute:');

await (async () => {
  const db = makeDb({ users: [{ email: 'ref@x.com', referral_code: 'AAA2345' }] });
  const env = { DB: db };

  const hit = await refRoute(ctx({ url: `${BASE}/r/AAA2345`, params: { code: 'AAA2345' }, env }));
  await settle();
  ok(hit.status === 302, '/r/<code> redirects');
  ok((hit.headers.get('Set-Cookie') || '').startsWith(`${REFERRAL_COOKIE}=AAA2345`), 'and stamps the referral cookie');
  ok(/utm_source=referral/.test(hit.headers.get('Location')), 'with referral UTM on the destination');

  const quiz = await refRoute(ctx({ url: `${BASE}/r/AAA2345?to=quiz&c=groupchat`, params: { code: 'AAA2345' }, env }));
  ok(/\/quiz\?/.test(quiz.headers.get('Location')), '?to=quiz lands on the quiz');
  ok(/utm_content=groupchat/.test(quiz.headers.get('Location')), '?c=<channel> becomes utm_content');

  const evil = await refRoute(ctx({ url: `${BASE}/r/AAA2345?to=https://evil.test`, params: { code: 'AAA2345' }, env }));
  ok(evil.headers.get('Location').startsWith(`${BASE}/?`),
    'an off-allowlist ?to= falls back home — /r/ is never an open redirect');
  const badChannel = await refRoute(ctx({ url: `${BASE}/r/AAA2345?c=${encodeURIComponent('<script>')}`, params: { code: 'AAA2345' }, env }));
  ok(!/utm_content/.test(badChannel.headers.get('Location')), 'and a malformed channel tag is dropped, not echoed');

  const unknown = await refRoute(ctx({ url: `${BASE}/r/ZZZ9999`, params: { code: 'ZZZ9999' }, env }));
  ok(unknown.status === 302 && !unknown.headers.get('Set-Cookie'),
    'an unknown code still lands the visitor on a real page, with no cookie');

  ok(db.log.some((q) => /INSERT INTO events/i.test(q)), 'a human visit IS counted');
  const eventsBefore = db.log.filter((q) => /INSERT INTO events/i.test(q)).length;
  const crawler = await refRoute(ctx({
    url: `${BASE}/r/AAA2345`, params: { code: 'AAA2345' }, env,
    headers: { 'User-Agent': 'Slackbot-LinkExpanding 1.0' },
  }));
  await settle();
  ok(crawler.status === 302, 'an unfurler is redirected like anyone else');
  ok(db.log.filter((q) => /INSERT INTO events/i.test(q)).length === eventsBefore,
    'but is not counted as a referral visit');
})();

await (async () => {
  const id = 'c'.repeat(SHARE_ID_LEN);
  const db = makeDb({
    users: [{ email: 'ref@x.com', referral_code: 'AAA2345' }],
    shares: [{
      id, user_id: 'ref@x.com', img_key: shareImageKey('ref@x.com', id), views: 0,
      created_at: nowIso(), revoked_at: null,
      payload: JSON.stringify({ firstName: 'Alex', careers: [{ title: 'Accountants & Auditors', score: 82, tier: 'LEGENDARY' }] }),
    }],
  });
  const kv = makeKv();
  await kv.put(shareImageKey('ref@x.com', id), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  const env = { DB: db, COACH_KV: kv };

  const page = await sharePage(ctx({ url: `${BASE}/s/${id}`, params: { id }, env }));
  await settle();
  ok(page.status === 200, 'GET /s/<id> renders a live share');
  const body = await page.text();
  ok(/Alex’s career map/.test(body), 'with the stored snapshot, not live account data');
  ok(/\/r\/AAA2345\?to=quiz/.test(body), 'and a CTA that is the sharer’s referral link');
  ok(page.headers.get('X-Robots-Tag').includes('noindex'), 'served with an X-Robots-Tag noindex too');
  ok(db.shares.get(id).views === 1, 'a human view increments the counter');

  const bot = await sharePage(ctx({
    url: `${BASE}/s/${id}`, params: { id }, env, headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  }));
  await settle();
  ok(bot.status === 200 && db.shares.get(id).views === 1,
    'an unfurler still gets the page but does NOT inflate the view count');

  const img = await shareImg(ctx({ url: `${BASE}/s/img/${id}.png`, params: { id: `${id}.png` }, env }));
  ok(img.status === 200 && img.headers.get('Content-Type') === 'image/png', 'the OG image serves from KV');

  db.shares.get(id).revoked_at = nowIso();
  const gone = await sharePage(ctx({ url: `${BASE}/s/${id}`, params: { id }, env }));
  ok(gone.status === 404, 'a revoked share 404s');
  const goneImg = await shareImg(ctx({ url: `${BASE}/s/img/${id}.png`, params: { id: `${id}.png` }, env }));
  ok(goneImg.status === 404,
    'and so does its image — an image that outlives its page is a revocation that revoked nothing');

  const missing = await sharePage(ctx({ url: `${BASE}/s/${'z'.repeat(SHARE_ID_LEN)}`, params: { id: 'z'.repeat(SHARE_ID_LEN) }, env }));
  ok(missing.status === 404 && (await missing.text()) === (await gone.text()),
    'a never-existed id is byte-identical to a revoked one — a live link cannot be found by probing');
  const junk = await sharePage(ctx({ url: `${BASE}/s/../etc`, params: { id: '../etc' }, env }));
  ok(junk.status === 404, 'a path-shaped id never reaches D1');
})();

await (async () => {
  const db = makeDb({
    users: [{ email: 'u@x.com', referral_code: null, verified_at: nowIso() }],
    titles: { '13-2011.00': 'Accountants & Auditors' },
    sessionEmail: 'u@x.com',
  });
  const kv = makeKv();
  const env = { DB: db, COACH_KV: kv, SESSION_PEPPER: 'p' };
  const cookie = { Cookie: 'fw_session=tok' };

  const anon = await shareCreate(ctx({ url: `${BASE}/share`, method: 'POST', body: {}, env }));
  ok(anon.status === 401, 'POST /share without a session is 401');

  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString('base64')}`;
  const made = await shareCreate(ctx({
    url: `${BASE}/share`, method: 'POST', headers: cookie, env,
    body: { firstName: 'Uma', careers: [{ soc: '13-2011.00', score: 80, tier: 'LEGENDARY' }], png },
  }));
  const madeBody = await made.json();
  ok(made.status === 200 && isShareId(madeBody.id), 'a signed-in user can create a share');
  ok(madeBody.url.endsWith(`/s/${madeBody.id}`), 'and gets the public URL back');
  ok(kv.map.has(shareImageKey('u@x.com', madeBody.id)), 'the PNG landed in KV under the owner-scoped key');
  ok(!!madeBody.referralCode, 'and a referral code was minted, so the share page CTA is a real invite link');

  const junk = await shareCreate(ctx({
    url: `${BASE}/share`, method: 'POST', headers: cookie, env,
    body: { careers: [{ soc: '99-9999.99', score: 80, tier: 'GREAT' }] },
  }));
  ok(junk.status === 400, 'a SOC that is not in the catalog cannot be published');

  const listed = await shareList(ctx({ url: `${BASE}/share`, headers: cookie, env }));
  const listBody = await listed.json();
  ok(listed.status === 200 && listBody.shares.length === 1, 'GET /share lists the live links');
  ok(!JSON.stringify(listBody).includes('shareimg:'), 'and never leaks the KV key');

  const otherDb = makeDb({ users: [{ email: 'other@x.com' }], sessionEmail: 'other@x.com' });
  otherDb.shares.set(madeBody.id, { ...db.shares.get(madeBody.id) });
  const stolen = await shareRevoke(ctx({
    url: `${BASE}/share?id=${madeBody.id}`, method: 'DELETE', headers: cookie,
    env: { DB: otherDb, COACH_KV: kv, SESSION_PEPPER: 'p' },
  }));
  ok(stolen.status === 404, 'another account cannot revoke your share (the id is a capability on the PAGE only)');

  const revoked = await shareRevoke(ctx({ url: `${BASE}/share?id=${madeBody.id}`, method: 'DELETE', headers: cookie, env }));
  ok(revoked.status === 200, 'the owner can revoke it');
  ok(!kv.map.has(shareImageKey('u@x.com', madeBody.id)), 'and the KV image goes with it');
  const twice = await shareRevoke(ctx({ url: `${BASE}/share?id=${madeBody.id}`, method: 'DELETE', headers: cookie, env }));
  ok(twice.status === 404, 'revoking twice is a no-op, not a second success');
})();

await (async () => {
  const db = makeDb({ users: [{ email: 'u@x.com', verified_at: nowIso() }], sessionEmail: 'u@x.com' });
  const env = { DB: db, SESSION_PEPPER: 'p' };
  const anon = await referralRoute(ctx({ url: `${BASE}/referral`, env: { DB: makeDb({ sessionEmail: null }), SESSION_PEPPER: 'p' } }));
  ok(anon.status === 401, 'GET /referral needs a session');

  const res = await referralRoute(ctx({ url: `${BASE}/referral`, headers: { Cookie: 'fw_session=tok' }, env }));
  const body = await res.json();
  ok(res.status === 200 && body.enabled && body.link.includes('/r/'), 'GET /referral returns a usable link');
  ok(body.maxPerYear === MAX_CREDITS_PER_YEAR, 'and serves the ceiling so no client hard-writes it (§3 rule 11)');
  ok(body.verified === true, 'and says whether a credit can actually be issued to this account');
  ok(!('email' in body) && !JSON.stringify(body).includes('u@x.com'), 'and carries no address it did not need to');
})();

await (async () => {
  const page = await inviteRoute(ctx({ url: `${BASE}/invite`, env: {} }));
  ok(page.status === 200, 'GET /invite renders without a session (the blurbs are the point)');
  const html = await page.text();
  ok(/noindex/.test(html), '/invite is noindex — it is a signed-in tool with a personal link on it');
  ok(html.includes(`Up to ${MAX_CREDITS_PER_YEAR} credited invites a year`),
    'and its ceiling copy is generated from the constant, not typed');
  const visible = [...html.matchAll(/<p class="inv-text"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  ok(visible.length >= 5, `every blurb renders (${visible.length})`);
  ok(visible.every((t) => !/\{\{(LINK|PROMO)\}\}/.test(t)),
    'and none of them shows a raw {{LINK}}/{{PROMO}} placeholder before the script runs');
  ok(visible.every((t) => t.includes('flightway.ai/r/your-code')),
    'each shows a placeholder link instead, so the page is readable with JS still loading');
  ok(html.includes("data-inv-channel=\"groupchat\""), 'each blurb carries its own channel tag');
  ok(!/\$\d/.test(html), 'and quotes no price — pricing lives in one place and this is not it');
})();

console.log(`\ntest:referral — ${fail ? `${fail} FAILED` : 'all checks passed'}`);
process.exit(fail ? 1 : 0);
