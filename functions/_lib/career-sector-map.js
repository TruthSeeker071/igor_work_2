/** Server mirror of hub careerToQuizKeys + career-deep-dives slugs. */

const SLUG_TO_SECTOR_KEYS = {
  'software-engineer': ['tech', 'engineering'],
  'ux-designer': ['creative', 'tech'],
  'data-scientist': ['science', 'tech'],
  'product-manager': ['startups', 'business'],
  'investment-banker': ['finance'],
  'financial-analyst': ['finance'],
  actuary: ['finance', 'science'],
  accountant: ['finance'],
  surgeon: ['healthcare'],
  nurse: ['healthcare'],
  therapist: ['healthcare', 'social'],
  teacher: ['education'],
  professor: ['education', 'science'],
  lawyer: ['law'],
  'policy-analyst': ['law', 'government'],
  'graphic-designer': ['creative', 'marketing'],
  electrician: ['trades', 'engineering'],
  architect: ['engineering', 'creative'],
  journalist: ['marketing', 'media'],
  entrepreneur: ['startups', 'business'],
  'cybersecurity-analyst': ['cybersecurity', 'tech'],
  'devops-engineer': ['tech', 'operations'],
  'mechanical-engineer': ['engineering', 'trades'],
  'civil-engineer': ['engineering', 'government'],
  'social-worker': ['social', 'healthcare'],
  'public-relations': ['media', 'marketing'],
  'video-producer': ['media', 'creative'],
  pharmacist: ['pharmaceutical', 'healthcare'],
  'physician-assistant': ['healthcare', 'science'],
  'hr-manager': ['hr', 'business'],
  'operations-manager': ['operations', 'business'],
  'content-strategist': ['marketing', 'creative'],
  'biomedical-engineer': ['pharmaceutical', 'engineering'],
  paralegal: ['law'],
  'urban-planner': ['government', 'engineering'],
  'environmental-scientist': ['science', 'agriculture'],
  'supply-chain-manager': ['operations', 'business'],
  'physical-therapist': ['healthcare', 'sports'],
  copywriter: ['creative', 'marketing'],
  'real-estate-agent': ['realestate', 'business'],
  hospitality: ['hospitality', 'business', 'social'],
  'hotel-manager': ['hospitality', 'business', 'operations'],
  'restaurant-manager': ['hospitality', 'operations', 'business'],
  'event-planner': ['hospitality', 'social', 'creative'],
  'travel-tourism-manager': ['hospitality', 'social', 'business'],
  'software-engineering': ['tech', 'engineering'],
  'data-science': ['science', 'tech'],
  'ux-design': ['creative', 'tech'],
  'product-management': ['startups', 'business'],
  'investment-banking': ['finance'],
  'financial-analysis': ['finance'],
  'management-consulting': ['operations', 'business'],
  'marketing-strategy': ['marketing', 'creative'],
  'business-analytics': ['finance'],
  'corporate-strategy': ['operations', 'business'],
  'healthcare-admin': ['healthcare'],
  'legal-operations': ['law'],
};

export function sectorKeysForSlug(slug) {
  const key = String(slug || '').trim().toLowerCase();
  const keys = SLUG_TO_SECTOR_KEYS[key];
  return keys ? keys.slice() : [];
}

export function primarySectorKeysForSlug(slug) {
  return sectorKeysForSlug(slug).slice(0, 2);
}

export function slugCount() {
  return Object.keys(SLUG_TO_SECTOR_KEYS).length;
}
