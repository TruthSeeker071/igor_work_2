#!/usr/bin/env node
/**
 * derive-career.mjs — generate "Additional Careers" that do not exist in O*NET
 * by deriving them from an adjacent O*NET base career plus AI-assisted
 * per-dimension coordinate adjustments.
 *
 * Output: data/onet/artifacts/derived-careers.json (the sidecar the client and
 * server merge at runtime). Rows match careers.json row shape exactly plus the
 * derived-only fields (aiDerived, derivedFrom, description, vector, importance,
 * provenance). Derived rows carry vectorIndex:-1 (not in the .bin) and a
 * synthetic 99-XXXX.00 SOC.
 *
 * Usage:
 *   node scripts/derive-career.mjs                      # regenerate all specs below
 *   node scripts/derive-career.mjs --spec path.json     # custom spec file
 *   GEMINI_API_KEY=... node scripts/derive-career.mjs    # use Gemini for adjustments
 *
 * If no Gemini key is available (env GEMINI_API_KEY or .dev.vars), the script
 * falls back to hand-authored MANUAL_ADJUSTMENTS embedded per-spec below and
 * records honest provenance {model:"claude-opus (authoring session)",
 * method:"manual-ai-seed"}. Re-running WITH a key regenerates via Gemini and
 * records {model, method:"gemini-json"}.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'data', 'onet', 'artifacts');
const REGISTRY_PATH = path.join(ROOT, 'data', 'onet', 'dimension-registry-v1.json');
const CAREERS_PATH = path.join(ARTIFACTS, 'careers.json');
const LV_PATH = path.join(ARTIFACTS, 'vectors-lv.f32.bin');
const IM_PATH = path.join(ARTIFACTS, 'importance-im.f32.bin');
const OUT_PATH = path.join(ARTIFACTS, 'derived-careers.json');

const SCHEMA_ID = 'onet-lv-161-v1';
const DIM_COUNT = 161;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Career specs to derive. Each: title, slug, baseSoc, syntheticSoc (99-XXXX.00),
 * hubFeatured, notes (steer the AI), and manualAdjustments (dimension name ->
 * absolute 0-100 value) used when no Gemini key is present.
 */
