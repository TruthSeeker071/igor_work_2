// seo:check — the gate for the public, server-rendered SEO surface (V2 S13).
//
// Everything this covers is invisible at runtime and expensive to discover
// late. A career page with a duplicate <title> still renders. A canonical
// pointing at the prototype host still renders. A JSON-LD block that fails to
// parse still renders — Google just silently drops the rich result, months
// after the deploy, and nobody on the team ever looks at the raw HTML of one of
// 782 pages nobody on the team is the audience for.
//
// It runs OFFLINE, against the real handlers. `fetch` is stubbed to read the
// O*NET artifacts from disk, so this executes `functions/careers/[slug].js`,
// `functions/careers/index.js` and `functions/sitemap.xml.js` exactly as
// deployed — including the KV cache path, against a fake KV — rather than
// pattern-matching their source. That distinction is the whole value: an
// ownership bug lives in a WHERE clause and a caching bug lives in a key, and
// neither is visible to a regex.
//
// Coverage is the WHOLE catalog, not a sample. The plan asked for "a sample of
// N slugs"; all 782 render in ~60ms, and a sample is exactly how the one
// occupation with a pathological title ships broken.
//
// Run: npm run seo:check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://flightway.ai';

let fail = 0;
let passes = 0;
const assert = (cond, msg) => {
  if (cond) { passes += 1; return true; }
  fail += 1;
  console.error('  FAIL', msg);
  return false;
};
const section = (name) => console.log(`\n${name}`);

// ---------------------------------------------------------------------------
// Disk-backed fetch stub. The routes read artifacts over HTTP in production
// (`/data/onet/artifacts/*`, `/assets/data/salary-tiers.json`); here the same
// URLs resolve to the files those URLs are served from.

let fetchMode = 'ok'; // 'ok' | 'throw'
globalThis.fetch = async (url) => {
  if (fetchMode === 'throw') throw new Error('artifact store unavailable (test)');
  const u = new URL(String(url));
  const file = path.join(ROOT, u.pathname);
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

const {
  SITE: LIB_SITE, CAREER_PAGE_VERSION, MAX_TITLE, MAX_META_DESCRIPTION,
  ONET_RELEASE, ONET_DIMENSIONS, esc,
  renderCareerPage, renderCareersIndex, careerContent,
} = await import('../functions/_lib/career-page.js');
const { DIM_COUNT } = await import('../functions/_lib/onet/constants.js');
const {
  loadCareerIndex, dimensionsFor, neighboursFor, getSalaryTiers, clearCareerPageCache,
} = await import('../functions/_lib/career-catalog.js');
const { clearOnetCache } = await import('../functions/_lib/onet/store.js');
const { onRequest: slugRoute } = await import('../functions/careers/[slug].js');
const { onRequest: indexRoute } = await import('../functions/careers/index.js');
const {
  onRequest: sitemapRoute, STATIC_URLS, INDEX_URL, GUIDES_INDEX_URL, GUIDE_URLS,
} = await import('../functions/sitemap.xml.js');
const {
  GUIDES, GROUPS, GUIDE_BY_SLUG, CAREER_TITLES, CAREER_COUNT_CLAIM, GUIDES_CONTENT_DATE,
  renderGuidePage, renderGuidesIndex, guideWordCount, guideProse, tagsUsed, inline,
} = await import('../functions/_lib/guides.js');
const { buildLlmsTxt, buildLlmsFullTxt } = await import('../functions/_lib/llms.js');
const { onRequest: guideRoute } = await import('../functions/guides/[slug].js');
const { onRequest: guidesIndexRoute } = await import('../functions/guides/index.js');
const { onRequest: llmsRoute } = await import('../functions/llms.txt.js');
const { onRequest: llmsFullRoute } = await import('../functions/llms-full.txt.js');

// ---------------------------------------------------------------------------
// Fake KV + request driver.

function fakeKv() {
  const store = new Map();
  const kv = {
    keys: store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
  return kv;
}

const tasks = [];
function ctx(url, { method = 'GET', env = {}, params = {} } = {}) {
  return {
    request: new Request(url, { method }),
    env,
    params,
    waitUntil: (p) => { tasks.push(Promise.resolve(p).catch(() => {})); },
  };
}
const settle = () => Promise.all(tasks.splice(0));

async function callSlug(slug, opts = {}) {
  const res = await slugRoute(ctx(`${SITE}/careers/${slug}`, { ...opts, params: { slug } }));
  await settle();
  return res;
}

// ---------------------------------------------------------------------------
// Load the catalog once. Everything below reads this index.

const env = { COACH_KV: fakeKv() };
const index = await loadCareerIndex(env, SITE);
const salaryTiers = await getSalaryTiers(SITE);

section(`Catalog — ${index.count} canonical slugs, ${index.aliasTo.size} aliases`);
assert(LIB_SITE === SITE, 'career-page.js SITE is the canonical host');
assert(index.count > 700, `catalog has more than 700 publishable careers (got ${index.count})`);
assert(index.sectors.length >= 8, `directory groups into at least 8 sectors (got ${index.sectors.length})`);
assert(
  index.sectors.reduce((n, s) => n + s.rows.length, 0) === index.count,
  'every career appears in exactly one sector section — none dropped from the directory',
);
assert(
  [...index.bySlug.keys()].every((s) => /^[a-z0-9-]+$/.test(s)),
  'every canonical slug is url-safe lowercase',
);
assert(
  ![...index.bySlug.values()].some((r) => r.aiDerived === true),
  'no AI-derived career gets a public page (they appear and disappear per user)',
);

// Facts stated in prose on ~780 public pages. A wrong O*NET release number is a
// false citation on every one of them, and nobody would ever notice by reading.
{
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/onet/dimension-registry-v1.json'), 'utf8'));
  assert(String(registry.onetRelease) === ONET_RELEASE, `the credited O*NET release matches the registry (${registry.onetRelease} vs ${ONET_RELEASE})`);
  assert(registry.dimensions.length === ONET_DIMENSIONS, `the dimension count in the fit explainer matches the registry (${registry.dimensions.length} vs ${ONET_DIMENSIONS})`);
  assert(DIM_COUNT === ONET_DIMENSIONS, `the dimension count matches onet/constants.js DIM_COUNT (${DIM_COUNT})`);
}

// ---------------------------------------------------------------------------
// Whole-catalog render sweep.

const INTERNAL_OK = new Set([
  '/', '/careers', '/guides', '/quiz', '/pricing', '/privacy', '/terms', '/security', '/contact',
  '/auth#signin', '/#how-it-works', '/terms#our-content',
]);
const SECTOR_KEYS = new Set(index.sectors.map((s) => s.key));
const MAX_PAGE_BYTES = 60 * 1024;
const MAX_INDEX_BYTES = 200 * 1024;

function parseLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { out.push({ raw: m[1], obj: JSON.parse(m[1]) }); } catch { out.push({ raw: m[1], obj: null }); }
  }
  return out;
}

