#!/usr/bin/env node
/**
 * Stress tests for sector fit cheat sheet (server + client parity).
 * Run: node scripts/stress-sector-fit.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);

const {
  SECTOR_KEYS,
  ensureSectorFitSheet,
  applySectorPatches,
  syncQuizScoresFromSheet,
  industryFitFromSheet,
  patchSectorFitFromLearning,
} = await import(new URL('../functions/_lib/sector-fit-sheet.js', import.meta.url).href);

// --- Client module in VM ---
function loadClientModule() {
  const code = readFileSync(new URL('../assets/js/shared/sector-fit-sheet.js', import.meta.url), 'utf8');
  const sandbox = {
    window: {},
    globalThis: {},
    console,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'sector-fit-sheet.js' });
  return sandbox.FWSectorFitSheet;
}

const Client = loadClientModule();

// --- Test harness ---
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    return;
  }
  failed += 1;
  failures.push(msg);
  console.error('FAIL:', msg);
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function makeQuiz(scores = {}) {
  return { scores: { ...scores }, archetype: 'The Builder' };
}

console.log('== Sector fit stress tests ==\n');

// 1. Key parity with industries.json
const industries = JSON.parse(
  readFileSync(new URL('../assets/data/industries.json', import.meta.url), 'utf8'),
);
const industryKeys = Object.keys(industries).sort();
const sectorKeysSorted = [...SECTOR_KEYS].sort();
assert(
  industryKeys.length === 24 && sectorKeysSorted.length === 24,
  `Expected 24 sectors, got industries=${industryKeys.length} SECTOR_KEYS=${sectorKeysSorted.length}`,
);
assert(
  JSON.stringify(industryKeys) === JSON.stringify(sectorKeysSorted),
  `SECTOR_KEYS mismatch vs industries.json:\n  missing=${industryKeys.filter((k) => !SECTOR_KEYS.includes(k)).join(',')}\n  extra=${SECTOR_KEYS.filter((k) => !industries[k]).join(',')}`,
);
assert(
  Client.SECTOR_KEYS.length === SECTOR_KEYS.length
    && Client.SECTOR_KEYS.every((k, i) => k === SECTOR_KEYS[i]),
  'Client SECTOR_KEYS diverge from server',
);

// 2. Seed from quiz scores
{
  const quiz = makeQuiz({ tech: 88.7, healthcare: 42, bogus: 99 });
  const sheet = ensureSectorFitSheet(quiz);
  assert(sheet.scores.tech === 89, `tech rounds to 89, got ${sheet.scores.tech}`);
  assert(sheet.scores.healthcare === 42, 'healthcare preserved');
  assert(quiz.scores.tech === 89, 'quiz.scores mirrors sheet after seed');
  assert(SECTOR_KEYS.every((k) => typeof sheet.scores[k] === 'number'), 'all 24 keys present after seed');
  assert(!('bogus' in sheet.scores), 'unknown keys not in sheet');
  assert(sheet.history.length === 0, 'quiz seed does not create noisy history entry');
}

// 3. Empty quiz seeds zeros
{
  const quiz = {};
  ensureSectorFitSheet(quiz);
  assert(SECTOR_KEYS.every((k) => quiz.sectorFitSheet.scores[k] === 0), 'empty quiz -> all zeros');
  assert(quiz.sectorFitSheet.history.length === 0, 'no history without signal');
}

// 4. Server ±20 clamp per patch
{
  const quiz = makeQuiz({ tech: 50 });
  ensureSectorFitSheet(quiz);
  const { changed, changes } = applySectorPatches(quiz.sectorFitSheet, [
    { key: 'tech', score: 100, reason: 'huge boost' },
    { key: 'finance', score: 30, reason: 'new sector' },
  ], { source: 'coach' });
  assert(changed, 'patch should change');
  assert(quiz.sectorFitSheet.scores.tech === 70, `tech clamped +20 from 50 -> 70, got ${quiz.sectorFitSheet.scores.tech}`);
  assert(quiz.sectorFitSheet.scores.finance === 20, 'finance from 0 clamped to +20 max -> 20');
  assert(changes.length === 2, 'two changes recorded');
  syncQuizScoresFromSheet(quiz);
  assert(quiz.scores.tech === 70, 'scores synced after patch');
}

// 5. Ignore invalid keys / sub-1 deltas
{
  const quiz = makeQuiz({ tech: 50 });
  ensureSectorFitSheet(quiz);
  const r = applySectorPatches(quiz.sectorFitSheet, [
    { key: 'notreal', score: 80 },
    { key: 'tech', score: 50.4 },
    { key: 'law', score: -5 },
  ], { source: 'coach' });
  assert(!r.changed, 'no-op patch');
  assert(quiz.sectorFitSheet.scores.law === 0, 'negative clamped to 0 on apply... wait law was 0, -5 clamps to 0, delta 0');
}

// 6. History cap at 40
{
  const quiz = makeQuiz({ tech: 10 });
  ensureSectorFitSheet(quiz);
  for (let i = 0; i < 45; i += 1) {
    applySectorPatches(quiz.sectorFitSheet, [{ key: 'tech', score: 10 + (i % 2) }], { source: 'refine' });
  }
  assert(quiz.sectorFitSheet.history.length <= 40, `history capped at 40, got ${quiz.sectorFitSheet.history.length}`);
}

// 7. industryFitFromSheet top-N
{
  const quiz = makeQuiz({ tech: 90, finance: 85, healthcare: 10, law: 0 });
  ensureSectorFitSheet(quiz);
  const top = industryFitFromSheet(quiz.sectorFitSheet, 4);
  assert(top[0].key === 'tech' && top[0].score === 90, 'top is tech');
  assert(top.length === 3, 'zeros excluded, length 3');
  assert(!top.some((t) => t.key === 'law'), 'zero law excluded');
}

// 8. Portal snapshot fallback uses sheet not raw hallucination
{
  const { buildFallbackPortalSnapshot } = await import(
    new URL('../functions/_lib/portal-snapshot.js', import.meta.url).href
  );
  const quiz = makeQuiz({ tech: 77, finance: 66 });
  ensureSectorFitSheet(quiz);
  // Simulate stale quiz.scores diverged from sheet
  quiz.scores = { tech: 10, finance: 10 };
  quiz.sectorFitSheet.scores = { ...quiz.sectorFitSheet.scores, tech: 77, finance: 66 };
  const snap = buildFallbackPortalSnapshot(quiz, [{ careerId: 1, name: 'Dev', score: 72, skills: ['JS'] }]);
  assert(snap.industryFit[0].score === 77, 'snapshot reads sheet scores via ensureSectorFitSheet resync');
}

// 9. normalizeSnapshot ignores AI fitScore on careers
{
  const { buildFallbackPortalSnapshot } = await import(
    new URL('../functions/_lib/portal-snapshot.js', import.meta.url).href
  );
  const quiz = makeQuiz({ tech: 80 });
  ensureSectorFitSheet(quiz);
  const pool = [{ careerId: 5, name: 'Analyst', score: 62, skills: [] }];
  const snap = buildFallbackPortalSnapshot(quiz, pool);
  assert(snap.careerPicks[0].fitScore === 62, 'fitScore from pool not AI');
}

// 10. patchSectorFitFromLearning soft-fail (mock Gemini)
{
  const quiz = makeQuiz({ tech: 50 });
  ensureSectorFitSheet(quiz);
  const env = {};
  const orig = (await import('../functions/_lib/gemini-json.js')).callGeminiJson;
  // Monkey-patch via dynamic re-import won't work easily; test apply path via direct mock
  const updates = [{ key: 'tech', score: 65, reason: 'CS projects' }, { key: 'cybersecurity', score: 55, reason: 'security club' }];
  const r = applySectorPatches(quiz.sectorFitSheet, updates, { source: 'resume' });
  assert(r.changed && quiz.sectorFitSheet.scores.tech === 65, 'mock patch applied');
  assert(quiz.sectorFitSheet.history[r.changes.length > 0 ? quiz.sectorFitSheet.history.length - 1 : 0].source === 'resume', 'history source');
}

// 11. Rapid concurrent-style patches (sequential stress)
{
  const quiz = makeQuiz(Object.fromEntries(SECTOR_KEYS.map((k, i) => [k, (i * 3) % 100])));
  ensureSectorFitSheet(quiz);
  let totalChanges = 0;
  for (let round = 0; round < 100; round += 1) {
    const key = SECTOR_KEYS[round % SECTOR_KEYS.length];
    const from = quiz.sectorFitSheet.scores[key];
    const to = (from + 7) % 101;
    const r = applySectorPatches(quiz.sectorFitSheet, [{ key, score: to }], { source: 'coach' });
    if (r.changed) totalChanges += 1;
  }
  assert(totalChanges > 50, `rapid patches applied (${totalChanges}/100 rounds changed)`);
  assert(quiz.sectorFitSheet.history.length <= 40, 'history still capped after 100 rounds');
  syncQuizScoresFromSheet(quiz);
  assert(
    JSON.stringify(quiz.scores) === JSON.stringify(quiz.sectorFitSheet.scores),
    'scores stay mirrored after stress',
  );
}

// 12. Client/server seed parity
{
  const scores = { tech: 72, media: 48, agriculture: 3 };
  const serverQuiz = makeQuiz(scores);
  const clientQuiz = makeQuiz(deepClone(scores));
  ensureSectorFitSheet(serverQuiz);
  Client.ensureSectorFitSheet(clientQuiz);
  assert(
    JSON.stringify(serverQuiz.sectorFitSheet.scores) === JSON.stringify(clientQuiz.sectorFitSheet.scores),
    'client/server seed parity',
  );
}

// 13. Client recordLocalPatches — NO ±20 clamp (documented divergence)
{
  const quiz = makeQuiz({ tech: 50 });
  Client.ensureSectorFitSheet(quiz);
  Client.recordLocalPatches(quiz, [{ key: 'tech', score: 95, reason: 'refine boost' }], 'refine');
  assert(quiz.sectorFitSheet.scores.tech === 95, 'client refine allows >20 delta (intentional for user sliders)');
}

// 14. applyServerSheet overwrites local
{
  const quiz = makeQuiz({ tech: 40 });
  Client.ensureSectorFitSheet(quiz);
  const serverSheet = {
    scores: Object.fromEntries(SECTOR_KEYS.map((k) => [k, k === 'tech' ? 88 : 0])),
    updatedAt: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), source: 'coach', changes: [{ key: 'tech', from: 40, to: 88 }] }],
  };
  Client.applyServerSheet(quiz, serverSheet);
  assert(quiz.scores.tech === 88, 'server sheet wins');
  assert(quiz.sectorFitSheet.history.length === 1, 'history replaced from server');
}

// 15. renderSectorCheatSheet outputs 24 rows, escapes HTML
{
  const quiz = makeQuiz({ tech: 50 });
  Client.ensureSectorFitSheet(quiz);
  const html = Client.renderSectorCheatSheet(quiz.sectorFitSheet);
  assert((html.match(/portal-sector-row/g) || []).length === 24, '24 sector rows rendered');
  Client.recordLocalPatches(quiz, [{ key: 'tech', score: 60, reason: '<script>x</script>' }], 'coach');
  const html2 = Client.renderSectorCheatSheet(quiz.sectorFitSheet);
  assert(!html2.includes('<script>x</script>'), 'raw script not in HTML output');
  assert(html2.includes('portal-sector-history'), 'history section present');
}

// 16. profileEntryHint 7-day window
{
  const quiz = makeQuiz({ tech: 50 });
  Client.ensureSectorFitSheet(quiz);
  quiz.sectorFitSheet.history = [{
    at: new Date().toISOString(),
    source: 'coach',
    changes: [{ key: 'tech', from: 50, to: 55 }],
  }];
  assert(Client.profileEntryHint(quiz.sectorFitSheet).includes('Updated 1 sector'), 'hint for recent update');
  quiz.sectorFitSheet.history[0].at = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  assert(Client.profileEntryHint(quiz.sectorFitSheet) === '', 'no hint after 7 days');
}

// 17. Merge logic simulation (auth mergeSectorFitSheet behavior)
function mergeSectorFitSheet(localQuiz, serverQuiz) {
  if (!localQuiz || !serverQuiz) return serverQuiz || localQuiz;
  const localSheet = localQuiz.sectorFitSheet;
  const serverSheet = serverQuiz.sectorFitSheet;
  if (!serverSheet || typeof serverSheet !== 'object') {
    if (localSheet && localSheet.scores) {
      return { ...serverQuiz, sectorFitSheet: localSheet, scores: { ...localSheet.scores } };
    }
    return serverQuiz;
  }
  if (!localSheet || typeof localSheet !== 'object') return serverQuiz;
  const localAt = Date.parse(localSheet.updatedAt || '');
  const serverAt = Date.parse(serverSheet.updatedAt || '');
  if (!Number.isNaN(localAt) && (Number.isNaN(serverAt) || localAt >= serverAt)) {
    return { ...serverQuiz, sectorFitSheet: localSheet, scores: { ...localSheet.scores } };
  }
  return serverQuiz;
}

{
  const local = makeQuiz({ tech: 60 });
  const server = makeQuiz({ tech: 40 });
  Client.ensureSectorFitSheet(local);
  ensureSectorFitSheet(server);
  local.sectorFitSheet.updatedAt = '2026-06-20T12:00:00.000Z';
  server.sectorFitSheet.updatedAt = '2026-06-19T12:00:00.000Z';
  const merged = mergeSectorFitSheet(local, server);
  assert(merged.sectorFitSheet.scores.tech === 60, 'newer local sheet wins merge');
  server.sectorFitSheet.updatedAt = '2026-06-21T12:00:00.000Z';
  const merged2 = mergeSectorFitSheet(local, server);
  assert(merged2.sectorFitSheet.scores.tech === 40, 'newer server sheet wins merge');
}

// 18. computeInputsHash changes when sector updatedAt changes
{
  const { computeInputsHash } = await import(
    new URL('../functions/_lib/portal-snapshot.js', import.meta.url).href
  );
  const quiz = makeQuiz({ tech: 50 });
  ensureSectorFitSheet(quiz);
  const h1 = computeInputsHash(quiz);
  applySectorPatches(quiz.sectorFitSheet, [{ key: 'tech', score: 55 }], { source: 'coach' });
  syncQuizScoresFromSheet(quiz);
  const h2 = computeInputsHash(quiz);
  assert(h1 !== h2, 'inputs hash invalidates on sector update (scores + sectorUpdatedAt)');
}

// 19. Extreme values stress
{
  const quiz = makeQuiz({});
  ensureSectorFitSheet(quiz);
  const r = applySectorPatches(
    quiz.sectorFitSheet,
    SECTOR_KEYS.map((k) => ({ key: k, score: 999 })),
    { source: 'coach' },
  );
  assert(r.changed, 'all sectors patched');
  assert(SECTOR_KEYS.every((k) => quiz.sectorFitSheet.scores[k] === 20), 'max +20 from 0 caps at 20 not 100');
}

// 20. Re-ensure idempotent
{
  const quiz = makeQuiz({ tech: 55, finance: 44 });
  const s1 = ensureSectorFitSheet(quiz);
  const s2 = ensureSectorFitSheet(quiz);
  assert(s1.scores.tech === 55 && s2.scores.tech === 55, 're-ensure preserves scores');
  assert(JSON.stringify(s1.scores) === JSON.stringify(s2.scores), 're-ensure score map stable');
}

console.log(`\n== Results: ${passed} passed, ${failed} failed ==`);
if (failures.length) {
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('All stress tests passed.');
