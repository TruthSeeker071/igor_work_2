// gate: test:deadlines — the durable proof for V2 S9, the Deadline Radar.
//
// Three layers, because three different classes of bug can ship here and only
// one of them is visible by reading the code:
//   1. PURE — extraction: does a model's answer survive contact with reality?
//      (unknown kinds, invented URLs, a date copied off a 2019 page, a date in
//      the past, in-batch duplicates). Plus the date arithmetic, which is the
//      one thing in this feature that is subtly wrong by default.
//   2. REAL SQLITE, loaded from migrations/0020_deadlines.sql — the dedupe and
//      the alert selection. A refresh runs every week forever; if the upsert is
//      wrong the radar fills with the same program five times, and if it is TOO
//      eager it resurrects rows the student dismissed. Neither is visible in a
//      code review and neither would fail any other gate.
//   3. THE REAL HANDLERS, executed — auth, cross-user authz, validation copy,
//      the §4 weekly meter and its refund, and a full grounded refresh end to
//      end against a stubbed Gemini (research → shape → sanitize → upsert →
//      re-run is idempotent).
//
// node:sqlite is built in from Node 22.5.

import { readFileSync } from 'node:fs';
import {
  DEADLINE_KINDS, ALERT_TIERS, MAX_DEADLINES, MAX_USER_ROWS, MAX_HORIZON_DAYS,
  sanitizeDeadlines, sanitizeManualDeadline, normalizeKind, normalizeStatus,
  normalizeTitleKey, dedupeKeyFor, deadlineId, daysUntil, isIsoDate, shiftDate,
  utcDate, cycleLabel, closesPhrase, buildDeadlineQueries, buildDeadlinePrompt,
} from '../functions/_lib/deadline-core.js';
import {
  listUpcoming, nextTracked, countRows, upsertDeadlines, insertManual, setStatus,
  selectAlertBatch, markAlerted,
} from '../functions/_lib/deadline-store.js';
import { refreshDeadlinesForUser } from '../functions/_lib/deadline-refresh.js';
import { FEATURE_LIMITS, checkFeatureLimit, refundFeatureUse, featureKvKey } from '../functions/_lib/plan-limits.js';
import { USER_ID_TABLES } from '../functions/account.js';
import { REGISTERED_EVENTS, isAllowedName } from '../functions/_lib/events.js';
import { EMAIL_TYPES } from '../functions/_lib/email-template.js';
import { deadlineAlertEmail } from '../functions/_lib/emails.js';
import { createUser, createSession } from '../functions/_lib/auth.js';
import { saveUserBlob } from '../functions/_lib/user.js';
import * as radar from '../functions/deadlines.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  ok  ', m); else { fail += 1; console.error('  FAIL', m); } };
const section = (t) => console.log(`\n${t}`);

const BASE = 'https://flightway.ai';
const ENV_BASE = {
  SESSION_PEPPER: 'test-session-pepper',
  ALLOWED_ORIGIN: BASE,
  SITE_URL: BASE,
  PAYWALL_ENABLED: 'true',
  MAILING_ADDRESS: 'FlightWay, Inc., 1 Test St, City, ST 00000',
  UNSUB_SECRET: 'test-unsub-secret',
};

// A fixed clock. Every date below is expressed against it, so this gate cannot
// start failing on a particular calendar day the way a Date.now() fixture would.
const NOW = Date.parse('2026-07-24T20:00:00Z');
const TODAY = '2026-07-24';
const inDays = (n) => shiftDate(TODAY, n);

// ---------------------------------------------------------------------------
section('dates: UTC-anchored on both sides (the bug this replaced):');
{
  // The helper S9 removed measured from the caller's exact INSTANT to the
  // target's UTC midnight and rounded. After ~12:00 UTC that made a deadline
  // closing TODAY compute to -1 — and both callers filter on `daysOut >= 0`,
  // so the radar hid a deadline on the very day it mattered most.
  assert(daysUntil(TODAY, Date.parse('2026-07-24T23:59:00Z')) === 0, 'a deadline closing today reads 0 at 23:59 UTC, not -1');
  assert(daysUntil(TODAY, Date.parse('2026-07-24T00:00:01Z')) === 0, 'and still 0 one second after midnight');
  assert(daysUntil(inDays(1), Date.parse('2026-07-24T23:59:00Z')) === 1, 'tomorrow reads 1 all day, never 0');
  assert(daysUntil(inDays(1), Date.parse('2026-07-24T00:00:01Z')) === 1, 'and 1 at the other end of the same day');
  assert(daysUntil(inDays(-1), NOW) === -1, 'yesterday is negative');
  assert(daysUntil(inDays(14), NOW) === 14, 'a fortnight is 14 whole days');
  assert(daysUntil('not-a-date', NOW) === null, 'garbage is null, not NaN');
  assert(isIsoDate('2026-02-31') === false, 'a shaped but impossible date is rejected');
  assert(isIsoDate('2026-02-28') === true && isIsoDate('2026-7-4') === false, 'real dates pass, sloppy ones do not');
  assert(utcDate(NOW) === TODAY, 'utcDate takes the UTC day, not the local one');
  assert(closesPhrase(0) === 'closes today' && closesPhrase(1) === 'closes tomorrow' && closesPhrase(9) === 'closes in 9 days', 'the shared phrase is the same in the UI and the email');
}

