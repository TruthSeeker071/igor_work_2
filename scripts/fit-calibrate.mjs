#!/usr/bin/env node
/**
 * fit:calibrate — the offline instrument for the distinctive-fit rollout
 * (docs/DISTINCT_FIT_MASTERPLAN_2026-07-21.md, phase D1).
 *
 * It is committed tooling rather than a throwaway probe because every constant
 * the flip depends on — FIT_TIERS, FIT_NEUTRAL, the stretch criteria, the
 * tradeOff thresholds — is a claim about a DISTRIBUTION, and a distribution
 * that nobody can recompute is a distribution nobody can check. Re-run this
 * after any change to the seed, the centroids or the chokepoint.
 *
 * It runs the real client modules against the real artifacts, exactly as
 * scripts/test-vectors.cjs does, over the six shared personas in
 * scripts/fixtures/fit-personas.cjs.
 *
 * Variants: A = today's mean-centered cosine, D = masked distinctive fit
 * (subtract LV_BASELINE from both sides, correlate over the user's nonzero
 * dims). Each variant is measured by calling its own function — cosine for A,
 * distinctiveCosine for D — never through personalityFitPercent, so the
 * comparison stays honest no matter which one the chokepoint is shipping.
 *
 * Usage:
 *   node scripts/fit-calibrate.mjs              # both variants + ladder search
 *   node scripts/fit-calibrate.mjs --variant=A  # one variant
 *   node scripts/fit-calibrate.mjs --json       # machine-readable
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ART = path.join(REPO, 'data/onet/artifacts');
const artifact = (n) => JSON.parse(fs.readFileSync(path.join(ART, n), 'utf8'));

const ARGS = process.argv.slice(2);
const ONLY = (ARGS.find((a) => a.startsWith('--variant=')) || '').slice(10).toUpperCase();
const AS_JSON = ARGS.includes('--json');

// Occupancy targets from the masterplan (Part 2). A ladder is only meaningful
// if the top tiers stay rare for a DECIDED user — the defect that started this
// plan is a finance persona with 446/782 careers at mythic.
const OCCUPANCY = { mythic: 0.03, legendary: 0.08, epic: 0.20 };

// ---- browser stubs, same shape as scripts/test-vectors.cjs ----
const store = {};
global.window = global;
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
global.dispatchEvent = () => {};
global.addEventListener = () => {};
global.fetch = () => Promise.reject(new Error('no network in fit:calibrate'));

const load = (rel) => {
  const code = fs.readFileSync(path.join(REPO, rel), 'utf8');
  // Indirect eval so the IIFEs land in global scope, where `window` is.
  (0, eval)(code);
};
load('assets/js/shared/onet-math.js');
load('assets/js/shared/academics-map.js');
load('assets/js/shared/refine-map.js');
load('assets/js/shared/sector-fit-sheet.js');
load('assets/js/shared/user.js');
load('assets/js/shared/onet-vectors.js');
load('assets/js/shared/hub-zone-fit.js');

const M = global.FWOnetMath;
const V = global.FWOnetVectors;
const ZF = global.FWHubZoneFit;
const DIM = V.DIM;
const { PERSONAS } = require('./fixtures/fit-personas.cjs');

const careers = artifact('careers.json');
const zoneCentroids = artifact('zone-centroids.json');
const aggregates = artifact('zone-aggregate-vectors.json');
const zoneProfiles = artifact('zone-dimension-profiles.json');
const lvRaw = fs.readFileSync(path.join(ART, 'vectors-lv.f32.bin'));
const lvBuf = new Float32Array(lvRaw.buffer, lvRaw.byteOffset, lvRaw.byteLength / 4);
const vecFor = (c) => Array.from(lvBuf.subarray(c.vectorIndex * DIM, c.vectorIndex * DIM + DIM));
const bySoc = Object.fromEntries(careers.map((c) => [c.soc, c]));

// Serve the real dimension profiles off disk so the theme layer runs on
// production data instead of the built-in fallback (mirrors test-vectors.cjs).
{
  const sheet = global.FWSectorFitSheet;
  global.fetch = (url) => (String(url).includes('zone-dimension-profiles')
    ? Promise.resolve({ ok: true, json: async () => zoneProfiles })
    : Promise.reject(new Error('no network in fit:calibrate')));
  await V.loadZoneDimensionProfiles();
  global.fetch = () => Promise.reject(new Error('no network in fit:calibrate'));
  global.FWSectorFitSheet = sheet;
}

const VARIANTS = {
  A: (u, v) => M.cosinePercent(M.cosine(u, v)),
  D: (u, v) => M.cosinePercent(M.distinctiveCosine(u, v)),
};

/** Run `fn` with the chokepoint forced to one variant, then restore it. */
function withVariant(name, fn) {
  const origV = V.personalityFitPercent;
  const origM = M.personalityFitPercent;
  V.personalityFitPercent = VARIANTS[name];
  M.personalityFitPercent = VARIANTS[name];
  try { return fn(); } finally {
    V.personalityFitPercent = origV;
    M.personalityFitPercent = origM;
  }
}