/** Anchors only. `<link rel=…>` hrefs are ASSETS, and their stamps are
 *  verify:busters' job, not a navigable-link check's. */
function internalHrefs(html) {
  return [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1])
    .filter((h) => h.startsWith('/') && !h.startsWith('//'));
}

const titles = new Map();
const descs = new Map();
const problems = { title: [], desc: [], canonical: [], ld: [], link: [], size: [], h1: [], og: [], prose: [] };
let biggest = 0;
let biggestSlug = '';
const t0 = Date.now();

for (const [slug, row] of index.bySlug) {
  const dims = await dimensionsFor(env, SITE, row);
  const { related, sameSector } = await neighboursFor(env, SITE, index, row);
  const content = careerContent({
    row, dims, related, sameSector, salaryTiers, catalogCount: index.count,
  });
  const html = renderCareerPage(content);

  // The descriptions artifact clips O*NET's text at 500 chars, so 32 rows
  // arrive ending mid-clause. cleanDescription() cuts back to the last whole
  // sentence; this is the assertion that keeps it doing so.
  if (content.description && !/[.!?…]$/.test(content.description)) problems.prose.push(`${slug}: …${content.description.slice(-40)}`);
  if (content.hook && !/[.!?…]$/.test(content.hook)) problems.prose.push(`${slug} hook: …${content.hook.slice(-40)}`);
  if (!content.context.length) problems.prose.push(`${slug}: no work-context notes`);

  if (html.length > biggest) { biggest = html.length; biggestSlug = slug; }
  if (html.length > MAX_PAGE_BYTES) problems.size.push(`${slug} ${html.length}B`);

  const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '';
  const desc = (/<meta name="description" content="([^"]*)">/.exec(html) || [])[1] || '';
  titles.set(title, (titles.get(title) || 0) + 1);
  descs.set(desc, (descs.get(desc) || 0) + 1);
  // A title longer than MAX_TITLE is allowed ONLY when the occupation's own
  // name is already that long — titleFor() drops the suffix in stages and then
  // stops, because inventing a shorter name for a federal occupation title
  // would be worse than a clipped SERP line.
  if (title.length > MAX_TITLE && title !== row.title) problems.title.push(`${slug} (${title.length}) ${title}`);
  if (!desc || desc.length > MAX_META_DESCRIPTION || desc.length < 70) problems.desc.push(`${slug} (${desc.length})`);

  const canon = (/<link rel="canonical" href="([^"]*)">/.exec(html) || [])[1] || '';
  if (canon !== `${SITE}/careers/${slug}`) problems.canonical.push(`${slug} -> ${canon}`);
  if ((html.match(/rel="canonical"/g) || []).length !== 1) problems.canonical.push(`${slug} has ${(html.match(/rel="canonical"/g) || []).length} canonicals`);
  if (/name="robots"/.test(html)) problems.canonical.push(`${slug} carries a robots meta on an indexable page`);

  if ((html.match(/<h1>/g) || []).length !== 1) problems.h1.push(slug);

  const og = (/<meta property="og:image" content="([^"]*)">/.exec(html) || [])[1] || '';
  if (!og.startsWith(`${SITE}/assets/og/`)) problems.og.push(`${slug} og:image ${og}`);
  if (!/twitter:card" content="summary_large_image"/.test(html)) problems.og.push(`${slug} twitter:card`);

  const lds = parseLd(html);
  if (lds.length !== 2) problems.ld.push(`${slug}: ${lds.length} blocks`);
  else if (!lds[0].obj || !lds[1].obj) problems.ld.push(`${slug}: unparseable JSON-LD`);
  else {
    const [occ, crumb] = lds.map((l) => l.obj);
    if (occ['@type'] !== 'Occupation') problems.ld.push(`${slug}: first block is ${occ['@type']}`);
    if (occ.url !== `${SITE}/careers/${slug}`) problems.ld.push(`${slug}: Occupation.url ${occ.url}`);
    if (occ.occupationalCategory !== row.soc) problems.ld.push(`${slug}: occupationalCategory ${occ.occupationalCategory}`);
    if (crumb['@type'] !== 'BreadcrumbList') problems.ld.push(`${slug}: second block is ${crumb['@type']}`);
    if (!Array.isArray(crumb.itemListElement) || crumb.itemListElement.length !== 3) problems.ld.push(`${slug}: breadcrumb depth`);
    else if (crumb.itemListElement[2].item !== `${SITE}/careers/${slug}`) problems.ld.push(`${slug}: breadcrumb leaf`);
  }
  // A payload that can emit "</script>" closes its own block and turns the
  // rest of the page into executable markup. jsonLd() escapes < > &.
  for (const l of lds) {
    if (/<|>/.test(l.raw)) problems.ld.push(`${slug}: raw angle bracket inside JSON-LD`);
  }

  for (const href of internalHrefs(html)) {
    if (INTERNAL_OK.has(href)) continue;
    if (href.startsWith('/careers#')) {
      if (!SECTOR_KEYS.has(href.slice('/careers#'.length))) problems.link.push(`${slug} -> ${href}`);
      continue;
    }
    if (href.startsWith('/careers/')) {
      const target = href.slice('/careers/'.length);
      if (!index.bySlug.has(target)) problems.link.push(`${slug} -> ${href} (no such career page)`);
      continue;
    }
    // "Open in FlightWay" — the app's own deep dive. Uses the CLEAN url
    // (`/career`, not `/career.html`): Pages 308s the .html form, and a
    // redirect hop on the one link that hands a reader to the product is a
    // hop worth not having.
    if (href.startsWith('/career?slug=')) {
      const target = decodeURIComponent(href.slice('/career?slug='.length));
      if (!index.bySlug.has(target)) problems.link.push(`${slug} -> ${href} (app deep dive slug)`);
      continue;
    }
    if (href.startsWith('/quiz?')) continue;
    problems.link.push(`${slug} -> ${href} (unknown internal target)`);
  }
}

