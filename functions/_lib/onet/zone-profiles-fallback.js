/**
 * Derive sparse zone-dimension-profiles from zone-aggregate-vectors.json when
 * zone-dimension-profiles.json is missing.
 */
export function deriveZoneProfilesFromAggregates(aggregates, topK = 15) {
  const profiles = {};
  const zones = Object.keys(aggregates || {});
  for (const zone of zones) {
    const entry = aggregates[zone];
    // Prefer the representativeness-weighted centroid (zone-weighting.mjs) so
    // the top dimensions describe the zone's core careers, not its outliers.
    const lvMean = Array.isArray(entry) ? entry : (entry?.lvMeanW || entry?.lvMean);
    if (!Array.isArray(lvMean)) continue;
    const ranked = lvMean
      .map((v, i) => ({ index: i, score: Number(v) || 0 }))
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    const sum = ranked.reduce((s, d) => s + d.score, 0) || 1;
    profiles[zone] = ranked.map((d) => ({
      index: d.index,
      weight: Math.round((d.score / sum) * 10000) / 10000,
    }));
  }
  return profiles;
}
