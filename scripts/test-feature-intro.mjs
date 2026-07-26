// Feature onboarding (WS-F) — manifest contract, persistence, seeding, wiring.
//
// The invariants that would break silently in a browser and never in a lint:
//   1. Every manifest entry obeys the copy rules (outcome headline ≤ 9 words,
//      exactly three benefits, every benefit icon present in lucide-lite —
//      a missing icon renders nothing, so the row silently loses its glyph).
//   2. featureIntros survives the user-model round trip on BOTH sides, so a
//      mark made on one device reaches D1 and comes back.
//   3. "Seen" is one-way: the local→account merge unions, never overwrites,
//      and the upload hash covers intros (otherwise a mark stays local for the
//      whole session).
//   4. Every page that declares data-fw-intro actually loads the engine, its
//      CSS, and lucide-lite — the three-part wiring that is easy to half-do.
//
// Deterministic, no API cost. Run: npm run test:intro

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEY_MAP, normalizeUser, denormalizeUser } from '../functions/_lib/user-model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/* ── Load the engine the way test:user loads the client facade ──────────── */
function loadEngine(seedStore) {
  const store = Object.assign({}, seedStore || {});
  const g = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    setTimeout: () => 0,
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
  };
  g.window = g;
  const userCode = read('assets/js/shared/user.js');
  // eslint-disable-next-line no-new-func
  new Function('window', 'localStorage', userCode)(g, g.localStorage);
  const introCode = read('assets/js/shared/feature-intro.js');
  // The engine boots off `document`; withhold it so the module loads as pure
  // state + manifest (auto() is the browser half and is covered by the wiring
  // assertions below).
  // eslint-disable-next-line no-new-func
  new Function('window', 'localStorage', 'document', introCode)(g, g.localStorage, undefined);
  return { FWFeatureIntro: g.FWFeatureIntro, FWUser: g.FWUser, store };
}

const { FWFeatureIntro } = loadEngine();
const FEATURES = FWFeatureIntro.FEATURES;
const LUCIDE = read('assets/vendor/lucide-lite.js');

/* ── 1. Manifest contract ───────────────────────────────────────────────── */
test('manifest is non-empty and every entry keys itself', () => {
  const keys = Object.keys(FEATURES);
  assert.ok(keys.length > 0, 'no features in the manifest');
  keys.forEach((k) => assert.equal(FEATURES[k].key, k, `${k} disagrees with its own key`));
});

