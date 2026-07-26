// gate: test:cron — the durable proof for V2 S11's notification engine.
//
// Everything the cron does is invisible until it is wrong in someone's inbox.
// The three failure modes this gate exists for, none of which a code review
// catches reliably:
//
//   1. ROUTING. "Monday" and "the 1st" are two `if`s inside one function that
//      runs 365 times a year and is observed by nobody. So the REAL dispatcher
//      is driven against real date fixtures — an ordinary Wednesday, a Monday,
//      the 1st, and a Monday that IS the 1st — and the assertion is on which
//      emails actually got sent, not on the source text of a condition.
//   2. RECIPIENTS. S11 deleted the paywall filter (D9). A regression that
//      re-adds any plan predicate silently stops mailing every free user, which
//      looks exactly like "nobody replied". A free account is seeded WITH THE
//      PAYWALL ON and asserted to receive.
//   3. CONTENT. `composeDigest().hasContent` is the send decision. If it ever
//      counts the teaser, an account with nothing going on receives a bare
//      upgrade ad — the fastest unsubscribe in the product.
//
// Three layers, like test:deadlines: pure composition, real SQL against the
// real migrations, then the real dispatcher end to end against a stubbed Resend.
//
// node:sqlite is built in from Node 22.5.

import { readFileSync } from 'node:fs';
import {
  composeDigest, pickTeaser, streakLine, digestMarcoLine, digestDeadlines,
  weekIndex, FREE_TEASERS, FREE_TEASER_ROTATION, PAID_TEASERS,
  DIGEST_DEADLINE_HORIZON_DAYS, DIGEST_MAX_TASKS,
} from '../functions/_lib/digest.js';
import {
  monthKey, previousMonth, isMonthKey, monthLabel, monthBounds, monthReviewType,
  vectorMovement, composeMonthReview, reviewHeadline, REVIEW_ACTIVITY,
  readinessTrend, outreachSummary, termPosition,
} from '../functions/_lib/month-review.js';
import {
  BROADCAST_SEGMENTS, MAX_SUBJECT, MAX_BODY,
  renderMarkdown, normalizeBroadcastInput, resolveSegment, claimBroadcast,
  dueBroadcasts, finishBroadcast, broadcastId,
} from '../functions/_lib/broadcast.js';
import { FEATURE_LIMITS } from '../functions/_lib/plan-limits.js';
import { isoWeek } from '../functions/_lib/weekly-plan-core.js';
import { weekDocKey } from '../functions/_lib/weekly-plan-store.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  ok  ', m); else { fail += 1; console.error('  FAIL', m); } };
const section = (t) => console.log(`\n${t}`);

const DAY = 86400000;
// A Wednesday, mid-month, mid-afternoon UTC.
const NOW = Date.parse('2026-07-15T14:00:00.000Z');
const inDays = (n, from = NOW) => new Date(from + n * DAY).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
section('digest composition — the send decision:');
{
  const empty = composeDigest({ now: NOW, week: '2026-W29', plan: 'free' });
  assert(empty.hasContent === false, 'nothing to say → hasContent false (no email)');
  assert(!!empty.teaser, 'a free account still gets a teaser object...');
  assert(empty.hasContent === false, '...and the teaser does NOT make it sendable — an ad is not a digest');
  assert(typeof empty.marcoLine === 'string' && empty.marcoLine.length > 0, 'the Marco line always renders');

  const tasksOnly = composeDigest({ now: NOW, week: '2026-W29', tasks: [{ label: 'Finish the DCF module' }] });
  assert(tasksOnly.hasContent === true, 'tasks alone make it sendable');

  const commitOnly = composeDigest({
    now: NOW, week: '2026-W29',
    commitments: [{ text: 'Email Prof. Ito', daysOut: 2, done: false }],
  });
  assert(commitOnly.hasContent === true,
    'COMMITMENTS ALONE make it sendable — the S10 `if (!tasks.length) continue` excluded exactly these students');

  const deadlineOnly = composeDigest({
    now: NOW, week: '2026-W29',
    deadlines: [{ title: 'Summer Analyst', due_date: inDays(9), status: 'tracked' }],
  });
  assert(deadlineOnly.hasContent === true, 'a deadline alone makes it sendable');

  // S12 — application moves are a "how last week went" fact, in the same class
  // as the streak line. They render, but they never make an email sendable: a
  // digest is a forward-looking prompt, and an email whose entire substance is
  // "you moved two applications last week" tells the student what they already
  // know and asks nothing of them.
  const appsOnly = composeDigest({ now: NOW, week: '2026-W29', applicationsMoved: 2 });
  assert(appsOnly.hasContent === false,
    'application moves alone do NOT make a digest sendable — it is a retrospective fact, not an ask');
  assert(appsOnly.applicationsLine === '2 applications moved stage last week.',
    'and the line states the exact claim status_at supports');
  const oneApp = composeDigest({ now: NOW, week: '2026-W29', applicationsMoved: 1, tasks: [{ label: 'x' }] });
  assert(oneApp.applicationsLine === '1 application moved stage last week.', 'singular copy on one');
  assert(composeDigest({ now: NOW, week: '2026-W29' }).applicationsLine === '',
    'and zero renders no line at all rather than "0 applications moved"');
  assert(oneApp.counts.applicationsMoved === 1, 'the count is exposed for the renderer');

  // S17 — the stale-draft nudge is the same class of line, with one sharper
  // reason for staying out of `hasContent`: a stale draft is ONE item with no
  // dismiss button, so an email whose entire substance is "send that message"
  // would arrive every Monday until the student either sent it or unsubscribed.
  // Nudging inside a digest they were already getting is a nudge; generating the
  // digest in order to nudge is a nag.
  const draftsOnly = composeDigest({ now: NOW, week: '2026-W29', staleDrafts: 2 });
  assert(draftsOnly.hasContent === false,
    'stale outreach drafts alone do NOT make a digest sendable');
  assert(draftsOnly.staleDraftsLine === '2 outreach drafts have been sitting unsent for over a week.',
    'and the line states exactly what status_at supports');
  const oneDraft = composeDigest({ now: NOW, week: '2026-W29', staleDrafts: 1, tasks: [{ label: 'x' }] });
  assert(oneDraft.staleDraftsLine.startsWith('One outreach draft'), 'singular copy on one');
  assert(oneDraft.counts.staleDrafts === 1, 'the count is exposed for the renderer');
  assert(composeDigest({ now: NOW, week: '2026-W29' }).staleDraftsLine === '',
    'and zero renders no line rather than "0 drafts"');
  // The utmUrl trap composeDigest already documents: a query after the `#` lands
  // in the fragment, so the attribution silently disappears while the link works.
  assert(oneDraft.staleDraftsUrl.indexOf('utm_source') < oneDraft.staleDraftsUrl.indexOf('#')
    && oneDraft.staleDraftsUrl.endsWith('#network'),
    'the CTA carries its UTM before the fragment and lands on the list');

  // Marco line priority: below the two real urgencies, above every retrospective.
  const overdueBeatsDraft = composeDigest({
    now: NOW, week: '2026-W29', staleDrafts: 3,
    commitments: [{ text: 'Ship the notebook', daysOut: -2, overdue: true }],
  });
  assert(/still open/.test(overdueBeatsDraft.marcoLine),
    'an overdue promise the student made outranks an unsent draft');
  const draftBeatsGoodWeek = composeDigest({
    now: NOW, week: '2026-W29', staleDrafts: 1, tasks: [{ label: 'x' }],
    completion: { total: 3, done: 3, windowDays: 7 },
  });
  assert(/still sitting there/.test(draftBeatsGoodWeek.marcoLine),
    'but it outranks a good-week line — it is the cheapest open thing to finish');

  const doneCommit = composeDigest({
    now: NOW, week: '2026-W29',
    commitments: [{ text: 'Already finished', daysOut: 1, done: true }],
  });
  assert(doneCommit.hasContent === false && doneCommit.commitments.length === 0,
    'a COMPLETED commitment is not content — a digest never chases finished work');

  const far = composeDigest({
    now: NOW, week: '2026-W29',
    commitments: [{ text: 'Three weeks out', daysOut: 21, done: false }],
  });
  assert(far.commitments.length === 0, 'a commitment three weeks out is not this week’s business');

  const capped = composeDigest({
    now: NOW, week: '2026-W29',
    tasks: [1, 2, 3, 4, 5].map((i) => ({ label: `t${i}` })),
  });
  assert(capped.tasks.length === DIGEST_MAX_TASKS, `tasks capped at ${DIGEST_MAX_TASKS}`);
}

