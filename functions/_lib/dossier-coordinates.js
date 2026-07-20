// Dossier ⇄ vector bridge: every AI surface that reads the KV dossier also
// gets the user's live O*NET coordinates — target career, personality/objective
// fits, the biggest coordinate gaps, and quiz-level signals — composed at READ
// time from D1 (quiz_profiles + roadmaps). Nothing is persisted into KV: the
// block is fenced with [[coordinates]] markers and saveDossier strips them, so
// the digest can never go stale, duplicate, or survive a Gemini dossier merge.

import { COORDINATES_BLOCK_RE, loadDossier } from '../_lib.js';
import { loadRoadmap } from './auth.js';
import { loadUser } from './user.js';
import { normalizeUser } from './user-model.js';

const pct = (v) => Math.round(Math.max(0, Math.min(100, Number(v) || 0)));

/** Pure: compose the digest lines from a quiz profile (v1 or v2) + roadmap. */
export function buildCoordinateLines(quiz, roadmap) {
  const user = normalizeUser(quiz || {});
  const lines = [];
  const focus = user.focus.careerFocus;
  if (focus?.name) {
    lines.push(`target career: ${String(focus.name).slice(0, 90)}${focus.soc ? ` (O*NET ${focus.soc})` : ''}`);
  }
  // Where they study gates which programs are reachable at all, so it belongs
  // in front of every AI surface — not just the org query that collects it.
  if (user.identity.school) lines.push(`school: ${String(user.identity.school).slice(0, 80)}`);
  const fc = roadmap?.fitContext;
  if (fc) {
    const bits = [];
    if (fc.personalityFit != null) bits.push(`personality fit ${pct(fc.personalityFit)}/100`);
    if (fc.objectiveFit != null) bits.push(`objective (skills/experience) fit ${pct(fc.objectiveFit)}/100`);
    if (fc.preparedness != null) bits.push(`readiness ${pct(fc.preparedness)}%`);
    if (bits.length) lines.push(`fit vs target: ${bits.join(', ')}`);
  }
  const gaps = (roadmap?.focusTracker?.skillGaps || []).filter((g) => g && g.label).slice(0, 6);
  if (gaps.length) {
    lines.push('largest coordinate gaps (objective vector vs role, 0-100):');
    gaps.forEach((g) => {
      lines.push(`- ${String(g.label).slice(0, 60)}: you ${pct(g.user)} vs role ${pct(g.target)}`
        + (g.progress ? ` (${pct(g.progress)}% closed)` : ''));
    });
  } else if (Array.isArray(fc?.vectorGaps) && fc.vectorGaps.length) {
    lines.push('largest coordinate gaps (objective vector vs role, 0-100):');
    fc.vectorGaps.slice(0, 5).forEach((g) => {
      if (g?.name) lines.push(`- ${String(g.name).slice(0, 60)}: you ${pct(g.user)} vs role ${pct(g.target)}`);
    });
  }
  const scores = user.assessment.scores;
  if (scores && typeof scores === 'object') {
    const top = Object.entries(scores)
      .filter(([, v]) => Number.isFinite(Number(v)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);
    if (top.length) lines.push(`top quiz industries: ${top.join(', ')}`);
  }
  // archetype has no v2 home; the model passes unknown root keys through.
  if (user.archetype) lines.push(`quiz archetype: ${String(user.archetype).slice(0, 60)}`);
  return lines;
}

/**
 * loadDossier + the live coordinates block. Use this in READ paths that feed
 * prompts; write/merge paths keep raw loadDossier (saveDossier strips the
 * fenced block anyway, so a merge echoing it can never persist it).
 */
export async function loadDossierWithCoordinates(env, email) {
  const dossier = await loadDossier(env, email);
  if (!email) return dossier;
  try {
    const [quiz, roadmap] = await Promise.all([
      loadUser(env, email).catch(() => null),
      loadRoadmap(env, email).catch(() => null),
    ]);
    const lines = buildCoordinateLines(quiz, roadmap);
    if (!lines.length) return dossier;
    const base = String(dossier || '').replace(COORDINATES_BLOCK_RE, '\n').trim();
    return (base ? base + '\n\n' : '')
      + '[[coordinates]]\n'
      + '# live O*NET vector snapshot — regenerated on every request; never copy into dossier fields\n'
      + lines.join('\n')
      + '\n[[/coordinates]]';
  } catch {
    return dossier;
  }
}
