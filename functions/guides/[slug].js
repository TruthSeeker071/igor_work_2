/**
 * GET /guides/<slug> — one guide (V2 S14).
 *
 * Eight known slugs, held as constants. There is no alias table here and there
 * should not be one: the career slugs needed aliases because five different
 * legacy naming schemes already pointed at them, whereas these URLs were minted
 * this session and nothing links at an older form of them. An unknown slug is a
 * real 404 — noindex, no canonical, not cached — for the same reason the career
 * 404 is: a soft-404 farm is a site-wide signal, not a per-page one.
 */
import { GUIDE_BY_SLUG, renderGuidePage, renderGuideNotFound } from '../_lib/guides.js';
import { logServerError } from '../_lib/events.js';

const HTML = 'text/html; charset=utf-8';
const CACHE_CONTROL = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800';

/** Same normalization the career route applies: case is not a different page,
 *  and Pages serves `.html` forms of clean URLs elsewhere on the site. */
function normalize(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\.html?$/, '').replace(/^\/+|\/+$/g, '');
}

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
    });
  }

  const slug = normalize(params && params.slug);

  try {
    const guide = GUIDE_BY_SLUG.get(slug);
    if (!guide) {
      return new Response(request.method === 'HEAD' ? null : renderGuideNotFound(slug), {
        status: 404,
        headers: { 'Content-Type': HTML, 'Cache-Control': 'no-store' },
      });
    }

    const body = renderGuidePage(guide);
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: { 'Content-Type': HTML, 'Cache-Control': CACHE_CONTROL },
    });
  } catch (err) {
    console.error('guide page error', slug, err);
    if (waitUntil) waitUntil(logServerError(env, '/guides/[slug]', err, { status: 500, slug }));
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta name="robots" content="noindex"><title>Temporarily unavailable</title></head>'
      + '<body><p>This guide is temporarily unavailable. <a href="/guides">All guides</a>.</p></body></html>',
      { status: 500, headers: { 'Content-Type': HTML, 'Cache-Control': 'no-store' } },
    );
  }
}