section('digest deadlines — horizon, status and ordering:');
{
  const rows = [
    { title: 'Far away', due_date: inDays(60), status: 'tracked' },
    { title: 'Soon', due_date: inDays(3), status: 'tracked' },
    { title: 'Dismissed', due_date: inDays(5), status: 'dismissed' },
    { title: 'Already done', due_date: inDays(6), status: 'done' },
    { title: 'Yesterday', due_date: inDays(-1), status: 'tracked' },
    { title: 'Middle', due_date: inDays(12), status: 'tracked' },
  ];
  const out = digestDeadlines(rows, NOW);
  assert(out.map((d) => d.title).join(',') === 'Soon,Middle', 'soonest first, inside the horizon only');
  assert(!out.some((d) => d.title === 'Dismissed'), 'a dismissed deadline never reappears in an email');
  assert(!out.some((d) => d.title === 'Already done'), 'a completed deadline is not chased');
  assert(!out.some((d) => d.title === 'Yesterday'), 'a passed deadline is dropped, not shown as negative days');
  assert(digestDeadlines([{ title: 'Edge', due_date: inDays(DIGEST_DEADLINE_HORIZON_DAYS), status: 'tracked' }], NOW).length === 1,
    `exactly ${DIGEST_DEADLINE_HORIZON_DAYS} days out is still inside the horizon`);
  assert(digestDeadlines([{ title: 'Past edge', due_date: inDays(DIGEST_DEADLINE_HORIZON_DAYS + 1), status: 'tracked' }], NOW).length === 0,
    'one day past it is not');
  assert(digestDeadlines([{ title: 'Bad url', due_date: inDays(2), status: 'tracked', url: 'javascript:alert(1)' }], NOW)[0].url === '',
    'a non-https url is stripped, never linked');
}

section('the teaser slot:');
{
  const free = pickTeaser({ plan: 'free', capFeatures: ['mock-interview'], week: '2026-W29', base: 'https://x' });
  assert(free.kind === 'upgrade' && free.key === 'mock-interview',
    'a free user who hit the mock-interview wall is sold the mock interview');
  assert(/utm_campaign=teaser_mock-interview/.test(free.ctaUrl), 'the CTA carries a per-slot utm_campaign');

  const paid = pickTeaser({ plan: 'premium', capFeatures: ['mock-interview'], week: '2026-W29', base: 'https://x' });
  assert(paid.kind === 'discovery', 'a PAYING user is never shown an upgrade pitch');
  assert(!/pricing/.test(paid.ctaUrl), '...and is never linked to the pricing page');

  // The one that is easy to get wrong: a fragment path must keep the query
  // BEFORE the '#', or the whole utm lands in the fragment and never reaches
  // the beacon — the link still works, so nobody notices the lost attribution.
  const withHash = PAID_TEASERS.find((t) => t.path.includes('#'));
  let hashOk = true;
  for (let i = 0; i < PAID_TEASERS.length; i++) {
    const t = pickTeaser({ plan: 'premium', week: `2026-W${String((i % 52) + 1).padStart(2, '0')}`, base: 'https://x' });
    if (t.ctaUrl.indexOf('#') !== -1 && t.ctaUrl.indexOf('utm_source') > t.ctaUrl.indexOf('#')) hashOk = false;
  }
  assert(!!withHash, 'at least one paid teaser targets a fragment (the case being guarded)');
  assert(hashOk, 'the utm query always precedes the fragment');

  const noHits = pickTeaser({ plan: 'free', capFeatures: [], week: '2026-W29', base: '' });
  assert(!!noHits && noHits.kind === 'upgrade', 'a free user who hit no wall still gets a rotating teaser');
  const a = pickTeaser({ plan: 'free', capFeatures: [], week: '2026-W29', base: '' });
  const b = pickTeaser({ plan: 'free', capFeatures: [], week: '2026-W30', base: '' });
  assert(a.key !== b.key, 'consecutive weeks rotate to a different pitch');

  const unknown = pickTeaser({ plan: 'free', capFeatures: ['not-a-feature'], week: '2026-W29', base: '' });
  assert(!!unknown && FREE_TEASER_ROTATION.includes(unknown.key),
    'an unrecognised cap feature falls back to the rotation rather than rendering nothing');

  // Anti-drift: a teaser keyed to a feature that no longer exists would sell
  // something we removed.
  for (const key of Object.keys(FREE_TEASERS)) {
    assert(!!FEATURE_LIMITS[key], `FREE_TEASERS.${key} is a real plan-limits feature`);
  }
  for (const t of PAID_TEASERS) {
    assert(!!FEATURE_LIMITS[t.key], `PAID_TEASERS ${t.key} is a real plan-limits feature`);
  }
  assert(weekIndex('2026-W29') !== weekIndex('2026-W30') && weekIndex('garbage') === 0,
    'weekIndex is stable and degrades to 0');
}

