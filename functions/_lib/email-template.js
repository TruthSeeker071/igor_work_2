// FlightWay V2 S4 — the shared email system. ONE branded, dark-mode-compatible
// shell + ONE send chokepoint, so every later email (verify, welcome, day-3,
// weekly digest, password reset, quiz results) renders and sends the same way,
// logs to email_log, emits `email_sent`, and — for lifecycle mail — carries the
// CAN-SPAM footer + RFC 8058 one-click List-Unsubscribe headers Gmail requires.
//
// Pure (Web Crypto + fetch only) so the standalone flightway-cron Worker imports
// it exactly like it already imports notify-token.js / _lib.js.

import { resendConfigFromEnv } from '../_lib.js';
import { unsubToken } from './notify-token.js';
import { logServerEvent, cryptoRandomId } from './events.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;

// The email types that flow through here. Not enforced (a stray type still logs
// and sends) — a reference for readers and the gate.
export const EMAIL_TYPES = [
  'verify', 'welcome', 'day3', 'weekly_digest', 'password_reset', 'quiz_results',
  // S9 Deadline Radar alert tiers. Unlike the lifecycle types these are NOT
  // `alreadySent`-guarded: a student has many deadlines and must be warned about
  // each one. Exactly-once lives per ROW, in deadlines.alerted_t3/alerted_t14.
  'deadline_t3', 'deadline_t14',
  // S11. The logged type for a review is SUFFIXED with the month
  // (`month_review:2026-07`, see monthReviewType) so `alreadySent` makes it
  // once per month rather than once per account; the bare name is the family.
  'month_review', 'broadcast',
  // An admin's test copy of a broadcast. A DISTINCT type so a test can never be
  // mistaken for the real send when reading email_log.
  'broadcast_test',
  // S15 (D24). Two sides of one credit: `referral_credit` tells the referrer
  // money landed on their account, `referral_thanks` tells the referee their
  // friend was credited (and invites them to share their own link). Both are
  // sent at most once per referral by construction — the `signed_up → converted`
  // claim in _lib/referral.js is what makes the credit path run exactly once.
  'referral_credit', 'referral_thanks',
  // S18 Semester Loop. Both are SUFFIXED with the term id (termReviewType /
  // termSetupType in term-core.js) so `alreadySent` makes them once per TERM
  // rather than once per account — a student has one term after another, and a
  // once-ever guard would mean the second one arrived in silence. The bare names
  // here are the families.
  'term_review', 'term_setup',
];

