import { getVectorsForSocs, getMagnitudeSample } from './vectors.js';
import { getCareers } from './store.js';
import {
  computeFitPercent,
  objectiveFitPercent,
  overallFitScore,
  computePreparedness,
  computeGapVector,
  isObjectiveVectorActive,
} from './math.js';
import { ensureUserVectors } from './user-vectors.js';

async function loadZoneCentroids(baseUrl) {
  const res = await fetch(new URL('/data/onet/artifacts/zone-centroids.json', baseUrl).toString());
  if (!res.ok) return null;
  return res.json();
}

export async function computeVectorFitForSoc(env, baseUrl, quiz, soc) {
  if (!soc || !quiz) return null;
  const zoneCentroids = await loadZoneCentroids(baseUrl);
  const quizWithVectors = zoneCentroids ? ensureUserVectors({ ...quiz }, zoneCentroids) : quiz;
  const personality = quizWithVectors?.personalityVector?.values || null;
  const objective = quizWithVectors?.objectiveVector?.values || null;
  const objectiveActive = isObjectiveVectorActive(objective);
  if (!personality) return null;

  const [vectorResult, careers, magSample] = await Promise.all([
    getVectorsForSocs(env, baseUrl, [soc]),
    getCareers(env, baseUrl),
    getMagnitudeSample(env, baseUrl),
  ]);
  if (vectorResult.error) return null;
  const careerVec = vectorResult.vectors[soc];
  if (!careerVec) return null;
  const importance = vectorResult.importance[soc];
  const meta = careers.find((c) => c.soc === soc);

  const entry = { soc };
  entry.personalityFit = computeFitPercent(personality, careerVec);
  if (objectiveActive) {
    entry.objectiveFit = objectiveFitPercent(objective, careerVec);
    entry.preparedness = computePreparedness(objective, careerVec, {
      jobZone: meta?.jobZone,
      magnitudeSample: magSample,
    });
    entry.topGaps = computeGapVector(objective, careerVec, importance)
      .slice(0, 5)
      .map((g) => ({ index: g.index, gap: Math.round(g.gap * 10) / 10 }));
  }
  entry.fitScore = overallFitScore(entry.personalityFit, entry.objectiveFit ?? null);
  return entry;
}
