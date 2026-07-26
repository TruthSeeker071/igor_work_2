// Assert the legacy SLUG_ALIASES tables stay identical everywhere they exist.
// Canonical copy: assets/js/shared/onet-catalog.js. The others are runtime
// fallbacks (client), the server's own copy (roadmap-sync.js), or the S13
// server-rendered career pages' own copy (career-page.js).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildCatalogIndex, slugify, truncatedSlug, SLUG_ALIASES } from '../functions/_lib/career-page.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'assets/js/shared/onet-catalog.js',
  'assets/js/shared/career-focus-migrate.js',
  'assets/js/hub/hub-careers.js',
  'functions/_lib/roadmap-sync.js',
  'functions/_lib/career-page.js',
];

function extractAliases(source, file) {
  const m = source.match(/SLUG_ALIASES\s*=\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error(`No SLUG_ALIASES table found in ${file}`);
  const entries = {};
  for (const line of m[1].split('\n')) {
    const pair = line.match(/'([a-z-]+)'\s*:\s*'([a-z-]+)'/);
    if (pair) entries[pair[1]] = pair[2];
  }
  return entries;
}

const tables = FILES.map((f) => ({
  file: f,
  aliases: extractAliases(readFileSync(join(root, f), 'utf8'), f),
}));

const canonical = tables[0];
let failed = false;
for (const t of tables.slice(1)) {
  const canonKeys = Object.keys(canonical.aliases).sort();
  const keys = Object.keys(t.aliases).sort();
  if (JSON.stringify(canonKeys) !== JSON.stringify(keys)) {
    console.error(`FAIL ${t.file}: key set differs from ${canonical.file}`);
    failed = true;
    continue;
  }
  for (const k of canonKeys) {
    if (t.aliases[k] !== canonical.aliases[k]) {
      console.error(`FAIL ${t.file}: '${k}' → '${t.aliases[k]}' (canonical: '${canonical.aliases[k]}')`);
      failed = true;
    }
  }
}

if (!failed) {
  console.log(`slug-aliases OK: ${Object.keys(canonical.aliases).length} aliases identical across ${FILES.length} files`);
}

// ---------------------------------------------------------------------------
// Part 2: the real SSR routing index. Table parity above only proves the
// alias TEXT matches across files — it says nothing about whether those
// aliases actually resolve inside the index career-page.js/career-catalog.js
// build at request time. This builds that index for real (same inputs, same
// aiDerived filter as functions/_lib/career-catalog.js's loadCareerIndex) and
// checks the routing behaviour itself.

const careersRaw = JSON.parse(readFileSync(join(root, 'data/onet/artifacts/careers.json'), 'utf8'));
const hubMap = JSON.parse(readFileSync(join(root, 'data/onet/hub-career-soc-map.json'), 'utf8'));
const careers = careersRaw.filter((r) => r && r.aiDerived !== true);
const index = buildCatalogIndex({ careers, hubMap });

// Every SLUG_ALIASES key either resolves through aliasTo to a real canonical
// page, or is entirely absent from the catalog's routing index (some alias
// targets — e.g. a merged hub zone's old name — are not in-scope careers).
// FAIL only the case where an alias resolves to a slug that does not exist.
let inScopeAliases = 0;
let outOfScopeAliases = 0;
for (const [from, to] of Object.entries(SLUG_ALIASES)) {
  const resolved = index.aliasTo.get(from);
  if (resolved === undefined) {
    if (index.bySlug.has(from)) {
      console.error(`FAIL SLUG_ALIASES['${from}'] → '${to}' but '${from}' is itself a canonical page in the routing index`);
      failed = true;
    } else {
      outOfScopeAliases += 1;
      console.log(`  note: SLUG_ALIASES['${from}'] → '${to}' — '${from}' resolves to nothing in the routing index (not an in-scope career)`);
    }
    continue;
  }
  inScopeAliases += 1;
  if (!index.bySlug.has(resolved)) {
    console.error(`FAIL SLUG_ALIASES['${from}'] → '${resolved}' but '${resolved}' does not exist as a canonical slug`);
    failed = true;
  }
}

// No slug is both a canonical page and an alias.
for (const slug of index.aliasTo.keys()) {
  if (index.bySlug.has(slug)) {
    console.error(`FAIL '${slug}' is BOTH a canonical page and an alias`);
    failed = true;
  }
}

// Every canonical slug is non-empty, lowercase, [a-z0-9-]+, and unique (Map
// keys are already unique by construction — this checks the shape).
const SLUG_RE = /^[a-z0-9-]+$/;
for (const slug of index.bySlug.keys()) {
  if (!slug || !SLUG_RE.test(slug)) {
    console.error(`FAIL canonical slug '${slug}' is empty or does not match ${SLUG_RE}`);
    failed = true;
  }
}

// For every row, slugify(title) and truncatedSlug(title) must resolve (via
// bySlug directly or via aliasTo) to that row's OWN canonical slug — the
// title form must never point at a different career.
function resolvesTo(slug) {
  if (index.bySlug.has(slug)) return slug;
  return index.aliasTo.get(slug);
}
let titleMismatches = 0;
let truncMismatches = 0;
for (const row of index.rows) {
  const own = row.__slug;
  const titleResolved = resolvesTo(slugify(row.title));
  if (titleResolved !== own) {
    console.error(`FAIL '${row.title}' (${row.soc}): slugify(title) resolves to '${titleResolved}', not its own canonical slug '${own}'`);
    failed = true;
    titleMismatches += 1;
  }
  const truncResolved = resolvesTo(truncatedSlug(row.title));
  if (truncResolved !== own) {
    console.error(`FAIL '${row.title}' (${row.soc}): truncatedSlug(title) resolves to '${truncResolved}', not its own canonical slug '${own}'`);
    failed = true;
    truncMismatches += 1;
  }
}

console.log(
  `routing index: ${index.bySlug.size} canonical slugs, ${index.aliasTo.size} aliases `
  + `(${inScopeAliases} SLUG_ALIASES in-scope, ${outOfScopeAliases} out-of-scope; `
  + `${titleMismatches} title mismatches, ${truncMismatches} truncated-slug mismatches)`,
);

if (failed) process.exit(1);
console.log('verify:aliases PASS');