const pct = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Everything the calibration needs about one persona under one variant. */
function measure(persona, variant) {
  const fit = VARIANTS[variant];
  const quiz = V.hydrateQuizVectors(JSON.parse(JSON.stringify(persona.quiz)), { zoneCentroids });
  const values = quiz.personalityVector.values;
  const signalDims = values.filter((x) => x !== 0).length;

  const catalog = careers.map((c) => fit(values, vecFor(c)));
  const sorted = catalog.slice().sort((a, b) => a - b);

  // Objective fit is FROZEN by the plan, so every threshold that compares
  // personality against objective (the stretch criteria, tradeOffLabel) moves
  // when personality shrinks — even though neither side of the comparison was
  // edited. These are the numbers those constants have to be re-picked against.
  const objValues = quiz.objectiveVector && quiz.objectiveVector.values;
  const objActive = objValues && M.magnitude(objValues) > 0.01;
  const objective = objActive ? careers.map((c) => M.objectiveFitPercent(objValues, vecFor(c))) : null;
  const overall = objective ? catalog.map((p, i) => V.overallFitScore(p, objective[i])) : catalog.slice();
  const topByOverall = new Set(overall
    .map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).slice(0, 12).map(([, i]) => i));
  const gaps = objective ? catalog.map((p, i) => p - objective[i]) : [];

  const clusters = {};
  for (const p of PERSONAS) clusters[p.key] = mean(p.expect.map((s) => fit(values, vecFor(bySoc[s]))));

  const zoneMap = withVariant(variant,
    () => ZF.computeZoneFitsMap(quiz.personalityVector, quiz.objectiveVector, aggregates));
  const zoneRows = ZF.ZONE_ORDER.filter((z) => zoneMap[z])
    .map((z) => ({ id: z, score: zoneMap[z].personalityFit }))
    .sort((a, b) => b.score - a.score);
  const median = zoneRows[Math.floor(zoneRows.length / 2)].score;

  return {
    key: persona.key,
    variant,
    signalDims,
    own: clusters[persona.key],
    clusters,
    worstOtherCluster: Object.entries(clusters)
      .filter(([k]) => k !== persona.key && k !== 'trades')
      .sort((a, b) => b[1] - a[1])[0] || null,
    homeZone: zoneRows[0].id,
    homeRank: zoneRows.findIndex((r) => r.id === persona.homeZone) + 1,
    homeMargin: zoneRows.find((r) => r.id === persona.homeZone).score - median,
    p10: pct(sorted, 0.10),
    p50: pct(sorted, 0.50),
    p90: pct(sorted, 0.90),
    p99: pct(sorted, 0.99),
    max: sorted[sorted.length - 1],
    zeroShare: catalog.filter((x) => x <= 0).length / catalog.length,
    catalogSorted: sorted,
    objActive: !!objective,
    objP50: objective ? pct(objective.slice().sort((a, b) => a - b), 0.50) : null,
    objP90: objective ? pct(objective.slice().sort((a, b) => a - b), 0.90) : null,
    objMax: objective ? Math.max(...objective) : null,
    // Stretch surfacing (onet-vectors.js STRETCH_MIN_OBJECTIVE / _MIN_GAP /
    // _TOP_EXCLUDE): objectiveFit >= 52 AND objectiveFit >= personalityFit + 12
    // AND not in the top 12 by overall. Only the count matters — the panel shows
    // 3, so "how many qualify" is really "how selective is the criterion".
    stretchCount: (minObj, minGap) => (objective
      ? objective.filter((o, i) => o >= minObj && o >= catalog[i] + minGap && !topByOverall.has(i)).length
      : 0),
    // tradeOffLabel branches on personalityFit - objectiveFit (+/-30) and on
    // both >= 50.
    gapP90: gaps.length ? pct(gaps.slice().sort((a, b) => a - b), 0.90) : null,
    gapP10: gaps.length ? pct(gaps.slice().sort((a, b) => a - b), 0.10) : null,
    tradeOffShares: objective ? {
      pAhead30: gaps.filter((g) => g >= 30).length / gaps.length,
      oAhead30: gaps.filter((g) => g <= -30).length / gaps.length,
      bothStrong50: catalog.filter((p, i) => p >= 50 && objective[i] >= 50).length / catalog.length,
    } : null,
  };
}

