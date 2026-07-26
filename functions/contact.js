// FlightWay V2 S2 — the support inbox (D22).
//
// POST { email, topic, body, turnstileToken? } → a row in contact_messages plus
// a notification to hello@flightway.ai. Follows the house pattern for a public
// unauthenticated write: originFromEnv + checkRateLimit + allowlisted enum +
// server-side truncation + peppered IP hash, never a raw IP.
//
// Two things are deliberate and worth not "simplifying" later:
//
// 1. The D1 row is the record; the email is the notification. Resend can fail,
//    and as of this commit the hello@flightway.ai alias is an OPEN item on
//    Jacob's checklist — it may not receive at all yet. A support message that
//    only ever existed in an inbox nobody reads is a message that was lost, so
//    the insert happens first and its failure is the only thing that 500s.
// 2. Turnstile is optional and OFF by default. If TURNSTILE_SECRET_KEY is unset
//    the check is skipped entirely rather than failing closed — the form has to
//    work on a deployment that never configured it, which is every deployment
//    today. When the key IS set, a missing or bad token is rejected.
import {
  originFromEnv, jsonResponse, preflightResponse, normalizeEmail, isValidEmail,
  resendConfigFromEnv,
} from './_lib.js';
import {
  checkRateLimit, refundRateLimit, clientIp, sha256Hex, generateToken, getSessionEmail,
} from './_lib/auth.js';
import { logServerEvent, logServerError } from './_lib/events.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_FETCH_TIMEOUT_MS = 8000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Mirrored in contact.html's <select>. The client renders these; it does not
// invent them. Anything else is a 400 rather than a free-text column.
export const CONTACT_TOPICS = ['support', 'billing', 'privacy', 'career-center', 'partnership', 'feedback', 'other'];

const MAX_BODY_CHARS = 4000;
const MAX_NAME_CHARS = 80;
const RATE_LIMIT_MAX = 5; // per IP per hour — a real person sends one

export const SUPPORT_INBOX = 'hello@flightway.ai';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Present only when the operator configured it. Exported for the gate. */
export function turnstileEnabled(env) {
  return !!(env && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}

// A real Turnstile token is a bounded opaque string; Cloudflare documents the
// ceiling as 2048 bytes. Bounding it here is what makes the fail-open below
// safe: without a cap, a caller can post a megabyte of junk, force the 6s
// AbortSignal to fire, and land in the degraded branch ON PURPOSE — turning a
// deliberate resilience choice into a one-line bypass.
const MAX_TURNSTILE_TOKEN = 2048;

export async function verifyTurnstile(env, token, ip) {
  if (!turnstileEnabled(env)) return { ok: true, skipped: true };
  const value = String(token || '');
  if (!value) return { ok: false, reason: 'missing-token' };
  if (value.length > MAX_TURNSTILE_TOKEN) return { ok: false, reason: 'oversized-token' };
  try {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET_KEY);
    form.append('response', value);
    if (ip) form.append('remoteip', ip);
    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(6000),
    });
    const data = await resp.json();
    return data && data.success ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch (err) {
    // Cloudflare being unreachable must not become "nobody can contact support".
    // A spam wave is recoverable; a silently dead contact form is not.
    console.warn('turnstile verify failed open', err?.message || err);
    return { ok: true, degraded: true };
  }
}

