// Roadmap branch layout + full-branch extend invariants (run: npm run roadmap:layout)
//
// Session 1 of the roadmap completion plan (docs/ROADMAP_COMPLETION_PLAN_2026-07-21.md):
//   WS-A1 — the client layout engine must place branches so no two node boxes
//           overlap, no branch crosses the spine, and a committed branch may run
//           arbitrarily far past the spine tip (no depth cap).
//   WS-A2 — the server extend path must grow a committed branch by a real
//           multi-waypoint chunk, keep every new node renderable (confidence >= 2),
//           and let the branch continue past the spine-tip depth without pruning.
//
// The layout half loads the real client module (assets/js/app/roadmap-tree.js)
// in a vm sandbox and drives buildLayout on synthetic trees. The extend half
// drives the real server helpers (normalizeRoadmapTree / mergeTreeExtend).

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeRoadmapTree,
  mergeTreeExtend,
  uncommitTreePath,
  latestCompletedWaypointId,
  nodeConfidence,
  MAX_TREE_NODES,
  MAX_EXTEND_NODES,
  MAX_EXTEND_PER_CALL,
  SPINE_WAYPOINT_COUNT,
} from '../functions/_lib/roadmap-tree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ok  ' + msg); return; }
  fails += 1;
  console.error('  FAIL ' + msg);
}

// ---- load the real client layout module in a sandbox ----------------------
const clientCode = fs.readFileSync(path.join(ROOT, 'assets/js/app/roadmap-tree.js'), 'utf8');
const sandbox = { requestAnimationFrame: () => {}, console };
vm.createContext(sandbox);
vm.runInContext(clientCode, sandbox); // typeof window === 'undefined' -> binds to the sandbox global
const FWRoadmapTree = sandbox.FWRoadmapTree;
if (!FWRoadmapTree || typeof FWRoadmapTree.buildLayout !== 'function') {
  console.error('could not load FWRoadmapTree.buildLayout from client module');
  process.exit(1);
}

// A node box is generous enough that two nodes on the grid never touch, but any
// genuine overlap (same / near-same position) is flagged. Lanes are 130 world
// units apart, branch hops 72, spine hops 110 — all exceed a full box side.
const BOX_HALF_W = 55; // box width 110 < 130 (lane spacing)
const BOX_HALF_H = 30; // box height 60 < 72 (branch hop spacing)
const SIBLING_GAP = 130;

function overlaps(a, b) {
  return Math.abs(a.x - b.x) < BOX_HALF_W * 2 && Math.abs(a.y - b.y) < BOX_HALF_H * 2;
}

function assertNoOverlap(layout, label) {
  const ns = layout.nodes;
  let bad = null;
  for (let i = 0; i < ns.length && !bad; i += 1) {
    for (let j = i + 1; j < ns.length; j += 1) {
      if (overlaps(ns[i], ns[j])) { bad = [ns[i], ns[j]]; break; }
    }
  }
  ok(!bad, `${label}: no two node boxes overlap` + (bad
    ? ` (got ${bad[0].id}@(${bad[0].x},${bad[0].y}) vs ${bad[1].id}@(${bad[1].x},${bad[1].y}))` : ''));
}

function assertSpineClearance(layout, label) {
  // Every non-spine, non-trunk node lives at least one full lane off the spine
  // column, so branches never cross or touch x=0.
  const bad = layout.nodes.filter((n) => {
    const role = (n.raw && n.raw.pathRole) || n.pathRole;
    if (n.id === 'trunk' || role === 'spine') return false;
    return Math.abs(n.x) < SIBLING_GAP - 1;
  });
  ok(bad.length === 0, `${label}: no branch node crosses the spine`
    + (bad.length ? ` (offenders: ${bad.map((n) => `${n.id}@x=${n.x}`).join(', ')})` : ''));
}

