#!/usr/bin/env node
/**
 * og:build — render the social share cards (V2 S2).
 *
 * og:image is the one asset in the product that NOBODY on the team ever sees.
 * It renders in someone else's Slack, someone else's iMessage, a LinkedIn feed —
 * never on flightway.ai. That is exactly why it rots, and why this is a build
 * script instead of three PNGs someone exported from a design tool once: the
 * cards are generated from the same brand mark and the same palette the site
 * uses, so they cannot drift away from it silently.
 *
 * The mark is not re-drawn here. The path data is READ OUT of
 * assets/js/shared/brand.js at build time — that file is the single source of
 * truth for the bird (it already replaced the PNG), and parsing it means a
 * future tweak to the mark reaches the share cards on the next `npm run
 * og:build` instead of leaving them showing an old logo forever.
 *
 * Output: assets/og/og-<name>.png at exactly 1200x630 (the size Facebook,
 * LinkedIn, Slack and X all crop from). Committed to the repo — this is not
 * run in CI, and a missing card degrades a share into a bare-text link.
 *
 * Run: npm run og:build   (then bump the ?v= stamp on every referencing page)
 * Gate: verify:meta asserts each file exists AND is 1200x630, so a corrupted or
 * half-written render fails the suite rather than shipping.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'og');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');

// Palette lifted from [data-theme="dark"] in assets/css/flightway-theme.css.
// Literal here rather than parsed: a share card is a fixed composition, and the
// dark plate is the point — it must not follow a future theme change by accident.
const C = {
  bg: '#141312',        // --bg
  surface: '#1e1b19',   // --surface
  text: '#f5eee9',      // --text
  muted: '#9e938b',     // --text-muted
  border: '#342e2a',    // --border
  markFrom: '#EF4C16',  // --fw-mark-from
  markTo: '#F5A216',    // --fw-mark-to
};

/** Read the bird outline out of brand.js so the card can never show a stale mark. */
function readBirdMark() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/shared/brand.js'), 'utf8');
  const vb = src.match(/var BIRD_VB\s*=\s*'([^']+)'/);
  const d = src.match(/var BIRD_D\s*=\s*'([^']+)'/);
  if (!vb || !d) {
    throw new Error('og:build — could not find BIRD_VB/BIRD_D in assets/js/shared/brand.js. '
      + 'The mark moved; update this parser rather than hard-coding the path.');
  }
  return { viewBox: vb[1], d: d[1] };
}

/**
 * The cards. `eyebrow` is the constant brand line, `headline` is the promise,
 * `sub` is the proof. Copy is deliberately the SAME sentence each page already
 * ships in its own <meta name="description"> — a share card that promises
 * something the landing page does not say is a bounce.
 */
const CARDS = [
  {
    name: 'og-default',
    eyebrow: 'CAREER DEVELOPMENT FOR STUDENTS',
    headline: 'Your dream, turbocharged',
    sub: '750+ real careers, scored against your own strengths — then a step-by-step roadmap to the one you pick.',
  },
  {
    name: 'og-quiz',
    eyebrow: 'THE 90-SECOND CAREER QUIZ',
    headline: 'Which careers actually fit you?',
    sub: 'Ten questions, matched against 750+ real occupations — with the reasoning shown, not hidden.',
  },
  {
    name: 'og-pricing',
    eyebrow: 'FLIGHT PLAN',
    headline: 'Out-plan the competition',
    sub: 'A career coach costs $150/hour. Flight Plan is about $2.30/week.',
  },
  // S13. One card shared by the directory and all ~780 career pages. Per-career
  // images were spec'd as an optional stretch and are not worth 780 renders in
  // a build step nobody runs automatically — the title and description in the
  // share preview already carry the occupation's name.
  {
    name: 'og-careers',
    eyebrow: 'CAREER GUIDES',
    headline: 'What the job actually takes',
    sub: 'Real occupational data on 780+ careers — the work, the skills, the education path, and how your fit is scored.',
  },
  // S14. One card shared by the guides hub and all eight guide pages. Same
  // reasoning as og-careers: the guide's own title and description already
  // carry the specifics into the share preview.
  {
    name: 'og-guides',
    eyebrow: 'FLIGHTWAY GUIDES',
    headline: 'Career advice that shows its work',
    sub: 'How to choose a direction, how to judge the tools that claim to help, and what the work looks like week to week.',
  },
];

