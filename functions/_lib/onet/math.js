import { DIM_COUNT } from './constants.js';

export function clamp100(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

export function dot(a, b, len = DIM_COUNT) {
  let sum = 0;
  for (let i = 0; i < len; i++) sum += (a[i] || 0) * (b[i] || 0);
  return sum;
}

export function magnitude(vec, len = DIM_COUNT) {
  return Math.sqrt(dot(vec, vec, len));
}

export function isObjectiveVectorActive(values, threshold = 0.01) {
  return magnitude(values) > threshold;
}

function vecMean(vec, len = DIM_COUNT) {
  let s = 0;
  for (let i = 0; i < len; i++) s += (vec[i] || 0);
  return s / len;
}

// Mean-centered cosine (Pearson correlation) — strips the shared "generic
// occupation" common-mode baseline of O*NET vectors so fit scores actually
// spread out instead of clustering at ~0.70-0.85. Returns [-1,1]; cosinePercent
// clamps <0 to 0. MUST stay identical to assets/js/shared/onet-math.js cosine
// (explicit client/server parity invariant).
export function cosine(a, b, len = DIM_COUNT) {
  const ma = vecMean(a, len);
  const mb = vecMean(b, len);
  let dab = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    const da = (a[i] || 0) - ma;
    const db = (b[i] || 0) - mb;
    dab += da * db; na += da * da; nb += db * db;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dab / Math.sqrt(na * nb);
}

export function normalizeVector(vec, len = DIM_COUNT) {
  const mag = magnitude(vec, len);
  if (mag < 1e-6) return new Array(len).fill(0);
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = (vec[i] || 0) / mag;
  return out;
}

/** Cosine similarity as 0–100 (positive vectors → cos ∈ [0,1]) */
export function cosinePercent(cos) {
  return clamp100(Math.round((Number(cos) || 0) * 100));
}

export function computeFitPercent(userVec, careerVec) {
  return cosinePercent(cosine(userVec, careerVec));
}

/** Objective fit uses direction only (L2-normalized objective vs career). */
export function objectiveFitPercent(objectiveVec, careerVec, len = DIM_COUNT) {
  return cosinePercent(cosine(normalizeVector(objectiveVec, len), careerVec, len));
}

// ---- Fit chokepoints ----

// Stamps every stored fit percent (KV rank keys, stretch-fit caches, portal
// snapshots) so a cache written by one formula can never be served under
// another. Bump it in BOTH math files whenever a chokepoint's output moves.
export const FIT_MATH_VERSION = 4;

// THE personality-fit chokepoint. Every personality fit percent in the app,
// client and server, comes from here; no call site composes
// cosinePercent(cosine(personality, ...)) itself.
//
// This is the mean-centered cosine, restored 2026-07-21 after the
// baseline-subtracted ("distinctive") formula shipped and was rejected in use:
// it separated desk sectors well but compressed almost the whole catalog into
// single digits, which reads as no answer at all. Plain correlation trades that
// discrimination for a legible spread — see docs/FIT_MATH.md.
export function personalityFitPercent(userValues, careerVec, len = DIM_COUNT) {
  return cosinePercent(cosine(userValues, careerVec, len));
}

// THE display-fit chokepoint (server mirror). Every fit percent the product
// SHOWS is personality fit: how the way you like to work lines up with what a
// career actually involves.
//
// Objective fit is deliberately NOT folded in. It was, twice: as a 0.75/0.25
// blend, then as one correlation against the summed vector. Both mixed 'would I
// like this' with 'am I ready for this', which are different questions asked at
// different moments. Objective fit is still computed and still shown — beside
// personality fit, and driving preparedness, skill gaps and the stretch panel.
// MUST stay identical to assets/js/shared/onet-math.js displayFitPercent.
export function displayFitPercent(personalityValues, careerVec, len = DIM_COUNT) {
  if (!personalityValues || !personalityValues.length) return null;
  return personalityFitPercent(personalityValues, careerVec, len);
}
/**
 * FW2.0 A1 — server mirror of the browser fitContributions (assets/js/shared/onet-math.js)
 * so deep-dive narrative can cite the same numbers the UI drawer shows. Each
 * dim's product / (|u||c|) is its share of the correlation; returns top-k by
 * product, on the raw levels the plain correlation itself scores.
 */
export function fitContributions(userVec, careerVec, k = 3, labels = null) {
  if (!userVec || !careerVec) return [];
  const len = Math.min(userVec.length, careerVec.length) || DIM_COUNT;
  const n = len;
  const denom = magnitude(userVec, n) * magnitude(careerVec, n);
  const rows = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const d = i;
    const product = (userVec[i] || 0) * (careerVec[i] || 0);
    if (product <= 0) continue;
    total += product;
    rows.push({
      index: d,
      label: labels && labels[d] != null ? labels[d] : null,
      userScore: clamp100(userVec[d] || 0),
      careerWeight: clamp100(careerVec[d] || 0),
      product,
      contribution: denom > 0 ? product / denom : 0,
    });
  }
  rows.sort((a, b) => b.product - a.product);
  rows.forEach((r) => { r.share = total > 0 ? r.product / total : 0; });
  return rows.slice(0, k > 0 ? k : 3);
}

