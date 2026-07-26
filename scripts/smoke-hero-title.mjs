#!/usr/bin/env node
// hero:check — the landing hero's gradient word must keep its descenders.
//
// Three commits (9d5fd5f, 11109f2, f7b5baa) tried to fix a beheaded 'g' in
// "turbocharged." by chasing overflow:hidden on the reveal mask. Nothing was
// ever clipping it: `.fw-mask-inner.peach` paints its gradient with
// background-clip:text and -webkit-text-fill-color:transparent, so ink outside
// the element's own box is simply never drawn — and at line-height 1.05 that
// box ends 0.131em above Inter's descenders. The fix is padding-bottom on the
// gradient element (with a matching negative margin so layout is untouched),
// which is invisible to the eye and therefore easy to "clean up" later. This
// asserts it, so a regression surfaces as a failing script instead of a fourth
// screenshot.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HERO_CHECK_PORT || 4599);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const body = await readFile(join(ROOT, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();

// Headroom = px between the lowest glyph ink and the bottom of the box the
// gradient is painted in. Negative means the descender is being erased.
async function check(label, viewport, theme) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  if (theme === 'light') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(2200);

  const r = await page.evaluate(() => {
    const el = document.querySelector('.fw-mask-inner.peach');
    const sub = document.querySelector('.fw-hero-sub');
    const ctas = document.querySelector('#fw-hero-ctas');
    const headroom = () => {
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(el.textContent);
      const ruler = document.createElement('span');
      ruler.textContent = 'x';
      ruler.style.cssText = 'display:inline-block;width:0;overflow:hidden;font:inherit';
      el.appendChild(ruler);
      const baseline = ruler.getBoundingClientRect().bottom - box.top;
      ruler.remove();
      return +(box.height - (baseline + m.actualBoundingBoxDescent)).toFixed(2);
    };
    const clipped = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflow !== 'visible' || s.clipPath !== 'none') clipped.push(`${n.tagName}.${n.className}`);
    }
    const withFix = { headroom: headroom(), sub: sub.getBoundingClientRect().top, ctas: ctas.getBoundingClientRect().top };
    // Same page with the rule neutralised: isolates the fix's layout cost.
    el.style.paddingBottom = '0px';
    el.style.marginBottom = '0px';
    const without = { headroom: headroom(), sub: sub.getBoundingClientRect().top, ctas: ctas.getBoundingClientRect().top };
    el.style.paddingBottom = '';
    el.style.marginBottom = '';
    return { withFix, without, clipped };
  });
  await page.close();

  const shifted = Math.abs(r.withFix.sub - r.without.sub) > 0.5 || Math.abs(r.withFix.ctas - r.without.ctas) > 0.5;
  const ok = r.withFix.headroom > 0 && !shifted && !r.clipped.length;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label.padEnd(20)} headroom ${String(r.withFix.headroom).padStart(7)}px`
    + `  (unpadded ${String(r.without.headroom).padStart(7)}px)`
    + `  layout shift: ${shifted ? 'YES' : 'none'}`
    + (r.clipped.length ? `  clipping ancestors: ${r.clipped.join(', ')}` : ''));
  return ok;
}

const results = [];
results.push(await check('desktop 1440 dark', { width: 1440, height: 900 }));
results.push(await check('desktop 1440 light', { width: 1440, height: 900 }, 'light'));
results.push(await check('laptop 1024 dark', { width: 1024, height: 768 }));
results.push(await check('mobile 390 dark', { width: 390, height: 844 }));
results.push(await check('mobile 320 light', { width: 320, height: 720 }, 'light'));

await browser.close();
server.close();

if (results.every(Boolean)) {
  console.log('hero:check PASS');
} else {
  console.error('hero:check FAILED — the gradient word is losing its descenders');
  process.exit(1);
}
