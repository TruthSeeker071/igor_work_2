/**
 * contrast:check — the hardcoded-dark-plate trap, as a gate.
 *
 * Four separate contrast bugs have shipped from one mistake: a container whose
 * background is a hardcoded dark hex in BOTH themes (`.fw-intent-dialog`,
 * `.fw-iv-modal`, `.salary-arena`) gaining a descendant rule that paints text
 * with a theme token. In dark theme the token is light and everything looks
 * right; in light theme it resolves dark and the text disappears onto the dark
 * plate. Measured instances: #fw-art-title, #fw-iv-title, #fw-intent-title at
 * 1.49:1, and .sal-cta-stat strong at 1.06:1.
 *
 * Nobody testing in dark can see any of them, which is why they keep shipping.
 * So this checks statically, in both themes, against the WCAG AA 4.5:1 floor.
 *
 * Scope is deliberately narrow — the exact defect class, not a general contrast
 * auditor: only plates with a LITERAL dark hex background, and only descendant
 * rules that set a literal or single-token `color`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = path.join(ROOT, 'assets/css');
const AA = 4.5;
const PLATE_LUM_MAX = 70; // simple 0-255 brightness; below this a plate is "dark"

let fail = 0;
const problem = (m) => { fail++; console.error(`  FAIL ${m}`); };

// --- colour maths -----------------------------------------------------------
const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (fg, bg) => {
  const a = lum(fg); const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const over = (fg, alpha, bg) => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);
const brightness = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

function parseHex(hex) {
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// --- load every stylesheet as flat (selector, body) rules -------------------
// PLUS every page-local <style> block in a root .html. Those are not an
// exception any more — S5's OAuth button, S6's quiz reveal and S9's Deadline
// Radar all ship their CSS inline on purpose, because a shared-stylesheet edit
// forces a cache-buster sweep across every page that links it. So "the CSS this
// gate can see" and "the CSS the product ships" had quietly stopped being the
// same set, and the newest surfaces were the ones outside it.
const sources = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(CSS_DIR, f), 'utf8') }));
for (const f of fs.readdirSync(ROOT).filter((f2) => f2.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sre = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let s;
  let n = 0;
  while ((s = sre.exec(html))) {
    n += 1;
    // Keep the leading newlines so a reported line number is the line in the
    // HTML file, not in the extracted fragment.
    const before = html.slice(0, s.index + s[0].indexOf(s[1])).replace(/[^\n]/g, '');
    sources.push({ file: `${f} <style#${n}>`, text: before + s[1] });
  }
}

const rules = [];       // { file, line, selectors[], body }
const tokens = { dark: new Map(), light: new Map() };

for (const { file, text: raw } of sources) {
  // Strip comments before parsing, but keep every newline so reported line
  // numbers stay true. Without this a prose comment mentioning a colon and a
  // brace gets parsed as a selector and the gate reports nonsense.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;
  // Flat scan: `selector { ...no nested braces... }`. At-rule wrappers (@media,
  // @supports) are skipped by the no-brace body, which is fine — a plate or a
  // colour that only exists inside a media query is not the shipped default.
  const re = /([^{}@;]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (!selectors.length) continue;
    const body = m[2];
    rules.push({ file, line: lineOf(m.index), selectors, body });

    // Theme token definitions: `--text: 245 238 233;` under :root / [data-theme=…]
    for (const sel of selectors) {
      const isLight = /\[data-theme=["']?light["']?\]/.test(sel);
      const isDark = /^:root$/.test(sel) || /\[data-theme=["']?dark["']?\]/.test(sel);
      if (!isLight && !isDark) continue;
      const tre = /--([\w-]+): *(\d+) +(\d+) +(\d+) *;/g;
      let t;
      while ((t = tre.exec(body))) {
        tokens[isLight ? 'light' : 'dark'].set(t[1], [+t[2], +t[3], +t[4]]);
      }
    }
  }
}

// --- find the dark plates ---------------------------------------------------
const plates = new Map(); // selector -> { rgb, file, line }
for (const r of rules) {
  const bg = r.body.match(/background(?:-color)?: *#([0-9a-fA-F]{3,6})\b/);
  if (!bg) continue;
  const rgb = parseHex(bg[1]);
  if (brightness(rgb) >= PLATE_LUM_MAX) continue;
  for (const sel of r.selectors) {
    // Only real element plates, not pseudo-elements or state-only rules.
    if (/::/.test(sel)) continue;
    plates.set(sel.replace(/:hover|:focus(-visible)?|:active/g, '').trim(), { rgb, file: r.file, line: r.line });
  }
}

// --- resolve a colour declaration to [rgb, alpha] in a given theme ----------
function resolveColor(decl, theme) {
  let m = decl.match(/^#([0-9a-fA-F]{3,6})$/);
  if (m) return { rgb: parseHex(m[1]), alpha: 1, tokenized: false };
  m = decl.match(/^rgba?\( *(\d+) *, *(\d+) *, *(\d+) *(?:, *([\d.]+) *)?\)$/);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] === undefined ? 1 : +m[4], tokenized: false };
  m = decl.match(/^rgba?\( *var\(--([\w-]+)\) *(?:\/ *([\d.]+) *)?\)$/);
  if (m) {
    const rgb = tokens[theme].get(m[1]);
    if (!rgb) return null;
    return { rgb, alpha: m[2] === undefined ? 1 : +m[2], tokenized: true };
  }
  return null; // inherit, currentColor, transparent, gradients, unknown — not our class
}

// --- check every descendant rule that paints text on a plate ----------------
console.log(`contrast:check — ${plates.size} hardcoded-dark plate(s), ${rules.length} rules`);
let checked = 0;

for (const [plateSel, plate] of plates) {
  for (const r of rules) {
    for (const sel of r.selectors) {
      // A descendant rule: the plate selector appears, followed by a combinator
      // and something else. `.plate` alone is the plate; `.plate h3` is text on it.
      if (!sel.includes(plateSel)) continue;
      const tail = sel.slice(sel.indexOf(plateSel) + plateSel.length);
      if (!/^[\s>+~]/.test(tail)) continue;
      if (/::(before|after|backdrop)/.test(tail)) continue;

      const cm = r.body.match(/(?:^|[;{\s])color: *([^;!]+?)(?: *!important)? *(?:;|$)/);
      if (!cm) continue;
      const decl = cm[1].trim();

      for (const theme of ['dark', 'light']) {
        const c = resolveColor(decl, theme);
        if (!c) continue;
        checked++;
        const eff = c.alpha === 1 ? c.rgb : over(c.rgb, c.alpha, plate.rgb);
        const ratio = contrast(eff, plate.rgb);
        if (ratio < AA) {
          problem(`${r.file}:${r.line} \`${sel}\` paints \`${decl}\` on `
            + `\`${plateSel}\` (#${plate.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}, `
            + `${plate.file}:${plate.line}) — ${ratio.toFixed(2)}:1 in ${theme} theme, AA floor ${AA}:1`
            + (c.tokenized ? ' — a theme token on a plate that is hardcoded dark in BOTH themes' : ''));
        }
      }
    }
  }
}

console.log(`contrast:check — ${checked} plate/text pairs measured across both themes`);

// --- check B: the conflict fingerprint --------------------------------------
// Check A only sees plates it can match by SELECTOR TEXT, so it misses the
// commonest real shape: `#page-quiz .salary-arena` is the plate but the text
// rule is `#page-quiz .sal-cta-stat`, a sibling class whose nesting exists only
// in the markup. Those cases have a fingerprint that needs no nesting at all —
// the SAME selector is painted a hardcoded-light colour by one sheet (because
// it sits on a dark plate) and a theme token by another (because a light-theme
// pass swept the page). Both cannot be right: whoever wrote the hardcoded light
// value knew the background was dark in both themes, so the token is the bug.
const byColor = new Map(); // selector -> { light: [...], token: [...] }
for (const r of rules) {
  const cm = r.body.match(/(?:^|[;{\s])color: *([^;!]+?)(?: *!important)? *(?:;|$)/);
  if (!cm) continue;
  const decl = cm[1].trim();
  const isToken = /^rgba?\( *var\(--[\w-]+\)/.test(decl);
  const lit = resolveColor(decl, 'dark');
  const isHardLight = !isToken && lit && brightness(lit.rgb) > 160;
  if (!isToken && !isHardLight) continue;
  for (const sel of r.selectors) {
    // Compare on the selector's own terms, ignoring theme scoping — a
    // `[data-theme="light"] X` rule and an `X` rule target the same element.
    const key = sel.replace(/\[data-theme=["']?\w+["']?\]/g, '').replace(/\s+/g, ' ').trim();
    if (!key) continue;
    if (!byColor.has(key)) byColor.set(key, { light: [], token: [] });
    byColor.get(key)[isToken ? 'token' : 'light'].push({ ...r, decl, sel });
  }
}
let conflicts = 0;
for (const [key, hits] of byColor) {
  if (!hits.light.length || !hits.token.length) continue;
  // Not every token is a bug. `--primary-fg` is "the text colour on the accent
  // fill" and is light in BOTH themes, so a button painted #fff here and
  // rgb(var(--primary-fg)) there is two spellings of the same intent. The
  // defect needs the token to actually go DARK in some theme — that is the
  // moment it stops being readable on a plate the other sheet knew was dark.
  // And a token rule that repaints the BACKGROUND alongside the text is
  // self-consistent by construction — it moved the whole element onto the
  // theme's surface, so both halves travel together. The defect is a rule that
  // takes over the text colour and leaves someone else's background behind.
  const t = hits.token.find((h) => !/background(-color)?: */.test(h.body)
    && ['dark', 'light'].some((theme) => {
      const c = resolveColor(h.decl, theme);
      return c && brightness(c.rgb) < 128;
    }));
  if (!t) continue;
  conflicts++;
  const l = hits.light[0];
  problem(`\`${key}\` is painted a hardcoded-light \`${l.decl}\` (${l.file}:${l.line}) `
    + `and a theme token \`${t.decl}\` (${t.file}:${t.line}) — the hardcoded value says this `
    + `element sits on a plate that is dark in BOTH themes, so the token goes dark-on-dark in one of them`);
}
console.log(`contrast:check — ${byColor.size} coloured selectors cross-checked, ${conflicts} conflict(s)`);

