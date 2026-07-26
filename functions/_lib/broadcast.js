// FlightWay V2 S11 — admin broadcast composer (D11, plan §5 S11).
//
// Product-update mail, written by an admin, sent to a segment. Three rules the
// rest of this file exists to enforce:
//
//   1. ONE SENDER. The cron dispatcher is the only thing that sends a
//      broadcast. "Send now" queues it for the next dispatch (hourly), it does
//      not send inline — a Pages Function that walks a recipient list is one
//      slow SMTP hop away from timing out halfway through, and a half-sent
//      broadcast with no record of where it stopped is the worst outcome
//      available. Test-sends to yourself go straight out, because that is one
//      email to one address.
//   2. NEVER TO SOMEONE WHO DID NOT ASK. Every segment query carries
//      `verified_at IS NOT NULL AND notify_product = 1` in the SQL, so an
//      unverified or opted-out address is not even loaded. There is no code
//      path that takes a recipient list from anywhere else.
//   3. THE BODY IS ESCAPED FIRST. The author is an admin, but "trusted author"
//      is exactly the assumption that puts a stray `<script>` (or a pasted
//      angle bracket) into a hundred inboxes. Markdown is rendered from
//      already-escaped text, so the only tags in the output are ones this file
//      emitted.

import { normalizePlan, effectivePlan } from './entitlements.js';
import { cryptoRandomId } from './events.js';
import { cleanSchoolValue, normalizeSchoolKey } from './school.js';
import { normalizeUser } from './user-model.js';

export const BROADCAST_SEGMENTS = ['all', 'free', 'paid', 'school', 'active30'];
export const BROADCAST_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'];
export const MAX_SUBJECT = 140;
export const MAX_BODY = 8000;
/** Response-size / blast-radius bound on one broadcast. */
export const MAX_RECIPIENTS = 5000;
export const ACTIVE_DAYS = 30;

export const SEGMENT_LABELS = {
  all: 'Everyone opted in to product updates',
  free: 'Free accounts',
  paid: 'Paying accounts',
  school: 'School name contains…',
  active30: 'Active in the last 30 days',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A deliberately small markdown subset: headings (##), bold, italic, links,
 * bullet lists, paragraphs. Everything is escaped BEFORE any tag is emitted, so
 * the only markup in the result is markup this function produced.
 *
 * Links are https-only. A `javascript:` href in an email is inert in every
 * modern client, but a `http://` one is a downgrade an admin will paste by
 * accident, and there is no reason for either to survive the composer.
 */
export function renderMarkdown(md) {
  const src = String(md == null ? '' : md).slice(0, MAX_BODY);
  const blocks = src.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const html = [];
  const text = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      const items = lines.map((l) => l.replace(/^[-*]\s+/, ''));
      html.push('<ul style="padding-left:20px;margin:0 0 16px;font-size:15px;line-height:1.6;color:#e8edff">'
        + items.map((i) => `<li style="margin:0 0 8px">${inline(i)}</li>`).join('')
        + '</ul>');
      text.push(items.map((i) => `- ${plain(i)}`).join('\n'));
      continue;
    }
    const h = /^(#{2,3})\s+(.*)$/.exec(lines[0]);
    if (h && lines.length === 1) {
      const size = h[1].length === 2 ? 19 : 16;
      html.push(`<p style="font-size:${size}px;font-weight:700;line-height:1.35;color:#f3f6ff;margin:0 0 12px">${inline(h[2])}</p>`);
      text.push(plain(h[2]));
      continue;
    }
    html.push(`<p style="font-size:15px;line-height:1.65;color:#c3ccea;margin:0 0 16px">${lines.map(inline).join('<br>')}</p>`);
    text.push(lines.map(plain).join('\n'));
  }

  return { html: html.join(''), text: text.join('\n\n') };
}

function inline(s) {
  let out = esc(s);
  // [label](https://…) — the url is re-escaped and https-gated after the match,
  // so a crafted label can never close the attribute it sits in.
  out = out.replace(/\[([^\]]{1,120})\]\((https:\/\/[^\s)]{1,300})\)/g,
    (m, label, url) => `<a href="${esc(url)}" style="color:#8fb6ff;text-decoration:underline">${label}</a>`);
  out = out.replace(/\*\*([^*]{1,200})\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]{1,200})\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

function plain(s) {
  return String(s)
    .replace(/\[([^\]]{1,120})\]\((https:\/\/[^\s)]{1,300})\)/g, '$1 ($2)')
    .replace(/\*\*([^*]{1,200})\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]{1,200})\*(?!\*)/g, '$1$2');
}

/**
 * Validate an admin's composed broadcast. Returns `{ ok, error?, value? }` —
 * never throws, so the endpoint's error copy lives in one place.
 */
export function normalizeBroadcastInput(body = {}) {
  const subject = String(body.subject || '').trim().slice(0, MAX_SUBJECT);
  const bodyMd = String(body.body || body.bodyMd || '').trim().slice(0, MAX_BODY);
  const kind = String(body.segment || body.segmentKind || 'all').toLowerCase();
  if (!subject) return { ok: false, error: 'A subject is required.' };
  if (!bodyMd) return { ok: false, error: 'The body is empty.' };
  if (!BROADCAST_SEGMENTS.includes(kind)) return { ok: false, error: 'Unknown segment.' };

  let value = null;
  if (kind === 'school') {
    value = cleanSchoolValue(body.segmentValue);
    if (!value) return { ok: false, error: 'The school segment needs a school name to match.' };
  }

  let scheduledAt = null;
  if (body.scheduledAt) {
    const t = Date.parse(String(body.scheduledAt));
    if (!Number.isFinite(t)) return { ok: false, error: 'That schedule time is not a valid date.' };
    scheduledAt = new Date(t).toISOString();
  }

  return { ok: true, value: { subject, bodyMd, segmentKind: kind, segmentValue: value, scheduledAt } };
}

