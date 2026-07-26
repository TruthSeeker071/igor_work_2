// FlightWay V2 S16 — Live-posting readiness scorecard (plan §5 S16, D13).
//
//   GET  /scorecard                                  → latest report + trend + cap state
//   POST /scorecard {action:'run'}                   → one grounded run (metered)
//   POST /scorecard {action:'commit', actionId, dueAt?}
//                                                    → an action becomes a dated roadmap step
//
// House patterns: session-gated, IP rate-limited, §4-metered. The meter is the
// heaviest in the product — three live web calls plus a 2,200-token shaping call
// — so it is spent as late as possible and refunded on every failure the student
// did not cause, exactly as `opportunities.js` does.
//
// **Strictly read-only over vectors.** The report READS the roadmap's skill gaps
// and the artifacts table to build the evidence corpus, and the commit path
// APPENDS a step. Neither touches objectiveVector, objectiveAiPatch or the
// gap-progress-sync chain: appending an undone step changes no progress, so the
// single-writer invariant (2026-07-10) is untouched and no re-sync is owed.
//
// The route is `/scorecard` and there is no `scorecard.html` — nothing to shadow
// (the S11/S12 trap where a Function at a page's path makes the page unreachable).

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, loadRoadmap, saveRoadmap } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { resolveSchool } from './_lib/school.js';
import { resolveEntitlement } from './_lib/entitlements.js';
import { checkFeatureLimit, refundFeatureUse } from './_lib/plan-limits.js';
import { groundingEnabled } from './_lib/gemini-grounded.js';
import { logServerError, logServerEvent } from './_lib/events.js';
import { MAX_STEPS_PER_NODE } from './_lib/roadmap-tree.js';
import { currentWaypoint } from './_lib/weekly-plan-gen.js';
import { applyCommitment, normalizeDueAt, normalizeEffort } from './_lib/commitments.js';
import { buildTrend } from './_lib/scorecard-core.js';
import {
  latestScorecard, listTrend, getScorecard, scorecardsTableReady,
} from './_lib/scorecard-store.js';
import { runScorecardForUser, REFUNDABLE_REASONS } from './_lib/scorecard-run.js';

const RATE_LIMIT_MAX = 40;
const FEATURE = 'scorecard-run';

/**
 * The one sentence each degraded state says out loud. A student who presses a
 * button and sees nothing assumes it is broken; every one of these is a real
 * state of the product, and naming it is the difference between "not switched on
 * yet" and "this feature is broken".
 */
