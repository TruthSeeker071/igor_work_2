// FlightWay V2 S18 — Interview Season Mode, pure core (plan §5 S18, D13).
//
// A "season" is six weeks of scheduled mock interviews with a shape: one
// session a week, each week pointed at a different part of the same rubric, all
// six scored by the debrief engine that already exists. §5 S18 calls the
// program "scheduling + persistence + narrative", and that is exactly what this
// file is — there is no second interviewer here, no second scoring model, and
// no second definition of what a good answer is. `interview-core.js` still runs
// every session and still writes every score.
//
// **The repo decides the ARC; the web only fills in the round names.** Same call
// S17 made for the network mapper, for the same reason. Asked to invent six
// weeks of interview prep, a language model produces six plausible weeks that
// differ every time it is asked — and a program whose week 3 changes between
// two page loads is not a program. So `buildProgram` is deterministic template
// rendering over the family playbook (`interview-playbooks.js`), which is where
// this repo already keeps what each field actually tests. Grounding, when it is
// on and has something to say, supplies ONE thing the playbook cannot know: the
// real-world round structure for that role. It decorates the program; it never
// generates it. With grounding off — which is the state of both Pages projects
// today — the program is complete, and says which of the two it is.
//
// PURE: no D1, no KV, no fetch, no clock beyond an injected `now`. season-store.js
// is the D1 half and functions/interview-season.js is the endpoint.

import { playbookForFamily } from './interview-playbooks.js';
import { sanitizeUntrustedText } from './roadmap-tree.js';
import { utcDate, shiftDate, isIsoDate, daysUntil } from './deadline-core.js';

export const SEASON_WEEKS = 6;
export const SEASON_DAYS = SEASON_WEEKS * 7;
export const PROGRAM_VERSION = 1;
export const SEASON_STATUSES = ['active', 'completed', 'abandoned'];

/** The rubric axes, by id — the same six `interview-core.js` scores. */
export const SEASON_AXES = ['communication', 'structure', 'specificity', 'technical', 'composure', 'fit'];

const MAX_FOCUS_PER_WEEK = 3;
const MAX_ROUNDS = 6;

/**
 * The arc. Six weeks, and the ORDER is the whole argument:
 *
 *  1. a cold baseline, because every later number is meaningless without one;
 *  2. stories, because a student with three good ones answers half the questions;
 *  3. the technical core, which is where the family playbooks differ most;
 *  4. pressure, run by the OTHER persona, because composure is the axis practice
 *     under comfortable conditions never touches;
 *  5. the specific firm, which is the first week that needs something from the
 *     student the product cannot supply;
 *  6. the full loop, cold again, against week 1.
 *
 * `draw` names which playbook list this week's focus areas come from, so a
 * healthcare student's week 3 is care-team judgment and a software student's is
 * systems reasoning without either being written down twice.
 */
const WEEK_ARC = [
  {
    key: 'baseline',
    title: 'Baseline',
    persona: 'coach',
    draw: 'behavioralFocus',
    axes: ['communication', 'structure', 'specificity', 'composure', 'fit'],
    ask: 'Run one full session cold. No notes, no preparation, no second attempt.',
    why: 'Every number in the five weeks after this is measured against today. A first score you prepared for tells you nothing about where you actually are.',
  },
  {
    key: 'stories',
    title: 'Your stories',
    persona: 'coach',
    draw: 'behavioralFocus',
    axes: ['structure', 'specificity'],
    ask: 'Before the session, write three things you have actually done. Use them.',
    why: 'Most behavioural questions are the same four questions wearing different clothes. Three real stories, told with the numbers in them, answer almost all of them.',
  },
  {
    key: 'technical',
    title: 'The technical core',
    persona: 'coach',
    draw: 'technicalArchetypes',
    axes: ['technical'],
    ask: 'Say your reasoning out loud, including the part where you are unsure.',
    why: 'This is the week the field stops being interchangeable. Everything below is what this specific career actually asks about.',
  },
  {
    key: 'pressure',
    title: 'Under pressure',
    persona: 'pressure',
    draw: 'behavioralFocus',
    axes: ['composure', 'communication'],
    ask: 'Switch the interviewer to the pressure persona and do not switch back.',
    why: 'Composure is the one axis that practice under comfortable conditions never touches. It is also the axis a real interviewer tests on purpose.',
  },
  {
    key: 'firm',
    title: 'The firm',
    persona: 'coach',
    draw: 'evaluationEmphasis',
    axes: ['fit', 'specificity'],
    company: true,
    ask: 'Name a real employer in the company field before you start.',
    why: 'This is the first week the product needs something from you it cannot look up: which door you are actually knocking on.',
  },
  {
    key: 'loop',
    title: 'The full loop',
    persona: 'pressure',
    draw: 'evaluationEmphasis',
    axes: SEASON_AXES.slice(),
    ask: 'Cold again, pressure persona, all eight questions. Then read week 1 back.',
    why: 'The point of six weeks is the gap between this score and the first one. Read them side by side; that difference is the only thing this program was ever measuring.',
  },
];

