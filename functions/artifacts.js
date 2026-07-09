// FlightWay 2.0 — Pillar B3 artifacts (portfolio evidence).
//   GET  → the user's logged artifacts (newest first)
//   POST { type, title, note?, waypointId? } → log one (validated, rate-limited)
// Session-gated, house pattern. Renders as an "Evidence" list on the portal.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, clientIp, generateToken } from './_lib/auth.js';

const TYPES = new Set(['repo', 'doc', 'analysis', 'design', 'other']);

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  let artifacts = [];
  try {
    const r = await env.DB.prepare(
      'SELECT id, waypoint_id, type, title, note, created_at FROM artifacts WHERE email = ? ORDER BY created_at DESC LIMIT 50',
    ).bind(email).all();
    artifacts = (r.results || []).map((a) => ({
      id: a.id, waypointId: a.waypoint_id, type: a.type, title: a.title, note: a.note, createdAt: a.created_at,
    }));
  } catch (err) {
    console.error('artifacts list failed', err?.message || err); // table may not exist until 0010 applied
  }
  return jsonResponse(200, { artifacts }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, `artifact:${clientIp(request)}`, { max: 30 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const type = String(body?.type || '').toLowerCase();
  const title = String(body?.title || '').trim().slice(0, 120);
  const note = String(body?.note || '').trim().slice(0, 200);
  const waypointId = (String(body?.waypointId || '').slice(0, 64)) || null;

  if (!TYPES.has(type)) return jsonResponse(400, { error: 'Pick an artifact type.' }, origin);
  if (title.length < 2) return jsonResponse(400, { error: 'Give your artifact a title.' }, origin);

  const id = generateToken(12);
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO artifacts (id, email, waypoint_id, type, title, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, email, waypointId, type, title, note || null, createdAt).run();
  } catch (err) {
    console.error('artifact insert failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not save your artifact.' }, origin);
  }
  return jsonResponse(200, { ok: true, artifact: { id, waypointId, type, title, note, createdAt } }, origin);
}
