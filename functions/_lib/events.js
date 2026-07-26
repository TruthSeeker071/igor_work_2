// FlightWay V2 S1 — the analytics event contract, shared by everything.
//
// One module so the beacon endpoint (functions/events.js), the Stripe webhook's
// server-side writes, the cron rollup (workers/cron) and the gate
// (scripts/test-events.mjs) all agree on what an event IS. Nothing here touches
// the network or the DOM; it is pure so the gate can execute every rule.
//
// Three invariants this file exists to hold:
//   1. NAME DISCIPLINE — the events table's cardinality is bounded, so the S3
//      dashboards stay meaningful and a stranger POSTing junk cannot invent
//      3,000 event names. REGISTERED_EVENTS is the exact allowlist and must
//      stay in lockstep with docs/EVENTS.md (the gate asserts parity in both
//      directions). ALLOWED_PREFIXES is the second tier: a well-formed name on
//      a known surface is accepted even if a future session forgot to register
//      it, because silently dropping a real event is worse than a stray row.
//   2. NO PII IN PROPS — user linkage is the user_id column and nothing else.
//      scrubProps drops banned keys, email-shaped values, long free text and
//      anything nested. It is a lint with teeth, not a convention.
//   3. NOTHING THROWS AT THE USER — every helper degrades to "drop it" rather
//      than raise. The beacon's contract with the page is that it can never be
//      the reason something breaks.

/**
 * The kill switch (D19). Analytics is ON by default — a deployment that
 * forgets an env var should still be able to see itself — and goes dark only
 * when someone explicitly sets ANALYTICS_ENABLED to a falsey string. Served to
 * the client on /config so one env flip stops the beacon everywhere at once.
 */
export function analyticsEnabled(env) {
  const raw = env && env.ANALYTICS_ENABLED != null ? String(env.ANALYTICS_ENABLED).trim().toLowerCase() : '';
  if (!raw) return true;
  return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no');
}

export const MAX_BATCH = 20;
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_PROPS_BYTES = 1024;
export const MAX_NAME_LEN = 40;
export const MAX_PATH_LEN = 120;
export const MAX_STRING_PROP_LEN = 64;
export const EVENTS_RETENTION_DAYS = 90;

/**
 * The exact allowlist. Mirrors docs/EVENTS.md — every name here has a row
 * there, and every row there is here (gate: test:events).
 *
 * The first block is the 22 events that predate S1: their names are LIVE in
 * localStorage ring buffers on real browsers, so they are never renamed.
 */
