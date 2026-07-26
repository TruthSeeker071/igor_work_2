// flightplan:ui-check — V2 exit QA for flightplan.html's render layer.
//
// S16 (readiness scorecard), S17 (network mapper), S18 (interview season +
// your term) and S19 (NPS) all shipped server-side logic covered by their own
// pure gates (test:scorecard/test:outreach/test:season/test:nps) — this gate
// does not re-test any of that. What it proves is the half a Node test can't:
// every throwaway Playwright probe run by hand during those sessions found a
// real render-layer defect (a missing "%" on a rendered score; a `[hidden]`
// vs author-display CSS bug) that a pure-logic test cannot see. So this gate
// checks exactly that class of thing and nothing else: the page BOOTS clean,
// each of the four panels MOUNTS its no-data state as real rendered text, and
// the NPS card walks its two steps end to end.
//
// Serves the working tree with a stubbed /config (paywall ON, real cap table)
// and /auth/me (free plan), plus one fixture per panel GET matching that
// panel's own "nothing yet" shape, plus a generic catch-all for every other
// same-origin API path so the page never hits a dead network path — same
// pattern as smoke-plan-ui.mjs, extended because this page mounts five panels
// instead of one.
//
// Port 8940 (FLIGHTPLAN_UI_PORT overrides): 4599/8931/8934/8935/8936/8937/
// 8938/8939 are already owned by hero/screenshots/layout/opportunities/plan/
// resume-ui/artifacts/quiz-funnel — one port per gate is the house rule.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { publicFeatureLimits } from '../functions/_lib/plan-limits.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FLIGHTPLAN_UI_PORT || 8940);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const EMAIL = 'probe@flightway.local';
// Same base shape as smoke-plan-ui.mjs's QUIZ_SEED. `flightplan` is the one
// featureIntros key this page's own boot script checks unconditionally
// (<body data-fw-intro="flightplan">) — without it, FWFeatureIntro.auto()
// opens a full-screen interstitial over the page during our settle window,
// which would block the NPS click-walk. `interview-season` and `semester`
// are only ever shown from an explicit button press (season/term panels'
// own "Start"/"Set up" handlers), which none of our six assertions trigger,
// so they need no seed.
const QUIZ_SEED = JSON.stringify({
  name: 'Probe',
  scores: { tech: 80, people: 40 },
  careerFocus: { soc: '15-2051.00', slug: 'test-career', name: 'Test Career' },
  featureIntros: { _seeded: true, flightplan: { seen: true } },
});

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok - ${name}`); }
  catch (err) { failures += 1; console.error(`  FAIL - ${name}\n    ${err.message}`); }
}

// The real cap table, straight from the module the server enforces.
const LIMITS = publicFeatureLimits();
const REMAINING = {
  'marco-chat': 3, 'roadmap-generate': 1, 'career-sim': 1, 'opportunity-search': 1,
  'resume-draft': 1, 'mock-interview': 1, 'marco-thread': 2, 'deadline-refresh': 1,
  'scorecard-run': 1, 'outreach-draft': 2,
};

// One fixture per panel GET, each the panel's own "nothing yet" shape (read
// straight off scorecard-panel.js / network-panel.js / season-panel.js /
// term-panel.js's applyGetData()) — never a populated report, since this gate
// checks the no-data mount, not the business logic already covered by
// test:scorecard/test:outreach/test:season/test:nps.
const SCORECARD_EMPTY = {
  ready: true, groundingOn: true, id: '', at: null, report: null, trend: [],
  cap: null, reason: '', message: '',
};
const OUTREACH_EMPTY = {
  ready: true,
  contacts: [],
  // One suggestion so the list-is-empty state renders its real shape
  // (intro + suggestion cards), not just the separate no-career message.
  suggestions: [{
    archetype: 'alum', label: 'A recent alum in your target field', orgType: 'university',
    why: 'They remember what the first internship search felt like.',
    howToFind: 'Your school’s alumni directory, or a LinkedIn alumni search for your major.',
  }],
  networkSteps: [], statuses: ['suggested', 'drafted', 'sent', 'replied', 'met'],
  cap: null, full: false, reason: '', message: '',
};
const SEASON_NONE = {
  ready: true, locked: false, season: null, program: null, lockedWeeks: 0, weekNow: 0,
  progress: null, trend: [], headline: '', careerName: 'Data Analyst', stale: false,
  reason: '', message: '',
};
const TERM_NONE = {
  ready: true, term: null, review: null, canReview: false, headline: '',
  systems: ['semester', 'quarter', 'trimester'], maxOutcomes: 3, message: '',
};

/** Register a JSON fixture at an exact pathname (query strings ignored). */
function stub(page, pathname, body, status = 200) {
  return page.route((u) => u.pathname === pathname, (route) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
  }));
}

async function openFlightplan(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const npsPosts = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // Generic catch-all, registered FIRST so it has the LOWEST priority —
  // Playwright checks routes in reverse registration order, so every specific
  // stub registered below still wins. Any same-origin path with no file
  // extension (i.e. an API call, not a static asset) gets a harmless 200 {}
  // (204 for the /events beacon) so the page never hits a dead network path:
  // /weekly-plan, /deadlines, /artifacts, /referral, /share, /notify-prefs,
  // /portal-snapshot, /career-focus, /profile* and friends all land here.
  await page.route(() => true, (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.origin !== ORIGIN) return route.continue();
    if (path.extname(u.pathname)) return route.continue(); // static asset -> real file server
    if (u.pathname === '/events') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await stub(page, '/config', {
    paywallEnabled: true, stripeEnabled: false, stripeTestMode: false, featureLimits: LIMITS,
  });
  await stub(page, '/auth/me', {
    email: EMAIL, plan: 'free', planRaw: 'free', paywall: true, remaining: REMAINING,
  });
  await stub(page, '/scorecard', SCORECARD_EMPTY);
  await stub(page, '/outreach', OUTREACH_EMPTY);
  await stub(page, '/interview-season', SEASON_NONE);
  await stub(page, '/semester', TERM_NONE);

  // /nps: GET is the eligibility check (query-string moment), POST is the
  // score/dismiss submission — same path, so it needs its own method branch
  // rather than the flat stub() helper. The POST body is captured for the
  // NPS-walk test to assert against.
  await page.route((u) => u.pathname === '/nps', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (_) { /* malformed body, leave {} */ }
      npsPosts.push(body);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          ok: true, promoter: true, id: 'nps-test-1',
          attribution: { name: 'Probe', school: 'Test University' },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true, eligible: true }) });
  });

  await page.addInitScript((quiz) => {
    sessionStorage.setItem('fw-session-hint', 'probe@flightway.local');
    localStorage.setItem('fw_hub_quiz_v1', quiz);
  }, QUIZ_SEED);

  await page.goto(`${ORIGIN}/flightplan.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page, pageErrors, consoleErrors, npsPosts };
}