function clean(v, n) {
  return sanitizeUntrustedText(v, n);
}

/**
 * This week's focus areas: a rotating slice of the playbook list it draws from.
 *
 * Three of the six weeks draw from `behavioralFocus` and two from
 * `evaluationEmphasis`, so without rotation weeks 2 and 4 print the same three
 * lines and read as a copy-paste — which is what a student sees, not what the
 * arc intends. Two rules make the rotation actually rotate:
 *
 *  - `drawIndex` counts draws FROM THIS LIST, not weeks. Stepping by the week
 *    index looks equivalent and is not: two weeks that draw the same list can be
 *    an even number of weeks apart, and the offset then lands on the same window.
 *  - the slice is one shorter than the list when the list is short. A playbook
 *    with exactly three behavioural focuses (consulting has three) would
 *    otherwise hand every draw the whole list, and rotating a full list is a
 *    reorder, not a different slice.
 *
 * Deterministic given the playbook, so the same program renders identically on
 * every load — `test:season` asserts that rebuild equality directly.
 */
function focusFor(playbook, spec, drawIndex) {
  const list = (playbook && Array.isArray(playbook[spec.draw]) ? playbook[spec.draw] : [])
    .map((s) => clean(s, 140))
    .filter(Boolean);
  if (!list.length) return [];
  const take = Math.min(MAX_FOCUS_PER_WEEK, Math.max(1, list.length - 1));
  const offset = (drawIndex * take) % list.length;
  const out = [];
  for (let i = 0; i < take; i += 1) out.push(list[(offset + i) % list.length]);
  return out;
}

/** The [from, to] UTC day window for one week of a season. Both inclusive. */
export function weekWindow(startDate, week) {
  const start = isIsoDate(startDate) ? String(startDate).slice(0, 10) : '';
  const n = Math.max(1, Math.min(SEASON_WEEKS, Math.round(Number(week) || 1)));
  if (!start) return { from: '', to: '' };
  return { from: shiftDate(start, (n - 1) * 7), to: shiftDate(start, n * 7 - 1) };
}

/** The last day of a season that starts on `startDate` (inclusive). */
export function seasonEndDate(startDate) {
  return isIsoDate(startDate) ? shiftDate(String(startDate).slice(0, 10), SEASON_DAYS - 1) : '';
}

/**
 * Which week the student is in right now.
 *
 * 0 = the season has a start date in the future (nothing is due yet).
 * 1..6 = the live week.
 * 7 = past the end. Deliberately NOT clamped to 6: "you are in week 6" and "the
 * six weeks are over" are different sentences, and a card that says the first
 * one forever is the card that makes a finished program feel unfinished.
 */
export function currentWeek(startDate, now = Date.now()) {
  if (!isIsoDate(startDate)) return 0;
  const days = -daysUntil(String(startDate).slice(0, 10), now);
  if (days < 0) return 0;
  return Math.min(SEASON_WEEKS + 1, Math.floor(days / 7) + 1);
}