/**
 * Resolve a segment to addresses.
 *
 * The opt-in gate is in the SQL of every branch, not applied afterwards: a
 * filter you can forget to call is a filter that eventually does not run, and
 * the failure mode here is mailing someone who unsubscribed.
 *
 * `paid`/`free` are decided by `effectivePlan`, not the raw column — a lapsed
 * subscriber whose `plan` still reads 'premium' is a free user, and telling
 * them about a paid-only feature they no longer have is worse than silence.
 */
export async function resolveSegment(env, segment = {}, opts = {}) {
  if (!env || !env.DB) return [];
  const kind = BROADCAST_SEGMENTS.includes(segment.segmentKind) ? segment.segmentKind : 'all';
  const limit = Math.min(MAX_RECIPIENTS, Math.max(1, Number(opts.limit) || MAX_RECIPIENTS));
  const OPTED = 'verified_at IS NOT NULL AND notify_product = 1';

  if (kind === 'active30') {
    const since = new Date((Number.isFinite(opts.now) ? opts.now : Date.now()) - ACTIVE_DAYS * 86400000).toISOString();
    const r = await env.DB.prepare(
      `SELECT u.email, u.plan, u.plan_expires_at FROM users u
        WHERE ${OPTED} AND EXISTS (
          SELECT 1 FROM events e WHERE e.user_id = u.email AND e.ts >= ?
        ) LIMIT ?`,
    ).bind(since, limit).all();
    return (r.results || []);
  }

  if (kind === 'school') {
    // School lives inside the user_profiles JSON blob, not a column, so this is
    // the one segment that cannot be a pure SQL predicate. The LIKE narrows the
    // scan cheaply and the exact match is done in JS against the same
    // normalizer the rest of the product uses — a substring match on raw JSON
    // would happily match a school name that appears in someone's dossier text.
    const needle = normalizeSchoolKey(segment.segmentValue || '');
    if (!needle) return [];
    const r = await env.DB.prepare(
      `SELECT u.email, u.plan, u.plan_expires_at, p.payload FROM users u
        JOIN user_profiles p ON p.email = u.email
        WHERE ${OPTED} AND p.payload IS NOT NULL LIMIT ?`,
    ).bind(limit).all();
    return (r.results || []).filter((row) => {
      let school = '';
      try {
        // Through the user facade (§3.5), never by reaching into the raw blob:
        // the school's location inside the payload has moved once already
        // (v1 → v2), and a hand-rolled path here would have silently matched
        // nobody after that migration instead of failing.
        school = normalizeUser(JSON.parse(row.payload) || {}).identity.school || '';
      } catch (_) { school = ''; }
      return !!school && normalizeSchoolKey(school).includes(needle);
    }).map((row) => ({ email: row.email, plan: row.plan, plan_expires_at: row.plan_expires_at }));
  }

  const r = await env.DB.prepare(
    `SELECT email, plan, plan_expires_at FROM users WHERE ${OPTED} LIMIT ?`,
  ).bind(limit).all();
  const rows = r.results || [];
  if (kind === 'all') return rows;
  const wantPaid = kind === 'paid';
  return rows.filter((u) => (normalizePlan(effectivePlan(u.plan, u.plan_expires_at)) !== 'free') === wantPaid);
}

/** A new row's id. Prefixed so a stray id in a log is identifiable at a glance. */
export function broadcastId() {
  return `bc_${cryptoRandomId()}`;
}

/**
 * Claim a scheduled broadcast for sending. The UPDATE is the lock: only the
 * caller whose statement actually changed a row owns it, so the daily and the
 * hourly dispatcher can both run this without one of them re-sending what the
 * other is halfway through.
 */
export async function claimBroadcast(env, id) {
  try {
    const res = await env.DB.prepare(
      "UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'",
    ).bind(id).run();
    return !!(res && res.meta && res.meta.changes);
  } catch (err) {
    console.warn('broadcast claim failed', err && err.message ? err.message : err);
    return false;
  }
}

/** Broadcasts whose scheduled time has arrived. Oldest first. */
export async function dueBroadcasts(env, nowMs = Date.now()) {
  if (!env || !env.DB) return [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, subject, body_md, segment_kind, segment_value FROM broadcasts
        WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
        ORDER BY scheduled_at ASC LIMIT 5`,
    ).bind(new Date(nowMs).toISOString()).all();
    return r.results || [];
  } catch (err) {
    // Pre-0021 schema: there is no table, so there is nothing due.
    console.warn('broadcast due query failed (pre-0021?)', err && err.message ? err.message : err);
    return [];
  }
}

export async function finishBroadcast(env, id, { recipients, sent, failed, nowMs = Date.now() }) {
  try {
    await env.DB.prepare(
      `UPDATE broadcasts SET status = ?, sent_at = ?, recipients = ?, sent_count = ?, failed_count = ?
        WHERE id = ?`,
    ).bind(
      // A run is `failed` only when something actually went wrong and nothing
      // got out. Zero recipients is NOT a failure — an empty segment means
      // there was nobody to mail. But a run that recorded a failure and sent
      // nothing (the segment query threw, say) must never be recorded as
      // `sent`: the row is the only record anyone will read afterwards.
      (failed > 0 && sent === 0) ? 'failed' : 'sent',
      new Date(nowMs).toISOString(), recipients, sent, failed, id,
    ).run();
  } catch (err) {
    console.error('broadcast finish failed', id, err && err.message ? err.message : err);
  }
}
