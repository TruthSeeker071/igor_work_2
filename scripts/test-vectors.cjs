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
  const q = JSON.parse(global.localStorage.getItem('fw_hub_quiz_v1'));
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
  global.localStorage.setItem('fw_hub_quiz_v1', JSON.stringify(stretchQuiz));
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
  global.localStorage.setItem('fw_hub_quiz_v1', JSON.stringify(inactiveQuiz));
  V.clearRankedCache();
  const none = await V.stretchFitCandidates({ limit: 3 });
  assert(Array.isArray(none) && none.length === 0, 'no candidates when objective vector inactive');

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

// --- (5) FW2.0 A1 — fitContributions invariants (why-this-match) ---
// Synchronous; runs before the async block's process.exit and shares `fail`.
console.log('fitContributions (A1):');
(function () {
  const M = global.FWOnetMath;
  const D = M.DIM;
  const u = new Array(D).fill(0);
  const c = new Array(D).fill(0);
  for (let i = 0; i < D; i++) { u[i] = (i % 10) * 5; c[i] = ((i * 3) % 10) * 6; } // non-negative scores
  const all = M.fitContributions(u, c, D);
  let ordered = true;
  for (let i = 1; i < all.length; i++) if (all[i].product > all[i - 1].product + 1e-9) ordered = false;
  assert(ordered, 'contributions sorted by product desc');
  const cos = M.cosine(u, c);
  const sumContrib = all.reduce((s, r) => s + r.contribution, 0);
  assert(Math.abs(sumContrib - cos) < 1e-6, 'Σcontribution ≈ cosine (' + sumContrib.toFixed(5) + ' vs ' + cos.toFixed(5) + ')');
  const sumShare = all.reduce((s, r) => s + r.share, 0);
  assert(Math.abs(sumShare - 1) < 1e-6, 'Σshare ≈ 1 (' + sumShare.toFixed(5) + ')');
  const top3 = M.fitContributions(u, c, 3);
  assert(top3.length === 3, 'k=3 returns 3 rows');
  assert(top3[0].product >= top3[1].product && top3[1].product >= top3[2].product, 'top-3 internally ordered');
  assert(top3[0].product === all[0].product, 'top contributor matches full ranking');
  const labels = new Array(D).fill(null).map((_, i) => 'Dim ' + i);
  const labeled = M.fitContributions(u, c, 2, labels);
  assert(labeled[0].label === 'Dim ' + labeled[0].index, 'labels threaded by index');
  assert(M.fitContributions(null, c, 3).length === 0, 'null user vector → []');
  assert(M.fitContributions(new Array(D).fill(0), c, 3).length === 0, 'zero user vector → []');
})();
// (final exit happens in the async fitForSlugOrSoc block above)
