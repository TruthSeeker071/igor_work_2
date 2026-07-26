// test:season — V2 S18, Interview Season Mode + the Semester Loop.
//
// §5 S18 names three things this gate has to cover: term-aware fixtures, the
// endpoints, and mock-score persistence. Two of those turned out to already have
// a home (`test:weekly` took the term arithmetic through the digest, and
// `test:endpoints` drives both routes against real SQLite loaded from 0026), so
// what is left here is the part neither of those can reach: the pure arithmetic
// that decides what a student is TOLD, and the one metering change this session
// made to a live chokepoint.
//
// Four things it asserts hardest, because each is silent when it goes wrong:
//
//   1. **The six-week program is deterministic.** Every render of a season
//      re-reads the stored program, but a regenerated one must be byte-identical
//      or a student's week 3 changes between two page loads. That is not a
//      cosmetic bug — it is the difference between a program and a suggestion.
//   2. **"Week 16 of 15" never happens.** The term week is a rounded division and
//      the naive form overruns by one on almost every real term. It is a small
//      wrongness that makes a student stop believing the bigger numbers.
//   3. **Nothing is seeded into the past.** A student who runs the ritual in week
//      six must get promises, not four commitments that were already overdue when
//      they were created. Both clamps are pinned here.
//   4. **The bonus regeneration is granted once and consumed once.** It is an
//      entitlement, so both halves matter: a bonus that never gets consumed hands
//      out a free generation every month forever, and one consumed too eagerly
//      makes the grant a no-op the student was told they had earned.
//
// Everything runs offline: both cores are pure, and the plan-limits chokepoint is
// driven with an in-memory KV double.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SEASON_WEEKS, SEASON_DAYS, SEASON_AXES, buildProgram, sanitizeFormat, weekWindow,
  seasonEndDate, currentWeek, seasonProgress, trendPoints, seasonHeadline, seasonIsStale,
} from '../functions/_lib/season-core.js';
import {
  TERM_SYSTEMS, MAX_OUTCOMES, MIN_TERM_DAYS, MAX_TERM_DAYS, MIN_SEED_LEAD_DAYS,
  DELIVERABLE_LEAD_DAYS, REVIEW_OPENS_DAYS_BEFORE_END,
  normalizeTermSystem, cleanTermLabel, daysBetween, validateTerm, termWeek, termPhrase,
  termLine, sanitizeOutcomes, sanitizeAnchors, seedSchedule, reviewOpen, termBounds,
  termReviewType, termSetupType, defaultTermLabel, termHeadline,
} from '../functions/_lib/term-core.js';
import {
  FEATURE_LIMITS, checkFeatureLimit, grantFeatureBonus, featureBonusKey, featureKvKey,
  publicFeatureLimits,
} from '../functions/_lib/plan-limits.js';
import { composeDigest, digestMarcoLine, TERM_CLOSING_DAYS } from '../functions/_lib/digest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (cond) { console.log(`  ok - ${name}`); return; }
  failures += 1;
  console.error(`  FAIL - ${name}`);
}
function test(name, fn) {
  try { fn(); } catch (err) { failures += 1; console.error(`  FAIL - ${name}\n    ${err.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); } catch (err) { failures += 1; console.error(`  FAIL - ${name}\n    ${err.message}`); }
}
function section(title) { console.log(`\n${title}`); }

/** A source file with its comments removed — a lint a comment can flip is not a lint (S17). */
function codeOnly(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const DAY = 86400000;
const at = (iso) => Date.parse(`${iso}T12:00:00Z`);

// ---------------------------------------------------------------------------
section('Interview Season — the program is a program');

test('the arc is six weeks and every one of them is described', () => {
  const p = buildProgram({ family: 'finance', careerName: 'Quantitative Analyst', careerSlug: 'quant', startDate: '2026-09-01' });
  check('six weeks', p.weeks.length === SEASON_WEEKS && SEASON_WEEKS === 6);
  check('SEASON_DAYS is the six weeks, not a second number', SEASON_DAYS === SEASON_WEEKS * 7);
  check('every week has a title, a reason and an ask', p.weeks.every((w) => w.title && w.why && w.ask));
  check('every week names at least one rubric axis it is aimed at',
    p.weeks.every((w) => w.axes.length && w.axes.every((a) => SEASON_AXES.includes(a))));
  check('week 1 is a cold baseline and week 6 is the full loop',
    p.weeks[0].key === 'baseline' && p.weeks[5].key === 'loop');
  check('the pressure persona appears — composure is not testable without it',
    p.weeks.some((w) => w.persona === 'pressure'));
  check('exactly one week asks for a real employer name', p.weeks.filter((w) => w.company).length === 1);
});

test('the program is byte-identical on a rebuild', () => {
  const args = { family: 'software', careerName: 'Software Engineer', careerSlug: 'swe', startDate: '2026-09-01' };
  check('two builds a moment apart are the same program',
    JSON.stringify(buildProgram(args)) === JSON.stringify(buildProgram(args)));
});

test('the focus areas actually differ by career family', () => {
  const fin = buildProgram({ family: 'finance', careerName: 'X', careerSlug: 'x', startDate: '2026-09-01' });
  const health = buildProgram({ family: 'healthcare', careerName: 'Y', careerSlug: 'y', startDate: '2026-09-01' });
  const finTech = JSON.stringify(fin.weeks[2].focus);
  const healthTech = JSON.stringify(health.weeks[2].focus);
  check('a finance week 3 is not a healthcare week 3', finTech !== healthTech);
  check('and neither is empty — the playbook is what makes this real',
    fin.weeks[2].focus.length > 0 && health.weeks[2].focus.length > 0);
});

test('no two weeks drawing the same playbook list reprint the same lines', () => {
  // The failure this pins is what a student SEES: consulting's behavioralFocus
  // and evaluationEmphasis each have exactly three entries, so a three-item slice
  // is the whole list and "rotating" it is a no-op. Weeks 1, 2 and 4 all draw the
  // first list and weeks 5 and 6 the second. Checked across every family, because
  // the list lengths differ per playbook and one of them is always the short case.
  const FAMILIES = ['finance', 'software', 'engineering', 'consulting', 'healthcare', 'design', 'media', 'research', 'general'];
  const dupes = [];
  FAMILIES.forEach((family) => {
    const p = buildProgram({ family, careerName: 'X', careerSlug: 'x', startDate: '2026-09-01' });
    const seen = new Map();
    p.weeks.forEach((w) => {
      const key = JSON.stringify(w.focus);
      if (!w.focus.length) return;
      if (seen.has(key)) dupes.push(`${family}: week ${seen.get(key)} == week ${w.week}`);
      else seen.set(key, w.week);
    });
  });
  check(`every week's focus slice is distinct within its program${dupes.length ? ' — ' + dupes.join('; ') : ''}`,
    dupes.length === 0);
  const consulting = buildProgram({ family: 'consulting', careerName: 'C', careerSlug: 'c', startDate: '2026-09-01' });
  check('a three-entry playbook list still yields non-empty slices',
    consulting.weeks.every((w) => w.focus.length > 0));
});