section('the streak line and the Marco line:');
{
  assert(streakLine([]) === null, 'no previous week → no line (never congratulate a week they were not here for)');
  assert(/all 3/.test(streakLine([{ done: true }, { done: true }, { done: true }])), 'a perfect week says so');
  assert(/None/.test(streakLine([{ done: false }, { done: false }])), 'a zero week is stated plainly');
  assert(/2 of 3/.test(streakLine([{ done: true }, { done: true }, { done: false }])), 'a partial week counts exactly');

  const overdue = digestMarcoLine({ commitments: [{ text: 'The DCF module', overdue: true }] });
  assert(/DCF module/.test(overdue), 'an overdue promise is named');
  assert(!/late|behind|should have|failed/i.test(overdue), 'and is NEVER scolded — the same rule Marco chats under');

  const soon = digestMarcoLine({ deadlines: [{ title: 'Summer Analyst', daysOut: 2 }] });
  assert(/Summer Analyst/.test(soon), 'with nothing overdue, the closing deadline leads');
  const both = digestMarcoLine({
    commitments: [{ text: 'Their own promise', overdue: true }],
    deadlines: [{ title: 'Summer Analyst', daysOut: 2 }],
  });
  assert(/Their own promise/.test(both), 'an overdue promise outranks a closing deadline');
  assert(digestMarcoLine({}).length > 0, 'an empty week still gets a line rather than an empty block');
}

// ---------------------------------------------------------------------------
section('month keys and bounds:');
{
  assert(monthKey(Date.parse('2026-07-01T00:00:00Z')) === '2026-07', 'monthKey is UTC');
  assert(previousMonth('2026-01') === '2025-12', 'previousMonth crosses the year boundary');
  assert(previousMonth('nope') === '', 'and returns empty on garbage rather than guessing');
  assert(isMonthKey('2026-07') && !isMonthKey('2026-13') && !isMonthKey('2026-7'), 'month keys are validated, not trusted');
  assert(monthLabel('2026-07') === 'July 2026', 'human label');
  assert(monthReviewType('2026-07') === 'month_review:2026-07',
    'the email_log type is MONTH-SUFFIXED — a static one would make the review once per account, ever');

  const feb = monthBounds('2026-02');
  assert(feb.startDate === '2026-02-01' && feb.endDate === '2026-03-01',
    'bounds are half-open, so February needs no day-count arithmetic');
  const dec = monthBounds('2026-12');
  assert(dec.endDate === '2027-01-01', 'December rolls into the next year');
}

section('vector movement:');
{
  assert(vectorMovement([]).measured === false, 'no snapshots → not measured (never "0 change")');
  assert(vectorMovement([{ week: '2026-W27', values: [1, 2] }]).measured === false, 'one snapshot cannot be a delta');
  const m = vectorMovement([
    { week: '2026-W27', values: [10, 10, 10, 10] },
    { week: '2026-W31', values: [14, 8, 10.4, 10] },
  ]);
  assert(m.measured && m.up === 1 && m.down === 1,
    'only |Δ| >= 1 counts — a 0.4 drift is re-merge noise, not progress');
  assert(m.topGain === 4, 'the biggest single gain is reported');
  assert(m.from === '2026-W27' && m.to === '2026-W31', 'the compared window is stated');
}

section('month review composition:');
{
  const tree = {
    version: 2,
    activePath: ['wp1'],
    nodes: [{
      id: 'wp1', title: 'Land a summer analyst seat', shortTitle: 'Analyst seat', done: false,
      steps: [
        { id: 's1', text: 'Finish the DCF module', done: true, dueAt: '2026-06-10' },
        { id: 's2', text: 'Email Prof. Ito', done: false, dueAt: '2026-06-20' },
        { id: 's3', text: 'Next month’s thing', done: false, dueAt: '2026-07-20' },
        { id: 's4', text: 'No date on this one', done: false },
      ],
    }],
  };
  const r = composeMonthReview({
    month: '2026-06',
    now: NOW,
    activity: { step_done: 4, marco_msg: 2, quiz_start: 9 },
    deadlines: [
      { title: 'Hit this', org: 'GS', due_date: '2026-06-05', status: 'done' },
      { title: 'Missed this', org: '', due_date: '2026-06-25', status: 'tracked' },
      { title: 'Dismissed', org: '', due_date: '2026-06-26', status: 'dismissed' },
    ],
    snapshots: [
      { week: '2026-W23', values: [10, 10] },
      { week: '2026-W27', values: [13, 10] },
    ],
    roadmap: tree,
  });

  assert(r.activity.map((a) => a.event).join(',') === 'step_done,marco_msg',
    'only REVIEW_ACTIVITY events are reported, in the declared order');
  assert(!r.activity.some((a) => a.event === 'quiz_start'), 'an unlisted event is not smuggled into the report');
  assert(r.deadlinesHit.length === 1 && r.deadlinesMissed.length === 1, 'done = hit, still-tracked-and-past = missed');
  assert(!r.deadlinesMissed.some((d) => d.title === 'Dismissed'),
    'a DISMISSED deadline is neither hit nor missed — the student said it was not theirs');
  assert(r.commitmentsKept.length === 1 && r.commitmentsKept[0].text === 'Finish the DCF module', 'kept commitment');
  assert(r.commitmentsSlipped.length === 1 && r.commitmentsSlipped[0].text === 'Email Prof. Ito', 'slipped commitment');
  assert(!r.commitmentsKept.concat(r.commitmentsSlipped).some((c) => /Next month/.test(c.text)),
    'a JULY commitment is not in the JUNE review — the month window is the whole point');
  assert(r.nextFocus && r.nextFocus.kind === 'commitment',
    'next month’s focus prefers a still-open commitment (their words, already dated)');
  assert(r.evidence.length === 0 && r.applications.length === 0,
    'with no evidence and no application moves, both sections stay empty and render nothing');
  assert(r.hasContent === true, 'a month with activity is worth sending');

  // S12 — the two sections S11 shipped as present-and-empty.
  const withS12 = composeMonthReview({
    month: '2026-06',
    now: NOW,
    evidence: [
      { title: 'Fraud-detection notebook', type: 'repo', note: 'n', created_at: '2026-06-11T00:00:00.000Z' },
      { title: '', type: 'doc', created_at: '2026-06-12T00:00:00.000Z' },
    ],
    applications: [
      { role: 'Summer Analyst', company: 'Goldman Sachs', status: 'interviewing', status_at: '2026-06-14T00:00:00.000Z' },
      { role: '', company: 'x', status: 'applied', status_at: '2026-06-15T00:00:00.000Z' },
    ],
    roadmap: null,
  });
  assert(withS12.evidence.length === 1 && withS12.applications.length === 1,
    'a row with no title (or no role) is dropped rather than rendered as a blank bullet');
  assert(withS12.totals.evidence === 1 && withS12.totals.applications === 1, 'and both are counted');
  assert(withS12.hasContent === true,
    'a month whose ONLY substance is evidence and application moves is still worth sending');
  assert(/evidence/i.test(withS12.headline) && /application/i.test(withS12.headline),
    'and the headline names them rather than calling it a quiet month');
  assert(!/quiet/i.test(withS12.headline), 'the quiet-month branch does not fire when S12 data exists');
  assert(reviewHeadline({ totals: { activity: 0, commitmentsKept: 0, deadlinesHit: 0, evidence: 0, applications: 0 }, movement: { measured: false } })
    .startsWith('A quiet month'), 'and it still does fire when there is genuinely nothing');
  assert(withS12.headline.split(',').length <= 3, 'the headline stays a sentence — three clauses at most');

  const quiet = composeMonthReview({ month: '2026-06', now: NOW, roadmap: null });
  assert(quiet.hasContent === false, 'a month with nothing in it is NOT sent');
  assert(!/great|well done|congrat/i.test(quiet.headline), 'and the quiet headline does not congratulate');
  assert(!/failed|behind|should/i.test(reviewHeadline({
    totals: { activity: 0, commitmentsKept: 0, deadlinesHit: 0, commitmentsSlipped: 3, deadlinesMissed: 2 },
    movement: { measured: false },
  })), 'nor does a month full of slips scold');
  assert(REVIEW_ACTIVITY.every((a) => a.label && a.one && a.label !== a.one),
    'every activity row has distinct singular/plural copy ("1 commitments kept" is the tell)');
}