Object.entries(FEATURES).forEach(([key, f]) => {
  test(`${key}: headline is an outcome in <= 9 words`, () => {
    assert.ok(f.headline, 'missing headline');
    const words = f.headline.trim().split(/\s+/);
    assert.ok(words.length <= 9, `${words.length} words: "${f.headline}"`);
    // The tool's own name as the headline is exactly what the plan forbids.
    assert.ok(
      f.headline.toLowerCase() !== String(f.eyebrow || '').toLowerCase(),
      'headline repeats the feature name instead of the outcome',
    );
  });

  test(`${key}: exactly three concrete benefits`, () => {
    assert.ok(Array.isArray(f.benefits), 'benefits missing');
    assert.equal(f.benefits.length, 3, `${f.benefits.length} benefits`);
    f.benefits.forEach((b, i) => {
      assert.ok(b.text && b.text.length > 30, `benefit ${i} is too thin to be concrete`);
      assert.ok(b.icon, `benefit ${i} has no icon`);
      assert.ok(
        LUCIDE.includes(`"${b.icon}":`),
        `benefit ${i} icon "${b.icon}" is not in lucide-lite.js — it would render as nothing`,
      );
    });
  });

  test(`${key}: has a CTA and an inline SVG visual`, () => {
    assert.ok(f.cta, 'missing cta');
    assert.ok(f.visual && f.visual.startsWith('<svg'), 'visual must be an inline SVG scene');
    // The xmlns URL is the one legitimate http:// in an SVG; anything that
    // fetches (an <image>, a url() fill) is the stock imagery the plan bans.
    assert.ok(!/<img|<image|url\(/.test(f.visual), 'no remote or bitmap imagery in a visual');
  });

  test(`${key}: ribbon holds at most three tips`, () => {
    if (!f.ribbon) return;
    assert.ok(Array.isArray(f.ribbon), 'ribbon must be an array');
    assert.ok(f.ribbon.length <= 3, `${f.ribbon.length} tips — the plan caps it at 3`);
    f.ribbon.forEach((t) => assert.ok(t.length <= 110, `tip too long to stay one line: "${t}"`));
  });
});

/* ── 2. Persistence through the user model, both sides ──────────────────── */
test('featureIntros is in both KEY_MAPs, at the same path', () => {
  const server = KEY_MAP.find(([v1]) => v1 === 'featureIntros');
  assert.ok(server, 'server KEY_MAP has no featureIntros row');
  assert.equal(server[1], 'journey.featureIntros');
  const { FWUser } = loadEngine();
  assert.deepEqual(FWUser.KEY_MAP, KEY_MAP, 'client and server KEY_MAP drifted');
});

test('a mark survives normalize → denormalize (the D1 round trip)', () => {
  const v1 = { scores: { realistic: 4 }, featureIntros: { hub: { seen: true, seenAt: '2026-07-21T00:00:00.000Z' } } };
  const v2 = normalizeUser(v1);
  assert.equal(v2.journey.featureIntros.hub.seen, true);
  assert.deepEqual(denormalizeUser(v2).featureIntros, v1.featureIntros);
});

test('markSeen writes through the facade and reads back as seen', () => {
  const { FWFeatureIntro: engine, FWUser, store } = loadEngine();
  assert.equal(engine.isSeen('hub'), false, 'a fresh profile has seen nothing');
  engine.markSeen('hub', 'go');
  assert.equal(engine.isSeen('hub'), true);
  const stored = JSON.parse(store['fw_user_v1']);
  assert.equal(stored.journey.featureIntros.hub.seen, true, 'not stored at journey.featureIntros');
  assert.ok(stored.journey.featureIntros.hub.seenAt, 'no seenAt stamp');
  assert.equal(FWUser.getBlob().featureIntros.hub.seen, true, 'not visible in the v1 view');
});

test('markSeen is idempotent — a second call does not restamp', () => {
  const { FWFeatureIntro: engine } = loadEngine();
  engine.markSeen('hub', 'go');
  const first = engine.stateFor('hub').seenAt;
  engine.markSeen('hub', 'skip');
  assert.equal(engine.stateFor('hub').seenAt, first);
});

/* ── 2b. Measurement: the counters exist and read back ──────────────────── */
test('every outcome logs a counted event, and stats() reads them back', () => {
  const store = {};
  const g = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    setTimeout: () => 0,
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
  };
  g.window = g;
  const logged = [];
  g.FWEvents = {
    log: (t, d) => logged.push({ t, d, page: 'probe' }),
    all: () => logged.slice().reverse(),
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'localStorage', read('assets/js/shared/user.js'))(g, g.localStorage);
  // eslint-disable-next-line no-new-func
  new Function('window', 'localStorage', 'document', read('assets/js/shared/feature-intro.js'))(g, g.localStorage, undefined);
  const engine = g.FWFeatureIntro;

  engine.markSeen('hub', 'go');
  engine.markSeen('resume', 'skip');
  engine.markSeen('mock-interview', 'gate');
  assert.deepEqual(logged.map((e) => e.t), [
    'feature_intro_completed', 'feature_intro_skipped', 'feature_intro_upgraded',
  ], 'each outcome must be its own counter — skipped vs completed is the whole signal');

  const s = engine.stats();
  assert.equal(s.hub.completed, 1);
  assert.equal(s.resume.skipped, 1);
  assert.equal(s['mock-interview'].upgraded, 1, 'a locked feature\'s CTA counts as an upgrade moment');
});

/* ── 3. Seeding: a demonstrably-used feature is never introduced ─────────── */
test('seeding marks features the student has already used', () => {
  const v1 = {
    scores: { realistic: 4 },
    refine: { answers: [] },
    profileBuilding: { answers: [{ id: 'a' }] },
    resumeText: 'Jacob Klugerman — resume',
  };
  const { FWFeatureIntro: engine } = loadEngine({
    fw_user_v1: JSON.stringify(normalizeUser(v1)),
    fw_roadmap_v1: JSON.stringify({ version: 2, nodes: [] }),
    fw_sim_history_v2: JSON.stringify([{ id: 't1' }]),
  });
  engine.seed();
  ['hub', 'sharpen', 'know-you', 'resume', 'roadmap', 'simulation'].forEach((k) => {
    assert.equal(engine.isSeen(k), true, `${k} should have been seeded from existing data`);
  });
  assert.equal(engine.isSeen('marco'), false, 'no signal for marco — must stay unseen');
});

test('seeding writes nothing when the visitor has no profile at all', () => {
  // Load-bearing: an fw_user_v1 written here makes user.js's boot migration
  // treat a later legacy fw_hub_quiz_v1 as already promoted and DELETE it.
  // smoke-hub-load.mjs caught exactly that — the seeded quiz vanished and the
  // hub's zone fits went flat.
  const { FWFeatureIntro: engine, store } = loadEngine();
  engine.seed();
  assert.equal(store['fw_user_v1'], undefined, 'seed() must not create a user object');
  // And the legacy blob must still survive a boot after an intro-less visit.
  const legacy = { name: 'Smoke', scores: { creative: 90 } };
  const second = loadEngine({ fw_hub_quiz_v1: JSON.stringify(legacy) });
  second.FWFeatureIntro.seed();
  assert.equal(second.FWUser.getBlob().scores.creative, 90, 'the promoted quiz survived seeding');
});

