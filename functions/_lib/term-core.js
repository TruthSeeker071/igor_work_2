// FlightWay V2 S18 — Semester Loop, pure core (plan §5 S18, D14).
//
// A student's year has a shape the product has never known about. "Do this by
// Friday" is a different ask in week 2 than in week 14, the end of a term is the
// one moment they will actually stop and look back, and the start of one is the
// only moment they will plan. The Semester Loop is those two moments, plus the
// arithmetic that makes every other surface aware of where in the term they are.
//
// **The term is one fact with two homes, and each home has exactly one writer.**
// That is `school.js`'s rule, generalized by `user-sync.js`, applied again:
//
//   - the `terms` D1 row is the record of the RITUAL — the outcomes they picked,
//     what it seeded, the review, and `regen_granted_at` (an entitlement, which
//     is the reason none of this can live in the client-writable user blob);
//   - `identity.termSystem` / `termStart` / `termEnd` on the user object are the
//     readable MIRROR — written by the ritual through `setUserField`, learned
//     from conversation through `syncUserFromDossier`, and read by Marco, the
//     client and anything that just needs the dates.
//
// `resolveTerm` (term-store.js) is the single reader, and it prefers the row: a
// student who ran the ritual has a term record; a student who only ever told
// Marco "my quarter ends March 20" still gets a term-aware digest out of the
// mirror. Neither path writes the other's home.
//
// PURE: no D1, no KV, no fetch, no clock beyond an injected `now`.

import { sanitizeUntrustedText } from './roadmap-tree.js';
import { utcDate, shiftDate, isIsoDate, daysUntil, DAY_MS } from './deadline-core.js';

/**
 * Quarter is not a smaller semester and trimester is not a bigger quarter — the
 * only thing this list actually decides is what the product CALLS the block of
 * time, so the student is never told they are in "week 6 of the semester" when
 * their school has never used the word.
 */
export const TERM_SYSTEMS = ['semester', 'quarter', 'trimester'];
export const TERM_SYSTEM_LABEL = { semester: 'semester', quarter: 'quarter', trimester: 'trimester' };

export const MAX_OUTCOMES = 3;
export const MAX_ANCHORS = 5;
export const OUTCOME_CAP = 120;
export const LABEL_CAP = 40;
export const ANCHOR_CAP = 60;

/** A term shorter than this is not a term; longer than this is a year with a typo. */
export const MIN_TERM_DAYS = 21;
export const MAX_TERM_DAYS = 200;
/** How far ahead a term may be set up. Beyond this it is a guess, not a calendar. */
export const MAX_TERM_LEAD_DAYS = 400;
/** A seeded commitment always lands at least this far out — a promise due yesterday is not one. */
export const MIN_SEED_LEAD_DAYS = 3;
/** The deliverable sits this far before the end: late enough to be real, early enough to finish. */
export const DELIVERABLE_LEAD_DAYS = 7;
/** The review opens this many days before the end — finals week is when they actually look back. */
export const REVIEW_OPENS_DAYS_BEFORE_END = 7;

export function normalizeTermSystem(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return TERM_SYSTEMS.includes(s) ? s : '';
}

/** Student-entered term name ("Fall 2026"). Untrusted text; '' is a valid answer. */
export function cleanTermLabel(v) {
  return sanitizeUntrustedText(v, LABEL_CAP);
}

function day(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 10);
  return isIsoDate(s) ? s : '';
}

