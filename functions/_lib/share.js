// FlightWay V2 S15 — the shareable career map (plan §5 S15, D4/D14).
//
// A share is a SNAPSHOT the user previewed and deliberately published, not a
// live window into their account. That single rule explains most of this file:
//
//   · Nothing here is ever written by a background path. The only writer is
//     POST /share, behind a session, after the user has looked at the card.
//   · The stored payload is what gets rendered forever after. Re-deriving it
//     from live data at view time would mean a link someone pasted in January
//     silently changes what it says about them in March.
//   · The client sends SOC codes, never career titles. Titles are resolved from
//     the catalog server-side, so a public page on flightway.ai can never be
//     made to say arbitrary text — the only free text a user controls is their
//     own first name, and that is character-classed and length-capped.
//   · The id is the capability (the page is unauthenticated — that is the
//     point), so it is 22 base62 characters of crypto randomness, not a
//     sequence and not a hash of anything.

import { ONET_DIMENSIONS, SITE, shell } from './career-page.js';

export const SHARE_ID_LEN = 22;
/** A ceiling on KV, not a product limit: ten live links is more than anyone needs. */
export const MAX_SHARES_PER_USER = 10;
export const MAX_PNG_BYTES = 300 * 1024;
export const MAX_FIRST_NAME = 24;
export const MAX_CARDS = 3;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * The tier vocabulary, server-side. The client sends a KEY from this set and
 * nothing else — the human label is chosen here, so a crafted request cannot
 * put its own wording on a FlightWay-branded public page. Mirrors
 * `qzTierFor()` in assets/js/quiz/quiz-app.js, which reads its thresholds from
 * FWOnetMath.FIT_TIERS (the fit math itself is untouched by S15).
 */
export const TIER_LABELS = {
  LEGENDARY: 'Legendary fit',
  EPIC: 'Epic match',
  GREAT: 'Great match',
  SOLID: 'Solid match',
  EARLY: 'Early match',
};

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function generateShareId(len = SHARE_ID_LEN) {
  const buf = new Uint8Array(len * 2);
  crypto.getRandomValues(buf);
  const out = [];
  const n = ID_ALPHABET.length;
  const limit = 256 - (256 % n);
  for (const b of buf) {
    if (out.length >= len) break;
    if (b >= limit) continue;
    out.push(ID_ALPHABET[b % n]);
  }
  while (out.length < len) out.push(ID_ALPHABET[0]);
  return out.join('');
}

/** Ids come off a URL segment, so validate the shape before touching D1. */
export function isShareId(raw) {
  const s = String(raw == null ? '' : raw);
  return s.length === SHARE_ID_LEN && /^[A-Za-z0-9]+$/.test(s);
}

/**
 * KV key for a share's PNG.
 *
 * The owner's email is a colon-delimited SEGMENT on purpose: functions/account.js
 * purges KV by sweeping for exactly that, so a deleted account takes its share
 * images with it without a second list anyone has to remember to update. The
 * email never leaves the server — /s/img/<id>.png resolves the row first.
 */
export function shareImageKey(email, id) {
  return `shareimg:${email}:${id}`;
}

/** A first name, or ''. Letters, marks, spaces, hyphens and apostrophes only. */
export function sanitizeFirstName(raw) {
  const s = String(raw == null ? '' : raw).trim().split(/\s+/)[0] || '';
  const clean = s.replace(/[^\p{L}\p{M}'’-]/gu, '').slice(0, MAX_FIRST_NAME);
  return clean.length >= 2 ? clean : '';
}

/**
 * Validate the client's card request. PURE — no I/O — so scripts/test-referral.mjs
 * can drive it with hostile input. SOC codes are shape-checked here and RESOLVED
 * to titles by the caller (resolveCareerTitles); this function never trusts a
 * title it was handed.
 */
export function sanitizeShareRequest(raw) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const cards = Array.isArray(body.careers) ? body.careers : [];
  const out = [];
  const seen = new Set();
  for (const c of cards) {
    if (out.length >= MAX_CARDS) break;
    if (!c || typeof c !== 'object') continue;
    const soc = String(c.soc || '').trim().toUpperCase();
    if (!/^\d{2}-\d{4}\.\d{2}$/.test(soc)) continue;
    if (seen.has(soc)) continue;
    const score = Math.round(Number(c.score));
    if (!Number.isFinite(score) || score < 0 || score > 100) continue;
    const tier = String(c.tier || '').trim().toUpperCase();
    if (!TIER_LABELS[tier]) continue;
    seen.add(soc);
    out.push({ soc, score, tier });
  }
  if (!out.length) return { ok: false, error: 'A share card needs at least one career match.' };
  return { ok: true, payload: { firstName: sanitizeFirstName(body.firstName), careers: out } };
}

/**
 * Titles from the catalog, keyed by SOC. Both tables, because a student's top
 * match can be an AI-derived career (those have no public /careers page — S13 —
 * but they are real matches and refusing to let someone share one would be
 * arbitrary).
 */
export async function resolveCareerTitles(env, socs) {
  const list = [...new Set((socs || []).filter(Boolean))];
  if (!list.length || !env || !env.DB) return new Map();
  const marks = list.map(() => '?').join(',');
  const out = new Map();
  try {
    const res = await env.DB.prepare(
      `SELECT soc, title FROM onet_careers WHERE soc IN (${marks})`,
    ).bind(...list).all();
    for (const r of (res && res.results) || []) out.set(String(r.soc), String(r.title));
  } catch (err) {
    console.warn('share: onet title lookup failed', err && err.message);
  }
  const missing = list.filter((s) => !out.has(s));
  if (missing.length) {
    try {
      const res = await env.DB.prepare(
        `SELECT soc, title FROM derived_careers WHERE soc IN (${missing.map(() => '?').join(',')})`,
      ).bind(...missing).all();
      for (const r of (res && res.results) || []) out.set(String(r.soc), String(r.title));
    } catch { /* derived table is optional on old schemas */ }
  }
  return out;
}

/** Decode a data: URL or bare base64 PNG. Returns { ok, bytes } — never throws. */
export function decodePngBase64(raw) {
  const s = String(raw == null ? '' : raw);
  const b64 = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  if (!b64) return { ok: false, error: 'No image was sent.' };
  // 4 base64 chars per 3 bytes — reject oversize before allocating anything.
  if (b64.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 + 8) {
    return { ok: false, error: 'That image is too large to share.' };
  }
  let bin;
  try { bin = atob(b64); } catch { return { ok: false, error: 'That image could not be read.' }; }
  if (bin.length > MAX_PNG_BYTES) return { ok: false, error: 'That image is too large to share.' };
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  // PNG magic. A share image is produced by our own canvas; anything else is
  // someone using the endpoint as free file hosting on our domain.
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || magic.some((b, i) => bytes[i] !== b)) {
    return { ok: false, error: 'Only PNG cards can be shared.' };
  }
  return { ok: true, bytes };
}