// ---------------------------------------------------------------------------
section('kinds + statuses come from closed sets:');
{
  assert(DEADLINE_KINDS.length === 5 && DEADLINE_KINDS.includes('application-window'), 'the five §5 S9 kinds');
  assert(normalizeKind('Internships') === 'internship' && normalizeKind('student_org') === 'club', 'known synonyms map');
  assert(normalizeKind('  COMPETITION ') === 'competition', 'case and whitespace do not matter');
  assert(normalizeKind('wedding') === '', 'an unknown kind is DROPPED, never filed under a catch-all');
  assert(normalizeStatus('DONE') === 'done' && normalizeStatus('deleted') === '', 'statuses likewise');
}

// ---------------------------------------------------------------------------
section('title normalization: conservative on purpose:');
{
  assert(
    normalizeTitleKey('The Goldman Sachs Summer Analyst Program 2027')
    === normalizeTitleKey('Goldman Sachs Analyst Programme'),
    'two wordings of one program share a key (noise words + year dropped)',
  );
  assert(
    normalizeTitleKey('Goldman Sachs Analyst Program')
    !== normalizeTitleKey('Morgan Stanley Analyst Program'),
    'two DIFFERENT programs do not — over-merging would hide one of them entirely',
  );
  assert(normalizeTitleKey('Summer Program 2027') !== '', 'an all-noise title still gets a stable key rather than an empty one');
  assert(dedupeKeyFor('x-y', '2026-11-30') === 'x-y|2026-11', 'the dedupe key windows on the month');
  assert(deadlineId('A@B.com', 'k') === deadlineId('a@b.com', 'k'), 'the id is case-insensitive in the address');
  assert(deadlineId('a@b.com', 'k') !== deadlineId('c@d.com', 'k'), 'and never collides across users');
}

// ---------------------------------------------------------------------------
section('sanitizeDeadlines: a model answer meeting reality:');
{
  const sources = [
    { title: 'GS careers', url: 'https://www.goldmansachs.com/careers/students/programs' },
    { title: 'Rhodes', url: 'https://www.rhodeshouse.ox.ac.uk/scholarships/apply' },
  ];
  const raw = [
    // 0 — good, and the URL is a lazy transcription (no www., trailing slash)
    { kind: 'internship', title: 'Summer Analyst Program', org: 'Goldman Sachs', dueDate: inDays(120), url: 'https://goldmansachs.com/careers/students/programs/' },
    // 1 — good
    { kind: 'fellowship', title: 'Rhodes Scholarship', org: 'Rhodes Trust', dueDate: inDays(60), url: 'https://www.rhodeshouse.ox.ac.uk/scholarships/apply' },
    // 2 — a URL nobody fetched
    { kind: 'internship', title: 'Invented Program', org: 'Nowhere', dueDate: inDays(30), url: 'https://example.com/apply' },
    // 3 — last year's date, read off a stale page
    { kind: 'internship', title: 'Stale Listing', org: 'Old Co', dueDate: inDays(-10), url: sources[0].url },
    // 4 — a wrong-decade date
    { kind: 'fellowship', title: 'Far Future', org: 'X', dueDate: shiftDate(TODAY, MAX_HORIZON_DAYS + 5), url: sources[0].url },
    // 5 — a kind we do not have
    { kind: 'wedding', title: 'Not A Deadline', org: 'X', dueDate: inDays(20), url: sources[0].url },
    // 6 — no date at all
    { kind: 'club', title: 'No Date', org: 'X', dueDate: 'rolling', url: sources[0].url },
    // 7 — http, not https
    { kind: 'club', title: 'Insecure', org: 'X', dueDate: inDays(20), url: 'http://www.goldmansachs.com/careers/students/programs' },
    // 8 — a duplicate of 0 with different wording and a date in the same month
    { kind: 'internship', title: 'The Summer Analyst Programme', org: 'Goldman Sachs', dueDate: inDays(120), url: sources[0].url },
    // 9 — empty title
    { kind: 'internship', title: '   ', org: 'X', dueDate: inDays(20), url: sources[0].url },
  ];
  const out = sanitizeDeadlines(raw, { sources, now: NOW });
  const titles = out.map((d) => d.title);
  assert(out.length === 2, `exactly the two verifiable items survive (got ${out.length}: ${titles.join(' | ')})`);
  assert(titles.includes('Summer Analyst Program') && titles.includes('Rhodes Scholarship'), 'and they are the right two');
  assert(!titles.includes('Invented Program'), 'a URL that is not one of the research sources is dropped — never shipped as a checkable date');
  assert(!titles.includes('Stale Listing'), 'a date already in the past is dropped');
  assert(!titles.includes('Far Future'), `a date past the ${MAX_HORIZON_DAYS}-day horizon is dropped (the wrong-year failure)`);
  assert(!titles.includes('Insecure'), 'http is not https');
  assert(out[0].url === sources[0].url || out[1].url === sources[0].url, 'the SOURCE url is shipped, not the model\'s transcription of it');
  assert(out.every((d) => d.titleKey && d.dedupeKey), 'every survivor carries its dedupe keys');

  const many = Array.from({ length: 30 }, (_, i) => ({
    kind: 'competition', title: `Contest Number ${i}`, org: 'X', dueDate: inDays(30 + i), url: sources[0].url,
  }));
  assert(sanitizeDeadlines(many, { sources, now: NOW }).length === MAX_DEADLINES, `capped at ${MAX_DEADLINES} per refresh`);
  assert(sanitizeDeadlines(null, { sources, now: NOW }).length === 0, 'a non-array answer is empty, not a throw');
  assert(sanitizeDeadlines([{}, null, 'x'], { sources, now: NOW }).length === 0, 'so is junk');
}

