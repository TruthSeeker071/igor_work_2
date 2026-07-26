/**
 * FlightWay V2 S16 — the grounded live-posting pipeline.
 *
 * ONE implementation, two callers: `POST /scorecard {action:'run'}` (the student
 * pressed the button, spends their allowance) and the quarterly cron sweep for
 * premium accounts. Splitting it would have meant two prompts drifting apart,
 * and the prompt is where every anti-hallucination rule lives — the same reason
 * S9's `deadline-refresh.js` is shaped this way.
 *
 * Deliberately meter-free: the caller owns `checkFeatureLimit`/`refundFeatureUse`
 * so it can hand the allowance back on the failures the student did not cause
 * (nothing came back from research, the shaping call failed, or the run produced
 * no requirements at all). The cron spends no allowance — its brakes are the
 * shared grounding budget plus its own per-night cap.
 *
 * Degrades to a reason string, never an exception. Every one of these is a
 * legitimate state of the product rather than an error, and the panel renders
 * them as such:
 *   'grounding-off' | 'no-career' | 'no-resume' | 'no-results' | 'shape-failed'
 *   | 'no-requirements' | 'save-failed'
 */

import { loadUserBlob } from './user.js';
import { loadRoadmap } from './auth.js';
import { callGeminiJson } from './gemini-json.js';
import { groundingEnabled, researchWeb, buildEvidenceBlock, GROUNDING_TTL } from './gemini-grounded.js';
import { utcDate } from './deadline-core.js';
import { resolveCareer } from './deadline-refresh.js';
import {
  buildPostingQueries, buildScorecardPrompt, buildEvidenceCorpus,
  sanitizeScorecard, scoreRequirements, buildReport, MAX_CORPUS_ENTRIES,
} from './scorecard-core.js';
import { insertScorecard } from './scorecard-store.js';

const RESEARCH_TIMEOUT_MS = 8000;
const SHAPING_TIMEOUT_MS = 25000;
const MAX_GAPS = 6;
const MAX_ARTIFACTS = 12;

/** The reasons that mean "nothing was produced and it was not their fault". */
export const REFUNDABLE_REASONS = new Set(['no-results', 'shape-failed', 'no-requirements', 'save-failed']);

/** Latest saved resume document for one account, or null. Read-only. */
async function loadLatestResume(env, email) {
  if (!env || !env.DB || !email) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT json FROM resumes WHERE email = ? ORDER BY updated_at DESC LIMIT 1',
    ).bind(email).first();
    if (!row) return null;
    return JSON.parse(row.json);
  } catch (_) {
    return null;
  }
}

/** Filed evidence for one account. Read-only over artifacts — never a writer. */
async function loadArtifacts(env, email) {
  if (!env || !env.DB || !email) return [];
  try {
    const r = await env.DB.prepare(
      'SELECT title, note FROM artifacts WHERE email = ? ORDER BY created_at DESC LIMIT ?',
    ).bind(email, MAX_ARTIFACTS).all();
    return r.results || [];
  } catch (_) {
    return [];
  }
}

/**
 * Run one readiness scorecard for one account and persist the result.
 *
 * @returns {Promise<{ok:boolean, reason?:string, id?:string, report?:object,
 *                    score?:number, corpusSize?:number, downgraded?:number}>}
 */
export async function runScorecardForUser(env, email, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const fail = (reason) => ({ ok: false, reason });
  if (!groundingEnabled(env)) return fail('grounding-off');
  if (!env || !env.COACH_KV || !env.DB) return fail('grounding-off');

  const [quiz, roadmap] = await Promise.all([
    loadUserBlob(env, email).catch(() => null),
    loadRoadmap(env, email).catch(() => null),
  ]);
  const career = resolveCareer(quiz, roadmap);
  // Without a target role every query would be about "this career" — generic
  // enough that the answers are noise, and it would still cost grounding.
  if (!career.name) return fail('no-career');

  const gaps = ((roadmap && roadmap.focusTracker && roadmap.focusTracker.skillGaps) || [])
    .filter((g) => g && g.label)
    .slice(0, MAX_GAPS);
  const [resume, artifacts] = await Promise.all([
    loadLatestResume(env, email),
    loadArtifacts(env, email),
  ]);
  const corpus = buildEvidenceCorpus({ resume, gaps, artifacts });
  // Nothing on record means every requirement resolves to "missing" and the
  // report is a 0% that says more about the empty profile than about the
  // student. Refuse BEFORE spending grounding, and tell them what to fill in.
  if (!corpus.entries.length) return fail('no-resume');

  const school = String(opts.school || '').slice(0, 120);
  const queries = buildPostingQueries({ careerName: career.name, school, now });
  const results = await Promise.all(queries.map((query) => researchWeb(env, {
    query, budgetKey: email, freshnessTtl: GROUNDING_TTL.VOLATILE, timeoutMs: RESEARCH_TIMEOUT_MS,
  })));
  const briefs = results.filter(Boolean);
  if (!briefs.length) return fail('no-results');

  const sources = [];
  const seen = new Set();
  let fetchedAt = null;
  for (const b of briefs) {
    if (b.fetchedAt && (!fetchedAt || b.fetchedAt > fetchedAt)) fetchedAt = b.fetchedAt;
    for (const s of b.sources || []) {
      if (!s || !s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push({ title: s.title, url: s.url });
    }
  }

  const shaped = await callGeminiJson(env, {
    prompt: buildScorecardPrompt({
      evidence: buildEvidenceBlock(briefs),
      careerName: career.name,
      school,
      corpus,
      today: utcDate(now),
    }),
    temperature: 0.2,
    maxTokens: 2200,
    jsonMode: true,
    label: 'scorecard',
    softFail: true,
    timeoutMs: SHAPING_TIMEOUT_MS,
  });
  if (!shaped || typeof shaped !== 'object') return fail('shape-failed');

  const sanitized = sanitizeScorecard(shaped, { sources, corpus });
  // A run that survived validation with no requirements left has measured
  // nothing. Publishing its 0% would be the single most damaging number this
  // feature can show, so it is a refundable failure instead.
  if (!sanitized.requirements.length) return fail('no-requirements');

  const scored = scoreRequirements(sanitized.requirements);
  const report = buildReport({
    careerName: career.name,
    careerSlug: career.slug,
    school,
    sanitized,
    scored,
    sources,
    fetchedAt,
    source: opts.source,
    now,
  });

  const saved = await insertScorecard(env, email, {
    report, scored, careerName: career.name, careerSlug: career.slug, source: opts.source, now,
  });
  if (!saved.ok) return fail('save-failed');

  return {
    ok: true,
    id: saved.id,
    report,
    score: scored.score,
    corpusSize: Math.min(corpus.entries.length, MAX_CORPUS_ENTRIES),
    downgraded: sanitized.downgraded,
  };
}
