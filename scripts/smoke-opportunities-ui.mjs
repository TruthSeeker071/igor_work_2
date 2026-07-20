// opportunities:ui-check — roadmap.html "Opportunities for you" panel
// invariants (build plan §9). Serves the working tree with stubbed /auth/me +
// /opportunities and drives the focus view with Playwright (same pattern as
// smoke-resume-ui.mjs):
//   1. list state: panel renders sourced items + as-of line + school input.
//   2. school save: POST body carries the school; re-GET repersonalizes.
//   3. 402 → the Flight Plan gate CTA renders (no list, no error).
//   4. empty shape (grounding off) → clean empty state.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8935;
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
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const EMAIL = 'probe@flightway.local';
const QUIZ_SEED = JSON.stringify({
  name: 'Probe',
  scores: { tech: 80 },
  careerFocus: { soc: '15-2051.00', slug: 'test-career', name: 'Test Career' },
});

// Same tree shape scripts/test-vectors.cjs proves normalizes cleanly.
const mkNode = (id, parentId, depth) => ({
  id, parentId, depth, type: 'waypoint', pathRole: 'spine',
  shortTitle: 'Do ' + id, title: 'Do ' + id, confidence: 4,
  steps: [{ id: id + '-st1', text: 'step', done: false }],
});
const mkGap = (dimIndex, label, gap) => ({
  id: 'dim-' + dimIndex, dimIndex, label, domain: 'skills',
  user: 50, vBase: 50, target: 50 + gap, gap, source: 'coordinate',
  checklist: [], checklistSource: 'fast', logs: [], manualComplete: false,
  status: 'open', progress: 0,
});
const ROADMAP_SEED = JSON.stringify({
  version: 2, targetCareerSlug: 'test-career', targetCareerName: 'Test Career',
  summary: 'x', trunk: { id: 'trunk', title: 'Now', confidence: 5 },
  nodes: [mkNode('s1', 'trunk', 1), mkNode('s2', 's1', 2)],
  decisions: [], activePath: ['trunk', 's1', 's2'],
  focusTracker: {
    version: 3, waypointId: 's1', updatedAt: '2026-07-18T00:00:00.000Z',
    skillGaps: [mkGap(5, 'Programming', 30), mkGap(7, 'Writing', 12)],
  },
});

const OPP_BODY = {
  opportunities: [
    {
      id: 'op-a', type: 'course', title: 'Applied Programming Certificate', org: 'Coursera',
      url: 'https://www.coursera.org/cert', deadline: '2026-09-01', gapDimIndex: 5,
      gapLabel: 'Programming', impactTier: 'high', whyThisFits: 'Hands-on projects target your largest gap.',
    },
    {
      id: 'op-b', type: 'student_org', title: 'Student Writers Guild', org: 'National Writers Society',
      url: 'https://www.writers.org/join', deadline: null, gapDimIndex: 7,
      gapLabel: 'Writing', impactTier: 'medium', whyThisFits: 'Regular publication practice closes your writing gap.',
    },
  ],
  grounded: true,
  fetchedAt: '2026-07-18T12:00:00.000Z',
  sources: [{ title: 'Coursera', url: 'https://www.coursera.org/cert' }],
  school: '',
};
const EMPTY_BODY = { opportunities: [], grounded: false, fetchedAt: null, sources: [], school: '', reason: 'grounding-off' };

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok - ${name}`); }
  catch (err) { failures += 1; console.error(`  FAIL - ${name}\n    ${err.message}`); }
}

async function newRoadmapPage(browser, { onOpportunities }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: EMAIL }) }));
  await page.route('**/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ paywallEnabled: false }) }));
  await page.route('**/opportunities', onOpportunities);
  await page.addInitScript((args) => {
    sessionStorage.setItem('fw-session-hint', 'probe@flightway.local');
    localStorage.setItem('fw_hub_quiz_v1', args.quiz);
    localStorage.setItem('fw_roadmap_v1', args.roadmap);
  }, { quiz: QUIZ_SEED, roadmap: ROADMAP_SEED });
  await page.goto(`http://127.0.0.1:${PORT}/roadmap.html?focus=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#oppf-panel', { timeout: 15000 });
  return { ctx, page, pageErrors };
}

const browser = await chromium.launch();

