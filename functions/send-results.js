// Cloudflare Pages Function — route: /send-results
// Emails the quiz-taker a link to their results. User-initiated from the results
// screen, so unlike forgot-password it surfaces send failures back to the caller.
import { jsonResponse, preflightResponse, originFromEnv } from './_lib.js';
import { checkRateLimit, hashedIpKey } from './_lib/auth.js';
import { sendMail, renderEmail, transactionalFooter } from './_lib/email-template.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function idempotencyKeyFor(email, resultsUrl) {
  const bytes = new TextEncoder().encode(`${email}|${resultsUrl}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `quiz-results/${hex.slice(0, 48)}`;
}

function resultsEmail(resultsUrl) {
  const body = 'Thanks for completing the FlightWay quiz. We scored your answers across 12 '
    + 'industries and built your personalized career map — your best-fit paths, lit up just for you.';
  return renderEmail({
    preheader: 'Your FlightWay career hub is ready.',
    heading: 'Your career hub is ready',
    bodyHtml: `<p style="font-size:15px;line-height:1.65;color:#c3ccea;margin:0 0 16px">${body}</p>`,
    bodyText: body,
    cta: { label: 'Open my career hub', url: resultsUrl },
    footer: transactionalFooter(),
  });
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
    return jsonResponse(400, { error: 'Invalid JSON body' }, origin);
  }

  const email = (payload.email || '').trim().toLowerCase();
  const resultsUrl = (payload.results_url || '').trim();

  if (!EMAIL_RE.test(email)) {
    return jsonResponse(400, { error: 'Please provide a valid email address.' }, origin);
  }
  if (!/^https?:\/\//i.test(resultsUrl) || resultsUrl.length > 8000) {
    return jsonResponse(400, { error: 'Invalid results URL.' }, origin);
  }

  // This endpoint is unauthenticated (it fires from the quiz result screen) and
  // sends mail via Resend, so throttle per-IP and per-recipient to prevent
  // email-bombing and Resend cost/reputation abuse.
  try {
    await checkRateLimit(env, `sendresults:${await hashedIpKey(env, request)}`);
    await checkRateLimit(env, `sendresults:${email}`);
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many requests. Please try again later.' }, origin);
  }

  const { html, text } = resultsEmail(resultsUrl);
  const idempotencyKey = await idempotencyKeyFor(email, resultsUrl);
  const res = await sendMail(env, {
    to: email, subject: 'Your FlightWay career hub is ready', html, text, type: 'quiz_results', idempotencyKey,
  });

  if (res.skipped) {
    console.error('RESEND_API_KEY is not configured on this deployment');
    return jsonResponse(
      500,
      {
        error:
          'Email service is not configured on this deployment. '
          + 'Add RESEND_API_KEY under Pages → Settings → Variables and Secrets, then trigger a new deployment (secrets do not apply until redeploy).',
      },
      origin,
    );
  }
  if (!res.ok) {
    if (res.error === 'timeout') {
      return jsonResponse(500, { error: 'Email service timed out. Please try again.' }, origin);
    }
    return jsonResponse(
      502,
      {
        error:
          `Resend rejected the email request: ${res.error || 'unknown error'}. `
          + 'Verify flightway.ai in Resend and set FROM_EMAIL to an address on that domain.',
      },
      origin,
    );
  }
  return jsonResponse(200, { ok: true }, origin);
}
