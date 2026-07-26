// FlightWay V2 S4 — notification preferences (D9/D10).
//   GET  → { prefs: {weekly,deadlines,review,product}, optin, verified }
//   POST { prefs: {weekly?,deadlines?,review?,product?} }  (partial, no-clobber)
//        (also accepts the legacy { optin: bool } from the old single toggle)
// Session-gated + rate-limited. NOT premium-gated: D9 makes the weekly digest a
// free Flight Plan feature, so every signed-in user manages their own categories.
// (Inert vs. today's behaviour while the paywall is dark — everyone is premium —
// but forward-correct once it flips; the cron send-filter is S11's to remove.)

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, hashedIpKey } from './_lib/auth.js';
import { unsubToken } from './_lib/notify-token.js';

// category name → users column. Kept in sync with migration 0019 + email-template
// UNSUB_CATEGORIES + unsubscribe.js. 'weekly' is the pre-existing notify_optin.
const CATEGORY_COLUMN = {
  weekly: 'notify_optin',
  deadlines: 'notify_deadlines',
  review: 'notify_review',
  product: 'notify_product',
};

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const prefs = { weekly: false, deadlines: false, review: false, product: false };
  let verified = true;
  try {
    const row = await env.DB.prepare(
      'SELECT notify_optin, notify_deadlines, notify_review, notify_product, verified_at FROM users WHERE email = ?',
    ).bind(email).first();
    if (row) {
      prefs.weekly = !!row.notify_optin;
      prefs.deadlines = !!row.notify_deadlines;
      prefs.review = !!row.notify_review;
      prefs.product = !!row.notify_product;
      verified = !!row.verified_at;
    }
  } catch (_) {
    // Pre-0019 schema (category / verified_at columns absent). Fall back to the
    // legacy single-column read and treat verification as unknown → don't nag.
    try {
      const row = await env.DB.prepare('SELECT notify_optin FROM users WHERE email = ?').bind(email).first();
      prefs.weekly = !!(row && row.notify_optin);
    } catch (_2) { /* pre-0009: no notify columns at all */ }
    verified = true;
  }
  return jsonResponse(200, { prefs, optin: prefs.weekly, verified }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, `notify:${await hashedIpKey(env, request)}`, { max: 20 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }

  // Collect only the categories the caller actually sent, so a single-category
  // toggle never clobbers the others (fragile save-path rule: a partial save
  // drops nothing). Legacy clients send { optin } for the weekly toggle.
  const updates = {};
  if (body.prefs && typeof body.prefs === 'object') {
    for (const k of Object.keys(CATEGORY_COLUMN)) {
      if (k in body.prefs) updates[k] = !!body.prefs[k];
    }
  }
  if ('optin' in body) updates.weekly = !!body.optin;
  if (!Object.keys(updates).length) return jsonResponse(400, { error: 'No preferences to update.' }, origin);

  const sets = [];
  const binds = [];
  for (const [k, v] of Object.entries(updates)) {
    sets.push(`${CATEGORY_COLUMN[k]} = ?`);
    binds.push(v ? 1 : 0);
  }
  // When weekly turns on, refresh the stored (deterministic) unsub token hash,
  // matching the pre-S4 behaviour so unsubscribe re-derivation stays consistent.
  if (updates.weekly === true) {
    sets.push('notify_token_hash = ?');
    binds.push(await unsubToken(email, env));
  }
  binds.push(email);

  try {
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE email = ?`).bind(...binds).run();
  } catch (err) {
    // Category columns may not exist yet (pre-0019 window). If the request only
    // touched weekly, retry against the 0009 columns so the core toggle survives.
    if ('weekly' in updates) {
      try {
        await env.DB.prepare('UPDATE users SET notify_optin = ?, notify_token_hash = ? WHERE email = ?')
          .bind(updates.weekly ? 1 : 0, updates.weekly ? await unsubToken(email, env) : null, email).run();
      } catch (e2) {
        console.error('notify-prefs weekly fallback failed', e2?.message || e2);
        return jsonResponse(500, { error: 'Could not save your preference.' }, origin);
      }
    } else {
      console.error('notify-prefs update failed', err?.message || err);
      return jsonResponse(500, { error: 'Could not save your preferences.' }, origin);
    }
  }
  return jsonResponse(200, { ok: true, prefs: updates }, origin);
}
