// FlightWay — where is every branch, and what is each environment actually running?
//
//   npm run env:status
//
// Run this BEFORE and AFTER any push. It answers, in one screen, the four
// questions that have caused every deploy confusion in this repo:
//
//   1. Is my working tree clean, and is my branch pushed?
//   2. What commit is each Cloudflare project actually SERVING right now
//      (not what did I push — what is live)?
//   3. How far apart are prototype and production?
//   4. Is each site in the Stripe mode it is supposed to be in?
//
// Topology (see docs/BRANCH_AND_ENV_PROTOCOL.md):
//   Jacob_Work -> Pages project `flightway`prototype -> flightwayjacobprototype.pages.dev  (test Stripe)
//   main       -> Pages project `flightway`          -> flightway.ai                       (live Stripe)
//
// Read-only. Needs git, network, and wrangler auth for the deployed-commit
// lookup; degrades to "unknown" rather than failing if wrangler is not logged in.

import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch { return ''; }
};

const ENVS = [
  {
    name: 'PROTOTYPE', branch: 'Jacob_Work', project: 'flightwayprototype',
    url: 'https://flightwayjacobprototype.pages.dev', expectTestMode: true,
  },
  {
    name: 'PRODUCTION', branch: 'main', project: 'flightway',
    url: 'https://flightway.ai', expectTestMode: false,
  },
];

/** The commit sha of the newest Production deployment of a Pages project. */
function deployedSha(project) {
  // `--environment production` is REQUIRED, not tidiness. Without it the list is
  // the newest deployments of ANY environment, and the `flightway` project's
  // first page is entirely Jacob_Work PREVIEW builds (that project still builds
  // previews for the other branch) — the scan below then never reaches a
  // Production row, returns null, and the line reads "unknown (wrangler not
  // authenticated?)" while wrangler is perfectly authenticated. Observed on
  // merge day 2026-07-25, on the one line that mattered most.
  const out = run('npx', ['wrangler', 'pages', 'deployment', 'list',
    '--project-name', project, '--environment', 'production']);
  if (!out) return null;
  // Rows are box-drawn; the first Production row is the newest.
  for (const line of out.split('\n')) {
    if (!line.includes('Production')) continue;
    const cells = line.split('│').map((c) => c.trim());
    const sha = cells.find((c) => /^[0-9a-f]{7,40}$/.test(c));
    if (sha) return sha.slice(0, 7);
  }
  return null;
}

async function liveConfig(url) {
  try {
    const res = await fetch(`${url}/config`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) { return { error: err?.message || 'unreachable' }; }
}

const dirty = run('git', ['status', '--porcelain']).split('\n').filter(Boolean);
run('git', ['fetch', '--quiet', 'origin']);

console.log('\nFlightWay — branch / environment status\n');

let problems = 0;
for (const env of ENVS) {
  const originSha = run('git', ['rev-parse', '--short', `origin/${env.branch}`]) || '?';
  const deployed = deployedSha(env.project);
  const cfg = await liveConfig(env.url);

  console.log(`  ${env.name}  ${env.branch} → ${env.project} → ${env.url}`);
  console.log(`    origin/${env.branch.padEnd(12)} ${originSha}`);

  if (!deployed) {
    console.log('    deployed        unknown  (wrangler not authenticated?)');
  } else if (deployed === originSha) {
    console.log(`    deployed        ${deployed}  ✓ serving the branch tip`);
  } else {
    const behind = run('git', ['rev-list', '--count', `${deployed}..origin/${env.branch}`]);
    console.log(`    deployed        ${deployed}  ✗ ${behind || '?'} commit(s) behind the branch tip`);
    console.log('                             (build still running, or the build failed)');
    problems++;
  }

  if (cfg.error) {
    console.log(`    /config         unreachable: ${cfg.error}`);
    problems++;
  } else {
    const mode = cfg.stripeTestMode ? 'TEST' : 'LIVE';
    const want = env.expectTestMode ? 'TEST' : 'LIVE';
    const ok = mode === want;
    console.log(`    stripe          ${mode} mode${ok ? '' : `  ✗ EXPECTED ${want}`}`
      + `${ok ? `  → uses the ${mode === 'TEST' ? '_TEST' : 'unsuffixed'} price ids` : ''}`);
    if (!ok) problems++;
    console.log(`    paywall         ${cfg.paywallEnabled ? 'on' : 'off'}`
      + `    ai ${cfg.aiEnabled ? 'key present' : 'NO KEY'}`);
    if (!cfg.aiEnabled) problems++;
  }
  console.log('');
}

// ── how far apart are the two branches ──────────────────────────────────────
const ahead = run('git', ['rev-list', '--count', 'origin/main..origin/Jacob_Work']);
const behind = run('git', ['rev-list', '--count', 'origin/Jacob_Work..origin/main']);
console.log('  BRANCH DELTA');
console.log(`    in Jacob_Work, not in main   ${ahead}   ${Number(ahead) ? '(unreleased — prototype is ahead)' : '(nothing pending)'}`);
console.log(`    in main, not in Jacob_Work   ${behind}  ${Number(behind) ? '✗ production has commits prototype lacks — see the protocol doc' : '(clean fast-forward available)'}`);
if (Number(behind)) problems++;

console.log('\n  WORKING TREE');
if (!dirty.length) console.log('    clean');
else {
  console.log(`    ${dirty.length} uncommitted change(s):`);
  for (const d of dirty.slice(0, 10)) console.log(`      ${d}`);
  if (dirty.length > 10) console.log(`      … and ${dirty.length - 10} more`);
}

console.log('');
if (problems) {
  console.log(`${problems} thing(s) need attention — see docs/BRANCH_AND_ENV_PROTOCOL.md\n`);
  process.exit(1);
}
console.log('Both environments are serving their branch tip in the right Stripe mode.\n');
