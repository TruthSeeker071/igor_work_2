// FlightWay 2.0 — B1 weekly Flight Plan selection invariants.
//   run: npm run test:weekly
import {
  isoWeek, selectWeeklyTasks, applyDoneState, markStepDone, planProgress,
} from '../functions/_lib/weekly-plan-core.js';

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

process.exit(fail ? 1 : 0);
