#!/usr/bin/env node
/**
 * layout:check — the WS-B gate (docs/OVERHAUL_MASTERPLAN_2026-07-20.md).
 *
 * Every page must grow into the space it is given: window size, browser zoom
 * and OS scaling all just work. Serves the working tree on a local port and
 * walks pages x widths x zoom x themes asserting, at each cell:
 *
 *   1. no horizontal body scroll,
 *   2. nothing sticking out past the right edge (unless it lives inside a
 *      container that legitimately scrolls on x),
 *   3. no clipped interactive control (a button/tab/input whose own content
 *      is wider than its box),
 *   4. no dead gutter — the page's widest frame actually uses the viewport.
 *
 * Browser zoom is modelled the way the browser does it: at 150% on a 1440px
 * window the layout viewport is 960 CSS px and the DPR is 1.5. So a cell is
 * viewport = round(width / zoom) with deviceScaleFactor = zoom.
 *
 * Usage: node scripts/verify-fluid-layout.mjs [pageFilter] [--quick]
 *                                             [--base=https://host] [--jobs=N]
 *
 * --base points the same matrix at a DEPLOYED origin instead of the working
 * tree (WS-H H3). The local server is not started in that mode, so what is
 * audited is exactly what the CDN serves — busters, headers and all.
 *
 * CONCURRENCY. The 270 cells used to run one at a time, ~2.9s each, ~13
 * minutes — more than the other 33 gates combined, and the reason the pre-push
 * full run kept being skipped. They now run through a worker pool.
 *
 * This is safe HERE in a way it explicitly is not for perf:check, and the
 * distinction is worth keeping straight: this gate asserts on GEOMETRY
 * (getBoundingClientRect, scrollWidth, clientWidth), which is a pure function
 * of viewport and stylesheet. perf:check asserts on WALL-CLOCK FCP, so
 * anything running beside it changes the number it measures — which is why it
 * has a `solo` lane in run-gates.mjs and must keep it. Overlapping cells here
 * cannot change a layout result; it can only change how long we wait for one.
 *
 * What contention CAN do is delay a cell reaching a settled state before it is
 * measured, which would read as a spurious `dead gutter`. Two guards: the
 * settle wait below is a real condition (fonts loaded + two rAFs) rather than
 * the flat 400ms sleep it replaced, and the pool is capped well under the core
 * count. --jobs=1 restores the old serial walk exactly if a result is ever
 * suspect.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.LAYOUT_CHECK_PORT || 8934);
const FILTER = process.argv.slice(2).find((a) => !a.startsWith('--')) || '';
const QUICK = process.argv.includes('--quick');
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').slice(7).replace(/\/$/, '');
// Capped at 6: each job is a full browser context, and the point of the cap is
// that a contended cell must still settle inside its timeouts. 10-core box →
// 6. --jobs / LAYOUT_CHECK_JOBS override; 1 is the old serial walk.
const JOBS = Math.max(1, Number(
  (process.argv.find((a) => a.startsWith('--jobs=')) || '').slice(7)
  || process.env.LAYOUT_CHECK_JOBS
  || Math.min(6, Math.max(2, os.cpus().length - 4)),
));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Unstubbed API calls 404 on purpose so real empty states render.
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
if (!BASE) await new Promise((r) => server.listen(PORT, r));

const PAGES = [
  { name: 'index', authed: false },
  { name: 'portal', authed: true },
  // S7's new primary tab. Worth the 30 cells: it is the one page built entirely
  // out of auto-fit grids (modules + doors), the shape that collapses first.
  { name: 'flightplan', authed: true },
  // S12's Application Tracker. Worth the cells for the same reason flightplan
  // is: the board is a five-column grid that collapses to a stacked list, which
  // is the exact shape this gate exists to walk. Like `review`, the harness
  // 404s /applications so the CARDS never render — the frame, the header and
  // the empty-state are what is covered here.
  { name: 'applications', authed: true },
  // S11's Month in Review. In the matrix for its FRAME — a new page's header,
  // month picker, nav and footer are exactly what this gate exists to walk.
  // Its section rows are not covered here: `/month-review` 404s in this harness
  // by design, so the lists never render. Those are proven by the signed-in
  // headless probe recorded in the S11 ledger entry, the same split S9's radar
  // and S10's commitments module already use.
  { name: 'review', authed: true },
  { name: 'dashboard', authed: true, hub: true },
  { name: 'coach', authed: true },
  { name: 'roadmap', authed: true },
  { name: 'resume', authed: true },
  { name: 'quiz', authed: false },
  { name: 'career', authed: true, query: 'slug=product-management' },
  { name: 'pricing', authed: false },
  // S19's B2B door. Worth the 30 cells: it is the only page on the site with a
  // five-field form grid AND a card grid AND an FAQ list stacked in one column
  // flow, which is the shape that overflows first. `community` is deliberately
  // NOT walked — it is a strict subset of these shapes (one card grid, one
  // input), the same reasoning that keeps terms.html and security.html out.
  { name: 'career-centers', authed: false },
  // S2's document pages. Only two of the four: privacy covers the prose+wide
  // <table> path (the real overflow risk — a processor table has to scroll
  // inside its own box, never the body), and contact covers the two-column
  // form grid. terms.html and security.html are structurally identical to
  // privacy.html, so walking them too would cost 60 cells to re-prove the
  // same stylesheet.
  { name: 'privacy', authed: false },
  { name: 'contact', authed: false },
];
const WIDTHS = QUICK ? [1280, 2560] : [1024, 1280, 1440, 1920, 2560];
const ZOOMS = QUICK ? [1] : [0.67, 1, 1.5];
const THEMES = QUICK ? ['light'] : ['light', 'dark'];
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

// Runs in the page. Returns every violation it can see, with enough of a
// selector to find the offender in CSS.
const AUDIT = () => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, bodyScroll: 0, overflow: [], clipped: [], widestFrame: 0 };
  const doc = document.documentElement;
  out.bodyScroll = Math.max(doc.scrollWidth, document.body.scrollWidth) - vw;

  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  // Only a real scroll container excuses a wide child. `hidden`/`clip` do not:
  // they stop the body scrolling but silently amputate the content, which is
  // the bug B3 exists to catch — and html/body carry overflow-x: clip
  // site-wide, so walking into them would excuse everything.
  const scrollsX = (el) => {
    for (let n = el.parentElement; n && n !== document.body && n !== doc; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // Widest thing that behaves like a page frame: a box holding real content,
    // a canvas (the hub's map IS its frame, and it is position:fixed), or —
    // added with S2's document pages — a box that spans the viewport AND paints
    // it. The `children.length > 1` proxy was standing in for "this is chrome,
    // not a spacer", and it misses the commonest shape of chrome there is: a
    // full-bleed bar wrapping exactly one centred container. privacy.html's
    // <header class="fw-doc-nav"> and <footer class="fw-footer"> are 3805px of
    // painted, edge-to-edge bar at 2560px@67%, and the old rule scored the page
    // at 1760 (its inner container) and called that a dead gutter — when what a
    // reader sees is chrome running the full width of the screen.
    //
    // This does NOT soften what the check is for. A real dead gutter is a
    // narrow card floating on the body's own background, and there `body *`
    // contains nothing full-bleed and painted, so it still fails. The rule is
    // now "something paints the viewport edge to edge", which is the thing the
    // eye actually reads as a frame.
    const paintsViewport = r.width >= vw - 24
      && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    if (r.width > out.widestFrame && r.width <= vw + 1
        && (el.children.length > 1 || el.tagName === 'CANVAS' || paintsViewport)) {
      out.widestFrame = Math.round(r.width);
    }
    // Parked off-canvas (the hub's closed detail drawer is fixed + translated
    // a full panel width right). That is a closed drawer, not an overflow.
    if (r.left >= vw - 1) continue;
    if (r.right > vw + 1 && !scrollsX(el)) {
      out.overflow.push({ sel: label(el), right: Math.round(r.right) });
    }
    if (el.matches('button, .btn, .cta-btn, .app-nav-tab, input, select, .pill, .chip')) {
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll'
          && cs.textOverflow !== 'ellipsis') {
        out.clipped.push({ sel: label(el), over: el.scrollWidth - el.clientWidth });
      }
    }
  }
  out.overflow = out.overflow.slice(0, 6);
  out.clipped = out.clipped.slice(0, 6);
  return out;
};

// The matrix, flattened. Built in the original page→theme→width→zoom order so
// the failure list stays in the order a reader expects no matter which worker
// happened to pick a cell up.
const CELLS = [];
for (const spec of PAGES) {
  if (FILTER && !spec.name.includes(FILTER)) continue;
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      for (const zoom of ZOOMS) CELLS.push({ spec, theme, width, zoom });
    }
  }
}

// Replaces a flat 400ms sleep. Under a worker pool a fixed sleep is exactly the
// wrong shape: it is dead time on a fast cell and not enough on a contended
// one. Wait for the real post-layout conditions instead — webfonts resolved
// (a fallback face measures differently, which is what B3 is looking at) and
// two animation frames, so anything the entrance convention schedules on rAF
// has landed before the geometry is read.
const SETTLE = () => new Promise((resolve) => {
  const frames = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
  (document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve()).then(frames);
});

const browser = await chromium.launch();

async function runCell({ spec, theme, width, zoom }) {
  const label = `${spec.name} ${width}px @${Math.round(zoom * 100)}% ${theme}`;
  const vp = { width: Math.round(width / zoom), height: Math.round(900 / zoom) };
  // newContext() belongs INSIDE the try. If the browser dies mid-run — which is
  // what heavy contention looks like, e.g. two full walks racing — every
  // in-flight worker's next newContext() rejects, and outside the try that is an
  // uncaught exception that kills the process with no verdict at all. Observed:
  // 168 clean cells, then 6 simultaneous failures (= JOBS) and a hard crash. A
  // gate may report a failure; it may not vanish.
  let ctx = null;
  try {
    ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: zoom, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    if (spec.authed) {
      await page.route('**/auth/me', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ email: PROBE_EMAIL }),
      }));
    }
    await page.addInitScript((a) => {
      localStorage.setItem('flightway-theme', a.theme);
      localStorage.setItem('fw_hub_quiz_v1', a.quiz);
      localStorage.setItem('fw_hub_fit_explainer_seen_v1', '1');
      if (a.authed) sessionStorage.setItem('fw-session-hint', a.email);
    }, { theme, quiz: QUIZ_SEED, authed: !!spec.authed, email: PROBE_EMAIL });

    const url = `${BASE || `http://127.0.0.1:${PORT}`}/${spec.name}.html${spec.query ? '?' + spec.query : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (spec.hub) {
      await page.waitForFunction(() => {
        const el = document.getElementById('hub-loading');
        return el && el.classList.contains('is-hidden');
      }, { timeout: 15000 });
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.evaluate(SETTLE);

    const r = await page.evaluate(AUDIT);
    const bad = [];
    if (r.bodyScroll > 1) bad.push(`body scrolls x by ${r.bodyScroll}px`);
    for (const o of r.overflow) bad.push(`overflows right: ${o.sel} @${o.right} (vw ${r.vw})`);
    for (const c of r.clipped) bad.push(`clipped control: ${c.sel} by ${c.over}px`);
    // A page frame that uses less than half the viewport is a dead gutter.
    if (r.widestFrame < r.vw * 0.5) bad.push(`dead gutter: widest frame ${r.widestFrame} of ${r.vw}`);
    return { label, bad };
  } catch (e) {
    return { label, bad: [`LOAD FAILED :: ${e.message.split('\n')[0]}`] };
  } finally {
    // Always closed, or a thrown cell leaks a context and starves the pool.
    // Null-guarded: when newContext() itself is what failed there is nothing to
    // close, and an unguarded .close() here would throw out of the finally and
    // re-create exactly the uncaught crash the try above exists to prevent.
    if (ctx) await ctx.close().catch(() => {});
  }
}

const results = new Array(CELLS.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, CELLS.length) }, async () => {
  while (next < CELLS.length) {
    const i = next++;
    results[i] = await runCell(CELLS[i]);
    process.stdout.write(results[i].bad.length ? 'x' : '.');
  }
}));
await browser.close();
if (!BASE) server.close();

// Progress dots land in completion order; the report is rebuilt in matrix
// order so two runs of the same tree print the same thing.
const failures = results.filter((r) => r.bad.length)
  .map((r) => `${r.label}\n    - ${r.bad.join('\n    - ')}`);

if (failures.length) {
  console.error(`\nlayout:check FAIL — ${failures.length} of ${results.length} cells\n`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`\nlayout:check PASS — ${results.length} cells clean (x${JOBS})`);
