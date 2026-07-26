// FlightWay V2 S19 — consented testimonials (plan §5 S19, D28).
//
//   GET  /testimonials?limit=3   → approved quotes, public, no auth
//   POST /testimonials {quote, npsId, consentName, consentSchool}
//                                → a PENDING quote, session-gated
//
// This is the only endpoint in the product that serves one student's words to
// another person, so the guards are worth stating:
//
//  1. **Nothing is published by this endpoint.** A POST creates `status:
//     'pending'` and a human approves it in the admin console. There is no
//     auto-approve path and no score threshold that skips review.
//  2. **Consent is applied at WRITE time** (`redactConsent`), not at render
//     time. A name the student did not agree to print is never in the row, so
//     no later bug in this file can leak it.
//  3. **The GET filters status in SQL** and projects through `publicQuote`,
//     which copies four named fields. Adding a column to the table therefore
//     cannot accidentally start serving it.
//
// The public read is KV-cached because it sits on the landing page: a marketing
// page that does a D1 query per visitor is a marketing page that gets slower
// exactly as it starts working.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, generateToken } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { normalizeUser } from './_lib/user-model.js';
import { resolveSchool } from './_lib/school.js';
import { logServerEvent, logServerError } from './_lib/events.js';
import {
  validateTestimonial, redactConsent, publicQuote, sortQuotes, MAX_PENDING_PER_USER,
} from './_lib/feedback-core.js';
import {
  feedbackTablesReady, listPublicQuotes, createTestimonial, pendingTestimonialCount,
} from './_lib/feedback-store.js';

const RATE_LIMIT_MAX = 10;
const CACHE_KEY = 'quotes:public:v1';
const CACHE_TTL_SEC = 600;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const limit = Math.max(1, Math.min(12, Number(new URL(request.url).searchParams.get('limit')) || 6));

  let quotes = null;
  try {
    if (env.COACH_KV) {
      const hit = await env.COACH_KV.get(CACHE_KEY, 'json');
      if (Array.isArray(hit)) quotes = hit;
    }
  } catch (_) { /* a cold cache is not an error */ }

  if (quotes === null) {
    const rows = await listPublicQuotes(env, 12);
    quotes = sortQuotes(rows).map(publicQuote).filter(Boolean);
    try {
      if (env.COACH_KV) {
        await env.COACH_KV.put(CACHE_KEY, JSON.stringify(quotes), { expirationTtl: CACHE_TTL_SEC });
      }
    } catch (_) { /* the answer is correct without a cache */ }
  }

  // An empty list is a real, correct answer before the first quote is approved —
  // the landing page renders nothing at all rather than a placeholder quote.
  const res = jsonResponse(200, { quotes: quotes.slice(0, limit) }, origin);
  res.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, `quote:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const parsed = validateTestimonial(body);
  if (parsed.error) return jsonResponse(400, { error: parsed.error }, origin);

  if (!(await feedbackTablesReady(env))) {
    return jsonResponse(503, { error: 'Feedback is not switched on yet.', ready: false }, origin);
  }

  if (await pendingTestimonialCount(env, email) >= MAX_PENDING_PER_USER) {
    return jsonResponse(429, {
      error: 'You already have quotes waiting for review — thank you, we have them.',
    }, origin);
  }

  // The identity snapshot, filtered by what was actually ticked. Read here and
  // not from the request body: a client-supplied name is a client-supplied
  // claim, and this one gets printed on the homepage.
  const user = normalizeUser(await loadUserBlob(env, email).catch(() => null) || {});
  const school = await resolveSchool(env, email, { quiz: user, persist: false }).catch(() => '');
  const { displayName, school: consentedSchool } = redactConsent({
    name: user.identity?.name || '',
    school,
    consentName: parsed.consentName,
    consentSchool: parsed.consentSchool,
  });

  const id = generateToken(12);
  try {
    await createTestimonial(env, email, {
      id,
      npsId: parsed.npsId,
      score: typeof body?.score === 'number' ? body.score : null,
      quote: parsed.quote,
      displayName,
      school: consentedSchool,
      consentName: parsed.consentName,
      consentSchool: parsed.consentSchool,
    }, new Date().toISOString());
  } catch (err) {
    await logServerError(env, 'testimonials', err);
    return jsonResponse(500, { error: 'Could not save that just now.' }, origin);
  }

  context.waitUntil(logServerEvent(env, 'testimonial_given', {
    props: { named: !!displayName, schooled: !!consentedSchool },
    userId: email,
    path: '/testimonials',
  }).catch(() => {}));

  return jsonResponse(200, { ok: true, id, status: 'pending' }, origin, { credentials: true });
}
