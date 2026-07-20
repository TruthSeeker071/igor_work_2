// Vector pipeline invariants (run: npm run test:vectors)
// Harness: load real client modules with browser stubs and verify
// (1) hydrateQuizVectors is idempotent (stable updatedAt / object identity)
// (2) persistQuizVectors skips events when nothing changed
// (3) quizPayloadHash changes when refine/academics/vectors change

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');

// --- browser stubs ---
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
let dispatched = [];
global.window = global;
global.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
global.dispatchEvent = (e) => { dispatched.push(e.type); };
global.addEventListener = () => {};
global.fetch = () => Promise.reject(new Error('no network in test'));
// leave global.document undefined so boot hooks are skipped

function load(rel) {
  const code = fs.readFileSync(path.join(REPO, rel), 'utf8');
  // eslint-disable-next-line no-eval
  eval(code);
}

load('assets/js/shared/onet-math.js');
load('assets/js/shared/academics-map.js');
load('assets/js/shared/refine-map.js');
load('assets/js/shared/user.js'); // onet-vectors reads/writes storage via FWUser's blob view
load('assets/js/shared/onet-vectors.js');

const V = global.FWOnetVectors;
const DIM = V.DIM;

function seedQuiz() {
  const values = new Array(DIM).fill(0);
  for (let i = 0; i < DIM; i++) values[i] = (i * 7) % 100;
  return {
    scores: { tech: 80, finance: 60 },
    personalityVector: {
      schemaId: V.SCHEMA, values, confidence: new Array(DIM).fill('quiz-anchored'),
      updatedAt: '2026-07-01T00:00:00.000Z', source: 'quiz-seed',
    },
    refine: { hours: 60, creative: 40 },
    academics: { gpa: 3.8, major: 'computer science math', liked: 'statistics programming' },
    resumeText: 'Software engineering intern building python trading systems; '
      + 'financial analysis, statistics, machine learning, portfolio research projects.',
  };
}

let fail = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS', msg); } else { fail++; console.error('  FAIL', msg); }
}

// --- (1) idempotency across repeated hydrations (simulates page boots) ---
console.log('idempotent hydration:');
let quiz = seedQuiz();
quiz = V.hydrateQuizVectors(quiz, {});
const p1 = quiz.personalityVector, o1 = quiz.objectiveVector;
// second boot: fresh parse of the persisted JSON (new object identities)
let quiz2 = JSON.parse(JSON.stringify(quiz));
quiz2 = V.hydrateQuizVectors(quiz2, {});
assert(quiz2.personalityVector.updatedAt === p1.updatedAt, 'personality updatedAt stable across boots');
assert(quiz2.objectiveVector.updatedAt === o1.updatedAt, 'objective updatedAt stable across boots');
const p2vals = quiz2.personalityVector.values, p1vals = p1.values;
assert(p1vals.every((v, i) => v === p2vals[i]), 'personality values stable across boots');

// third boot to confirm steady state
let quiz3 = JSON.parse(JSON.stringify(quiz2));
quiz3 = V.hydrateQuizVectors(quiz3, {});
assert(quiz3.personalityVector.updatedAt === p1.updatedAt, 'personality updatedAt stable on 3rd boot');
assert(quiz3.objectiveVector.updatedAt === o1.updatedAt, 'objective updatedAt stable on 3rd boot');

// --- (1c) legacy-schema migration: corrupt / mismatched vectors get reseeded ---
console.log('legacy-schema migration:');
// A saturated all-100 personality vector is corrupt legacy data → dropped & reseeded.
let legacy = seedQuiz();
legacy.personalityVector = {
  schemaId: V.SCHEMA, values: new Array(DIM).fill(100),
  confidence: new Array(DIM).fill('quiz-anchored'), updatedAt: '2026-01-01T00:00:00.000Z', source: 'legacy',
};
legacy = V.hydrateQuizVectors(legacy, {});
assert(!legacy.personalityVector.values.every((v) => v >= 99.5),
  'saturated all-100 personality vector is reseeded, not left flat');

// A vector from an older schema (wrong dimension count) must not crash hydration.
let wrongLen = seedQuiz();
wrongLen.personalityVector = { schemaId: 'onet-lv-old', values: new Array(40).fill(50) };
let threw = false;
try { wrongLen = V.hydrateQuizVectors(wrongLen, {}); } catch (_) { threw = true; }
assert(!threw, 'wrong-length legacy vector does not crash hydration');
assert(wrongLen.personalityVector.values.length === DIM, 'reseeded personality has current DIM length');