section(`Career pages — all ${index.count} rendered in ${Date.now() - t0}ms`);
const dupTitles = [...titles.entries()].filter(([, n]) => n > 1);
const dupDescs = [...descs.entries()].filter(([, n]) => n > 1);
assert(dupTitles.length === 0, `every <title> is unique (${dupTitles.length} duplicated: ${dupTitles.slice(0, 3).map(([t]) => t).join(' | ')})`);
assert(dupDescs.length === 0, `every meta description is unique (${dupDescs.length} duplicated)`);
assert(problems.title.length === 0, `titles fit a search result or are the occupation's own name (${problems.title.slice(0, 3).join('; ')})`);
assert(problems.desc.length === 0, `descriptions are 70–${MAX_META_DESCRIPTION} chars (${problems.desc.slice(0, 3).join('; ')})`);
assert(problems.canonical.length === 0, `exactly one canonical, absolute, self-referential, no robots meta (${problems.canonical.slice(0, 3).join('; ')})`);
assert(problems.h1.length === 0, `exactly one <h1> per page (${problems.h1.slice(0, 3).join(', ')})`);
assert(problems.og.length === 0, `og:image absolute + twitter summary_large_image (${problems.og.slice(0, 2).join('; ')})`);
assert(problems.ld.length === 0, `Occupation + BreadcrumbList JSON-LD parse and point at this page (${problems.ld.slice(0, 3).join('; ')})`);
assert(problems.link.length === 0, `every internal link resolves (${problems.link.slice(0, 3).join('; ')})`);
assert(problems.size.length === 0, `every page is under ${MAX_PAGE_BYTES / 1024}KB (largest: ${biggestSlug} ${biggest}B)`);
assert(problems.prose.length === 0, `no page ships a severed sentence or an empty work-context section (${problems.prose.slice(0, 3).join('; ')})`);

// og:image must be a file that EXISTS at the stamped path — the one asset
// nobody on the team ever sees rendered.
const ogRef = (/<meta property="og:image" content="[^"]*\/assets\/og\/([a-z0-9-]+\.png)\?v=/.exec(
  renderCareerPage(careerContent({
    row: index.bySlug.get([...index.bySlug.keys()][0]), dims: [], related: [], sameSector: [], salaryTiers, catalogCount: index.count,
  })),
) || [])[1];
assert(!!ogRef && fs.existsSync(path.join(ROOT, 'assets/og', ogRef)), `the career og:image file exists on disk (${ogRef})`);

// ---------------------------------------------------------------------------
// The directory.

section('Directory — /careers');
const idxHtml = renderCareersIndex({ sectors: index.sectors, count: index.count });
const idxLinks = new Set(internalHrefs(idxHtml).filter((h) => h.startsWith('/careers/')).map((h) => h.slice('/careers/'.length)));
assert(idxLinks.size === index.count, `the directory links every career page (${idxLinks.size} of ${index.count})`);
assert([...idxLinks].every((s) => index.bySlug.has(s)), 'no directory link points at a career page that does not exist');
assert(idxHtml.length <= MAX_INDEX_BYTES, `directory is under ${MAX_INDEX_BYTES / 1024}KB (${idxHtml.length}B)`);
assert(/<link rel="canonical" href="https:\/\/flightway\.ai\/careers">/.test(idxHtml), 'directory canonical is /careers');
assert((idxHtml.match(/<h1>/g) || []).length === 1, 'directory has exactly one h1');
assert(parseLd(idxHtml).every((l) => l.obj), 'directory JSON-LD parses');
assert(
  index.sectors.every((s) => idxHtml.includes(`id="${s.key}"`)),
  'every sector section carries the id the career pages deep-link to',
);
// The search box is progressive enhancement. If it hid rows before JS ran, a
// crawler with JS disabled would read an empty directory — the exact failure
// this whole session exists to avoid.
assert(!/data-cg-name="[^"]*" hidden/.test(idxHtml), 'no directory row ships hidden');

// ---------------------------------------------------------------------------
// Routes, executed.

section('Routes — executed handlers');
const sample = [...index.bySlug.keys()][0];
const first = await callSlug(sample, { env });
assert(first.status === 200, `GET /careers/${sample} → 200`);
assert((first.headers.get('content-type') || '').includes('text/html'), 'career page is text/html');
const cc = first.headers.get('cache-control') || '';
assert(cc.includes('s-maxage=86400'), `career page sets s-maxage=86400 (${cc})`);
assert(cc.includes('stale-while-revalidate'), 'career page sets stale-while-revalidate');
assert(cc.includes('max-age=0'), 'career page pins the BROWSER cache to 0 — the one cache we cannot bust');
assert(first.headers.get('x-fw-cache') === 'miss', 'first request renders (X-FW-Cache: miss)');

const firstBody = await first.text();
const second = await callSlug(sample, { env });
assert(second.headers.get('x-fw-cache') === 'hit', 'second request is served from KV (X-FW-Cache: hit)');
assert(await second.text() === firstBody, 'the cached body is byte-identical to the rendered one');
assert(
  [...env.COACH_KV.keys.keys()].some((k) => k === `cgpage:${CAREER_PAGE_VERSION}:${sample}`),
  'the KV key carries CAREER_PAGE_VERSION — bumping it is the purge hook',
);

const aliasEntry = [...index.aliasTo.entries()].find(([, to]) => index.bySlug.has(to));
const redirect = await callSlug(aliasEntry[0], { env });
assert(redirect.status === 301, `an alias 301s rather than rendering a duplicate (${aliasEntry[0]})`);
assert(redirect.headers.get('location') === `/careers/${aliasEntry[1]}`, `alias points at /careers/${aliasEntry[1]}`);

const upper = await callSlug(sample.toUpperCase(), { env });
assert(upper.status === 200, 'an uppercase slug still resolves (case is not a different page)');
const dotHtml = await callSlug(`${sample}.html`, { env });
assert(dotHtml.status === 200, 'a .html suffix still resolves');