function fontFace(family, file, weights) {
  const abs = path.join(FONT_DIR, file).split(path.sep).join('/');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weights};`
    + `src:url('file://${abs}') format('woff2');}`;
}

function cardHtml({ eyebrow, headline, sub }, bird) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${fontFace('Inter', 'inter-latin.woff2', '100 900')}
${fontFace('Space Grotesk', 'space-grotesk-latin.woff2', '300 700')}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{
  background:${C.bg};
  color:${C.text};
  font-family:'Inter',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
  position:relative;
}
/* Warm bloom off the mark, so the plate reads as lit rather than flat black
   in a feed full of white cards. */
.glow{
  position:absolute;left:-180px;top:-220px;width:820px;height:820px;border-radius:50%;
  background:radial-gradient(circle, rgba(239,76,22,.20) 0%, rgba(239,76,22,.07) 42%, rgba(239,76,22,0) 68%);
}
.grid{
  position:absolute;inset:0;
  background-image:linear-gradient(${C.border} 1px, transparent 1px),
                   linear-gradient(90deg, ${C.border} 1px, transparent 1px);
  background-size:60px 60px;
  opacity:.16;
  -webkit-mask-image:linear-gradient(120deg, transparent 30%, #000 100%);
          mask-image:linear-gradient(120deg, transparent 30%, #000 100%);
}
.plate{position:relative;height:100%;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between}
.brand{display:flex;align-items:center;gap:16px}
.brand svg{width:52px;height:59px;display:block}
.brand .word{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:38px;letter-spacing:-.01em}
.eyebrow{margin-top:6px;font-size:17px;font-weight:600;letter-spacing:.16em;color:${C.markTo}}
h1{
  font-family:'Space Grotesk',sans-serif;font-weight:700;
  font-size:74px;line-height:1.04;letter-spacing:-.025em;
  max-width:960px;
}
.sub{margin-top:22px;font-size:26px;line-height:1.42;color:${C.muted};max-width:900px}
.rule{width:104px;height:5px;border-radius:3px;margin-bottom:26px;
  background:linear-gradient(90deg, ${C.markFrom}, ${C.markTo});}
.foot{display:flex;align-items:center;justify-content:space-between;
  font-size:20px;color:${C.muted};border-top:1px solid ${C.border};padding-top:22px}
.foot b{color:${C.text};font-weight:600}
</style></head><body>
<div class="glow"></div><div class="grid"></div>
<div class="plate">
  <div>
    <div class="brand">
      <svg viewBox="${bird.viewBox}" aria-hidden="true"><defs>
        <linearGradient id="m" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="${C.markFrom}"/><stop offset="1" stop-color="${C.markTo}"/>
        </linearGradient></defs>
        <path fill="url(#m)" fill-rule="evenodd" d="${bird.d}"/>
      </svg>
      <span class="word">FlightWay</span>
    </div>
    <p class="eyebrow">${eyebrow}</p>
  </div>
  <div>
    <div class="rule"></div>
    <h1>${headline}</h1>
    <p class="sub">${sub}</p>
  </div>
  <div class="foot"><span><b>flightway.ai</b></span><span>Free to start · No card required</span></div>
</div>
</body></html>`;
}

const bird = readBirdMark();
fs.mkdirSync(OUT_DIR, { recursive: true });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-og-'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
let built = 0;
try {
  for (const card of CARDS) {
    const tmp = path.join(tmpDir, `${card.name}.html`);
    fs.writeFileSync(tmp, cardHtml(card, bird));
    await page.goto(`file://${tmp}`, { waitUntil: 'load' });
    // The faces are local files, but they are still async — screenshotting
    // before they resolve silently ships a card typeset in the fallback stack.
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(OUT_DIR, `${card.name}.png`);
    await page.screenshot({ path: out, type: 'png' });
    const { size } = fs.statSync(out);
    console.log(`  ok  assets/og/${card.name}.png  (${Math.round(size / 1024)}KB)`);
    built += 1;
  }
} finally {
  await browser.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`og:build — ${built} card(s) written to assets/og/`);
