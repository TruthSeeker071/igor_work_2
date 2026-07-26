// FlightWay V2 S1 — POST /events, the analytics beacon.
//
// The contract with the page is absolute: this endpoint can never be the reason
// something breaks. It answers 204 to everything it accepts AND everything it
// throws away, it does all of its work inside waitUntil so the browser is never
// waiting on a KV read, and it swallows every failure into a console warning.
// A student loading the quiz must not be able to tell whether analytics is
// healthy, misconfigured, or switched off.
//
// What it is NOT: it is not authenticated, but it also never trusts the caller
// for identity. `anon_id` is client-owned by design (it identifies a browser,
// not a person, and lives in localStorage — no cookies, D19/§2 privacy stance),
// while `user_id` is read from the SESSION COOKIE and never from the body, so
// no one can attribute events to somebody else's account. History is never
// retro-rewritten when an anonymous visitor later signs in: `identify` simply
// marks the moment, and rows from then on carry the user.
//
// Body (text/plain so sendBeacon needs no preflight):
//   { anon: "<uuid>", path: "/quiz", attr: { ref, utm_source, utm_medium,
//     utm_campaign }, events: [ { n: "quiz_start", p: {...}, path? } ] }

import { originFromEnv, preflightResponse } from './_lib.js';
import { checkRateLimit, hashedIpKey, getSessionEmail } from './_lib/auth.js';
import {
  MAX_BODY_BYTES, analyticsEnabled, classifyUa, sanitizeBatch, writeEvents,
} from './_lib/events.js';

// Generous on purpose: this is abuse control, not metering. A heavy session on
// a slow connection can legitimately flush a dozen batches; 120/hr per
// anon+IP pair stops a script, not a student.
const RATE_LIMIT_MAX = 120;

function noContent(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
    },
  });
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  // Every early exit below is still a 204. The client must not learn anything
  // from the status code, and a non-2xx here would show up as a console error
  // on a real user's page.
  if (!analyticsEnabled(env)) return noContent(origin);

  // Do Not Track is honored client-side too (events.js sends nothing at all).
  // Honoring the header as well means a privacy-tooled browser that somehow
  // still POSTs is respected, and it is the behaviour the privacy policy
  // written in S2 will claim.
  if (String(request.headers.get('DNT') || '') === '1') return noContent(origin);

  const uaClass = classifyUa(request.headers.get('User-Agent'));
  if (uaClass === 'bot') return noContent(origin);

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) return noContent(origin);

  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return noContent(origin);
  }
  if (!raw || raw.length > MAX_BODY_BYTES) return noContent(origin);

  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return noContent(origin);
  }
  if (!body || typeof body !== 'object') return noContent(origin);

  // Everything expensive — the IP hash, the KV rate-limit read, the session
  // lookup, the D1 batch — happens after the response is already on its way
  // back. The rate-limit bucket is keyed by a peppered hash of the IP, never
  // the IP itself (see hashedIpKey): the beacon endpoint must not be the one
  // place a raw address lands in KV.
  const persist = async () => {
    try {
      await checkRateLimit(env, `ev:${String(body.anon || '').slice(0, 40)}:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    } catch {
      return; // over the limit: drop the batch, silently, by design
    }
    let userId = null;
    try {
      userId = (await getSessionEmail(request, env)) || null;
    } catch {
      userId = null; // an unreadable session is an anonymous event, not an error
    }
    const { rows, rejected } = sanitizeBatch(body, { uaClass, userId });
    if (rejected) console.warn('events: rejected', rejected, 'of', (body.events || []).length);
    if (!rows.length) return;
    try {
      await writeEvents(env.DB, rows);
    } catch (err) {
      console.error('events: insert failed', err && err.message);
    }
  };

  if (typeof context.waitUntil === 'function') context.waitUntil(persist());
  else await persist();

  return noContent(origin);
}
