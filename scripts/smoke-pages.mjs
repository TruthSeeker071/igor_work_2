#!/usr/bin/env node
// Asserts portal/career/roadmap boot with zero pageerrors. Catches the class
// of bug scripts/smoke-hub-load.mjs already catches for dashboard.html (a
// runtime throw during boot that no watchdog/error-UI surfaces) — see
// docs/CONVERSATION_HANDOFF.md "Hub boot hotfix" for the incident this exists
// to prevent recurring on other pages.
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE_URL || 'https://flightwayjacobprototype.pages.dev';
const PAGES = ['/portal.html', '/career.html?slug=chief-executives', '/roadmap.html', '/simulation.html', '/pricing.html'];

const browser = await chromium.launch();
const page = await browser.newPage();
let failed = false;
try {
  for (const path of PAGES) {
    const errors = [];
    page.removeAllListeners('pageerror');
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(3000);
    if (errors.length) {
      failed = true;
      console.error('FAIL', path, '-', errors.join('; '));
    } else {
      console.log('OK', path);
    }
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
