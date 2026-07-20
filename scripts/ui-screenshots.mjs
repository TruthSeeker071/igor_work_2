#!/usr/bin/env node
/**
 * UI screenshot harness for the polish/audit pass.
 * Serves the working tree on a local port (zero-dep static server) and
 * captures every page x {light,dark} x {desktop,mobile}, plus the hub at
 * macro / mid-zoom / sector-dive. App pages get a stubbed /auth/me session
 * so they render authed shells instead of redirecting; all other API calls
 * intentionally 404 so real empty/error states show. Console + page errors
 * land in errors.log.
 *
 * Usage: node scripts/ui-screenshots.mjs <outDir> [pageFilter]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(ROOT, '.screenshots');
const FILTER = process.argv[3] || '';
const PORT = 8931;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(ROOT, p);
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

// authed: stub /auth/me so the page renders its signed-in shell.
const PAGES = [
  { name: 'index', authed: false },
  { name: 'auth', authed: false },
  { name: 'quiz', authed: false },
  { name: 'pricing', authed: false },
  { name: '404', authed: false },
  { name: 'dashboard', authed: true },
  { name: 'portal', authed: true },
  { name: 'roadmap', authed: true },
  { name: 'coach', authed: true },
  { name: 'career', authed: true, query: 'slug=product-management' },
  { name: 'simulation', authed: true },
  { name: 'profile-build', authed: true },
  { name: 'resume', authed: true },
];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 812 },
];
const THEMES = ['light', 'dark'];
const PROBE_EMAIL = 'probe@flightway.local';

const QUIZ_SEED = JSON.stringify({
  name: 'Probe',
  scores: { creative: 90, tech: 40, marketing: 55 },
  sectorFitSheet: {
    version: 1,
    scores: { creative: 90, tech: 40, marketing: 55 },
    seededAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [],
  },
});

fs.mkdirSync(OUT, { recursive: true });
const errLog = [];

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function waitHubReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('hub-loading');
    return el && el.classList.contains('is-hidden');
  }, { timeout: 12000 });
  // Outlast the overlay's 0.45s opacity fade so it isn't in the shot.
  await page.waitForTimeout(900);
}

async function findZonePoint(page) {
  return page.evaluate(() => {
    const c = document.getElementById('map-canvas');
    if (!c || !window.FWHubCanvasRender || !FWHubCanvasRender.zoneAtScreen) return null;
    const r = c.getBoundingClientRect();
    const hits = [];
    for (let gy = 2; gy < 10; gy++) {
      for (let gx = 2; gx < 10; gx++) {
        const x = (r.width * gx) / 12;
        const y = (r.height * gy) / 12;
        const z = FWHubCanvasRender.zoneAtScreen(x, y);
        if (z) hits.push({ x: x + r.left, y: y + r.top, id: z.id || String(z) });
      }
    }
    if (!hits.length) return null;
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    hits.sort((a, b) => (Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)));
    return hits[0];
  });
}

async function newPageFor(browser, vp, theme, opts) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    // Hub captures need real motion (canvas anims); static pages disable it
    // so entrance-stagger elements don't screenshot at opacity 0.
    reducedMotion: opts.motion ? 'no-preference' : 'reduce',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errLog.push(`[pageerror] ${page.url()} :: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errLog.push(`[console] ${page.url()} :: ${m.text()}`);
  });
  if (opts.authed) {
    await page.route('**/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: PROBE_EMAIL }),
    }));
  }
  await page.addInitScript((args) => {
    localStorage.setItem('flightway-theme', args.theme);
    localStorage.setItem('fw_hub_quiz_v1', args.quiz);
    localStorage.setItem('fw_hub_fit_explainer_seen_v1', '1');
    if (args.authed) sessionStorage.setItem('fw-session-hint', args.email);
  }, { theme, quiz: QUIZ_SEED, authed: !!opts.authed, email: PROBE_EMAIL });
  return { ctx, page };
}

const browser = await chromium.launch();
for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    for (const spec of PAGES) {
      const name = spec.name;
      if (FILTER && !name.includes(FILTER)) continue;
      const tag = `${name}-${theme}-${vp.name}`;
      const { ctx, page } = await newPageFor(browser, vp, theme, {
        authed: spec.authed,
        motion: name === 'dashboard',
      });
      try {
        await page.goto(`http://127.0.0.1:${PORT}/${name}.html${spec.query ? '?' + spec.query : ''}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (name === 'dashboard') {
          await waitHubReady(page);
          await page.screenshot({ path: path.join(OUT, `${tag}-macro.png`) });
          if (vp.name === 'desktop') {
            await page.mouse.move(vp.width / 2, vp.height / 2);
            for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(90); }
            await page.waitForTimeout(700);
            await page.screenshot({ path: path.join(OUT, `${tag}-mid.png`) });
            await page.goto(`http://127.0.0.1:${PORT}/${name}.html`, { waitUntil: 'domcontentloaded' });
            await waitHubReady(page);
            const pt = await findZonePoint(page);
            if (pt) {
              await page.mouse.dblclick(pt.x, pt.y);
              await page.waitForTimeout(1400);
              await page.screenshot({ path: path.join(OUT, `${tag}-sector.png`) });
            } else {
              errLog.push(`[harness] ${tag}: no zone hit for sector dive`);
            }
          }
        } else {
          await settle(page);
          const finalPath = new URL(page.url()).pathname;
          if (!finalPath.includes(name)) errLog.push(`[harness] ${tag}: redirected to ${finalPath}`);
          await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
        }
        process.stdout.write(`ok ${tag}\n`);
      } catch (e) {
        errLog.push(`[harness] ${tag} FAILED :: ${e.message.split('\n')[0]}`);
        process.stdout.write(`FAIL ${tag} :: ${e.message.split('\n')[0]}\n`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
fs.writeFileSync(path.join(OUT, 'errors.log'), errLog.join('\n') + '\n');
console.log(`\n${errLog.length} console/page errors -> ${path.join(OUT, 'errors.log')}`);
