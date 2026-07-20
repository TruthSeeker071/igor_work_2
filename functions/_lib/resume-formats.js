/**
 * Tier-1 baked-knowledge resume formatting floor.
 *
 * Deterministic per-career-family formatting profiles (length, font,
 * section order, emphasis, template variants) plus the Harvard-style
 * bullet rubric used to steer the Gemini resume generator. No AI calls
 * live here — this module only supplies facts and prompt text.
 *
 * Research notes baked in (see scripts/test-resume-formats.mjs for the
 * assertions that pin these down):
 *  - Finance/IB resumes: 1 page, conservative serif, no color/graphics,
 *    half-inch margins, every bullet verb+action+number.
 *  - Tech resumes: 1 page early-career (2 acceptable at senior level),
 *    sans-serif, project-forward, GitHub/portfolio links expected.
 *  - Consulting: 1 page, leadership + quantified business impact,
 *    case-competition wins matter.
 *  - Healthcare/clinical: 2-3 pages once licensed, licensure/certs live
 *    directly under the name, compliance & patient-outcome language.
 *  - Design: 1 page, portfolio link is mandatory, resume is secondary
 *    evidence to the portfolio itself.
 *  - Research/academia: this module produces an industry-facing RESUME,
 *    not an academic CV. A CV (full publication list, 3-20+ pages) is a
 *    different object and callers should not conflate the two.
 *  - General/other: 1-2 pages, reverse-chronological.
 */

import { CAREER_FAMILIES, resolveCareerFamily } from './career-family.js';

export { CAREER_FAMILIES, resolveCareerFamily };

const DEFAULT_FAMILY = 'general';

// Families that get the project-forward variant (projects/portfolio ahead
// of a strict chronological work-history list).
const PROJECT_FORWARD_FAMILIES = new Set(['software', 'engineering', 'design', 'media']);

// Families that get the dense LaTeX one-pager variant.
const LATEX_FAMILIES = new Set(['finance', 'software', 'engineering', 'consulting', 'research']);

// Exactly one recommended variant id per family.
const RECOMMENDED_VARIANT = {
  finance: 'latex-onepager',
  software: 'project-forward',
  engineering: 'project-forward',
  consulting: 'classic',
  healthcare: 'classic',
  design: 'project-forward',
  media: 'project-forward',
  research: 'classic',
  education: 'classic',
  law: 'classic',
  business_ops: 'classic',
  trades: 'classic',
  public_service: 'classic',
  general: 'classic',
};

function buildTemplateVariants(family) {
  const variants = [
    {
      id: 'classic',
      label: 'Classic',
      description:
        'Reverse-chronological single-column resume. Safe, ATS-friendly default that works for any employer.',
      engine: 'html',
    },
  ];

  if (PROJECT_FORWARD_FAMILIES.has(family)) {
    variants.push({
      id: 'project-forward',
      label: 'Project-Forward',
      description:
        'Leads with a projects/portfolio section ahead of the work-history block — for candidates whose strongest evidence is what they shipped, not just where they were employed.',
      engine: 'html',
    });
  }

  if (LATEX_FAMILIES.has(family)) {
    variants.push({
      id: 'latex-onepager',
      label: 'LaTeX One-Pager',
      description:
        "Dense, precisely-kerned single-column LaTeX layout (Jake's-Resume lineage) favored in finance and technical recruiting.",
      engine: 'latex',
    });
  }

  const recommendedId = RECOMMENDED_VARIANT[family] || 'classic';
  return variants.map((v) => (v.id === recommendedId ? { ...v, recommended: true } : v));
}

