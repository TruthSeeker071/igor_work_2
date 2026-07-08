import { callGeminiJson } from '../gemini-json.js';
import { checkRateLimit, loadQuizProfile, saveQuizProfile } from '../auth.js';
import { loadDossier } from '../../_lib.js';
import { DIM_COUNT } from './constants.js';
import { clamp100 } from './math.js';
import { getRegistry } from './store.js';

const CONTEXT_MAX = 4000;
const RESUME_EXCERPT_MAX = 6000;
const RATE_LIMIT_OBJECTIVE_PATCH_MAX = 30;
const MAX_PATCH_DIMENSIONS = 40;
const DOSSIER_EXCERPT_LEARNING_MAX = 4000;

/**
 * AI objective patches live in quiz.objectiveAiPatch — a replayable record of
 * absolute values per dimension. The objective vector is REBUILT from rules
 * (academics → refine → resume) on every hydration, client and server, so a
 * patch applied only to the vector is silently lost on the next rebuild.
 * Every rebuild replays this record as its final step instead.
 */
export function mergeObjectiveAiPatch(existing, changes, source) {
  const byIndex = new Map();
  (existing?.dimensions || []).forEach((d) => {
    const idx = Number(d.index);
    if (Number.isInteger(idx) && idx >= 0 && idx < DIM_COUNT) {
      byIndex.set(idx, clamp100(d.value != null ? d.value : d.to));
    }
  });
  (changes || []).forEach((c) => {
    const idx = Number(c.index);
    if (Number.isInteger(idx) && idx >= 0 && idx < DIM_COUNT) {
      byIndex.set(idx, clamp100(c.value != null ? c.value : c.to));
    }
  });
  const dimensions = [...byIndex.entries()]
    .slice(-MAX_PATCH_DIMENSIONS)
    .map(([index, value]) => ({ index, value }));
  if (!dimensions.length) return existing || null;
  return {
    dimensions,
    source: source || existing?.source || 'ai-patch',
    updatedAt: new Date().toISOString(),
  };
}

export function applyObjectiveAiPatch(objectiveVec, patch) {
  if (!patch?.dimensions?.length) return objectiveVec;
  const values = [...(objectiveVec?.values || new Array(DIM_COUNT).fill(0))];
  const sources = [...(objectiveVec?.sources || new Array(DIM_COUNT).fill(null))];
  let changed = false;
  for (const d of patch.dimensions) {
    const idx = Number(d.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= DIM_COUNT) continue;
    const next = clamp100(d.value);
    if (values[idx] === next) continue;
    values[idx] = next;
    sources[idx] = 'ai-patch';
    changed = true;
  }
  if (!changed) return objectiveVec;
  return {
    schemaId: objectiveVec?.schemaId || 'onet-lv-161-v1',
    values,
    sources,
    updatedAt: new Date().toISOString(),
    source: objectiveVec?.source || 'ai-patch',
  };
}

/**
 * Gemini patch for objective vector from resume evidence (skills/knowledge/abilities).
 */
