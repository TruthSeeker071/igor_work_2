// FlightWay V2 S2 — the trust/SEO surface gate.  run: npm run verify:meta
//
// Every failure this catches is invisible at runtime. A page with no og:image
// still renders. A canonical pointing at the wrong host still renders. A footer
// link to a page that does not exist still renders — it just 404s for the one
// visitor who clicks it, months later, and nobody hears about it. That is the
// entire class of bug S2 exists to close, so it needs a gate or it comes back
// on the next page anyone adds.
//
// Seven things asserted here that nothing else asserts:
//   1. EVERY root page is CLASSIFIED. The classification table below is the
//      contract; a new .html file that nobody classified fails the suite rather
//      than quietly shipping without meta or without a noindex. That is the
//      point — the failure mode this replaces is "someone added a page and
//      forgot", which by definition nobody notices.
//   2. Public pages carry the full set (title/description/canonical/og/twitter)
//      and app shells carry noindex. An indexed empty JS shell is worse than no
//      page at all: it puts a blank result in Google under a FlightWay title.
//   3. og:image files EXIST and are exactly 1200x630. A share card that 404s or
//      is the wrong aspect degrades a link to bare text in every feed, and no
//      one on the team ever sees their own og:image.
//   4. NO dead links. `href="#"` anywhere, a cross-page #fragment that resolves
//      to no id (the `pricing.html -> index.html#pricing` bug), or an internal
//      href that resolves to neither a page, an asset, nor a Function route.
//   5. `.dev.vars.example` is blocked in _redirects — the mechanism that
//      actually works. `.assetsignore` is checked too but only as a warning,
//      because it was PROVEN ineffective on this project (see below).
//   6. robots.txt is served by the Function, not a static file, and says
//      opposite things on the canonical host and everywhere else (D23).
//   7. The host-noindex predicate itself: pages.dev noindex, flightway.ai not.
//
// Deliberately NOT a live check. It runs offline against the repo so it can be
// in the unit tier and fail BEFORE a deploy, not after.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shouldNoindexHost, isCanonicalHost } from '../functions/_lib/host.js';
import { onRequest as robotsHandler } from '../functions/robots.txt.js';
import { CONTACT_TOPICS, turnstileEnabled } from '../functions/contact.js';
import {
  STATIC_URLS, INDEX_URL, GUIDES_INDEX_URL, GUIDE_URLS, buildSitemap,
} from '../functions/sitemap.xml.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://flightway.ai';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail += 1; console.error('  FAIL', m); } };
const warn = (m) => console.warn('  warn:', m);

// ---------------------------------------------------------------------------
// The classification table. THIS IS THE CONTRACT — every root .html must appear.
//
//   public  — indexable marketing/funnel surface. Needs the full meta set.
//   shell   — renders an empty (or signed-in-only) shell to a crawler. Needs
//             noindex, and must NOT carry a canonical: a noindex page that
//             self-canonicalises sends Google two contradictory signals.
//   error   — 404.html. noindex, but deliberately still followable.
//   shim    — Flightway.html, the orphaned legacy hash-router. noindex.
//
// `canonical` is the clean URL Cloudflare Pages actually serves the file at
// (verified: /privacy.html 308s to /privacy).
const CLASSIFY = {
  'index.html': { kind: 'public', canonical: '/', og: 'og-default' },
  'pricing.html': { kind: 'public', canonical: '/pricing', og: 'og-pricing' },
  'quiz.html': { kind: 'public', canonical: '/quiz', og: 'og-quiz' },
  'privacy.html': { kind: 'public', canonical: '/privacy', og: 'og-default' },
  'terms.html': { kind: 'public', canonical: '/terms', og: 'og-default' },
  'security.html': { kind: 'public', canonical: '/security', og: 'og-default' },
  'contact.html': { kind: 'public', canonical: '/contact', og: 'og-default' },
  // S19 — the business surface. Both are real marketing pages (full nav, full
  // footer, real content), so they are `public` and carry the whole meta set.
  'career-centers.html': { kind: 'public', canonical: '/career-centers', og: 'og-default' },
  'community.html': { kind: 'public', canonical: '/community', og: 'og-default' },
  'portal.html': { kind: 'shell' },
  'flightplan.html': { kind: 'shell' },
  // S12 Application Tracker. Signed-in only and rendered from /applications,
  // so a crawler reads an empty board.
  'applications.html': { kind: 'shell' },
  'dashboard.html': { kind: 'shell' },
  'roadmap.html': { kind: 'shell' },
  'coach.html': { kind: 'shell' },
  'resume.html': { kind: 'shell' },
  'career.html': { kind: 'shell' },
  'profile-build.html': { kind: 'shell' },
  'admin.html': { kind: 'shell' },
  'auth.html': { kind: 'shell' },
  'simulation.html': { kind: 'shell' },
  // S11 Month in Review. Signed-in only and JS-rendered from /month-review, so
  // a crawler sees an empty shell; the retrospective itself is one person's
  // private record and has no business being indexable.
  'review.html': { kind: 'shell' },
  '404.html': { kind: 'error' },
  'Flightway.html': { kind: 'shim' },
};