export const REGISTERED_EVENTS = new Set([
  // --- pre-S1 (unchanged names) ---
  'artifact_modal', 'artifact_saved', 'nudge_optin', 'flightplan_done', 'flightplan_view',
  'resume_tailor', 'resume_guided_build', 'plan_cap_hit', 'career_compare_open',
  'why_match_open', 'ai_exposure_view', 'firmup_start', 'sim_share_download',
  'sim_share_native', 'mockiv_start', 'mockiv_debrief', 'mockiv_open', 'pricing_view',
  'pricing_period', 'pricing_checkout_error', 'pricing_click', 'pricing_intent_email',
  // The masterplan's §2 audit counted 22; feature-intro.js's five were missed
  // (four of them built by string concat, which is why a grep for a literal
  // name never found them). Registered here so the beacon keeps them.
  'feature_intro_shown', 'feature_intro_completed', 'feature_intro_skipped',
  'feature_intro_upgraded', 'feature_ribbon_dismissed',

  // --- S1: visit context (emitted by events.js itself) ---
  'page_view', 'session_start', 'identify',

  // --- S1: quiz funnel ---
  'quiz_start', 'quiz_q_view', 'quiz_q_answer', 'quiz_complete',
  'gate_view', 'gate_signup_click',

  // --- S1: account ---
  'signup_complete', 'login',

  // --- S1: the development loop ---
  'roadmap_generated', 'roadmap_committed', 'roadmap_extend',
  'tree_interact', 'step_done', 'skill_gap_view', 'opp_search', 'nav_click',

  // --- S1: monetization ---
  'paywall_view', 'upgrade_click', 'checkout_start',
  // server-written (Stripe webhook) — no browser required
  'checkout_success', 'plan_changed',

  // --- S2: trust surfaces ---
  // Server-written from POST /contact, so the count survives a student closing
  // the tab on the success screen. `contact_` is not a registered prefix —
  // there is exactly one contact event and there is no reason to open a whole
  // namespace for it.
  'contact_submitted',

  // --- S4: email infrastructure. verify_/email_ are already prefix-allowlisted,
  // but these four are canonical §6 names, so register them explicitly (parity
  // with EVENTS.md is asserted by test:events). All server-written: verify_sent
  // (register/resend), verify_done (verify handler), email_sent (the sendMail
  // chokepoint), email_unsub (the unsubscribe handler, prop = category).
  'verify_sent', 'verify_done', 'email_sent', 'email_unsub',

  // --- S6: the post-quiz reveal (D5). reveal_view fires when the match-card
  // interstitial renders; reveal_card_expand when a card's factor breakdown is
  // opened; gate_google_click on the reveal gate's "Continue with Google" (it
  // sits on the gate_ prefix but is registered for EVENTS.md parity, like
  // gate_view/gate_signup_click). signup_complete gains a `source` prop (S6) —
  // props are not parity-checked, so only the doc changes for that.
  'reveal_view', 'reveal_card_expand', 'gate_google_click',

  // --- S9: the Deadline Radar (D12). The three deadline_* are client-written
  // from the radar module; `radar_refresh` has TWO writers — the client on the
  // student's own Refresh button (source:'manual') and logServerEvent from the
  // nightly cron sweep (source:'cron'), so an unattended refresh still lands in
  // the funnel. §6's `deadline_alert_click` is deliberately absent: the alert
  // email's CTA carries UTM, so a click is already an attributed `page_view`,
  // and FlightWay does not open-track (§9 non-goal).
  'deadline_saved', 'deadline_dismissed', 'deadline_done', 'radar_refresh',

  // --- S10: commitments, micro-steps, Marco follow-through. The three
  // commitment_* and step_breakdown are client-written (roadmap drawer +
  // Flight Plan module). `marco_callback_shown` is server-written from
  // chat.js and counts the callback OPPORTUNITY — the block was assembled and
  // handed to the model at the opening of a conversation — not proof the reply
  // used it. The server cannot know the second thing, and a client-side regex
  // over Marco's prose pretending to know it would be a worse number than none.
  'commitment_set', 'commitment_cleared', 'commitment_done', 'commitment_rescheduled',
  'step_breakdown', 'marco_callback_shown',

  // --- S11: lifecycle completion. `review_viewed` is client-written when
  // review.html renders a month (once per month rendered, not per fetch).
  // Deliberately the ONLY new name: the digest's own sends already arrive as
  // `email_sent{type}` from the shared chokepoint, an admin queueing a
  // broadcast is an admin action recorded in `admin_audit_log` rather than
  // product behaviour, and a digest CLICK arrives as a UTM-attributed
  // `page_view` (FlightWay does not open-track — §9).
  'review_viewed',

  // --- S12: Evidence Locker + Application Tracker. All client-written.
  // `evidence_added` is deliberately ABSENT: `artifact_saved` has counted every
  // add since before S1 and registering a second name for the same click would
  // split one funnel across two metrics. The locker's own adds go through the
  // same modal and the same event.
  // `tracker_tailor_click` / `tracker_practice_click` count the INTENT to use
  // the tool from a specific application — the tool's own start event
  // (`resume_tailor`, `mockiv_start`) still counts the run, so the drop-off
  // between "opened it from an application" and "actually ran it" is one join.
  'evidence_viewed', 'evidence_edited', 'evidence_deleted',
  'application_saved', 'application_stage_change', 'application_removed',
  'tracker_tailor_click', 'tracker_practice_click',

  // --- S13: the public, server-rendered career pages. Both client-written,
  // from inline scripts in the rendered HTML (functions/_lib/career-page.js) —
  // so the call sites are NOT under assets/js and test:events' literal-name
  // lint does not see them. `career_cta_click` is the SEO channel's only
  // conversion number: stranger arrives from search → stranger starts the quiz.
  // There is deliberately NO server-side page_view for /careers/*: logServerEvent
  // writes anon_id 'server' with null ref/utm, which is precisely what the
  // Sources panel dedupes and classifies on. See docs/EVENTS.md.
  'career_cta_click', 'career_index_search',

  // --- S14: the guides hub. Same shape and the same lint caveat as the two
  // above — written from an inline script in `functions/_lib/guides.js`, so no
  // call site under assets/js. `placement` is 'end' (the CTA at the foot of a
  // guide) or 'index' (the hub's own CTA); `slug` is the guide, or 'index'.
  'guide_cta_click',

  // --- S15: share + referral. Mixed writers, and which is which matters when
  // reading the funnel:
  //   share_created      client, on the surface the card was made from
  //   share_view         SERVER, from /s/<id> — the viewer has no FlightWay
  //                      session and no beacon, so the page is the only witness
  //   referral_visit     SERVER, from /r/<code>, bot-filtered like the beacon
  //   referral_signup    client, off the `referred` flag POST /auth/register
  //                      returns (the bind happens server-side, so the browser
  //                      has no other way to know it happened)
  //   referral_converted SERVER, from the Stripe webhook. Fires TWICE per
  //                      referral by design — once at `converted`, once at
  //                      `credited` — because a gap between those two is the
  //                      single most important thing this funnel can show.
  //   referral_copy      client, from /invite: which channel someone actually
  //                      copied. The one number that makes manual outreach
  //                      improvable, and its call site is an inline script in
  //                      functions/invite.js (same lint caveat as S13/S14).
  'share_created', 'share_view',
  'referral_visit', 'referral_signup', 'referral_converted', 'referral_copy',

  // --- S16: the live-posting readiness scorecard.
  //   scorecard_run              SERVER, from the endpoint AND the quarterly
  //                              cron — `source` says which. It is written
  //                              server-side because the quarterly run has no
  //                              browser at all, and a metric that only counted
  //                              the runs someone watched would undercount the
  //                              product's own spending.
  //   scorecard_viewed           client, once per mount that renders a report.
  //   scorecard_action_committed client, when one of the three actions becomes
  //                              a roadmap step. This is the conversion the
  //                              whole feature exists for: a readiness number
  //                              nobody acts on is a horoscope.
  'scorecard_run', 'scorecard_viewed', 'scorecard_action_committed',

  // --- S17: the network mapper.
  //   outreach_draft    SERVER, from POST /outreach {action:'draft'} — the only
  //                     one of the three that is an observation rather than a
  //                     report, because it is the only one FlightWay does. Its
  //                     `repairs` prop is the honesty metric here, the way
  //                     `downgraded` is for the scorecard: it counts how often
  //                     the model had to be corrected before a student saw the
  //                     draft (an invented name, an invented link, a template
  //                     sentence). Rising `repairs` means the prompt is drifting.
  //   outreach_sent     client, when the student says they sent it. FlightWay
  //                     never sends anything and cannot observe this — it is
  //                     their report, which is exactly why it is worth logging:
  //                     draft→sent is where this feature is won or lost.
  //   outreach_replied  client. Carries `status`, because 'met' rides this name
  //                     rather than a fourth one — 'met' is a stronger outcome
  //                     on the same funnel, and splitting it would halve the
  //                     reply number this feature is judged on.
  'outreach_draft', 'outreach_sent', 'outreach_replied',

  // --- S18: Interview Season Mode + the Semester Loop.
  //   season_started   SERVER, from POST /interview-season {action:'start'}.
  //                    Carries `family` and `formatSource` — the second is this
  //                    feature's honesty metric, the way `repairs` is S17's: it
  //                    says whether the round list the student is reading came
  //                    off the live web or out of this repo's own playbook.
  //                    Nothing else in the funnel can distinguish those two, and
  //                    they are very different products.
  //   mock_completed   SERVER, from the mock-interview debrief. §6 lists it in
  //                    the client taxonomy, but the SCORE is computed and
  //                    persisted server-side (interview-core.js weights the
  //                    composite; the model never returns an overall), so the
  //                    server is the only place that can log it without a client
  //                    re-deriving a number it does not own. Carries `week` and
  //                    a season flag, which is the only way to tell a scheduled
  //                    session apart from an ad-hoc one.
  //   semester_setup   client, when the start-of-term ritual is completed.
  //                    Carries how many outcomes were picked and how many
  //                    commitments were actually seeded — those two disagree
  //                    when the current waypoint is at its step ceiling, which
  //                    is a real product wall nobody would otherwise see.
  //   semester_review  client, when the end-of-term review is opened. Carries
  //                    `granted`: whether this was the run that claimed the
  //                    term's one bonus roadmap regeneration.
  'season_started', 'mock_completed', 'semester_setup', 'semester_review',

  // --- S19: the business surface (D28, D16, D14).
  //   nps_shown        client, and it has to be: only the browser knows the card
  //                    actually rendered. Carries `moment`, so the response rate
  //                    can be read per surface — the same ask lands very
  //                    differently after a month review than after a checkbox.
  //   nps_scored       SERVER, from POST /nps. §6 lists it under the client
  //                    taxonomy; the row is already durable in `nps_responses`
  //                    by the time the response returns, and a client beacon
  //                    queued behind a navigation away from the card would leave
  //                    the table and the funnel disagreeing about the same
  //                    event. Same call contact.js makes for `contact_submitted`.
  //                    Carries `status`, so a DISMISSAL is counted too — the
  //                    denominator is the whole point of a frequency-capped ask.
  //   testimonial_given SERVER, from POST /testimonials. Its two props are
  //                    `named` and `schooled`: whether the student consented to
  //                    print each. Consent rate is the number that decides
  //                    whether this feature produces usable proof or a queue of
  //                    anonymous sentences.
  //   pilot_requested  client, from the /career-centers form. Carries the
  //                    cohort-size band, which is the only segmentation a B2B
  //                    funnel of this size can support.
  //   waitlist_joined  client, from /community. Carries `list` so a second
  //                    waitlist later does not need a second event name.
  'nps_shown', 'nps_scored', 'testimonial_given', 'pilot_requested', 'waitlist_joined',
]);

