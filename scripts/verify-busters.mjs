// verify:busters — the cache-stamp drift gate.
//
// /assets/* ships `immutable, max-age=1y`, so a stamp is the only thing that
// ever makes a browser refetch. Two failure shapes have shipped before this
// gate existed:
//   1. Drift: quiz.html served coach.js?v=20260720c while coach.html had `l`
//      — two pages, same module, different bytes, invisible until it misbehaves.
//      JS-injected references (HUB_LAZY_MODULES) can drift the same way.
//   2. Stale stamp: a file changes but a page keeps the old stamp, so users
//      hold the old bytes for up to a year.
// This walks every ?v= reference in *.html, assets/js, assets/css and
// functions/**/*.js and asserts: one stamp per asset across the whole repo,
// the referenced file exists, and the stamp's date is not older than the
// file's last git change. HTML is now also emitted from Pages Functions (S13's
// career pages, for one) — those templates carry their own `?v=` stamps in JS
// string literals, invisible to a *.html walk, so functions/ is walked too or
// their stamps could drift from the rest of the site undetected.
// (Same-day re-stamps with different bytes — the favicon bug — are not
// detectable from a date; the letter suffix discipline is the guard there.)
//
// Run: npm run verify:busters

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ASSET_EXT = /\.(js|css|json|png|svg|ico|woff2)$/i;
const REF_RE = /[A-Za-z0-9_@/.-]+\?v=([0-9a-z]+)/g;

// S2: og:image must be an ABSOLUTE url (relative ones are ignored by most
// scrapers), so the share cards are referenced as
// `https://flightway.ai/assets/og/og-default.png?v=…`. REF_RE's character class
// stops at the `:`, so the match arrives as `flightway.ai/assets/…` — a path
// that resolves to nothing and would fail the existence check. Same-origin
// absolute references are still /assets/* under the 1-year immutable rule, so
// they need checking, not skipping: strip the host back to a rooted path.
const SITE_HOSTS = ['flightway.ai', 'www.flightway.ai', 'flightwayjacobprototype.pages.dev'];
function derefSameOrigin(rawPath) {
  // REF_RE's class excludes ':' but includes '/', so an absolute url arrives as
  // `//flightway.ai/assets/…` — the scheme is gone but the protocol-relative
  // slashes are not. Drop them before matching the host.
  const bare = rawPath.replace(/^\/+/, '');
  for (const host of SITE_HOSTS) {
    if (bare.startsWith(`${host}/`)) return bare.slice(host.length);
  }
  return rawPath;
}

function* sourceFiles() {
  for (const f of fs.readdirSync(ROOT)) {
    if (f.endsWith('.html')) yield path.join(ROOT, f);
  }
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.(js|css)$/.test(e.name) ? [p] : []);
  });
  yield* walk(path.join(ROOT, 'assets'));
  yield* walk(path.join(ROOT, 'functions'));
}

// asset repo-path -> Map(stamp -> [referencing files])
const refs = new Map();
for (const file of sourceFiles()) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(REF_RE)) {
    const [full, stamp] = m;
    const rawPath = derefSameOrigin(full.slice(0, full.indexOf('?')));
    if (!ASSET_EXT.test(rawPath)) continue;
    let assetPath = rawPath.startsWith('/')
      ? rawPath.slice(1)
      : path.relative(ROOT, path.resolve(path.dirname(file), rawPath));
    if (!fs.existsSync(path.join(ROOT, assetPath)) && !rawPath.includes('/')) {
      // A bare filename in JS is usually `SOME_BASE + 'name.json?v=…'` — the
      // base is runtime string concat we cannot see. The one base in use is
      // the O*NET artifacts dir; anything else is skipped with a warning.
      const artifact = path.join('data/onet/artifacts', rawPath);
      if (fs.existsSync(path.join(ROOT, artifact))) assetPath = artifact;
      else { console.warn(`  warn: cannot resolve '${full}' in ${path.relative(ROOT, file)} — skipped`); continue; }
    }
    if (!refs.has(assetPath)) refs.set(assetPath, new Map());
    const byStamp = refs.get(assetPath);
    if (!byStamp.has(stamp)) byStamp.set(stamp, []);
    byStamp.get(stamp).push(path.relative(ROOT, file));
  }
}

const dirty = new Set(
  execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((l) => l.slice(3).trim()).filter(Boolean),
);

function lastChangeDate(assetPath) {
  if (dirty.has(assetPath)) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    return execFileSync(
      'git', ['log', '-1', '--format=%ad', '--date=format:%Y%m%d', '--', assetPath],
      { cwd: ROOT, encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

let fail = 0;
const problem = (msg) => { fail += 1; console.error(`  FAIL ${msg}`); };

for (const [assetPath, byStamp] of [...refs.entries()].sort()) {
  if (byStamp.size > 1) {
    const detail = [...byStamp.entries()]
      .map(([s, files]) => `?v=${s} in ${[...new Set(files)].join(', ')}`).join(' vs ');
    problem(`${assetPath} is served at ${byStamp.size} different stamps: ${detail}`);
  }
  if (!fs.existsSync(path.join(ROOT, assetPath))) {
    problem(`${assetPath} is referenced with a stamp but does not exist on disk`);
    continue;
  }
  const changed = lastChangeDate(assetPath);
  if (!changed) continue; // untracked-but-present (new asset pre-commit) — date check has nothing to compare
  for (const stamp of byStamp.keys()) {
    const stampDate = (stamp.match(/^(\d{8})/) || [])[1];
    if (stampDate && stampDate < changed) {
      // /data/* ships max-age=1d, not immutable — a stale stamp there
      // self-heals within a day, so it is drift-noise, not a pinning bug.
      if (assetPath.startsWith('data/')) {
        console.warn(`  warn: ${assetPath} changed ${changed}, referenced at ?v=${stamp} (1-day cache rule — cosmetic)`);
        continue;
      }
      problem(`${assetPath} changed ${changed} but is still referenced at ?v=${stamp} `
        + `(${[...new Set(byStamp.get(stamp))].join(', ')}) — users keep the old bytes`);
    }
  }
}

console.log(`verify:busters — ${refs.size} stamped assets checked`);
console.log(fail ? `verify:busters FAIL — ${fail} problem(s)` : 'verify:busters PASS');
process.exit(fail ? 1 : 0);
