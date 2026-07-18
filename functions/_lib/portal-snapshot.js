import { geminiConfigFromEnv } from '../_lib.js';
import { normalizeProfileAnswers } from './dossier-enrich.js';
import { callGeminiJson } from './gemini-json.js';
import {
  ensureSectorFitSheet,
  industryFitFromSheet,
} from './sector-fit-sheet.js';

const KNOW_YOU_MAX = 280;
const CHARACTER_MAX = 600;
const NOTE_MAX = 80;
const DOSSIER_MAX = 6000;

export const PENDING_ANALYSIS_MSG = 'Generating your analysis, check back soon.';

function hashString(str) {
  const s = String(str || '');
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
    hash &= hash;
  }
  return (hash >>> 0).toString(36);
}

export function dossierFingerprint(dossier) {
  return hashString(String(dossier || '').trim());
}

export function computeInputsHash(quiz, dossier = '') {
  const pb = quiz?.profileBuilding;
  const sheet = quiz?.sectorFitSheet;
  const payload = {
    scores: quiz?.scores || {},
    sectorUpdatedAt: String(sheet?.updatedAt || ''),
    archetype: String(quiz?.archetype || ''),
    characterSummary: String(quiz?.characterSummary || ''),
    traits: Array.isArray(quiz?.traits) ? quiz.traits : [],
    pb: Array.isArray(pb?.answers)
      ? pb.answers.map((a) => ({ id: a.id, answer: String(a.answer || '').trim() }))
      : [],
    dossierFp: dossierFingerprint(dossier),
    personalityVecAt: String(quiz?.personalityVector?.updatedAt || ''),
    objectiveVecAt: String(quiz?.objectiveVector?.updatedAt || ''),
    vectorSchemaId: String(quiz?.vectorSchemaId || ''),
  };
  return hashString(JSON.stringify(payload));
}

export function topIndustryKeys(scores, n = 6) {
  return Object.entries(scores || {})
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => String(key));
}

function trimText(s, max) {
  return String(s || '').trim().slice(0, max);
}

function archetypeLabel(archetype) {
  return String(archetype || '').trim().replace(/^The\s+/i, '');
}

function shortKnowYouFromAnswers(answers, name) {
  const byId = {};
  (answers || []).forEach((a) => {
    if (a?.id && a?.answer) byId[a.id] = a.answer;
  });
  const bits = [];
  if (byId.unfinished) bits.push(`you're working on ${trimText(byId.unfinished, 80)}`);
  if (byId.friends) bits.push(`people see you as strong at ${trimText(byId.friends, 80)}`);
  if (byId.curious) bits.push(`you're curious about ${trimText(byId.curious, 80)}`);
  if (byId.talk) bits.push(`you light up talking about ${trimText(byId.talk, 80)}`);
  if (byId.downtime) bits.push(`you choose ${trimText(byId.downtime, 80)} in your free time`);
  if (!bits.length) return '';
  const lead = name && name !== 'Student' ? `${name}, ` : '';
  return trimText(`${lead}We hear that ${bits.slice(0, 2).join(', and ')}.`, KNOW_YOU_MAX);
}

export function buildFallbackPortalSnapshot(quiz, careerPool) {
  ensureSectorFitSheet(quiz);
  const scores = quiz?.scores || {};
  const pool = Array.isArray(careerPool) ? careerPool : [];
  const industryFit = industryFitFromSheet(quiz.sectorFitSheet, 4);
  const industryKeys = industryFit.map((it) => it.key);
  const traits = Array.isArray(quiz?.traits)
    ? quiz.traits.map((t) => String(t).slice(0, 60)).slice(0, 4)
    : [];

  const knowYou = PENDING_ANALYSIS_MSG;

  const characterAnalysis = trimText(PENDING_ANALYSIS_MSG, CHARACTER_MAX);

  const careerPicks = pool.slice(0, 3).map((c) => ({
    careerId: Number(c.careerId),
    soc: c.soc ? String(c.soc) : null,
    title: c.name ? String(c.name).slice(0, 120) : '',
    note: trimText(`Strong quiz fit at ${Math.round(Number(c.score) || 0)}%`, NOTE_MAX),
    fitScore: Math.round(Number(c.score) || 0),
  })).filter((c) => Number.isFinite(c.careerId));

  const skillTags = [];
  pool.slice(0, 3).forEach((c) => {
    (Array.isArray(c.skills) ? c.skills : []).forEach((s) => {
      const t = String(s).trim();
      if (t && skillTags.length < 6 && !skillTags.includes(t)) skillTags.push(t);
    });
  });

  return {
    version: 2,
    inputsHash: computeInputsHash(quiz),
    dossierFp: '',
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    knowYou,
    characterAnalysis,
    traits,
    careerPicks,
    industryPicks: industryKeys.slice(0, 4),
    industryFit,
    skillTags,
  };
}