// A bare legacy payload gets newly-expected keys initialized (no undefined-map crashes).
let bare = { scores: { tech: 50 } };
bare = V.hydrateQuizVectors(bare, {});
assert(Array.isArray(bare.careerFocusHistory), 'careerFocusHistory initialized for legacy payload');
assert(bare.academics && typeof bare.academics === 'object', 'academics initialized for legacy payload');

// --- (1b) objective AI patch replay survives rebuilds ---
console.log('objective AI patch replay:');
let pq = seedQuiz();
pq.objectiveAiPatch = {
  dimensions: [{ index: 21, value: 88 }, { index: 4, value: 75 }],
  source: 'resume',
  updatedAt: '2026-07-02T00:00:00.000Z',
};
pq = V.hydrateQuizVectors(pq, {});
assert(pq.objectiveVector.values[21] === 88 && pq.objectiveVector.values[4] === 75,
  'patch values present after hydrate');
assert(pq.objectiveVector.sources[21] === 'ai-patch', 'patched dims tagged ai-patch');
let pq2 = JSON.parse(JSON.stringify(pq));
pq2 = V.hydrateQuizVectors(pq2, {});
assert(pq2.objectiveVector.values[21] === 88, 'patch survives second boot');
assert(pq2.objectiveVector.updatedAt === pq.objectiveVector.updatedAt,
  'patched objective updatedAt stable across boots');

// --- (2) persistQuizVectors event behavior ---
console.log('persist event dispatch:');
dispatched = [];
V.persistQuizVectors(JSON.parse(JSON.stringify(quiz3)), { sync: false });
assert(dispatched.length === 0, 'no events when vectors unchanged (' + JSON.stringify(dispatched) + ')');

dispatched = [];
const changed = JSON.parse(JSON.stringify(quiz3));
changed.refine = { hours: 10, creative: 90, social: 100 };
V.persistQuizVectors(changed, { sync: false });
assert(dispatched.includes('fw-objective-updated') && dispatched.includes('fw-personality-updated'),
  'events fire when refine actually changes vectors');

// changed vectors must get a fresh updatedAt
assert(changed.personalityVector.updatedAt !== p1.updatedAt, 'changed personality gets new updatedAt');

