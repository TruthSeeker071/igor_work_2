#!/usr/bin/env node
/**
 * Gate 1: verify O*NET hub data artifacts (layout, colors, similarity).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = join(ROOT, 'data/onet/artifacts');
const HUB_MAP_PATH = join(ROOT, 'data/onet/hub-career-soc-map.json');

function loadJson(name) {
  return JSON.parse(readFileSync(join(ART, name), 'utf8'));
}

function loadHubMap() {
  return JSON.parse(readFileSync(HUB_MAP_PATH, 'utf8'));
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function ok(msg) {
  console.log('OK:', msg);
}

const careers = loadJson('careers.json');
const manifest = loadJson('manifest.json');
const excluded = loadJson('careers-excluded.json');
const similarity = loadJson('similarity-top8.json');
const zoneLayout = loadJson('zone-layout.json');
const zoneAggregates = loadJson('zone-aggregate-vectors.json');
const zoneCentroids = loadJson('zone-centroids.json');

const EXPECTED = manifest.occupationCount;
if (careers.length !== EXPECTED) {
  fail(`Expected ${EXPECTED} careers, got ${careers.length}`);
}
ok(`${careers.length} careers in careers.json (manifest occupationCount)`);

if (!excluded.count || excluded.count < 1) {
  fail('careers-excluded.json missing or empty');
}
ok(`careers-excluded.json has ${excluded.count} excluded careers`);

let outOfScope = 0;
let missingCollar = 0;
careers.forEach((c) => {
  if (c.mvpInScope === false) outOfScope++;
  if (!c.collarCategory) missingCollar++;
});
if (outOfScope) fail(`${outOfScope} careers in careers.json with mvpInScope=false`);
if (missingCollar) fail(`${missingCollar} careers missing collarCategory`);
ok('All in-scope careers have collarCategory and mvpInScope');

const excludedSocs = new Set((excluded.careers || []).map((c) => c.soc));
careers.forEach((c) => {
  if (excludedSocs.has(c.soc)) fail(`Excluded SOC ${c.soc} present in careers.json`);
});
ok('No excluded SOC in careers.json');

const hubMap = loadHubMap();
const careerSocs = new Set(careers.map((c) => c.soc));
let hubMapMissing = 0;
Object.values(hubMap.careers || {}).forEach((entry) => {
  (entry.socs || []).forEach((s) => {
    if (s && s.soc && !careerSocs.has(s.soc)) hubMapMissing++;
  });
});
if (hubMapMissing) fail(`${hubMapMissing} hub-career-soc-map SOC(s) missing from careers.json`);
ok('Every hub-career-soc-map SOC resolves in careers.json');

const aggZones = Object.keys(zoneAggregates);
if (!aggZones.length) fail('zone-aggregate-vectors.json empty');
ok(`zone-aggregate-vectors.json has ${aggZones.length} zones`);

const centroidZones = Object.keys(zoneCentroids);
if (!centroidZones.length) fail('zone-centroids.json empty');
ok(`zone-centroids.json has ${centroidZones.length} zones`);

let missingColor = 0;
let missingZone = 0;
const positions = [];
const zoneSpread = {};

careers.forEach((c) => {
  if (!c.orbColor || !/^#[0-9A-Fa-f]{6}$/.test(c.orbColor)) missingColor++;
  if (!c.hubZone) missingZone++;
  if (c.layoutX == null || c.layoutY == null) fail(`Missing layout for ${c.soc}`);
  positions.push({ x: c.layoutX, y: c.layoutY, soc: c.soc, zone: c.hubZone });
  if (!zoneSpread[c.hubZone]) zoneSpread[c.hubZone] = { minX: c.layoutX, maxX: c.layoutX, minY: c.layoutY, maxY: c.layoutY };
  else {
    const z = zoneSpread[c.hubZone];
    z.minX = Math.min(z.minX, c.layoutX);
    z.maxX = Math.max(z.maxX, c.layoutX);
    z.minY = Math.min(z.minY, c.layoutY);
    z.maxY = Math.max(z.maxY, c.layoutY);
  }
});

if (missingColor) fail(`${missingColor} careers missing valid orbColor`);
if (missingZone) fail(`${missingZone} careers missing hubZone`);
ok('Every career has orbColor and hubZone');

const posKey = new Set();
let dupes = 0;
positions.forEach((p) => {
  const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  if (posKey.has(k)) dupes++;
  posKey.add(k);
});
if (dupes > careers.length * 0.02) {
  fail(`Too many duplicate positions: ${dupes} (${(dupes / careers.length * 100).toFixed(1)}%)`);
}
ok(`Position uniqueness: ${dupes} near-duplicate pairs (allowed <2%)`);

let cx = 0;
let cy = 0;
positions.forEach((p) => { cx += p.x; cy += p.y; });
cx /= positions.length;
cy /= positions.length;
let varX = 0;
let varY = 0;
positions.forEach((p) => {
  varX += (p.x - cx) ** 2;
  varY += (p.y - cy) ** 2;
});
const stdX = Math.sqrt(varX / positions.length);
const stdY = Math.sqrt(varY / positions.length);
if (stdX < 80 || stdY < 40) {
  fail(`Careers clustered at centroid (stdX=${stdX.toFixed(1)}, stdY=${stdY.toFixed(1)})`);
}
ok(`Spread stdX=${stdX.toFixed(1)} stdY=${stdY.toFixed(1)}`);

let narrowZones = 0;
Object.keys(zoneSpread).forEach((zone) => {
  const z = zoneSpread[zone];
  const spanX = z.maxX - z.minX;
  const spanY = z.maxY - z.minY;
  const count = careers.filter((c) => c.hubZone === zone).length;
  if (count > 3 && (spanX < 20 || spanY < 15)) narrowZones++;
});
if (narrowZones > 2) {
  fail(`${narrowZones} zones have careers in <20×15 box with 4+ careers`);
}
ok(`Zone internal spread: ${narrowZones} narrow zones (max 2 allowed)`);

let badSim = 0;
let overEight = 0;
Object.keys(similarity).forEach((soc) => {
  const neighbors = similarity[soc];
  if (neighbors.length > 8) overEight++;
  neighbors.forEach((n) => {
    if (n.score < 0.55) badSim++;
  });
});
if (overEight) fail(`${overEight} careers have >8 similarity neighbors`);
if (badSim) fail(`${badSim} similarity links below 0.55`);
ok(`Similarity top-8: all scores >= 0.55`);

if (!zoneLayout.worldW || !zoneLayout.zones) {
  fail('zone-layout.json missing worldW or zones');
}
ok(`zone-layout world ${zoneLayout.worldW}×${zoneLayout.worldH}`);

if (!zoneLayout.sectorCanvas || !zoneLayout.sectorCanvas.w || !zoneLayout.sectorCanvas.h) {
  fail('zone-layout.json missing sectorCanvas');
}
const SECTOR_W = zoneLayout.sectorCanvas.w;
const SECTOR_H = zoneLayout.sectorCanvas.h;
ok(`sector canvas ${SECTOR_W}×${SECTOR_H}`);

let missingSector = 0;
let sectorOut = 0;
const sectorByZone = {};
careers.forEach((c) => {
  if (c.sectorX == null || c.sectorY == null) missingSector++;
  if (c.sectorX < 0 || c.sectorX > SECTOR_W || c.sectorY < 0 || c.sectorY > SECTOR_H) sectorOut++;
  if (!sectorByZone[c.hubZone]) sectorByZone[c.hubZone] = [];
  sectorByZone[c.hubZone].push(c);
});
if (missingSector) fail(`${missingSector} careers missing sectorX/sectorY`);
if (sectorOut) fail(`${sectorOut} careers outside sector canvas`);
ok('Every career has sectorX/Y within sector canvas');

const SECTOR_MIN_PAIR = 40;
let sectorClosePairs = 0;
let sectorTotalPairs = 0;
Object.keys(sectorByZone).forEach((zone) => {
  const inZone = sectorByZone[zone];
  for (let i = 0; i < inZone.length; i++) {
    for (let j = i + 1; j < inZone.length; j++) {
      sectorTotalPairs++;
      const d = Math.hypot(inZone[i].sectorX - inZone[j].sectorX, inZone[i].sectorY - inZone[j].sectorY);
      if (d < SECTOR_MIN_PAIR) sectorClosePairs++;
    }
  }
});
const sectorClosePct = sectorTotalPairs ? (sectorClosePairs / sectorTotalPairs) * 100 : 0;
if (sectorClosePct > 8) {
  fail(`${sectorClosePct.toFixed(1)}% sector pairs closer than ${SECTOR_MIN_PAIR} (max 8%)`);
}
ok(`Sector pair spacing: ${sectorClosePct.toFixed(1)}% pairs < ${SECTOR_MIN_PAIR} (max 8%)`);

let missingNorm = 0;
careers.forEach((c) => {
  if (c.layoutNX == null || c.layoutNY == null) missingNorm++;
});
if (missingNorm) fail(`${missingNorm} careers missing layoutNX/layoutNY`);

const EDGE = 12;
let edgeViolations = 0;
careers.forEach((c) => {
  const zb = zoneLayout.zones[c.hubZone];
  if (!zb) return;
  if (c.layoutX < zb.minX + EDGE || c.layoutX > zb.maxX - EDGE
    || c.layoutY < zb.minY + EDGE || c.layoutY > zb.maxY - EDGE) {
    edgeViolations++;
  }
});
if (edgeViolations) fail(`${edgeViolations} careers within ${EDGE} units of zone edge`);
ok(`Edge margin: all careers >= ${EDGE} units from zone border`);

const MIN_PAIR = 14;
let closePairs = 0;
let totalPairs = 0;
Object.keys(zoneSpread).forEach((zone) => {
  const inZone = careers.filter((c) => c.hubZone === zone);
  for (let i = 0; i < inZone.length; i++) {
    for (let j = i + 1; j < inZone.length; j++) {
      totalPairs++;
      const d = Math.hypot(inZone[i].layoutX - inZone[j].layoutX, inZone[i].layoutY - inZone[j].layoutY);
      if (d < MIN_PAIR) closePairs++;
    }
  }
});
const closePct = totalPairs ? (closePairs / totalPairs) * 100 : 0;
if (closePct > 5) {
  fail(`${closePct.toFixed(1)}% of zone pairs closer than ${MIN_PAIR} units (max 5%)`);
}
ok(`Pair spacing: ${closePct.toFixed(1)}% pairs < ${MIN_PAIR} units (max 5%)`);

console.log('\nverify-hub-data: all checks passed');