// ---- synthetic-tree builders (client shape: getSpineChain follows pathRole) --
function spineNode(i, extra) {
  return Object.assign({
    id: 's' + i,
    parentId: i === 1 ? 'trunk' : 's' + (i - 1),
    pathRole: 'spine',
    confidence: Math.max(3, 5 - Math.floor((i - 1) / 2)),
    title: 'Spine ' + i,
    steps: [],
  }, extra || {});
}

function baseSpine() {
  return [
    spineNode(1),
    spineNode(2, { isMajor: true }),
    spineNode(3),
    spineNode(4, { isMajor: true }),
    spineNode(5),
    spineNode(6),
  ];
}

// FIXTURE A — a base tree: 6 spine, two majors, two short branches per major.
function fixtureBase() {
  const nodes = baseSpine();
  function branch(id, parent, conf) {
    return { id, parentId: parent, pathRole: 'branch', confidence: conf, title: id, steps: [] };
  }
  nodes.push(branch('a1', 's2', 3), branch('a2', 'a1', 2), branch('b1', 's2', 3));
  nodes.push(branch('c1', 's4', 2), branch('c2', 'c1', 2), branch('d1', 's4', 2));
  const decisions = [
    { id: 'da', nodeId: 's2', options: [{ id: 'oa1', childNodeId: 'a1', label: 'A' }, { id: 'oa2', childNodeId: 'b1', label: 'B' }] },
    { id: 'dc', nodeId: 's4', options: [{ id: 'oc1', childNodeId: 'c1', label: 'C' }, { id: 'oc2', childNodeId: 'd1', label: 'D' }] },
  ];
  return { version: 2, nodes, decisions, activePath: ['trunk', 's1', 's2', 's3', 's4', 's5', 's6'], trunk: { id: 'trunk', title: 'Start' } };
}

// FIXTURE B — a long committed+extended branch: a 12-hop linear chain off s2.
function fixtureLongBranch() {
  const nodes = baseSpine();
  const chain = [];
  for (let k = 1; k <= 12; k += 1) {
    const id = 'x' + k;
    nodes.push({ id, parentId: k === 1 ? 's2' : 'x' + (k - 1), pathRole: 'branch', confidence: Math.max(2, 5 - Math.floor(k / 2)), title: id, steps: [] });
    chain.push(id);
  }
  // A second short exploratory branch off the OTHER major, on the opposite side.
  nodes.push({ id: 'y1', parentId: 's4', pathRole: 'branch', confidence: 3, title: 'y1', steps: [] });
  const decisions = [
    { id: 'dx', nodeId: 's2', options: [{ id: 'ox1', childNodeId: 'x1', label: 'X' }, { id: 'ox2', childNodeId: 'y1', label: 'skip' }], chosenOptionId: 'ox1' },
    { id: 'dy', nodeId: 's4', options: [{ id: 'oy1', childNodeId: 'y1', label: 'Y' }, { id: 'oy2', childNodeId: 'x1', label: 'skip' }] },
  ];
  return { tree: { version: 2, nodes, decisions, activePath: ['trunk', 's1', 's2', 's3', 's4', 's5', 's6'], trunk: { id: 'trunk', title: 'Start' } }, chain };
}

// FIXTURE C — a branch that itself forks (a decision whose nodeId is a branch
// node), to stress lane reservation for sub-forks.
function fixtureSubFork() {
  const nodes = baseSpine();
  function branch(id, parent, conf) {
    return { id, parentId: parent, pathRole: 'branch', confidence: conf, title: id, steps: [] };
  }
  nodes.push(branch('p1', 's2', 3), branch('p2', 'p1', 3));
  // p2 forks into f1 and f2
  nodes.push(branch('f1', 'p2', 2), branch('f1b', 'f1', 2), branch('f2', 'p2', 2));
  const decisions = [
    { id: 'dp', nodeId: 's2', options: [{ id: 'op1', childNodeId: 'p1', label: 'P' }, { id: 'op2', childNodeId: 'f2', label: 'alt' }] },
    { id: 'df', nodeId: 'p2', options: [{ id: 'of1', childNodeId: 'f1', label: 'F1' }, { id: 'of2', childNodeId: 'f2', label: 'F2' }] },
  ];
  return { version: 2, nodes, decisions, activePath: ['trunk', 's1', 's2', 's3', 's4', 's5', 's6'], trunk: { id: 'trunk', title: 'Start' } };
}

