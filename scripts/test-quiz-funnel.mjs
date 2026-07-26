// test:quiz-funnel — V2 S6 quiz reveal (build plan §S6). Serves the working
// tree, boots quiz.html offline, and drives the reveal directly through
// window.qzShowReveal (bypassing the click-through quiz + any feature-intro
// modal, same shortcut smoke-plan-ui.mjs/smoke-opportunities-ui.mjs take for
// stages behind a full flow). Same http-server + Playwright harness pattern
// as scripts/smoke-plan-ui.mjs.
//
// Three invariants:
//   1. Scoring-map coverage: >= 8 of the 10 pre-signup questions carry a
//      scoring map (QZ_INITIAL_IDS / QZ_Qs, read as page-scope globals —
//      classic-script top-level `const`, not window.*).
//   2. The reveal renders exactly the top 3 of a fixture ranking, in order,
//      as real (unlocked) cards.
//   3. Ranks 4-10 never reach the DOM — 7 locked placeholders, and zero trace
//      of the fixture names for ranks 4-10 anywhere in the reveal container's
//      innerHTML (the load-bearing assertion: the gate can't be defeated via
//      devtools if the data was never there to read).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.QUIZ_FUNNEL_PORT || 8939);
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

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok - ${name}`); }
  catch (err) { failures += 1; console.error(`  FAIL - ${name}\n    ${err.message}`); }
}

// Ten distinct careers, deterministic and distinguishable by name alone —
// exactly what a real rankOnetCareersFromVectors resolution shapes.
const FIX = Array.from({ length: 10 }, (_, i) => ({
  career: { name: 'FixtureCareer' + (i + 1), soc: '99-000' + i + '.00', industry: 'Technology' },
  score: 95 - i * 5,
}));

const browser = await chromium.launch();
let ctx;
try {
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // Any other POST the page makes (persist, events, etc.) → 200 {}. Registered
  // first so the more specific routes below (registered later = higher
  // priority in Playwright) can override it for /config and /onet/vectors.
  await page.route('**/*', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  await page.route('**/config', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ analyticsEnabled: false, googleAuthEnabled: false, featureLimits: {} }),
  }));
  await page.route('**/onet/vectors', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }));

  await page.goto(`http://127.0.0.1:${PORT}/quiz.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => !!(window.qzShowReveal && window.FWOnetVectors), { timeout: 15000 });

  await test('scoring-map coverage: >= 8 of 10 pre-signup questions carry a scoring map', async () => {
    const r = await page.evaluate(() => {
      // Deep-scan a question object for a property named `s` (non-null object —
      // the sector->weight map) or `score` (a function), at any nesting depth
      // (tags/opts/pairs/items arrays all carry `s` one level down).
      function hasScoringMap(node, depth) {
        if (depth > 8 || node == null || typeof node !== 'object') return false;
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (k === 's' && v && typeof v === 'object') return true;
          if (k === 'score' && typeof v === 'function') return true;
          if (v && typeof v === 'object' && hasScoringMap(v, depth + 1)) return true;
        }
        return false;
      }
      const ids = QZ_INITIAL_IDS;
      const scored = ids.filter((id) => {
        const q = QZ_Qs.find((qq) => qq.id === id);
        return q && hasScoringMap(q, 0);
      });
      return { total: ids.length, scoredCount: scored.length, scoredIds: scored };
    });
    console.log(`    scoring-map coverage: ${r.scoredCount}/${r.total} — scored ids: ${JSON.stringify(r.scoredIds)}`);
    assert.equal(r.total, 10, `QZ_INITIAL_IDS should have 10 entries, got ${r.total}`);
    assert.ok(r.scoredCount >= 8, `expected >= 8 scored initial questions, got ${r.scoredCount}`);
  });

  await test('reveal renders exactly the top 3 of the ranking as real cards, in order', async () => {
    await page.evaluate((fix) => {
      window.__ev = [];
      window.FWEvents = { log: (n) => { window.__ev.push(n); } };
      window.FWOnetVectors.rankOnetCareersFromVectors = () => Promise.resolve(fix);
      if (window.FWOnetVectors.rankFeaturedFromVectors) {
        window.FWOnetVectors.rankFeaturedFromVectors = () => Promise.resolve(fix);
      }
      window.qzShowReveal();
    }, FIX);

    await page.waitForSelector('#page-quiz .qz-match-card', { timeout: 15000 });

    const real = await page.$$eval('#qz-reveal .qz-match-card:not(.qz-match-card--locked)',
      (els) => els.map((el) => (el.querySelector('.qz-mc-name') || {}).textContent || ''));
    assert.equal(real.length, 3, `expected exactly 3 real cards, got ${real.length}`);
    assert.deepEqual(real, ['FixtureCareer1', 'FixtureCareer2', 'FixtureCareer3'],
      `expected top-3 fixture names in order, got ${JSON.stringify(real)}`);

    const revealHidden = await page.$eval('#qz-reveal', (el) => el.classList.contains('qz-hidden'));
    assert.equal(revealHidden, false, '#qz-reveal should be visible (qz-hidden removed) after the reveal');

    const ev = await page.evaluate(() => window.__ev || []);
    assert.ok(ev.includes('reveal_view'), `expected a reveal_view event, got ${JSON.stringify(ev)}`);
    assert.ok(ev.includes('gate_view'), `expected a gate_view event, got ${JSON.stringify(ev)}`);

    const gateHidden = await page.$eval('#qz-gate', (el) => el.classList.contains('qz-hidden'));
    assert.equal(gateHidden, false, '#qz-gate should be visible (shown below the cards) after the reveal');
  });

  await test('ranks 4-10 never reach the DOM: 7 locked placeholders, zero real data leaked', async () => {
    const lockedCount = await page.$$eval('#qz-reveal .qz-match-card--locked', (els) => els.length);
    assert.equal(lockedCount, 7, `expected 7 locked placeholders, got ${lockedCount}`);

    const { innerText, innerHTML } = await page.$eval('#qz-reveal', (el) => ({
      innerText: el.innerText, innerHTML: el.innerHTML,
    }));
    for (let i = 4; i <= 10; i++) {
      const name = 'FixtureCareer' + i;
      assert.ok(!innerHTML.includes(name), `#qz-reveal innerHTML leaked ${name} (rank ${i} reached the DOM)`);
      assert.ok(!innerText.includes(name), `#qz-reveal innerText leaked ${name} (rank ${i} reached the DOM)`);
    }
  });

  await test('no uncaught page errors', async () => {
    assert.deepEqual(pageErrors, [], `no uncaught page errors, got ${JSON.stringify(pageErrors)}`);
  });
} finally {
  if (ctx) await ctx.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}

console.log(failures ? `\ntest:quiz-funnel FAILED (${failures})` : '\ntest:quiz-funnel passed');
process.exit(failures ? 1 : 0);
