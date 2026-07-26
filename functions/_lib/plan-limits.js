// FlightWay — per-feature usage limits (free/paid merge §2).
//
// One table, one helper. Every metered feature declares its caps here instead of
// hardcoding a number at its call site, so retuning a cap is a one-line change in
// one file. checkFeatureLimit() is the generalized form of the atomic COACH_KV
// daily counter mock-interview.js pioneered (26h expirationTtl, keyed per
// user+day) — same pattern, one extra key segment per feature.
//
//   limits[plan]  null = unlimited · 0 = not on that plan at all (hard gate)
//   resetPeriod   'day' | 'week' | 'month' | 'lifetime'. May also be a per-PLAN
//                 map ({ free: 'lifetime', premium: 'day' }) when the free tier
//                 is a one-off taste of something paid users get on a cycle —
//                 V2 §4's mock interview is the only such row today.
//   keyPrefix     the COACH_KV key segment. NEVER rename one that is already
//                 live — it hands every existing user a fresh allowance.
//   one           singular label, used when the cap is exactly 1 ("1 free
//                 career simulation", not "1 free career simulations"). Every
//                 V2 §4 taste is a 1, so without it most walls read wrong.
//
// Dev testers (§3.5) short-circuit to unlimited before any KV read.
//
// V2 §4 (S8) re-tiered this table: the weekly loop is free and the execution
// tools are metered tastes. Two rows deliberately change key SHAPE, which hands
// every existing user a fresh allowance — that is the intended loosening, not a
// mistake: `roadmap-generate` moves lifetime → month (free users need periodic
// regen), and `mock-interview`'s free tier moves 0 → a lifetime taste (a
// zero-free feature was a conversion dead end). Premium's `mockivday:<e>:<date>`
// counters are untouched by that: the free taste keys on the undated form.

import { PLAN_RANK, normalizePlan, resolveEntitlement, isDevTester } from './entitlements.js';

