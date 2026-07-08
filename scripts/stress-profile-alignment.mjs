#!/usr/bin/env node
/**
 * Profile alignment drift tests.
 * Run: node scripts/stress-profile-alignment.mjs
 */
import { sectorKeysForSlug, slugCount } from '../functions/_lib/career-sector-map.js';
import { detectDrift } from '../functions/_lib/profile-alignment.js';
import { ensureSectorFitSheet } from '../functions/_lib/sector-fit-sheet.js';
import { buildSeedDossier } from '../functions/_lib.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error('FAIL:', msg);
}

console.log('== Profile alignment stress tests ==\n');

assert(slugCount() >= 45, `slug map has entries (${slugCount()})`);
assert(
  JSON.stringify(sectorKeysForSlug('graphic-designer')) === JSON.stringify(['creative', 'marketing']),
  'graphic-designer maps to creative, marketing',
);

const sampleDossier = `# user dossier v1
top_industries: tech, startups
archetype: The Multi-Threat
goals: break into software engineering, pursue applied mathematics
interests: math, coding, chess, AI engineering
career_signals: Software Engineering, AI Engineering
target_career: Graphic Designer (switched 2026-06-25, via home_dropdown)
prior_focus: (none yet)
archived_interests: (none yet)
recent: (no chat yet)
notes: quant finance research
`;

const quiz = {
  careerFocus: {
    slug: 'graphic-designer',
    name: 'graphic designer',
    source: 'home_dropdown',
    updatedAt: new Date().toISOString(),
  },
  scores: { tech: 90, startups: 85, creative: 70, marketing: 65 },
};
ensureSectorFitSheet(quiz);

const drift = detectDrift(quiz, sampleDossier);
assert(drift.severity === 'large', `sample dossier + graphic designer -> large (got ${drift.severity})`);
assert(drift.reasons.includes('target_sector_overlap'), 'includes target_sector_overlap');

const alignedQuiz = {
  careerFocus: { slug: 'software-engineer', name: 'Software Engineer', updatedAt: new Date().toISOString() },
  scores: { tech: 95, engineering: 80 },
};
ensureSectorFitSheet(alignedQuiz);
const alignedDossier = buildSeedDossier({ topIndustries: ['tech', 'engineering'] });
const okDrift = detectDrift(alignedQuiz, alignedDossier);
assert(okDrift.severity !== 'large', 'aligned tech focus is not large drift');

const sheetOnlyQuiz = { scores: { creative: 100, marketing: 97, startups: 96, business: 81 } };
ensureSectorFitSheet(sheetOnlyQuiz);
const sheetDrift = detectDrift(sheetOnlyQuiz, buildSeedDossier({ topIndustries: ['tech'] }));
assert(
  sheetDrift.reasons.includes('sheet_vs_dossier_top4') || sheetDrift.severity === 'small',
  'sheet vs dossier top4 detected',
);

console.log(`\n== Results: ${passed} passed, ${failed} failed ==`);
if (failed) process.exit(1);
console.log('All profile alignment tests passed.');
