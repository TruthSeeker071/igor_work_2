#!/usr/bin/env node
/**
 * O*NET 30.3 → onet-lv-161-v1 artifacts (zero LLM).
 * Usage: node scripts/onet-etl/build.mjs [--input path/to/db_30_3_text]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeUmapLayout, orbColorForZone, ZONE_ORB_COLORS } from './layout-umap.mjs';
import { computeSectorUmapLayout } from './sector-preset-layout.mjs';
import { classifyCareer } from './collar-scope.mjs';
import { buildZoneDimensionProfiles } from './build-zone-profiles.mjs';
import { hubZoneForSoc, zoneAggregateEntry } from './zone-weighting.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INPUT = path.join(ROOT, '.onet-cache/db_30_3_text');
const OUT_DIR = path.join(ROOT, 'data/onet/artifacts');
const SCHEMA_ID = 'onet-lv-161-v1';
const DIM_COUNT = 161;
const LV_MAX = 7;
const TOP_K_SIM = 8;
const MIN_SIM_SCORE = 0.55;

const DOMAIN_FILES = [
  { domain: 'skills', files: ['Essential Skills.txt', 'Transferable Skills.txt'] },
  { domain: 'knowledge', files: ['Knowledge.txt'] },
  { domain: 'abilities', files: ['Abilities.txt'] },
  { domain: 'workActivities', files: ['Work Activities.txt'] },
];

const ZONE_W = 200;
const ZONE_H = 175;
const GUTTER = 0;
const WORLD_W = 6 * (ZONE_W + GUTTER);
const WORLD_H = 3 * (ZONE_H + GUTTER);

/** 6×3 grid — one continent per zone, no overlap */
const ZONE_GRID = [
  ['tech', 'healthcare', 'finance', 'science', 'engineering', 'creative'],
  ['business', 'marketing', 'education', 'law', 'social', 'media'],
  ['government', 'operations', 'trades', 'agriculture', 'cybersecurity', 'hospitality'],
];

const ZONE_GRID_LOOKUP = new Map();
ZONE_GRID.forEach((row, gy) => {
  row.forEach((zone, gx) => {
    const minX = gx * (ZONE_W + GUTTER) + GUTTER / 2;
    const minY = gy * (ZONE_H + GUTTER) + GUTTER / 2;
    const maxX = minX + ZONE_W;
    const maxY = minY + ZONE_H;
    ZONE_GRID_LOOKUP.set(zone, {
      minX, minY, maxX, maxY,
      labelX: minX + ZONE_W / 2,
      labelY: minY + ZONE_H / 2,
      cx: minX + ZONE_W / 2,
      cy: minY + ZONE_H / 2,
    });
  });
});

function parseTsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cols = line.split('\t');
    const row = {};
    header.forEach((h, i) => { row[h.trim()] = (cols[i] || '').trim(); });
    return row;
  });
}

function lvTo100(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, (v / LV_MAX) * 100));
}

function imTo100(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, ((v - 1) / 4) * 100));
}

function socMajor(soc) {
  return String(soc || '').slice(0, 2);
}

function buildRegistry(inputDir) {
  const seen = new Map();
  const dimensions = [];

  for (const { domain, files } of DOMAIN_FILES) {
    for (const file of files) {
      const fp = path.join(inputDir, file);
      if (!fs.existsSync(fp)) throw new Error(`Missing ${fp}`);
      const rows = parseTsv(fp);
      const elementIds = [...new Set(rows.filter((r) => r['Scale ID'] === 'LV').map((r) => r['Element ID']))].sort();
      for (const elementId of elementIds) {
        if (seen.has(elementId)) continue;
        const nameRow = rows.find((r) => r['Element ID'] === elementId);
        seen.set(elementId, {
          index: dimensions.length,
          elementId,
          name: nameRow?.['Element Name'] || elementId,
          domain,
          lvMin: 0,
          lvMax: LV_MAX,
        });
        dimensions.push(seen.get(elementId));
      }
    }
  }

  if (dimensions.length !== DIM_COUNT) {
    throw new Error(`Expected ${DIM_COUNT} dimensions, got ${dimensions.length}`);
  }
  return { schemaId: SCHEMA_ID, onetRelease: '30.3', dimensions };
}