// FIXTURE D — two branches on the SAME side off DIFFERENT majors, the inner one
// long. Stresses that the outward lean (WS-multi angled growth) stays inside the
// branch's reserved lane band and never overlaps the outer branch or the spine.
function fixtureSameSideLean() {
  const nodes = baseSpine();
  function branch(id, parent, conf) {
    return { id, parentId: parent, pathRole: 'branch', confidence: conf, title: id, steps: [] };
  }
  let prev = 's2';
  for (let k = 1; k <= 7; k += 1) { nodes.push(branch('m' + k, prev, 3)); prev = 'm' + k; } // ordinal 0 -> left, 7 hops
  nodes.push(branch('r1', 's2', 3));                                    // ordinal 1 -> right
  nodes.push(branch('n1', 's4', 3), branch('n2', 'n1', 2));             // ordinal 2 -> left (same side as m)
  const decisions = [
    { id: 'dm', nodeId: 's2', options: [{ id: 'om1', childNodeId: 'm1', label: 'M' }, { id: 'om2', childNodeId: 'r1', label: 'R' }] },
    { id: 'dn', nodeId: 's4', options: [{ id: 'on1', childNodeId: 'n1', label: 'N' }, { id: 'on2', childNodeId: 'm1', label: 'skip' }] },
  ];
  return { version: 2, nodes, decisions, activePath: ['trunk', 's1', 's2', 's3', 's4', 's5', 's6'], trunk: { id: 'trunk', title: 'Start' } };
}

// ============================ WS-A1: layout ================================
console.log('WS-A1 collision-aware branch layout');

const layoutA = FWRoadmapTree.buildLayout(fixtureBase());
assertNoOverlap(layoutA, 'base tree');
assertSpineClearance(layoutA, 'base tree');
ok(layoutA.nodes.some((n) => n.x < 0) && layoutA.nodes.some((n) => n.x > 0),
  'base tree: branches placed on both sides of the spine');

const { tree: longTree, chain: longChain } = fixtureLongBranch();
const layoutB = FWRoadmapTree.buildLayout(longTree);
assertNoOverlap(layoutB, 'long extended branch');
assertSpineClearance(layoutB, 'long extended branch');
const placedIds = new Set(layoutB.nodes.map((n) => n.id));
const missing = longChain.filter((id) => !placedIds.has(id));
ok(missing.length === 0, `long extended branch: all 12 hops rendered (no depth cap)`
  + (missing.length ? ` — missing ${missing.join(', ')}` : ''));
const deepest = layoutB.nodes.find((n) => n.id === 'x12');
ok(deepest && deepest.y < layoutB.spineTipY,
  'long extended branch: the tip runs past the spine tip');

const layoutC = FWRoadmapTree.buildLayout(fixtureSubFork());
assertNoOverlap(layoutC, 'sub-fork branch');
assertSpineClearance(layoutC, 'sub-fork branch');
ok(['p1', 'p2', 'f1', 'f1b', 'f2'].every((id) => layoutC.nodes.some((n) => n.id === id)),
  'sub-fork branch: linear chain and both sub-forks all placed');

const layoutD = FWRoadmapTree.buildLayout(fixtureSameSideLean());
assertNoOverlap(layoutD, 'same-side leaning branches');
assertSpineClearance(layoutD, 'same-side leaning branches');
ok(['m1', 'm7', 'n1', 'n2'].every((id) => layoutD.nodes.some((n) => n.id === id)),
  'same-side leaning branches: long inner chain + outer branch all placed');

// Determinism: same tree in, byte-identical positions out.
const l1 = FWRoadmapTree.buildLayout(fixtureBase());
const l2 = FWRoadmapTree.buildLayout(fixtureBase());
const posStr = (l) => l.nodes.map((n) => `${n.id}:${n.x},${n.y}`).sort().join('|');
ok(posStr(l1) === posStr(l2), 'layout is deterministic across redraws');