export function shareUrl(base, id) {
  return `${String(base || SITE).replace(/\/+$/, '')}/s/${id}`;
}

export function shareImageUrl(base, id) {
  return `${String(base || SITE).replace(/\/+$/, '')}/s/img/${id}.png`;
}

// ------------------------------------------------------------- the OG page

const SHARE_CSS = `
.share-wrap{max-width:820px;margin:0 auto;padding:56px 20px 80px}
.share-eyebrow{font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--fw-ink-dim,#8a93ac);margin:0 0 10px}
.share-card-img{display:block;width:100%;height:auto;border-radius:16px;border:1px solid var(--fw-line,#26365f);margin:0 0 28px}
.share-list{list-style:none;padding:0;margin:0 0 32px;display:grid;gap:10px}
.share-row{display:flex;align-items:baseline;gap:12px;padding:14px 16px;border:1px solid var(--fw-line,#26365f);border-radius:12px}
.share-rank{font-weight:700;opacity:.6;min-width:1.4em}
.share-name{font-weight:600;flex:1}
.share-tier{font-size:.85rem;color:var(--fw-ink-dim,#8a93ac)}
.share-fit{font-variant-numeric:tabular-nums;font-weight:700}
.share-cta{display:inline-block;padding:14px 22px;border-radius:999px;font-weight:600;text-decoration:none}
.share-note{font-size:.85rem;color:var(--fw-ink-dim,#8a93ac);margin:20px 0 0}
`;

/**
 * The public page. `noindex` is deliberate and not negotiable: these are
 * user-generated pages on the marketing domain. Open Graph previews still work
 * (link unfurlers are not search indexers), which is the entire job.
 */
export function sharePageHtml({ id, payload, origin, ctaUrl }) {
  const cards = (payload && payload.careers) || [];
  const first = cards[0] || {};
  const name = (payload && payload.firstName) || '';
  const heading = name ? `${name}’s career map` : 'A career map from FlightWay';
  const title = cards.length
    ? `${heading} — ${first.title}`
    : heading;
  const description = cards.length
    ? `Top match: ${first.title} (${first.score}% fit). See yours in about 90 seconds — FlightWay explains every match instead of just naming one.`
    : 'FlightWay explains every career match instead of just naming one. See yours in about 90 seconds.';

  const rows = cards.map((c, i) => `<li class="share-row">
      <span class="share-rank">#${i + 1}</span>
      <span class="share-name">${esc(c.title)}</span>
      <span class="share-tier">${esc(TIER_LABELS[c.tier] || '')}</span>
      <span class="share-fit">${c.score}%</span>
    </li>`).join('\n');

  const main = `<main class="share-wrap">
  <p class="share-eyebrow">Shared from FlightWay</p>
  <h1>${esc(heading)}</h1>
  <img class="share-card-img" src="${esc(shareImageUrl(origin, id))}" width="1200" height="630"
       alt="${esc(heading)} — top career matches from FlightWay" loading="eager">
  <ul class="share-list">
${rows}
  </ul>
  <a class="share-cta cg-btn" href="${esc(ctaUrl)}">Find your own path — take the quiz</a>
  <p class="share-note">FlightWay scores ${ONET_DIMENSIONS} O*NET dimensions against how you actually work, then shows you the factor-by-factor reason for every match. Free to try.</p>
</main>`;

  return shell({
    title: title.length > 70 ? `${heading} — FlightWay` : title,
    description,
    canonicalPath: `/s/${id}`,
    ogImage: shareImageUrl(origin, id),
    noindex: true,
    css: SHARE_CSS,
    main,
  });
}

/** What a revoked or unknown link answers. Same 404 for both — a live-but-revoked
 *  id must not be distinguishable from one that never existed. */
export function shareMissingHtml() {
  return shell({
    title: 'This share link is no longer available — FlightWay',
    description: 'This FlightWay share link has been turned off by the person who made it.',
    canonicalPath: '/s/gone',
    noindex: true,
    css: SHARE_CSS,
    main: `<main class="share-wrap">
  <h1>This link is no longer available</h1>
  <p>The person who shared this career map turned the link off. Nothing was deleted from their account — they just stopped sharing it.</p>
  <p><a class="share-cta cg-btn" href="/quiz">Find your own career matches</a></p>
</main>`,
  });
}
