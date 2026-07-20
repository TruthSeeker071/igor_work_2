// resume:ui-check — resume.html interaction invariants (post-ship fix plan
// R.4/R.5). Serves the working tree with stubbed auth + API routes (same
// pattern as ui-screenshots.mjs) and drives the page with Playwright:
//   1. skills: type + Enter → removable tag, preview, draft; blur commits too.
//   2. guided build: CTA → modal Q&A (options + template step) → full draft
//      lands in the editor and is saved to /resume-doc.
//   3. persistence: reloading mid-flow resumes the question state.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8934;
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
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const SOC = '15-2051.00';
// readLocalQuiz (auth.js) requires a `scores` object before it returns the doc.
const QUIZ_SEED = JSON.stringify({ name: 'Probe', scores: { tech: 80 }, careerFocus: { soc: SOC, name: 'Data Scientist' } });

const GUIDED_QUESTIONS = [
  { question: 'About how many people used your biggest project?', options: ['~10', '~100', 'Not sure'] },
  { question: 'How long did your longest commitment run?', options: ['One semester', 'A full year'] },
];
const DRAFT_DOC = {
  v: 1,
  contact: { name: '', email: '', phone: '', location: '', links: [] },
  summary: 'Analytical student with hands-on project experience.',
  template: 'classic',
  sections: [
    { kind: 'experience', heading: 'Work Experience', items: [{ org: 'Data Club', role: 'Analyst', start: '2025', end: '2026', bullets: [{ text: 'Analyzed survey results for around 100 users', src: 'experience', dims: [] }] }] },
    { kind: 'education', heading: 'Education', items: [{ org: 'State University', role: 'B.S. Statistics', start: '2024', end: '2028', bullets: [] }] },
    { kind: 'projects', heading: 'Projects', items: [] },
    { kind: 'skills', heading: 'Skills', flat: ['Python', 'SQL', 'Communication'] },
  ],
};

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok - ${name}`); }
  catch (err) { failures += 1; console.error(`  FAIL - ${name}\n    ${err.message}`); }
}

async function newResumePage(browser, { onBuilderPost, guidedSeed } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const saves = [];
  await page.route('**/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'probe@flightway.local' }) }));
  await page.route('**/resume-doc*', (r) => {
    if (r.request().method() === 'POST') {
      saves.push(JSON.parse(r.request().postData() || '{}'));
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'doc-1', updated_at: new Date().toISOString() }) });
      return;
    }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resumes: [], latest: null }) });
  });
  await page.route('**/resume-builder*', (r) => {
    if (r.request().method() === 'POST' && onBuilderPost) { onBuilderPost(r); return; }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: null }) });
  });
  await page.addInitScript((args) => {
    sessionStorage.setItem('fw-session-hint', 'probe@flightway.local');
    localStorage.setItem('fw_hub_quiz_v1', args.quiz);
    localStorage.removeItem('fw_resume_draft_v1');
    if (args.guidedSeed) localStorage.setItem('fw_resume_guided_v1', args.guidedSeed);
    else localStorage.removeItem('fw_resume_guided_v1');
  }, { quiz: QUIZ_SEED, guidedSeed: guidedSeed || null });
  await page.goto(`http://127.0.0.1:${PORT}/resume.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#resume-skill-input', { timeout: 10000 });
  await page.waitForTimeout(800);
  return { ctx, page, saves, pageErrors };
}

const browser = await chromium.launch();

await test('skills: Enter commits a removable tag into preview + draft; blur commits too', async () => {
  const { ctx, page, pageErrors } = await newResumePage(browser);
  await page.evaluate(() => document.getElementById('resume-skill-input').scrollIntoView());
  await page.click('#resume-skill-input');
  await page.keyboard.type('Python');
  await page.keyboard.press('Enter');
  await page.keyboard.type('SQL');
  await page.evaluate(() => document.getElementById('resume-skill-input').blur());
  await page.waitForTimeout(1100);
  const r = await page.evaluate(() => ({
    tags: Array.from(document.querySelectorAll('.resume-skill-tag')).map((t) => t.textContent.replace('✕', '')),
    preview: document.getElementById('resume-preview-pane').innerHTML,
    draft: JSON.parse(localStorage.getItem('fw_resume_draft_v1')).resume.sections.find((s) => s.kind === 'skills').flat,
  }));
  assert.deepEqual(r.tags, ['Python', 'SQL'], 'both commit gestures render tags');
  assert.ok(r.preview.includes('Python') && r.preview.includes('SQL'), 'preview shows skills');
  assert.deepEqual(r.draft, ['Python', 'SQL'], 'draft persisted');
  await page.click('.resume-skill-tag button');
  await page.waitForTimeout(200);
  const left = await page.evaluate(() => document.querySelectorAll('.resume-skill-tag').length);
  assert.equal(left, 1, 'remove button works');
  assert.deepEqual(pageErrors, [], 'no page errors');
  await ctx.close();
});

