// gate: test:emails — the durable proof for V2 S4 email infrastructure.
//
// Runs the pure template/footer contract, then loads the REAL migrations into
// node:sqlite (so a column typo or a broken grandfather UPDATE fails here, not in
// production) and exercises the whole server surface end to end: the grandfather
// backfill + new-row defaults, the verify-token round-trip (fresh/used/expired/
// already), the sendMail chokepoint (email_log + email_sent + List-Unsubscribe +
// idempotency, and the failed/skipped/timeout branches), the day-3 idempotency
// guard, per-category + all-off unsubscribe (GET page and RFC 8058 POST), and the
// category-partial no-clobber notify-prefs update through the real handler.
//
// node:sqlite is built in from Node 22.5.

import { readFileSync } from 'node:fs';
import {
  renderEmail, marketingFooter, transactionalFooter, mailingAddress,
  sendMail, alreadySent, siteBase, UNSUB_CATEGORIES, EMAIL_TYPES,
} from '../functions/_lib/email-template.js';
import {
  verifyEmail, welcomeEmail, day3Email, weeklyDigestEmail, monthReviewEmail, broadcastEmail,
  termReviewEmail, termSetupEmail,
} from '../functions/_lib/emails.js';
import { composeDigest } from '../functions/_lib/digest.js';
import { composeMonthReview } from '../functions/_lib/month-review.js';
import {
  createUser, createVerifyToken, consumeVerifyToken, isEmailVerified, createSession,
} from '../functions/_lib/auth.js';
import { unsubToken } from '../functions/_lib/notify-token.js';
import * as prefs from '../functions/notify-prefs.js';
import * as unsub from '../functions/unsubscribe.js';
import * as verify from '../functions/verify.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  ok  ', m); else { fail += 1; console.error('  FAIL', m); } };
const section = (t) => console.log(`\n${t}`);

const ENV = {
  RESEND_API_KEY: 're_test', FROM_EMAIL: 'FlightWay <careers@flightway.ai>',
  SITE_URL: 'https://flightway.ai', MAILING_ADDRESS: 'FlightWay, Inc., 1 Test St, City, ST 00000',
  UNSUB_SECRET: 'test-unsub-secret', SESSION_PEPPER: 'test-session-pepper',
};

