// FlightWay V2 — the lifecycle notification engine.
//
// Pages Functions can't run cron, so this small standalone Worker (bound to the
// same D1 + KV) dispatches on `event.cron` (wrangler.toml [triggers]):
//   Daily 14:00 UTC — the lifecycle dispatcher (runDaily): day-3 onboarding
//                     follow-up, the S9 Deadline Radar T-14/T-3 alerts, the
//                     weekly Flight Plan digest on Mondays, the Month in Review
//                     on the 1st, any due broadcasts, then the nightly radar
//                     refresh and last the S16 quarterly readiness scorecards.
//   Hourly  :00     — due broadcasts only (S11). A broadcast an admin queues at
//                     15:00 UTC must not wait 23 hours for the daily pass.
//   Daily 04:00 UTC — the analytics rollup + 90-day raw prune (S1).
// `event.cron` is the schedule string Cloudflare matched, so dispatch is exact
// rather than a guess from the clock. Deploy: `npm run deploy:cron`.
//
// WHO GETS MAIL (D9/D10, changed in S11): verified + opted into the relevant
// CATEGORY. There is no longer a plan filter anywhere in this file — the
// `paywallEnabled` gate that used to restrict the digest to paying accounts is
// gone, because the free lifecycle loop IS the product's retention mechanism.
//
// Reuses (single-sourced from the Pages codebase): the weekly task selection
// AND generation, the week doc's key/signature, the shared email shell + send
// chokepoint, the lifecycle email content, the digest and review composition
// models, the analytics rollup helpers, the Deadline Radar layer, and the
// broadcast segment resolver. Nothing about a student's week is computed twice.
import { selectWeeklyTasks, isoWeek } from '../../functions/_lib/weekly-plan-core.js';
import { generateWeeklyPlan } from '../../functions/_lib/weekly-plan-gen.js';
import { loadWeekDoc, saveWeekDoc, weeklyInputSig, refreshDoneState } from '../../functions/_lib/weekly-plan-store.js';
import { loadProgressState, saveProgressState, reconcileFractionsWithTree } from '../../functions/_lib/flightplan-progress.js';
import { resolveSchool } from '../../functions/_lib/school.js';
import { resendConfigFromEnv } from '../../functions/_lib.js';
import { effectivePlan } from '../../functions/_lib/entitlements.js';
import { rollupDay, pruneEvents, previousDay, utcDayString, logServerEvent } from '../../functions/_lib/events.js';
import { sendMail, alreadySent } from '../../functions/_lib/email-template.js';
import {
  weeklyDigestEmail, day3Email, deadlineAlertEmail, monthReviewEmail, broadcastEmail,
  termReviewEmail, termSetupEmail,
} from '../../functions/_lib/emails.js';
import { ALERT_TIERS } from '../../functions/_lib/deadline-core.js';
import { selectAlertBatch, markAlerted, listUpcoming } from '../../functions/_lib/deadline-store.js';
import { refreshDeadlinesForUser } from '../../functions/_lib/deadline-refresh.js';
import { groundingEnabled, groundingBudgetAllows } from '../../functions/_lib/gemini-grounded.js';
import { schoolForCacheKey } from '../../functions/_lib/deadlines.js';
import { collectCommitments, recentCompletion } from '../../functions/_lib/commitments.js';
import { loadUserBlob } from '../../functions/_lib/user.js';
import { composeDigest, TEASER_CAP_WINDOW_DAYS } from '../../functions/_lib/digest.js';
import { monthKey, previousMonth, gatherMonthReview, monthReviewType } from '../../functions/_lib/month-review.js';
import { countMovedByUser } from '../../functions/_lib/application-store.js';
import { staleDraftsByUser } from '../../functions/_lib/contact-store.js';
import { STALE_DRAFT_DAYS } from '../../functions/_lib/contact-core.js';
import { dueBroadcasts, claimBroadcast, finishBroadcast, resolveSegment } from '../../functions/_lib/broadcast.js';
import { selectQuarterlyBatch } from '../../functions/_lib/scorecard-store.js';
import { runScorecardForUser } from '../../functions/_lib/scorecard-run.js';
import { activeTermsByUser, termsAwaitingReview, termsAwaitingRitual } from '../../functions/_lib/term-store.js';
import { termReviewType, termSetupType, defaultTermLabel } from '../../functions/_lib/term-core.js';
import { utcDate } from '../../functions/_lib/deadline-core.js';

