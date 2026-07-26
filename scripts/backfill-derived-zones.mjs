#!/usr/bin/env node
/**
 * backfill-derived-zones.mjs — rewrite stale display fields in derived_careers.
 *
 * AI-derived "fragment" rows snapshot their base career's hubZone / orbColor /
 * jobZone / collarCategory and layout coordinates into `row_json` at generation
 * time, so the 2026-07-18 rezone left older fragments pointing at zones that no
 * longer exist. Serving already re-keys these on read
 * (functions/_lib/onet/derive-rekey.js), which is the actual fix — this script
 * is belt-and-braces: it makes the stored rows match what is served.
 *
 * Usage:
 *   node scripts/backfill-derived-zones.mjs                 # print UPDATE SQL for stale rows
 *   node scripts/backfill-derived-zones.mjs --apply         # run them via wrangler d1 (remote)
 *   node scripts/backfill-derived-zones.mjs --fixture f.json  # dry-run against a local row array
 *
 * Rows whose base SOC no longer exists (or is out of scope) are reported as
 * orphans and are NOT rewritten — they are already dropped at read time, and
 * deleting user-generated rows is Jacob's call, not this script's.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { baseIndexFromCareers, rekeyDerivedRows } from '../functions/_lib/onet/derive-rekey.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_NAME = 'flightway-db';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fixtureIdx = args.indexOf('--fixture');
const fixture = fixtureIdx >= 0 ? args[fixtureIdx + 1] : null;

const careers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/onet/artifacts/careers.json'), 'utf8'));
const baseBySoc = baseIndexFromCareers(Array.isArray(careers) ? careers : careers.careers);

function readFixtureRows(file) {
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return Array.isArray(data) ? data : (data.careers || []);
}

function readRemoteRows() {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json',
    '--command', 'SELECT soc, row_json FROM derived_careers',
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  const results = (Array.isArray(parsed) ? parsed[0] : parsed).results || [];
  const rows = [];
  for (const r of results) {
    if (!r || !r.row_json) continue;
    try { rows.push(JSON.parse(r.row_json)); } catch { /* skip corrupt row */ }
  }
  return rows;
}

const rows = fixture ? readFixtureRows(fixture) : readRemoteRows();
const rekeyed = rekeyDerivedRows(rows, baseBySoc);
const bySoc = new Map(rekeyed.map((r) => [r.soc, r]));

const statements = [];
let unchanged = 0;
const orphans = [];
for (const row of rows) {
  if (!row || !row.soc) continue;
  const fixed = bySoc.get(row.soc);
  if (!fixed) { orphans.push(row.soc); continue; }
  if (JSON.stringify(fixed) === JSON.stringify(row)) { unchanged += 1; continue; }
  const json = JSON.stringify(fixed).replace(/'/g, "''");
  statements.push(`UPDATE derived_careers SET row_json = '${json}' WHERE soc = '${row.soc}';`);
  console.error(`  ${row.soc} ${row.title}: hubZone ${row.hubZone} -> ${fixed.hubZone}`);
}

console.error(`\n${rows.length} derived rows | ${statements.length} stale | ${unchanged} already current | ${orphans.length} orphaned`);
if (orphans.length) console.error(`orphans (base SOC gone or excluded, dropped at read time): ${orphans.join(', ')}`);

if (!statements.length) process.exit(0);

if (!apply) {
  console.log(statements.join('\n'));
  console.error('\n(dry run — re-run with --apply to execute against remote D1)');
  process.exit(0);
}

const sqlFile = path.join(ROOT, 'migrations/.backfill-derived-zones.sql');
fs.writeFileSync(sqlFile, statements.join('\n') + '\n');
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', sqlFile], {
    cwd: ROOT, stdio: 'inherit',
  });
} finally {
  fs.unlinkSync(sqlFile);
}
console.error(`Applied ${statements.length} updates.`);
