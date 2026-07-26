import { SCHEMA_ID, DIM_COUNT } from './constants.js';
import {
  emptyVector, clamp100, gateLayerDeltas, personalityFitPercent,
} from './math.js';

const SECTOR_KEYS = [
  'tech', 'healthcare', 'finance', 'creative', 'education', 'business', 'law',
  'engineering', 'science', 'startups', 'social', 'marketing', 'trades', 'media',
  'government', 'cybersecurity', 'operations', 'hospitality', 'aerospace',
  'pharmaceutical', 'sports', 'realestate', 'hr', 'agriculture',
];

const SECTOR_TO_ZONE = {
  tech: 'tech', healthcare: 'healthcare', finance: 'finance', creative: 'creative',
  education: 'education', business: 'business', law: 'law', engineering: 'engineering',
  science: 'science', startups: 'business', social: 'social', marketing: 'marketing',
  trades: 'trades', media: 'media', government: 'government', cybersecurity: 'cybersecurity',
  operations: 'operations', hospitality: 'hospitality', aerospace: 'engineering',
  pharmaceutical: 'pharmaceutical', sports: 'sports', realestate: 'realestate',
  hr: 'hr', agriculture: 'agriculture',
};

// Seed gain (parity: assets/js/shared/onet-vectors.js — same constants, same
// values, verified by npm run test:vectors).
// The seed blends the top-3 sector centroids, and three broadly-similar
// occupation centroids average out to something close to the generic occupation
// — a direction that fits everything a little and nothing much. Two corrections:
// the blend weight is steep enough that the declared top sector dominates
// (90-vs-60 reads ~7.6:1, not 2.25:1), and the contrast expansion is stronger on
// the dimensions the top sector commits to, so the result stays on that axis.
// Everything is measured from the per-dimension "generic occupation" baseline
// (the mean across every zone centroid), not from a literal 50: fit is a
// mean-centered cosine precisely because O*NET level vectors sit on a large
// shared baseline well off 50, so 50 is not the neutral point and gating against
// it barely discriminates.
// Generation stamp on the seed's output — bumped whenever the seed's math
// changes, so a stored vector can be told apart from one today's seed would
// produce. Gen 2 is fix 1.3's sharpened seed. The server STAMPS but never
// drops: `ensureUserVectors` seeds only when there is no vector at all, and
// the re-seed decision needs the quiz scores AND the centroids together, which
// is the client's hydrate. Parity: assets/js/shared/onet-vectors.js.
export const PERSONALITY_SEED_GEN = 2;
const SEED_WEIGHT_EXPONENT = 5;
const SEED_GAIN_ALIGNED = 3;
const SEED_GAIN_OTHER = 0.75;
const SEED_TOP_COMMIT = 8;  // |topCentroid - baseline| below this is not a commitment
const SEED_ZERO_BAND = 6;   // post-gain |v - its own mean| below this reads as "no signal"

function vectorMean(vec) {
  let s = 0;
  for (let i = 0; i < DIM_COUNT; i++) s += Number(vec[i]) || 0;
  return s / DIM_COUNT;
}

// Every sector scores high on reading, speaking and critical thinking and low on
// wrist-finger speed, so those dimensions say nothing about WHICH sector — only
// a dimension's departure from this baseline does.
function zoneBaselineVector(zoneCentroids) {
  const keys = zoneCentroids ? Object.keys(zoneCentroids) : [];
  const out = emptyVector(0);
  let used = 0;
  for (const k of keys) {
    const c = zoneCentroids[k];
    if (!c || c.length !== DIM_COUNT) continue;
    used++;
    for (let i = 0; i < DIM_COUNT; i++) out[i] += Number(c[i]) || 0;
  }
  if (!used) return null;
  for (let i = 0; i < DIM_COUNT; i++) out[i] /= used;
  return out;
}

