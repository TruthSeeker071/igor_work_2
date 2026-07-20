#!/usr/bin/env node
/**
 * Verification script for the Tier-1 resume/interview baked-knowledge
 * floor. Plain node, no deps. Exits 1 on any failure.
 *
 * Run: node scripts/test-resume-formats.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAREER_FAMILIES,
  resolveCareerFamily,
  formatProfileForFamily,
  ACTION_VERBS,
  resumeRubricBlock,
} from '../functions/_lib/resume-formats.js';

import {
  playbookForFamily,
  INTERVIEW_METRICS,
  PERSONAS,
} from '../functions/_lib/interview-playbooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

// --- formatProfileForFamily: every family has >=1 variant, exactly 1 recommended ---
for (const family of CAREER_FAMILIES) {
  const profile = formatProfileForFamily(family);
  assert(
    Array.isArray(profile.templateVariants) && profile.templateVariants.length >= 1,
    `formatProfileForFamily('${family}') should have >=1 templateVariant`
  );
  const recommendedCount = profile.templateVariants.filter((v) => v.recommended === true).length;
  assert(
    recommendedCount === 1,
    `formatProfileForFamily('${family}') should have exactly 1 recommended variant, got ${recommendedCount}`
  );
}

// --- finance and software include latex-onepager ---
for (const family of ['finance', 'software']) {
  const profile = formatProfileForFamily(family);
  const hasLatex = profile.templateVariants.some((v) => v.id === 'latex-onepager');
  assert(hasLatex, `formatProfileForFamily('${family}') should include a 'latex-onepager' variant`);
}

// --- unknown family falls back to general ---
{
  const fallback = formatProfileForFamily('nonsense');
  const general = formatProfileForFamily('general');
  assert(fallback.family === 'general', `formatProfileForFamily('nonsense') should resolve to the general profile, got '${fallback.family}'`);
  assert(fallback.label === general.label, `formatProfileForFamily('nonsense') should match the general profile label`);
}

// --- resolveCareerFamily cases ---
const resolveCases = [
  [{ soc: '15-1252.00' }, 'software'],
  [{ soc: '13-2051.00' }, 'finance'],
  [{ soc: '13-1111.00' }, 'consulting'],
  [{ soc: '29-1141.00' }, 'healthcare'],
  [{ slug: 'investment-banker' }, 'finance'],
  [{ careerName: 'Management Consultant' }, 'consulting'],
];
for (const [input, expected] of resolveCases) {
  const actual = resolveCareerFamily(input);
  assert(
    actual === expected,
    `resolveCareerFamily(${JSON.stringify(input)}) should be '${expected}', got '${actual}'`
  );
}

// --- ACTION_VERBS ---
assert(Array.isArray(ACTION_VERBS) && ACTION_VERBS.length >= 30, `ACTION_VERBS.length should be >= 30, got ${ACTION_VERBS?.length}`);

// --- resumeRubricBlock mentions the formula and the clarifying-question rule ---
{
  const block = resumeRubricBlock();
  const lower = block.toLowerCase();
  assert(lower.includes('formula'), 'resumeRubricBlock() should mention "formula"');
  assert(lower.includes('clarifying question'), 'resumeRubricBlock() should mention the clarifying-question rule');
}

// --- playbookForFamily: every family has >=4 technicalArchetypes and >=3 sampleTechnicalQuestions ---
for (const family of CAREER_FAMILIES) {
  const playbook = playbookForFamily(family);
  assert(
    Array.isArray(playbook.technicalArchetypes) && playbook.technicalArchetypes.length >= 4,
    `playbookForFamily('${family}') should have >=4 technicalArchetypes, got ${playbook.technicalArchetypes?.length}`
  );
  assert(
    Array.isArray(playbook.sampleTechnicalQuestions) && playbook.sampleTechnicalQuestions.length >= 3,
    `playbookForFamily('${family}') should have >=3 sampleTechnicalQuestions, got ${playbook.sampleTechnicalQuestions?.length}`
  );
}

// --- unknown family playbook falls back to general ---
{
  const fallback = playbookForFamily('nonsense');
  assert(fallback.family === 'general', `playbookForFamily('nonsense') should resolve to the general playbook, got '${fallback.family}'`);
}

// --- INTERVIEW_METRICS ---
assert(
  Array.isArray(INTERVIEW_METRICS) && INTERVIEW_METRICS.length === 6,
  `INTERVIEW_METRICS.length should be 6, got ${INTERVIEW_METRICS?.length}`
);
for (const metric of INTERVIEW_METRICS || []) {
  assert(
    metric.anchors && metric.anchors[1] && metric.anchors[3] && metric.anchors[5],
    `INTERVIEW_METRICS entry '${metric.id}' should have anchors for 1, 3, and 5`
  );
}

// --- PERSONAS ---
assert(
  PERSONAS?.coach?.name && PERSONAS?.pressure?.name && PERSONAS.coach.name !== PERSONAS.pressure.name,
  `PERSONAS.coach.name ('${PERSONAS?.coach?.name}') should differ from PERSONAS.pressure.name ('${PERSONAS?.pressure?.name}')`
);

// --- toLatex: pasted blank lines in free text must not break line-break commands ---
// Loads the real shipped assets/js/shared/resume-render.js (a plain-script IIFE,
// not CJS) the same way scripts/test-resume-ats.cjs does: readFileSync + eval
// into a stubbed module scope.
{
  const code = fs.readFileSync(path.join(REPO, 'assets/js/shared/resume-render.js'), 'utf8');
  const sandboxModule = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'exports', code);
  fn(sandboxModule, sandboxModule.exports);
  const R = sandboxModule.exports;

  const resume = {
    contact: { name: 'Test User', email: 't@example.com', phone: '', location: '', links: [] },
    summary: 'line1\n\nline2\n',
    sections: [],
  };
  const tex = R.toLatex(resume);
  assert(!tex.includes('\\\\\n\n'), 'toLatex output must not have a blank line right after a \\\\ line-break command');
  assert(!/\n\n\\\\/.test(tex), 'toLatex output must not have a blank line right before a \\\\ line-break command');
  assert(tex.includes('line1 line2'), 'toLatex should collapse the pasted blank line while keeping both halves of the summary');
}

// --- report ---
if (failures.length) {
  console.error(`resume:format-check FAIL (${failures.length} failure${failures.length === 1 ? '' : 's'})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('resume:format-check PASS');
