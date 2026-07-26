// FlightWay V2 S18 — the Semester Loop (plan §5 S18, D14).
//
//   GET  /semester                       → the term, the week, what it seeded
//   POST /semester {action:'setup', …}   → the start-of-term ritual
//   POST /semester {action:'review'}     → the end-of-term review (+1 regen, once)
//
// **The route is `/semester` and the surface is the Semester Loop**, which is
// what §5 S18 calls it even for the quarter and trimester students the system
// field exists for. S17's naming rule: the endpoint takes the vocabulary the
// events already use (`semester_setup`, `semester_review`). It is deliberately
// not `/term`, which sits one keystroke from the `/terms` legal page.
//
// Two things here are load-bearing and neither is obvious:
//
//  1. **The ritual writes into the roadmap doc**, which §3.8 calls a fragile
//     save/merge path. It takes `functions/scorecard.js`'s exact shape — build
//     the steps into an in-memory tree, apply every date through
//     `applyCommitment` (S10's single implementation of what a commitment IS),
//     then ONE `saveRoadmap`. Nothing here touches objectiveVector,
//     objectiveAiPatch or the gap-progress-sync chain, so no re-sync is owed.
//     `normalizeSteps` SILENTLY SLICES past MAX_STEPS_PER_NODE, so the seeding
//     stops at the ceiling and REPORTS what did not fit rather than writing
//     steps that vanish on the next save.
//  2. **The +1 roadmap regeneration is an entitlement**, so its guard is a D1
//     column written in the same statement that checks it (`claimTermRegen`),
//     never a flag in the client-writable user blob. The grant itself is
//     `grantFeatureBonus`, not a refund: a refund does nothing for a student who
//     has not spent this month's allowance yet, which is most of them.
//
// "What moved" is `month-review.js` run over the term's window rather than a
// calendar month — one implementation of that computation, not two.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey, loadRoadmap, saveRoadmap } from './_lib/auth.js';
import { loadUserBlob } from './_lib/user.js';
import { normalizeUser } from './_lib/user-model.js';
import { setUserFields } from './_lib/user-sync.js';
import { logServerError } from './_lib/events.js';
import { resolveCareer } from './_lib/deadline-refresh.js';
import { currentWaypoint } from './_lib/weekly-plan-gen.js';
import { MAX_STEPS_PER_NODE } from './_lib/roadmap-tree.js';
import { applyCommitment } from './_lib/commitments.js';
import { gatherReviewForBounds } from './_lib/month-review.js';
import { grantFeatureBonus } from './_lib/plan-limits.js';
import {
  TERM_SYSTEMS, MAX_OUTCOMES, normalizeTermSystem, cleanTermLabel, defaultTermLabel,
  validateTerm, termWeek, termHeadline, sanitizeOutcomes, sanitizeAnchors,
  seedSchedule, reviewOpen, termBounds,
} from './_lib/term-core.js';
import {
  termsTableReady, resolveTerm, currentTermRow, upsertTerm, saveTermReview, claimTermRegen,
} from './_lib/term-store.js';

const RATE_LIMIT_MAX = 60;

const REASON_COPY = {
  'not-ready': 'The semester loop is not switched on yet.',
  'bad-system': 'Pick semester, quarter or trimester.',
  'bad-dates': 'Both term dates need to be real calendar days.',
  'too-short': 'That term is shorter than three weeks — check the dates.',
  'too-long': 'That is longer than any single term. Set one block at a time.',
  'already-over': 'That term is already over. Set up the next one, or review the last one below.',
  'too-far': 'That start date is more than a year out. Set it closer to the time.',
  'no-outcomes': 'Name at least one outcome for the term — that is the whole ritual.',
  'save-failed': 'Could not save your term just now. Try again.',
  'no-term': 'Set up your term first.',
  'no-roadmap': 'Build your roadmap first — term outcomes become dated steps on it.',
  'no-waypoint': 'No open waypoint to hang these on. Build or extend your roadmap first.',
  'waypoint-full': 'Your current waypoint is at its step limit, so nothing was dated. Check a few steps off and run this again.',
  'too-early': 'The review opens in the last week of your term.',
};

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  return { origin, email, env, request };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `semester:${await hashedIpKey(env, request)}`, { max: RATE_LIMIT_MAX });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

/** The term for this account from whichever home has one, plus the blob it needed. */
async function loadTermContext(env, email, now) {
  const blob = await loadUserBlob(env, email).catch(() => null);
  const user = normalizeUser(blob || {});
  const term = await resolveTerm(env, email, { user, now });
  return { blob, user, term };
}