export const FEATURE_LIMITS = {
  'marco-chat': {
    keyPrefix: 'marcochatday',
    resetPeriod: 'day',
    label: 'Marco messages',
    one: 'Marco message',
    limits: { free: 10, premium: null, lifetime: null },
  },
  // WS-D D3: Marco's proactive thread cards. Not a feature the user asks for —
  // a cap on how often the product interrupts, which is why free gets a couple
  // a day and paid gets as many as Marco actually has something to say.
  'marco-thread': {
    keyPrefix: 'marcothreadday',
    resetPeriod: 'day',
    label: 'Marco topic suggestions',
    one: 'Marco topic suggestion',
    limits: { free: 2, premium: null, lifetime: null },
  },
  // §4 "1 active + 1 regen/month": one monthly allowance IS both halves — you
  // build one roadmap and may rebuild it once a cycle. Prefix unchanged; the
  // month segment is what makes the key new.
  'roadmap-generate': {
    keyPrefix: 'roadmapgen',
    resetPeriod: 'month',
    label: 'AI roadmap generations',
    one: 'AI roadmap generation',
    limits: { free: 1, premium: null, lifetime: null },
    // S18. The ONLY row that can carry a bonus: §5 S18's end-of-term review
    // grants +1 regeneration, and §4's own note beside this row already said it
    // would ("the semester loop grants +1 at term end"). See `grantFeatureBonus`
    // below for why a bonus is a separate unwindowed counter and not a refund.
    bonusable: true,
  },
  'mock-interview': {
    // Live since the mock-interview ship — the prefix must stay `mockivday`.
    keyPrefix: 'mockivday',
    resetPeriod: { free: 'lifetime', premium: 'day', lifetime: 'day' },
    label: 'mock interview sessions',
    one: 'mock interview',
    limits: { free: 1, premium: 3, lifetime: 3 },
  },
  // §4: sims were the huddle's scarcity pick. Only a CACHE MISS is metered —
  // sim-generate serves the shared `simv2:<slug>` blob to anyone, so a cache hit
  // costs nothing and metering it would wall off the discovery funnel §4 protects.
  'career-sim': {
    keyPrefix: 'simgenmo',
    resetPeriod: 'month',
    label: 'career simulations',
    one: 'career simulation',
    limits: { free: 1, premium: null, lifetime: null },
  },
  // §4: free sees the top 2 of each search, blurred beyond. The cap counts
  // SEARCHES (grounded research spend), never re-reads of a cached result.
  'opportunity-search': {
    keyPrefix: 'oppsearchwk',
    resetPeriod: 'week',
    label: 'opportunity searches',
    one: 'opportunity search',
    limits: { free: 1, premium: null, lifetime: null },
  },
  // §4's resume row. The ATS check named there is a client-side function with
  // no server surface (it recomputes on every keystroke), so the meter sits on
  // the whole-resume AI draft instead — the one expensive call on that page.
  // Building and editing by hand, and AI bullet help, stay free.
  'resume-draft': {
    keyPrefix: 'rdraftmo',
    resetPeriod: 'month',
    label: 'AI resume drafts',
    one: 'AI resume draft',
    limits: { free: 1, premium: null, lifetime: null },
  },
  'resume-tailor': {
    keyPrefix: 'rtailorlife',
    resetPeriod: 'lifetime',
    label: 'resume tailorings',
    one: 'resume tailoring',
    limits: { free: 1, premium: null, lifetime: null },
  },
  // §4's Deadline Radar row: "View + alerts free; 1 grounded refresh/week" on
  // free, "refresh on demand" on paid. VIEWING the radar, the T-14/T-3 alert
  // emails and adding your own dates are all unmetered on every plan — the
  // meter is on the one action that spends money (three live web calls plus a
  // shaping call). S8 deliberately left this row out because the feature did
  // not exist yet; S9 built it, so it lands with its enforcement point.
  'deadline-refresh': {
    keyPrefix: 'dlrefreshwk',
    resetPeriod: 'week',
    label: 'deadline refreshes',
    one: 'deadline refresh',
    limits: { free: 1, premium: null, lifetime: null },
  },
  // §4's Live-posting scorecard row — "the heaviest grounding cost in the
  // product", and the table says so: free gets ONE, ever, and paid runs it on
  // demand (plus the quarterly cron auto-run, which spends no allowance because
  // nobody asked for it). One run is three live web calls plus a 2,200-token
  // shaping call, so this is the only §4 row where a lifetime taste on free is
  // about cost rather than about selling the upgrade.
  //
  // The key is the bare `scorecardlife:<email>` (periodSegment returns '' for
  // lifetime), which is what makes "one, ever" actually mean it — a dated
  // segment would hand every account a fresh taste at midnight. `resetPeriod` is
  // a flat string rather than mock-interview's per-plan map because paid is
  // UNLIMITED here: checkFeatureLimit returns before it ever computes a key for
  // a null limit, so a per-plan period would be a number nobody reads.
  'scorecard-run': {
    keyPrefix: 'scorecardlife',
    resetPeriod: 'lifetime',
    label: 'readiness scorecards',
    one: 'readiness scorecard',
    limits: { free: 1, premium: null, lifetime: null },
  },
  // §4's Network mapper row: "2/month" on free, unlimited on paid, and the
  // table's own rationale is "AI drafting cost; 2 keeps the habit alive". The
  // meter is on the DRAFT and nothing else — keeping an archetype, marking a
  // message sent, and every other move on the list are free on every plan,
  // because they cost nothing and metering the tracking would meter the loop §4
  // protects. Two a month is deliberately a real allowance rather than a taste:
  // outreach only works as a habit, and one message ever is not a habit.
  'outreach-draft': {
    keyPrefix: 'outdraftmo',
    resetPeriod: 'month',
    label: 'outreach drafts',
    one: 'outreach draft',
    limits: { free: 2, premium: null, lifetime: null },
  },
};

const DAY_TTL_SECONDS = 60 * 60 * 26;
// Each TTL only has to outlive the longest window its segment can still cover
// (a month key written on the 1st has 31 days left), so these are the shortest
// safe values — a stale counter that outlives its window is unread, not wrong.
const PERIOD_TTL_SECONDS = {
  day: DAY_TTL_SECONDS,
  week: 60 * 60 * 24 * 8,
  month: 60 * 60 * 24 * 32,
};

/** 'day' | 'week' | 'month' | 'lifetime' for this feature ON THIS PLAN. */
export function resetPeriodFor(featureKey, plan) {
  const feature = FEATURE_LIMITS[featureKey];
  if (!feature) return 'lifetime';
  const rp = feature.resetPeriod;
  if (typeof rp === 'string') return rp;
  if (rp && typeof rp === 'object') return rp[normalizePlan(plan)] || rp.free || 'lifetime';
  return 'lifetime';
}

