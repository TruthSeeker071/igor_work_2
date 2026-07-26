/**
 * FlightWay V2 S9 — the grounded deadline-extraction pipeline.
 *
 * ONE implementation, two callers: `POST /deadlines {action:'refresh'}` (the
 * student pressed the button, spends their weekly allowance) and the nightly
 * cron sweep for recently-active accounts. Splitting it would have meant two
 * prompts drifting apart, and the prompt is where every anti-hallucination rule
 * lives.
 *
 * Deliberately meter-free: the caller owns `checkFeatureLimit`/`refundFeatureUse`
 * so it can hand the allowance back on the two failures the student did not
 * cause (nothing came back from research, or the shaping call failed). The cron
 * spends nothing at all — its budget is the shared grounding counters plus its
 * own per-night user cap.
 *
 * Degrades to a reason string, never an exception: grounding off, no career yet,
 * no evidence, bad shape. Each one is a legitimate state of the product, not an
 * error, and the radar renders them as such.
 */

import { loadUserBlob } from './user.js';
import { loadRoadmap } from './auth.js';
import { callGeminiJson } from './gemini-json.js';
import { groundingEnabled, researchWeb, buildEvidenceBlock, GROUNDING_TTL } from './gemini-grounded.js';
import { buildDeadlineQueries, buildDeadlinePrompt, sanitizeDeadlines, utcDate } from './deadline-core.js';
import { upsertDeadlines } from './deadline-store.js';

const RESEARCH_TIMEOUT_MS = 8000;
const SHAPING_TIMEOUT_MS = 20000;

function pickYear(quiz) {
  if (!quiz) return '';
  return String(
    (quiz.identity && quiz.identity.year)
    || (quiz.profile && quiz.profile.year)
    || quiz.year || '',
  ).slice(0, 40);
}

/** The career this radar is about, from the roadmap first and the quiz second. */
export function resolveCareer(quiz, roadmap) {
  return {
    name: (roadmap && roadmap.targetCareerName)
      || (quiz && quiz.careerFocus && quiz.careerFocus.name) || '',
    slug: (roadmap && roadmap.targetCareerSlug)
      || (quiz && quiz.careerFocus && quiz.careerFocus.slug) || '',
  };
}

/**
 * Run one grounded refresh for one user and persist the result.
 *
 * @returns {Promise<{ok:boolean, reason?:string, added:number, updated:number,
 *                    skipped:number, found:number, sources:Array, fetchedAt:?string}>}
 *   `reason` values: 'grounding-off' | 'no-career' | 'no-results' | 'shape-failed'.
 *   'no-results' and 'shape-failed' are the two the caller should refund on —
 *   nothing was produced and the student was not at fault.
 */
export async function refreshDeadlinesForUser(env, email, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const empty = { ok: false, added: 0, updated: 0, skipped: 0, found: 0, sources: [], fetchedAt: null };
  if (!groundingEnabled(env)) return { ...empty, reason: 'grounding-off' };
  if (!env || !env.COACH_KV || !env.DB) return { ...empty, reason: 'grounding-off' };

  const [quiz, roadmap] = await Promise.all([
    loadUserBlob(env, email).catch(() => null),
    loadRoadmap(env, email).catch(() => null),
  ]);
  const career = resolveCareer(quiz, roadmap);
  // No target career means every query would be about "this career" — generic
  // enough that the answers would be noise, and it would still cost grounding.
  if (!career.name) return { ...empty, reason: 'no-career' };

  const school = String(opts.school || '').slice(0, 120);
  const queries = buildDeadlineQueries({ careerName: career.name, school, now });
  const results = await Promise.all(queries.map((query) => researchWeb(env, {
    query, budgetKey: email, freshnessTtl: GROUNDING_TTL.VOLATILE, timeoutMs: RESEARCH_TIMEOUT_MS,
  })));
  const briefs = results.filter(Boolean);
  if (!briefs.length) return { ...empty, reason: 'no-results' };

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
    prompt: buildDeadlinePrompt({
      evidence: buildEvidenceBlock(briefs),
      careerName: career.name,
      school,
      year: pickYear(quiz),
      today: utcDate(now),
    }),
    temperature: 0.1,
    maxTokens: 1400,
    jsonMode: true,
    label: 'deadline-radar',
    softFail: true,
    timeoutMs: SHAPING_TIMEOUT_MS,
  });
  if (!shaped || !Array.isArray(shaped.deadlines)) {
    return { ...empty, reason: 'shape-failed', sources, fetchedAt };
  }

  const items = sanitizeDeadlines(shaped.deadlines, { sources, now });
  const counts = await upsertDeadlines(env, email, items, {
    source: 'grounded', careerSlug: career.slug, now,
  });
  return { ok: true, ...counts, found: items.length, sources, fetchedAt };
}
