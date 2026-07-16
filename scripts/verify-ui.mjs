#!/usr/bin/env node
// UI token-discipline ratchet (Phase 1 of UI overhaul).
// Counts per CSS file: hardcoded hex colors, !important, raw 100vh usage,
// px font-size literals. Fails if any count EXCEEDS scripts/ui-baseline.json —
// counts may only go down. After intentional reductions run:
//   node scripts/verify-ui.mjs --update
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssDir = join(root, 'assets', 'css');
const baselinePath = join(root, 'scripts', 'ui-baseline.json');
// Token source files are allowed to define colors.
const HEX_EXEMPT = new Set(['flightway-theme.css', 'zone-colors.css']);

const metrics = {};
for (const f of readdirSync(cssDir).filter(f => f.endsWith('.css')).sort()) {
  const src = readFileSync(join(cssDir, f), 'utf8');
  metrics[f] = {
    hex: HEX_EXEMPT.has(f) ? 0 : (src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length,
    important: (src.match(/!important/g) || []).length,
    vh100: (src.match(/100vh/g) || []).length,
    fontSizePx: (src.match(/font-size:\s*[\d.]+px/g) || []).length,
  };
}

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify(metrics, null, 2) + '\n');
  console.log('ui-baseline.json updated');
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); }
catch { console.error('No scripts/ui-baseline.json — run with --update first.'); process.exit(1); }

let failed = false;
for (const [file, m] of Object.entries(metrics)) {
  const b = baseline[file] || { hex: 0, important: 0, vh100: 0, fontSizePx: 0 };
  for (const k of Object.keys(m)) {
    if (m[k] > b[k]) {
      console.error(`FAIL ${file}: ${k} ${b[k]} -> ${m[k]} (ratchet only goes down; use tokens instead)`);
      failed = true;
    }
  }
}
console.log(failed ? 'verify-ui: FAILED' : 'verify-ui: OK (no token-discipline regressions)');
process.exit(failed ? 1 : 0);
