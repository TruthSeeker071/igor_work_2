// FlightWay V2 S18 — Interview Season Mode (plan §5 S18, D13).
//
//   GET  /interview-season                    → the program, the week, the trend
//   POST /interview-season {action:'start'}   → begin six weeks (PREMIUM)
//   POST /interview-season {action:'end'}     → stop early
//
// **The route is `/interview-season` and the surface is the Interview Season.**
// S17's rule: a Pages Function shadows a static asset at the same path, so the
// endpoint takes the action vocabulary the events already use (`season_started`)
// and leaves every page name free.
//
// **This is scheduling, persistence and narrative — not a second interviewer.**
// Every session in a season runs through `functions/mock-interview.js` and is
// scored by `interview-core.js`'s debrief exactly as an ad-hoc session is. The
// only thing this endpoint adds to a session is the two columns saying which
// week of which program it was, and the SERVER decides those (season-store.js
// `seasonStampFor`) — a client cannot name a week.
//
// **Free is locked-visible, and what it sees is real** (§4, D18). A free account
// gets its own six-week arc built from its own career family, with week 1's
// detail intact and the other five truncated SERVER-SIDE before serialization —
// so `lockedWeeks` is a count of things that are not in the payload, not content
// the CSS is hiding. That is the same contract §5 S8's `lockedTail` documents.
//
// Read-only over the vector chain: nothing here touches objectiveVector,
// objectiveAiPatch or the gap-progress-sync chain, so no re-sync is owed.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, loadRoadmap } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { resolveEntitlement, planSatisfies } from './_lib/entitlements.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import { logServerError, logServerEvent } from './_lib/events.js';
import { resolveCareer } from './_lib/deadline-refresh.js';
import { resolveCareerFamily } from './_lib/career-family.js';
import { groundingEnabled, researchWeb, buildEvidenceBlock, GROUNDING_TTL } from './_lib/gemini-grounded.js';
import { utcDate } from './_lib/deadline-core.js';
import {
  SEASON_WEEKS, buildProgram, buildFormatPrompt, sanitizeFormat, currentWeek,
  seasonProgress, trendPoints, seasonHeadline, seasonIsStale,
} from './_lib/season-core.js';
import {
  seasonsTableReady, activeSeason, insertSeason, endSeason, sessionsForSeason,
} from './_lib/season-store.js';

const RATE_LIMIT_MAX = 60;
const FORMAT_TIMEOUT_MS = 15000;
const RESEARCH_TIMEOUT_MS = 8000;
/** The round list is a property of the ROLE, not the student — cached per slug. */
const FORMAT_KV_PREFIX = 'ivformat:';
const FORMAT_TTL_SECONDS = 30 * 24 * 3600;
/** How much of the program a locked account sees in full. */
const FREE_VISIBLE_WEEKS = 1;

