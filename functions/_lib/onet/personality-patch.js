import { callGeminiJson } from '../gemini-json.js';
import { checkRateLimit, loadQuizProfile, saveQuizProfile } from '../auth.js';
import { loadDossier } from '../../_lib.js';
import { DIM_COUNT, GEMINI_CAREER_BATCH_DISABLED, SCHEMA_ID } from './constants.js';
import { clamp100, vectorVariance } from './math.js';
import { ensureUserVectors, projectSectorScoresFromPersonality } from './user-vectors.js';
import { ensureSectorFitSheet, applySectorPatches } from '../sector-fit-sheet.js';
import { getRegistry } from './store.js';
import { maybeSmallAlignAfterSectorPatch } from '../profile-alignment.js';

const CONTEXT_MAX = 3000;
const DOSSIER_EXCERPT_MAX = 4000;
const RATE_LIMIT_PERSONALITY_PATCH_MAX = 30;
const MIN_VARIANCE = 80;

async function loadZoneCentroids(env, baseUrl) {
  const url = new URL('/data/onet/artifacts/zone-centroids.json', baseUrl).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('zone-centroids unavailable');
  return res.json();
}

export async function patchPersonalityFromLearning(env, baseUrl, { quiz, dossier = '', source, contextText = '' }) {
  if (GEMINI_CAREER_BATCH_DISABLED) {
    // Personality patch is per-user only — never batch careers.
  }

  const zoneCentroids = await loadZoneCentroids(env, baseUrl);
  ensureUserVectors(quiz, zoneCentroids);
  ensureSectorFitSheet(quiz);

  const registry = await getRegistry(env, baseUrl);
  const dimList = registry.dimensions.slice(0, 40).map((d) => `${d.index}:${d.elementId}:${d.name}`).join('\n');
  const current = quiz.personalityVector.values;

  const ctx = String(contextText || '').trim().slice(0, CONTEXT_MAX);
  const dossierExcerpt = String(dossier || '').trim().slice(0, DOSSIER_EXCERPT_MAX);

  const prompt = `Update a student's O*NET personality vector (${DIM_COUNT} dimensions, each 0-100).
Return ONLY JSON: { "updates": [ { "index": 0-${DIM_COUNT - 1}, "value": 0-100, "confidence": "dossier-inferred"|"estimated", "reason": "short" } ] }

Rules:
- Include 10–18 dimensions that should change based on NEW learning below.
- Values must be polarized: prefer ≤25 or ≥75; avoid the mushy 40–60 band unless strongly justified.
- At least 40% of updated dimensions must be 0 or ≤15 (sparse profile).
- Max ±25 change per dimension per patch.
- Do NOT reference careers or occupations — only user traits.
- If nothing should change, return { "updates": [] }

Sample dimension ids (index:elementId:name):
${dimList}
... (${DIM_COUNT} total)

Current vector sample (first 20): ${current.slice(0, 20).map((v) => Math.round(v)).join(', ')}

Learning source: ${source}
${ctx ? `\nNew context:\n${ctx}` : ''}
${dossierExcerpt ? `\nCoach dossier excerpt:\n${dossierExcerpt}` : ''}`;

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.35,
      maxTokens: 1200,
      jsonMode: true,
      label: 'personality-vector-patch',
      softFail: true,
    });
    if (!raw || typeof raw !== 'object') {
      return { quiz, changed: false, changes: [] };
    }

    const updates = Array.isArray(raw.updates) ? raw.updates : [];
    const changes = [];
    const values = [...quiz.personalityVector.values];
    const confidence = [...quiz.personalityVector.confidence];

    for (const u of updates.slice(0, 20)) {
      const idx = Number(u.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= DIM_COUNT) continue;
      const prev = values[idx];
      const next = clamp100(u.value);
      if (next === prev) continue;
      if (Math.abs(next - prev) > 25) continue;
      values[idx] = next;
      confidence[idx] = u.confidence === 'dossier-inferred' ? 'dossier-inferred' : 'estimated';
      changes.push({
        index: idx,
        from: prev,
        to: next,
        reason: String(u.reason || '').slice(0, 120),
        source: source || 'gemini-patch',
      });
    }

    if (!changes.length) {
      return { quiz, changed: false, changes: [] };
    }

    quiz.personalityVector = {
      ...quiz.personalityVector,
      values,
      confidence,
      updatedAt: new Date().toISOString(),
      source: source === 'profile-building' ? 'profile-building' : 'gemini-patch',
    };

    const variance = vectorVariance(values);
    if (variance < MIN_VARIANCE) {
      quiz.personalityVector.lowConfidence = true;
    }

    const projected = projectSectorScoresFromPersonality(values, zoneCentroids);
    const sectorPatches = Object.entries(projected).map(([key, score]) => ({ key, score }));
    applySectorPatches(quiz.sectorFitSheet, sectorPatches, { source: 'vector-projection' });
    quiz.scores = { ...quiz.sectorFitSheet.scores };

    return { quiz, changed: true, changes };
  } catch (err) {
    console.warn('patchPersonalityFromLearning failed', err);
    return { quiz, changed: false, changes: [] };
  }
}

