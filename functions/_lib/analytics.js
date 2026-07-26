// FlightWay V2 S3 — the admin analytics read layer (D19: self-hosted, no vendors).
//
// One module so the dashboard endpoint (functions/admin/analytics.js) and the
// gate (scripts/test-admin.mjs) agree on exactly what every number MEANS. Every
// function here is pure over a D1-shaped `db` — no DOM, no network, no clock
// except the `today`/`now` the caller passes in — so the gate can seed a real
// SQLite database from migration 0017 and assert each aggregate to the row.
//
// Two rules govern where the numbers come from (masterplan §5 S3):
//   1. events_daily (the nightly rollup) is used for anything that is a plain
//      additive count over days — feature usage, the zero-use callout. It is
//      cheap, exact for counts, and survives the 90-day raw prune.
//   2. raw `events` is used only where events_daily physically cannot answer:
//      DISTINCT users across a window (DAU/WAU/MAU, funnel stages), per-identity
//      correlation (activation, cohorts, sources), path filters (landing), and
//      the live tail. Every such query is bounded to a short range (<= the
//      90-day retention window), so it is never a growing full scan.
//
// Nothing here decides WHO may read it. Authorization is the endpoint's job
// (adminGate → 404 to everyone who is not an admin); this file assumes the
// caller has already earned the data.

import { dayFromIso, shiftDay } from './events.js';

// The activation signal (masterplan §5 S3: "signup → roadmap generated or plan
// viewed within 48h"). Kept as one named constant so the overview rate and the
// funnel's last stage cannot silently disagree about what "activated" means.
export const ACTIVATION_EVENTS = ['roadmap_generated', 'pricing_view'];
export const ACTIVATION_WINDOW_HOURS = 48;

// The paths that count as "the landing page" for the top of the discovery
// funnel. A visitor is anyone with a page_view on one of these.
export const LANDING_PATHS = ['/', '/index.html', '/index', '/index.htm'];

// The discovery funnel, in order. `reveal_view` was flagged `pending` while S6
// had not yet shipped the post-quiz reveal, so the stage could show its real
// shape while reading a structural zero. S6 shipped it — `qzShowReveal()` emits
// the event at assets/js/quiz/quiz-app.js:2457 — so the flag is GONE. Do not
// re-add it: a `pending` chip on a live stage tells the reader to discount a
// zero that is real data, which is the opposite of what the chip is for.
export const DISCOVERY_FUNNEL = [
  { stage: 'landing', label: 'Landing', event: null }, // page_view on a landing path
  { stage: 'quiz_start', label: 'Quiz started', event: 'quiz_start' },
  { stage: 'quiz_complete', label: 'Quiz completed', event: 'quiz_complete' },
  { stage: 'reveal_view', label: 'Match reveal', event: 'reveal_view' },
  { stage: 'signup', label: 'Signed up', event: 'signup_complete' },
  { stage: 'activated', label: 'Activated', event: 'roadmap_generated' },
];

export const PAYWALL_STAGES = ['plan_cap_hit', 'upgrade_click', 'checkout_start', 'checkout_success'];

// The features whose usage the dashboard watches, and whose ABSENCE is the
// "maintaining eight for free" callout the audit asked us to make measurable.
// Each maps a friendly label to the event name that proves the feature ran.
// page_view/session_start/identify are deliberately excluded — they are context,
// not features, and would drown the signal.
export const WATCHED_FEATURES = [
  { key: 'quiz', label: 'Quiz', event: 'quiz_complete' },
  { key: 'roadmap', label: 'Roadmap generate', event: 'roadmap_generated' },
  { key: 'roadmap_extend', label: 'Roadmap extend', event: 'roadmap_extend' },
  { key: 'skill_gap', label: 'Skill gap', event: 'skill_gap_view' },
  { key: 'opp_finder', label: 'Opportunity finder', event: 'opp_search' },
  { key: 'marco', label: 'Marco chat', event: 'nav_click' }, // proxy until a marco_ event exists
  { key: 'resume_tailor', label: 'Resume tailor', event: 'resume_tailor' },
  { key: 'resume_build', label: 'Resume build', event: 'resume_guided_build' },
  { key: 'mock_interview', label: 'Mock interview', event: 'mockiv_start' },
  { key: 'sim_share', label: 'Sim share', event: 'sim_share_download' },
  { key: 'compare', label: 'Career compare', event: 'career_compare_open' },
  { key: 'why_match', label: 'Why-this-match', event: 'why_match_open' },
  { key: 'ai_exposure', label: 'AI exposure', event: 'ai_exposure_view' },
  { key: 'artifacts', label: 'Evidence locker', event: 'artifact_saved' },
  { key: 'flightplan', label: 'Flight Plan', event: 'flightplan_view' },
];