/**
 * Tier 2. A name that is not registered but is well-formed AND sits on a known
 * product surface is still accepted, so the failure mode of "a later session
 * shipped an event and forgot this file" is a stray row, not lost data.
 */
export const ALLOWED_PREFIXES = [
  'quiz_', 'gate_', 'roadmap_', 'tree_', 'step_', 'nav_', 'marco_', 'opp_',
  'resume_', 'plan_', 'paywall_', 'upgrade_', 'checkout_', 'referral_', 'share_',
  'nps_', 'deadline_', 'radar_', 'commitment_', 'evidence_', 'application_',
  'tracker_', 'outreach_', 'scorecard_', 'season_', 'semester_', 'mock_', 'mockiv_',
  'review_', 'email_', 'flightplan_', 'artifact_', 'pricing_', 'sim_', 'career_',
  'deep_', 'thisweek_', 'skill_', 'testimonial_', 'server_', 'signup_', 'verify_',
  // feature-intro.js composes `'feature_intro_' + outcome` at runtime, so the
  // prefix is the only guarantee a future outcome value survives the beacon.
  'feature_',
];

const NAME_SHAPE = /^[a-z][a-z0-9_]{2,39}$/;

export function isAllowedName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name || name.length > MAX_NAME_LEN) return false;
  if (REGISTERED_EVENTS.has(name)) return true;
  if (!NAME_SHAPE.test(name)) return false;
  return ALLOWED_PREFIXES.some((p) => name.startsWith(p));
}