export async function patchObjectiveFromResume(env, baseUrl, {
  objectiveVector,
  resumeText = '',
  summary = '',
  highlights = [],
  dossier = '',
}) {
  const registry = await getRegistry(env, baseUrl);
  const dimList = registry.dimensions.slice(0, 40).map((d) => `${d.index}:${d.elementId}:${d.name}`).join('\n');
  const values = [...(objectiveVector?.values || new Array(DIM_COUNT).fill(0))];
  const sources = [...(objectiveVector?.sources || new Array(DIM_COUNT).fill(null))];

  const resumeExcerpt = [
    summary,
    Array.isArray(highlights) ? highlights.join('\n') : '',
    String(resumeText || ''),
  ].filter(Boolean).join('\n').slice(0, RESUME_EXCERPT_MAX);

  const dossierExcerpt = String(dossier || '').trim().slice(0, CONTEXT_MAX);

  const prompt = `Update a student's O*NET objective vector (${DIM_COUNT} dimensions, each 0-100) based on resume evidence.
Return ONLY JSON: { "updates": [ { "index": 0-${DIM_COUNT - 1}, "value": 0-100, "reason": "short" } ] }

Rules:
- Include 10–18 dimensions the resume clearly demonstrates (skills, tools, coursework, projects, certifications).
- Values reflect demonstrated capability (not personality): higher = stronger evidence on resume.
- Prefer polarized values (≤25 or ≥75) when evidence is clear; avoid mushy 40–60 unless justified.
- Max ±25 change per dimension per patch.
- Only update dimensions with resume evidence — do not guess personality traits.
- Sector-themed rules have already applied coarse sparse bumps; refine specific dimensions (e.g. machine learning vs game development) with evidence — do not re-inflate entire O*NET domains.
- If nothing should change, return { "updates": [] }

Sample dimension ids (index:elementId:name):
${dimList}
... (${DIM_COUNT} total)

Current objective vector sample (first 20): ${values.slice(0, 20).map((v) => Math.round(v)).join(', ')}

${dossierExcerpt ? `Coach dossier excerpt:\n${dossierExcerpt}\n` : ''}
Resume context:
${resumeExcerpt}`;

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.3,
      maxTokens: 1200,
      jsonMode: true,
      label: 'objective-vector-patch',
      softFail: true,
    });
    if (!raw || typeof raw !== 'object') {
      return { objectiveVector, changed: false, changes: [] };
    }

    const updates = Array.isArray(raw.updates) ? raw.updates : [];
    const changes = [];
    const nextValues = [...values];
    const nextSources = [...sources];

    for (const u of updates.slice(0, 20)) {
      const idx = Number(u.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= DIM_COUNT) continue;
      const prev = nextValues[idx];
      const next = clamp100(u.value);
      if (next === prev) continue;
      if (Math.abs(next - prev) > 25) continue;
      nextValues[idx] = next;
      nextSources[idx] = 'resume-gemini';
      changes.push({
        index: idx,
        from: prev,
        to: next,
        reason: String(u.reason || '').slice(0, 120),
        source: 'resume-gemini',
      });
    }

    if (!changes.length) {
      return { objectiveVector, changed: false, changes: [] };
    }

    const patched = {
      schemaId: objectiveVector?.schemaId || 'onet-lv-161-v1',
      values: nextValues,
      sources: nextSources,
      updatedAt: new Date().toISOString(),
      source: 'resume-gemini',
    };

    return { objectiveVector: patched, changed: true, changes };
  } catch (err) {
    console.warn('patchObjectiveFromResume failed', err);
    return { objectiveVector, changed: false, changes: [] };
  }
}

/**
 * Gemini objective patch from coach/deep-dive chat evidence — the objective
 * analog of patchPersonalityFromLearning. Only capability evidence (skills,
 * coursework, tools, projects the user reports), never personality traits.
 */
