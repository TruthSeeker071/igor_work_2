// verify:user — the user-object access guard.
//
// After the Phase 2 consumer migration (docs/USER_OBJECT_MASTERPLAN.md), the
// ONLY code allowed to touch the legacy quiz-blob storage identifiers is the
// facade layer itself. Everything else reads/writes through FWUser (client)
// or loadUser/saveUser/loadUserBlob/saveUserBlob (server), so Phase 4 can
// flip the stored shape/key inside the facades without touching consumers.
// This script fails the moment a new direct reference appears in shipped app
// code (assets/, functions/). scripts/ and docs/ are exempt: test harnesses
// legitimately seed storage to simulate saved state, and docs describe it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const BANNED = /fw_hub_quiz_v1|HUB_QUIZ_KEY|loadQuizProfile|saveQuizProfile/;

// The facade layer: the client facade names the legacy key to delete it on
// boot; the pure model's KEY_MAP spec comment names it as the v1 shape's home.
// Since 0014 (quiz_profiles dropped, aliases removed) nothing else may match.
const ALLOWED = new Set([
  'assets/js/shared/user.js',
  'functions/_lib/user-model.js',
]);

const ROOTS = ['assets', 'functions'];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|cjs|html)$/.test(entry.name)) yield full;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(path.join(REPO, root))) {
    const rel = path.relative(REPO, file);
    if (ALLOWED.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (BANNED.test(line)) violations.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
}

if (violations.length) {
  console.error(`verify:user FAILED — ${violations.length} direct quiz-blob reference(s) outside the facade layer:`);
  violations.forEach((v) => console.error(`  ${v}`));
  console.error('\nRoute reads/writes through FWUser (client) or functions/_lib/user.js (server).');
  process.exit(1);
}
console.log('verify:user OK — no direct quiz-blob access outside the facade layer');