/**
 * The KV key segment for one window. Empty for 'lifetime'.
 * Weeks key on the UTC Monday's date, so a week is one unambiguous string and
 * never straddles a year boundary the way an ISO week NUMBER does.
 */
function periodSegment(period, now) {
  const d = new Date(now);
  if (period === 'day') return d.toISOString().slice(0, 10);
  if (period === 'month') return d.toISOString().slice(0, 7);
  if (period === 'week') {
    const back = (d.getUTCDay() + 6) % 7; // 0 = Monday
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back))
      .toISOString().slice(0, 10);
  }
  return '';
}

/** "Come back tomorrow." — the honest sentence for a window that does reopen. */
function reopensPhrase(period) {
  if (period === 'day') return 'Come back tomorrow.';
  if (period === 'week') return 'Your next one opens Monday.';
  if (period === 'month') return 'Your next one opens next month.';
  return '';
}

/**
 * The cap table as the client is allowed to see it — WS-G G3. Served on
 * /config so pricing copy and every usage meter read the SAME numbers this
 * file enforces, instead of hand-written ones that drift the first time a cap
 * is retuned. `keyPrefix` is deliberately not exported: it is a KV detail and
 * naming it publicly invites someone to depend on it.
 */
export function publicFeatureLimits() {
  const out = {};
  for (const key of Object.keys(FEATURE_LIMITS)) {
    const f = FEATURE_LIMITS[key];
    out[key] = {
      label: f.label,
      // A string, or the per-plan map — served as declared so the client can
      // say "one, ever" to a free user and "3 a day" to a paying one from the
      // same row instead of guessing which half applies.
      resetPeriod: (f.resetPeriod && typeof f.resetPeriod === 'object')
        ? { ...f.resetPeriod }
        : f.resetPeriod,
      limits: { ...f.limits },
    };
    if (f.one) out[key].one = f.one;
  }
  return out;
}

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

/**
 * COACH_KV key for a user's counter. Windowed features carry their window as a
 * trailing segment and roll over at UTC midnight (day/week) or on the 1st
 * (month); lifetime counters are the bare `prefix:email`.
 *
 * `plan` matters only for a feature whose resetPeriod is a per-plan map — pass
 * it whenever you have it, or a free user's lifetime taste and a paid user's
 * daily counter resolve to the same key.
 */
export function featureKvKey(featureKey, email, now = Date.now(), plan) {
  const feature = FEATURE_LIMITS[featureKey];
  if (!feature) return '';
  const who = String(email || '').trim().toLowerCase();
  const seg = periodSegment(resetPeriodFor(featureKey, plan), now);
  return seg ? `${feature.keyPrefix}:${who}:${seg}` : `${feature.keyPrefix}:${who}`;
}

/**
 * The bonus counter's key. Deliberately UNWINDOWED — a bonus is earned, and an
 * earned thing that silently evaporates at midnight on the 1st is worse than one
 * that was never granted.
 */
export function featureBonusKey(featureKey, email) {
  const feature = FEATURE_LIMITS[featureKey];
  if (!feature) return '';
  return `fbonus:${feature.keyPrefix}:${String(email || '').trim().toLowerCase()}`;
}

/** Bonus units this account is holding for a feature. 0 for every unbonusable row. */
async function readBonus(env, email, featureKey) {
  const feature = FEATURE_LIMITS[featureKey];
  if (!feature || !feature.bonusable || !env || !env.COACH_KV) return 0;
  try {
    return Math.max(0, Number(await env.COACH_KV.get(featureBonusKey(featureKey, email))) || 0);
  } catch (_) {
    return 0;
  }
}

/**
 * Grant N extra uses of a feature, outside the window's normal allowance.
 *
 * This is NOT `refundFeatureUse` with a different name, and the difference is
 * the whole reason it exists: a refund decrements the window counter and
 * therefore does nothing at all for a student who has not spent this window's
 * allowance yet — which is most students at the end of a term. A bonus is its
 * own unwindowed counter that `checkFeatureLimit` ADDS to the limit and consumes
 * only once the ordinary allowance is gone, so "+1 regeneration" means one more
 * than they would otherwise have had, whenever they get round to using it.
 *
 * Best-effort and never throws: a failed grant must not fail the review that
 * earned it. Idempotency is the CALLER's job — `terms.regen_granted_at` is the
 * guard for this feature's only caller, and it is a D1 row rather than a KV
 * counter precisely because it has to be.
 */
