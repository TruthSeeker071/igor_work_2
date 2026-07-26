// FlightWay — upcoming deadlines, read-only (WS-D slice D4; D1-first since S9).
//
// The single read that Marco's rail, his chat context and the weekly plan all
// go through, so they can never quote different dates at the same student.
//
// TWO sources, in order:
//   1. the `deadlines` table (S9 Deadline Radar) — durable, per-user, includes
//      anything the student added by hand, and survives cache eviction, a
//      career change and a roadmap rebuild;
//   2. the Opportunity Finder's KV cache — the pre-S9 behaviour, kept as the
//      fallback for every account whose radar has never been refreshed. It goes
//      quiet on its own as the table fills.
//
// Read-only by construction on BOTH paths: no research call, no shaping call,
// no writes. That matters on the chat hot path, and it keeps the flag behaviour
// honest — with GROUNDING_ENABLED off nothing populates either source, so this
// returns [] and every consumer degrades to hidden rather than to broken. That
// emptiness is correct, not a bug.

import { opportunityCacheKey, sanitizeSchoolName } from './opportunity-core.js';
import { schoolFromDossier, cleanSchoolValue } from './school.js';
import { listUpcoming } from './deadline-store.js';
// S9 replaced a local helper with this one, and it is a BUG FIX, not a move.
// The old version measured from the caller's exact instant to the target's UTC
// midnight, so `Math.round` drifted with the time of day: after ~12:00 UTC a
// deadline closing TODAY computed to -1 and was filtered out entirely, and one
// closing tomorrow read "closes today". This version anchors BOTH sides to UTC
// midnight, so the answer is a property of the calendar and holds all day.
import { daysUntil } from './deadline-core.js';

const MAX_GAPS = 6;      // must match functions/opportunities.js

/**
 * Resolve the school the finder would have keyed on, without any I/O: the
 * stored profile value first, else the dossier's `school:` line — the same
 * order resolveSchool() uses, minus its adopt-and-persist side effect.
 */
export function schoolForCacheKey({ quiz, dossier }) {
  const fromQuiz = cleanSchoolValue(
    (quiz && quiz.school)
    || (quiz && quiz.identity && quiz.identity.school)
    || (quiz && quiz.profile && quiz.profile.school),
  );
  if (fromQuiz) return fromQuiz;
  return sanitizeSchoolName(schoolFromDossier(dossier));
}

/**
 * The next `limit` dated opportunities, soonest first.
 * Returns [] for every miss — no cache, no career, no gaps, no dated results.
 *
 * @returns {Promise<Array<{title, org, url, deadline, daysOut}>>}
 */
export async function loadUpcomingDeadlines(env, email, opts = {}) {
  const { quiz = null, roadmap = null, dossier = '', limit = 3, now = Date.now() } = opts;
  if (!env || !email) return [];

  // S9: the radar is the source of truth when it has anything to say. Only
  // TRACKED rows — a deadline the student marked done or dismissed must not
  // come back out of Marco's mouth as something still coming at them.
  try {
    const rows = await listUpcoming(env, email, { now, limit: Math.max(1, limit) + 5 });
    const tracked = rows
      .filter((r) => r && r.status === 'tracked')
      .slice(0, Math.max(0, limit))
      .map((r) => ({
        title: String(r.title),
        org: String(r.org || ''),
        url: String(r.url || ''),
        deadline: String(r.due_date),
        daysOut: daysUntil(r.due_date, now),
      }))
      .filter((d) => Number.isFinite(d.daysOut) && d.daysOut >= 0);
    if (tracked.length) return tracked;
  } catch (err) {
    console.warn('deadlines D1 read failed', err && err.message ? err.message : err);
  }

  // Fallback: the finder's KV cache (pre-S9 behaviour).
  if (!env.COACH_KV) return [];

  const career = {
    soc: (quiz && quiz.careerFocus && quiz.careerFocus.soc) || '',
    slug: (roadmap && roadmap.targetCareerSlug) || '',
  };
  const gaps = ((roadmap && roadmap.focusTracker && roadmap.focusTracker.skillGaps) || [])
    .filter((gp) => gp && gp.label && gp.dimIndex != null)
    .slice(0, MAX_GAPS);
  if (!gaps.length) return [];

  const key = opportunityCacheKey({
    email,
    career,
    gaps,
    school: schoolForCacheKey({ quiz, dossier }),
  });

  let body = null;
  try {
    body = await env.COACH_KV.get(key, 'json');
  } catch (err) {
    console.warn('deadlines cache read failed', err && err.message ? err.message : err);
    return [];
  }
  if (!body || !Array.isArray(body.opportunities)) return [];

  return body.opportunities
    .filter((o) => o && o.deadline && o.title)
    .map((o) => ({
      title: String(o.title),
      org: String(o.org || ''),
      url: String(o.url || ''),
      deadline: String(o.deadline),
      daysOut: daysUntil(o.deadline, now),
    }))
    .filter((o) => Number.isFinite(o.daysOut) && o.daysOut >= 0)
    .sort((a, b) => a.daysOut - b.daysOut)
    .slice(0, Math.max(0, limit));
}

/**
 * A compact prompt block: titles and dates only. Deliberately not the URLs or
 * the "why this fits" prose — Marco needs to be able to say "that closes in
 * nine days", not to re-pitch the opportunity, and the chat context has a
 * token budget to respect.
 */
export function deadlinesPromptBlock(deadlines) {
  const list = (deadlines || []).filter((d) => d && d.title && d.deadline);
  if (!list.length) return '';
  const lines = list.map((d) => {
    const when = d.daysOut === 0 ? 'closes today'
      : d.daysOut === 1 ? 'closes tomorrow'
        : `closes in ${d.daysOut} days`;
    return `- ${d.title} (${d.deadline}, ${when})`;
  });
  return `\n## Upcoming deadlines\nThese are real dates from the user's opportunity matches. Reference one only when it is\nrelevant to what they asked; never list them all, and never invent a date that is not here.\n${lines.join('\n')}\n`;
}