await test('guided build: Q&A modal → full draft lands in editor and saves', async () => {
  const { ctx, page, saves, pageErrors } = await newResumePage(browser, {
    onBuilderPost: (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.mode === 'questions') {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions: GUIDED_QUESTIONS }) });
        return;
      }
      assert.equal(body.mode, 'draft-doc', 'second call is draft-doc');
      assert.equal(body.answers.length, 2, 'both answers folded into generation');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resume: DRAFT_DOC, template: 'classic', questions: ['What was the survey response rate?'] }) });
    },
  });
  await page.click('#resume-guided-btn');
  await page.waitForSelector('.fw-qwiz-option', { timeout: 8000 });
  await page.click('.fw-qwiz-options button:nth-child(2)'); // ~100
  await page.waitForTimeout(150);
  await page.click('.fw-qwiz-options button:nth-child(1)'); // One semester
  await page.waitForTimeout(150);
  // Template step (or direct finish when no format profile is loaded).
  const hasWizard = await page.evaluate(() => !!document.querySelector('.fw-qwiz-overlay'));
  if (hasWizard) await page.click('#fw-qwiz-skip');
  await page.waitForFunction(() => (document.getElementById('resume-summary') || {}).value !== '', { timeout: 10000 });
  const r = await page.evaluate(() => ({
    summary: document.getElementById('resume-summary').value,
    skillTags: document.querySelectorAll('.resume-skill-tag').length,
    preview: document.getElementById('resume-preview-pane').innerHTML,
    expInputs: Array.from(document.querySelectorAll('[data-items="experience"] input')).map((i) => i.value),
    gapQsHidden: document.getElementById('resume-suggest-questions-wrap').hidden,
  }));
  assert.ok(r.summary.includes('Analytical student'), 'summary landed in editor');
  assert.equal(r.skillTags, 3, 'AI-populated skills render as tags');
  assert.ok(r.preview.includes('Data Club'), 'preview shows built experience');
  assert.ok(r.expInputs.includes('Data Club'), 'experience editable in manual editor');
  assert.equal(r.gapQsHidden, false, 'leftover gap questions surfaced');
  assert.ok(saves.length >= 1 && saves[0].json.summary.includes('Analytical'), 'built doc saved to /resume-doc');
  assert.deepEqual(pageErrors, [], 'no page errors');
  await ctx.close();
});

await test('persistence: reload mid-flow resumes the question state', async () => {
  // Loading the page with a mid-flow state in localStorage IS the post-reload
  // situation — the state a real reload would find.
  const { ctx, page } = await newResumePage(browser, {
    guidedSeed: JSON.stringify({
      soc: SOC, careerName: 'Data Scientist',
      questions: GUIDED_QUESTIONS,
      answers: [{ prompt: GUIDED_QUESTIONS[0].question, answer: '~100' }], idx: 1,
    }),
  });
  const label = await page.evaluate(() => document.getElementById('resume-guided-btn').textContent);
  assert.ok(/Continue building \(1 questions? left\)/.test(label), `CTA offers to continue (got "${label}")`);
  await page.click('#resume-guided-btn');
  await page.waitForSelector('.fw-qwiz-question', { timeout: 8000 });
  const q = await page.evaluate(() => ({
    text: document.querySelector('.fw-qwiz-question').textContent,
    progress: document.querySelector('.fw-qwiz-progress').textContent,
  }));
  assert.equal(q.text, GUIDED_QUESTIONS[1].question, 'wizard resumes at the unanswered question');
  assert.equal(q.progress, 'Question 2 of 2', 'progress reflects restored position');
  await ctx.close();
});

await browser.close();
server.close();
if (failures) { console.error(`resume:ui-check FAILED (${failures})`); process.exit(1); }
console.log('resume:ui-check PASS');
