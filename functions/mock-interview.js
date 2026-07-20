// FlightWay 2.0 — stateful mock interview (premium). Replaces the flashcard
// interview-prep flow with a continuous 8-question, ~20-minute, text-only
// session: intro → behavioral → technical → candidate-questions → close, one
// persona throughout, feedback withheld until a single end-of-session debrief.
//
//   POST { action:'turn',    career?, soc?, persona?, company?, resumeText?,
//          transcript:[{role:'interviewer'|'student', text}], difficulty?,
//          sessionToken?, sessionStartTs? }
//     → { question, questionIndex, totalQuestions, phase, difficulty, done,
//         companySources?, companyAsOf?, sessionToken? + sessionStartTs? (first turn) }
//   POST { action:'debrief', ...same context + sessionToken + sessionStartTs }
//     → { debrief: { scores, verdict, highlights, actions }, sessionId }
//   GET  → { sessions: [{ id, career, persona, company, scores, created_at }] }
//
// House patterns: session-gated + requirePlan('premium') + IP rate limit +
// 3-sessions/day cap spent once at session start, with a stateless peppered
// session token (interview-token.js) proving later turns and the debrief
// belong to a paid session; client holds the transcript (no server beacon,
// like sim-mirror.js); resume/company/transcript text fenced as untrusted DATA
// (interview-core.js); company mode research goes through Pillar W
// (functions/_lib/gemini-grounded.js) — cached globally, budgeted, optional.
// Strictly read-only over vectors, dossier, and the O*NET store.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import { getSessionEmail, checkRateLimit, clientIp } from './_lib/auth.js';
import { resolveSchool } from './_lib/school.js';
import { requirePlan } from './_lib/entitlements.js';
import { checkFeatureLimit } from './_lib/plan-limits.js';
import { resolveCareerFamily } from './_lib/career-family.js';
import { groundingEnabled, researchWeb, buildEvidenceBlock, GROUNDING_TTL } from './_lib/gemini-grounded.js';
import {
  TOTAL_QUESTIONS, MAX_RESUME_CHARS, fenceText, planSession, sanitizeTranscript,
  turnState, nextDifficulty, personaFor, buildTurnPrompt, buildDebriefPrompt,
  sanitizeDebrief, playbookForFamily,
} from './_lib/interview-core.js';
import { mintInterviewToken, verifyInterviewToken, mintDifficultyTag, verifyDifficultyTag } from './_lib/interview-token.js';

const HISTORY_CAP = 50;
const TURN_TIMEOUT_MS = 18000;
const DEBRIEF_TIMEOUT_MS = 25000;
const SOC_RE = /^\d{2}-\d{4}\.\d{2}$/;

function clampStr(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) return { origin, error: jsonResponse(402, { error: 'Mock interviews are a Flight Plan feature.', upgrade: true }, origin) };
  return { origin, email, env, request, plan: ent.plan };
}

function parseContext(body) {
  const soc = clampStr(body?.soc, 16);
  return {
    careerName: fenceText(body?.career, 120) || 'your target career',
    soc: SOC_RE.test(soc) ? soc : '',
    persona: body?.persona === 'pressure' ? 'pressure' : 'coach',
    company: fenceText(body?.company, 80),
    resumeText: fenceText(body?.resumeText, MAX_RESUME_CHARS),
    transcript: sanitizeTranscript(body?.transcript),
    // No `difficulty` here on purpose: adaptive difficulty is server-derived
    // from signed per-turn markers (verifyDifficultyTag), never client-trusted.
  };
}