// ============================ WS-A2: extend ================================
console.log('\nWS-A2 full-branch extend (server)');

ok(MAX_TREE_NODES === 48, `MAX_TREE_NODES raised to 48 (got ${MAX_TREE_NODES})`);
ok(MAX_EXTEND_NODES === 46, `MAX_EXTEND_NODES raised to 46 (got ${MAX_EXTEND_NODES})`);
ok(MAX_EXTEND_PER_CALL === 6, `MAX_EXTEND_PER_CALL === 6 (got ${MAX_EXTEND_PER_CALL})`);

// A valid v2 base tree the real normalizer accepts (branch roots parented to
// their major so assignConfidenceScores walks the whole committed chain).
function serverBase() {
  const nodes = [
    { id: 's1', parentId: 'trunk', depth: 1, pathRole: 'spine', title: 'Foundation semester', confidence: 5, steps: [{ id: 's1a', text: 'Enroll in the intro sequence', done: false }] },
    { id: 's2', parentId: 's1', depth: 2, pathRole: 'spine', isMajor: true, title: 'First branch point', confidence: 4, steps: [{ id: 's2a', text: 'Pick a specialization', done: false }] },
    { id: 's3', parentId: 's2', depth: 3, pathRole: 'spine', title: 'Build a real project', confidence: 4, steps: [{ id: 's3a', text: 'Ship a portfolio project', done: false }] },
    { id: 's4', parentId: 's3', depth: 4, pathRole: 'spine', isMajor: true, title: 'Second branch point', confidence: 3, steps: [{ id: 's4a', text: 'Choose an internship track', done: false }] },
    { id: 's5', parentId: 's4', depth: 5, pathRole: 'spine', title: 'Internship push', confidence: 3, steps: [{ id: 's5a', text: 'Apply broadly', done: false }] },
    { id: 's6', parentId: 's5', depth: 6, pathRole: 'spine', title: 'Convert to a return offer', confidence: 3, steps: [{ id: 's6a', text: 'Nail the interviews', done: false }] },
    { id: 'ba1', parentId: 's2', depth: 3, pathRole: 'branch', title: 'Deepen quantitative skills', confidence: 3, addressedGaps: ['quantitative skills'], steps: [{ id: 'ba1a', text: 'Take real analysis', done: false }] },
    { id: 'ba2', parentId: 'ba1', depth: 4, pathRole: 'branch', title: 'Apply the math in a project', confidence: 2, addressedGaps: ['quantitative skills'], steps: [{ id: 'ba2a', text: 'Build a pricing model', done: false }] },
    { id: 'bb1', parentId: 's2', depth: 3, pathRole: 'branch', title: 'Alternative: software depth', confidence: 3, addressedGaps: ['software engineering'], steps: [{ id: 'bb1a', text: 'Take systems programming', done: false }] },
    { id: 'bc1', parentId: 's4', depth: 5, pathRole: 'branch', title: 'Research track', confidence: 2, addressedGaps: ['research'], steps: [{ id: 'bc1a', text: 'Join a lab', done: false }] },
    { id: 'bd1', parentId: 's4', depth: 5, pathRole: 'branch', title: 'Alternative: industry track', confidence: 2, addressedGaps: ['industry'], steps: [{ id: 'bd1a', text: 'Cold-email alumni', done: false }] },
  ];
  return normalizeRoadmapTree({
    version: 2,
    targetCareerSlug: 'data-scientist',
    targetCareerName: 'Data Scientist',
    trunk: { id: 'trunk', title: 'Where you are now', subtitle: 'Now', confidence: 5 },
    nodes,
    decisions: [
      { id: 'd1', nodeId: 's2', prompt: 'Which way?', options: [{ id: 'o1', label: 'Deepen quantitative skills', childNodeId: 'ba1' }, { id: 'o2', label: 'Alternative: software depth', childNodeId: 'bb1' }] },
      { id: 'd2', nodeId: 's4', prompt: 'Which track?', options: [{ id: 'o3', label: 'Research track', childNodeId: 'bc1' }, { id: 'o4', label: 'Alternative: industry track', childNodeId: 'bd1' }] },
    ],
    activePath: ['trunk', 's1', 's2', 's3', 's4', 's5', 's6'],
  }, null);
}

