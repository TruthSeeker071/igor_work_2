// Server-side career ranking — the top-N O*NET careers by fit, with names.
//
// Why this exists: career ranking has always been a client-side vector op over
// the whole catalog (`FWOnetVectors`), and the only server-reachable rank was
// `portalSnapshot.careerPicks`, which stores a `careerId` and no name. That one
// gap forced two recorded deviations — WS-E E3's "top-5 fit careers with scores
// in Marco's context" and WS-D D3's thread rule 3, which had to fire on a
// sector instead of a career. This module closes both.
//
// The cost problem it has to respect (the reason it was deferred):
//   Ranking needs the whole catalog — careers.json (347KB) plus the level
//   vector buffer (503KB). Both are module-cached per isolate, so a WARM
//   isolate ranks 782 careers in ~2ms; a COLD one pays ~850KB of fetch+parse.
//   Marco's chat is the hot path and cannot pay that.
//
// So the rank is a CACHE, never a hot-path computation:
//   - `loadCachedCareerRank` is one KV read. Hit → the block goes in the
//     prompt. Miss → the block is simply absent this turn.
//   - `refreshCareerRank` is what pays the catalog cost, and callers run it
//     through `context.waitUntil` AFTER the response is sent. One turn later
//     the cache is warm and stays warm.
//   - The key embeds a fingerprint of the vectors the rank was computed from,
//     so a stale rank is unreachable rather than needing invalidation: a quiz
//     retake, a gap-progress-sync write or an AI patch all move the
//     fingerprint. The TTL is only a backstop for catalog rebuilds.
//
// Two invariants this deliberately does NOT touch:
//   - It introduces no scoring math. Every number comes from
//     `./math.js` (`personalityFitPercent`, `objectiveFitPercent`,
//     `displayFitPercent`), which
//     already carries the client/server parity invariant with
//     `assets/js/shared/onet-math.js`. Parity is kept by not inventing.
//   - It writes a derived RANKING to KV, never a vector, and never to the user
//     object. `gap-progress-sync` remains the only server-side vector writer.

import { DIM_COUNT, SCHEMA_ID } from './constants.js';
import {
  personalityFitPercent, objectiveFitPercent, displayFitPercent, isObjectiveVectorActive,
} from './math.js';
import { getCareers, getLvBuffer, sliceVector } from './store.js';

export const CAREER_RANK_SIZE = 5;
export const CAREER_RANK_TTL_SEC = 30 * 24 * 3600; // backstop only; the fingerprint is the real invalidator
// v2 = distinctive fit (FIT_MATH_VERSION 2). The key's vector fingerprint can
// see the user's vector change but not the FORMULA change, so the prefix is the
// only thing that can retire ranks written under the old scoring. v1 entries
// orphan and are reaped by the 30-day TTL.
const KV_PREFIX = 'career-rank:v4';

/** djb2, matching the stretch-fits precedent — stable across runs and isolates. */
function hash36(str) {
  let h = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h &= 0xffffffff;
  }
  return (h >>> 0).toString(36);
}

/**
 * Fingerprint of the inputs a rank depends on. Values are rounded to whole
 * points before hashing: the vectors are 0-100 level scales and sub-point
 * drift cannot reorder a top-5, so rounding stops a no-op save from throwing
 * the cache away.
 */
export function careerRankFingerprint(personality, objective) {
  const p = Array.isArray(personality) ? personality : [];
  const o = Array.isArray(objective) ? objective : [];
  let acc = `${SCHEMA_ID}|`;
  for (let i = 0; i < DIM_COUNT; i += 1) acc += `${Math.round(Number(p[i]) || 0)},`;
  acc += '|';
  for (let i = 0; i < DIM_COUNT; i += 1) acc += `${Math.round(Number(o[i]) || 0)},`;
  return hash36(acc);
}

export function careerRankKey(email, fingerprint) {
  return `${careerRankKeyPrefix(email)}${fingerprint}`;
}

/**
 * Everything in this namespace belonging to one user, as a KV list() prefix.
 *
 * Exported for the account purge, which sweeps KV by matching the email as a
 * colon-delimited segment. That sweep cannot see this namespace: the email here
 * is hashed, so the plaintext address never appears in the key. This is the one
 * per-user namespace that has to be deleted by name rather than found, and the
 * purge gate asserts it stays that way.
 */
export function careerRankKeyPrefix(email) {
  return `${KV_PREFIX}:${hash36(String(email || '').toLowerCase())}:`;
}