const BATCH = 50; // ≤50/min to respect Resend limits
const ROLLUP_CRON = '0 4 * * *';
const BROADCAST_CRON = '0 * * * *';
const RADAR_ACTIVE_DAYS = 21;      // §5 S9: refresh users active in the last 3 weeks
const RADAR_DEFAULT_CAP = 50;      // users per night; override with DEADLINE_REFRESH_DAILY_CAP
const RADAR_MARK_TTL = 7 * 86400;  // one refresh per user per week
const RADAR_RETRY_TTL = 86400;     // ...but re-check a user with no career tomorrow
const SCORECARD_DEFAULT_CAP = 20;  // accounts per night; override with SCORECARD_AUTO_DAILY_CAP
const SCORECARD_MARK_TTL = 85 * 86400; // one automatic scorecard per account per quarter
// How many stale weeks the digest may GENERATE (Gemini) in one Monday run.
// Everything past it falls back to the deterministic selection, which is the
// same list minus the AI phrasing — a plain task beats a missing email.
const DIGEST_GENERATE_DEFAULT_CAP = 25;

export default {
  async scheduled(event, env, ctx) {
    if (event && event.cron === ROLLUP_CRON) {
      ctx.waitUntil(runRollup(env));
      return;
    }
    if (event && event.cron === BROADCAST_CRON) {
      ctx.waitUntil(runBroadcasts(env));
      return;
    }
    ctx.waitUntil(runDaily(env));
  },
};

/**
 * The 14:00 dispatcher. Day-3 and the alerts run every day; the digest only on
 * Mondays and the review only on the 1st (both UTC). Ordered and independently
 * guarded so a slow digest never starves day-3 and a failure in one never sinks
 * the other.
 */
async function runDaily(env, nowMs) {
  // `nowMs` is injectable so `test:cron` can drive the real dispatcher against
  // date fixtures — a Monday, the 1st, a Monday-that-is-the-1st, an ordinary
  // Wednesday — rather than asserting on the source text of an if statement.
  const now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  await runDay3(env).catch((e) => console.error('cron day3 failed', e?.message || e));
  await runDeadlineAlerts(env).catch((e) => console.error('cron deadline alerts failed', e?.message || e));
  if (now.getUTCDay() === 1) {
    await runWeeklyDigest(env, now.getTime()).catch((e) => console.error('cron digest failed', e?.message || e));
  }
  if (now.getUTCDate() === 1) {
    await runMonthReview(env, now.getTime()).catch((e) => console.error('cron month review failed', e?.message || e));
  }
  // S18 — term boundaries, every day. Unlike the digest and the review, a term
  // does not start or end on a schedule this Worker could anticipate: a quarter
  // ending on a Thursday is a Thursday email or it is a stale one.
  await runTermRituals(env, now.getTime()).catch((e) => console.error('cron term rituals failed', e?.message || e));
  // Backstop for the hourly trigger: `claimBroadcast` is an atomic status
  // change, so the two dispatchers can overlap without one re-sending what the
  // other is halfway through.
  await runBroadcasts(env).catch((e) => console.error('cron broadcasts failed', e?.message || e));
  // Last two on purpose: they are the only steps that spend money, and the only
  // ones that are fine to lose. Everything above has already run by the time the
  // grounding budget or a per-night cap stops either of them. The radar goes
  // first of the two because it serves every plan; the scorecard sweep is a paid
  // benefit and can wait for whatever budget the radar left.
  await runRadarRefresh(env).catch((e) => console.error('cron radar refresh failed', e?.message || e));
  await runQuarterlyScorecards(env).catch((e) => console.error('cron scorecard sweep failed', e?.message || e));
}

/**
 * S16 — the quarterly readiness scorecard for premium accounts (§4).
 *
 * The same three brakes the radar refresh has, because this is the more
 * expensive of the two jobs per user (three live web calls plus a 2,200-token
 * shaping call):
 *   1. `GROUNDING_ENABLED` — unset on this Worker, so the step is inert until
 *      Jacob turns it on deliberately (§7);
 *   2. the SHARED daily grounding budget, re-checked between users so we stop
 *      the loop rather than grinding through people who will all get null back;
 *   3. `SCORECARD_AUTO_DAILY_CAP` accounts per night, default 20.
 *
 * "Quarterly" is enforced by the DATA, not by the schedule: `selectQuarterlyBatch`
 * returns only accounts whose newest report is older than 85 days, so this runs
 * every night, does nothing on almost all of them, and spreads a cohort's
 * anniversaries naturally instead of stacking every premium account onto the 1st.
 *
 * Entitlement is resolved per candidate rather than filtered in SQL —
 * `resolveEntitlement` is the only thing that knows about `plan_expires_at`,
 * comp grants and the dev allowlist, and a hand-written `plan IN (...)` here
 * would be a second copy of that rule drifting quietly out of date.
 *
 * No allowance is spent: the student did not ask for this run, so charging it
 * against a meter they might want to use themselves would be indefensible.
 */