function publicTerm(term, now) {
  if (!term) return null;
  const w = termWeek(term, now);
  return {
    id: term.id || '',
    source: term.source,
    system: term.system,
    label: term.label || defaultTermLabel(term.system, term.startDate),
    startDate: term.startDate,
    endDate: term.endDate,
    outcomes: term.outcomes || [],
    anchors: term.anchors || { courses: [], clubs: [], deliverable: '' },
    seeded: term.seeded || [],
    reviewedAt: term.reviewedAt || '',
    regenGrantedAt: term.regenGrantedAt || '',
    week: w.week,
    total: w.total,
    status: w.status,
    daysLeft: w.daysLeft,
  };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  const now = Date.now();
  try {
    const ready = await termsTableReady(env);
    const { term } = await loadTermContext(env, email, now);
    return jsonResponse(200, {
      ready,
      systems: TERM_SYSTEMS,
      maxOutcomes: MAX_OUTCOMES,
      term: publicTerm(term, now),
      // A mirror term (dates learned in conversation, no row) can never carry a
      // review, because the ritual that a review reports on never happened.
      review: (term && term.review) || null,
      canReview: !!(term && term.id && reviewOpen(term, now)),
      headline: termHeadline(term, now),
      reason: ready ? '' : 'not-ready',
      message: ready ? '' : REASON_COPY['not-ready'],
    }, origin);
  } catch (err) {
    await logServerError(env, 'semester', err);
    console.warn('semester GET failed', err && err.message ? err.message : err);
    return jsonResponse(200, {
      ready: false, systems: TERM_SYSTEMS, maxOutcomes: MAX_OUTCOMES, term: null, review: null,
      canReview: false, headline: '', reason: 'error', message: 'Could not load your term just now.',
    }, origin);
  }
}

/**
 * The start-of-term ritual: three outcomes, the courses and clubs they hang off,
 * one deliverable → a term row, dated roadmap steps, and the mirror on the user
 * object so Marco and the digest know what week it is.
 *
 * Ordering is deliberate. The TERM ROW is written first and the roadmap second,
 * because a term with no seeded steps is a working feature (the card offers to
 * seed again) while seeded steps with no term is an orphan set of dates nothing
 * explains. If the roadmap write fails, the student has a term.
 */
async function handleSetup(env, email, raw, origin) {
  const now = Date.now();
  const system = normalizeTermSystem(raw && raw.system);
  const startDate = String((raw && raw.startDate) || '').slice(0, 10);
  const endDate = String((raw && raw.endDate) || '').slice(0, 10);
  const check = validateTerm({ system, startDate, endDate }, now);
  if (!check.ok) {
    return jsonResponse(200, { ok: false, reason: check.reason, message: REASON_COPY[check.reason] }, origin);
  }

  const outcomes = sanitizeOutcomes(raw && raw.outcomes);
  const anchors = sanitizeAnchors(raw && raw.anchors);
  if (!outcomes.length) {
    return jsonResponse(200, { ok: false, reason: 'no-outcomes', message: REASON_COPY['no-outcomes'] }, origin);
  }

  const term = {
    system,
    label: cleanTermLabel(raw && raw.label) || defaultTermLabel(system, startDate),
    startDate,
    endDate,
    outcomes,
    anchors,
    seeded: [],
  };
  const schedule = seedSchedule(term, { outcomes, deliverable: anchors.deliverable }, now);

  const saved = await upsertTerm(env, email, term, now);
  if (!saved.ok) {
    return jsonResponse(200, { ok: false, reason: 'save-failed', message: REASON_COPY['save-failed'] }, origin);
  }
  term.id = saved.id;

  // The mirror: ONE user save and ONE dossier write for all three halves of the
  // same fact (user-sync.js setUserFields). Best-effort — a term whose dates did
  // not reach the dossier is a term Marco has to be told about again, not a
  // failed ritual.
  try {
    await setUserFields(env, email, {
      'identity.termSystem': system,
      'identity.termStart': startDate,
      'identity.termEnd': endDate,
    });
  } catch (err) {
    console.warn('semester mirror failed', err && err.message ? err.message : err);
  }

  const seedResult = await seedCommitments(env, email, saved.id, schedule);
  if (seedResult.seeded.length) {
    term.seeded = seedResult.seeded;
    await upsertTerm(env, email, term, now);
  }

  const fresh = await currentTermRow(env, email, now);
  return jsonResponse(200, {
    ok: true,
    term: publicTerm(fresh || { ...term, source: 'row' }, now),
    seeded: seedResult.seeded,
    // Requested vs actually dated. They disagree exactly when the waypoint hit
    // its step ceiling, which is a real wall the student would otherwise meet as
    // silence.
    requested: schedule.length,
    reason: seedResult.reason,
    message: seedResult.reason ? (REASON_COPY[seedResult.reason] || '') : '',
    headline: termHeadline(fresh || term, now),
  }, origin);
}

/**
 * Turn the ritual's schedule into dated roadmap steps.
 *
 * The step TEXT is the student's own words, so it is already sanitized
 * (`sanitizeOutcomes`) and stored — this reads it back out of the schedule the
 * server built, never out of the request body a second time.
 *
 * `aiBuilt: true` matches `scorecard.js`'s committed actions. The flag is not a
 * claim about authorship — the text here is the student's — it is what exempts a
 * server-seeded step from `pruneBranchNodes`, and a term commitment that the
 * next tree normalize could quietly remove would be the worst possible version
 * of this feature.
 */
