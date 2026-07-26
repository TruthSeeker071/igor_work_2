#!/usr/bin/env node
// Asserts portal/career/roadmap boot with zero pageerrors. Catches the class
// of bug scripts/smoke-hub-load.mjs already catches for dashboard.html (a
// runtime throw during boot that no watchdog/error-UI surfaces) — see
// docs/CONVERSATION_HANDOFF.md "Hub boot hotfix" for the incident this exists
// to prevent recurring on other pages.
//
// S2 adds a second half that does NOT need a browser: the trust surface is all
// HTTP semantics — a status code, a header, a redirect — and none of it is
// visible to a pageerror check. Kept in this gate rather than a new one because
// it is the same question ("is what we deployed actually what we meant?") asked
// of the same deployment.
//
// NOTE the asymmetry that bit S1: `/assets/x.js?v=<new>` returns 200 whether or
// not the new build landed, because the stamp is a cache-buster, not a route.
// Only a FUNCTION response proves a deploy. Every header assertion below reads
// one.
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE_URL || 'https://flightwayjacobprototype.pages.dev';
const CANONICAL = /^https:\/\/(www\.)?flightway\.ai/i.test(BASE);
const PAGES = [
  // S7: flightplan.html is a nav tab now — a boot error there is a dead primary
  // destination, which is exactly what this gate exists to catch.
  '/portal.html', '/flightplan.html', '/applications.html', '/career.html?slug=chief-executives', '/roadmap.html', '/simulation.html',
  '/pricing.html', '/resume.html', '/coach.html', '/admin.html',
  // S2: the new document pages boot with their own inline script (contact) or
  // none at all (the legal three) — cheap to walk, and a broken one is invisible
  // otherwise because nobody on the team opens them.
  '/privacy', '/terms', '/security', '/contact',
];

let failed = false;
const bad = (msg) => { failed = true; console.error('FAIL', msg); };

// ---------------------------------------------------------------------------
// Browser half: no uncaught exception during boot.

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  for (const path of PAGES) {
    const errors = [];
    page.removeAllListeners('pageerror');
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(3000);
    if (errors.length) bad(`${path} - ${errors.join('; ')}`);
    else console.log('OK', path);
  }
} finally {
  await browser.close();
}

// ---------------------------------------------------------------------------
// HTTP half: the S2 lockdown, asserted against the deployment itself.

console.log(`\nhttp checks against ${BASE}${CANONICAL ? ' (canonical host)' : ' (non-canonical host)'}:`);

const head = async (p, opts = {}) => fetch(BASE + p, { redirect: 'manual', ...opts });

// 1. The legal surface answers at its clean URL.
for (const p of ['/privacy', '/terms', '/security', '/contact']) {
  const r = await head(p);
  if (r.status === 200) console.log('OK ', `${p} 200`);
  else bad(`${p} returned ${r.status}, expected 200`);
}

// 2. robots.txt is served by the Function and says the right thing for THIS
//    host. This is also the check that proves the Function shadows a static
//    asset at the same path — the one behaviour that could not be verified
//    offline (docs/V2_PROGRESS.md S2).
{
  const r = await head('/robots.txt');
  const body = await r.text();
  if (r.status !== 200) bad(`/robots.txt returned ${r.status}`);
  else if (CANONICAL) {
    if (/^User-agent: \*\nAllow: \//m.test(body) && body.includes('Sitemap:')) console.log('OK ', '/robots.txt allows crawling and points at the sitemap');
    else bad(`/robots.txt on the canonical host should allow crawling — got:\n${body.slice(0, 200)}`);
  } else if (/^Disallow: \/$/m.test(body) && !/^Allow: \//m.test(body)) {
    console.log('OK ', '/robots.txt is Disallow-all on this non-canonical host');
  } else {
    bad(`/robots.txt on a non-canonical host must be Disallow-all — got:\n${body.slice(0, 200)}`);
  }
}

// 3. X-Robots-Tag. The header is what stops an externally-linked prototype page
//    being indexed even though robots.txt told the crawler not to fetch it.
{
  const r = await head('/');
  const tag = r.headers.get('x-robots-tag') || '';
  if (CANONICAL) {
    if (!tag) console.log('OK ', 'the canonical host is served untagged');
    else bad(`flightway.ai must NOT carry X-Robots-Tag (got "${tag}")`);
  } else if (/noindex/i.test(tag)) {
    console.log('OK ', `X-Robots-Tag: ${tag}`);
  } else {
    bad(`this host must carry X-Robots-Tag: noindex (got "${tag || 'none'}")`);
  }
}

// 4. Repo files that used to be public. `.dev.vars.example` served 200 on live
//    flightway.ai until this session.
for (const p of ['/.dev.vars.example', '/.cursor/rules/jacob-work-prototype.mdc', '/wrangler.toml', '/CLAUDE.md']) {
  const r = await head(p);
  if (r.status === 200) bad(`${p} is still publicly served (${r.status})`);
  else console.log('OK ', `${p} blocked (${r.status})`);
}

// 5. /config carries the S2 field, which is how we know the FUNCTIONS bundle
//    (not just the static assets) is the new one.
{
  const r = await fetch(`${BASE}/config`);
  const cfg = r.ok ? await r.json() : null;
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'turnstileSiteKey')) console.log('OK ', '/config serves turnstileSiteKey — the functions bundle is current');
  else bad('/config has no turnstileSiteKey — the deployed functions bundle predates S2');
}

