// test:school — the student's school reaches every AI surface that advises them,
// and a school change stated in conversation propagates everywhere.
//
// The bug this exists to prevent: a UChicago student was told to join the
// Cornell Quant Fund, because `quiz.school` was known to exactly one query
// builder and to no prompt at all. Two invariants keep that fixed:
//   1. every advice-giving prompt builder carries schoolPromptBlock();
//   2. dossier `school:` ⇄ quiz_profiles.school stay in step, in both
//      directions, so Marco (or any surface that merges dossier facts) can
//      change it once and have it apply everywhere.
import assert from 'node:assert/strict';

import {
  sanitizeSchoolName, normalizeSchoolKey, cleanSchoolValue, schoolPromptBlock,
  schoolFromDossier, applySchoolToDossier, resolveSchool, setSchool, syncSchoolFromDossier,
} from '../functions/_lib/school.js';
import { normalizeUser, denormalizeUser } from '../functions/_lib/user-model.js';
import { buildGenerateTreePrompt, buildGeneratePrompt } from '../functions/_lib/roadmap-generate.js';
import { buildOpportunityPrompt } from '../functions/_lib/opportunity-core.js';
import { buildScorecardPrompt } from '../functions/_lib/scorecard-core.js';
import { buildOutreachPrompt } from '../functions/_lib/contact-core.js';
import { buildWeeklyPlanPrompt } from '../functions/_lib/weekly-plan-gen.js';
import { buildTurnPrompt, buildDebriefPrompt } from '../functions/_lib/interview-core.js';
import { buildCoordinateLines } from '../functions/_lib/dossier-coordinates.js';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err && err.message ? err.message : err}`);
  }
}

const SCHOOL = 'University of Chicago';

// ---------- 1. value hygiene ----------
await test('school value: strips injection chars, caps at 80, rejects placeholders', async () => {
  assert.equal(sanitizeSchoolName('  U<sc>ri&pt"Chi\'cago   '), 'UscriptChicago');
  assert.equal(sanitizeSchoolName('x'.repeat(120)).length, 80);
  assert.equal(normalizeSchoolKey(' UChicago '), 'uchicago');
  assert.equal(cleanSchoolValue('(unknown)'), '', 'seed placeholder is not a school');
  assert.equal(cleanSchoolValue('(none yet)'), '');
  assert.equal(cleanSchoolValue('  '), '');
  assert.equal(cleanSchoolValue(SCHOOL), SCHOOL);
  assert.equal(sanitizeSchoolName('Texas A&M-Commerce'), 'Texas AM-Commerce', 'hyphens survive');
});

// ---------- 2. the prompt block states the fact AND the constraint ----------
await test('schoolPromptBlock: names the school and bars other universities\' clubs', async () => {
  const b = schoolPromptBlock(SCHOOL);
  assert.ok(b.includes(`School: ${SCHOOL}`), 'school stated');
  assert.ok(/never name another university's internal club/i.test(b), 'constraint present');
  assert.ok(b.includes(`at ${SCHOOL}, or open to students anywhere`), 'constraint is scoped to their school');
  const none = schoolPromptBlock('');
  assert.ok(/not stated/.test(none) && /open-to-anyone/.test(none), 'unknown school → open-to-anyone only');
  assert.equal(schoolPromptBlock('(unknown)'), none, 'placeholder behaves as unknown');
});

// ---------- 3. every advice-giving prompt builder carries it ----------
// Add a row here when you add an AI surface that tells a student what to do.
const SURFACES = [
  ['roadmap tree', (school) => buildGenerateTreePrompt({ careerName: 'Quant Trader', careerSlug: 'q', school })],
  ['roadmap v1', (school) => buildGeneratePrompt({ careerName: 'Quant Trader', careerSlug: 'q', school })],
  ['opportunity finder', (school) => buildOpportunityPrompt({ evidence: 'E', dossier: 'D', careerName: 'Quant Trader', gaps: [], school })],
  // S16: the readiness scorecard scores a student against live postings, so
  // "could they actually apply to this?" is a school question before it is a
  // scoring one — a posting they are ineligible for would drag the number down
  // for a gap that does not exist.
  ['readiness scorecard', (school) => buildScorecardPrompt({ evidence: 'E', careerName: 'Quant Trader', school, today: '2026-09-01' })],
  // S17: the network mapper drafts a message to "a {school} alum" — five of its
  // seven archetypes name the student's own school in the label, so a draft that
  // points them at another university's trading team is advice they cannot act on.
  ['outreach draft', (school) => buildOutreachPrompt({
    contact: { label: 'A UChicago alum', channel: 'email' },
    careerName: 'Quant Trader', school, corpus: { entries: [], ids: new Set() }, today: '2026-09-01',
  })],
  ['weekly plan', (school) => buildWeeklyPlanPrompt({
    careerName: 'Quant Trader', node: { title: 'n' }, stepLines: [], planPhases: [], prevTasks: [], notes: [], week: '2026-W30', school,
  })],
  ['mock interview turn', (school) => buildTurnPrompt({
    playbook: { label: 'x', behavioralFocus: [], technicalArchetypes: [], sampleTechnicalQuestions: [] },
    persona: 'analyst', careerName: 'Quant Trader', transcript: [], difficulty: 3, slot: 'intro', questionIndex: 0, school,
  })],
  ['mock interview debrief', (school) => buildDebriefPrompt({
    playbook: { label: 'x', evaluationEmphasis: [] }, careerName: 'Quant Trader', transcript: [], technicalAsked: false, school,
  })],
];

for (const [label, build] of SURFACES) {
  await test(`prompt carries the school: ${label}`, async () => {
    const withSchool = String(build(SCHOOL));
    assert.ok(withSchool.includes(SCHOOL), `${label} never names the school`);
    assert.ok(
      /never name another university's internal club|never list another university's internal club/i.test(withSchool),
      `${label} states the school but not the constraint`,
    );
    const without = String(build(''));
    assert.ok(!without.includes(SCHOOL), `${label} leaks a school it was not given`);
  });
}

await test('coordinates digest carries the school to every dossier-reading surface', async () => {
  const lines = buildCoordinateLines({ school: SCHOOL, careerFocus: { name: 'Quant Trader' } }, null);
  assert.ok(lines.some((l) => l === `school: ${SCHOOL}`), 'school line present');
  assert.ok(!buildCoordinateLines({}, null).some((l) => l.startsWith('school:')), 'no line when unknown');
});

// ---------- 4. dossier <-> quiz_profiles stay in step ----------
const SEED = [
  'DOSSIER_V1',
  'top_industries: finance',
  'archetype: Analyst',
  'school: (unknown)',
  'gpa: 3.9',
  'interests: (none yet)',
  'goals: (none yet)',
  'recent: (no chat yet)',
].join('\n');

await test('dossier school: field is read and rewritten, placeholders read as unknown', async () => {
  assert.equal(schoolFromDossier(SEED), '', '(unknown) is not a school');
  const updated = applySchoolToDossier(SEED, SCHOOL);
  assert.equal(schoolFromDossier(updated), SCHOOL, 'round-trips');
  assert.equal(updated.split('\n').length, SEED.split('\n').length, 'rewrites in place, adds no line');
  const noField = applySchoolToDossier('DOSSIER_V1\ngoals: x', SCHOOL);
  assert.equal(schoolFromDossier(noField), SCHOOL, 'appends the field when the dossier lacks it');
  assert.equal(schoolFromDossier(applySchoolToDossier(updated, '')), '', 'clearing writes the placeholder back');
});

// In-memory D1/KV doubles: these mirror only what school.js touches.
// Stored rows are the v2 user since Phase 4; assertions read the v1 view.
const v1View = (state) => (state.profile ? denormalizeUser(normalizeUser(state.profile)) : null);

function fakeEnv(initial = {}) {
  const state = { profile: initial.profile || null, dossier: initial.dossier || null, writes: 0 };
  const env = {
    COACH_KV: {
      async get(k) { return k.includes('dossier') ? state.dossier : null; },
      async put(k, v) { if (k.includes('dossier')) state.dossier = v; },
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() { return state.profile ? { payload: JSON.stringify(state.profile) } : null; },
              async run() {
                if (/INSERT INTO (?:user_profiles|quiz_profiles)/.test(sql)) {
                  state.profile = JSON.parse(args[1]);
                  state.writes += 1;
                }
              },
            };
          },
        };
      },
    },
  };
  return { env, state };
}

await test('resolveSchool: quiz wins; otherwise the dossier is adopted and persisted', async () => {
  const a = fakeEnv({ profile: { school: SCHOOL }, dossier: applySchoolToDossier(SEED, 'Cornell') });
  assert.equal(await resolveSchool(a.env, 'u@x.com'), SCHOOL, 'saved value wins over the dossier');
  assert.equal(a.state.writes, 0, 'no write when the saved value is already there');

  const b = fakeEnv({ profile: { scores: {} }, dossier: applySchoolToDossier(SEED, SCHOOL) });
  assert.equal(await resolveSchool(b.env, 'u@x.com'), SCHOOL, 'falls back to the dossier');
  assert.equal(v1View(b.state).school, SCHOOL, 'and adopts it so nothing re-derives');
  assert.deepEqual(v1View(b.state).scores, {}, 'other profile keys survive the adopt');

  const c = fakeEnv({ profile: null, dossier: SEED });
  assert.equal(await resolveSchool(c.env, 'u@x.com'), '', 'nothing known stays empty');
  assert.equal(c.state.writes, 0);
});

await test('syncSchoolFromDossier: conversation → quiz_profiles, and no-ops when they agree', async () => {
  const a = fakeEnv({ profile: { school: SCHOOL }, dossier: SEED });
  assert.equal(await syncSchoolFromDossier(a.env, 'u@x.com', applySchoolToDossier(SEED, 'Cornell University')), true);
  assert.equal(v1View(a.state).school, 'Cornell University', '"I am transferring to Cornell" lands in D1');

  const b = fakeEnv({ profile: { school: SCHOOL }, dossier: SEED });
  assert.equal(await syncSchoolFromDossier(b.env, 'u@x.com', applySchoolToDossier(SEED, SCHOOL)), false);
  assert.equal(b.state.writes, 0, 'unchanged school writes nothing');

  const c = fakeEnv({ profile: { school: SCHOOL }, dossier: SEED });
  assert.equal(await syncSchoolFromDossier(c.env, 'u@x.com', SEED), false, 'placeholder never clears a known school');
  assert.equal(v1View(c.state).school, SCHOOL);
});

await test('setSchool: writes both stores, and the mirror does not bounce back', async () => {
  const a = fakeEnv({ profile: { scores: { finance: 9 } }, dossier: SEED });
  assert.equal(await setSchool(a.env, 'u@x.com', ' University of  Chicago '), SCHOOL);
  assert.equal(v1View(a.state).school, SCHOOL, 'quiz profile updated');
  assert.deepEqual(v1View(a.state).scores, { finance: 9 }, 'no other profile key dropped');
  assert.equal(schoolFromDossier(a.state.dossier), SCHOOL, 'dossier updated so a later merge agrees');

  const b = fakeEnv({ profile: { school: SCHOOL }, dossier: applySchoolToDossier(SEED, SCHOOL) });
  await setSchool(b.env, 'u@x.com', '');
  assert.equal(v1View(b.state).school, undefined, 'clearing removes it');
  assert.equal(schoolFromDossier(b.state.dossier), '', 'and clears the dossier field too');
});

if (failures) {
  console.error(`test:school FAILED (${failures} failing)`);
  process.exit(1);
}
console.log('test:school PASS');
