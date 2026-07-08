/**
 * derive-career.js — runtime "fragment" career generation, D1-backed and global.
 *
 * Promotes scripts/derive-career.mjs (the build-time reference) to a request-time
 * server library: given a real O*NET base career, ask Gemini (JSON mode, one
 * batched call) for 3 distinct specializations, apply/clamp per-dimension absolute
 * adjustments to a copy of the base vector, and persist each as a derived_careers
 * row. Rows carry the full careers.json row shape (soc/title/layout/…) plus the
 * derived-only fields (aiDerived/derivedFrom/description/vector/importance/
 * provenance) so store.getDerivedCareers + onet/vectors serve them like the static
 * sidecar. Generation is idempotent: existing fragments are returned, never
 * regenerated. Gemini failure returns [] and inserts nothing (no fallback rows).
 */
import {
  getRegistry,
  getSocIndex,
  getLvBuffer,
  getImBuffer,
  getCareers,
  getDerivedCareers,
  sliceVector,
} from './onet/store.js';
import { DIM_COUNT } from './onet/constants.js';
import { callGeminiJson } from './gemini-json.js';
import { resolveGeminiModels } from '../_lib.js';

const FRAGMENT_COUNT = 3;
// Synthetic SOC range for runtime fragments. The static sidecar owns 99-0XXX;
// runtime rows start at 99-1000.00 and count up.
const SYNTHETIC_SOC_START = '99-1000.00';
const SYNTHETIC_SOC_PREFIX = '99-1';

function round2(v) {
  return Math.round(v * 100) / 100;
}

