/**
 * Per-zone UMAP layout: project 161-dim career vectors into zone bounds.
 */
import { UMAP } from 'umap-js';

export const LAYOUT_PAD = 24;
export const MIN_PAIR_DISTANCE = 26;
export const EDGE_MARGIN = 12;

export const ZONE_ORB_COLORS = {
  tech: '#3B82F6',
  healthcare: '#10B981',
  finance: '#F59E0B',
  science: '#8B5CF6',
  engineering: '#6366F1',
  creative: '#EC4899',
  business: '#78716C',
  marketing: '#F97316',
  education: '#14B8A6',
  law: '#64748B',
  social: '#A855F7',
  media: '#E11D48',
  government: '#475569',
  operations: '#0EA5E9',
  trades: '#84CC16',
  agriculture: '#65A30D',
  cybersecurity: '#06B6D4',
  hospitality: '#D946EF',
};

function clampToInner(x, y, bounds, pad) {
  const minX = bounds.minX + pad;
  const maxX = bounds.maxX - pad;
  const minY = bounds.minY + pad;
  const maxY = bounds.maxY - pad;
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

function normalizedInZone(x, y, bounds, pad) {
  const innerW = bounds.maxX - bounds.minX - pad * 2;
  const innerH = bounds.maxY - bounds.minY - pad * 2;
  const minX = bounds.minX + pad;
  const minY = bounds.minY + pad;
  return {
    nx: innerW > 0 ? (x - minX) / innerW : 0.5,
    ny: innerH > 0 ? (y - minY) / innerH : 0.5,
  };
}

/**
 * Force-based spread so careers fill the zone without tight clumps.
 * @param {string[]} socs
 * @param {Record<string, { x: number, y: number }>} positions mutable
 * @param {object} bounds zone bounds
 * @param {number} pad
 */
export function spreadCareersInZone(socs, positions, bounds, pad = LAYOUT_PAD, minDistOverride) {
  if (socs.length < 2) return;

  const pts = socs.map((soc) => ({
    soc,
    x: positions[soc].x,
    y: positions[soc].y,
  }));

  const minDist = minDistOverride != null ? minDistOverride : MIN_PAIR_DISTANCE;
  const iterations = Math.min(80, 40 + socs.length);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.5;
          const px = dx * push;
          const py = dy * push;
          pts[i].x -= px;
          pts[i].y -= py;
          pts[j].x += px;
          pts[j].y += py;
        }
      }
    }

    // Mild center repulsion keeps points from hugging one corner after UMAP.
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    pts.forEach((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy) || 0.001;
      const innerW = bounds.maxX - bounds.minX - pad * 2;
      const innerH = bounds.maxY - bounds.minY - pad * 2;
      const maxR = Math.min(innerW, innerH) * 0.42;
      if (dist < maxR * 0.35) {
        const push = (maxR * 0.35 - dist) * 0.12;
        p.x += (dx / dist) * push;
        p.y += (dy / dist) * push;
      }
    });

    pts.forEach((p) => {
      const c = clampToInner(p.x, p.y, bounds, pad);
      p.x = c.x;
      p.y = c.y;
    });
  }

  pts.forEach((p) => {
    positions[p.soc] = { x: p.x, y: p.y };
  });
}

/**
 * @param {Map<string, string[]>} byZone soc lists per hubZone
 * @param {Map<string, { lv: Float32Array }>} socData
 * @param {Map<string, object>} zoneBoundsLookup ZONE_GRID_LOOKUP
 * @returns {Record<string, { x: number, y: number, nx: number, ny: number }>}
 */