export function buildNotificationHtml({ email, name, topic, body, userId, id }) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#141312;color:#f5eee9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px">
    <p style="color:#F5A216;font-weight:700;letter-spacing:.08em;font-size:12px;margin:0 0 10px">FLIGHTWAY · CONTACT FORM</p>
    <h1 style="font-size:20px;margin:0 0 4px">${esc(topic)}</h1>
    <p style="margin:0 0 18px;color:#9e938b;font-size:14px">from <b style="color:#f5eee9">${esc(name || email)}</b>${name ? ` &lt;${esc(email)}&gt;` : ''}${userId ? ` · signed in as ${esc(userId)}` : ' · not signed in'}</p>
    <div style="white-space:pre-wrap;background:#1e1b19;border:1px solid #342e2a;border-radius:12px;padding:16px;line-height:1.55;font-size:15px">${esc(body)}</div>
    <p style="color:#9e938b;font-size:12px;margin:20px 0 0">Reply straight to ${esc(email)}. Stored as contact_messages id <code>${esc(id)}</code>.</p>
  </div></body></html>`;
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  // 254 is the RFC 5321 ceiling for an address. `isValidEmail` is a shape test
  // with no length bound, and this is the one user-controlled string that would
  // otherwise reach D1 uncapped — every other field here has a slice().
  const email = normalizeEmail(payload?.email || '');
  if (!email || email.length > 254 || !isValidEmail(email)) {
    return jsonResponse(400, { error: 'Please enter an email address we can reply to.' }, origin);
  }

  const topic = String(payload?.topic || '').trim().toLowerCase();
  if (!CONTACT_TOPICS.includes(topic)) {
    return jsonResponse(400, { error: 'Please choose what your message is about.' }, origin);
  }

  const rawBody = String(payload?.body || '').trim();
  if (rawBody.length < 10) {
    return jsonResponse(400, { error: 'Please tell us a little more — at least a sentence.' }, origin);
  }
  const body = rawBody.slice(0, MAX_BODY_CHARS);
  const name = String(payload?.name || '').trim().slice(0, MAX_NAME_CHARS);

  const ip = clientIp(request);
  const pepper = env.INTENT_PEPPER || env.SESSION_PEPPER || 'flightway';
  // The hash is the rate-limit key, not just the stored column. `checkRateLimit`
  // persists whatever it is handed as part of a KV key name (`auth_rate:<key>`),
  // so passing a raw IP would write the raw IP into KV for the length of the
  // window. Hashing first means this endpoint never puts an IP anywhere, which
  // is what the privacy policy is now able to say about it.
  const ipHash = (await sha256Hex(`${ip}|${pepper}`)).slice(0, 32);
  const rateKey = `contact:${ipHash}`;
  try {
    await checkRateLimit(env, rateKey, { max: RATE_LIMIT_MAX });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many messages. Please try again later.' }, origin);
  }

  const turnstile = await verifyTurnstile(env, payload?.turnstileToken, ip);
  if (!turnstile.ok) {
    // The attempt was spent before the challenge ran. A failed challenge is not
    // a message sent, and five an hour is tight enough that three fumbled
    // challenges would lock a real person out of support.
    await refundRateLimit(env, rateKey);
    return jsonResponse(400, { error: 'That verification did not complete. Please try again.' }, origin);
  }

  // Context, not identity: filled in only when the sender was already signed in.
  const userId = await getSessionEmail(request, env).catch(() => '');

  const id = generateToken(12);
  const ts = new Date().toISOString();
  try {
    if (!env.DB) throw new Error('no D1 binding');
    const ua = String(request.headers.get('User-Agent') || '').slice(0, 200);
    await env.DB.prepare(
      'INSERT INTO contact_messages (id, ts, email, name, topic, body, status, user_id, ip_hash, user_agent) '
      + "VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)",
    ).bind(id, ts, email, name || null, topic, body, userId || null, ipHash, ua).run();
  } catch (err) {
    await logServerError(env, 'contact', err);
    // The row IS the deliverable. If it did not land, say so — do not paint a
    // success screen over a message that no longer exists anywhere.
    console.error('contact_messages insert failed', err?.message || err);
    await refundRateLimit(env, rateKey); // a fault on our side is not their attempt to spend
    return jsonResponse(500, {
      error: `We could not save that. Please email ${SUPPORT_INBOX} directly and we will pick it up there.`,
    }, origin);
  }

  // Notification is best-effort from here on: the message is already durable.
  const { apiKey, fromEmail } = resendConfigFromEnv(env);
  let notified = false;
  if (!apiKey) {
    console.warn('contact: RESEND_API_KEY not configured — message stored, no notification sent');
  } else {
    try {
      const resp = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // Same id as the row, so a retry cannot double-notify.
          'Idempotency-Key': `contact/${id}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [SUPPORT_INBOX],
          reply_to: email,
          subject: `[FlightWay ${topic}] ${email}`,
          html: buildNotificationHtml({ email, name, topic, body, userId, id }),
          text: `${topic} from ${name ? `${name} <${email}>` : email}${userId ? ` (signed in as ${userId})` : ''}\n\n${body}\n\n-- contact_messages ${id}`,
        }),
        signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
      });
      notified = resp.ok;
      if (!resp.ok) console.error('contact: resend rejected', resp.status, await resp.text().catch(() => ''));
    } catch (err) {
      console.error('contact: resend send failed', err?.message || err);
    }
  }

  // Server-side so the number survives a student closing the tab on the
  // success screen — same reasoning as the Stripe webhook events in S1.
  context.waitUntil(logServerEvent(env, 'contact_submitted', {
    props: { topic, notified, signedIn: !!userId },
    userId: userId || null,
    path: '/contact',
  }).catch(() => {}));

  return jsonResponse(200, { ok: true, id }, origin);
}
