// Resume Builder v2 — Layer 2 render/ATS invariants (run: npm run resume:ats-check)
// Loads the real shipped assets/js/shared/resume-render.js (a plain-script
// IIFE, not CJS) the way scripts/test-vectors.cjs loads client modules:
// readFileSync + eval into a stubbed module/window scope. The schema
// validator is a real ESM module, so it's loaded via dynamic import() inside
// an async main.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

let failures = 0;
function group(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL: ' + name);
    console.error('  ' + (err && err.stack ? err.stack : err));
  }
}

function loadRenderModule() {
  const code = fs.readFileSync(path.join(REPO, 'assets/js/shared/resume-render.js'), 'utf8');
  const sandboxModule = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'exports', code);
  fn(sandboxModule, sandboxModule.exports);
  if (!sandboxModule.exports || typeof sandboxModule.exports.toHtml !== 'function') {
    throw new Error('resume-render.js did not populate module.exports as expected');
  }
  return sandboxModule.exports;
}

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/fixtures', name), 'utf8'));
}

async function main() {
  const R = loadRenderModule();
  const sample = loadFixture('resume-sample.json');
  const broken = loadFixture('resume-broken.json');

  // (a) toPlainText parse order
  group('toPlainText emits fields in top-to-bottom order', () => {
    const text = R.toPlainText(sample);
    const chain = [
      sample.contact.name,
      sample.contact.email,
      sample.summary,
      'Work Experience',
      sample.sections[0].items[0].role,
      sample.sections[0].items[0].bullets[0].text,
      sample.sections[0].items[1].bullets[0].text,
      'Education',
      sample.sections[1].items[0].org,
      'Projects',
      sample.sections[2].items[0].bullets[0].text,
      'Skills',
      sample.sections[3].flat[0],
    ];
    let cursor = -1;
    for (const needle of chain) {
      const idx = text.indexOf(needle, cursor + 1);
      assert.ok(idx > cursor, `expected "${needle}" to appear after position ${cursor}, got ${idx}`);
      cursor = idx;
    }
  });

  // (b) toHtml bans + escaping + contact visible
  group('toHtml enforces hard bans and escapes user text', () => {
    const html = R.toHtml(sample);
    assert.ok(!/<table/i.test(html), 'toHtml must not contain <table');
    assert.ok(!/column/i.test(html), 'toHtml must not contain "column"');
    assert.ok(!/float:/i.test(html), 'toHtml must not contain "float:"');
    assert.ok(!/position:/i.test(html), 'toHtml must not contain "position:"');
    assert.ok(html.includes(sample.contact.email), 'contact email must appear as body text');

    const evil = JSON.parse(JSON.stringify(sample));
    evil.sections[0].items[0].bullets[0].text = 'Injected <script>alert(1)</script> bullet';
    const evilHtml = R.toHtml(evil);
    assert.ok(!evilHtml.includes('<script>'), 'raw <script> must not appear unescaped');
    assert.ok(evilHtml.includes('&lt;script&gt;'), 'bullet text must be HTML-escaped');
  });

  // (c) toDocxXml text nodes match same order
  group('toDocxXml text nodes match toPlainText order', () => {
    const xml = R.toDocxXml(sample);
    const texts = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xml))) texts.push(m[1]);
    const joined = texts.join('\n');
    const chain = [
      sample.contact.name,
      sample.contact.email,
      sample.summary,
      'Work Experience',
      sample.sections[0].items[0].bullets[0].text,
      'Education',
      'Projects',
      'Skills',
    ];
    let cursor = -1;
    for (const needle of chain) {
      const idx = joined.indexOf(needle, cursor + 1);
      assert.ok(idx > cursor, `expected "${needle}" in docx text order after position ${cursor}, got ${idx}`);
      cursor = idx;
    }
    assert.ok(!xml.includes('<w:tbl'), 'toDocxXml must not contain a table');
  });

  // (d) atsCheck scoring
  group('atsCheck scores the clean fixture 100 and flags every seeded defect', () => {
    const cleanResult = R.atsCheck(sample);
    assert.strictEqual(cleanResult.score, 100, `clean fixture should score 100, got ${cleanResult.score}`);
    assert.strictEqual(cleanResult.issues.length, 0, `clean fixture should have 0 issues, got ${JSON.stringify(cleanResult.issues)}`);

    const brokenResult = R.atsCheck(broken);
    assert.ok(brokenResult.score < 100, `broken fixture should score < 100, got ${brokenResult.score}`);
    const joinedIssues = brokenResult.issues.join(' | ');
    const expectedSubstrings = [
      'phone',
      'too long',
      'Empty section: Projects',
      'Missing dates on experience item',
      'Malformed date "13/2020"',
    ];
    for (const needle of expectedSubstrings) {
      assert.ok(joinedIssues.includes(needle), `expected an issue containing "${needle}", got: ${joinedIssues}`);
    }
  });

  // (e) round-trip through the schema validator
  const schemaMod = await import(path.join(REPO, 'functions/_lib/resume-schema.js'));
  group('validateResume round-trips the clean fixture unchanged', () => {
    const result = schemaMod.validateResume(sample);
    assert.strictEqual(result.ok, true, `validateResume should accept the sample fixture: ${JSON.stringify(result.errors)}`);
    assert.deepStrictEqual(result.resume, sample, 'normalized resume must deep-equal the fixture');
  });

  // (f) "never invent a number" server-side backstop (fix plan 2.2):
  // a fabricated stat with no trace in the evidence corpus is stripped and
  // converted into a clarifying question, never shipped verbatim.
  const builderMod = await import(path.join(REPO, 'functions/resume-builder.js'));
  group('enforceTraceableNumbers strips fabricated stats into questions', () => {
    const corpus = 'Ran the poker club newsletter. Organized weekly sessions for members. GPA 3.8.';
    const out = builderMod.enforceTraceableNumbers([
      { text: 'Grew newsletter readership 400% to 5,000 subscribers', dims: [], evidence: 'dossier' },
      { text: 'Maintained a 3.8 GPA while running weekly sessions', dims: [], evidence: 'dossier' },
    ], corpus);
    const joined = out.bullets.map((b) => b.text).join(' | ');
    assert.ok(!joined.includes('400'), 'fabricated 400% removed');
    assert.ok(!joined.includes('5,000') && !joined.includes('5000'), 'fabricated subscriber count removed');
    assert.ok(joined.includes('3.8'), 'traceable GPA kept');
    assert.ok(out.questions.length >= 1 && out.questions[0].includes('?'), 'fabricated stat became a clarifying question');
    const prose = builderMod.stripUntracedNumbersFromText('Improved outcomes by 60% across 12 projects with a 3.8 GPA', corpus);
    assert.ok(!prose.includes('60') && !prose.includes('12'), 'summary numbers also stripped');
    assert.ok(prose.includes('3.8'), 'traceable summary number kept');
  });

  // (g) PUT path keeps previously-validated sim_trial bullets (fix plan 2.4):
  // trialRolesLc === null means "no re-check" (the PUT case), not "strip all".
  group('sanitizeBullets: null trialRolesLc round-trips sim_trial bullets; list still guards generation', () => {
    const bullets = [
      { text: 'Flew the Quant Trader simulation and balanced a live book', dims: [], evidence: 'sim_trial' },
      { text: 'Analyzed member survey data for the poker club', dims: [], evidence: 'dossier' },
    ];
    const onPut = builderMod.sanitizeBullets(bullets, [], null);
    assert.strictEqual(onPut.length, 2, 'PUT (null) keeps previously-validated sim_trial bullets');
    assert.strictEqual(onPut[0].evidence, 'sim_trial');
    const onGenerate = builderMod.sanitizeBullets(bullets, [], ['quant trader']);
    assert.strictEqual(onGenerate.length, 2, 'generation keeps sim_trial bullets naming a real sim');
    const fabricated = builderMod.sanitizeBullets(bullets, [], ['other sim']);
    assert.strictEqual(fabricated.length, 1, 'generation drops sim_trial bullets naming no supplied sim');
    assert.strictEqual(fabricated[0].evidence, 'dossier');
  });

  if (failures > 0) {
    console.error(`\n${failures} group(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll resume ATS checks passed.');
}

main().catch((err) => {
  console.error('FATAL: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
