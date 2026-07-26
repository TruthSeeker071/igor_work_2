/**
 * GET /sitemap.xml — generated, not committed (V2 S13).
 *
 * This REPLACES the static `sitemap.xml`, which listed seven URLs and could not
 * have listed the ~780 career pages without someone regenerating and committing
 * a file every time the catalog changed. A Pages Function shadows a static
 * asset at the same path — S2 proved that when `functions/robots.txt.js` beat
 * the committed `robots.txt` — but the static file is deleted anyway, because
 * two sources of truth for the same URL is exactly the drift this replaces.
 *
 * URLs are always `https://flightway.ai/...` regardless of which host served
 * the request, for the same reason index.html's canonical is hardcoded: the
 * prototype must point at the real site, never at itself. `robots.txt` only
 * advertises the sitemap on the canonical host (functions/robots.txt.js), and
 * `_middleware.js` tags every non-canonical response `noindex`.
 *
 * `lastmod` appears only where it is TRUE. Career pages carry
 * CAREER_CONTENT_DATE, which moves with the render template and the catalog;
 * the static pages carry none, because nothing here knows when index.html was
 * last edited and a fabricated lastmod is worse than an absent one — Google
 * ignores lastmod values it learns not to trust, for the whole site.
 */
import {
  SITE, CAREER_PAGE_VERSION, CAREER_PAGE_TTL_SECONDS, CAREER_CONTENT_DATE,
} from './_lib/career-page.js';
import { GUIDES, GUIDES_CONTENT_DATE } from './_lib/guides.js';
import { loadCareerIndex } from './_lib/career-catalog.js';

/**
 * The indexable static surface. MUST equal the `public` rows of the
 * classification table in scripts/verify-meta.mjs — that gate imports this list
 * and asserts both directions, so a new public page that nobody added here
 * fails the suite instead of quietly never being crawled.
 */
export const STATIC_URLS = [
  '/', '/quiz', '/pricing', '/privacy', '/terms', '/security', '/contact',
  // S19 (D16/D14): the two business-surface doors. `/career-centers` is the B2B
  // pitch Leo and Igor point CUNY at; `/community` is a waitlist page for a
  // forum that does not exist yet and says so in its own h1 — it is listed here
  // because it is a real page with real content, not a doorway.
  '/career-centers', '/community',
];

/** The directory. Listed separately from STATIC_URLS because it is a Function
 *  route, not a root .html, so it has no row in the classification table. */
export const INDEX_URL = '/careers';

/** The guides hub and its pages (S14). Also Function routes, also outside the
 *  classification table, and derived from `_lib/guides.js` rather than typed
 *  out — adding a guide adds its sitemap entry with nothing to remember. */
export const GUIDES_INDEX_URL = '/guides';
export const GUIDE_URLS = GUIDES.map((g) => `/guides/${g.slug}`);

/**
 * A short fingerprint of the non-career URL set, folded into the KV cache key.
 *
 * Derived rather than declared on purpose: a version constant is only correct
 * while somebody remembers to bump it, and the failure is invisible — the
 * sitemap keeps answering 200 with a body that is missing a page nobody will
 * notice for a day. djb2 over the joined list is enough; this is a cache key,
 * not a security boundary.
 */
export function staticSetTag() {
  const src = [...STATIC_URLS, INDEX_URL, GUIDES_INDEX_URL, ...GUIDE_URLS].join('|');
  let h = 5381;
  for (let i = 0; i < src.length; i += 1) h = (((h << 5) + h) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function urlEntry(loc, lastmod) {
  return lastmod
    ? `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`
    : `  <url><loc>${loc}</loc></url>`;
}

export function buildSitemap(slugs) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...STATIC_URLS.map((p) => urlEntry(`${SITE}${p}`)),
    urlEntry(`${SITE}${GUIDES_INDEX_URL}`, GUIDES_CONTENT_DATE),
    ...GUIDE_URLS.map((p) => urlEntry(`${SITE}${p}`, GUIDES_CONTENT_DATE)),
    urlEntry(`${SITE}${INDEX_URL}`, CAREER_CONTENT_DATE),
    ...(slugs || []).map((s) => urlEntry(`${SITE}/careers/${s}`, CAREER_CONTENT_DATE)),
    '</urlset>',
    '',
  ];
  return lines.join('\n');
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
    });
  }

  const baseUrl = new URL(request.url).origin;
  // Three things in the key, not two: the guides can change without the career
  // template moving, and a sitemap that is 24h stale about a brand-new page is
  // exactly the crawl delay this file exists to remove.
  //
  // S19 found the third the hard way. Adding `/career-centers` and `/community`
  // to STATIC_URLS changed neither of the other two, so the deployed sitemap
  // kept serving the previous build's body — the new pages were simply absent
  // from it, silently, for as long as the TTL had left. The documented purge
  // hook was "bump CAREER_PAGE_VERSION", which would throw away ~780 cached
  // career renders to publish two <loc> lines. `staticSetTag()` is derived
  // instead of declared, so adding, removing or renaming a static page purges
  // this cache and nothing else, with no constant anyone has to remember.
  const key = `cgsitemap:${CAREER_PAGE_VERSION}:${GUIDES_CONTENT_DATE}:${staticSetTag()}`;
  let body = null;

  if (env.COACH_KV) {
    try { body = await env.COACH_KV.get(key, 'text'); } catch { body = null; }
  }

  if (!body) {
    try {
      const index = await loadCareerIndex(env, baseUrl);
      body = buildSitemap([...index.bySlug.keys()].sort());
      if (env.COACH_KV && waitUntil) {
        waitUntil(
          env.COACH_KV.put(key, body, { expirationTtl: CAREER_PAGE_TTL_SECONDS })
            .catch((err) => console.warn('sitemap cache write failed', err && err.message)),
        );
      }
    } catch (err) {
      // Degrade, never 500. A sitemap missing the career pages costs a crawl
      // cycle; a 500 at this URL is a Search Console error on the whole site.
      console.warn('sitemap: catalog unavailable, serving static pages only', err && err.message);
      body = buildSitemap([]);
    }
  }

  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