// ---------------------------------------------------------------------------
section('manual add: the ONE place a URL is optional:');
{
  assert(sanitizeManualDeadline({ title: 'My club application', dueDate: inDays(10) }, { now: NOW }).ok, 'a title and a date is enough — the student IS the source');
  assert(sanitizeManualDeadline({ title: '', dueDate: inDays(10) }, { now: NOW }).error === 'A title is required.', 'no title → student-facing copy');
  assert(/Pick a date/.test(sanitizeManualDeadline({ title: 'x', dueDate: 'soon' }, { now: NOW }).error), 'no date → student-facing copy');
  assert(/already passed/.test(sanitizeManualDeadline({ title: 'x', dueDate: inDays(-1) }, { now: NOW }).error), 'a past date is refused with a reason');
  const withUrl = sanitizeManualDeadline({ title: 'x', dueDate: inDays(5), url: 'javascript:alert(1)' }, { now: NOW });
  assert(withUrl.ok && withUrl.value.url === '', 'a non-https url is stripped rather than stored (it becomes an href)');
  const good = sanitizeManualDeadline({ title: 'x', dueDate: inDays(5), url: 'https://ok.example/apply', kind: 'garbage' }, { now: NOW });
  assert(good.value.url === 'https://ok.example/apply' && good.value.kind === 'application-window', 'https survives; an unknown kind falls back to the generic one');
}

// ---------------------------------------------------------------------------
section('research queries + prompt carry no identity, and STATE the school (§3.6):');
{
  const qs = buildDeadlineQueries({ careerName: 'Investment Banker', school: 'Rice University', now: NOW });
  assert(qs.length === 3, 'three queries');
  assert(qs.every((q) => !/@/.test(q)), 'no email in a query — the research cache is shared across users');
  assert(qs.some((q) => q.includes('Rice University')), 'the school personalizes one of them');
  assert(qs.every((q) => q.includes(cycleLabel(NOW))), 'each is scoped to the current admissions cycle so a stale brief cannot be served');
  assert(buildDeadlineQueries({ careerName: 'X', school: '', now: NOW })[2].includes('university career center'), 'no school → the generic third query, never an empty one');

  const p = buildDeadlinePrompt({ evidence: '=== WEB EVIDENCE ===', careerName: 'Investment Banker', school: 'Rice University', year: 'Junior', today: TODAY });
  assert(p.indexOf('=== WEB EVIDENCE ===') === 0, 'the fenced evidence LEADS the prompt');
  assert(p.includes("STUDENT'S SCHOOL: Rice University"), 'the school is stated, not merely available (§3.6)');
  assert(p.includes(`TODAY'S DATE: ${TODAY}`), 'today is stated so the model can reject stale listings itself');
  assert(/character for character/.test(p), 'the copy-the-source-URL rule is in the prompt as well as the sanitizer');
  assert(buildDeadlinePrompt({ evidence: '', careerName: 'X', school: '', today: TODAY }).includes('not stated'), 'an unknown school is said out loud rather than omitted');
}

