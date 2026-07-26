// FlightWay V2 S19 — the one-question NPS card (plan §5 S19, D28).
//
//   GET  /nps?moment=flightplan_done          → may we ask? (+ why not)
//   POST /nps {action:'score', moment, score} → record it
//   POST /nps {action:'dismiss', moment}      → record the decline
//
// Three decisions worth not undoing:
//
//  1. **The server owns the frequency cap, and a dismissal spends it.** The card
//     is raised at three product moments and a student can hit two of them in
//     one sitting, so "closed it without answering" has to start the same 30-day
//     cooldown an answer does — otherwise the survey nags exactly the people
//     least interested in it. That is why `dismiss` writes a row.
//  2. **Eligibility is asked at the MOMENT, never on page load.** The GET here
//     costs one indexed row read and only happens when a student actually
//     finishes a task, commits a track or opens their review. A page that asks
//     on load would pay for the survey on every render of three pages.
//  3. **The promoter follow-up shows the student their own attribution before
//     they consent to it.** The response carries the exact name and school we
//     would print, so the consent checkboxes are informed rather than abstract.
//     Reading a student's own identity back to their own session is not a leak;
//     printing it on the homepage without this step would be.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, generateToken } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { normalizeUser } from './_lib/user-model.js';
import { resolveSchool } from './_lib/school.js';
import { logServerEvent, logServerError } from './_lib/events.js';
import {
  NPS_MOMENTS, NPS_COOLDOWN_DAYS, validateNps, npsEligible, npsCooldownUntil, isPromoter,
} from './_lib/feedback-core.js';
import { feedbackTablesReady, lastNpsAsk, recordNps } from './_lib/feedback-store.js';

const RATE_LIMIT_MAX = 40;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  return { origin, email };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `nps:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

/** The name and school we would print, or empty strings. Never invented. */
async function attributionFor(env, email) {
  try {
    const user = normalizeUser(await loadUserBlob(env, email).catch(() => null) || {});
    // `resolveSchool` with persist:false — asking who somebody is must not have
    // the side effect of writing to their profile.
    const school = await resolveSchool(env, email, { quiz: user, persist: false }).catch(() => '');
    return {
      name: String(user.identity?.name || '').trim(),
      school: String(school || '').trim(),
    };
  } catch (_) {
    return { name: '', school: '' };
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { origin, email, error } = await gate(context);
  if (error) return error;

  const moment = String(new URL(request.url).searchParams.get('moment') || '').trim();
  if (moment && !NPS_MOMENTS.includes(moment)) {
    return jsonResponse(400, { error: 'Unknown moment.' }, origin);
  }

  // 0027 pending: report it plainly and refuse rather than showing a card whose
  // submit would 500. Same shape as S16/S17/S18's "not switched on yet".
  const ready = await feedbackTablesReady(env);
  if (!ready) {
    return jsonResponse(200, { ready: false, eligible: false, cooldownDays: NPS_COOLDOWN_DAYS }, origin, { credentials: true });
  }

  const last = await lastNpsAsk(env, email);
  const now = new Date().toISOString();
  const eligible = npsEligible(last, now);
  return jsonResponse(200, {
    ready: true,
    eligible,
    cooldownDays: NPS_COOLDOWN_DAYS,
    cooldownUntil: eligible ? null : npsCooldownUntil(last),
  }, origin, { credentials: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { origin, email, error } = await gate(context);
  if (error) return error;

  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const parsed = validateNps(body);
  if (parsed.error) return jsonResponse(400, { error: parsed.error }, origin);

  if (!(await feedbackTablesReady(env))) {
    return jsonResponse(503, { error: 'Feedback is not switched on yet.', ready: false }, origin);
  }

  // Re-check the cap on the write path. The GET is advice; this is the rule —
  // a client that skips the GET, or two tabs that both passed it, must not be
  // able to write two rows inside the window.
  const now = new Date().toISOString();
  const last = await lastNpsAsk(env, email);
  if (!npsEligible(last, now)) {
    return jsonResponse(429, {
      error: 'You have already been asked recently.',
      cooldownUntil: npsCooldownUntil(last),
    }, origin);
  }

  const id = generateToken(12);
  try {
    await recordNps(env, email, { id, ...parsed }, now);
  } catch (err) {
    await logServerError(env, 'nps', err);
    return jsonResponse(500, { error: 'Could not save that just now.' }, origin);
  }

  const promoter = parsed.status === 'scored' && isPromoter(parsed.score);

  // Server-side, like contact.js's `contact_submitted` and S18's
  // `mock_completed`: the row is already durable, and a client beacon queued
  // behind a navigation away from the card would leave the table and the funnel
  // disagreeing about the same event. §6 lists this under the client taxonomy —
  // recorded as drift in the ledger.
  context.waitUntil(logServerEvent(env, 'nps_scored', {
    props: { moment: parsed.moment, status: parsed.status, score: parsed.score },
    userId: email,
    path: '/nps',
  }).catch(() => {}));

  return jsonResponse(200, {
    ok: true,
    id,
    promoter,
    attribution: promoter ? await attributionFor(env, email) : null,
  }, origin, { credentials: true });
}
