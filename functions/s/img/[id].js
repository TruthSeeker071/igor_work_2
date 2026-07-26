// FlightWay V2 S15 — GET /s/img/<id>.png, the share card's Open Graph image.
//
// A separate route from the page because unfurlers fetch the image on its own,
// often from a different IP and with no referer. It resolves the share row
// FIRST (which is where the owner's email lives) and only then reads KV, so the
// KV key can carry the email as a segment — that is what makes the image get
// deleted by the account-purge sweep without a second list to maintain.
//
// A revoked share's image 404s immediately: an image that outlives its page is
// a revocation that did not actually revoke anything.

import { isShareId, shareImageKey } from '../../_lib/share.js';

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { env, params } = context;
  // Pages hands us the whole last segment, extension included.
  const id = String((params && params.id) || '').replace(/\.png$/i, '');
  if (!isShareId(id) || !env || !env.DB || !env.COACH_KV) return notFound();

  let row;
  try {
    row = await env.DB.prepare('SELECT user_id, img_key, revoked_at FROM shares WHERE id = ?')
      .bind(id).first();
  } catch {
    return notFound();
  }
  if (!row || row.revoked_at || !row.img_key) return notFound();

  // Trust the stored key, but never a key that is not the one this row owns.
  if (row.img_key !== shareImageKey(row.user_id, id)) return notFound();

  let bytes;
  try {
    bytes = await env.COACH_KV.get(row.img_key, 'arrayBuffer');
  } catch {
    return notFound();
  }
  if (!bytes) return notFound();

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // The bytes for a given id never change (a new card is a new id), so this
      // is genuinely immutable — but only for as long as the share is live,
      // hence the modest shared TTL rather than a year.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'X-Robots-Tag': 'noindex',
    },
  });
}
