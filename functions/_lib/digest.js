// FlightWay V2 S11 — the weekly digest COMPOSITION model (D9/D11, plan §5 S11).
//
// The Monday email is the product's only unprompted touch, so it has to say
// something true about THIS student's week rather than be a newsletter with
// their name at the top. This module decides what goes in it and in what order:
//
//   1. how last week actually went          (streak / completion line)
//   2. the three tasks the Flight Plan picked
//   3. deadlines closing inside three weeks (external urgency)
//   4. what they said they would do          (their own dates)
//   5. ONE teaser slot                       (free: the wall they hit; paid: a
//                                             tool they own and have not used)
//   6. one Marco line                        (template + real fill, never a
//                                             per-user Gemini call)
//
// PURE — no D1, no KV, no fetch, no clock of its own beyond an injected `now`.
// That is what lets `test:cron` drive the whole contract directly, including
// the cases that matter most and are hardest to reach any other way: the
// student with nothing to say to, and the student who missed everything.
//
// Ordering note: this file decides ORDER and CONTENT. emails.js decides how it
// looks. The cron decides who gets one. Three files, three questions, so a copy
// change never becomes a recipient change.

import { closesPhrase, daysUntil, utcDate } from './deadline-core.js';
import { movedPhrase } from './application-core.js';
import { staleDraftPhrase } from './contact-core.js';
import { termLine as termLineFor, termWeek } from './term-core.js';

/** S18. The closing fortnight is the only window the digest says anything about the term. */
export const TERM_CLOSING_DAYS = 14;

/** Deadlines further out than this are not this week's business (§5 S11). */
export const DIGEST_DEADLINE_HORIZON_DAYS = 21;
export const DIGEST_MAX_TASKS = 3;
export const DIGEST_MAX_DEADLINES = 3;
export const DIGEST_MAX_COMMITMENTS = 4;
/** How far back a `plan_cap_hit` still counts as "the wall they are hitting". */
export const TEASER_CAP_WINDOW_DAYS = 30;

/**
 * The free-tier teaser slots, keyed by the `plan-limits.js` feature key a
 * `plan_cap_hit` carries. A student who ran out of Marco messages on Thursday
 * gets the Marco line, not a generic upsell — the whole point of keying this to
 * behaviour is that the pitch is for something they already tried to use.
 *
 * Copy rule: state what the wall costs them, not what the plan costs us. Each
 * line is one sentence and never claims a number that is not in §4.
 */
export const FREE_TEASERS = {
  'marco-chat': {
    headline: 'Marco, without the daily ceiling',
    line: 'You ran out of messages this week. Premium takes the cap off, so a long problem gets a long conversation.',
  },
  'marco-thread': {
    headline: 'Every thread Marco has for you',
    line: 'Premium lifts the limit on the topics Marco raises, so nothing waits until tomorrow.',
  },
  'roadmap-generate': {
    headline: 'Rebuild the plan whenever the plan changes',
    line: 'Free rebuilds your roadmap once a month. Premium rebuilds it the day something moves.',
  },
  'mock-interview': {
    headline: 'Practise until it is boring',
    line: 'You used your one mock interview. Premium runs three a day, with a scored debrief each time.',
  },
  'career-sim': {
    headline: 'Try the job before you commit four years to it',
    line: 'Free runs one simulation a month. Premium runs as many as you have questions.',
  },
  'opportunity-search': {
    headline: 'The rest of the list',
    line: 'You are seeing the top two. Premium shows every programme we found, and searches whenever you want.',
  },
  'resume-draft': {
    headline: 'A resume that keeps up with you',
    line: 'Free drafts one a month. Premium redrafts it every time your roadmap moves.',
  },
  'resume-tailor': {
    headline: 'Tailored to the posting, not to the average',
    line: 'You used your one tailoring. Premium tailors your resume to every application you send.',
  },
  'deadline-refresh': {
    headline: 'A radar that refreshes when you ask',
    line: 'Free rescans once a week. Premium rescans the moment you suspect something changed.',
  },
};

/**
 * The fallback rotation for a free user who has not hit a wall yet. Ordered by
 * how development-first each one is, and rotated by week so two consecutive
 * digests never carry the same pitch.
 */
