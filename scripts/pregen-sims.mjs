#!/usr/bin/env node
/**
 * Pre-generate career simulations for high-traffic careers so most users
 * never see the ~20s first-generation wait. Safe to re-run: cached sims
 * return instantly (cached:true) and don't hit Gemini.
 *
 * Usage:
 *   SIM_BASE_URL=https://<deployment> node scripts/pregen-sims.mjs
 *   node scripts/pregen-sims.mjs --base https://... --delay 8000
 *
 * Runs sequentially with a delay to respect Gemini free-tier limits.
 * The 7 authored flights don't need generation and are skipped.
 */

const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

const BASE = arg('base', process.env.SIM_BASE_URL || 'https://flightwayjacobprototype.pages.dev');
const DELAY_MS = Number(arg('delay', process.env.SIM_PREGEN_DELAY || 8000));

// Top careers students actually look at (hub catalog + quiz-match volume),
// minus the 7 authored ones. Extend freely — reruns are cheap.
const CAREERS = [
  ['software-engineer', 'Software Engineer'],
  ['data-scientist', 'Data Scientist'],
  ['registered-nurses', 'Registered Nurse'],
  ['investment-banker', 'Investment Banker'],
  ['lawyers', 'Lawyer'],
  ['teacher', 'High School Teacher'],
  ['entrepreneur', 'Entrepreneur'],
  ['financial-analysts', 'Financial Analyst'],
  ['management-consultant', 'Management Consultant'],
  ['marketing-manager', 'Marketing Manager'],
  ['graphic-designers', 'Graphic Designer'],
  ['mechanical-engineers', 'Mechanical Engineer'],
  ['civil-engineers', 'Civil Engineer'],
  ['physical-therapists', 'Physical Therapist'],
  ['physician-assistants', 'Physician Assistant'],
  ['pharmacists', 'Pharmacist'],
  ['psychologist', 'Psychologist'],
  ['journalist', 'Journalist'],
  ['architect', 'Architect'],
  ['cybersecurity-analyst', 'Cybersecurity Analyst'],
  ['devops-engineer', 'DevOps Engineer'],
  ['electrician', 'Electrician'],
  ['human-resources-manager', 'HR Manager'],
  ['operations-manager', 'Operations Manager'],
  ['biomedical-engineer', 'Biomedical Engineer'],
  ['environmental-scientist', 'Environmental Scientist'],
  ['social-worker', 'Social Worker'],
  ['video-producer', 'Video Producer'],
  ['copywriter', 'Copywriter'],
  ['actuary', 'Actuary'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0, cached = 0, failed = 0;
for (const [slug, name] of CAREERS) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + '/sim-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name }),
    });
    const data = await res.json().catch(() => ({}));
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (res.ok && data.sim) {
      if (data.cached) { cached += 1; console.log(`cached  ${slug} (${secs}s)`); }
      else { ok += 1; console.log(`built   ${slug} (${secs}s)`); }
    } else {
      failed += 1;
      console.warn(`FAILED  ${slug}: ${res.status} ${data.error || ''}`);
    }
  } catch (err) {
    failed += 1;
    console.warn(`FAILED  ${slug}: ${err.message}`);
  }
  if (!cached || CAREERS.indexOf(CAREERS.find(c => c[0] === slug)) < CAREERS.length - 1) await sleep(DELAY_MS);
}

console.log(`\nDone: ${ok} built, ${cached} already cached, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
