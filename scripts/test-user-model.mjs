// test:user — the canonical user object's contract with the legacy quiz blob.
//
// Three properties keep the migration safe:
//   1. Round-trip: denormalize(normalize(v1)) preserves every field. The two
//      deliberate asymmetries are the school and GPA mirrors — the canonical
//      value is written to BOTH v1 homes (school: root + profile.school; gpa:
//      profile.gpa + academics.gpa), repairing the drift the two-home quirks
//      allowed. Nothing is ever dropped.
//   2. normalize is idempotent (v2 in → same v2 out).
//   3. The client facade (assets/js/shared/user.js) and the server model
//      (functions/_lib/user-model.js) never drift: same KEY_MAP, same
//      normalize output, byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KEY_MAP, normalizeUser, denormalizeUser, getUserField, emptyUser,
} from '../functions/_lib/user-model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message}`);
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8'));
}

// The expected round-trip output: the fixture itself, plus the documented
// mirrors (each canonical value lands in both of its v1 homes).
function withMirrors(v1) {
  return withGpaMirror(withSchoolMirror(v1));
}

// academics.gpa (the panel's, live) wins over profile.gpa (written once at
// quiz completion) and is written back to both homes — including an academics
// object the fixture never had, so the vector GPA boost sees it.
function withGpaMirror(v1) {
  const out = clone(v1);
  const acad = out.academics && typeof out.academics === 'object' ? out.academics : null;
  const fromAcad = acad && acad.gpa !== undefined && acad.gpa !== null && acad.gpa !== '';
  const gpa = fromAcad ? acad.gpa : (out.profile ? out.profile.gpa : undefined);
  if (gpa === undefined) return out;
  if (!out.profile || typeof out.profile !== 'object') out.profile = {};
  out.profile.gpa = gpa;
  if (gpa !== null && gpa !== '') out.academics = { ...(acad || {}), gpa };
  else if (acad) out.academics = { ...acad, gpa };
  return out;
}

function withSchoolMirror(v1) {
  const out = clone(v1);
  const root = typeof out.school === 'string' && out.school.trim() ? out.school : '';
  const nested = out.profile && typeof out.profile.school === 'string' && out.profile.school.trim()
    ? out.profile.school : '';
  const canonical = root || nested;
  if (canonical) {
    out.school = canonical;
    if (!out.profile || typeof out.profile !== 'object') out.profile = {};
    out.profile.school = canonical;
  }
  return out;
}

const FIXTURES = ['user-v1-fresh.json', 'user-v1-resume.json', 'user-v1-tenured.json'];

for (const name of FIXTURES) {
  await test(`round-trip preserves every field: ${name}`, () => {
    const v1 = loadFixture(name);
    const roundTripped = denormalizeUser(normalizeUser(clone(v1)));
    assert.deepEqual(roundTripped, withMirrors(v1));
  });

  await test(`normalize is idempotent: ${name}`, () => {
    const once = normalizeUser(clone(loadFixture(name)));
    const twice = normalizeUser(clone(once));
    assert.deepEqual(twice, once);
  });
}

await test('school precedence: blob root beats profile.school', () => {
  const user = normalizeUser({ school: 'UChicago', profile: { school: 'Stale U' } });
  assert.equal(user.identity.school, 'UChicago');
  const v1 = denormalizeUser(user);
  assert.equal(v1.school, 'UChicago');
  assert.equal(v1.profile.school, 'UChicago');
});

await test('non-empty profile.school beats null root school', () => {
  const user = normalizeUser({ school: null, profile: { school: 'UChicago' } });
  assert.equal(user.identity.school, 'UChicago');
});

await test('null school stays only in profile (no fabricated root key)', () => {
  const v1 = denormalizeUser(normalizeUser({ name: 'A', profile: { school: null } }));
  assert.equal('school' in v1, false);
  assert.equal(v1.profile.school, null);
});

