// FlightWay 2.0 — B1 weekly Flight Plan selection invariants.
//   run: npm run test:weekly
import {
  isoWeek, selectWeeklyTasks, applyDoneState, markStepDone, planProgress,
} from '../functions/_lib/weekly-plan-core.js';
import { computeGapProgressDims } from '../functions/_lib/gap-progress-sync.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function sampleTree() {
  return {
    version: 2,
    activePath: ['trunk', 'wp1', 'wp2'],
    nodes: [
      { id: 'wp1', title: 'Waypoint 1', shortTitle: 'WP1', done: false, steps: [
        { id: 's1', text: 'Do A', done: false },
        { id: 's2', text: 'Do B', done: true },
        { id: 's3', text: 'Do C', done: false },
      ] },
      { id: 'wp2', title: 'Waypoint 2', shortTitle: 'WP2', done: false, steps: [
        { id: 's1', text: 'Do D', done: false },
        { id: 's2', text: 'Do E', done: false },
      ] },
    ],
  };
}

console.log('isoWeek:');
assert(/^\d{4}-W\d{2}$/.test(isoWeek(new Date('2026-07-08T12:00:00Z'))), 'ISO week key shape YYYY-Www');
assert(isoWeek(new Date('2026-07-06T00:00:00Z')) === isoWeek(new Date('2026-07-12T23:00:00Z')), 'Mon–Sun map to the same ISO week');
assert(isoWeek(new Date('2026-07-12T00:00:00Z')) !== isoWeek(new Date('2026-07-13T00:00:00Z')), 'next Monday rolls to a new week');

console.log('selectWeeklyTasks:');
const picked = selectWeeklyTasks(sampleTree(), { limit: 3 });
assert(picked.length === 3, 'picks 3 tasks');
assert(eq(picked.map((t) => t.id), ['wp1:s1', 'wp1:s3', 'wp2:s1']), 'path + step order, skips done steps');
assert(picked[0].label === 'Do A' && picked[0].waypointTitle === 'WP1', 'label + waypoint title carried');
assert(eq(picked, selectWeeklyTasks(sampleTree(), { limit: 3 })), 'deterministic: same tree → same tasks');
assert(selectWeeklyTasks(sampleTree(), { limit: 2 }).length === 2, 'respects limit');
assert(eq(selectWeeklyTasks({ version: 2, nodes: [] }), []), 'empty roadmap → []');
assert(eq(selectWeeklyTasks(null), []), 'null roadmap → []');

const allDone = sampleTree();
allDone.nodes.forEach((n) => { n.steps.forEach((s) => { s.done = true; }); n.done = true; });
assert(eq(selectWeeklyTasks(allDone), []), 'all steps done → []');

// no activePath → falls back to node order
const noPath = sampleTree(); delete noPath.activePath;
assert(selectWeeklyTasks(noPath, { limit: 3 }).length === 3, 'falls back to node order when no active path');

// semester-plan sequencing: plan-anchored steps come first, in phase order,
// carrying the phase's weeks label; unanchored steps follow in step order.
const planned = sampleTree();
planned.nodes[0].semesterPlan = { sig: 'x', plan: { phases: [
  { title: 'P1', weeks: 'Weeks 1-3', items: [{ text: 'later step first', stepId: 's3' }] },
  { title: 'P2', weeks: 'Weeks 4-6', items: [{ text: 'then this', stepId: 's1' }] },
] } };
const seq = selectWeeklyTasks(planned, { limit: 3 });
assert(eq(seq.map((t) => t.id), ['wp1:s3', 'wp1:s1', 'wp2:s1']), 'semester plan reorders steps (s3 before s1)');
assert(seq[0].weeks === 'Weeks 1-3' && seq[1].weeks === 'Weeks 4-6', 'tasks carry their phase week window');
assert(seq[2].weeks === undefined, 'unanchored step has no weeks label');

console.log('applyDoneState:');
const tree2 = sampleTree();
tree2.nodes[0].steps[0].done = true; // wp1:s1 now done
const refreshed = applyDoneState(picked, tree2);
assert(refreshed.find((t) => t.id === 'wp1:s1').done === true, 'saved task reflects live done-state');
assert(refreshed.find((t) => t.id === 'wp2:s1').done === false, 'incomplete task stays not-done');

console.log('markStepDone:');
const tree3 = sampleTree();
assert(markStepDone(tree3, 'wp2', 's1', true) === true, 'marks an existing step');
assert(tree3.nodes[1].done === false, 'waypoint not complete while a step remains');
markStepDone(tree3, 'wp2', 's2', true);
assert(tree3.nodes[1].done === true, 'waypoint completes when all steps done');
assert(markStepDone(tree3, 'nope', 's1', true) === false, 'missing waypoint → false');

