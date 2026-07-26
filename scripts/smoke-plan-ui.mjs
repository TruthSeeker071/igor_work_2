// plan:ui-check — WS-G free/paid activation surfaces.
//
// The caps are enforced server-side and covered by test:entitlements. What
// this proves is the half a Node test can't: that a signed-in student SEES
// the cap before hitting it, that hitting it produces one card and not a
// dead end, and that a student with nothing capped sees no nag at all.
//
// Serves the working tree with a stubbed /config (paywall ON, real cap table)
// and /auth/me, then drives portal.html — same pattern as smoke-resume-ui.mjs.
//   1. free plan  → panel badge + one meter per spendable allowance, real numbers
//   2. exhausted  → that row alone carries the upgrade link (moment 1, seen early)
//   3. paid plan  → badge only, zero meters, zero upgrade links anywhere
//   4. dark paywall → "Preview access", no meters, no /auth/me call at all
//   5. chip + cap card contracts, and the wiring that renders them on roadmap/coach
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { publicFeatureLimits } from '../functions/_lib/plan-limits.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8936;
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
const QUIZ_SEED = JSON.stringify({
  name: 'Probe',
  scores: { tech: 80, people: 40 },
  careerFocus: { soc: '15-2051.00', slug: 'test-career', name: 'Test Career' },
  featureIntros: { _seeded: true, portal: { seen: true }, roadmap: { seen: true }, marco: { seen: true } },
});

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok - ${name}`); }
  catch (err) { failures += 1; console.error(`  FAIL - ${name}\n    ${err.message}`); }
}

// The real table, straight from the module the server enforces — a harness
// that hand-writes caps proves the UI matches the harness, not the product.
const LIMITS = publicFeatureLimits();

async function openPortal(browser, { paywall = true, plan = 'free', remaining = {}, dev = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  const meCalls = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/config', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ paywallEnabled: paywall, stripeEnabled: false, stripeTestMode: false, featureLimits: LIMITS }),
  }));
  await page.route('**/auth/me', (r) => {
    meCalls.push(r.request().url());
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: EMAIL, plan, planRaw: plan, paywall, remaining, ...(dev ? { dev: true } : {}) }),
    });
  });
  await page.addInitScript((quiz) => {
    sessionStorage.setItem('fw-session-hint', 'probe@flightway.local');
    localStorage.setItem('fw_hub_quiz_v1', quiz);
  }, QUIZ_SEED);
  await page.goto(`http://127.0.0.1:${PORT}/portal.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(900);
  return { ctx, page, pageErrors, meCalls };
}

const readPanel = (page) => page.evaluate(() => {
  const host = document.getElementById('portal-plan');
  if (!host || host.hidden) return { hidden: true };
  return {
    hidden: false,
    badge: (host.querySelector('.fw-plan-badge') || {}).textContent || '',
    note: (host.querySelector('.fw-plan-note') || {}).textContent || '',
    meters: Array.from(host.querySelectorAll('.fw-plan-meter')).map((li) => ({
      label: li.querySelector('.fw-plan-meter-label').textContent,
      value: li.querySelector('.fw-plan-meter-value').textContent,
      width: li.querySelector('.fw-plan-meter-fill').style.width,
      cta: !!li.querySelector('.fw-plan-meter-cta'),
    })),
    upgradeLinks: host.querySelectorAll('a[href="pricing.html"]').length,
  };
});

const browser = await chromium.launch();