async function runQuarterlyScorecards(env) {
  if (!env.DB || !env.COACH_KV) return;
  if (!groundingEnabled(env)) return;
  const cap = Math.max(0, Number(env.SCORECARD_AUTO_DAILY_CAP) || SCORECARD_DEFAULT_CAP);
  if (!cap) return;

  const candidates = await selectQuarterlyBatch(env, { limit: cap * 3, activeDays: RADAR_ACTIVE_DAYS });
  if (!candidates.length) return;

  let done = 0, skippedFree = 0, budgetStopped = false;
  const reasons = {};
  for (const row of candidates) {
    if (done >= cap) break;
    const email = row && row.email;
    if (!email) continue;
    if (!(await groundingBudgetAllows(env, null))) { budgetStopped = true; break; }

    const plan = await effectivePlan(env, email).catch(() => 'free');
    if (plan === 'free') { skippedFree += 1; continue; } // §4: paid benefit, and nothing was spent

    // Written BEFORE the work: a run that throws must not be retried every
    // night for a quarter. The TTL is the quarter itself.
    const markKey = `scorecardcron:${email}`;
    if (await env.COACH_KV.get(markKey)) continue;
    await env.COACH_KV.put(markKey, String(Date.now()), { expirationTtl: SCORECARD_MARK_TTL });

    try {
      const quiz = await loadUserBlob(env, email).catch(() => null);
      const res = await runScorecardForUser(env, email, {
        school: schoolForCacheKey({ quiz }), source: 'auto',
      });
      if (!res.ok) {
        reasons[res.reason] = (reasons[res.reason] || 0) + 1;
        // Nothing was produced and nothing durable was spent on the two profile
        // refusals — re-check those tomorrow rather than in three months.
        if (res.reason === 'no-career' || res.reason === 'no-resume') {
          await env.COACH_KV.put(markKey, String(Date.now()), { expirationTtl: RADAR_RETRY_TTL });
          continue;
        }
        done += 1; // the web calls happened; count them against the night's cap
        continue;
      }
      done += 1;
      await logServerEvent(env, 'scorecard_run', {
        userId: email,
        props: {
          source: 'auto',
          band: res.report.band,
          requirements: res.report.counts.total,
          postings: res.report.postings.length,
          downgraded: res.downgraded,
        },
      });
    } catch (err) {
      done += 1; // it cost us something; count it
      console.error('cron scorecard failed', email, err?.message || err);
    }
  }
  console.log(JSON.stringify({
    type: 'scorecard_sweep_run', ran: done, skippedFree, budgetStopped,
    reasons, candidates: candidates.length, cap, at: new Date().toISOString(),
  }));
}

/**
 * S9 — the T-3 / T-14 Deadline Radar alerts.
 *
 * ONE email per user per tier per night, listing every deadline of theirs in
 * that window. The verified + `notify_deadlines` gate is in the SQL
 * (selectAlertBatch), so an unsubscribed account is never even loaded.
 *
 * Exactly-once is per ROW (`deadlines.alerted_t3` / `alerted_t14`), NOT the
 * email_log `alreadySent` guard the lifecycle mails use — a student has many
 * deadlines and must be warned about each of them. The marker is written only
 * after a send SUCCEEDS, so a Resend outage leaves the rows selectable
 * tomorrow instead of silently burning the one warning the feature exists for.
 */
async function runDeadlineAlerts(env) {
  if (!env.DB) return;
  const { apiKey } = resendConfigFromEnv(env);
  if (!apiKey) { console.error('cron: RESEND_API_KEY not configured (deadline alerts)'); return; }

  const now = Date.now();
  let sent = 0, rows = 0, failed = 0, inBatch = 0;

  for (const spec of ALERT_TIERS) {
    const batch = await selectAlertBatch(env, spec.tier, { now, limit: 500 });
    if (!batch.length) continue;
    const byUser = new Map();
    for (const row of batch) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push(row);
    }
    for (const [email, items] of byUser) {
      try {
        if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
        const mail = await deadlineAlertEmail(env, email, items, spec.tier, now);
        const res = await sendMail(env, {
          to: email, subject: mail.subject, html: mail.html, text: mail.text,
          type: `deadline_${spec.tier}`, listUnsubscribe: mail.listUnsubscribe,
        });
        inBatch += 1;
        if (res.ok) {
          sent += 1;
          rows += await markAlerted(env, spec.tier, items.map((i) => i.id), now);
        } else {
          failed += 1;
          await recordFail(env, email, res.error);
        }
      } catch (err) {
        failed += 1;
        console.error('cron deadline alert send failed', email, err?.message || err);
      }
    }
  }
  if (sent || failed) {
    console.log(JSON.stringify({ type: 'deadline_alerts', sent, rows, failed, at: new Date().toISOString() }));
  }
}

