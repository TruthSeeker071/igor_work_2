import { callGeminiJson } from './gemini-json.js';
import { loadQuizProfile, saveQuizProfile } from './auth.js';
import { maybePatchPersonalityForUser } from './onet/personality-patch.js';

export const SECTOR_KEYS = [
  'tech', 'healthcare', 'finance', 'creative', 'education', 'business', 'law',
  'engineering', 'science', 'startups', 'social', 'marketing', 'trades', 'media',
  'government', 'cybersecurity', 'operations', 'hospitality', 'aerospace',
  'pharmaceutical', 'sports', 'realestate', 'hr', 'agriculture',
];

const SHEET_VERSION = 1;
const HISTORY_MAX = 40;
const MAX_DELTA_PER_PATCH = 20;
const DOSSIER_EXCERPT_MAX = 4000;
const CONTEXT_MAX = 3000;

function nowIso() {
  return new Date().toISOString();
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function emptyScores() {
  const out = {};
  SECTOR_KEYS.forEach((k) => { out[k] = 0; });
  return out;
}

function scoresFromQuiz(quiz) {
  const raw = quiz?.scores && typeof quiz.scores === 'object' ? quiz.scores : {};
  const out = emptyScores();
  SECTOR_KEYS.forEach((k) => {
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) {
      out[k] = clampScore(raw[k]);
    }
  });
  return out;
}

export function ensureSectorFitSheet(quiz) {
  if (!quiz || typeof quiz !== 'object') return null;
  const existing = quiz.sectorFitSheet;
  if (existing && existing.version === SHEET_VERSION && existing.scores) {
    const scores = emptyScores();
    SECTOR_KEYS.forEach((k) => {
      scores[k] = clampScore(existing.scores[k]);
    });
    quiz.sectorFitSheet = {
      version: SHEET_VERSION,
      scores,
      seededAt: existing.seededAt || existing.updatedAt || nowIso(),
      updatedAt: existing.updatedAt || existing.seededAt || nowIso(),
      history: Array.isArray(existing.history) ? existing.history.slice(-HISTORY_MAX) : [],
    };
    quiz.scores = Object.assign({}, quiz.sectorFitSheet.scores);
    return quiz.sectorFitSheet;
  }

  const scores = scoresFromQuiz(quiz);
  const ts = nowIso();
  quiz.sectorFitSheet = {
    version: SHEET_VERSION,
    scores,
    seededAt: ts,
    updatedAt: ts,
    history: [],
  };
  quiz.scores = Object.assign({}, scores);
  return quiz.sectorFitSheet;
}

export function applySectorPatches(sheet, patches, meta) {
  if (!sheet || !sheet.scores) return { sheet, changed: false, changes: [] };
  const source = String(meta?.source || 'unknown').slice(0, 32);
  const changes = [];
  const list = Array.isArray(patches) ? patches : [];

  list.forEach((p) => {
    const key = String(p?.key || '').trim();
    if (!SECTOR_KEYS.includes(key)) return;
    const from = clampScore(sheet.scores[key]);
    let to = clampScore(p.score);
    if (Math.abs(to - from) < 1) return;
    const maxUp = from + MAX_DELTA_PER_PATCH;
    const maxDown = from - MAX_DELTA_PER_PATCH;
    to = Math.max(maxDown, Math.min(maxUp, to));
    if (to === from) return;
    sheet.scores[key] = to;
    changes.push({
      key,
      from,
      to,
      reason: String(p.reason || '').trim().slice(0, 120) || undefined,
    });
  });

  if (!changes.length) return { sheet, changed: false, changes: [] };

  const ts = nowIso();
  sheet.updatedAt = ts;
  if (!Array.isArray(sheet.history)) sheet.history = [];
  sheet.history.push({ at: ts, source, changes });
  if (sheet.history.length > HISTORY_MAX) {
    sheet.history = sheet.history.slice(-HISTORY_MAX);
  }
  return { sheet, changed: true, changes };
}

export function syncQuizScoresFromSheet(quiz) {
  if (!quiz?.sectorFitSheet?.scores) return quiz;
  quiz.scores = Object.assign({}, quiz.sectorFitSheet.scores);
  return quiz;
}

export function industryFitFromSheet(sheet, n = 4) {
  const scores = sheet?.scores || {};
  return Object.entries(scores)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, score]) => ({ key, score: clampScore(score) }));
}

function scoresBlock(scores) {
  return SECTOR_KEYS.map((k) => `${k}: ${clampScore(scores[k])}`).join('\n');
}

export async function patchSectorFitFromLearning(env, { quiz, dossier = '', source, contextText = '' }) {
  ensureSectorFitSheet(quiz);
  const sheet = quiz.sectorFitSheet;
  const ctx = String(contextText || '').trim().slice(0, CONTEXT_MAX);
  const dossierExcerpt = String(dossier || '').trim().slice(0, DOSSIER_EXCERPT_MAX);

  const prompt = `You update a student's sector fit cheat sheet (0-100 per industry sector).
Return ONLY JSON: { "updates": [ { "key": "<sector>", "score": 0-100, "reason": "short" } ] }

Rules:
- Only include sectors that should change based on NEW learning in the context below.
- Use ONLY these sector keys: ${SECTOR_KEYS.join(', ')}
- Create a sharp profile, not flat averages: top 3–5 sectors should be 70–95; weak sectors 0–25.
- score is the new 0-100 fit for that sector (not a delta).
- If nothing should change, return { "updates": [] }
- Do not score individual careers.
- Max 6 sectors per response.

Current sector scores:
${scoresBlock(sheet.scores)}

Learning source: ${source}
${ctx ? `\nNew context:\n${ctx}` : ''}
${dossierExcerpt ? `\nCoach dossier excerpt:\n${dossierExcerpt}` : ''}`;

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.35,
      maxTokens: 800,
      jsonMode: true,
      label: 'sector-fit-patch',
      softFail: true,
    });
    if (!raw || typeof raw !== 'object') {
      return { sheet, changed: false, changes: [] };
    }
    const updates = Array.isArray(raw.updates) ? raw.updates : [];
    const result = applySectorPatches(sheet, updates, { source });
    if (result.changed) syncQuizScoresFromSheet(quiz);
    return result;
  } catch (err) {
    console.warn('sector-fit patch failed', err);
    return { sheet, changed: false, changes: [] };
  }
}

/**
 * Load quiz, patch personality vector (and derived sector sheet), persist. Soft-fail.
 */
export async function maybePatchSectorFitForUser(env, email, { source, contextText = '', baseUrl }) {
  if (!email) return { sectorFitSheet: null, changed: false };
  try {
    const origin = baseUrl || env.ALLOWED_ORIGIN || 'https://flightway.ai';
    const result = await maybePatchPersonalityForUser(env, email, {
      source,
      contextText,
      baseUrl: origin,
    });
    if (result.skipped) {
      return { sectorFitSheet: null, changed: false, rateLimited: result.reason === 'rate_limit' };
    }
    const quiz = await loadQuizProfile(env, email);
    return {
      sectorFitSheet: quiz?.sectorFitSheet || null,
      changed: !!result.changed,
      changes: result.changes || [],
      personalityVector: quiz?.personalityVector || null,
    };
  } catch (err) {
    console.warn('maybePatchPersonalityForUser failed', err);
    try {
      const quiz = await loadQuizProfile(env, email);
      return {
        sectorFitSheet: quiz?.sectorFitSheet || null,
        changed: false,
        personalityPatchFailed: true,
      };
    } catch (_) {
      return { sectorFitSheet: null, changed: false, personalityPatchFailed: true };
    }
  }
}