// ---------------------------------------------------------------------------
// fetch stub — captures the last request so header/body assertions can run.
let lastReq = null;
function stubFetch(kind) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    lastReq = { url: String(url), opts, body: opts && opts.body ? JSON.parse(opts.body) : null };
    if (kind === 'ok') return new Response(JSON.stringify({ id: 'msg_test' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (kind === 'fail') return new Response('bad domain', { status: 422 });
    const e = new Error('aborted'); e.name = 'AbortError'; throw e; // 'timeout'
  };
  return () => { globalThis.fetch = real; };
}

// ---------------------------------------------------------------------------
section('template + footer contract (pure):');
{
  const tf = transactionalFooter();
  assert(!/unsubscrib/i.test(tf.html) && !/unsubscrib/i.test(tf.text), 'transactional footer has NO unsubscribe (can\'t unsub from a reset)');

  const mf = await marketingFooter(ENV, 'a@b.com', { category: 'weekly' });
  assert(mf.listUnsubscribe === `<${mf.unsubUrl}>`, 'List-Unsubscribe wraps the unsub url in <>');
  assert(/cat=weekly/.test(mf.unsubUrl), 'marketing footer unsub url carries the category');
  assert(/flightplan\.html#notifications/.test(mf.html), 'marketing footer links the prefs center');
  assert(mf.html.includes(ENV.MAILING_ADDRESS) && mf.text.includes(ENV.MAILING_ADDRESS), 'CAN-SPAM postal address in html + text');
  assert(/Unsubscribe/i.test(mf.html) && /Unsubscribe:/.test(mf.text), 'unsubscribe link present in both parts');

  const r = renderEmail({ heading: 'Hi there', bodyHtml: '<p>b</p>', bodyText: 'b', cta: { label: 'Go', url: 'https://x/y' }, footer: mf });
  assert(/FlightWay/.test(r.html), 'branded wordmark in the shell');
  assert(r.text.includes('https://x/y'), 'text part carries the CTA url');
  assert(r.html.includes('Hi there') && r.text.includes('Hi there'), 'heading in both parts');

  // Each lifecycle builder: marketing ones carry unsub + address; verify does not.
  const v = verifyEmail(ENV, 'a@b.com', 'https://flightway.ai/verify?token=T&email=a%40b.com');
  assert(v.subject && !/unsubscrib/i.test(v.html) && v.text.includes('token=T'), 'verify email: transactional (no unsub) + link');
  for (const [name, mk] of [['welcome', welcomeEmail], ['day3', day3Email]]) {
    const m = await mk(ENV, 'a@b.com');
    assert(m.subject && m.listUnsubscribe && /Unsubscribe/i.test(m.html) && m.html.includes(ENV.MAILING_ADDRESS) && /Email preferences/.test(m.html), `${name} email: marketing footer contract`);
  }
  // S11: the digest renders a COMPOSED digest (functions/_lib/digest.js decides
  // what goes in and in what order; this file only proves how it looks). Built
  // through the real composer so the two can never drift apart.
  const NOW = Date.parse('2026-07-13T14:00:00.000Z');
  const dg = composeDigest({
    now: NOW, week: '2026-W29', plan: 'free', base: 'https://flightway.ai',
    tasks: [{ label: 'Do the thing', waypointTitle: 'Waypoint 1' }],
    prevTasks: [{ done: true }, { done: false }, { done: false }],
    deadlines: [{ title: 'Summer Analyst Program', org: 'GS', due_date: '2026-07-20', status: 'tracked', url: 'https://x.example/a' }],
    commitments: [
      { text: 'Finish the DCF module', daysOut: -3, done: false },
      { text: 'Email two alumni', daysOut: 0, done: false },
      { text: 'Already finished', daysOut: 2, done: true },
      { text: 'Three weeks out', daysOut: 21, done: false },
    ],
    capFeatures: ['mock-interview'],
    applicationsMoved: 2,
    staleDrafts: 2,
    // S18 — the student's academic calendar. NOW is inside this window.
    term: { system: 'quarter', label: 'Fall 2026', startDate: '2026-06-29', endDate: '2026-09-13' },
  });
  const wd = await weeklyDigestEmail(ENV, 'a@b.com', dg);
  assert(wd.listUnsubscribe && /Do the thing/.test(wd.html) && /cat=weekly/.test(wd.listUnsubscribe),
    'weekly digest: tasks rendered + weekly-category unsub');
  assert(/1 of 3/.test(wd.html) && /1 of 3/.test(wd.text), 'weekly digest: the streak line renders in both parts');
  assert(/Summer Analyst Program/.test(wd.html) && /Summer Analyst Program/.test(wd.text),
    'weekly digest: deadlines render in both parts');
  assert(wd.html.indexOf('Summer Analyst Program') < wd.html.indexOf('You said you would'),
    'weekly digest: deadlines come BEFORE commitments — an imposed date cannot be moved, a chosen one can');

  // S10 digest hook, still true after the S11 rebuild.
  assert(/Finish the DCF module/.test(wd.html) && /3 days late/.test(wd.html) && /3 days late/.test(wd.text),
    'weekly digest: an overdue commitment appears in BOTH the html and the text part');
  assert(!/you.{0,4}re 3 days late/i.test(wd.html) && !/still haven/i.test(wd.html),
    'weekly digest: an overdue commitment is stated as a fact, never scolded (nobody can reply to an email)');
  assert(!/Already finished/.test(wd.html) && !/Three weeks out/.test(wd.html),
    'weekly digest: done commitments and ones past this week are left out');
  assert(/Marco/.test(wd.html) && /Marco:/.test(wd.text), 'weekly digest: the Marco line renders in both parts');
  assert(/utm_campaign=teaser_mock-interview/.test(wd.html), 'weekly digest: the free teaser carries its own utm_campaign');
  assert(/utm_campaign=weekly/.test(wd.html), 'weekly digest: the main CTA is attributed too');

  // S12 — the tracker line. Last in the body, because it reports what already
  // happened rather than asking for anything.
  assert(/2 applications moved stage last week\./.test(wd.html)
    && /2 applications moved stage last week\./.test(wd.text),
    'weekly digest: the application-moves line renders in BOTH parts');
  assert(wd.html.indexOf('applications moved stage') > wd.html.indexOf('You said you would'),
    'weekly digest: it sits below the asks, not above them');
  assert(/applications\.html\?utm_source=email/.test(wd.html),
    'weekly digest: and its link into the tracker is attributed');

  // S17 — the stale-draft nudge. It ASKS for something (send it), so unlike the
  // tracker line it sits ABOVE that one, among the asks.
  assert(/2 outreach drafts have been sitting unsent/.test(wd.html)
    && /2 outreach drafts have been sitting unsent/.test(wd.text),
    'weekly digest: the stale-draft nudge renders in BOTH parts');
  assert(wd.html.indexOf('outreach drafts have been sitting') < wd.html.indexOf('applications moved stage'),
    'weekly digest: an ask sits above a retrospective fact');
  assert(/flightplan\.html\?utm_source=email[^"]*#network/.test(wd.html),
    'weekly digest: its link lands on #network with the UTM BEFORE the fragment');
  assert(/never send is worth/.test(wd.html) && /never send is worth/.test(wd.text),
    'weekly digest: and it says why, in one line, in both parts');

  const wdBare = await weeklyDigestEmail(ENV, 'a@b.com', composeDigest({
    now: NOW, week: '2026-W29', plan: 'premium', tasks: [{ label: 'Do the thing' }],
  }));
  assert(!/You said you would/.test(wdBare.html), 'weekly digest: no commitments renders no empty heading');
  assert(!/Closing soon/.test(wdBare.html), 'weekly digest: no deadlines renders no empty heading');
  assert(!/applications moved/.test(wdBare.html),
    'weekly digest: zero application moves renders no line rather than "0 applications moved"');
  assert(!/outreach draft/.test(wdBare.html) && !/outreach draft/.test(wdBare.text),
    'weekly digest: zero stale drafts renders no nudge in either part');

  // S18 — the term line. It FRAMES the email rather than adding to it, so it is
  // the first thing in the body: a student five weeks from finals reads the same
  // three tasks differently from one in week two.
  assert(/Week \d+ of \d+ · Fall 2026/.test(wd.html) && /Week \d+ of \d+ · Fall 2026/.test(wd.text),
    'weekly digest: the term line renders in BOTH parts, with the student\'s own name for the term');
  assert(wd.html.indexOf('Fall 2026') < wd.html.indexOf('Do the thing'),
    'weekly digest: and it sits above everything, because it frames the list rather than joining it');
  assert(!/Week \d+ of/.test(wdBare.html) && !/Week \d+ of/.test(wdBare.text),
    'weekly digest: a student who never told us their dates gets no line, not "Week 0 of 0"');
  assert(!/pricing/.test(wdBare.html), 'weekly digest: a PAYING reader is never linked to the pricing page');
  assert(/Included in your plan/.test(wdBare.html), 'weekly digest: they get a discovery slot instead');

  // S11: Month in Review.
  const rv = composeMonthReview({
    month: '2026-06', now: NOW,
    activity: { step_done: 4, marco_msg: 1 },
    deadlines: [{ title: 'Hit this one', org: 'GS', due_date: '2026-06-05', status: 'done' }],
    snapshots: [{ week: '2026-W23', values: [10, 10] }, { week: '2026-W26', values: [13, 10] }],
    evidence: [{ title: 'Fraud-detection notebook', type: 'repo', created_at: '2026-06-11T00:00:00.000Z' }],
    applications: [{ role: 'Summer Analyst', company: 'Goldman Sachs', status: 'interviewing', status_at: '2026-06-14T00:00:00.000Z' }],
    // S20 — the three sections the review gained at final QA.
    scorecards: [
      { score: 41, career_name: 'Data Analyst', created_at: '2026-05-20T00:00:00.000Z' },
      { score: 63, career_name: 'Data Analyst', created_at: '2026-06-28T00:00:00.000Z' },
    ],
    outreach: { sent: 4, replied: 1 },
    term: { label: 'Fall 2026', start_date: '2026-05-11', end_date: '2026-08-21' },
    roadmap: {
      version: 2,
      activePath: ['wp1'],
      nodes: [{ id: 'wp1', title: 'Analyst seat', shortTitle: 'Analyst seat', steps: [
        { id: 's1', text: 'Finish the DCF module', done: true, dueAt: '2026-06-10' },
        { id: 's2', text: 'Email Prof. Ito', done: false, dueAt: '2026-06-20' },
      ] }],
    },
  });
  const mr = await monthReviewEmail(ENV, 'a@b.com', rv);
  assert(mr.subject === 'June 2026 in review', 'month review: the subject names the month');
  assert(mr.listUnsubscribe && /cat=review/.test(mr.listUnsubscribe),
    'month review: unsubscribing turns off the REVIEW category, not the weekly plan');
  assert(mr.html.includes(ENV.MAILING_ADDRESS) && /Unsubscribe/i.test(mr.html), 'month review: full CAN-SPAM footer');
  assert(/4 /.test(mr.html) && /roadmap steps completed/.test(mr.html), 'month review: activity counts render');
  assert(/Hit this one/.test(mr.html) && /Hit this one/.test(mr.text), 'month review: deadlines hit render in both parts');
  assert(/Finish the DCF module/.test(mr.text) && /Email Prof. Ito/.test(mr.text), 'month review: kept and slipped commitments both render');
  assert(/One focus/.test(mr.html), 'month review: next month’s one focus renders');
  // S12 — the two sections S11 shipped as present-and-empty placeholders.
  assert(/Proof you added/.test(mr.html) && /Fraud-detection notebook/.test(mr.html)
    && /Fraud-detection notebook/.test(mr.text),
    'month review: evidence renders in both parts');
  assert(/Applications you moved/.test(mr.html) && /Summer Analyst/.test(mr.text)
    && /interviewing/.test(mr.text),
    'month review: application moves render in both parts, naming the stage they landed in');
  assert(/utm_medium=review/.test(mr.html) && /\/review\?m=2026-06/.test(mr.html),
    'month review: the CTA deep-links the month it is about, attributed');
  // S20 — the three sections S16/S17/S18 shipped without.
  assert(/Your outreach/.test(mr.html) && /5 contacts moved forward — 4 sent, 1 replied/.test(mr.text),
    'month review: outreach renders the advance count and its breakdown in both parts');
  assert(/Job-posting readiness/.test(mr.html) && /moved from 41% to 63%/.test(mr.text),
    'month review: readiness renders as a trend when a baseline exists');
  assert(/Your term/.test(mr.html) && /Fall 2026 — you closed the month at week 8 of 15/.test(mr.text),
    'month review: the term line names the student’s own label and the week the month closed on');

  const rvQuiet = composeMonthReview({ month: '2026-06', now: NOW, roadmap: null });
  const mrQuiet = await monthReviewEmail(ENV, 'a@b.com', rvQuiet);
  assert(!/What you did/.test(mrQuiet.html) && !/Deadlines you hit/.test(mrQuiet.html),
    'month review: empty sections are SKIPPED, never rendered as a zero');
  assert(!/Proof you added/.test(mrQuiet.html) && !/Applications you moved/.test(mrQuiet.html),
    'month review: and the two S12 sections skip themselves the same way');
  assert(!/Your outreach/.test(mrQuiet.html) && !/Job-posting readiness/.test(mrQuiet.html)
    && !/Your term/.test(mrQuiet.html),
    'month review: the three S20 sections skip themselves the same way too');
  assert(mrQuiet.html.includes(ENV.MAILING_ADDRESS), 'month review: even the quiet one carries the footer');

  // S11: admin broadcast.
  const bc = await broadcastEmail(ENV, 'a@b.com', {
    subject: 'We shipped the Deadline Radar',
    bodyMd: '## Big news\n\nIt is **live** — [see it](https://flightway.ai/flightplan.html).\n\n<script>alert(1)</script>',
  });
  assert(bc.listUnsubscribe && /cat=product/.test(bc.listUnsubscribe),
    'broadcast: unsubscribing turns off PRODUCT updates only');
  assert(bc.html.includes(ENV.MAILING_ADDRESS) && /Unsubscribe/i.test(bc.html), 'broadcast: full CAN-SPAM footer');
  assert(/<strong>live<\/strong>/.test(bc.html) && /href="https:\/\/flightway.ai\/flightplan.html"/.test(bc.html),
    'broadcast: markdown renders');
  assert(!/<script/i.test(bc.html) && /&lt;script&gt;/.test(bc.html),
    'broadcast: a script tag is ESCAPED, never emitted — "the author is an admin" is not a security model');
  assert(bc.text.includes('Big news') && !/<strong>/.test(bc.text), 'broadcast: the text part is plain');

  assert(mailingAddress(ENV) === ENV.MAILING_ADDRESS, 'mailingAddress returns the configured address');
  assert(mailingAddress({}) === 'FlightWay, Inc.', 'mailingAddress falls back (and warns) when unset');
  assert(EMAIL_TYPES.length >= 6 && UNSUB_CATEGORIES.includes('all') && UNSUB_CATEGORIES.includes('weekly'), 'type + category constants present');
  for (const t of ['month_review', 'broadcast', 'broadcast_test']) {
    assert(EMAIL_TYPES.includes(t), `EMAIL_TYPES knows about ${t}`);
  }
  assert(UNSUB_CATEGORIES.includes('review') && UNSUB_CATEGORIES.includes('product'),
    'every S11 sender targets a category that exists (a bad cat= silently unsubscribes from nothing)');

  // S18: the two term-boundary emails.
  const TERM = { id: 'tmabc', system: 'quarter', label: 'Fall 2026', startDate: '2026-06-29', endDate: '2026-09-13' };
  const tr = await termReviewEmail(ENV, 'a@b.com', TERM);
  assert(/cat=review/.test(tr.listUnsubscribe),
    'term review: rides the REVIEW category, alongside Month in Review — both ask for nothing');
  assert(/Fall 2026 in review/.test(tr.subject) && /Fall 2026/.test(tr.text),
    'term review: named by the student\'s own term, in both the subject and the body');
  // A retrospective mail that quotes a figure the page then recomputes is a mail
  // that can be wrong by the time it is read, so it quotes none.
  assert(!/\b\d+ (commitments?|deadlines?|applications?)\b/.test(tr.text),
    'term review: it carries NO counts — the review is computed when they open it');
  assert(/flightplan\.html\?utm_source=email[^"]*#semester/.test(tr.html),
    'term review: its link lands on #semester with the UTM BEFORE the fragment');
  assert(/extra roadmap rebuild/.test(tr.text), 'term review: and says what the review unlocks');
  assert(tr.html.includes(ENV.MAILING_ADDRESS), 'term review: full CAN-SPAM footer');

  const ts = await termSetupEmail(ENV, 'a@b.com', TERM);
  assert(/cat=product/.test(ts.listUnsubscribe),
    'term setup: rides PRODUCT — someone who unsubscribed from retrospectives did not ask to stop being offered features');
  assert(/three/i.test(ts.text) && /two minutes/i.test(ts.text),
    'term setup: states the ask and what it costs them');
  assert(/flightplan\.html\?utm_source=email[^"]*#semester/.test(ts.html),
    'term setup: same fragment, same UTM ordering');
  assert(ts.subject !== tr.subject, 'the two term emails are never mistaken for each other in an inbox');
  for (const t of ['term_review', 'term_setup']) {
    assert(EMAIL_TYPES.includes(t), `EMAIL_TYPES knows about ${t}`);
  }
}

// ---------------------------------------------------------------------------
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
if (!DatabaseSync) {
  console.warn('\n  SKIP node:sqlite unavailable — the DB sections did not run (upgrade to Node 22.5+)');
} else {
  const readMig = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
  const d1For = (sqlite) => ({
    prepare(sql) {
      const runP = (p) => { const r = sqlite.prepare(sql).run(...p); return { meta: { changes: Number(r.changes) || 0 } }; };
      const allP = (p) => ({ results: sqlite.prepare(sql).all(...p) });
      const firstP = (p) => (sqlite.prepare(sql).get(...p) ?? null);
      return {
        bind(...p) { return { async run() { return runP(p); }, async all() { return allP(p); }, async first() { return firstP(p); } }; },
        async run() { return runP([]); }, async all() { return allP([]); }, async first() { return firstP([]); },
      };
    },
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
  });
  const kv = () => { const map = new Map(); return { map, get: async (k) => (map.has(k) ? map.get(k) : null), put: async (k, v) => { map.set(k, String(v)); }, delete: async (k) => map.delete(k), list: async () => ({ keys: [] }) }; };

  // -------------------------------------------------------------------------
  section('migration 0019: grandfather backfill + new-row defaults (real SQL):');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readMig('0001_auth.sql'));
  sqlite.exec(readMig('0009_v2_notifications.sql'));
  sqlite.exec(readMig('0017_analytics.sql')); // events table, so email_sent can be written
  // Two PRE-existing accounts, created before the migration runs.
  sqlite.exec("INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('old1@x.com','h','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'), ('old2@x.com','h','2026-02-02T00:00:00.000Z','2026-02-02T00:00:00.000Z')");
  sqlite.exec(readMig('0019_email_v2.sql')); // grandfather UPDATE runs here

  const old1 = sqlite.prepare("SELECT * FROM users WHERE email='old1@x.com'").get();
  assert(old1.verified_at === old1.created_at, 'grandfather: pre-existing account marked verified_at = created_at');
  assert(old1.notify_deadlines === 0 && old1.notify_review === 0 && old1.notify_product === 0, 'grandfather: pre-existing categories NOT silently enrolled (all 0)');
  assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_log'").get() != null, 'email_log table created');

  const env = { ...ENV, DB: d1For(sqlite), COACH_KV: kv() };
  await createUser(env, 'new1@x.com', 'hash');
  const new1 = sqlite.prepare("SELECT * FROM users WHERE email='new1@x.com'").get();
  assert(new1.verified_at == null, 'new account starts UNverified (verified_at NULL)');
  assert(new1.notify_optin === 1 && new1.notify_deadlines === 1 && new1.notify_review === 1 && new1.notify_product === 1, 'new account: all four notification categories default ON (D10)');

  // -------------------------------------------------------------------------
  section('verify-token round-trip:');
  const token = await createVerifyToken(env, 'new1@x.com');
  const afterCreate = sqlite.prepare("SELECT verify_token_hash, verify_sent_at FROM users WHERE email='new1@x.com'").get();
  assert(afterCreate.verify_token_hash && afterCreate.verify_sent_at, 'createVerifyToken stores hash + sent_at');
  const res1 = await consumeVerifyToken(env, token);
  assert(res1 && res1.email === 'new1@x.com' && res1.already === false, 'consume: valid token verifies the account');
  const afterConsume = sqlite.prepare("SELECT verified_at, verify_token_hash FROM users WHERE email='new1@x.com'").get();
  assert(afterConsume.verified_at && afterConsume.verify_token_hash == null, 'consume: verified_at set, token cleared');
  assert((await isEmailVerified(env, 'new1@x.com')) === true, 'isEmailVerified true after verify');
  assert((await consumeVerifyToken(env, token)) == null || (await consumeVerifyToken(env, token)).already, 'consume: a used token cannot re-verify (null or already)');
  assert((await consumeVerifyToken(env, 'deadbeef')) == null, 'consume: unknown token → null');

  await createUser(env, 'exp@x.com', 'h');
  const expTok = await createVerifyToken(env, 'exp@x.com');
  sqlite.exec("UPDATE users SET verify_sent_at='2026-01-01T00:00:00.000Z' WHERE email='exp@x.com'"); // >48h ago
  assert((await consumeVerifyToken(env, expTok)) == null, 'consume: expired token (past 48h TTL) → null');
  assert((await isEmailVerified(env, 'exp@x.com')) === false, 'expired token did not verify the account');

  // already-verified → { already: true }
  const reTok = await createVerifyToken(env, 'new1@x.com');
  const reRes = await consumeVerifyToken(env, reTok);
  assert(reRes && reRes.already === true, 'consume: already-verified account → { already:true } (idempotent success)');

  // -------------------------------------------------------------------------
  section('verify handler (GET /verify) + verify_done event:');
  await createUser(env, 'vh@x.com', 'h');
  const vhTok = await createVerifyToken(env, 'vh@x.com');
  const vResp = await verify.onRequestGet({ request: { url: `https://flightway.ai/verify?token=${vhTok}&email=vh%40x.com` }, env });
  const vBody = await vResp.text();
  assert(vResp.status === 200 && /verified/i.test(vBody), 'GET /verify valid token → confirmation page');
  assert(sqlite.prepare("SELECT COUNT(*) c FROM events WHERE name='verify_done'").get().c >= 1, 'verify_done event written on success');
  const vBad = await verify.onRequestGet({ request: { url: 'https://flightway.ai/verify?token=nope&email=vh%40x.com' }, env });
  assert(/expired|used/i.test(await vBad.text()), 'GET /verify bad token → expired/used page');

  // -------------------------------------------------------------------------
  section('sendMail chokepoint (email_log + email_sent + headers + branches):');
  {
    const restore = stubFetch('ok');
    const r = await sendMail(env, { to: 'S1@x.com', subject: 'S', html: '<b>h</b>', text: 'h', type: 'welcome', listUnsubscribe: '<https://flightway.ai/unsubscribe?x>', idempotencyKey: 'idem-1' });
    restore();
    assert(r.ok && r.messageId === 'msg_test', 'sendMail success → { ok, messageId }');
    const log = sqlite.prepare("SELECT * FROM email_log WHERE user_id='s1@x.com'").get();
    assert(log && log.type === 'welcome' && log.status === 'sent', 'email_log row written (lowercased user_id, status sent)');
    assert(sqlite.prepare("SELECT COUNT(*) c FROM events WHERE name='email_sent'").get().c === 1, 'email_sent event written exactly once on success');
    assert(lastReq.body.headers['List-Unsubscribe'] === '<https://flightway.ai/unsubscribe?x>' && lastReq.body.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'RFC 8058 headers set on the Resend request');
    assert(lastReq.opts.headers['Idempotency-Key'] === 'idem-1', 'Idempotency-Key forwarded when provided');
  }
  {
    const restore = stubFetch('fail');
    const r = await sendMail(env, { to: 's2@x.com', subject: 'S', html: 'h', text: 'h', type: 'day3' });
    restore();
    assert(!r.ok && /422/.test(r.error || ''), 'sendMail non-2xx → { ok:false, error }');
    assert(sqlite.prepare("SELECT status FROM email_log WHERE user_id='s2@x.com'").get().status === 'failed', 'failed send logged status=failed');
    assert(sqlite.prepare("SELECT COUNT(*) c FROM events WHERE name='email_sent'").get().c === 1, 'no email_sent event on a failed send');
  }
  {
    const r = await sendMail({ ...env, RESEND_API_KEY: '' }, { to: 's3@x.com', subject: 'S', html: 'h', text: 'h', type: 'welcome' });
    assert(r.skipped && sqlite.prepare("SELECT status FROM email_log WHERE user_id='s3@x.com'").get().status === 'skipped', 'no API key → skipped (logged status=skipped)');
  }
  {
    const restore = stubFetch('timeout');
    const r = await sendMail(env, { to: 's4@x.com', subject: 'S', html: 'h', text: 'h', type: 'verify' });
    restore();
    assert(!r.ok && r.error === 'timeout', 'sendMail upstream timeout → error=timeout (never throws)');
  }

  // -------------------------------------------------------------------------
  section('day-3 idempotency guard (alreadySent):');
  assert((await alreadySent(env, 's1@x.com', 'welcome')) === true, 'alreadySent true after a sent row');
  assert((await alreadySent(env, 's2@x.com', 'day3')) === true, 'alreadySent true after a failed row (attempted, do not retry)');
  assert((await alreadySent(env, 's3@x.com', 'welcome')) === false, 'alreadySent false for a skipped-only row (retryable)');
  assert((await alreadySent(env, 'nobody@x.com', 'day3')) === false, 'alreadySent false when never sent');

  // -------------------------------------------------------------------------
  section('unsubscribe: per-category + all-off (GET page + RFC 8058 POST):');
  await createUser(env, 'u@x.com', 'h'); // all four categories = 1
  const utok = await unsubToken('u@x.com', env);
  const gd = await unsub.onRequestGet({ request: { url: `https://flightway.ai/unsubscribe?email=u%40x.com&token=${utok}&cat=deadlines` }, env });
  assert(/unsubscribed/i.test(await gd.text()), 'GET unsubscribe cat=deadlines → confirmation page');
  let u = sqlite.prepare("SELECT * FROM users WHERE email='u@x.com'").get();
  assert(u.notify_deadlines === 0 && u.notify_optin === 1 && u.notify_review === 1, 'per-category unsub turns off ONLY that category');
  assert(sqlite.prepare("SELECT COUNT(*) c FROM events WHERE name='email_unsub'").get().c >= 1, 'email_unsub event written');
  const gbad = await unsub.onRequestGet({ request: { url: 'https://flightway.ai/unsubscribe?email=u%40x.com&token=badtoken&cat=weekly' }, env });
  assert(/invalid/i.test(await gbad.text()), 'GET unsubscribe bad token → invalid page');
  u = sqlite.prepare("SELECT notify_optin FROM users WHERE email='u@x.com'").get();
  assert(u.notify_optin === 1, 'bad token did not change anything');
  await unsub.onRequestGet({ request: { url: `https://flightway.ai/unsubscribe?email=u%40x.com&token=${utok}&cat=all` }, env });
  u = sqlite.prepare("SELECT * FROM users WHERE email='u@x.com'").get();
  assert(u.notify_optin === 0 && u.notify_deadlines === 0 && u.notify_review === 0 && u.notify_product === 0, 'cat=all turns every category off');
  const pOk = await unsub.onRequestPost({ request: { url: `https://flightway.ai/unsubscribe?email=u%40x.com&token=${utok}&cat=weekly` }, env });
  assert(pOk.status === 200, 'POST one-click valid token → 200');
  const pBad = await unsub.onRequestPost({ request: { url: 'https://flightway.ai/unsubscribe?email=u%40x.com&token=bad&cat=weekly' }, env });
  assert(pBad.status === 403, 'POST one-click bad token → 403');

  // -------------------------------------------------------------------------
  section('notify-prefs: category partial update (no clobber), through the handler:');
  await createUser(env, 'p@x.com', 'h'); // all four = 1, unverified
  const sess = await createSession(env, 'p@x.com');
  const withSession = (body, method = 'POST') => ({
    request: { url: 'https://flightway.ai/notify-prefs', method, headers: new Headers({ cookie: `fw_session=${sess.token}`, 'content-type': 'application/json' }), json: async () => body },
    env,
  });
  const getResp = await prefs.onRequestGet(withSession(null, 'GET'));
  const getData = await getResp.json();
  assert(getResp.status === 200 && getData.prefs.weekly === true && getData.verified === false, 'GET prefs: all-on, verified=false for a new account');
  await prefs.onRequestPost(withSession({ prefs: { weekly: false } }));
  let p = sqlite.prepare("SELECT * FROM users WHERE email='p@x.com'").get();
  assert(p.notify_optin === 0 && p.notify_deadlines === 1 && p.notify_review === 1, 'partial update: weekly off does NOT clobber the other categories');
  await prefs.onRequestPost(withSession({ prefs: { deadlines: false, product: false } }));
  p = sqlite.prepare("SELECT * FROM users WHERE email='p@x.com'").get();
  assert(p.notify_deadlines === 0 && p.notify_product === 0 && p.notify_review === 1 && p.notify_optin === 0, 'second partial update only touches its own keys');
  const noAuth = await prefs.onRequestGet({ request: { url: 'https://flightway.ai/notify-prefs', method: 'GET', headers: new Headers({}), json: async () => null }, env });
  assert(noAuth.status === 401, 'notify-prefs requires a session (401 signed out)');
}

// ---------------------------------------------------------------------------
if (fail) { console.error(`\ntest:emails — ${fail} FAILED`); process.exit(1); }
console.log('\ntest:emails — all checks passed');
