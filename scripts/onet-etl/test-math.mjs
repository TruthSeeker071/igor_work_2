#!/usr/bin/env node
import { clamp100, cosine, cosinePercent, computeFitPercent, displayFitPercent, objectiveFitPercent, computeGapVector, emptyVector } from '../../functions/_lib/onet/math.js';
import { DIM_COUNT } from '../../functions/_lib/onet/constants.js';
import {
  rankCareersByFit, careerRankFingerprint, careerRankKey, careerRankPromptBlock,
} from '../../functions/_lib/onet/career-rank.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
}

const a = emptyVector(10);
const b = emptyVector(20);
for (let i = 0; i < DIM_COUNT; i++) { a[i] = i % 50; b[i] = (i * 2) % 80; }
const cos = cosine(a, b);
assert(cos >= -1 && cos <= 1.0000001, 'centered cosine in [-1,1]');
assert(cosinePercent(1) === 100, 'cos=1 -> 100');
assert(cosinePercent(0) === 0, 'cos=0 -> 0');
assert(computeFitPercent(a, a) === 100, 'identical vectors -> 100');
// Mean-centered cosine strips a shared constant baseline: adding the same
// constant to every dimension must not change the score (the common-mode fix).
const aPlus = a.map((v) => v + 25);
assert(Math.abs(cosine(a, aPlus) - 1) < 1e-9, 'constant offset invariant -> corr 1');
assert(computeFitPercent(a, aPlus) === 100, 'constant offset -> 100% fit');
// Anti-correlated deviations must score low (raw cosine could not express this).
const aNeg = a.map((v) => 100 - v);
assert(cosine(a, aNeg) < 0, 'inverted profile -> negative correlation');
assert(cosinePercent(cosine(a, aNeg)) === 0, 'inverted profile -> 0% fit');
// The displayed fit is personality fit — objective evidence deliberately does
// not move it. Asserted as an identity so it cannot be folded back in quietly.
assert(displayFitPercent(a, b) === computeFitPercent(a, b),
  'displayed fit is exactly personality fit');
assert(displayFitPercent(null, b) === null, 'no personality vector -> no displayed fit');
assert(clamp100(150) === 100, 'clamp high');
assert(clamp100(-5) === 0, 'clamp low');

const gaps = computeGapVector(a, b, new Array(DIM_COUNT).fill(100));
assert(gaps[0].gap >= gaps[gaps.length - 1].gap, 'gaps sorted');

