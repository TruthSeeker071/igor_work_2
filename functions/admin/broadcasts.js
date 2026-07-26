// FlightWay V2 S11 — GET/POST /admin/broadcasts (D11, the broadcast composer).
//
//   GET  /admin/broadcasts                        → recent broadcasts + segment sizes
//   POST {action:'preview'}                       → rendered html/text + recipient count
//   POST {action:'test'}                          → send ONE copy to the admin, now
//   POST {action:'queue', scheduledAt?}           → create + queue (now, or later)
//   POST {action:'cancel', id}                    → un-queue a scheduled broadcast
//
// This endpoint NEVER mails a segment. `queue` writes a row with
// `status='scheduled'` and the cron Worker is the only sender — a Pages Function
// walking a recipient list can be cut off mid-list with no record of where it
// stopped, and a half-sent broadcast is worse than a late one. The hourly
// broadcast trigger keeps "send now" honest (≤1h), and the copy says so.
//
// Every mutation requires elevation, like grants: mailing every user is the
// most irreversible button in the console.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { checkRateLimit, hashedIpKey } from '../_lib/auth.js';
import { adminGate, adminNotFound, readJsonBody, requireElevation, audit } from '../_lib/admin.js';
import { sendMail } from '../_lib/email-template.js';
import { broadcastEmail } from '../_lib/emails.js';
import { logServerError } from '../_lib/events.js';
import {
  BROADCAST_SEGMENTS, SEGMENT_LABELS, MAX_SUBJECT, MAX_BODY,
  normalizeBroadcastInput, renderMarkdown, resolveSegment, broadcastId,
} from '../_lib/broadcast.js';