const REASON_COPY = {
  'not-ready': 'The readiness scorecard is not switched on yet.',
  'grounding-off': 'Live posting search is off right now, so there is nothing to score against yet.',
  'no-career': 'Pick a target career and build your roadmap first — the scorecard reads real postings for that role.',
  'no-resume': 'Add your resume or log some evidence first. With nothing on record every requirement reads as missing, which tells you nothing.',
  'no-results': 'No live postings came back for that role just now. Try again later — this one is on us, so it did not use your run.',
  'shape-failed': 'Could not read those postings just now. Try again — this one did not use your run.',
  'no-requirements': 'Those postings did not list requirements clearly enough to score. Try again later — this one did not use your run.',
  'save-failed': 'Could not save that report. Try again — this one did not use your run.',
};

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  const ent = await resolveEntitlement(env, email);
  return { origin, email, env, request, plan: ent.effective };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `scorecard:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

/** The cap as the panel renders it. Peeks — never spends. */
async function capState(env, email, plan) {
  const cap = await checkFeatureLimit(env, email, FEATURE, { spend: false, plan });
  return {
    ok: !!cap.ok,
    limit: cap.limit === undefined ? null : cap.limit,
    remaining: cap.unlimited ? null : cap.remaining,
    resetPeriod: cap.resetPeriod || null,
    upgrade: !!cap.upgrade,
    message: cap.message || '',
  };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  try {
    const ready = await scorecardsTableReady(env);
    const [latest, trendRows, cap] = await Promise.all([
      ready ? latestScorecard(env, email) : null,
      ready ? listTrend(env, email) : [],
      capState(env, email, plan),
    ]);
    return jsonResponse(200, {
      ready,
      groundingOn: groundingEnabled(env),
      id: latest ? latest.id : '',
      at: latest ? latest.at : null,
      report: latest ? latest.report : null,
      trend: buildTrend(trendRows),
      cap,
      reason: ready ? '' : 'not-ready',
      message: ready ? '' : REASON_COPY['not-ready'],
    }, origin);
  } catch (err) {
    await logServerError(env, 'scorecard', err);
    console.warn('scorecard GET failed', err && err.message ? err.message : err);
    return jsonResponse(200, {
      ready: false, groundingOn: false, id: '', at: null, report: null, trend: [],
      cap: { ok: false, limit: null, remaining: 0, resetPeriod: null, upgrade: false, message: '' },
      reason: 'error', message: 'Could not load your scorecard just now.',
    }, origin);
  }
}

/**
 * One grounded run.
 *
 * Ordering is the whole safety story: the cheap refusals (migration, grounding
 * flag) come FIRST and cost nothing, the meter is spent only once the run is
 * genuinely about to happen, and every downstream failure the student did not
 * cause hands the allowance straight back. A free account's single lifetime
 * taste must not be burned by a Gemini timeout.
 */
async function handleRun(env, email, plan, origin) {
  if (!(await scorecardsTableReady(env))) {
    return jsonResponse(200, { ok: false, reason: 'not-ready', message: REASON_COPY['not-ready'] }, origin);
  }
  if (!groundingEnabled(env)) {
    return jsonResponse(200, { ok: false, reason: 'grounding-off', message: REASON_COPY['grounding-off'] }, origin);
  }

  const cap = await checkFeatureLimit(env, email, FEATURE, { plan });
  if (!cap.ok) {
    return jsonResponse(200, {
      ok: false,
      reason: 'capped',
      message: cap.message,
      cap: { message: cap.message, upgrade: !!cap.upgrade, resetPeriod: cap.resetPeriod, limit: cap.limit },
    }, origin);
  }

  let spent = true;
  try {
    const quiz = await loadUserBlob(env, email).catch(() => null);
    const school = await resolveSchool(env, email, { quiz }).catch(() => '');
    const res = await runScorecardForUser(env, email, { school, source: 'manual' });
    if (!res.ok) {
      // 'no-career' and 'no-resume' are the student's own profile state and are
      // refused BEFORE any grounding spend inside the pipeline — but the meter
      // was already taken here, so they are refunded too. Charging someone for
      // being told to build their roadmap first would be indefensible.
      await refundFeatureUse(env, email, FEATURE, { plan });
      spent = false;
      return jsonResponse(200, {
        ok: false, reason: res.reason, message: REASON_COPY[res.reason] || 'Could not build your scorecard just now.',
      }, origin);
    }

    await logServerEvent(env, 'scorecard_run', {
      userId: email,
      props: {
        source: 'manual',
        band: res.report.band,
        requirements: res.report.counts.total,
        postings: res.report.postings.length,
        downgraded: res.downgraded,
      },
    });

    const trendRows = await listTrend(env, email);
    return jsonResponse(200, {
      ok: true,
      id: res.id,
      at: res.report.ranAt,
      report: res.report,
      trend: buildTrend(trendRows),
      remaining: cap.unlimited ? null : Math.max(0, Number(cap.remaining) || 0),
    }, origin);
  } catch (err) {
    if (spent) await refundFeatureUse(env, email, FEATURE, { plan });
    await logServerError(env, 'scorecard', err);
    console.warn('scorecard run failed', err && err.message ? err.message : err);
    return jsonResponse(200, {
      ok: false, reason: 'error', message: 'Could not build your scorecard just now. Try again — this one did not use your run.',
    }, origin);
  }
}

/**
 * Turn one report action into a dated roadmap step.
 *
 * The step TEXT comes from the stored report, never from the request body. That
 * is the whole authorization story for a path that writes into the roadmap doc:
 * the client sends an id, the server looks up what that id means in a row it
 * already owns, and there is no shape of request that can put arbitrary text on
 * someone's roadmap.
 *
 * `aiBuilt: true` matters beyond provenance — the multi-track invariant exempts
 * aiBuilt steps from `pruneBranchNodes`, so a committed action cannot be quietly
 * removed by the next tree normalize.
 */
async function handleCommit(env, email, raw, origin) {
  const actionId = String((raw && raw.actionId) || '').trim().slice(0, 64);
  if (!actionId) return jsonResponse(400, { error: 'Missing actionId.' }, origin);

  const scorecardId = String((raw && raw.scorecardId) || '').trim().slice(0, 64);
  const stored = scorecardId
    ? await getScorecard(env, email, scorecardId)
    : await latestScorecard(env, email);
  const action = ((stored && stored.report && stored.report.actions) || [])
    .find((a) => a && a.id === actionId);
  if (!action) return jsonResponse(404, { error: 'That action is not on your latest scorecard.' }, origin);

  const tree = await loadRoadmap(env, email);
  if (!tree) return jsonResponse(409, { error: 'Build your roadmap first — actions become steps on it.' }, origin);
  const node = currentWaypoint(tree);
  if (!node) return jsonResponse(409, { error: 'No open waypoint to add this to. Build or extend your roadmap first.' }, origin);

  const stepId = `${actionId}`.slice(0, 48);
  const steps = Array.isArray(node.steps) ? node.steps : [];
  // Committing the same action twice is a double-click, not an error: the step
  // is already there and saying so is more useful than a second copy of it.
  if (steps.some((s) => s && s.id === stepId)) {
    return jsonResponse(200, { ok: true, duplicate: true, nodeId: node.id, stepId }, origin);
  }
  // normalizeSteps SILENTLY SLICES past MAX_STEPS_PER_NODE, so a full waypoint
  // must refuse here rather than accept a step that vanishes on the next save.
  if (steps.length >= MAX_STEPS_PER_NODE) {
    return jsonResponse(200, {
      ok: false, reason: 'full',
      error: 'That waypoint is already at its step limit. Check a few off first, then commit this.',
    }, origin);
  }

  const nextNode = {
    ...node,
    steps: steps.concat([{ id: stepId, text: action.text, done: false, aiBuilt: true }]),
  };
  let next = {
    ...tree,
    nodes: tree.nodes.map((n) => (n && n.id === node.id ? nextNode : n)),
    updatedAt: new Date().toISOString(),
  };

  // One save, not two: the date is applied to the in-memory tree that already
  // carries the new step. `applyCommitment` stays the single implementation of
  // what a commitment IS (committedAt stamping, dueMoves accounting).
  const dueAt = normalizeDueAt(raw && raw.dueAt);
  let commitment = null;
  if (dueAt) {
    const applied = applyCommitment(next, node.id, stepId, {
      action: 'set', dueAt, effort: normalizeEffort(raw && raw.effort),
    });
    if (applied.changed) {
      next = applied.roadmap;
      commitment = applied.commitment;
    }
  }
  await saveRoadmap(env, email, next);

  return jsonResponse(200, {
    ok: true, duplicate: false, nodeId: node.id, stepId, commitment,
    waypointTitle: String(node.shortTitle || node.title || '').slice(0, 80),
  }, origin);
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const action = String((body && body.action) || '').trim().toLowerCase();

  if (action === 'run') return handleRun(env, email, plan, origin);
  if (action === 'commit') {
    try {
      return await handleCommit(env, email, body, origin);
    } catch (err) {
      await logServerError(env, 'scorecard', err);
      console.warn('scorecard commit failed', err && err.message ? err.message : err);
      return jsonResponse(500, { error: 'Could not add that to your roadmap.' }, origin);
    }
  }
  return jsonResponse(400, { error: 'Unknown scorecard action.' }, origin);
}

export { REASON_COPY, REFUNDABLE_REASONS };
