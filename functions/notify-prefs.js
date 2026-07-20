// FlightWay 2.0 — nudge opt-in preference (Pillar B2).
//   GET  → { optin }        (is the weekly nudge on for this user?)
//   POST { optin: bool }     (turn it on/off; stores the unsubscribe token on opt-in)
// Session-gated + rate-limited. The Monday cron worker reads notify_optin.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, clientIp } from './_lib/auth.js';
import { requirePlan } from './_lib/entitlements.js';
import { unsubToken } from './_lib/notify-token.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  // Free/paid merge §1: the weekly email digest is part of the Flight Plan.
  // Read stays honest rather than 402 so the portal can simply hide the toggle.
  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) return jsonResponse(200, { optin: false, upgrade: true, feature: 'notify-prefs' }, origin);

  let optin = false;
  try {
    const row = await env.DB.prepare('SELECT notify_optin FROM users WHERE email = ?').bind(email).first();
    optin = !!(row && row.notify_optin);
  } catch (_) { /* column may not exist until migration 0009 applied */ }
  return jsonResponse(200, { optin }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) {
    return jsonResponse(402, { error: 'The weekly digest is a Flight Plan feature.', upgrade: true, feature: 'notify-prefs' }, origin);
  }

  try {
    await checkRateLimit(env, `notify:${clientIp(request)}`, { max: 20 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const optin = !!body.optin;

  try {
    const token = optin ? await unsubToken(email, env) : null;
    await env.DB.prepare('UPDATE users SET notify_optin = ?, notify_token_hash = ? WHERE email = ?')
      .bind(optin ? 1 : 0, token, email).run();
  } catch (err) {
    console.error('notify-prefs update failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not save your preference.' }, origin);
  }
  return jsonResponse(200, { ok: true, optin }, origin);
}
