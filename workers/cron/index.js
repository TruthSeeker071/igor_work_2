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
import { getJobsForCareer } from '../../functions/_lib/jobs/cache.js';

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

// Up to 3 job postings across the user's top 2 fit-careers, read from the persisted
// portal snapshot (careerPicks carry the SOC). Shares the site's per-career KV cache.
// Best-effort: any failure returns [] so the nudge still sends without the section.
async function loadJobsForUser(env, base, email) {
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) return [];
  const row = await env.DB.prepare('SELECT payload FROM quiz_profiles WHERE email = ?').bind(email).first();
  if (!row || !row.payload) return [];
  let picks = [];
  try {
    const snap = JSON.parse(row.payload).portalSnapshot;
    picks = (snap && Array.isArray(snap.careerPicks)) ? snap.careerPicks : [];
  } catch (_) { return []; }

  const careers = [];
  const seen = new Set();
  for (const p of picks) {
    const soc = p && p.soc ? String(p.soc) : '';
    if (!soc || seen.has(soc)) continue;
    seen.add(soc);
    careers.push({ soc, title: p.title ? String(p.title) : '' });
    if (careers.length >= 2) break;
  }

  const perCareer = [];
  for (const c of careers) {
    const jobs = await getJobsForCareer(env, base, { soc: c.soc, title: c.title });
    if (jobs.length) perCareer.push(jobs);
  }
  // Round-robin so both careers are represented before either is exhausted.
  const out = [];
  const maxLen = perCareer.reduce((m, a) => Math.max(m, a.length), 0);
  for (let i = 0; i < maxLen && out.length < 3; i += 1) {
    for (let j = 0; j < perCareer.length && out.length < 3; j += 1) {
      if (perCareer[j][i]) out.push(perCareer[j][i]);
    }
  }
  return out;
}

async function run(env) {
  if (!env.DB) { console.error('cron: no DB binding'); return; }
  const { apiKey, fromEmail } = resendConfigFromEnv(env);
  if (!apiKey) { console.error('cron: RESEND_API_KEY not configured'); return; }
  const base = env.SITE_URL || 'https://flightway.ai';

  let users = [];
  try {
    const r = await env.DB.prepare('SELECT email FROM users WHERE notify_optin = 1').all();
    users = r.results || [];
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
      // Jobs are an additive section — never let them skip or fail the nudge itself.
      let jobs = [];
      try { jobs = await loadJobsForUser(env, base, email); } catch (_) { jobs = []; }
      if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
      await sendNudge(env, { email, apiKey, fromEmail, base, tasks, jobs });
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

function jobSalary(j) {
  const m = (n) => (n != null && isFinite(Number(n)))
    ? (Number(n) >= 1000 ? '$' + Math.round(Number(n) / 1000) + 'k' : '$' + Math.round(Number(n))) : '';
  const a = m(j.salaryMin); const b = m(j.salaryMax);
  if (a && b && a !== b) return a + '–' + b;
  return a || b || '';
}

async function sendNudge(env, { email, apiKey, fromEmail, base, tasks, jobs }) {
  const token = await unsubToken(email, env);
  const unsub = `${base}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
  const address = env.MAILING_ADDRESS || 'FlightWay, Inc.';
  const items = tasks.map((t) => `<li style="margin:0 0 8px">${esc(t.label)}`
    + (t.waypointTitle ? ` <span style="color:#8a93ac">— ${esc(t.waypointTitle)}</span>` : '') + '</li>').join('');

  // "3 jobs worth a look" — additive section, only when we actually have postings.
  // All Adzuna fields are untrusted: esc() text, and quote-escape the href value.
  const jobList = Array.isArray(jobs) ? jobs : [];
  let jobsHtml = '';
  let jobsText = '';
  if (jobList.length) {
    const rows = jobList.map((j) => {
      const meta = [j.company, j.location].filter(Boolean).map(esc).join(' · ');
      const sal = jobSalary(j);
      const href = esc(String(j.url || '')).replace(/"/g, '&quot;');
      return `<li style="margin:0 0 12px;list-style:none">`
        + `<a href="${href}" style="color:#e8edff;text-decoration:none;font-weight:700;font-size:15px">${esc(j.title)}</a>`
        + `<div style="color:#8a93ac;font-size:13px;margin-top:2px">${meta}${sal ? (meta ? ' · ' : '') + esc(sal) : ''}</div>`
        + `</li>`;
    }).join('');
    jobsHtml = `<div style="margin:26px 0 4px">
      <p style="color:#6ea8ff;font-weight:700;letter-spacing:.02em;margin:0 0 8px">JOBS WORTH A LOOK</p>
      <ul style="padding:0;margin:0 0 4px">${rows}</ul></div>`;
    jobsText = '\n\nJobs worth a look:\n\n' + jobList.map((j) => {
      const meta = [j.company, j.location].filter(Boolean).join(' · ');
      return `- ${j.title}${meta ? ' (' + meta + ')' : ''}\n  ${j.url}`;
    }).join('\n');
  }

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0b1020;color:#e8edff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:28px 24px">
    <p style="color:#6ea8ff;font-weight:700;letter-spacing:.02em;margin:0 0 6px">FLIGHTWAY · THIS WEEK</p>
    <h1 style="font-size:22px;margin:0 0 6px">Your 3 tasks this week</h1>
    <p style="opacity:.8;margin:0 0 18px">Finish these to move your career coordinates — that's the whole point.</p>
    <ol style="padding-left:20px;margin:0 0 22px;font-size:16px;line-height:1.5">${items}</ol>
    <a href="${base}/portal.html" style="display:inline-block;background:#6ea8ff;color:#06122b;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">Open your Flight Plan</a>
    ${jobsHtml}
    <p style="opacity:.55;font-size:12px;margin:26px 0 0;line-height:1.5">You're getting this because you turned on weekly nudges (one email a week).
    <a href="${unsub}" style="color:#8fb6ff">Unsubscribe</a> · ${esc(address)}</p>
  </div></body></html>`;

  const text = `Your 3 Flight Plan tasks this week:\n\n`
    + tasks.map((t, i) => `${i + 1}. ${t.label}${t.waypointTitle ? ' — ' + t.waypointTitle : ''}`).join('\n')
    + `\n\nOpen your Flight Plan: ${base}/portal.html`
    + jobsText
    + `\n\nUnsubscribe: ${unsub}\n${address}`;

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