await test('free plan: the panel states the plan and every spendable allowance', async () => {
  const { ctx, page, pageErrors } = await openPortal(browser, {
    plan: 'free',
    remaining: {
      'marco-chat': 3, 'roadmap-generate': 1, 'career-sim': 1, 'opportunity-search': 1,
      'resume-draft': 1, 'mock-interview': 1, 'marco-thread': 2, 'deadline-refresh': 1,
      'scorecard-run': 1, 'outreach-draft': 2,
    },
  });
  const p = await readPanel(page);
  assert.equal(p.hidden, false, 'panel renders for a capped plan');
  assert.equal(p.badge, 'Free plan', 'badge names the plan');
  assert.equal(p.meters.length, 8, 'one meter per spendable allowance — not per metered feature');
  assert.equal(p.meters[0].value, '3 of 10 left today', 'daily allowance reads from the enforced cap');
  assert.equal(p.meters[0].width, '30%', 'the bar is the fraction left, not a guess');
  // V2 §4 gave the table week and month windows. A meter that says "left today"
  // about a monthly allowance promises the student it comes back tomorrow.
  assert.equal(p.meters[1].value, '1 of 1 left this month', 'a monthly allowance names its own window');
  assert.equal(p.meters[3].value, '1 of 1 left this week', 'so does a weekly one');
  // S9's Deadline Radar refresh is appended last, so the five above keep their
  // indices — that ordering guarantee is the whole reason it was appended.
  assert.equal(p.meters[5].value, '1 of 1 left this week', 'the S9 deadline refresh is a weekly allowance too');
  // S16's scorecard is the panel's only LIFETIME allowance, and the wording is
  // the point: "1 of 1 left" with no window word, because there is no window it
  // comes back in. A suffix here would promise a second free run that §4 never
  // grants — the most expensive false promise in the cap table.
  assert.equal(p.meters[6].value, '1 of 1 left', 'a lifetime taste names no window it will return in');
  // S17's outreach drafts, appended last for the same index-stability reason. It
  // is the first row in the panel whose free allowance is more than one, so it is
  // also the only place the PLURAL label is exercised end to end — "2 of 2
  // outreach drafts left this month", not "2 outreach draft".
  assert.equal(p.meters[7].value, '2 of 2 left this month', 'a multi-unit monthly allowance reads plural and names its window');
  assert.equal(p.upgradeLinks, 0, 'nothing is exhausted, so nothing nags');
  assert.deepEqual(pageErrors, [], 'no page errors');
  await ctx.close();
});

await test('exhausted: only the spent row carries the upgrade link', async () => {
  const { ctx, page } = await openPortal(browser, {
    plan: 'free',
    remaining: { 'marco-chat': 0, 'roadmap-generate': 1, 'mock-interview': 0 },
  });
  const p = await readPanel(page);
  assert.equal(p.meters[0].cta, true, 'the spent allowance offers the lift');
  assert.equal(p.meters[0].value, 'None left today', 'and says so plainly');
  assert.equal(p.meters[1].cta, false, 'the untouched allowance does not');
  assert.equal(p.upgradeLinks, 1, 'exactly one upgrade moment on the page');
  await ctx.close();
});

await test('paid plan: a badge, no meters, and not one upgrade moment', async () => {
  const { ctx, page } = await openPortal(browser, {
    plan: 'premium',
    remaining: { 'marco-chat': null, 'roadmap-generate': null, 'mock-interview': 3 },
  });
  const p = await readPanel(page);
  assert.equal(p.badge, 'Flight Plan', 'badge names the paid plan');
  assert.equal(p.meters.length, 0, 'nothing capped, nothing metered');
  assert.equal(p.upgradeLinks, 0, 'a paying student is never sold to');
  await ctx.close();
});

await test('dark paywall: preview badge, no meters, and no counters pulled', async () => {
  const { ctx, page } = await openPortal(browser, { paywall: false, plan: 'free', remaining: { 'marco-chat': 5 } });
  const p = await readPanel(page);
  assert.match(p.badge, /Preview access/, 'the preview is named, not mislabelled as a free plan');
  assert.equal(p.meters.length, 0, 'nothing is capped during the preview, so nothing is metered');
  // FWEnt skips /auth/me entirely while the paywall is dark. The panel must
  // live with that rather than forcing a counters fetch whose numbers could
  // not be true — this is why the live prototype shows the preview badge only.
  const counters = await page.evaluate(() => ({
    remaining: FWEnt.remaining('marco-chat'),
    limit: FWEnt.limitFor('marco-chat', 'free'),
  }));
  assert.equal(counters.remaining, undefined, 'no counters are pulled on a dark-paywall build');
  assert.equal(counters.limit, 10, 'but the cap table still lands — pricing copy needs it either way');
  await ctx.close();
});