const base = serverBase();
ok(base && base.nodes && base.nodes.length >= 8,
  'base tree normalizes (raised caps + confidence floor did not break normal generation)');

// Every branch node in the base is now renderable (confidence >= 2) — the floor
// fix (assignConfidenceScores) that previously let branch children decay to 1.
if (base) {
  const invisibleBranch = base.nodes.filter((n) => n.pathRole === 'branch' && nodeConfidence(n) <= 1);
  ok(invisibleBranch.length === 0,
    'every base branch node is renderable (confidence >= 2)'
    + (invisibleBranch.length ? ` — got ${invisibleBranch.map((n) => n.id).join(', ')}` : ''));
}

// Commit the quantitative branch (choose option 1 off s2), then simulate an
// AI extend of 6 fresh waypoints off its tip.
function extNodes(prefix, n) {
  const nodes = [];
  for (let k = 1; k <= n; k += 1) {
    nodes.push({
      id: `${prefix}${k}`,
      parentId: k === 1 ? 'tip' : `${prefix}${k - 1}`,
      depth: 4 + k,
      pathRole: 'branch',
      title: `Extension waypoint ${prefix}${k}`,
      // Deliberately understated confidence: the server must floor these to >= 2
      // (and never prune them) as they run past the spine tip.
      confidence: 1,
      addressedGaps: ['quantitative skills'],
      steps: [{ id: `${prefix}${k}s1`, text: `Do concrete step ${k}`, done: false }],
    });
  }
  return { nodes, decisions: [] };
}

function commit(tree, decisionNodeId, optionIndex) {
  const decisions = tree.decisions.map((d) => (
    d.nodeId === decisionNodeId ? { ...d, chosenOptionId: d.options[optionIndex].id } : d
  ));
  return { ...tree, decisions };
}

// Find the committed branch root (chosen option's childNodeId off s2).
const committed = base ? commit(base, 's2', 0) : null;
const branchRootId = committed && committed.decisions.find((d) => d.nodeId === 's2').options[0].childNodeId;

function branchChainLen(tree, rootId) {
  let cur = tree.nodes.find((n) => n.id === rootId);
  let len = 0;
  const seen = new Set();
  while (cur && !seen.has(cur.id) && len < 60) {
    seen.add(cur.id);
    len += 1;
    const kids = tree.nodes.filter((n) => n.parentId === cur.id && n.pathRole === 'branch');
    cur = kids.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] || null;
  }
  return len;
}