export async function patchObjectiveFromLearning(env, baseUrl, {
  quiz, dossier = '', source, contextText = '',
}) {
  const registry = await getRegistry(env, baseUrl);
  const dimList = registry.dimensions.slice(0, 40).map((d) => `${d.index}:${d.elementId}:${d.name}`).join('\n');
  const objectiveVector = quiz?.objectiveVector || null;
  const values = [...(objectiveVector?.values || new Array(DIM_COUNT).fill(0))];

  const ctx = String(contextText || '').trim().slice(0, CONTEXT_MAX);
  const dossierExcerpt = String(dossier || '').trim().slice(0, DOSSIER_EXCERPT_LEARNING_MAX);

  const prompt = `Update a student's O*NET objective (capability) vector (${DIM_COUNT} dimensions, each 0-100) based on NEW concrete evidence from a coaching conversation.
Return ONLY JSON: { "updates": [ { "index": 0-${DIM_COUNT - 1}, "value": 0-100, "reason": "short" } ] }

Rules:
- Include only dimensions with concrete capability evidence: courses taken, tools used, projects built, certifications, work experience the student reports.
- Do NOT infer personality traits or preferences — capabilities only.
- Max ±25 change per dimension per patch; at most 12 dimensions.
- If the conversation contains no new capability evidence, return { "updates": [] }

Sample dimension ids (index:elementId:name):
${dimList}
... (${DIM_COUNT} total)

Current objective vector sample (first 20): ${values.slice(0, 20).map((v) => Math.round(v)).join(', ')}

Learning source: ${source}
${ctx ? `\nConversation context:\n${ctx}` : ''}
${dossierExcerpt ? `\nCoach dossier excerpt:\n${dossierExcerpt}` : ''}`;

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.3,
      maxTokens: 1000,
      jsonMode: true,
      label: 'objective-learning-patch',
      softFail: true,
    });
    if (!raw || typeof raw !== 'object') {
      return { quiz, changed: false, changes: [] };
    }

    const updates = Array.isArray(raw.updates) ? raw.updates : [];
    const changes = [];
    const nextValues = [...values];
    const nextSources = [...(objectiveVector?.sources || new Array(DIM_COUNT).fill(null))];

    for (const u of updates.slice(0, 12)) {
      const idx = Number(u.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= DIM_COUNT) continue;
      const prev = nextValues[idx];
      const next = clamp100(u.value);
      if (next === prev) continue;
      if (Math.abs(next - prev) > 25) continue;
      nextValues[idx] = next;
      nextSources[idx] = 'ai-patch';
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

    quiz.objectiveVector = {
      schemaId: objectiveVector?.schemaId || 'onet-lv-161-v1',
      values: nextValues,
      sources: nextSources,
      updatedAt: new Date().toISOString(),
      source: 'ai-patch',
    };
    quiz.objectiveSkipped = false;
    quiz.objectiveAiPatch = mergeObjectiveAiPatch(quiz.objectiveAiPatch, changes, source || 'chat');

    return { quiz, changed: true, changes };
  } catch (err) {
    console.warn('patchObjectiveFromLearning failed', err);
    return { quiz, changed: false, changes: [] };
  }
}

export async function maybePatchObjectiveForUser(env, email, { source, contextText = '', baseUrl }) {
  const rlKey = `objective_patch:${email}`;
  try {
    await checkRateLimit(env, rlKey, { max: RATE_LIMIT_OBJECTIVE_PATCH_MAX });
  } catch {
    return { skipped: true, reason: 'rate_limit' };
  }

  const quiz = await loadQuizProfile(env, email);
  if (!quiz) return { skipped: true, reason: 'no_profile' };

  const dossier = await loadDossier(env, email).catch(() => '');
  const result = await patchObjectiveFromLearning(env, baseUrl, {
    quiz,
    dossier,
    source,
    contextText,
  });

  if (result.changed) {
    await saveQuizProfile(env, email, result.quiz);
  }

  return result;
}

/**
 * Create a small objective vector patch from completing a waypoint step.
 * Boosts the relevant dimension(s) by 4-8% based on how decisive the step
 * is for closing the skill gap.
 */
export function createWaypointStepPatch({ gapLabel, dimIndex, boost = 6, currentValue = 0 }) {
  if (dimIndex == null || !Number.isInteger(dimIndex) || dimIndex < 0 || dimIndex >= DIM_COUNT) {
    return null;
  }
  const clampedBoost = Math.max(4, Math.min(8, Math.round(boost)));
  const nextValue = clamp100(currentValue + clampedBoost);
  if (nextValue === currentValue) return null;
  return {
    dimensions: [{
      index: dimIndex,
      value: nextValue,
      reason: `Completed step for: ${gapLabel}`,
      source: 'waypoint-step',
    }],
  };
}

/**
 * Create a revert patch for undoing a waypoint step completion.
 * Reduces the relevant dimension by the same boost amount (4-8%).
 */
export function createWaypointStepRevertPatch({ gapLabel, dimIndex, boost = 6, currentValue = 0 }) {
  if (dimIndex == null || !Number.isInteger(dimIndex) || dimIndex < 0 || dimIndex >= DIM_COUNT) {
    return null;
  }
  const clampedBoost = Math.max(4, Math.min(8, Math.round(boost)));
  const nextValue = clamp100(currentValue - clampedBoost);
  if (nextValue === currentValue) return null;
  return {
    dimensions: [{
      index: dimIndex,
      value: nextValue,
      reason: `Undid step for: ${gapLabel}`,
      source: 'waypoint-step-revert',
    }],
  };
}