test('the week windows tile the six weeks with no gap and no overlap', () => {
  const start = '2026-09-01';
  check('week 1 opens on the start date', weekWindow(start, 1).from === start);
  check('week 6 closes on the season end date', weekWindow(start, 6).to === seasonEndDate(start));
  let ok = true;
  for (let w = 1; w < SEASON_WEEKS; w += 1) {
    const a = weekWindow(start, w);
    const b = weekWindow(start, w + 1);
    if (daysBetween(a.to, b.from) !== 1) ok = false;
  }
  check('each week starts the day after the last one ends', ok);
  check('a season is 42 days end to end', daysBetween(start, seasonEndDate(start)) === SEASON_DAYS - 1);
});

test('currentWeek distinguishes "not started" from "week 6" from "over"', () => {
  const start = '2026-09-01';
  check('before the start date it is 0, not 1', currentWeek(start, at('2026-08-31')) === 0);
  check('day one is week 1', currentWeek(start, at('2026-09-01')) === 1);
  check('day seven is still week 1', currentWeek(start, at('2026-09-07')) === 1);
  check('day eight is week 2', currentWeek(start, at('2026-09-08')) === 2);
  check('the last day is week 6', currentWeek(start, at(seasonEndDate(start))) === SEASON_WEEKS);
  // 7, not a clamp to 6: "you are in week 6" and "the six weeks are over" are
  // different sentences, and a card stuck on the first one makes a finished
  // program feel unfinished forever.
  check('the day after is 7 — over, not clamped to 6',
    currentWeek(start, at('2026-10-13')) === SEASON_WEEKS + 1);
  check('no start date is 0, never NaN', currentWeek('', Date.now()) === 0);
});

