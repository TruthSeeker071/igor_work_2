/**
 * GET /guides — the guides hub (V2 S14).
 *
 * No KV cache, deliberately, unlike `functions/careers/index.js`. That page
 * caches because building it means loading the catalog artifact and grouping
 * 782 rows; this one is string concatenation over a constant in
 * `_lib/guides.js`. A KV round trip would cost more than the work it skips, and
 * it would add a cache-coherence problem (a stale hub after a content edit) to
 * a page that cannot otherwise have one. The edge cache still holds it.
 */
import { renderGuidesIndex } from '../_lib/guides.js';
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

  try {
    const body = renderGuidesIndex();
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: { 'Content-Type': HTML, 'Cache-Control': CACHE_CONTROL },
    });
  } catch (err) {
    console.error('guides index error', err);
    if (waitUntil) waitUntil(logServerError(env, '/guides', err, { status: 500 }));
    return new Response('The guides are temporarily unavailable.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