// 6. S9's Deadline Radar route exists and is auth-gated. 401 is the PASS here:
//    it proves the Function is routed (a missing route answers 404/405) without
//    writing anything, which is why this is a signed-out probe and not a read.
{
  const r = await fetch(`${BASE}/deadlines`, { redirect: 'follow' });
  if (r.status === 401) console.log('OK ', '/deadlines routed and auth-gated (401 signed out)');
  else bad(`/deadlines returned ${r.status}, expected 401 — the deployed functions bundle predates S9`);
}

// 7. S11's Month in Review — the same shape of probe, for the same reason.
//    401 proves the route exists; the page behind it is a signed-in shell.
{
  const r = await fetch(`${BASE}/month-review`, { redirect: 'follow' });
  if (r.status === 401) console.log('OK ', '/month-review routed and auth-gated (401 signed out)');
  else bad(`/month-review returned ${r.status}, expected 401 — the deployed functions bundle predates S11`);
}
{
  const r = await fetch(`${BASE}/review`, { redirect: 'follow' });
  if (r.ok) console.log('OK ', '/review serves the Month in Review shell at its clean URL');
  else bad(`/review returned ${r.status} — the review page is not deployed`);
}

// 8. S12's Application Tracker. The endpoint is `/tracker`, NOT `/applications`
//    — a Function at that path would shadow applications.html (S2's finding,
//    S11's trap). 401 proves the route is live without writing a row into the
//    shared production D1; the second probe proves the PAGE still wins its own
//    clean URL, which is the half a rename can silently break.
{
  const r = await fetch(`${BASE}/tracker`, { redirect: 'follow' });
  if (r.status === 401) console.log('OK ', '/tracker routed and auth-gated (401 signed out)');
  else bad(`/tracker returned ${r.status}, expected 401 — the deployed functions bundle predates S12`);
}
{
  const r = await fetch(`${BASE}/applications`, { redirect: 'follow' });
  const type = r.headers.get('content-type') || '';
  if (r.ok && /text\/html/i.test(type)) console.log('OK ', '/applications serves the tracker PAGE, not a Function');
  else if (r.status === 404) bad('/applications 404s — applications.html is not deployed yet');
  else bad(`/applications returned ${r.status} ${type} — a Function is shadowing applications.html`);
}

