import {
  originFromEnv,
  loadDossier,
  buildSeedDossier,
  geminiConfigFromEnv,
  resolveGeminiModels,
  geminiGenerateContent,
  geminiTextFromResponse,
  GEMINI_SAFETY_SETTINGS,
} from './_lib.js';
import {
  normalizeProfileAnswers as normalizeCustomAnswers,
  dossierFromEnrichPrompt,
  mergeDossierFromPrompt,
} from './_lib/dossier-enrich.js';
import {
  authPreflight,
  authJsonResponse,
  optionalSession,
} from './_lib/auth.js';
import { maybeSyncRoadmap } from './_lib/roadmap-sync.js';
import { maybePatchSectorFitForUser } from './_lib/sector-fit-sheet.js';

const MAX_RESUME_CHARS = 12000;
const MAX_NAME_LEN = 80;
const MAX_ANSWER_LEN = 400;

const INDUSTRY_KEYS = [
  'tech', 'healthcare', 'finance', 'creative', 'education', 'business', 'law',
  'engineering', 'science', 'startups', 'social', 'marketing', 'trades', 'media',
  'government', 'cybersecurity', 'operations', 'hospitality', 'aerospace',
  'pharmaceutical', 'sports', 'realestate', 'hr', 'agriculture',
];

function parseJsonFromText(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

async function callGemini(env, prompt) {
  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) {
    throw Object.assign(new Error('GEMINI_API_KEY is not configured.'), { _userFacing: true });
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1600 },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  };

  for (const m of resolveGeminiModels(env)) {
    try {
      const data = await geminiGenerateContent({ apiKey, model: m, body });
      const text = geminiTextFromResponse(data);
      if (text) return parseJsonFromText(text);
    } catch {
      // try fallback model
    }
  }
  throw new Error('Quiz enrichment failed.');
}

function normalizeBoosts(raw) {
  const out = {};
  INDUSTRY_KEYS.forEach((k) => {
    const v = raw && raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.max(0, Math.min(12, Math.round(v)));
    }
  });
  return out;
}

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  if (request.method === 'OPTIONS') return authPreflight(origin);
  if (request.method !== 'POST') return authJsonResponse(405, { error: 'Method not allowed' }, origin);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body' }, origin);
  }

  const customAnswers = normalizeCustomAnswers(payload.customAnswers);
  const resumeSummary = String(payload.resumeSummary || '').trim().slice(0, 500);
  const resumeText = String(payload.resumeText || '').trim().slice(0, MAX_RESUME_CHARS);

  if (!customAnswers.length && !resumeSummary && resumeText.length < 40) {
    return authJsonResponse(400, { error: 'Provide customAnswers and/or resume context.' }, origin);
  }

  const session = await optionalSession(request, env);
  const email = session?.email || null;
  const userName = String(payload.userName || 'Student').trim().slice(0, MAX_NAME_LEN);
  const baseScores = payload.baseScores && typeof payload.baseScores === 'object' ? payload.baseScores : null;

  const answersXml = customAnswers.length
    ? `<custom_answers>\n${customAnswers.map((a) => `<item statement="${a.prompt.replace(/"/g, "'")}">${a.answer}</item>`).join('\n')}\n</custom_answers>`
    : '';
  const resumeXml = resumeText.length >= 40
    ? `<resume>\n${resumeText}\n</resume>`
    : (resumeSummary ? `<resume_summary>${resumeSummary}</resume_summary>` : '');
  const scoresXml = baseScores
    ? `<base_quiz_scores>${JSON.stringify(baseScores)}</base_quiz_scores>`
    : '';

  const prompt = `Analyze this student's quiz free-text answers (and optional resume) for career personalization.

Return ONLY valid JSON:
{
  "industryBoosts": { ${INDUSTRY_KEYS.map((k) => `"${k}":0-12`).join(', ')} },
  "characterSummary": "max 300 chars — personality/work-style synthesis",
  "traits": ["max 4 short trait labels"]
}

Rules:
- industryBoosts 0-12: how strongly their own words support each industry (0 = no signal). Use only these keys.
- Weight custom answers heavily; resume is supplementary context when present.
- characterSummary captures how they act in groups / work style in plain language.
- traits should be polar opposites where possible (e.g. "analytical vs people-first") to support a directional personality vector.

${scoresXml}
${answersXml}
${resumeXml}`;

  try {
    const raw = await callGemini(env, prompt);
    const boosts = normalizeBoosts(raw.industryBoosts);
    const characterSummary = String(raw.characterSummary || '').slice(0, 300);
    const traits = Array.isArray(raw.traits)
      ? raw.traits.map((t) => String(t).slice(0, 60)).slice(0, 4)
      : [];

    let dossierUpdated = false;
    if (email && (customAnswers.length || characterSummary)) {
      let dossier = await loadDossier(env, email);
      if (!dossier) dossier = buildSeedDossier({});
      const mergePrompt = dossierFromEnrichPrompt(
        customAnswers,
        characterSummary,
        traits,
        resumeSummary || resumeText.slice(0, 500),
        dossier,
      );
      dossierUpdated = await mergeDossierFromPrompt(env, email, mergePrompt, { currentDossier: dossier });
    }

    let roadmapSync = null;
    if (email && dossierUpdated) {
      try {
        roadmapSync = await maybeSyncRoadmap(env, email, { reason: 'quiz-enrich' });
      } catch (err) {
        console.warn('quiz-enrich roadmap sync failed', err);
      }
    }

    let sectorPatch = null;
    if (email) {
      const enrichCtx = [
        characterSummary ? `Character: ${characterSummary}` : '',
        customAnswers.map((a) => `${a.prompt}: ${a.answer}`).join('\n'),
        resumeSummary || resumeText.slice(0, 500),
      ].filter(Boolean).join('\n');
      sectorPatch = await maybePatchSectorFitForUser(env, email, {
        source: 'quiz-enrich',
        contextText: enrichCtx,
        baseUrl: origin,
      });
    }

    return authJsonResponse(200, {
      industryBoosts: boosts,
      characterSummary,
      traits,
      dossierUpdated,
      userName,
      roadmapUpdated: !!(roadmapSync && !roadmapSync.cached),
      roadmapRetargeted: !!(roadmapSync && roadmapSync.retargeted),
      roadmap: roadmapSync?.roadmap || undefined,
      sectorFitSheet: sectorPatch?.sectorFitSheet || undefined,
      sectorFitUpdated: !!(sectorPatch && sectorPatch.changed),
    }, origin);
  } catch (err) {
    console.error('quiz-enrich failed', err);
    return authJsonResponse(500, { error: 'Could not enrich quiz answers. Try again.' }, origin);
  }
}
