import { SCHEMA_ID } from './constants.js';

let registryCache = null;

export async function loadDimensionRegistry(baseUrl) {
  if (registryCache) return registryCache;
  const url = new URL('/data/onet/dimension-registry-v1.json', baseUrl).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`);
  registryCache = await res.json();
  return registryCache;
}

function dimByIndex(registry, index) {
  const dims = registry?.dimensions || [];
  for (let i = 0; i < dims.length; i += 1) {
    if (dims[i].index === index) return dims[i];
  }
  return dims[index] || null;
}

export function formatGapList(topGaps, registry, limit = 5) {
  if (!topGaps || !topGaps.length) return { gaps: [], labels: [] };
  const out = [];
  const labels = [];
  const n = Math.min(limit, topGaps.length);
  for (let i = 0; i < n; i += 1) {
    const g = topGaps[i];
    const idx = g.index;
    const dim = dimByIndex(registry, idx);
    const name = dim?.name || `Dimension ${idx}`;
    const domain = dim?.domain || 'unknown';
    out.push({
      index: idx,
      gap: g.gap,
      name,
      domain,
    });
    labels.push(name);
  }
  return { gaps: out, labels };
}

export function vectorInputsFingerprint(quiz) {
  const p = quiz?.personalityVector?.updatedAt || '';
  const o = quiz?.objectiveVector?.updatedAt || '';
  const schema = quiz?.vectorSchemaId || SCHEMA_ID;
  return `${schema}|${p}|${o}`;
}

export function buildFitContext(vectorFit, quizFitBreakdown, targetSoc, registry) {
  let vectorGaps = [];
  let topGaps = [];
  if (vectorFit?.vectorGaps?.length) {
    vectorGaps = vectorFit.vectorGaps;
    topGaps = vectorGaps.map((g) => g.name).filter(Boolean);
  } else if (vectorFit?.topGaps?.length && registry) {
    const formatted = formatGapList(vectorFit.topGaps, registry, 5);
    vectorGaps = formatted.gaps;
    topGaps = formatted.labels;
  }
  if (!topGaps.length && quizFitBreakdown?.gaps?.length) {
    topGaps = quizFitBreakdown.gaps.slice(0, 4);
  }
  const quizPct = vectorFit?.fitScore ?? vectorFit?.personalityFit ?? quizFitBreakdown?.percent ?? null;
  return {
    quizFitPercent: quizPct != null ? Math.round(Number(quizPct)) : null,
    vectorFitScore: vectorFit?.fitScore != null ? Math.round(Number(vectorFit.fitScore)) : null,
    personalityFit: vectorFit?.personalityFit != null ? Math.round(Number(vectorFit.personalityFit)) : null,
    objectiveFit: vectorFit?.objectiveFit != null ? Math.round(Number(vectorFit.objectiveFit)) : null,
    preparedness: vectorFit?.preparedness != null ? Math.round(Number(vectorFit.preparedness)) : null,
    targetSoc: targetSoc || null,
    topGaps,
    vectorGaps,
  };
}