function ingestDomainRows(rows, elementIndex, socIndex) {
  for (const row of rows) {
    if (row['Scale ID'] !== 'LV') continue;
    const soc = row['O*NET-SOC Code'];
    const idx = elementIndex.get(row['Element ID']);
    if (idx == null || !soc) continue;
    if (!socIndex.has(soc)) {
      socIndex.set(soc, {
        lv: new Float32Array(DIM_COUNT),
        im: new Float32Array(DIM_COUNT),
        mask: new Uint16Array(DIM_COUNT),
        hasLv: new Uint8Array(DIM_COUNT),
      });
    }
    const rec = socIndex.get(soc);
    const notRel = row['Not Relevant'] === 'Y';
    const lowConf = row['Recommend Suppress'] === 'Y';
    const lv = lvTo100(row['Data Value']);
    if (lv != null) {
      rec.lv[idx] = notRel ? 0 : lv;
      rec.hasLv[idx] = 1;
      let m = 0;
      if (notRel) m |= 1;
      if (lowConf) m |= 2;
      rec.mask[idx] = m;
    }
  }
}

function ingestImRows(rows, elementIndex, socIndex) {
  for (const row of rows) {
    if (row['Scale ID'] !== 'IM') continue;
    const soc = row['O*NET-SOC Code'];
    const idx = elementIndex.get(row['Element ID']);
    if (idx == null || !soc || !socIndex.has(soc)) continue;
    socIndex.get(soc).im[idx] = imTo100(row['Data Value']);
  }
}

function imputeMissing(socList, socData) {
  const majorMedians = new Map();
  for (const soc of socList) {
    const major = socMajor(soc);
    if (!majorMedians.has(major)) majorMedians.set(major, []);
    majorMedians.get(major).push(socData.get(soc));
  }
  for (const [, recs] of majorMedians) {
    const med = new Float32Array(DIM_COUNT);
    for (let d = 0; d < DIM_COUNT; d++) {
      const vals = recs.filter((r) => r.hasLv[d]).map((r) => r.lv[d]).sort((a, b) => a - b);
      med[d] = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    }
    for (const rec of recs) {
      for (let d = 0; d < DIM_COUNT; d++) {
        if (!rec.hasLv[d]) {
          rec.lv[d] = med[d];
          rec.mask[d] |= 4; // imputed
          rec.hasLv[d] = 1;
        }
      }
    }
  }
}