async function seedCommitments(env, email, termId, schedule) {
  const empty = { seeded: [], reason: '' };
  if (!schedule.length) return empty;

  const tree = await loadRoadmap(env, email).catch(() => null);
  if (!tree) return { seeded: [], reason: 'no-roadmap' };
  const node = currentWaypoint(tree);
  if (!node) return { seeded: [], reason: 'no-waypoint' };

  const existing = Array.isArray(node.steps) ? node.steps : [];
  const room = Math.max(0, MAX_STEPS_PER_NODE - existing.length);
  if (!room) return { seeded: [], reason: 'waypoint-full' };

  const idBase = String(termId || '').slice(-8);
  const fresh = [];
  schedule.slice(0, room).forEach((item, i) => {
    const stepId = `tm${idBase}${item.kind === 'deliverable' ? 'd' : 'o'}${i}`.slice(0, 48);
    if (existing.some((s) => s && s.id === stepId)) return; // re-running the ritual is not a second copy
    fresh.push({ id: stepId, text: item.text, done: false, aiBuilt: true, dueAt: item.dueAt });
  });
  if (!fresh.length) return { seeded: [], reason: schedule.length > room ? 'waypoint-full' : '' };

  const nextNode = {
    ...node,
    steps: existing.concat(fresh.map((f) => ({ id: f.id, text: f.text, done: false, aiBuilt: true }))),
  };
  let next = {
    ...tree,
    nodes: tree.nodes.map((n) => (n && n.id === node.id ? nextNode : n)),
    updatedAt: new Date().toISOString(),
  };
  // One save, not one per step: every date goes onto the in-memory tree that
  // already carries the new steps, through the single implementation of what a
  // commitment is.
  const seeded = [];
  fresh.forEach((f) => {
    const applied = applyCommitment(next, node.id, f.id, { action: 'set', dueAt: f.dueAt });
    if (applied.changed) next = applied.roadmap;
    seeded.push({ nodeId: node.id, stepId: f.id, text: f.text, dueAt: f.dueAt });
  });
  await saveRoadmap(env, email, next);

  return {
    seeded,
    reason: schedule.length > seeded.length ? 'waypoint-full' : '',
    waypointTitle: String(node.shortTitle || node.title || '').slice(0, 80),
  };
}

/**
 * The end-of-term review.
 *
 * Idempotent by construction: `saveTermReview` overwrites the stored snapshot
 * (running it twice on the last day of term is not two terms), but the +1
 * regeneration is claimed through a single conditional UPDATE that can only
 * succeed once. `granted` in the response is that claim's own answer, so the
 * copy can say "this is your bonus" exactly once and "you already have it" every
 * time after.
 */
async function handleReview(env, email, origin) {
  const now = Date.now();
  const { user, term } = await loadTermContext(env, email, now);
  if (!term || !term.id) {
    return jsonResponse(200, { ok: false, reason: 'no-term', message: REASON_COPY['no-term'] }, origin);
  }
  if (!reviewOpen(term, now)) {
    return jsonResponse(200, { ok: false, reason: 'too-early', message: REASON_COPY['too-early'] }, origin);
  }

  const bounds = termBounds(term);
  const roadmap = await loadRoadmap(env, email).catch(() => null);
  const career = resolveCareer(user, roadmap);
  const review = await gatherReviewForBounds(env, email, bounds, {
    now,
    label: term.label || defaultTermLabel(term.system, term.startDate),
    roadmap,
    careerName: career.name,
  });

  // Claim first, save second: the claim is the thing that must happen exactly
  // once, and a review row that failed to write is recoverable (press it again)
  // while a double grant is not.
  const granted = await claimTermRegen(env, email, term.id, now);
  if (granted) await grantFeatureBonus(env, email, 'roadmap-generate', 1);

  const stored = { ...review, term: { id: term.id, label: term.label, startDate: term.startDate, endDate: term.endDate } };
  await saveTermReview(env, email, term.id, stored, now);

  const fresh = await currentTermRow(env, email, now);
  return jsonResponse(200, {
    ok: true,
    review: stored,
    granted,
    // What the grant actually bought, in the product's own words. Never a cap
    // number written here — §3 rule 11 — just the fact that there is one more.
    grantLine: granted
      ? 'That term earned you one extra roadmap rebuild. It is on your account now and does not expire at the end of the month.'
      : '',
    term: publicTerm(fresh || term, now),
    headline: termHeadline(fresh || term, now),
  }, origin);
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const action = String((body && body.action) || '').trim().toLowerCase();

  // Every write needs the table, answered with a sentence rather than a 500.
  if (!(await termsTableReady(env))) {
    return jsonResponse(200, { ok: false, reason: 'not-ready', message: REASON_COPY['not-ready'] }, origin);
  }

  try {
    if (action === 'setup') return await handleSetup(env, email, body, origin);
    if (action === 'review') return await handleReview(env, email, origin);
  } catch (err) {
    await logServerError(env, 'semester', err);
    console.warn('semester POST failed', action, err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not save your term just now.' }, origin);
  }
  return jsonResponse(400, { error: 'Unknown semester action.' }, origin);
}

export { REASON_COPY };
