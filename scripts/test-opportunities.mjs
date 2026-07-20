// test:opportunities — opportunity-core invariants (build plan §9).
// Pure imports, no D1/KV/fetch — pattern: scripts/test-grounding.mjs.
import assert from 'node:assert/strict';

import {
  MAX_OPPORTUNITIES,
  buildOpportunityQueries,
  buildOpportunityPrompt,
  sanitizeOpportunities,
  rankOpportunities,
  impactTier,
  mergeResearchSources,
  sanitizeSchoolName,
  normalizeSchoolKey,
  opportunityId,
} from '../functions/_lib/opportunity-core.js';

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

const GAPS = [
  { id: 'dim-3', dimIndex: 3, label: 'Complex Problem Solving', domain: 'skills', gap: 24 },
  { id: 'dim-7', dimIndex: 7, label: 'Programming', domain: 'skills', gap: 20 },
  { id: 'dim-11', dimIndex: 11, label: 'Mathematics', domain: 'knowledge', gap: 15 },
  { id: 'dim-19', dimIndex: 19, label: 'Systems Analysis', domain: 'skills', gap: 12 },
  { id: 'dim-22', dimIndex: 22, label: 'Judgment and Decision Making', domain: 'skills', gap: 9 },
  { id: 'dim-30', dimIndex: 30, label: 'Writing', domain: 'skills', gap: 6 },
];
const SOURCES = [
  { title: 'Coursera', url: 'https://www.coursera.org/some/course' },
  { title: 'DECA', url: 'https://www.deca.org/compete' },
];

// ---------- 1. queries are career+gap-only (shared cache safe) ----------
await test('queries: 3 total; courses cover gaps 1-3, competitions 4-6, orgs national when no school', async () => {
  const qs = buildOpportunityQueries({ careerName: 'Data Scientist', gaps: GAPS, school: '' });
  assert.equal(qs.length, 3);
  assert.ok(qs[0].includes('Complex Problem Solving, Programming, Mathematics'), 'q1 has gaps 1-3');
  assert.ok(qs[0].includes('Data Scientist'));
  assert.ok(qs[1].includes('Systems Analysis, Judgment and Decision Making, Writing'), 'q2 has gaps 4-6');
  assert.ok(qs[2].startsWith('national student organizations'), 'no school → national orgs');
  for (const q of qs) {
    assert.ok(!q.includes('@'), 'no user identity in query text');
  }
});

await test('queries: school personalizes the org query; <4 gaps → q2 falls back to gaps 1-3', async () => {
  const qs = buildOpportunityQueries({ careerName: 'Data Scientist', gaps: GAPS.slice(0, 2), school: 'UChicago' });
  assert.ok(qs[1].includes('Complex Problem Solving, Programming'), 'q2 falls back to leading gaps');
  assert.ok(qs[2].startsWith('UChicago student organizations'), 'school embedded in org query');
});

// ---------- 2. deterministic tier math (decision #3) ----------
await test('impactTier: direct×big→high, one of the two→medium, neither→low; boundary gap=18 is big', async () => {
  assert.equal(impactTier('direct', 24), 'high');
  assert.equal(impactTier('direct', 18), 'high');
  assert.equal(impactTier('direct', 10), 'medium');
  assert.equal(impactTier('related', 20), 'medium');
  assert.equal(impactTier('related', 5), 'low');
  assert.equal(impactTier('nonsense', 5), 'low');
});

// ---------- 3. sanitize: source-URL enforcement (decision #4) ----------
function rawItem(over = {}) {
  return {
    type: 'course',
    title: 'Applied Problem Solving',
    org: 'Coursera',
    url: 'https://www.coursera.org/some/course',
    deadline: null,
    gapLabel: 'Complex Problem Solving',
    directness: 'direct',
    whyThisFits: 'Targets your largest gap.',
    ...over,
  };
}

await test('sanitize: non-https URL dropped', async () => {
  assert.equal(sanitizeOpportunities([rawItem({ url: 'http://www.coursera.org/x' })], GAPS, SOURCES).length, 0);
});

await test('sanitize: https URL with origin not in sources dropped (no invented links)', async () => {
  assert.equal(sanitizeOpportunities([rawItem({ url: 'https://evil.example.com/course' })], GAPS, SOURCES).length, 0);
  assert.equal(sanitizeOpportunities([rawItem({ url: 'not a url' })], GAPS, SOURCES).length, 0);
});

