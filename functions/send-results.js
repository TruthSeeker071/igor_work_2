// Cloudflare Pages Function — route: /send-results
// (redeploy trigger: picks up the RESEND_API_KEY secret added in Pages settings)
import {
  jsonResponse,
  preflightResponse,
  originFromEnv,
  resendConfigFromEnv,
} from './_lib.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_FETCH_TIMEOUT_MS = 8000;

async function idempotencyKeyFor(email, resultsUrl) {
  const bytes = new TextEncoder().encode(`${email}|${resultsUrl}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `quiz-results/${hex.slice(0, 48)}`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(resultsUrl) {
  const safeUrl = esc(resultsUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;box-shadow:0 6px 24px rgba(15,23,42,0.06);overflow:hidden;">
          <tr><td style="padding:36px 40px 0;text-align:center;">
            <div style="font-size:12px;letter-spacing:3px;font-weight:700;color:#1a56db;text-transform:uppercase;margin-bottom:10px;">Flightway</div>
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#0f172a;margin:0 0 14px;line-height:1.2;">Your career hub is ready</h1>
            <p style="font-size:15px;line-height:1.65;color:#475569;margin:0 0 28px;">
              Thanks for completing the Flightway quiz. We scored your answers
              across 12 industries and built your personalized career map — your
              best-fit paths, lit up just for you.
            </p>
          </td></tr>
          <tr><td align="center" style="padding:0 40px 32px;">
            <a href="${safeUrl}"
               style="display:inline-block;padding:15px 36px;background:#1a56db;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;border-radius:100px;box-shadow:0 4px 14px rgba(26,86,219,0.35);">
              Open My Career Hub →
            </a>
          </td></tr>
          <tr><td style="padding:0 40px 36px;">
            <p style="font-size:12px;line-height:1.6;color:#94a3b8;margin:0;text-align:center;">
              Button not working? Copy &amp; paste this URL into your browser:<br>
              <span style="color:#475569;word-break:break-all;">${safeUrl}</span>
            </p>
          </td></tr>
          <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;">
            <p style="font-size:11px;color:#94a3b8;margin:0;">
              You're receiving this because you requested your results at Flightway.
              If this wasn't you, you can safely ignore this email.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildText(resultsUrl) {
  return [
    'Your career hub is ready.',
    '',
    'Thanks for completing the Flightway quiz. Click the link below to',
    'open your personalized career map:',
    '',
    resultsUrl,
    '',
    "If this wasn't you, you can safely ignore this email.",
  ].join('\n');
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

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

  const { apiKey, fromEmail } = resendConfigFromEnv(env);
  if (!apiKey) {
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

  try {
    const idempotencyKey = await idempotencyKeyFor(email, resultsUrl);
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: 'Your Flightway career hub is ready',
        html: buildHtml(resultsUrl),
        text: buildText(resultsUrl),
      }),
      signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error('Resend API error', resp.status, detail);

      let detailText = 'Email service returned an error.';
      try {
        const parsed = JSON.parse(detail);
        detailText = parsed.message || parsed.error || detail;
      } catch {
        detailText = detail || detailText;
      }

      return jsonResponse(
        502,
        {
          error:
            `Resend rejected the email request: ${detailText}. `
            + 'Verify flightway.ai in Resend and set FROM_EMAIL to an address on that domain.',
        },
        origin,
      );
    }

    return jsonResponse(200, { ok: true }, origin);
  } catch (err) {
    console.error('send-results failed', err);
    const timedOut = err && err.name === 'AbortError';
    return jsonResponse(
      500,
      { error: timedOut ? 'Email service timed out. Please try again.' : 'Could not send email. Please try again.' },
      origin,
    );
  }
}
