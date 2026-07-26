// artifacts:ui-check — the portfolio-evidence UI gate.
//
// assets/js/app/artifacts.js was orphaned from the 2026-07-10 streamlining
// until 2026-07-21: no page loaded it, so FWArtifacts was undefined and every
// call site took its guarded no-op branch while three live consumers kept
// reading the D1 `artifacts` table it is the only writer for. Nothing in the
// repo executed the client. This gate boots the real portal.html and drives
// the real "+ Add" button so the wiring cannot silently rot again.
//
// It pins four things that have each broken a shipped surface before:
//   1. The card mounts into #portal-fw2-stack, not the #portal-actions
//      fallback (renderActions() wipes #portal-actions on every render).
//   2. The modal meets the feature-intro.js standard: dialog semantics, a
//      focus trap that wraps BOTH ways, Escape, and focus restored to the
//      invoker.
//   3. A 5xx collapses to one friendly line and never leaks server text
//      (fw-errors.js does this on purpose — see FWErr.fromResponse).
//   4. Heading contrast inside .fw-iv-modal. That modal is hardcoded dark in
//      BOTH themes, but `[data-theme="light"] h3` in flightway-theme.css has
//      the same specificity as `.fw-iv-modal h3` and used to win on source
//      order, painting #373737 on #0e1730 — 1.46:1, versus the 4.5:1 AA floor.
//      The same h3 rule backs the shipped mock-interview modal, so this
//      assertion guards that surface too.
//
// It then drives pricing.html's intent modal for the same reason. A repo-wide
// sweep of the hardcoded-dark surfaces (`background: #0e1730|#0b1327|#06122b`
// in assets/css/*.css, cross-checked against every heading emitted into them)
// found exactly three live headings: #fw-art-title and #fw-iv-title above, and
// #fw-intent-title on pricing.html — the same defect, on the one page a
// prospective buyer sees first. .fw-iv-persona-card uses <div>s, and every
// input in those surfaces sets its own color, so this is the full set.
//
// Run: npm run artifacts:ui-check   (port 8938; ARTIFACTS_UI_PORT overrides)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ARTIFACTS_UI_PORT || 8938);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
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