// ---------------------------------------------------------------- small utils

/** UTC date string (YYYY-MM-DD) for a Date/ms/ISO — the shape `day` columns use. */
export function toDay(input) {
  const d = input instanceof Date ? input : new Date(input);
  return d.toISOString().slice(0, 10);
}

/** The Monday (UTC) of the ISO week containing `dayStr`. Cohorts key on this. */
export function weekStart(dayStr) {
  const d = new Date(dayStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD strings (b - a), positive when b is later. */
export function daysBetween(a, b) {
  const ma = Date.parse(a + 'T00:00:00Z');
  const mb = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return 0;
  return Math.round((mb - ma) / 86400000);
}

/** Clamp a caller-supplied {from,to} to sane, in-range YYYY-MM-DD, max `maxDays`. */
export function clampRange(from, to, today, maxDays = 90) {
  const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let end = isDay(to) ? to : today;
  if (end > today) end = today;
  let start = isDay(from) ? from : shiftDay(end, -29);
  if (start > end) start = end;
  if (daysBetween(start, end) > maxDays) start = shiftDay(end, -maxDays);
  return { from: start, to: end };
}

async function firstRow(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const bound = params.length ? stmt.bind(...params) : stmt;
  return (await bound.first()) || null;
}

async function allRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const res = await bound.all();
  return (res && res.results) || [];
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(part, whole) { return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0; }

function parseProps(raw) {
  if (!raw) return null;
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

// -------------------------------------------------------------------- OVERVIEW

/**
 * DAU/WAU/MAU (anon + signed-in), a signups trend, the 48h activation rate, and
 * paid-account counts. MRR is an ESTIMATE only, and only when the caller hands
 * in a monthly price — the real prices live in Stripe, not this repo, so a
 * number invented here would be a lie on a dashboard people trust.
 */
export async function overviewMetrics(db, opts = {}) {
  const today = opts.today || toDay(new Date());
  const nowIso = opts.nowIso || new Date().toISOString();
  const monthlyCents = Number.isFinite(Number(opts.monthlyCents)) && Number(opts.monthlyCents) > 0
    ? Math.round(Number(opts.monthlyCents)) : null;

  const activeFor = async (floorDay) => {
    const r = await firstRow(
      db,
      'SELECT COUNT(DISTINCT anon_id) a, COUNT(DISTINCT user_id) u FROM events WHERE day >= ?',
      [floorDay],
    );
    return { anon: num(r && r.a), user: num(r && r.u) };
  };
  const dau = await activeFor(today);
  const wau = await activeFor(shiftDay(today, -6));
  const mau = await activeFor(shiftDay(today, -29));

  // Signups per day over the last 30, for both the trend and the windows.
  const signupRows = await allRows(
    db,
    "SELECT day, COUNT(*) c FROM events WHERE name = 'signup_complete' AND day >= ? GROUP BY day ORDER BY day",
    [shiftDay(today, -29)],
  );
  const byDay = new Map(signupRows.map((r) => [r.day, num(r.c)]));
  const sumSince = (floorDay) => {
    let t = 0;
    for (const [d, c] of byDay) if (d >= floorDay) t += c;
    return t;
  };
  const perDay = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = shiftDay(today, -i);
    perDay.push({ day: d, count: byDay.get(d) || 0 });
  }

  // Activation: of the accounts that signed up in the last 30 days, how many did
  // an activation action within 48h of signing up. julianday keeps the window
  // correct across the ISO/UTC timestamps regardless of local offset.
  const actList = ACTIVATION_EVENTS.map((n) => `'${n}'`).join(',');
  const actRow = await firstRow(
    db,
    'SELECT COUNT(*) signups, SUM(CASE WHEN EXISTS ('
    + '  SELECT 1 FROM events a WHERE a.anon_id = s.anon_id'
    + `    AND a.name IN (${actList})`
    + '    AND julianday(a.ts) >= julianday(s.ts)'
    + `    AND julianday(a.ts) <= julianday(s.ts) + ${ACTIVATION_WINDOW_HOURS / 24.0}`
    + ') THEN 1 ELSE 0 END) activated '
    + "FROM events s WHERE s.name = 'signup_complete' AND s.day >= ?",
    [shiftDay(today, -29)],
  );
  const aSignups = num(actRow && actRow.signups);
  const aActivated = num(actRow && actRow.activated);

  // Revenue: active paid accounts by plan. An expired premium is not paid.
  const planRows = await allRows(
    db,
    "SELECT plan, COUNT(*) c FROM users WHERE plan IN ('premium','lifetime') "
    + 'AND (plan_expires_at IS NULL OR plan_expires_at > ?) GROUP BY plan',
    [nowIso],
  );
  const activeByPlan = { premium: 0, lifetime: 0 };
  for (const r of planRows) if (r.plan in activeByPlan) activeByPlan[r.plan] = num(r.c);
  const paidCount = activeByPlan.premium + activeByPlan.lifetime;

  return {
    generatedAt: nowIso,
    active: { dau, wau, mau },
    signups: { today: sumSince(today), last7: sumSince(shiftDay(today, -6)), last30: sumSince(shiftDay(today, -29)), perDay },
    activation: { windowDays: 30, thresholdHours: ACTIVATION_WINDOW_HOURS, events: ACTIVATION_EVENTS, signups: aSignups, activated: aActivated, rate: pct(aActivated, aSignups) },
    revenue: {
      paidCount,
      activeByPlan,
      // Estimate only — premium subscriptions × monthly price. Lifetime is not
      // recurring, so it is excluded from MRR by definition (still in paidCount).
      mrr: { monthlyCents, estimateCents: monthlyCents != null ? activeByPlan.premium * monthlyCents : null },
    },
  };
}

// ---------------------------------------------------------------------- FUNNEL

async function distinctAnonByName(db, from, to) {
  const rows = await allRows(
    db,
    'SELECT name, COUNT(DISTINCT anon_id) c FROM events WHERE day BETWEEN ? AND ? GROUP BY name',
    [from, to],
  );
  const m = new Map();
  for (const r of rows) m.set(r.name, num(r.c));
  return m;
}

/**
 * The discovery funnel (distinct visitors per stage, with per-stage conversion)
 * and the paywall funnel (action counts per stage + a plan_cap_hit-by-feature
 * breakdown). The paywall funnel is deliberately stage-total, not one clean
 * per-feature waterfall: each stage keys its feature under a different prop
 * (`feature` vs `source: 'cap:<f>'` vs `price`), so a joined per-feature funnel
 * would be more precise-looking than the data actually supports.
 */
export async function funnelMetrics(db, opts = {}) {
  const today = opts.today || toDay(new Date());
  const { from, to } = clampRange(opts.from, opts.to, today);

  const byName = await distinctAnonByName(db, from, to);
  const landingRow = await firstRow(
    db,
    `SELECT COUNT(DISTINCT anon_id) c FROM events WHERE name = 'page_view' AND day BETWEEN ? AND ? AND path IN (${LANDING_PATHS.map(() => '?').join(',')})`,
    [from, to, ...LANDING_PATHS],
  );

  let prev = null;
  const discovery = DISCOVERY_FUNNEL.map((s) => {
    const count = s.stage === 'landing' ? num(landingRow && landingRow.c) : (byName.get(s.event) || 0);
    const row = { stage: s.stage, label: s.label, count, pctOfPrev: prev == null ? 100 : pct(count, prev), pctOfTop: null, pending: !!s.pending };
    prev = count;
    return row;
  });
  const top = discovery.length ? discovery[0].count : 0;
  for (const r of discovery) r.pctOfTop = pct(r.count, top);

  // Paywall: stage totals (a person can hit several caps, so COUNT not DISTINCT).
  const payRows = await allRows(
    db,
    `SELECT name, COUNT(*) c FROM events WHERE name IN (${PAYWALL_STAGES.map(() => '?').join(',')}) AND day BETWEEN ? AND ? GROUP BY name`,
    [...PAYWALL_STAGES, from, to],
  );
  const payMap = new Map(payRows.map((r) => [r.name, num(r.c)]));
  const paywallStages = PAYWALL_STAGES.map((n) => ({ event: n, count: payMap.get(n) || 0 }));

  const capRows = await allRows(
    db,
    "SELECT props FROM events WHERE name = 'plan_cap_hit' AND day BETWEEN ? AND ?",
    [from, to],
  );
  const byFeature = new Map();
  for (const r of capRows) {
    const p = parseProps(r.props);
    const f = (p && typeof p.feature === 'string' && p.feature) || 'unknown';
    byFeature.set(f, (byFeature.get(f) || 0) + 1);
  }

  return {
    from,
    to,
    discovery,
    paywall: {
      stages: paywallStages,
      capsByFeature: [...byFeature.entries()].map(([feature, count]) => ({ feature, count })).sort((a, b) => b.count - a.count),
    },
  };
}

// ------------------------------------------------------------------- RETENTION

/**
 * Weekly signup cohorts × weeks-since (the classic triangle), plus the "days
 * since last action" distribution — the loop-health metric. Both derived from
 * raw events over `weeks` weeks (bounded well inside the 90-day window).
 */
export async function retentionMetrics(db, opts = {}) {
  const today = opts.today || toDay(new Date());
  const weeks = Math.min(Math.max(Number(opts.weeks) || 8, 1), 12);
  const floor = weekStart(shiftDay(today, -(weeks - 1) * 7));

  const signupRows = await allRows(
    db,
    "SELECT anon_id, MIN(day) d FROM events WHERE name = 'signup_complete' AND day >= ? GROUP BY anon_id",
    [floor],
  );
  const activityRows = await allRows(
    db,
    'SELECT DISTINCT anon_id, day FROM events WHERE day >= ?',
    [floor],
  );

  const cohortOf = new Map(); // anon -> cohort week start
  for (const r of signupRows) cohortOf.set(r.anon_id, weekStart(r.d));

  const cohortWeeks = [];
  for (let i = weeks - 1; i >= 0; i -= 1) cohortWeeks.push(weekStart(shiftDay(today, -i * 7)));
  const idxOfWeek = new Map(cohortWeeks.map((w, i) => [w, i]));

  // active[anon] = Set of week-indices in which they did anything.
  const activeWeeks = new Map();
  for (const r of activityRows) {
    const wi = idxOfWeek.get(weekStart(r.day));
    if (wi == null) continue;
    if (!activeWeeks.has(r.anon_id)) activeWeeks.set(r.anon_id, new Set());
    activeWeeks.get(r.anon_id).add(wi);
  }

  const cohorts = cohortWeeks.map((w, ci) => {
    const members = [];
    for (const [anon, cw] of cohortOf) if (cw === w) members.push(anon);
    const maxOffset = weeks - 1 - ci;
    const retained = [];
    for (let off = 0; off <= maxOffset; off += 1) {
      let n = 0;
      for (const anon of members) {
        const set = activeWeeks.get(anon);
        if (set && set.has(ci + off)) n += 1;
      }
      retained.push({ offset: off, count: n, pct: pct(n, members.length) });
    }
    return { cohortWeek: w, size: members.length, retained };
  });

  // Days since last action, per distinct anon, over the whole retained window.
  const lastRows = await allRows(db, 'SELECT anon_id, MAX(ts) m FROM events GROUP BY anon_id');
  const buckets = [
    { bucket: '0–1d', min: 0, max: 1 },
    { bucket: '2–7d', min: 2, max: 7 },
    { bucket: '8–30d', min: 8, max: 30 },
    { bucket: '31–90d', min: 31, max: 90 },
    { bucket: '90d+', min: 91, max: Infinity },
  ].map((b) => ({ ...b, count: 0 }));
  const nowMs = Date.parse((opts.nowIso || new Date().toISOString()));
  for (const r of lastRows) {
    const t = Date.parse(r.m);
    if (!Number.isFinite(t)) continue;
    const days = Math.floor((nowMs - t) / 86400000);
    const b = buckets.find((x) => days >= x.min && days <= x.max) || buckets[buckets.length - 1];
    b.count += 1;
  }

  return { weeks, cohortWeeks, cohorts, recency: buckets.map(({ bucket, count }) => ({ bucket, count })) };
}

// -------------------------------------------------------------- FEATURE USAGE

/**
 * Events/uniques per watched feature per week, from events_daily (additive,
 * exact, cheap). `uniqueDays` is the SUM of daily uniques — an upper bound on
 * distinct people for the week, labelled as such rather than pretending to be a
 * true weekly unique count. Zero-use features are the callout list.
 */
export async function featureUsage(db, opts = {}) {
  const today = opts.today || toDay(new Date());
  const weeks = Math.min(Math.max(Number(opts.weeks) || 8, 1), 12);
  const floor = weekStart(shiftDay(today, -(weeks - 1) * 7));

  const rows = await allRows(
    db,
    'SELECT day, name, count, uniques_anon FROM events_daily WHERE day >= ?',
    [floor],
  );
  const cohortWeeks = [];
  for (let i = weeks - 1; i >= 0; i -= 1) cohortWeeks.push(weekStart(shiftDay(today, -i * 7)));
  const idxOfWeek = new Map(cohortWeeks.map((w, i) => [w, i]));

  // name -> [{events, uniqueDays} per week idx]
  const perName = new Map();
  const blank = () => cohortWeeks.map(() => ({ events: 0, uniqueDays: 0 }));
  for (const r of rows) {
    const wi = idxOfWeek.get(weekStart(r.day));
    if (wi == null) continue;
    if (!perName.has(r.name)) perName.set(r.name, blank());
    const cell = perName.get(r.name)[wi];
    cell.events += num(r.count);
    cell.uniqueDays += num(r.uniques_anon);
  }

  const featureRows = WATCHED_FEATURES.map((f) => {
    const cells = perName.get(f.event) || blank();
    const total = cells.reduce((s, c) => s + c.events, 0);
    return { key: f.key, label: f.label, event: f.event, perWeek: cells, total };
  });
  const zeroUse = featureRows.filter((f) => f.total === 0).map((f) => ({ key: f.key, label: f.label, event: f.event }));

  return { weeks, cohortWeeks, features: featureRows, zeroUse };
}

// ------------------------------------------------------------------- SOURCES

// Each token is bounded by a domain-label delimiter on BOTH sides — `(^|\.)` on
// the left, `(\.|$)` on the right — so the SAME list matches a full referrer
// host (`www.linkedin.com`, `twitter.com`), a bare utm_source token (`twitter`,
// `x`, `ig`), AND an apex shortener that has no further label (`t.co`, `wa.me`,
// `youtu.be`). A hard trailing `\.` (the earlier bug) silently dropped `t.co`
// — the canonical Twitter/X web referrer — and bare `x`/`ig`/`fb` utm tokens
// into their own channel rows. The right boundary must be `(\.|$)`, NOT `\.?`:
// an optional dot would let the single-letter `x` token match `xyz.com`.
const CHANNEL_HOSTS = [
  { test: /(^|\.)linkedin(\.|$)/i, channel: 'linkedin' },
  { test: /(^|\.)(instagram|ig)(\.|$)/i, channel: 'instagram' },
  { test: /(^|\.)(wa\.me|whatsapp)(\.|$)/i, channel: 'whatsapp' },
  { test: /(^|\.)(t\.co|twitter|x)(\.|$)/i, channel: 'twitter' },
  { test: /(^|\.)(facebook|fb)(\.|$)/i, channel: 'facebook' },
  { test: /(^|\.)(youtube|youtu\.be)(\.|$)/i, channel: 'youtube' },
  { test: /(^|\.)reddit(\.|$)/i, channel: 'reddit' },
  { test: /(^|\.)google(\.|$)/i, channel: 'google' },
];

/** First-touch attribution → a coarse channel label. utm_source wins; then ref host. */
export function classifyChannel(utmSource, utmMedium, ref) {
  const src = String(utmSource || '').trim().toLowerCase();
  const med = String(utmMedium || '').trim().toLowerCase();
  if (med === 'referral' || src === 'referral' || src === 'refer') return 'referral';
  if (src) {
    for (const h of CHANNEL_HOSTS) if (h.test.test(src)) return h.channel;
    return src.slice(0, 24);
  }
  const host = String(ref || '').trim().toLowerCase();
  if (host) {
    for (const h of CHANNEL_HOSTS) if (h.test.test(host)) return h.channel;
    return host.slice(0, 24);
  }
  return 'organic';
}

/**
 * First-touch channel → visitors / signups / activations. Attribution is stamped
 * on every row, so each anon's channel is read from their earliest row and then
 * their behaviour is tallied against it.
 */
export async function sourceAttribution(db, opts = {}) {
  const today = opts.today || toDay(new Date());
  const { from, to } = clampRange(opts.from, opts.to, today);

  const rows = await allRows(
    db,
    "SELECT anon_id, ts, utm_source, utm_medium, ref, name FROM events "
    + "WHERE day BETWEEN ? AND ? AND name IN ('page_view','session_start','signup_complete','roadmap_generated') "
    + 'ORDER BY ts ASC',
    [from, to],
  );

  const channelOf = new Map(); // anon -> channel (first row wins, ORDER BY ts ASC)
  const did = new Map(); // anon -> { signup, activated }
  for (const r of rows) {
    if (!channelOf.has(r.anon_id)) channelOf.set(r.anon_id, classifyChannel(r.utm_source, r.utm_medium, r.ref));
    if (!did.has(r.anon_id)) did.set(r.anon_id, { signup: false, activated: false });
    if (r.name === 'signup_complete') did.get(r.anon_id).signup = true;
    if (r.name === 'roadmap_generated') did.get(r.anon_id).activated = true;
  }

  const agg = new Map(); // channel -> {visitors, signups, activations}
  for (const [anon, channel] of channelOf) {
    if (!agg.has(channel)) agg.set(channel, { channel, visitors: 0, signups: 0, activations: 0 });
    const a = agg.get(channel);
    a.visitors += 1;
    const d = did.get(anon);
    if (d && d.signup) a.signups += 1;
    if (d && d.activated) a.activations += 1;
  }

  const channels = [...agg.values()].sort((a, b) => b.visitors - a.visitors);
  for (const c of channels) { c.signupRate = pct(c.signups, c.visitors); c.activationRate = pct(c.activations, c.visitors); }
  return { from, to, channels };
}

// ------------------------------------------------------------------ LIVE TAIL

/** The last N events for debugging instrumentation. No user_id/email — the tail
 *  is a firehose an admin watches live, and the anon short-id is enough to
 *  follow one session without putting an address on screen. */
export async function liveTail(db, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 200);
  const rows = await allRows(
    db,
    'SELECT ts, name, path, anon_id, ua_class, props FROM events ORDER BY ts DESC LIMIT ?',
    [limit],
  );
  return {
    limit,
    events: rows.map((r) => ({
      ts: r.ts,
      name: r.name,
      path: r.path,
      anon: String(r.anon_id || '').slice(0, 8),
      ua: r.ua_class,
      props: parseProps(r.props),
    })),
  };
}

// ---------------------------------------------------------------- ERROR LOG

/** The last N server errors + a route→count rollup over `sinceDays`. The
 *  self-hosted stand-in for Sentry (masterplan §5 S3). */
export async function recentServerErrors(db, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const today = opts.today || toDay(new Date());
  const sinceDays = Math.min(Math.max(Number(opts.sinceDays) || 7, 1), 90);
  const sinceDay = shiftDay(today, -(sinceDays - 1));

  const recent = await allRows(
    db,
    'SELECT ts, route, message, detail FROM server_errors ORDER BY ts DESC LIMIT ?',
    [limit],
  );
  const byRouteRows = await allRows(
    db,
    'SELECT route, COUNT(*) c FROM server_errors WHERE day >= ? GROUP BY route ORDER BY c DESC',
    [sinceDay],
  );
  return {
    limit,
    sinceDays,
    recent: recent.map((r) => ({ ts: r.ts, route: r.route, message: r.message, detail: r.detail })),
    byRoute: byRouteRows.map((r) => ({ route: r.route, count: num(r.c) })),
  };
}