const shareAtOrAbove = (r, t) => r.catalogSorted.filter((x) => x >= t).length / r.catalogSorted.length;

/**
 * Lowest integer threshold whose occupancy meets `target`, aggregated across
 * personas. Lowest, not any: a higher threshold also meets the target but
 * throws away tier headroom, and the tiers exist to discriminate.
 *
 * `aggregate` matters more than it looks. 'worst' asks that NO persona exceed
 * the target, which hands the whole ladder to the trades persona: its cluster
 * is genuinely the most distinctive in O*NET level space, so it scores 83 on
 * its own careers while the desk personas sit at 43-71. Calibrating the ceiling
 * to it puts mythic at 85 and nobody else can ever reach a top tier. 'median'
 * calibrates to a typical decided user and reports where trades lands.
 */
function thresholdFor(rows, target, aggregate = 'median') {
  const agg = (t) => {
    const shares = rows.map((r) => shareAtOrAbove(r, t)).sort((a, b) => b - a); // desc
    if (aggregate === 'worst') return shares[0];
    if (aggregate === 'allow1') return shares[1];      // every persona but one
    return shares[Math.floor(shares.length / 2)];      // median persona
  };
  for (let t = 0; t <= 100; t++) if (agg(t) <= target) return t;
  return 100;
}

/** Print a ladder's occupancy per persona, plus where each persona's own cluster lands. */
function ladderTable(rows, name, t) {
  console.log(`\n  ${name}: ${JSON.stringify(t)}`);
  console.log(`  ${'persona'.padEnd(14)}  myth  legd  epic  rare  unc   own-cluster reads   p99 reads`);
  for (const r of rows) {
    const s = (x) => `${(shareAtOrAbove(r, x) * 100).toFixed(0)}%`.padStart(5);
    console.log(
      `  ${r.key.padEnd(14)}${s(t.mythic)}${s(t.legendary)}${s(t.epic)}${s(t.rare)}${s(t.uncommon)}`
      + `   ${tierUnder(t, r.own).padEnd(18)}  ${tierUnder(t, r.p99)}`,
    );
  }
}

