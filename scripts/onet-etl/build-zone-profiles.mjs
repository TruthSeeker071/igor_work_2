#!/usr/bin/env node
/**
 * Build sparse zone-dimension-profiles.json from zone-centroids + manual overrides.
 * Usage: node scripts/onet-etl/build-zone-profiles.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DIM_COUNT = 161;
const PROFILE_TOP_K = 25;

const centroidsPath = path.join(ROOT, 'data/onet/artifacts/zone-centroids.json');
const registryPath = path.join(ROOT, 'data/onet/dimension-registry-v1.json');
const overridesPath = path.join(ROOT, 'data/onet/zone-dimension-profile-overrides.json');
const outPath = path.join(ROOT, 'data/onet/artifacts/zone-dimension-profiles.json');

export function buildZoneDimensionProfiles(zoneCentroids, registry, overrides = {}) {
  const zones = Object.keys(zoneCentroids);
  const dimNames = (registry?.dimensions || []).map((d) => d.name);
  const globalMean = new Array(DIM_COUNT).fill(0);

  zones.forEach((zone) => {
    zoneCentroids[zone].forEach((v, i) => { globalMean[i] += v; });
  });
  for (let i = 0; i < DIM_COUNT; i++) globalMean[i] /= zones.length || 1;

  const profiles = {};
  for (const zone of zones) {
    const centroid = zoneCentroids[zone];
    const ranked = centroid
      .map((v, i) => ({ index: i, delta: v - globalMean[i], score: v, name: dimNames[i] || `dim-${i}` }))
      .sort((a, b) => b.delta - a.delta);
    let top = ranked.filter((d) => d.delta > 0).slice(0, PROFILE_TOP_K);
    if (top.length < 12) {
      top = [...ranked].sort((a, b) => b.score - a.score).slice(0, PROFILE_TOP_K);
    }
    const sum = top.reduce((s, d) => s + Math.max(d.delta, d.score * 0.01), 0) || 1;
    profiles[zone] = top.map((d) => ({
      index: d.index,
      weight: Math.round((Math.max(d.delta, d.score * 0.01) / sum) * 10000) / 10000,
      name: d.name,
    }));
  }

  for (const [zone, entries] of Object.entries(overrides || {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    const byIndex = new Map((profiles[zone] || []).map((e) => [e.index, { ...e }]));
    entries.forEach((entry) => {
      byIndex.set(entry.index, {
        index: entry.index,
        weight: entry.weight,
        name: entry.name || dimNames[entry.index] || `dim-${entry.index}`,
        ...(entry.pin ? { pin: true } : {}),
      });
    });
    const merged = [...byIndex.values()];
    const weightSum = merged.reduce((s, e) => s + e.weight, 0) || 1;
    profiles[zone] = merged
      .map((e) => ({ index: e.index, weight: Math.round((e.weight / weightSum) * 10000) / 10000, name: e.name }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, PROFILE_TOP_K + 5);
    const renorm = profiles[zone].reduce((s, e) => s + e.weight, 0) || 1;
    profiles[zone] = profiles[zone].map((e) => ({
      ...e,
      weight: Math.round((e.weight / renorm) * 10000) / 10000,
    }));
  }

  return profiles;
}

function main() {
  if (!fs.existsSync(centroidsPath)) {
    console.error('Missing zone-centroids.json — run npm run onet:build first.');
    process.exit(1);
  }
  const zoneCentroids = JSON.parse(fs.readFileSync(centroidsPath, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const overrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : {};
  const profiles = buildZoneDimensionProfiles(zoneCentroids, registry, overrides);
  fs.writeFileSync(outPath, JSON.stringify(profiles, null, 2));
  console.log(`Wrote ${Object.keys(profiles).length} zone profiles → ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