const missing = await callSlug('definitely-not-a-real-career-xyz', { env });
assert(missing.status === 404, 'an unknown slug is a real 404, not a soft 200');
const missBody = await missing.text();
assert(/name="robots" content="noindex/.test(missBody), 'the 404 page is noindex — a soft-404 farm is a site-wide penalty');
assert(!/rel="canonical"/.test(missBody), 'the 404 page carries no canonical (noindex + canonical is a contradiction)');
assert((missing.headers.get('cache-control') || '').includes('no-store'), '404s are not cached');

const posted = await slugRoute(ctx(`${SITE}/careers/${sample}`, { method: 'POST', env, params: { slug: sample } }));
assert(posted.status === 405, 'POST to a career page is 405');
const headRes = await slugRoute(ctx(`${SITE}/careers/${sample}`, { method: 'HEAD', env, params: { slug: sample } }));
await settle();
assert(headRes.status === 200 && (await headRes.text()) === '', 'HEAD returns headers with no body');

const dirRes = await indexRoute(ctx(`${SITE}/careers`, { env }));
await settle();
assert(dirRes.status === 200, 'GET /careers → 200');
assert(dirRes.headers.get('x-fw-cache') === 'miss', 'directory renders on a cold cache');
const dirRes2 = await indexRoute(ctx(`${SITE}/careers`, { env }));
await settle();
assert(dirRes2.headers.get('x-fw-cache') === 'hit', 'directory is served from KV on the second request');

// ---------------------------------------------------------------------------
// Sitemap.

section('Sitemap — /sitemap.xml');
const smRes = await sitemapRoute(ctx(`${SITE}/sitemap.xml`, { env }));
await settle();
const sm = await smRes.text();
assert(smRes.status === 200, 'GET /sitemap.xml → 200');
assert((smRes.headers.get('content-type') || '').includes('xml'), 'sitemap is served as xml');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
assert(
  locs.length === STATIC_URLS.length + 1 + 1 + GUIDE_URLS.length + index.count,
  `sitemap lists every static page, both directories, all ${GUIDE_URLS.length} guides and all ${index.count} careers (${locs.length})`,
);
assert(locs.includes(`${SITE}${GUIDES_INDEX_URL}`), 'the guides hub is in the sitemap');

// S19, found live: the sitemap body is KV-cached, and its key was
// `CAREER_PAGE_VERSION:GUIDES_CONTENT_DATE`. Adding a page to STATIC_URLS moves
// neither, so a deployed sitemap kept serving the previous build's body with the
// new pages simply absent from it — 200, well-formed, and wrong, for as long as
// the TTL had left. The key now carries a fingerprint of the static set, which
// is derived rather than declared precisely because a bump-me constant is only
// correct while somebody remembers it.
{
  const src = fs.readFileSync(path.join(ROOT, 'functions/sitemap.xml.js'), 'utf8');
  assert(/const key = `cgsitemap:\$\{CAREER_PAGE_VERSION\}:\$\{GUIDES_CONTENT_DATE\}:\$\{staticSetTag\(\)\}`/.test(src),
    'the sitemap cache key carries a fingerprint of the static URL set');
  assert(/export function staticSetTag/.test(src) && /STATIC_URLS/.test(src.split('export function staticSetTag')[1].slice(0, 400)),
    'and that fingerprint is derived from STATIC_URLS, not a constant somebody has to bump');
}
assert(
  GUIDE_URLS.every((p) => locs.includes(`${SITE}${p}`)),
  'every guide page is in the sitemap',
);
assert(
  GUIDE_URLS.every((p) => new RegExp(`<loc>${SITE}${p}</loc><lastmod>${GUIDES_CONTENT_DATE}</lastmod>`).test(sm.replace(/\s+/g, ''))),
  'every guide url carries the guides content date as its lastmod',
);
assert(new Set(locs).size === locs.length, 'no duplicate <loc>');
assert(locs.every((l) => l.startsWith(SITE)), 'every sitemap url is on the canonical host, whatever host served the request');
assert(locs.includes(`${SITE}${INDEX_URL}`), 'the directory is in the sitemap');
assert(
  locs.filter((l) => l.startsWith(`${SITE}/careers/`)).every((l) => index.bySlug.has(l.slice(`${SITE}/careers/`.length))),
  'every career url in the sitemap is a page that renders 200 (never an alias, which would 301)',
);
assert(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(sm), 'no unescaped ampersand — one is enough to make the whole file unparseable');
assert(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sm), 'career urls carry a real lastmod');
assert(
  !new RegExp(`<loc>${SITE}/</loc><lastmod>`).test(sm.replace(/\s+/g, '')),
  'static pages carry NO lastmod — a fabricated one teaches Google to ignore all of them',
);

// ---------------------------------------------------------------------------
// Hostile input. Catalog titles come from a build artifact today, but this is
// the only HTML in the product built by string concatenation.