await test('dev tester: unlocked, and told so rather than shown empty meters', async () => {
  const { ctx, page } = await openPortal(browser, { plan: 'lifetime', dev: true, remaining: {} });
  const p = await readPanel(page);
  assert.match(p.badge, /Developer access/, 'dev access is labelled');
  assert.equal(p.meters.length, 0, 'and carries no meters');
  await ctx.close();
});

await test('chip contract: fills from the cap table, hides when nothing is true', async () => {
  const { ctx, page } = await openPortal(browser, {
    plan: 'free', remaining: { 'marco-chat': 2, 'roadmap-generate': 0 },
  });
  const r = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = '<span class="fw-plan-chip" data-fw-plan-chip="roadmap-generate" hidden></span>'
      + '<span class="fw-plan-chip" data-fw-plan-chip="mock-interview" hidden></span>';
    document.body.appendChild(host);
    FWPlanSurface.sync(host);
    const chips = host.querySelectorAll('[data-fw-plan-chip]');
    return {
      spent: { text: chips[0].textContent, hidden: chips[0].hidden, out: chips[0].classList.contains('is-out') },
      locked: { hidden: chips[1].hidden },
    };
  });
  assert.equal(r.spent.text, 'None left this month', 'a spent monthly allowance names the window it returns in');
  assert.equal(r.spent.out, true, 'and is styled as spent');
  // The fixture never told us this counter (V2 §4 gave mock-interview a free
  // lifetime taste, so it is no longer a 0-on-free hard gate — but a chip must
  // still say NOTHING until /auth/me has actually answered for it).
  assert.equal(r.locked.hidden, true, 'an allowance we have not been told yet shows no meter');
  await ctx.close();
});

await test('cap card: server copy, one CTA, never stacked', async () => {
  const { ctx, page } = await openPortal(browser, { plan: 'free', remaining: { 'marco-chat': 0 } });
  const r = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    FWPlanSurface.capCard(host, 'marco-chat', "You've used your 5 free Marco messages — Flight Plan lifts the cap.");
    FWPlanSurface.capCard(host, 'marco-chat', 'That was your last free Marco message today.');
    return {
      cards: host.querySelectorAll('.fw-plan-cap').length,
      title: host.querySelector('.fw-plan-cap-title').textContent,
      ctas: host.querySelectorAll('.fw-plan-cap-cta').length,
      fine: (host.querySelector('.fw-plan-cap-fine') || {}).textContent || '',
    };
  });
  assert.equal(r.cards, 1, 'a second cap hit replaces the card, never stacks one');
  assert.equal(r.title, 'That was your last free Marco message today.', 'the card states the wall it was given');
  assert.equal(r.ctas, 1, 'exactly one way forward');
  assert.match(r.fine, /come back tomorrow/i, 'a daily cap says when it lifts — no dead end');
  await ctx.close();
});

await test('cap card escapes server text (it lands on an innerHTML path)', async () => {
  const { ctx, page } = await openPortal(browser, { plan: 'free', remaining: { 'marco-chat': 0 } });
  const r = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    FWPlanSurface.capCard(host, 'marco-chat', '<img src=x onerror="window.__pwned=1">');
    return { imgs: host.querySelectorAll('img').length, pwned: !!window.__pwned };
  });
  assert.equal(r.imgs, 0, 'no markup is injected');
  assert.equal(r.pwned, false, 'and nothing executes');
  await ctx.close();
});

