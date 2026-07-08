// Canonical user-profile accessor.
//
// FlightWay uses the normalized session email as the single canonical profile
// id across every storage backend. All four profile sub-resources resolve
// through this module so callers never hand-build storage keys:
//   - quiz profile   -> D1  quiz_profiles.email
//   - dossier        -> KV  dossier:{email}
//   - roadmap        -> D1  roadmaps.email
//   - career analyses-> D1  career_analyses (email, slug)
// Ephemeral chat state also lives in KV under the prefixes below.

import { loadDossier } from '../_lib.js';
import {
  loadQuizProfile,
  loadRoadmap,
  loadCareerAnalyses,
  ANALYSIS_FRESH_MS,
} from './auth.js';

// Canonical KV key builders (email is the canonical id).
export const profileKeys = {
  dossier: (email) => `dossier:${email}`,
  coachChat: (email) => `chat:${email}`,
  careerChat: (email, slug) => `career-chat:${email}:${slug}`,
};

function isFresh(updatedAt) {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) < ANALYSIS_FRESH_MS;
}

// Keep only fresh analyses and shape them as a { slug: analysis } map for the client cache.
function freshAnalysisMap(analyses) {
  const map = {};
  for (const row of analyses || []) {
    if (row && row.slug && row.payload && isFresh(row.updatedAt)) {
      map[row.slug] = row.payload;
    }
  }
  return map;
}

/** In-request memoization so handlers do not re-read D1/KV for quiz, dossier, roadmap. */
export function createProfileCache(env, email) {
  let quizP;
  let dossierP;
  let roadmapP;
  return {
    getQuiz: () => quizP ??= loadQuizProfile(env, email).catch(() => null),
    getDossier: () => dossierP ??= loadDossier(env, email).catch(() => ''),
    getRoadmap: () => roadmapP ??= loadRoadmap(env, email).catch(() => null),
  };
}

// Load every profile sub-resource for a session email in parallel.
export async function loadFullProfile(env, email) {
  const [quiz, dossier, roadmap, analyses] = await Promise.all([
    loadQuizProfile(env, email).catch(() => null),
    loadDossier(env, email).catch(() => null),
    loadRoadmap(env, email).catch(() => null),
    loadCareerAnalyses(env, email).catch(() => []),
  ]);
  return {
    email,
    quiz: quiz || null,
    dossier: dossier || null,
    roadmap: roadmap || null,
    analyses: freshAnalysisMap(analyses),
  };
}