// ---------------------------------------------------------------------------
section('alert tiers cover 1..14 days with no gap and no overlap:');
{
  const covered = new Set();
  for (const t of ALERT_TIERS) for (let d = t.minDays; d <= t.maxDays; d += 1) {
    assert(!covered.has(d) || d < 0, `day ${d} belongs to exactly one tier`);
    covered.add(d);
  }
  for (let d = 1; d <= 14; d += 1) assert(covered.has(d), `a deadline ${d} day(s) out is alertable`);
  assert(!covered.has(0) && !covered.has(15), 'and nothing outside the fortnight is');
  assert(new Set(ALERT_TIERS.map((t) => t.column)).size === ALERT_TIERS.length, 'each tier has its own idempotency column');
}

// ---------------------------------------------------------------------------
section('wiring: the cap row, the purge classification, the event names:');
{
  const f = FEATURE_LIMITS['deadline-refresh'];
  assert(f && f.resetPeriod === 'week' && f.limits.free === 1 && f.limits.premium === null, '§4: 1 grounded refresh/week free, on demand for paid');
  assert(f.one === 'deadline refresh', 'a cap of 1 has a singular label ("1 free deadline refresh")');
  assert(USER_ID_TABLES.includes('deadlines'), 'the table is purged with the account (test:purge enforces the other direction)');
  for (const n of ['deadline_saved', 'deadline_dismissed', 'deadline_done', 'radar_refresh']) {
    assert(REGISTERED_EVENTS.has(n) && isAllowedName(n), `${n} is registered, not merely prefix-tolerated`);
  }
  assert(!REGISTERED_EVENTS.has('deadline_alert_click'), '§6\'s deadline_alert_click is deliberately absent (UTM, not a pixel — see EVENTS.md)');
  assert(EMAIL_TYPES.includes('deadline_t3') && EMAIL_TYPES.includes('deadline_t14'), 'both alert tiers are registered email types');
}