/**
 * Rank the catalog by overall fit. Pure — no I/O, so the suite can drive it
 * from fixtures.
 *
 * @param {Array} careers   careers.json rows (soc, title, hubZone, vectorIndex)
 * @param {Float32Array} lv the level-vector buffer those vectorIndexes point into
 * @returns {Array<{soc,title,hubZone,fit,personalityFit,objectiveFit}>}
 */
export function rankCareersByFit(careers, lv, personality, objective, limit = CAREER_RANK_SIZE) {
  if (!Array.isArray(careers) || !lv || !Array.isArray(personality) || !personality.length) return [];
  // A user who has never had an objective layer has `objectiveVector: null`,
  // not an empty vector — isObjectiveVectorActive would dereference it.
  const objActive = Array.isArray(objective) && objective.length > 0
    && isObjectiveVectorActive(objective);
  const maxIndex = Math.floor(lv.length / DIM_COUNT);
  const scored = [];
  for (const row of careers) {
    // AI-derived fragments are merged into the catalog at read time and their
    // vectorIndex does not address this buffer — ranking them would score a
    // different career's vector under their name.
    if (!row || row.aiDerived || !row.title || !Number.isInteger(row.vectorIndex)) continue;
    if (row.vectorIndex < 0 || row.vectorIndex >= maxIndex) continue;
    const vec = sliceVector(lv, row.vectorIndex);
    const personalityFit = personalityFitPercent(personality, vec);
    const objectiveFit = objActive ? objectiveFitPercent(objective, vec) : null;
    scored.push({
      soc: row.soc,
      title: row.title,
      hubZone: row.hubZone || null,
      fit: displayFitPercent(personality, vec),
      personalityFit,
      objectiveFit,
    });
  }
  // Ties break on SOC so the same profile always yields the same list — a
  // proactive thread that proposes a different career on every identical turn
  // reads as noise, not as noticing something.
  scored.sort((a, b) => (b.fit - a.fit) || (a.soc < b.soc ? -1 : a.soc > b.soc ? 1 : 0));
  return scored.slice(0, Math.max(0, limit));
}

/** One KV read. Returns [] for every miss — never throws onto the chat path. */
export async function loadCachedCareerRank(env, email, personality, objective) {
  if (!env || !env.COACH_KV || !email || !Array.isArray(personality) || !personality.length) return [];
  try {
    const key = careerRankKey(email, careerRankFingerprint(personality, objective));
    const raw = await env.COACH_KV.get(key, 'json');
    return Array.isArray(raw?.careers) ? raw.careers : [];
  } catch (err) {
    console.warn('career rank cache read failed', err);
    return [];
  }
}

/**
 * Compute and cache the rank. THIS is the call that pays the catalog cost —
 * run it from `context.waitUntil`, never inline on a request the user waits on.
 */
export async function refreshCareerRank(env, baseUrl, email, personality, objective) {
  if (!env || !env.COACH_KV || !email || !Array.isArray(personality) || !personality.length) return [];
  try {
    const [careers, lv] = await Promise.all([
      getCareers(env, baseUrl),
      getLvBuffer(env, baseUrl),
    ]);
    const ranked = rankCareersByFit(careers, lv, personality, objective);
    if (!ranked.length) return [];
    const key = careerRankKey(email, careerRankFingerprint(personality, objective));
    await env.COACH_KV.put(
      key,
      JSON.stringify({ careers: ranked, schemaId: SCHEMA_ID, computedAt: new Date().toISOString() }),
      { expirationTtl: CAREER_RANK_TTL_SEC },
    );
    return ranked;
  } catch (err) {
    console.warn('career rank refresh failed', err);
    return [];
  }
}

/**
 * The prompt block. Empty string on an empty rank so the composer drops it —
 * a heading with nothing under it teaches the model the data is missing.
 */
export function careerRankPromptBlock(ranked) {
  const rows = Array.isArray(ranked) ? ranked.filter((r) => r && r.title) : [];
  if (!rows.length) return '';
  const lines = rows.map((r) => {
    const obj = Number.isFinite(r.objectiveFit) ? `, preparedness ${r.objectiveFit}%` : '';
    return `- ${r.title} — ${r.fit}% fit (personality ${r.personalityFit}%${obj})`;
  });
  return `## Their strongest career matches
Computed from their own vectors against the whole O*NET catalog, best first:
${lines.join('\n')}
These are matches, not decisions. Name one only when it answers what they asked.`;
}
