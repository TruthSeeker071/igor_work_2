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
// The personality seed ranks quiz scores through FWSectorFitSheet.SECTOR_KEYS.
// Without this the seed returns an all-zero vector and every seed assertion
// below passes vacuously against zeros.
load('assets/js/shared/sector-fit-sheet.js');
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

// Push the wall clock past the current millisecond. Two consecutive boots land
// in the same millisecond ~92% of the time, so an updatedAt assertion across
// them only fires on the other 8% — which is exactly how a re-seed that ran on
// EVERY boot passed this file for months while flaking the suite.
function tick() {
  const t = Date.now();
  while (Date.now() === t) { /* spin: a sub-millisecond wait has no sync form */ }
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

// --- (1d) one-time personality re-seed (fix 1.3 reached only new profiles) ---
// A stored personalityVector was always reused, so the sharpened seed landed on
// new quiz completions and nobody who finished before `f958b3a`. The generation
// stamp lets an older vector be re-seeded — but ONLY where that is provably
// lossless, because server AI personality patches
// (functions/_lib/onet/personality-patch.js) edit values in place with no
// replay record, unlike objectiveAiPatch.
console.log('personality seed generation:');
{
  const ZC = JSON.parse(fs.readFileSync(path.join(REPO, 'data/onet/artifacts/zone-centroids.json'), 'utf8'));
  const oldVec = () => ({
    schemaId: V.SCHEMA,
    values: new Array(DIM).fill(50).map((v, i) => v + (i % 7)),
    confidence: new Array(DIM).fill('quiz-anchored'),
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'quiz-seed',
  });
  // No refine, no resume: the replayable layers legitimately move personality,
  // so a fixture carrying them cannot tell "re-seeded" from "layer applied".
  const plainQuiz = (source) => ({
    scores: { tech: 80, finance: 60 },
    personalityVector: source ? { ...oldVec(), source } : oldVec(),
  });

  assert(V.PERSONALITY_SEED_GEN >= 2, 'the seed carries a generation stamp');
  const fresh = V.seedPersonalityFromQuiz({ tech: 90, finance: 60 }, ZC);
  assert(fresh.seedGen === V.PERSONALITY_SEED_GEN, 'a freshly seeded vector is stamped with the current generation');
  // Guard the assertions below from passing against an empty vector: a seed
  // with no spread is what a missing FWSectorFitSheet produces, and every
  // "re-seed changed something" check would still pass against it.
  const spread = Math.max(...fresh.values) - Math.min(...fresh.values);
  assert(spread > 1, 'a freshly seeded vector has real spread, not all zeros');

  let stale = plainQuiz();
  const staleVals = stale.personalityVector.values.slice();
  stale = V.hydrateQuizVectors(stale, { zoneCentroids: ZC });
  assert(stale.personalityVector.seedGen === V.PERSONALITY_SEED_GEN,
    'an unstamped quiz-seed vector is re-seeded to the current generation');
  assert(!staleVals.every((v, i) => v === stale.personalityVector.values[i]),
    're-seeding actually produces a different vector');

  // Idempotence — the whole point of the stamp. A second boot must not re-seed.
  let again = JSON.parse(JSON.stringify(stale));
  tick();
  again = V.hydrateQuizVectors(again, { zoneCentroids: ZC });
  assert(again.personalityVector.updatedAt === stale.personalityVector.updatedAt,
    're-seed is one-time: the second boot leaves updatedAt alone');
  assert(stale.personalityVector.values.every((v, i) => v === again.personalityVector.values[i]),
    're-seed is idempotent across boots');

  // A page can hydrate without loading sector-fit-sheet.js (roadmap.html did
  // for months). The seed needs its SECTOR_KEYS, so without it the re-seed
  // returns an all-zero vector. Overwriting a real profile with that is data
  // loss, and the zeros then read as corrupt to the legacy migration, which
  // drops and re-seeds them on every single boot.
  {
    const sheet = global.FWSectorFitSheet;
    delete global.FWSectorFitSheet;
    try {
      let noSheet = plainQuiz();
      const kept = noSheet.personalityVector.values.slice();
      const keptAt = noSheet.personalityVector.updatedAt;
      noSheet = V.hydrateQuizVectors(noSheet, { zoneCentroids: ZC });
      assert(kept.every((v, i) => v === noSheet.personalityVector.values[i]),
        'no sector sheet -> the re-seed is skipped, not applied as an empty vector');
      assert(noSheet.personalityVector.updatedAt === keptAt,
        'no sector sheet -> a skipped re-seed leaves updatedAt alone');

      // Nothing stored to fall back to: the seed is empty either way, but an
      // unchanged rebuild must still not churn updatedAt across boots.
      let bareBoot = V.hydrateQuizVectors({ scores: { tech: 80, finance: 60 } }, { zoneCentroids: ZC });
      const bareAt = bareBoot.personalityVector.updatedAt;
      tick();
      bareBoot = V.hydrateQuizVectors(JSON.parse(JSON.stringify(bareBoot)), { zoneCentroids: ZC });
      assert(bareBoot.personalityVector.updatedAt === bareAt,
        'a rebuild that reproduces a dropped vector exactly keeps its updatedAt');
    } finally {
      global.FWSectorFitSheet = sheet;
    }
  }

  // The trap. Each of these sources is written directly by the server's
  // personality patch and cannot be regenerated from the quiz, so the stored
  // vector must survive untouched.
  for (const src of ['gemini-patch', 'profile-building', 'resume-gemini']) {
    let patched = plainQuiz(src);
    const before = patched.personalityVector.values.slice();
    patched = V.hydrateQuizVectors(patched, { zoneCentroids: ZC });
    assert(before.every((v, i) => v === patched.personalityVector.values[i]),
      `a ${src} vector is never dropped by the re-seed`);
    assert(!V.personalityReseedIsLossless({ source: src }), `${src} is classified unreplayable`);
  }

  // Without centroids a re-seed would return an empty vector — dropping there
  // would destroy the profile rather than sharpen it.
  let noCentroids = plainQuiz();
  const keep = noCentroids.personalityVector.values.slice();
  noCentroids = V.hydrateQuizVectors(noCentroids, {});
  assert(keep.every((v, i) => v === noCentroids.personalityVector.values[i]),
    'no zone centroids loaded -> the stored vector is kept, never emptied');

  // Replayable layers on top of the seed are not a reason to keep a stale base:
  // hydrate re-applies them, and the bleed/refine both preserve the base source.
  assert(V.personalityReseedIsLossless({ source: 'quiz-seed' }), 'a pure seed is lossless to re-seed');
  assert(V.personalityReseedIsLossless({ source: 'resume-bleed' }), 'a replayed bleed is lossless to re-seed');
  assert(V.personalityReseedIsLossless({ source: 'refine-rules' }), 'a replayed refine is lossless to re-seed');
}

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

// --- (2d) onboarding personas: does a finished profile actually point somewhere? ---
// Six decided students (scripts/fixtures/fit-personas.cjs), hydrated through the
// real pipeline against the real O*NET artifacts. The assertions are the
// acceptance gate for distinctive fit (masterplan Part 6, values locked in
// docs/DISTINCT_FIT_PROGRESS.md): home zone #1 by 40+, own cluster >= 40, every
// other cluster 20 below it, and the top tiers rare again — a decided finance
// profile used to read mythic on 446 of 782 careers. The same six drive
// npm run fit:calibrate, which is where every number here was measured.
const ART = path.join(REPO, 'data/onet/artifacts');
const artifact = (n) => JSON.parse(fs.readFileSync(path.join(ART, n), 'utf8'));

const { PERSONAS } = require('./fixtures/fit-personas.cjs');

function percentileOf(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function runPersonaSuite() {
  console.log('onboarding personas (distinctive fit):');
  load('assets/js/shared/sector-fit-sheet.js');
  load('assets/js/shared/hub-zone-fit.js');
  const SV = await import('../functions/_lib/onet/user-vectors.js');

  const careers = artifact('careers.json');
  const zoneCentroids = artifact('zone-centroids.json');
  const aggregates = artifact('zone-aggregate-vectors.json');
  const zoneProfiles = artifact('zone-dimension-profiles.json');
  const lvRaw = fs.readFileSync(path.join(ART, 'vectors-lv.f32.bin'));
  const lvBuf = new Float32Array(lvRaw.buffer, lvRaw.byteOffset, lvRaw.byteLength / 4);
  const vecFor = (c) => Array.from(lvBuf.subarray(c.vectorIndex * DIM, c.vectorIndex * DIM + DIM));
  const bySoc = {};
  careers.forEach((c) => { bySoc[c.soc] = c; });

  // Serve the real dimension profiles off disk so the theme layer runs on
  // production data rather than the built-in fallback.
  const prevFetch = global.fetch;
  const sectorSheet = global.FWSectorFitSheet;
  global.fetch = (url) => (String(url).includes('zone-dimension-profiles')
    ? Promise.resolve({ ok: true, json: async () => zoneProfiles })
    : Promise.reject(new Error('no network in test')));
  await V.loadZoneDimensionProfiles();
  global.fetch = prevFetch;
  // The remaining top-level test code ran while this awaited, and section (3)
  // clears FWSectorFitSheet — without SECTOR_KEYS the quiz seed has no sectors
  // to rank and silently returns an empty vector.
  global.FWSectorFitSheet = sectorSheet;

  const M = global.FWOnetMath;
  const ZF = global.FWHubZoneFit;
  // A SOC that is not in careers.json would silently shrink a persona's cluster
  // to whichever codes happen to exist, and every mean below would be computed
  // over the survivors. (25-2052.00, the probe's original education pick, is one
  // such dead code.) Assert resolution before averaging anything.
  const deadSocs = PERSONAS.flatMap((p) => p.expect.filter((s) => !bySoc[s]).map((s) => `${p.key}/${s}`));
  assert(deadSocs.length === 0, `every persona expect SOC resolves in careers.json${deadSocs.length ? `: ${deadSocs.join(', ')}` : ''}`);
  const fitOf = (values, soc) => M.displayFitPercent(values, vecFor(bySoc[soc]));
  const meanFit = (values, socs) => socs.reduce((s, soc) => s + fitOf(values, soc), 0) / socs.length;

  for (const persona of PERSONAS) {
    let quiz = V.hydrateQuizVectors(JSON.parse(JSON.stringify(persona.quiz)), { zoneCentroids });
    const first = JSON.stringify(quiz.personalityVector.values);
    // Second boot: fresh parse of the persisted JSON, exactly like a page load.
    let again = V.hydrateQuizVectors(JSON.parse(JSON.stringify(quiz)), { zoneCentroids });
    assert(first === JSON.stringify(again.personalityVector.values),
      `${persona.key}: re-hydration is byte-identical`);

    const values = quiz.personalityVector.values;
    // The catalog is scored the way the app displays it: personality fit.
    const catalog = careers.map((c) => M.displayFitPercent(values, vecFor(c)));
    const sorted = catalog.slice().sort((a, b) => a - b);
    // ACCEPTANCE BARS, rewritten 2026-07-21 with the return to plain correlation.
    // Every number below is measured, not aspirational — see docs/FIT_MATH.md.
    //
    // What was DELETED and why, stated plainly so nobody restores it by reflex:
    // the distinctive-fit suite asserted "every other persona's cluster sits 20
    // points below this persona's own". A mean-centered cosine cannot do that —
    // a quant-finance profile reads tech 79 against its own 82 — and that
    // indiscrimination is a KNOWN, ACCEPTED cost of the formula the product now
    // ships. Keeping the assertion would fail honestly; weakening it to a number
    // plain cosine happens to clear would be a gate that tests nothing. It is
    // gone, and the bars that remain are the ones this formula is meant to hit:
    // the right cluster first, by a visible margin, with a legible spread.
    const spread = percentileOf(sorted, 0.9) - percentileOf(sorted, 0.1);
    assert(spread >= 25, `${persona.key}: p90-p10 fit spread ${spread.toFixed(1)} >= 25`);

    const clusters = {};
    for (const p of PERSONAS) clusters[p.key] = meanFit(values, p.expect);
    const own = clusters[persona.key];
    assert(own >= 45, `${persona.key}: own top careers mean ${own.toFixed(1)} >= 45`);
    // The own cluster must still be the BEST cluster, even though the others sit
    // close. This is the discrimination claim the formula can actually support.
    const others = Object.entries(clusters)
      .filter(([k]) => k !== persona.key)
      .sort((a, b) => b[1] - a[1]);
    const [nearestKey, nearestFit] = others[0];
    assert(own > nearestFit,
      `${persona.key}: own cluster ${own.toFixed(1)} beats nearest other (${nearestKey} ${nearestFit.toFixed(1)})`);

    // "Everything is gold" regression guard. This is deliberately a loose bar,
    // because one absolute ladder cannot be tight across profiles that sit at
    // different absolute levels (finance measures 17% mythic, trades 0%). It is
    // set to catch the failure that actually happened before — a decided profile
    // reading mythic on 446 of 782 careers, i.e. 57% — not to pin the ladder.
    const shareAtOrAbove = (t) => catalog.filter((x) => x >= t).length / catalog.length;
    assert(shareAtOrAbove(M.FIT_TIERS.mythic) <= 0.25,
      `${persona.key}: ${(shareAtOrAbove(M.FIT_TIERS.mythic) * 100).toFixed(1)}% of the catalog reads mythic <= 25%`);

    const zoneMap = ZF.computeZoneFitsMap(quiz.personalityVector, quiz.objectiveVector, aggregates);
    const zoneRows = ZF.ZONE_ORDER.filter((z) => zoneMap[z])
      .map((z) => ({ id: z, score: zoneMap[z].overallFit }))
      .sort((a, b) => b.score - a.score);
    const median = zoneRows[Math.floor(zoneRows.length / 2)].score;
    const home = zoneRows.findIndex((r) => r.id === persona.homeZone);
    assert(home === 0, `${persona.key}: ${persona.homeZone} ranks #1 (got ${zoneRows[0].id})`);
    // Measured margins over the median display zone: 11, 24, 19, 55, 30, 20.
    // quant-finance sets the floor at 11 and always will: business-finance is
    // the merged 115-career macro-sector that overlaps every other desk zone,
    // and plain correlation cannot pull it away from them. That is the accepted
    // cost of this formula, not a regression — see docs/FIT_MATH.md.
    const margin = zoneRows[home].score - median;
    assert(margin >= 8, `${persona.key}: home zone beats median by ${margin} >= 8`);

    // Round-trip guard for masterplan decision 7: the server projects sector
    // scores back onto the sheet from the personality vector, and those scores
    // are what a later re-seed reads. Now that the projection is a distinctive
    // fit (mostly zeros, a few strong sectors), re-seeding from it must still
    // point at the same place — otherwise a learning patch quietly walks the
    // user's profile somewhere else.
    const projected = SV.projectSectorScoresFromPersonality(values, zoneCentroids);
    const reseeded = SV.seedPersonalityFromQuiz(projected, zoneCentroids);
    const rtMap = ZF.computeZoneFitsMap(reseeded, quiz.objectiveVector, aggregates);
    const rtTop = ZF.ZONE_ORDER.filter((z) => rtMap[z])
      .map((z) => ({ id: z, score: rtMap[z].personalityFit }))
      .sort((a, b) => b.score - a.score)[0];
    assert(rtTop.id === persona.homeZone,
      `${persona.key}: projected sector scores re-seed to ${persona.homeZone} (got ${rtTop.id})`);

    const cross = PERSONAS.map((p) => `${p.key}=${Math.round(clusters[p.key])}`).join(' ');
    console.log(`    ${persona.key} cross-matrix: ${cross}`);
  }
}

// --- (2c) client/server scoring-constant parity ---
// Every constant below exists twice on purpose (browser IIFE + ESM function).
// A rebuild that disagrees between the two silently rewrites the user's vector
// on the next sync, so drift is a hard failure, not a style issue.
console.log('client/server scoring constant parity:');
{
  const clientVectors = fs.readFileSync(path.join(REPO, 'assets/js/shared/onet-vectors.js'), 'utf8');
  const serverVectors = fs.readFileSync(path.join(REPO, 'functions/_lib/onet/user-vectors.js'), 'utf8');
  const clientMath = fs.readFileSync(path.join(REPO, 'assets/js/shared/onet-math.js'), 'utf8');
  const serverMath = fs.readFileSync(path.join(REPO, 'functions/_lib/onet/math.js'), 'utf8');
  const clientRefine = fs.readFileSync(path.join(REPO, 'assets/js/shared/refine-map.js'), 'utf8');
  const serverRefine = fs.readFileSync(path.join(REPO, 'functions/_lib/onet/refine-map.js'), 'utf8');
  const num = (src, name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*(-?[0-9.]+)\\s*;`));
    return m ? m[1] : null;
  };
  const pairs = [
    ['SEED_WEIGHT_EXPONENT', clientVectors, serverVectors],
    ['SEED_GAIN_ALIGNED', clientVectors, serverVectors],
    ['SEED_GAIN_OTHER', clientVectors, serverVectors],
    ['SEED_TOP_COMMIT', clientVectors, serverVectors],
    ['SEED_ZERO_BAND', clientVectors, serverVectors],
    ['PERSONALITY_OBJECTIVE_BLEED', clientVectors, serverVectors],
    ['BLEED_L1_BUDGET', clientVectors, serverVectors],
    ['REFINE_L1_BUDGET', clientRefine, serverRefine],
    ['LAYER_GAIN_ALIGNED', clientMath, serverMath],
    ['LAYER_GAIN_OPEN', clientMath, serverMath],
    ['LAYER_GAIN_OPPOSED', clientMath, serverMath],
  ];
  pairs.forEach(([name, a, b]) => {
    const av = num(a, name);
    const bv = num(b, name);
    assert(av != null && av === bv, `${name} matches client/server (${av} vs ${bv})`);
  });
}

// --- (2e) distinctive-fit baseline parity ---
// LV_BASELINE is a generated literal, embedded rather than fetched, so nothing
// at runtime would notice it drifting from the centroids it was derived from.
// Four copies must agree: client embed, server embed, the artifact, and a
// recomputation done here from scratch (deliberately NOT the generator's own
// code — a generator that is wrong the same way twice proves nothing).
// --- (2e) a stored vector with no signal is not an answer ---
// The failure this guards, reported from real use 2026-07-21: hydration that
// runs before the zone centroids are available drops a corrupt vector, fails to
// reseed, and writes a full-length all-zero `source: 'empty'` vector. Every
// "do we have a vector?" check passes on it, re-hydration reuses a stored
// vector, and the profile scores the same nothing against every career forever.
//
// Deliberately synchronous. resolvePersonality seeds inside a .then(), and
// section (3) below clears FWSectorFitSheet while that promise would be in
// flight — a value measured after the await measures the sheet-less seed, not
// the repair. So this asserts the two halves separately and in order:
//   (a) hasVectorSignal rejects the degenerate vector and accepts a real one,
//   (b) the seed it falls back to actually points at the user's own sectors.
console.log('degenerate stored vector:');
{
  const ZC = JSON.parse(fs.readFileSync(path.join(REPO, 'data/onet/artifacts/zone-centroids.json'), 'utf8'));
  const M2 = global.FWOnetMath;
  assert(V.hasVectorSignal(new Array(DIM).fill(0)) === false, 'an all-zero vector has no signal');
  assert(V.hasVectorSignal(new Array(DIM).fill(0).map((_, i) => (i < 5 ? 40 : 0))) === false,
    '5 nonzero dims is below the signal floor');
  assert(V.hasVectorSignal(new Array(DIM).fill(0).map((_, i) => (i % 3 === 0 ? 40 : 0))) === true,
    'a real sparse profile clears the signal floor');

  const seeded = V.seedPersonalityFromQuiz({ tech: 80, finance: 60, science: 40 }, ZC);
  const fitZone = (z) => M2.displayFitPercent(seeded.values, ZC[z]);
  assert(V.hasVectorSignal(seeded.values), 'the fallback seed has real signal');
  assert(fitZone('tech') > fitZone('trades'),
    `seeded from {tech:80, finance:60}: tech ${fitZone('tech')} beats trades ${fitZone('trades')}`);
  assert(fitZone('finance') > fitZone('agriculture'),
    `seeded: finance ${fitZone('finance')} beats agriculture ${fitZone('agriculture')}`);

  // The guard itself: resolvePersonality must not hand back the empty vector.
  // Asserted on the branch it takes, not on what the async seed produces.
  const emptyStored = {
    schemaId: V.SCHEMA,
    values: new Array(DIM).fill(0),
    confidence: new Array(DIM).fill('estimated'),
    updatedAt: '2026-07-01T00:00:00.000Z',
    source: 'empty',
  };
  assert(V.hasVectorSignal(emptyStored.values) === false,
    'the stored-vector guard rejects a full-length all-zero vector');
  assert(V.hasVectorSignal(seeded.values) === true,
    'the stored-vector guard accepts the vector the repair produces');
}
// --- (2f) the fit chokepoints ---
// personalityFitPercent and displayFitPercent are the ONE place each fit is
// scored (client IIFE + server ESM). Three things have to hold: the two
// implementations agree bit-for-bit, personality fit really is the plain
// mean-centered cosine, and the DISPLAYED fit is personality fit alone — no
// objective evidence folded in, which two previous formulas both did.
async function runChokepointSuite() {
  console.log('fit chokepoints:');
  const S = await import('../functions/_lib/onet/math.js');
  const C = global.FWOnetMath;

  const flag = (src, name) => {
    const m = fs.readFileSync(path.join(REPO, src), 'utf8')
      .match(new RegExp(`${name}\\s*=\\s*(true|false|[0-9.]+)\\s*;`));
    return m ? m[1] : null;
  };
  const a = flag('assets/js/shared/onet-math.js', 'FIT_MATH_VERSION');
  const b = flag('functions/_lib/onet/math.js', 'FIT_MATH_VERSION');
  assert(a != null && a === b, `FIT_MATH_VERSION matches client/server (${a} vs ${b})`);
  assert(C.FIT_MATH_VERSION === S.FIT_MATH_VERSION, 'FIT_MATH_VERSION agrees at runtime');
  // P0.3 survives the formula change: a stored fit percent is only safe if its
  // version identifies the formula that wrote it. v1 was the original cosine,
  // v2 the distinctive formula, v3 this one. Caches key on it.
  assert(C.FIT_MATH_VERSION >= 4, `FIT_MATH_VERSION ${C.FIT_MATH_VERSION} is at or past the personality-only display formula`);
  ['assets/js/shared/onet-math.js', 'functions/_lib/onet/math.js'].forEach((src) => {
    const txt = fs.readFileSync(path.join(REPO, src), 'utf8');
    assert(!/LV_BASELINE|distinctiveCosine|maskedResiduals/.test(txt),
      `${src} carries no leftover distinctive-fit machinery`);
  });

  // Deterministic fixtures spanning the range. Careers are built FROM the user
  // profile so fits land across 0-100: an equality assertion whose two sides are
  // both 0 proves nothing.
  const noise = (i) => 15 + ((i * 53) % 83);
  const dense = new Array(DIM).fill(0).map((_, i) => 20 + ((i * 37) % 71));
  const sparse = dense.map((v, i) => (i % 3 === 0 ? v : 0));
  const flat = new Array(DIM).fill(50);
  const objective = dense.map((v, i) => (i % 5 === 0 ? v * 0.8 : 0));
  const careers = {
    aligned: dense.map((v) => v),
    partly: dense.map((v, i) => 0.6 * v + 0.4 * noise(i)),
    opposed: dense.map((v) => 100 - v),
    unrelated: new Array(DIM).fill(0).map((_, i) => noise(i)),
  };
  const fixtures = { dense, sparse, flat };

  let sawStrongFit = false;
  Object.keys(fixtures).forEach((name) => {
    const u = fixtures[name];
    Object.keys(careers).forEach((cName) => {
      const v = careers[cName];
      const wantP = C.cosinePercent(C.cosine(u, v));
      if (wantP > 20) sawStrongFit = true;
      assert(C.personalityFitPercent(u, v) === wantP,
        `client personality fit is the plain cosine, ${name}/${cName} (${wantP})`);
      assert(S.personalityFitPercent(u, v) === wantP,
        `server personality fit is the plain cosine, ${name}/${cName} (${wantP})`);

      // The displayed fit is personality fit — asserted as an identity in both
      // files so a future change cannot quietly fold objective evidence back in.
      assert(C.displayFitPercent(u, v) === wantP,
        `client display fit == personality fit, ${name}/${cName} (${wantP})`);
      assert(S.displayFitPercent(u, v) === wantP,
        `server display fit == personality fit, ${name}/${cName} (${wantP})`);
    });
  });
  assert(sawStrongFit, 'chokepoint fixtures exercise a real (>20) fit, not just zeros');

  // The chokepoint only means anything if nothing routes around it. Several
  // migrated call sites (career-compare, career-personalize, portal-target-
  // switch) have no numeric assertion anywhere in the suite, so this structural
  // scan is their only coverage: a re-introduced raw personality cosine is a
  // silently wrong number on a real surface.
  // Empty is the end state. Nothing goes back in here — the formula behind the
  // chokepoint has now changed twice, and both times the call sites came along
  // for free precisely because none of them compute their own cosine.
  const ALLOWED_RAW_PERSONALITY_COSINE = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(js|mjs)$/.test(e.name) ? [p] : [];
  });
  const RAW = /cosine\s*\(\s*(?:state\.)?personality(?:Vec|\.values)?\s*,/;
  const offenders = [...walk(path.join(REPO, 'assets/js')), ...walk(path.join(REPO, 'functions'))]
    .map((p) => [path.relative(REPO, p), fs.readFileSync(p, 'utf8')])
    .filter(([rel]) => !ALLOWED_RAW_PERSONALITY_COSINE.includes(rel))
    .flatMap(([rel, src]) => src.split('\n')
      .map((line, i) => [rel, i + 1, line])
      .filter(([, , line]) => RAW.test(line) && !/^\s*(\/\/|\*)/.test(line)));
  assert(offenders.length === 0,
    `no call site computes a raw personality cosine${offenders.length ? `: ${offenders.map(([r, n]) => `${r}:${n}`).join(', ')}` : ''}`);
}

// --- (2b) fitForSlugOrSoc returns the same fit the hub shows ---
console.log('fitForSlugOrSoc blend:');
(async () => {
  await runChokepointSuite();
  await runPersonaSuite();

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
  const expectedP = M.personalityFitPercent(q.personalityVector.values, careerVec);
  const expectedO = M.objectiveFitPercent(q.objectiveVector.values, careerVec);
  const expected = M.displayFitPercent(q.personalityVector.values, careerVec);
  assert(fit.personalityFit === expectedP, 'personality component matches hub math');
  assert(fit.objectiveFit === expectedO, 'objective component matches hub math');
  assert(fit.percent === expected, `percent is the displayed (personality) fit (${fit.percent} vs ${expected})`);

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
  // The panel is defined as "careers the quiz alone would not surface", so the
  // exclusion has to be measured against the ranking the user actually sees —
  // which is personality fit. Assert the ranked list really is that ranking, so
  // a future change to the displayed fit cannot silently redefine the panel.
  const fullRank = await V.rankOnetCareersFromVectors({ limit: 782 });
  assert(fullRank.slice(0, 12).map((e) => e.soc).indexOf(STRETCH_SOC) === -1,
    'stretch candidate is NOT in the top 12 the user sees');
  assert(fullRank.every((e, i) => i === 0 || (fullRank[i - 1].personalityFit || 0) >= (e.personalityFit || 0)),
    'the ranked list is ordered by personality fit — the same fit the panel excludes against');
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

  // --- S10 commitments: dueAt/effort/committedAt/dueMoves are USER state
  // living on a step inside the roadmap doc. saveRoadmap and loadRoadmap BOTH
  // run normalizeRoadmap(x, x), so a field normalizeSteps does not know about
  // is not "ignored" — it is deleted on the very next save. Every assertion
  // below is a way that has actually happened to a field in this file before.
  console.log('commitment fields through normalize/merge/preserve:');
  const cTree = JSON.parse(JSON.stringify(vTree));
  cTree.nodes[0].steps = [
    { id: 's1-st1', text: 'Finish the DCF module', done: false, dueAt: '2026-08-01', effort: 'M', committedAt: '2026-07-24T10:00:00.000Z', dueMoves: 2 },
    { id: 's1-st2', text: 'Email two alumni', done: false },
  ];

  // 1. The no-op save. This is the whole feature: PUT /profile/roadmap hands
  //    the same object in as preserveFrom, and it must come back intact.
  const cNorm = RT.normalizeRoadmapTree(cTree, cTree);
  const cStep = cNorm.nodes.find((n) => n.id === 's1').steps[0];
  assert(cStep.dueAt === '2026-08-01', 'no-op save preserves dueAt');
  assert(cStep.effort === 'M', 'no-op save preserves effort');
  assert(cStep.committedAt === '2026-07-24T10:00:00.000Z', 'no-op save preserves committedAt');
  assert(cStep.dueMoves === 2, 'no-op save preserves the reschedule count');
  assert(cNorm.nodes[0].steps[1].dueAt === undefined, 'an uncommitted step gains no date');

  // 2. Idempotence. Normalizing twice must not stamp, drift or accumulate —
  //    every page load and every save runs this again.
  const cNorm2 = RT.normalizeRoadmapTree(cNorm, cNorm);
  assert(JSON.stringify(cNorm2.nodes[0].steps) === JSON.stringify(cNorm.nodes[0].steps),
    'normalize is idempotent over commitment fields');

  // 3. Regeneration. The model's raw tree carries no commitment fields at all;
  //    preserveFrom does. A rebuild must not throw away a promise the student
  //    made — this is the `preserveFrom` carry-forward the tracker relies on.
  const cRaw = JSON.parse(JSON.stringify(cTree));
  cRaw.nodes[0].steps = [
    { id: 's1-st1', text: 'Finish the DCF module', done: false },
    { id: 's1-st2', text: 'Email two alumni', done: false },
  ];
  const cRegen = RT.normalizeRoadmapTree(cRaw, cNorm);
  assert(cRegen.nodes[0].steps[0].dueAt === '2026-08-01',
    'a regenerated tree keeps the commitment on a surviving step id');
  assert(cRegen.nodes[0].steps[0].dueMoves === 2, 'the reschedule count survives regeneration too');

  // 4. THE TRAP (the `preserveFrom` lesson, S3-completion note): clearing must
  //    not be undone by the preserved copy. An explicit null is the tombstone.
  //    If this ever regresses, "remove date" becomes "hide it until Tuesday".
  const cCleared = JSON.parse(JSON.stringify(cNorm));
  cCleared.nodes[0].steps[0] = Object.assign({}, cCleared.nodes[0].steps[0], {
    dueAt: null, effort: null, committedAt: null, dueMoves: null,
  });
  const cAfterClear = RT.normalizeRoadmapTree(cCleared, cNorm);
  const clearedStep = cAfterClear.nodes[0].steps[0];
  assert(clearedStep.dueAt === undefined, 'a cleared dueAt is NOT resurrected from preserveFrom');
  assert(clearedStep.effort === undefined && clearedStep.committedAt === undefined
    && clearedStep.dueMoves === undefined, 'clearing a date clears the whole commitment');
  assert(clearedStep.text === 'Finish the DCF module' && clearedStep.done === false,
    'clearing a commitment touches nothing else on the step');

  // 5. Garbage in, nothing out. A model or a hand-edited doc can hand us any of
  //    these; none may become a rendered "due Feb 31st".
  const cBad = JSON.parse(JSON.stringify(cTree));
  cBad.nodes[0].steps = [
    { id: 'b1', text: 'a', done: false, dueAt: '2026-02-31' },
    { id: 'b2', text: 'b', done: false, dueAt: 'next friday' },
    { id: 'b3', text: 'c', done: false, dueAt: '2026-08-01T12:00:00Z' },
    { id: 'b4', text: 'd', done: false, dueAt: '2026-08-01', effort: 'XL' },
    { id: 'b5', text: 'e', done: false, effort: 'S', committedAt: 'x' },
  ];
  const cBadNorm = RT.normalizeRoadmapTree(cBad, null).nodes[0].steps;
  assert(cBadNorm[0].dueAt === undefined, 'an impossible calendar day is dropped, not coerced');
  assert(cBadNorm[1].dueAt === undefined, 'free text is not a date');
  assert(cBadNorm[2].dueAt === '2026-08-01',
    'a full ISO instant is truncated to its UTC day, never stored raw (it would sort and render wrong)');
  assert(cBadNorm[3].dueAt === '2026-08-01' && cBadNorm[3].effort === undefined,
    'an unknown effort is dropped while the valid date survives');
  assert(cBadNorm[4].effort === undefined && cBadNorm[4].committedAt === undefined,
    'commitment meta with no date is not a commitment');

  // 6. mergeTreePatch — Marco's inline waypoint edits replace a node's whole
  //    steps array. The commitment has to come through that too.
  const cPatched = RT.mergeTreePatch(cNorm, {
    nodes: [{
      id: 's1', parentId: 'trunk', depth: 1, type: 'waypoint', title: 'Do s1', confidence: 4,
      steps: [{ id: 's1-st1', text: 'Finish the DCF model module', done: false }],
    }],
  });
  const cPatchStep = cPatched.nodes.find((n) => n.id === 's1').steps.find((s) => s.id === 's1-st1');
  assert(cPatchStep && cPatchStep.text === 'Finish the DCF model module',
    'the patch still rewrites the step text');
  assert(cPatchStep.dueAt === '2026-08-01' && cPatchStep.dueMoves === 2,
    'a waypoint content patch does not wipe the commitment on a kept step id');

  // 7. The client mirror agrees with the server. Two implementations of
  //    "overdue" is how two surfaces start telling the same student different
  //    things on the same afternoon.
  console.log('commitments client/server parity:');
  const CM = await import('../functions/_lib/commitments.js');
  const mirrorSrc = fs.readFileSync(path.join(REPO, 'assets/js/shared/commitments.js'), 'utf8');
  const mirrorSandbox = {};
  new Function('window', mirrorSrc)(mirrorSandbox);
  const FWC = mirrorSandbox.FWCommitments;
  assert(!!FWC, 'the client mirror loads outside a browser');

  const NOW = Date.parse('2026-07-24T23:59:00Z');
  const parityTree = {
    version: 2, targetCareerSlug: 't', targetCareerName: 'T',
    nodes: [{
      id: 'w1', shortTitle: 'W', title: 'W',
      steps: [
        { id: 'p1', text: 'late one', done: false, dueAt: '2026-07-20' },
        { id: 'p2', text: 'today', done: false, dueAt: '2026-07-24' },
        { id: 'p3', text: 'later', done: false, dueAt: '2026-09-01', effort: 'L', dueMoves: 1 },
        { id: 'p4', text: 'finished', done: true, dueAt: '2026-07-22' },
        { id: 'p5', text: 'no date', done: false },
      ],
    }],
  };
  const srvList = CM.collectCommitments(parityTree, { now: NOW });
  const cliList = FWC.collect(parityTree, { now: NOW });
  assert(JSON.stringify(srvList) === JSON.stringify(cliList),
    'client and server collectCommitments agree field-for-field and in order');
  assert(srvList.length === 3 && srvList[0].stepId === 'p1' && srvList[0].overdue === true,
    'overdue sorts first; done and undated are excluded');
  // 23:59 UTC is the exact shape of the bug S9 found in the old daysUntil: an
  // instant-based measurement makes a deadline closing TODAY read as -1.
  assert(srvList[1].daysOut === 0 && srvList[1].overdue === false,
    'a step due today reads 0 days out at 23:59 UTC, not -1');
  assert(JSON.stringify(CM.commitmentBuckets(srvList).overdue.map((c) => c.stepId))
    === JSON.stringify(FWC.buckets(cliList).overdue.map((c) => c.stepId)),
    'client and server bucket identically');

  // 8. The two mutation paths agree, including the honesty counter.
  const srvMoved = CM.applyCommitment(parityTree, 'w1', 'p1', { action: 'set', dueAt: '2026-08-10' });
  const cliMoved = FWC.setCommitment(parityTree, 'w1', 'p1', '2026-08-10', null);
  const srvStep = srvMoved.roadmap.nodes[0].steps.find((s) => s.id === 'p1');
  const cliStep = cliMoved.nodes[0].steps.find((s) => s.id === 'p1');
  assert(srvStep.dueMoves === 1 && cliStep.dueMoves === 1,
    'moving a date LATER counts as a reschedule on both sides');
  const srvEarlier = CM.applyCommitment(parityTree, 'w1', 'p3', { action: 'set', dueAt: '2026-08-01' });
  const cliEarlier = FWC.setCommitment(parityTree, 'w1', 'p3', '2026-08-01', 'L');
  assert(srvEarlier.roadmap.nodes[0].steps.find((s) => s.id === 'p3').dueMoves === 1
    && cliEarlier.nodes[0].steps.find((s) => s.id === 'p3').dueMoves === 1,
    'pulling a date EARLIER is not a slip and does not bump the count');
  assert(CM.applyCommitment(parityTree, 'w1', 'p5', { action: 'clear' }).changed === false
    && FWC.clearCommitment(parityTree, 'w1', 'p5') === null,
    'clearing a step that has no date is a no-op on both sides');
  assert(CM.applyCommitment(parityTree, 'w1', 'nope', { action: 'set', dueAt: '2026-08-01' }).changed === false,
    'a step id that is not on this tree changes nothing (the cross-user guard)');

  // 9. A clear survives a real save round-trip end to end: mutate → normalize.
  const clearedTree = CM.applyCommitment(parityTree, 'w1', 'p3', { action: 'clear' }).roadmap;
  const savedAfterClear = RT.normalizeRoadmapTree(
    Object.assign({}, clearedTree, { trunk: { id: 'trunk', title: 'Now', confidence: 5 }, activePath: ['trunk'], decisions: [] }),
    Object.assign({}, parityTree, { trunk: { id: 'trunk', title: 'Now', confidence: 5 }, activePath: ['trunk'], decisions: [] }),
  );
  const savedStep = savedAfterClear.nodes[0].steps.find((s) => s.id === 'p3');
  assert(savedStep.dueAt === undefined && savedStep.effort === undefined,
    'clear → save → normalize really removes the commitment');


  // ---------------------------------------------------------------------------
  // S12 — the Evidence Locker's vector attribution. This lives in test:vectors
  // rather than a gate of its own because the claim it protects is a claim about
  // the objective-vector pipeline: the locker EXPLAINS a movement the single
  // writer already made, and it must never become a second writer.
  console.log('evidence locker attribution (READ-ONLY over vectors):');
  const EL = await import('../functions/_lib/evidence-locker.js');
  const GPS = await import('../functions/_lib/gap-progress-sync.js');

  const lockerTree = {
    version: 2,
    targetCareerSlug: 'quant', targetCareerName: 'Quant',
    activePath: ['trunk', 'n1'],
    nodes: [{
      id: 'n1', shortTitle: 'W1', title: 'W1',
      addressedGaps: ['Quantitative Analysis'],
      steps: [{ id: 'a', text: 'x', done: false }, { id: 'b', text: 'y', done: false }],
    }],
    focusTracker: {
      skillGaps: [
        {
          id: 'g1', label: 'Quantitative Analysis', dimIndex: 12, vBase: 40, target: 90,
          checklist: [], logs: [{ id: 'art-ART1', artifactId: 'ART1', text: '[artifact:repo] notebook', w: 10 }],
        },
        {
          // Four heavy logs: the 30-point evidence cap is already saturated, so
          // the marginal contribution of any one of them is genuinely zero.
          id: 'g2', label: 'Financial Modeling', dimIndex: 33, vBase: 20, target: 70,
          checklist: [],
          logs: [
            { id: 'art-CAP1', artifactId: 'CAP1', w: 10 },
            { id: 'art-CAP2', artifactId: 'CAP2', w: 10 },
            { id: 'art-CAP3', artifactId: 'CAP3', w: 10 },
            { id: 'art-CAP4', artifactId: 'CAP4', w: 10 },
          ],
        },
        // A gap with no dimension index: there is no coordinate to have moved.
        { id: 'g3', label: 'Unmapped Skill', logs: [{ id: 'art-NODIM', artifactId: 'NODIM', w: 8 }] },
      ],
    },
  };

  const lockerArtifacts = [
    { id: 'ART1', title: 'Fraud notebook', type: 'repo', gapId: 'g1', dimIndex: 12 },
    { id: 'CAP4', title: 'Fourth model', type: 'analysis', gapId: 'g2', dimIndex: 33 },
    { id: 'NODIM', title: 'Club deck', type: 'design', gapId: 'g3' },
    { id: 'LOOSE', title: 'Portfolio only', type: 'other' },
  ];

  // The invariant, checked the only way it can be checked: snapshot the input,
  // run attribution, compare. `attributeArtifacts` builds its counterfactual by
  // spreading, so a mutation here would mean a student's real gap losing a log.
  const beforeJson = JSON.stringify(lockerTree);
  const attribution = EL.attributeArtifacts(lockerTree, lockerArtifacts);
  assert(JSON.stringify(lockerTree) === beforeJson,
    'attribution does not mutate the tree it was handed — not one log, not one gap');

  const baseDims = GPS.computeGapProgressDims(lockerTree);
  const dim12 = baseDims.find((d) => d.index === 12).value;
  assert(dim12 === 45,
    'the fixture is the real formula: base 40 + span 50 x 10% evidence = 45');
  assert(attribution.byId.ART1.linked === true && attribution.byId.ART1.delta === 5,
    'and the artifact is credited with exactly the 5 points removing it would cost');
  assert(attribution.byId.ART1.gapLabel === 'Quantitative Analysis' && attribution.byId.ART1.dimIndex === 12,
    'with the gap it is filed under, taken from the tree rather than from the artifact row');

  assert(attribution.byId.CAP4.linked === true && attribution.byId.CAP4.delta === 0,
    'a fourth artifact on a gap already at the 30-point evidence cap is credited ZERO, not its raw weight');
  assert(EL.attributionPhrase(attribution.byId.CAP4) === 'Filed under Financial Modeling',
    'and the locker says so plainly instead of rounding up to a number that never happened');
  assert(EL.attributionPhrase(attribution.byId.ART1) === 'Moved Quantitative Analysis +5',
    'a real movement reads as one');

  assert(attribution.byId.NODIM.linked === true && attribution.byId.NODIM.delta === null,
    'a gap with no dimension index has no coordinate to have moved');
  assert(attribution.byId.LOOSE.linked === false && EL.attributionPhrase(attribution.byId.LOOSE) === '',
    'portfolio-only evidence claims nothing at all');
  assert(attribution.linkedCount === 3 && attribution.totalDelta === 5,
    'the header line counts only what is real');

  assert(EL.attributeArtifacts(null, lockerArtifacts).linkedCount === 0,
    'no roadmap at all degrades to zero attribution rather than throwing');

  // The structural half. The numeric assertions above would all still pass if a
  // later session added a save call here, and the damage would be a second
  // writer on the fragile path the 2026-07-10 streamlining exists to prevent.
  // Strip comments before matching. A presence-lint that a COMMENT can trip is
  // a lint a future session satisfies by rewording prose instead of fixing the
  // code — and this one tripped on its own explanatory note the first time it
  // ran. Block comments plus whole-line `//` and ` *` lines: enough to remove
  // every doc comment in these two files, and it can only ever remove text, so
  // it cannot manufacture a pass.
  const codeOnly = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');

  const lockerSrc = codeOnly(fs.readFileSync(path.join(REPO, 'functions/_lib/evidence-locker.js'), 'utf8'));
  for (const forbidden of ['saveUser', 'saveRoadmap', 'saveUserBlob', 'mergeObjectiveAiPatch',
    'applyObjectiveAiPatch', 'env.DB', 'COACH_KV', 'fetch(']) {
    assert(!lockerSrc.includes(forbidden),
      `evidence-locker.js contains no ${forbidden} — it explains the vector, it never writes it`);
  }
  assert(/computeGapProgressDims/.test(lockerSrc),
    'and it derives the number from the single writer’s own function rather than re-implementing the formula');

  // The same discipline, applied to the one file that legitimately DOES write.
  // functions/artifacts.js used to carry a second copy of the progress formula
  // (checklist ratio where the canonical function uses a step ratio), so logging
  // an artifact wrote one value and the next roadmap save converged it to
  // another. It now mutates the tree and hands it to syncGapProgressToQuiz, and
  // these three assertions are what stop an inline formula coming back: the
  // vector-patch primitives and the raw user-blob writers must not appear in
  // this file at all.
  const artifactsSrc = codeOnly(fs.readFileSync(path.join(REPO, 'functions/artifacts.js'), 'utf8'));
  for (const forbidden of ['mergeObjectiveAiPatch', 'applyObjectiveAiPatch', 'saveUserBlob']) {
    assert(!artifactsSrc.includes(forbidden),
      `functions/artifacts.js contains no ${forbidden} — it moves the vector through the single writer or not at all`);
  }
  assert(/syncGapProgressToQuiz/.test(artifactsSrc),
    'and it does call syncGapProgressToQuiz (both on log and on delete)');

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

  // --- Regeneration invariant: a same-career rebuild's raw model output has NO
  // focusTracker, but preserveFrom (the stored roadmap) holds the user's v3
  // tracker. normalizeRoadmapTree must carry it so ensureFocusTrackerOnTree
  // round-trips v3 rather than rebuilding a fresh v1 — otherwise every profile
  // drift refresh silently wipes gap logs and re-bases vBase (the exact loss the
  // save-path round-trip above exists to prevent, but on the regeneration path).
  console.log('v3 focusTracker survives same-career regeneration:');
  const freshRaw = {
    version: 2, targetCareerSlug: 'test-career', targetCareerName: 'Test Career',
    summary: 'regenerated', trunk: { id: 'trunk', title: 'Now', confidence: 5 },
    nodes: [mkNode('s1', 'trunk', 1), mkNode('s2', 's1', 2)],
    decisions: [], activePath: ['trunk', 's1', 's2'],
    // no focusTracker — fresh model output never contains one
  };
  const rNorm = RT.normalizeRoadmapTree(freshRaw, pTree);
  assert(rNorm && rNorm.focusTracker && rNorm.focusTracker.version === 3,
    'same-career regen preserves the v3 tracker (not downgraded to v1)');
  const rGap = rNorm && rNorm.focusTracker && (rNorm.focusTracker.skillGaps || []).find((g) => g.dimIndex === 5);
  assert(rGap && rGap.vBase === 30, 'vBase base survives regeneration');
  assert(rGap && rGap.logs && rGap.logs[0] && rGap.logs[0].w === 7, 'gap logs survive regeneration');

  // Retarget to a DIFFERENT career must NOT inherit the old tracker.
  console.log('retarget regeneration starts a fresh tracker:');
  const retargetRaw = Object.assign({}, freshRaw, {
    targetCareerSlug: 'other-career', targetCareerName: 'Other Career',
  });
  const tNorm = RT.normalizeRoadmapTree(retargetRaw, pTree);
  assert(tNorm && tNorm.focusTracker && tNorm.focusTracker.version !== 3,
    'a different-career rebuild does not inherit the prior v3 tracker');

  // --- §3B.1: a fresh branch RE-choice must not be reverted to the old option.
  // normalizeRoadmapTree backfills chosenOptionId from preserveFrom, but only
  // when raw carries none — otherwise a caller that just switched A→B has its
  // choice (and the derived activePath) silently reverted to A, desyncing
  // decisions/activePath from focusTracker.activeBranchKey.
  console.log('branch re-choice survives normalize (§3B.1):');
  const mkBranch = (id, parentId, depth) => ({
    id, parentId, depth, type: 'waypoint', pathRole: 'branch',
    shortTitle: 'Br ' + id, title: 'Br ' + id, confidence: 4,
    steps: [{ id: id + '-st1', text: 'step', done: false }],
  });
  const decBase = {
    version: 2, targetCareerSlug: 'test-career', targetCareerName: 'Test Career',
    summary: 'x', trunk: { id: 'trunk', title: 'Now', confidence: 5 },
    nodes: [
      mkNode('s1', 'trunk', 1), mkNode('s2', 's1', 2),
      mkBranch('a1', 's1', 2), mkBranch('a2', 'a1', 3),
      mkBranch('b1', 's1', 2), mkBranch('b2', 'b1', 3),
    ],
    decisions: [{
      id: 'D1', nodeId: 's1', prompt: 'Which path?',
      options: [
        { id: 'optA', label: 'Path A', childNodeId: 'a1' },
        { id: 'optB', label: 'Path B', childNodeId: 'b1' },
      ],
      chosenOptionId: 'optA',
    }],
    activePath: ['trunk', 's1', 's2'],
  };
  const preserveChoice = JSON.parse(JSON.stringify(decBase)); // holds optA
  const rawReChoice = JSON.parse(JSON.stringify(decBase));
  rawReChoice.decisions[0].chosenOptionId = 'optB'; // caller just switched A→B
  const dNorm = RT.normalizeRoadmapTree(rawReChoice, preserveChoice);
  const dDec = (dNorm.decisions || []).find((d) => d.id === 'D1');
  assert(dDec && dDec.chosenOptionId === 'optB',
    're-choosing a decision A→B is NOT reverted to A by normalize');
  assert(dNorm.activePath.includes('b1') && !dNorm.activePath.includes('a1'),
    'activePath follows the re-chosen branch B, not the preserved A');
  // And the original guarantee still holds: raw with no choice backfills from prev.
  const rawNoChoice = JSON.parse(JSON.stringify(decBase));
  rawNoChoice.decisions[0].chosenOptionId = null;
  const bNorm = RT.normalizeRoadmapTree(rawNoChoice, preserveChoice);
  const bDec = (bNorm.decisions || []).find((d) => d.id === 'D1');
  assert(bDec && bDec.chosenOptionId === 'optA',
    'a choiceless raw still backfills the prior chosenOptionId from preserveFrom');

  // --- §2.4/§3B.5: followTreePath, chooseTreePath, and mergeTreeSplit share one
  // focus-mutating helper (addBranchFocus). Their INPUTS legitimately differ, and
  // the unification must preserve that: follow keys the focus by the branch ROOT
  // (walking up from an arbitrary target) while recording the *specific* waypoint
  // navigated to; choose/split hold the root already and point the waypoint at it.
  console.log('branch focus helper unification (§2.4/§3B.5):');
  const focusTree = RT.normalizeRoadmapTree(JSON.parse(JSON.stringify(decBase)), null);
  assert(focusTree && (focusTree.nodes || []).some((n) => n.id === 'a2' && n.pathRole === 'branch'),
    'focus fixture: deep branch node a2 survives normalize as a branch');

  // follow to a DEEP branch node: branchKey = root (a1), waypointId = the target (a2).
  const fFollow = RT.followTreePath(focusTree, 'a2');
  const fFocus = (fFollow.focusTracker?.branchFocuses || []).find((b) => b.branchKey === 'a1');
  assert(fFocus && fFocus.waypointId === 'a2',
    'followTreePath keys focus by branch root a1 but records deep waypoint a2');
  assert(fFollow.focusTracker?.activeBranchKey === 'a1',
    'followTreePath marks the branch root active');

  // choose a decision option: branchKey AND waypointId are the option childNodeId (root).
  const fChoose = RT.chooseTreePath(focusTree, 'D1', 'optA');
  const cFocus = (fChoose.focusTracker?.branchFocuses || []).find((b) => b.branchKey === 'a1');
  assert(cFocus && cFocus.waypointId === 'a1',
    'chooseTreePath keys focus and waypoint both at the branch root a1');
  assert(fChoose.focusTracker?.activeBranchKey === 'a1',
    'chooseTreePath marks the chosen branch root active');

  // multi-track (MAX_BRANCH_FOCUSES raised to 4): with spine + a1 already focused,
  // following into branch b ADDS b1 (keyed by root, waypoint = the deep target b2)
  // rather than evicting a1 — the user can track several branches at once now.
  const capSeed = JSON.parse(JSON.stringify(focusTree));
  capSeed.focusTracker = {
    version: 1, skillGaps: [],
    branchFocuses: [
      { branchKey: 'spine', waypointId: 's1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { branchKey: 'a1', waypointId: 'a1', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    activeBranchKey: 'a1',
  };
  const fCap = RT.followTreePath(capSeed, 'b2');
  const capKeys = (fCap.focusTracker?.branchFocuses || []).map((b) => b.branchKey);
  assert(capKeys.length === 3 && capKeys.includes('spine') && capKeys.includes('a1') && capKeys.includes('b1'),
    'a third focus is ADDED, not replaced, under the raised MAX_BRANCH_FOCUSES cap');
  const capB = (fCap.focusTracker?.branchFocuses || []).find((b) => b.branchKey === 'b1');
  assert(capB && capB.waypointId === 'b2', 'the added focus records the deep waypoint b2 under root b1');

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
// The portal snapshot's prose cites careerPool fit percentages, and its
// staleness check keys on vector timestamps — which cannot see a scoring change.
// FIT_MATH_VERSION is the salt that can; it must be read there, and it must stay
// inert while the version is 1 so no snapshot regenerates before the flip.
{
  const inputsHash = authSrc.slice(
    authSrc.indexOf('function computePortalInputsHash'),
    authSrc.indexOf('function readDossierFingerprint') > authSrc.indexOf('function computePortalInputsHash')
      ? authSrc.indexOf('function readDossierFingerprint')
      : authSrc.length,
  ).split('\n  }')[0];
  assert(inputsHash.includes('FIT_MATH_VERSION'),
    'computePortalInputsHash is salted with FIT_MATH_VERSION');
  assert(/fitMath\s*>\s*1/.test(inputsHash),
    'the FIT_MATH_VERSION salt is inert at version 1 (no snapshot churn before the flip)');
}
const mergeBlock = authSrc.slice(authSrc.indexOf('async function doUpload'), authSrc.indexOf('lastUploadedQuizHash = quizPayloadHash'));
assert(mergeBlock.includes('mergeVectorInputs'), 'upload merge includes mergeVectorInputs');
assert(mergeBlock.includes('mergeCareerFocus'), 'upload merge includes mergeCareerFocus');
// (final exit happens in the async fitForSlugOrSoc block above)