// --- check C: a status token is a HUE SIGNAL, never a text colour ------------
// `--ok` / `--warn` / `--err` are tuned to read as accents on a surface, not as
// type: on the light theme's own `--surface` they measure 1.75 / 2.09 / 3.99 :1,
// all under the AA floor. Every existing use in the repo is a border-left or a
// tint (auth-pages `.auth-alert`, theme `.fw-toast--error`) with the text left
// on `--text` — so this is a zero-instance invariant, which is the cheapest and
// strongest kind. S9 shipped `color: rgb(var(--ok))` on a "Done" button and it
// was effectively invisible in light mode; checks A and B could not see it,
// because there is no hardcoded dark plate anywhere near it.
const STATUS_TOKENS = ['ok', 'warn', 'err'];
let statusUses = 0;
for (const r of rules) {
  const cm = r.body.match(/(?:^|[;{\s])color: *([^;!]+?)(?: *!important)? *(?:;|$)/);
  if (!cm) continue;
  const m = cm[1].trim().match(/^rgba?\( *var\(--([\w-]+)\) *(?:\/ *([\d.]+) *)?\)$/);
  if (!m || !STATUS_TOKENS.includes(m[1])) continue;
  statusUses++;
  const fg = tokens.light.get(m[1]) || tokens.dark.get(m[1]);
  const bg = tokens.light.get('surface');
  const ratio = fg && bg ? contrast(fg, bg).toFixed(2) : '?';
  problem(`${r.file}:${r.line} \`${r.selectors.join(', ')}\` paints text \`${cm[1].trim()}\` — `
    + `a status token is a hue signal, not a text colour (${ratio}:1 on the light theme's own --surface). `
    + 'Put the hue on a border-left or a background tint and leave the text on rgb(var(--text)), '
    + 'the way .auth-alert and .fw-toast--error do.');
}
console.log(`contrast:check — status tokens used as text: ${statusUses} (must be 0)`);

console.log(fail ? `contrast:check FAIL — ${fail} problem(s)` : 'contrast:check PASS');
process.exit(fail ? 1 : 0);
