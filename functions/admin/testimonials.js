// FlightWay V2 S19 — the testimonial review queue (plan §5 S19, D28).
//
//   GET  /admin/testimonials                     → the queue + the NPS summary
//   POST /admin/testimonials {action, id}        → approve | feature | unfeature | reject
//
// **Every mutation requires elevation**, exactly like grants and broadcasts.
// Approving a quote publishes a named student's words on flightway.ai's
// homepage: it is outward-facing, it is seen by everyone, and it is the kind of
// button that should cost a password.
//
// The GET carries the NPS summary alongside the queue because the two answer
// one question together — a 9 with no quote and a quote with no score are both
// half a signal, and the console should never show one without the other.
//
// Approving or rejecting busts the public KV cache immediately. Without that a
// quote sits invisible for up to ten minutes after approval and the operator's
// natural conclusion is that the button did not work.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { adminGate, adminNotFound, readJsonBody, requireElevation, audit } from '../_lib/admin.js';
import { logServerError } from '../_lib/events.js';
import { REVIEW_ACTIONS, npsSummary, NPS_MOMENTS } from '../_lib/feedback-core.js';
import {
  feedbackTablesReady, listTestimonialQueue, reviewTestimonial, npsRowsSince,
} from '../_lib/feedback-store.js';

const SUMMARY_DAYS = 90;
const PUBLIC_CACHE_KEY = 'quotes:public:v1';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

async function bustPublicCache(env) {
  try {
    if (env.COACH_KV && typeof env.COACH_KV.delete === 'function') {
      await env.COACH_KV.delete(PUBLIC_CACHE_KEY);
    }
  } catch (err) {
    console.warn('quote cache bust failed', err?.message || err);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  const migrated = await feedbackTablesReady(env);
  if (!migrated) {
    return jsonResponse(200, {
      migrated: false, queue: [], summary: null, moments: NPS_MOMENTS, summaryDays: SUMMARY_DAYS,
    }, origin, { credentials: true });
  }

  const since = new Date(Date.now() - SUMMARY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [queue, rows] = await Promise.all([
    listTestimonialQueue(env, 60),
    npsRowsSince(env, since),
  ]);

  // Per-moment breakdown: a 6 after a month review and a 6 after checking off a
  // task are different complaints, and one averaged number hides which.
  const byMoment = {};
  for (const m of NPS_MOMENTS) {
    byMoment[m] = npsSummary(rows.filter((r) => r.moment === m));
  }

  return jsonResponse(200, {
    migrated: true,
    queue: queue || [],
    queueReadable: queue !== null,
    summary: npsSummary(rows),
    byMoment,
    moments: NPS_MOMENTS,
    summaryDays: SUMMARY_DAYS,
    // The last few written comments, so a low score has words attached. No
    // user_id: this panel is about the product, not about who said it.
    comments: rows
      .filter((r) => r.status === 'scored' && String(r.comment || '').trim())
      .slice(0, 20)
      .map((r) => ({ score: r.score, moment: r.moment, comment: r.comment, ts: r.created_at })),
  }, origin, { credentials: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  if (!(await requireElevation(env, who.email))) {
    // `elevate: true` is the flag the console's shared handleRefusal() keys off
    // to relock the badge and refocus the password field — grants.js and
    // broadcasts.js both send it, and without it a 403 here prints a sentence
    // and leaves the console looking unlocked.
    return jsonResponse(403, { error: 'Unlock the console first.', elevate: true }, origin, { credentials: true });
  }

  const body = await readJsonBody(request);
  const action = String(body?.action || '').trim().toLowerCase();
  const status = REVIEW_ACTIONS[action];
  if (!status) return jsonResponse(400, { error: 'Unknown action.' }, origin, { credentials: true });

  const id = String(body?.id || '').trim();
  if (!id) return jsonResponse(400, { error: 'Which quote?' }, origin, { credentials: true });

  if (!(await feedbackTablesReady(env))) {
    return jsonResponse(503, { error: 'Migration 0027 has not been applied yet.' }, origin, { credentials: true });
  }

  let changed = 0;
  try {
    changed = await reviewTestimonial(env, id, status, who.email, new Date().toISOString());
  } catch (err) {
    await logServerError(env, 'admin/testimonials', err);
    return jsonResponse(500, { error: 'Could not update that quote.' }, origin, { credentials: true });
  }

  // A no-op is reported as a no-op. "Approved" over zero changed rows teaches an
  // operator to trust a button that did nothing.
  if (!changed) {
    return jsonResponse(404, { error: 'No quote with that id.' }, origin, { credentials: true });
  }

  await bustPublicCache(env);
  await audit(env, who.email, `testimonial_${action}`, null, { id, status });

  return jsonResponse(200, { ok: true, id, status }, origin, { credentials: true });
}
