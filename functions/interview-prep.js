// FlightWay 2.0 — Pillar D1 interview prep (premium).
//   POST { careerName, soc?, stage:'question'|'feedback', question?, answer? }
//     stage 'question'  → one practice question for the target career (KV-cached
//                         12-question bank per career; server tracks seen per user)
//     stage 'feedback'  → rubric-scored feedback on the student's answer
// House pattern: session-gated + requirePlan('premium') + rate-limited + schema-validated.
// Server-side prompts only. Cost ceiling: banks are cached 30d; feedback is daily-capped.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import { getSessionEmail, checkRateLimit, clientIp } from './_lib/auth.js';
import { requirePlan } from './_lib/entitlements.js';

const BANK_TTL = 60 * 60 * 24 * 30;   // 30d
const SEEN_TTL = 60 * 60 * 24 * 7;    // 7d
const MAX_ANSWER = 2000;
const TYPES = ['behavioral', 'role', 'curveball'];

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}
function clampStr(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function clampScore(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3; }

// Manual per-day cap (checkRateLimit is hourly; this enforces the 20/day ceiling).
async function dailyLimit(env, key, max) {
  if (!env.COACH_KV) return;
  const day = new Date().toISOString().slice(0, 10);
  const k = `iprepday:${key}:${day}`;
  const n = Number(await env.COACH_KV.get(k)) || 0;
  if (n >= max) {
    const e = new Error('Daily interview-prep limit reached. Come back tomorrow.');
    e.status = 429; e._userFacing = true; throw e;
  }
  await env.COACH_KV.put(k, String(n + 1), { expirationTtl: 60 * 60 * 26 });
}

async function getBank(env, careerName, key) {
  const cacheKey = `iprep:${key}:qs`;
  if (env.COACH_KV) {
    try {
      const cached = await env.COACH_KV.get(cacheKey, 'json');
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (_) { /* ignore */ }
  }
  const prompt = [
    `Generate 12 realistic interview questions for an entry-level candidate targeting: ${careerName}.`,
    'Mix types: some behavioral, some role-specific/technical, a couple of curveballs.',
    'Keep each question one sentence, answerable by a college student, no preamble.',
    'Respond ONLY with JSON: {"questions":[{"type":"behavioral|role|curveball","text":"..."}]}',
  ].join('\n');
  const raw = await callGeminiJson(env, { prompt, temperature: 0.7, maxTokens: 900, label: 'iprep-bank' });
  const bank = (raw && Array.isArray(raw.questions) ? raw.questions : [])
    .map((q) => ({ type: TYPES.includes(String(q.type)) ? q.type : 'role', text: clampStr(q.text, 240) }))
    .filter((q) => q.text.length > 8)
    .slice(0, 12);
  if (bank.length && env.COACH_KV) {
    await env.COACH_KV.put(cacheKey, JSON.stringify(bank), { expirationTtl: BANK_TTL });
  }
  return bank;
}

async function pickUnseen(env, email, key, bank) {
  const seenKey = `iprepseen:${email}:${key}`;
  let seen = [];
  if (env.COACH_KV) {
    try { seen = (await env.COACH_KV.get(seenKey, 'json')) || []; } catch (_) { seen = []; }
  }
  if (!Array.isArray(seen)) seen = [];
  let idx = bank.findIndex((_, i) => seen.indexOf(i) === -1);
  if (idx === -1) { seen = []; idx = 0; } // all seen → reset
  seen.push(idx);
  if (env.COACH_KV) await env.COACH_KV.put(seenKey, JSON.stringify(seen.slice(-24)), { expirationTtl: SEEN_TTL });
  return { question: bank[idx], index: idx };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) return jsonResponse(402, { error: 'Interview prep is a Flight Plan feature.', upgrade: true }, origin);

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const careerName = clampStr(body?.careerName, 120);
  const stage = String(body?.stage || 'question');
  if (!careerName) return jsonResponse(400, { error: 'Missing careerName.' }, origin);
  const key = body?.soc ? slug(body.soc) : slug(careerName);

  try {
    await checkRateLimit(env, `iprep:${clientIp(request)}`, { max: 30 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  try {
    if (stage === 'question') {
      await dailyLimit(env, `q:${email}`, 40);
      const bank = await getBank(env, careerName, key);
      if (!bank.length) return jsonResponse(502, { error: 'Could not generate questions right now.' }, origin);
      const picked = await pickUnseen(env, email, key, bank);
      return jsonResponse(200, { question: picked.question, index: picked.index, remaining: bank.length }, origin);
    }

    if (stage === 'feedback') {
      const question = clampStr(body?.question, 240);
      const answer = clampStr(body?.answer, MAX_ANSWER);
      if (question.length < 5 || answer.length < 20) {
        return jsonResponse(400, { error: 'Give the question and an answer of at least a sentence or two.' }, origin);
      }
      await dailyLimit(env, `fb:${email}`, 20);
      const prompt = [
        `You are an experienced interviewer for ${careerName}, coaching an entry-level candidate.`,
        'Score their answer honestly but kindly on three axes (1–5) and give one crisp note each,',
        'a one-line overall verdict, and one "model moment" — a sentence they could have said to land it.',
        '',
        `QUESTION: ${question}`,
        `THEIR ANSWER: ${answer}`,
        '',
        'Respond ONLY with JSON, no markdown:',
        '{"structure":{"score":1-5,"note":"..."},"specificity":{"score":1-5,"note":"..."},'
        + '"clarity":{"score":1-5,"note":"..."},"verdict":"one line","model_moment":"one sentence"}',
      ].join('\n');
      const raw = await callGeminiJson(env, { prompt, temperature: 0.4, maxTokens: 700, label: 'iprep-feedback' });
      const axis = (o) => ({ score: clampScore(o && o.score), note: clampStr(o && o.note, 240) });
      const feedback = {
        structure: axis(raw && raw.structure),
        specificity: axis(raw && raw.specificity),
        clarity: axis(raw && raw.clarity),
        verdict: clampStr(raw && raw.verdict, 300),
        model_moment: clampStr(raw && raw.model_moment, 300),
      };
      if (!feedback.verdict) return jsonResponse(502, { error: 'Coach returned an unusable response.' }, origin);
      return jsonResponse(200, { feedback }, origin);
    }

    return jsonResponse(400, { error: 'Unknown stage.' }, origin);
  } catch (err) {
    const status = err.status || 500;
    return jsonResponse(status, { error: err._userFacing ? err.message : 'Interview prep is unavailable right now.' }, origin);
  }
}
