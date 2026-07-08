/** Server mirror of client academics-map — keyword rules for resume/objective parsing. */

/** @typedef {{ zone: string, weight?: number }} ResumeThemeRef */

/**
 * Sector-themed resume rules: keyword match → sparse zone dimension profile bumps.
 * @type {Array<{ pattern: RegExp, themes: ResumeThemeRef[], boost: number }>}
 */
export const RESUME_THEME_RULES = [
  {
    pattern: /\b(python|javascript|typescript|java|react|node\.?js|sql|programming|software|developer|github|aws|cloud|devops|cs\d{2,3})\b/i,
    themes: [{ zone: 'tech', weight: 1 }, { zone: 'cybersecurity', weight: 0.35 }],
    boost: 12,
  },
  {
    pattern: /\b(algorithmic trading|black-?scholes|market-?making|quantitative|numpy|pandas|computational|applied mathematics|statistical analysis|fintech)\b/i,
    themes: [{ zone: 'finance', weight: 1 }, { zone: 'tech', weight: 0.85 }, { zone: 'science', weight: 0.35 }],
    boost: 12,
  },
  {
    pattern: /\b(robotics|robotic|ros\b|autonomous (vehicle|system)|embedded systems)\b/i,
    themes: [{ zone: 'engineering', weight: 1 }, { zone: 'tech', weight: 0.85 }],
    boost: 10,
  },
  {
    pattern: /\b(ai product|product management|ml product|ai pm|artificial intelligence)\b/i,
    themes: [{ zone: 'tech', weight: 1 }, { zone: 'business', weight: 0.6 }],
    boost: 10,
  },
  {
    pattern: /\b(genomic|genomics|bioinformatics|sequencing|computational biology)\b/i,
    themes: [{ zone: 'science', weight: 1 }, { zone: 'tech', weight: 0.7 }],
    boost: 10,
  },
  {
    pattern: /\b(data|machine learning|deep learning|statistics|analytics|stats|pytorch|tensorflow)\b/i,
    themes: [{ zone: 'tech', weight: 0.8 }, { zone: 'science', weight: 0.5 }, { zone: 'finance', weight: 0.4 }],
    boost: 10,
  },
  {
    pattern: /\b(finance|accounting|excel|financial modeling|valuation|investment|banking|econ|economics)\b/i,
    themes: [{ zone: 'finance', weight: 1 }, { zone: 'business', weight: 0.5 }],
    boost: 10,
  },
  {
    pattern: /\b(marketing|social media|seo|content|advertising|brand|growth)\b/i,
    themes: [{ zone: 'marketing', weight: 1 }, { zone: 'creative', weight: 0.4 }],
    boost: 8,
  },
  {
    pattern: /\b(leadership|managed|team lead|president|director|supervisor)\b/i,
    themes: [{ zone: 'business', weight: 1 }, { zone: 'operations', weight: 0.6 }],
    boost: 10,
  },
  {
    pattern: /\b(research|laboratory|thesis|publication|manuscript|experiment)\b/i,
    themes: [{ zone: 'science', weight: 1 }, { zone: 'tech', weight: 0.35 }],
    boost: 10,
  },
  {
    pattern: /\b(design|figma|ux|ui|graphic|adobe|photoshop|illustrator)\b/i,
    themes: [{ zone: 'creative', weight: 1 }, { zone: 'tech', weight: 0.45 }],
    boost: 10,
  },
  {
    pattern: /\b(internship|intern)\b/i,
    themes: [{ zone: 'business', weight: 0.7 }, { zone: 'tech', weight: 0.5 }],
    boost: 6,
  },
  {
    pattern: /\b(gpa|dean'?s list|honors|\b[34]\.\d{1,2}\b)\b/i,
    themes: [{ zone: 'academic', weight: 1 }],
    boost: 5,
  },
  {
    pattern: /\b(volunteer|community|nonprofit|outreach|advocacy)\b/i,
    themes: [{ zone: 'social', weight: 1 }, { zone: 'government', weight: 0.35 }],
    boost: 6,
  },
  {
    pattern: /\b(project|capstone|portfolio|built|launched)\b/i,
    themes: [{ zone: 'tech', weight: 0.6 }, { zone: 'business', weight: 0.5 }],
    boost: 8,
  },
  {
    pattern: /\b(law|lsat|legal|attorney|paralegal|litigation)\b/i,
    themes: [{ zone: 'law', weight: 1 }, { zone: 'government', weight: 0.4 }],
    boost: 9,
  },
  {
    pattern: /\b(nursing|pre-?med|healthcare|clinical|patient|mcat)\b/i,
    themes: [{ zone: 'healthcare', weight: 1 }, { zone: 'science', weight: 0.45 }],
    boost: 10,
  },
  {
    pattern: /\b(engineering|mechanical|civil|electrical|cad|solidworks|matlab)\b/i,
    themes: [{ zone: 'engineering', weight: 1 }, { zone: 'tech', weight: 0.35 }],
    boost: 9,
  },
  {
    pattern: /\b(cybersecurity|infosec|penetration|soc analyst|siem|cissp)\b/i,
    themes: [{ zone: 'cybersecurity', weight: 1 }, { zone: 'tech', weight: 0.5 }],
    boost: 10,
  },
  {
    pattern: /\b(consulting|strategy|mba|operations|supply chain|logistics)\b/i,
    themes: [{ zone: 'business', weight: 1 }, { zone: 'operations', weight: 0.55 }],
    boost: 8,
  },
  {
    pattern: /\b(teaching|tutor|education|curriculum|classroom|professor)\b/i,
    themes: [{ zone: 'education', weight: 1 }, { zone: 'social', weight: 0.35 }],
    boost: 8,
  },
  {
    pattern: /\b(journalism|broadcast|film|video|podcast|media)\b/i,
    themes: [{ zone: 'media', weight: 1 }, { zone: 'creative', weight: 0.45 }],
    boost: 8,
  },
  {
    pattern: /\b(hospitality|hotel|restaurant|culinary|tourism|event planning)\b/i,
    themes: [{ zone: 'hospitality', weight: 1 }],
    boost: 7,
  },
  {
    pattern: /\b(agriculture|farming|conservation|forestry|sustainability)\b/i,
    themes: [{ zone: 'agriculture', weight: 1 }, { zone: 'science', weight: 0.35 }],
    boost: 7,
  },
  {
    pattern: /\b(welding|electrician|plumber|hvac|carpentry|construction|trades)\b/i,
    themes: [{ zone: 'trades', weight: 1 }, { zone: 'engineering', weight: 0.3 }],
    boost: 8,
  },
];

/** @deprecated Use RESUME_THEME_RULES — kept for tests referencing old export name. */
export const RESUME_KEYWORD_RULES = RESUME_THEME_RULES;

export const GRAD_OBJECTIVE_TEXT = [
  'medicine healthcare nursing mcat pre-med science med school health professions',
  'law school lsat legal government attorney pre-law',
  'phd research academia graduate science thesis dissertation',
  'mba business finance graduate school management',
  'internship work industry experience tech business career',
  '',
];

export const KEYWORD_IND = {
  calc: { tech: 2, finance: 2, engineering: 2, science: 1 },
  math: { tech: 2, finance: 3, engineering: 2, science: 1 },
  statisti: { finance: 3, tech: 2, science: 2 },
  stats: { finance: 3, tech: 2, science: 2 },
  econom: { finance: 3, business: 3, realestate: 1 },
  econ: { finance: 3, business: 3, realestate: 1 },
  comput: { tech: 4, engineering: 2, cybersecurity: 2 },
  cyber: { cybersecurity: 4, tech: 2 },
  medic: { healthcare: 4, science: 1, pharmaceutical: 1 },
  mcat: { healthcare: 4, science: 2 },
  law: { law: 4, government: 1 },
  lsat: { law: 4, government: 1 },
  premed: { healthcare: 4, science: 2 },
  prelaw: { law: 4, government: 1 },
  mba: { business: 3, finance: 2 },
  phd: { science: 4, education: 2 },
  nursing: { healthcare: 4 },
  accounting: { finance: 3, business: 2 },
};

export const ZONE_PROFILES_URL = '/data/onet/artifacts/zone-dimension-profiles.json';

export function classDeltaFromText(text, sign = 1) {
  const t = String(text || '').toLowerCase();
  const d = {};
  if (!t) return d;
  for (const [kw, scores] of Object.entries(KEYWORD_IND)) {
    if (!t.includes(kw)) continue;
    for (const [k, pts] of Object.entries(scores)) {
      d[k] = (d[k] || 0) + pts * sign;
    }
  }
  return d;
}