/**
 * S9 — the nightly Deadline Radar refresh for recently-active accounts (D12).
 *
 * Three independent brakes, because this is the one scheduled job that spends
 * real money on every iteration:
 *   1. `GROUNDING_ENABLED` — unset on this Worker, so the whole step is inert
 *      until Jacob turns it on deliberately (§7);
 *   2. the SHARED daily grounding budget (`GROUNDING_GLOBAL_DAILY`, enforced
 *      inside researchWeb and re-checked here so we stop the loop rather than
 *      grinding through users that will all get null back);
 *   3. `DEADLINE_REFRESH_DAILY_CAP` users per night, default 50.
 *
 * Per-user frequency is a KV marker written BEFORE the work — a refresh that
 * throws or finds nothing must not be retried every night for a week. The one
 * exception is an account with no target career yet: nothing was spent on it,
 * so its marker is shortened to a day and it does not count against the cap,
 * which is what stops a large population of pre-roadmap accounts from starving
 * the students who actually have something to scan for.
 */
async function runRadarRefresh(env) {
  if (!env.DB || !env.COACH_KV) return;
  if (!groundingEnabled(env)) return;
  const cap = Math.max(0, Number(env.DEADLINE_REFRESH_DAILY_CAP) || RADAR_DEFAULT_CAP);
  if (!cap) return;

  const since = new Date(Date.now() - RADAR_ACTIVE_DAYS * 86400000).toISOString();
  let users = [];
  try {
    const r = await env.DB.prepare(
      'SELECT DISTINCT user_id FROM events WHERE user_id IS NOT NULL AND ts >= ? LIMIT 2000',
    ).bind(since).all();
    users = (r.results || []).map((x) => x.user_id).filter(Boolean);
  } catch (err) {
    // Pre-0017 schema, or no analytics yet: there is no "active user" signal to
    // read, so refresh nobody rather than everybody.
    console.warn('cron radar: active-user query failed', err?.message || err);
    return;
  }

  let done = 0, added = 0, updated = 0, recent = 0, noCareer = 0, budgetStopped = false;
  for (const email of users) {
    if (done >= cap) break;
    if (!(await groundingBudgetAllows(env, null))) { budgetStopped = true; break; }
    const markKey = `radarcron:${email}`;
    if (await env.COACH_KV.get(markKey)) { recent += 1; continue; }
    await env.COACH_KV.put(markKey, String(Date.now()), { expirationTtl: RADAR_MARK_TTL });
    try {
      const quiz = await loadUserBlob(env, email).catch(() => null);
      const res = await refreshDeadlinesForUser(env, email, { school: schoolForCacheKey({ quiz }) });
      if (res.reason === 'no-career') {
        noCareer += 1;
        await env.COACH_KV.put(markKey, String(Date.now()), { expirationTtl: RADAR_RETRY_TTL });
        continue; // nothing was spent, so it does not count against the cap
      }
      done += 1;
      added += res.added; updated += res.updated;
      await logServerEvent(env, 'radar_refresh', {
        userId: email,
        props: { source: 'cron', added: res.added, updated: res.updated, reason: res.reason || 'ok' },
      });
    } catch (err) {
      done += 1; // it cost us something; count it
      console.error('cron radar refresh failed', email, err?.message || err);
    }
  }
  console.log(JSON.stringify({
    type: 'radar_refresh_run', refreshed: done, added, updated, skippedRecent: recent,
    skippedNoCareer: noCareer, budgetStopped, candidates: users.length, cap,
    at: new Date().toISOString(),
  }));
}

/**
 * V2 S1 — aggregate yesterday into events_daily, then drop raw events past the
 * 90-day retention window. Both halves are idempotent (rollupDay deletes the day
 * before re-inserting), so a retry can never double-count and a missed night can
 * be replayed by hand. Yesterday, not today: a current-day rollup would be a
 * partial count and every dashboard would show a fake dip at the right edge.
 */
