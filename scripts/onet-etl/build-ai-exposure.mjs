#!/usr/bin/env node
// FlightWay 2.0 — Pillar C1: AI-Exposure ETL.
// Computes a per-occupation AI-exposure score from O*NET work-activity levels ×
// an editorial exposure-weights table (ai-exposure-weights.json). The score is an
// importance-weighted average of activity exposure — scale-invariant, so it doesn't
// matter whether the level buffer is 0–7 or 0–100:
//   score = 100 · Σ(level_i · exposure_i) / Σ(level_i)   over the 41 work activities
// "What AI eats"   = activities ranked by level·exposure.
// "What stays human"= activities ranked by level·(1−exposure).
//
//   run: npm run onet:exposure   → writes data/ai-exposure.json
// This is a self-assessment aid, NOT a job-loss prediction (see docs/AI_EXPOSURE_METHOD.md).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const A = (p) => path.join(REPO, p);

function readJson(rel) { return JSON.parse(fs.readFileSync(A(rel), 'utf8')); }

function main() {
  const registry = readJson('data/onet/dimension-registry-v1.json');
  const dims = registry.dimensions || registry;
  const wa = dims.filter((d) => d.domain === 'workActivities'); // 41
  const weightsDoc = readJson('scripts/onet-etl/ai-exposure-weights.json');
  const weights = weightsDoc.weights || {};

  // Fail loudly if the editorial table drifts from the registry.
  const missing = wa.filter((d) => weights[d.elementId] == null);
  if (missing.length) {
    console.error('Missing exposure weights for:', missing.map((d) => `${d.elementId} ${d.name}`));
    process.exit(1);
  }
  const waCols = wa.map((d) => ({ index: d.index, name: d.name, exposure: Number(weights[d.elementId].exposure) }));

  const manifest = readJson('data/onet/artifacts/manifest.json');
  const DIM = manifest.dimensionCount || 161;
  const careers = readJson('data/onet/artifacts/careers.json');
  const list = Array.isArray(careers) ? careers : (careers.careers || Object.values(careers));

  const bin = fs.readFileSync(A('data/onet/artifacts/vectors-lv.f32.bin'));
  const f32 = new Float32Array(bin.buffer, bin.byteOffset, Math.floor(bin.length / 4));

  // Pass 1 — raw importance-weighted exposure per occupation (0–100, absolute):
  //   raw = 100 · Σ(level·exposure) / Σ(level)
  const recs = [];
  for (const c of list) {
    const soc = c.soc || c.socCode;
    const row = Number(c.vectorIndex);
    if (soc == null || !Number.isInteger(row)) continue;
    const base = row * DIM;
    let num = 0, den = 0;
    const eaten = [], durable = [];
    for (const col of waCols) {
      const level = Number(f32[base + col.index]) || 0;
      if (level <= 0) continue;
      num += level * col.exposure;
      den += level;
      eaten.push({ name: col.name, w: level * col.exposure });
      durable.push({ name: col.name, w: level * (1 - col.exposure) });
    }
    if (den <= 0) continue;
    const raw = Math.max(0, Math.min(100, Math.round((100 * num) / den)));
    eaten.sort((a, b) => b.w - a.w);
    durable.sort((a, b) => b.w - a.w);
    recs.push({
      soc, raw,
      topExposed: eaten.slice(0, 4).map((x) => x.name),
      topDurable: durable.slice(0, 4).map((x) => x.name),
    });
  }

  // Pass 2 — percentile-rank the raw score so the displayed 0–100 spans the full
  // range and reads honestly as "more AI-exposed than N% of careers". The absolute
  // weighted average is kept as rawExposure for transparency.
  const sorted = recs.map((r) => r.raw).sort((a, b) => a - b);
  const percentile = (v) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
    return Math.round((lo / sorted.length) * 100);
  };
  const band = (p) => (p < 40 ? 'low' : p < 75 ? 'moderate' : 'high');

  const out = {};
  let n = 0;
  for (const r of recs) {
    const score = percentile(r.raw);
    if (!(score >= 0 && score <= 100) || !r.topExposed.length || !r.topDurable.length) {
      console.error('bad record', r.soc); process.exit(1);
    }
    out[r.soc] = { score, rawExposure: r.raw, band: band(score), topExposed: r.topExposed, topDurable: r.topDurable };
    n += 1;
  }

  const payload = {
    meta: {
      version: 'ai-exposure-v1',
      builtAt: new Date().toISOString(),
      method: 'score = percentile rank of an importance-weighted average of O*NET work-activity exposure; self-assessment, not a job-loss prediction',
      weightsVersion: weightsDoc.meta?.version || null,
      occupationCount: n,
      docs: 'docs/AI_EXPOSURE_METHOD.md',
    },
    careers: out,
  };
  fs.writeFileSync(A('data/ai-exposure.json'), JSON.stringify(payload));
  const raws = recs.map((r) => r.raw);
  console.log(`ai-exposure.json: ${n} occupations; rawExposure ${Math.min(...raws)}–${Math.max(...raws)}; score = percentile 0–100`);

  // Spot-check a few for plausibility.
  const socOf = (norm) => (list.find((c) => (c.titleNorm || '').includes(norm)) || {}).soc;
  ['chief executives', 'registered nurses', 'accountants', 'heavy and tractor', 'software developers', 'hairdressers']
    .forEach((q) => {
      const soc = socOf(q);
      if (soc && out[soc]) console.log(`  ${q}: score ${out[soc].score} · raw ${out[soc].rawExposure} (${out[soc].band})`);
    });
}

main();
