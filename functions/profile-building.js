import {
  originFromEnv,
  loadDossier,
  buildSeedDossier,
} from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  optionalSession,
} from './_lib/auth.js';
import {
  normalizeProfileAnswers,
  dossierFromProfileBuildingPrompt,
  mergeDossierFromPrompt,
  synthesizeIdentityAnalysis,
} from './_lib/dossier-enrich.js';
import { topIndustryKeys } from './_lib/portal-snapshot.js';
import { loadUserBlob, saveUserBlob } from './_lib/user.js';
import { maybeSyncRoadmap } from './_lib/roadmap-sync.js';
import { maybePatchSectorFitForUser } from './_lib/sector-fit-sheet.js';

const RESPONSE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => { setTimeout(() => resolve(null), ms); }),
  ]);
}

function industryNamesFromScores(scores) {
  return topIndustryKeys(scores, 3).map((k) => (
    String(k).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  ));
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  if (request.method === 'OPTIONS') return authPreflight(origin);
  if (request.method !== 'POST') return authJsonResponse(405, { error: 'Method not allowed' }, origin);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const answers = normalizeProfileAnswers(payload.answers);
  if (!answers.length) {
    return authJsonResponse(400, { error: 'Provide at least one answer.' }, origin);
  }

  const session = await optionalSession(request, env);
  const email = session?.email || null;

  let dossierUpdated = false;
  let characterSummary = '';

  if (email) {
    const dossierPromise = (async () => {
      const dossier = (await loadDossier(env, email)) || buildSeedDossier({});
      const fullPrompt = dossierFromProfileBuildingPrompt(answers, dossier);
      return mergeDossierFromPrompt(env, email, fullPrompt, { currentDossier: dossier });
    })();

    const dossierResult = await withTimeout(dossierPromise, RESPONSE_TIMEOUT_MS);
    if (dossierResult) dossierUpdated = true;

    try {
      const quiz = (await loadUserBlob(env, email)) || {};
      const identityContext = {
        userName: quiz.name || payload.userName || 'Student',
        archetype: quiz.archetype || '',
        topIndustries: industryNamesFromScores(quiz.scores),
      };
      const identityText = await synthesizeIdentityAnalysis(env, answers, identityContext);
      if (identityText) characterSummary = identityText.slice(0, 900);

      if (!quiz.profileBuilding) quiz.profileBuilding = {};
      quiz.profileBuilding.answers = answers;
      quiz.profileBuilding.completedAt = new Date().toISOString();
      if (characterSummary) quiz.characterSummary = characterSummary;
      await saveUserBlob(env, email, quiz);
    } catch (err) {
      console.warn('profile-building quiz patch failed', err);
    }
  }

  let roadmapSync = null;
  if (email && dossierUpdated) {
    try {
      roadmapSync = await maybeSyncRoadmap(env, email, { reason: 'profile-building' });
    } catch (err) {
      console.warn('profile-building roadmap sync failed', err);
    }
  }

  let sectorPatch = null;
  if (email) {
    const pbContext = answers.map((a) => `${a.prompt}: ${a.answer}`).join('\n');
    sectorPatch = await maybePatchSectorFitForUser(env, email, {
      source: 'profile-building',
      contextText: pbContext,
      baseUrl: origin,
    });
  }

  return authJsonResponse(200, {
    ok: true,
    dossierUpdated,
    characterSummary: characterSummary || undefined,
    roadmapUpdated: !!(roadmapSync && !roadmapSync.cached),
    roadmapRetargeted: !!(roadmapSync && roadmapSync.retargeted),
    roadmap: roadmapSync?.roadmap || undefined,
    sectorFitSheet: sectorPatch?.sectorFitSheet || undefined,
    sectorFitUpdated: !!(sectorPatch && sectorPatch.changed),
    personalityVector: sectorPatch?.personalityVector || undefined,
    personalityPatch: (sectorPatch?.changes && sectorPatch.changes.length)
      ? { dimensions: sectorPatch.changes, source: 'profile-building' }
      : undefined,
    personalityPatchFailed: sectorPatch?.personalityPatchFailed || undefined,
  }, origin);
}