await test('minimal school.js-shaped blob {school} survives', () => {
  const user = normalizeUser({ school: 'UChicago' });
  assert.equal(user.identity.school, 'UChicago');
  assert.equal(denormalizeUser(user).school, 'UChicago');
});

await test('unknown fields pass through untouched (future-proofing)', () => {
  const v1 = {
    name: 'A',
    someFutureField: { a: 1 },
    profile: { year: 'junior', zip: '60637' },
  };
  const user = normalizeUser(clone(v1));
  assert.deepEqual(user.someFutureField, { a: 1 });
  assert.equal(user.identity.zip, '60637');
  assert.deepEqual(denormalizeUser(user), v1);
});

await test('collision-named v1 keys park under _legacy and come back', () => {
  const v1 = { name: 'A', vectors: 'not-a-group-in-v1' };
  const user = normalizeUser(clone(v1));
  assert.equal(user._legacy.vectors, 'not-a-group-in-v1');
  assert.deepEqual(denormalizeUser(user), v1);
});

await test('empty/absent input yields an empty user, not a crash', () => {
  assert.deepEqual(normalizeUser(null), emptyUser());
  assert.deepEqual(denormalizeUser(normalizeUser(null)), {});
});

await test('getUserField reads dot paths', () => {
  const user = normalizeUser(loadFixture('user-v1-tenured.json'));
  assert.equal(getUserField(user, 'identity.school'), 'University of Chicago');
  assert.equal(getUserField(user, 'focus.careerFocus.slug'), 'quantitative-analyst');
  assert.equal(getUserField(user, 'vectors.objective.source'), 'resume');
});