const REASON_COPY = {
  'not-ready': 'Interview Season is not switched on yet.',
  'no-career': 'Pick a target career first — the six weeks are built around the role you are interviewing for.',
  upgrade: 'Interview Season is a Flight Plan feature.',
  'already-active': 'You already have a season running.',
  'save-failed': 'Could not start your season just now. Try again.',
  'not-found': 'No season to end.',
};

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  const ent = await resolveEntitlement(env, email);
  return { origin, email, env, request, plan: ent.effective };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `season:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

/** Target career + its playbook family. One roadmap read serves both. */
async function seasonContext(env, email) {
  const [quiz, roadmap] = await Promise.all([
    loadUserBlob(env, email).catch(() => null),
    loadRoadmap(env, email).catch(() => null),
  ]);
  const career = resolveCareer(quiz, roadmap);
  const soc = String((roadmap && roadmap.targetSoc)
    || (quiz && quiz.careerFocus && quiz.careerFocus.soc) || '');
  return {
    careerName: career.name,
    careerSlug: career.slug,
    family: resolveCareerFamily({ soc, careerName: career.name }),
  };
}

/**
 * The role's real-world round structure, or null.
 *
 * One grounded read per CAREER SLUG, cached in KV for a month: the interview
 * process for a role is the same for every student targeting it, so this is the
 * mock-interview endpoint's company-research call made once more for a fact that
 * is even more shared. The shaped result is what gets cached, not the raw
 * research, so a second student starting the same season pays neither the web
 * call nor the shaping call.
 *
 * Every failure returns null and the program ships built from the playbook,
 * which is a complete program — see the `formatSource` field.
 */
async function loadRoleFormat(env, email, ctx) {
  if (!env || !env.COACH_KV || !ctx.careerSlug) return null;
  const key = FORMAT_KV_PREFIX + ctx.careerSlug;
  try {
    const cached = await env.COACH_KV.get(key);
    if (cached) {
      const rounds = sanitizeFormat(JSON.parse(cached));
      if (rounds.length) return rounds;
    }
  } catch (_) { /* a bad cache entry is a miss, never an error */ }

  if (!groundingEnabled(env)) return null;
  try {
    const research = await researchWeb(env, {
      query: `${ctx.careerName} interview process rounds for entry level and internship candidates`,
      freshnessTtl: GROUNDING_TTL.SEMI_STABLE,
      timeoutMs: RESEARCH_TIMEOUT_MS,
      budgetKey: email,
    });
    if (!research) return null;
    const shaped = await callGeminiJson(env, {
      prompt: `${buildEvidenceBlock(research)}\n\n${buildFormatPrompt({ careerName: ctx.careerName })}`,
      temperature: 0.2,
      maxTokens: 700,
      jsonMode: true,
      label: 'season-format',
      softFail: true,
      timeoutMs: FORMAT_TIMEOUT_MS,
    });
    const rounds = sanitizeFormat(shaped);
    if (!rounds.length) return null;
    try {
      await env.COACH_KV.put(key, JSON.stringify({ rounds }), { expirationTtl: FORMAT_TTL_SECONDS });
    } catch (_) { /* the cache is an optimization; a failed write costs a call, not a season */ }
    return rounds;
  } catch (err) {
    await logServerError(env, 'interview-season', err);
    return null;
  }
}

/**
 * What a locked account is allowed to see: the six week TITLES with week 1's
 * detail, and nothing else.
 *
 * The truncation happens HERE, before the response is serialized — §5 S8's
 * locked-tail contract. `lockedWeeks` is the count of weeks whose focus areas
 * and reasoning are genuinely absent from the payload.
 */
function previewProgram(program) {
  const weeks = (program.weeks || []).map((w, i) => (i < FREE_VISIBLE_WEEKS ? w : {
    week: w.week, key: w.key, title: w.title, persona: w.persona, locked: true,
  }));
  return {
    ...program,
    // A locked preview has no schedule: it is not running, so a from/to on it
    // would be a set of dates the student cannot act on.
    startDate: '', endDate: '', rounds: program.rounds, weeks,
  };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  const premium = planSatisfies(plan, 'premium');
  try {
    const [ready, ctx] = await Promise.all([seasonsTableReady(env), seasonContext(env, email)]);
    const season = ready ? await activeSeason(env, email) : null;

    if (!season) {
      // No live program: build the arc this student WOULD get, so both the
      // locked card and the start button are showing their own six weeks rather
      // than a stock description of somebody else's.
      const program = ctx.careerName
        ? buildProgram({ family: ctx.family, careerName: ctx.careerName, careerSlug: ctx.careerSlug, startDate: '' })
        : null;
      return jsonResponse(200, {
        ready,
        locked: !premium,
        plan,
        season: null,
        program: program ? (premium ? program : previewProgram(program)) : null,
        lockedWeeks: (program && !premium) ? Math.max(0, program.weeks.length - FREE_VISIBLE_WEEKS) : 0,
        weeks: SEASON_WEEKS,
        weekNow: 0,
        progress: null,
        trend: [],
        careerName: ctx.careerName,
        stale: false,
        headline: '',
        reason: ready ? (ctx.careerName ? '' : 'no-career') : 'not-ready',
        message: ready ? (ctx.careerName ? '' : REASON_COPY['no-career']) : REASON_COPY['not-ready'],
      }, origin);
    }

    const sessions = await sessionsForSeason(env, email, season.id);
    const progress = seasonProgress(season.program, sessions);
    const trend = trendPoints(sessions);
    const weekNow = currentWeek(season.startDate);
    return jsonResponse(200, {
      ready: true,
      // A season that was started while premium keeps running if the plan
      // lapses. Cutting a student off in week 4 of a program they paid to start
      // would be the meanest possible reading of §4, and it is not what the
      // table says — the METER is on the mock interviews, and that meter is
      // still there doing its job.
      locked: false,
      plan,
      season: {
        id: season.id, status: season.status, startDate: season.startDate,
        endDate: season.endDate, formatSource: season.formatSource,
        careerName: season.careerName, careerSlug: season.careerSlug,
      },
      program: season.program,
      lockedWeeks: 0,
      weeks: SEASON_WEEKS,
      weekNow,
      progress,
      trend,
      careerName: ctx.careerName || season.careerName,
      stale: seasonIsStale(season.program, ctx.careerSlug),
      headline: seasonHeadline({ progress, week: weekNow, trend }),
      reason: '',
      message: '',
    }, origin);
  } catch (err) {
    await logServerError(env, 'interview-season', err);
    console.warn('interview-season GET failed', err && err.message ? err.message : err);
    return jsonResponse(200, {
      ready: false, locked: !premium, plan, season: null, program: null, lockedWeeks: 0,
      weeks: SEASON_WEEKS, weekNow: 0, progress: null, trend: [], careerName: '', stale: false,
      headline: '', reason: 'error', message: 'Could not load your season just now.',
    }, origin);
  }
}

async function handleStart(env, email, plan, origin) {
  if (!planSatisfies(plan, 'premium')) {
    return jsonResponse(200, { ok: false, reason: 'upgrade', upgrade: true, message: REASON_COPY.upgrade }, origin);
  }
  const ctx = await seasonContext(env, email);
  if (!ctx.careerName) {
    return jsonResponse(200, { ok: false, reason: 'no-career', message: REASON_COPY['no-career'] }, origin);
  }
  if (await activeSeason(env, email)) {
    return jsonResponse(200, { ok: false, reason: 'already-active', message: REASON_COPY['already-active'] }, origin);
  }

  // The season starts TODAY, not on a date the client picked. Week 1 is a cold
  // baseline session, and a season scheduled to begin next month is six weeks of
  // nothing followed by the same first session — the start date is not a
  // decision worth exposing.
  const startDate = utcDate(Date.now());
  const rounds = await loadRoleFormat(env, email, ctx);
  const program = buildProgram({
    family: ctx.family,
    careerName: ctx.careerName,
    careerSlug: ctx.careerSlug,
    startDate,
    format: rounds ? { rounds } : null,
  });

  const res = await insertSeason(env, email, {
    program,
    careerSlug: ctx.careerSlug,
    careerName: ctx.careerName,
    family: ctx.family,
    formatSource: program.formatSource,
  });
  if (!res.ok) {
    return jsonResponse(200, {
      ok: false, reason: res.reason, message: REASON_COPY[res.reason] || REASON_COPY['save-failed'],
    }, origin);
  }

  await logServerEvent(env, 'season_started', {
    userId: email,
    props: { family: ctx.family, formatSource: program.formatSource, rounds: program.rounds.length },
  });

  return jsonResponse(200, {
    ok: true,
    season: {
      id: res.id, status: 'active', startDate: program.startDate, endDate: program.endDate,
      formatSource: program.formatSource, careerName: ctx.careerName, careerSlug: ctx.careerSlug,
    },
    program,
    weekNow: 1,
    progress: seasonProgress(program, []),
    trend: [],
    headline: seasonHeadline({ progress: seasonProgress(program, []), week: 1, trend: [] }),
  }, origin);
}

async function handleEnd(env, email, raw, origin) {
  const season = await activeSeason(env, email);
  if (!season) return jsonResponse(404, { ok: false, reason: 'not-found', error: REASON_COPY['not-found'] }, origin);
  // 'completed' when the six weeks genuinely ran out, 'abandoned' when they
  // stopped early. Decided from the CLOCK, never from the request — a student
  // pressing "end" in week 2 has abandoned it, whatever the button says.
  const status = currentWeek(season.startDate) > SEASON_WEEKS ? 'completed' : 'abandoned';
  const ok = await endSeason(env, email, season.id, status);
  if (!ok) return jsonResponse(404, { ok: false, reason: 'not-found', error: REASON_COPY['not-found'] }, origin);
  return jsonResponse(200, { ok: true, status }, origin);
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const action = String((body && body.action) || '').trim().toLowerCase();

  // Every write needs the table, answered with a sentence rather than a 500 —
  // "not switched on yet" and "your save failed" look identical from outside and
  // only one of them is actionable.
  if (!(await seasonsTableReady(env))) {
    return jsonResponse(200, { ok: false, reason: 'not-ready', message: REASON_COPY['not-ready'] }, origin);
  }

  try {
    if (action === 'start') return await handleStart(env, email, plan, origin);
    if (action === 'end') return await handleEnd(env, email, body, origin);
  } catch (err) {
    await logServerError(env, 'interview-season', err);
    console.warn('interview-season POST failed', action, err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not update your season just now.' }, origin);
  }
  return jsonResponse(400, { error: 'Unknown season action.' }, origin);
}

export { REASON_COPY };
