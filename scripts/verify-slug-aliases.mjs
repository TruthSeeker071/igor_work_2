// Assert the legacy SLUG_ALIASES tables stay identical everywhere they exist.
// Canonical copy: assets/js/shared/onet-catalog.js. The others are runtime
// fallbacks (client) or the server's own copy (roadmap-sync.js).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'assets/js/shared/onet-catalog.js',
  'assets/js/shared/career-focus-migrate.js',
  'assets/js/hub/hub-careers.js',
  'functions/_lib/roadmap-sync.js',
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

if (failed) process.exit(1);
console.log(`slug-aliases OK: ${Object.keys(canonical.aliases).length} aliases identical across ${FILES.length} files`);
