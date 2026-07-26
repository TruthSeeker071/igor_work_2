// FlightWay V2 S11 — Month in Review (D13, plan §5 S11).
//
// Once a month the product stops asking for something and reports back. That is
// the whole design constraint: every line here must be a FACT the student can
// check, derived from something already stored, because a retrospective that
// flatters is worthless the second they notice it flatters.
//
// What is derivable, and where from:
//   what you did      — `events` rows for that user, in the month (S1). The
//                       only per-user timestamped activity record we have.
//   deadlines         — `deadlines` rows whose due_date fell in the month (S9):
//                       done = hit, still tracked and past = missed.
//   commitments       — steps whose `dueAt` fell in the month (S10): done vs not.
//   coordinates       — `vector_snapshots` weeks inside the month (0007). The
//                       161 dimensions have no human-readable label anywhere on
//                       the server, so this reports MOVEMENT (how many rose,
//                       how many fell, the net) and never invents a name for a
//                       dimension. An unlabelled honest number beats a labelled
//                       guess.
//   next focus        — the soonest open commitment, else the tracked waypoint.
//   evidence          — `artifacts` rows created in the month (S12).
//   applications      — `applications` rows whose STATUS moved in the month
//                       (S12), read off `status_at` rather than `updated_at` so
//                       a notes edit is not reported as progress.
//
// The top half is PURE (gate drives it directly). `gatherMonthReview` at the
// bottom is the only part that touches D1.

import { daysUntil, utcDate } from './deadline-core.js';
import { collectCommitments } from './commitments.js';
import { trackedWaypointNodes } from './weekly-plan-gen.js';
import { waypointDisplayTitle, isoWeek } from './weekly-plan-core.js';
import { termWeek, cleanTermLabel } from './term-core.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** The activity events a review reports, in the order they are shown. */
export const REVIEW_ACTIVITY = [
  { event: 'step_done', label: 'roadmap steps completed', one: 'roadmap step completed' },
  { event: 'commitment_done', label: 'commitments kept', one: 'commitment kept' },
  { event: 'commitment_set', label: 'new commitments made', one: 'new commitment made' },
  { event: 'deadline_done', label: 'deadlines marked done', one: 'deadline marked done' },
  { event: 'marco_msg', label: 'conversations with Marco', one: 'conversation with Marco' },
  { event: 'roadmap_committed', label: 'roadmap branches tracked', one: 'roadmap branch tracked' },
  { event: 'roadmap_extend', label: 'roadmap extensions', one: 'roadmap extension' },
  // S20 — mock interviews were server-logged since S18 (`mock_completed`) but
  // the review never reported them. An events row, so it rides the existing
  // activity read with no new query and no new table dependency.
  { event: 'mock_completed', label: 'mock interviews completed', one: 'mock interview completed' },
];

/** 'YYYY-MM' for an instant, UTC. A month is a calendar month, like S9's dates. */
export function monthKey(nowMs = Date.now()) {
  return utcDate(nowMs).slice(0, 7);
}

/** The month before a 'YYYY-MM'. Returns '' on garbage rather than guessing. */
export function previousMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) { mo = 12; y -= 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

export function isMonthKey(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 && Number(m[1]) >= 2020 && Number(m[1]) <= 2100;
}

/**
 * The `email_log` type for one month's review. Month-suffixed because
 * `alreadySent` matches on (user_id, type): a static type would make the review
 * exactly-once per ACCOUNT rather than per month, and every student would get
 * exactly one review email ever.
 */
export function monthReviewType(month) {
  return `month_review:${month}`;
}

/** 'July 2026'. */
export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  return `${MONTH_NAMES[Number(m[2]) - 1] || ''} ${m[1]}`.trim();
}

/**
 * Half-open ISO bounds for a month: [startIso, endIso). Half-open because a
 * closed upper bound has to know whether the month has 28, 30 or 31 days AND
 * whether the last instant is 23:59:59.999 or 23:59:59 — every off-by-one in
 * date range code lives in that decision.
 */