/**
 * Build the whole program. Deterministic given (playbook, career, startDate) —
 * `test:season` asserts that two builds a millisecond apart are byte-identical,
 * because a program that reshuffles is not a program.
 *
 * `format` is the optional grounded half: `{ rounds: [{name, what}], notes }`.
 * Null is a complete and expected input, not a degraded one.
 */
export function buildProgram({ family, careerName, careerSlug, startDate, format } = {}) {
  const playbook = playbookForFamily(family);
  const start = isIsoDate(startDate) ? String(startDate).slice(0, 10) : '';
  const rounds = sanitizeFormat(format);
  // Draws taken from each playbook list so far — see focusFor: the rotation has
  // to step per DRAW, not per week, or two weeks an even distance apart land on
  // the same slice.
  const draws = {};
  return {
    version: PROGRAM_VERSION,
    careerName: clean(careerName, 120),
    careerSlug: String(careerSlug || '').slice(0, 80),
    family: String(family || 'general').slice(0, 40),
    playbookLabel: clean(playbook && playbook.label, 80),
    personaNotes: clean(playbook && playbook.personaNotes, 300),
    startDate: start,
    endDate: seasonEndDate(start),
    // Where the ROUND list came from, stated on the card. A student looking at
    // "phone screen → technical screen → superday" deserves to know whether that
    // came off the live web or out of this repo's own playbook.
    formatSource: rounds.length ? 'web' : 'playbook',
    rounds,
    weeks: WEEK_ARC.map((spec, i) => {
      const win = weekWindow(start, i + 1);
      const drawIndex = draws[spec.draw] || 0;
      draws[spec.draw] = drawIndex + 1;
      return {
        week: i + 1,
        key: spec.key,
        title: spec.title,
        persona: spec.persona,
        axes: spec.axes.slice(),
        focus: focusFor(playbook, spec, drawIndex),
        ask: spec.ask,
        why: spec.why,
        company: !!spec.company,
        from: win.from,
        to: win.to,
      };
    }),
  };
}

/**
 * Validate the grounded round list. Web-derived text reaching a UI is untrusted
 * data, so every string is sanitized here rather than at render time; a round
 * with no name is dropped rather than rendered as an empty bullet.
 */
export function sanitizeFormat(raw) {
  const list = Array.isArray(raw && raw.rounds) ? raw.rounds : (Array.isArray(raw) ? raw : []);
  return list
    .map((r) => ({ name: clean(r && r.name, 60), what: clean(r && r.what, 180) }))
    .filter((r) => r.name)
    .slice(0, MAX_ROUNDS);
}

/**
 * The prompt for the one grounded read a season ever makes. One call per season
 * START (never per week, never per render), and its result is cached per career
 * slug because the interview process for a role is the same for every student
 * targeting it — the mock-interview endpoint's company research cache made
 * exactly this call for exactly this reason.
 */
export function buildFormatPrompt({ careerName }) {
  return [
    `What does the interview process for a ${careerName || 'graduate'} role actually look like, `
      + 'end to end, for an entry-level or internship candidate?',
    '',
    'List the ROUNDS in order. For each one, name it the way the industry names it and say in one',
    'sentence what it actually tests. Do not describe how to prepare and do not give advice.',
    'If the process genuinely varies by employer, say so in `notes` rather than inventing a',
    'consensus that does not exist.',
    '',
    'Respond ONLY with JSON, no markdown:',
    '{"rounds":[{"name":"<round name>","what":"<one sentence: what it tests>"}],"notes":"<or empty>"}',
  ].join('\n');
}

/**
 * Fold the student's actual sessions into the program.
 *
 * A session belongs to a week because the SERVER stamped it at debrief time
 * (`interview_sessions.season_week`), never because the client claimed one —
 * same authorization story as S16's commit path and S17's archetype key.
 *
 * `best` rather than latest: a student who runs week 3 twice has two real
 * scores, and the honest summary of the week is the better one. `count` is right
 * next to it so nothing is hidden by that choice.
 */