function normalizeSnapshot(raw, quiz, careerPool, inputsHash, dossierFp, source) {
  ensureSectorFitSheet(quiz);
  const poolIds = new Set((careerPool || []).map((c) => Number(c.careerId)));
  const poolById = {};
  (careerPool || []).forEach((c) => {
    poolById[Number(c.careerId)] = c;
  });

  const careerPicks = (Array.isArray(raw?.careerPicks) ? raw.careerPicks : [])
    .map((c) => {
      const careerId = Number(c.careerId);
      const poolHit = poolById[careerId];
      const fitScore = poolHit ? Math.round(Number(poolHit.score) || 0) : 0;
      return {
        careerId,
        // soc + title persist the career identity so the weekly-nudge cron can
        // resolve real job postings from D1 (careerId alone isn't a SOC).
        soc: poolHit && poolHit.soc ? String(poolHit.soc) : null,
        title: poolHit && poolHit.name ? String(poolHit.name).slice(0, 120) : '',
        note: trimText(c.note, NOTE_MAX),
        fitScore,
      };
    })
    .filter((c) => Number.isFinite(c.careerId) && poolIds.has(c.careerId))
    .slice(0, 3);

  const industryFit = industryFitFromSheet(quiz.sectorFitSheet, 4);
  const industryPicks = industryFit.map((it) => it.key);

  const skillTags = (Array.isArray(raw?.skillTags) ? raw.skillTags : [])
    .map((s) => trimText(s, 40))
    .filter(Boolean)
    .slice(0, 8);

  const traits = (Array.isArray(raw?.traits) ? raw.traits : [])
    .map((t) => trimText(t, 60))
    .filter(Boolean)
    .slice(0, 4);

  const fallback = buildFallbackPortalSnapshot(quiz, careerPool);

  return {
    version: 2,
    inputsHash,
    dossierFp: dossierFp || '',
    generatedAt: new Date().toISOString(),
    source: source || 'fallback',
    knowYou: trimText(raw?.knowYou, KNOW_YOU_MAX) || fallback.knowYou,
    characterAnalysis: trimText(raw?.characterAnalysis, CHARACTER_MAX) || fallback.characterAnalysis,
    traits: traits.length ? traits : fallback.traits,
    careerPicks: careerPicks.length ? careerPicks : fallback.careerPicks,
    industryPicks: industryPicks.length ? industryPicks : fallback.industryPicks,
    industryFit: industryFit.length ? industryFit : fallback.industryFit,
    skillTags: skillTags.length ? skillTags : fallback.skillTags,
  };
}

export async function synthesizePortalSnapshot(env, quiz, careerPool, dossier = '') {
  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) return { snapshot: null, aiError: 'GEMINI_API_KEY is not configured.' };

  const scores = quiz?.scores || {};
  const topScores = Object.entries(scores)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${Math.round(v)}`)
    .join(', ');

  const pool = (careerPool || []).slice(0, 6);
  const careersBlock = pool
    .map((c) => `- id ${c.careerId}: ${c.name} (${Math.round(Number(c.score) || 0)}% fit)`)
    .join('\n');

  const pbAnswers = normalizeProfileAnswers(quiz?.profileBuilding?.answers || []);
  const pbBlock = pbAnswers.map((a) => `- ${a.prompt}: ${a.answer}`).join('\n');

  const customAnswers = Array.isArray(quiz?.customAnswers) ? quiz.customAnswers : [];
  const customBlock = customAnswers
    .slice(0, 4)
    .map((a) => `- ${a.prompt}: ${a.answer}`)
    .join('\n');

  const dossierBlock = trimText(dossier, DOSSIER_MAX);

  const prompt = `You personalize a student career portal home page. Return ONLY a JSON object with these keys:
- knowYou: string, about 2 lines max (~200 chars), second person, warm and specific
- characterAnalysis: string, 2-3 sentences on work style and motivations
- traits: array of max 4 short trait label strings
- careerPicks: array of max 3 objects with careerId (number from list below), note (one short line, max 60 chars) — do NOT include fitScore
- skillTags: array of max 8 short skill phrase strings inferred from the full profile

Rules:
- Treat the dossier as the primary evolving source of truth; reconcile quiz data where they conflict
- careerPicks: use ONLY career ids from the list below; notes should be specific, not generic
- skillTags: AI-inferred strengths only — do not list generic filler
- Do NOT score industries or careers numerically — sector fit is computed separately
- No bullet characters in prose fields
- Aim for brevity in knowYou (~2 lines) but complete sentences

Student: ${quiz?.name || 'Student'}
Archetype: ${quiz?.archetype || 'unknown'}
Quiz traits: ${(quiz?.traits || []).join(', ') || 'none'}
Top quiz scores: ${topScores || 'none'}
Character summary: ${quiz?.characterSummary || 'none'}

Career pool:
${careersBlock || 'none'}

Profile-building answers:
${pbBlock || 'none'}

Quiz free-text:
${customBlock || 'none'}

Coach dossier (primary context):
${dossierBlock || 'none yet'}`;

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.4,
      maxTokens: 1200,
      jsonMode: true,
      label: 'portal-snapshot',
      softFail: true,
    });
    if (!raw || typeof raw !== 'object') {
      return { snapshot: null, aiError: 'Portal snapshot AI returned empty or invalid JSON.' };
    }
    const dossierFp = dossierFingerprint(dossier);
    const inputsHash = computeInputsHash(quiz, dossier);
    return {
      snapshot: normalizeSnapshot(raw, quiz, careerPool, inputsHash, dossierFp, 'ai'),
      aiError: null,
    };
  } catch (err) {
    console.warn('portal snapshot AI failed', err);
    return { snapshot: null, aiError: err?.message || 'Portal snapshot AI failed.' };
  }
}

export async function generatePortalSnapshot(env, quiz, careerPool, dossier = '') {
  const inputsHash = computeInputsHash(quiz, dossier);
  const dossierFp = dossierFingerprint(dossier);
  const fallback = buildFallbackPortalSnapshot(quiz, careerPool);
  fallback.inputsHash = inputsHash;
  fallback.dossierFp = dossierFp;

  const { snapshot: ai, aiError } = await synthesizePortalSnapshot(env, quiz, careerPool, dossier);
  if (ai) return { portalSnapshot: ai, aiError: null };

  return {
    portalSnapshot: { ...fallback, inputsHash, dossierFp, generatedAt: new Date().toISOString(), source: 'fallback' },
    aiError,
  };
}

export { normalizeSnapshot, KNOW_YOU_MAX, CHARACTER_MAX };