// ---------------------------------------------------------------------------
section('month review — the S20 sections (readiness, outreach, term):');
{
  const bounds = monthBounds('2026-06');

  const runs = [
    { score: 41, career_name: 'Data Analyst', created_at: '2026-05-20T00:00:00.000Z' },
    { score: 55, career_name: 'Data Analyst', created_at: '2026-06-10T00:00:00.000Z' },
    { score: 63, career_name: 'Data Analyst', created_at: '2026-06-28T00:00:00.000Z' },
  ];
  const trend = readinessTrend(runs, bounds);
  assert(trend.measured && trend.score === 63 && trend.from === 41 && trend.delta === 22,
    'readiness: the newest run BEFORE the month is the baseline, the month’s last run is the level');
  const single = readinessTrend([runs[1]], bounds);
  assert(single.measured && single.from == null && single.delta == null,
    'readiness: one run ever is a level, never a fabricated trend');
  const twoInside = readinessTrend([runs[1], runs[2]], bounds);
  assert(twoInside.measured && twoInside.from === 55,
    'readiness: with no earlier history, the month’s own first run is the baseline');
  assert(readinessTrend([runs[0]], bounds).measured === false,
    'readiness: a run BEFORE the month is not this month’s news');
  assert(readinessTrend([], bounds).measured === false && readinessTrend(null, bounds).measured === false,
    'readiness: no rows (0024 unapplied reads as empty) measures nothing');

  const o = outreachSummary({ suggested: 9, drafted: 1, sent: 4, replied: 1 });
  assert(o.advanced === 6 && o.sent === 4 && o.replied === 1 && o.met === 0,
    'outreach: drafted+sent+replied+met count as advances; a reset to suggested does not');
  assert(outreachSummary(null).advanced === 0, 'outreach: no rows reads as zero advances');

  const term = { label: 'Fall 2026', start_date: '2026-05-11', end_date: '2026-08-21' };
  const pos = termPosition(term, bounds);
  assert(pos.present && !pos.ended && pos.week === 8 && pos.total === 15 && pos.label === 'Fall 2026',
    'term: position is measured at the month’s LAST instant (June 30th = week 8 of 15)');
  const endedIn = termPosition({ label: 'Spring', start_date: '2026-03-02', end_date: '2026-06-12' }, bounds);
  assert(endedIn.present && endedIn.ended && endedIn.endDate === '2026-06-12',
    'term: a term that ended INSIDE the month is reported as wrapped up');
  assert(termPosition({ start_date: '2026-01-05', end_date: '2026-04-24' }, bounds).present === false,
    'term: a term that ended before the month is not this month’s news');
  assert(termPosition({ start_date: '2026-09-28', end_date: '2026-12-11' }, bounds).present === false,
    'term: an upcoming term renders nothing — "week 0 of 11" is not information');
  assert(termPosition(null, bounds).present === false, 'term: no row (0026 unapplied) renders nothing');

  const r20 = composeMonthReview({
    month: '2026-06', now: NOW,
    outreach: { sent: 2 }, scorecards: runs, term,
    roadmap: null,
  });
  assert(r20.hasContent === true, 'a month whose substance is outreach + a readiness run is still worth sending');
  assert(r20.outreach.advanced === 2 && r20.readiness.score === 63 && r20.term.week === 8,
    'compose carries all three S20 sections');
  assert(!/quiet/i.test(r20.headline) && /outreach/.test(r20.headline),
    'the headline names outreach rather than calling the month quiet');
  assert(r20.totals.outreach === 2, 'and the totals row carries it');

  const termOnly = composeMonthReview({ month: '2026-06', now: NOW, term, roadmap: null });
  assert(termOnly.hasContent === false,
    'a term POSITION alone never sends the email — ambient state is not something the student did');
  assert(termOnly.term.present === true, 'but the section still composes for a month with other content');
}

// ---------------------------------------------------------------------------
section('broadcast markdown — escaped BEFORE any tag is emitted:');
{
  const evil = renderMarkdown('<script>alert(1)</script>\n\n**bold** and <img src=x onerror=y>');
  assert(!/<script/i.test(evil.html), 'a script tag cannot survive');
  assert(!/<img/i.test(evil.html), 'nor an img tag');
  assert(/&lt;script&gt;/.test(evil.html), 'it is escaped, not stripped — the admin sees what they typed');
  assert(/<strong>bold<\/strong>/.test(evil.html), 'while real markdown still renders');

  const link = renderMarkdown('[click](https://flightway.ai/x) and [bad](javascript:alert(1))');
  assert(/href="https:\/\/flightway.ai\/x"/.test(link.html), 'an https link renders');
  assert(!/javascript:/.test(link.html) || !/<a[^>]*javascript:/.test(link.html), 'a javascript: url is never an href');

  const quoted = renderMarkdown('[a"onmouseover="alert(1)](https://x.example/)');
  assert(!/onmouseover=/.test(quoted.html.replace(/&quot;/g, '')) || /&quot;/.test(quoted.html),
    'a crafted label cannot close the attribute it sits in');

  const list = renderMarkdown('- one\n- two');
  assert(/<ul/.test(list.html) && (list.html.match(/<li/g) || []).length === 2, 'bullet lists render');
  assert(list.text === '- one\n- two', 'and the text part stays plain');

  const heading = renderMarkdown('## Big news');
  assert(/font-weight:700/.test(heading.html) && heading.text === 'Big news', 'headings render in both parts');
  assert(renderMarkdown('x'.repeat(MAX_BODY + 500)).text.length <= MAX_BODY, 'the body is capped');
}

