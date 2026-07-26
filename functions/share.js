// FlightWay V2 S15 — the share-link API (plan §5 S15).
//
//   POST   /share         create a public link for a card the user just previewed
//   GET    /share         the signed-in user's live links (account revoke list)
//   DELETE /share?id=…    revoke one
//
// Session-gated on every verb. A share page is unauthenticated once it exists,
// so creating one is the consent moment and it never happens implicitly — see
// the rule at the top of _lib/share.js.
//
// Everything degrades to an explicit "not switched on yet" when migration 0023
// has not been applied: the client's download/native-share path is pure canvas
// and keeps working regardless, which is the half that needs no server at all.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey } from './_lib/auth.js';
import {
  MAX_SHARES_PER_USER, decodePngBase64, generateShareId, isShareId,
  resolveCareerTitles, sanitizeShareRequest, shareImageKey, shareImageUrl, shareUrl,
} from './_lib/share.js';
import { ensureReferralCode } from './_lib/referral.js';

const NOT_READY = 'Share links are not switched on for this deployment yet.';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

function siteOrigin(request) {
  return new URL(request.url).origin;
}

/** Shape one row for the client. Never leaks the KV key or the owner's email. */
function publicRow(row, origin) {
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* corrupt row reads empty */ }
  return {
    id: row.id,
    url: shareUrl(origin, row.id),
    imageUrl: row.img_key ? shareImageUrl(origin, row.id) : '',
    careers: ((payload && payload.careers) || []).map((c) => c.title).filter(Boolean),
    views: Number(row.views || 0),
    createdAt: row.created_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Sign in to manage your share links.' }, origin);

  try {
    const res = await env.DB.prepare(
      'SELECT id, payload, img_key, views, created_at FROM shares WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT ?',
    ).bind(email, MAX_SHARES_PER_USER + 5).all();
    return jsonResponse(200, {
      enabled: true,
      max: MAX_SHARES_PER_USER,
      shares: ((res && res.results) || []).map((r) => publicRow(r, siteOrigin(request))),
    }, origin);
  } catch {
    return jsonResponse(200, { enabled: false, max: MAX_SHARES_PER_USER, shares: [], note: NOT_READY }, origin);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Sign in to create a share link.' }, origin);

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }

  try {
    await checkRateLimit(env, `share:${await hashedIpKey(env, request)}`, { max: 20 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  const parsed = sanitizeShareRequest(body);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error }, origin);

  // Titles come from the catalog, never from the request (_lib/share.js header).
  const titles = await resolveCareerTitles(env, parsed.payload.careers.map((c) => c.soc));
  const careers = parsed.payload.careers
    .map((c) => ({ ...c, title: titles.get(c.soc) || '' }))
    .filter((c) => c.title);
  if (!careers.length) {
    return jsonResponse(400, { error: 'We could not match those careers to the catalog.' }, origin);
  }

  let bytes = null;
  if (body && body.png) {
    const img = decodePngBase64(body.png);
    if (!img.ok) return jsonResponse(400, { error: img.error }, origin);
    bytes = img.bytes;
  }

  const id = generateShareId();
  const nowIso = new Date().toISOString();
  const payload = JSON.stringify({ firstName: parsed.payload.firstName, careers, createdAt: nowIso });
  const imgKey = bytes ? shareImageKey(email, id) : null;

  try {
    const live = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM shares WHERE user_id = ? AND revoked_at IS NULL',
    ).bind(email).first();
    if (Number((live && live.n) || 0) >= MAX_SHARES_PER_USER) {
      return jsonResponse(409, {
        error: `You have ${MAX_SHARES_PER_USER} live share links. Turn one off to make a new one.`,
      }, origin);
    }
    // The image goes in FIRST. A row whose img_key points at nothing renders a
    // broken card; a KV blob with no row is invisible and ages out with the
    // account purge sweep.
    if (bytes && env.COACH_KV) await env.COACH_KV.put(imgKey, bytes);
    await env.DB.prepare(
      'INSERT INTO shares (id, user_id, payload, img_key, views, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind(id, email, payload, bytes && env.COACH_KV ? imgKey : null, nowIso).run();
  } catch (err) {
    console.error('share create failed', err && err.message);
    return jsonResponse(503, { error: NOT_READY }, origin);
  }

  // Minting the referral code here (rather than only on /referral) means the
  // share page's CTA is a real referral link from the very first share.
  const code = await ensureReferralCode(env, email);
  const site = siteOrigin(request);
  return jsonResponse(200, {
    id,
    url: shareUrl(site, id),
    imageUrl: bytes ? shareImageUrl(site, id) : '',
    referralCode: code,
  }, origin);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Sign in to manage your share links.' }, origin);

  const id = String(new URL(request.url).searchParams.get('id') || '');
  if (!isShareId(id)) return jsonResponse(400, { error: 'Unknown share link.' }, origin);

  try {
    // Scoped to the owner: the id alone is a capability on the PUBLIC page, and
    // it must not also be one on the revoke path.
    const res = await env.DB.prepare(
      'UPDATE shares SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    ).bind(new Date().toISOString(), id, email).run();
    if (!res || !res.meta || res.meta.changes !== 1) {
      return jsonResponse(404, { error: 'That link is already off.' }, origin);
    }
    if (env.COACH_KV) {
      try { await env.COACH_KV.delete(shareImageKey(email, id)); } catch { /* best effort */ }
    }
    return jsonResponse(200, { ok: true, revoked: id }, origin);
  } catch (err) {
    console.error('share revoke failed', err && err.message);
    return jsonResponse(503, { error: NOT_READY }, origin);
  }
}
