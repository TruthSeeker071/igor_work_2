// FlightWay — environment/secret completeness check across every deploy target.
//
//   npm run verify:env
//
// Why this exists: there are THREE independent configuration stores and nothing
// previously compared them.
//
//   flightway           Pages project, branch main       -> flightway.ai
//   flightwayprototype  Pages project, branch Jacob_Work -> flightwayjacobprototype.pages.dev
//   flightway-cron      standalone Worker (wrangler deploy, NOT Pages)
//
// Pages secrets and Worker secrets are separate stores; setting one does not
// touch the other. That is exactly how the cron Worker ended up with zero
// secrets and silently never sent an email.
//
// This reads NAMES only — `wrangler secret list` never returns values, so this
// can prove a secret is *absent*, never that two environments hold the SAME
// value. For the one place that matters (UNSUB_SECRET, which must match across
// all three or unsubscribe links fail), see the rotate-everywhere command in
// the WARNINGS output below.
//
// Requires wrangler auth. Not part of `npm run gates` — it needs the network
// and an authenticated account, so it is a deliberate manual check.

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the matrix ──────────────────────────────────────────────────────────────
// `required` — absence is a hard failure.
// `advised`  — has a working fallback, but the fallback is a shared/guessable
//              value and the var should be set explicitly in production.
const PAGES_REQUIRED = [
  'GEMINI_API_KEY',       // no fallback; every AI surface dies without it
  'SESSION_PEPPER',       // falls back to GEMINI_API_KEY then 'flightway-dev-pepper'
  'STRIPE_SECRET_KEY',    // no fallback; checkout unavailable
  'STRIPE_WEBHOOK_SECRET',// falls back to '' -> webhook 500s, plans never flip
  'RESEND_API_KEY',       // no fallback; password reset + result emails die
];
const PAGES_ADVISED = [
  'UNSUB_SECRET',         // falls back to SESSION_PEPPER (works, but then it
                          // differs from any env that DOES set it -> token mismatch)
  'INTENT_PEPPER',        // falls back to SESSION_PEPPER
];
// S2: purely optional. Turnstile is only rendered when BOTH halves are present
// (/config serves the site key; functions/contact.js holds the secret), and the
// contact + register forms work identically without it. Listed so a half-set
// pair — the one configuration that would show a broken widget — is visible.
// S5 (D6): also optional. The "Continue with Google" buttons render only when
// BOTH halves are set (/config serves googleAuthEnabled; the callback holds the
// secret). A client id with no secret would show a button whose flow 500s at the
// token exchange, so a half-set pair is surfaced the same way Turnstile's is.
const PAGES_OPTIONAL_PAIRS = [
  ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
  ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
];
// S15 (D24): single optional vars whose ABSENCE changes what the product
// promises, so it has to be visible rather than assumed. Unset is a legitimate
// state for each — the referral loop still credits the referrer without a promo
// code, it just cannot give the friend their free month, and the invite surfaces
// say so out loud instead of promising one.
const PAGES_OPTIONAL_SINGLES = {
  STRIPE_REFERRAL_PROMO_ID: 'the referee’s free month (D24) — without it the invite copy drops that promise',
  REFERRAL_CREDIT_CENTS: 'overrides the monthly price as the referrer credit; unset = read from Stripe',
};
// Only the live site needs a root admin identity.
const PROD_ONLY_REQUIRED = ['ROOT_ADMIN_EMAIL'];

const CRON_REQUIRED_SECRETS = ['RESEND_API_KEY', 'UNSUB_SECRET'];
const CRON_REQUIRED_VARS = ['SITE_URL', 'FROM_EMAIL'];
// Required by CAN-SPAM in every commercial email, but only once one is actually
// sent. Nothing sends today (no user has notify_optin = 1), so an unset value
// is not a broken deployment — it is a blocker on the FIRST send, and this
// warns rather than fails so the real failures stay visible.
const CRON_BEFORE_FIRST_SEND_VARS = ['MAILING_ADDRESS'];
// S9: the nightly Deadline Radar refresh needs BOTH — the flag (a var in the
// cron's wrangler.toml) and the key (a secret on the Worker). With the flag on
// and no key, the loop wakes every night, marks users refreshed for a week and
// gets nothing back: a dead feature that looks configured. Neither set is fine
// — the step is inert by design until Jacob turns it on.
const CRON_GROUNDING_VAR = 'GROUNDING_ENABLED';
const CRON_GROUNDING_SECRET = 'GEMINI_API_KEY';
// S16: the quarterly readiness sweep rides the SAME pair — it is the second and
// more expensive consumer of it, so turning grounding on for the radar switches
// this on too. Reported (never required) so the cost is visible at the moment
// the flag is flipped rather than discovered in a bill.
const CRON_GROUNDING_RIDERS = {
  DEADLINE_REFRESH_DAILY_CAP: 'accounts per night for the S9 radar refresh (default 50)',
  SCORECARD_AUTO_DAILY_CAP: 'accounts per night for the S16 quarterly scorecard (default 20)',
};