// The unsubscribe categories a footer/link can target. 'all' turns every
// category off in one click (the RFC 8058 requirement). Kept in sync with the
// columns in migration 0019 + notify-prefs.js.
export const UNSUB_CATEGORIES = ['weekly', 'deadlines', 'review', 'product', 'all'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function siteBase(env) {
  return (env && env.SITE_URL) || 'https://flightway.ai';
}

// CAN-SPAM §7704(a)(5) requires a valid physical postal address in every
// commercial email. The fallback keeps a send from crashing but is NOT a valid
// address; warned once per isolate (this runs per-recipient) and mirrored in
// `npm run verify:env`. Single-sourced here so every marketing sender agrees.
let warnedMailingAddress = false;
export function mailingAddress(env) {
  if (env && env.MAILING_ADDRESS) return env.MAILING_ADDRESS;
  if (!warnedMailingAddress) {
    warnedMailingAddress = true;
    console.warn(
      'MAILING_ADDRESS is not set — the CAN-SPAM footer is falling back to the '
      + 'company name, which is NOT a valid physical postal address. Set it on the '
      + 'flightway-cron Worker AND both Pages projects before any bulk send.',
    );
  }
  return 'FlightWay, Inc.';
}

/**
 * The lifecycle footer: "why am I getting this" + one-click unsubscribe + a
 * preferences link + the postal address, and the `List-Unsubscribe` header value
 * (RFC 8058) to pass to sendMail. `category` decides which category the
 * one-click link turns off ('all' for onboarding mail that isn't a toggle).
 */
export async function marketingFooter(env, email, opts = {}) {
  const base = siteBase(env);
  const addr = String(email || '').toLowerCase().trim();
  const token = await unsubToken(addr, env);
  const category = UNSUB_CATEGORIES.includes(opts.category) ? opts.category : 'all';
  const unsubUrl = `${base}/unsubscribe?email=${encodeURIComponent(addr)}&token=${token}&cat=${category}`;
  const prefsUrl = `${base}/flightplan.html#notifications`;
  const why = opts.why
    || 'You’re getting this because you have a FlightWay account with email updates on.';
  const address = mailingAddress(env);
  const html = `<p style="font-size:12px;line-height:1.7;color:#8a93ac;margin:0">${esc(why)}<br>`
    + `<a href="${esc(unsubUrl)}" style="color:#8fb6ff;text-decoration:underline">Unsubscribe</a>`
    + ` &nbsp;·&nbsp; <a href="${esc(prefsUrl)}" style="color:#8fb6ff;text-decoration:underline">Email preferences</a>`
    + `<br>${esc(address)}</p>`;
  const text = `${why}\nUnsubscribe: ${unsubUrl}\nEmail preferences: ${prefsUrl}\n${address}`;
  return { html, text, listUnsubscribe: `<${unsubUrl}>`, unsubUrl, prefsUrl, category };
}

/** The transactional footer: no unsubscribe (you can't unsubscribe from a
 * password reset), just the identity line. */
export function transactionalFooter() {
  const html = '<p style="font-size:12px;line-height:1.7;color:#8a93ac;margin:0">'
    + 'FlightWay · This is an account email about something you did. '
    + 'If it wasn’t you, you can safely ignore it.</p>';
  const text = 'FlightWay · This is an account email about something you did. '
    + 'If it wasn’t you, you can safely ignore it.';
  return { html, text };
}

/**
 * Wrap bespoke body content in the branded shell. Callers supply `bodyHtml`
 * (rich) + `bodyText` (plain) so both MIME parts stay correct, plus a `footer`
 * ({html,text}) from marketingFooter()/transactionalFooter(). Returns both parts.
 */
export function renderEmail({ preheader = '', heading = '', bodyHtml = '', bodyText = '', cta = null, footer = null }) {
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0b1020">${esc(preheader)}</div>` : '';
  const ctaHtml = cta
    ? `<tr><td align="center" style="padding:6px 40px 30px">`
      + `<a href="${esc(cta.url)}" style="display:inline-block;padding:14px 30px;background:#6ea8ff;`
      + `color:#06122b;font-weight:700;text-decoration:none;border-radius:100px;font-size:16px">`
      + `${esc(cta.label)} →</a></td></tr>` : '';
  const footerHtml = footer && footer.html
    ? `<tr><td style="padding:8px 40px 30px;border-top:1px solid #223056">${footer.html}</td></tr>` : '';

  const html = `<!DOCTYPE html><html lang="en"><head>`
    + `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">`
    + `</head><body style="margin:0;padding:0;background:#0b1020;color:#e8edff;`
    + `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
    + pre
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 16px">`
    + `<tr><td align="center">`
    + `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111834;border-radius:16px;overflow:hidden;border:1px solid #223056">`
    + `<tr><td style="padding:28px 40px 0">`
    + `<div style="font-size:13px;letter-spacing:.14em;font-weight:800;color:#6ea8ff;text-transform:uppercase">FlightWay</div>`
    + `</td></tr>`
    + `<tr><td style="padding:16px 40px 4px">`
    + `<h1 style="font-size:24px;line-height:1.25;margin:0 0 14px;color:#f3f6ff">${esc(heading)}</h1>`
    + bodyHtml
    + `</td></tr>`
    + ctaHtml
    + footerHtml
    + `</table></td></tr></table></body></html>`;

  const lines = [heading, ''];
  if (bodyText) lines.push(bodyText, '');
  if (cta) lines.push(`${cta.label}: ${cta.url}`, '');
  if (footer && footer.text) lines.push('—', footer.text);
  return { html, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
}

async function logEmail(env, userId, type, status, messageId) {
  try {
    if (!env || !env.DB) return;
    await env.DB.prepare(
      'INSERT INTO email_log (id, ts, user_id, type, status, message_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(cryptoRandomId(), new Date().toISOString(), userId, type, status, messageId || null).run();
  } catch (_) {
    // email_log arrives with migration 0019; a logging failure must never fail
    // (or double-count) a send.
  }
}

/**
 * The single send chokepoint. NEVER throws — returns a result the caller branches
 * on, so forgot-password can keep its "generic 200 regardless" contract and the
 * cron can keep looping. Records exactly one email_log row (sent|failed|skipped)
 * and, on success, one `email_sent` event so the send shows in the admin funnel.
 *
 * opts: { to, subject, html, text, type, listUnsubscribe?, idempotencyKey? }
 */
export async function sendMail(env, opts = {}) {
  const to = String(opts.to || '').trim();
  const userId = to.toLowerCase();
  const type = opts.type || 'other';
  const { apiKey, fromEmail } = resendConfigFromEnv(env);

  if (!apiKey) {
    await logEmail(env, userId, type, 'skipped', null);
    return { ok: false, skipped: true, status: 'skipped', error: 'RESEND_API_KEY not configured' };
  }

  const reqHeaders = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (opts.idempotencyKey) reqHeaders['Idempotency-Key'] = opts.idempotencyKey;

  const mail = { from: fromEmail, to: [to], subject: opts.subject, html: opts.html, text: opts.text };
  if (opts.listUnsubscribe) {
    // RFC 8058: the header must be paired with List-Unsubscribe-Post so Gmail /
    // Yahoo render the one-click control and POST to the URL.
    mail.headers = {
      'List-Unsubscribe': opts.listUnsubscribe,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  let status = 'failed';
  let messageId = null;
  let error = null;
  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (resp.ok) {
      status = 'sent';
      try { const j = await resp.json(); messageId = j && j.id ? String(j.id) : null; } catch (_) { /* body optional */ }
    } else {
      error = `resend ${resp.status} ${(await resp.text().catch(() => '')).slice(0, 140)}`;
    }
  } catch (err) {
    error = (err && err.name === 'AbortError') ? 'timeout'
      : String((err && err.message) || err).slice(0, 140);
  }

  await logEmail(env, userId, type, status, messageId);
  if (status === 'sent') {
    try { await logServerEvent(env, 'email_sent', { userId, props: { type } }); } catch (_) { /* best-effort */ }
  }
  return { ok: status === 'sent', status, messageId, error };
}

/** Has a `type` email already been logged sent/failed for this user? Used to
 * make welcome/day-3 exactly-once. Returns false on any error (never blocks). */
export async function alreadySent(env, userId, type) {
  try {
    if (!env || !env.DB) return false;
    const row = await env.DB.prepare(
      "SELECT 1 FROM email_log WHERE user_id = ? AND type = ? AND status != 'skipped' LIMIT 1",
    ).bind(String(userId || '').toLowerCase(), type).first();
    return !!row;
  } catch (_) {
    return false;
  }
}
