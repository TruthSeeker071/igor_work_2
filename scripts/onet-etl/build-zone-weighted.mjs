#!/usr/bin/env node
/**
 * Add the representativeness-weighted centroid (lvMeanW + repWeightSum) to an
 * already-built zone-aggregate-vectors.json, in place.
 *
 * WHY THIS EXISTS instead of just re-running build.mjs: rezone-hub.mjs is a
 * downstream pass that rewrote careers.json/layout-2d.json/hub-zone-map.json to
 * the 10 display macro-sectors, and a full build.mjs run would overwrite those
 * with a fresh 18-zone UMAP layout. This script re-derives the 18 build-time
 * zone ids from (soc, title) — hubZoneForSoc is pure, and the recovered
 * membership reproduces every stored `count` exactly — and reuses each zone's
 * stored lvMean as c0, so the existing fields come out byte-identical.
 *
 * Usage: node scripts/onet-etl/build-zone-weighted.mjs [--check]
 *   --check  report what would change and exit non-zero if stale; write nothing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hubZoneForSoc, zoneAggregateEntry } from './zone-weighting.mjs';
import { DIM_COUNT } from '../../functions/_lib/onet/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../data/onet/artifacts');
const AGG_FILE = path.join(OUT_DIR, 'zone-aggregate-vectors.json');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8'));
}

function main() {
  const check = process.argv.includes('--check');
  const careers = loadJson('careers.json');
  const aggregates = loadJson('zone-aggregate-vectors.json');
  const raw = fs.readFileSync(path.join(OUT_DIR, 'vectors-lv.f32.bin'));
  const lv = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

  const byZone = new Map();
  careers.forEach((c) => {
    const zone = hubZoneForSoc(c.soc, c.title);
    if (!byZone.has(zone)) byZone.set(zone, []);
    const off = c.vectorIndex * DIM_COUNT;
    byZone.get(zone).push(Array.from(lv.subarray(off, off + DIM_COUNT)));
  });

  const zones = Object.keys(aggregates);
  const missing = zones.filter((z) => !byZone.has(z));
  if (missing.length) {
    throw new Error(`recovered membership is missing zones: ${missing.join(', ')}`);
  }
  const extra = [...byZone.keys()].filter((z) => !aggregates[z]);
  if (extra.length) {
    throw new Error(`recovered membership invented zones: ${extra.join(', ')}`);
  }

  let stale = 0;
  zones.forEach((zone) => {
    const vectors = byZone.get(zone);
    const entry = aggregates[zone];
    if (vectors.length !== entry.count) {
      throw new Error(`zone ${zone}: recovered ${vectors.length} careers, artifact says ${entry.count}`);
    }
    const next = zoneAggregateEntry(vectors, entry.lvMean);
    const changed = JSON.stringify(entry.lvMeanW) !== JSON.stringify(next.lvMeanW)
      || entry.repWeightSum !== next.repWeightSum;
    if (changed) stale++;
    entry.lvMeanW = next.lvMeanW;
    entry.repWeightSum = next.repWeightSum;
  });

  if (check) {
    console.log(stale
      ? `zone-aggregate-vectors.json: ${stale}/${zones.length} zones stale — run without --check`
      : `zone-aggregate-vectors.json: all ${zones.length} weighted centroids up to date`);
    process.exit(stale ? 1 : 0);
  }

  fs.writeFileSync(AGG_FILE, JSON.stringify(aggregates, null, 2));
  console.log(`Wrote lvMeanW + repWeightSum for ${zones.length} zones → ${AGG_FILE}`);
}

main();