section('Escaping');
const hostileRow = {
  soc: '99-9999.00',
  title: '<img src=x onerror="alert(1)">Evil "Career" & Co',
  hubZone: 'tech',
  socMajor: '15',
  jobZone: 4,
  vectorIndex: 0,
  description: '</script><script>alert(2)</script>',
  __slug: 'hostile-career',
};
const hostileHtml = renderCareerPage(careerContent({
  row: hostileRow, dims: [], related: [], sameSector: [], salaryTiers, catalogCount: 1,
}));
assert(!hostileHtml.includes('<img src=x'), 'a script-shaped title is escaped, not injected');
assert(!/onerror="alert/.test(hostileHtml), 'no event handler survives into the markup');
assert(
  (hostileHtml.match(/<script/g) || []).length === (hostileHtml.match(/<script[ >]/g) || []).length,
  'no extra <script> opened by page content',
);
const hostileLd = parseLd(hostileHtml);
assert(hostileLd.length === 2 && hostileLd.every((l) => l.obj), 'JSON-LD still parses with hostile content in it');
assert(hostileLd.every((l) => !/<\/script/i.test(l.raw)), 'JSON-LD cannot close its own script block');

// ---------------------------------------------------------------------------
// Degradation. The artifact store being unreachable must never produce a 500 at
// /sitemap.xml — that is a Search Console error against the whole property.

// The stack traces this section prints are the failure paths UNDER TEST — the
// handlers log before degrading, and that logging is part of what is asserted.
section('Degradation (the errors below are deliberate)');
clearCareerPageCache();
clearOnetCache();
fetchMode = 'throw';
const brokenEnv = { COACH_KV: fakeKv() };
const smBroken = await sitemapRoute(ctx(`${SITE}/sitemap.xml`, { env: brokenEnv }));
await settle();
const smBrokenBody = await smBroken.text();
assert(smBroken.status === 200, 'sitemap still 200s when the catalog is unreachable');
assert(
  [...smBrokenBody.matchAll(/<loc>/g)].length === STATIC_URLS.length + 1 + 1 + GUIDE_URLS.length,
  `the degraded sitemap still lists every static page, both directories and every guide (${[...smBrokenBody.matchAll(/<loc>/g)].length})`,
);
assert(smBrokenBody.includes('</urlset>'), 'the degraded sitemap is still valid XML');

const brokenPage = await slugRoute(ctx(`${SITE}/careers/${sample}`, { env: brokenEnv, params: { slug: sample } }));
await settle();
assert(brokenPage.status === 500, 'a career page whose catalog is unreachable reports 500, not a fake 200');
assert(/noindex/.test(await brokenPage.text()), 'even the 500 body is noindex — a crawler remembers an empty page');
fetchMode = 'ok';

// ---------------------------------------------------------------------------
// S14 — the guides hub.
//
// Same discipline as the career sweep above: render every guide and assert
// against all of them. Three things here are specific to this surface and are
// the reason it needs its own section rather than a reuse of the career one.
//
//   1. The FAQPage JSON-LD must match the VISIBLE questions and answers.
//      Google's guidelines require the marked-up Q&A to be present for the
//      reader; markup that has drifted from the page is the failure mode that
//      gets structured data ignored site-wide, and it drifts the first time
//      somebody edits one and not the other.
//   2. The product pitch must come LAST. A guide that opens by selling is a
//      doorway page, and doorway pages are a manual-action risk against the
//      whole domain (plan §10). Asserted structurally: no FlightWay mention in
//      the first section of any guide.
//   3. The occupational titles the guides use as anchor text are constants in
//      a pure module. They are checked against the LIVE catalog here, so a
//      renamed occupation is a red gate rather than eight pages calling it by
//      a name that no longer exists.

section(`Guides — ${GUIDES.length} pages`);
assert(GUIDES.length >= 6 && GUIDES.length <= 8, `the hub has 6-8 guides (${GUIDES.length})`);
assert(new Set(GUIDES.map((g) => g.slug)).size === GUIDES.length, 'every guide slug is unique');
assert(GUIDES.every((g) => /^[a-z0-9-]+$/.test(g.slug)), 'every guide slug is url-safe lowercase');
assert(
  GUIDES.every((g) => GROUPS.some((grp) => grp.key === g.group)),
  'every guide belongs to a group the hub actually renders',
);
assert(
  CAREER_COUNT_CLAIM <= index.count,
  `the "${CAREER_COUNT_CLAIM}+ careers" claim in the guides is still true (catalog has ${index.count})`,
);
{
  const wrong = Object.entries(CAREER_TITLES).filter(([slug, title]) => {
    const row = index.bySlug.get(slug);
    return !row || row.title !== title;
  });
  assert(wrong.length === 0, `every CAREER_TITLES entry matches the live catalog title (${wrong.map(([s, t]) => `${s}: "${t}" vs "${index.bySlug.get(s) ? index.bySlug.get(s).title : 'MISSING'}"`).slice(0, 3).join('; ')})`);
}

const GUIDE_SLUGS = new Set(GUIDES.map((g) => g.slug));
const EXTERNAL_OK = new Set(['www.onetonline.org', 'www.bls.gov', 'www.dol.gov']);
const ALLOWED_INLINE_TAGS = /^(?:\/?(?:strong|em|a)|a href="[^"<>]*")$/;
const gp = {
  title: [], desc: [], canonical: [], ld: [], link: [], size: [], h1: [], og: [],
  faq: [], thin: [], pitch: [], tag: [], structure: [], external: [],
};
const gTitles = new Map();
const gDescs = new Map();

for (const g of GUIDES) {
  const html = renderGuidePage(g);

  // Structure floors. A four-paragraph page with an FAQ bolted on is the thin
  // content the plan's risk register names by hand.
  const words = guideWordCount(g);
  if (words < 600) gp.thin.push(`${g.slug}: ${words} words`);
  if (g.sections.length < 4) gp.structure.push(`${g.slug}: ${g.sections.length} sections`);
  if (g.faq.length < 3 || g.faq.length > 6) gp.structure.push(`${g.slug}: ${g.faq.length} faq entries`);
  if (!g.related.length || g.related.some((s) => !GUIDE_SLUGS.has(s) || s === g.slug)) gp.structure.push(`${g.slug}: bad related list`);
  if (!g.careers.length || g.careers.some((s) => !index.bySlug.has(s))) gp.structure.push(`${g.slug}: bad careers list`);
  if (g.careers.some((s) => !CAREER_TITLES[s])) gp.structure.push(`${g.slug}: a linked career has no anchor title`);

  // Informational first (rule 2 above).
  const firstSection = [g.sections[0].h2, ...g.sections[0].body, ...((g.sections[0].list && g.sections[0].list.items) || [])].join(' ');
  if (/FlightWay/i.test(firstSection)) gp.pitch.push(`${g.slug}: FlightWay named in section 1`);
  const lastSection = g.sections[g.sections.length - 1];
  if (!/FlightWay/i.test([g.cta.h2, g.cta.p, lastSection.h2, ...lastSection.body].join(' '))) {
    gp.pitch.push(`${g.slug}: no product tie-in at all`);
  }

  // Inline markup allowlist (rule from _lib/guides.js's header).
  for (const s of [...guideProse(g), g.cta.p]) {
    for (const t of tagsUsed(s)) if (!ALLOWED_INLINE_TAGS.test(t)) gp.tag.push(`${g.slug}: <${t}>`);
  }
  // A paragraph that renders after a list must exist because the list has a
  // lead-in. An `after` with no list is an authoring mistake, not a layout.
  for (const sec of g.sections) {
    if (sec.after && sec.after.length && !sec.list) gp.structure.push(`${g.slug}/${sec.id}: after[] with no list`);
  }
  for (const f of g.faq) {
    if (tagsUsed(f.q).length || tagsUsed(f.a).length) gp.faq.push(`${g.slug}: html in an faq entry`);
    if (!/[.!?]$/.test(f.a.trim())) gp.faq.push(`${g.slug}: faq answer ends mid-sentence`);
    if (f.a.length < 60) gp.faq.push(`${g.slug}: faq answer under 60 chars`);
  }

  if (html.length > MAX_PAGE_BYTES) gp.size.push(`${g.slug} ${html.length}B`);

  const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '';
  const desc = (/<meta name="description" content="([^"]*)">/.exec(html) || [])[1] || '';
  gTitles.set(title, (gTitles.get(title) || 0) + 1);
  gDescs.set(desc, (gDescs.get(desc) || 0) + 1);
  if (!title.endsWith('| FlightWay')) gp.title.push(`${g.slug}: title carries no brand suffix`);
  if (title.length > MAX_TITLE) gp.title.push(`${g.slug} (${title.length}) ${title}`);
  if (!desc || desc.length > MAX_META_DESCRIPTION || desc.length < 70) gp.desc.push(`${g.slug} (${desc.length})`);
  if (!/[.!?]$/.test(desc)) gp.desc.push(`${g.slug}: description ends mid-sentence`);

  const canon = (/<link rel="canonical" href="([^"]*)">/.exec(html) || [])[1] || '';
  if (canon !== `${SITE}/guides/${g.slug}`) gp.canonical.push(`${g.slug} -> ${canon}`);
  if ((html.match(/rel="canonical"/g) || []).length !== 1) gp.canonical.push(`${g.slug}: wrong canonical count`);
  if (/name="robots"/.test(html)) gp.canonical.push(`${g.slug}: robots meta on an indexable page`);
  if ((html.match(/<h1>/g) || []).length !== 1) gp.h1.push(g.slug);

  const og = (/<meta property="og:image" content="([^"]*)">/.exec(html) || [])[1] || '';
  if (!og.startsWith(`${SITE}/assets/og/`)) gp.og.push(`${g.slug} og:image ${og}`);
  if (!/twitter:card" content="summary_large_image"/.test(html)) gp.og.push(`${g.slug} twitter:card`);

  const lds = parseLd(html);
  if (lds.length !== 3) gp.ld.push(`${g.slug}: ${lds.length} blocks`);
  else if (lds.some((l) => !l.obj)) gp.ld.push(`${g.slug}: unparseable JSON-LD`);
  else {
    const [article, faqPage, crumb] = lds.map((l) => l.obj);
    if (article['@type'] !== 'Article') gp.ld.push(`${g.slug}: first block is ${article['@type']}`);
    if (article.url !== `${SITE}/guides/${g.slug}`) gp.ld.push(`${g.slug}: Article.url ${article.url}`);
    if (article.headline !== g.title) gp.ld.push(`${g.slug}: Article.headline drifted from the title`);
    if (article.dateModified !== GUIDES_CONTENT_DATE) gp.ld.push(`${g.slug}: Article.dateModified is not the content date`);
    if (faqPage['@type'] !== 'FAQPage') gp.ld.push(`${g.slug}: second block is ${faqPage['@type']}`);
    // Rule 1: the markup and the page must say the same thing.
    const marked = (faqPage.mainEntity || []).map((q) => [q.name, q.acceptedAnswer && q.acceptedAnswer.text]);
    const shown = [...html.matchAll(/<p class="gd-faq-q">([\s\S]*?)<\/p>\s*<p class="gd-faq-a">([\s\S]*?)<\/p>/g)]
      .map((m) => [m[1], m[2]]);
    if (shown.length !== g.faq.length) gp.faq.push(`${g.slug}: ${shown.length} rendered faq blocks vs ${g.faq.length} authored`);
    if (marked.length !== shown.length) gp.ld.push(`${g.slug}: FAQPage marks ${marked.length} questions, the page shows ${shown.length}`);
    else {
      for (let i = 0; i < marked.length; i += 1) {
        // The rendered copy is HTML-escaped; compare against the escaped form.
        if (esc(marked[i][0]) !== shown[i][0] || esc(marked[i][1]) !== shown[i][1]) {
          gp.ld.push(`${g.slug}: FAQPage entry ${i} is not what the page shows`);
        }
      }
    }
    if (crumb['@type'] !== 'BreadcrumbList') gp.ld.push(`${g.slug}: third block is ${crumb['@type']}`);
    else if (!Array.isArray(crumb.itemListElement) || crumb.itemListElement.length !== 3
      || crumb.itemListElement[2].item !== `${SITE}/guides/${g.slug}`) gp.ld.push(`${g.slug}: breadcrumb leaf`);
  }
  for (const l of lds) if (/<|>/.test(l.raw)) gp.ld.push(`${g.slug}: raw angle bracket inside JSON-LD`);

  for (const href of internalHrefs(html)) {
    if (INTERNAL_OK.has(href)) continue;
    if (href.startsWith('/careers/')) {
      if (!index.bySlug.has(href.slice('/careers/'.length))) gp.link.push(`${g.slug} -> ${href}`);
      continue;
    }
    if (href.startsWith('/guides/')) {
      if (!GUIDE_SLUGS.has(href.slice('/guides/'.length))) gp.link.push(`${g.slug} -> ${href}`);
      continue;
    }
    if (href.startsWith('/quiz?')) continue;
    gp.link.push(`${g.slug} -> ${href} (unknown internal target)`);
  }
  for (const m of html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"/g)) {
    const host = new URL(m[1]).hostname;
    if (!EXTERNAL_OK.has(host) && host !== 'flightway.ai') gp.external.push(`${g.slug} -> ${m[1]}`);
  }
}