export function decisiveSeedPersonalityFromQuiz(scores, zoneCentroids) {
  const ranked = SECTOR_KEYS.map((key) => ({
    key,
    score: Number(scores?.[key]) || 0,
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const values = emptyVector(0);
  const confidence = new Array(DIM_COUNT).fill('estimated');

  if (!ranked.length) {
    return {
      schemaId: SCHEMA_ID,
      values,
      confidence,
      updatedAt: new Date().toISOString(),
      source: 'quiz-seed',
      seedGen: PERSONALITY_SEED_GEN,
    };
  }

  let totalWeight = 0;
  for (const item of ranked) {
    const zone = SECTOR_TO_ZONE[item.key] || item.key;
    const centroid = zoneCentroids?.[zone];
    if (!centroid || centroid.length !== DIM_COUNT) continue;
    const w = (item.score / 100) ** SEED_WEIGHT_EXPONENT;
    totalWeight += w;
    for (let i = 0; i < DIM_COUNT; i++) {
      values[i] += centroid[i] * w;
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < DIM_COUNT; i++) values[i] /= totalWeight;
  }

  const topZone = SECTOR_TO_ZONE[ranked[0].key] || ranked[0].key;
  const topRaw = zoneCentroids?.[topZone];
  const topCentroid = (topRaw && topRaw.length === DIM_COUNT) ? topRaw : null;
  const baseline = zoneBaselineVector(zoneCentroids);

  for (let i = 0; i < DIM_COUNT; i++) {
    const b = baseline ? baseline[i] : 50;
    const d = values[i] - b;
    const t = topCentroid ? topCentroid[i] - b : 0;
    const aligned = d !== 0 && Math.abs(t) >= SEED_TOP_COMMIT && (d > 0) === (t > 0);
    values[i] = clamp100(b + d * (aligned ? SEED_GAIN_ALIGNED : SEED_GAIN_OTHER));
  }
  // Zeroing runs against the amplified vector's own mean, not the baseline: a
  // dimension is "no signal" when it fails to stand out from the rest of THIS
  // user's profile. Zeroed dims are what make the vector discriminate — an
  // all-dimensions-populated vector correlates with every occupation.
  const vMean = vectorMean(values);
  for (let i = 0; i < DIM_COUNT; i++) {
    if (Math.abs(values[i] - vMean) < SEED_ZERO_BAND) {
      values[i] = 0;
      confidence[i] = 'estimated';
    } else {
      confidence[i] = 'quiz-anchored';
    }
  }

  return {
    schemaId: SCHEMA_ID,
    values,
    confidence,
    updatedAt: new Date().toISOString(),
    source: 'quiz-seed',
    seedGen: PERSONALITY_SEED_GEN,
  };
}

export function seedPersonalityFromQuiz(scores, zoneCentroids) {
  return decisiveSeedPersonalityFromQuiz(scores, zoneCentroids);
}

// Projecting a learned personality vector back onto the sector sheet must mean
// the same thing the portal's sector bars mean, or the two disagree on the same
// screen — so it goes through the fit chokepoint rather than composing its own
// cosine (distinctive-fit masterplan, decision 7). Guarded by the round-trip
// assertion in npm run test:vectors: re-seeding from these projected scores
// still ranks the persona's home zone #1.
export function projectSectorScoresFromPersonality(personalityVec, zoneCentroids) {
  const scores = {};
  for (const key of SECTOR_KEYS) {
    const zone = SECTOR_TO_ZONE[key] || key;
    const centroid = zoneCentroids?.[zone];
    if (!centroid) { scores[key] = 0; continue; }
    scores[key] = personalityFitPercent(personalityVec, centroid);
  }
  return scores;
}

export function ensureUserVectors(quiz, zoneCentroids) {
  if (!quiz || typeof quiz !== 'object') return quiz;
  quiz.vectorSchemaId = SCHEMA_ID;

  if (!quiz.personalityVector?.values?.length) {
    const scores = quiz.sectorFitSheet?.scores || quiz.scores || {};
    quiz.personalityVector = seedPersonalityFromQuiz(scores, zoneCentroids);
  }
  if (!quiz.objectiveVector?.values?.length) {
    quiz.objectiveVector = {
      schemaId: SCHEMA_ID,
      values: emptyVector(0),
      sources: [],
      updatedAt: new Date().toISOString(),
      source: 'empty',
    };
  }
  return quiz;
}

/** Resume/objective bumps also nudge personality on the same dimensions (light touch). */
export const PERSONALITY_OBJECTIVE_BLEED = 0.2;
// Know-you / resume text reaches personality only through this bleed, and the
// objective layer it bleeds from touches most of the vector — so it gets the
// same direction gate and L1 budget as sharpen, one notch looser because the
// text is the user's own words rather than five slider positions.
// Parity: assets/js/shared/onet-vectors.js.
export const BLEED_L1_BUDGET = 150;

export function bleedPersonalityFromObjectiveDelta(personalityVec, beforeObjectiveValues, afterObjectiveValues) {
  if (!personalityVec?.values?.length || !afterObjectiveValues?.length) return personalityVec;
  const before = beforeObjectiveValues || [];
  const values = [...personalityVec.values];
  const confidence = [...(personalityVec.confidence || new Array(DIM_COUNT).fill('estimated'))];
  const pending = new Array(DIM_COUNT);
  for (let i = 0; i < DIM_COUNT; i += 1) {
    pending[i] = PERSONALITY_OBJECTIVE_BLEED * ((afterObjectiveValues[i] || 0) - (before[i] || 0));
  }
  const bleed = gateLayerDeltas(values, pending, BLEED_L1_BUDGET, 50);
  let changed = false;
  for (let i = 0; i < DIM_COUNT; i += 1) {
    const delta = bleed[i];
    if (!delta) continue;
    values[i] = clamp100(values[i] + delta);
    if (!confidence[i] || confidence[i] === 'estimated') confidence[i] = 'resume-bleed';
    changed = true;
  }
  if (!changed) return personalityVec;
  return {
    ...personalityVec,
    values,
    confidence,
    updatedAt: new Date().toISOString(),
    source: personalityVec.source || 'resume-bleed',
  };
}

export { SECTOR_KEYS, SECTOR_TO_ZONE };