/** Whole days from `from` to `to`, both ISO days. NaN when either is unusable. */
export function daysBetween(from, to) {
  const a = day(from);
  const b = day(to);
  if (!a || !b) return NaN;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * Validate a proposed term. Returns `{ ok, reason }` — the reason is a key the
 * endpoint maps to a sentence, never a sentence itself (REASON_COPY owns copy).
 */
export function validateTerm({ system, startDate, endDate } = {}, now = Date.now()) {
  if (!normalizeTermSystem(system)) return { ok: false, reason: 'bad-system' };
  const start = day(startDate);
  const end = day(endDate);
  if (!start || !end) return { ok: false, reason: 'bad-dates' };
  const span = daysBetween(start, end);
  if (!Number.isFinite(span) || span < MIN_TERM_DAYS) return { ok: false, reason: 'too-short' };
  if (span > MAX_TERM_DAYS) return { ok: false, reason: 'too-long' };
  // A term that ended before today cannot be planned; it can only be reviewed.
  if (daysUntil(end, now) < 0) return { ok: false, reason: 'already-over' };
  if (daysUntil(start, now) > MAX_TERM_LEAD_DAYS) return { ok: false, reason: 'too-far' };
  return { ok: true, reason: '' };
}

/**
 * Where in the term are we?
 *
 * `total` is the number of WEEKS the term spans, rounded up — a 15-week-and-two-
 * day term is 16 weeks by the arithmetic and 15 by every syllabus in the
 * building, so the remainder only counts as another week when it is more than
 * half of one. Getting this wrong shows up as "week 16 of 15", which is the kind
 * of small wrongness that makes a student stop trusting the bigger numbers.
 */
export function termWeek(term, now = Date.now()) {
  const start = day(term && (term.startDate || term.start_date));
  const end = day(term && (term.endDate || term.end_date));
  if (!start || !end) return { week: 0, total: 0, status: 'none', daysLeft: null };
  const span = daysBetween(start, end) + 1; // inclusive of the last day
  const total = Math.max(1, Math.round(span / 7));
  const elapsed = -daysUntil(start, now);
  const daysLeft = daysUntil(end, now);
  if (elapsed < 0) return { week: 0, total, status: 'upcoming', daysLeft, startsIn: -elapsed };
  if (daysLeft < 0) return { week: total, total, status: 'ended', daysLeft };
  return {
    week: Math.max(1, Math.min(total, Math.floor(elapsed / 7) + 1)),
    total,
    status: daysLeft <= REVIEW_OPENS_DAYS_BEFORE_END ? 'ending' : 'active',
    daysLeft,
  };
}

/**
 * "Week 6 of 15" — the digest line and the card's subtitle.
 *
 * Returns '' for a term that has not started or has ended, because both of those
 * render as a sentence somewhere else and a "week 0 of 15" is not information.
 */
export function termPhrase(term, now = Date.now()) {
  const w = termWeek(term, now);
  if (w.status !== 'active' && w.status !== 'ending') return '';
  return `Week ${w.week} of ${w.total}`;
}

/** "Week 6 of 15 · Fall 2026" — the same line with the student's own name for it. */
export function termLine(term, now = Date.now()) {
  const phrase = termPhrase(term, now);
  if (!phrase) return '';
  const label = cleanTermLabel(term && term.label);
  return label ? `${phrase} · ${label}` : phrase;
}

/** Up to three outcomes, sanitized. Blank entries are dropped, not stored empty. */
export function sanitizeOutcomes(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((o) => sanitizeUntrustedText(typeof o === 'string' ? o : (o && o.text), OUTCOME_CAP))
    .filter(Boolean)
    .slice(0, MAX_OUTCOMES);
}

/**
 * The term's anchors: the courses and clubs the outcomes hang off, plus the ONE
 * deliverable §5 S18 asks for.
 *
 * Anchors are context, not commitments — they are what the student is already
 * doing, and turning "CS 154" into a dated roadmap step would be the product
 * inventing homework. Only the deliverable becomes a step.
 */
export function sanitizeAnchors(raw) {
  const list = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;]/))
    .map((s) => sanitizeUntrustedText(s, ANCHOR_CAP))
    .filter(Boolean)
    .slice(0, MAX_ANCHORS);
  return {
    courses: list(raw && raw.courses),
    clubs: list(raw && raw.clubs),
    deliverable: sanitizeUntrustedText(raw && raw.deliverable, OUTCOME_CAP),
  };
}

/**
 * When each seeded commitment is due.
 *
 * Outcomes are spread evenly across the term (3 outcomes over 15 weeks land
 * around weeks 4, 8 and 11) rather than stacked at the end, because the whole
 * argument for a start-of-term ritual is that a student who dates everything for
 * finals week has not planned anything.
 *
 * Two clamps, and both exist because a student can run this ritual in week 6:
 *  - nothing is ever dated before `MIN_SEED_LEAD_DAYS` from today, so a late
 *    setup produces promises instead of instant failures;
 *  - nothing lands past the last day of the term.
 * A term with too little left for a spread collapses to the end date, which is
 * honest — it says "this is due before the term is over" and nothing more.
 */