assert([...gTitles.values()].every((n) => n === 1), `every guide <title> is unique (${[...gTitles.entries()].filter(([, n]) => n > 1).map(([t]) => t).join(' | ')})`);
assert([...gDescs.values()].every((n) => n === 1), 'every guide meta description is unique');
assert(gp.title.length === 0, `guide titles fit a search result and carry the brand (${gp.title.slice(0, 3).join('; ')})`);
assert(gp.desc.length === 0, `guide descriptions are 70-${MAX_META_DESCRIPTION} chars and end in a full stop (${gp.desc.slice(0, 3).join('; ')})`);
assert(gp.canonical.length === 0, `exactly one self-referential canonical, no robots meta (${gp.canonical.slice(0, 3).join('; ')})`);
assert(gp.h1.length === 0, `exactly one <h1> per guide (${gp.h1.join(', ')})`);
assert(gp.og.length === 0, `og:image absolute + twitter summary_large_image (${gp.og.slice(0, 2).join('; ')})`);
assert(gp.ld.length === 0, `Article + FAQPage + BreadcrumbList parse, and the FAQ markup equals the visible Q&A (${gp.ld.slice(0, 3).join('; ')})`);
assert(gp.faq.length === 0, `every FAQ answer is substantial, plain text, and a complete sentence (${gp.faq.slice(0, 3).join('; ')})`);
assert(gp.link.length === 0, `every internal link in a guide resolves (${gp.link.slice(0, 3).join('; ')})`);
assert(gp.external.length === 0, `external links point only at O*NET, BLS or DOL (${gp.external.slice(0, 3).join('; ')})`);
assert(gp.size.length === 0, `every guide is under ${MAX_PAGE_BYTES / 1024}KB (${gp.size.slice(0, 2).join('; ')})`);
assert(gp.thin.length === 0, `every guide carries at least 600 words of real prose (${gp.thin.join('; ')})`);
assert(gp.structure.length === 0, `every guide has 4+ sections, 3-6 FAQ entries, and valid related/career lists (${gp.structure.slice(0, 3).join('; ')})`);
assert(gp.pitch.length === 0, `no guide opens with the product pitch, and none forgets it entirely (${gp.pitch.join('; ')})`);
assert(gp.tag.length === 0, `guide prose uses only <strong>, <em> and <a href> (${gp.tag.slice(0, 3).join('; ')})`);