export async function grantFeatureBonus(env, email, featureKey, n = 1) {
  try {
    const feature = FEATURE_LIMITS[featureKey];
    if (!feature || !feature.bonusable || !env || !env.COACH_KV || !email) return false;
    const units = Math.max(1, Math.min(12, Math.round(Number(n) || 1)));
    const key = featureBonusKey(featureKey, email);
    const held = Math.max(0, Number(await env.COACH_KV.get(key)) || 0);
    await env.COACH_KV.put(key, String(held + units));
    return true;
  } catch (err) {
    console.warn('feature bonus grant failed', err);
    return false;
  }
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
  const period = resetPeriodFor(featureKey, plan);
  const key = featureKvKey(featureKey, email, now, plan);
  const used = Number(await env.COACH_KV.get(key)) || 0;
  // S18. Earned units sitting outside the window (grantFeatureBonus). Zero for
  // every row that is not `bonusable`, and that check happens before the KV read
  // — this is on the hot path of every /auth/me, which peeks at all ten features.
  const bonus = await readBonus(env, email, featureKey);
  const effective = limit + bonus;

  if (used >= effective) {
    const upgrade = upgradeHelps(featureKey, plan);
    // The wall quotes `used`, not the cap. Without a bonus the two are the same
    // number and nothing changes; WITH one they differ, and by the time a
    // student hits the wall the bonus has already been consumed — so quoting the
    // cap would tell someone who generated twice this month that they used their
    // "1 free generation", which is a number they can catch us on.
    const spent = used === 1 ? (feature.one || label) : label;
    const message = upgrade
      ? `You've used your ${used} free ${spent} — Flight Plan lifts the cap.`
      : `Limit reached (${used} ${spent}). ${reopensPhrase(period)}`.trim();
    return { ...base, ok: false, plan, limit: effective, bonus, used, remaining: 0, upgrade, resetPeriod: period, message };
  }

  if (spend) {
    const ttl = PERIOD_TTL_SECONDS[period];
    await env.COACH_KV.put(key, String(used + 1), ttl ? { expirationTtl: ttl } : {});
    // The bonus is consumed only once the window's ordinary allowance is gone.
    // Without this the granted unit would sit in KV forever and hand the student
    // an extra generation every month for the rest of the account's life.
    if (bonus > 0 && used + 1 > limit) {
      try {
        await env.COACH_KV.put(featureBonusKey(featureKey, email), String(bonus - 1));
      } catch (err) {
        console.warn('feature bonus consume failed', err);
      }
    }
  }
  const nowUsed = spend ? used + 1 : used;
  return {
    ...base, ok: true, plan, limit: effective, bonus, used: nowUsed, resetPeriod: period,
    remaining: Math.max(0, effective - nowUsed),
  };
}

/**
 * Give back one use after a failure the user did not cause.
 *
 * The spend happens before any model work so a blocked message costs nothing
 * upstream — correct. The gap is the other direction: when the turn then fails
 * server-side, the user has paid one of five daily messages for a reply they
 * never got. Refunding closes that without weakening the up-front spend.
 *
 * Best-effort and never throws — a failed refund must not convert a handled
 * error into an unhandled one. Never refunds below zero, and no-ops for
 * unlimited plans (where nothing was counted in the first place).
 */
export async function refundFeatureUse(env, email, featureKey, opts = {}) {
  try {
    const feature = FEATURE_LIMITS[featureKey];
    if (!feature || !env || !env.COACH_KV || !email) return;
    if (isDevTester(env, email)) return;
    const plan = opts.plan ? normalizePlan(opts.plan) : (await resolveEntitlement(env, email)).effective;
    if (featureLimit(featureKey, plan) === null) return;
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const period = resetPeriodFor(featureKey, plan);
    const key = featureKvKey(featureKey, email, now, plan);
    const used = Number(await env.COACH_KV.get(key)) || 0;
    if (used <= 0) return;
    const ttl = PERIOD_TTL_SECONDS[period];
    await env.COACH_KV.put(key, String(used - 1), ttl ? { expirationTtl: ttl } : {});
  } catch (err) {
    console.warn('feature use refund failed', err);
  }
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