export function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = Date.UTC(y, mo - 1, 1);
  const end = Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1);
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
    startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(end).toISOString().slice(0, 10), // exclusive
  };
}

function pluralize(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Vector movement across the month. `snapshots` are `{week, values[]}` in
 * chronological order — the first and last inside the window are compared.
 *
 * A dimension counts as moved only at |Δ| >= 1 point: the vectors carry
 * fractional noise from every re-merge, and a review that reports "158 of your
 * 161 coordinates moved" every month is reporting rounding, not progress.
 */
export function vectorMovement(snapshots) {
  const list = (snapshots || []).filter((s) => Array.isArray(s.values) && s.values.length);
  if (list.length < 2) {
    return { measured: false, weeks: list.length, up: 0, down: 0, net: 0, topGain: 0 };
  }
  const first = list[0].values;
  const last = list[list.length - 1].values;
  const len = Math.min(first.length, last.length);
  let up = 0, down = 0, net = 0, topGain = 0;
  for (let i = 0; i < len; i++) {
    const delta = (Number(last[i]) || 0) - (Number(first[i]) || 0);
    if (delta >= 1) { up += 1; net += delta; if (delta > topGain) topGain = delta; }
    else if (delta <= -1) { down += 1; net += delta; }
  }
  return {
    measured: true,
    weeks: list.length,
    from: list[0].week,
    to: list[list.length - 1].week,
    up,
    down,
    net: Math.round(net * 10) / 10,
    topGain: Math.round(topGain * 10) / 10,
  };
}

/**
 * S20 — live-posting readiness across the month (S16's scorecards table).
 * `rows` are ASC by created_at and may reach BEFORE the window (same rule as
 * reviewSnapshots, for the same reason: a single run inside the month still
 * deserves a baseline if an older one exists). Reports only when a run
 * happened IN the month — a stale February score is not July news.
 */
export function readinessTrend(rows, bounds) {
  const startIso = (bounds && bounds.startIso) || '';
  const endIso = (bounds && bounds.endIso) || '';
  const list = (rows || []).filter((r) => r && r.created_at && Number.isFinite(Number(r.score)));
  const inWindow = list.filter((r) => r.created_at >= startIso && r.created_at < endIso);
  if (!inWindow.length || !startIso) return { measured: false };
  const latest = inWindow[inWindow.length - 1];
  const before = list.filter((r) => r.created_at < startIso);
  // Baseline preference: the newest run before the month; else, with two or
  // more runs inside it, the month's own first run. One run ever = no trend.
  const baseline = before.length ? before[before.length - 1]
    : (inWindow.length >= 2 ? inWindow[0] : null);
  const score = Math.round(Number(latest.score));
  const from = baseline ? Math.round(Number(baseline.score)) : null;
  return {
    measured: true,
    score,
    from,
    delta: from == null ? null : score - from,
    runs: inWindow.length,
    careerName: String(latest.career_name || latest.careerName || ''),
  };
}

/**
 * S20 — outreach moves in the month (S17's contacts table). `byStatus` is
 * {status: count} for rows whose status_at fell in the window. 'suggested' is
 * excluded on purpose: status_at moves only on a real change, and the only
 * change TO suggested is a reset, which is not an advance.
 */
export function outreachSummary(byStatus) {
  const counts = byStatus || {};
  const n = (k) => Math.max(0, Number(counts[k]) || 0);
  const out = { drafted: n('drafted'), sent: n('sent'), replied: n('replied'), met: n('met') };
  out.advanced = out.drafted + out.sent + out.replied + out.met;
  return out;
}

/**
 * S20 — where the student's term stood when the month closed (S18's terms
 * table). Position is measured at the window's LAST instant, because the
 * review is written after the month ends and "week 7" on the 1st would be
 * about a week the review does not cover. A term that ended inside the month
 * is reported as ended; one that ended before it is not reported at all.
 */
export function termPosition(term, bounds) {
  if (!term || !bounds || !bounds.endIso) return { present: false };
  const atMs = Date.parse(bounds.endIso) - 1;
  if (!Number.isFinite(atMs)) return { present: false };
  const w = termWeek(term, atMs);
  const label = cleanTermLabel(term.label);
  if (w.status === 'active' || w.status === 'ending') {
    return { present: true, ended: false, week: w.week, total: w.total, label };
  }
  if (w.status === 'ended') {
    const endDate = String(term.end_date || term.endDate || '');
    if (endDate && endDate >= bounds.startDate && endDate < bounds.endDate) {
      return { present: true, ended: true, endDate, label };
    }
  }
  return { present: false };
}

/**
 * Compose the month. Everything is already filtered to the month by the caller
 * EXCEPT commitments (which come off the whole tree, because the tree has no
 * per-month index and never will).
 */
export function composeMonthReview(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const month = String(input.month || monthKey(now));
  // S18. `input.bounds` lets the same composer run over an arbitrary window —
  // the Semester Loop's end-of-term review is exactly this computation over a
  // 15-week range instead of a calendar month, and a second implementation of
  // "what moved" would be a second set of numbers to disagree with these.
  const bounds = input.bounds || monthBounds(month) || { startDate: '', endDate: '' };
  const today = utcDate(now);

  const activityCounts = input.activity || {};
  const activity = REVIEW_ACTIVITY
    .map((a) => ({ ...a, count: Math.max(0, Number(activityCounts[a.event]) || 0) }))
    .filter((a) => a.count > 0);

  const deadlineRows = input.deadlines || [];
  const deadlinesHit = deadlineRows
    .filter((d) => d.status === 'done')
    .map((d) => ({ title: String(d.title || ''), org: String(d.org || ''), date: String(d.due_date || '') }))
    .filter((d) => d.title);
  const deadlinesMissed = deadlineRows
    .filter((d) => d.status === 'tracked' && String(d.due_date || '') < today)
    .map((d) => ({ title: String(d.title || ''), org: String(d.org || ''), date: String(d.due_date || '') }))
    .filter((d) => d.title);

  const allCommitments = collectCommitments(input.roadmap, { now, includeDone: true });
  const inMonth = allCommitments.filter((c) => c.dueAt >= bounds.startDate && c.dueAt < bounds.endDate);
  const commitmentsKept = inMonth.filter((c) => c.done)
    .map((c) => ({ text: c.text, dueAt: c.dueAt, waypointTitle: c.waypointTitle }));
  const commitmentsSlipped = inMonth.filter((c) => !c.done)
    .map((c) => ({ text: c.text, dueAt: c.dueAt, waypointTitle: c.waypointTitle }));

  const movement = vectorMovement(input.snapshots);

  // S20 — the three sections S16/S17/S18 shipped without (their sessions
  // predate no part of this file, but the email predates all three features).
  const readiness = readinessTrend(input.scorecards, bounds);
  const outreach = outreachSummary(input.outreach);
  const term = termPosition(input.term, bounds);

  // Next month's ONE focus. The soonest still-open commitment beats a waypoint
  // title: it is a thing the student wrote, and it already has a date on it.
  const open = allCommitments.filter((c) => !c.done);
  let nextFocus = null;
  if (open.length) {
    nextFocus = { kind: 'commitment', text: open[0].text, dueAt: open[0].dueAt, daysOut: daysUntil(open[0].dueAt, now) };
  } else {
    const nodes = trackedWaypointNodes(input.roadmap);
    const node = nodes.find((n) => !n.done) || nodes[0];
    if (node) nextFocus = { kind: 'waypoint', text: waypointDisplayTitle(node), dueAt: '', daysOut: null };
  }

  // S12. Evidence is what the student SHOWED for the month; applications are
  // the stage moves they made. Both are already scoped to the month by the SQL
  // that read them, so the composer only shapes and caps.
  const evidence = (input.evidence || [])
    .map((a) => ({
      title: String((a && (a.title || a.role)) || ''),
      type: String((a && a.type) || ''),
      note: String((a && a.note) || ''),
      at: String((a && (a.created_at || a.createdAt)) || ''),
    }))
    .filter((e) => e.title)
    .slice(0, 8);
  const applications = (input.applications || [])
    .map((a) => ({
      role: String((a && a.role) || ''),
      company: String((a && a.company) || ''),
      status: String((a && a.status) || ''),
      at: String((a && (a.status_at || a.statusAt)) || ''),
    }))
    .filter((a) => a.role)
    .slice(0, 8);

  const totals = {
    activity: activity.reduce((s, a) => s + a.count, 0),
    deadlinesHit: deadlinesHit.length,
    deadlinesMissed: deadlinesMissed.length,
    commitmentsKept: commitmentsKept.length,
    commitmentsSlipped: commitmentsSlipped.length,
    evidence: evidence.length,
    applications: applications.length,
    outreach: outreach.advanced,
  };

  return {
    month,
    label: String(input.label || monthLabel(month)),
    careerName: String(input.careerName || ''),
    activity,
    deadlinesHit,
    deadlinesMissed,
    commitmentsKept,
    commitmentsSlipped,
    evidence,
    applications,
    outreach,
    readiness,
    term,
    movement,
    nextFocus,
    totals,
    headline: reviewHeadline({ totals, movement }),
    // The term's week number is deliberately NOT here: a position is ambient
    // state, not something the student did, and it must never be the only
    // reason a review email goes out.
    hasContent: totals.activity > 0 || totals.deadlinesHit > 0 || totals.commitmentsKept > 0
      || totals.commitmentsSlipped > 0 || totals.deadlinesMissed > 0 || movement.measured
      || totals.evidence > 0 || totals.applications > 0
      || outreach.advanced > 0 || readiness.measured,
  };
}

/**
 * One sentence at the top. Never congratulatory when nothing happened, and
 * never scolding when something slipped — the same rule Marco's follow-through
 * preamble runs on, for the same reason.
 */
export function reviewHeadline({ totals, movement }) {
  // S12 added two more ways to have had a month. A student who logged three
  // pieces of evidence and moved two applications did NOT have a quiet month,
  // and telling them they did is the kind of wrong number that ends a
  // subscription — so both count here as well as in `hasContent`.
  const ev = Number(totals.evidence) || 0;
  const apps = Number(totals.applications) || 0;
  // S20 added outreach the same way S12 added the two above: a student who
  // advanced four contacts did not have a quiet month either.
  const reach = Number(totals.outreach) || 0;
  if (totals.activity === 0 && totals.commitmentsKept === 0 && totals.deadlinesHit === 0 && ev === 0 && apps === 0 && reach === 0) {
    return 'A quiet month. The list below is short on purpose — one thing next month beats a plan you do not start.';
  }
  const parts = [];
  if (totals.commitmentsKept) parts.push(pluralize(totals.commitmentsKept, 'commitment kept', 'commitments kept'));
  if (totals.deadlinesHit) parts.push(pluralize(totals.deadlinesHit, 'deadline hit', 'deadlines hit'));
  if (ev) parts.push(pluralize(ev, 'piece of evidence logged', 'pieces of evidence logged'));
  if (apps) parts.push(pluralize(apps, 'application moved', 'applications moved'));
  if (reach) parts.push(pluralize(reach, 'outreach contact advanced', 'outreach contacts advanced'));
  if (!parts.length && totals.activity) parts.push(pluralize(totals.activity, 'move on your roadmap', 'moves on your roadmap'));
  // Three clauses is the point at which a headline stops being one.
  const lead = parts.slice(0, 3).join(', ');
  if (movement && movement.measured && movement.up > 0) {
    return `${lead} — and ${pluralize(movement.up, 'coordinate', 'coordinates')} moved up.`;
  }
  return `${lead}.`;
}

// ---------------------------------------------------------------------------
// D1 reads. Everything above is pure; everything below is one query per source
// and returns the shape composeMonthReview expects. Each read degrades to empty
// on its own rather than failing the review: a missing `deadlines` table (0020
// not applied) must not take the vector section down with it.

async function activityCounts(env, email, bounds) {
  const out = {};
  try {
    const r = await env.DB.prepare(
      'SELECT name, COUNT(*) AS c FROM events WHERE user_id = ? AND ts >= ? AND ts < ? GROUP BY name',
    ).bind(email, bounds.startIso, bounds.endIso).all();
    (r.results || []).forEach((row) => { out[row.name] = Number(row.c) || 0; });
  } catch (err) {
    console.warn('month-review: activity query failed', err && err.message ? err.message : err);
  }
  return out;
}

async function monthDeadlines(env, email, bounds) {
  try {
    const r = await env.DB.prepare(
      `SELECT title, org, due_date, status FROM deadlines
        WHERE user_id = ? AND due_date >= ? AND due_date < ? ORDER BY due_date ASC LIMIT 50`,
    ).bind(email, bounds.startDate, bounds.endDate).all();
    return r.results || [];
  } catch (err) {
    console.warn('month-review: deadlines query failed', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * Snapshots bounding the window. It deliberately reaches ONE snapshot before the
 * window starts: a student whose only snapshot inside July is the one written on
 * the 3rd would otherwise have nothing to compare against, and the review would
 * report "not enough history" for someone with a year of it.
 *
 * S18: takes `bounds` rather than a month key so the term review can use it. The
 * arithmetic is unchanged — it derived these bounds from the month itself.
 */
async function reviewSnapshots(env, email, bounds) {
  if (!bounds) return [];
  // vector_snapshots is keyed by ISO WEEK ('2026-W28'), which does not compare
  // against a 'YYYY-MM-DD' bound at all — so the range is converted to week
  // keys first. Zero-padded ISO week strings DO sort lexicographically, both
  // within and across years, which is what makes a plain SQL BETWEEN correct.
  const from = isoWeek(new Date(Date.parse(bounds.startIso) - 7 * 86400000));
  const to = isoWeek(new Date(Date.parse(bounds.endIso) - 86400000));
  try {
    const r = await env.DB.prepare(
      `SELECT week, personality_json FROM vector_snapshots
        WHERE email = ? AND week >= ? AND week <= ? ORDER BY week ASC LIMIT 12`,
    ).bind(email, from, to).all();
    return (r.results || []).map((row) => {
      let values = null;
      try { values = row.personality_json ? JSON.parse(row.personality_json) : null; } catch (_) { values = null; }
      return { week: row.week, values: Array.isArray(values) ? values : null };
    }).filter((s) => s.values);
  } catch (err) {
    console.warn('month-review: snapshots query failed', err && err.message ? err.message : err);
    return [];
  }
}

/** S12 — evidence logged in the month. Keyed by `email`, as `artifacts` has been since 0010. */
async function monthEvidence(env, email, bounds) {
  try {
    const r = await env.DB.prepare(
      `SELECT title, type, note, created_at FROM artifacts
        WHERE email = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC LIMIT 20`,
    ).bind(email, bounds.startIso, bounds.endIso).all();
    return r.results || [];
  } catch (err) {
    console.warn('month-review: evidence query failed', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * S12 — applications whose STATUS moved in the month. `status_at`, never
 * `updated_at`: a student who fixed a typo in their notes has not advanced an
 * application, and a review that says otherwise is a number they can catch us on.
 */
async function monthApplications(env, email, bounds) {
  try {
    const r = await env.DB.prepare(
      `SELECT role, company, status, status_at FROM applications
        WHERE user_id = ? AND status_at IS NOT NULL AND status_at >= ? AND status_at < ?
        ORDER BY status_at ASC LIMIT 20`,
    ).bind(email, bounds.startIso, bounds.endIso).all();
    return r.results || [];
  } catch (err) {
    console.warn('month-review: applications query failed', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * S20 — S16's scorecard runs, newest-first up to the window's end, then
 * reversed to ASC for readinessTrend. LIMIT 13 for the same reason
 * reviewSnapshots stops at 12: one baseline before the window plus a
 * generous month inside it. Degrades to empty where 0024 is not applied.
 */
async function monthScorecards(env, email, bounds) {
  try {
    const r = await env.DB.prepare(
      `SELECT score, career_name, created_at FROM scorecards
        WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 13`,
    ).bind(email, bounds.endIso).all();
    return (r.results || []).slice().reverse();
  } catch (err) {
    console.warn('month-review: scorecards query failed', err && err.message ? err.message : err);
    return [];
  }
}

/**
 * S20 — S17's contacts whose status MOVED in the month, grouped by where they
 * moved to. `status_at`, never `updated_at`, for the same reason applications
 * read `status_at`: a notes edit is not progress. Degrades to {} where 0025
 * is not applied.
 */
async function monthOutreach(env, email, bounds) {
  const out = {};
  try {
    const r = await env.DB.prepare(
      `SELECT status, COUNT(*) AS c FROM contacts
        WHERE user_id = ? AND status_at IS NOT NULL AND status_at >= ? AND status_at < ?
        GROUP BY status`,
    ).bind(email, bounds.startIso, bounds.endIso).all();
    (r.results || []).forEach((row) => { out[row.status] = Number(row.c) || 0; });
  } catch (err) {
    console.warn('month-review: contacts query failed', err && err.message ? err.message : err);
  }
  return out;
}

/**
 * S20 — the S18 term overlapping the window, newest first if several do
 * (a quarter system can legitimately have two in one month; the current one
 * wins). Overlap on DAY bounds because term dates are yyyy-mm-dd. Degrades
 * to null where 0026 is not applied.
 */
async function monthTerm(env, email, bounds) {
  try {
    const r = await env.DB.prepare(
      `SELECT label, system, start_date, end_date FROM terms
        WHERE user_id = ? AND start_date < ? AND end_date >= ?
        ORDER BY start_date DESC LIMIT 1`,
    ).bind(email, bounds.endDate, bounds.startDate).all();
    return (r.results && r.results[0]) || null;
  } catch (err) {
    console.warn('month-review: terms query failed', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Everything composeMonthReview needs, read in parallel. Callers supply the
 * roadmap tree (both of them — the endpoint and the cron — already hold it).
 */
export async function gatherMonthReview(env, email, month, opts = {}) {
  const bounds = monthBounds(month);
  if (!bounds) {
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    return composeMonthReview({ month, now, roadmap: opts.roadmap, careerName: opts.careerName });
  }
  return gatherReviewForBounds(env, email, bounds, { ...opts, month });
}

/**
 * The same five reads over an ARBITRARY window — S18's end-of-term review.
 *
 * `gatherMonthReview` is now a thin wrapper over this, which is the point: "what
 * moved" has one implementation, and a term is a window like any other. Callers
 * pass `label` because a term is named by the student ("Fall 2026") and a month
 * is named by the calendar.
 */
export async function gatherReviewForBounds(env, email, bounds, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const month = String(opts.month || monthKey(now));
  if (!bounds || !env || !env.DB) {
    return composeMonthReview({
      month, now, bounds, label: opts.label, roadmap: opts.roadmap, careerName: opts.careerName,
    });
  }
  const [activity, deadlines, snapshots, evidence, applications, scorecards, outreach, term] = await Promise.all([
    activityCounts(env, email, bounds),
    monthDeadlines(env, email, bounds),
    reviewSnapshots(env, email, bounds),
    monthEvidence(env, email, bounds),
    monthApplications(env, email, bounds),
    monthScorecards(env, email, bounds),
    monthOutreach(env, email, bounds),
    monthTerm(env, email, bounds),
  ]);
  return composeMonthReview({
    month, now, bounds, label: opts.label, activity, deadlines, snapshots, evidence, applications,
    scorecards, outreach, term,
    roadmap: opts.roadmap,
    careerName: opts.careerName,
  });
}