/** Two coordinate gaps, so the gap select has real options to bind. */
const ROADMAP = {
  version: 2, targetCareerSlug: 'test-career', targetCareerName: 'Test Career',
  trunk: { id: 'trunk', title: 'Today' }, activePath: ['trunk', 'wp1'], nodes: [], decisions: [],
  focusTracker: {
    version: 3, waypointId: 'wp1',
    skillGaps: [
      { id: 'gap-math', dimIndex: 12, label: 'Mathematics', domain: 'skills', source: 'coordinate', user: 40, vBase: 40, target: 80, gap: 40, checklist: [], logs: [], status: 'in_progress', progress: 30 },
      { id: 'gap-prog', dimIndex: 21, label: 'Programming', domain: 'skills', source: 'coordinate', user: 50, vBase: 50, target: 90, gap: 40, checklist: [], logs: [], status: 'in_progress', progress: 10 },
    ],
  },
};

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => srgb(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseRgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

let failures = 0;
const errs = [];
const check = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
  await page.route('**/auth/me', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'probe@flightway.local' }),
  }));
  // GET lists nothing; POST fails 5xx with server detail the user must never see.
  await page.route('**/artifacts', (r) => (r.request().method() === 'POST'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'D1_ERROR: near "INTO": syntax error at offset 12' }) })
    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ artifacts: [] }) })));
  await page.addInitScript((a) => {
    localStorage.setItem('flightway-theme', a.theme);
    localStorage.setItem('fw_hub_quiz_v1', a.quiz);
    localStorage.setItem('fw_roadmap_v1', a.roadmap);
    sessionStorage.setItem('fw-session-hint', 'probe@flightway.local');
  }, { theme, quiz: JSON.stringify({ name: 'Probe', scores: { tech: 70 } }), roadmap: JSON.stringify(ROADMAP) });

  await page.goto(`http://127.0.0.1:${PORT}/portal.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);

  console.log(`\n[${theme}] portal.html — evidence card + artifact modal`);

  check(await page.locator('#portal-card-evidence').count() === 1, 'evidence card is injected');
  const host = await page.evaluate(() => {
    const c = document.getElementById('portal-card-evidence');
    return c && c.parentElement ? c.parentElement.id : null;
  });
  check(host === 'portal-fw2-stack', `card mounts into #portal-fw2-stack (got #${host})`);

  await page.locator('#fw-art-add').click();
  await page.waitForTimeout(350);

  const st = await page.evaluate(() => {
    const o = document.getElementById('fw-art-overlay');
    const m = o.querySelector('.fw-iv-modal');
    const h3 = m.querySelector('#fw-art-title');
    return {
      hidden: o.hidden,
      overlayPos: getComputedStyle(o).position,
      modalRadius: getComputedStyle(m).borderRadius,
      btnPad: getComputedStyle(o.querySelector('.fw-art-type-btn')).padding,
      role: m.getAttribute('role'),
      ariaModal: m.getAttribute('aria-modal'),
      labelledby: m.getAttribute('aria-labelledby'),
      pressed: [...o.querySelectorAll('.fw-art-type-btn')].map((b) => b.getAttribute('aria-pressed')),
      gapWrapHidden: o.querySelector('#fw-art-gap-wrap').hidden,
      gapOptCount: o.querySelectorAll('#fw-art-gap option').length,
      closeSvg: !!o.querySelector('#fw-art-close svg'),
      errRole: o.querySelector('#fw-art-error').getAttribute('role'),
      active: document.activeElement.id,
      modalBg: getComputedStyle(m).backgroundColor,
      h3Color: getComputedStyle(h3).color,
    };
  });

  check(!st.hidden, 'modal opens from the + Add button');
  check(st.overlayPos === 'fixed', `overlay picks up its CSS (position:${st.overlayPos})`);
  check(st.modalRadius !== '0px' && st.btnPad !== '0px',
    `modal + type buttons are styled (radius ${st.modalRadius}, btn pad ${st.btnPad})`);
  check(st.role === 'dialog' && st.ariaModal === 'true' && st.labelledby === 'fw-art-title',
    'dialog semantics: role, aria-modal, aria-labelledby');
  check(st.pressed.filter((p) => p === 'true').length === 1,
    `exactly one type button is aria-pressed (${st.pressed.join(',')})`);
  check(st.gapWrapHidden === false && st.gapOptCount === 3,
    `gap select binds the local roadmap's gaps (${st.gapOptCount} options)`);
  check(st.closeSvg, 'close button renders the lucide x');
  check(st.errRole === 'alert', 'error line carries role=alert');
  check(st.active === 'fw-art-title-in', `focus lands inside the modal (${st.active})`);

  // 4. Contrast — the modal is hardcoded dark in both themes, so the heading
  //    must stay light in both. A theme rule stealing it is invisible in dark.
  const ratio = contrast(parseRgb(st.h3Color), parseRgb(st.modalBg));
  check(ratio >= 4.5,
    `modal heading contrast is AA (${ratio.toFixed(2)}:1, ${st.h3Color} on ${st.modalBg})`);

  // aria-pressed must track the selection, not just the initial paint.
  await page.locator('.fw-art-type-btn[data-type="design"]').click();
  const pressedAfter = await page.evaluate(() => [...document.querySelectorAll('.fw-art-type-btn')]
    .map((b) => `${b.getAttribute('data-type')}:${b.getAttribute('aria-pressed')}`).join(' '));
  check(pressedAfter.includes('design:true') && !pressedAfter.includes('repo:true'),
    `aria-pressed follows the selection (${pressedAfter})`);

  // Focus trap must wrap in BOTH directions.
  await page.evaluate(() => document.getElementById('fw-art-close').focus());
  await page.keyboard.press('Shift+Tab');
  const back = await page.evaluate(() => document.activeElement.id);
  check(back === 'fw-art-save', `shift-tab off the first focusable wraps to the last (${back})`);
  await page.keyboard.press('Tab');
  const fwd = await page.evaluate(() => document.activeElement.id);
  check(fwd === 'fw-art-close', `tab off the last focusable wraps to the first (${fwd})`);

  // 3. A 5xx must collapse to one friendly line.
  await page.fill('#fw-art-title-in', 'Monte Carlo pricer');
  await page.locator('#fw-art-save').click();
  await page.waitForTimeout(600);
  const err = await page.evaluate(() => {
    const e = document.getElementById('fw-art-error');
    return { hidden: e.hidden, text: e.textContent };
  });
  check(!err.hidden, 'a failed save surfaces the error line');
  check(!/D1_ERROR|syntax error|offset/.test(err.text),
    `a 5xx does not leak server text (got "${err.text}")`);
  check(await page.evaluate(() => !document.getElementById('fw-art-overlay').hidden),
    'the modal stays open on a failed save, so the draft is not lost');

  // Escape closes and hands focus back to whatever opened it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    hidden: document.getElementById('fw-art-overlay').hidden,
    active: document.activeElement.id,
  }));
  check(after.hidden, 'Escape closes the modal');
  check(after.active === 'fw-art-add', `focus returns to the invoking + Add button (${after.active})`);

  // ── pricing.html — the third hardcoded-dark surface ──────────────────────
  // /config without stripeEnabled is what makes the CTA take the fake-door
  // branch (billing.js available() → false), which is what opens this modal.
  await page.route('**/config', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ stripeEnabled: false }),
  }));
  await page.route('**/waitlist-intent', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto(`http://127.0.0.1:${PORT}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  console.log(`\n[${theme}] pricing.html — intent modal`);

  await page.locator('.fw-intent-cta').first().click();
  await page.waitForTimeout(400);

  const intent = await page.evaluate(() => {
    const m = document.getElementById('fw-intent-modal');
    const d = m.querySelector('.fw-intent-dialog');
    const h3 = document.getElementById('fw-intent-title');
    return {
      hidden: m.hidden,
      dialogBg: getComputedStyle(d).backgroundColor,
      h3Color: getComputedStyle(h3).color,
    };
  });

  check(!intent.hidden, 'the intent modal opens from a pricing CTA');
  const intentRatio = contrast(parseRgb(intent.h3Color), parseRgb(intent.dialogBg));
  check(intentRatio >= 4.5,
    `intent heading contrast is AA (${intentRatio.toFixed(2)}:1, ${intent.h3Color} on ${intent.dialogBg})`);

  await ctx.close();
}

await browser.close();
server.close();

const real = errs.filter((e) => !/404|Failed to load resource/.test(e));
if (real.length) {
  console.log(`\nuncaught page errors (${real.length}):`);
  real.slice(0, 10).forEach((e) => console.log('  ' + e));
}
console.log(failures || real.length
  ? `\nartifacts:ui-check FAILED — ${failures} check(s), ${real.length} page error(s)`
  : '\nartifacts:ui-check passed');
process.exit(failures || real.length ? 1 : 0);
