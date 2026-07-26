#!/usr/bin/env node
/**
 * quiz:calibrate — the offline instrument for the V2 S6 initial-quiz rework (D8).
 *
 * The audit's complaint was that a generic profile "scored 90+ against nine of
 * ten sectors": with only FOUR scored questions in the pre-signup set, a persona
 * with a real lean was under-sampled, its raw sector scores bunched, and the
 * ÷max×100 display normalization then floated everything to ~90+. S6 raised the
 * scored count to EIGHT, so a lean produces separation instead of noise.
 *
 * This harness proves the move by running representative personas through the
 * REAL scoring maps (extracted from quiz-app.js — no duplication, no drift) over
 * the OLD initial set vs the NEW one, and reporting, per persona:
 *   - the top-3 sectors and the #1↔#2 gap (separation)
 *   - how many of the 25 sectors normalize to ≥ 90 (the audit's number to move)
 *
 * It replicates only the additive scoring qzComputeScores does for the types the
 * scored initial questions use (tags, mc, pairs, multi, rank) — the leaning
 * zone-boost and resume/enrich boosts are out of scope (constant offsets that do
 * not change the discrimination story). Re-run after any change to QZ_Qs or the
 * initial set.
 *
 * Usage: node scripts/quiz-calibrate.mjs   (add --json for machine output)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/quiz/quiz-app.js'), 'utf8');

// --- Extract the real question bank + the current initial set from source ---
const qzR = Math.round; // referenced only inside score:v=>{} closures we never call
function evalConst(name, re) {
  const m = SRC.match(re);
  if (!m) throw new Error('could not extract ' + name + ' from quiz-app.js');
  // eslint-disable-next-line no-eval
  return eval('(' + m[1] + ')');
}
const QZ_Qs = evalConst('QZ_Qs', /const QZ_Qs = (\[[\s\S]*?\n\]);/);
const NEW_IDS = evalConst('QZ_INITIAL_IDS', /const QZ_INITIAL_IDS = (\[[^\]]*\]);/);
const OLD_IDS = [0, 24, 2, 20, 21, 22, 3, 5, 17, 23]; // the pre-S6 set (4 scored)
const byId = (id) => QZ_Qs.find((q) => q.id === id);

// A question "carries a scoring map" if it has a score fn or an `s` object anywhere.
function scored(q) {
  if (!q) return false;
  if (typeof q.score === 'function') return true;
  let found = false;
  (function scan(v) {
    if (found || !v || typeof v !== 'object') return;
    if (v.s && typeof v.s === 'object') { found = true; return; }
    if (Array.isArray(v)) v.forEach(scan);
    else Object.keys(v).forEach((k) => scan(v[k]));
  })(q);
  return found;
}

// --- Persona answers, keyed by question id. Values reference the REAL options
//     by a text predicate so a reorder of QZ_Qs can't silently mis-encode them. ---
const pickIdx = (opts, pred) => { const i = opts.findIndex(pred); if (i < 0) throw new Error('no option matched'); return i; };

const PERSONAS = {
  'STEM / builder': {
    subjects: ['Math', 'Science', 'Tech / Coding', 'Engineering'],
    mc: { 18: 'building', 6: 'data', 22: 'alone', 17: 'boring' },
    pairs3: ['a', 'a', 'b', 'b'], // money / structure / more-hours / love
    env5: ['Startup', 'Remote'],
    rank16: ['Writing code', 'Running an experiment', 'Designing'],
  },
  'Humanities / social': {
    subjects: ['Writing', 'Psychology', 'Global Issues', 'Languages'],
    mc: { 18: 'patients', 6: 'people', 22: 'constant', 17: 'meaningful' },
    pairs3: ['b', 'b', 'a', 'b'],
    env5: ['Non-profit', 'Academic'],
    rank16: ['Teaching a class', 'Diagnosing', 'Designing'],
  },
  'Business / finance': {
    subjects: ['Business', 'Economics', 'Math'],
    mc: { 18: 'Meetings', 6: 'consensus', 22: 'constant', 17: 'earning' },
    pairs3: ['a', 'a', 'b', 'a'],
    env5: ['Corporate'],
    rank16: ['Closing a high-stakes deal', 'Writing code', 'Teaching a class'],
  },
  'Generic / undecided': {
    subjects: ['Business', 'Psychology', 'Writing'],
    mc: { 18: 'Research', 6: 'frameworks', 22: 'Balanced', 17: 'wrong field' },
    pairs3: ['a', 'b', 'a', 'b'],
    env5: ['Small business', 'Other'],
    rank16: ['Closing a high-stakes deal', 'Teaching a class', 'Designing'],
  },
};

// --- Replicate qzComputeScores' additive logic for the scored initial types ---
function scoreSet(ids, persona) {
  const sc = {};
  const add = (s, m = 1) => { if (!s) return; Object.entries(s).forEach(([k, v]) => { sc[k] = (sc[k] || 0) + v * m; }); };
  const has = (id) => ids.indexOf(id) !== -1;

  if (has(1)) { const q = byId(1); persona.subjects.forEach((name) => { const t = q.tags.find((x) => x.t.includes(name)); if (t) add(t.s); }); }
  [18, 6, 22, 17].forEach((id) => { if (has(id) && persona.mc[id]) { const q = byId(id); const i = pickIdx(q.opts, (o) => o.t.toLowerCase().includes(persona.mc[id].toLowerCase())); add(q.opts[i].s, 2); } });
  if (has(3)) { const q = byId(3); persona.pairs3.forEach((side, i) => { const p = q.pairs[i]; if (p && p[side]) add(p[side].s, 2); }); }
  if (has(5)) { const q = byId(5); persona.env5.forEach((name) => { const o = q.opts.find((x) => x.t.includes(name)); if (o) add(o.s); }); }
  if (has(16)) { const q = byId(16); persona.rank16.slice(0, 3).forEach((name, r) => { const it = q.items.find((x) => x.t.includes(name)); if (it) add(it.s, [3, 2, 1][r]); }); }
  return sc;
}
function normalize(sc) { const max = Math.max(1, ...Object.values(sc)); const out = {}; Object.entries(sc).forEach(([k, v]) => { out[k] = Math.round((v / max) * 100); }); return out; }
function top(nsc, n) { return Object.entries(nsc).sort((a, b) => b[1] - a[1]).slice(0, n); }
function countGE(nsc, thr) { return Object.values(nsc).filter((v) => v >= thr).length; }

// --- Report ---
const rows = [];
const coverageNew = NEW_IDS.filter((id) => scored(byId(id))).length;
const coverageOld = OLD_IDS.filter((id) => scored(byId(id))).length;

for (const [name, p] of Object.entries(PERSONAS)) {
  const oldN = normalize(scoreSet(OLD_IDS, p));
  const newN = normalize(scoreSet(NEW_IDS, p));
  const oTop = top(oldN, 3), nTop = top(newN, 3);
  rows.push({
    persona: name,
    old: { top: oTop, ge90: countGE(oldN, 90), ge85: countGE(oldN, 85), gap: (oTop[0]?.[1] || 0) - (oTop[1]?.[1] || 0) },
    neu: { top: nTop, ge90: countGE(newN, 90), ge85: countGE(newN, 85), gap: (nTop[0]?.[1] || 0) - (nTop[1]?.[1] || 0) },
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ coverageOld, coverageNew, rows }, null, 2));
} else {
  console.log('\nquiz:calibrate — initial-set scoring-map coverage: OLD ' + coverageOld + '/10 → NEW ' + coverageNew + '/10\n');
  const fmt = (t) => t.map(([k, v]) => `${k} ${v}`).join(', ');
  for (const r of rows) {
    console.log(`■ ${r.persona}`);
    console.log(`    OLD (4 scored):  #1↔2 gap ${String(r.old.gap).padStart(3)}  ·  sectors ≥90: ${r.old.ge90}  ·  ≥85: ${r.old.ge85}   [${fmt(r.old.top)}]`);
    console.log(`    NEW (8 scored):  #1↔2 gap ${String(r.neu.gap).padStart(3)}  ·  sectors ≥90: ${r.neu.ge90}  ·  ≥85: ${r.neu.ge85}   [${fmt(r.neu.top)}]`);
    console.log('');
  }
  const avgOld = (rows.reduce((a, r) => a + r.old.ge90, 0) / rows.length).toFixed(1);
  const avgNew = (rows.reduce((a, r) => a + r.neu.ge90, 0) / rows.length).toFixed(1);
  console.log(`Average sectors ≥90 per persona:  OLD ${avgOld}  →  NEW ${avgNew}   (lower = sharper separation)\n`);
}
