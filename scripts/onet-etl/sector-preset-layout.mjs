/**
 * Per-zone sector-local layout (~4× reference viewport area).
 * UMAP + k-means clusters for organic grouping; spread pass prevents overlap.
 */
import { UMAP } from 'umap-js';
import { spreadCareersInZone } from './layout-umap.mjs';

export const REF_VIEW_W = 1280;
export const REF_VIEW_H = 720;
export const SECTOR_W = REF_VIEW_W * 2;
export const SECTOR_H = REF_VIEW_H * 2;
export const SECTOR_MARGIN = 80;
export const MIN_ORB_GAP = 44;

function clampSector(x, y, margin, innerW, innerH) {
  return {
    x: Math.min(margin + innerW, Math.max(margin, x)),
    y: Math.min(margin + innerH, Math.max(margin, y)),
  };
}

function clusterCount(n) {
  if (n < 4) return 1;
  return Math.max(2, Math.min(5, Math.round(Math.sqrt(n / 6))));
}

function kMeans2D(embedding, k, iterations = 28) {
  const n = embedding.length;
  if (k <= 1 || n <= 1) return embedding.map(() => 0);

  const centroids = [embedding[0].slice()];
  for (let c = 1; c < k; c++) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (const cen of centroids) {
        const d = Math.hypot(embedding[i][0] - cen[0], embedding[i][1] - cen[1]);
        if (d < minD) minD = d;
      }
      if (minD > bestDist) {
        bestDist = minD;
        bestIdx = i;
      }
    }
    centroids.push(embedding[bestIdx].slice());
  }

  const labels = new Array(n).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = Math.hypot(embedding[i][0] - centroids[c][0], embedding[i][1] - centroids[c][1]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      labels[i] = best;
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const l = labels[i];
      sums[l][0] += embedding[i][0];
      sums[l][1] += embedding[i][1];
      sums[l][2] += 1;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][2] > 0) {
        centroids[c][0] = sums[c][0] / sums[c][2];
        centroids[c][1] = sums[c][1] / sums[c][2];
      }
    }
  }
  return labels;
}

function runZoneUmap(socs, socData) {
  const vectors = socs.map((soc) => Array.from(socData.get(soc).lv));
  const nNeighbors = Math.min(15, Math.max(2, socs.length - 1));
  const umapOpts = {
    nComponents: 2,
    nNeighbors,
    randomState: 42,
  };
  if (socs.length >= 10) {
    umapOpts.minDist = 0.55;
    umapOpts.spread = 1.35;
  } else {
    umapOpts.minDist = 0.45;
    umapOpts.spread = 1.15;
  }
  const umap = new UMAP(umapOpts);
  return umap.fit(vectors);
}

function clusterCenters(k, cx, cy, radius) {
  const centers = [];
  for (let i = 0; i < k; i++) {
    const ang = (2 * Math.PI * i) / k - Math.PI / 2;
    centers.push({
      x: cx + Math.cos(ang) * radius,
      y: cy + Math.sin(ang) * radius,
    });
  }
  return centers;
}

function normalizeClusterEmbedding(embedding, labels, k) {
  const ranges = [];
  for (let c = 0; c < k; c++) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    embedding.forEach((pt, i) => {
      if (labels[i] !== c) return;
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    });
    ranges.push({
      minX,
      maxX,
      minY,
      maxY,
      rangeX: Math.max(maxX - minX, 1e-6),
      rangeY: Math.max(maxY - minY, 1e-6),
    });
  }
  return ranges;
}

function spreadSectorOrphans(socs, positions, margin, innerW, innerH) {
  const maxNN = 0.22 * Math.min(innerW, innerH);
  const bounds = {
    minX: margin,
    maxX: margin + innerW,
    minY: margin,
    maxY: margin + innerH,
  };

  for (let pass = 0; pass < 2; pass++) {
    socs.forEach((soc) => {
      const p = positions[soc];
      let nearest = Infinity;
      let nearestSoc = null;
      socs.forEach((other) => {
        if (other === soc) return;
        const op = positions[other];
        const d = Math.hypot(p.x - op.x, p.y - op.y);
        if (d < nearest) {
          nearest = d;
          nearestSoc = other;
        }
      });
      if (nearestSoc && nearest > maxNN) {
        const op = positions[nearestSoc];
        const dx = op.x - p.x;
        const dy = op.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const pull = (nearest - maxNN * 0.85) * 0.45;
        p.x += (dx / d) * pull;
        p.y += (dy / d) * pull;
        const c = clampSector(p.x, p.y, margin, innerW, innerH);
        p.x = c.x;
        p.y = c.y;
      }
    });
    spreadCareersInZone(socs, positions, bounds, 0, MIN_ORB_GAP);
  }
}

/**
 * @param {Map<string, string[]>} byZone zone -> soc[]
 * @param {Map<string, { lv: Float32Array }>} socData
 */