/* ── Server-side career ranker ─────────────────────────────────────────
   The ranker exists so Marco's context and thread rule 3 can name careers.
   It must introduce NO scoring math of its own — everything below either
   re-derives a number from math.js or pins a behaviour that would silently
   corrupt the list (a derived fragment scored under someone else's vector,
   a tie that reorders between calls). */
{
  const mkVec = (fn) => Array.from({ length: DIM_COUNT }, (_, i) => fn(i));
  const personality = mkVec((i) => (i % 50) + 10);
  const objective = mkVec((i) => (i % 30));
  const far = mkVec((i) => 100 - ((i % 50) + 10));
  // 'Middling' has to actually land BETWEEN the other two under the current
  // formula, or the ordering assertions below pass on a SOC tie-break rather
  // than on scoring. Half personality, half noise measures ~62%.
  const mid = mkVec((i) => 0.5 * ((i % 50) + 10) + 0.5 * (((i * 7) % 60) + 5));

  // Rows 0..2 are real; row 3 is an AI-derived fragment and row 4's
  // vectorIndex points past the end of the buffer.
  const lv = new Float32Array(3 * DIM_COUNT);
  [personality, far, mid].forEach((v, n) => {
    for (let i = 0; i < DIM_COUNT; i++) lv[n * DIM_COUNT + i] = v[i];
  });
  const careers = [
    { soc: '00-0001.00', title: 'Perfect Match', hubZone: 'tech', vectorIndex: 0 },
    { soc: '00-0002.00', title: 'Opposite', hubZone: 'trades', vectorIndex: 1 },
    { soc: '00-0003.00', title: 'Middling', hubZone: 'science', vectorIndex: 2 },
    { soc: '00-0004.00', title: 'Derived Fragment', vectorIndex: 0, aiDerived: true },
    { soc: '00-0005.00', title: 'Out Of Bounds', vectorIndex: 99 },
  ];

  const ranked = rankCareersByFit(careers, lv, personality, objective, 5);
  assert(ranked.length === 3, 'ranker drops aiDerived rows and out-of-range vectorIndexes');
  assert(!ranked.some((r) => r.title === 'Derived Fragment'), 'a derived fragment is never scored');
  assert(ranked[0].title === 'Perfect Match', 'best fit ranks first');
  assert(ranked[ranked.length - 1].title === 'Opposite', 'inverted profile ranks last');
  assert(ranked[0].personalityFit === 100, 'a career vector equal to the personality vector is 100% personality fit');
  assert(ranked[0].fit === displayFitPercent(personality, personality),
    'ranker fit is exactly math.js displayFitPercent — no ranker-local scoring');
  for (let i = 1; i < ranked.length; i++) {
    assert(ranked[i - 1].fit >= ranked[i].fit, 'ranked descending by fit');
  }
  assert(rankCareersByFit(careers, lv, personality, objective, 2).length === 2, 'limit is respected');

  // An inactive objective vector must leave the score personality-only, not
  // drag every career toward a zero vector.
  const noObj = rankCareersByFit(careers, lv, personality, new Array(DIM_COUNT).fill(0), 5);
  assert(noObj[0].objectiveFit === null, 'an inactive objective vector contributes nothing');
  assert(noObj[0].fit === noObj[0].personalityFit, 'personality-only fit when objective is inactive');

  // Determinism: same state, same list. A thread that proposes a different
  // career on every identical turn reads as noise.
  const tied = [
    { soc: '00-0009.00', title: 'Bee', vectorIndex: 0 },
    { soc: '00-0008.00', title: 'Ay', vectorIndex: 0 },
  ];
  const t1 = rankCareersByFit(tied, lv, personality, objective, 5);
  const t2 = rankCareersByFit(tied, lv, personality, objective, 5);
  assert(JSON.stringify(t1) === JSON.stringify(t2), 'ranking is deterministic');
  assert(t1[0].soc === '00-0008.00', 'ties break on SOC, not on catalog order');

  assert(rankCareersByFit(careers, lv, null, objective, 5).length === 0, 'no personality vector -> empty rank');
  // A profile that never had an objective layer carries `objectiveVector: null`,
  // not a zero vector — chat.js reads `quiz?.objectiveVector?.values`.
  const nullObj = rankCareersByFit(careers, lv, personality, null, 5);
  assert(nullObj.length === 3 && nullObj[0].objectiveFit === null,
    'a null objective vector ranks personality-only instead of throwing');

  // The fingerprint is the cache's only invalidator, so it has to move when
  // the vectors move — and only then.
  const fp = careerRankFingerprint(personality, objective);
  assert(fp === careerRankFingerprint(personality.slice(), objective.slice()),
    'fingerprint is stable for identical vectors');
  const drifted = personality.slice();
  drifted[7] += 0.2;
  assert(fp === careerRankFingerprint(drifted, objective),
    'sub-point drift does not throw the cache away');
  const moved = personality.slice();
  moved[7] += 1;
  assert(fp !== careerRankFingerprint(moved, objective),
    'a one-point vector change invalidates the cached rank');
  assert(fp !== careerRankFingerprint(personality, far),
    'an objective-vector change invalidates the cached rank');
  assert(careerRankKey('A@B.com', fp) === careerRankKey('a@b.com', fp),
    'the cache key is case-insensitive on email');

  // The block is dropped, not emptied: a heading with nothing under it teaches
  // the model the data is missing.
  assert(careerRankPromptBlock([]) === '', 'an empty rank produces no prompt block');
  const block = careerRankPromptBlock(ranked);
  assert(block.includes('Perfect Match') && block.includes(`${ranked[0].fit}%`),
    'the prompt block names each career and its score');
}

if (failed) {
  console.error(failed + ' test(s) failed');
  process.exit(1);
}
console.log('onet math tests passed');
