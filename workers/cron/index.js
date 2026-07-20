// FlightWay 2.0 — nudge cron Worker (Pillar B2).
// Pages Functions can't run cron, so this is a small standalone Worker bound to the
// same D1 + KV. Every Monday 14:00 UTC it emails opted-in users their 3 Flight Plan
// tasks for the week (the SAME deterministic selection the portal shows), with a
// one-click unsubscribe link. Deploy: `npm run deploy:cron`.
//
// Reuses (single-sourced): weekly-plan-core selection, the unsubscribe token, and
// the Resend config helper from the Pages codebase.
import { selectWeeklyTasks } from '../../functions/_lib/weekly-plan-core.js';
import { unsubToken } from '../../functions/_lib/notify-token.js';
import { resendConfigFromEnv } from '../../functions/_lib.js';
import { effectivePlan, paywallEnabled, isDevTester } from '../../functions/_lib/entitlements.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const BATCH = 50; // ≤50/min to respect Resend limits

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run(env) {
  if (!env.DB) { console.error('cron: no DB binding'); return; }
  const { apiKey, fromEmail } = resendConfigFromEnv(env);
  if (!apiKey) { console.error('cron: RESEND_API_KEY not configured'); return; }
  const base = env.SITE_URL || 'https://flightwayjacobprototype.pages.dev';

  let users = [];
  try {
    const r = await env.DB.prepare(
      'SELECT email, plan, plan_expires_at FROM users WHERE notify_optin = 1',
    ).all();
    users = r.results || [];
    // Free/paid merge §1: the weekly digest is a Flight Plan feature. Filtered
    // here with effectivePlan rather than in SQL so an expired plan lapses on
    // the same rule the app uses. Inert while the paywall is dark (everyone is
    // treated as premium), so beta nudges keep flowing until the flip.
    if (paywallEnabled(env)) {
      users = users.filter((u) => isDevTester(env, u.email)
        || effectivePlan(u.plan, u.plan_expires_at) !== 'free');
    }
  } catch (err) {
    console.error('cron: user query failed', err?.message || err);
    return;
  }

  let sent = 0, skipped = 0, failed = 0, inBatch = 0;
  for (const u of users) {
    const email = u.email;
    try {
      const rm = await env.DB.prepare('SELECT payload FROM roadmaps WHERE email = ?').bind(email).first();
      let tasks = [];
      if (rm && rm.payload) {
        try { tasks = selectWeeklyTasks(JSON.parse(rm.payload), { limit: 3 }); } catch (_) { tasks = []; }
      }
      if (!tasks.length) { skipped += 1; continue; } // nothing to nudge about this week
      if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
      await sendNudge(env, { email, apiKey, fromEmail, base, tasks });
      sent += 1; inBatch += 1;
    } catch (err) {
      failed += 1;
      try {
        if (env.COACH_KV) {
          await env.COACH_KV.put(`nudgefail:${email}:${Date.now()}`, String(err?.message || err).slice(0, 200), { expirationTtl: 7 * 24 * 3600 });
        }
      } catch (_) { /* ignore */ }
    }
  }
  console.log(JSON.stringify({ type: 'nudge_run', sent, skipped, failed, total: users.length, at: new Date().toISOString() }));
}

async function sendNudge(env, { email, apiKey, fromEmail, base, tasks }) {
  const token = await unsubToken(email, env);
  const unsub = `${base}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
  const address = env.MAILING_ADDRESS || 'FlightWay, Inc.';
  const items = tasks.map((t) => `<li style="margin:0 0 8px">${esc(t.label)}`
    + (t.waypointTitle ? ` <span style="color:#8a93ac">— ${esc(t.waypointTitle)}</span>` : '') + '</li>').join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0b1020;color:#e8edff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:28px 24px">
    <p style="color:#6ea8ff;font-weight:700;letter-spacing:.02em;margin:0 0 6px">FLIGHTWAY · THIS WEEK</p>
    <h1 style="font-size:22px;margin:0 0 6px">Your 3 tasks this week</h1>
    <p style="opacity:.8;margin:0 0 18px">Finish these to move your career coordinates — that's the whole point.</p>
    <ol style="padding-left:20px;margin:0 0 22px;font-size:16px;line-height:1.5">${items}</ol>
    <a href="${base}/portal.html" style="display:inline-block;background:#6ea8ff;color:#06122b;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">Open your Flight Plan</a>
    <p style="opacity:.55;font-size:12px;margin:26px 0 0;line-height:1.5">You're getting this because you turned on weekly nudges (one email a week).
    <a href="${unsub}" style="color:#8fb6ff">Unsubscribe</a> · ${esc(address)}</p>
  </div></body></html>`;

  const text = `Your 3 Flight Plan tasks this week:\n\n`
    + tasks.map((t, i) => `${i + 1}. ${t.label}${t.waypointTitle ? ' — ' + t.waypointTitle : ''}`).join('\n')
    + `\n\nOpen your Flight Plan: ${base}/portal.html\n\nUnsubscribe: ${unsub}\n${address}`;

  const resp = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: [email], subject: 'Your 3 Flight Plan tasks this week', html, text }),
  });
  if (!resp.ok) {
    const d = await resp.text();
    throw new Error(`resend ${resp.status} ${d.slice(0, 140)}`);
  }
}
