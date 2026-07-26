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
import { spawnSync } from 'node:child_process';
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
const ALL_VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 812 },
];
const ALL_THEMES = ['light', 'dark'];

// A persona sweep wants one axis of the matrix, not all 52 cells: the same five
// surfaces, dark desktop, once per persona. FW_SHOT_PAGES / FW_SHOT_THEMES /
// FW_SHOT_VIEWPORTS narrow the loops (comma-separated, exact names); unset means
// the full matrix, so the audit run is unchanged.
const pickList = (env, all, nameOf) => {
  const want = (process.env[env] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!want.length) return all;
  const kept = all.filter((x) => want.includes(nameOf(x)));
  const missing = want.filter((w) => !all.some((x) => nameOf(x) === w));
  if (missing.length) throw new Error(`${env}: unknown ${missing.join(', ')}`);
  return kept;
};
const VIEWPORTS = pickList('FW_SHOT_VIEWPORTS', ALL_VIEWPORTS, (v) => v.name);
const THEMES = pickList('FW_SHOT_THEMES', ALL_THEMES, (t) => t);
const SHOT_PAGES = pickList('FW_SHOT_PAGES', PAGES, (p) => p.name);
const PROBE_EMAIL = 'probe@flightway.local';

// FW_SHOT_PERSONA seeds a fixture persona from scripts/fixtures/fit-personas.cjs
// (FW_SHOT_QUIZ still takes a raw quiz object). Either way the blob is hydrated
// first, in a child process, because that is what a user who finished the quiz
// actually has in storage: answers PLUS vectors. The hub hydrates on its own,
// but portal/career/coach read the stored vector and will happily rank sectors
// off an all-zero one — a screenshot of that is a screenshot of the fixture.
function hydrateSeed(arg, stdin) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/fixtures/hydrate-persona.cjs'), arg],
    { input: stdin, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`hydrate-persona ${arg}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}
const QUIZ_SEED = process.env.FW_SHOT_PERSONA ? hydrateSeed(process.env.FW_SHOT_PERSONA)
  : process.env.FW_SHOT_QUIZ ? hydrateSeed('-', process.env.FW_SHOT_QUIZ)
    : JSON.stringify({
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
  await dismissFeatureIntro(page);
}

// A first-visit FWFeatureIntro modal covers the page it is introducing —
// coach.html shot as a full-screen "An advisor who has already read your file"
// card with Marco's target chip behind it. Its seen-flag lives on the canonical
// user object, and pre-writing fw_user_v1 here would suppress the legacy-quiz
// promotion the seed depends on, so dismiss the modal instead of forging state.
async function dismissFeatureIntro(page) {
  const hit = await page.evaluate(() => {
    const skip = document.querySelector('.fw-intro-skip[data-fw-intro-act="skip"]');
    if (!skip) return false;
    skip.click();
    return true;
  }).catch(() => false);
  if (hit) await page.waitForTimeout(600);
}

async function waitHubReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('hub-loading');
    return el && el.classList.contains('is-hidden');
  }, { timeout: 12000 });
  // The loading overlay hides before the zone fits resolve, and the zone label
  // layer is cached — shoot too early and every cluster is captured at its
  // pre-fit colour, which looks like a plausible map and is not one. Wait for a
  // real fit to exist before the shutter, then outlast the 0.45s fade.
  await page.waitForFunction(() => {
    if (!window.FWOnetHub || typeof FWOnetHub.getZoneFit !== 'function') return false;
    const ids = (window.FWHubZoneFit && FWHubZoneFit.ZONE_ORDER) || [];
    return ids.some((z) => {
      const f = FWOnetHub.getZoneFit(z);
      return f && (f.overallFit > 0 || f.personalityFit > 0);
    });
  }, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

// `preferId` is the persona's own top-fit zone. Diving into whatever zone
// happens to sit nearest screen centre answers the wrong question: for the
// finance persona that was Creative & Media, where every orb is correctly grey,
// and a screenshot of a dead sector says nothing about whether live sectors
// still show a gradient.
async function findZonePoint(page, preferId) {
  return page.evaluate((prefer) => {
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
    const wanted = prefer ? hits.filter((h) => h.id === prefer) : [];
    return wanted.length ? wanted[0] : hits[0];
  }, preferId || null);
}

// Per-career vectors come from `POST /onet/vectors`, a Pages Function. Against
// a static server it 404s, every career keeps `fitScore: null`, and a sector
// dive renders 115 grey orbs — which looks exactly like "distinctive fit scored
// this whole sector zero" and is in fact "no fit was ever computed". The orb
// ladder is the surface this project is judged on, so serve the same payload
// off the same artifacts the function reads.
const ART = path.join(ROOT, 'data/onet/artifacts');
const DIM_COUNT = 161;
const socIndex = JSON.parse(fs.readFileSync(path.join(ART, 'soc-index.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ART, 'manifest.json'), 'utf8'));
const derivedBySoc = {};
const derivedFile = JSON.parse(fs.readFileSync(path.join(ART, 'derived-careers.json'), 'utf8'));
for (const d of (Array.isArray(derivedFile) ? derivedFile : derivedFile.careers || [])) {
  if (d && d.soc) derivedBySoc[d.soc] = d;
}
const f32 = (file) => {
  const raw = fs.readFileSync(path.join(ART, file));
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};
const lvBuf = f32('vectors-lv.f32.bin');
const imBuf = f32('importance-im.f32.bin');
const sliceVec = (buf, idx) => Array.from(buf.subarray(idx * DIM_COUNT, idx * DIM_COUNT + DIM_COUNT));

function vectorsForSocs(socs) {
  const vectors = {}; const importance = {}; const missing = [];
  for (const soc of socs || []) {
    const idx = socIndex[soc] != null ? socIndex[soc] : (socIndex.index && socIndex.index[soc]);
    if (idx == null) {
      const d = derivedBySoc[soc];
      if (d && Array.isArray(d.vector)) {
        vectors[soc] = d.vector.slice(0, DIM_COUNT);
        importance[soc] = Array.isArray(d.importance) ? d.importance.slice(0, DIM_COUNT)
          : new Array(DIM_COUNT).fill(0);
      } else missing.push(soc);
      continue;
    }
    vectors[soc] = sliceVec(lvBuf, idx);
    importance[soc] = sliceVec(imBuf, idx);
  }
  return { schemaId: manifest.schemaId, dimensionCount: DIM_COUNT, vectors, importance, missing };
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
  await page.route('**/onet/vectors', (route) => {
    let socs = [];
    try {
      const req = route.request();
      socs = req.method() === 'POST'
        ? (JSON.parse(req.postData() || '{}').socs || [])
        : (new URL(req.url()).searchParams.get('socs') || '').split(',').filter(Boolean);
    } catch (_) { /* fall through to an empty batch */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(vectorsForSocs(socs)),
    });
  });
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
    for (const spec of SHOT_PAGES) {
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
          // Two persona runs can come back pixel-identical and still both be
          // right; the only way to tell a rendering bug from a seeding bug is to
          // read the page's own numbers back. Dump them beside the shot.
          const fits = await page.evaluate(() => {
            const ids = (window.FWHubZoneFit && FWHubZoneFit.ZONE_ORDER) || [];
            const out = {};
            ids.forEach((z) => {
              const f = window.FWOnetHub && FWOnetHub.getZoneFit ? FWOnetHub.getZoneFit(z) : null;
              if (f) out[z] = { overall: f.overallFit, personality: f.personalityFit };
            });
            return out;
          }).catch(() => null);
          if (fits) fs.writeFileSync(path.join(OUT, `${tag}-fits.json`), JSON.stringify(fits, null, 2));
          await page.screenshot({ path: path.join(OUT, `${tag}-macro.png`) });
          if (vp.name === 'desktop') {
            await page.mouse.move(vp.width / 2, vp.height / 2);
            for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(90); }
            await page.waitForTimeout(700);
            await page.screenshot({ path: path.join(OUT, `${tag}-mid.png`) });
            await page.goto(`http://127.0.0.1:${PORT}/${name}.html`, { waitUntil: 'domcontentloaded' });
            await waitHubReady(page);
            const topZone = fits && Object.keys(fits).length
              ? Object.keys(fits).sort((a, b) => fits[b].overall - fits[a].overall)[0] : null;
            const pt = await findZonePoint(page, topZone);
            if (pt && topZone && pt.id !== topZone) {
              errLog.push(`[harness] ${tag}: wanted zone ${topZone}, dove into ${pt.id}`);
            }
            if (pt) {
              await page.mouse.dblclick(pt.x, pt.y);
              // Career vectors arrive in batches of 40 and every orb is grey
              // until its own fit lands, so wait for the ladder rather than a
              // fixed delay — an early shutter photographs an uncoloured sector.
              await page.waitForFunction(() => {
                const list = window.FWOnetHub && FWOnetHub.getRenderCareers
                  ? FWOnetHub.getRenderCareers() : [];
                return list.length && list.filter((c) => c.fitScore != null).length >= list.length * 0.9;
              }, { timeout: 15000 }).catch(() => {
                errLog.push(`[harness] ${tag}: sector fits never resolved`);
              });
              await page.waitForTimeout(1400);
              await page.screenshot({ path: path.join(OUT, `${tag}-sector.png`) });
              const orbs = await page.evaluate(() => {
                const list = (window.FWOnetHub && FWOnetHub.getRenderCareers
                  ? FWOnetHub.getRenderCareers() : []).filter((c) => c.fitScore != null);
                const T = window.FWOnetMath.FIT_TIERS;
                const tier = (s) => (s >= T.mythic ? 'mythic' : s >= T.legendary ? 'legendary'
                  : s >= T.epic ? 'epic' : s >= T.rare ? 'rare' : s >= T.uncommon ? 'uncommon' : 'common');
                const counts = {};
                list.forEach((c) => { counts[tier(c.fitScore)] = (counts[tier(c.fitScore)] || 0) + 1; });
                return {
                  zone: FWOnetHub.getActiveZone ? FWOnetHub.getActiveZone() : null,
                  n: list.length,
                  tiers: counts,
                  top: list.slice().sort((a, b) => b.fitScore - a.fitScore).slice(0, 8)
                    .map((c) => `${c.name} ${c.fitScore}`),
                };
              }).catch(() => null);
              if (orbs) fs.writeFileSync(path.join(OUT, `${tag}-orbs.json`), JSON.stringify(orbs, null, 2));
            } else {
              errLog.push(`[harness] ${tag}: no zone hit for sector dive`);
            }
          }
        } else {
          await settle(page);
          const finalPath = new URL(page.url()).pathname;
          if (!finalPath.includes(name)) errLog.push(`[harness] ${tag}: redirected to ${finalPath}`);
          await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
          // The portal's sector bars — the surface a fit change is most visible
          // on after the map — live inside the profile drawer, so the page shot
          // never contains them. Open it and capture separately.
          if (name === 'portal') {
            const opened = await page.evaluate(() => {
              const btn = document.getElementById('portal-profile-open');
              if (!btn) return false;
              btn.click();
              return true;
            }).catch(() => false);
            if (opened) {
              await page.waitForTimeout(900);
              await page.screenshot({ path: path.join(OUT, `${tag}-profile.png`) });
              const sectors = await page.evaluate(() => Array.from(
                document.querySelectorAll('.portal-sector-row'),
              ).map((r) => ({
                label: (r.querySelector('.portal-sector-label') || {}).textContent,
                score: (r.querySelector('.portal-sector-score') || {}).textContent,
              }))).catch(() => null);
              if (sectors) fs.writeFileSync(path.join(OUT, `${tag}-sectors.json`), JSON.stringify(sectors, null, 2));
            } else {
              errLog.push(`[harness] ${tag}: no profile drawer button`);
            }
          }
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