// Core per-family facts. templateVariants + family + label are merged in
// by formatProfileForFamily() so every family definition here stays
// focused on the substantive content.
const FAMILY_PROFILES = {
  finance: {
    label: 'Finance & Investment Banking',
    pages: '1',
    fontClass: 'serif',
    fontSuggestions: ['Garamond', 'Times New Roman', 'Georgia'],
    sectionOrder: ['summary', 'education', 'experience', 'leadership', 'skills'],
    tone: 'Conservative, precise, quantified. No adjective survives without a number behind it.',
    emphasis: [
      'deal, transaction, or portfolio experience',
      'quantified financial impact ($ and %)',
      'technical/tool fluency (Excel, financial modeling, Bloomberg/FactSet)',
      'GPA and coursework when strong',
      'leadership in finance-adjacent clubs or competitions',
    ],
    bulletStyle: 'formula',
    notes:
      'One page is non-negotiable at analyst/associate level. Half-inch margins, no color, no graphics, no columns.',
  },
  software: {
    label: 'Software & Tech',
    pages: '1',
    fontClass: 'sans',
    fontSuggestions: ['Helvetica', 'Inter', 'Calibri'],
    sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education'],
    tone: 'Direct and project-forward. Let the shipped work and the metrics do the talking.',
    emphasis: [
      'shipped projects with measurable impact (latency, scale, revenue, users)',
      'languages, frameworks, and tools',
      'GitHub / portfolio / live-project links',
      'system-design or scale-relevant details',
    ],
    bulletStyle: 'formula',
    notes:
      'One page is the default for early-career candidates; two pages is acceptable at 5+ years of experience. Keep it single-column and ATS-friendly.',
  },
  engineering: {
    label: 'Engineering',
    pages: '1',
    fontClass: 'sans',
    fontSuggestions: ['Helvetica', 'Calibri', 'Arial'],
    sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education'],
    tone: 'Technical and concrete — scope, tools, and measured outcomes over adjectives.',
    emphasis: [
      'certifications (PE, EIT) where applicable',
      'CAD / simulation / analysis tools',
      'project scope and safety-relevant outcomes',
      'quantified efficiency, cost, or reliability improvements',
    ],
    bulletStyle: 'formula',
    notes: 'One page for early-career; two pages acceptable once project history is substantial.',
  },
  consulting: {
    label: 'Consulting',
    pages: '1',
    fontClass: 'serif',
    fontSuggestions: ['Garamond', 'Georgia', 'Times New Roman'],
    sectionOrder: ['summary', 'education', 'experience', 'leadership', 'skills'],
    tone: 'Polished and leadership-forward, every claim backed by a quantified outcome.',
    emphasis: [
      'leadership roles, even outside work (clubs, case competitions)',
      'quantified business impact',
      'case-competition results',
      'cross-functional or client-facing teamwork',
    ],
    bulletStyle: 'formula',
    notes: 'One page even for early-career candidates; unquantified bullets read as unsubstantiated claims.',
  },
  healthcare: {
    label: 'Healthcare & Clinical',
    pages: '2-3',
    fontClass: 'serif',
    fontSuggestions: ['Georgia', 'Times New Roman', 'Garamond'],
    sectionOrder: ['summary', 'licenses', 'education', 'experience', 'skills'],
    tone: 'Precise and credential-forward. Compliance and patient-outcome language, not marketing language.',
    emphasis: [
      'licensure and certifications (placed prominently, near the top)',
      'clinical rotations / supervised hours',
      'patient-outcome and quality metrics',
      'compliance, documentation, and HIPAA competency',
      'continuing education',
    ],
    bulletStyle: 'formula',
    notes: '2-3 pages is standard once licensed; the one-page rule does not apply here.',
  },
  design: {
    label: 'Design & Creative',
    pages: '1',
    fontClass: 'sans',
    fontSuggestions: ['Helvetica', 'Inter', 'Futura'],
    sectionOrder: ['summary', 'experience', 'projects', 'skills', 'education'],
    tone: 'Visual-literate and concise; the portfolio carries the proof, the resume carries the context.',
    emphasis: [
      'portfolio link (mandatory, not optional)',
      'design process on 1-2 signature projects',
      'measurable outcomes of design work (conversion, engagement, adoption)',
      'tool fluency (Figma, Adobe Creative Cloud, prototyping tools)',
    ],
    bulletStyle: 'formula',
    notes: 'Portfolio link is mandatory. Without it the resume is treated as incomplete by most reviewers.',
  },
  media: {
    label: 'Media & Journalism',
    pages: '1',
    fontClass: 'sans',
    fontSuggestions: ['Helvetica', 'Georgia', 'Calibri'],
    sectionOrder: ['summary', 'experience', 'projects', 'skills', 'education'],
    tone: 'Clear, editorial, evidence-driven — clips and audience impact over self-description.',
    emphasis: [
      'clips / portfolio link',
      'audience or engagement metrics',
      'editorial judgment and deadline performance',
      'multimedia / platform skills',
    ],
    bulletStyle: 'formula',
    notes: 'Link to clips or a portfolio; without evidence of published work the resume reads as unverified.',
  },
  research: {
    label: 'Research (industry-facing resume)',
    pages: '2',
    fontClass: 'serif',
    fontSuggestions: ['Georgia', 'Times New Roman', 'Garamond'],
    sectionOrder: ['summary', 'education', 'experience', 'publications', 'skills'],
    tone: 'Methodical and evidence-based, written for an industry or applied-research audience.',
    emphasis: [
      'publications and presentations (selected, not exhaustive)',
      'methods and statistical/analytical tools',
      'grants or funding secured',
      'advisor, lab, or research-group affiliation',
    ],
    bulletStyle: 'formula',
    notes:
      'This profile produces an industry-facing RESUME, not an academic CV. A CV (full publication list, 3-20+ pages depending on career stage) is a different object; do not conflate the two.',
  },
  education: {
    label: 'Education & Teaching',
    pages: '2',
    fontClass: 'serif',
    fontSuggestions: ['Georgia', 'Garamond', 'Times New Roman'],
    sectionOrder: ['summary', 'education', 'experience', 'skills'],
    tone: 'Warm but evidence-based — outcomes for students, not just duties performed.',
    emphasis: [
      'teaching license / certifications',
      'curriculum or lesson design',
      'classroom-management and engagement outcomes',
      'measured student-achievement gains',
    ],
    bulletStyle: 'formula',
    notes: 'Certification status belongs near the top; district and grade-level context should be explicit.',
  },
  law: {
    label: 'Law & Legal',
    pages: '1',
    fontClass: 'serif',
    fontSuggestions: ['Garamond', 'Times New Roman', 'Georgia'],
    sectionOrder: ['summary', 'education', 'experience', 'activities', 'skills'],
    tone: 'Formal and precise; conservative formatting matches the profession.',
    emphasis: [
      'writing-sample availability',
      'law review / moot court / journal involvement',
      'bar admission status and jurisdiction',
      'case or matter experience with scope noted (without breaching confidentiality)',
    ],
    bulletStyle: 'formula',
    notes: 'One page for early-career candidates; keep formatting conservative (no color, minimal graphics).',
  },
  business_ops: {
    label: 'Business & Operations',
    pages: '2',
    fontClass: 'sans',
    fontSuggestions: ['Calibri', 'Helvetica', 'Arial'],
    sectionOrder: ['summary', 'experience', 'skills', 'education'],
    tone: 'Outcome-driven — the resume should read like a track record of measurable ownership.',
    emphasis: [
      'process improvements with before/after metrics',
      'cross-functional or team leadership',
      'KPIs owned and moved',
      'budget or P&L scope',
    ],
    bulletStyle: 'formula',
    notes: 'Two pages is the norm for corporate/business roles once past entry level.',
  },
  trades: {
    label: 'Skilled Trades',
    pages: '1',
    fontClass: 'sans',
    fontSuggestions: ['Calibri', 'Arial', 'Helvetica'],
    sectionOrder: ['summary', 'licenses', 'experience', 'skills', 'education'],
    tone: 'Concrete and safety-conscious; certifications and hands-on scope over soft-skill language.',
    emphasis: [
      'certifications and licenses (with renewal status)',
      'safety record',
      'tools and equipment proficiency',
      'apprenticeship / journeyman / master status',
    ],
    bulletStyle: 'formula',
    notes: 'Certifications belong near the top; renewal/expiration dates should be current.',
  },
  public_service: {
    label: 'Public Service & Policy',
    pages: '2',
    fontClass: 'serif',
    fontSuggestions: ['Georgia', 'Times New Roman', 'Garamond'],
    sectionOrder: ['summary', 'experience', 'education', 'skills'],
    tone: 'Formal and outcome-oriented, written for program- or policy-level scrutiny.',
    emphasis: [
      'policy or program impact',
      'stakeholder and coalition management',
      'budget or program scope',
      'public communication and reporting',
    ],
    bulletStyle: 'formula',
    notes:
      'Federal (USAJobs) resumes are capped at two pages as of late 2025 — keep within that even when tempted to add detail.',
  },
  general: {
    label: 'General / Other',
    pages: '1-2',
    fontClass: 'sans',
    fontSuggestions: ['Calibri', 'Helvetica', 'Georgia'],
    sectionOrder: ['summary', 'experience', 'education', 'skills'],
    tone: 'Clear and reverse-chronological — the safest default when the target role is unclear or mixed.',
    emphasis: [
      'the 2-3 clearest accomplishments available',
      'transferable skills',
      'straightforward reverse-chronological clarity',
    ],
    bulletStyle: 'formula',
    notes: 'One page for early-career, two pages once there is 5+ years of relevant history.',
  },
};