console.log('planProgress:');
assert(eq(planProgress([{ done: true }, { done: false }, { done: true }]), { done: 2, total: 3 }), 'counts done/total');

console.log('computeGapProgressDims (steps → absolute gap values):');
function gapTree() {
  const t = sampleTree();
  t.nodes[0].addressedGaps = ['Analyzing Data'];
  t.focusTracker = {
    version: 3,
    skillGaps: [
      { id: 'g1', dimIndex: 10, label: 'Analyzing Data', vBase: 30, user: 30, target: 90 },
      { id: 'g2', dimIndex: 20, label: 'Unmatched Gap', vBase: 40, user: 40, target: 80 },
    ],
  };
  return t;
}
{
  const t = gapTree(); // wp1 (addresses g1): 1 of 3 done; overall: 1 of 5 done
  const dims = computeGapProgressDims(t);
  const g1 = dims.find((d) => d.index === 10);
  const g2 = dims.find((d) => d.index === 20);
  // g1: 30 + 60·0.6·(1/3) = 42; g2 falls back to overall ratio: 40 + 40·0.6·(1/5) = 44.8 → 45
  assert(g1 && g1.value === 42, 'matched gap uses its waypoints\' step ratio (42)');
  assert(g2 && g2.value === 45, 'unmatched gap falls back to overall path ratio (45)');
  assert(eq(computeGapProgressDims(t), dims), 'idempotent: same tree → same dims');
}
{
  const t = gapTree();
  t.nodes.forEach((n) => n.steps.forEach((s) => { s.done = false; }));
  const dims = computeGapProgressDims(t);
  assert(dims.every((d, i) => d.value === [30, 40][i]), 'zero steps done → exact vBase restore');
  t.nodes.forEach((n) => n.steps.forEach((s) => { s.done = true; }));
  const full = computeGapProgressDims(t);
  const g1 = full.find((d) => d.index === 10);
  assert(g1.value === 30 + Math.round(60 * 0.6), 'all steps done → base + 60% of span');
  t.focusTracker.skillGaps[0].manualComplete = true;
  const manual = computeGapProgressDims(t).find((d) => d.index === 10);
  assert(manual.value === 84, 'manualComplete pins at least 90% of span (84)');
}
{
  const t = gapTree();
  t.focusTracker.skillGaps[0].logs = [{ id: 'l1', text: 'built it', w: 12 }, { id: 'l2', text: 'shipped', w: 12 }, { id: 'l3', text: 'more', w: 12 }];
  const g1 = computeGapProgressDims(t).find((d) => d.index === 10);
  // evidence capped at 30: 30 + 60·min(0.9, 0.6·(1/3) + 0.30) = 30 + 60·0.5 = 60
  assert(g1.value === 60, 'evidence weights count, capped at 30% (60)');
  t.focusTracker.skillGaps[0].checklist = [{ id: 'c1', done: true }, { id: 'c2', done: true }];
  const withLegacy = computeGapProgressDims(t).find((d) => d.index === 10);
  // legacy checklist fully done lifts ratio to 1.0: 30 + 60·min(0.9, 0.6+0.3) = 84
  assert(withLegacy.value === 84, 'legacy checklist credit never regresses (max ratio)');
}
assert(eq(computeGapProgressDims({ nodes: [] }), []), 'no focusTracker → []');

// ── v2: AI weekly plan pure helpers ─────────────────────────────
const { currentWaypoint, trackedWaypointNodes, sanitizeWeeklyTasks, fallbackWeeklyTasks, describeStepProgress } =
  await import('../functions/_lib/weekly-plan-gen.js');
const { emptyProgressState, accrueTaskToggle, reconcileFractionsWithTree } =
  await import('../functions/_lib/flightplan-progress.js');

