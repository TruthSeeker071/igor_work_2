/**
 * derive-rekey.js — read-time re-keying of AI-derived ("fragment") rows.
 *
 * A derived row snapshots its parent's display fields (hubZone, orbColor,
 * jobZone, collarCategory) and layout coordinates into `row_json` at generation
 * time. The 2026-07-18 macro-hub rezone renamed/merged zones, so every fragment
 * generated before it carries a dead `hubZone` — and the hub buckets rows by
 * hubZone verbatim, which means those fragments render nowhere. Rather than
 * trust the snapshot, re-derive it from the CURRENT base row on every read, and
 * drop fragments whose base no longer exists or is out of scope (a satellite
 * without a live parent is never served).
 *
 * Pure and dependency-free so both the store (catalog merge) and the
 * derive-career lib (HTTP reads) can use it without an import cycle.
 */

export const FRAGMENT_COUNT = 3;

// Fields a fragment copies from its base at generation time — all re-read here.
const SNAPSHOT_FIELDS = ['hubZone', 'orbColor', 'jobZone', 'collarCategory'];
const LAYOUT_KEYS = [
  'layoutX', 'layoutY', 'layoutNX', 'layoutNY',
  'sectorX', 'sectorY', 'sectorNX', 'sectorNY',
];

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Deterministic small offset so the derived orb sits near its base but distinct.
// Places each fragment on a fixed orbit around its base career: FRAGMENT_COUNT
// (3) siblings 120 degrees apart at a fixed radius, so they never overlap each
// other or crowd the parent. 46 world units keeps them visually attached to
// the base while approaching real-career nearest-neighbor spacing within a
// zone (empirically ~70-90 units), rather than the old +/-14 grid-jitter offset
// (max ~20 units apart) that let siblings render almost on top of one another.
export function offsetLayout(baseRow, seed) {
  const FRAGMENT_ORBIT_R = 92; // 2x — keeps satellites from crowding the parent orb
  // Deterministic per-base jitter (hash of base SOC + seed) so sibling spacing
  // reads organic rather than a perfect 120° tripod, while keeping siblings at
  // least ~70° apart and the radius within ±30% of the nominal orbit.
  let h = 0;
  const key = String(baseRow.soc || '') + ':' + seed;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  const j1 = ((h >>> 8) & 0xff) / 255;  // 0..1
  const j2 = ((h >>> 16) & 0xff) / 255; // 0..1
  const angle = ((seed - 1) * (2 * Math.PI / FRAGMENT_COUNT)) + (Math.PI / 6)
    + (j1 - 0.5) * (Math.PI / 3.6); // ±25° wobble
  const orbitR = FRAGMENT_ORBIT_R * (0.7 + 0.6 * j2);
  const dx = Math.cos(angle) * orbitR;
  const dy = Math.sin(angle) * orbitR;
  const out = {};
  for (const [xk, yk] of [['layoutX', 'layoutY'], ['sectorX', 'sectorY']]) {
    if (baseRow[xk] != null) out[xk] = round2(baseRow[xk] + dx);
    if (baseRow[yk] != null) out[yk] = round2(baseRow[yk] + dy);
  }
  for (const k of ['layoutNX', 'layoutNY', 'sectorNX', 'sectorNY']) {
    if (baseRow[k] != null) out[k] = baseRow[k];
  }
  return out;
}

/**
 * SOC -> live base row, for rows a fragment is allowed to inherit from.
 * Derived and out-of-scope rows are never bases, so a fragment pointing at one
 * is an orphan.
 */
export function baseIndexFromCareers(careers) {
  const map = new Map();
  for (const c of (careers || [])) {
    if (!c || !c.soc || c.aiDerived || c.mvpInScope === false) continue;
    map.set(c.soc, c);
  }
  return map;
}

/** One row re-keyed against its live base. `seed` is its orbit slot (1-based). */
export function rekeyDerivedRow(row, baseRow, seed) {
  const out = { ...row };
  for (const k of SNAPSHOT_FIELDS) out[k] = baseRow[k];
  const layout = offsetLayout(baseRow, seed);
  for (const k of LAYOUT_KEYS) out[k] = layout[k] != null ? layout[k] : null;
  out.derivedFrom = { soc: baseRow.soc, title: baseRow.title };
  return out;
}

/**
 * Re-key a whole derived set. Non-derived rows pass through untouched;
 * fragments with no live base are dropped.
 */
export function rekeyDerivedRows(rows, baseBySoc) {
  const list = Array.isArray(rows) ? rows : [];
  // Fragments are generated with seeds 1..FRAGMENT_COUNT in ascending
  // synthetic-SOC order, so sorting siblings by soc reproduces the seed each
  // row was originally laid out with — the orbit slot stays stable.
  const siblings = new Map();
  for (const r of list) {
    if (!r || !r.aiDerived || !r.soc) continue;
    const parent = r.derivedFrom && r.derivedFrom.soc;
    if (!parent) continue;
    if (!siblings.has(parent)) siblings.set(parent, []);
    siblings.get(parent).push(r.soc);
  }
  const seedBySoc = new Map();
  for (const socs of siblings.values()) {
    socs.sort();
    socs.forEach((soc, i) => seedBySoc.set(soc, i + 1));
  }
  const out = [];
  for (const r of list) {
    if (!r) continue;
    if (!r.aiDerived) { out.push(r); continue; }
    const parentSoc = r.derivedFrom && r.derivedFrom.soc;
    const baseRow = parentSoc && baseBySoc ? baseBySoc.get(parentSoc) : null;
    if (!baseRow) continue; // orphan — never served
    out.push(rekeyDerivedRow(r, baseRow, seedBySoc.get(r.soc) || 1));
  }
  return out;
}