const SPECS = [
  {
    title: 'Quantitative Trader',
    slug: 'quantitative-trader',
    baseSoc: '13-2099.01', // Financial Quantitative Analysts
    syntheticSoc: '99-0001.00',
    hubFeatured: 0,
    notes:
      'A quant trader executes and manages systematic trading strategies in live markets. '
      + 'Versus a quant analyst (the base), a trader leans harder on fast judgment under time '
      + 'pressure, real-time monitoring of many instruments, programming for execution/backtesting, '
      + 'and decisive action; research/model-building stays high but is applied to live PnL.',
    // Hand-authored AI seed (used when GEMINI_API_KEY absent). Absolute 0-100
    // values relative to the base vector. Dimension names must match the
    // registry exactly.
    manualAdjustments: {
      'Judgment and Decision Making': 78,        // base 60.7 -> decisive under pressure
      'Making Decisions and Solving Problems': 90, // base 82.7
      'Programming': 62,                          // base 37.4 -> execution/backtest code
      'Working with Computers': 88,               // base 72.9
      'Mathematics': 78,                          // (skill) base 71.4 stays high
      'Mathematical Reasoning': 80,               // base 71.4
      'Number Facility': 82,                      // base 67.9 -> fast mental arithmetic
      'Economics and Accounting': 84,             // base 75.7 -> markets/pricing fluency
      'Complex Problem Solving': 72,              // base 58.9
      'Critical Thinking': 78,                    // base 67.9
      'Speed of Closure': 66,                     // base 37.4 -> fast pattern read
      'Selective Attention': 68,                  // base 41.1 -> focus amid noise
      'Time Sharing': 62,                         // base 26.9 -> monitor many markets
      'Analyzing Data or Information': 90,        // base 87.1
      'Systems Evaluation': 68,                   // base 55.4 -> evaluate strategy behavior
      'Deductive Reasoning': 74,                  // base 67.9
      'Inductive Reasoning': 72,                  // base 64.3
      'Active Learning': 66,                      // base 55.4 -> adapt to regime shifts
    },
  },
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadCareersArray() {
  const data = readJson(CAREERS_PATH);
  return Array.isArray(data) ? data : (data && data.careers) || [];
}

function loadFloatRow(binPath, index) {
  const buf = fs.readFileSync(binPath);
  const arr = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const start = index * DIM_COUNT;
  return Array.from(arr.subarray(start, start + DIM_COUNT));
}

function clamp01_100(v) {
  return Math.max(0, Math.min(100, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Resolve the Gemini API key from env or .dev.vars (KEY=VALUE lines).
function resolveGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const devVars = path.join(ROOT, '.dev.vars');
  if (fs.existsSync(devVars)) {
    for (const line of fs.readFileSync(devVars, 'utf8').split('\n')) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
}

function resolveGeminiModel() {
  return (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
}

// Ask Gemini (JSON mode) for per-dimension absolute adjustments + a description.
async function requestGeminiAdjustments(spec, base, registry) {
  const apiKey = resolveGeminiKey();
  if (!apiKey) return null;
  const model = resolveGeminiModel();
  const dimLines = registry.dimensions
    .map((d) => `${d.name} [${d.domain}] (base ${round2(base[d.index])})`)
    .join('\n');
  const prompt = [
    `You are calibrating an O*NET-style skill/ability vector for a career that does NOT exist in O*NET: "${spec.title}".`,
    `It is derived from the adjacent O*NET career (SOC ${spec.baseSoc}). ${spec.notes || ''}`,
    '',
    'Below are the 161 dimensions with the BASE career\'s value (0-100) for each:',
    dimLines,
    '',
    'Return STRICT JSON of the form:',
    '{ "description": "1-2 sentence description of the derived career",',
    '  "adjustments": { "<exact dimension name>": <new absolute 0-100 number>, ... } }',
    'Provide 10-25 adjustments only for dimensions that meaningfully differ from the base.',
    'Use ONLY exact dimension names from the list above. Values are absolute (not deltas).',
  ].join('\n');

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s < 0 || e <= s) throw new Error('Gemini returned non-JSON adjustments.');
    parsed = JSON.parse(text.slice(s, e + 1));
  }
  return { adjustments: parsed.adjustments || {}, description: parsed.description || '', model };
}

// Apply absolute per-dimension adjustments to a copy of the base vector.
function applyAdjustments(base, adjustments, nameToIndex) {
  const vector = base.map(round2);
  const applied = {};
  const unknown = [];
  for (const [name, value] of Object.entries(adjustments)) {
    const idx = nameToIndex.get(name);
    if (idx == null) {
      unknown.push(name);
      continue;
    }
    const clamped = round2(clamp01_100(Number(value)));
    vector[idx] = clamped;
    applied[name] = clamped;
  }
  return { vector, applied, unknown };
}

// Offset base sector/layout coords deterministically so the derived orb sits in
// the same sector/hubZone as its base but is visually distinct.
function offsetLayout(baseRow, seed) {
  const dx = ((seed % 5) - 2) * 7; // deterministic small offset
  const dy = (((seed >> 2) % 5) - 2) * 7;
  const out = {};
  const pairs = [
    ['layoutX', 'layoutY'], ['sectorX', 'sectorY'],
  ];
  for (const [xk, yk] of pairs) {
    if (baseRow[xk] != null) out[xk] = round2(baseRow[xk] + dx);
    if (baseRow[yk] != null) out[yk] = round2(baseRow[yk] + dy);
  }
  // Normalized coords copied from base (kept in-range; visual offset lives in
  // the absolute coords which the renderer prefers).
  for (const k of ['layoutNX', 'layoutNY', 'sectorNX', 'sectorNY']) {
    if (baseRow[k] != null) out[k] = baseRow[k];
  }
  return out;
}

function buildDerivedRow(spec, baseRow, baseVector, baseImportance, registry, adj, provenanceMeta, seed) {
  const nameToIndex = new Map(registry.dimensions.map((d) => [d.name, d.index]));
  const { vector, applied, unknown } = applyAdjustments(baseVector, adj.adjustments, nameToIndex);
  if (unknown.length) {
    console.warn(`[derive-career] ${spec.title}: unknown dimension names ignored: ${unknown.join(', ')}`);
  }
  const layout = offsetLayout(baseRow, seed);
  const description = adj.description
    || `AI-derived from ${baseRow.title}. ${baseRow.description || ''}`.trim();

  return {
    // --- careers.json row shape (must match EXACTLY for every consumer) ---
    soc: spec.syntheticSoc,
    title: spec.title,
    titleNorm: spec.title.toLowerCase(),
    socMajor: spec.syntheticSoc.slice(0, 2),
    hubZone: baseRow.hubZone,
    jobZone: baseRow.jobZone,
    vectorIndex: -1, // not present in vectors-lv.f32.bin
    hubFeatured: spec.hubFeatured != null ? spec.hubFeatured : 0,
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
    importance: baseImportance.map(round2), // copy base importance map
    provenance: {
      model: provenanceMeta.model,
      date: provenanceMeta.date,
      method: provenanceMeta.method,
      adjustments: applied,
    },
  };
}

async function main() {
  const registry = readJson(REGISTRY_PATH);
  if (!Array.isArray(registry.dimensions) || registry.dimensions.length !== DIM_COUNT) {
    throw new Error(`registry dimension count mismatch: ${registry.dimensions?.length}`);
  }
  const careers = loadCareersArray();
  const bySoc = new Map(careers.map((r) => [r.soc, r]));

  const derivedRows = [];
  const date = new Date().toISOString().slice(0, 10);

  let seed = 1;
  for (const spec of SPECS) {
    const baseRow = bySoc.get(spec.baseSoc);
    if (!baseRow) throw new Error(`base SOC ${spec.baseSoc} not found in careers.json`);
    if (baseRow.vectorIndex == null || baseRow.vectorIndex < 0) {
      throw new Error(`base SOC ${spec.baseSoc} has no vectorIndex`);
    }
    const baseVector = loadFloatRow(LV_PATH, baseRow.vectorIndex);
    const baseImportance = loadFloatRow(IM_PATH, baseRow.vectorIndex);

    let adj;
    let provenanceMeta;
    let gemini = null;
    try {
      gemini = await requestGeminiAdjustments(spec, baseVector, registry);
    } catch (err) {
      console.warn(`[derive-career] Gemini failed for ${spec.title}, falling back to manual seed: ${err.message}`);
    }
    if (gemini) {
      adj = { adjustments: gemini.adjustments, description: gemini.description };
      provenanceMeta = { model: gemini.model, date, method: 'gemini-json' };
    } else {
      adj = { adjustments: spec.manualAdjustments || {}, description: spec.description || '' };
      provenanceMeta = { model: 'claude-opus (authoring session)', date, method: 'manual-ai-seed' };
    }

    const row = buildDerivedRow(spec, baseRow, baseVector, baseImportance, registry, adj, provenanceMeta, seed);
    derivedRows.push(row);
    seed += 1;
    console.log(`[derive-career] ${spec.title} (${spec.syntheticSoc}) <- ${baseRow.title} [${provenanceMeta.method}] `
      + `${Object.keys(row.provenance.adjustments).length} adjustments`);
  }

  const out = { schemaId: SCHEMA_ID, careers: derivedRows };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[derive-career] wrote ${derivedRows.length} derived career(s) -> ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
