#!/usr/bin/env node
/**
 * run-gates — the gate suite, in parallel, in one command.
 *
 * The suite is 39 independent scripts. Run serially (the hand-rolled bash loop
 * every session used to write) that is ~12 minutes of wall clock, which is why
 * the protocol's "full gate run before each commit" kept getting skipped or
 * quietly narrowed. Almost none of them actually contend, so they don't have to
 * be serial.
 *
 * Four lanes, chosen by what a gate contends on — NOT by what it tests:
 *   pure  — node only, no port, no network. Safe at high concurrency.
 *   port  — boots a local static server + Playwright. One port each (see
 *           PORTS below); concurrency capped because each one is a browser.
 *   live  — hits the deployed pages.dev. Network-bound, so cheap to overlap.
 *   solo  — perf:check MEASURES page load timings. Anything running beside it
 *           skews the numbers it asserts on, so it runs alone, last.
 *
 * The first three lanes run concurrently with each other; solo waits for them.
 * Wall time is therefore max(pure, port, live) + solo, ~2 min instead of ~12.
 *
 * Usage:
 *   node scripts/run-gates.mjs                 # all 39
 *   node scripts/run-gates.mjs --tier=unit     # offline only (pure+port) — the
 *                                              # per-slice gate; no network
 *   node scripts/run-gates.mjs --tier=live     # live+solo only
 *   node scripts/run-gates.mjs --only=test:endpoints,verify:busters
 *   node scripts/run-gates.mjs --jobs=4        # cap the pure lane
 *   node scripts/run-gates.mjs --list
 *
 * Per-gate output lands in .gates/<name>.log (gitignored) — the console shows
 * one line per gate so a failure is visible immediately, not after 12 minutes.
 * Exit code is nonzero if any gate failed; failures are re-listed at the end
 * with the tail of their log, so you rarely need to open the file.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = path.join(ROOT, '.gates');

// One port per port-lane gate. A shared port is why resume:ui-check and
// layout:check used to collide on 8934 — keep these distinct and keep each
// script reading its own env var.
const PORTS = {
  'hero:check': { HERO_CHECK_PORT: '4599' },
  'resume:ui-check': { RESUME_UI_PORT: '8937' },
  'opportunities:ui-check': {},
  'plan:ui-check': {},
  'artifacts:ui-check': { ARTIFACTS_UI_PORT: '8938' },
  'flightplan:ui-check': { FLIGHTPLAN_UI_PORT: '8940' },
  'layout:check': { LAYOUT_CHECK_PORT: '8934' },
  'test:quiz-funnel': { QUIZ_FUNNEL_PORT: '8939' },
};

/** name → lane. Adding a gate? Put it in the lane matching what it CONTENDS on. */
const GATES = [
  ['test:vectors', 'pure'],
  ['onet:test', 'pure'],
  ['hub:verify', 'pure'],
  ['verify:aliases', 'pure'],
  ['verify:user', 'pure'],
  ['test:user', 'pure'],
  ['test:sync', 'pure'],
  ['test:school', 'pure'],
  ['test:entitlements', 'pure'],
  ['test:admin', 'pure'],
  ['test:marco-voice', 'pure'],
  ['test:marco-ui', 'pure'],
  ['test:marco-stream', 'pure'],
  ['test:chat-turn', 'pure'],
  ['test:intro', 'pure'],
  ['test:weekly', 'pure'],
  ['test:opportunities', 'pure'],
  ['interview:check', 'pure'],
  ['resume:ats-check', 'pure'],
  ['resume:format-check', 'pure'],
  ['resume:tailor-check', 'pure'],
  ['stripe:check', 'pure'],
  ['grounding:check', 'pure'],
  ['verify:busters', 'pure'],
  ['verify:meta', 'pure'],
  ['seo:check', 'pure'],
  ['contrast:check', 'pure'],
  ['test:endpoints', 'pure'],
  ['test:events', 'pure'],
  ['test:referral', 'pure'],
  ['test:emails', 'pure'],
  ['test:purge', 'pure'],
  ['test:deadlines', 'pure'],
  ['test:scorecard', 'pure'],
  ['test:outreach', 'pure'],
  ['test:season', 'pure'],
  ['test:nps', 'pure'],
  ['test:cron', 'pure'],
  ['roadmap:layout', 'pure'],
  ['hero:check', 'port'],
  ['resume:ui-check', 'port'],
  ['opportunities:ui-check', 'port'],
  ['plan:ui-check', 'port'],
  ['artifacts:ui-check', 'port'],
  ['flightplan:ui-check', 'port'],
  ['test:quiz-funnel', 'port'],
  ['layout:check', 'port'],
  ['pages:smoke', 'live'],
  ['hub:smoke', 'live'],
  ['perf:check', 'solo'],
];

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

if (process.argv.includes('--list')) {
  for (const [name, lane] of GATES) console.log(`${lane.padEnd(5)} ${name}`);
  console.log(`\n${GATES.length} gates`);
  process.exit(0);
}

const tier = arg('tier', 'all');
const only = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const TIERS = { all: ['pure', 'port', 'live', 'solo'], unit: ['pure', 'port'], live: ['live', 'solo'] };
const lanes = TIERS[tier];
if (!lanes) { console.error(`unknown --tier=${tier} (all|unit|live)`); process.exit(2); }

