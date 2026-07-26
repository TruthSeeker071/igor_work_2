/**
 * GET /careers/:slug — the server-rendered public career page (V2 S13, D4/D20).
 *
 * This is the zero-CAC channel: ~780 real pages Google and the AI answer
 * engines can read without running JavaScript. `career.html` (the app's deep
 * dive) stays exactly where it is and stays `noindex` — it is an empty shell to
 * a crawler, which is why it was never indexable in the first place.
 *
 * Three deliberate properties:
 *
 * - **Aliases 301, they do not render.** Every alternate spelling of a career
 *   (the `SLUG_ALIASES` table, the title form of a career whose canonical is a
 *   legacy hub slug, and the 64-char truncation `career-lookup.js` emits)
 *   redirects to one canonical URL. Serving the same page at three URLs is how
 *   a site splits its own ranking signal.
 *
 * - **The KV cache is the real cache.** `s-maxage` is set because it is correct
 *   for any shared cache in front of this, but Cloudflare does not edge-cache a
 *   Function response by default, so the thing that actually makes this fast is
 *   the KV read. `X-FW-Cache` reports which path served, so `pages:smoke` can
 *   prove the cache works instead of assuming it.
 *
 * - **Purging is a version bump.** `CAREER_PAGE_VERSION` is part of the key, so
 *   changing the template orphans every cached page at once. There is no purge
 *   API call and nothing to remember to run.
 */
import {
  CAREER_PAGE_VERSION,
  CAREER_PAGE_TTL_SECONDS,
  normalizeSlug,
  renderCareerPage,
  renderCareerNotFound,
  careerContent,
} from '../_lib/career-page.js';
import {
  loadCareerIndex, dimensionsFor, neighboursFor, getSalaryTiers,
} from '../_lib/career-catalog.js';
import { logServerError } from '../_lib/events.js';

const HTML = 'text/html; charset=utf-8';
// max-age=0 is explicit: without it a browser may heuristically cache HTML,
// and a stale career page in a student's own browser is the one cache we have
// no way to bust.
const CACHE_CONTROL = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800';

function htmlResponse(body, { status = 200, cache = CACHE_CONTROL, extra = {} } = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': HTML, 'Cache-Control': cache, ...extra },
  });
}

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
    });
  }

  const raw = decodeURIComponent(String((params && params.slug) || '')).trim();
  const slug = raw.toLowerCase().replace(/\.html?$/, '').replace(/\/+$/, '');
  const url = new URL(request.url);
  const baseUrl = url.origin;

  try {
    const index = await loadCareerIndex(env, baseUrl);

    if (!index.bySlug.has(slug)) {
      const target = index.aliasTo.get(normalizeSlug(slug));
      if (target) {
        return new Response(null, {
          status: 301,
          headers: {
            Location: `/careers/${target}`,
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
      return htmlResponse(request.method === 'HEAD' ? null : renderCareerNotFound(slug), {
        status: 404,
        cache: 'no-store',
      });
    }

    const key = `cgpage:${CAREER_PAGE_VERSION}:${slug}`;
    let body = null;
    if (env.COACH_KV) {
      try { body = await env.COACH_KV.get(key, 'text'); } catch { body = null; }
    }

    if (body) {
      return htmlResponse(request.method === 'HEAD' ? null : body, { extra: { 'X-FW-Cache': 'hit' } });
    }

    const row = index.bySlug.get(slug);
    const [dims, salaryTiers] = await Promise.all([
      dimensionsFor(env, baseUrl, row),
      getSalaryTiers(baseUrl),
    ]);
    const { related, sameSector } = await neighboursFor(env, baseUrl, index, row);
    body = renderCareerPage(careerContent({
      row, dims, related, sameSector, salaryTiers, catalogCount: index.count,
    }));

    if (env.COACH_KV && waitUntil) {
      waitUntil(
        env.COACH_KV.put(key, body, { expirationTtl: CAREER_PAGE_TTL_SECONDS })
          .catch((err) => console.warn('career page cache write failed', slug, err && err.message)),
      );
    }

    return htmlResponse(request.method === 'HEAD' ? null : body, { extra: { 'X-FW-Cache': 'miss' } });
  } catch (err) {
    console.error('careers/[slug] error', err);
    if (waitUntil) waitUntil(logServerError(env, '/careers/[slug]', err, { status: 500 }));
    // Never a blank 500 on an indexable route: a crawler that gets an empty
    // body remembers the empty body. Serve the real not-found shell (which is
    // noindex) under a 500 so the status still tells the truth.
    return htmlResponse(renderCareerNotFound(''), { status: 500, cache: 'no-store' });
  }
}