const ACTIONS = new Set(['preview', 'test', 'queue', 'cancel']);
const LIST_LIMIT = 30;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  let rows = [];
  let migrated = true;
  try {
    const r = await env.DB.prepare(
      `SELECT id, created_at, actor_email, subject, segment_kind, segment_value, status,
              scheduled_at, sent_at, recipients, sent_count, failed_count, test_sent_at
         FROM broadcasts ORDER BY created_at DESC LIMIT ?`,
    ).bind(LIST_LIMIT).all();
    rows = r.results || [];
  } catch (err) {
    // Pre-0021: the panel renders with an explicit note rather than an error
    // card, because "the migration is not applied yet" and "the console is
    // broken" look identical from the outside and only one is actionable.
    migrated = false;
    console.warn('admin/broadcasts list failed (pre-0021?)', err?.message || err);
  }

  return jsonResponse(200, {
    migrated,
    broadcasts: rows,
    segments: BROADCAST_SEGMENTS.map((k) => ({ key: k, label: SEGMENT_LABELS[k] })),
    limits: { subject: MAX_SUBJECT, body: MAX_BODY },
  }, origin, { credentials: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResponse(parsed.status, { error: parsed.error }, origin, { credentials: true });

  const action = String(parsed.body?.action || '').toLowerCase();
  if (!ACTIONS.has(action)) {
    return jsonResponse(400, { error: 'Unknown action.', actions: [...ACTIONS] }, origin, { credentials: true });
  }

  // Preview is a read (it renders markdown and counts a segment), so it is
  // gated like the dashboards: admin, no elevation. Everything that sends or
  // persists needs the password re-check.
  if (action !== 'preview' && !(await requireElevation(env, who.email))) {
    return jsonResponse(403, { error: 'Confirm your password to make changes.', elevate: true }, origin, { credentials: true });
  }

  try {
    await checkRateLimit(env, `adminbcast:${who.email}`, { max: 60 });
    await checkRateLimit(env, `adminbcast:${await hashedIpKey(env, request)}`, { max: 60 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin, { credentials: true });
  }

  try {
    if (action === 'cancel') return await cancel(context, origin, who, parsed.body);

    const input = normalizeBroadcastInput(parsed.body);
    if (!input.ok) return jsonResponse(400, { error: input.error }, origin, { credentials: true });

    if (action === 'preview') return await preview(context, origin, input.value);
    if (action === 'test') return await testSend(context, origin, who, input.value);
    return await queue(context, origin, who, input.value);
  } catch (err) {
    await logServerError(env, 'admin/broadcasts', err, { detail: action });
    console.error('admin/broadcasts failed', action, err?.message || err);
    return jsonResponse(500, { error: 'Could not complete that.' }, origin, { credentials: true });
  }
}

async function preview(context, origin, value) {
  const { env } = context;
  const body = renderMarkdown(value.bodyMd);
  let recipients = null;
  try {
    recipients = (await resolveSegment(env, value)).length;
  } catch (err) {
    // A failed count must not block the preview: seeing the rendered email is
    // the point, and an unknown audience size is honestly reported as null.
    console.warn('admin/broadcasts segment count failed', err?.message || err);
  }
  return jsonResponse(200, {
    subject: value.subject,
    html: body.html,
    text: body.text,
    segment: { kind: value.segmentKind, value: value.segmentValue, label: SEGMENT_LABELS[value.segmentKind] },
    recipients,
  }, origin, { credentials: true });
}

/**
 * One copy to the admin's own address, immediately. Sent through the SAME
 * builder and the same chokepoint as the real thing — a test that renders
 * differently from the send is worth nothing — and logged to `email_log` as
 * `broadcast_test` so a test can never be mistaken for the broadcast.
 */
async function testSend(context, origin, who, value) {
  const { env } = context;
  const mail = await broadcastEmail(env, who.email, { subject: value.subject, bodyMd: value.bodyMd });
  const res = await sendMail(env, {
    to: who.email, subject: mail.subject, html: mail.html, text: mail.text,
    type: 'broadcast_test', listUnsubscribe: mail.listUnsubscribe,
  });
  await audit(env, who.email, 'broadcast_test', who.email, { subject: value.subject.slice(0, 80) });
  if (!res.ok) {
    return jsonResponse(502, { error: `Test send failed: ${res.error || res.status}` }, origin, { credentials: true });
  }
  return jsonResponse(200, { ok: true, sentTo: who.email }, origin, { credentials: true });
}

async function queue(context, origin, who, value) {
  const { env } = context;
  const now = Date.now();
  // "Send now" is `scheduled_at = now`: the cron picks it up on its next pass
  // (hourly) rather than this request walking the list. One sender, always.
  const scheduledAt = value.scheduledAt || new Date(now).toISOString();
  const id = broadcastId();
  try {
    await env.DB.prepare(
      `INSERT INTO broadcasts (id, created_at, actor_email, subject, body_md, segment_kind,
                               segment_value, status, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    ).bind(
      id, new Date(now).toISOString(), who.email, value.subject, value.bodyMd,
      value.segmentKind, value.segmentValue, scheduledAt,
    ).run();
  } catch (err) {
    console.error('admin/broadcasts insert failed', err?.message || err);
    return jsonResponse(500, {
      error: 'Could not queue this broadcast. If migration 0021 has not been applied to D1 yet, that is why.',
    }, origin, { credentials: true });
  }
  await audit(env, who.email, 'broadcast_queue', null, {
    id, segment: value.segmentKind, scheduledAt, subject: value.subject.slice(0, 80),
  });
  return jsonResponse(200, { ok: true, id, status: 'scheduled', scheduledAt }, origin, { credentials: true });
}

/**
 * Un-queue. Only a `scheduled` row can be cancelled: once the dispatcher has
 * claimed it (`sending`) some addresses already have it, and marking that
 * "cancelled" would be a lie in the record.
 */
async function cancel(context, origin, who, body) {
  const { env } = context;
  const id = String(body?.id || '').trim().slice(0, 64);
  if (!id) return jsonResponse(400, { error: 'Which broadcast?' }, origin, { credentials: true });
  let changed = 0;
  try {
    const res = await env.DB.prepare(
      "UPDATE broadcasts SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'",
    ).bind(id).run();
    changed = (res && res.meta && res.meta.changes) || 0;
  } catch (err) {
    console.error('admin/broadcasts cancel failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not cancel that broadcast.' }, origin, { credentials: true });
  }
  if (!changed) {
    return jsonResponse(409, {
      error: 'That broadcast is no longer scheduled — it has already started sending, or was cancelled.',
    }, origin, { credentials: true });
  }
  await audit(env, who.email, 'broadcast_cancel', null, { id });
  return jsonResponse(200, { ok: true, id, status: 'cancelled' }, origin, { credentials: true });
}
