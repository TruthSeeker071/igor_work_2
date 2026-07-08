#!/usr/bin/env node
/**
 * Tests for sector-stratified resume → objective vector rules.
 * Run: node scripts/test-resume-objective-rules.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildZoneDimensionProfiles } from './onet-etl/build-zone-profiles.mjs';
import { applyThemedRulesToObjective, setZoneDimensionProfiles } from '../functions/_lib/onet/resume-theme-map.js';
import { RESUME_THEME_RULES } from '../functions/_lib/onet/academics-map.js';
import { DIM_COUNT } from '../functions/_lib/onet/constants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const profilesPath = new URL('../data/onet/artifacts/zone-dimension-profiles.json', import.meta.url);
const centroidsPath = new URL('../data/onet/artifacts/zone-centroids.json', import.meta.url);
const registryPath = new URL('../data/onet/dimension-registry-v1.json', import.meta.url);

let failed = 0;
function assert(cond, msg) {
  if (cond) return;
  failed += 1;
  console.error('FAIL:', msg);
}

const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
setZoneDimensionProfiles(profiles);

const zoneCount = Object.keys(profiles).length;
assert(zoneCount >= 18, `expected >= 18 zones, got ${zoneCount}`);

Object.entries(profiles).forEach(([zone, entries]) => {
  const minLen = zone === 'academic' ? 5 : 10;
  assert(Array.isArray(entries) && entries.length >= minLen, `${zone} profile too short (${entries?.length || 0})`);
  const sum = entries.reduce((s, e) => s + e.weight, 0);
  assert(sum > 0.85 && sum < 1.15, `${zone} weights sum ${sum.toFixed(3)}`);
});

const pythonText = 'Software engineering intern — built Python APIs and SQL dashboards for a finance team.';
const pyVec = applyThemedRulesToObjective(
  { schemaId: 'onet-lv-161-v1', values: new Array(DIM_COUNT).fill(0), sources: [] },
  pythonText,
  { profiles, rules: RESUME_THEME_RULES },
);

assert(pyVec.values[21] >= 5, `Programming (21) should be boosted, got ${pyVec.values[21]}`);
assert(pyVec.values[139] >= 3, `Working with Computers (139) should be boosted, got ${pyVec.values[139]}`);
assert(pyVec.values[10] < 3, `Social Perceptiveness (10) should stay low, got ${pyVec.values[10]}`);

const nonZero = pyVec.values.filter((v) => v > 0).length;
assert(nonZero < 75, `Python resume should be sparser than domain-wide (<75 non-zero), got ${nonZero}`);

const financeText = 'Financial analyst internship — Excel modeling, valuation, and investment research.';
const finVec = applyThemedRulesToObjective(
  { schemaId: 'onet-lv-161-v1', values: new Array(DIM_COUNT).fill(0), sources: [] },
  financeText,
  { profiles, rules: RESUME_THEME_RULES },
);

const financeKnowledge = finVec.values.slice(35, 68);
const financeNonZero = financeKnowledge.filter((v) => v > 0).length;
assert(financeNonZero < 28, `finance should not fill all knowledge dims, got ${financeNonZero}/33`);
assert(financeKnowledge.some((v) => v >= 5), 'finance should boost some knowledge dims');

const heavyText = [
  'Python JavaScript React SQL machine learning data analytics',
  'finance accounting excel investment banking leadership managed team',
  'internship project capstone gpa 3.9 cybersecurity',
].join(' ');
const heavyVec = applyThemedRulesToObjective(
  { schemaId: 'onet-lv-161-v1', values: new Array(DIM_COUNT).fill(0), sources: [] },
  heavyText,
  { profiles, rules: RESUME_THEME_RULES },
);
const maxVal = Math.max(...heavyVec.values);
assert(maxVal <= 25, `stacking cap: max dimension should be <=25, got ${maxVal}`);

// ETL builder smoke
const centroids = JSON.parse(readFileSync(centroidsPath, 'utf8'));
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const rebuilt = buildZoneDimensionProfiles(centroids, registry, { academic: profiles.academic });
assert(rebuilt.tech && rebuilt.tech.length > 0, 'rebuild profiles from centroids');

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('resume objective rules tests passed');
console.log(`  zones: ${zoneCount}, python non-zero dims: ${nonZero}, max stacked: ${maxVal}`);
