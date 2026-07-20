#!/usr/bin/env node
/**
 * Post-ship macro-hub redesign (docs/POST_SHIP_FIX_PLAN.md-adjacent feature,
 * approved plan: "Macro Career Hub Redesign — Organic Continuous-Zoom Map").
 *
 * Dissolves Agriculture/Operations/Hospitality (careers reassigned
 * individually, see REASSIGN below) and merges Engineering+Science+
 * Cybersecurity and Creative+Marketing+Media into combined macro-sectors —
 * 18 hub zones -> 11, every career orb preserved. Regenerates the hub's
 * overview-tier and sector-dive-tier per-career layout around the new
 * taxonomy, and a fresh organic (non-grid) macro-cluster placement seeded by
 * real zone-to-zone vector similarity.
 *
 * SCOPE BOUNDARY (do not widen): only career.hubZone/orbColor and the layout-
 * and sector-prefixed position fields in careers.json, plus hub-zone-map.json,
 * layout-2d.json, zone-layout.json,
 * zone-colors.json are mutated. zone-centroids.json and
 * zone-aggregate-vectors.json are read-only inputs here and are NEVER
 * rewritten — FWOnetVectors.hydrateQuizVectors / quiz personality-vector
 * seeding depend on their original 18-zone keys staying exactly as they are.
 * This script does not touch O*NET ingestion (build.mjs) at all; it operates
 * as a downstream pass over the already-built careers.json.
 *
 * Usage: node scripts/onet-etl/rezone-hub.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UMAP } from 'umap-js';
import { computeUmapLayout, ZONE_ORB_COLORS as OLD_ZONE_COLORS } from './layout-umap.mjs';
import { computeSectorUmapLayout } from './sector-preset-layout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'data/onet/artifacts');
const DIM_COUNT = 161;

// ---- Individual career reassignments (Agriculture/Operations/Hospitality dissolved) ----
const REASSIGN = {
  // Agriculture (20 careers)
  '17-2021.00': 'engineering-science', // Agricultural Engineers
  '25-9021.00': 'education',           // Farm and Home Management Educators
  '13-1021.00': 'business',            // Buyers and Purchasing Agents, Farm Products
  '13-1023.00': 'business',            // Purchasing Agents, Except Wholesale, Retail, and Farm Products
  '13-1022.00': 'business',            // Wholesale and Retail Buyers, Except Farm Products
  '45-2091.00': 'trades',              // Agricultural Equipment Operators
  '45-2011.00': 'trades',              // Agricultural Inspectors
  '19-4012.00': 'trades',              // Agricultural Technicians
  '45-2099.00': 'trades',              // Agricultural Workers, All Other
  '45-2021.00': 'trades',              // Animal Breeders
  '45-4021.00': 'trades',              // Fallers
  '11-9013.00': 'trades',              // Farmers, Ranchers, and Other Agricultural Managers
  '45-1011.00': 'trades',              // First-Line Supervisors of Farming, Fishing, and Forestry Workers
  '45-3031.00': 'trades',              // Fishing and Hunting Workers
  '45-4011.00': 'trades',              // Forest and Conservation Workers
  '45-2041.00': 'trades',              // Graders and Sorters, Agricultural Products
  '45-4023.00': 'trades',              // Log Graders and Scalers
  '45-4022.00': 'trades',              // Logging Equipment Operators
  '45-4029.00': 'trades',              // Logging Workers, All Other
  '19-4012.01': 'trades',              // Precision Agriculture Technicians
  // Operations (5 careers) -> Trades (facilities/grounds/pest-control, not office ops)
  '37-2019.00': 'trades',              // Building Cleaning Workers, All Other
  '37-3019.00': 'trades',              // Grounds Maintenance Workers, All Other
  '37-2021.00': 'trades',              // Pest Control Workers
  '37-3012.00': 'trades',              // Pesticide Handlers, Sprayers, and Applicators, Vegetation
  '37-3013.00': 'trades',              // Tree Trimmers and Pruners
  // Hospitality (6 careers) -> Trades (culinary craft) / Social (guest-facing)
  '35-1011.00': 'trades',              // Chefs and Head Cooks
  '35-2014.00': 'trades',              // Cooks, Restaurant
  '39-6012.00': 'social',              // Concierges
  '35-3041.00': 'social',              // Food Servers, Nonrestaurant
  '35-9031.00': 'social',              // Hosts and Hostesses, Restaurant, Lounge, and Coffee Shop
  '43-4081.00': 'social',              // Hotel, Motel, and Resort Desk Clerks
};
const EXPECTED_REASSIGN_COUNT = 31;

// ---- Zone merges (Engineering+Science+Cybersecurity, Creative+Marketing+Media, Business+Finance) ----
const MERGE_INTO = {
  engineering: 'engineering-science', science: 'engineering-science', cybersecurity: 'engineering-science',
  creative: 'creative-media', marketing: 'creative-media', media: 'creative-media',
  business: 'business-finance', finance: 'business-finance',
};

const ZONE_LABELS = {
  tech: 'Tech', healthcare: 'Healthcare',
  'engineering-science': 'Engineering & Science', 'creative-media': 'Creative & Media',
  'business-finance': 'Business & Finance', education: 'Education', law: 'Law', social: 'Social',
  government: 'Government', trades: 'Trades',
};
const EXPECTED_ZONES = Object.keys(ZONE_LABELS); // 10
const DEAD_ZONES = ['agriculture', 'operations', 'hospitality', 'engineering', 'science', 'cybersecurity', 'creative', 'marketing', 'media', 'business', 'finance'];

// New macro-group colors reuse an existing constituent zone's color rather than designing new ones.
const ZONE_COLORS = { ...OLD_ZONE_COLORS };
DEAD_ZONES.forEach((z) => { delete ZONE_COLORS[z]; });
ZONE_COLORS['engineering-science'] = OLD_ZONE_COLORS.engineering;
ZONE_COLORS['creative-media'] = OLD_ZONE_COLORS.creative;
ZONE_COLORS['business-finance'] = OLD_ZONE_COLORS.finance; // finance's hue reads stronger than business's

function newHubZoneFor(career) {
  // REASSIGN targets are written in constituent-zone terms (e.g. 'business'),
  // so they must ALSO pass through MERGE_INTO — otherwise a reassigned career
  // resurrects a dead zone id after that zone is merged away.
  const z = REASSIGN[career.soc] || career.hubZone;
  return MERGE_INTO[z] || z;
}

function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8')); }
function writeMinified(name, data) { fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data)); }
function writePretty(name, data) { fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2)); }

function main() {
  const careers = loadJson('careers.json');
  const zoneAggregates = loadJson('zone-aggregate-vectors.json'); // read-only, never rewritten
  const totalBefore = careers.length;

  // ---- Reassign hubZone + recolor every career ----
  const zoneCounts = {};
  careers.forEach((c) => {
    const nz = newHubZoneFor(c);
    c.hubZone = nz;
    c.orbColor = ZONE_COLORS[nz] || ZONE_COLORS['business-finance'];
    zoneCounts[nz] = (zoneCounts[nz] || 0) + 1;
  });

  // ---- Safety assertions before writing anything ----
  const reassignedCount = Object.keys(REASSIGN).length;
  if (reassignedCount !== EXPECTED_REASSIGN_COUNT) {
    throw new Error(`REASSIGN table has ${reassignedCount} entries, expected ${EXPECTED_REASSIGN_COUNT}`);
  }
  if (careers.length !== totalBefore) {
    throw new Error(`career count changed: ${totalBefore} -> ${careers.length}`);
  }
  const gotZones = Object.keys(zoneCounts).sort().join(',');
  const wantZones = EXPECTED_ZONES.slice().sort().join(',');
  if (gotZones !== wantZones) {
    throw new Error(`zone set mismatch.\n  got:  ${gotZones}\n  want: ${wantZones}`);
  }
  DEAD_ZONES.forEach((z) => {
    if (zoneCounts[z]) throw new Error(`dead zone id "${z}" still present after reassignment (${zoneCounts[z]} careers)`);
  });
  console.log('New zone counts:', zoneCounts);
  console.log(`Total careers: ${totalBefore} (unchanged)`);

  // ---- Load raw 161-dim vectors for UMAP (career-level; this file is unchanged) ----
  const lvBuf = new Float32Array(
    fs.readFileSync(path.join(OUT_DIR, 'vectors-lv.f32.bin')).buffer,
  );
  const socData = new Map();
  careers.forEach((c) => {
    if (c.vectorIndex == null) return;
    socData.set(c.soc, { lv: lvBuf.subarray(c.vectorIndex * DIM_COUNT, (c.vectorIndex + 1) * DIM_COUNT) });
  });

  // ---- Macro-group placement: aggregate vector per new zone -> UMAP to 2D -> circle-pack ----
  // Merged zones average their constituents' EXISTING (untouched) aggregate
  // vectors, weighted by original count; singleton zones reuse their own
  // vector as-is. Neither reads nor needs the post-reassignment membership —
  // this is a display-only similarity signal, not the real vector taxonomy.
  const zoneVec = {};
  for (const zoneId of EXPECTED_ZONES) {
    const constituents = Object.keys(MERGE_INTO).filter((k) => MERGE_INTO[k] === zoneId);
    if (constituents.length) {
      const acc = new Float64Array(DIM_COUNT);
      let totalN = 0;
      constituents.forEach((oldZone) => {
        const agg = zoneAggregates[oldZone];
        if (!agg) return;
        const n = agg.count || 0;
        totalN += n;
        agg.lvMean.forEach((v, d) => { acc[d] += v * n; });
      });
      zoneVec[zoneId] = totalN ? Array.from(acc, (v) => v / totalN) : new Array(DIM_COUNT).fill(0);
    } else {
      const agg = zoneAggregates[zoneId];
      zoneVec[zoneId] = agg ? agg.lvMean.slice() : new Array(DIM_COUNT).fill(0);
    }
  }

  const macroUmap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(10, EXPECTED_ZONES.length - 1),
    randomState: 42,
    minDist: 0.4,
    spread: 1.3,
  });
  const embedding = macroUmap.fit(EXPECTED_ZONES.map((z) => zoneVec[z]));

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  embedding.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  // Sized generously (not just fit-to-content) so 11 circles of very different
  // radii can spread out with real breathing room instead of packing tight —
  // "spread out across the hub map" implies a map bigger than the viewport,
  // meant to be panned, not squeezed to a minimum bounding box.
  const WORLD_W = 4200;
  const WORLD_H = 2500;
  const WORLD_PAD = 260;
  const innerW = WORLD_W - WORLD_PAD * 2;
  const innerH = WORLD_H - WORLD_PAD * 2;
  const RADIUS_MIN = 150;
  const RADIUS_MAX = 380;
  const countValues = EXPECTED_ZONES.map((z) => zoneCounts[z] || 1);
  const maxCount = Math.max(...countValues);
  const minCount = Math.min(...countValues);
  function radiusFor(n) {
    if (maxCount === minCount) return (RADIUS_MIN + RADIUS_MAX) / 2;
    const t = (Math.sqrt(n) - Math.sqrt(minCount)) / (Math.sqrt(maxCount) - Math.sqrt(minCount));
    return RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN);
  }

  const circles = EXPECTED_ZONES.map((z, i) => {
    const [ex, ey] = embedding[i];
    const nx = (ex - minX) / spanX;
    const ny = (ey - minY) / spanY;
    return {
      id: z,
      x: WORLD_PAD + nx * innerW,
      y: WORLD_PAD + ny * innerH,
      r: radiusFor(zoneCounts[z] || 1),
    };
  });

  // Iterative pairwise repulsion so clusters never overlap regardless of the
  // raw UMAP spacing — same push-apart recipe as spreadCareersInZone, applied
  // to differently-sized circles instead of fixed-radius points. Runs to
  // convergence (capped) rather than a fixed count. Overlap is measured AFTER
  // the boundary clamp, in its own pass — clamping can reintroduce overlap
  // the repulsion step just resolved, and that must be what the exit
  // condition sees, not the pre-clamp snapshot.
  const CLUSTER_GAP = 80; // room for the neighbor-link web to read clearly between clusters
  function measureMaxOverlap() {
    let worst = 0;
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i]; const b = circles[j];
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 0.001;
        const over = (a.r + b.r + CLUSTER_GAP) - dist;
        if (over > worst) worst = over;
      }
    }
    return worst;
  }
  // ---- Bridge chain: Business & Finance ↔ Tech ↔ Engineering & Science ----
  // Tech is the vector bridge between the two; UMAP often but not always
  // places it between them. Make it deterministic: place the three centroids
  // collinear with tech in the middle at exactly the same spacing every other
  // adjacent pair gets (r+r+CLUSTER_GAP), anchored at the trio's own UMAP
  // centroid and oriented along the UMAP-given B&F→E&S direction so the
  // arrangement stays as organic as the constraint allows. The trio is then
  // PINNED through the repulsion pass: neighbors make room around the chain
  // instead of dissolving it. (Seeding the UMAP init was rejected: umap-js
  // exposes no per-point init here, and a seeded init still wouldn't
  // guarantee post-optimization adjacency.)
  const BRIDGE_CHAIN = ['business-finance', 'tech', 'engineering-science'];
  const chain = BRIDGE_CHAIN.map((id) => circles.find((c) => c.id === id));
  const pinned = new Set(chain.every(Boolean) ? BRIDGE_CHAIN : []);
  if (chain.every(Boolean)) {
    const [bf, tech, es] = chain;
    let ux = es.x - bf.x;
    let uy = es.y - bf.y;
    const ulen = Math.hypot(ux, uy);
    if (ulen < 1e-6) { ux = 1; uy = 0; } else { ux /= ulen; uy /= ulen; }
    const anchorX = (bf.x + tech.x + es.x) / 3;
    const anchorY = (bf.y + tech.y + es.y) / 3;
    const dBf = tech.r + bf.r + CLUSTER_GAP;
    const dEs = tech.r + es.r + CLUSTER_GAP;
    tech.x = anchorX; tech.y = anchorY;
    bf.x = anchorX - ux * dBf; bf.y = anchorY - uy * dBf;
    es.x = anchorX + ux * dEs; es.y = anchorY + uy * dEs;
    // Group-shift the whole chain inside the padded world (rigidly, so the
    // spacing survives) — pinned circles never receive the per-circle clamp.
    let sx = 0; let sy = 0;
    chain.forEach((c) => {
      sx = Math.max(sx, WORLD_PAD + c.r - c.x);
      sy = Math.max(sy, WORLD_PAD + c.r - c.y);
    });
    chain.forEach((c) => { c.x += sx; c.y += sy; });
    sx = 0; sy = 0;
    chain.forEach((c) => {
      sx = Math.min(sx, WORLD_W - WORLD_PAD - c.r - c.x);
      sy = Math.min(sy, WORLD_H - WORLD_PAD - c.r - c.y);
    });
    chain.forEach((c) => { c.x += sx; c.y += sy; });
  }

  let maxOverlap = measureMaxOverlap();
  let iter = 0;
  while (iter < 4000 && maxOverlap > 0.5) {
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i]; const b = circles[j];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = a.r + b.r + CLUSTER_GAP;
        if (dist < minDist) {
          const aPin = pinned.has(a.id);
          const bPin = pinned.has(b.id);
          // Both pinned: chain spacing is exact by construction — leave it.
          if (aPin && bPin) continue;
          const push = ((minDist - dist) / dist) * 0.5;
          // A pinned circle transfers its share of the push to its partner.
          if (aPin) { b.x += dx * push * 2; b.y += dy * push * 2; }
          else if (bPin) { a.x -= dx * push * 2; a.y -= dy * push * 2; }
          else {
            a.x -= dx * push; a.y -= dy * push;
            b.x += dx * push; b.y += dy * push;
          }
        }
      }
    }
    circles.forEach((c) => {
      if (pinned.has(c.id)) return; // in-bounds by construction; clamping would break the chain
      c.x = Math.min(WORLD_W - WORLD_PAD - c.r, Math.max(WORLD_PAD + c.r, c.x));
      c.y = Math.min(WORLD_H - WORLD_PAD - c.r, Math.max(WORLD_PAD + c.r, c.y));
    });
    maxOverlap = measureMaxOverlap();
    iter += 1;
  }
  if (pinned.size) {
    const trioLog = BRIDGE_CHAIN.map((id) => {
      const c = circles.find((x) => x.id === id);
      return `${id}@(${Math.round(c.x)},${Math.round(c.y)}) r${Math.round(c.r)}`;
    }).join('  ');
    console.log('Bridge chain pinned: ' + trioLog);
  }
  console.log(`Circle-pack: ${iter} iterations, final max overlap ${maxOverlap.toFixed(2)}px`);
  if (maxOverlap > 0.5) throw new Error(`circle-pack did not converge (residual overlap ${maxOverlap.toFixed(1)}px) — widen WORLD_W/H or lower RADIUS_MAX`);

  const zoneBoundsLookup = new Map();
  const zoneLayoutZones = {};
  circles.forEach((c) => {
    const bounds = {
      minX: c.x - c.r, maxX: c.x + c.r, minY: c.y - c.r, maxY: c.y + c.r,
      cx: c.x, cy: c.y, labelX: c.x, labelY: c.y - c.r - 18,
    };
    zoneBoundsLookup.set(c.id, bounds);
    zoneLayoutZones[c.id] = { ...bounds, r: c.r, count: zoneCounts[c.id] || 0, label: ZONE_LABELS[c.id] };
  });

  // ---- Overview-tier per-career layout: reuse computeUmapLayout, unchanged ----
  const byZoneOverview = new Map();
  careers.forEach((c) => {
    if (!byZoneOverview.has(c.hubZone)) byZoneOverview.set(c.hubZone, []);
    byZoneOverview.get(c.hubZone).push(c.soc);
  });
  const overviewLayout = computeUmapLayout(byZoneOverview, socData, zoneBoundsLookup);
  careers.forEach((c) => {
    const pos = overviewLayout[c.soc];
    if (!pos) return;
    c.layoutX = Math.round(pos.x * 100) / 100;
    c.layoutY = Math.round(pos.y * 100) / 100;
    c.layoutNX = Math.round(pos.nx * 10000) / 10000;
    c.layoutNY = Math.round(pos.ny * 10000) / 10000;
  });

  // ---- Sector-dive-tier per-career layout: reuse computeSectorUmapLayout, unchanged ----
  const byZoneSector = new Map();
  careers.forEach((c) => {
    if (!byZoneSector.has(c.hubZone)) byZoneSector.set(c.hubZone, []);
    byZoneSector.get(c.hubZone).push(c.soc);
  });
  const { positions: sectorPositions, sectorCanvas } = computeSectorUmapLayout(byZoneSector, socData);
  careers.forEach((c) => {
    const pos = sectorPositions[c.soc];
    if (pos) Object.assign(c, pos); // sectorX, sectorY, sectorNX, sectorNY
  });

  // ---- Write artifacts (scope boundary: nothing else touched) ----
  writeMinified('careers.json', careers);

  const hubZoneMap = {};
  careers.forEach((c) => { hubZoneMap[c.soc] = c.hubZone; });
  writeMinified('hub-zone-map.json', hubZoneMap);

  const layout2d = {};
  careers.forEach((c) => {
    layout2d[c.soc] = { x: c.layoutX, y: c.layoutY, nx: c.layoutNX, ny: c.layoutNY, hubZone: c.hubZone, orbColor: c.orbColor };
  });
  writeMinified('layout-2d.json', layout2d);

  writePretty('zone-colors.json', ZONE_COLORS);
  writePretty('zone-layout.json', { worldW: WORLD_W, worldH: WORLD_H, sectorCanvas, zones: zoneLayoutZones });

  console.log(`rezone-hub complete. ${Object.keys(zoneLayoutZones).length} macro-zones, ${careers.length} careers.`);
}

main();