await test('list state: sourced items, tier chips, as-of line, school input', async () => {
  const gets = [];
  const { ctx, page, pageErrors } = await newRoadmapPage(browser, {
    onOpportunities: (r) => {
      gets.push(r.request().method());
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPP_BODY) });
    },
  });
  await page.waitForSelector('#oppf-panel .oppf-item', { timeout: 10000 });
  const s = await page.evaluate(() => ({
    heading: document.querySelector('#oppf-panel .oppf-heading').textContent,
    items: document.querySelectorAll('#oppf-panel .oppf-item').length,
    firstTier: document.querySelector('#oppf-panel .oppf-tier').textContent,
    firstLink: (() => {
      const a = document.querySelector('#oppf-panel .oppf-title');
      return { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') };
    })(),
    asof: document.querySelector('#oppf-panel .oppf-asof').textContent,
    deadline: document.querySelector('#oppf-panel .oppf-org').textContent,
    schoolInput: !!document.querySelector('#oppf-panel .oppf-school-input'),
  }));
  assert.equal(s.heading, 'Opportunities for you');
  assert.equal(s.items, 2, 'both opportunities render');
  assert.ok(s.firstTier.includes('High impact') && s.firstTier.includes('Programming'), 'qualitative tier chip, no numbers');
  assert.ok(!/\d+ ?(points|pts)/.test(s.firstTier), 'no numeric point claims');
  assert.equal(s.firstLink.href, 'https://www.coursera.org/cert');
  assert.equal(s.firstLink.target, '_blank');
  assert.equal(s.firstLink.rel, 'noopener');
  assert.equal(s.asof, 'Opportunities checked as of 2026-07-18');
  assert.ok(s.deadline.includes('Deadline 2026-09-01'), 'deadline shown');
  assert.ok(s.schoolInput, 'school input offered when unset');
  assert.equal(gets.filter((m) => m === 'GET').length, 1, 'exactly one fetch despite focus re-renders');
  assert.deepEqual(pageErrors, [], 'no page errors');
  await ctx.close();
});

await test('school save: POST carries school, re-GET repersonalizes the panel', async () => {
  const posts = [];
  let getCount = 0;
  const { ctx, page } = await newRoadmapPage(browser, {
    onOpportunities: (r) => {
      const req = r.request();
      if (req.method() === 'POST') {
        posts.push(JSON.parse(req.postData() || '{}'));
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, school: posts[0].school }) });
        return;
      }
      getCount += 1;
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...OPP_BODY, school: posts.length ? posts[0].school : '' }),
      });
    },
  });
  await page.waitForSelector('#oppf-panel .oppf-school-input', { timeout: 10000 });
  await page.fill('#oppf-panel .oppf-school-input', 'UChicago');
  await page.click('#oppf-panel .oppf-school-save');
  await page.waitForSelector('#oppf-panel .oppf-school', { timeout: 10000 });
  const label = await page.evaluate(() => document.querySelector('#oppf-panel .oppf-school').textContent);
  assert.deepEqual(posts, [{ school: 'UChicago' }], 'POST body carries the school');
  assert.equal(getCount, 2, 'save triggers a fresh GET (server key includes school)');
  assert.ok(label.includes('UChicago'), 'panel shows the personalized school');
  await ctx.close();
});

await test('402 → Flight Plan gate CTA renders', async () => {
  const { ctx, page, pageErrors } = await newRoadmapPage(browser, {
    onOpportunities: (r) => r.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'Opportunity matching is a Flight Plan feature.', upgrade: true }) }),
  });
  await page.waitForSelector('#oppf-panel .fw-ent-gate', { timeout: 10000 });
  const s = await page.evaluate(() => ({
    title: document.querySelector('#oppf-panel .fw-ent-gate-title').textContent,
    cta: document.querySelector('#oppf-panel .fw-ent-gate-cta').getAttribute('href'),
    items: document.querySelectorAll('#oppf-panel .oppf-item').length,
  }));
  assert.equal(s.title, 'A Flight Plan feature');
  assert.equal(s.cta, 'pricing.html');
  assert.equal(s.items, 0, 'no list behind the gate');
  assert.deepEqual(pageErrors, [], 'no page errors');
  await ctx.close();
});

await test('grounding-off empty shape → clean empty state, never an error', async () => {
  const { ctx, page, pageErrors } = await newRoadmapPage(browser, {
    onOpportunities: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_BODY) }),
  });
  await page.waitForSelector('#oppf-panel .oppf-empty', { timeout: 10000 });
  const text = await page.evaluate(() => document.querySelector('#oppf-panel .oppf-empty').textContent);
  assert.ok(text.includes('No live opportunity matches right now'), 'empty copy shown');
  assert.deepEqual(pageErrors, [], 'no page errors');
  await ctx.close();
});

await browser.close();
server.close();
if (failures) { console.error(`opportunities:ui-check FAILED (${failures})`); process.exit(1); }
console.log('opportunities:ui-check PASS');
