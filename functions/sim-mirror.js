/**
 * POST /sim-mirror — cross-career pattern readout over the student's
 * flight telemetry. Input is sanitized field-by-field (never trusted).
 */
import { originFromEnv } from './_lib.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  checkRateLimit,
  clientIp,
} from './_lib/auth.js';

const MAX_TRIALS = 12;
const RATE_MAX = 8;

function num(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function strList(v, n, max) {
  return Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];
}

function sanitizeTrials(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TRIALS).map((t) => ({
    role: str(t && t.role, 80),
    domain: str(t && t.domain, 60),
    familiarity: str(t && t.familiarity, 20),
    predictedEnjoyment: num(t && t.predictedEnjoyment, 1, 10),
    experiencedEnjoyment: num(t && t.experiencedEnjoyment, 1, 10),
    gap: num(t && t.gap, -9, 9),
    minutesSpent: num(t && t.minutesSpent, 0, 240),
    colleagueMessagesSent: num(t && t.colleagueMessagesSent, 0, 50),
    hintsUsed: num(t && t.hintsUsed, 0, 20),
    energizedBy: strList(t && t.energizedBy, 6, 120),
    drainedBy: strList(t && t.drainedBy, 6, 120),
    surpriseNote: str(t && t.surpriseNote, 240),
    workExcerpt: str(t && t.workExcerpt, 300),
  })).filter((t) => t.role && t.experiencedEnjoyment != null);
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

  const trials = sanitizeTrials(payload.trials);
  if (trials.length < 2) {
    return authJsonResponse(400, { error: 'The Mirror needs at least 2 completed flights.' }, origin);
  }

  try {
    await checkRateLimit(env, 'simmirror:' + clientIp(request), { max: RATE_MAX });
  } catch (err) {
    return authErrorResponse(err, origin);
  }

  const prompt = [
    "You are the Mirror — FlightWay's pattern engine. A college student has completed realistic short work simulations across different careers. Below is their behavioral telemetry.",
    "Find the cross-domain patterns they cannot see themselves: what kinds of cognitive work energize them regardless of field, what drains them, and what their prediction-vs-experience gaps reveal about their self-knowledge.",
    'Write in plain, warm, direct language — no jargon. Be specific and evidence-based — reflect their own signals back to them. Never flatter.',
    '',
    'TELEMETRY:',
    JSON.stringify(trials, null, 2),
    '',
    'Respond ONLY with JSON, no markdown:',
    '{"headline": "one sharp plain-language sentence naming the strongest pattern", "patterns": [{"title": "short pattern name", "evidence": "1-2 sentences citing their actual signals"}] (2-4 items), "predictionInsight": "1-2 sentences on what their forecast-vs-actual gaps reveal about how well they predict what they will enjoy", "nextFlights": [{"career": "specific career", "why": "one plain sentence tying it to their patterns"}] (3 items, at least one unexpected)}',
  ].join('\n');

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.6,
      maxTokens: 1100,
      label: 'sim-mirror',
    });
    const mirror = {
      headline: str(raw && raw.headline, 240),
      patterns: (Array.isArray(raw && raw.patterns) ? raw.patterns : []).slice(0, 4).map((p) => ({
        title: str(p && p.title, 90),
        evidence: str(p && p.evidence, 400),
      })).filter((p) => p.title),
      predictionInsight: str(raw && raw.predictionInsight, 400),
      nextFlights: (Array.isArray(raw && raw.nextFlights) ? raw.nextFlights : []).slice(0, 3).map((n) => ({
        career: str(n && n.career, 80),
        why: str(n && n.why, 240),
      })).filter((n) => n.career),
    };
    if (!mirror.headline || !mirror.patterns.length) {
      return authJsonResponse(502, { error: 'The Mirror returned an unusable response.' }, origin);
    }
    return authJsonResponse(200, { mirror }, origin);
  } catch (err) {
    console.warn('sim-mirror failed', err && err.message);
    return authErrorResponse(err, origin);
  }
}