export const FREE_TEASER_ROTATION = [
  'opportunity-search', 'mock-interview', 'resume-tailor', 'career-sim', 'roadmap-generate',
];

/**
 * Paid users get a DISCOVERY slot instead of an upsell. There is nothing to
 * sell them, and a paid subscriber reading an upgrade pitch is the fastest way
 * to make an email feel like spam — but most of them have never opened half of
 * what they are paying for.
 */
export const PAID_TEASERS = [
  {
    key: 'mock-interview',
    headline: 'Your mock interview is included',
    line: 'Three a day, scored, with a debrief that names the two answers to rebuild.',
    ctaLabel: 'Run a mock interview',
    path: '/coach.html',
  },
  {
    key: 'opportunity-search',
    headline: 'The Opportunity Finder is unlimited on your plan',
    line: 'It searches live programmes, internships and fellowships against your actual roadmap.',
    ctaLabel: 'Search opportunities',
    path: '/roadmap.html',
  },
  {
    key: 'resume-tailor',
    headline: 'Tailor your resume per application',
    line: 'Paste the posting and it rewrites the bullets to match what that employer asked for.',
    ctaLabel: 'Open the resume builder',
    path: '/resume.html',
  },
  {
    key: 'career-sim',
    headline: 'Career simulations are unlimited on your plan',
    line: 'A day in the job, decisions and all, before you commit years to the path.',
    ctaLabel: 'Run a simulation',
    path: '/simulation.html',
  },
  {
    key: 'deadline-refresh',
    headline: 'Rescan your Deadline Radar any time',
    line: 'Application windows move. Yours refreshes on demand rather than once a week.',
    ctaLabel: 'Open the radar',
    path: '/flightplan.html#deadlines',
  },
];

/**
 * `path` may carry a fragment (`/flightplan.html#deadlines`). The query has to
 * go BEFORE the `#` or the whole thing lands in the fragment and the UTM never
 * reaches the beacon — the attribution silently disappears while the link still
 * works, which is the failure nobody notices.
 */
function utmUrl(base, path, campaign) {
  const hashAt = path.indexOf('#');
  const pathname = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const sep = pathname.includes('?') ? '&' : '?';
  return `${base}${pathname}${sep}utm_source=email&utm_medium=digest&utm_campaign=${campaign}${hash}`;
}

/** Stable non-negative integer for rotating slots, from an ISO week string. */
export function weekIndex(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(week || ''));
  if (!m) return 0;
  return (Number(m[1]) * 53 + Number(m[2])) >>> 0;
}

/**
 * Which teaser this student sees. `capFeatures` is their recent `plan_cap_hit`
 * feature list, most-hit first — the wall they actually keep running into.
 *
 * Returns null for a plan we have nothing to say to, rather than a filler slot:
 * an empty section is better than a paragraph that exists to fill a template.
 */
export function pickTeaser({ plan = 'free', capFeatures = [], week = '', base = '' } = {}) {
  const idx = weekIndex(week);
  if (plan && plan !== 'free') {
    const t = PAID_TEASERS[idx % PAID_TEASERS.length];
    return {
      kind: 'discovery',
      key: t.key,
      headline: t.headline,
      line: t.line,
      ctaLabel: t.ctaLabel,
      ctaUrl: utmUrl(base, t.path, `discovery_${t.key}`),
    };
  }
  const hit = (capFeatures || []).find((f) => FREE_TEASERS[f]);
  const key = hit || FREE_TEASER_ROTATION[idx % FREE_TEASER_ROTATION.length];
  const copy = FREE_TEASERS[key];
  if (!copy) return null;
  return {
    kind: 'upgrade',
    key,
    headline: copy.headline,
    line: copy.line,
    ctaLabel: 'See what Premium adds',
    ctaUrl: utmUrl(base, '/pricing', `teaser_${key}`),
  };
}

/**
 * The one Marco line. A TEMPLATE with real fill — deliberately not a Gemini
 * call per recipient (§5 S11: budget). Every branch below is a fact the digest
 * already holds, so the line can be warm without ever being invented; there is
 * no branch that guesses at how the student is feeling.
 *
 * Order matters: an overdue promise outranks a closing deadline outranks a
 * good week, because that is the order Marco would raise them in person.
 */