export async function patchPersonalityFromResume(env, baseUrl, { quiz, dossier = '', resumeText = '', summary = '', highlights = [] }) {
  const zoneCentroids = await loadZoneCentroids(env, baseUrl);
  ensureUserVectors(quiz, zoneCentroids);
  ensureSectorFitSheet(quiz);

  const registry = await getRegistry(env, baseUrl);
  const dimList = registry.dimensions.slice(0, 40).map((d) => `${d.index}:${d.elementId}:${d.name}`).join('\n');
  const current = quiz.personalityVector.values;

  const ctx = [
    summary,
    Array.isArray(highlights) ? highlights.join('; ') : '',
    String(resumeText || '').slice(0, 2000),
  ].filter(Boolean).join('\n').slice(0, CONTEXT_MAX);
  const dossierExcerpt = String(dossier || '').trim().slice(0, DOSSIER_EXCERPT_MAX);

  const prompt = `Nudge a student's O*NET personality vector (${DIM_COUNT} dimensions, each 0-100) based on resume work-style signals.
Return ONLY JSON: { "updates": [ { "index": 0-${DIM_COUNT - 1}, "value": 0-100, "confidence": "dossier-inferred"|"estimated", "reason": "short" } ] }

Rules:
- Include only 5–10 dimensions with clear resume evidence (collaboration style, pace, structure preference, etc.).
- This is a LIGHT touch — max ±12 change per dimension.
- Do NOT update capability/skill dimensions (leave those to the objective vector).
- Do NOT reference careers or occupations — only inferred work-style traits.
- If nothing should change, return { "updates": [] }

Sample dimension ids (index:elementId:name):
${dimList}
... (${DIM_COUNT} total)

Current vector sample (first 20): ${current.slice(0, 20).map((v) => Math.round(v)).join(', ')}

Resume context:
${ctx}
${dossierExcerpt ? `\nCoach dossier excerpt:\n${dossierExcerpt}` : ''}`;

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.3,
      maxTokens: 900,
      jsonMode: true,
      label: 'personality-resume-patch',
      softFail: true,
    });
    if (!raw || typeof raw !== 'object') {
      return { quiz, changed: false, changes: [] };
    }

    const updates = Array.isArray(raw.updates) ? raw.updates : [];
    const changes = [];
    const values = [...quiz.personalityVector.values];
    const confidence = [...quiz.personalityVector.confidence];
    const MAX_RESUME_DELTA = 12;

    for (const u of updates.slice(0, 10)) {
      const idx = Number(u.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= DIM_COUNT) continue;
      const prev = values[idx];
      const next = clamp100(u.value);
      if (next === prev) continue;
      if (Math.abs(next - prev) > MAX_RESUME_DELTA) continue;
      values[idx] = next;
      confidence[idx] = u.confidence === 'dossier-inferred' ? 'dossier-inferred' : 'estimated';
      changes.push({
        index: idx,
        from: prev,
        to: next,
        reason: String(u.reason || '').slice(0, 120),
        source: 'resume-gemini',
      });
    }

    if (!changes.length) {
      return { quiz, changed: false, changes: [] };
    }

    quiz.personalityVector = {
      ...quiz.personalityVector,
      values,
      confidence,
      updatedAt: new Date().toISOString(),
      source: 'resume-gemini',
    };

    const variance = vectorVariance(values);
    if (variance < MIN_VARIANCE) {
      quiz.personalityVector.lowConfidence = true;
    }

    const projected = projectSectorScoresFromPersonality(values, zoneCentroids);
    const sectorPatches = Object.entries(projected).map(([key, score]) => ({ key, score }));
    applySectorPatches(quiz.sectorFitSheet, sectorPatches, { source: 'vector-projection' });
    quiz.scores = { ...quiz.sectorFitSheet.scores };

    return { quiz, changed: true, changes };
  } catch (err) {
    console.warn('patchPersonalityFromResume failed', err);
    return { quiz, changed: false, changes: [] };
  }
}

export async function maybePatchPersonalityForUser(env, email, { source, contextText = '', baseUrl }) {
  const rlKey = `personality_patch:${email}`;
  try {
    await checkRateLimit(env, rlKey, { max: RATE_LIMIT_PERSONALITY_PATCH_MAX });
  } catch {
    return { skipped: true, reason: 'rate_limit' };
  }

  const quiz = await loadQuizProfile(env, email);
  if (!quiz) return { skipped: true, reason: 'no_profile' };

  const dossier = await loadDossier(env, email).catch(() => '');
  const result = await patchPersonalityFromLearning(env, baseUrl, {
    quiz,
    dossier,
    source,
    contextText,
  });

  if (result.changed) {
    await saveQuizProfile(env, email, result.quiz);
    await maybeSmallAlignAfterSectorPatch(env, email, result.quiz.sectorFitSheet).catch(() => {});
  }

  return result;
}
