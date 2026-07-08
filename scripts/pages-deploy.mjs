#!/usr/bin/env node
/**
 * Deploy to Cloudflare Pages without uploading dev-only paths (e.g. .onet-cache).
 * Pages deploy does not read .assetsignore; large local ETL caches must be excluded here.
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectName = process.argv[2] || 'flightwayjacobprototype';
const branch = process.argv[3] || 'Jacob_Work';

const staging = mkdtempSync(join(tmpdir(), 'fw-pages-'));
const excludes = [
  '.onet-cache',
  'node_modules',
  '.git',
  '.wrangler',
  '.cursor',
  '.DS_Store',
];

const rsyncArgs = ['-a', ...excludes.flatMap((item) => ['--exclude', item]), `${ROOT}/`, `${staging}/`];
const rsync = spawnSync('rsync', rsyncArgs, { stdio: 'inherit' });
if (rsync.status !== 0) {
  rmSync(staging, { recursive: true, force: true });
  process.exit(rsync.status || 1);
}

// Minify the staged copy of /assets only. Repo sources stay readable; Functions
// are compiled by wrangler and must not be touched here. A file that fails to
// minify ships as-is rather than failing the deploy.
function minifyTree(dir) {
  let saved = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { saved += minifyTree(full); continue; }
    const ext = extname(entry);
    if (ext !== '.js' && ext !== '.css') continue;
    const src = readFileSync(full, 'utf8');
    try {
      const out = transformSync(src, { loader: ext === '.js' ? 'js' : 'css', minify: true });
      writeFileSync(full, out.code);
      saved += src.length - out.code.length;
    } catch (err) {
      console.warn(`minify skipped ${full}: ${err.message}`);
    }
  }
  return saved;
}
const savedBytes = minifyTree(join(staging, 'assets'));
console.log(`minified /assets: ${(savedBytes / 1024).toFixed(0)}KB removed pre-gzip`);

const deploy = spawnSync(
  'npx',
  [
    'wrangler',
    'pages',
    'deploy',
    staging,
    `--project-name=${projectName}`,
    `--branch=${branch}`,
    '--commit-dirty=true',
  ],
  { stdio: 'inherit', cwd: ROOT },
);

rmSync(staging, { recursive: true, force: true });
process.exit(deploy.status || 0);