export function computeGapVector(objectiveVec, careerVec, importanceVec) {
  const gaps = [];
  for (let i = 0; i < DIM_COUNT; i++) {
    const gap = Math.max(0, (careerVec[i] || 0) - (objectiveVec[i] || 0));
    const weight = (importanceVec?.[i] ?? 50) / 100;
    gaps.push({ index: i, gap: gap * weight, rawGap: gap });
  }
  gaps.sort((a, b) => b.gap - a.gap);
  return gaps;
}

export function demandScoreFromJobZone(jobZone) {
  const jz = Number(jobZone);
  if (!Number.isFinite(jz)) return 50;
  return clamp100(40 + jz * 12);
}

export function percentileInSample(value, sample) {
  if (!sample?.length) return 50;
  const sorted = [...sample].sort((a, b) => a - b);
  let below = 0;
  for (const v of sorted) if (v <= value) below++;
  return clamp100((below / sorted.length) * 100);
}

export function computePreparedness(objectiveVec, careerVec) {
  const careerMagSq = dot(careerVec, careerVec);
  if (!careerMagSq) return null;
  return clamp100((100 * dot(objectiveVec, careerVec)) / careerMagSq);
}

export function blendVectors(vectors, weights) {
  const out = new Array(DIM_COUNT).fill(0);
  let wSum = 0;
  vectors.forEach((vec, i) => {
    const w = weights[i] || 0;
    wSum += w;
    for (let d = 0; d < DIM_COUNT; d++) out[d] += (vec[d] || 0) * w;
  });
  if (wSum > 0) {
    for (let d = 0; d < DIM_COUNT; d++) out[d] /= wSum;
  }
  return out;
}

// ---- Onboarding layer gating ----
// Onboarding stacks several sources (quiz seed, sharpen, know-you / resume) onto
// ONE personality vector. Ungated, each source adds positive mass in a slightly
// different direction, the sum drifts back toward the generic-occupation
// baseline, and every career ends up scoring the same middling percent. So each
// source's pending deltas are gated against the vector they land on, and the
// whole layer is then held to an L1 budget so no single source can out-shout the
// seed. MUST stay identical to assets/js/shared/onet-math.js gateLayerDeltas
// (client/server parity).
export const LAYER_GAIN_ALIGNED = 1;    // sharpens a direction the vector already has
export const LAYER_GAIN_OPEN = 0.5;     // opens a dim the vector has no opinion on
export const LAYER_GAIN_OPPOSED = 0.25; // fights the direction — new info still moves it, slowly

// `center` is the vector's neutral point: 50 for personality (an O*NET level
// profile), 0 for objective (a sparse target vector built up from nothing).
export function gateLayerDeltas(baseValues, pending, budget, center = 50) {
  const out = new Array(pending.length);
  let total = 0;
  for (let i = 0; i < pending.length; i++) {
    const delta = Number(pending[i]) || 0;
    if (!delta) { out[i] = 0; continue; }
    const base = Number(baseValues && baseValues[i]) || 0;
    const d = base - center;
    let gain;
    if (base === 0 || d === 0) gain = LAYER_GAIN_OPEN;
    else gain = ((delta > 0) === (d > 0)) ? LAYER_GAIN_ALIGNED : LAYER_GAIN_OPPOSED;
    out[i] = delta * gain;
    total += Math.abs(out[i]);
  }
  if (budget > 0 && total > budget) {
    const k = budget / total;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}

export function emptyVector(fill = 0) {
  return new Array(DIM_COUNT).fill(fill);
}

export function vectorVariance(vec) {
  const mean = vec.reduce((s, v) => s + v, 0) / DIM_COUNT;
  return vec.reduce((s, v) => s + (v - mean) ** 2, 0) / DIM_COUNT;
}