// Company mode is the primary Pillar W consumer: firm process/values/question
// style, globally cached (semi-stable) so one fetch serves every student
// prepping for that firm. Null (flag off / budget / miss) → baked playbook only.
async function companyResearch(env, email, ctx) {
  if (!ctx.company || !groundingEnabled(env)) return null;
  return researchWeb(env, {
    query: `${ctx.company} ${ctx.careerName} interview process, values, and question style`,
    freshnessTtl: GROUNDING_TTL.SEMI_STABLE,
    timeoutMs: 8000,
    budgetKey: email,
  });
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

// Session history for the over-time metric chart.
export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  try {
    const r = await g.env.DB.prepare(
      'SELECT id, career, soc, persona, company, scores_json, created_at FROM interview_sessions WHERE email = ? ORDER BY created_at DESC LIMIT ?',
    ).bind(g.email, HISTORY_CAP).all();
    const sessions = (r.results || []).map((row) => {
      let scores = null;
      try { scores = JSON.parse(row.scores_json); } catch (_) { /* keep null */ }
      return { id: row.id, career: row.career, soc: row.soc, persona: row.persona, company: row.company, scores, created_at: row.created_at };
    });
    return jsonResponse(200, { sessions }, g.origin);
  } catch (err) {
    console.warn('mock-interview history failed', err?.message || err);
    return jsonResponse(200, { sessions: [] }, g.origin);
  }
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin, plan } = g;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const action = body?.action === 'debrief' ? 'debrief' : 'turn';
  const ctx = parseContext(body);

  try {
    await checkRateLimit(env, `mockiv:${clientIp(request)}`, { max: 30 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  const family = resolveCareerFamily({ soc: ctx.soc, careerName: ctx.careerName });
  const playbook = playbookForFamily(family);
  const slots = planSession(playbook);
  const state = turnState(ctx.transcript, slots);

  try {
    if (action === 'turn') {
      const isSessionStart = ctx.transcript.length === 0;
      // The daily cap counts sessions, not turns: spend one unit on the first
      // turn and mint a stateless token proving this session paid. Later turns
      // present the token instead of touching the counter, so a mid-session
      // user is never cut off — even when the just-spent slot was the last one.
      let sessionStartTs = 0;
      let sessionToken = '';
      let sessionsLeft;
      if (isSessionStart) {
        const cap = await checkFeatureLimit(env, email, 'mock-interview', { plan });
        if (!cap.ok) {
          return jsonResponse(429, { error: cap.message, upgrade: !!cap.upgrade, remaining: 0 }, origin);
        }
        sessionsLeft = cap.remaining;
        sessionStartTs = Date.now();
        sessionToken = await mintInterviewToken(env, email, sessionStartTs);
      } else if (!(await verifyInterviewToken(env, email, body?.sessionToken, body?.sessionStartTs))) {
        return jsonResponse(401, { error: 'This interview session has expired — start a new one.' }, origin);
      } else {
        sessionStartTs = Number(body?.sessionStartTs);
      }

      // Adaptive difficulty, server-derived: read back the signed marker this
      // server put on the previous interviewer turn. Missing or tampered
      // marker → conservative mid default, never the client's own number.
      let difficultyNow = 3;
      if (!isSessionStart) {
        const interviewerTurns = ctx.transcript.filter((t) => t.role === 'interviewer');
        const lastIv = interviewerTurns[interviewerTurns.length - 1];
        difficultyNow = (lastIv
          && await verifyDifficultyTag(env, email, sessionStartTs, interviewerTurns.length - 1, lastIv.tag)) || 3;
      }

      const research = await companyResearch(env, email, ctx);
      const companyEvidence = research ? buildEvidenceBlock(research) : '';
      const slot = state.done ? 'close' : slots[Math.min(state.questionIndex, slots.length - 1)];
      const prompt = buildTurnPrompt({
        playbook,
        persona: ctx.persona,
        careerName: ctx.careerName,
        company: ctx.company,
        companyEvidence,
        school: await resolveSchool(env, email).catch(() => ''),
        resumeText: ctx.resumeText,
        transcript: ctx.transcript,
        difficulty: difficultyNow,
        slot,
        questionIndex: state.questionIndex,
      });
      const raw = await callGeminiJson(env, {
        prompt,
        temperature: 0.7,
        maxTokens: 500,
        label: 'mock-interview-turn',
        softFail: false,
        timeoutMs: TURN_TIMEOUT_MS,
        deadlineAt: Date.now() + 35000,
      });
      const question = fenceText(raw?.question, 900);
      if (!question) return jsonResponse(502, { error: 'The interviewer lost their train of thought — try again.' }, origin);
      const difficulty = slot === 'technical' || slot === 'behavioral'
        ? nextDifficulty(difficultyNow, raw?.assessment)
        : difficultyNow;
      // Signed marker the client stores on this interviewer entry and resends;
      // the next turn derives its difficulty from it (see difficultyNow above).
      const difficultyTag = await mintDifficultyTag(env, email, sessionStartTs, state.questionIndex, difficulty);
      return jsonResponse(200, {
        question,
        questionIndex: state.questionIndex,
        totalQuestions: TOTAL_QUESTIONS,
        phase: slot,
        difficulty,
        difficultyTag,
        done: state.done,
        persona: personaFor(ctx.persona).name,
        ...(isSessionStart ? { sessionToken, sessionStartTs, remaining: sessionsLeft } : {}),
        ...(research ? { companySources: research.sources || [], companyAsOf: research.fetchedAt || null } : {}),
      }, origin);
    }

    // ---- debrief ----
    // The token proves this debrief follows a session that went through the
    // turn flow (and already spent its daily slot) — a debrief-only request
    // with a fabricated transcript is rejected, never scored or persisted.
    if (!(await verifyInterviewToken(env, email, body?.sessionToken, body?.sessionStartTs))) {
      return jsonResponse(401, { error: 'Debrief unavailable — this interview session is missing or expired. Start a new session.' }, origin);
    }
    if (ctx.transcript.length < 4) {
      return jsonResponse(400, { error: 'Not enough interview to debrief yet — answer a few questions first.' }, origin);
    }
    const prompt = buildDebriefPrompt({
      playbook,
      careerName: ctx.careerName,
      company: ctx.company,
      resumeText: ctx.resumeText,
      transcript: ctx.transcript,
      technicalAsked: state.technicalAsked,
      school: await resolveSchool(env, email).catch(() => ''),
    });
    const raw = await callGeminiJson(env, {
      prompt,
      temperature: 0.3,
      maxTokens: 1400,
      label: 'mock-interview-debrief',
      softFail: false,
      timeoutMs: DEBRIEF_TIMEOUT_MS,
      deadlineAt: Date.now() + 45000,
    });
    // sanitizeDebrief returns null when the model response lacks the raw
    // material for a real debrief — honest failure, never a flat-3 grade.
    const debrief = sanitizeDebrief(raw, { technicalAsked: state.technicalAsked, playbook });
    if (!debrief) {
      return jsonResponse(502, { error: 'Could not build your debrief — try again.' }, origin);
    }

    // Persist the metric log (D1) so the over-time chart is a straight query;
    // transcript itself stays client-owned (lean by design).
    let sessionId = null;
    try {
      sessionId = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare(
        'INSERT INTO interview_sessions (id, email, career, soc, persona, company, scores_json, debrief_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        sessionId, email, ctx.careerName, ctx.soc || null, ctx.persona, ctx.company || null,
        JSON.stringify(debrief.scores),
        JSON.stringify({ verdict: debrief.verdict, highlights: debrief.highlights, actions: debrief.actions }),
        now,
      ).run();
      await env.DB.prepare(
        'DELETE FROM interview_sessions WHERE email = ? AND id NOT IN (SELECT id FROM interview_sessions WHERE email = ? ORDER BY created_at DESC LIMIT ?)',
      ).bind(email, email, HISTORY_CAP).run();
    } catch (err) {
      console.warn('mock-interview persist failed', err?.message || err);
      sessionId = null; // debrief still returns — persistence is best-effort
    }
    return jsonResponse(200, { debrief, sessionId }, origin);
  } catch (err) {
    const status = err.status || 500;
    return jsonResponse(status, { error: err._userFacing ? err.message : 'The mock interviewer is unavailable right now.' }, origin);
  }
}