// layout:check walks 330 cells (5 widths x 3 zooms x 2 themes x 11 pages) and
// costs ~13 minutes — more than the other 32 gates combined. Its --quick mode
// covers 18 cells in ~19s, which catches a broken layout while you are working;
// the full 270 is a pre-push gate, not a per-slice one. `--tier=unit`
// substitutes it, `--tier=all` keeps the full walk.
const QUICK_SUBS = { 'layout:check': 'layout:check:quick' };
const substitute = (name) => (tier === 'unit' && QUICK_SUBS[name]) || name;

const selected = GATES
  .filter(([name, lane]) => (only.length ? only.includes(name) : lanes.includes(lane)))
  .map(([name, lane]) => [substitute(name), lane]);
if (!selected.length) { console.error('no gates selected'); process.exit(2); }

const unknown = only.filter((n) => !GATES.some(([g]) => g === n));
if (unknown.length) { console.error(`unknown gate(s): ${unknown.join(', ')}`); process.exit(2); }

fs.rmSync(LOGS, { recursive: true, force: true });
fs.mkdirSync(LOGS, { recursive: true });

const results = new Map();
const started = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
/** A substituted gate keeps its original's lane and port env. */
const canonical = (name) => Object.keys(QUICK_SUBS).find((k) => QUICK_SUBS[k] === name) || name;
const laneOf = (name) => (GATES.find(([g]) => g === canonical(name)) || [])[1];
/** Lanes whose gates drive a browser or the network, so a red can be a flake. */
const RETRYABLE = new Set(['port', 'live', 'solo']);

function runGate(name, attempt = 1) {
  return new Promise((resolve) => {
    const logFile = path.join(LOGS, `${name.replace(/[:/]/g, '_')}.log`);
    const out = fs.createWriteStream(logFile);
    const t0 = Date.now();
    const child = spawn('npm', ['run', '--silent', name], {
      cwd: ROOT,
      env: { ...process.env, ...(PORTS[canonical(name)] || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on('error', (err) => {
      out.write(`\nspawn failed: ${err.message}\n`);
      finish(1);
    });
    child.on('close', (code) => finish(code));
    let done = false;
    function finish(code) {
      if (done) return;
      done = true;
      // Wait for the log stream to flush before classifying a failure — the
      // retry reason is read back out of this file.
      out.end(() => report(code));
    }
    function report(code) {
      const ms = Date.now() - t0;
      const ok = code === 0;
      // A browser gate that failed on a navigation timeout is almost always
      // contention or a live-network hiccup, not a defect — the parallel lanes
      // made these appear where the serial run had none. Retry once, alone, and
      // only call it a failure if it reproduces. A gate that fails on its own
      // assertions retries too; that costs one extra run and removes the
      // temptation to hand-wave a red gate as "probably flaky".
      if (!ok && attempt === 1 && RETRYABLE.has(laneOf(name))) {
        const why = /Timeout|ECONN|ERR_|EADDRINUSE|net::/i.test(fs.readFileSync(logFile, 'utf8')) ? 'timeout/network' : 'assertion';
        console.log(` retry ${name.padEnd(24)} ${secs(ms).padStart(7)}  (${why})`);
        resolve(runGate(name, 2));
        return;
      }
      results.set(name, { ok, ms, logFile, attempt });
      const tag = ok ? (attempt > 1 ? '  ok* ' : '  ok  ') : ' FAIL ';
      console.log(`${tag} ${name.padEnd(24)} ${secs(ms).padStart(7)}`);
      resolve();
    }
  });
}

/** Run `names` with at most `limit` in flight. */
async function lane(names, limit) {
  const queue = [...names];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await runGate(queue.shift());
  });
  await Promise.all(workers);
}

const of = (l) => selected.filter(([, lane_]) => lane_ === l).map(([n]) => n);
const jobs = Number(arg('jobs', String(Math.min(8, Math.max(2, os.cpus().length - 2)))));

console.log(`run-gates — ${selected.length} gates, tier=${tier}, pure lane x${jobs}\n`);

// pure + port + live overlap; solo waits for a quiet machine.
await Promise.all([
  lane(of('pure'), jobs),
  lane(of('port'), 3),
  lane(of('live'), 2),
]);
await lane(of('solo'), 1);

const failed = [...results.entries()].filter(([, r]) => !r.ok);
const wall = Date.now() - started;
const serial = [...results.values()].reduce((a, r) => a + r.ms, 0);

console.log(`\n${results.size - failed.length}/${results.size} passed in ${secs(wall)} `
  + `(${secs(serial)} of work — ${(serial / wall).toFixed(1)}x)`);

for (const [name, r] of failed) {
  console.log(`\n─── FAIL ${name} ─────────────────────────────`);
  const text = fs.readFileSync(r.logFile, 'utf8').trimEnd().split('\n');
  console.log(text.slice(-15).join('\n'));
  console.log(`    full log: ${path.relative(ROOT, r.logFile)}`);
}

process.exit(failed.length ? 1 : 0);