// Regression: grounding hands back vertexaisearch redirect URLs, so every
// source shares one origin — origin-matching let the model ship a guessed
// token (404) or another opportunity's token (wrong page). Only the exact
// source URL, or a host only one source uses, may ship.
await test('sanitize: same-origin URL that is not a source URL is dropped', async () => {
  const shared = [
    { title: 'a', url: 'https://cloud.example.com/redirect/AAA' },
    { title: 'b', url: 'https://cloud.example.com/redirect/BBB' },
  ];
  assert.equal(
    sanitizeOpportunities([rawItem({ url: 'https://cloud.example.com/redirect/GUESSED' })], GAPS, shared).length,
    0,
    'invented path on a shared origin dropped',
  );
  const ok = sanitizeOpportunities([rawItem({ url: 'https://cloud.example.com/redirect/BBB' })], GAPS, shared);
  assert.equal(ok.length, 1, 'exact source URL kept');
  assert.equal(ok[0].url, 'https://cloud.example.com/redirect/BBB');
});

await test('sanitize: copy drift (case/www/trailing slash/fragment) matches; shipped URL is the source\'s own', async () => {
  const out = sanitizeOpportunities(
    [rawItem({ url: 'https://COURSERA.org/some/course/#apply' })],
    GAPS, SOURCES,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://www.coursera.org/some/course', 'source URL wins over the model\'s copy');
});

await test('sanitize: a trimmed URL snaps to the one source on that host, but never when the host is ambiguous', async () => {
  const snapped = sanitizeOpportunities([rawItem({ url: 'https://www.coursera.org' })], GAPS, SOURCES);
  assert.equal(snapped.length, 1);
  assert.equal(snapped[0].url, 'https://www.coursera.org/some/course');
  const twoOnHost = [
    { title: 'a', url: 'https://www.coursera.org/one' },
    { title: 'b', url: 'https://www.coursera.org/two' },
  ];
  assert.equal(sanitizeOpportunities([rawItem({ url: 'https://www.coursera.org' })], GAPS, twoOnHost).length, 0);
});

await test('sanitize: valid item kept with computed id/tier/gapDimIndex', async () => {
  const out = sanitizeOpportunities([rawItem()], GAPS, SOURCES);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, opportunityId('https://www.coursera.org/some/course', 'course'));
  assert.equal(out[0].impactTier, 'high');
  assert.equal(out[0].gapDimIndex, 3);
  assert.equal(out[0].gapLabel, 'Complex Problem Solving');
});

await test('sanitize: deadline must be ISO YYYY-MM-DD, else null — never invented', async () => {
  assert.equal(sanitizeOpportunities([rawItem({ deadline: '2026-09-01' })], GAPS, SOURCES)[0].deadline, '2026-09-01');
  assert.equal(sanitizeOpportunities([rawItem({ deadline: 'next fall' })], GAPS, SOURCES)[0].deadline, null);
  assert.equal(sanitizeOpportunities([rawItem({ deadline: 'soon (rolling)' })], GAPS, SOURCES)[0].deadline, null);
  assert.equal(sanitizeOpportunities([rawItem({ deadline: '2026-99-99' })], GAPS, SOURCES)[0].deadline, null);
});

await test('sanitize: gapLabel must match a real gap (case-insensitive), else dropped', async () => {
  assert.equal(sanitizeOpportunities([rawItem({ gapLabel: 'Underwater Basket Weaving' })], GAPS, SOURCES).length, 0);
  const out = sanitizeOpportunities([rawItem({ gapLabel: '  complex problem solving ' })], GAPS, SOURCES);
  assert.equal(out.length, 1, 'case/whitespace-insensitive match');
  assert.equal(out[0].gapLabel, 'Complex Problem Solving', 'canonical label restored');
});

await test('sanitize: unknown type dropped; "student-org"/"Course" coerced; injection chars stripped; caps enforced', async () => {
  assert.equal(sanitizeOpportunities([rawItem({ type: 'internship' })], GAPS, SOURCES).length, 0);
  const coerced = sanitizeOpportunities([
    rawItem({ type: 'student-org', url: 'https://www.deca.org/x' }),
    rawItem({ type: ' Course ' }),
  ], GAPS, SOURCES);
  assert.deepEqual(coerced.map((o) => o.type), ['student_org', 'course']);
  const dirty = sanitizeOpportunities(
    [rawItem({ title: '<script>alert(1)</script>' + 'x'.repeat(300), whyThisFits: 'a<b>c' })],
    GAPS, SOURCES,
  );
  assert.ok(!dirty[0].title.includes('<') && !dirty[0].title.includes('>'), 'angle brackets stripped');
  assert.ok(dirty[0].title.length <= 120, 'title capped');
  assert.ok(!dirty[0].whyThisFits.includes('<'), 'why line stripped');
});

