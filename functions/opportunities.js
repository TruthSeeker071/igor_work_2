// FlightWay — Coordinate-Gap Opportunity Finder (premium, Pillar W consumer).
//
//   GET  /opportunities → { opportunities, grounded, fetchedAt, sources, school, reason? }
//   POST /opportunities { school } → { ok, school }
//
// House patterns: session-gated + requirePlan('premium') + IP rate limit
// (mock-interview.js). Strictly read-only over vectors/roadmap (decision #6):
// never touches objectiveVector, objectiveAiPatch, or gap-progress-sync.
// Opportunities appear ONLY when grounded research returned a real source URL
// (origin-matched in opportunity-core); grounding off / over budget / empty →
// the clean empty shape with NO shaping call — groundedJson is deliberately
// not used because its ungrounded fallback would be a paid call whose output
// decision #4 forces us to discard.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { loadUserBlob } from './_lib/user.js';
import { callGeminiJson } from './_lib/gemini-json.js';
import {
  getSessionEmail, checkRateLimit, clientIp,
  loadRoadmap,
} from './_lib/auth.js';
import { resolveSchool, setSchool } from './_lib/school.js';
import { requirePlan } from './_lib/entitlements.js';
import { groundingEnabled, researchWeb, buildEvidenceBlock, GROUNDING_TTL } from './_lib/gemini-grounded.js';
import { loadDossierWithCoordinates } from './_lib/dossier-coordinates.js';
import {
  buildOpportunityQueries, buildOpportunityPrompt, sanitizeOpportunities,
  rankOpportunities, mergeResearchSources, sanitizeSchoolName, normalizeSchoolKey,
} from './_lib/opportunity-core.js';

const CACHE_TTL_SEC = 86400; // per-user result cache: 1 day
const RESEARCH_TIMEOUT_MS = 8000;
const SHAPING_TIMEOUT_MS = 20000;
const MAX_GAPS = 6;

async function gate(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return { origin, error: jsonResponse(401, { error: 'Not signed in.' }, origin) };
  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) return { origin, error: jsonResponse(402, { error: 'Opportunity matching is a Flight Plan feature.', upgrade: true }, origin) };
  return { origin, email, env, request };
}

async function rateLimit(env, request, origin) {
  try {
    await checkRateLimit(env, `oppfind:${clientIp(request)}`, { max: 30 });
    return null;
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }
}

function emptyShape(school, reason) {
  return { opportunities: [], grounded: false, fetchedAt: null, sources: [], school: school || '', reason };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  try {
    const [quiz, roadmap] = await Promise.all([
      loadUserBlob(env, email).catch(() => null),
      loadRoadmap(env, email).catch(() => null),
    ]);
    // Prefills the panel's field from whatever the system already knows: the
    // saved value, else the dossier's school: line (adopted on the spot), so a
    // student who told Marco where they study never types it here.
    const school = await resolveSchool(env, email, { quiz }).catch(() => sanitizeSchoolName(quiz && quiz.school));
    const career = {
      name: (roadmap && roadmap.targetCareerName) || (quiz && quiz.careerFocus && quiz.careerFocus.name) || '',
      slug: (roadmap && roadmap.targetCareerSlug) || '',
      soc: (quiz && quiz.careerFocus && quiz.careerFocus.soc) || '',
    };
    const gaps = ((roadmap && roadmap.focusTracker && roadmap.focusTracker.skillGaps) || [])
      .filter((gp) => gp && gp.label && gp.dimIndex != null)
      .slice(0, MAX_GAPS);
    if (!career.name || !gaps.length) return jsonResponse(200, emptyShape(school, 'no-gaps'), origin);
    if (!groundingEnabled(env)) return jsonResponse(200, emptyShape(school, 'grounding-off'), origin);

    // Key embeds career + gap set + school, so any of those changing is an
    // automatic invalidation — nothing else ever needs to clear this.
    // v2: v1 bodies hold pre-resolution (redirect) URLs — never serve them.
    const cacheKey = `oppfind:v2:${email}:${career.soc || career.slug || ''}:${gaps.map((gp) => gp.dimIndex).join('.')}:${normalizeSchoolKey(school)}`;
    if (env.COACH_KV) {
      const cached = await env.COACH_KV.get(cacheKey, 'json').catch(() => null);
      if (cached && Array.isArray(cached.opportunities)) return jsonResponse(200, cached, origin);
    }

    // Career+gap-only query text → shared gw:q: research cache across users.
    // The 3 parallel calls can over/under-count the KV budget counter by ≤2 —
    // benign, accepted (build plan §4 step 5).
    const queries = buildOpportunityQueries({ careerName: career.name, gaps, school });
    const results = await Promise.all(queries.map((query) => researchWeb(env, {
      query, budgetKey: email, freshnessTtl: GROUNDING_TTL.VOLATILE, timeoutMs: RESEARCH_TIMEOUT_MS,
    })));
    const briefs = results.filter(Boolean);
    if (!briefs.length) return jsonResponse(200, emptyShape(school, 'no-results'), origin);

    const { sources, fetchedAt } = mergeResearchSources(briefs);
    const dossier = await loadDossierWithCoordinates(env, email).catch(() => '');
    const shaped = await callGeminiJson(env, {
      prompt: buildOpportunityPrompt({ evidence: buildEvidenceBlock(briefs), dossier, careerName: career.name, gaps, school }),
      temperature: 0.4,
      maxTokens: 1400,
      jsonMode: true,
      label: 'opportunity-finder',
      softFail: true,
      timeoutMs: SHAPING_TIMEOUT_MS,
    });
    if (!shaped || !Array.isArray(shaped.opportunities)) {
      // Not cached: the research is already in the gw:q: cache, so a retry
      // only re-runs the (failed) shaping call.
      return jsonResponse(200, emptyShape(school, 'shape-failed'), origin);
    }

    const opportunities = rankOpportunities(sanitizeOpportunities(shaped.opportunities, gaps, sources), gaps);
    const body = { opportunities, grounded: true, fetchedAt, sources, school };
    if (env.COACH_KV) {
      await env.COACH_KV.put(cacheKey, JSON.stringify(body), { expirationTtl: CACHE_TTL_SEC }).catch(() => {});
    }
    return jsonResponse(200, body, origin);
  } catch (err) {
    console.warn('opportunities GET failed', err && err.message ? err.message : err);
    return jsonResponse(200, emptyShape('', 'error'), origin);
  }
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const { env, request, email, origin } = g;
  const limited = await rateLimit(env, request, origin);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const school = sanitizeSchoolName(body && body.school);

  try {
    // Server-side read-modify-write is mandatory: the client quiz sync merges
    // with the SERVER copy as its base and drops unknown local-only keys, so
    // `school` set only in localStorage would be silently wiped (§3/§6).
    // setSchool also mirrors into the dossier's school: line, so the next
    // Gemini dossier merge reads what the student just typed instead of
    // reverting it from stale text.
    const saved = await setSchool(env, email, school);
    return jsonResponse(200, { ok: true, school: saved }, origin);
  } catch (err) {
    console.warn('opportunities POST failed', err && err.message ? err.message : err);
    return jsonResponse(500, { error: 'Could not save your school. Try again.' }, origin);
  }
}
