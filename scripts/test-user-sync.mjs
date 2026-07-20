// test:sync — the generalized dossier ↔ user identity-field registry.
//
// Extends test-school.mjs's honesty pattern to every registry field: a durable
// fact stated in ANY conversation ("I'm a junior now") must land in the user
// store via the dossier merge → saveDossier → syncUserFromDossier chain, a
// placeholder must never overwrite a real value, and an explicit set must
// mirror into the dossier without bouncing back (one sync direction each).
import assert from 'node:assert/strict';

import {
  FIELDS,
  cleanYearValue,
  cleanGpaValue,
  cleanSubjectsValue,
  cleanLeaningValue,
  syncUserFromDossier,
  setUserField,
  mirrorFieldsToDossier,
} from '../functions/_lib/user-sync.js';
import { parseDossierFields } from '../functions/_lib/dossier-parse.js';
import { normalizeUser, denormalizeUser } from '../functions/_lib/user-model.js';
import { buildSeedDossier, saveDossier } from '../functions/_lib.js';

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

// In-memory D1/KV doubles — the same shape test-school.mjs uses. Stored rows
// are the v2 user since Phase 4; assertions read the v1 view.
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

const DOSSIER = (over = {}) => [
  'DOSSIER_V1',
  'top_industries: finance',
  `school: ${over.school || '(unknown)'}`,
  `gpa: ${over.gpa || '(unknown)'}`,
  `year: ${over.year || '(unknown)'}`,
  `subjects_major: ${over.subjects || '(none yet)'}`,
  `career_leaning: ${over.leaning || '(none yet)'}`,
  'interests: (none yet)',
  'goals: (none yet)',
  'recent: (no chat yet)',
].join('\n');

// ---------- 1. per-field value hygiene ----------
await test('year: aliases normalize, junk rejected', () => {
  assert.equal(cleanYearValue('Junior'), 'junior');
  assert.equal(cleanYearValue('first-year'), 'freshman');
  assert.equal(cleanYearValue('junior year'), 'junior');
  assert.equal(cleanYearValue('(unknown)'), '');
  assert.equal(cleanYearValue('super-senior'), '');
});

await test('gpa: parses, bounds, rounds; junk rejected', () => {
  assert.equal(cleanGpaValue('3.85'), 3.85);
  assert.equal(cleanGpaValue('3.856'), 3.86);
  assert.equal(cleanGpaValue('GPA 3.9'), 3.9);
  assert.equal(cleanGpaValue('11'), '');
  assert.equal(cleanGpaValue('(unknown)'), '');
});

await test('subjects: list sanitized, deduped, capped at 8x60', () => {
  assert.deepEqual(cleanSubjectsValue('math, computer science, math'), ['math', 'computer science']);
  assert.equal(cleanSubjectsValue('(none yet)'), '');
  const many = cleanSubjectsValue(Array.from({ length: 12 }, (_, i) => `subject ${i}`).join(','));
  assert.equal(many.length, 8);
  assert.equal(cleanSubjectsValue('<script>alert(1)</script>')[0], 'scriptalert(1)/script');
});

await test('careerLeaning: sanitized and capped at 120', () => {
  assert.equal(cleanLeaningValue('quantitative finance'), 'quantitative finance');
  assert.equal(cleanLeaningValue('x'.repeat(200)).length, 80); // sanitizeSchoolName caps at 80 first
  assert.equal(cleanLeaningValue('(none yet)'), '');
});

// ---------- 2. seed + parser carry every registry line ----------
await test('buildSeedDossier and parseDossierFields know every registry line', () => {
  const seed = buildSeedDossier({
    school: 'UChicago', gpa: 3.9, year: 'sophomore', subjects: ['math'], careerLeaning: 'quant',
  });
  const parsed = parseDossierFields(seed);
  FIELDS.forEach((f) => {
    assert.ok(f.line in parsed, `seed/parser missing line: ${f.line}`);
  });
  assert.equal(parsed.year, 'sophomore');
  assert.equal(parsed.subjects_major, 'math');
  assert.equal(parsed.career_leaning, 'quant');
});

// ---------- 3. dossier → user: the honesty chain ----------
await test('a dossier merge stating "junior" lands in identity.year', async () => {
  const { env, state } = fakeEnv({ profile: { name: 'A', profile: { year: 'sophomore' } } });
  const wrote = await syncUserFromDossier(env, 'u@x.com', DOSSIER({ year: 'junior' }));
  assert.equal(wrote, true);
  assert.equal(v1View(state).profile.year, 'junior');
});

await test('a placeholder never overwrites a real value', async () => {
  const { env, state } = fakeEnv({ profile: { name: 'A', profile: { year: 'junior', gpa: 3.8 } } });
  const wrote = await syncUserFromDossier(env, 'u@x.com', DOSSIER({}));
  assert.equal(wrote, false, 'all-placeholder dossier writes nothing');
  assert.equal(state.writes, 0);
  assert.equal(v1View(state).profile.year, 'junior');
  assert.equal(v1View(state).profile.gpa, 3.8);
});