/**
 * Always returns a valid format profile. Unknown/unrecognized family ids
 * fall back to 'general'.
 */
export function formatProfileForFamily(family) {
  const key = FAMILY_PROFILES[family] ? family : DEFAULT_FAMILY;
  const base = FAMILY_PROFILES[key];
  return {
    family: key,
    label: base.label,
    pages: base.pages,
    fontClass: base.fontClass,
    fontSuggestions: base.fontSuggestions.slice(),
    sectionOrder: base.sectionOrder.slice(),
    tone: base.tone,
    emphasis: base.emphasis.slice(),
    bulletStyle: base.bulletStyle,
    notes: base.notes,
    templateVariants: buildTemplateVariants(key),
  };
}

// ~40 Harvard-style strong resume action verbs.
export const ACTION_VERBS = [
  'Accelerated',
  'Achieved',
  'Analyzed',
  'Architected',
  'Automated',
  'Built',
  'Conducted',
  'Consolidated',
  'Coordinated',
  'Delivered',
  'Designed',
  'Developed',
  'Directed',
  'Drove',
  'Engineered',
  'Established',
  'Evaluated',
  'Executed',
  'Expanded',
  'Facilitated',
  'Forecasted',
  'Generated',
  'Implemented',
  'Improved',
  'Increased',
  'Initiated',
  'Launched',
  'Led',
  'Managed',
  'Negotiated',
  'Optimized',
  'Orchestrated',
  'Overhauled',
  'Presented',
  'Reduced',
  'Resolved',
  'Restructured',
  'Secured',
  'Spearheaded',
  'Streamlined',
  'Synthesized',
  'Transformed',
  'Validated',
];

