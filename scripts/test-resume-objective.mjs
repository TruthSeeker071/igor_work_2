#!/usr/bin/env node
/**
 * Smoke test: resume rules produce directional objective vector (finance/tech/science).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyThemedRulesToObjective, setZoneDimensionProfiles } from '../functions/_lib/onet/resume-theme-map.js';
import { objectiveFitPercent } from '../functions/_lib/onet/math.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RESUME = `JACOB KLUGERMAN
Research Assistant | Albert Einstein College of Medicine, Department of Systems and Computational Biology
Conducted genomic data validation research. Built Python programs with Numpy and Pandas.
IMC Prosperity Algorithmic Trading Competition — Black-Scholes option pricing, market-making, quantitative research.
University of Chicago — Computational & Applied Mathematics. AP Microeconomics, AP Calculus BC, AP Computer Science.
Flightway Co-Founder & Technical Product Lead. Statistical analysis and algorithm design.`;

const profilesPath = path.join(ROOT, 'data/onet/artifacts/zone-dimension-profiles.json');
const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
setZoneDimensionProfiles(profiles);

const empty = { schemaId: 'onet-lv-161-v1', values: new Array(161).fill(0), sources: [] };
const result = applyThemedRulesToObjective(empty, RESUME, { profiles });

const zoneCounts = {};
(result.sources || []).forEach((tag) => {
  if (!tag || !String(tag).startsWith('resume:')) return;
  const z = String(tag).slice(7);
  zoneCounts[z] = (zoneCounts[z] || 0) + 1;
});
const topZones = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([z]) => z);
console.log('Top zone tags:', topZones.join(', '));

const badDominant = ['healthcare', 'social', 'education'].includes(topZones[0]);
if (badDominant) {
  console.error('FAIL: unexpected dominant zone', topZones[0]);
  process.exit(1);
}
const hasQuantSignal = ['finance', 'tech', 'science'].some((z) => topZones.includes(z));
if (!hasQuantSignal) {
  console.error('FAIL: finance/tech/science not in top zones', topZones);
  process.exit(1);
}

const careers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/onet/artifacts/careers.json'), 'utf8'));
const coroner = careers.find((c) => /Coroner/i.test(c.title));
const quantCareers = careers.filter((c) => /Data Scientist|Financial Quantitative|Operations Research Analyst|Statistician/i.test(c.title));
if (!coroner || !quantCareers.length) {
  console.warn('SKIP vector fit compare — careers not found');
  console.log('PASS rules zone sharpening');
  process.exit(0);
}

const socIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/onet/artifacts/soc-index.json'), 'utf8'));
const lvBuf = fs.readFileSync(path.join(ROOT, 'data/onet/artifacts/vectors-lv.f32.bin'));
const view = new Float32Array(lvBuf.buffer, lvBuf.byteOffset, lvBuf.byteLength / 4);

function sliceVec(soc) {
  const idx = socIndex[soc];
  if (idx == null) return null;
  const out = new Array(161);
  for (let i = 0; i < 161; i++) out[i] = view[idx * 161 + i];
  return out;
}

function fitForCareer(c) {
  const vec = sliceVec(c.soc);
  if (!vec) return null;
  return objectiveFitPercent(result.values, vec);
}

const corFit = fitForCareer(coroner);
let bestQuant = { title: '', fit: 0 };
quantCareers.forEach((c) => {
  const f = fitForCareer(c);
  if (f != null && f > bestQuant.fit) bestQuant = { title: c.title, fit: f };
});

console.log(`Best quant match (${bestQuant.title}): ${bestQuant.fit}%`);
console.log(`Coroner objective fit: ${corFit}%`);

const minSpread = 6;
if (bestQuant.fit - corFit < minSpread) {
  console.error(`FAIL: expected quant careers >= coroner + ${minSpread} (got ${bestQuant.fit} vs ${corFit})`);
  process.exit(1);
}

const flatBand = quantCareers.every((c) => {
  const f = fitForCareer(c);
  return f == null || (f >= 16 && f <= 56);
});
if (!flatBand) {
  console.error('FAIL: quant fits outside expected directional band');
  process.exit(1);
}

console.log('PASS resume objective sharpening');