const ROOT_REQUIRED_VARS = [
  'ALLOWED_ORIGIN', 'PAYWALL_ENABLED', 'GROUNDING_ENABLED',
  'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL',
  'STRIPE_PRICE_LIFETIME', 'STRIPE_PRICE_SPRINT',
];

// ── helpers ─────────────────────────────────────────────────────────────────
function wrangler(args) {
  try {
    return execFileSync('npx', ['wrangler', ...args], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return `__ERROR__ ${err?.stderr || err?.message || err}`;
  }
}

/** Secret NAMES for a Pages project. Output is a human-readable "  - NAME: ..." list. */
function pagesSecrets(project) {
  const out = wrangler(['pages', 'secret', 'list', '--project-name', project]);
  if (out.startsWith('__ERROR__')) return { error: out.slice(10).trim().split('\n')[0] };
  return { names: [...out.matchAll(/^\s+-\s+([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]) };
}

/** Secret NAMES for the cron Worker. `secret list` emits JSON here. */
function workerSecrets() {
  const out = wrangler(['secret', 'list', '-c', 'workers/cron/wrangler.toml']);
  if (out.startsWith('__ERROR__')) return { error: out.slice(10).trim().split('\n')[0] };
  try {
    const json = JSON.parse(out.slice(out.indexOf('[')));
    return { names: json.map((s) => s.name) };
  } catch {
    return { names: [...out.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]) };
  }
}

/** Uncommented `KEY = "value"` assignments in a wrangler.toml. */
function tomlVars(relPath) {
  let src;
  try { src = readFileSync(join(root, relPath), 'utf8'); } catch { return []; }
  return [...src.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*["']/gm)].map((m) => m[1]);
}

// ── run ─────────────────────────────────────────────────────────────────────
const problems = [];
const warnings = [];
let checks = 0;

function report(label, present, required, advised = []) {
  console.log(`\n── ${label} ──`);
  if (present.error) {
    console.log(`  ! could not read: ${present.error}`);
    problems.push(`${label}: could not be read (wrangler auth?)`);
    return;
  }
  const have = new Set(present.names);
  for (const key of required) {
    checks++;
    const ok = have.has(key);
    console.log(`  ${ok ? 'ok  ' : 'MISS'} ${key}`);
    if (!ok) problems.push(`${label}: ${key} is missing`);
  }
  for (const key of advised) {
    checks++;
    const ok = have.has(key);
    console.log(`  ${ok ? 'ok  ' : 'warn'} ${key}${ok ? '' : '  (falls back to SESSION_PEPPER)'}`);
    if (!ok) warnings.push(`${label}: ${key} unset — falls back to SESSION_PEPPER`);
  }
  // S2: an optional feature is only half-configured when exactly one of its
  // keys exists. That state is worse than "off" — Turnstile with a site key and
  // no secret renders a challenge nobody can pass — and it is invisible to a
  // required/advised list, because neither key is required.
  for (const pair of PAGES_OPTIONAL_PAIRS) {
    const set = pair.filter((k) => have.has(k));
    if (set.length && set.length !== pair.length) {
      console.log(`  warn ${pair.join(' + ')} — only ${set.join(', ')} is set`);
      warnings.push(`${label}: ${pair.join('/')} is half-configured — set both or neither`);
    } else if (set.length) {
      console.log(`  ok   ${pair.join(' + ')} (both set — feature enabled)`);
    }
  }
  for (const [key, why] of Object.entries(PAGES_OPTIONAL_SINGLES)) {
    if (!have.has('STRIPE_SECRET_KEY')) break; // not a Stripe-carrying target
    console.log(`  ${have.has(key) ? 'ok  ' : '--  '} ${key}${have.has(key) ? '' : `  (unset — ${why})`}`);
  }
  const extra = present.names.filter((n) => !required.includes(n) && !advised.includes(n));
  if (extra.length) console.log(`  --   also set: ${extra.join(', ')}`);
}

console.log('FlightWay — environment completeness across all three deploy targets');

report('flightway (Pages -> flightway.ai)',
  pagesSecrets('flightway'), [...PAGES_REQUIRED, ...PROD_ONLY_REQUIRED], PAGES_ADVISED);

report('flightwayprototype (Pages -> pages.dev)',
  pagesSecrets('flightwayprototype'), PAGES_REQUIRED, PAGES_ADVISED);

// Read once — each call is a wrangler subprocess, and the grounding-pair check
// below needs the same list the report just printed.
const cronSecrets = workerSecrets();
report('flightway-cron (Worker) — secrets',
  cronSecrets, CRON_REQUIRED_SECRETS);

// Vars live in the repo, so these are checked from the files, not the API.
const cronVars = tomlVars('workers/cron/wrangler.toml');
console.log('\n── flightway-cron (Worker) — vars in workers/cron/wrangler.toml ──');
for (const key of CRON_REQUIRED_VARS) {
  checks++;
  const ok = cronVars.includes(key);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${key}`);
  if (!ok) problems.push(`flightway-cron: ${key} not set (commented out or absent in wrangler.toml)`);
}
for (const key of CRON_BEFORE_FIRST_SEND_VARS) {
  checks++;
  const ok = cronVars.includes(key);
  console.log(`  ${ok ? 'ok  ' : 'warn'} ${key}${ok ? '' : '  (not needed until the first email actually sends)'}`);
  if (!ok) warnings.push(`flightway-cron: ${key} unset — CAN-SPAM blocker on the FIRST send, not on today's deployment`);
}
{
  checks++;
  const flagOn = cronVars.includes(CRON_GROUNDING_VAR);
  const keySet = !cronSecrets.error && cronSecrets.names.includes(CRON_GROUNDING_SECRET);
  const half = flagOn && !keySet;
  console.log(`  ${half ? 'warn' : 'ok  '} ${CRON_GROUNDING_VAR} + ${CRON_GROUNDING_SECRET}`
    + (flagOn ? '' : '  (nightly Deadline Radar refresh + quarterly scorecards are OFF — deliberate default)'));
  if (half) {
    warnings.push(`flightway-cron: ${CRON_GROUNDING_VAR} is set but ${CRON_GROUNDING_SECRET} is not — the nightly Deadline Radar refresh and the quarterly scorecard sweep will both run and return nothing every night`);
  }
  // The two per-night caps ride the same switch. Printed only once grounding is
  // actually on, so an off deployment does not carry two lines about spend that
  // is not happening.
  if (flagOn) {
    for (const [key, why] of Object.entries(CRON_GROUNDING_RIDERS)) {
      console.log(`  ok   ${key}${cronVars.includes(key) ? '' : ' (unset — using the default)'}  ${why}`);
    }
  }
}

const rootVars = tomlVars('wrangler.toml');
console.log('\n── Pages vars in wrangler.toml [env.production.vars] ──');
for (const key of ROOT_REQUIRED_VARS) {
  checks++;
  const ok = rootVars.includes(key);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${key}`);
  if (!ok) problems.push(`wrangler.toml: ${key} not set`);
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('');
if (warnings.length) {
  console.log('WARNINGS (work, but drift-prone):');
  for (const w of warnings) console.log(`  - ${w}`);
  console.log('  UNSUB_SECRET must be IDENTICAL in all three targets or unsubscribe');
  console.log('  links fail. This check can only see names, never values. To force a');
  console.log('  match, rotate it everywhere at once:');
  console.log('    U=$(openssl rand -hex 32) \\');
  console.log('      && printf %s "$U" | npx wrangler pages secret put UNSUB_SECRET --project-name flightway \\');
  console.log('      && printf %s "$U" | npx wrangler pages secret put UNSUB_SECRET --project-name flightwayprototype \\');
  console.log('      && printf %s "$U" | npx wrangler secret put UNSUB_SECRET -c workers/cron/wrangler.toml; unset U');
  console.log('  Pages secrets bind at BUILD time — redeploy both projects afterwards.');
  console.log('');
}
if (problems.length) {
  console.log(`FAIL — ${problems.length} problem(s) of ${checks} checks:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`PASS — ${checks} checks, every required value present.`);