export function seedSchedule(term, { outcomes = [], deliverable = '' } = {}, now = Date.now()) {
  const start = day(term && (term.startDate || term.start_date));
  const end = day(term && (term.endDate || term.end_date));
  const out = [];
  if (!start || !end) return out;
  const span = daysBetween(start, end);
  const floorDate = shiftDate(utcDate(now), MIN_SEED_LEAD_DAYS);
  const clamp = (iso) => {
    let d = iso;
    if (d < floorDate) d = floorDate;
    if (d > end) d = end;
    return d;
  };

  const list = sanitizeOutcomes(outcomes);
  list.forEach((text, i) => {
    out.push({ kind: 'outcome', index: i, text, dueAt: clamp(shiftDate(start, Math.round((span * (i + 1)) / (list.length + 1)))) });
  });
  const dv = sanitizeUntrustedText(deliverable, OUTCOME_CAP);
  if (dv) {
    out.push({ kind: 'deliverable', index: 0, text: dv, dueAt: clamp(shiftDate(end, -DELIVERABLE_LEAD_DAYS)) });
  }
  return out;
}

/**
 * Can the end-of-term review be run yet?
 *
 * It opens a week before the end rather than on the last day: a student's last
 * day of term is the day they are least likely to open anything, and a
 * retrospective that only exists during finals week is a retrospective nobody
 * reads. It never expires — a term reviewed in the following March is still
 * their term.
 */
export function reviewOpen(term, now = Date.now()) {
  const end = day(term && (term.endDate || term.end_date));
  if (!end) return false;
  return daysUntil(end, now) <= REVIEW_OPENS_DAYS_BEFORE_END;
}

/** Half-open ISO bounds over the whole term, for the month-review readers. */
export function termBounds(term) {
  const start = day(term && (term.startDate || term.start_date));
  const end = day(term && (term.endDate || term.end_date));
  if (!start || !end) return null;
  return {
    startIso: `${start}T00:00:00.000Z`,
    // Exclusive: `end` is the last day OF the term, so the window has to reach
    // the start of the day after it or everything that happened on the final day
    // falls outside the review of the term it happened in.
    endIso: `${shiftDate(end, 1)}T00:00:00.000Z`,
    startDate: start,
    endDate: shiftDate(end, 1),
  };
}

/** The email-log type for a term's review mail. Once per TERM, not once ever. */
export function termReviewType(termId) { return `term_review:${String(termId || '').slice(0, 48)}`; }
/** The email-log type for the "you have a term but never ran the ritual" nudge. */
export function termSetupType(termId) { return `term_setup:${String(termId || '').slice(0, 48)}`; }

/** A label to fall back on when the student did not name their term. */
export function defaultTermLabel(system, startDate) {
  const start = day(startDate);
  if (!start) return '';
  const y = start.slice(0, 4);
  const m = Number(start.slice(5, 7));
  const season = m <= 2 ? 'Winter' : m <= 5 ? 'Spring' : m <= 7 ? 'Summer' : 'Fall';
  return `${season} ${y}`;
}

/**
 * The one sentence at the top of the Semester card.
 *
 * Every branch is a fact the caller already holds. There is no branch that
 * guesses at how the term is going — `composeMonthReview`'s rule, and the reason
 * a retrospective can be warm without being invented.
 */
export function termHeadline(term, now = Date.now()) {
  if (!term) return 'Tell FlightWay when your term starts and ends, and the whole plan starts keeping your calendar.';
  const w = termWeek(term, now);
  const seeded = Number((term.seeded && term.seeded.length) || term.seededCount || 0);
  if (w.status === 'upcoming') {
    return `Your ${TERM_SYSTEM_LABEL[term.system] || 'term'} starts in ${w.startsIn} day${w.startsIn === 1 ? '' : 's'}. Set the three outcomes now and they are dated before week one.`;
  }
  if (w.status === 'ended') {
    return term.reviewedAt
      ? 'That term is closed. Set up the next one whenever the dates are on your calendar.'
      : 'Your term is over. The review below is what actually moved in it.';
  }
  if (w.status === 'ending') {
    return `Week ${w.week} of ${w.total} — ${w.daysLeft === 0 ? 'the last day' : `${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left`}. Time to look back at it.`;
  }
  if (!seeded) {
    return `Week ${w.week} of ${w.total}. Pick three outcomes for this term and FlightWay dates them across it.`;
  }
  return `Week ${w.week} of ${w.total}, with ${seeded} dated commitment${seeded === 1 ? '' : 's'} riding on it.`;
}

/** Today, as the UTC day the whole product agrees on. */
export function today(now = Date.now()) { return utcDate(now); }