// --- client/server parity ---------------------------------------------------
// Load the browser facade the way test-vectors.cjs does: eval with stubs.
function loadClientFacade(seed = {}) {
  const store = { ...seed };
  const g = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
  g.window = g;
  const code = fs.readFileSync(path.join(REPO, 'assets/js/shared/user.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'localStorage', code)(g, g.localStorage);
  return { FWUser: g.window.FWUser, store: g.localStorage };
}

await test('client and server KEY_MAP are identical', () => {
  const { FWUser } = loadClientFacade();
  assert.deepEqual(FWUser.KEY_MAP, KEY_MAP);
});

await test('client and server normalize agree on every fixture', () => {
  const { FWUser } = loadClientFacade();
  for (const name of FIXTURES) {
    const v1 = loadFixture(name);
    assert.deepEqual(FWUser.normalizeUser(clone(v1)), normalizeUser(clone(v1)));
    assert.deepEqual(
      FWUser.denormalizeUser(FWUser.normalizeUser(clone(v1))),
      denormalizeUser(normalizeUser(clone(v1))),
    );
  }
});

await test('boot migration promotes the legacy v1 blob to fw_user_v1 and deletes it', () => {
  const v1 = loadFixture('user-v1-tenured.json');
  const { FWUser, store } = loadClientFacade({ 'fw_hub_quiz_v1': JSON.stringify(v1) });
  const stored = JSON.parse(store.getItem('fw_user_v1'));
  assert.equal(stored.v, 2, 'stored shape is v2');
  assert.equal(stored.identity.school, 'University of Chicago');
  assert.equal(store.getItem('fw_hub_quiz_v1'), null, 'legacy key deleted after promotion');
  assert.deepEqual(FWUser.getBlob().personalityVector, v1.personalityVector, 'v1 view intact');
});

await test('boot migration clears an orphaned legacy key when fw_user_v1 already exists', () => {
  const v1 = loadFixture('user-v1-tenured.json');
  const v2 = normalizeUser(clone(v1));
  v2.identity.gpa = 3.95; // newer than the legacy copy — must survive
  const { store } = loadClientFacade({
    'fw_hub_quiz_v1': JSON.stringify(v1),
    'fw_user_v1': JSON.stringify(v2),
  });
  assert.equal(store.getItem('fw_hub_quiz_v1'), null, 'orphaned legacy key deleted');
  assert.equal(JSON.parse(store.getItem('fw_user_v1')).identity.gpa, 3.95,
    'existing fw_user_v1 untouched');
});

await test('FWUser.get/update round-trip the stored user', () => {
  const v1 = loadFixture('user-v1-tenured.json');
  const { FWUser, store } = loadClientFacade({ 'fw_hub_quiz_v1': JSON.stringify(v1) });
  const user = FWUser.get();
  assert.equal(user.identity.school, 'University of Chicago');
  FWUser.update((u) => { u.identity.gpa = 3.9; });
  const written = JSON.parse(store.getItem('fw_user_v1'));
  assert.equal(written.identity.gpa, 3.9);
  assert.equal(written.identity.school, 'University of Chicago');
  assert.deepEqual(written.vectors.personality, v1.personalityVector);
  assert.equal(FWUser.getBlob().academics.gpa, 3.9, 'v1 view reflects the update');
  assert.equal(FWUser.getBlob().profile.gpa, 3.9, 'both v1 homes agree');
});

// --- the GPA merge -----------------------------------------------------------

await test('gpa precedence: the academics panel beats the quiz value', () => {
  const user = normalizeUser({ profile: { gpa: 3.2 }, academics: { gpa: 3.8, major: 'cs' } });
  assert.equal(user.identity.gpa, 3.8);
  assert.equal('gpa' in user.focus.academics, false, 'v2 holds exactly one GPA');
  const v1 = denormalizeUser(user);
  assert.equal(v1.profile.gpa, 3.8);
  assert.equal(v1.academics.gpa, 3.8, 'the vector boost reads the live value');
  assert.equal(v1.academics.major, 'cs', 'the rest of academics is untouched');
});

await test('gpa falls back to the quiz value when the panel never set one', () => {
  const user = normalizeUser({ profile: { gpa: 3.2 }, academics: { gpa: null, major: 'cs' } });
  assert.equal(user.identity.gpa, 3.2);
  assert.equal(denormalizeUser(user).academics.gpa, 3.2);
});

await test('a quiz-only profile mirrors its GPA into academics for the boost', () => {
  const v1 = denormalizeUser(normalizeUser({ profile: { gpa: 3.7 } }));
  assert.equal(v1.academics.gpa, 3.7);
  assert.equal(v1.profile.gpa, 3.7);
});

await test('no GPA fabricates no academics object (gpaTierBoost reads null as 0)', () => {
  const v1 = denormalizeUser(normalizeUser({ profile: { gpa: null, year: 'junior' } }));
  assert.equal(v1.profile.gpa, null);
  assert.equal('academics' in v1, false);
});

await test('a dossier-synced identity.gpa reaches academics.gpa', () => {
  // syncUserFromDossier writes identity.gpa on the stored v2 — the mirror is
  // what carries it to the vector rebuild's input.
  const user = normalizeUser({ profile: { gpa: 3.2 }, academics: { gpa: 3.8 } });
  user.identity.gpa = 4.0; // the conversation stated a newer GPA
  assert.equal(denormalizeUser(user).academics.gpa, 4.0);
});

await test('a pre-merge v2 row adopts its academics.gpa, once', () => {
  const stored = normalizeUser({ profile: { gpa: 3.2 } });
  stored.focus.academics = { gpa: 3.8, major: 'cs' }; // the shape rows had before
  const fixed = normalizeUser(stored);
  assert.equal(fixed.identity.gpa, 3.8, 'the panel value wins on adoption');
  assert.equal('gpa' in fixed.focus.academics, false);
  assert.deepEqual(normalizeUser(clone(fixed)), fixed, 'idempotent');
});

if (failures) {
  console.error(`\ntest:user FAILED (${failures})`);
  process.exit(1);
}
console.log('\ntest:user passed');