// The guides share one card; it has to exist at the stamped path.
{
  const ref = (/<meta property="og:image" content="[^"]*\/assets\/og\/([a-z0-9-]+\.png)\?v=/.exec(renderGuidePage(GUIDES[0])) || [])[1];
  assert(!!ref && fs.existsSync(path.join(ROOT, 'assets/og', ref)), `the guides og:image file exists on disk (${ref})`);
}

// inline() is the last line of defence if a guide ever carries something else.
{
  const hostile = inline('ok <script>alert(1)</script> <strong>keep</strong> <a href="/quiz">link</a> <img src=x> 5 < 6 & 7');
  assert(!/<script/.test(hostile), 'inline() escapes a <script> in guide prose');
  assert(!/<img/.test(hostile), 'inline() escapes a tag that is not on the allowlist');
  assert(hostile.includes('<strong>keep</strong>'), 'inline() keeps <strong>');
  assert(hostile.includes('<a href="/quiz">link</a>'), 'inline() keeps an anchor');
  assert(hostile.includes('5 &lt; 6 &amp; 7'), 'inline() escapes a bare < and a bare &');
}

section('Guides hub — /guides');
{
  const hub = renderGuidesIndex();
  const linked = new Set(internalHrefs(hub).filter((h) => h.startsWith('/guides/')).map((h) => h.slice('/guides/'.length)));
  assert(linked.size === GUIDES.length, `the hub links every guide (${linked.size} of ${GUIDES.length})`);
  assert([...linked].every((s) => GUIDE_SLUGS.has(s)), 'no hub link points at a guide that does not exist');
  assert(/<link rel="canonical" href="https:\/\/flightway\.ai\/guides">/.test(hub), 'hub canonical is /guides');
  assert((hub.match(/<h1>/g) || []).length === 1, 'hub has exactly one h1');
  assert(parseLd(hub).length === 2 && parseLd(hub).every((l) => l.obj), 'hub JSON-LD parses (CollectionPage + BreadcrumbList)');
  assert(
    internalHrefs(hub).filter((h) => h.startsWith('/careers/')).every((h) => index.bySlug.has(h.slice('/careers/'.length))),
    'every career the hub links exists',
  );
}