if (committed && branchRootId) {
  const baseLen = branchChainLen(committed, branchRootId);
  const ext1 = mergeTreeExtend(committed, branchRootId, extNodes('e', 6));
  const grew1 = ext1.nodes.length - committed.nodes.length;
  ok(grew1 >= 3 && grew1 <= MAX_EXTEND_PER_CALL,
    `extend adds a multi-waypoint chunk (added ${grew1}, cap ${MAX_EXTEND_PER_CALL})`);
  ok(branchChainLen(ext1, branchRootId) > baseLen,
    'extend lengthens the committed branch chain');

  // Every node on the committed branch is renderable — the floor fix means the
  // understated confidence-1 inputs come out >= 2 and none were pruned.
  const committedNodeIds = new Set();
  (function collect(id) {
    committedNodeIds.add(id);
    ext1.nodes.filter((n) => n.parentId === id && n.pathRole === 'branch').forEach((c) => collect(c.id));
  }(branchRootId));
  const belowFloor = [...committedNodeIds]
    .map((id) => ext1.nodes.find((n) => n.id === id))
    .filter((n) => n && nodeConfidence(n) <= 1);
  ok(belowFloor.length === 0,
    'extended nodes are all renderable (confidence floored to >= 2, none pruned)'
    + (belowFloor.length ? ` — got ${belowFloor.map((n) => n.id).join(', ')}` : ''));

  // Continuous extension: extend AGAIN off the new tip and confirm the branch
  // runs past the spine-tip depth (worldDepth > 6) without being pruned.
  const ext2 = mergeTreeExtend(ext1, branchRootId, extNodes('f', 6));
  ok(ext2.nodes.length > ext1.nodes.length, 'a second extend keeps growing the branch (continuous extension)');
  const finalChainLen = branchChainLen(ext2, branchRootId);
  // hops from the s2 major to the tip = chain length (root is 1 hop off the major).
  ok(finalChainLen > SPINE_WAYPOINT_COUNT,
    `committed branch runs past the spine tip depth (chain ${finalChainLen} > spine ${SPINE_WAYPOINT_COUNT})`);
  ok(ext2.nodes.length <= MAX_TREE_NODES, `tree stays within the absolute node ceiling (${ext2.nodes.length} <= ${MAX_TREE_NODES})`);

  // The UNCOMMITTED sibling branch (bb1) must NOT have been granted the same
  // freedom — it stays short.
  ok(branchChainLen(ext2, 'bb1') <= 2, 'the uncommitted sibling branch stays short (cap still applies to it)');

  // C: uncommitting a branch must NOT prune its aiBuilt extension — the mapped
  // possibilities survive so they stay a visualization the user can return to.
  const decS2 = ext1.decisions.find((d) => d.nodeId === 's2');
  const unExt = uncommitTreePath(ext1, decS2.id, null);
  const keptExt = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].filter((id) => unExt.nodes.some((n) => n.id === id));
  ok(keptExt.length === 6, `aiBuilt extension survives an uncommit (kept ${keptExt.length}/6, not pruned)`);

  // E: an AI extension may carry ONE critical-choice fork (a decision + two
  // option-root waypoints). mergeTreeExtend must accept it, and the layout must
  // place both sub-branches without overlap.
  const forkExt = {
    nodes: [
      { id: 'g1', parentId: 'tip', depth: 5, pathRole: 'branch', title: 'Chain on', confidence: 4, steps: [{ id: 'g1s', text: 'do a thing', done: false }] },
      { id: 'g2', parentId: 'g1', depth: 6, pathRole: 'branch', title: 'Choice point', confidence: 3, steps: [{ id: 'g2s', text: 'decide', done: false }] },
      { id: 'gA', parentId: 'g2', depth: 7, pathRole: 'branch', title: 'Option A path', confidence: 3, steps: [{ id: 'gAs', text: 'path A step', done: false }] },
      { id: 'gB', parentId: 'g2', depth: 7, pathRole: 'branch', title: 'Option B path', confidence: 3, steps: [{ id: 'gBs', text: 'path B step', done: false }] },
    ],
    decisions: [
      { id: 'gd', nodeId: 'g2', prompt: 'Which way from here?', options: [{ id: 'ga', label: 'A', childNodeId: 'gA' }, { id: 'gb', label: 'B', childNodeId: 'gB' }] },
    ],
  };
  const forked = mergeTreeExtend(committed, branchRootId, forkExt);
  ok(forked.nodes.some((n) => n.id === 'gA') && forked.nodes.some((n) => n.id === 'gB'),
    'extend fork: both option-root waypoints are merged');
  ok(forked.decisions.some((d) => d.nodeId === 'g2' && (d.options || []).length === 2),
    'extend fork: the sub-branch decision is merged onto the new choice waypoint');
  const forkedLayout = FWRoadmapTree.buildLayout(forked);
  assertNoOverlap(forkedLayout, 'extend fork layout');
  assertSpineClearance(forkedLayout, 'extend fork layout');
  ok(['gA', 'gB'].every((id) => forkedLayout.nodes.some((n) => n.id === id)),
    'extend fork: both sub-branches placed on the map');
} else {
  ok(false, 'could not commit a branch on the normalized base tree');
}

