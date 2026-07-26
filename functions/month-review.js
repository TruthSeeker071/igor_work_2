// FlightWay V2 S11 — GET /month-review?m=YYYY-MM (D13).
//
// The read side of Month in Review. The email links here; this endpoint feeds
// `review.html` the same object the email was rendered from, so the page can
// never say something the email did not — one composer, two surfaces.
//
// Free on every plan (§4: "Month in Review — free/free. It's a retention email;
// metering it would be self-harm").
//
// Authorization is structural: the month is a query parameter but the EMAIL
// comes from the session cookie, so there is no id space in which one student
// can name another's review.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, loadRoadmap } from './_lib/auth.js';
import { logServerError } from './_lib/events.js';
import {
  gatherMonthReview, monthKey, previousMonth, isMonthKey, monthLabel,
} from './_lib/month-review.js';

const RATE_LIMIT_MAX = 60;
/** How many months back the picker (and this endpoint) will look. */
const MAX_MONTHS_BACK = 11;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

/** The months a review can be asked for: this one and the eleven before it. */
export function availableMonths(nowMs = Date.now()) {
  const out = [];
  let m = monthKey(nowMs);
  for (let i = 0; i <= MAX_MONTHS_BACK; i++) {
    out.push({ month: m, label: monthLabel(m) });
    m = previousMonth(m);
  }
  return out;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  try {
    const email = await getSessionEmail(request, env);
    if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

    try {
      await checkRateLimit(env, `mreview:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    } catch (err) {
      return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
    }

    const now = Date.now();
    let params;
    try { params = new URL(request.url).searchParams; } catch (_) { params = new URLSearchParams(); }
    const asked = String(params.get('m') || '').trim();
    // Default to the month that just ended — the same month the 1st-of-month
    // email covers, so a student who clicks that email's CTA lands on exactly
    // what they were just reading rather than on a half-finished current month.
    const requested = isMonthKey(asked) ? asked : previousMonth(monthKey(now));
    const months = availableMonths(now);
    if (!months.some((m) => m.month === requested)) {
      return jsonResponse(400, { error: 'That month is outside the review window.', months }, origin);
    }

    const tree = await loadRoadmap(env, email).catch(() => null);
    const review = await gatherMonthReview(env, email, requested, {
      now, roadmap: tree, careerName: (tree && tree.targetCareerName) || '',
    });
    return jsonResponse(200, { review, months }, origin);
  } catch (err) {
    await logServerError(env, 'month-review', err);
    console.error('month-review GET failed', err && err.stack ? err.stack : err);
    return jsonResponse(500, { error: 'Could not build your review.' }, origin);
  }
}