await test('multi-field sync lands in ONE save', async () => {
  const { env, state } = fakeEnv({ profile: { name: 'A' } });
  const wrote = await syncUserFromDossier(env, 'u@x.com',
    DOSSIER({ school: 'UChicago', year: 'junior', gpa: '3.9', subjects: 'math, statistics', leaning: 'quant research' }));
  assert.equal(wrote, true);
  assert.equal(state.writes, 1, 'one save for all fields');
  assert.equal(v1View(state).school, 'UChicago', 'school lands in both v1 homes');
  assert.equal(v1View(state).profile.school, 'UChicago');
  assert.equal(v1View(state).profile.year, 'junior');
  assert.equal(v1View(state).profile.gpa, 3.9);
  assert.deepEqual(v1View(state).profile.subjects, ['math', 'statistics']);
  assert.equal(v1View(state).profile.careerLeaning, 'quant research');
});

await test('sync no-ops when dossier and user already agree', async () => {
  const { env, state } = fakeEnv({ profile: { name: 'A', profile: { year: 'junior' } } });
  const wrote = await syncUserFromDossier(env, 'u@x.com', DOSSIER({ year: 'junior' }));
  assert.equal(wrote, false);
  assert.equal(state.writes, 0);
});

// ---------- 4. user → dossier: explicit set mirrors without bouncing ----------
await test('setUserField writes the store and mirrors the dossier line', async () => {
  const { env, state } = fakeEnv({ profile: { name: 'A' }, dossier: DOSSIER({}) });
  const clean = await setUserField(env, 'u@x.com', 'identity.year', 'Junior');
  assert.equal(clean, 'junior');
  assert.equal(v1View(state).profile.year, 'junior');
  assert.equal(parseDossierFields(state.dossier).year, 'junior', 'dossier line mirrored');
});

await test('the mirror does not bounce back (re-entrant sync no-ops)', async () => {
  const { env, state } = fakeEnv({ profile: { name: 'A' }, dossier: DOSSIER({}) });
  await setUserField(env, 'u@x.com', 'identity.subjects', 'math, cs');
  const writesAfterSet = state.writes;
  // saveDossier (the mirror path) re-enters syncUserFromDossier — must no-op.
  await saveDossier(env, 'u@x.com', state.dossier);
  assert.equal(state.writes, writesAfterSet, 'no extra profile write from the re-entrant sync');
  assert.deepEqual(v1View(state).profile.subjects, ['math', 'cs']);
});

await test('saveDossier syncs ALL registry fields (the school.js chain, generalized)', async () => {
  const { env, state } = fakeEnv({ profile: { name: 'A' } });
  await saveDossier(env, 'u@x.com', DOSSIER({ year: 'senior', leaning: 'data science' }));
  assert.equal(v1View(state).profile.year, 'senior');
  assert.equal(v1View(state).profile.careerLeaning, 'data science');
});

// ---------- 5. the GPA merge: one fact, two v1 homes, one dossier line -------
// The academics panel edits the GPA through PUT /profile/quiz rather than an
// explicit set, so that endpoint mirrors the dossier line itself. Without the
// mirror the next dossier write would sync the onboarding value back over it.
await test('a panel-edited GPA is mirrored into the dossier line', async () => {
  const panelSaved = normalizeUser({ profile: { gpa: 3.2 }, academics: { gpa: 3.9 } });
  assert.equal(panelSaved.identity.gpa, 3.9, 'the panel value is the canonical GPA');
  const { env, state } = fakeEnv({ profile: panelSaved, dossier: DOSSIER({ gpa: '3.2' }) });
  assert.equal(await mirrorFieldsToDossier(env, 'u@x.com', panelSaved, { only: ['identity.gpa'] }), true);
  assert.equal(parseDossierFields(state.dossier).gpa, '3.9');
});

await test('a panel-edited GPA survives the next dossier write', async () => {
  const panelSaved = normalizeUser({ profile: { gpa: 3.2 }, academics: { gpa: 3.9 } });
  const { env, state } = fakeEnv({ profile: panelSaved, dossier: DOSSIER({ gpa: '3.2' }) });
  await mirrorFieldsToDossier(env, 'u@x.com', panelSaved, { only: ['identity.gpa'] });
  await saveDossier(env, 'u@x.com', state.dossier); // any later conversation
  assert.equal(v1View(state).academics.gpa, 3.9, 'the vector boost still reads the edit');
  assert.equal(v1View(state).profile.gpa, 3.9, 'both v1 homes agree');
});

await test('a GPA stated in conversation reaches academics.gpa (the vector input)', async () => {
  const stored = normalizeUser({ profile: { gpa: 3.2 }, academics: { gpa: 3.4, major: 'cs' } });
  const { env, state } = fakeEnv({ profile: stored });
  await saveDossier(env, 'u@x.com', DOSSIER({ gpa: '4.0' }));
  assert.equal(v1View(state).academics.gpa, 4);
  assert.equal(v1View(state).profile.gpa, 4);
  assert.equal(v1View(state).academics.major, 'cs', 'the rest of academics is untouched');
});

if (failures) {
  console.error(`\ntest:sync FAILED (${failures})`);
  process.exit(1);
}
console.log('\ntest:sync passed');