const hostText = (page, id) => page.evaluate((hostId) => {
  const el = document.getElementById(hostId);
  return el ? (el.textContent || '').trim() : null;
}, id);

const browser = await chromium.launch();

await test('flightplan.html boots clean: zero pageerrors, zero console errors', async () => {
  const { ctx, pageErrors, consoleErrors } = await openFlightplan(browser);
  assert.deepEqual(pageErrors, [], 'no uncaught page errors');
  assert.deepEqual(consoleErrors, [], 'no console messages of type error');
  await ctx.close();
});

await test('scorecard panel (#flightplan-scorecard) mounts its no-data state', async () => {
  const { ctx, page } = await openFlightplan(browser);
  const text = await hostText(page, 'flightplan-scorecard');
  assert.ok(text && text.length > 0, `expected rendered text, got ${JSON.stringify(text)}`);
  assert.match(text, /stack up against real, live postings/i, 'renders the scorecard intro sentence, not a blank shell');
  await ctx.close();
});

await test('network/outreach panel (#flightplan-network) mounts its no-data state', async () => {
  const { ctx, page } = await openFlightplan(browser);
  const text = await hostText(page, 'flightplan-network');
  assert.ok(text && text.length > 0, `expected rendered text, got ${JSON.stringify(text)}`);
  assert.match(text, /networking is the one roadmap step/i, 'renders the network mapper intro sentence');
  await ctx.close();
});

await test('season (#flightplan-season) and term (#flightplan-term) panels both mount their no-data state', async () => {
  const { ctx, page } = await openFlightplan(browser);
  const seasonText = await hostText(page, 'flightplan-season');
  const termText = await hostText(page, 'flightplan-term');
  assert.ok(seasonText && seasonText.length > 0, `season: expected rendered text, got ${JSON.stringify(seasonText)}`);
  assert.match(seasonText, /six weeks, one scored mock interview each/i, 'season renders its intro sentence');
  assert.ok(termText && termText.length > 0, `term: expected rendered text, got ${JSON.stringify(termText)}`);
  assert.match(termText, /Set up my term/, 'term renders its setup CTA');
  await ctx.close();
});

await test('NPS two-step walk: score 9 reaches the consent/quote step and posts the score', async () => {
  const { ctx, page, npsPosts } = await openFlightplan(browser);
  await page.evaluate((moment) => { window.FWNps.maybeAsk(moment); }, 'flightplan_done');
  await page.waitForSelector('.fw-nps-card', { timeout: 5000 });
  // Step one: pick a score.
  await page.locator('.fw-nps-scale').getByRole('button', { name: '9', exact: true }).click();
  // Step two: send it. `.fw-nps-more` (comment box + Send) is revealed by the
  // click above; Playwright auto-waits for it to become actionable.
  await page.locator('.fw-nps-more button.fw-nps-btn--primary').click();
  await page.waitForSelector('.fw-nps-quote', { timeout: 5000 });
  const question = await page.locator('.fw-nps-q').textContent();
  assert.match(question || '', /mind if we quote you/i, 'the consent/quote step is showing, not the score scale still');
  assert.ok(npsPosts.length >= 1, 'the score POST reached /nps');
  const last = npsPosts[npsPosts.length - 1];
  assert.equal(last.action, 'score', 'it is a score submission, not a dismiss');
  assert.equal(last.score, 9, 'the POST body carries the picked score');
  await ctx.close();
});

await browser.close();
await new Promise((r) => server.close(r));

// Static wiring: the four panels and the NPS card are only real if
// flightplan.html actually loads their modules and provides their hosts.
const html = fs.readFileSync(path.join(ROOT, 'flightplan.html'), 'utf8');
await test('static wiring: nps.js + all four panel modules load busted; host elements exist', () => {
  for (const src of [
    'assets/js/shared/nps.js',
    'assets/js/app/scorecard-panel.js',
    'assets/js/app/network-panel.js',
    'assets/js/app/season-panel.js',
    'assets/js/app/term-panel.js',
  ]) {
    const escaped = src.replace(/[.]/g, '\\.');
    assert.match(html, new RegExp(escaped + '\\?v=\\d+'), `${src} is loaded with a cache buster`);
  }
  for (const id of ['flightplan-scorecard', 'flightplan-network', 'flightplan-season', 'flightplan-term']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} host exists in the static HTML`);
  }
});

console.log(failures ? `\nflightplan:ui-check FAILED (${failures})` : '\nflightplan:ui-check passed');
process.exit(failures ? 1 : 0);
