import { SCHEMA_ID, DIM_COUNT } from './constants.js';
import { emptyVector, clamp100, cosine, cosinePercent } from './math.js';

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
    };
  }

  let totalWeight = 0;
  for (const item of ranked) {
    const zone = SECTOR_TO_ZONE[item.key] || item.key;
    const centroid = zoneCentroids?.[zone];
    if (!centroid || centroid.length !== DIM_COUNT) continue;
    const w = (item.score / 100) ** 2;
    totalWeight += w;
    for (let i = 0; i < DIM_COUNT; i++) {
      values[i] += centroid[i] * w;
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < DIM_COUNT; i++) values[i] /= totalWeight;
  }

  for (let i = 0; i < DIM_COUNT; i++) {
    values[i] = clamp100(50 + (values[i] - 50) * 1.6);
    if (Math.abs(values[i] - 50) < 10) {
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
  };
}

export function seedPersonalityFromQuiz(scores, zoneCentroids) {
  return decisiveSeedPersonalityFromQuiz(scores, zoneCentroids);
}

export function projectSectorScoresFromPersonality(personalityVec, zoneCentroids) {
  const scores = {};
  for (const key of SECTOR_KEYS) {
    const zone = SECTOR_TO_ZONE[key] || key;
    const centroid = zoneCentroids?.[zone];
    if (!centroid) { scores[key] = 0; continue; }
    scores[key] = cosinePercent(cosine(personalityVec, centroid));
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

export function bleedPersonalityFromObjectiveDelta(personalityVec, beforeObjectiveValues, afterObjectiveValues) {
  if (!personalityVec?.values?.length || !afterObjectiveValues?.length) return personalityVec;
  const before = beforeObjectiveValues || [];
  const values = [...personalityVec.values];
  const confidence = [...(personalityVec.confidence || new Array(DIM_COUNT).fill('estimated'))];
  let changed = false;
  for (let i = 0; i < DIM_COUNT; i += 1) {
    const delta = (afterObjectiveValues[i] || 0) - (before[i] || 0);
    if (!delta) continue;
    values[i] = clamp100(values[i] + PERSONALITY_OBJECTIVE_BLEED * delta);
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
