/**
 * Tier-1 baked-knowledge mock-interview floor.
 *
 * Deterministic per-career-family interview playbooks (question mix,
 * technical archetypes, evaluation emphasis) plus the shared scoring
 * rubric and interviewer personas used by the mock-interview feature.
 * No AI calls live here — this module only supplies facts and prompt
 * text for the generator/scorer to consume.
 */

import { CAREER_FAMILIES, resolveCareerFamily } from './career-family.js';

export { CAREER_FAMILIES, resolveCareerFamily };

const DEFAULT_FAMILY = 'general';

const STRUCTURE = ['intro', 'behavioral', 'technical', 'candidate_questions', 'close'];

// mix.behavioral + mix.technical always sums to 6 (the remaining 2 of the
// 8 total questions are the fixed intro/warmup and candidate_questions/close).
const FAMILY_PLAYBOOKS = {
  finance: {
    label: 'Finance & Investment Banking',
    mix: { behavioral: 2, technical: 4 },
    technicalArchetypes: [
      'Markets fundamentals pop quiz',
      'Valuation / "pitch me a stock"',
      'Mental math drill',
      'Probability brainteaser',
      'Market-making / trading game',
      'Three-statement accounting linkage question',
    ],
    behavioralFocus: [
      'Why this firm / this seat, specifically',
      'A deal, project, or analysis you drove end-to-end',
      'Handling a high-pressure deadline',
    ],
    evaluationEmphasis: [
      'Quantitative reasoning speed and accuracy',
      'Market awareness and intellectual curiosity',
      'Composure under rapid-fire follow-ups',
    ],
    personaNotes: 'Expect a fast pace, cold market-awareness checks, and zero tolerance for hand-waved numbers.',
    sampleTechnicalQuestions: [
      'Walk me through a DCF.',
      "Pitch me a stock you like and one you'd short.",
      "What's 37 times 43, and what's the fastest way to get there?",
      'A stock is at $50. I offer you a coin flip for +$10/-$10 — do you take it, and why?',
    ],
  },
  software: {
    label: 'Software & Tech',
    mix: { behavioral: 2, technical: 4 },
    technicalArchetypes: [
      'Live coding / algorithm problem',
      'System design walkthrough',
      'Debugging a broken snippet',
      'Past-project deep-dive',
      'API or data-model design question',
    ],
    behavioralFocus: [
      'Handling ambiguous or shifting requirements',
      'Conflict or disagreement with a teammate',
      'Learning a new technology under deadline pressure',
    ],
    evaluationEmphasis: [
      'Problem-solving process, not just the final answer',
      'Code clarity and correctness',
      'Communication while thinking out loud',
    ],
    personaNotes: 'Expect a peer engineer probing your reasoning aloud, not just checking your final answer.',
    sampleTechnicalQuestions: [
      'Given a stream of values, find the first repeated one — walk me through your approach.',
      'Design a URL shortener that needs to handle 10M requests a day.',
      "Walk me through the most technically challenging bug you've fixed.",
      "How would you scale this service if traffic 10x'd overnight?",
    ],
  },
  engineering: {
    label: 'Engineering',
    mix: { behavioral: 2, technical: 4 },
    technicalArchetypes: [
      'Technical design walkthrough of a past project',
      'Root-cause / debugging scenario',
      'Standards, tolerances, or safety-code question',
      'Trade-off and estimation problem',
      'CAD or simulation-tool proficiency check',
    ],
    behavioralFocus: [
      'Working within a cross-disciplinary team',
      'A design trade-off you had to defend',
      'Catching or fixing a costly mistake',
    ],
    evaluationEmphasis: [
      'Rigor of technical reasoning',
      'Awareness of constraints (cost, safety, tolerance)',
      'Clarity explaining technical work to a mixed audience',
    ],
    personaNotes: 'Expect probing on assumptions behind any estimate or design choice you offer.',
    sampleTechnicalQuestions: [
      'Walk me through the trade-offs in your senior design project.',
      'A part is failing in the field — how do you root-cause it?',
      'How do you decide when a design meets code versus needs revision?',
      'Estimate the load requirements for this scenario — talk me through your assumptions.',
    ],
  },
  consulting: {
    label: 'Consulting',
    mix: { behavioral: 2, technical: 4 },
    technicalArchetypes: [
      'Market-sizing estimation',
      'Profitability case',
      'Market-entry case',
      'Mental math under time pressure',
      'Chart or data-interpretation exercise',
    ],
    behavioralFocus: [
      'Leadership on a team project',
      'Persuading a skeptical stakeholder',
      'A time you had to synthesize ambiguous information quickly',
    ],
    evaluationEmphasis: [
      'MECE structure (mutually exclusive, collectively exhaustive)',
      'Adapting a framework to the specifics of the case rather than reciting it',
      'Clear, confident recommendation at the end',
    ],
    personaNotes: 'Expect a case-first interview: state your structure before diving into analysis.',
    sampleTechnicalQuestions: [
      'Estimate the number of gas stations in Chicago.',
      "Our client's profits dropped 20% last year — how would you figure out why?",
      'A retailer wants to enter a new market — how do you evaluate whether they should?',
      "Walk me through how you'd structure an analysis of a merger.",
    ],
  },
  healthcare: {
    label: 'Healthcare & Clinical',
    mix: { behavioral: 4, technical: 2 },
    technicalArchetypes: [
      'Clinical vignette / scenario',
      'Ethics dilemma (autonomy vs. beneficence)',
      'Licensure and scope-of-practice question',
      'Informed-consent walkthrough',
      'HIPAA or compliance scenario',
      'Triage / prioritization exercise',
    ],
    behavioralFocus: [
      'Disagreeing with a supervising clinician',
      'Handling an emotional or distressed patient or family',
      'A time you caught or prevented an error',
      'Working within a multidisciplinary care team',
    ],
    evaluationEmphasis: [
      'Sound ethical reasoning (autonomy, beneficence, non-maleficence, justice)',
      'Patient-communication skill',
      'Compliance and scope-of-practice awareness',
    ],
    personaNotes: 'Expect ethics-heavy scenarios probing judgment as much as clinical knowledge.',
    sampleTechnicalQuestions: [
      'A patient refuses a treatment you believe is necessary — what do you do?',
      "How do you handle disagreeing with a supervising physician's treatment plan?",
      'Describe how you would obtain informed consent from a patient who is anxious and confused.',
      'A colleague makes a medication error — walk me through what you do next.',
    ],
  },
  design: {
    label: 'Design & Creative',
    mix: { behavioral: 2, technical: 4 },
    technicalArchetypes: [
      'Portfolio critique walkthrough',
      'Live design-critique exercise',
      'Design-process deep-dive on a past project',
      'Whiteboard UX problem',
      'Tooling and craft proficiency check',
    ],
    behavioralFocus: [
      'Handling stakeholder disagreement on direction',
      'Defending a design decision with data',
      'Working within tight design constraints',
    ],
    evaluationEmphasis: [
      'Quality of process narration, not just the final artifact',
      'Ability to take and apply critique',
      'User-centered reasoning behind decisions',
    ],
    personaNotes: 'Expect the portfolio to drive the conversation — be ready to defend every choice on it.',
    sampleTechnicalQuestions: [
      'Walk me through the process behind your favorite project in your portfolio.',
      'Critique this screen — what would you change and why?',
      'How did you handle a stakeholder who disagreed with your design direction?',
      "Sketch out how you'd redesign our onboarding flow.",
    ],
  },
  media: {
    label: 'Media & Journalism',
    mix: { behavioral: 3, technical: 3 },
    technicalArchetypes: [
      'Portfolio / clips discussion',
      'Editorial-judgment scenario (what to cover or cut)',
      'Breaking-news / deadline simulation',
      'Fact-checking and sourcing scenario',
      'Audience or analytics interpretation',
    ],
    behavioralFocus: [
      'Working a tight deadline with incomplete information',
      'Handling a source who backed out or a story that fell apart',
      'Pushback on a piece from an editor or subject',
    ],
    evaluationEmphasis: [
      'Editorial judgment and news sense',
      'Sourcing and verification discipline',
      'Clarity and concision in storytelling',
    ],
    personaNotes: 'Expect deadline-simulation pressure and scrutiny of how you verify claims.',
    sampleTechnicalQuestions: [
      "Walk me through your best clip and why you're proud of it.",
      'Breaking news just came in that contradicts your draft — what do you do in the next 20 minutes?',
      'How do you decide what to cut when a story runs long?',
      'How would you verify a claim from an anonymous source?',
    ],
  },
  research: {
    label: 'Research',
    mix: { behavioral: 2, technical: 4 },
    technicalArchetypes: [
      'Methods defense (why this design, not another)',
      'Statistics / analysis walkthrough',
      'Prior publication or thesis defense',
      'Confounds and threats-to-validity probe',
      'Reproducibility / data-handling question',
    ],
    behavioralFocus: [
      'Handling a failed experiment or null result',
      'Collaborating with (or managing conflict with) a PI or lab mate',
      'Communicating findings to a non-expert audience',
    ],
    evaluationEmphasis: [
      'Rigor of methodological reasoning',
      'Statistical literacy',
      'Intellectual honesty about limitations',
    ],
    personaNotes: 'Expect deep probing on methodology — be ready to defend every design choice you made.',
    sampleTechnicalQuestions: [
      'Why did you choose this methodology over the alternatives?',
      'What is the biggest threat to validity in your work, and how did you address it?',
      "Walk me through how you'd analyze this dataset.",
      'What would you do differently if you re-ran this study?',
    ],
  },
  education: {
    label: 'Education & Teaching',
    mix: { behavioral: 4, technical: 2 },
    technicalArchetypes: [
      'Lesson-plan walkthrough',
      'Classroom-management scenario',
      'Differentiated-instruction scenario',
      'Assessment and grading-philosophy question',
    ],
    behavioralFocus: [
      'Handling a disruptive or disengaged student',
      'A difficult conversation with a parent or guardian',
      'Adapting instruction for mixed skill levels',
      'Collaborating with other teachers or administrators',
    ],
    evaluationEmphasis: [
      'Classroom-management judgment',
      'Evidence of student-outcome focus',
      'Warmth balanced with clear boundaries',
    ],
    personaNotes: 'Expect scenario-based prompts testing in-the-moment classroom judgment.',
    sampleTechnicalQuestions: [
      "Walk me through how you'd plan a lesson for a class with mixed skill levels.",
      'A student is disruptive during instruction — what do you do in the moment?',
      'How do you assess whether students actually learned the material?',
      'How would you handle a parent who disagrees with a grade you gave?',
    ],
  },
  law: {
    label: 'Law & Legal',
    mix: { behavioral: 3, technical: 3 },
    technicalArchetypes: [
      'Issue-spotting hypothetical',
      'Writing-sample discussion',
      'Ethics / professional-responsibility scenario',
      'Client-conflict scenario',
      'Legal-research-approach question',
    ],
    behavioralFocus: [
      'Managing a demanding or difficult client',
      'A time you had to deliver bad news',
      'Working under a tight filing deadline',
    ],
    evaluationEmphasis: [
      'Precision of issue-spotting and reasoning',
      'Professional-responsibility judgment',
      'Written and verbal clarity',
    ],
    personaNotes: 'Expect a hypothetical fact pattern used to test issue-spotting live, on the spot.',
    sampleTechnicalQuestions: [
      'Spot the issues in this fact pattern.',
      'Walk me through the reasoning in your writing sample.',
      "A client asks you to do something you're not sure is ethical — what do you do?",
      'How would you research an unfamiliar area of law under a same-day deadline?',
    ],
  },
  business_ops: {
    label: 'Business & Operations',
    mix: { behavioral: 3, technical: 3 },
    technicalArchetypes: [
      'Role-relevant scenario walkthrough',
      'Metrics-literacy question (read a dashboard)',
      'Prioritization / trade-off case',
      'Process-improvement scenario',
      'Cross-functional conflict scenario',
    ],
    behavioralFocus: [
      'Owning a metric that slipped',
      'Cross-functional disagreement',
      'Prioritizing under competing deadlines',
    ],
    evaluationEmphasis: [
      'Metrics literacy and data-driven reasoning',
      'Prioritization judgment',
      'Ownership language (what you did, not just the team)',
    ],
    personaNotes: 'Expect practical, scenario-driven questions rooted in day-to-day operational trade-offs.',
    sampleTechnicalQuestions: [
      'Walk me through a process you improved and how you measured the improvement.',
      'How would you prioritize between three competing deadlines?',
      "Read this dashboard — what's the first thing you'd investigate?",
      'Describe a cross-functional conflict you navigated.',
    ],
  },
  trades: {
    label: 'Skilled Trades',
    mix: { behavioral: 2, technical: 4 },
    technicalArchetypes: [
      'Safety-protocol scenario',
      'Hands-on troubleshooting walkthrough',
      'Certification and code-compliance check',
      'Tool / equipment proficiency question',
      'Emergency or on-the-job incident scenario',
    ],
    behavioralFocus: [
      'A time a safety issue came up on the job',
      'Handling a job that did not match the original spec',
      'Working alongside a difficult crew member or client',
    ],
    evaluationEmphasis: [
      'Safety judgment',
      'Hands-on troubleshooting competence',
      'Certification currency and code awareness',
    ],
    personaNotes: 'Expect concrete, scenario-based questions rather than abstract behavioral prompts.',
    sampleTechnicalQuestions: [
      "Walk me through how you'd troubleshoot a system that isn't powering on.",
      'What is your process when a job does not match the original spec?',
      'Describe a time a safety issue came up on the job — what did you do?',
      'What certifications do you hold, and when do they need renewal?',
    ],
  },
  public_service: {
    label: 'Public Service & Policy',
    mix: { behavioral: 4, technical: 2 },
    technicalArchetypes: [
      'Policy-scenario analysis',
      'Stakeholder-management roleplay',
      'Budget / resource trade-off scenario',
      'Regulatory-compliance question',
    ],
    behavioralFocus: [
      'Building support for an unpopular but necessary decision',
      'Navigating opposing stakeholder groups',
      'Communicating a setback to the public or a community',
      'Working within a bureaucratic or resource-constrained process',
    ],
    evaluationEmphasis: [
      'Stakeholder-management judgment',
      'Clarity of public communication',
      'Awareness of policy or budget trade-offs',
    ],
    personaNotes: 'Expect scenario prompts that test political and stakeholder judgment, not technical recall.',
    sampleTechnicalQuestions: [
      "Walk me through how you'd build support for an unpopular but necessary policy.",
      'Two stakeholder groups want opposite outcomes — how do you navigate that?',
      'How would you communicate a budget cut to an affected community?',
      "Describe how you'd evaluate whether a program is working.",
    ],
  },
  general: {
    label: 'General / Other',
    mix: { behavioral: 3, technical: 3 },
    technicalArchetypes: [
      'Role-relevant scenario walkthrough',
      'Metrics-literacy question',
      'Prioritization case',
      'Problem-solving walkthrough',
    ],
    behavioralFocus: [
      'A project you are proud of, start to finish',
      'Learning something quickly under pressure',
      'Handling conflicting priorities',
    ],
    evaluationEmphasis: [
      'Clarity and structure of communication',
      'Concrete, specific examples over generalities',
      'Evidence of ownership and follow-through',
    ],
    personaNotes: 'Role-agnostic playbook: keep prompts general and let candidate examples drive specificity.',
    sampleTechnicalQuestions: [
      "Walk me through a project you're proud of, start to finish.",
      'How do you prioritize when everything feels urgent?',
      'Describe a time you had to learn something quickly to get a task done.',
      'What metrics would you use to know if you are succeeding in this role?',
    ],
  },
};