// ---------------------------------------------------------------------------
section('alert email: category, unsubscribe, UTM, and no invented dates:');
{
  const mail = await deadlineAlertEmail(ENV_BASE, 'a@b.com', [
    { title: 'Summer Analyst Program', org: 'Goldman Sachs', url: 'https://www.goldmansachs.com/x', due_date: inDays(2) },
    { title: 'Rhodes Scholarship', org: 'Rhodes Trust', url: 'javascript:alert(1)', due_date: inDays(3) },
  ], 't3', NOW);
  assert(/cat=deadlines/.test(mail.listUnsubscribe), 'one-click unsubscribe turns off THIS category, not the weekly plan');
  assert(mail.html.includes(ENV_BASE.MAILING_ADDRESS), 'CAN-SPAM postal address');
  assert(/utm_medium=deadline/.test(mail.html) && /utm_campaign=t3/.test(mail.html), 'the CTA carries UTM — this is how the click is measured');
  assert(/#deadlines/.test(mail.html), 'and deep-links to the radar itself, not the page top');
  assert(mail.html.includes('Summer Analyst Program') && mail.html.includes(inDays(2)), 'the real date is printed, never a relative guess alone');
  assert(!/javascript:/i.test(mail.html), 'a non-https url never becomes an href in an email');
  assert(/2 deadlines closing soon/.test(mail.subject), 'one email lists them all — three separate mails in one evening is how a warning becomes spam');
  const one = await deadlineAlertEmail(ENV_BASE, 'a@b.com', [{ title: 'Solo', org: '', url: '', due_date: inDays(10) }], 't14', NOW);
  assert(/1 deadline in about two weeks/.test(one.subject), 'and the singular reads right');
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
  const kv = () => {
    const map = new Map();
    return {
      map,
      get: async (k, type) => {
        if (!map.has(k)) return null;
        const v = map.get(k);
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (k, v) => { map.set(k, String(v)); },
      delete: async (k) => map.delete(k),
      list: async () => ({ keys: [] }),
    };
  };

  const sqlite = new DatabaseSync(':memory:');
  for (const m of ['0001_auth.sql', '0009_v2_notifications.sql', '0013_user_profiles.sql', '0017_analytics.sql', '0019_email_v2.sql', '0020_deadlines.sql']) {
    sqlite.exec(readMig(m));
  }
  const env = { ...ENV_BASE, DB: d1For(sqlite), COACH_KV: kv() };

  assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deadlines'").get() != null, 'migration 0020 creates the table');
  assert(sqlite.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND tbl_name='deadlines'").get().c >= 4, 'and its four indexes');

  const A = 'a@x.com';
  const B = 'b@x.com';
  await createUser(env, A, 'h');
  await createUser(env, B, 'h');
  sqlite.exec("UPDATE users SET verified_at='2026-01-01T00:00:00.000Z', notify_deadlines=1 WHERE email IN ('a@x.com','b@x.com')");

  const item = (title, dueDate, kind = 'internship') => {
    const titleKey = normalizeTitleKey(title);
    return { kind, title, org: 'Goldman Sachs', dueDate, url: 'https://x.example/a', titleKey, dedupeKey: dedupeKeyFor(titleKey, dueDate) };
  };

  // -------------------------------------------------------------------------
  section('upsert dedupe: the thing a weekly refresh gets wrong:');
  {
    const first = await upsertDeadlines(env, A, [item('Summer Analyst Program', inDays(120))], { now: NOW, careerSlug: 'ib' });
    assert(first.added === 1, 'a new deadline is inserted');

    const again = await upsertDeadlines(env, A, [item('The Summer Analyst Programme 2027', inDays(120))], { now: NOW });
    assert(again.added === 0 && again.updated === 1, 'the SAME program worded differently updates the row instead of adding a second');
    assert(sqlite.prepare('SELECT COUNT(*) c FROM deadlines WHERE user_id=?').get(A).c === 1, 'still exactly one row');

    // The case the month-keyed unique index alone would miss.
    const shifted = await upsertDeadlines(env, A, [item('Summer Analyst Program', shiftDate(inDays(120), 4))], { now: NOW });
    const row = sqlite.prepare('SELECT * FROM deadlines WHERE user_id=?').get(A);
    assert(shifted.updated === 1 && sqlite.prepare('SELECT COUNT(*) c FROM deadlines WHERE user_id=?').get(A).c === 1,
      'a corrected date inside the merge window updates, even across a month boundary — the near-window match, not the unique index');
    assert(row.due_date === shiftDate(inDays(120), 4), 'and the corrected date is what is stored');
    assert(row.refreshed_at && row.created_at, 'refreshed_at moves, created_at stays');

    // Far enough away to be a genuinely different round.
    const other = await upsertDeadlines(env, A, [item('Summer Analyst Program', inDays(300))], { now: NOW });
    assert(other.added === 1, 'the same program a season later IS a second deadline, not a duplicate');
    assert(sqlite.prepare('SELECT COUNT(*) c FROM deadlines WHERE user_id=?').get(A).c === 2, 'two rows now');
  }

  // -------------------------------------------------------------------------
  section('dismissal survives a refresh (the invariant the whole feature rests on):');
  {
    await upsertDeadlines(env, A, [item('Unwanted Fellowship', inDays(90), 'fellowship')], { now: NOW });
    const id = sqlite.prepare("SELECT id FROM deadlines WHERE user_id=? AND title LIKE 'Unwanted%'").get(A).id;
    assert(await setStatus(env, A, id, 'dismissed'), 'the student dismisses it');

    const res = await upsertDeadlines(env, A, [item('Unwanted Fellowship', inDays(90), 'fellowship')], { now: NOW });
    const after = sqlite.prepare('SELECT status FROM deadlines WHERE id=?').get(id);
    assert(res.added === 0, 'the next refresh does not re-add it');
    assert(after.status === 'dismissed', 'and does NOT flip it back to tracked — "dismiss" cannot mean "hide until Tuesday"');

    const visible = await listUpcoming(env, A, { now: NOW });
    assert(!visible.some((r) => r.id === id), 'so it stays out of the radar');
    assert(sqlite.prepare('SELECT COUNT(*) c FROM deadlines WHERE id=?').get(id).c === 1, 'while remaining in D1 — the row IS the dedupe memory');
  }

  // -------------------------------------------------------------------------
  section('reads: what the radar, the chip and Marco see:');
  {
    // The store trusts its input (both callers validate first — proved above),
    // so the read is the second line of defence: a row whose date has since
    // passed must fall out of the radar on its own rather than needing a sweep.
    sqlite.exec(`INSERT INTO deadlines (id,user_id,title,org,kind,due_date,url,source,career_slug,status,title_key,dedupe_key,created_at)
                 VALUES ('dl-past','a@x.com','Yesterday','','competition','${inDays(-1)}','','grounded','','tracked','yesterday','yesterday|x','2026-01-01T00:00:00Z')`);
    const rows = await listUpcoming(env, A, { now: NOW });
    assert(!rows.some((r) => r.id === 'dl-past'), 'a date that has since passed drops out of the radar');
    assert(rows.every((r, i) => i === 0 || rows[i - 1].due_date <= r.due_date), 'soonest first');

    const next = await nextTracked(env, A, NOW);
    assert(next && next.deadline === rows[0].due_date, 'the This Week chip and the radar agree on what is next');
    assert(next.daysOut === daysUntil(next.deadline, NOW), 'and daysOut is recomputed, never stored');
    assert((await nextTracked(env, B, NOW)) === null, 'a user with no deadlines gets null, not someone else\'s');
  }

  // -------------------------------------------------------------------------
  section('cross-user authz:');
  {
    const aId = sqlite.prepare('SELECT id FROM deadlines WHERE user_id=? LIMIT 1').get(A).id;
    assert((await setStatus(env, B, aId, 'done')) === false, 'B cannot flip A\'s deadline');
    assert(sqlite.prepare('SELECT status FROM deadlines WHERE id=?').get(aId).status !== 'done', 'and A\'s row is untouched');
    assert((await setStatus(env, A, aId, 'nonsense')) === false, 'an unknown status is refused');
  }

  // -------------------------------------------------------------------------
  section('alert selection + exactly-once:');
  {
    const C = 'c@x.com';   // verified + opted in
    const D = 'd@x.com';   // verified, opted OUT
    const E = 'e@x.com';   // opted in, UNverified
    for (const e of [C, D, E]) await createUser(env, e, 'h');
    sqlite.exec("UPDATE users SET verified_at='2026-01-01T00:00:00.000Z', notify_deadlines=1 WHERE email='c@x.com'");
    sqlite.exec("UPDATE users SET verified_at='2026-01-01T00:00:00.000Z', notify_deadlines=0 WHERE email='d@x.com'");
    sqlite.exec("UPDATE users SET verified_at=NULL, notify_deadlines=1 WHERE email='e@x.com'");
    let n = 0;
    const seed = (who, days) => {
      n += 1;
      sqlite.exec(`INSERT INTO deadlines (id,user_id,title,org,kind,due_date,url,source,career_slug,status,title_key,dedupe_key,created_at)
                   VALUES ('seed-${n}','${who}','Seed ${n}','','internship','${inDays(days)}','','grounded','','tracked','seed-${n}','seed-${n}|x','2026-01-01T00:00:00Z')`);
      return `seed-${n}`;
    };
    const c2 = seed(C, 2);      // t3
    const c5 = seed(C, 5);      // t3 — the day an exact T-3 trigger would have missed
    const c10 = seed(C, 10);    // t14
    const c20 = seed(C, 20);    // neither, yet
    seed(D, 2);
    seed(E, 2);

    const t3 = await selectAlertBatch(env, 't3', { now: NOW });
    const t3ids = t3.map((r) => r.id);
    assert(t3ids.includes(c2) && t3ids.includes(c5), 'the closing-soon tier covers 1..7 days — a deadline found on day 5 still gets warned about');
    assert(!t3ids.includes(c10) && !t3ids.includes(c20), 'and nothing outside its window');
    assert(t3.every((r) => r.user_id === C), 'an opted-out user and an unverified one are never even loaded');

    const t14 = await selectAlertBatch(env, 't14', { now: NOW });
    assert(t14.map((r) => r.id).includes(c10) && !t14.map((r) => r.id).includes(c2), 'the two-weeks tier is disjoint from it');

    assert((await markAlerted(env, 't3', t3ids, NOW)) === t3ids.length, 'a successful send marks its rows');
    assert((await selectAlertBatch(env, 't3', { now: NOW })).length === 0, 'and they are never selected again — one warning per deadline per tier');
    assert((await selectAlertBatch(env, 't14', { now: NOW })).length === t14.length, 'marking one tier does not consume the other');
    assert(sqlite.prepare('SELECT alerted_t3 FROM deadlines WHERE id=?').get(c2).alerted_t3 != null, 'the marker is a timestamp on the row, not an email_log guard');

    sqlite.exec(`UPDATE deadlines SET status='dismissed' WHERE id='${c10}'`);
    assert((await selectAlertBatch(env, 't14', { now: NOW })).every((r) => r.id !== c10), 'a dismissed deadline stops alerting immediately');
  }

  // -------------------------------------------------------------------------
  section('§4 meter: one grounded refresh a week, and the refund:');
  {
    const key = featureKvKey('deadline-refresh', A, NOW, 'free');
    assert(/^dlrefreshwk:a@x\.com:\d{4}-\d{2}-\d{2}$/.test(key), 'the counter keys on the UTC Monday of the week');
    // 2026-07-24 is a Friday; its week key must be Monday the 20th.
    assert(key.endsWith(':2026-07-20'), 'and a Friday belongs to the Monday four days back');

    const first = await checkFeatureLimit(env, A, 'deadline-refresh', { plan: 'free', now: NOW });
    assert(first.ok && first.remaining === 0, 'the free account gets exactly one');
    const second = await checkFeatureLimit(env, A, 'deadline-refresh', { plan: 'free', now: NOW });
    assert(!second.ok && second.upgrade && /1 free deadline refresh/.test(second.message), 'the second is refused, with the singular and the lift');

    await refundFeatureUse(env, A, 'deadline-refresh', { plan: 'free', now: NOW });
    assert((await checkFeatureLimit(env, A, 'deadline-refresh', { spend: false, plan: 'free', now: NOW })).ok,
      'a refresh that produced nothing hands the week back');

    const nextWeek = NOW + 7 * 86400000;
    assert((await checkFeatureLimit(env, A, 'deadline-refresh', { spend: false, plan: 'free', now: nextWeek })).ok, 'the allowance reopens next week');
    assert((await checkFeatureLimit(env, A, 'deadline-refresh', { spend: false, plan: 'premium', now: NOW })).unlimited, 'paid refreshes on demand');
  }

  // -------------------------------------------------------------------------
  section('handlers: auth, validation and the honest refusals:');
  {
    const ctx = (method, { token, body } = {}) => {
      const headers = new Headers({ 'content-type': 'application/json', origin: BASE });
      if (token) headers.set('cookie', `fw_session=${token}`);
      return {
        env,
        request: {
          url: `${BASE}/deadlines`,
          method,
          headers,
          json: async () => body,
        },
      };
    };
    const { token } = await createSession(env, A);
    const { token: tokenB } = await createSession(env, B);

    assert((await radar.onRequestGet(ctx('GET'))).status === 401, 'signed out → 401, never a leak');
    assert((await radar.onRequestPost(ctx('POST', { body: { action: 'add' } }))).status === 401, 'and on the write path too');

    const g = await radar.onRequestGet(ctx('GET', { token }));
    const gb = await g.json();
    assert(g.status === 200 && Array.isArray(gb.deadlines), 'a signed-in read returns the radar');
    assert(gb.grounded === false && gb.canRefresh === false, 'with grounding dark the client is told so rather than shown a dead button');
    assert(gb.cap && gb.cap.limit === 1 && gb.cap.resetPeriod === 'week', 'the cap ships with the list — the client never hand-writes a limit');
    assert(gb.kinds.join() === DEADLINE_KINDS.join(), 'the kind list is served, so the add-form select cannot drift from the server');
    assert(gb.deadlines.every((d) => d.daysOut >= 0 && d.status !== 'dismissed'), 'only upcoming, non-dismissed rows');

    const bad = await radar.onRequestPost(ctx('POST', { token, body: { action: 'add', title: '', dueDate: inDays(5) } }));
    assert(bad.status === 400 && /title is required/i.test((await bad.json()).error), 'a bad manual add answers with copy a student can act on');

    const added = await radar.onRequestPost(ctx('POST', { token, body: { action: 'add', title: 'My own deadline', dueDate: inDays(9), kind: 'club', url: 'https://ok.example/x' } }));
    const ab = await added.json();
    assert(added.status === 200 && ab.ok && ab.deadline.title === 'My own deadline', 'a good one is stored and returned');
    assert(ab.deadline.source === 'manual', 'and marked as the student\'s own');
    assert(ab.deadlines.some((d) => d.id === ab.deadline.id), 'the whole refreshed list comes back so the client re-renders from the server');

    const notMine = await radar.onRequestPost(ctx('POST', { token: tokenB, body: { action: 'status', id: ab.deadline.id, status: 'done' } }));
    assert(notMine.status === 404, 'another account gets 404 on A\'s deadline — not 403, which would confirm it exists');

    const mine = await radar.onRequestPost(ctx('POST', { token, body: { action: 'status', id: ab.deadline.id, status: 'done' } }));
    assert(mine.status === 200 && (await mine.json()).status === 'done', 'the owner can mark it done');

    const unknown = await radar.onRequestPost(ctx('POST', { token, body: { action: 'destroy' } }));
    assert(unknown.status === 400, 'an unknown action is 400, not 500');

    const refreshOff = await radar.onRequestPost(ctx('POST', { token, body: { action: 'refresh' } }));
    const ro = await refreshOff.json();
    assert(refreshOff.status === 200 && ro.reason === 'grounding-off' && Array.isArray(ro.deadlines),
      'a refresh with grounding off is an honest reason plus the existing list, never an error page');
    assert((await checkFeatureLimit(env, A, 'deadline-refresh', { spend: false, plan: 'free', now: NOW })).ok,
      'and it does NOT spend the week — nothing was scanned');
  }

  // -------------------------------------------------------------------------
  section('full grounded refresh, end to end (Gemini stubbed):');
  {
    const SRC = 'https://www.goldmansachs.com/careers/students/programs';
    const real = globalThis.fetch;
    let researchCalls = 0, shapeCalls = 0;
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const grounded = Array.isArray(body.tools) && body.tools.some((t) => t.google_search);
      let text;
      if (grounded) { researchCalls += 1; text = '- Goldman Sachs Summer Analyst applications close on a fixed date.'; } else {
        shapeCalls += 1;
        text = JSON.stringify({
          deadlines: [
            { kind: 'internship', title: 'Summer Analyst Program', org: 'Goldman Sachs', dueDate: inDays(150), url: SRC },
            { kind: 'internship', title: 'Ghost Program', org: 'Nobody', dueDate: inDays(150), url: 'https://not-a-source.example/x' },
          ],
        });
      }
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text }] },
          ...(grounded ? { groundingMetadata: { groundingChunks: [{ web: { uri: SRC, title: 'GS careers' } }] } } : {}),
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const genv = { ...env, GROUNDING_ENABLED: 'true', GEMINI_API_KEY: 'test-key' };
    await saveUserBlob(genv, B, { careerFocus: { name: 'Investment Banker', slug: 'investment-banker' } });

    const r1 = await refreshDeadlinesForUser(genv, B, { school: 'Rice University', now: NOW });
    assert(r1.ok, `a full refresh succeeds (reason=${r1.reason || 'none'}, research=${researchCalls}, shape=${shapeCalls})`);
    assert(researchCalls === 3, 'three research queries were issued');
    assert(r1.found === 1 && r1.added === 1, 'the sourced item lands; the one citing a URL nobody fetched does not');
    assert(sqlite.prepare("SELECT COUNT(*) c FROM deadlines WHERE user_id='b@x.com' AND title='Ghost Program'").get().c === 0,
      'the ghost never reaches D1 — the invariant is enforced in the sanitizer, not the prompt');
    const stored = sqlite.prepare("SELECT * FROM deadlines WHERE user_id='b@x.com'").get();
    assert(stored.url === SRC && stored.source === 'grounded' && stored.career_slug === 'investment-banker', 'provenance is stored with the row');

    const r2 = await refreshDeadlinesForUser(genv, B, { school: 'Rice University', now: NOW });
    assert(r2.ok && r2.added === 0 && r2.updated === 1, 'running it again updates rather than duplicates — the whole point of the weekly refresh');
    assert(sqlite.prepare("SELECT COUNT(*) c FROM deadlines WHERE user_id='b@x.com'").get().c === 1, 'still one row after two refreshes');
    assert(researchCalls === 3, 'and the second refresh spent NO new research — the shared query cache served it');

    // The two early exits, on the same stub.
    assert((await refreshDeadlinesForUser({ ...genv, GROUNDING_ENABLED: 'false' }, B, { now: NOW })).reason === 'grounding-off', 'flag off is a reason, not a throw');
    const noCareer = await refreshDeadlinesForUser(genv, 'nobody@x.com', { now: NOW });
    assert(noCareer.reason === 'no-career', 'an account with no target career is skipped before anything is spent');

    globalThis.fetch = real;
  }

  // -------------------------------------------------------------------------
  section('the account ceiling:');
  {
    const F = 'f@x.com';
    await createUser(env, F, 'h');
    const many = Array.from({ length: MAX_USER_ROWS + 5 }, (_, i) => item(`Ceiling Program ${i}`, inDays(30 + i)));
    const res = await upsertDeadlines(env, F, many, { now: NOW });
    assert(res.added === MAX_USER_ROWS, `a single account cannot grow past ${MAX_USER_ROWS} rows`);
    assert(await countRows(env, F) === MAX_USER_ROWS, 'and the count agrees');
    const refreshed = await upsertDeadlines(env, F, [item('Ceiling Program 0', inDays(31))], { now: NOW });
    assert(refreshed.updated === 1, 'but an EXISTING row still gets its corrected date — a full radar is not a frozen one');
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall deadline checks passed');
process.exit(fail ? 1 : 0);
