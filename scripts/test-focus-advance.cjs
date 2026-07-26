/**
 * Regression: branch-aware focus advance + editability.
 * Guards the "completing all waypoints in a branch → infinite 'Loading your next
 * waypoint…'" bug and the "can't complete a branch waypoint you didn't structurally
 * commit" bug. shouldAdvanceFocus / advanceFocusWaypoint must use the ACTIVE branch's
 * next-undone waypoint, not the spine activePath; canEditWaypoint must accept a
 * branch's live frontier waypoint.
 */
// Use the real modules (roadmap-tree first: it owns FWRoadmapTree.nextWaypoint,
// which skill-gap-tracker delegates to). No stubs — this exercises the shipped code.
const path = require('path');
require(path.join(__dirname, '..', 'assets', 'js', 'app', 'roadmap-tree.js'));
require(path.join(__dirname, '..', 'assets', 'js', 'app', 'skill-gap-tracker.js'));
const T = globalThis.FWSkillGapTracker;
const RT = globalThis.FWRoadmapTree;

function tree(nodes, ft, activePath) {
  return {
    version: 2,
    trunk: { id: 'trunk' },
    activePath: activePath || ['trunk', 's1', 's2'],
    decisions: [{ id: 'd1', nodeId: 's1', options: [{ id: 'o1', childNodeId: 'b1' }] }],
    nodes: nodes,
    fitContext: {},
    focusTracker: ft,
  };
}
const spine = (s1, s2) => [
  { id: 's1', parentId: 'trunk', pathRole: 'spine', done: s1 },
  { id: 's2', parentId: 's1', pathRole: 'spine', done: s2 },
];
const branch = (b1, b2) => [
  { id: 'b1', parentId: 's1', pathRole: 'branch', done: b1 },
  { id: 'b2', parentId: 'b1', pathRole: 'branch', done: b2 },
];

let pass = 0, fail = 0;
function check(name, got, want) { const ok = got === want; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' => ' + got); ok ? pass++ : fail++; }

// 1. Exhausted branch (both branch waypoints done), spine still has an undone waypoint.
const t1 = tree([...spine(true, false), ...branch(true, true)], { version: 1, activeBranchKey: 'b1', waypointId: 'b2', skillGaps: [] });
check('exhausted branch: shouldAdvanceFocus FALSE (no infinite load)', T.shouldAdvanceFocus(t1), false);
check('exhausted branch: advance keeps pin, no spine jump', T.advanceFocusWaypoint(t1, null).focusTracker.waypointId, 'b2');

// 2. Branch has a next undone waypoint -> advance within the branch.
const t2 = tree([...spine(true, false), ...branch(true, false)], { version: 1, activeBranchKey: 'b1', waypointId: 'b1', skillGaps: [] });
check('branch next undone: shouldAdvanceFocus TRUE', T.shouldAdvanceFocus(t2), true);
check('branch advance: pins branch next-undone b2 (not spine)', T.advanceFocusWaypoint(t2, null).focusTracker.waypointId, 'b2');

// 3/4. Spine behavior unchanged.
const t3 = tree([...spine(true, false), ...branch(true, true)], { version: 1, activeBranchKey: 'spine', waypointId: 's1', skillGaps: [] });
check('spine mid: shouldAdvanceFocus TRUE (unchanged)', T.shouldAdvanceFocus(t3), true);
const t4 = tree([...spine(true, true), ...branch(true, true)], { version: 1, activeBranchKey: 'spine', waypointId: 's2', skillGaps: [] });
check('spine exhausted: shouldAdvanceFocus FALSE (unchanged)', T.shouldAdvanceFocus(t4), false);

// 5. canEditWaypoint accepts the branch frontier even when the pin is elsewhere,
//    but not a future (not-yet-reachable) branch waypoint.
const t5 = tree([...spine(true, false), ...branch(false, false)], { version: 1, activeBranchKey: 'b1', waypointId: 's1', skillGaps: [] });
check('canEditWaypoint(branch frontier b1) TRUE (pin elsewhere)', RT.canEditWaypoint(t5, 'b1'), true);
check('canEditWaypoint(future branch b2, not frontier) FALSE', RT.canEditWaypoint(t5, 'b2'), false);

// --- canMarkWaypointUndone: "done AND nothing done after it" (dependency-aware) ---
// Editor's example: a spine waypoint with a completed branch off it can't be undone.
const u1 = tree([...spine(true, false), ...branch(true, false)], {});
check('undo spine s1 with a done branch off it: FALSE', RT.canMarkWaypointUndone(u1, 's1'), false);
check('undo branch b1 (nothing done after it): TRUE', RT.canMarkWaypointUndone(u1, 'b1'), true);

// Key improvement: a done branch waypoint is undoable even if its spine fork is not done
// (old activePath-tip rule returned false here — branch tips were un-undoable).
const u2 = tree([...spine(false, false), ...branch(true, false)], {});
check('undo done branch b1 while spine fork undone: TRUE', RT.canMarkWaypointUndone(u2, 'b1'), true);

// A later spine waypoint blocks undo of an earlier one; the spine tip is undoable.
const u3 = tree([...spine(true, true), ...branch(false, false)], {});
check('undo spine s1 with later spine s2 done: FALSE', RT.canMarkWaypointUndone(u3, 's1'), false);
check('undo spine tip s2 (nothing after): TRUE', RT.canMarkWaypointUndone(u3, 's2'), true);

// A deeper branch waypoint blocks undo of an earlier branch waypoint.
const u4 = tree([...spine(true, false), ...branch(true, true)], {});
check('undo branch b1 with deeper branch b2 done: FALSE', RT.canMarkWaypointUndone(u4, 'b1'), false);
check('undo branch tip b2 (nothing after): TRUE', RT.canMarkWaypointUndone(u4, 'b2'), true);
check('undo a not-done waypoint: FALSE', RT.canMarkWaypointUndone(u4, 's2'), false);

// Sibling branches off the same spine node are independently undoable; the shared
// fork is not while either branch stays done.
const u5 = tree([
  { id: 's1', parentId: 'trunk', pathRole: 'spine', done: true },
  { id: 's2', parentId: 's1', pathRole: 'spine', done: false },
  { id: 'bA', parentId: 's1', pathRole: 'branch', done: true },
  { id: 'bB', parentId: 's1', pathRole: 'branch', done: true },
], {});
check('undo sibling branch bA independently: TRUE', RT.canMarkWaypointUndone(u5, 'bA'), true);
check('undo sibling branch bB independently: TRUE', RT.canMarkWaypointUndone(u5, 'bB'), true);
check('undo shared spine fork s1 while branches done: FALSE', RT.canMarkWaypointUndone(u5, 's1'), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