/**
 * Always returns a valid interview playbook. Unknown/unrecognized family
 * ids fall back to 'general'.
 */
export function playbookForFamily(family) {
  const key = FAMILY_PLAYBOOKS[family] ? family : DEFAULT_FAMILY;
  const base = FAMILY_PLAYBOOKS[key];
  return {
    family: key,
    label: base.label,
    structure: STRUCTURE.slice(),
    mix: { ...base.mix },
    technicalArchetypes: base.technicalArchetypes.slice(),
    behavioralFocus: base.behavioralFocus.slice(),
    evaluationEmphasis: base.evaluationEmphasis.slice(),
    personaNotes: base.personaNotes,
    sampleTechnicalQuestions: base.sampleTechnicalQuestions.slice(),
  };
}

// Exactly 6 scoring metrics, each with concrete observable anchors at
// levels 1, 3, and 5.
export const INTERVIEW_METRICS = [
  {
    id: 'communication',
    label: 'Communication & Clarity',
    anchors: {
      1: 'Rambling, unclear answers; the interviewer has to re-ask the question to get a straight answer.',
      3: 'Answers are understandable and roughly on-topic but include filler or need occasional clarifying follow-ups.',
      5: 'Answers are crisp and organized and land the point in the first sentence; jargon is explained without being asked.',
    },
  },
  {
    id: 'structure',
    label: 'Structure',
    anchors: {
      1: 'Answers wander with no discernible shape — no setup, no throughline, no conclusion.',
      3: 'Uses a recognizable shape (e.g., rough STAR or case structure) but skips a step or buries the outcome.',
      5: 'Consistently frames Situation-Task-Action-Result (or case-equivalent structure) and signposts the approach before diving in.',
    },
  },
  {
    id: 'specificity',
    label: 'Specificity',
    anchors: {
      1: "Speaks only in generalities (\"I'm a team player\"); no concrete example, number, or name.",
      3: "Gives a real example but leaves out scale or measurable outcome (\"it went well\").",
      5: 'Names the specific project, decision, and a quantified result (%, $, time, count) without being prompted.',
    },
  },
  {
    id: 'technical',
    label: 'Technical Ability',
    anchors: {
      1: 'Cannot work through the problem even with hints; fundamental gaps in domain knowledge.',
      3: 'Gets to a workable answer with some interviewer prompting; reasoning has minor gaps.',
      5: 'Solves independently, explains the reasoning aloud, and correctly handles a follow-up curveball.',
    },
  },
  {
    id: 'composure',
    label: 'Composure Under Pressure',
    anchors: {
      1: 'Visibly rattled by pushback or a tough question; answers shut down or become defensive.',
      3: 'Recovers within a beat after a hard follow-up; stays polite and re-engages.',
      5: 'Treats pushback as normal conversation, probes the question further, and stays calm through a rapid-fire follow-up chain.',
    },
  },
  {
    id: 'fit',
    label: 'Role & Culture Fit',
    anchors: {
      1: 'Nothing offered connects to this role, company, or team; motivation reads generic or copy-pasted.',
      3: 'Draws a plausible connection between background and the role when asked.',
      5: 'Proactively ties examples to the specific role/team and asks informed questions that show real research.',
    },
  },
];