async function runRollup(env) {
  if (!env.DB) { console.error('cron rollup: no DB binding'); return; }
  const today = utcDayString(Date.now());
  const day = previousDay(today);
  try {
    const names = await rollupDay(env.DB, day);
    const pruned = await pruneEvents(env.DB, today);
    console.log(JSON.stringify({
      type: 'events_rollup', day, names, prunedBefore: pruned && pruned.cutoff, pruned: pruned && pruned.changes,
    }));
  } catch (err) {
    console.error('cron rollup failed', err?.message || err);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function recordFail(env, email, msg) {
  try {
    if (env.COACH_KV) {
      return env.COACH_KV.put(`nudgefail:${email}:${Date.now()}`, String(msg || '').slice(0, 200), { expirationTtl: 7 * 24 * 3600 });
    }
  } catch (_) { /* ignore */ }
  return Promise.resolve();
}

/**
 * Recipients for a category. Verified + opted in, and NOTHING else — the
 * `paywallEnabled` plan filter that lived here through S10 is deleted (D9: free
 * users get the full lifecycle). `plan` still comes back because the digest's
 * teaser slot needs to know whether it is selling or recommending, but it never
 * decides who receives.
 *
 * Defensive: if the category column is absent (pre-0019 window, when the
 * grandfather backfill also has not run) fall back to the legacy opted-in query
 * rather than sending nothing.
 */
async function selectRecipients(env, column) {
  try {
    const r = await env.DB.prepare(
      `SELECT email, plan, plan_expires_at FROM users WHERE ${column} = 1 AND verified_at IS NOT NULL`,
    ).all();
    return r.results || [];
  } catch (_) {
    const r = await env.DB.prepare('SELECT email, plan, plan_expires_at FROM users WHERE notify_optin = 1').all();
    return r.results || [];
  }
}

async function loadTree(env, email) {
  try {
    const rm = await env.DB.prepare('SELECT payload FROM roadmaps WHERE email = ?').bind(email).first();
    if (!rm || !rm.payload) return null;
    return JSON.parse(rm.payload);
  } catch (_) {
    return null;
  }
}

/**
 * The walls each student hit recently, most-hit first — one query for the whole
 * run rather than one per recipient. This is what makes the free tier's teaser
 * slot about something they actually tried to use instead of a rotating pitch.
 *
 * Reads `props` as text and pulls `feature` with a narrow regex: D1 has
 * json_extract, but props is a free-form column and a malformed row would take
 * the whole query down with it rather than being skipped.
 */
async function capHitsByUser(env, nowMs) {
  const map = new Map();
  if (!env.DB) return map;
  const since = new Date(nowMs - TEASER_CAP_WINDOW_DAYS * 86400000).toISOString();
  try {
    const r = await env.DB.prepare(
      "SELECT user_id, props FROM events WHERE name = 'plan_cap_hit' AND user_id IS NOT NULL AND ts >= ?"
      + ' ORDER BY ts DESC LIMIT 5000',
    ).bind(since).all();
    for (const row of (r.results || [])) {
      const m = /"feature"\s*:\s*"([a-z0-9-]{1,40})"/i.exec(String(row.props || ''));
      if (!m) continue;
      if (!map.has(row.user_id)) map.set(row.user_id, new Map());
      const counts = map.get(row.user_id);
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
  } catch (err) {
    console.warn('cron: cap-hit query failed', err?.message || err);
  }
  // Collapse to a most-hit-first list per user.
  const out = new Map();
  for (const [user, counts] of map) {
    out.set(user, [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k));
  }
  return out;
}

/**
 * The Monday digest (§5 S11). Per user: the week's tasks (generated on send if
 * the week doc is stale — this runs BEFORE the student's first visit of the
 * week, so the doc it writes is the one they will see), how last week went,
 * deadlines inside three weeks, their own open commitments, one teaser and one
 * Marco line.
 *
 * `composeDigest().hasContent` is the send decision, and it deliberately does
 * NOT count the teaser: an email whose only substance is an upgrade pitch is an
 * ad, and D9 promised a digest. (Through S10 the rule was `if (!tasks.length)
 * continue`, which silently excluded every student who had dated a step but not
 * yet generated a plan.)
 */
async function runWeeklyDigest(env, nowMs) {
  if (!env.DB) { console.error('cron: no DB binding'); return; }
  const { apiKey } = resendConfigFromEnv(env);
  if (!apiKey) { console.error('cron: RESEND_API_KEY not configured'); return; }

  let users = [];
  try {
    users = await selectRecipients(env, 'notify_optin');
  } catch (err) {
    console.error('cron: digest user query failed', err?.message || err);
    return;
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const week = isoWeek(new Date(now));
  const prevWeek = isoWeek(new Date(now - 7 * 86400000));
  const capHits = await capHitsByUser(env, now);
  // S12 — how many applications each recipient moved in the last week, in ONE
  // aggregate for the whole run rather than a read per user (the capHitsByUser
  // shape). An unapplied 0022 returns an empty map, not a failed digest.
  const appMoves = await countMovedByUser(env, new Date(now - 7 * 86400000).toISOString());
  // S17 — outreach drafts written and never sent, same one-aggregate-per-run
  // shape. An unapplied 0025 returns an empty map, so a pending migration costs
  // the digest one line rather than the whole send.
  const staleDrafts = await staleDraftsByUser(env, new Date(now - STALE_DRAFT_DAYS * 86400000).toISOString());
  // S18 — every account's live term, in one grouped read for the whole run. This
  // is the ROW half only: a student whose dates live solely on the user object
  // (stated to Marco, never ritualised) is not term-aware in the digest, because
  // reading a blob per recipient is exactly the per-user read this shape exists
  // to avoid. An unapplied 0026 returns an empty map, so a pending migration
  // costs one line rather than the send.
  const terms = await activeTermsByUser(env, utcDate(now));
  const genCap = Math.max(0, Number(env.DIGEST_GENERATE_CAP) || DIGEST_GENERATE_DEFAULT_CAP);

  let sent = 0, skipped = 0, failed = 0, inBatch = 0, generated = 0;
  for (const u of users) {
    const email = u.email;
    try {
      const tree = await loadTree(env, email);
      const [prevDoc, deadlines] = await Promise.all([
        loadWeekDoc(env, email, prevWeek).catch(() => null),
        listUpcoming(env, email, { now, limit: 10 }).catch(() => []),
      ]);

      let tasks = [];
      if (tree) {
        const sig = weeklyInputSig(tree);
        let doc = await loadWeekDoc(env, email, week).catch(() => null);
        if ((!doc || doc.sig !== sig) && generated < genCap) {
          // Generate-on-send, then persist under the SHARED key/signature so the
          // student's own first visit this week is free rather than paying for
          // the same week twice. The inputs are the page's inputs — including
          // the school, because §3.6 makes stating it a hard rule for any
          // prompt that gives advice, and a plan generated here is the plan
          // they will read on the page.
          try {
            const state = reconcileFractionsWithTree(await loadProgressState(env, email), tree);
            const out = await generateWeeklyPlan(env, tree, {
              week,
              fractions: state.fractions,
              prevTasks: prevDoc ? prevDoc.tasks.map((t) => ({ label: t.label, done: !!t.done, stepId: t.stepId })) : [],
              notes: state.notes,
              school: await resolveSchool(env, email, { persist: false }).catch(() => ''),
            });
            if (out.tasks && out.tasks.length) {
              doc = { week, sig, tasks: out.tasks, generated: out.generated, generatedAt: new Date().toISOString() };
              await saveWeekDoc(env, email, doc);
              state.lastWeek = week;
              await saveProgressState(env, email, state);
              generated += 1;
            }
          } catch (err) {
            console.warn('cron digest generate failed', email, err?.message || err);
          }
        }
        // Past the generation cap (or after a failure) the deterministic
        // selection is the fallback: the same steps, without the AI phrasing.
        // NOT saved as a week doc — a doc written here would suppress the real
        // generation on the student's next visit.
        tasks = (doc && doc.tasks && doc.tasks.length)
          ? refreshDoneState({ ...doc, tasks: doc.tasks }, tree).tasks
          : selectWeeklyTasks(tree, { limit: 3 });
      }

      const digest = composeDigest({
        now,
        week,
        base: (env.SITE_URL || 'https://flightway.ai'),
        plan: effectivePlan(u.plan, u.plan_expires_at),
        tasks,
        commitments: tree ? collectCommitments(tree, { now }) : [],
        completion: tree ? recentCompletion(tree, { now }) : null,
        deadlines,
        // Last week's tasks, re-checked against the tree: a step ticked off on
        // the roadmap page still counts as last week's task closed.
        prevTasks: (prevDoc && tree) ? refreshDoneState({ ...prevDoc }, tree).tasks : (prevDoc ? prevDoc.tasks : []),
        capFeatures: capHits.get(email) || [],
        applicationsMoved: appMoves.get(email) || 0,
        staleDrafts: staleDrafts.get(email) || 0,
        term: terms.get(email) || null,
        careerName: (tree && tree.targetCareerName) || '',
      });
      if (!digest.hasContent) { skipped += 1; continue; }

      if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
      const mail = await weeklyDigestEmail(env, email, digest);
      const res = await sendMail(env, {
        to: email, subject: mail.subject, html: mail.html, text: mail.text,
        type: 'weekly_digest', listUnsubscribe: mail.listUnsubscribe,
      });
      if (res.ok) { sent += 1; } else { failed += 1; await recordFail(env, email, res.error); }
      inBatch += 1;
    } catch (err) {
      failed += 1;
      await recordFail(env, email, err?.message || err);
    }
  }
  console.log(JSON.stringify({
    type: 'nudge_run', sent, skipped, failed, generated, total: users.length, week, at: new Date().toISOString(),
  }));
}

/**
 * Month in Review, on the 1st (D13). Reviews the month that just ENDED, which
 * is the only month with a complete answer in it.
 *
 * Exactly-once is `email_log`-guarded on a month-suffixed type, so a retry (or
 * a second deploy of this Worker on the same day) cannot send two.
 * `hasContent` skips accounts with nothing to report: a review email that says
 * "you did nothing" is the single most effective unsubscribe prompt available.
 */
async function runMonthReview(env, nowMs) {
  if (!env.DB) return;
  const { apiKey } = resendConfigFromEnv(env);
  if (!apiKey) { console.error('cron: RESEND_API_KEY not configured (month review)'); return; }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const month = previousMonth(monthKey(now));
  const type = monthReviewType(month);

  let users = [];
  try {
    users = await selectRecipients(env, 'notify_review');
  } catch (err) {
    console.error('cron: review user query failed', err?.message || err);
    return;
  }

  let sent = 0, skipped = 0, failed = 0, inBatch = 0;
  for (const u of users) {
    const email = u.email;
    try {
      if (await alreadySent(env, email, type)) { skipped += 1; continue; }
      const tree = await loadTree(env, email);
      const review = await gatherMonthReview(env, email, month, {
        now, roadmap: tree, careerName: (tree && tree.targetCareerName) || '',
      });
      if (!review.hasContent) { skipped += 1; continue; }

      if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
      const mail = await monthReviewEmail(env, email, review);
      const res = await sendMail(env, {
        to: email, subject: mail.subject, html: mail.html, text: mail.text,
        type, listUnsubscribe: mail.listUnsubscribe,
      });
      if (res.ok) { sent += 1; } else { failed += 1; await recordFail(env, email, res.error); }
      inBatch += 1;
    } catch (err) {
      failed += 1;
      console.error('cron month review failed', email, err?.message || err);
    }
  }
  console.log(JSON.stringify({ type: 'month_review_run', month, sent, skipped, failed, total: users.length, at: new Date().toISOString() }));
}

/**
 * S18 — the Semester Loop's two term-boundary emails (§5 S18: "Both ritual
 * moments get FWFeatureIntro + email triggers (cron: term boundaries)").
 *
 * Two sweeps, and both are bounded on BOTH sides by `term-store.js`. A term that
 * ended eight months ago is not a retrospective anybody wants, and a "set up your
 * term" nudge in week nine is not a nudge.
 *
 * Recipients are resolved the other way round from every other step here: the
 * sweep asks D1 which TERMS are due and then intersects with the opted-in
 * recipient lists, rather than walking every recipient and asking about their
 * term. There are far fewer terms at a boundary on any given day than there are
 * accounts, and that ratio only gets better as the product grows.
 *
 * The two mails ride different categories on purpose — `review` for the
 * retrospective (alongside Month in Review) and `product` for the setup prompt,
 * because a student who unsubscribed from retrospectives did not ask to stop
 * being offered features. Exactly-once is `email_log` on a TERM-suffixed type, so
 * the next term still gets its own pair.
 */
async function runTermRituals(env, nowMs) {
  if (!env.DB) return;
  const { apiKey } = resendConfigFromEnv(env);
  if (!apiKey) { console.error('cron: RESEND_API_KEY not configured (term rituals)'); return; }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const [dueReview, dueRitual] = await Promise.all([
    termsAwaitingReview(env, { now }),
    termsAwaitingRitual(env, { now }),
  ]);
  if (!dueReview.length && !dueRitual.length) return;

  const [reviewOptIn, productOptIn] = await Promise.all([
    selectRecipients(env, 'notify_review').catch(() => []),
    selectRecipients(env, 'notify_product').catch(() => []),
  ]);
  const canReview = new Set(reviewOptIn.map((u) => u.email));
  const canProduct = new Set(productOptIn.map((u) => u.email));

  let sent = 0, skipped = 0, failed = 0, inBatch = 0;
  const pass = async (rows, allowed, typeFor, build, label) => {
    for (const row of rows) {
      const email = row.user_id;
      try {
        if (!allowed.has(email)) { skipped += 1; continue; }
        const type = typeFor(row.id);
        if (await alreadySent(env, email, type)) { skipped += 1; continue; }
        const term = {
          id: row.id,
          system: row.system,
          label: row.label || defaultTermLabel(row.system, row.start_date),
          startDate: row.start_date,
          endDate: row.end_date,
        };
        if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
        const mail = await build(env, email, term);
        const res = await sendMail(env, {
          to: email, subject: mail.subject, html: mail.html, text: mail.text,
          type, listUnsubscribe: mail.listUnsubscribe,
        });
        if (res.ok) { sent += 1; } else { failed += 1; await recordFail(env, email, res.error); }
        inBatch += 1;
      } catch (err) {
        failed += 1;
        console.error(`cron ${label} failed`, email, err?.message || err);
      }
    }
  };

  await pass(dueReview, canReview, termReviewType, termReviewEmail, 'term review');
  await pass(dueRitual, canProduct, termSetupType, termSetupEmail, 'term setup');

  console.log(JSON.stringify({
    type: 'term_ritual_run', sent, skipped, failed,
    review: dueReview.length, setup: dueRitual.length, at: new Date().toISOString(),
  }));
}

/**
 * Scheduled admin broadcasts (D11). The ONLY sender — the admin endpoint
 * queues, it never mails a segment inline, because a Pages Function that walks
 * a recipient list can be cut off mid-list with no record of where it stopped.
 *
 * `claimBroadcast` is an atomic `scheduled` → `sending` update, so the hourly
 * and daily dispatchers can overlap safely. A broadcast that dies mid-send
 * stays `sending` rather than reverting: it needs a human to look at
 * `email_log` and decide, and silently retrying a partial send to a segment is
 * how people receive the same announcement twice.
 */
async function runBroadcasts(env) {
  if (!env.DB) return;
  const { apiKey } = resendConfigFromEnv(env);
  if (!apiKey) { console.error('cron: RESEND_API_KEY not configured (broadcasts)'); return; }

  const now = Date.now();
  const due = await dueBroadcasts(env, now);
  if (!due.length) return;

  for (const b of due) {
    if (!(await claimBroadcast(env, b.id))) continue;
    let recipients = [];
    try {
      recipients = await resolveSegment(env, { segmentKind: b.segment_kind, segmentValue: b.segment_value }, { now });
    } catch (err) {
      console.error('broadcast segment failed', b.id, err?.message || err);
      await finishBroadcast(env, b.id, { recipients: 0, sent: 0, failed: 1, nowMs: now });
      continue;
    }

    let sent = 0, failed = 0, inBatch = 0;
    for (const u of recipients) {
      try {
        if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
        const mail = await broadcastEmail(env, u.email, { subject: b.subject, bodyMd: b.body_md });
        const res = await sendMail(env, {
          to: u.email, subject: mail.subject, html: mail.html, text: mail.text,
          type: 'broadcast', listUnsubscribe: mail.listUnsubscribe,
        });
        if (res.ok) sent += 1; else { failed += 1; await recordFail(env, u.email, res.error); }
        inBatch += 1;
      } catch (err) {
        failed += 1;
        console.error('broadcast send failed', b.id, u.email, err?.message || err);
      }
    }
    await finishBroadcast(env, b.id, { recipients: recipients.length, sent, failed, nowMs: Date.now() });
    console.log(JSON.stringify({
      type: 'broadcast_run', id: b.id, segment: b.segment_kind, recipients: recipients.length, sent, failed,
      at: new Date().toISOString(),
    }));
  }
}

/**
 * Day-3 onboarding follow-up. Targets accounts that turned ~3 days old, are
 * verified and opted-in, and have no prior day-3 email. Two guards do the work:
 * the email_log check (`alreadySent`) makes it exactly-once, and the created_at
 * window [now-7d, now-3d] both bounds the scan AND — critically — stops the first
 * run after deploy from emailing every older account at once. Not plan-filtered:
 * onboarding is free + paid (D9).
 */
async function runDay3(env) {
  if (!env.DB) return;
  const now = Date.now();
  const lo = new Date(now - 7 * 86400000).toISOString();
  const hi = new Date(now - 3 * 86400000).toISOString();

  let users = [];
  try {
    const r = await env.DB.prepare(
      'SELECT email FROM users WHERE notify_optin = 1 AND verified_at IS NOT NULL AND created_at >= ? AND created_at <= ?',
    ).bind(lo, hi).all();
    users = r.results || [];
  } catch (err) {
    // Pre-0019 schema (no verified_at / email_log): skip day-3 — the safe
    // direction. Resumes automatically once the migration lands.
    console.warn('cron: day3 skipped (pre-0019 schema?)', err?.message || err);
    return;
  }

  let sent = 0, inBatch = 0;
  for (const u of users) {
    const email = u.email;
    if (await alreadySent(env, email, 'day3')) continue;
    try {
      if (inBatch >= BATCH) { await sleep(60000); inBatch = 0; }
      const mail = await day3Email(env, email);
      const res = await sendMail(env, {
        to: email, subject: mail.subject, html: mail.html, text: mail.text,
        type: 'day3', listUnsubscribe: mail.listUnsubscribe,
      });
      if (res.ok) sent += 1;
      inBatch += 1;
    } catch (err) {
      console.error('cron day3 send failed', email, err?.message || err);
    }
  }
  if (sent) console.log(JSON.stringify({ type: 'day3_run', sent, at: new Date().toISOString() }));
}

// Exported for `test:cron`, which drives the real dispatcher against date
// fixtures and fake bindings rather than asserting on the source text.
export {
  runDaily, runDay3, runWeeklyDigest, runMonthReview, runBroadcasts, runRollup,
  runDeadlineAlerts, runRadarRefresh, runTermRituals, selectRecipients, capHitsByUser,
  ROLLUP_CRON, BROADCAST_CRON,
};
