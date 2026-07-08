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
assert(cos > 0 && cos <= 1, 'cosine in range');
assert(cosinePercent(1) === 100, 'cos=1 -> 100');
assert(cosinePercent(0) === 0, 'cos=0 -> 0');
assert(computeFitPercent(a, a) === 100, 'identical vectors -> 100');
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