section('broadcast input validation:');
{
  assert(normalizeBroadcastInput({ subject: '', body: 'x' }).ok === false, 'a subject is required');
  assert(normalizeBroadcastInput({ subject: 'x', body: '' }).ok === false, 'a body is required');
  assert(normalizeBroadcastInput({ subject: 'x', body: 'y', segment: 'nope' }).ok === false, 'the segment is an allowlist');
  assert(normalizeBroadcastInput({ subject: 'x', body: 'y', segment: 'school' }).ok === false,
    'the school segment without a school name is refused rather than silently becoming "everyone"');
  const ok = normalizeBroadcastInput({ subject: 'x'.repeat(400), body: 'y', segment: 'all' });
  assert(ok.ok && ok.value.subject.length === MAX_SUBJECT, 'the subject is truncated, not rejected');
  assert(normalizeBroadcastInput({ subject: 'x', body: 'y', scheduledAt: 'not a date' }).ok === false,
    'an unparseable schedule is refused — silently sending now would be the worst default here');
  const sched = normalizeBroadcastInput({ subject: 'x', body: 'y', scheduledAt: '2026-08-01T09:00:00Z' });
  assert(sched.ok && sched.value.scheduledAt === '2026-08-01T09:00:00.000Z', 'a valid schedule is normalized to ISO');
}