export function digestMarcoLine({
  tasks = [], commitments = [], deadlines = [], completion = null, careerName = '', staleDrafts = 0,
  term = null, now = Date.now(),
} = {}) {
  const overdue = commitments.filter((c) => c && c.overdue);
  const soon = deadlines.filter((d) => Number.isFinite(d.daysOut) && d.daysOut <= 7);
  if (overdue.length) {
    const one = overdue[0];
    return `“${one.text}” is still open. If this week is already full, move the date rather than carrying it — `
      + 'a plan you keep beats a plan you meant.';
  }
  if (soon.length) {
    return `${soon[0].title} closes ${closesPhrase(soon[0].daysOut)}. Everything else on this list can wait a week; that cannot.`;
  }
  // S17. Below the two urgencies above and above every "how it went" branch: an
  // unsent draft is the cheapest thing on this list to finish and the one with
  // the longest tail, but it is never more urgent than a date somebody set.
  if (staleDrafts > 0) {
    return staleDrafts === 1
      ? 'That outreach draft is still sitting there. Read it once, change one line so it sounds like you, and send it — an unsent message has exactly the same value as no message.'
      : `${staleDrafts} outreach drafts are still sitting there. Send the one you are least nervous about; the others get easier after it.`;
  }
  // S18. Below every urgency somebody actually set, and above every "how it
  // went" branch, because the end of a term is a deadline nobody sent them: it
  // is not on the radar, it has no application window, and it is the one date
  // that ends the run of weeks they have left to do anything about this term.
  // Fires ONLY in the closing fortnight — a line about the term in week 3 would
  // be a countdown that runs for four months, which is a nag.
  if (term) {
    const w = termWeek(term, now);
    if ((w.status === 'active' || w.status === 'ending') && Number.isFinite(w.daysLeft) && w.daysLeft <= TERM_CLOSING_DAYS) {
      const weeksLeft = Math.max(1, Math.ceil((w.daysLeft + 1) / 7));
      return weeksLeft === 1
        ? 'This is the last week of your term. Nothing new — finish the one thing below that you would be sorry to carry into the break.'
        : `${weeksLeft} weeks left in the term. What is on this list is what fits; anything bigger belongs to next term, not to a late night in week ${w.total}.`;
    }
  }
  if (completion && completion.total && completion.done === completion.total) {
    return 'You closed everything you dated last week. That is the whole method — keep the list short enough to finish.';
  }
  if (completion && completion.total && completion.done === 0) {
    return 'Nothing dated got closed last week. Pick the smallest item below and finish only that one — momentum first, volume later.';
  }
  if (tasks.length) {
    return careerName
      ? `Three things this week, all of them pointed at ${careerName}. Start with the first one.`
      : 'Three things this week. Start with the first one — the order is the plan.';
  }
  return 'Nothing is scheduled this week. Put a date on one roadmap step and it becomes something you actually do.';
}

/**
 * "How last week went", from the previous week's stored plan doc. Returns null
 * when there is no previous week — a first-week greeting that congratulates
 * someone on a week they were not here for is worse than no line at all.
 */
export function streakLine(prevTasks) {
  const list = Array.isArray(prevTasks) ? prevTasks : [];
  if (!list.length) return null;
  const done = list.filter((t) => t && t.done).length;
  if (done === list.length) return `You closed all ${list.length} of last week’s tasks.`;
  if (done === 0) return `None of last week’s ${list.length} tasks got closed. Fresh list below.`;
  return `You closed ${done} of ${list.length} last week.`;
}

/** Deadlines worth naming in a weekly email: tracked, inside the horizon, soonest first. */
export function digestDeadlines(rows, now = Date.now()) {
  const today = utcDate(now);
  return (rows || [])
    .map((d) => {
      const date = String(d.due_date || d.deadline || '');
      const daysOut = daysUntil(date, now);
      return {
        title: String(d.title || ''),
        org: String(d.org || ''),
        url: /^https:\/\//i.test(String(d.url || '')) ? String(d.url) : '',
        date,
        daysOut,
        when: closesPhrase(daysOut),
        status: String(d.status || 'tracked'),
      };
    })
    .filter((d) => d.title && d.date && d.date >= today && d.status === 'tracked'
      && Number.isFinite(d.daysOut) && d.daysOut <= DIGEST_DEADLINE_HORIZON_DAYS)
    .sort((a, b) => a.daysOut - b.daysOut)
    .slice(0, DIGEST_MAX_DEADLINES);
}