/**
 * Compact string embedding the 6 scoring metrics + anchors for a scoring
 * prompt. Notes that 'technical' may be N/A when no technical question was
 * asked, and that overall is a weighted composite (technical weighted up
 * for technical-heavy roles).
 */
export function metricsPromptBlock() {
  const lines = ['SCORING RUBRIC (score each metric 1-5, using the anchors below):'];
  for (const metric of INTERVIEW_METRICS) {
    lines.push(`  ${metric.label} (${metric.id}):`);
    lines.push(`    1 = ${metric.anchors[1]}`);
    lines.push(`    3 = ${metric.anchors[3]}`);
    lines.push(`    5 = ${metric.anchors[5]}`);
  }
  lines.push(
    "  Note: 'technical' may be scored N/A if no technical question was asked in the session — do not penalize for a missing technical score in that case."
  );
  lines.push(
    '  Overall score is a weighted composite of the six metrics, with the technical weight increased for technical-heavy roles (e.g. software, finance, engineering) and decreased (or dropped) for roles where no technical question was asked.'
  );
  return lines.join('\n');
}

// Two distinct interviewer personas: a warm coach and a brisk,
// realistic-pressure interviewer. Neither is ever abusive.
export const PERSONAS = {
  coach: {
    id: 'coach',
    name: 'Maya',
    style:
      'Warm, encouraging, and collaborative. Gives the candidate room to think out loud, offers a supportive nudge when they stall, calls out strong answers explicitly, and treats mistakes as coachable moments rather than failures.',
  },
  pressure: {
    id: 'pressure',
    name: 'Elliot',
    style:
      'Brisk and probing. Asks tight follow-up questions, keeps an eye on the clock, interrupts padding to get to the point, and pushes on weak spots the way a real interviewer under time pressure would. Firm but never abusive or demeaning.',
  },
};