function cosine(a, b, offsetA, offsetB) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < DIM_COUNT; i++) {
    const x = a[offsetA + i];
    const y = b[offsetB + i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function zoneBoundsFor(zone) {
  if (ZONE_GRID_LOOKUP.has(zone)) return ZONE_GRID_LOOKUP.get(zone);
  const fallback = ZONE_GRID_LOOKUP.get('business');
  return fallback;
}

function buildByZone(socList, careers) {
  const byZone = new Map();
  socList.forEach((soc) => {
    const zone = careers.find((c) => c.soc === soc)?.hubZone || 'business';
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone).push(soc);
  });
  return byZone;
}

function buildZoneCentroids(inScopeCareers, lvBuffer) {
  const byZone = new Map();
  inScopeCareers.forEach((c) => {
    if (!byZone.has(c.hubZone)) byZone.set(c.hubZone, []);
    byZone.get(c.hubZone).push(c);
  });
  const centroids = {};
  for (const [zone, list] of byZone) {
    const mean = new Float32Array(DIM_COUNT);
    list.forEach((c) => {
      const off = c.vectorIndex * DIM_COUNT;
      for (let d = 0; d < DIM_COUNT; d++) mean[d] += lvBuffer[off + d];
    });
    const n = list.length || 1;
    for (let d = 0; d < DIM_COUNT; d++) mean[d] /= n;
    centroids[zone] = Array.from(mean);
  }
  return centroids;
}

function buildZoneAggregateVectors(inScopeCareers, lvBuffer) {
  const byZone = new Map();
  inScopeCareers.forEach((c) => {
    if (!byZone.has(c.hubZone)) byZone.set(c.hubZone, []);
    byZone.get(c.hubZone).push(c);
  });
  const out = {};
  for (const [zone, list] of byZone) {
    const vectors = list.map((c) => {
      const off = c.vectorIndex * DIM_COUNT;
      return Array.from(lvBuffer.subarray(off, off + DIM_COUNT));
    });
    out[zone] = zoneAggregateEntry(vectors);
  }
  return out;
}

function packInScopeBuffers(inScopeCareers, socData) {
  const n = inScopeCareers.length;
  const lvBuffer = new Float32Array(n * DIM_COUNT);
  const imBuffer = new Float32Array(n * DIM_COUNT);
  const maskBuffer = new Uint16Array(n * DIM_COUNT);
  const socToIndex = new Map();
  inScopeCareers.forEach((c, i) => {
    c.vectorIndex = i;
    socToIndex.set(c.soc, i);
    const rec = socData.get(c.soc);
    lvBuffer.set(rec.lv, i * DIM_COUNT);
    imBuffer.set(rec.im, i * DIM_COUNT);
    maskBuffer.set(rec.mask, i * DIM_COUNT);
  });
  return { lvBuffer, imBuffer, maskBuffer, socToIndex };
}

function buildZoneLayoutArtifact(careers) {
  const zones = {};
  for (const [zone, bounds] of ZONE_GRID_LOOKUP) {
    const inZone = careers.filter((c) => c.hubZone === zone);
    let minX = bounds.minX;
    let maxX = bounds.maxX;
    let minY = bounds.minY;
    let maxY = bounds.maxY;
    if (inZone.length) {
      minX = Math.min(...inZone.map((c) => c.layoutX));
      maxX = Math.max(...inZone.map((c) => c.layoutX));
      minY = Math.min(...inZone.map((c) => c.layoutY));
      maxY = Math.max(...inZone.map((c) => c.layoutY));
    }
    zones[zone] = {
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
      labelX: bounds.labelX,
      labelY: bounds.labelY,
      careerMinX: Math.round(minX * 100) / 100,
      careerMaxX: Math.round(maxX * 100) / 100,
      careerMinY: Math.round(minY * 100) / 100,
      careerMaxY: Math.round(maxY * 100) / 100,
      count: inZone.length,
    };
  }
  return { worldW: WORLD_W, worldH: WORLD_H, zoneW: ZONE_W, zoneH: ZONE_H, gutter: GUTTER, zones };
}

function main() {
  const inputArg = process.argv.find((a, i) => process.argv[i - 1] === '--input');
  const inputDir = inputArg ? path.resolve(inputArg) : DEFAULT_INPUT;
  if (!fs.existsSync(inputDir)) {
    console.error(`Input not found: ${inputDir}. Run with downloaded O*NET text files.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const registry = buildRegistry(inputDir);
  const elementIndex = new Map(registry.dimensions.map((d) => [d.elementId, d.index]));

  const occRows = parseTsv(path.join(inputDir, 'Occupation Data.txt'));
  const socList = occRows.map((r) => r['O*NET-SOC Code']).filter(Boolean);
  const occMeta = new Map(occRows.map((r) => [r['O*NET-SOC Code'], r]));

  let jobZones = new Map();
  const jzPath = path.join(inputDir, 'Job Zones.txt');
  if (fs.existsSync(jzPath)) {
    for (const row of parseTsv(jzPath)) {
      const soc = row['O*NET-SOC Code'];
      const jz = parseInt(row['Job Zone'], 10);
      if (soc && Number.isFinite(jz)) jobZones.set(soc, jz);
    }
  }

  const socData = new Map();
  for (const { files } of DOMAIN_FILES) {
    for (const file of files) {
      ingestDomainRows(parseTsv(path.join(inputDir, file)), elementIndex, socData);
    }
  }
  for (const { files } of DOMAIN_FILES) {
    for (const file of files) {
      const imRows = parseTsv(path.join(inputDir, file)).filter((r) => r['Scale ID'] === 'IM');
      ingestImRows(imRows, elementIndex, socData);
    }
  }

  for (const soc of socList) {
    if (!socData.has(soc)) {
      socData.set(soc, {
        lv: new Float32Array(DIM_COUNT),
        im: new Float32Array(DIM_COUNT).fill(50),
        mask: new Uint16Array(DIM_COUNT),
        hasLv: new Uint8Array(DIM_COUNT),
      });
    }
  }
  imputeMissing(socList, socData);

  const nAll = socList.length;
  const allCareers = socList.map((soc, i) => {
    const rec = socData.get(soc);
    const meta = occMeta.get(soc) || {};
    const title = meta.Title || soc;
    const jobZone = jobZones.get(soc) || null;
    const hubZone = hubZoneForSoc(soc, title);
    const collar = classifyCareer(soc, title, hubZone, jobZone);
    return {
      soc,
      title,
      titleNorm: title.toLowerCase(),
      description: (meta.Description || '').slice(0, 500),
      socMajor: socMajor(soc),
      hubZone,
      jobZone,
      vectorIndex: i,
      hubFeatured: 0,
      collarCategory: collar.collarCategory,
      mvpInScope: collar.mvpInScope,
      exclusionReason: collar.exclusionReason,
      orbColor: null,
      aiDerived: false,
    };
  });

  const inScopeCareers = allCareers.filter((c) => c.mvpInScope);
  const excludedCareers = allCareers.filter((c) => !c.mvpInScope);
  console.log(`Collar filter: ${inScopeCareers.length} in MVP scope, ${excludedCareers.length} excluded`);

  const { lvBuffer, imBuffer, maskBuffer, socToIndex } = packInScopeBuffers(inScopeCareers, socData);
  const careers = inScopeCareers;
  const n = careers.length;
  const socOrder = careers.map((c) => c.soc);

  careers.forEach((c) => {
    c.orbColor = orbColorForZone(c.hubZone);
  });

  const byZone = buildByZone(socOrder, careers);
  console.log('Computing UMAP layout per zone...');
  const layout = computeUmapLayout(byZone, socData, ZONE_GRID_LOOKUP);
  careers.forEach((c) => {
    const bounds = zoneBoundsFor(c.hubZone);
    const pos = layout[c.soc] || { x: bounds.cx, y: bounds.cy, nx: 0.5, ny: 0.5 };
    c.layoutX = Math.round(pos.x * 100) / 100;
    c.layoutY = Math.round(pos.y * 100) / 100;
    c.layoutNX = Math.round((pos.nx != null ? pos.nx : 0.5) * 10000) / 10000;
    c.layoutNY = Math.round((pos.ny != null ? pos.ny : 0.5) * 10000) / 10000;
    c.orbColor = orbColorForZone(c.hubZone);
    c.aiDerived = false;
  });

  const usedPos = new Set();
  careers.forEach((c) => {
    const bounds = zoneBoundsFor(c.hubZone);
    const pad = 24;
    let key = `${c.layoutX.toFixed(2)},${c.layoutY.toFixed(2)}`;
    let nudge = 0;
    while (usedPos.has(key)) {
      nudge += 0.01;
      c.layoutX = Math.round((c.layoutX + 0.01) * 100) / 100;
      c.layoutY = Math.round((c.layoutY + 0.01) * 100) / 100;
      if (c.layoutX > bounds.maxX - pad) c.layoutX = bounds.minX + pad;
      if (c.layoutY > bounds.maxY - pad) c.layoutY = bounds.minY + pad;
      key = `${c.layoutX.toFixed(2)},${c.layoutY.toFixed(2)}`;
      if (nudge > 2) break;
    }
    usedPos.add(key);
  });

  const sectorLayout = computeSectorUmapLayout(byZone, socData);
  careers.forEach((c) => {
    const p = sectorLayout.positions[c.soc];
    if (p) {
      c.sectorX = p.sectorX;
      c.sectorY = p.sectorY;
      c.sectorNX = p.sectorNX;
      c.sectorNY = p.sectorNY;
    }
  });

  const zoneLayout = buildZoneLayoutArtifact(careers);
  zoneLayout.sectorCanvas = sectorLayout.sectorCanvas;

  const zoneCentroids = buildZoneCentroids(careers, lvBuffer);
  const zoneAggregateVectors = buildZoneAggregateVectors(careers, lvBuffer);
  const overridesPath = path.join(ROOT, 'data/onet/zone-dimension-profile-overrides.json');
  const profileOverrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : {};
  const zoneDimensionProfiles = buildZoneDimensionProfiles(zoneCentroids, registry, profileOverrides);

  console.log('Computing similarity top-%d (>= %s) for %d careers...', TOP_K_SIM, MIN_SIM_SCORE, n);
  const similarity = {};
  for (let i = 0; i < n; i++) {
    const soc = socOrder[i];
    const scores = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const score = cosine(lvBuffer, lvBuffer, i * DIM_COUNT, j * DIM_COUNT);
      if (score < MIN_SIM_SCORE) continue;
      scores.push({ soc: socOrder[j], score });
    }
    scores.sort((a, b) => b.score - a.score);
    similarity[soc] = scores.slice(0, TOP_K_SIM).map((s) => ({
      soc: s.soc,
      score: Math.round(s.score * 10000) / 10000,
    }));
  }

  const hubZoneMap = {};
  careers.forEach((c) => { hubZoneMap[c.soc] = c.hubZone; });

  fs.writeFileSync(path.join(ROOT, 'data/onet/dimension-registry-v1.json'), JSON.stringify(registry, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
    schemaId: SCHEMA_ID,
    onetRelease: '30.3',
    dimensionCount: DIM_COUNT,
    occupationCount: n,
    occupationCountTotal: nAll,
    excludedCount: excludedCareers.length,
    socOrder,
    builtAt: new Date().toISOString(),
  }, null, 2));
  // Descriptions ship separately: they are ~35% of careers.json bytes but are
  // only read on panel/deep-dive interaction, so the client fetches them off
  // the boot critical path (see onet-catalog.js loadCore vs load).
  fs.writeFileSync(path.join(OUT_DIR, 'careers.json'), JSON.stringify(careers.map(({ description, ...rest }) => rest)));
  fs.writeFileSync(path.join(OUT_DIR, 'career-descriptions.json'), JSON.stringify(Object.fromEntries(careers.map((c) => [c.soc, c.description || '']))));
  fs.writeFileSync(path.join(OUT_DIR, 'careers-excluded.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    count: excludedCareers.length,
    careers: excludedCareers.map((c) => ({
      soc: c.soc,
      title: c.title,
      hubZone: c.hubZone,
      socMajor: c.socMajor,
      collarCategory: c.collarCategory,
      exclusionReason: c.exclusionReason,
    })),
  }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'layout-2d.json'), JSON.stringify(
    Object.fromEntries(careers.map((c) => [c.soc, {
      x: c.layoutX,
      y: c.layoutY,
      nx: c.layoutNX,
      ny: c.layoutNY,
      hubZone: c.hubZone,
      orbColor: c.orbColor,
    }]))
  ));
  fs.writeFileSync(path.join(OUT_DIR, 'zone-colors.json'), JSON.stringify(ZONE_ORB_COLORS, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'hub-zone-map.json'), JSON.stringify(hubZoneMap));
  fs.writeFileSync(path.join(OUT_DIR, 'zone-layout.json'), JSON.stringify(zoneLayout, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'zone-centroids.json'), JSON.stringify(zoneCentroids, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'zone-dimension-profiles.json'), JSON.stringify(zoneDimensionProfiles, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'zone-aggregate-vectors.json'), JSON.stringify(zoneAggregateVectors, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'similarity-top8.json'), JSON.stringify(similarity));
  fs.writeFileSync(path.join(OUT_DIR, 'similarity-top50.json'), JSON.stringify(similarity));
  fs.writeFileSync(path.join(OUT_DIR, 'soc-index.json'), JSON.stringify(Object.fromEntries(socToIndex)));

  fs.writeFileSync(path.join(OUT_DIR, 'vectors-lv.f32.bin'), Buffer.from(lvBuffer.buffer));
  fs.writeFileSync(path.join(OUT_DIR, 'importance-im.f32.bin'), Buffer.from(imBuffer.buffer));
  fs.writeFileSync(path.join(OUT_DIR, 'masks.uint16.bin'), Buffer.from(maskBuffer.buffer));

  // Validation
  let bad = 0;
  for (let i = 0; i < lvBuffer.length; i++) {
    if (!Number.isFinite(lvBuffer[i]) || lvBuffer[i] < 0 || lvBuffer[i] > 100) bad++;
  }
  if (bad) throw new Error(`Invalid LV values: ${bad}`);

  const sw = socToIndex.get('15-1252.00');
  if (sw != null) {
    const sample = Array.from(lvBuffer.slice(sw * DIM_COUNT, sw * DIM_COUNT + 5));
    console.log('Sample Software Developers LV[0:5]:', sample.map((v) => v.toFixed(1)));
  }

  console.log(`Built ${n} in-scope careers (${excludedCareers.length} excluded of ${nAll}), ${DIM_COUNT} dimensions → ${OUT_DIR}`);
}

main();
