/**
 * GET /careers — the sector-grouped public directory (V2 S13).
 *
 * Server-rendered in full: every career slug is a real `<a href>` in the HTML,
 * because the entire point of this page is that a crawler with no JavaScript
 * can walk from here to all ~780 career pages. The search box is a progressive
 * enhancement layered on top and hides nothing until someone types.
 *
 * Shares the KV cache and the version-bump purge hook with `[slug].js`.
 */
import {
  CAREER_PAGE_VERSION, CAREER_PAGE_TTL_SECONDS, renderCareersIndex,
} from '../_lib/career-page.js';
import { loadCareerIndex } from '../_lib/career-catalog.js';
import { logServerError } from '../_lib/events.js';

const HTML = 'text/html; charset=utf-8';
const CACHE_CONTROL = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800';

export async function onRequest(context) {
  const { request, env, waitUntil } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
    });
  }

  const baseUrl = new URL(request.url).origin;
  const key = `cgindex:${CAREER_PAGE_VERSION}`;

  try {
    let body = null;
    let cache = 'miss';
    if (env.COACH_KV) {
      try { body = await env.COACH_KV.get(key, 'text'); } catch { body = null; }
    }
    if (body) {
      cache = 'hit';
    } else {
      const index = await loadCareerIndex(env, baseUrl);
      body = renderCareersIndex({ sectors: index.sectors, count: index.count });
      if (env.COACH_KV && waitUntil) {
        waitUntil(
          env.COACH_KV.put(key, body, { expirationTtl: CAREER_PAGE_TTL_SECONDS })
            .catch((err) => console.warn('careers index cache write failed', err && err.message)),
        );
      }
    }

    return new Response(request.method === 'HEAD' ? null : body, {
      headers: { 'Content-Type': HTML, 'Cache-Control': CACHE_CONTROL, 'X-FW-Cache': cache },
    });
  } catch (err) {
    console.error('careers index error', err);
    if (waitUntil) waitUntil(logServerError(env, '/careers', err, { status: 500 }));
    return new Response('Career directory is temporarily unavailable.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