function report(variant) {
  const rows = PERSONAS.map((p) => measure(p, variant));
  const legacyTiers = M.FIT_TIERS;

  console.log(`\n=== variant ${variant} ${variant === 'A' ? '(today: mean-centered cosine)' : '(distinctive: masked, baseline-subtracted)'} ===`);
  console.log('persona        dims   own   home#  margin    p10  p50  p90  p99  max  zero%   worst other desk');
  for (const r of rows) {
    const w = r.worstOtherCluster;
    console.log(
      `${r.key.padEnd(14)} ${String(r.signalDims).padStart(4)} `
      + `${r.own.toFixed(0).padStart(5)} ${String(r.homeRank).padStart(6)} `
      + `${r.homeMargin.toFixed(0).padStart(7)} ${r.p10.toFixed(0).padStart(6)} `
      + `${r.p50.toFixed(0).padStart(4)} ${r.p90.toFixed(0).padStart(4)} `
      + `${r.p99.toFixed(0).padStart(4)} ${String(r.max).padStart(4)} `
      + `${(r.zeroShare * 100).toFixed(0).padStart(5)}%   ${w ? `${w[0]} ${w[1].toFixed(0)}` : '—'}`,
    );
  }

  console.log('\ncluster cross-matrix (row = persona vector, column = that cluster\'s careers):');
  console.log(`${''.padEnd(14)}${PERSONAS.map((p) => p.key.slice(0, 9).padStart(10)).join('')}`);
  for (const r of rows) {
    console.log(r.key.padEnd(14) + PERSONAS.map((p) => r.clusters[p.key].toFixed(0).padStart(10)).join(''));
  }

  const derive = (aggregate) => ({
    mythic: thresholdFor(rows, OCCUPANCY.mythic, aggregate),
    legendary: thresholdFor(rows, OCCUPANCY.legendary, aggregate),
    epic: thresholdFor(rows, OCCUPANCY.epic, aggregate),
    rare: thresholdFor(rows, 0.35, aggregate),
    uncommon: thresholdFor(rows, 0.55, aggregate),
  });
  const candidates = {
    'current (shipped)': legacyTiers,
    'masterplan first cut': { mythic: 60, legendary: 45, epic: 30, rare: 15, uncommon: 5 },
    'derived, median persona': derive('median'),
    'derived, all but one': derive('allow1'),
    // SHIPPED at D2 (docs/DISTINCT_FIT_PROGRESS.md). This is derive('allow1'),
    // 71/58/35/19/1, with only `rare` rounded: every persona but trades meets
    // the occupancy targets, and every persona's own cluster still reads epic or
    // better. D1 also rounded mythic to 70, which put the education persona at
    // 3.2% mythic and failed its own <=3% acceptance bar — 71 is the measured
    // value, so 71 is what ships.
    'SHIPPED (D2)': { mythic: 71, legendary: 58, epic: 35, rare: 20, uncommon: 1 },
    'derived, worst persona': derive('worst'),
  };
  console.log('\ncandidate ladders — occupancy per persona, and what each persona\'s own cluster reads as.'
    + `\n(targets: mythic <=${OCCUPANCY.mythic * 100}%, legendary <=${OCCUPANCY.legendary * 100}%, epic <=${OCCUPANCY.epic * 100}%, rare <=35%, uncommon <=55%)`);
  for (const [name, t] of Object.entries(candidates)) ladderTable(rows, name, t);

  // FIT_NEUTRAL is a placeholder for "no fit computed yet". It must not colour
  // as a good match under whichever ladder ships — that is why it got a name.
  console.log('\nFIT_NEUTRAL — what a "we do not know yet" placeholder would read as:');
  for (const [name, t] of Object.entries(candidates)) {
    console.log(`  ${String(M.FIT_NEUTRAL).padStart(3)} under ${name.padEnd(24)} -> ${tierUnder(t, M.FIT_NEUTRAL)}`
      + `   (below ${t.uncommon} reads "common")`);
  }

  const live = rows.filter((r) => r.objActive);
  if (live.length) {
    console.log('\nthresholds that compare personality against the (frozen) objective vector:');
    console.log(`  ${'persona'.padEnd(14)} objFit p50/p90/max  stretch@52/12  @30/12  @20/12   p-o p10..p90  p>=50&o>=50  p-o>=30`);
    for (const r of live) {
      const t = r.tradeOffShares;
      console.log(
        `  ${r.key.padEnd(14)}${`${r.objP50.toFixed(0)}/${r.objP90.toFixed(0)}/${r.objMax}`.padStart(18)}`
        + `${String(r.stretchCount(52, 12)).padStart(15)}${String(r.stretchCount(30, 12)).padStart(8)}`
        + `${String(r.stretchCount(20, 12)).padStart(8)}`
        + `${`${r.gapP10.toFixed(0)}..${r.gapP90.toFixed(0)}`.padStart(14)}`
        + `${`${(t.bothStrong50 * 100).toFixed(0)}%`.padStart(13)}${`${(t.pAhead30 * 100).toFixed(0)}%`.padStart(9)}`,
      );
    }
    console.log('  (stretch shows how many of 782 careers qualify; the panel renders 3.'
      + '\n   "p-o >= 30" is how often tradeOffLabel claims "strong personality, early objective".)');
  }

  return { variant, rows: rows.map(({ catalogSorted, stretchCount, ...r }) => r), candidates };
}

function tierUnder(t, s) {
  if (s >= t.mythic) return 'mythic';
  if (s >= t.legendary) return 'legendary';
  if (s >= t.epic) return 'epic';
  if (s >= t.rare) return 'rare';
  if (s >= t.uncommon) return 'uncommon';
  return 'common';
}

const out = [];
for (const variant of ['A', 'D']) {
  if (ONLY && ONLY !== variant) continue;
  out.push(report(variant));
}
if (AS_JSON) console.log(`\n${JSON.stringify(out, null, 2)}`);