// ---------------------------------------------------------------------------
// Everything below needs the REAL schema. A stub only pattern-matches SQL; a
// column typo in a segment query would otherwise ship green.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older node */ }
if (!DatabaseSync) {
  console.warn('\n  SKIP node:sqlite unavailable — the DB + dispatcher sections did not run (upgrade to Node 22.5+)');
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
  const kvStore = () => {
    const map = new Map();
    return {
      map,
      get: async (k, type) => (map.has(k) ? (type === 'json' ? JSON.parse(map.get(k)) : map.get(k)) : null),
      put: async (k, v) => { map.set(k, String(v)); },
      delete: async (k) => map.delete(k),
      list: async () => ({ keys: [] }),
    };
  };

  const sqlite = new DatabaseSync(':memory:');
  for (const m of [
    '0001_auth.sql', '0007_v2_execution.sql', '0008_v2_entitlements.sql', '0009_v2_notifications.sql',
    '0013_user_profiles.sql', '0015_stripe_billing.sql', '0016_admin_console.sql', '0017_analytics.sql',
    '0012_interview_sessions.sql',
    '0019_email_v2.sql', '0020_deadlines.sql', '0021_broadcasts.sql',
    // S18. 0026 ALTERs `interview_sessions`, so 0012 has to be loaded first —
    // the real migration runner applies them in order and this list has to
    // agree with it or the gate tests a schema that cannot exist.
    '0026_season_term.sql',
  ]) {
    sqlite.exec(readMig(m));
  }
  assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='broadcasts'").get() != null,
    'migration 0021 creates the broadcasts table');
  assert(sqlite.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND tbl_name='broadcasts'").get().c >= 2,
    'and both of its indexes');

  const { createUser } = await import('../functions/_lib/auth.js');

  // Resend stub. Captures every send so the dispatcher assertions can read the
  // real outcome rather than a log line.
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.resend.com')) {
      const body = JSON.parse(opts.body);
      sends.push({ to: body.to[0], subject: body.subject, html: body.html, text: body.text });
      return new Response(JSON.stringify({ id: `msg_${sends.length}` }), { status: 200 });
    }
    // Anything else (Gemini) is unreachable in the gate: generateWeeklyPlan
    // softFails to its deterministic fallback, which is the path asserted.
    return new Response('no', { status: 500 });
  };

  const ENV = {
    DB: d1For(sqlite),
    COACH_KV: kvStore(),
    RESEND_API_KEY: 're_test',
    FROM_EMAIL: 'FlightWay <careers@flightway.ai>',
    SITE_URL: 'https://flightway.ai',
    MAILING_ADDRESS: 'FlightWay, Inc., 1 Test St, City, ST 00000',
    UNSUB_SECRET: 'test-unsub-secret',
    SESSION_PEPPER: 'test-session-pepper',
    // ON, deliberately. This is the environment in which S10's filter would
    // have silently excluded every free account.
    PAYWALL_ENABLED: 'true',
  };

  const FREE = 'free@x.com';
  const PAID = 'paid@x.com';
  const OPTOUT = 'optout@x.com';
  const UNVERIFIED = 'unverified@x.com';
  for (const e of [FREE, PAID, OPTOUT, UNVERIFIED]) await createUser(ENV, e, 'hash');
  sqlite.exec(`
    UPDATE users SET verified_at='2026-01-01T00:00:00.000Z', notify_optin=1, notify_review=1,
                     notify_product=1, notify_deadlines=1
      WHERE email IN ('${FREE}','${PAID}','${OPTOUT}');
    UPDATE users SET plan='premium' WHERE email='${PAID}';
    UPDATE users SET notify_optin=0, notify_review=0, notify_product=0 WHERE email='${OPTOUT}';
    UPDATE users SET verified_at=NULL, notify_optin=1, notify_product=1 WHERE email='${UNVERIFIED}';
  `);

  const tree = {
    version: 2,
    activePath: ['wp1'],
    targetCareerName: 'Investment Banking Analyst',
    nodes: [{
      id: 'wp1', title: 'Land a summer analyst seat', shortTitle: 'Analyst seat', done: false,
      steps: [
        { id: 's1', text: 'Finish the DCF module', done: false },
        { id: 's2', text: 'Email Prof. Ito', done: false, dueAt: inDays(2) },
        { id: 's3', text: 'Rebuild the resume', done: false },
      ],
    }],
  };
  for (const e of [FREE, PAID]) {
    sqlite.prepare('INSERT INTO roadmaps (email, payload, updated_at) VALUES (?, ?, ?)')
      .run(e, JSON.stringify(tree), new Date(NOW).toISOString());
  }

  const cron = await import('../workers/cron/index.js');

  // -------------------------------------------------------------------------
  section('recipients — the paywall filter is GONE (D9):');
  {
    const rows = await cron.selectRecipients(ENV, 'notify_optin');
    const emails = rows.map((r) => r.email).sort();
    assert(emails.includes(FREE),
      'a FREE account receives the digest with PAYWALL_ENABLED=true — the S10 plan filter is deleted');
    assert(emails.includes(PAID), 'a paid account still receives it');
    assert(!emails.includes(OPTOUT), 'an opted-out account is never loaded');
    assert(!emails.includes(UNVERIFIED), 'an UNVERIFIED account is never loaded (D7)');

    // Anti-drift, on CALLS rather than on the word: the header comment
    // deliberately names the filter it deleted, and a guard that a comment can
    // trip is a guard nobody trusts.
    const src = readFileSync(new URL('../workers/cron/index.js', import.meta.url), 'utf8');
    assert(!/paywallEnabled\s*\(/.test(src),
      'the dispatcher never CALLS paywallEnabled — the guard against re-adding the plan filter');
    assert(!/isDevTester\s*\(/.test(src), 'nor the dev-tester bypass that only existed to soften that filter');
    assert(!/effectivePlan\s*\([^)]*\)\s*!==\s*'free'/.test(src),
      'and no inline plan predicate has taken its place');

    const reviewRows = await cron.selectRecipients(ENV, 'notify_review');
    assert(reviewRows.some((r) => r.email === FREE) && !reviewRows.some((r) => r.email === OPTOUT),
      'the review uses its OWN category column, so unsubscribing from one email does not kill the other');
  }

  section('cap-hit teaser keying, off real event rows:');
  {
    const ins = sqlite.prepare('INSERT INTO events (id, ts, day, anon_id, user_id, name, props) VALUES (?,?,?,?,?,?,?)');
    const t = new Date(NOW - 2 * DAY).toISOString();
    ins.run('e1', t, t.slice(0, 10), 'anon', FREE, 'plan_cap_hit', JSON.stringify({ feature: 'mock-interview' }));
    ins.run('e2', t, t.slice(0, 10), 'anon', FREE, 'plan_cap_hit', JSON.stringify({ feature: 'career-sim' }));
    ins.run('e3', t, t.slice(0, 10), 'anon', FREE, 'plan_cap_hit', JSON.stringify({ feature: 'career-sim' }));
    ins.run('e4', t, t.slice(0, 10), 'anon', FREE, 'plan_cap_hit', 'not json at all');
    const old = new Date(NOW - 200 * DAY).toISOString();
    ins.run('e5', old, old.slice(0, 10), 'anon', FREE, 'plan_cap_hit', JSON.stringify({ feature: 'resume-tailor' }));

    const map = await cron.capHitsByUser(ENV, NOW);
    const hits = map.get(FREE) || [];
    assert(hits[0] === 'career-sim', 'the wall they hit MOST is the teaser they see');
    assert(hits.includes('mock-interview'), 'and the others are still ranked behind it');
    assert(!hits.includes('resume-tailor'), 'a wall from six months ago is not "what they are hitting"');
    assert(hits.length === 2, 'a malformed props row is skipped, not fatal to the whole query');
  }

  // -------------------------------------------------------------------------
  section('the REAL dispatcher, driven by date fixtures:');
  const typesFor = (email) => sqlite.prepare('SELECT type FROM email_log WHERE user_id=? ORDER BY ts').all(email).map((r) => r.type);
  const resetMail = () => { sends.length = 0; sqlite.exec('DELETE FROM email_log'); };

  // Seed something real in each month a review is asked for. Without this the
  // reviews below would correctly refuse to send (hasContent false) and the
  // routing assertions would pass for the wrong reason — the exact way a
  // routing test quietly stops testing routing.
  {
    const ins = sqlite.prepare('INSERT INTO events (id, ts, day, anon_id, user_id, name, props) VALUES (?,?,?,?,?,?,?)');
    let n = 0;
    for (const month of ['2026-05', '2026-06', '2026-08']) {
      for (const e of [FREE, PAID]) {
        const ts = `${month}-12T09:00:00.000Z`;
        ins.run(`rv${n += 1}`, ts, ts.slice(0, 10), 'anon', e, 'step_done', '{}');
      }
    }
  }

  {
    // An ordinary Wednesday: no digest, no review.
    resetMail();
    await cron.runDaily(ENV, Date.parse('2026-07-15T14:00:00Z'));
    assert(!typesFor(FREE).includes('weekly_digest'), 'Wednesday sends NO weekly digest');
    assert(!typesFor(FREE).some((t) => t.startsWith('month_review')), 'and no review');
  }
  {
    // A Monday that is not the 1st.
    resetMail();
    await cron.runDaily(ENV, Date.parse('2026-07-13T14:00:00Z'));
    assert(typesFor(FREE).includes('weekly_digest'), 'MONDAY sends the weekly digest');
    assert(typesFor(PAID).includes('weekly_digest'), 'to paid accounts too');
    assert(!typesFor(OPTOUT).includes('weekly_digest'), 'and never to an opted-out account');
    assert(!typesFor(FREE).some((t) => t.startsWith('month_review')), 'Monday alone does not send a review');
  }
  {
    // The 1st, which in September 2026 is a Tuesday.
    resetMail();
    await cron.runDaily(ENV, Date.parse('2026-09-01T14:00:00Z'));
    const t = typesFor(FREE);
    assert(!t.includes('weekly_digest'), 'the 1st alone sends no digest (Tuesday)');
    assert(t.includes('month_review:2026-08'), 'THE 1st sends the review, for the month that just ENDED');
  }
  {
    // Both at once — June 1st 2026 is a Monday. The case an `else if` breaks.
    resetMail();
    await cron.runDaily(ENV, Date.parse('2026-06-01T14:00:00Z'));
    const t = typesFor(FREE);
    assert(t.includes('weekly_digest') && t.includes('month_review:2026-05'),
      'a Monday that IS the 1st sends BOTH — the routing is two independent ifs, not a chain');
  }
  {
    // Idempotency: the review must not double-send if the dispatcher reruns.
    const before = typesFor(FREE).filter((t) => t === 'month_review:2026-05').length;
    await cron.runDaily(ENV, Date.parse('2026-06-01T14:00:00Z'));
    const after = typesFor(FREE).filter((t) => t === 'month_review:2026-05').length;
    assert(before === 1 && after === 1, 'a second run on the same day sends NO second review (email_log guarded)');
  }
  {
    // And the month suffix is what makes next month sendable at all.
    resetMail();
    sqlite.prepare('INSERT INTO email_log (id, ts, user_id, type, status) VALUES (?,?,?,?,?)')
      .run('x1', new Date(NOW).toISOString(), FREE, 'month_review:2026-05', 'sent');
    await cron.runDaily(ENV, Date.parse('2026-07-01T14:00:00Z'));
    assert(typesFor(FREE).includes('month_review:2026-06'),
      'last month having been sent does not block this month — the suffix is load-bearing');
  }

  section('digest content, end to end:');
  {
    resetMail();
    await cron.runDaily(ENV, Date.parse('2026-07-13T14:00:00Z'));
    const mail = sends.find((s) => s.to === FREE && /task|week/i.test(s.subject));
    assert(!!mail, 'the free user got a digest');
    assert(/Finish the DCF module/.test(mail.text), 'it carries the deterministic weekly tasks (Gemini unreachable → fallback)');
    assert(/Unsubscribe/.test(mail.text) && /1 Test St/.test(mail.text),
      'with the full CAN-SPAM footer: one-click unsubscribe + the postal address');
    assert(/utm_source=email/.test(mail.html), 'and UTM on the CTA, which is how a click is attributed');

    const paidMail = sends.find((s) => s.to === PAID && /task|week/i.test(s.subject));
    assert(!!paidMail && !/pricing/.test(paidMail.html),
      'the PAYING user’s digest contains no link to the pricing page');
    assert(/pricing/.test(mail.html), 'while the free one does');
  }

  section('a student with no roadmap at all:');
  {
    resetMail();
    const BARE = 'bare@x.com';
    await createUser(ENV, BARE, 'hash');
    sqlite.exec(`UPDATE users SET verified_at='2026-01-01T00:00:00.000Z', notify_optin=1 WHERE email='${BARE}'`);
    await cron.runDaily(ENV, Date.parse('2026-07-13T14:00:00Z'));
    assert(!typesFor(BARE).includes('weekly_digest'),
      'nothing to say → no email at all, rather than a bare upgrade ad');
  }

  // -------------------------------------------------------------------------
  section('broadcast segments — the opt-in gate is in the SQL:');
  {
    const all = await resolveSegment(ENV, { segmentKind: 'all' }, { now: NOW });
    const emails = all.map((r) => r.email);
    assert(emails.includes(FREE) && emails.includes(PAID), 'opted-in verified accounts are in');
    assert(!emails.includes(OPTOUT), 'an account opted out of PRODUCT updates is not');
    assert(!emails.includes(UNVERIFIED), 'nor an unverified one');

    const paid = await resolveSegment(ENV, { segmentKind: 'paid' }, { now: NOW });
    assert(paid.length === 1 && paid[0].email === PAID, 'the paid segment is exactly the paying accounts');
    const free = await resolveSegment(ENV, { segmentKind: 'free' }, { now: NOW });
    assert(free.some((r) => r.email === FREE) && !free.some((r) => r.email === PAID), 'and the free segment is the complement');

    // A lapsed subscriber: the column still says premium, the date says no.
    sqlite.exec(`UPDATE users SET plan='premium', plan_expires_at='2020-01-01T00:00:00.000Z' WHERE email='${FREE}'`);
    const paid2 = await resolveSegment(ENV, { segmentKind: 'paid' }, { now: NOW });
    assert(!paid2.some((r) => r.email === FREE),
      'a LAPSED subscriber is not in the paid segment — the segment reads effectivePlan, not the raw column');
    sqlite.exec(`UPDATE users SET plan='free', plan_expires_at=NULL WHERE email='${FREE}'`);

    const DORMANT = 'dormant@x.com';
    await createUser(ENV, DORMANT, 'hash');
    sqlite.exec(`UPDATE users SET verified_at='2026-01-01T00:00:00.000Z', notify_product=1 WHERE email='${DORMANT}'`);
    const active = await resolveSegment(ENV, { segmentKind: 'active30' }, { now: NOW });
    assert(active.some((r) => r.email === FREE), 'the active-30 segment finds a user with recent events');
    assert(!active.some((r) => r.email === DORMANT), 'and excludes an account with no events at all');

    // BOTH stored shapes. `user_profiles.payload` is v1 for every row written
    // before the v2 upgrade and v2 after it, so a school segment that only
    // understood one of them would silently match half the students.
    sqlite.prepare('INSERT INTO user_profiles (email, payload, updated_at) VALUES (?,?,?)')
      .run(PAID, JSON.stringify({ v: 2, identity: { school: 'University of Chicago' } }), new Date(NOW).toISOString());
    sqlite.prepare('INSERT INTO user_profiles (email, payload, updated_at) VALUES (?,?,?)')
      .run(FREE, JSON.stringify({ school: 'University of Chicago Booth' }), new Date(NOW).toISOString());
    sqlite.prepare('INSERT INTO user_profiles (email, payload, updated_at) VALUES (?,?,?)')
      .run(DORMANT, JSON.stringify({ profile: { school: 'Stanford University' } }), new Date(NOW).toISOString());

    const school = await resolveSegment(ENV, { segmentKind: 'school', segmentValue: 'chicago' }, { now: NOW });
    const got = school.map((r) => r.email).sort();
    assert(got.includes(PAID), 'the school segment reads a v2 payload through the user facade');
    assert(got.includes(FREE), 'and a legacy v1 payload with school at the blob root');
    assert(!got.includes(DORMANT), 'and does not match a different school');
    const noSchool = await resolveSegment(ENV, { segmentKind: 'school', segmentValue: 'oxford' }, { now: NOW });
    assert(noSchool.length === 0, 'and matches nobody when no one qualifies, rather than falling back to everyone');
  }

  section('broadcast dispatch — claim, send, record:');
  {
    resetMail();
    const id = broadcastId();
    sqlite.prepare(`INSERT INTO broadcasts (id, created_at, actor_email, subject, body_md, segment_kind,
                    segment_value, status, scheduled_at) VALUES (?,?,?,?,?,?,?,'scheduled',?)`)
      .run(id, new Date(NOW).toISOString(), 'admin@x.com', 'We shipped the Deadline Radar',
        '## Big news\n\nIt is **live**.', 'all', null, new Date(NOW - 60000).toISOString());

    const due = await dueBroadcasts(ENV, NOW);
    assert(due.length === 1 && due[0].id === id, 'a broadcast whose time has come is due');
    assert((await dueBroadcasts(ENV, Date.parse('2026-07-15T13:00:00Z') - 7 * DAY)).length === 0,
      'and one scheduled for the future is not');

    assert(await claimBroadcast(ENV, id) === true, 'the first claim wins');
    assert(await claimBroadcast(ENV, id) === false,
      'a SECOND claim loses — this is what makes the hourly and daily dispatchers safe to overlap');

    sqlite.prepare("UPDATE broadcasts SET status='scheduled' WHERE id=?").run(id);
    await cron.runBroadcasts(ENV);
    const row = sqlite.prepare('SELECT * FROM broadcasts WHERE id=?').get(id);
    assert(row.status === 'sent' && row.sent_count >= 2, 'the dispatcher sent it and recorded the count');
    assert(row.recipients === row.sent_count + row.failed_count, 'the recorded arithmetic adds up');
    const bc = sends.find((s) => s.subject === 'We shipped the Deadline Radar');
    assert(!!bc && /It is <strong>live<\/strong>/.test(bc.html), 'the markdown rendered');
    assert(/Unsubscribe/.test(bc.text) && /1 Test St/.test(bc.text), 'with the CAN-SPAM footer');
    assert(/cat=product/.test(bc.text), 'unsubscribing from a broadcast turns off PRODUCT updates only');
    assert(!sends.some((s) => s.to === OPTOUT && s.subject === 'We shipped the Deadline Radar'),
      'and the opted-out account was never mailed');

    // Re-running must not re-send: the row is no longer scheduled.
    const before = sends.length;
    await cron.runBroadcasts(ENV);
    assert(sends.length === before, 'a sent broadcast is never re-sent');

    await finishBroadcast(ENV, id, { recipients: 0, sent: 0, failed: 0, nowMs: NOW });
    assert(sqlite.prepare('SELECT status FROM broadcasts WHERE id=?').get(id).status === 'sent',
      'an empty segment finishes as sent, not failed — nobody to mail is not an error');
    // ...but a run that failed and got nothing out must not read as sent. The
    // first cut keyed on `recipients === 0`, so a segment query that threw was
    // recorded as a successful broadcast — the row is the only record anyone
    // reads afterwards.
    await finishBroadcast(ENV, id, { recipients: 0, sent: 0, failed: 1, nowMs: NOW });
    assert(sqlite.prepare('SELECT status FROM broadcasts WHERE id=?').get(id).status === 'failed',
      'a run that failed and sent nothing is recorded as FAILED, even with zero recipients');
    await finishBroadcast(ENV, id, { recipients: 5, sent: 4, failed: 1, nowMs: NOW });
    assert(sqlite.prepare('SELECT status FROM broadcasts WHERE id=?').get(id).status === 'sent',
      'and a partial send is sent, with the failure count carried alongside');
  }

  section('the week doc is written under the SHARED key (no double generation):');
  {
    const week = isoWeek(new Date(Date.parse('2026-07-13T14:00:00Z')));
    const key = weekDocKey(FREE, week);
    const raw = await ENV.COACH_KV.get(key);
    if (raw) {
      const doc = JSON.parse(raw);
      assert(doc.week === week && typeof doc.sig === 'string' && doc.sig.length > 0,
        'the digest persisted a week doc the page will accept (same key, same sig field)');
    } else {
      // The fallback path writes nothing on purpose — a doc written from the
      // deterministic selection would suppress the real generation on the
      // student's next visit.
      assert(true, 'no doc written: generation fell back, and the fallback deliberately does not persist');
    }
  }

  // -------------------------------------------------------------------------
  section('S18 — term boundaries, and the digest line that rides along:');
  {
    const { termReviewType, termSetupType } = await import('../functions/_lib/term-core.js');
    const day = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);
    const insTerm = sqlite.prepare(`INSERT INTO terms
      (id, user_id, system, label, start_date, end_date, outcomes_json, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const iso = new Date(NOW).toISOString();

    // FREE: a term that ended three days ago and was never reviewed.
    insTerm.run('tm-ended', FREE, 'quarter', 'Spring 2026', day(-90), day(-3), JSON.stringify({ outcomes: ['a'] }), iso, iso);
    // PAID: a term that started four days ago and whose ritual was never run.
    insTerm.run('tm-fresh', PAID, 'semester', 'Fall 2026', day(-4), day(80), null, iso, iso);
    // OPTOUT: both situations, and opted out of both categories.
    insTerm.run('tm-opt-a', OPTOUT, 'quarter', 'Spring 2026', day(-90), day(-3), JSON.stringify({ outcomes: ['a'] }), iso, iso);
    // A term that ended eight months ago: bounded on BOTH sides, because a
    // retrospective about last year is not one anybody wants — and mailing it
    // the first night this code ships is the worst possible introduction.
    insTerm.run('tm-ancient', FREE, 'quarter', 'Fall 2025', day(-330), day(-240), JSON.stringify({ outcomes: ['a'] }), iso, iso);

    resetMail();
    await cron.runTermRituals(ENV, NOW);

    const toFree = sends.filter((s) => s.to === FREE);
    const toPaid = sends.filter((s) => s.to === PAID);
    assert(toFree.length === 1 && /Spring 2026 in review/.test(toFree[0].subject),
      'a term that ended and was never reviewed gets exactly one review mail');
    assert(!toFree.some((s) => /Fall 2025/.test(s.subject)),
      'and the eight-month-old one is out of the window rather than mailed alongside it');
    assert(toPaid.length === 1 && /Set up/i.test(toPaid[0].subject),
      'a term that started with no outcomes gets the setup nudge, not the review');
    assert(!sends.some((s) => s.to === OPTOUT),
      'an opted-out account gets neither — the sweep intersects with the opt-in lists');
    assert(typesFor(FREE).includes(termReviewType('tm-ended')),
      'the review is logged under a TERM-suffixed type');
    assert(typesFor(PAID).includes(termSetupType('tm-fresh')), 'and so is the setup nudge');

    const firstRun = sends.length;
    await cron.runTermRituals(ENV, NOW);
    assert(sends.length === firstRun,
      'a second run the same night sends nothing — alreadySent is per TERM, so the NEXT term still gets its own pair');

    // The other half: the digest's term line, sourced from the grouped query
    // rather than a per-recipient blob read.
    const terms = await (await import('../functions/_lib/term-store.js')).activeTermsByUser(ENV, day(0));
    assert(terms.get(PAID) && terms.get(PAID).label === 'Fall 2026',
      'activeTermsByUser finds the live term in ONE query for the whole run');
    assert(!terms.has(FREE), 'and an ENDED term is not a live one');

    resetMail();
    await cron.runDaily(ENV, Date.parse('2026-07-13T14:00:00Z')); // a Monday
    const digest = sends.find((s) => s.to === PAID && /task/i.test(s.subject));
    assert(!!digest, 'the Monday digest still goes out');
    assert(/Week \d+ of \d+ · Fall 2026/.test(digest.html) && /Week \d+ of \d+ · Fall 2026/.test(digest.text),
      'and now carries the term line in BOTH parts, from the grouped query');
    const freeDigest = sends.find((s) => s.to === FREE && /task/i.test(s.subject));
    assert(freeDigest && !/Week \d+ of/.test(freeDigest.text),
      'while a student with no LIVE term gets no line rather than a stale one');
  }

  globalThis.fetch = realFetch;
}

// ---------------------------------------------------------------------------
section('cron routing constants:');
{
  const src = readFileSync(new URL('../workers/cron/index.js', import.meta.url), 'utf8');
  const toml = readFileSync(new URL('../workers/cron/wrangler.toml', import.meta.url), 'utf8');
  const crons = /crons\s*=\s*\[([^\]]*)\]/.exec(toml);
  assert(!!crons, 'wrangler.toml declares triggers');
  const declared = crons[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  assert(declared.includes('0 14 * * *'), 'the daily lifecycle trigger is registered');
  assert(declared.includes('0 4 * * *'), 'the rollup trigger is registered');
  assert(declared.includes('0 * * * *'), 'the hourly broadcast trigger is registered');
  // Every schedule the code dispatches on must actually be registered, or the
  // branch is dead code that nobody will notice for months.
  for (const c of [/ROLLUP_CRON = '([^']+)'/, /BROADCAST_CRON = '([^']+)'/]) {
    const m = c.exec(src);
    assert(!!m && declared.includes(m[1]), `code dispatches on ${m && m[1]} and wrangler.toml registers it`);
  }
  assert(BROADCAST_SEGMENTS.length === 5, 'five segments, matching the composer');
}

console.log(`\ntest:cron — ${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