export function seasonProgress(program, sessions) {
  const weeks = (program && Array.isArray(program.weeks)) ? program.weeks : [];
  const rows = Array.isArray(sessions) ? sessions : [];
  const byWeek = new Map();
  rows.forEach((s) => {
    const w = Math.round(Number(s && s.week) || 0);
    if (!(w >= 1 && w <= SEASON_WEEKS)) return;
    const overall = Number(s && s.scores && s.scores.overall);
    const entry = byWeek.get(w) || { count: 0, best: null, at: '' };
    entry.count += 1;
    if (Number.isFinite(overall) && (entry.best == null || overall > entry.best)) entry.best = overall;
    if (!entry.at || String(s.at || '') > entry.at) entry.at = String(s.at || '');
    byWeek.set(w, entry);
  });
  const out = weeks.map((w) => {
    const hit = byWeek.get(w.week) || null;
    return {
      ...w,
      done: !!hit,
      count: hit ? hit.count : 0,
      best: hit ? hit.best : null,
      at: hit ? hit.at : '',
    };
  });
  const doneCount = out.filter((w) => w.done).length;
  return { weeks: out, done: doneCount, total: weeks.length || SEASON_WEEKS };
}

/**
 * The trend line: overall score per scored session, oldest first.
 *
 * Sessions with no overall are dropped rather than plotted as zero. A debrief
 * whose technical axis was N/A still has an overall (interview-core.js weights
 * around the gap), so the only rows this loses are ones that never had a number.
 */
export function trendPoints(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((s) => ({
      at: String((s && s.at) || ''),
      week: Math.round(Number(s && s.week) || 0) || null,
      overall: Number(s && s.scores && s.scores.overall),
    }))
    .filter((p) => p.at && Number.isFinite(p.overall))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

/**
 * The one sentence at the top of the card. Never congratulatory about a program
 * that has not started and never a number that has not been earned — the same
 * rule `reviewHeadline` and `digestMarcoLine` run on.
 */
export function seasonHeadline({ progress, week, trend } = {}) {
  const done = (progress && progress.done) || 0;
  const total = (progress && progress.total) || SEASON_WEEKS;
  const w = Math.round(Number(week) || 0);
  if (w === 0) return 'Your season starts this week. Week 1 is a cold session — that is the point of it.';
  if (w > SEASON_WEEKS) {
    if (!done) return 'The six weeks are over and no session was run. Start a new season whenever the next interview is real.';
    const pts = Array.isArray(trend) ? trend : [];
    if (pts.length >= 2) {
      const delta = Math.round((pts[pts.length - 1].overall - pts[0].overall) * 10) / 10;
      if (delta > 0) return `Season complete — ${done} of ${total} weeks run, and you finished ${delta} points above where you started.`;
      if (delta < 0) return `Season complete — ${done} of ${total} weeks run. You finished below your baseline, which usually means the later weeks were harder, not that you got worse.`;
      return `Season complete — ${done} of ${total} weeks run, and you finished level with your baseline.`;
    }
    return `Season complete — ${done} of ${total} weeks run.`;
  }
  if (!done) return `Week ${w} of ${SEASON_WEEKS}. Nothing run yet — one session this week is the entire ask.`;
  const thisWeek = progress && progress.weeks && progress.weeks.find((x) => x.week === w);
  if (thisWeek && thisWeek.done) return `Week ${w} of ${SEASON_WEEKS}, already run. ${done} of ${total} weeks done.`;
  return `Week ${w} of ${SEASON_WEEKS}. ${done} of ${total} weeks done — this week's session is still open.`;
}

/**
 * Is this season still about the career the student is actually chasing?
 *
 * A program keyed to a role they have since moved off is not a smaller version
 * of the right program, it is the wrong one — so the card says so and offers a
 * restart rather than quietly training them for a job they stopped wanting.
 */
export function seasonIsStale(program, careerSlug) {
  const was = String((program && program.careerSlug) || '');
  const now = String(careerSlug || '');
  return !!(was && now && was !== now);
}

/** Today, as the UTC day the whole product agrees on. */
export function today(now = Date.now()) { return utcDate(now); }