export function computeUmapLayout(byZone, socData, zoneBoundsLookup) {
  const layout = {};
  const pad = LAYOUT_PAD;

  for (const [zone, socs] of byZone) {
    const bounds = zoneBoundsLookup.get(zone) || zoneBoundsLookup.get('business');
    const innerW = bounds.maxX - bounds.minX - pad * 2;
    const innerH = bounds.maxY - bounds.minY - pad * 2;
    const cx = bounds.minX + pad + innerW / 2;
    const cy = bounds.minY + pad + innerH / 2;

    if (socs.length === 0) continue;

    if (socs.length === 1) {
      const c = clampToInner(cx, cy, bounds, pad);
      const n = normalizedInZone(c.x, c.y, bounds, pad);
      layout[socs[0]] = { x: c.x, y: c.y, nx: n.nx, ny: n.ny };
      continue;
    }

    if (socs.length === 2) {
      const p0 = clampToInner(cx - innerW * 0.25, cy, bounds, pad);
      const p1 = clampToInner(cx + innerW * 0.25, cy, bounds, pad);
      const n0 = normalizedInZone(p0.x, p0.y, bounds, pad);
      const n1 = normalizedInZone(p1.x, p1.y, bounds, pad);
      layout[socs[0]] = { x: p0.x, y: p0.y, nx: n0.nx, ny: n0.ny };
      layout[socs[1]] = { x: p1.x, y: p1.y, nx: n1.nx, ny: n1.ny };
      continue;
    }

    const vectors = socs.map((soc) => Array.from(socData.get(soc).lv));

    let embedding;
    try {
      const nNeighbors = Math.min(15, Math.max(2, socs.length - 1));
      const umapOpts = {
        nComponents: 2,
        nNeighbors,
        randomState: 42,
      };
      if (socs.length >= 10) {
        umapOpts.minDist = 0.75;
        umapOpts.spread = 1.4;
      } else {
        umapOpts.minDist = 0.65;
        umapOpts.spread = 1.25;
      }
      const umap = new UMAP(umapOpts);
      embedding = umap.fit(vectors);
    } catch (err) {
      console.warn(`UMAP failed for zone ${zone} (${socs.length} careers), using grid fallback`, err.message);
      const cols = Math.ceil(Math.sqrt(socs.length));
      const rows = Math.ceil(socs.length / cols);
      socs.forEach((soc, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = bounds.minX + pad + ((col + 0.5) / cols) * innerW;
        const y = bounds.minY + pad + ((row + 0.5) / rows) * innerH;
        const c = clampToInner(x, y, bounds, pad);
        const n = normalizedInZone(c.x, c.y, bounds, pad);
        layout[soc] = { x: c.x, y: c.y, nx: n.nx, ny: n.ny };
      });
      spreadCareersInZone(socs, layout, bounds, pad);
      socs.forEach((soc) => {
        const n = normalizedInZone(layout[soc].x, layout[soc].y, bounds, pad);
        layout[soc].nx = n.nx;
        layout[soc].ny = n.ny;
      });
      continue;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    embedding.forEach(([ex, ey]) => {
      if (ex < minX) minX = ex;
      if (ex > maxX) maxX = ex;
      if (ey < minY) minY = ey;
      if (ey > maxY) maxY = ey;
    });
    const rangeX = Math.max(maxX - minX, 1e-6);
    const rangeY = Math.max(maxY - minY, 1e-6);

    const zonePositions = {};
    socs.forEach((soc, i) => {
      const [ex, ey] = embedding[i];
      const nx = (ex - minX) / rangeX;
      const ny = (ey - minY) / rangeY;
      const x = bounds.minX + pad + nx * innerW;
      const y = bounds.minY + pad + ny * innerH;
      const c = clampToInner(x, y, bounds, pad);
      zonePositions[soc] = { x: c.x, y: c.y };
    });

    spreadCareersInZone(socs, zonePositions, bounds, pad);

    socs.forEach((soc) => {
      const p = zonePositions[soc];
      const n = normalizedInZone(p.x, p.y, bounds, pad);
      layout[soc] = { x: p.x, y: p.y, nx: n.nx, ny: n.ny };
    });
  }

  return layout;
}

export function orbColorForZone(zone) {
  return ZONE_ORB_COLORS[zone] || ZONE_ORB_COLORS.business;
}