section('Guides routes — executed handlers');
{
  const call = async (slug, opts = {}) => guideRoute(ctx(`${SITE}/guides/${slug}`, { ...opts, params: { slug } }));
  const sampleGuide = GUIDES[0].slug;
  const res = await call(sampleGuide, { env });
  assert(res.status === 200, `GET /guides/${sampleGuide} → 200`);
  assert((res.headers.get('content-type') || '').includes('text/html'), 'a guide is text/html');
  const gcc = res.headers.get('cache-control') || '';
  assert(gcc.includes('s-maxage=86400') && gcc.includes('max-age=0'), `guide cache headers (${gcc})`);
  assert((await call(sampleGuide.toUpperCase(), { env })).status === 200, 'an uppercase guide slug still resolves');
  assert((await call(`${sampleGuide}.html`, { env })).status === 200, 'a .html suffix still resolves');

  const gone = await call('not-a-real-guide-xyz', { env });
  assert(gone.status === 404, 'an unknown guide slug is a real 404');
  const goneBody = await gone.text();
  assert(/name="robots" content="noindex/.test(goneBody), 'the guide 404 is noindex');
  assert(!/rel="canonical"/.test(goneBody), 'the guide 404 carries no canonical');
  assert((gone.headers.get('cache-control') || '').includes('no-store'), 'the guide 404 is not cached');

  const posted = await guideRoute(ctx(`${SITE}/guides/${sampleGuide}`, { method: 'POST', env, params: { slug: sampleGuide } }));
  assert(posted.status === 405, 'POST to a guide is 405');
  const headed = await guideRoute(ctx(`${SITE}/guides/${sampleGuide}`, { method: 'HEAD', env, params: { slug: sampleGuide } }));
  assert(headed.status === 200 && (await headed.text()) === '', 'HEAD on a guide returns headers with no body');

  const hubRes = await guidesIndexRoute(ctx(`${SITE}/guides`, { env }));
  assert(hubRes.status === 200, 'GET /guides → 200');
  assert((await hubRes.text()).includes('<h1>'), 'the hub renders a document');
}

// ---------------------------------------------------------------------------
// llms.txt / llms-full.txt.
//
// What earns an accurate citation from an answer engine is specificity and
// stated limits, not keywords — so the assertions below are mostly about the
// file continuing to contain checkable facts and the "does not do" section,
// plus the ordinary hygiene (absolute canonical URLs, no dead links).

section('llms.txt');
{
  const res = await llmsRoute(ctx(`${SITE}/llms.txt`));
  const body = await res.text();
  assert(res.status === 200, 'GET /llms.txt → 200');
  assert((res.headers.get('content-type') || '').includes('text/plain'), 'llms.txt is text/plain');
  assert(body.startsWith('# FlightWay\n'), 'llms.txt opens with the H1 the convention expects');
  assert(/^> .+/m.test(body), 'llms.txt carries the one-line blockquote summary');
  assert(/## What FlightWay does not do/.test(body), 'llms.txt states what the product does NOT do — the section that keeps a citation honest');
  assert(/mean-centered/.test(body) && /161/.test(body) && new RegExp(ONET_RELEASE).test(body),
    'llms.txt states the actual method (mean-centered, 161 dimensions, the O*NET release)');
  assert(!/\$|price|per month/i.test(body), 'llms.txt quotes no price — S19 re-leads pricing and any number here would go stale');
  assert(body.includes(`${SITE}/sitemap.xml`), 'llms.txt points at the sitemap for the full career list');

  const urls = [...body.matchAll(/\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
  assert(urls.length >= GUIDES.length + 4, `llms.txt links the guides and the key pages (${urls.length} links)`);
  assert(urls.every((u) => u.startsWith(SITE)), 'every llms.txt link is on the canonical host, whatever host served it');
  assert(
    GUIDES.every((g) => body.includes(`${SITE}/guides/${g.slug}`)),
    'every guide is listed in llms.txt',
  );
  const paths = [...new Set(urls.map((u) => u.slice(SITE.length)))];
  const known = new Set([...STATIC_URLS, INDEX_URL, GUIDES_INDEX_URL, ...GUIDE_URLS, '/', '/sitemap.xml']);
  const dead = paths.filter((p) => !known.has(p) && !(p.startsWith('/careers/') && index.bySlug.has(p.slice('/careers/'.length))));
  assert(dead.length === 0, `every llms.txt url resolves to a page that exists (${dead.join(', ')})`);
  assert(body.length < 20 * 1024, `llms.txt is under 20KB (${body.length}B)`);

  assert((await llmsRoute(ctx(`${SITE}/llms.txt`, { method: 'POST' }))).status === 405, 'POST /llms.txt is 405');
  const head = await llmsRoute(ctx(`${SITE}/llms.txt`, { method: 'HEAD' }));
  assert(head.status === 200 && (await head.text()) === '', 'HEAD /llms.txt returns headers with no body');
}

section('llms-full.txt');
{
  const res = await llmsFullRoute(ctx(`${SITE}/llms-full.txt`));
  const body = await res.text();
  assert(res.status === 200, 'GET /llms-full.txt → 200');
  assert((res.headers.get('content-type') || '').includes('text/plain'), 'llms-full.txt is text/plain');
  assert(body.startsWith(buildLlmsTxt().trimEnd()), 'llms-full.txt begins with the whole of llms.txt');
  for (const g of GUIDES) {
    if (!body.includes(`# ${g.title}`)) assert(false, `llms-full.txt contains the guide "${g.title}"`);
    const lastQ = g.faq[g.faq.length - 1].q;
    if (!body.includes(lastQ)) assert(false, `llms-full.txt runs to the END of "${g.slug}" (its last FAQ question is missing)`);
  }
  assert(GUIDES.every((g) => body.includes(g.sections[g.sections.length - 1].h2)), 'every guide\'s final section heading survives into llms-full.txt');
  // Plain text means plain text: markup that leaks through is markup a model
  // has to guess at.
  assert(!/<(strong|em|a |\/a|p |div|script)/i.test(body), 'llms-full.txt carries no HTML tags');
  assert(!/&(amp|lt|gt|quot|#39);/.test(body), 'llms-full.txt carries no HTML entities');
  assert(body.length < 200 * 1024, `llms-full.txt is under 200KB (${Math.round(body.length / 1024)}KB)`);
  assert(!body.includes('/careers/software-developers'), 'llms-full.txt does not try to inline the 780+ career pages');

  assert((await llmsFullRoute(ctx(`${SITE}/llms-full.txt`, { method: 'POST' }))).status === 405, 'POST /llms-full.txt is 405');
}

// ---------------------------------------------------------------------------
// The landing page's structured data (S14). Read off disk rather than rendered,
// because index.html is a static file — but parsed and type-checked the same
// way, and the FAQPage is held to the same visible-text rule as the guides.

section('index.html structured data');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
  assert(blocks.length === 3, `index.html carries three JSON-LD blocks (${blocks.length})`);
  assert(blocks.every(Boolean), 'every index.html JSON-LD block parses');
  const byType = new Map(blocks.filter(Boolean).map((b) => [b['@type'], b]));
  assert(byType.has('Organization'), 'index.html declares an Organization');
  assert(byType.has('WebSite'), 'index.html declares a WebSite');
  assert(byType.has('FAQPage'), 'index.html declares a FAQPage');

  const org = byType.get('Organization') || {};
  assert(org.url === `${SITE}/`, `Organization.url is ${SITE}/ (got ${org.url})`);
  const logoPath = String(org.logo || '').replace(SITE, '').split('?')[0];
  assert(!!logoPath && fs.existsSync(path.join(ROOT, logoPath.replace(/^\//, ''))), `the Organization logo exists on disk (${logoPath})`);
  assert(html.includes(`href="${logoPath}?v=`) || html.includes(`href="${org.logo}"`),
    'the Organization logo carries the same ?v= stamp the page uses for that file');
  const site = byType.get('WebSite') || {};
  assert(site.url === `${SITE}/`, 'WebSite.url is the canonical host');
  assert(!site.potentialAction, 'WebSite declares no SearchAction — there is no site search endpoint to point one at');

  // Same rule as the guides: the marked-up Q&A has to be on the page.
  const faq = byType.get('FAQPage') || {};
  const marked = (faq.mainEntity || []).map((q) => [q.name, q.acceptedAnswer && q.acceptedAnswer.text]);
  const shown = [...html.matchAll(/<article class="fw-faq-item[^"]*">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((m) => [m[1].trim(), m[2].trim()]);
  assert(marked.length >= 5, `the landing FAQ has at least five questions (${marked.length})`);
  assert(shown.length === marked.length, `every marked-up FAQ question is rendered on the page (${shown.length} shown vs ${marked.length} marked)`);
  const drift = marked.filter((pair, i) => !shown[i] || shown[i][0] !== pair[0] || shown[i][1] !== pair[1]);
  assert(drift.length === 0, `the landing FAQPage markup says exactly what the page says (${drift.slice(0, 2).map((d) => d[0]).join('; ')})`);
  assert(/id="faq"/.test(html), 'the landing FAQ section carries an id so it can be linked');
}

// ---------------------------------------------------------------------------

console.log(`\nseo:check — ${passes} assertions, ${fail} failed`);
if (fail) process.exit(1);
console.log(`OK: ${index.count} career pages + ${GUIDES.length} guides + directories + llms.txt + sitemap`);