// Pages that legitimately have no footer, with the reason. Anything not listed
// here must carry the legal links, so "I forgot the footer" cannot ship.
const NO_FOOTER = {
  'dashboard.html': 'full-viewport canvas map with position:fixed chrome — a document-flow footer would be dead markup below a body that does not scroll',
  'Flightway.html': 'redirect shim; its <body> exists only for the no-JS fallback line',
};

// Pages whose #fragment is a ROUTE, not an element id (they hash-route in JS),
// so `auth.html#signin` is correct even though no element carries that id.
const HASH_ROUTED = new Set(['auth.html', 'Flightway.html']);
// JS-rendered anchors: the target id is built at runtime (not in static HTML), so
// the static id scan can't see it. Precise per-fragment allowlist — unlike
// HASH_ROUTED it exempts ONLY this fragment, not every fragment on the page.
// flightplan.html#notifications is created by notify-optin.js (panel.id='notifications').
const JS_RENDERED_FRAGMENTS = new Set(['flightplan.html#notifications']);
// Per-fragment hash ROUTES on pages that are otherwise ordinary documents (so
// the whole page must not be exempted the way HASH_ROUTED does). Each entry is
// a fragment a script reads from location.hash and acts on; there is no element
// with that id, and there should not be. Cited to the handler, so a future
// session can check the route still exists rather than trusting the list.
//   quiz.html#sharpen  → quiz-app.js: hash === '#sharpen' opens the sharpen flow
//   coach.html#practice → interview-mode.js openFromHash(): opens Mock Interview
const HASH_ROUTE_FRAGMENTS = new Set(['quiz.html#sharpen', 'coach.html#practice']);

const LEGAL_PAGES = ['privacy.html', 'terms.html', 'security.html', 'contact.html'];

// ---------------------------------------------------------------------------
// Load.

const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const src = new Map(htmlFiles.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));

// The link and footer passes read MARKUP, not prose. This repo comments changes
// heavily and those comments quote the code they replaced — a comment that says
// `href="#" still scrolls the page` is documentation, not a dead link, and a
// footer link inside a commented-out block is not a footer link. Strip first.
const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const live = new Map([...src].map(([f, t]) => [f, stripComments(t)]));

const meta = (text, attr, name) => {
  const re = new RegExp(`<meta[^>]*\\b${attr}=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const alt = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*\\b${attr}=["']${name}["']`, 'i');
  const m = text.match(re) || text.match(alt);
  return m ? m[1] : null;
};
const metaCount = (text, attr, name) => (text.match(new RegExp(`\\b${attr}=["']${name}["']`, 'gi')) || []).length;
const canonicalOf = (text) => {
  const m = text.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : null;
};
const titleOf = (text) => {
  const m = text.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
};
const idsOf = (text) => new Set([...text.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));

console.log('verify:meta — classification');
for (const f of htmlFiles) {
  assert(!!CLASSIFY[f], `${f} is classified in verify-meta.mjs (a new page must be classified, not defaulted)`);
}
for (const f of Object.keys(CLASSIFY)) {
  assert(src.has(f), `${f} in the classification table still exists on disk`);
}