// --- (2b) fitForSlugOrSoc returns the blended hub formula ---
console.log('fitForSlugOrSoc blend:');
(async () => {
  const SOC = '99-9999.99';
  const careerVec = new Array(DIM).fill(0).map((_, i) => ((i * 13) % 100));
  global.fetch = (url, opts) => {
    if (String(url).includes('/onet/vectors')) {
      return Promise.resolve({ json: async () => ({ vectors: { [SOC]: careerVec } }) });
    }
    return Promise.reject(new Error('no network in test'));
  };
  const q = global.FWUser.getBlob(); // v1 view over the stored (v2) user
  const fit = await V.fitForSlugOrSoc(null, SOC, null);
  assert(fit && fit.vector === true, 'vector fit resolved');
  const M = global.FWOnetMath;
  const expectedP = M.cosinePercent(M.cosine(q.personalityVector.values, careerVec));
  const expectedO = M.objectiveFitPercent(q.objectiveVector.values, careerVec);
  const expected = V.overallFitScore(expectedP, expectedO);
  assert(fit.personalityFit === expectedP, 'personality component matches hub math');
  assert(fit.objectiveFit === expectedO, 'objective component matches hub math');
  assert(fit.percent === expected, `percent is blended overallFitScore (${fit.percent} vs ${expected})`);

  // --- (4) Objective-Vector Stretch Surfacing ---
  console.log('stretch-fit candidates:');
  const Mm = global.FWOnetMath;
  const block = (lo, hi, val) => {
    const v = new Array(DIM).fill(0);
    for (let i = lo; i < hi; i++) v[i] = val;
    return v;
  };
  // Personality strong in dims [0,80); objective strong in [80,160). These
  // subspaces are orthogonal so component fits are fully controllable.
  const persoVals = block(0, 80, 90);
  const objVals = block(80, 160, 90);
  // 13 personality-magnet careers (overall ~75) fill the top ranks.
  const magnetVec = block(0, 80, 80);
  // One stretch career: high objective fit, moderate personality fit → overall
  // ~42, so it lands well outside the top 12.
  const stretchVec = new Array(DIM).fill(0);
  for (let i = 0; i < DIM; i++) stretchVec[i] = (i >= 80 && i < 160) ? 90 : (i < 40 ? 45 : 0);

  const rows = [];
  const vecMap = {};
  for (let i = 0; i < 13; i++) {
    const soc = `10-000${i}.00`;
    rows.push({ soc, title: `Magnet ${i}` });
    vecMap[soc] = magnetVec;
  }
  const STRETCH_SOC = '99-1111.11';
  rows.push({ soc: STRETCH_SOC, title: 'Stretch Career' });
  vecMap[STRETCH_SOC] = stretchVec;

  // Mock the catalog + vector + registry fetch used by the ranking pipeline.
  global.FWOnetCatalog = {
    load: () => Promise.resolve(rows),
    canonicalSlugForRow: (r) => String(r.title).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    slugify: (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  };
  const registry = { dimensions: [] };
  for (let i = 0; i < DIM; i++) registry.dimensions.push({ index: i, name: `Dim ${i}` });
  global.fetch = (url) => {
    if (String(url).includes('/onet/vectors')) {
      return Promise.resolve({ json: async () => ({ vectors: vecMap }) });
    }
    if (String(url).includes('dimension-registry')) {
      return Promise.resolve({ ok: true, json: async () => registry });
    }
    return Promise.reject(new Error('no network in test'));
  };

  // Persist a quiz blob with an explicit personality vector (preserved by
  // hydration) and the objective vector injected via objectiveAiPatch — the
  // only route that survives the objective rebuild (hydration otherwise
  // reconstructs objective purely from academics/resume/patch).
  const objPatchDims = [];
  for (let i = 80; i < 160; i++) objPatchDims.push({ index: i, value: objVals[i] });
  const stretchQuiz = {
    personalityVector: {
      schemaId: V.SCHEMA, values: persoVals, confidence: new Array(DIM).fill('quiz-anchored'),
      updatedAt: '2026-07-01T00:00:00.000Z', source: 'quiz-seed',
    },
    objectiveAiPatch: {
      dimensions: objPatchDims, source: 'resume', updatedAt: '2026-07-02T00:00:00.000Z',
    },
  };
  global.FWUser.putBlob(stretchQuiz);
  V.clearRankedCache();

  const candidates = await V.stretchFitCandidates({ limit: 3 });
  assert(Array.isArray(candidates) && candidates.length === 1, 'exactly one stretch candidate surfaced');
  const sc = candidates[0];
  assert(sc && sc.soc === STRETCH_SOC, 'stretch candidate is the objective-dominant career');
  assert(sc.objectiveFit >= 72, `objectiveFit >= 72 threshold honored (${sc.objectiveFit})`);
  assert(sc.objectiveFit >= sc.personalityFit + 12, `objective exceeds personality by >=12 (${sc.objectiveFit} vs ${sc.personalityFit})`);
  // The 13 magnets outrank it by overall score, so it must be excluded from the top 12.
  const fullRank = await V.rankOnetCareersFromVectors({ limit: 782 });
  const topSocs = fullRank.slice(0, 12).map((e) => e.soc);
  assert(topSocs.indexOf(STRETCH_SOC) === -1, 'stretch candidate is NOT in the top 12 by overall');
  assert(Array.isArray(sc.drivers) && sc.drivers.length === 3, 'candidate carries top 3 drivers');
  assert(sc.drivers.every((d) => d && d.name && d.user != null && d.target != null),
    'each driver has name/user/target');

  // Objective inactive (no academics/resume/patch) → no candidates.
  const inactiveQuiz = JSON.parse(JSON.stringify(stretchQuiz));
  delete inactiveQuiz.objectiveAiPatch;
  global.FWUser.putBlob(inactiveQuiz);
  V.clearRankedCache();
  const none = await V.stretchFitCandidates({ limit: 3 });
  assert(Array.isArray(none) && none.length === 0, 'no candidates when objective vector inactive');

  // --- vBase invariant: the gap-progress patch base must survive the server
  // save/normalize round-trip (a dropped vBase would re-base patches on the
  // live, already-patched user value and compound them).
  console.log('vBase round-trip (normalizeRoadmapTree):');
  const RT = await import('../functions/_lib/roadmap-tree.js');
  const mkNode = (id, parentId, depth) => ({
    id, parentId, depth, type: 'waypoint', pathRole: 'spine',
    shortTitle: 'Do ' + id, title: 'Do ' + id, confidence: 4,
    steps: [{ id: id + '-st1', text: 'step', done: false }],
  });
  const vTree = {
    version: 2, targetCareerSlug: 'test-career', targetCareerName: 'Test Career',
    summary: 'x', trunk: { id: 'trunk', title: 'Now', confidence: 5 },
    nodes: [mkNode('s1', 'trunk', 1), mkNode('s2', 's1', 2)],
    decisions: [], activePath: ['trunk', 's1', 's2'],
    focusTracker: {
      version: 3, waypointId: 's1', updatedAt: '2026-07-09T00:00:00.000Z',
      skillGaps: [
        { id: 'dim-5', dimIndex: 5, label: 'Programming', domain: 'skills', user: 50, vBase: 30, target: 80, gap: 30, source: 'coordinate', checklist: [], checklistSource: 'fast', logs: [], manualComplete: false, status: 'open', progress: 0 },
        { id: 'dim-7', dimIndex: 7, label: 'Writing', domain: 'skills', user: 40, target: 70, gap: 30, source: 'coordinate', checklist: [], checklistSource: 'fast', logs: [], manualComplete: false, status: 'open', progress: 0 },
      ],
    },
  };
  const vNorm = RT.normalizeRoadmapTree(vTree, vTree);
  assert(!!vNorm, 'v3 tree normalizes');
  const vGaps = (vNorm && vNorm.focusTracker && vNorm.focusTracker.skillGaps) || [];
  const g5 = vGaps.find((g) => g.dimIndex === 5);
  const g7 = vGaps.find((g) => g.dimIndex === 7);
  assert(g5 && g5.vBase === 30, 'explicit vBase preserved through normalize');
  assert(g7 && g7.vBase === 40, 'missing vBase defaults to user value');

  // semesterPlan + evidence-weight round-trip (new persisted fields)
  console.log('semesterPlan + log weight round-trip:');
  const pTree = JSON.parse(JSON.stringify(vTree));
  pTree.nodes[0].semesterPlan = {
    sig: 'abc123',
    plan: { overview: 'sem', phases: [{ title: 'P1', weeks: 'Weeks 1-3', items: [{ text: 'do x' }] }] },
    generatedAt: '2026-07-09T00:00:00.000Z',
  };
  pTree.focusTracker.skillGaps[0].logs = [
    { id: 'log-1', text: 'Built a Monte Carlo simulator project', at: '2026-07-09T00:00:00.000Z', w: 7 },
    { id: 'log-2', text: 'read a bit', at: '2026-07-09T00:00:00.000Z' },
  ];
  const pNorm = RT.normalizeRoadmapTree(pTree, pTree);
  const pNode = pNorm.nodes.find((n) => n.id === 's1');
  assert(pNode && pNode.semesterPlan && pNode.semesterPlan.sig === 'abc123'
    && pNode.semesterPlan.plan.phases.length === 1, 'semesterPlan survives normalize round-trip');
  const pGap = pNorm.focusTracker.skillGaps.find((g) => g.dimIndex === 5);
  assert(pGap && pGap.logs[0].w === 7, 'log evidence weight w survives normalize');
  assert(pGap && pGap.logs[1].w === undefined, 'weightless legacy log stays weightless');

  process.exit(fail ? 1 : 0);
})();

// --- (3) quizPayloadHash sensitivity (auth.js) ---
console.log('quizPayloadHash coverage:');
global.FWSectorFitSheet = undefined;
load('assets/js/shared/auth.js');
// quizPayloadHash is private; probe via uploadLocalQuizIfPresent? Not callable offline.
// Instead re-extract the function body by evaluating the file was done above; test via known export?
// FWAuth doesn't export quizPayloadHash — verify indirectly by regex that the fields are present.
const authSrc = fs.readFileSync(path.join(REPO, 'assets/js/shared/auth.js'), 'utf8');
for (const field of ['refine:', 'academics:', 'personalityVecAt', 'objectiveVecAt', 'focus:']) {
  const inHash = authSrc.slice(authSrc.indexOf('function quizPayloadHash'), authSrc.indexOf('function portalSnapshotIsStale'));
  assert(inHash.includes(field), 'quizPayloadHash includes ' + field);
}
const mergeBlock = authSrc.slice(authSrc.indexOf('async function doUpload'), authSrc.indexOf('lastUploadedQuizHash = quizPayloadHash'));
assert(mergeBlock.includes('mergeVectorInputs'), 'upload merge includes mergeVectorInputs');
assert(mergeBlock.includes('mergeCareerFocus'), 'upload merge includes mergeCareerFocus');
// (final exit happens in the async fitForSlugOrSoc block above)