// ---------------------------------------------------------------------------
// User-agent classification. Bots are dropped entirely: a crawler's page_view
// is not a visit, and letting them in would quietly double every funnel top.

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|phantomjs|puppeteer|playwright|lighthouse|curl\/|wget|python-requests|axios\/|okhttp|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|slackbot|discordbot|preview|monitor|pingdom|uptime|gtmetrix|ahrefs|semrush|mj12|dotbot|petalbot|yandex|baiduspider|duckduckbot|applebot|gptbot|claudebot|perplexitybot|ccbot/i;
const MOBILE_RE = /mobi|android|iphone|ipod|ipad|windows phone|blackberry|opera mini/i;

export function classifyUa(raw) {
  const ua = String(raw == null ? '' : raw);
  if (!ua) return 'bot'; // no UA at all is a script, not a student
  if (BOT_RE.test(ua)) return 'bot';
  if (MOBILE_RE.test(ua)) return 'mobile';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// PII lint. Props carry shape, never identity.

/** Exact (normalized) keys that are identity by definition. */
const BANNED_KEYS = new Set([
  'email', 'emails', 'mail', 'name', 'names', 'fullname', 'firstname', 'lastname',
  'username', 'user', 'password', 'passwd', 'pass', 'secret', 'token', 'apikey',
  'phone', 'tel', 'address', 'street', 'city', 'zip', 'zipcode', 'postcode',
  'ssn', 'dob', 'birthday', 'birthdate', 'gpa', 'school', 'university', 'college',
  'ip', 'ipaddress', 'query', 'q', 'text', 'answer', 'answers', 'note', 'notes',
  'message', 'body', 'content', 'prompt', 'description',
]);

/** Substrings that are never innocent, wherever they appear in a key. */
const BANNED_KEY_PARTS = ['email', 'password', 'secret', 'apikey', 'ssn', 'authtoken'];

const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;

function normalizeKey(k) {
  return String(k == null ? '' : k).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isBannedPropKey(key) {
  const n = normalizeKey(key);
  if (!n) return true;
  if (BANNED_KEYS.has(n)) return true;
  return BANNED_KEY_PARTS.some((p) => n.includes(p));
}

/**
 * Flatten one props object into something safe to store.
 * Returns { props: object|null, dropped: string[] } — never throws.
 *
 * Rules, in order: banned key → drop. Nested value → drop (props are flat by
 * contract; a nested object is where free text hides). Email-shaped string →
 * drop. String over 64 chars → drop (enums and slugs are short; anything longer
 * is prose, and prose is where a school name or an essay answer lives).
 * Non-finite number → drop. Whole object over 1KB → truncated key by key.
 */
export function scrubProps(raw) {
  const dropped = [];
  if (raw == null) return { props: null, dropped };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { props: null, dropped: ['<non-object>'] };

  const out = {};
  let kept = 0;
  for (const key of Object.keys(raw)) {
    if (kept >= 24) { dropped.push(key); continue; }
    if (isBannedPropKey(key)) { dropped.push(key); continue; }
    const v = raw[key];
    if (v === null) { out[key] = null; kept++; continue; }
    const t = typeof v;
    if (t === 'boolean') { out[key] = v; kept++; continue; }
    if (t === 'number') {
      if (!Number.isFinite(v)) { dropped.push(key); continue; }
      out[key] = v; kept++; continue;
    }
    if (t === 'string') {
      const s = v.trim();
      if (!s) { out[key] = ''; kept++; continue; }
      if (EMAILISH.test(s)) { dropped.push(key); continue; }
      if (s.length > MAX_STRING_PROP_LEN) { dropped.push(key); continue; }
      out[key] = s; kept++; continue;
    }
    dropped.push(key); // objects, arrays, functions, undefined, symbols
  }

  if (!kept) return { props: null, dropped };

  // Size cap. Shed the largest keys until it fits rather than storing a
  // truncated string that would no longer parse as JSON.
  let json = JSON.stringify(out);
  if (json.length > MAX_PROPS_BYTES) {
    const byCost = Object.keys(out).sort((a, b) => JSON.stringify(out[b]).length - JSON.stringify(out[a]).length);
    for (const key of byCost) {
      delete out[key];
      dropped.push(key);
      json = JSON.stringify(out);
      if (json.length <= MAX_PROPS_BYTES) break;
    }
  }
  return { props: Object.keys(out).length ? out : null, dropped };
}

// ---------------------------------------------------------------------------
// Batch sanitation.

export function dayFromIso(iso) {
  return String(iso || '').slice(0, 10);
}

/** Path only — a query string is where a share token or an email ends up. */
export function cleanPath(raw) {
  let p = String(raw == null ? '' : raw).trim();
  if (!p) return '/';
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  if (!p.startsWith('/')) p = '/' + p;
  return p.slice(0, MAX_PATH_LEN);
}

function shortString(raw, max) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (EMAILISH.test(s)) return null;
  return s.slice(0, max);
}

/** Referrer → bare host. Full referrer URLs leak paths (and sometimes tokens). */
export function refHost(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.hostname.slice(0, 80) || null;
  } catch {
    return shortString(s.replace(/^https?:\/\//, '').split('/')[0], 80);
  }
}

/**
 * Turn one posted body into rows ready for D1. Pure: the caller supplies the
 * identity bits it alone can be trusted for (anon id is client-owned, user id
 * comes from the SESSION and never from the body, ts is server time).
 *
 * Returns { rows, rejected } — rejected is a count, kept for the gate and for
 * a future admin "instrumentation health" readout. Never throws.
 */
export function sanitizeBatch(body, ctx = {}) {
  const nowIso = ctx.nowIso || new Date().toISOString();
  const anonId = shortString(body && body.anon, 64);
  const userId = ctx.userId || null;
  const uaClass = ctx.uaClass || 'desktop';
  const newId = ctx.newId || (() => cryptoRandomId());

  const list = body && Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const attribution = (body && typeof body.attr === 'object' && body.attr) || {};
  const rows = [];
  let rejected = (body && Array.isArray(body.events) ? body.events.length : 0) - list.length;

  if (!anonId) return { rows: [], rejected: rejected + list.length };

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') { rejected++; continue; }
    const name = String(raw.n || raw.name || '').trim();
    if (!isAllowedName(name)) { rejected++; continue; }
    const { props } = scrubProps(raw.p || raw.props || null);
    rows.push({
      id: newId(),
      ts: nowIso,
      day: dayFromIso(nowIso),
      anon_id: anonId,
      user_id: userId,
      name,
      path: cleanPath(raw.path || (body && body.path) || '/'),
      props: props ? JSON.stringify(props) : null,
      ref: refHost(attribution.ref),
      utm_source: shortString(attribution.utm_source, 60),
      utm_medium: shortString(attribution.utm_medium, 60),
      utm_campaign: shortString(attribution.utm_campaign, 60),
      ua_class: uaClass,
    });
  }
  return { rows, rejected };
}

export const INSERT_EVENT_SQL = 'INSERT INTO events '
  + '(id, ts, day, anon_id, user_id, name, path, props, ref, utm_source, utm_medium, utm_campaign, ua_class) '
  + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

export function bindEventRow(stmt, row) {
  return stmt.bind(
    row.id, row.ts, row.day, row.anon_id, row.user_id, row.name, row.path,
    row.props, row.ref, row.utm_source, row.utm_medium, row.utm_campaign, row.ua_class,
  );
}

/** One batch() per request — 20 round trips would be 20 chances to time out. */
export async function writeEvents(db, rows) {
  if (!db || !rows || !rows.length) return 0;
  const stmt = db.prepare(INSERT_EVENT_SQL);
  await db.batch(rows.map((r) => bindEventRow(stmt, r)));
  return rows.length;
}

export function cryptoRandomId() {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    if (c && typeof c.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Write ONE server-side event (Stripe webhook, cron, future logServerError).
 * Best-effort by construction: a webhook must never fail Stripe's delivery —
 * and therefore trigger a retry storm — because an analytics insert threw.
 */
export async function logServerEvent(env, name, opts = {}) {
  try {
    if (!env || !env.DB || !isAllowedName(name)) return false;
    if (!analyticsEnabled(env)) return false; // one env var stops every writer
    const nowIso = new Date().toISOString();
    const { props } = scrubProps(opts.props || null);
    const row = {
      id: cryptoRandomId(),
      ts: nowIso,
      day: dayFromIso(nowIso),
      anon_id: opts.anonId || 'server',
      user_id: opts.userId || null,
      name,
      path: cleanPath(opts.path || '/server'),
      props: props ? JSON.stringify(props) : null,
      ref: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      ua_class: 'server',
    };
    await bindEventRow(env.DB.prepare(INSERT_EVENT_SQL), row).run();
    return true;
  } catch (err) {
    console.warn('logServerEvent failed', name, err && err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Server error log — the self-hosted stand-in for Sentry (S3). Writes one row
// to server_errors from the top catch of a high-traffic function.

export const MAX_ERR_MESSAGE_LEN = 500;
export const MAX_ERR_DETAIL_LEN = 1000;

/** Redact PII-shaped substrings so the error log never becomes a PII store:
 *  an email ("invalid email a@b.com"), an IPv4 address, or a long hex / base64url
 *  run (a session token, id, or hash) can all ride in on a message or a stack.
 *  The panel is admin-only, but an ops log is the last place a leaked secret
 *  should be allowed to settle. Email is masked first so its host is not then
 *  re-scanned by the token rules. */
function redactPii(s) {
  return String(s == null ? '' : s)
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/g, '<redacted>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '<token>')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<token>');
}

/**
 * Log an unhandled SERVER error. Best-effort by construction: it swallows its
 * own failure and returns a boolean, so wiring it into a catch block can never
 * turn a handled 500 into an unhandled crash. Unlike logServerEvent it does NOT
 * consult analyticsEnabled — an operational error log carries no user identity
 * (route + message + a stack head, PII redacted) and must stay visible even when
 * the analytics beacon is switched off, which is exactly when you are debugging.
 *
 * User-caused 4xx throws (the rate-limit 429 that reaches an outer catch in
 * career-roadmap / career-analysis) are NOT server errors and are dropped here,
 * so an abuse wave cannot bury a real crash under throttle noise — the one
 * moment the panel most needs to stay readable. 5xx and unclassified throws
 * (including the 502 upstream-gateway failures) still log.
 */
export async function logServerError(env, route, err, extra = {}) {
  try {
    if (!env || !env.DB) return false;
    const status = Number((err && err.status) != null ? err.status : (extra && extra.status));
    if (Number.isFinite(status) && status >= 400 && status < 500) return false;
    const nowIso = new Date().toISOString();
    const message = redactPii((err && err.message) || err || 'error').slice(0, MAX_ERR_MESSAGE_LEN);
    let detail = null;
    try {
      const d = {};
      if (extra && extra.status != null) d.status = extra.status;
      if (err && err.stack) d.stack = redactPii(err.stack).split('\n').slice(0, 4).join(' | ');
      if (extra && extra.detail != null) d.detail = redactPii(String(extra.detail)).slice(0, 300);
      const json = JSON.stringify(d);
      detail = json === '{}' ? null : json.slice(0, MAX_ERR_DETAIL_LEN);
    } catch { detail = null; }
    await env.DB.prepare(
      'INSERT INTO server_errors (id, ts, day, route, message, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(cryptoRandomId(), nowIso, dayFromIso(nowIso), String(route || '').slice(0, 120), message, detail).run();
    return true;
  } catch (e) {
    console.warn('logServerError failed', route, e && e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rollup + retention (run daily from the cron worker).

export function utcDayString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function previousDay(dayStr) {
  const d = new Date(dayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function shiftDay(dayStr, deltaDays) {
  const d = new Date(dayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export const ROLLUP_SELECT_SQL = 'SELECT name, COUNT(*) AS count, '
  + 'COUNT(DISTINCT anon_id) AS uniques_anon, '
  + 'COUNT(DISTINCT user_id) AS uniques_user '
  + 'FROM events WHERE day = ? GROUP BY name';

/**
 * Aggregate one day into events_daily. Idempotent on purpose: it deletes the
 * day first, so a cron retry (or a manual re-run after a bad deploy) can never
 * double-count. Returns the number of (day, name) rows written.
 */
export async function rollupDay(db, day) {
  if (!db || !day) return 0;
  const res = await db.prepare(ROLLUP_SELECT_SQL).bind(day).all();
  const rows = (res && res.results) || [];
  const stmts = [db.prepare('DELETE FROM events_daily WHERE day = ?').bind(day)];
  const ins = db.prepare(
    'INSERT INTO events_daily (day, name, count, uniques_anon, uniques_user) VALUES (?, ?, ?, ?, ?)',
  );
  for (const r of rows) {
    stmts.push(ins.bind(day, r.name, Number(r.count) || 0, Number(r.uniques_anon) || 0, Number(r.uniques_user) || 0));
  }
  await db.batch(stmts);
  return rows.length;
}

/** Drop raw events older than the retention window. events_daily is forever. */
export async function pruneEvents(db, today, retentionDays = EVENTS_RETENTION_DAYS) {
  if (!db || !today) return null;
  const cutoff = shiftDay(today, -Math.abs(retentionDays));
  const res = await db.prepare('DELETE FROM events WHERE day < ?').bind(cutoff).run();
  return { cutoff, changes: (res && res.meta && res.meta.changes) || 0 };
}
