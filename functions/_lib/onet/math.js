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

/**
 * FW2.0 A1 — server mirror of the browser fitContributions (assets/js/shared/onet-math.js)
 * so deep-dive narrative can cite the same numbers the UI drawer shows. Each
 * dim's u_i*c_i / (|u||c|) is its share of the cosine fit; returns top-k by product.
 */
export function fitContributions(userVec, careerVec, k = 3, labels = null) {
  if (!userVec || !careerVec) return [];
  const len = Math.min(userVec.length, careerVec.length) || DIM_COUNT;
  const denom = magnitude(userVec, len) * magnitude(careerVec, len);
  const rows = [];
  let total = 0;
  for (let i = 0; i < len; i++) {
    const u = userVec[i] || 0;
    const c = careerVec[i] || 0;
    const product = u * c;
    if (product <= 0) continue;
    total += product;
    rows.push({
      index: i,
      label: labels && labels[i] != null ? labels[i] : null,
      userScore: clamp100(u),
      careerWeight: clamp100(c),
      product,
      contribution: denom > 0 ? product / denom : 0,
    });
  }
  rows.sort((a, b) => b.product - a.product);
  rows.forEach((r) => { r.share = total > 0 ? r.product / total : 0; });
  return rows.slice(0, k > 0 ? k : 3);
}

/** Combined display fit: 75% personality + 25% objective (personality-only when objective absent). */
export function overallFitScore(personalityFit, objectiveFit) {
  if (personalityFit == null) return null;
  if (objectiveFit == null) return personalityFit;
  return Math.round(0.75 * personalityFit + 0.25 * objectiveFit);
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

export function emptyVector(fill = 0) {
  return new Array(DIM_COUNT).fill(fill);
}

export function vectorVariance(vec) {
  const mean = vec.reduce((s, v) => s + v, 0) / DIM_COUNT;
  return vec.reduce((s, v) => s + (v - mean) ** 2, 0) / DIM_COUNT;
}
