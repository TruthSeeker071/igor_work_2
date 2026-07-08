import { DIM_COUNT } from './constants.js';
import { clamp100 } from './math.js';
import { RESUME_THEME_RULES } from './academics-map.js';
import { SECTOR_TO_ZONE } from './user-vectors.js';

const MAX_DELTA_PER_DIM = 15;
const MAX_RULES_LAYER = 25;
/** Weights sum to 1 per zone profile — scale so top dims receive meaningful bumps. */
const PROFILE_BOOST_SCALE = 10;
const PROFILE_WEIGHT_FLOOR = 0.035;
const DOMINANT_ZONE_COUNT = 2;
const NON_DOMINANT_ATTENUATION = 0.08;

/** @type {Record<string, Array<{ index: number, weight: number, name?: string }>>|null} */
let profilesCache = null;

/** Minimal fallback when profiles artifact is not loaded yet. */
const FALLBACK_PROFILES = {
  tech: [
    { index: 21, weight: 0.12, name: 'Programming' },
    { index: 19, weight: 0.1, name: 'Technology Design' },
    { index: 139, weight: 0.1, name: 'Working with Computers' },
    { index: 45, weight: 0.08, name: 'Computers and Electronics' },
    { index: 22, weight: 0.08, name: 'Operations Analysis' },
  ],
  finance: [
    { index: 4, weight: 0.1, name: 'Mathematics' },
    { index: 32, weight: 0.1, name: 'Management of Financial Resources' },
    { index: 37, weight: 0.08, name: 'Economics and Accounting' },
  ],
  academic: [
    { index: 0, weight: 0.2, name: 'Reading Comprehension' },
    { index: 4, weight: 0.25, name: 'Mathematics' },
    { index: 7, weight: 0.2, name: 'Active Learning' },
    { index: 6, weight: 0.2, name: 'Critical Thinking' },
  ],
  business: [
    { index: 11, weight: 0.08, name: 'Coordination' },
    { index: 12, weight: 0.08, name: 'Persuasion' },
    { index: 32, weight: 0.08, name: 'Management of Financial Resources' },
  ],
};

export function setZoneDimensionProfiles(profiles) {
  profilesCache = profiles && typeof profiles === 'object' ? profiles : null;
}

export function getZoneDimensionProfilesSync() {
  return profilesCache || FALLBACK_PROFILES;
}

export function resolveThemeZone(themeName) {
  const key = String(themeName || '').trim();
  if (!key) return null;
  if (getZoneDimensionProfilesSync()[key]) return key;
  return SECTOR_TO_ZONE[key] || key;
}

function normalizeThemes(themes) {
  if (!Array.isArray(themes)) return [];
  return themes.map((t) => {
    if (typeof t === 'string') return { zone: t, weight: 1 };
    return { zone: t.zone, weight: typeof t.weight === 'number' ? t.weight : 1 };
  }).filter((t) => t.zone);
}

function zoneKeyFromTag(tag) {
  if (!tag) return null;
  return String(tag).replace(/^resume:/, '');
}

/**
 * Attenuate pending deltas for zones outside the top-N by total pending mass.
 */
export function sharpenPendingByZone(pending, zoneTag, opts = {}) {
  const dominantCount = opts.dominantCount ?? DOMINANT_ZONE_COUNT;
  const attenuation = opts.attenuation ?? NON_DOMINANT_ATTENUATION;
  const zoneScores = {};
  for (let i = 0; i < pending.length; i++) {
    if (pending[i] <= 0 || !zoneTag[i]) continue;
    const z = zoneKeyFromTag(zoneTag[i]);
    if (!z) continue;
    zoneScores[z] = (zoneScores[z] || 0) + pending[i];
  }
  const ranked = Object.entries(zoneScores).sort((a, b) => b[1] - a[1]);
  const dominant = new Set(ranked.slice(0, dominantCount).map(([z]) => z));
  if (!dominant.size) return;
  for (let i = 0; i < pending.length; i++) {
    if (pending[i] <= 0 || !zoneTag[i]) continue;
    const z = zoneKeyFromTag(zoneTag[i]);
    if (z && !dominant.has(z)) pending[i] *= attenuation;
  }
}

/** Suppress low-magnitude dimensions so direction peaks toward dominant themes. */
export function sharpenObjectiveValues(values, opts = {}) {
  const ratio = opts.peakRatio ?? 0.25;
  const attenuation = opts.dimAttenuation ?? 0.12;
  const peak = Math.max(...values, 0);
  if (peak <= 0) return values;
  const floor = peak * ratio;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0 && values[i] < floor) {
      values[i] = clamp100(Math.round(values[i] * attenuation));
    }
  }
  return values;
}

/**
 * Apply sector-themed sparse bumps to an objective vector.
 */
export function applyThemedRulesToObjective(objectiveVec, text, opts = {}) {
  const profiles = opts.profiles || getZoneDimensionProfilesSync();
  const rules = opts.rules || RESUME_THEME_RULES;
  const values = [...(objectiveVec?.values || new Array(DIM_COUNT).fill(0))];
  const sources = [...(objectiveVec?.sources || new Array(DIM_COUNT).fill(null))];
  const pending = new Array(DIM_COUNT).fill(0);
  const zoneTag = new Array(DIM_COUNT).fill(null);
  const blob = String(text || '');

  for (const rule of rules) {
    if (!rule.pattern.test(blob)) continue;
    const themes = normalizeThemes(rule.themes);
    for (const theme of themes) {
      const zone = resolveThemeZone(theme.zone);
      if (!zone) continue;
      const profile = profiles[zone];
      if (!Array.isArray(profile) || !profile.length) continue;
      const themeWeight = theme.weight > 0 ? theme.weight : 1;
      for (const entry of profile) {
        const idx = Number(entry.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= DIM_COUNT) continue;
        const w = Number(entry.weight) || 0;
        if (w < PROFILE_WEIGHT_FLOOR) continue;
        const delta = rule.boost * themeWeight * w * PROFILE_BOOST_SCALE;
        pending[idx] += delta;
        if (!zoneTag[idx] || delta > 0) zoneTag[idx] = `resume:${zone}`;
      }
    }
  }

  sharpenPendingByZone(pending, zoneTag);

  for (let i = 0; i < DIM_COUNT; i++) {
    if (pending[i] <= 0) continue;
    const delta = Math.min(pending[i], MAX_DELTA_PER_DIM);
    values[i] = clamp100(Math.min(MAX_RULES_LAYER, values[i] + delta));
    sources[i] = sources[i] || zoneTag[i] || 'resume-themed';
  }

  sharpenObjectiveValues(values);

  return {
    schemaId: objectiveVec?.schemaId || 'onet-lv-161-v1',
    values,
    sources,
    updatedAt: new Date().toISOString(),
    source: 'resume-rules',
  };
}

export { MAX_DELTA_PER_DIM, MAX_RULES_LAYER, FALLBACK_PROFILES, PROFILE_BOOST_SCALE };
