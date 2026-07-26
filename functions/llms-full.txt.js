/**
 * GET /llms-full.txt  (V2 S14, decision D20).
 *
 * `/llms.txt` plus the complete plain text of every guide, so a model that
 * wants the substance does not have to fetch eight HTML pages and strip the
 * markup off them.
 *
 * It stops at the guides. The 780+ career pages are deliberately NOT
 * concatenated here: they change whenever the catalog does, they would push
 * this file into the megabytes, and they are already enumerated in
 * `/sitemap.xml`, which the text points at. A file too large to be read is
 * worse than a short one that says where to look.
 */
import { buildLlmsFullTxt } from './_lib/llms.js';

const TEXT = 'text/plain; charset=utf-8';

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Content-Type': TEXT, Allow: 'GET, HEAD' },
    });
  }

  const body = buildLlmsFullTxt();
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': TEXT,
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
