// Shared career-pivot computation — the single quantifier behind BOTH pivot
// entry points (the /career-focus explicit picker and career-switch-chat's
// confirmed pivots), invoked from recordCareerFocus so neither duplicates it.
//
// Numbers produced:
//   transferPct         — cosine between the two CAREER vectors ("62% of your
//                         current-career vector transfers to X")
//   objectiveOverlapPct — the user's objective (skills/academics) vector vs
//                         the TARGET career vector (direction-only, same
//                         objectiveFitPercent the dual-fit UI shows)
//   breakdown           — per-coordinate classification of every dimension the
//                         target weighs high: transfers / partial / new_gap,
//                         ordered largest gap first (computeGapVector order —
//                         the same order roadmap regeneration closes gaps in).
import { getVectorsForSocs } from './vectors.js';
import {
  cosine,
  cosinePercent,
  objectiveFitPercent,
  computeGapVector,
  isObjectiveVectorActive,
} from './math.js';
import { loadDimensionRegistry, formatGapList } from './gap-format.js';

const TARGET_HIGH = 60;   // target-career level below this: dimension not material
const DIRECT_MAX_GAP = 12; // raw gap ≤ this → skill transfers directly
const PARTIAL_MAX_GAP = 30; // raw gap ≤ this → partial transfer
const BREAKDOWN_LIMIT = 12;

export function pivotSummaryLine(analysis, fromName, toName) {
  if (!analysis || analysis.transferPct == null) return '';
  let line = `${analysis.transferPct}% of your ${fromName || 'current career'} vector transfers to ${toName || 'the new target'}`;
  if (analysis.objectiveOverlapPct != null) {
    line += `; current skills/academics overlap the target at ${analysis.objectiveOverlapPct}%`;
  }
  return line + '.';
}

export async function computePivotAnalysis(env, baseUrl, quiz, fromSoc, toSoc) {
  if (!fromSoc || !toSoc || fromSoc === toSoc) return null;

  const vectorResult = await getVectorsForSocs(env, baseUrl, [fromSoc, toSoc]);
  if (vectorResult.error) return null;
  const fromVec = vectorResult.vectors[fromSoc];
  const toVec = vectorResult.vectors[toSoc];
  if (!fromVec || !toVec) return null;

  const analysis = {
    fromSoc,
    toSoc,
    transferPct: cosinePercent(cosine(fromVec, toVec)),
  };

  const objective = quiz?.objectiveVector?.values || null;
  if (objective && isObjectiveVectorActive(objective)) {
    analysis.objectiveOverlapPct = objectiveFitPercent(objective, toVec);

    // computeGapVector already importance-weights and ranks descending —
    // the breakdown inherits that order (largest gap first).
    const gaps = computeGapVector(objective, toVec, vectorResult.importance[toSoc]);
    const material = gaps.filter((g) => (toVec[g.index] || 0) >= TARGET_HIGH).slice(0, BREAKDOWN_LIMIT);

    let registry = null;
    try { registry = await loadDimensionRegistry(baseUrl); } catch (_) { /* names optional */ }
    const named = formatGapList(material, registry || { dimensions: [] }, material.length).gaps;
    const nameByIndex = new Map(named.map((n) => [n.index, n]));

    analysis.breakdown = material.map((g) => {
      const meta = nameByIndex.get(g.index) || {};
      const status = g.rawGap <= DIRECT_MAX_GAP
        ? 'transfers'
        : (g.rawGap <= PARTIAL_MAX_GAP ? 'partial' : 'new_gap');
      return {
        index: g.index,
        name: meta.name || `Dimension ${g.index}`,
        domain: meta.domain || 'unknown',
        gap: Math.round(g.gap * 10) / 10,
        rawGap: Math.round(g.rawGap),
        status,
      };
    });
  }

  return analysis;
}