test('the grounded round list is treated as untrusted web text', () => {
  const rounds = sanitizeFormat({
    rounds: [
      { name: '<script>alert(1)</script>Phone screen', what: 'Checks `basics`' },
      { name: '', what: 'a round with no name is not a round' },
      { name: 'Superday', what: 'x'.repeat(400) },
    ],
  });
  check('markup characters are stripped from a round name', !/[<>]/.test(rounds[0].name));
  check('backticks cannot survive into a prompt or a page', !rounds.some((r) => /`/.test(r.what)));
  check('a nameless round is dropped rather than rendered as an empty bullet', rounds.length === 2);
  check('a runaway description is capped', rounds[1].what.length <= 180);
  check('a null format is a complete answer, not a crash', sanitizeFormat(null).length === 0);
});

test('formatSource says which product the student is actually reading', () => {
  const bare = buildProgram({ family: 'general', careerName: 'X', careerSlug: 'x', startDate: '2026-09-01' });
  const web = buildProgram({
    family: 'general', careerName: 'X', careerSlug: 'x', startDate: '2026-09-01',
    format: { rounds: [{ name: 'Phone screen', what: 'Fit and basics' }] },
  });
  check('no rounds → playbook', bare.formatSource === 'playbook' && bare.rounds.length === 0);
  check('rounds → web', web.formatSource === 'web' && web.rounds.length === 1);
});

// ---------------------------------------------------------------------------
section('Interview Season — progress and the trend');

test('a week is done because the SERVER stamped a session, and best beats latest', () => {
  const p = buildProgram({ family: 'general', careerName: 'X', careerSlug: 'x', startDate: '2026-09-01' });
  const prog = seasonProgress(p, [
    { week: 1, at: '2026-09-02T10:00:00Z', scores: { overall: 2.8 } },
    { week: 3, at: '2026-09-16T10:00:00Z', scores: { overall: 3.4 } },
    { week: 3, at: '2026-09-17T10:00:00Z', scores: { overall: 3.1 } },
    { week: 9, at: '2026-11-01T10:00:00Z', scores: { overall: 5 } },
  ]);
  check('two weeks are done, not three', prog.done === 2);
  check('a week outside 1..6 is ignored rather than inventing a seventh row', prog.weeks.length === SEASON_WEEKS);
  const w3 = prog.weeks.find((w) => w.week === 3);
  check('a week run twice reports the BETTER score', w3.best === 3.4);
  check('and says it was run twice, so nothing is hidden by that choice', w3.count === 2);
  check('an unrun week carries null, never 0 — a zero is a score', prog.weeks[1].best === null);
});

test('the trend drops rows that never had a number', () => {
  const pts = trendPoints([
    { week: 2, at: '2026-09-10T10:00:00Z', scores: { overall: 3 } },
    { week: 1, at: '2026-09-02T10:00:00Z', scores: { overall: 2.5 } },
    { week: 3, at: '2026-09-20T10:00:00Z', scores: {} },
    { week: 4, at: '', scores: { overall: 4 } },
  ]);
  check('two points survive', pts.length === 2);
  check('oldest first, so a chart reads left to right', pts[0].at < pts[1].at);
  check('a scoreless debrief is not plotted as a zero', !pts.some((p) => p.overall === 0));
});

test('the headline never congratulates a program that has not happened', () => {
  const p = buildProgram({ family: 'general', careerName: 'X', careerSlug: 'x', startDate: '2026-09-01' });
  const empty = seasonProgress(p, []);
  check('before it starts it explains the cold week rather than praising anything',
    /starts this week/i.test(seasonHeadline({ progress: empty, week: 0, trend: [] })));
  check('week 3 with nothing run asks for one session',
    /Week 3 of 6/.test(seasonHeadline({ progress: empty, week: 3, trend: [] })));
  const done = seasonProgress(p, [
    { week: 1, at: '2026-09-02T10:00:00Z', scores: { overall: 2.5 } },
    { week: 6, at: '2026-10-10T10:00:00Z', scores: { overall: 4 } },
  ]);
  const finished = seasonHeadline({ progress: done, week: 7, trend: trendPoints([
    { week: 1, at: '2026-09-02T10:00:00Z', scores: { overall: 2.5 } },
    { week: 6, at: '2026-10-10T10:00:00Z', scores: { overall: 4 } },
  ]) });
  check('a finished season states the gain over the baseline', /1\.5 points above/.test(finished));
  check('a season nobody ran says so instead of reporting a gain of zero',
    /no session was run/i.test(seasonHeadline({ progress: empty, week: 7, trend: [] })));
});

test('a season keyed to an abandoned career is called stale, not quietly kept', () => {
  const p = buildProgram({ family: 'finance', careerName: 'Quant', careerSlug: 'quant', startDate: '2026-09-01' });
  check('a changed target is stale', seasonIsStale(p, 'teacher') === true);
  check('the same target is not', seasonIsStale(p, 'quant') === false);
  check('an unknown current target does not falsely accuse the season', seasonIsStale(p, '') === false);
});

// ---------------------------------------------------------------------------
section('Semester Loop — the term arithmetic');

test('validateTerm refuses every shape a real form can produce', () => {
  const now = at('2026-08-01');
  check('a good term passes', validateTerm({ system: 'quarter', startDate: '2026-09-28', endDate: '2026-12-11' }, now).ok);
  check('an unknown system is named', validateTerm({ system: 'trimester-ish', startDate: '2026-09-01', endDate: '2026-12-01' }, now).reason === 'bad-system');
  check('a missing date is named', validateTerm({ system: 'semester', startDate: '', endDate: '2026-12-01' }, now).reason === 'bad-dates');
  check('a two-week term is too short', validateTerm({ system: 'semester', startDate: '2026-09-01', endDate: '2026-09-14' }, now).reason === 'too-short');
  check('a nine-month term is too long', validateTerm({ system: 'semester', startDate: '2026-09-01', endDate: '2027-06-01' }, now).reason === 'too-long');
  check('a backwards term is caught by the span check, not accepted',
    validateTerm({ system: 'semester', startDate: '2026-12-01', endDate: '2026-09-01' }, now).ok === false);
  check('a term that already ended can only be reviewed',
    validateTerm({ system: 'semester', startDate: '2025-09-01', endDate: '2025-12-01' }, now).reason === 'already-over');
  check('a term two years out is a guess, not a calendar',
    validateTerm({ system: 'semester', startDate: '2028-09-01', endDate: '2028-12-01' }, now).reason === 'too-far');
  check('the bounds are the exported constants, not magic numbers here',
    MIN_TERM_DAYS === 21 && MAX_TERM_DAYS === 200);
  check('every system in the list normalizes to itself',
    TERM_SYSTEMS.every((s) => normalizeTermSystem(s.toUpperCase()) === s));
});

test('"week 16 of 15" never happens', () => {
  // A real 15-week autumn quarter: Sept 28 → Jan 8 is 103 days, which the naive
  // ceil() form calls 15 weeks and the last day of which the naive floor()+1 form
  // calls week 16.
  const term = { system: 'quarter', startDate: '2026-09-28', endDate: '2026-12-11' };
  const first = termWeek(term, at('2026-09-28'));
  const last = termWeek(term, at('2026-12-11'));
  check('day one is week 1', first.week === 1);
  check('the last day is never past the total', last.week <= last.total);
  check('an 11-week quarter reads as 11 weeks', last.total === 11);
  let overrun = false;
  for (let d = 0; d <= daysBetween(term.startDate, term.endDate); d += 1) {
    const w = termWeek(term, at(term.startDate) + d * DAY);
    if (w.week > w.total || w.week < 1) overrun = true;
  }
  check('no day inside the term reports a week outside 1..total', !overrun);
});

test('termWeek names the four states a term can be in', () => {
  const term = { system: 'semester', startDate: '2026-09-01', endDate: '2026-12-15' };
  check('before it starts: upcoming, and it says how many days', termWeek(term, at('2026-08-20')).status === 'upcoming');
  check('and carries startsIn so the card can say it', termWeek(term, at('2026-08-20')).startsIn === 12);
  check('the middle is active', termWeek(term, at('2026-10-01')).status === 'active');
  check('the last week is "ending" — that is when the review opens',
    termWeek(term, at('2026-12-10')).status === 'ending');
  check('after the last day: ended', termWeek(term, at('2026-12-16')).status === 'ended');
  check('a term with no dates is "none", never a crash', termWeek(null).status === 'none');
});

test('the digest line is empty except when it is true', () => {
  const term = { system: 'semester', label: 'Fall 2026', startDate: '2026-09-01', endDate: '2026-12-15' };
  check('mid-term it reads "Week N of M"', /^Week \d+ of \d+$/.test(termPhrase(term, at('2026-10-01'))));
  check('the labelled form adds the student\'s own name for the term',
    termLine(term, at('2026-10-01')).endsWith('· Fall 2026'));
  check('before the term there is nothing to say', termPhrase(term, at('2026-08-01')) === '');
  check('after it, likewise — "week 15 of 15" forever is not information',
    termPhrase(term, at('2027-01-05')) === '');
  check('an unnamed term still gets a line', termLine({ ...term, label: '' }, at('2026-10-01')) === 'Week 5 of 15');
});

test('the ritual\'s inputs are sanitized as the untrusted text they are', () => {
  const outs = sanitizeOutcomes([
    '  Finish the <b>trading</b> project  ',
    '',
    'x'.repeat(400),
    'A fourth outcome',
    'A fifth',
  ]);
  check('blank entries are dropped, not stored empty', outs.length === MAX_OUTCOMES);
  check('markup is stripped', !/[<>]/.test(outs[0]));
  check('a runaway outcome is capped', outs[2].length <= 120);
  check('three is the ceiling — a term with six priorities has none', MAX_OUTCOMES === 3);

  const anchors = sanitizeAnchors({ courses: 'CS 154, Stats 244, , Econ 200', clubs: ['Trading club'], deliverable: ' A backtest ' });
  check('a comma list becomes an array with the blanks removed', anchors.courses.length === 3);
  check('an array input works the same way', anchors.clubs[0] === 'Trading club');
  check('the deliverable is trimmed', anchors.deliverable === 'A backtest');
  check('an absent anchors object yields empty lists rather than undefined',
    sanitizeAnchors(null).courses.length === 0 && sanitizeAnchors(null).deliverable === '');
});

test('nothing is ever seeded into the past, or past the last day', () => {
  const term = { system: 'semester', startDate: '2026-09-01', endDate: '2026-12-15' };
  const onTime = seedSchedule(term, { outcomes: ['a', 'b', 'c'], deliverable: 'd' }, at('2026-08-25'));
  check('three outcomes plus one deliverable', onTime.length === 4);
  check('they are spread, not stacked',
    onTime[0].dueAt < onTime[1].dueAt && onTime[1].dueAt < onTime[2].dueAt);
  check('the first is not on day one — a plan is not a to-do list for Monday',
    onTime[0].dueAt > term.startDate);
  check('the deliverable sits a week before the end',
    daysBetween(onTime[3].dueAt, term.endDate) === DELIVERABLE_LEAD_DAYS);
  check('nothing lands after the last day', onTime.every((s) => s.dueAt <= term.endDate));

  // The case that matters: a student who runs the ritual in week 12 of 15.
  const late = seedSchedule(term, { outcomes: ['a', 'b', 'c'], deliverable: 'd' }, at('2026-11-25'));
  const floor = '2026-11-28';
  check('a late setup produces promises, not four instant failures',
    late.every((s) => s.dueAt >= floor));
  check('the clamp is MIN_SEED_LEAD_DAYS from today, not today', MIN_SEED_LEAD_DAYS === 3);
  check('and still nothing past the end', late.every((s) => s.dueAt <= term.endDate));
  check('a term with no dates seeds nothing rather than seeding today',
    seedSchedule({}, { outcomes: ['a'] }, Date.now()).length === 0);
  check('no outcomes and no deliverable is an empty schedule, not a crash',
    seedSchedule(term, {}, at('2026-09-01')).length === 0);
});

test('the review opens in the last week and never expires', () => {
  const term = { startDate: '2026-09-01', endDate: '2026-12-15' };
  check('mid-term it is closed', reviewOpen(term, at('2026-10-01')) === false);
  check('a week out it opens', reviewOpen(term, at('2026-12-08')) === true);
  check('the boundary is the exported constant', REVIEW_OPENS_DAYS_BEFORE_END === 7);
  check('months later it is still open — their term is still their term',
    reviewOpen(term, at('2027-03-01')) === true);
});

test('the review window includes the last day of term', () => {
  const b = termBounds({ startDate: '2026-09-01', endDate: '2026-12-15' });
  check('it starts at midnight on day one', b.startIso.startsWith('2026-09-01T00:00'));
  // Exclusive end: everything that happened ON December 15th has to fall inside
  // the review of the term it happened in, so the bound is the 16th.
  check('and ends at midnight on the day AFTER the last day', b.endDate === '2026-12-16');
  check('a term with no dates has no bounds rather than bounds of ""', termBounds({}) === null);
});

test('the email types are per-term, not per-account', () => {
  check('a review type carries the term id', termReviewType('tmabc') === 'term_review:tmabc');
  check('a setup type carries the term id', termSetupType('tmabc') === 'term_setup:tmabc');
  check('two terms get two types', termReviewType('tm1') !== termReviewType('tm2'));
  const types = fs.readFileSync(path.join(ROOT, 'functions/_lib/email-template.js'), 'utf8');
  check('both families are registered in EMAIL_TYPES',
    /'term_review'/.test(types) && /'term_setup'/.test(types));
});

test('a term nobody named still has a name', () => {
  check('September is Fall', defaultTermLabel('semester', '2026-09-28') === 'Fall 2026');
  check('January is Winter', defaultTermLabel('quarter', '2027-01-05') === 'Winter 2027');
  check('April is Spring', defaultTermLabel('quarter', '2027-04-01') === 'Spring 2027');
  check('a label the student typed is kept and capped', cleanTermLabel('x'.repeat(80)).length <= 40);
  check('a headline exists for a student with no term at all', !!termHeadline(null));
});

// ---------------------------------------------------------------------------
section('The digest is term-aware, and only when it has something to say');

test('the term line rides along without ever being the reason to send', () => {
  const now = at('2026-10-01');
  const term = { system: 'semester', label: 'Fall 2026', startDate: '2026-09-01', endDate: '2026-12-15' };
  const withTerm = composeDigest({ now, week: '2026-W40', base: 'https://x', plan: 'free', term });
  check('a digest with ONLY a term line has no content and is not sent',
    withTerm.termLine !== '' && withTerm.hasContent === false);
  check('the week number is exposed for the counts block', withTerm.counts.termWeek === withTerm.termWeek);
  const noTerm = composeDigest({ now, week: '2026-W40', base: 'https://x', plan: 'free' });
  check('a student who never told us their dates gets no line at all', noTerm.termLine === '');
  check('and no fabricated week number', noTerm.termWeek === 0);
});

test('Marco mentions the term only in the closing fortnight, and never over an overdue promise', () => {
  const now = at('2026-12-05'); // 10 days left
  const term = { system: 'semester', startDate: '2026-09-01', endDate: '2026-12-15' };
  const closing = digestMarcoLine({ term, now, tasks: [{ label: 'x' }] });
  check('ten days out it names the weeks left', /weeks left in the term/.test(closing));
  check('TERM_CLOSING_DAYS is the window, not a literal', TERM_CLOSING_DAYS === 14);
  const early = digestMarcoLine({ term, now: at('2026-10-01'), tasks: [{ label: 'x' }] });
  check('in week 5 it says nothing about the term — a four-month countdown is a nag',
    !/term/.test(early));
  const overdue = digestMarcoLine({
    term, now, commitments: [{ overdue: true, text: 'Finish the deck' }], tasks: [{ label: 'x' }],
  });
  check('an overdue promise still outranks the term', /Finish the deck/.test(overdue));
  const lastWeek = digestMarcoLine({ term, now: at('2026-12-13'), tasks: [{ label: 'x' }] });
  check('the final week says "last week", not "1 weeks"', /last week of your term/.test(lastWeek));
});

// ---------------------------------------------------------------------------
section('The +1 roadmap regeneration is granted once and consumed once');

function kvDouble() {
  const store = new Map();
  return {
    store,
    COACH_KV: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      put: async (k, v) => { store.set(k, String(v)); },
    },
  };
}
const FREE = { plan: 'free' };

await testAsync('only roadmap-generate can carry a bonus', async () => {
  check('the row declares it', FEATURE_LIMITS['roadmap-generate'].bonusable === true);
  const others = Object.keys(FEATURE_LIMITS).filter((k) => k !== 'roadmap-generate');
  check('and it is the only one — §4 grants a bonus nowhere else',
    others.every((k) => !FEATURE_LIMITS[k].bonusable));
  const env = kvDouble();
  check('granting on an unbonusable row is refused rather than silently stored',
    (await grantFeatureBonus(env, 'a@b.co', 'marco-chat', 1)) === false);
  check('and writes nothing', env.store.size === 0);
  // §3 rule 11: the client never sees a KV detail, and a bonus is one.
  check('publicFeatureLimits does not leak the bonus flag to /config',
    !Object.keys(publicFeatureLimits()).some((k) => 'bonusable' in publicFeatureLimits()[k]));
});

await testAsync('a bonus is one MORE, not a refund of something never spent', async () => {
  const env = kvDouble();
  const who = 'a@b.co';
  const now = at('2026-12-20');
  const before = await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, spend: false, now });
  check('free starts with one a month', before.limit === 1 && before.remaining === 1);

  await grantFeatureBonus(env, who, 'roadmap-generate', 1);
  const after = await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, spend: false, now });
  // This is the whole reason grantFeatureBonus exists rather than a refund:
  // refundFeatureUse returns early when `used <= 0`, so at the end of a term —
  // when most students have not spent the month's generation — it would do
  // nothing at all while reporting success.
  check('after the grant they have two, without having spent anything first',
    after.limit === 2 && after.remaining === 2);
  check('the counter itself was not touched', after.used === 0);
});

await testAsync('the bonus is consumed by the second spend, not the first', async () => {
  const env = kvDouble();
  const who = 'a@b.co';
  const now = at('2026-12-20');
  const bonusKey = featureBonusKey('roadmap-generate', who);
  await grantFeatureBonus(env, who, 'roadmap-generate', 1);

  const one = await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, now });
  check('the first generation is the ordinary allowance', one.ok && one.remaining === 1);
  check('and leaves the bonus untouched', env.store.get(bonusKey) === '1');

  const two = await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, now });
  check('the second is the bonus', two.ok && two.remaining === 0);
  check('which is now spent', env.store.get(bonusKey) === '0');

  const three = await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, now });
  check('the third is walled', three.ok === false);
  check('and the wall quotes the number they actually had', /your 2 free/.test(three.message));
});

await testAsync('an unconsumed bonus survives the month; a consumed one does not come back', async () => {
  const env = kvDouble();
  const who = 'a@b.co';
  const dec = at('2026-12-20');
  const jan = at('2027-01-20');
  await grantFeatureBonus(env, who, 'roadmap-generate', 1);
  const next = await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, spend: false, now: jan });
  check('an unspent bonus is still there next month — an earned thing does not evaporate',
    next.limit === 2);

  // Now spend both in December and roll over.
  await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, now: dec });
  await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, now: dec });
  const janAfter = await checkFeatureLimit(env, who, 'roadmap-generate', { ...FREE, spend: false, now: jan });
  check('January resets the window counter', janAfter.used === 0);
  check('but NOT the spent bonus — otherwise one grant is a free generation forever',
    janAfter.limit === 1 && janAfter.remaining === 1);
  check('the December and January counters are different keys',
    featureKvKey('roadmap-generate', who, dec, 'free') !== featureKvKey('roadmap-generate', who, jan, 'free'));
  check('while the bonus key carries no window segment at all',
    !/\d{4}-\d{2}/.test(featureBonusKey('roadmap-generate', who)));
});

await testAsync('an unlimited plan never reads a bonus at all', async () => {
  const env = kvDouble();
  await grantFeatureBonus(env, 'a@b.co', 'roadmap-generate', 1);
  const paid = await checkFeatureLimit(env, 'a@b.co', 'roadmap-generate', { plan: 'premium', spend: false });
  check('premium short-circuits before any counter is read', paid.unlimited === true && paid.limit === null);
});

// ---------------------------------------------------------------------------
section('Wiring: the mock-score link, the surfaces, the purge');

test('there is no second copy of a rubric score', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'migrations/0026_season_term.sql'), 'utf8');
  // §5 S18 says "migration: mock_scores IF NOT ALREADY PERSISTED". 0012 already
  // persists them, so the correct migration is the LINK, not a second table.
  check('0026 creates no mock_scores table', !/CREATE TABLE[^;]*mock_scores/i.test(migration));
  check('it adds the season link to the table that already holds the score',
    /ALTER TABLE interview_sessions ADD COLUMN season_id/.test(migration)
    && /ALTER TABLE interview_sessions ADD COLUMN season_week/.test(migration));
  check('one active season per account is an INDEX, not an intention',
    /UNIQUE INDEX[\s\S]*interview_seasons[\s\S]*WHERE status = 'active'/.test(migration));
  check('the entitlement guard is a column on terms', /regen_granted_at/.test(migration));
});

test('the debrief stamp cannot be driven from the request body', () => {
  const mock = codeOnly('functions/mock-interview.js');
  check('the season stamp comes from seasonStampFor, not from the body',
    /seasonStampFor\(env, email\)/.test(mock));
  check('and no season field is ever read off the request',
    !/body\?\.season|body\.season/.test(mock));
  check('the legacy INSERT survives a pending 0026 — one probe covers table and columns',
    /INSERT INTO interview_sessions \(\$\{cols\}\)/.test(mock));
  check('mock_completed is written server-side', /logServerEvent\(env, 'mock_completed'/.test(mock));
});

test('the two new tables go with the account', () => {
  const account = codeOnly('functions/account.js');
  check('interview_seasons is purged', /'interview_seasons'/.test(account));
  check('terms is purged', /'terms'/.test(account));
});

test('both panels mount on flightplan.html and neither hand-writes a cap', () => {
  const page = fs.readFileSync(path.join(ROOT, 'flightplan.html'), 'utf8');
  check('the season module has a host', /id="flightplan-season"/.test(page));
  check('and a #season section for its door to land on', /id="season"/.test(page));
  check('the term module has a host', /id="flightplan-term"/.test(page));
  check('and a #semester section for the email links to land on', /id="semester"/.test(page));
  check('both are mounted in the boot handler',
    /FWSeason\.mount\(\)/.test(page) && /FWTerm\.mount\(\)/.test(page));
  const icons = fs.readFileSync(path.join(ROOT, 'assets/vendor/lucide-lite.js'), 'utf8');
  check('their data-lucide names are ones lucide-lite actually carries',
    icons.includes('"target"') && icons.includes('"calendar-days"'));

  const season = codeOnly('assets/js/app/season-panel.js');
  const termJs = codeOnly('assets/js/app/term-panel.js');
  check('the season panel renders its lock from FWPlanSurface, never a number of its own',
    /FWPlanSurface\.lockedTailHtml/.test(season) && !/\b1 of \d\b/.test(season));
  check('the term panel computes no due dates — the server owns the schedule',
    !/seedSchedule|setDate\(|86400000/.test(termJs));
  check('both fire their FWFeatureIntro at the moment of entry',
    /maybeShow\('interview-season'\)/.test(season) && /maybeShow\('semester'\)/.test(termJs));

  // The deep link into the mock interview. `openFromHash` matches location.hash
  // EXACTLY, so a persona in the FRAGMENT stops the panel opening at all — a
  // link that looks broken with nothing in the console to explain it. Pinned
  // from both ends because the two files have to agree and neither can see the
  // other.
  check("the week's link puts the persona in the QUERY, before the fragment",
    /ivPersona=[^#]*#practice/.test(season) && !/#practice[^'"]*persona=/.test(season));
  const ivMode = codeOnly('assets/js/coach/interview-mode.js');
  check('and interview-mode.js reads that exact param', /q\.get\('ivPersona'\)/.test(ivMode));
  check('then strips it, so it cannot re-apply on a later open in the same tab',
    /q\.delete\('ivPersona'\)/.test(ivMode));
  check('the hash match is still exact, which is what made the query necessary',
    /location\.hash \|\| ''\) !== '#practice'/.test(ivMode));
});

test('the endpoints are named for the actions their events already use', () => {
  check('the season route exists', fs.existsSync(path.join(ROOT, 'functions/interview-season.js')));
  // S17's rule: a Function shadows a static asset at the same path. `/semester`
  // rather than `/term` also keeps a keystroke's distance from the `/terms`
  // legal page, which is a real file.
  check('the semester route exists', fs.existsSync(path.join(ROOT, 'functions/semester.js')));
  check('and does not shadow the Terms page', !fs.existsSync(path.join(ROOT, 'functions/terms.js')));
  check('terms.html is still a page', fs.existsSync(path.join(ROOT, 'terms.html')));
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`test:season FAILED (${failures})`); process.exit(1); }
console.log('test:season OK');