// ---- WS-C: uncommit / switch + the fork-is-frontier guard (Session 3) ------
// The commit layer (decisions[].chosenOptionId -> activePath) is reversible only
// while the user is standing at the fork. The guard itself lives in the handler
// (latestCompletedWaypointId === decision.nodeId); here we prove the frontier
// helper reports the right node and uncommitTreePath rewires commit + focus.
// Mark waypoints done the way the app does: all steps done (normalize derives
// node.done from steps via syncNodeDoneFromSteps, so setting node.done alone is
// wiped on the round-trip).
function markDone(tree, ids) {
  const set = new Set(ids);
  return {
    ...tree,
    nodes: tree.nodes.map((n) => (set.has(n.id)
      ? { ...n, done: true, steps: (n.steps || []).map((s) => ({ ...s, done: true })) }
      : n)),
  };
}

if (base) {
  // Commit branch A off s2 and complete the spine up to and including the fork,
  // but nothing on the branch itself — the user is standing at the fork.
  const committedAtFork = normalizeRoadmapTree(markDone(commit(base, 's2', 0), ['s1', 's2']), base);
  ok(committedAtFork, 'committed-at-fork tree normalizes');
  if (committedAtFork) {
    const dc = committedAtFork.decisions.find((d) => d.nodeId === 's2');
    const rootA = dc && (dc.options.find((o) => o.id === dc.chosenOptionId) || {}).childNodeId;
    const optB = dc && (dc.options.find((o) => o.id !== dc.chosenOptionId) || {}).id;
    ok(dc && dc.chosenOptionId, 'branch A is committed (chosenOptionId set)');
    ok(rootA && committedAtFork.activePath.indexOf(rootA) > 0, 'committed activePath follows branch A');
    ok(latestCompletedWaypointId(committedAtFork) === 's2',
      'the fork is the frontier while nothing on the branch is done (guard would allow)');

    // Uncommit → un-choose, fall back to the default spine, focus back to spine.
    const un = uncommitTreePath(committedAtFork, dc.id, null);
    const undc = un.decisions.find((d) => d.id === dc.id);
    ok(undc && !undc.chosenOptionId, 'uncommit clears the chosen option');
    ok(un.activePath.indexOf(rootA) === -1, 'uncommit drops branch A from the active path');
    ok(un.activePath.indexOf('s3') > 0, 'uncommit restores the default spine (s3 back on the path)');
    ok((un.focusTracker || {}).activeBranchKey === 'spine', 'uncommit resets active focus to the spine');

    // Switch → re-choose the sibling option off the same fork.
    if (optB) {
      const sw = uncommitTreePath(committedAtFork, dc.id, optB);
      const swdc = sw.decisions.find((d) => d.id === dc.id);
      ok(swdc && swdc.chosenOptionId === optB, 'switch re-chooses the sibling option off the same fork');
      ok(sw.activePath.indexOf(rootA) === -1, 'switch drops the old branch from the active path');
      ok((sw.focusTracker || {}).activeBranchKey && sw.focusTracker.activeBranchKey !== 'spine',
        'switch moves active focus onto the new branch');
    } else {
      ok(false, 'expected a sibling option to switch to on the s2 fork');
    }

    // Guard input: complete branch A's root and the frontier moves PAST the fork,
    // so latestCompletedWaypointId no longer equals it — the handler blocks any
    // path change so the user cannot rewrite progress they have already made.
    const progressed = normalizeRoadmapTree(markDone(commit(base, 's2', 0), ['s1', 's2', rootA]), base);
    ok(progressed && latestCompletedWaypointId(progressed) === rootA,
      'once a branch waypoint is done, the frontier is the branch node, not the fork');
    ok(progressed && latestCompletedWaypointId(progressed) !== 's2',
      'the fork is no longer the frontier after branch progress (guard would block)');
  }
}

console.log(fails ? `\nroadmap:layout FAIL — ${fails} assertion(s)` : '\nroadmap:layout PASS');
process.exit(fails ? 1 : 0);
