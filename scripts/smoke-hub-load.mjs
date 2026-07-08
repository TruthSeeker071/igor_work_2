#!/usr/bin/env node
/**
 * Assert Career Hub dismisses #hub-loading within a few seconds.
 * Requires: npx playwright install chromium (once)
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_HUB_URL || 'https://flightwayjacobprototype.pages.dev/dashboard';
const TIMEOUT_MS = 8000;

async function waitLoadingHidden(page) {
  await page.waitForFunction(function () {
    var el = document.getElementById('hub-loading');
    return el && el.classList.contains('is-hidden');
  }, { timeout: TIMEOUT_MS });
}

async function waitHubPaint(page) {
  await page.evaluate(function () {
    return new Promise(function (resolve) {
      var n = 4;
      function tick() {
        if (n-- <= 0) return resolve();
        requestAnimationFrame(tick);
      }
      tick();
    });
  });
}

async function assertHubOverviewState(page, label) {
  await waitHubPaint(page);
  const zones = await page.evaluate(function () {
    return window.FWOnetHub && typeof FWOnetHub.getOverviewZones === 'function'
      ? FWOnetHub.getOverviewZones().length
      : 0;
  });
  if (zones < 18) {
    throw new Error('[' + label + '] expected >= 18 overview zones, got ' + zones);
  }
  const hasPaint = await page.evaluate(function () {
    var c = document.getElementById('map-canvas');
    if (!c) return false;
    var ctx = c.getContext('2d');
    var w = c.width;
    var h = c.height;
    var samples = [
      [0.25, 0.35],
      [0.5, 0.45],
      [0.72, 0.55],
    ];
    for (var i = 0; i < samples.length; i++) {
      var sx = Math.floor(w * samples[i][0]);
      var sy = Math.floor(h * samples[i][1]);
      var d = ctx.getImageData(sx, sy, 1, 1).data;
      if (!(d[0] > 215 && d[1] > 225 && d[2] > 245)) return true;
    }
    return false;
  });
  if (!hasPaint) {
    throw new Error('[' + label + '] canvas has no painted zone content on overview boot');
  }
  console.log('OK hub loading dismissed:', label, '(' + zones + ' zones)');
}

async function assertHubLoads(page, label) {
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitLoadingHidden(page);
  await assertHubOverviewState(page, label);
  if (errors.length) {
    throw new Error('[' + label + '] page errors: ' + errors.join('; '));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await assertHubLoads(page, 'empty session');
  await page.evaluate(function () {
    localStorage.setItem('fw_hub_quiz_v1', JSON.stringify({
      name: 'Smoke',
      scores: { creative: 90, tech: 40, marketing: 55 },
      sectorFitSheet: {
        version: 1,
        scores: { creative: 90, tech: 40, marketing: 55 },
        seededAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        history: [],
      },
    }));
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitLoadingHidden(page);
  await assertHubOverviewState(page, 'with quiz localStorage');
  const fitSpread = await page.evaluate(function () {
    if (!window.FWOnetHub || typeof FWOnetHub.getOverviewZones !== 'function') return null;
    var zones = FWOnetHub.getOverviewZones();
    var fits = zones.map(function (z) {
      var f = FWOnetHub.getZoneFit(z.id);
      return f && f.personalityFit != null ? f.personalityFit : null;
    }).filter(function (v) { return v != null; });
    if (!fits.length) return null;
    return { min: Math.min.apply(null, fits), max: Math.max.apply(null, fits) };
  });
  if (!fitSpread || fitSpread.max - fitSpread.min < 5) {
    throw new Error('[with quiz localStorage] zone personality fits lack spread: ' + JSON.stringify(fitSpread));
  }
} finally {
  await browser.close();
}