function clamp01_100(v) {
  return Math.max(0, Math.min(100, v));
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Apply absolute per-dimension adjustments to a copy of the base vector.
function applyAdjustments(baseVector, adjustments, nameToIndex) {
  const vector = baseVector.map(round2);
  const applied = {};
  // Tolerate both {"Name": v} and [{name, value}] shapes from the model.
  const entries = Array.isArray(adjustments)
    ? adjustments.map((a) => [a && a.name, a && a.value])
    : Object.entries(adjustments || {});
  for (const [name, value] of entries) {
    let idx = nameToIndex.get(name);
    if (idx == null && typeof name === 'string') {
      // The prompt lists dimensions as `Name [domain] (base N)`; gemini-2.5-flash
      // (the 503 fallback) copies the decorations into its keys where flash-lite
      // returns bare names. Strip them rather than reject the whole fragment.
      idx = nameToIndex.get(
        name.replace(/\s*\(base[^)]*\)\s*$/i, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim(),
      );
    }
    if (idx == null) continue;
    const clamped = round2(clamp01_100(Number(value)));
    if (!Number.isFinite(clamped)) continue;
    vector[idx] = clamped;
    applied[name] = clamped;
  }
  return { vector, applied };
}

// Deterministic small offset so the derived orb sits near its base but distinct.
// Places each fragment on a fixed orbit around its base career: FRAGMENT_COUNT
// (3) siblings 120 degrees apart at a fixed radius, so they never overlap each
// other or crowd the parent. 46 world units keeps them visually attached to
// the base while approaching real-career nearest-neighbor spacing within a
// zone (empirically ~70-90 units), rather than the old +/-14 grid-jitter offset
// (max ~20 units apart) that let siblings render almost on top of one another.
function offsetLayout(baseRow, seed) {
  const FRAGMENT_ORBIT_R = 46;
  const angle = ((seed - 1) * (2 * Math.PI / FRAGMENT_COUNT)) + (Math.PI / 6);
  const dx = Math.cos(angle) * FRAGMENT_ORBIT_R;
  const dy = Math.sin(angle) * FRAGMENT_ORBIT_R;
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

function buildDerivedRow({ soc, title, slug, description, baseRow, vector, baseImportance, applied, model, seed }) {
  const layout = offsetLayout(baseRow, seed);
  return {
    // --- careers.json row shape (must match EXACTLY for every consumer) ---
    soc,
    title,
    titleNorm: String(title).toLowerCase(),
    socMajor: '99',
    hubZone: baseRow.hubZone,
    jobZone: baseRow.jobZone,
    vectorIndex: -1,
    hubFeatured: 0,
    collarCategory: baseRow.collarCategory,
    mvpInScope: true,
    exclusionReason: null,
    orbColor: baseRow.orbColor,
    aiDerived: true,
    layoutX: layout.layoutX,
    layoutY: layout.layoutY,
    layoutNX: layout.layoutNX,
    layoutNY: layout.layoutNY,
    sectorX: layout.sectorX,
    sectorY: layout.sectorY,
    sectorNX: layout.sectorNX,
    sectorNY: layout.sectorNY,
    // --- derived-only fields ---
    derivedFrom: { soc: baseRow.soc, title: baseRow.title },
    description,
    vector: vector.map(round2),
    importance: baseImportance.map(round2),
    provenance: {
      model,
      date: new Date().toISOString().slice(0, 10),
      method: 'runtime-fragment',
      adjustments: applied,
    },
    slug,
  };
}

// Build the batched Gemini prompt: all 161 dims with base values, ask for 3
// distinct specializations with absolute adjusted values (10-25 dims each).
function buildFragmentPrompt(baseRow, baseVector, registry) {
  const dimLines = registry.dimensions
    .map((d) => `${d.name} [${d.domain}] (base ${round2(baseVector[d.index])})`)
    .join('\n');
  return [
    `You are generating ${FRAGMENT_COUNT} distinct real-world SPECIALIZATIONS of the O*NET career "${baseRow.title}" (SOC ${baseRow.soc}) that do NOT themselves exist as separate O*NET occupations.`,
    'Each specialization is a plausible, differentiated career path a person in the base career could grow into (e.g. a sub-field, a tooling/domain focus, or a hands-on vs. strategic split). They must be meaningfully different from each other and from the base.',
    '',
    'Below are the 161 O*NET skill/ability/work-activity dimensions with the BASE career\'s value (0-100) for each:',
    dimLines,
    '',
    'Return STRICT JSON of the form:',
    '{ "fragments": [',
    '  { "title": "<specialization title, distinct from the base>",',
    '    "description": "1-2 sentence description of this specialization",',
    '    "adjustments": { "<exact dimension name>": <new absolute 0-100 number>, ... } },',
    '  ... exactly ' + FRAGMENT_COUNT + ' entries ...',
    '] }',
    'Provide 10-25 adjustments per fragment, ONLY for dimensions that meaningfully differ from the base.',
    'Use ONLY exact dimension names from the list above. Values are ABSOLUTE (not deltas), 0-100.',
    'Titles must be short (2-5 words), professional, and distinct from "' + baseRow.title + '".',
  ].join('\n');
}

/**
 * D1 read: all runtime derived rows (parsed from row_json).
 */
export async function getRuntimeDerivedRows(env) {
  if (!env.DB) return [];
  try {
    const result = await env.DB.prepare('SELECT row_json FROM derived_careers').all();
    const rows = (result && result.results) || [];
    const out = [];
    for (const r of rows) {
      if (!r || !r.row_json) continue;
      try { out.push(JSON.parse(r.row_json)); } catch { /* skip corrupt row */ }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Single derived row by SOC, or null. Sources from the unified static-sidecar +
 * D1 set so both hand-authored 99-0XXX and runtime 99-1XXX SOCs resolve (the
 * static ones are also in the client catalog, but this keeps the ?soc= endpoint
 * correct for a direct link before the catalog has merged them).
 */
export async function getRuntimeDerivedBySoc(env, baseUrl, soc) {
  if (!soc) return null;
  try {
    const all = await getDerivedCareers(env, baseUrl);
    return all.find((r) => r && r.soc === soc) || null;
  } catch {
    return null;
  }
}

function stripVectors(row) {
  if (!row) return row;
  const { vector, importance, ...rest } = row;
  return rest;
}

/**
 * Reverse lookup: fragments derived from a given base SOC. Unions the static
 * sidecar with the D1 runtime rows (via store.getDerivedCareers, which already
 * dedupes by soc) so hand-authored fragments — e.g. the seeded Quantitative
 * Trader off Financial Quantitative Analysts (13-2099.01) — surface in the hub
 * drawer strip even before/without any D1 table. Vector/importance stripped for
 * list responses (the full vectors are served by onet/vectors, not the catalog).
 */
export async function getFragmentsForSoc(env, baseUrl, baseSoc) {
  if (!baseSoc) return [];
  try {
    const all = await getDerivedCareers(env, baseUrl);
    return all
      .filter((r) => r && r.derivedFrom && r.derivedFrom.soc === baseSoc)
      .map(stripVectors);
  } catch {
    return [];
  }
}

// Next synthetic SOC in the 99-1XXX.00 range: MAX(soc) LIKE '99-1%' + 1.
async function nextSyntheticSoc(env) {
  let maxSeq = null;
  try {
    const row = await env.DB.prepare(
      "SELECT MAX(soc) AS m FROM derived_careers WHERE soc LIKE '99-1%'",
    ).first();
    if (row && row.m) maxSeq = row.m;
  } catch { /* fall through to start */ }
  if (!maxSeq) return { seq: 1000, format: (n) => `99-${n}.00` };
  const m = String(maxSeq).match(/^99-(\d+)\.00$/);
  const start = m ? Number(m[1]) + 1 : 1000;
  return { seq: start, format: (n) => `99-${n}.00` };
}

// Unique slug: prefer the slugified title, suffix -ai on catalog/D1/local collision.
function uniqueSlug(title, taken) {
  let base = slugify(title) || 'career';
  let slug = base;
  if (taken.has(slug)) slug = `${base}-ai`;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-ai-${n}`;
    n += 1;
  }
  taken.add(slug);
  return slug;
}

/**
 * generateFragmentsForBase — synchronous, global, idempotent.
 *
 * Guards: baseSoc must be a real O*NET SOC (in socIndex), its catalog row must
 * not be aiDerived. If fragments already exist for that base, returns them
 * (never regenerates). ONE batched Gemini JSON call → 3 specializations →
 * apply/clamp → INSERT OR IGNORE then SELECT (race-safe). Gemini failure returns
 * [] and inserts nothing.
 *
 * Returns the full derived rows (with vector/importance); callers that respond
 * over HTTP should strip those via getFragmentsForSoc-style projection.
 */
export async function generateFragmentsForBase(env, ctx, { baseSoc, email, baseUrl }) {
  if (!env.DB || !baseSoc) return [];
  const soc = String(baseSoc).trim();
  if (!soc || soc.startsWith('99-')) return []; // derived/synthetic bases never spawn fragments

  // Idempotent: already derived → return existing.
  const existing = await getFragmentsForSoc(env, baseUrl, soc);
  if (existing.length) return existing;

  // baseUrl is required for the static-artifact fallback when R2 (ONET_BUCKET)
  // is unbound; callers pass request URL origin. Once the store caches warm on
  // the first request, subsequent generations reuse them regardless.
  let socIndex; let registry; let careers;
  try {
    [socIndex, registry, careers] = await Promise.all([
      getSocIndex(env, baseUrl),
      getRegistry(env, baseUrl),
      getCareers(env, baseUrl),
    ]);
  } catch {
    return [];
  }

  const vectorIndex = socIndex ? socIndex[soc] : null;
  if (vectorIndex == null || vectorIndex < 0) return []; // not a real O*NET base
  const baseRow = Array.isArray(careers) ? careers.find((c) => c && c.soc === soc) : null;
  if (!baseRow || baseRow.aiDerived) return []; // unknown or already-derived base

  let lvBuf; let imBuf;
  try {
    [lvBuf, imBuf] = await Promise.all([
      getLvBuffer(env, baseUrl),
      getImBuffer(env, baseUrl),
    ]);
  } catch {
    return [];
  }
  const baseVector = sliceVector(lvBuf, vectorIndex);
  const baseImportance = sliceVector(imBuf, vectorIndex);
  const nameToIndex = new Map(registry.dimensions.map((d) => [d.name, d.index]));

  const model = resolveGeminiModels(env)[0];
  let parsed;
  try {
    parsed = await callGeminiJson(env, {
      prompt: buildFragmentPrompt(baseRow, baseVector, registry),
      temperature: 0.4,
      // Gemini 2.5 counts internal thinking toward maxOutputTokens in JSON
      // mode; 3072 truncated adjustments mid-array and the salvage parser
      // silently produced base-identical vectors.
      maxTokens: 8192,
      label: 'derive-fragments',
      softFail: true,
    });
  } catch {
    parsed = null;
  }
  const fragments = parsed && Array.isArray(parsed.fragments) ? parsed.fragments : [];
  if (!fragments.length) return []; // Gemini failure: no fallback rows

  // Build the "taken" slug set from the live catalog (includes static derived +
  // already-merged D1 rows) so new slugs never collide.
  const taken = new Set();
  if (Array.isArray(careers)) {
    for (const c of careers) {
      if (c && c.title) taken.add(slugify(c.title));
      if (c && c.slug) taken.add(c.slug);
    }
  }
  const existingSlugRows = await getRuntimeDerivedRows(env);
  for (const r of existingSlugRows) {
    if (r && r.slug) taken.add(r.slug);
    if (r && r.title) taken.add(slugify(r.title));
  }

  const socGen = await nextSyntheticSoc(env);
  let seq = socGen.seq;
  let seed = 1;
  const built = [];
  for (const frag of fragments.slice(0, FRAGMENT_COUNT)) {
    const title = String(frag && frag.title || '').trim();
    if (!title) continue;
    const description = String(frag.description || '').trim()
      || `AI-derived specialization of ${baseRow.title}.`;
    const { vector, applied } = applyAdjustments(baseVector, frag.adjustments, nameToIndex);
    // A fragment with no applied adjustments is base-identical — truncated or
    // malformed model output. Never persist an undifferentiated row.
    if (!Object.keys(applied).length) continue;
    const synthSoc = socGen.format(seq);
    seq += 1;
    const slug = uniqueSlug(title, taken);
    const row = buildDerivedRow({
      soc: synthSoc, title, slug, description, baseRow, vector,
      baseImportance, applied, model, seed,
    });
    seed += 1;
    built.push(row);
  }
  if (!built.length) {
    // Gemini answered but nothing survived the guards — log enough shape to
    // diagnose without dumping the payload (these failures are otherwise
    // invisible: callers treat [] as "no fragments yet" and move on).
    console.warn('derive-fragments: all fragments rejected', JSON.stringify({
      baseSoc: soc,
      count: fragments.length,
      shapes: fragments.slice(0, FRAGMENT_COUNT).map((f) => ({
        title: !!(f && f.title),
        adjType: f && f.adjustments ? (Array.isArray(f.adjustments) ? 'array' : typeof f.adjustments) : 'none',
        adjLen: f && f.adjustments ? (Array.isArray(f.adjustments) ? f.adjustments.length : Object.keys(f.adjustments).length) : 0,
        sampleKeys: f && f.adjustments && !Array.isArray(f.adjustments)
          ? Object.keys(f.adjustments).slice(0, 3) : [],
      })),
    }));
    return [];
  }

  // Persist race-safe: INSERT OR IGNORE (soc/slug are unique). A concurrent
  // request that already inserted wins — we re-SELECT the canonical set below.
  const createdBy = email ? String(email).slice(0, 200) : null;
  for (const row of built) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO derived_careers (soc, slug, derived_from_soc, title, row_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(row.soc, row.slug, soc, row.title, JSON.stringify(row), createdBy).run();
    } catch {
      // tolerate a lost race on unique constraint; canonical set comes from SELECT
    }
  }

  // Return the canonical persisted set (handles the race where another request
  // inserted a different batch first).
  const persisted = await env.DB.prepare(
    'SELECT row_json FROM derived_careers WHERE derived_from_soc = ? ORDER BY created_at ASC',
  ).bind(soc).all().catch(() => ({ results: [] }));
  const out = [];
  for (const r of (persisted.results || [])) {
    if (!r || !r.row_json) continue;
    try { out.push(JSON.parse(r.row_json)); } catch { /* skip */ }
  }
  return out.length ? out : built;
}

export { stripVectors };
