#!/usr/bin/env node
// Hydrate a fixture persona's raw quiz into the blob a real user actually has
// in storage, and print it as JSON.
//
// Why this exists: `fit-personas.cjs` carries the ANSWERS (sector scores,
// refine, academics, resume text). A user who has finished the quiz carries
// those *plus* the hydrated `personalityVector` / `objectiveVector`. Seeding a
// page with only the answers is not a smaller version of that state — it is a
// different one. The hub happens to hydrate on its own (it loads the zone
// centroids anyway), but `portal.html` reads whatever vector is already there,
// finds an all-zero `source: 'empty'` one, and ranks sectors off noise. A
// screenshot of that is a screenshot of the fixture, not of the product.
//
// Usage:
//   node scripts/fixtures/hydrate-persona.cjs quant-finance   # a fixture key
//   node scripts/fixtures/hydrate-persona.cjs -               # quiz JSON on stdin
//
// Hydration runs through the real client modules (same stub-load as
// test:vectors), in its own process — the browser stubs it installs would
// otherwise leak into whatever imported it.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ART = path.join(REPO, 'data/onet/artifacts');

// --- browser stubs (mirrors scripts/test-vectors.cjs) ---
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.window = global;
global.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
global.dispatchEvent = () => {};
global.addEventListener = () => {};
global.fetch = () => Promise.reject(new Error('no network'));

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(REPO, rel), 'utf8'));
}

load('assets/js/shared/onet-math.js');
load('assets/js/shared/academics-map.js');
load('assets/js/shared/refine-map.js');
// The seed ranks quiz scores through FWSectorFitSheet.SECTOR_KEYS; without it
// the vector comes back all zeros and looks like a successful hydration.
load('assets/js/shared/sector-fit-sheet.js');
load('assets/js/shared/user.js');
load('assets/js/shared/onet-vectors.js');

const V = global.FWOnetVectors;
const artifact = (name) => JSON.parse(fs.readFileSync(path.join(ART, name), 'utf8'));

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('usage: hydrate-persona.cjs <persona-key|->');

  let quiz;
  if (arg === '-') {
    quiz = JSON.parse(readStdin());
  } else {
    const { PERSONAS } = require('./fit-personas.cjs');
    const persona = PERSONAS.find((p) => p.key === arg);
    if (!persona) {
      throw new Error(`unknown persona "${arg}" (have: ${PERSONAS.map((p) => p.key).join(', ')})`);
    }
    quiz = JSON.parse(JSON.stringify(persona.quiz));
  }

  // Real dimension profiles, off disk — the theme layer otherwise silently
  // falls back to its built-in table.
  const zoneProfiles = artifact('zone-dimension-profiles.json');
  global.fetch = (url) => (String(url).includes('zone-dimension-profiles')
    ? Promise.resolve({ ok: true, json: async () => zoneProfiles })
    : Promise.reject(new Error('no network')));
  await V.loadZoneDimensionProfiles();

  const hydrated = V.hydrateQuizVectors(quiz, { zoneCentroids: artifact('zone-centroids.json') });
  const pv = hydrated.personalityVector;
  const signal = pv && pv.values ? pv.values.filter((x) => x).length : 0;
  if (signal < 24) {
    // A vector below the mask floor scores as "anti-generic" against every
    // career, which ranks trades first for everybody. Fail loudly rather than
    // hand a caller a blob that renders plausibly and means nothing.
    throw new Error(`hydration produced ${signal} signal dims (< 24) — the seed did not run`);
  }
  process.stdout.write(JSON.stringify(hydrated));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