test('seeding runs once and never un-marks a later feature', () => {
  const { FWFeatureIntro: engine, store } = loadEngine();
  engine.seed();
  engine.markSeen('marco', 'go');
  engine.seed(); // second boot
  assert.equal(engine.isSeen('marco'), true);
  assert.equal(JSON.parse(store['fw_user_v1']).journey.featureIntros._seeded, true);
});

/* ── 4. The merge and hash halves of the sync path (auth.js) ─────────────── */
test('auth.js unions intros on both merge chains and hashes them', () => {
  const auth = read('assets/js/shared/auth.js');
  assert.ok(auth.includes('function mergeFeatureIntros'), 'no mergeFeatureIntros');
  assert.equal(
    (auth.match(/merged = mergeFeatureIntros\(/g) || []).length, 2,
    'mergeFeatureIntros must run on BOTH the download (loadProfile) and upload chains',
  );
  assert.ok(auth.includes('intros: introsHash('), 'quizPayloadHash omits intros — marks would never sync');
});

/* ── 5. Page wiring ─────────────────────────────────────────────────────── */
const PAGES = fs.readdirSync(REPO).filter((f) => f.endsWith('.html'));
test('every page declaring data-fw-intro loads the engine, its CSS and lucide', () => {
  const declaring = PAGES.filter((p) => /data-fw-intro=/.test(read(p)));
  assert.ok(declaring.length > 0, 'no page declares a feature intro');
  declaring.forEach((p) => {
    const html = read(p);
    const key = html.match(/data-fw-intro="([a-z-]+)"/)[1];
    assert.ok(FEATURES[key], `${p} declares "${key}", which is not in the manifest`);
    assert.ok(html.includes('shared/feature-intro.js'), `${p} does not load feature-intro.js`);
    assert.ok(html.includes('feature-intro.css'), `${p} does not load feature-intro.css`);
    assert.ok(html.includes('lucide-lite.js'), `${p} does not load lucide-lite.js — benefits lose their icons`);
  });
});

test('every ribbon slot names a real feature on a page that loads the engine', () => {
  const slots = PAGES.filter((p) => /data-fw-ribbon=/.test(read(p)));
  assert.ok(slots.length > 0, 'no page declares a ribbon slot');
  slots.forEach((p) => {
    const html = read(p);
    [...html.matchAll(/data-fw-ribbon="([a-z-]+)"/g)].forEach(([, key]) => {
      assert.ok(FEATURES[key], `${p} mounts a ribbon for "${key}", which is not in the manifest`);
      assert.ok(FEATURES[key].ribbon && FEATURES[key].ribbon.length, `"${key}" has a slot but no tips`);
      assert.ok(html.includes('shared/feature-intro.js'), `${p} has a ribbon slot but never loads the engine`);
      assert.ok(html.includes('feature-intro.css'), `${p} has a ribbon slot but never loads its CSS`);
    });
  });
});

test('a ribbon-only feature is reachable through a slot, not an interstitial', () => {
  const ribbonOnly = Object.entries(FEATURES).filter(([, f]) => f.introMode === 'ribbon');
  ribbonOnly.forEach(([key]) => {
    const mounted = PAGES.some((p) => read(p).includes(`data-fw-ribbon="${key}"`));
    assert.ok(mounted, `"${key}" is ribbon-only but no page mounts its ribbon — it would teach nothing`);
  });
});

test('every interstitial feature is actually reachable from somewhere', () => {
  const declared = new Set();
  PAGES.forEach((p) => {
    const m = read(p).match(/data-fw-intro="([a-z-]+)"/);
    if (m) declared.add(m[1]);
  });
  const js = ['assets/js', 'assets/vendor'];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  ));
  const source = js.flatMap((d) => walk(path.join(REPO, d)))
    .filter((f) => f.endsWith('.js') && !f.endsWith('feature-intro.js'))
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  Object.entries(FEATURES).forEach(([key, f]) => {
    if (f.introMode === 'ribbon') return; // deliberately taught in place
    const fromJs = source.includes(`maybeShow('${key}')`) || source.includes(`show('${key}')`);
    assert.ok(
      declared.has(key) || fromJs,
      `"${key}" has an interstitial nobody ever triggers — wire a page's data-fw-intro or a maybeShow() call`,
    );
  });
});

test('feature-intro.js and its CSS carry one buster stamp across all pages', () => {
  ['feature-intro.js', 'feature-intro.css'].forEach((asset) => {
    const stamps = new Set();
    PAGES.forEach((p) => {
      const m = read(p).match(new RegExp(`${asset.replace('.', '\\.')}\\?v=([0-9a-z]+)`));
      if (m) stamps.add(m[1]);
    });
    assert.ok(stamps.size <= 1, `${asset} ships under ${stamps.size} different stamps: ${[...stamps]}`);
  });
});

if (failures) {
  console.error(`\ntest:intro FAILED — ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\ntest:intro passed');