/**
 * Compose the whole email's content model.
 *
 * `hasContent` is the recipient decision and it lives here rather than in the
 * cron on purpose: "is there anything to say to this person" is a property of
 * the digest, and putting it next to the composition is what stops the two
 * drifting into a send with an empty body. A teaser alone is NOT content — an
 * email whose only substance is an upgrade pitch is an ad, and D9 promised a
 * digest.
 */
export function composeDigest(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const plan = input.plan || 'free';
  const week = input.week || '';
  const base = input.base || '';
  const tasks = (input.tasks || []).slice(0, DIGEST_MAX_TASKS).map((t) => ({
    label: String(t.label || ''),
    waypointTitle: String(t.waypointTitle || ''),
    done: !!t.done,
  })).filter((t) => t.label);
  const commitments = (input.commitments || [])
    .filter((c) => c && !c.done && Number.isFinite(c.daysOut) && c.daysOut <= 7)
    .slice(0, DIGEST_MAX_COMMITMENTS)
    .map((c) => ({
      text: String(c.text || ''),
      daysOut: c.daysOut,
      overdue: !!c.overdue,
      waypointTitle: String(c.waypointTitle || ''),
    }))
    .filter((c) => c.text);
  const deadlines = digestDeadlines(input.deadlines, now);
  // S12. How many applications moved stage in the last week — a "how last week
  // went" fact, in the same class as the streak line. It is deliberately NOT
  // part of `hasContent`: a digest is a forward-looking prompt, and an email
  // whose entire substance is "you moved two applications last week" tells the
  // student something they already know and asks nothing of them.
  const applicationsMoved = Math.max(0, Math.round(Number(input.applicationsMoved) || 0));
  // S17. Drafts written and never sent, from `contacts.status_at` (§5 S17:
  // "digest nudges stale drafts"). Like applicationsMoved it does NOT count
  // toward `hasContent`, and the reason is sharper here: a stale draft is ONE
  // item with no dismiss button, so an email whose entire substance is "send
  // that message" would arrive every Monday until they either sent it or
  // unsubscribed. Nudging inside a digest they were already getting is a nudge;
  // generating the digest in order to nudge is a nag.
  const staleDrafts = Math.max(0, Math.round(Number(input.staleDrafts) || 0));
  const completion = input.completion || null;
  // S18. The student's academic calendar, when the product knows it (§5 S18:
  // "Digest becomes term-aware"). Like applicationsMoved and staleDrafts it does
  // NOT count toward `hasContent`: an email whose entire substance is "it is week
  // six" tells them the date, and D9 promised a digest.
  const term = input.term || null;
  const termWeekNow = term ? termWeek(term, now) : null;
  const teaser = pickTeaser({ plan, capFeatures: input.capFeatures, week, base });
  const marcoLine = digestMarcoLine({
    tasks, commitments, deadlines, completion, careerName: input.careerName || '', staleDrafts,
    term, now,
  });

  return {
    week,
    plan,
    streak: streakLine(input.prevTasks),
    tasks,
    deadlines,
    commitments,
    applicationsMoved,
    applicationsLine: applicationsMoved ? movedPhrase(applicationsMoved) + ' last week.' : '',
    staleDrafts,
    staleDraftsLine: staleDraftPhrase(staleDrafts),
    staleDraftsUrl: staleDrafts ? utmUrl(base, '/flightplan.html#network', 'stale_drafts') : '',
    // '' for every student who has never told us their dates, which is all of
    // them until they run the ritual or say so to Marco — so the line renders
    // nothing rather than a placeholder week.
    termLine: term ? termLineFor(term, now) : '',
    termWeek: termWeekNow ? termWeekNow.week : 0,
    termTotal: termWeekNow ? termWeekNow.total : 0,
    teaser,
    marcoLine,
    careerName: String(input.careerName || ''),
    counts: {
      tasks: tasks.length,
      deadlines: deadlines.length,
      commitments: commitments.length,
      applicationsMoved,
      staleDrafts,
      termWeek: termWeekNow ? termWeekNow.week : 0,
    },
    hasContent: tasks.length > 0 || deadlines.length > 0 || commitments.length > 0,
  };
}