await test('sanitize: duplicate url+type deduped; model-supplied tier ignored', async () => {
  const out = sanitizeOpportunities([rawItem(), rawItem(), rawItem({ impactTier: 'high', directness: 'related', gapLabel: 'Writing' })], GAPS, SOURCES);
  assert.equal(out.length, 1, 'dup url+type dropped even with different fields');
  const other = sanitizeOpportunities([rawItem({ directness: 'related', gapLabel: 'Writing', impactTier: 'high' })], GAPS, SOURCES);
  assert.equal(other[0].impactTier, 'low', 'tier recomputed from directness×gap, never trusted');
});

// ---------- 4. rank: tier then gap desc, capped at 8 ----------
await test('rank: high before medium before low; within tier larger gap first; cap 8', async () => {
  const mk = (tier, dim) => ({ id: `x-${tier}-${dim}`, impactTier: tier, gapDimIndex: dim });
  const ranked = rankOpportunities([
    mk('low', 3), mk('medium', 11), mk('high', 11), mk('medium', 3), mk('high', 3),
  ], GAPS);
  assert.deepEqual(ranked.map((o) => o.id), ['x-high-3', 'x-high-11', 'x-medium-3', 'x-medium-11', 'x-low-3']);
  const many = rankOpportunities(Array.from({ length: 12 }, (_, i) => mk('high', 3 + i)), GAPS);
  assert.equal(many.length, MAX_OPPORTUNITIES, 'capped at 8');
});

// ---------- 5. school field hygiene ----------
await test('school: strips <>&"\' and control chars, caps at 80; key normalized lowercase', async () => {
  assert.equal(sanitizeSchoolName('  U<sc>ri&pt"Chi\'cago   '), 'UscriptChicago');
  assert.equal(sanitizeSchoolName('x'.repeat(120)).length, 80);
  assert.equal(normalizeSchoolKey(' UChicago '), 'uchicago');
  assert.equal(sanitizeSchoolName(null), '');
});

// ---------- 6. merged sources ----------
await test('mergeResearchSources: dedupes by url, fetchedAt = newest', async () => {
  const merged = mergeResearchSources([
    { brief: 'a', sources: [SOURCES[0]], fetchedAt: '2026-07-17T00:00:00.000Z' },
    null,
    { brief: 'b', sources: [SOURCES[0], SOURCES[1]], fetchedAt: '2026-07-18T00:00:00.000Z' },
  ]);
  assert.equal(merged.sources.length, 2);
  assert.equal(merged.fetchedAt, '2026-07-18T00:00:00.000Z');
});

// ---------- 7. prompt shape (decision #3 in the instructions too) ----------
await test('prompt: evidence first, gap labels listed, asks for directness only — never numbers or tiers', async () => {
  const p = buildOpportunityPrompt({
    evidence: '=== WEB EVIDENCE ===\n[1] T — https://e.com\nfact\n=== END WEB EVIDENCE ===',
    dossier: 'Student dossier text',
    careerName: 'Data Scientist',
    gaps: GAPS,
  });
  assert.ok(p.startsWith('=== WEB EVIDENCE'), 'evidence block leads');
  assert.ok(p.includes('Complex Problem Solving (skills)'), 'gap table present');
  assert.ok(p.includes('"directness":"direct|related"'), 'model reports directness only');
  assert.ok(!/impactTier|point|score/i.test(p.split('TASK:')[1].replace(/Never output scores, point values/, '')), 'no tier/points requested');
  assert.ok(p.includes('Never output scores, point values, percentages'), 'numeric claims forbidden');
});

await test('prompt: school scopes what may be listed; no school → open-to-anyone only', async () => {
  const args = { evidence: 'E', dossier: 'D', careerName: 'Quant Trader', gaps: GAPS };
  const withSchool = buildOpportunityPrompt({ ...args, school: 'UChicago' });
  assert.ok(withSchool.includes("STUDENT'S SCHOOL: UChicago"), 'school stated');
  assert.ok(/at UChicago/.test(withSchool), 'listings scoped to their school');
  assert.ok(/never list another university's internal club/i.test(withSchool), 'other schools\' clubs barred');
  assert.ok(/character for character/i.test(withSchool), 'exact-URL copy demanded');
  const noSchool = buildOpportunityPrompt(args);
  assert.ok(!noSchool.includes("STUDENT'S SCHOOL"), 'no school line when unset');
  assert.ok(/open to any student/i.test(noSchool), 'falls back to open-to-anyone');
});

if (failures) {
  console.error(`test:opportunities FAILED (${failures} failing)`);
  process.exit(1);
}
console.log('test:opportunities PASS');