console.log('weekly-plan-gen:');
{
  const t = sampleTree();
  assert(currentWaypoint(t)?.id === 'wp1', 'currentWaypoint = first not-done path node with steps');
  t.nodes[0].done = true;
  assert(currentWaypoint(t)?.id === 'wp2', 'skips done waypoints');
}
{
  // trackedWaypointNodes: no focusTracker → just the spine's current waypoint.
  assert(eq(trackedWaypointNodes(sampleTree()).map((n) => n.id), ['wp1']), 'tracked set = spine current waypoint when nothing else tracked');
  const branchTree = sampleTree();
  branchTree.nodes.push({ id: 'b1', title: 'Branch 1', shortTitle: 'B1', pathRole: 'branch', done: false, steps: [{ id: 'x1', text: 'Branch step', done: false }] });
  branchTree.focusTracker = { branchFocuses: [{ branchKey: 'b1', waypointId: 'b1' }] };
  assert(eq(trackedWaypointNodes(branchTree).map((n) => n.id), ['wp1', 'b1']), 'tracked set = spine + each tracked branch (spine first)');
  const spineOff = sampleTree();
  spineOff.focusTracker = { spineTracked: false, branchFocuses: [] };
  assert(trackedWaypointNodes(spineOff).length >= 1, 'never empty — falls back to the current waypoint even if spine flagged off with no branches');
}
{
  // sanitizeWeeklyTasks now takes an ARRAY of tracked nodes; each task must name
  // one of them via waypointId, else it is dropped.
  const nodes = [sampleTree().nodes[0]]; // tracked = [wp1]
  const tasks = sanitizeWeeklyTasks([
    { label: 'Read ch. 4 of the stats book', stepId: 's1', waypointId: 'wp1', advance: 0.4 },
    { label: 'Task on a done step', stepId: 's2', waypointId: 'wp1', advance: 0.5 },
    { label: 'Send 3 networking emails', stepId: 'nope', waypointId: 'wp1', advance: 2, carried: true },
    { label: '', stepId: 's3', waypointId: 'wp1' },
    { label: 'z'.repeat(300), stepId: 's3', waypointId: 'wp1', advance: -1 },
    { label: 'Task on an untracked waypoint', stepId: 'x', waypointId: 'zzz' },
  ], nodes, '2026-W28');
  assert(tasks.length === 3, 'drops empty labels, done-step, and untracked-waypoint tasks');
  assert(tasks[0].id === '2026-W28-t1' && tasks[0].stepId === 's1' && tasks[0].advance === 0.4, 'week-scoped ids, valid stepId + advance kept');
  assert(tasks[1].stepId === null && tasks[1].carried === true && tasks[1].advance === 1, 'unknown stepId nulled, advance clamped to 1, carried kept');
  assert(tasks[2].label.length === 120 && tasks[2].advance === 0.05, 'label capped at 120, advance floor 0.05');
  assert(tasks.every((x) => x.waypointId === 'wp1' && x.done === false), 'tasks bound to a tracked waypoint, start undone');
}
{
  // The guarantee: a tracked waypoint the model skipped still gets ≥1 task.
  const nodes = [sampleTree().nodes[0], sampleTree().nodes[1]]; // tracked = [wp1, wp2]
  const tasks = sanitizeWeeklyTasks([
    { label: 'Only covers wp1', stepId: 's1', waypointId: 'wp1', advance: 0.5 },
  ], nodes, '2026-W28');
  assert(tasks.some((t) => t.waypointId === 'wp1') && tasks.some((t) => t.waypointId === 'wp2'), '≥1 task per tracked waypoint (skipped wp2 is lifted)');
  assert(tasks.find((t) => t.waypointId === 'wp2').source === 'waypoint', 'the lifted task is a deterministic waypoint lift');
}
{
  // Fallback is scoped to the tracked set. No focusTracker → only wp1's not-done
  // steps (s1, s3), not the whole active path.
  const fb = fallbackWeeklyTasks(sampleTree(), '2026-W28');
  assert(fb.length === 2 && fb[0].id === '2026-W28-t1' && fb[0].stepId === 's1' && fb[0].advance === 1, 'fallback lifts the tracked waypoint\'s not-done steps into v2 shape');
  assert(fb.every((t) => t.waypointId === 'wp1'), 'fallback stays within the tracked set (no wander to untracked wp2)');
  // Multi-track fallback covers spine AND each tracked branch.
  const bt = sampleTree();
  bt.nodes.push({ id: 'b1', title: 'Branch 1', shortTitle: 'B1', pathRole: 'branch', done: false, steps: [{ id: 'x1', text: 'Branch step', done: false }] });
  bt.focusTracker = { branchFocuses: [{ branchKey: 'b1', waypointId: 'b1' }] };
  const fb2 = fallbackWeeklyTasks(bt, '2026-W28');
  assert(fb2.some((t) => t.waypointId === 'wp1') && fb2.some((t) => t.waypointId === 'b1'), 'fallback covers the spine AND the tracked branch (≥1 each)');
}
{
  const lines = describeStepProgress(sampleTree().nodes[0], { 'wp1:s1': 0.5 });
  assert(lines[0].state.startsWith('IN PROGRESS'), 'fractional credit reads as IN PROGRESS');
  assert(lines[1].state === 'DONE' && lines[2].state === 'not started', 'done/not-started states derived from tree');
}

