/**
 * Deterministic career-family resolver.
 *
 * No AI, no network calls. Maps a career (via slug / SOC code / free-text
 * career name) onto one of a small set of "families" that drive resume
 * formatting defaults and mock-interview playbooks. Kept intentionally
 * coarse — this is a floor, not a taxonomy.
 */

import { sectorKeysForSlug } from './career-sector-map.js';

export const CAREER_FAMILIES = [
  'finance',
  'software',
  'engineering',
  'consulting',
  'healthcare',
  'design',
  'media',
  'research',
  'education',
  'law',
  'business_ops',
  'trades',
  'public_service',
  'general',
];

const DEFAULT_FAMILY = 'general';

// (a) Sector keys used by career-sector-map.js -> career family.
const SECTOR_KEY_TO_FAMILY = {
  finance: 'finance',
  tech: 'software',
  cybersecurity: 'software',
  engineering: 'engineering',
  healthcare: 'healthcare',
  pharmaceutical: 'healthcare',
  law: 'law',
  creative: 'design',
  media: 'media',
  science: 'research',
  education: 'education',
  government: 'public_service',
  social: 'public_service',
  trades: 'trades',
  business: 'business_ops',
  operations: 'business_ops',
  startups: 'business_ops',
  marketing: 'business_ops',
  hr: 'business_ops',
  realestate: 'business_ops',
  hospitality: 'business_ops',
  sports: 'business_ops',
  agriculture: 'business_ops',
};

function familyFromSlug(slug) {
  if (!slug) return null;
  const keys = sectorKeysForSlug(slug);
  if (!keys.length) return null;
  const families = [];
  for (const key of keys) {
    const family = SECTOR_KEY_TO_FAMILY[key];
    if (family && !families.includes(family)) families.push(family);
  }
  // Slug only takes precedence when it resolves to exactly one family.
  return families.length === 1 ? families[0] : null;
}

// (b) SOC major group -> career family.
function familyFromSoc(soc) {
  if (!soc) return null;
  const code = String(soc).trim();
  const match = code.match(/^(\d{2})-(\d{4})/);
  if (!match) return null;
  const major = match[1];
  const full = `${major}-${match[2]}`;

  switch (major) {
    case '11':
      return 'business_ops';
    case '13':
      if (full === '13-1111') return 'consulting';
      if (full.startsWith('13-2')) return 'finance';
      return 'business_ops';
    case '15':
      return 'software';
    case '17':
      return 'engineering';
    case '19':
      return 'research';
    case '21':
      return 'public_service';
    case '23':
      return 'law';
    case '25':
      return 'education';
    case '27':
      // Journalists / broadcast / media occupations live under 27-3xxx.
      return full.startsWith('27-3') ? 'media' : 'design';
    case '29':
    case '31':
      return 'healthcare';
    case '33':
      return 'public_service';
    case '35':
    case '37':
    case '39':
    case '41':
    case '43':
      return 'business_ops';
    case '45':
    case '47':
    case '49':
    case '51':
    case '53':
      return 'trades';
    default:
      return null;
  }
}

// (c) careerName keyword fallback, checked in priority order.
const NAME_RULES = [
  ['consulting', /consult/i],
  ['finance', /quant|invest(ment|or|ing)?|financ|account(ant|ing)?|actuar|banker|trading|trader|hedge fund|private equity/i],
  ['software', /software|developer|programmer|data scien|machine learning|devops|full.?stack|back.?end|front.?end|web dev/i],
  ['engineering', /engineer/i],
  ['healthcare', /nurse|physician|clinical|medical|healthcare|therapist|pharmac|surgeon|dental|dentist/i],
  ['law', /lawyer|attorney|legal|paralegal|counsel/i],
  ['education', /teach|professor|educat|instructor|tutor/i],
  ['research', /research|scientist|analyst.*lab|lab tech/i],
  ['design', /design|ux\b|ui\b|graphic/i],
  ['media', /journalist|media|editor|producer|broadcast|reporter/i],
  ['public_service', /polic(y|e)|government|social work|public (service|health)|diplomat/i],
  ['trades', /electric|plumb|mechanic|technician|construction|carpenter|hvac|welder/i],
  ['business_ops', /manager|operations|human resources|\bhr\b|marketing|sales|real estate|hospitality|logistics|supply chain/i],
];

function familyFromName(careerName) {
  if (!careerName) return null;
  const name = String(careerName);
  for (const [family, pattern] of NAME_RULES) {
    if (pattern.test(name)) return family;
  }
  return null;
}

/**
 * Resolve a career onto one of CAREER_FAMILIES. Deterministic, no AI.
 * Resolution order: unambiguous slug -> SOC major group -> careerName
 * keywords -> 'general'.
 */
export function resolveCareerFamily({ soc, slug, careerName } = {}) {
  const bySlug = familyFromSlug(slug);
  if (bySlug) return bySlug;

  const bySoc = familyFromSoc(soc);
  if (bySoc) return bySoc;

  const byName = familyFromName(careerName);
  if (byName) return byName;

  return DEFAULT_FAMILY;
}
