#!/usr/bin/env node
// Anti-fabrication invariants for functions/resume-tailor.js (plan Phase 4):
//   - a pick whose bulletRef is not in the input map is DROPPED (the model
//     cannot inject experience the student never had);
//   - reconstruction preserves provenance (src) and never emits a bullet whose
//     text was not derived from a real input bullet.
// Loads the endpoint's pure internals via its __test export.

const path = require('path');
const { pathToFileURL } = require('url');

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

async function main() {
  const modPath = path.join(__dirname, '..', 'functions', 'resume-tailor.js');
  const mod = await import(pathToFileURL(modPath).href);
  const { indexBullets, rebuildFromPicks, resumePlainLc } = mod.__test;

  const base = {
    v: 1,
    contact: { name: 'Sam Rivers', email: 's@x.io', phone: '', location: 'NYC', links: [] },
    summary: 'Analyst.',
    sections: [
      { kind: 'experience', heading: 'Work Experience', items: [
        { org: 'Acme', role: 'Analyst', start: 'Jan 2022', end: 'Present', bullets: [
          { text: 'Built financial models forecasting revenue.', src: 'resume', dims: ['Mathematics'] },
          { text: 'Presented findings to leadership weekly.', src: 'dossier', dims: [] },
        ] },
        { org: 'Cafe Uno', role: 'Barista', start: '2021', end: '2021', bullets: [
          { text: 'Served customers during rush hours.', src: 'manual', dims: [] },
        ] },
      ] },
      { kind: 'education', heading: 'Education', items: [
        { org: 'State University', role: 'BS Economics', start: '2019', end: '2023', bullets: [] },
      ] },
      { kind: 'skills', heading: 'Skills', flat: ['Excel', 'SQL'] },
    ],
  };

  const map = indexBullets(base);
  assert(map.size === 3, 'indexBullets should find 3 bullets');
  const refs = [...map.keys()];

  // 1. Fabricated ref is dropped; a real ref with reworded text is kept.
  const picks = [
    { ref: refs[0], text: 'Engineered revenue forecasting models in Excel.' },
    { ref: 'b9_9_9', text: 'Led a 40-person team across three continents.' }, // fabricated
  ];
  const sections = rebuildFromPicks(base, map, picks);
  assert(sections, 'rebuild should return sections for a valid pick');
  const expItems = sections.find((s) => s.kind === 'experience').items;
  const expBullets = expItems.flatMap((it) => it.bullets);
  assert(expBullets.length === 1, `only the real pick survives in experience (got ${expBullets.length})`);
  assert(expBullets[0].text === 'Engineered revenue forecasting models in Excel.', 'reworded text kept');
  assert(expBullets[0].src === 'resume', 'provenance src preserved from the original bullet');
  const flat = JSON.stringify(sections).toLowerCase();
  assert(!flat.includes('40-person') && !flat.includes('three continents'), 'fabricated content must not appear anywhere');
  console.log('PASS fabricated bulletRef dropped, provenance preserved');

  // 1b. Item-keep rule: education (bullet-less) is ALWAYS kept; an experience
  // item whose bullets were all passed over (Barista) is omitted by design.
  const edu = sections.find((s) => s.kind === 'education');
  assert(edu && edu.items.length === 1 && edu.items[0].org === 'State University', 'education item must survive tailoring');
  assert(!flat.includes('cafe uno'), 'unpicked bullet-bearing experience item is omitted');
  console.log('PASS education preserved, unpicked experience omitted');

  // 2. All-fabricated picks → null (caller falls back to base, no invented items).
  const none = rebuildFromPicks(base, map, [{ ref: 'zzz', text: 'made up' }]);
  assert(none === null, 'all-fabricated picks should yield null');
  console.log('PASS all-fabricated picks reject to null');

  // 3. Empty pick text falls back to the original bullet text (no data loss).
  const kept = rebuildFromPicks(base, map, [{ ref: refs[1], text: '' }]);
  const t = kept[0].items[0].bullets[0].text;
  assert(t === 'Presented findings to leadership weekly.', 'empty rewording keeps original text');
  console.log('PASS empty rewording preserves original bullet');

  // 4. resumePlainLc surfaces bullet + skill text for deterministic keyword match.
  const hay = resumePlainLc(base);
  assert(hay.includes('financial models') && hay.includes('sql'), 'plaintext includes bullets and skills');
  console.log('PASS resumePlainLc covers bullets and skills');

  console.log('\nAll resume-tailor invariants passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