export function computeSectorUmapLayout(byZone, socData) {
  const positions = {};
  const innerW = SECTOR_W - SECTOR_MARGIN * 2;
  const innerH = SECTOR_H - SECTOR_MARGIN * 2;
  const cx = SECTOR_MARGIN + innerW / 2;
  const cy = SECTOR_MARGIN + innerH / 2;
  const bounds = {
    minX: SECTOR_MARGIN,
    maxX: SECTOR_MARGIN + innerW,
    minY: SECTOR_MARGIN,
    maxY: SECTOR_MARGIN + innerH,
  };

  for (const [, socList] of byZone.entries()) {
    const socs = socList.slice();
    const n = socs.length;
    if (!n) continue;

    if (n === 1) {
      const c = clampSector(cx, cy, SECTOR_MARGIN, innerW, innerH);
      positions[socs[0]] = { x: c.x, y: c.y };
      continue;
    }

    let embedding;
    try {
      embedding = runZoneUmap(socs, socData);
    } catch (err) {
      console.warn(`Sector UMAP failed (${n} careers), using scattered fallback`, err.message);
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      socs.forEach((soc, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = SECTOR_MARGIN + ((col + 0.5) / cols) * innerW;
        const y = SECTOR_MARGIN + ((row + 0.5) / rows) * innerH;
        const c = clampSector(x, y, SECTOR_MARGIN, innerW, innerH);
        positions[soc] = { x: c.x, y: c.y };
      });
      spreadCareersInZone(socs, positions, bounds, 0, MIN_ORB_GAP);
      spreadSectorOrphans(socs, positions, SECTOR_MARGIN, innerW, innerH);
      continue;
    }

    const k = clusterCount(n);
    const labels = kMeans2D(embedding, k);
    const clusterRanges = normalizeClusterEmbedding(embedding, labels, k);
    const slotRadius = k === 1 ? 0 : 0.30 * Math.min(innerW, innerH);
    const clusterSlots = clusterCenters(k, cx, cy, slotRadius);
    const slotW = innerW * (k === 1 ? 0.82 : 0.62 / Math.ceil(Math.sqrt(k)));
    const slotH = innerH * (k === 1 ? 0.82 : 0.62 / Math.ceil(Math.sqrt(k)));

    const zonePositions = {};
    socs.forEach((soc, i) => {
      const c = labels[i];
      const slot = clusterSlots[c];
      const range = clusterRanges[c];
      const nx = (embedding[i][0] - range.minX) / range.rangeX;
      const ny = (embedding[i][1] - range.minY) / range.rangeY;
      const x = slot.x + (nx - 0.5) * slotW;
      const y = slot.y + (ny - 0.5) * slotH;
      const clamped = clampSector(x, y, SECTOR_MARGIN, innerW, innerH);
      zonePositions[soc] = { x: clamped.x, y: clamped.y };
    });

    spreadCareersInZone(socs, zonePositions, bounds, 0, MIN_ORB_GAP);
    spreadSectorOrphans(socs, zonePositions, SECTOR_MARGIN, innerW, innerH);

    socs.forEach((soc) => {
      const p = zonePositions[soc];
      positions[soc] = {
        sectorX: Math.round(p.x * 100) / 100,
        sectorY: Math.round(p.y * 100) / 100,
        sectorNX: Math.round(((p.x - SECTOR_MARGIN) / innerW) * 10000) / 10000,
        sectorNY: Math.round(((p.y - SECTOR_MARGIN) / innerH) * 10000) / 10000,
      };
    });
  }

  return {
    positions,
    sectorCanvas: { w: SECTOR_W, h: SECTOR_H },
  };
}

/** @deprecated use computeSectorUmapLayout */
export function computeSectorPresetLayout(byZone, layoutBySoc) {
  const positions = {};
  for (const [zone, socList] of byZone.entries()) {
    const socs = socList.slice().sort((a, b) => {
      const la = layoutBySoc[a] || { nx: 0.5, ny: 0.5 };
      const lb = layoutBySoc[b] || { nx: 0.5, ny: 0.5 };
      return la.ny - lb.ny || la.nx - lb.nx || String(a).localeCompare(String(b));
    });
    const innerW = SECTOR_W - SECTOR_MARGIN * 2;
    const innerH = SECTOR_H - SECTOR_MARGIN * 2;
    const n = socs.length;
    if (!n) continue;
    const aspect = innerW / innerH;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * aspect)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = innerW / cols;
    const cellH = innerH / rows;
    socs.forEach((soc, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = SECTOR_MARGIN + col * cellW + cellW / 2;
      const y = SECTOR_MARGIN + row * cellH + cellH / 2;
      positions[soc] = {
        sectorX: Math.round(x * 100) / 100,
        sectorY: Math.round(y * 100) / 100,
        sectorNX: Math.round(((x - SECTOR_MARGIN) / innerW) * 10000) / 10000,
        sectorNY: Math.round(((y - SECTOR_MARGIN) / innerH) * 10000) / 10000,
      };
    });
  }
  return {
    positions,
    sectorCanvas: { w: SECTOR_W, h: SECTOR_H },
  };
}