console.log('flightplan-progress:');
{
  const st = emptyProgressState();
  const task = { stepId: 's1', waypointId: 'wp1', advance: 0.4 };
  let r = accrueTaskToggle(st, task, true);
  assert(r.fraction === 0.4 && r.stepDone === false, 'accrual adds advance, below 1 → step not done');
  r = accrueTaskToggle(st, task, true);
  accrueTaskToggle(st, task, true);
  r = accrueTaskToggle(st, task, true);
  assert(r.fraction === 1 && r.stepDone === true, 'accrual clamps at 1 and flips stepDone');
  r = accrueTaskToggle(st, task, false);
  assert(r.fraction === 0.6 && r.stepDone === false, 'un-checking subtracts and un-flips');
  assert(accrueTaskToggle(st, { label: 'glue' }, true) === null, 'stepless tasks accrue nothing');
}
{
  const st = emptyProgressState();
  st.fractions['wp1:s1'] = 0.999;
  const rec = reconcileFractionsWithTree(st, sampleTree());
  assert(rec.fractions['wp1:s2'] === 1, 'directly-completed steps read as fraction 1');
  assert(rec.fractions['wp1:s1'] === 0.9, 'stale ≥1 fraction on an undone step drops back below the flip point');
}

// ---------------------------------------------------------------------------
// S18 — term-aware fixtures (§5 S18 names this gate for them).
//
// Two things are being pinned, and the second is the one that will bite:
//
//   1. **The ritual's output feeds the weekly loop.** Three outcomes become dated
//      steps on the current waypoint, and if `selectWeeklyTasks` did not pick
//      them up the whole Semester Loop would be a card that writes to a place
//      nothing reads. This is the composition, tested directly.
//   2. **`node.semesterPlan` and the S18 term are DIFFERENT things that share a
//      word.** The waypoint's `semesterPlan` is a pre-existing per-waypoint
//      phase sequence (`planOrderForNode`, weekly-plan-core.js:26); the term is
//      the student's academic calendar. Neither is derived from the other and
//      neither may quietly become the other's fallback — a student on quarters
//      whose waypoint carries a "semesterPlan" is not thereby on semesters.
console.log('S18 term awareness:');
{
  const { termWeek, termPhrase, seedSchedule } = await import('../functions/_lib/term-core.js');
  const at = (iso) => Date.parse(`${iso}T12:00:00Z`);
  const term = { system: 'quarter', startDate: '2026-09-28', endDate: '2026-12-11' };

  // The ritual's steps, as functions/semester.js seeds them: the student's own
  // text, `aiBuilt` (which exempts them from pruneBranchNodes), a due date.
  const seeded = seedSchedule(term, { outcomes: ['Ship the backtest', 'Get the referral'], deliverable: 'Public writeup' }, at('2026-09-28'));
  assert(seeded.length === 3, 'the ritual schedules two outcomes and a deliverable');
  const tree = sampleTree();
  tree.nodes[0].steps = seeded.map((s, i) => ({ id: `tmabc o${i}`.replace(' ', ''), text: s.text, done: false, aiBuilt: true, dueAt: s.dueAt }));
  const tasks = selectWeeklyTasks(tree, { limit: 3 });
  assert(tasks.length === 3, 'and all three are pickable as weekly tasks');
  assert(tasks[0].label === 'Ship the backtest',
    'the weekly plan offers the term outcome by the student\'s own words — the ritual feeds the loop');
  assert(tasks.every((t) => t.waypointId === 'wp1'),
    'from the current waypoint, which is where the ritual put them');

  // The two "semester" concepts do not leak into each other.
  const planned = sampleTree();
  planned.nodes[0].semesterPlan = { plan: { phases: [{ weeks: 'Weeks 1-3', items: [{ stepId: 's3' }] }] } };
  const order = selectWeeklyTasks(planned, { limit: 3 }).map((t) => t.id);
  assert(order[0] === 'wp1:s3',
    "a waypoint's own semesterPlan still sequences its steps — that concept is untouched by S18");
  assert(termWeek(planned.nodes[0].semesterPlan || {}).status === 'none',
    'and a semesterPlan is not a term: it has no dates, so termWeek says "none" rather than guessing');
  assert(termPhrase(term, at('2026-11-02')) === 'Week 6 of 11',
    'the term phrase the digest and the card share is week-of-total, from the term\'s own dates');
  assert(termWeek(term, at('2026-11-02')).total === 11 && termWeek(term, at('2026-11-02')).week === 6,
    'and an eleven-week quarter is eleven weeks, not fifteen — the system name never sets the length');
}

process.exit(fail ? 1 : 0);
