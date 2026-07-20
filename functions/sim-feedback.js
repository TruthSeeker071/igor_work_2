/**
 * POST /sim-feedback — a "senior practitioner" reviews the student's
 * Test Flight deliverable. Scenario context comes from the server
 * (sim-secrets / KV), so the review can't be steered by a spoofed brief.
 */
import { originFromEnv } from './_lib.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import { SIM_SECRETS } from './_lib/sim-secrets.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  checkRateLimit,
  clientIp,
} from './_lib/auth.js';

const MAX_ARTIFACT = 6000;
const RATE_MAX = 12;

async function loadContext(env, simId) {
  if (SIM_SECRETS[simId]) return SIM_SECRETS[simId];
  try {
    if (env.COACH_KV) {
      const gen = await env.COACH_KV.get('simv2:' + simId, 'json');
      if (gen && gen.secrets) return gen.secrets;
    }
  } catch (err) {
    console.warn('sim-feedback: KV read failed', err);
  }
  return null;
}

function normalizeList(v, n, maxLen) {
  return Array.isArray(v)
    ? v.map((x) => String(x || '').trim().slice(0, maxLen)).filter(Boolean).slice(0, n)
    : [];
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
    return authJsonResponse(400, { error: 'Invalid JSON body' }, origin);
  }

  const simId = String(payload.simId || '').trim().toLowerCase().slice(0, 64);
  const artifact = String(payload.artifact || '').trim().slice(0, MAX_ARTIFACT);
  if (!simId || artifact.length < 40) {
    return authJsonResponse(400, { error: 'Missing simId or artifact.' }, origin);
  }

  const ctx = await loadContext(env, simId);
  if (!ctx) return authJsonResponse(404, { error: 'Unknown simulation.' }, origin);

  try {
    await checkRateLimit(env, 'simfb:' + clientIp(request), { max: RATE_MAX });
  } catch (err) {
    return authErrorResponse(err, origin);
  }

  const prompt = [
    'You are a thoughtful senior ' + ctx.title + ' reviewing work from a college student with no prior exposure to this field, who just completed a realistic short job simulation.',
    'Give honest, specific, workplace-grade feedback — encouraging but never inflated, written in plain language a newcomer understands. Quote or reference their actual words where possible.',
    '',
    'SCENARIO: ' + ctx.brief,
    '',
    'THE DELIVERABLE THEY WERE ASKED FOR: ' + ctx.task,
    '',
    "STUDENT'S WORK:\n" + artifact,
    '',
    'Respond ONLY with JSON, no markdown, no preamble:',
    '{"strengths": [2-3 short specific strings], "growth": [2-3 short specific strings], "verdict": "1-2 sentence honest hiring-manager read of their raw instincts for this kind of work"}',
  ].join('\n');

  try {
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.5,
      maxTokens: 900,
      label: 'sim-feedback',
    });
    const feedback = {
      strengths: normalizeList(raw && raw.strengths, 3, 300),
      growth: normalizeList(raw && raw.growth, 3, 300),
      verdict: String((raw && raw.verdict) || '').trim().slice(0, 500),
    };
    if (!feedback.strengths.length || !feedback.verdict) {
      return authJsonResponse(502, { error: 'Reviewer returned an unusable response.' }, origin);
    }
    return authJsonResponse(200, { feedback }, origin);
  } catch (err) {
    console.warn('sim-feedback failed', err && err.message);
    return authErrorResponse(err, origin);
  }
}
