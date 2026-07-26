/**
 * GET /llms.txt  (V2 S14, decision D20).
 *
 * Served by a Function rather than committed as a static file for the same
 * reason `sitemap.xml` is: the guide list is generated from `_lib/guides.js`,
 * so adding a guide updates this file with no second place to remember. A
 * static copy would be the drift.
 *
 * Every URL is `https://flightway.ai/...` whatever host answered, matching
 * `sitemap.xml` and index.html's hardcoded canonical — the prototype must point
 * at the real site, never at itself. Non-canonical hosts still carry
 * `X-Robots-Tag: noindex` from `_middleware.js` and a `Disallow: /` robots.txt.
 *
 * `text/plain`, not `text/markdown`: the file IS markdown, but text/plain is
 * what every reference implementation serves and it renders in a browser
 * instead of prompting a download.
 */
import { buildLlmsTxt } from './_lib/llms.js';

const TEXT = 'text/plain; charset=utf-8';

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Content-Type': TEXT, Allow: 'GET, HEAD' },
    });
  }

  const body = buildLlmsTxt();
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': TEXT,
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