// ---------------------------------------------------------------------------
// 1. Public pages: the full set.

console.log('verify:meta — public page meta');
for (const [file, cfg] of Object.entries(CLASSIFY)) {
  if (cfg.kind !== 'public' || !src.has(file)) continue;
  const t = src.get(file);
  const title = titleOf(t);

  assert(title.length > 0 && title.length <= 70, `${file} title is 1-70 chars (${title.length})`);
  assert(/flightway/i.test(title), `${file} title carries the brand`);

  const desc = meta(t, 'name', 'description');
  assert(!!desc && desc.length >= 50 && desc.length <= 200,
    `${file} meta description is 50-200 chars (${desc ? desc.length : 'missing'})`);

  const canon = canonicalOf(t);
  assert(canon === SITE + cfg.canonical,
    `${file} canonical is ${SITE}${cfg.canonical} (got ${canon || 'none'})`);
  assert((t.match(/rel=["']canonical["']/gi) || []).length === 1, `${file} has exactly one canonical`);

  for (const prop of ['og:site_name', 'og:url', 'og:title', 'og:description', 'og:type', 'og:image']) {
    assert(!!meta(t, 'property', prop), `${file} has ${prop}`);
    assert(metaCount(t, 'property', prop) === 1, `${file} has exactly one ${prop}`);
  }
  assert(meta(t, 'property', 'og:url') === SITE + cfg.canonical, `${file} og:url matches its canonical`);

  const card = meta(t, 'name', 'twitter:card');
  assert(card === 'summary_large_image', `${file} twitter:card is summary_large_image (got ${card || 'none'})`);
  for (const prop of ['twitter:title', 'twitter:description', 'twitter:image']) {
    assert(!!meta(t, 'name', prop), `${file} has ${prop}`);
  }

  const ogImg = meta(t, 'property', 'og:image') || '';
  assert(ogImg.startsWith(`${SITE}/assets/og/${cfg.og}.png?v=`),
    `${file} og:image is the absolute, stamped ${cfg.og}.png (got ${ogImg})`);
  assert(meta(t, 'name', 'twitter:image') === ogImg, `${file} twitter:image matches og:image`);
  assert(!/name=["']robots["'][^>]*noindex/i.test(t), `${file} is public and must NOT carry noindex`);
}

// ---------------------------------------------------------------------------
// 2. App shells / error / shim: noindex, and no mixed signals.

console.log('verify:meta — noindex on non-indexable pages');
for (const [file, cfg] of Object.entries(CLASSIFY)) {
  if (cfg.kind === 'public' || !src.has(file)) continue;
  const t = src.get(file);
  const robots = meta(t, 'name', 'robots') || '';
  assert(/noindex/i.test(robots), `${file} (${cfg.kind}) carries a noindex robots meta (got "${robots}")`);
  assert(!canonicalOf(t),
    `${file} is noindex and must NOT also carry a canonical (contradictory signals)`);
  assert(!meta(t, 'property', 'og:image'),
    `${file} is noindex — an og:image on it is dead weight, drop it`);
}
// A 404 must stay followable so a crawler can re-crawl the real links on it.
assert(!/nofollow/i.test(meta(src.get('404.html') || '', 'name', 'robots') || ''),
  '404.html is noindex but NOT nofollow (its links must stay crawlable)');

// ---------------------------------------------------------------------------
// 3. The share cards themselves.

console.log('verify:meta — og image assets');
const OG_DIR = path.join(ROOT, 'assets/og');
for (const name of new Set(Object.values(CLASSIFY).map((c) => c.og).filter(Boolean))) {
  const p = path.join(OG_DIR, `${name}.png`);
  if (!fs.existsSync(p)) { assert(false, `assets/og/${name}.png exists (run npm run og:build)`); continue; }
  const buf = fs.readFileSync(p);
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert(isPng, `assets/og/${name}.png is a real PNG`);
  // IHDR width/height live at byte 16 and 20 of every PNG.
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  assert(w === 1200 && h === 630, `assets/og/${name}.png is 1200x630 (got ${w}x${h})`);
  assert(buf.length < 1024 * 1024, `assets/og/${name}.png is under 1MB (${Math.round(buf.length / 1024)}KB)`);
}

// ---------------------------------------------------------------------------
// 4. The link graph. Every internal href must go somewhere real.

console.log('verify:meta — internal links');

/** Pages Function routes, derived from the functions/ tree the same way Pages derives them. */
function functionRoutes(dir = path.join(ROOT, 'functions'), prefix = '') {
  const out = new Set();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { for (const r of functionRoutes(p, `${prefix}/${e.name}`)) out.add(r); continue; }
    if (!e.name.endsWith('.js')) continue;
    const base = e.name.slice(0, -3);
    out.add(base === 'index' ? (prefix || '/') : `${prefix}/${base}`);
  }
  return out;
}
const ROUTES = functionRoutes();
const ROOT_FILES = new Set(fs.readdirSync(ROOT).filter((f) => fs.statSync(path.join(ROOT, f)).isFile()));

/** Does an internal path resolve to something this deployment actually serves? */
function resolves(p) {
  if (p === '' || p === '/') return true;
  const clean = p.replace(/^\//, '');
  if (ROOT_FILES.has(clean)) return true;                 // /pricing.html, /favicon.ico
  if (ROOT_FILES.has(`${clean}.html`)) return true;        // /pricing  (Pages clean URL)
  if (fs.existsSync(path.join(ROOT, clean))) return true;  // /assets/..., /data/...
  // Function routes with no root .html — /contact, /robots.txt, /sitemap.xml,
  // /careers (functions/careers/index.js) all land here as exact matches.
  if (ROUTES.has(p.startsWith('/') ? p : `/${p}`)) return true;
  // Dynamic routes, e.g. /careers/<slug> matching functions/careers/[slug].js.
  // Matched segment-by-segment against the route (not just by segment count),
  // so an unrelated dead link that happens to share a route's depth can't
  // slip through as a false resolve — each bracket segment must additionally
  // look like a real slug.
  const pSeg = (p.startsWith('/') ? p : `/${p}`).split('/');
  for (const r of ROUTES) {
    if (!r.includes('[')) continue;
    const rSeg = r.split('/');
    if (rSeg.length !== pSeg.length) continue;
    if (rSeg.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']')
      ? /^[a-z0-9-]+$/.test(pSeg[i])
      : seg === pSeg[i]))) return true;
  }
  return false;
}

let deadLinks = 0;
for (const [file, text] of live) {
  const hashOnly = (text.match(/href=["']#["']/g) || []).length;
  assert(hashOnly === 0, `${file} has no dead href="#" (${hashOnly} found)`);

  const ids = idsOf(text);
  for (const m of text.matchAll(/href=["']([^"']+)["']/g)) {
    const raw = m[1].trim();
    if (!raw || /^(mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    if (/^https?:\/\//i.test(raw)) {
      // Only same-origin absolutes are ours to guarantee.
      const u = new URL(raw);
      if (!isCanonicalHost(u.hostname)) continue;
      if (!resolves(u.pathname)) { deadLinks += 1; console.error(`  FAIL ${file}: absolute link ${raw} resolves to nothing`); }
      continue;
    }
    const [beforeHash, frag] = raw.split('#');
    const pathPart = beforeHash.split('?')[0];

    if (!pathPart) {
      // Same-page anchor: the id must exist on THIS page.
      if (frag && !ids.has(frag)) { deadLinks += 1; console.error(`  FAIL ${file}: #${frag} matches no id on this page`); }
      continue;
    }
    if (!resolves(pathPart.startsWith('/') ? pathPart : `/${pathPart}`)) {
      deadLinks += 1; console.error(`  FAIL ${file}: href="${raw}" resolves to nothing`);
      continue;
    }
    if (!frag) continue;
    // Cross-page fragment: resolve the target page and check the id is there.
    // `/` has to map to index.html explicitly. Without this the strip produces
    // an empty string, `targetFile` becomes the literal ".html", the lookup
    // misses and the check silently passes — which would have exempted exactly
    // the link form the new footers use everywhere (`/#how-it-works`).
    const bare = pathPart.replace(/^\//, '');
    const targetFile = bare === '' ? 'index.html'
      : (ROOT_FILES.has(bare) ? bare : `${bare}.html`);
    if (!live.has(targetFile)) continue;         // not an html page we can inspect
    if (HASH_ROUTED.has(targetFile)) continue;   // the fragment IS the route
    if (!idsOf(live.get(targetFile)).has(frag)) {
      if (JS_RENDERED_FRAGMENTS.has(`${targetFile}#${frag}`)) continue; // built at runtime
      if (HASH_ROUTE_FRAGMENTS.has(`${targetFile}#${frag}`)) continue;  // the fragment IS a route
      deadLinks += 1;
      console.error(`  FAIL ${file}: href="${raw}" — ${targetFile} has no id="${frag}"`);
    }
  }
}
assert(deadLinks === 0, `no internal link resolves to nothing (${deadLinks} broken)`);

// An exemption nobody re-checks is a rubber stamp, so each hash ROUTE has to
// prove a handler still reads it. Client JS only — these are all location.hash
// reads — and the fragment must appear as a quoted literal somewhere under
// assets/js. Delete the route's handler and the exemption goes red with it.
{
  const jsFiles = [];
  const walkJs = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkJs(p);
      else if (e.name.endsWith('.js')) jsFiles.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walkJs(path.join(ROOT, 'assets/js'));
  for (const entry of HASH_ROUTE_FRAGMENTS) {
    const frag = entry.split('#')[1];
    assert(
      jsFiles.some((s) => s.includes(`'#${frag}'`) || s.includes(`"#${frag}"`)),
      `the ${entry} hash route still has a handler reading "${frag}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Legal reachability. Every page that can carry a footer must carry one.

console.log('verify:meta — legal reachability');
for (const [file, text] of live) {
  if (NO_FOOTER[file]) {
    assert(!/<footer/i.test(text), `${file} has no footer on purpose (${NO_FOOTER[file]})`);
    continue;
  }
  assert(/<footer/i.test(text), `${file} has a <footer>`);
  for (const target of ['/privacy', '/terms', '/security', '/contact']) {
    assert(text.includes(`href="${target}"`) || text.includes(`href="${target}?`),
      `${file} footer links to ${target}`);
  }
}
for (const f of LEGAL_PAGES) assert(src.has(f), `${f} exists`);

// The sitemap and the classification table must be the same set, both ways. A
// public page missing from the sitemap is a page Google finds late or not at
// all; a sitemap entry for a noindexed page is a contradiction Search Console
// reports as an error. The sitemap is generated (functions/sitemap.xml.js),
// not committed, so this asserts against its own URL list and its own pure
// builder rather than reading a static file off disk.
{
  const publicPaths = new Set(Object.values(CLASSIFY).filter((c) => c.kind === 'public').map((c) => c.canonical));
  for (const p of publicPaths) assert(STATIC_URLS.includes(p), `sitemap STATIC_URLS lists ${p}`);
  for (const p of STATIC_URLS) assert(publicPaths.has(p), `sitemap STATIC_URLS entry ${p} is a page classified public (not a noindexed shell)`);

  const xml = buildSitemap(['software-engineer']);
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'buildSitemap output starts with the XML declaration');
  assert(xml.includes('<urlset'), 'buildSitemap output contains <urlset');
  assert(xml.includes(`<loc>${SITE}/careers/software-engineer</loc>`), 'buildSitemap output lists a sample career page');
  for (const p of STATIC_URLS) assert(xml.includes(`<loc>${SITE}${p}</loc>`), `buildSitemap output lists ${p}`);
  assert(xml.includes(`<loc>${SITE}${INDEX_URL}</loc>`), `buildSitemap output lists ${INDEX_URL}`);
  assert(xml.trimEnd().endsWith('</urlset>'), 'buildSitemap output closes </urlset>');

  // S14. The guides are Function routes, so they are deliberately NOT in
  // STATIC_URLS — that list is asserted equal to the public rows of the
  // classification table above, and a guide has no root .html to classify.
  assert(GUIDE_URLS.length >= 6, `the sitemap carries the guides (${GUIDE_URLS.length})`);
  assert(xml.includes(`<loc>${SITE}${GUIDES_INDEX_URL}</loc>`), `buildSitemap output lists ${GUIDES_INDEX_URL}`);
  for (const p of GUIDE_URLS) assert(xml.includes(`<loc>${SITE}${p}</loc>`), `buildSitemap output lists ${p}`);
  assert(
    !GUIDE_URLS.some((p) => STATIC_URLS.includes(p)) && !STATIC_URLS.includes(GUIDES_INDEX_URL),
    'no guide url is also a STATIC_URLS entry (one page, one sitemap row)',
  );

  // S15. The share pages and /invite are the OPPOSITE case to the guides: also
  // Function routes with no root .html, but they must NEVER reach the sitemap.
  // A share page is user-generated content on the marketing domain and /invite
  // carries a personal link — indexing either would be a privacy failure dressed
  // as an SEO win, so the absence is asserted rather than assumed.
  for (const p of ['/s/', '/s/img/', '/invite', '/r/']) {
    assert(!xml.includes(`<loc>${SITE}${p}`), `the sitemap carries no ${p} url`);
    assert(!STATIC_URLS.some((u) => u.startsWith(p)), `STATIC_URLS carries no ${p} url`);
  }
}

// S15 — the share + referral routes exist and are correctly non-indexable.
// Executed rather than grepped: /s/img/[id].js answering at `/s/img/<id>.png`
// is a claim about how Pages derives a route from a nested [param] file, and
// only importing the module proves the file is even loadable.
console.log('verify:meta — S15 share + referral routes');
{
  const s15 = [
    ['functions/s/[id].js', 'onRequestGet'],
    ['functions/s/img/[id].js', 'onRequestGet'],
    ['functions/r/[code].js', 'onRequestGet'],
    ['functions/share.js', 'onRequestPost'],
    ['functions/referral.js', 'onRequestGet'],
    ['functions/invite.js', 'onRequestGet'],
  ];
  for (const [file, fn] of s15) {
    assert(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
    // eslint-disable-next-line no-await-in-loop
    const mod = await import(pathToFileURL(path.join(ROOT, file)).href);
    assert(typeof mod[fn] === 'function', `${file} exports ${fn}`);
  }

  const { sharePageHtml, shareMissingHtml, shareImageUrl } = await import(
    pathToFileURL(path.join(ROOT, 'functions/_lib/share.js')).href);
  const id = 'a'.repeat(22);
  const html = sharePageHtml({
    id,
    origin: SITE,
    ctaUrl: `${SITE}/quiz`,
    payload: { firstName: 'Alex', careers: [{ title: 'Accountants', score: 80, tier: 'LEGENDARY' }] },
  });
  assert(/<meta name="robots" content="noindex/.test(html), 'a share page is noindex');
  assert(!/rel="canonical"/.test(html), 'and carries no canonical (contradictory signals on a noindex page)');
  assert(html.includes(`<meta property="og:image" content="${shareImageUrl(SITE, id)}">`),
    'a share page\'s og:image is its own PNG, absolute');
  assert(/og:image:width" content="1200"/.test(html) && /og:image:height" content="630"/.test(html),
    'declared at 1200x630, the size unfurlers render large');
  assert(/twitter:card" content="summary_large_image"/.test(html), 'and as a large twitter card');
  assert(/<meta property="og:title"/.test(html) && /<meta name="description"/.test(html),
    'with a title and description for the preview');
  assert(/noindex/.test(shareMissingHtml()), 'and a revoked share page is noindex too');
}

// The counsel-review marking is part of the D21 deliverable, not decoration —
// it must not be quietly dropped by a later copy edit.
for (const f of ['privacy.html', 'terms.html', 'security.html']) {
  if (!src.has(f)) continue;
  const t = src.get(f);
  assert(/fw-doc-review/.test(t), `${f} carries the counsel-review notice`);
  assert(/counsel|attorney|lawyer/i.test(t), `${f} says the text is pending legal review out loud`);
  assert(/Last updated/i.test(t), `${f} states a last-updated date`);
  // Every TOC entry points at a heading that exists, and vice versa.
  const toc = [...t.matchAll(/<nav class="fw-doc-toc"[\s\S]*?<\/nav>/g)].join('');
  const tocIds = [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const h2Ids = [...t.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  assert(tocIds.length >= 6, `${f} table of contents has at least 6 entries (${tocIds.length})`);
  assert(tocIds.every((id) => h2Ids.includes(id)), `${f} every TOC link resolves to an <h2 id>`);
  assert(h2Ids.every((id) => tocIds.includes(id)), `${f} every <h2 id> is listed in the TOC`);
}

// ---------------------------------------------------------------------------
// 6. Lockdown: repo files, robots.txt, host noindex.

console.log('verify:meta — lockdown');
const redirects = fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8');
for (const p of ['/.dev.vars.example', '/.cursor/*', '/.assetsignore']) {
  assert(new RegExp(`^\\s*${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'm').test(redirects),
    `_redirects blocks ${p} (the mechanism that actually works — .assetsignore does not)`);
}
if (fs.existsSync(path.join(ROOT, '.assetsignore'))) {
  const ai = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8');
  if (!/\.dev\.vars\.example/.test(ai)) warn('.dev.vars.example is not in .assetsignore (belt only — _redirects is the braces)');
}
assert(!fs.existsSync(path.join(ROOT, 'robots.txt')),
  'the static robots.txt is gone — it served the same Allow:/ from every host (functions/robots.txt.js replaces it)');
assert(fs.existsSync(path.join(ROOT, 'functions/robots.txt.js')), 'functions/robots.txt.js exists');

assert(shouldNoindexHost('flightwayjacobprototype.pages.dev'), 'the prototype host is noindex');
assert(shouldNoindexHost('jacob-work.flightway.pages.dev'), 'a preview alias is noindex');
assert(shouldNoindexHost('abc123.flightwayprototype.pages.dev'), 'a per-commit alias is noindex');
assert(!shouldNoindexHost('flightway.ai'), 'flightway.ai is indexable');
assert(!shouldNoindexHost('www.flightway.ai'), 'www.flightway.ai is indexable');
assert(!shouldNoindexHost('localhost'), 'localhost is not tagged (it cannot be crawled)');
assert(shouldNoindexHost(''), 'an unparseable host fails closed');

const mw = fs.readFileSync(path.join(ROOT, 'functions/_middleware.js'), 'utf8');
assert(/SESSION_PEPPER/.test(mw), 'the middleware still refuses to serve an unconfigured environment');
assert(/X-Robots-Tag/.test(mw), 'the middleware sets X-Robots-Tag');
assert(/res\.webSocket|status === 101/.test(mw),
  'the middleware skips responses it must not reconstruct (101/websocket)');

// The robots handler itself, executed — not pattern-matched.
{
  const run = async (host) => {
    const res = await robotsHandler({ request: new Request(`https://${host}/robots.txt`) });
    return { status: res.status, ct: res.headers.get('Content-Type'), body: await res.text() };
  };
  const prod = await run('flightway.ai');
  const proto = await run('flightwayjacobprototype.pages.dev');
  assert(prod.status === 200 && /text\/plain/.test(prod.ct || ''), 'robots.txt is 200 text/plain');
  assert(/^User-agent: \*\nAllow: \//m.test(prod.body), 'flightway.ai robots.txt allows crawling');
  assert(prod.body.includes(`Sitemap: ${SITE}/sitemap.xml`), 'flightway.ai robots.txt points at the sitemap');
  assert(/GPTBot/.test(prod.body) && /ClaudeBot/.test(prod.body) && /Google-Extended/.test(prod.body),
    'flightway.ai robots.txt names the AI crawlers explicitly (D20)');
  assert(/Disallow: \/docs\//.test(prod.body), 'flightway.ai robots.txt keeps internal paths out');
  assert(/^Disallow: \/$/m.test(proto.body) && !/^Allow: \//m.test(proto.body),
    'every non-canonical host gets Disallow-all');
  assert(!proto.body.includes('Sitemap:'), 'a non-canonical host advertises no sitemap');
  const bad = await robotsHandler({ request: new Request('https://flightway.ai/robots.txt', { method: 'POST' }) });
  assert(bad.status === 405, 'robots.txt refuses non-GET');

  // S14: robots.txt has pointed AI crawlers at /llms.txt since S2, when that
  // file did not exist. It does now, and this is the assertion that keeps the
  // reference from becoming a lie again if the route is ever renamed.
  if (/llms\.txt/.test(prod.body)) {
    assert(ROUTES.has('/llms.txt'), 'robots.txt names /llms.txt and the route exists');
  }
}

// ---------------------------------------------------------------------------
// 9. The guides surface (S14). Function routes, so they never appear in the
// classification table — but an orphan is an orphan: a page nothing links to is
// a page Google finds late, if at all.

console.log('verify:meta — guides + llms surface');
for (const route of ['/guides', '/llms.txt', '/llms-full.txt']) {
  assert(ROUTES.has(route), `${route} is mounted as a Pages Function`);
}
assert(fs.existsSync(path.join(ROOT, 'functions/guides/[slug].js')), 'the per-guide dynamic route exists');
assert(resolves('/guides/career-quiz'), '/guides/<slug> resolves through the dynamic route');
{
  const home = live.get('index.html') || '';
  assert(home.includes('href="/guides"'), 'index.html links the guides hub (otherwise it is an orphan in the crawl graph)');
  for (const p of GUIDE_URLS.slice(0, 2)) {
    // Not every guide needs a link from the landing page — the hub carries
    // those — but the ones index.html DOES name must resolve.
    if (home.includes(`href="${p}"`)) assert(resolves(p), `index.html link ${p} resolves`);
  }
}

// ---------------------------------------------------------------------------
// 7. Contact: the client's <select> and the server's allowlist cannot drift.
// Same duplication hazard as the KEY_MAP that verify:user polices — the form is
// vanilla JS on a page and cannot import from functions/.

console.log('verify:meta — contact form contract');
{
  const t = src.get('contact.html') || '';
  const opts = [...t.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert(opts.length === CONTACT_TOPICS.length && opts.every((o) => CONTACT_TOPICS.includes(o)),
    `contact.html topics match the server allowlist (${opts.join(',')} vs ${CONTACT_TOPICS.join(',')})`);
  assert(/fetch\('\/contact'/.test(t), 'contact.html posts to /contact');
  assert(ROUTES.has('/contact'), 'functions/contact.js is mounted at /contact');
  assert(!turnstileEnabled({}), 'Turnstile is off when unconfigured (the form must work anyway)');
  assert(turnstileEnabled({ TURNSTILE_SITE_KEY: 'a', TURNSTILE_SECRET_KEY: 'b' }), 'Turnstile turns on when both keys are set');
  assert(/turnstileSiteKey/.test(fs.readFileSync(path.join(ROOT, 'functions/config.js'), 'utf8')),
    '/config serves turnstileSiteKey so the client never hard-codes it');
  const migrations = fs.readdirSync(path.join(ROOT, 'migrations'));
  assert(migrations.some((m) => /contact/.test(m)), 'a contact_messages migration exists');
}

// ---------------------------------------------------------------------------
// 8. The misconfigurations that used to be silent.

console.log('verify:meta — loud misconfiguration');
{
  const nt = fs.readFileSync(path.join(ROOT, 'functions/_lib/notify-token.js'), 'utf8');
  assert(/console\.warn/.test(nt) && /UNSUB_SECRET/.test(nt),
    'notify-token warns out loud when UNSUB_SECRET is missing (silent fallback = every unsubscribe link 403s)');
  // S4 moved the MAILING_ADDRESS warning out of the cron into the shared email
  // template (functions/_lib/email-template.js) that the cron AND every Pages
  // sender import — so this one warning now guards every marketing send path.
  const emailTpl = fs.readFileSync(path.join(ROOT, 'functions/_lib/email-template.js'), 'utf8');
  assert(/console\.warn/.test(emailTpl) && /MAILING_ADDRESS/.test(emailTpl),
    'the shared email template warns out loud when MAILING_ADDRESS is missing (CAN-SPAM)');
}

console.log(`\nverify:meta — ${htmlFiles.length} pages checked`);
console.log(fail ? `verify:meta FAIL — ${fail} problem(s)` : 'verify:meta PASS');
process.exit(fail ? 1 : 0);