// 9. S13's server-rendered public career pages. `/sitemap.xml` is also the
//    proof that the Function shadows the (now deleted) static sitemap file —
//    the same shadowing question S2 asked of robots.txt (#2 above).
{
  const r = await fetch(`${BASE}/careers`);
  const type = r.headers.get('content-type') || '';
  const body = await r.text();
  const hrefCount = (body.match(/href="\/careers\//g) || []).length;
  if (r.status === 200 && /text\/html/i.test(type) && body.includes('og:site_name') && hrefCount >= 100) {
    console.log('OK ', `/careers 200, text/html, ${hrefCount} career links`);
  } else {
    bad(`/careers returned ${r.status} ${type}, og:site_name=${body.includes('og:site_name')}, ${hrefCount} career links — expected 200/html/og:site_name/>=100 links`);
  }
}
{
  const r = await fetch(`${BASE}/careers/software-engineer`);
  const type = r.headers.get('content-type') || '';
  const body = await r.text();
  const hasCanonical = body.includes('<link rel="canonical" href="https://flightway.ai/careers/software-engineer">');
  const hasOccupation = body.includes('"@type":"Occupation"');
  if (r.status === 200 && /text\/html/i.test(type) && hasCanonical && hasOccupation) {
    console.log('OK ', '/careers/software-engineer 200, canonical + Occupation JSON-LD present');
  } else {
    bad(`/careers/software-engineer returned ${r.status} ${type}, canonical=${hasCanonical}, Occupation=${hasOccupation}`);
  }
  const cache = r.headers.get('x-fw-cache');
  if (cache === 'hit' || cache === 'miss') console.log('OK ', `/careers/software-engineer X-FW-Cache: ${cache}`);
  else bad(`/careers/software-engineer X-FW-Cache header missing or unexpected: "${cache}"`);
}
{
  // A known legacy alias must 301 to its canonical, not render — head() above
  // already sends redirect:'manual', so it is reused rather than a second
  // fetch helper.
  const r = await head('/careers/software-developers');
  const loc = r.headers.get('location') || '';
  if (r.status === 301 && loc === '/careers/software-engineer') {
    console.log('OK ', '/careers/software-developers 301 -> /careers/software-engineer');
  } else {
    bad(`/careers/software-developers returned ${r.status} location="${loc}", expected 301 -> /careers/software-engineer`);
  }
}
{
  const r = await fetch(`${BASE}/careers/definitely-not-a-real-career-xyz`);
  const body = await r.text();
  if (r.status === 404 && /noindex/i.test(body)) console.log('OK ', '/careers/definitely-not-a-real-career-xyz 404, noindex');
  else bad(`/careers/definitely-not-a-real-career-xyz returned ${r.status}, noindex present=${/noindex/i.test(body)}`);
}
{
  const r = await fetch(`${BASE}/sitemap.xml`);
  const type = r.headers.get('content-type') || '';
  const body = await r.text();
  const locCount = (body.match(/<loc>/g) || []).length;
  const hasCareerLoc = body.includes('<loc>https://flightway.ai/careers/software-engineer</loc>');
  if (r.status === 200 && /xml/i.test(type) && hasCareerLoc && locCount > 700) {
    console.log('OK ', `/sitemap.xml 200, xml, ${locCount} <loc> entries — Function shadows the deleted static file`);
  } else {
    bad(`/sitemap.xml returned ${r.status} ${type}, career loc present=${hasCareerLoc}, ${locCount} <loc> entries — expected 200/xml/>700 entries`);
  }
}

// 10. S14's guides hub and the two llms files. All four are Pages Functions at
//     paths with a dot or a bracket in them, which is exactly the routing that
//     no offline test can prove — `functions/llms.txt.js` answering at
//     `/llms.txt` is a claim about how Pages derives routes, not about our code.
{
  const r = await fetch(`${BASE}/guides`);
  const type = r.headers.get('content-type') || '';
  const body = await r.text();
  const links = (body.match(/href="\/guides\//g) || []).length;
  if (r.status === 200 && /text\/html/i.test(type) && links >= 6) {
    console.log('OK ', `/guides 200, text/html, ${links} guide links`);
  } else {
    bad(`/guides returned ${r.status} ${type}, ${links} guide links — expected 200/html/>=6 links`);
  }
}
{
  const r = await fetch(`${BASE}/guides/career-quiz`);
  const body = await r.text();
  const hasCanonical = body.includes('<link rel="canonical" href="https://flightway.ai/guides/career-quiz">');
  const hasFaq = /"@type":\s*"FAQPage"/.test(body);
  const hasArticle = /"@type":\s*"Article"/.test(body);
  if (r.status === 200 && hasCanonical && hasFaq && hasArticle) {
    console.log('OK ', '/guides/career-quiz 200, canonical + Article + FAQPage JSON-LD present');
  } else {
    bad(`/guides/career-quiz returned ${r.status}, canonical=${hasCanonical}, Article=${hasArticle}, FAQPage=${hasFaq}`);
  }
}
{
  const r = await fetch(`${BASE}/guides/not-a-real-guide-xyz`);
  const body = await r.text();
  if (r.status === 404 && /noindex/i.test(body)) console.log('OK ', '/guides/not-a-real-guide-xyz 404, noindex');
  else bad(`/guides/not-a-real-guide-xyz returned ${r.status}, noindex present=${/noindex/i.test(body)}`);
}
{
  const r = await fetch(`${BASE}/llms.txt`);
  const type = r.headers.get('content-type') || '';
  const body = await r.text();
  const ok = r.status === 200 && /text\/plain/i.test(type)
    && body.startsWith('# FlightWay') && body.includes('https://flightway.ai/guides/career-quiz');
  if (ok) console.log('OK ', `/llms.txt 200, text/plain, ${body.length}B, guides listed`);
  else bad(`/llms.txt returned ${r.status} ${type}, ${body.length}B — expected 200/text-plain starting "# FlightWay" and listing the guides`);
}
{
  const r = await fetch(`${BASE}/llms-full.txt`);
  const type = r.headers.get('content-type') || '';
  const body = await r.text();
  // The last guide's final FAQ question proves the file was not truncated.
  const ok = r.status === 200 && /text\/plain/i.test(type)
    && body.startsWith('# FlightWay') && body.includes('## Questions people ask') && body.length > 20000;
  if (ok) console.log('OK ', `/llms-full.txt 200, text/plain, ${Math.round(body.length / 1024)}KB, full guide text present`);
  else bad(`/llms-full.txt returned ${r.status} ${type}, ${body.length}B — expected 200/text-plain with the full guide text`);
}

if (failed) process.exit(1);
console.log('\npages:smoke PASS');
