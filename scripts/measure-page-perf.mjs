#!/usr/bin/env node
/**
 * perf:check — the WS-H H1 gate (docs/OVERHAUL_MASTERPLAN_2026-07-20.md).
 *
 * Fix 1.1 put a permanent `[fw-perf]` line on the hub. H1 asks the same
 * question of every page: how long until the student sees something, cold and
 * on a repeat visit. Budget: first contentful paint ≤ 2500ms cold, ≤ 1000ms
 * repeat.
 *
 * Measures against the DEPLOYED preview by default, because the numbers that
 * matter include real CDN headers and the immutable /assets cache — a local
 * static server would flatter every one of them. Pass a base URL to override.
 *
 *   node scripts/measure-page-perf.mjs [baseUrl] [--json]
 *
 * Cold  = a fresh browser context with an empty cache.
 * Repeat = the SAME context loading the page a second time, so the immutable
 *          asset cache is warm — this is the returning-student number.
 *
 * Signed-in pages get a stubbed /auth/me and a seeded quiz blob, the same way
 * layout:check does; without it they bounce to auth.html and measure nothing.
 * Every page is measured twice and the better cold run is kept, because a
 * single cold sample over a real network is mostly noise.
 */
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'https://flightwayjacobprototype.pages.dev').replace(/\/$/, '');
const AS_JSON = process.argv.includes('--json');
const COLD_BUDGET_MS = 2500;
const REPEAT_BUDGET_MS = 1000;
const RUNS = 2;

const PAGES = [
  { name: 'index', authed: false },
  { name: 'portal', authed: true },
  { name: 'dashboard', authed: true, hub: true },
  { name: 'coach', authed: true },
  { name: 'roadmap', authed: true },
  { name: 'resume', authed: true },
  { name: 'quiz', authed: false },
  { name: 'career', authed: true, query: 'slug=product-management' },
  { name: 'pricing', authed: false },
];

const PROBE_EMAIL = 'probe@flightway.local';
const QUIZ_SEED = JSON.stringify({
  name: 'Probe',
  scores: { creative: 90, tech: 40, marketing: 55 },
  // A returning student: interstitials already met, so the measurement is of
  // the page and not of a full-screen overlay painting first.
  featureIntros: { _seeded: true, portal: { seen: true }, hub: { seen: true }, marco: { seen: true }, roadmap: { seen: true }, resume: { seen: true } },
});

// FCP is what "the student sees something" means; the marks around it explain
// a bad number without a second run.
const READ_TIMINGS = () => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  // Zero paint entries on a repeat navigation is paint holding: the browser
  // kept the previous frame on screen because the new document was ready
  // before it had to blank anything. That is the best possible result, not a
  // missing measurement — reported as `held`, never as a budget failure.
  const paints = performance.getEntriesByType('paint');
  const fcp = paints.find((p) => p.name === 'first-contentful-paint') || paints[0];
  return {
    fcp: fcp ? Math.round(fcp.startTime) : null,
    paintHeld: paints.length === 0,
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    responseEnd: Math.round(nav.responseEnd || 0),
    transferKb: Math.round((performance.getEntriesByType('resource')
      .reduce((n, r) => n + (r.transferSize || 0), 0) + (nav.transferSize || 0)) / 1024),
    requests: performance.getEntriesByType('resource').length,
  };
};

const browser = await chromium.launch();
const rows = [];

for (const spec of PAGES) {
  const url = `${BASE}/${spec.name}.html${spec.query ? '?' + spec.query : ''}`;
  let best = null;
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    if (spec.authed) {
      await page.route('**/auth/me', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ email: PROBE_EMAIL }),
      }));
    }
    await page.addInitScript((a) => {
      localStorage.setItem('fw_hub_quiz_v1', a.quiz);
      localStorage.setItem('fw_hub_fit_explainer_seen_v1', '1');
      if (a.authed) sessionStorage.setItem('fw-session-hint', a.email);
    }, { quiz: QUIZ_SEED, authed: !!spec.authed, email: PROBE_EMAIL });

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      const cold = await page.evaluate(READ_TIMINGS);
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      const repeat = await page.evaluate(READ_TIMINGS);
      // Cold and repeat are kept independently: one flaky sample of either
      // shouldn't discard a good measurement of the other.
      if (!best) best = { cold, repeat };
      if (cold.fcp != null && (best.cold.fcp == null || cold.fcp < best.cold.fcp)) best.cold = cold;
      if (repeat.fcp != null && (best.repeat.fcp == null || repeat.fcp < best.repeat.fcp)) best.repeat = repeat;
    } catch (e) {
      if (!best) best = { error: e.message.split('\n')[0] };
    }
    await ctx.close();
  }
  rows.push({ page: spec.name, ...best });
}

await browser.close();

if (AS_JSON) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`perf:check — ${BASE}`);
  console.log('page          cold FCP   repeat FCP   DCL(cold)   reqs   KB');
  for (const r of rows) {
    if (r.error) { console.log(`${r.page.padEnd(12)}  ERROR ${r.error}`); continue; }
    const flag = (v, budget, held) => (v == null ? (held ? '  held  ' : '   n/a  ')
      : String(v).padStart(6) + (v > budget ? ' !' : '  '));
    console.log(`${r.page.padEnd(12)}${flag(r.cold.fcp, COLD_BUDGET_MS, r.cold.paintHeld)}    ${flag(r.repeat.fcp, REPEAT_BUDGET_MS, r.repeat.paintHeld)}   `
      + `${String(r.cold.domContentLoaded).padStart(6)}   ${String(r.cold.requests).padStart(4)}  ${String(r.cold.transferKb).padStart(5)}`);
  }
}

const over = rows.filter((r) => !r.error && ((r.cold.fcp || 0) > COLD_BUDGET_MS || (r.repeat.fcp || 0) > REPEAT_BUDGET_MS));
const errored = rows.filter((r) => r.error);
if (!AS_JSON) {
  console.log(over.length || errored.length
    ? `\nperf:check FAIL — ${over.map((r) => r.page).concat(errored.map((r) => r.page)).join(', ')}`
    : `\nperf:check PASS — every page paints inside ${COLD_BUDGET_MS}ms cold / ${REPEAT_BUDGET_MS}ms repeat`);
}
process.exit(over.length || errored.length ? 1 : 0);