export const BANNED_OPENERS = [
  'responsible for',
  'helped with',
  'worked on',
  'assisted with',
  'duties included',
  'tasked with',
  'in charge of',
  'participated in',
  'involved in',
  'familiar with',
];

/**
 * Compact multi-line rubric block for embedding directly into a Gemini
 * resume-generation prompt.
 */
export function resumeRubricBlock() {
  return [
    'RESUME BULLET RUBRIC (Harvard-style formula):',
    '  [strong action verb] + [what you did / scope] + [quantified result or impact]',
    '  - One accomplishment per bullet. Max 2 lines per bullet.',
    '  - Quantify wherever possible: %, $, count, or time (e.g. "cut load time 40%", "managed $2M budget").',
    '  - NEVER invent a number. If a metric is missing, do not guess — ask a clarifying question instead.',
    `  - Never open a bullet with: ${BANNED_OPENERS.join(', ')}.`,
    '  - No duty-listing ("responsible for X"). Every bullet is an accomplishment, not a job description.',
    '  - Recruiters scan a resume for ~7 seconds: lead with impact, not context.',
    `  - Prefer strong verbs, e.g.: ${ACTION_VERBS.slice(0, 12).join(', ')}, ...`,
  ].join('\n');
}

/**
 * Short prompt block describing a family's format profile (length, tone,
 * emphasis) for the resume generator.
 */
export function formatGuidanceBlock(family) {
  const profile = formatProfileForFamily(family);
  return [
    `FORMAT GUIDANCE (${profile.label}):`,
    `  - Target length: ${profile.pages} page(s).`,
    `  - Section order: ${profile.sectionOrder.join(' -> ')}.`,
    `  - Tone: ${profile.tone}`,
    `  - Emphasize: ${profile.emphasis.join('; ')}.`,
    `  - Notes: ${profile.notes}`,
  ].join('\n');
}
