#!/usr/bin/env node
import { clamp100, cosine, cosinePercent, computeFitPercent, overallFitScore, computeGapVector, emptyVector } from '../../functions/_lib/onet/math.js';
import { DIM_COUNT } from '../../functions/_lib/onet/constants.js';

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
assert(overallFitScore(80, 40) === 70, '75/25 weighted overall');
assert(overallFitScore(60, null) === 60, 'personality-only overall');
assert(overallFitScore(null, 40) === null, 'null personality overall');
assert(clamp100(150) === 100, 'clamp high');
assert(clamp100(-5) === 0, 'clamp low');

const gaps = computeGapVector(a, b, new Array(DIM_COUNT).fill(100));
assert(gaps[0].gap >= gaps[gaps.length - 1].gap, 'gaps sorted');

if (failed) {
  console.error(failed + ' test(s) failed');
  process.exit(1);
}
console.log('onet math tests passed');