// S8 (§4 / D18): the inline locked PREVIEW — the second upgrade moment, used
// wherever a free plan sees part of a list. The property that matters is that
// the placeholder rows are EMPTY: the server truncated the payload, so this is
// a count made visible, not real content hidden behind a blur.
await test('locked tail: empty placeholders, one CTA, and it attributes the click', async () => {
  const { ctx, page } = await openPortal(browser, { plan: 'free', remaining: { 'marco-chat': 3 } });
  const r = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    FWPlanSurface.lockedTail(host, 'opportunity-search', 3);
    const tail = host.querySelector('.fw-lock-tail');
    const rows = tail.querySelectorAll('.fw-lock-row');
    const cta = tail.querySelector('.fw-lock-cta');
    return {
      rows: rows.length,
      rowText: Array.from(rows).map((n) => n.textContent).join(''),
      line: tail.querySelector('.fw-lock-line').textContent,
      href: cta.getAttribute('href'),
      // upgradeSource() reads this to name the moment a pricing click came from.
      source: FWPlanSurface.allowance && cta.closest('[data-fw-gated]').getAttribute('data-fw-gated'),
      empty: FWPlanSurface.lockedTailHtml('opportunity-search', 0),
    };
  });
  assert.equal(r.rows, 3, 'one placeholder per locked item, capped at three');
  assert.equal(r.rowText, '', 'the placeholders hold NO text — nothing to un-blur in devtools');
  assert.match(r.line, /^3 /, 'the line leads with the server’s own locked count');
  assert.equal(r.href, 'pricing.html', 'one CTA, and it goes to pricing');
  assert.equal(r.source, 'opportunity-search', 'the tail is attributable, so upgrade_click names this moment');
  assert.equal(r.empty, '', 'nothing locked renders nothing at all — a paying plan never sees this');
  await ctx.close();
});

await browser.close();
await new Promise((r) => server.close(r));

// Static wiring: the surfaces above are only real if the pages that need them
// actually load the module and emit the slots.
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
await test('every page with a cap loads plan-surface.js after entitlements.js', async () => {
  // S8/§4 added metered surfaces to resume.html (AI draft + tailor) and
  // simulation.html (1 sim/month), so their cap cards need the module too.
  for (const f of ['portal.html', 'roadmap.html', 'coach.html', 'resume.html', 'simulation.html']) {
    const html = read(f);
    const ent = html.indexOf('shared/entitlements.js');
    const surf = html.indexOf('shared/plan-surface.js');
    assert.ok(ent >= 0, `${f} loads entitlements.js`);
    assert.ok(surf > ent, `${f} loads plan-surface.js after it (it reads FWEnt at boot)`);
  }
});
await test('roadmap emits the generations chip; coach routes its cap through the card', async () => {
  assert.match(read('assets/js/app/roadmap.js'), /data-fw-plan-chip="roadmap-generate"/, 'roadmap chip slot');
  assert.match(read('assets/js/app/roadmap.js'), /FWPlanSurface\.sync\(\)/, 'and refills it on every render');
  assert.match(read('assets/js/coach/coach.js'), /FWPlanSurface\.capCard\(/, 'coach renders the shared cap card');
  assert.doesNotMatch(read('assets/js/coach/coach.js'), /COACH_FREE_DAILY/, 'and no longer hardcodes the cap');
});

await test('pricing.html quotes the enforced caps, not a copy of them (G3)', async () => {
  const html = read('pricing.html');
  const slots = [...html.matchAll(/data-fw-limit="([^".]+)\.([^"]+)"[^>]*>([^<]*)</g)];
  assert.ok(slots.length >= 3, 'the page marks its cap numbers as slots');
  for (const [, feature, plan, shipped] of slots) {
    const real = LIMITS[feature] && LIMITS[feature].limits[plan];
    assert.equal(String(real), shipped.trim(),
      `pricing.html ships ${feature}.${plan} as "${shipped.trim()}" but the enforced cap is ${real}`);
  }
  // JS-off readers see the shipped number; /config corrects it if a deployment
  // ever runs a different table. Both halves have to exist.
  assert.match(html, /cfg && cfg\.featureLimits/, 'and overwrites them from /config at runtime');
});

console.log(failures ? `\nplan:ui-check FAILED (${failures})` : '\nplan:ui-check passed');
process.exit(failures ? 1 : 0);
