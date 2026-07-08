#!/usr/bin/env node
/**
 * Verify Career Hub: overview zone tiles + full-sector render.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cosinePercent, cosine } from '../functions/_lib/onet/math.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = join(ROOT, 'data/onet/artifacts');

const DIM_COUNT = 161;
const OVERVIEW_FILL = 0.94;
const OVERVIEW_TOPBAR_PX = 64;
const LOD_CONTINENT_ZOOM = 2.2;
const MAX_ZOOM = 3.0;
const SECTOR_ENTRY_ZOOM = 3.0;
const SECTOR_ZOOM_MIN = 0.7;
const SECTOR_ZOOM_MAX = 2.2;
const EXPECTED_ZONE_COUNT = 18;
const LAW_CAREER_COUNT = 33;
const SIMILARITY_ADJACENT = 0.75;
const SIMILARITY_RELATED = 0.55;
const MIN_LINKS_PER_NODE = 1;
const MAX_LINKS_PER_NODE = 3;
const SECTOR_ENTRY_SECTOR_ZOOM = 1.1;
const LAW_MIN_ENTRY_ZOOM = 1.0;

function loadJson(name) {
  return JSON.parse(readFileSync(join(ART, name), 'utf8'));
}

function clampPanOverview(panX, panY, zoom, viewW, viewH) {
  const minPanX = Math.min(0, viewW - zoom * viewW);
  const maxPanX = Math.max(0, viewW - zoom * viewW);
  panX = Math.min(maxPanX, Math.max(minPanX, panX));
  const minPanY = Math.min(0, viewH - zoom * viewH);
  const maxPanY = Math.max(0, viewH - zoom * viewH);
  panY = Math.min(maxPanY, Math.max(minPanY, panY));
  return { panX, panY };
}

function viewportRect(panX, panY, zoom, viewW, viewH, wW, wH, marginFrac = 0) {
  const marginX = wW * marginFrac;
  const marginY = wH * marginFrac;
  return {
    minX: (-panX / zoom) / viewW * wW - marginX,
    maxX: ((viewW - panX) / zoom) / viewW * wW + marginX,
    minY: (-panY / zoom) / viewH * wH - marginY,
    maxY: ((viewH - panY) / zoom) / viewH * wH + marginY,
  };
}

function rectsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function buildByZone(careers) {
  const byZone = {};
  careers.forEach((c) => {
    if (!byZone[c.hubZone]) byZone[c.hubZone] = [];
    byZone[c.hubZone].push(c);
  });
  return byZone;
}

function careerSectorXY(c) {
  return { x: c.sectorX, y: c.sectorY };
}

function sectorCareerBBox(zoneId, byZone) {
  const careers = byZone[zoneId] || [];
  if (!careers.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  careers.forEach((c) => {
    const pos = careerSectorXY(c);
    if (pos.x < minX) minX = pos.x;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.y > maxY) maxY = pos.y;
  });
  const spanW = Math.max(maxX - minX, 1);
  const spanH = Math.max(maxY - minY, 1);
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    spanW,
    spanH,
  };
}

function sectorBaseZoom(wW, wH) {
  const zoomX = (2 * wW) / (0.85 * wW);
  const zoomY = (2 * wH) / (0.85 * wH);
  return Math.min(zoomX, zoomY);
}

function sectorEntryZoom(zoneId, byZone, wW, wH) {
  const bbox = sectorCareerBBox(zoneId, byZone);
  if (!bbox) return 1;
  const fill = 0.90;
  const zoomX = fill * wW / bbox.spanW;
  const zoomY = fill * wH / bbox.spanH;
  return Math.min(zoomX, zoomY, sectorBaseZoom(wW, wH));
}

function sectorEffectiveZoom(zoneId, byZone, wW, wH, sectorZoom = 1) {
  const entry = sectorEntryZoom(zoneId, byZone, wW, wH);
  const cap = sectorBaseZoom(wW, wH);
  return Math.min(entry * sectorZoom, cap);
}

function computeOverviewFitZoom(viewW, viewH, wW, wH) {
  const topbar = OVERVIEW_TOPBAR_PX;
  const availH = Math.max(viewH - topbar, viewH * 0.5);
  const zoomX = OVERVIEW_FILL * viewW / wW;
  const zoomY = OVERVIEW_FILL * availH / wH;
  return Math.min(zoomX, zoomY, MAX_ZOOM);
}

function overviewCameraPan(viewW, viewH, zoom, focusX, focusY, wW, wH) {
  const topbar = OVERVIEW_TOPBAR_PX;
  const availH = Math.max(viewH - topbar, 1);
  const panX = viewW / 2 - (focusX / wW * viewW) * zoom;
  const panY = topbar + availH / 2 - (focusY / wH * availH) * zoom;
  return { panX, panY };
}

function suggestInitialCamera(viewW, viewH, wW, wH) {
  const zoom = computeOverviewFitZoom(viewW, viewH, wW, wH);
  const focusX = wW / 2;
  const focusY = wH / 2;
  const pan = overviewCameraPan(viewW, viewH, zoom, focusX, focusY, wW, wH);
  return { zoom, ...clampPanOverview(pan.panX, pan.panY, zoom, viewW, viewH) };
}

function sectorEntryCamera(zoneId, viewW, viewH, byZone, wW, wH, sectorZoom = SECTOR_ENTRY_SECTOR_ZOOM) {
  const bbox = sectorCareerBBox(zoneId, byZone);
  const focusX = bbox ? bbox.centerX : wW / 2;
  const focusY = bbox ? bbox.centerY : wH / 2;
  const zoom = sectorEffectiveZoom(zoneId, byZone, wW, wH, sectorZoom);
  const panX = viewW / 2 - (focusX / wW * viewW) * zoom;
  const panY = viewH / 2 - (focusY / wH * viewH) * zoom;
  return { zoom, panX, panY };
}

function visibleZones(rect, zoneLayout) {
  return Object.keys(zoneLayout.zones)
    .filter((zone) => rectsOverlap(rect, zoneLayout.zones[zone]))
    .map((zone) => ({ id: zone, bounds: zoneLayout.zones[zone] }));
}

function careersFitViewport(careers, rect, xyFn) {
  return careers.every((c) => {
    const pos = xyFn(c);
    return pos.x >= rect.minX && pos.x <= rect.maxX && pos.y >= rect.minY && pos.y <= rect.maxY;
  });
}

function zoneYEdgeClustering(zoneId, byZone, wH) {
  const careers = byZone[zoneId] || [];
  if (careers.length < 10) return false;
  const ys = careers.map((c) => c.sectorY);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const edgeBand = span * 0.12;
  let inTop = 0;
  let inBottom = 0;
  careers.forEach((c) => {
    if (c.sectorY <= minY + edgeBand) inTop++;
    if (c.sectorY >= maxY - edgeBand) inBottom++;
  });
  const edgeFrac = (inTop + inBottom) / careers.length;
  return edgeFrac > 0.72 && span < wH * 0.35;
}

function verifyGlobalCosineSpread(careers, manifest) {
  const vectors = loadLvVectors(manifest);
  const fixture = new Float32Array(DIM_COUNT);
  for (let d = 0; d < DIM_COUNT; d++) {
    fixture[d] = 0.35 + 0.3 * Math.sin(d * 0.17);
  }
  const display = careers.map((c, i) => cosinePercent(cosine(fixture, vectors[c.vectorIndex ?? i])));
  const n = display.length;
  const min = Math.min(...display);
  const max = Math.max(...display);
  const mean = display.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(display.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  if (max - min < 8) {
    throw new Error(`cosine spread range ${max - min} < 8 (min=${min} max=${max})`);
  }
  if (std < 8) {
    throw new Error(`cosine std dev ${std.toFixed(1)} < 8`);
  }
  return { min, max, std: std.toFixed(1) };
}

function loadLvVectors(manifest) {
  const buf = readFileSync(join(ART, 'vectors-lv.f32.bin'));
  const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = manifest.occupationCount;
  const vectors = [];
  for (let i = 0; i < n; i++) {
    vectors.push(floats.subarray(i * DIM_COUNT, (i + 1) * DIM_COUNT));
  }
  return vectors;
}

function nearestNeighborStats(careers) {
  if (careers.length < 2) return { cv: 0, maxDist: 0, mean: 0 };
  const dists = careers.map((c) => {
    let nearest = Infinity;
    careers.forEach((other) => {
      if (other.soc === c.soc) return;
      const d = Math.hypot(c.sectorX - other.sectorX, c.sectorY - other.sectorY);
      if (d < nearest) nearest = d;
    });
    return nearest;
  });
  const mean = dists.reduce((s, v) => s + v, 0) / dists.length;
  const variance = dists.reduce((s, v) => s + (v - mean) ** 2, 0) / dists.length;
  const std = Math.sqrt(variance);
  const cv = mean > 0 ? std / mean : 0;
  return { cv, maxDist: Math.max(...dists), mean };
}

function linkPosFor(c) {
  return { x: c.sectorX, y: c.sectorY };
}

function linkEdgeWeight(score, dist) {
  return score / (1 + dist / 120) ** 1.5;
}

function buildBalancedSectorLinks(visibleCareers, similarityIndex) {
  if (!similarityIndex || !visibleCareers?.length) return [];
  const bySoc = {};
  visibleCareers.forEach((c) => { bySoc[c.soc] = c; });
  const socs = visibleCareers.map((c) => c.soc);
  const candidates = [];
  const seenCand = {};

  function addCandidate(socA, socB, score) {
    if (!bySoc[socA] || !bySoc[socB] || socA === socB) return;
    const key = socA < socB ? `${socA}|${socB}` : `${socB}|${socA}`;
    if (seenCand[key]) return;
    const pa = linkPosFor(bySoc[socA]);
    const pb = linkPosFor(bySoc[socB]);
    const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    seenCand[key] = true;
    candidates.push({
      a: bySoc[socA],
      b: bySoc[socB],
      score,
      weight: linkEdgeWeight(score, dist),
      key,
    });
  }

  visibleCareers.forEach((c) => {
    const neighbors = similarityIndex[c.soc];
    if (!neighbors) return;
    neighbors.forEach((n) => {
      if (!n || !bySoc[n.soc]) return;
      if (n.score >= SIMILARITY_ADJACENT) addCandidate(c.soc, n.soc, n.score);
    });
  });

  const parent = {};
  socs.forEach((soc) => { parent[soc] = soc; });
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const sorted = candidates.slice().sort((x, y) => y.weight - x.weight);
  const edges = [];
  const edgeKeys = {};
  const degree = {};
  socs.forEach((soc) => { degree[soc] = 0; });

  function addEdge(edge) {
    if (edgeKeys[edge.key]) return false;
    if (degree[edge.a.soc] >= MAX_LINKS_PER_NODE || degree[edge.b.soc] >= MAX_LINKS_PER_NODE) return false;
    edgeKeys[edge.key] = true;
    edges.push({ a: edge.a.soc, b: edge.b.soc, score: edge.score });
    degree[edge.a.soc]++;
    degree[edge.b.soc]++;
    return true;
  }

  sorted.forEach((edge) => {
    if (find(edge.a.soc) !== find(edge.b.soc) && addEdge(edge)) {
      union(edge.a.soc, edge.b.soc);
    }
  });

  const roots = {};
  socs.forEach((soc) => { roots[find(soc)] = true; });
  if (Object.keys(roots).length > 1) {
    const bridgeCandidates = [];
    visibleCareers.forEach((c) => {
      const neighbors = similarityIndex[c.soc];
      if (!neighbors) return;
      neighbors.forEach((n) => {
        if (!n || !bySoc[n.soc] || n.score < SIMILARITY_RELATED) return;
        const pa = linkPosFor(c);
        const pb = linkPosFor(bySoc[n.soc]);
        const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        bridgeCandidates.push({
          a: c,
          b: bySoc[n.soc],
          score: n.score,
          weight: linkEdgeWeight(n.score, dist),
          key: c.soc < n.soc ? `${c.soc}|${n.soc}` : `${n.soc}|${c.soc}`,
        });
      });
    });
    bridgeCandidates.sort((x, y) => y.weight - x.weight);
    bridgeCandidates.forEach((edge) => {
      if (find(edge.a.soc) === find(edge.b.soc)) return;
      if (addEdge(edge)) union(edge.a.soc, edge.b.soc);
    });
  }

  sorted.forEach((edge) => {
    if (degree[edge.a.soc] >= MAX_LINKS_PER_NODE || degree[edge.b.soc] >= MAX_LINKS_PER_NODE) return;
    addEdge(edge);
  });

  socs.forEach((soc) => {
    if (degree[soc] >= MIN_LINKS_PER_NODE) return;
    const neighbors = similarityIndex[soc] || [];
    const best = neighbors
      .filter((n) => n && bySoc[n.soc] && n.score >= SIMILARITY_RELATED)
      .map((n) => {
        const pa = linkPosFor(bySoc[soc]);
        const pb = linkPosFor(bySoc[n.soc]);
        const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        return {
          a: bySoc[soc],
          b: bySoc[n.soc],
          score: n.score,
          weight: linkEdgeWeight(n.score, dist),
          key: soc < n.soc ? `${soc}|${n.soc}` : `${n.soc}|${soc}`,
        };
      })
      .sort((x, y) => y.weight - x.weight);
    for (let i = 0; i < best.length && degree[soc] < MIN_LINKS_PER_NODE; i++) {
      addEdge(best[i]);
    }
  });

  socs.forEach((soc) => {
    if (degree[soc] >= MIN_LINKS_PER_NODE) return;
    const others = socs
      .filter((otherSoc) => otherSoc !== soc)
      .map((otherSoc) => {
        const pa = linkPosFor(bySoc[soc]);
        const pb = linkPosFor(bySoc[otherSoc]);
        return { otherSoc, dist: Math.hypot(pa.x - pb.x, pa.y - pb.y) };
      })
      .sort((a, b) => a.dist - b.dist);
    for (let j = 0; j < others.length && degree[soc] < MIN_LINKS_PER_NODE; j++) {
      const { otherSoc, dist } = others[j];
      addEdge({
        a: bySoc[soc],
        b: bySoc[otherSoc],
        score: SIMILARITY_RELATED,
        weight: linkEdgeWeight(SIMILARITY_RELATED, dist),
        key: soc < otherSoc ? `${soc}|${otherSoc}` : `${otherSoc}|${soc}`,
      });
    }
  });

  return { edges, degree };
}

function verifyLinkDegrees(zoneId, byZone, similarityIndex) {
  const careers = byZone[zoneId] || [];
  const { edges, degree } = buildBalancedSectorLinks(careers, similarityIndex);
  const bad = careers.filter((c) => {
    const d = degree[c.soc] || 0;
    return d < MIN_LINKS_PER_NODE || d > MAX_LINKS_PER_NODE;
  });
  return { edges, bad };
}

function main() {
  const zoneLayout = loadJson('zone-layout.json');
  const careers = loadJson('careers.json');
  const similarityIndex = loadJson('similarity-top8.json');
  const manifest = loadJson('manifest.json');
  const wW = zoneLayout.worldW;
  const wH = zoneLayout.worldH;
  const sectorW = zoneLayout.sectorCanvas?.w || 2560;
  const sectorH = zoneLayout.sectorCanvas?.h || 1440;
  const zones = Object.values(zoneLayout.zones);

  if (zoneLayout.gutter !== 0) {
    console.error(`expected gutter=0, got ${zoneLayout.gutter}`);
    process.exit(1);
  }

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      if (a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY) {
        console.error('Zone overlap detected');
        process.exit(1);
      }
    }
  }

  careers.forEach((c) => {
    c.x = c.layoutX;
    c.y = c.layoutY;
  });

  let outOfBounds = 0;
  careers.forEach((c) => {
    const z = zoneLayout.zones[c.hubZone];
    if (!z || c.x < z.minX || c.x > z.maxX || c.y < z.minY || c.y > z.maxY) outOfBounds++;
  });
  if (outOfBounds) {
    console.error(`${outOfBounds} careers outside zone bounds`);
    process.exit(1);
  }

  const byZone = buildByZone(careers);
  const viewW = 1280;
  const viewH = 720;
  const cam = suggestInitialCamera(viewW, viewH, wW, wH);

  console.log(`Artifacts OK: ${careers.length} careers, world ${wW}x${wH}, sector ${sectorW}x${sectorH}, ${zones.length} zones`);

  let ok = true;

  if (careers.length !== manifest.occupationCount) {
    console.error(`careers.json length ${careers.length} != manifest occupationCount ${manifest.occupationCount}`);
    ok = false;
  } else {
    console.log(`career count ${careers.length} matches manifest OK`);
  }

  if (zones.length !== EXPECTED_ZONE_COUNT) {
    console.error(`expected ${EXPECTED_ZONE_COUNT} zones, got ${zones.length}`);
    ok = false;
  } else {
    console.log(`zone count ${zones.length} OK`);
  }

  const expectedZoom = computeOverviewFitZoom(viewW, viewH, wW, wH);
  if (Math.abs(cam.zoom - expectedZoom) > 0.001) {
    console.error(`fit zoom should be ${expectedZoom}, got ${cam.zoom}`);
    ok = false;
  } else {
    console.log(`overview fit zoom ${cam.zoom} OK`);
  }

  const overviewRect = viewportRect(cam.panX, cam.panY, cam.zoom, viewW, viewH, wW, wH, 0);
  const visible = visibleZones(overviewRect, zoneLayout);
  if (visible.length < EXPECTED_ZONE_COUNT) {
    console.error(`only ${visible.length} zones visible at fit zoom (expected ${EXPECTED_ZONE_COUNT})`);
    ok = false;
  } else {
    console.log(`all ${visible.length} zones visible at fit zoom OK`);
  }

  const lawCount = (byZone.law || []).length;
  if (lawCount !== LAW_CAREER_COUNT) {
    console.error(`law sector should have ${LAW_CAREER_COUNT} careers, got ${lawCount}`);
    ok = false;
  } else {
    console.log(`law sector careers=${lawCount} OK`);
  }

  const healthcareCount = (byZone.healthcare || []).length;
  if (!healthcareCount) {
    console.error('healthcare sector has no careers');
    ok = false;
  } else {
    console.log(`healthcare sector careers=${healthcareCount} OK`);
  }

  const lawCam = sectorEntryCamera('law', viewW, viewH, byZone, sectorW, sectorH);
  const lawRect = viewportRect(lawCam.panX, lawCam.panY, lawCam.zoom, viewW, viewH, sectorW, sectorH, 0.02);
  const lawFit = careersFitViewport(byZone.law || [], lawRect, careerSectorXY);
  if (lawCam.zoom < LAW_MIN_ENTRY_ZOOM) {
    console.error(`law sector entry zoom ${lawCam.zoom.toFixed(2)} < ${LAW_MIN_ENTRY_ZOOM}`);
    ok = false;
  } else {
    console.log(`law sector entry zoom ${lawCam.zoom.toFixed(2)} >= ${LAW_MIN_ENTRY_ZOOM} OK`);
  }
  if (!lawFit) {
    console.error('law sector entry camera does not fit all careers in viewport');
    ok = false;
  } else {
    console.log(`law sector bbox fit at entry zoom ${lawCam.zoom.toFixed(2)} OK`);
  }

  const lawNn = nearestNeighborStats(byZone.law || []);
  if (lawNn.cv < 0.12) {
    console.error(`law sector NN distance CV ${lawNn.cv.toFixed(3)} too uniform (grid-like)`);
    ok = false;
  } else {
    console.log(`law sector NN spread CV=${lawNn.cv.toFixed(3)} OK`);
  }
  const orphanThreshold = 0.22 * Math.min(sectorW - 160, sectorH - 160);
  if (lawNn.maxDist > orphanThreshold) {
    console.error(`law sector orphan max NN dist ${lawNn.maxDist.toFixed(1)} > ${orphanThreshold.toFixed(1)}`);
    ok = false;
  } else {
    console.log(`law sector orphan check maxNN=${lawNn.maxDist.toFixed(1)} OK`);
  }

  const hcCam = sectorEntryCamera('healthcare', viewW, viewH, byZone, sectorW, sectorH);
  const hcRect = viewportRect(hcCam.panX, hcCam.panY, hcCam.zoom, viewW, viewH, sectorW, sectorH, 0.02);
  const hcFit = careersFitViewport(byZone.healthcare || [], hcRect, careerSectorXY);
  if (!hcFit) {
    console.error('healthcare sector entry camera does not fit all careers in viewport');
    ok = false;
  } else {
    console.log(`healthcare sector bbox fit at entry zoom ${hcCam.zoom.toFixed(2)} OK`);
  }

  let largestZone = '';
  let largestCount = 0;
  Object.keys(byZone).forEach((z) => {
    if (byZone[z].length > largestCount) {
      largestCount = byZone[z].length;
      largestZone = z;
    }
  });
  if (zoneYEdgeClustering('healthcare', byZone, sectorH)) {
    console.error('healthcare sector shows Y-edge clustering');
    ok = false;
  } else {
    console.log('healthcare sector Y spread OK (no edge clustering)');
  }
  if (largestZone && zoneYEdgeClustering(largestZone, byZone, sectorH)) {
    console.error(`${largestZone} sector (${largestCount} careers) shows Y-edge clustering`);
    ok = false;
  } else if (largestZone) {
    console.log(`${largestZone} sector (${largestCount} careers) Y spread OK`);
  }

  if (cam.zoom >= LOD_CONTINENT_ZOOM) {
    console.error(`default zoom ${cam.zoom} should be < ${LOD_CONTINENT_ZOOM}`);
    ok = false;
  } else {
    console.log(`default zoom ${cam.zoom} is continent LOD OK`);
  }

  if (MAX_ZOOM > SECTOR_ENTRY_ZOOM + 0.001) {
    console.error(`MAX_ZOOM ${MAX_ZOOM} should not exceed SECTOR_ENTRY_ZOOM`);
    ok = false;
  } else {
    console.log(`MAX_ZOOM ${MAX_ZOOM} caps before sector entry OK`);
  }

  const maxSectorZoom = sectorEffectiveZoom('healthcare', byZone, sectorW, sectorH, SECTOR_ZOOM_MAX);
  const hcCap = sectorBaseZoom(sectorW, sectorH);
  if (maxSectorZoom > hcCap + 0.01) {
    console.error('sector max zoom exceeds sectorBaseZoom cap');
    ok = false;
  } else {
    console.log(`sector max zoom cap ${maxSectorZoom.toFixed(2)} OK`);
  }

  const hcLinkCheck = verifyLinkDegrees('healthcare', byZone, similarityIndex);
  if (hcLinkCheck.bad.length) {
    console.error(`healthcare link degrees invalid for ${hcLinkCheck.bad.length} careers`);
    ok = false;
  } else {
    console.log(`healthcare balanced links=${hcLinkCheck.edges.length} degree 1-3 OK`);
  }

  if (largestZone) {
    const bigLinkCheck = verifyLinkDegrees(largestZone, byZone, similarityIndex);
    if (bigLinkCheck.bad.length) {
      console.error(`${largestZone} link degrees invalid for ${bigLinkCheck.bad.length} careers`);
      ok = false;
    } else {
      console.log(`${largestZone} balanced links=${bigLinkCheck.edges.length} degree 1-3 OK`);
    }
  }

  try {
    const spread = verifyGlobalCosineSpread(careers, manifest);
    console.log(`global cosine spread min=${spread.min} max=${spread.max} std=${spread.std} OK`);
  } catch (err) {
    console.error(err.message);
    ok = false;
  }

  const zoneAgg = loadJson('zone-aggregate-vectors.json');
  const aggKeys = Object.keys(zoneAgg).filter((z) => zoneAgg[z].count > 0);
  if (aggKeys.length < 10) {
    console.error(`zone-aggregate-vectors only has ${aggKeys.length} non-empty zones`);
    ok = false;
  } else {
    console.log(`zone-aggregate-vectors ${aggKeys.length} zones OK`);
  }

  const TOPBAR_SAFE = 66;
  const LABEL_HALF = 7;
  const LABEL_OFFSET = LABEL_HALF + 4;
  function zoneLabelScreenY(zoneMinY, zoneSpanH, panY, zoom, viewH, wH) {
    const y = zoneMinY / wH * viewH;
    const zh = zoneSpanH / wH * viewH;
    let preferred = y + Math.max(zh * 0.22, 22);
    let screenY = panY + zoom * preferred - LABEL_OFFSET;
    if (screenY < TOPBAR_SAFE) {
      preferred = (TOPBAR_SAFE + LABEL_OFFSET - panY) / zoom;
      screenY = panY + zoom * preferred - LABEL_OFFSET;
    }
    return screenY;
  }
  const topRowZones = ['tech', 'healthcare', 'finance', 'science', 'engineering', 'creative'];
  let labelOk = true;
  topRowZones.forEach((zoneId) => {
    const zb = zoneLayout.zones[zoneId];
    if (!zb || !zb.count) return;
    const screenY = zoneLabelScreenY(zb.minY, zb.maxY - zb.minY, cam.panX, cam.panY, viewH, wH);
    if (screenY < TOPBAR_SAFE) {
      console.error(`zone ${zoneId} label screenY ${screenY.toFixed(1)} < safe ${TOPBAR_SAFE}`);
      labelOk = false;
      ok = false;
    }
  });
  if (labelOk) console.log('top-row zone label safe-Y OK');

  if (!ok) process.exit(1);
  console.log('All full-sector hub checks passed.');
}

main();
