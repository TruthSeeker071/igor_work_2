// FlightWay 2.0 — Resume Builder v2, Phase 2: base resume CRUD (premium, no AI).
//   GET    → list of the student's resumes + full latest doc.
//   POST   { id?, title?, json } → validate against schema v1, upsert (cap 3/email).
//   DELETE { id } → remove a resume + its tailored versions.
// Session-gated + requirePlan('premium') + rate-limited, house pattern (mirrors
// functions/artifacts.js response shape and functions/resume-builder.js requirePlan usage).
// Every query parameterized and WHERE email = ? scoped — cross-user isolation is
// an auth boundary, treat with care.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail, checkRateLimit, clientIp } from './_lib/auth.js';
import { requirePlan } from './_lib/entitlements.js';
import { validateResume } from './_lib/resume-schema.js';

const MAX_RESUMES = 3;
const TITLE_MAX = 120;
const DEFAULT_TITLE = 'My resume';

function nowIso() {
  return new Date().toISOString();
}

function parseLatest(row) {
  if (!row) return null;
  let json = null;
  try { json = JSON.parse(row.json); } catch { json = null; }
  return { id: row.id, title: row.title, json, updated_at: row.updated_at };
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) return jsonResponse(402, { error: 'The resume builder is a Flight Plan feature.', upgrade: true }, origin);

  // ?id=… → one full document (email-scoped), so the client can switch between
  // saved resumes without the latest-only limitation.
  const wantId = (new URL(request.url).searchParams.get('id') || '').trim().slice(0, 64);
  if (wantId) {
    try {
      const row = await env.DB.prepare(
        'SELECT id, title, json, updated_at FROM resumes WHERE id = ? AND email = ?',
      ).bind(wantId, email).first();
      if (!row) return jsonResponse(404, { error: 'Resume not found.' }, origin);
      return jsonResponse(200, { doc: parseLatest(row) }, origin);
    } catch (err) {
      console.error('resume-doc get-by-id failed', err?.message || err);
      return jsonResponse(500, { error: 'Could not load that resume.' }, origin);
    }
  }

  let rows = [];
  try {
    const r = await env.DB.prepare(
      'SELECT id, title, json, updated_at FROM resumes WHERE email = ? ORDER BY updated_at DESC',
    ).bind(email).all();
    rows = r.results || [];
  } catch (err) {
    console.error('resume-doc list failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not load your resumes.' }, origin);
  }

  const resumes = rows.map((row) => ({ id: row.id, title: row.title, updated_at: row.updated_at }));
  const latest = rows.length ? parseLatest(rows[0]) : null;

  return jsonResponse(200, { resumes, latest }, origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) return jsonResponse(402, { error: 'The resume builder is a Flight Plan feature.', upgrade: true }, origin);

  try {
    await checkRateLimit(env, `rdoc:${clientIp(request)}`, { max: 30 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }

  const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim().slice(0, 64) : null;
  const title = (typeof body?.title === 'string' && body.title.trim()) ? body.title.trim().slice(0, TITLE_MAX) : DEFAULT_TITLE;

  const result = validateResume(body?.json);
  if (!result.ok) {
    return jsonResponse(400, { error: 'Resume did not pass validation.', details: result.errors.slice(0, 5) }, origin);
  }
  const json = JSON.stringify(result.resume);
  const ts = nowIso();

  try {
    if (id) {
      const res = await env.DB.prepare(
        'UPDATE resumes SET title = ?, json = ?, updated_at = ? WHERE id = ? AND email = ?',
      ).bind(title, json, ts, id, email).run();
      if (!res.meta || !res.meta.changes) {
        return jsonResponse(404, { error: 'Resume not found.' }, origin);
      }
      return jsonResponse(200, { id, updated_at: ts }, origin);
    }

    const countRow = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM resumes WHERE email = ?',
    ).bind(email).first();
    if ((countRow?.n || 0) >= MAX_RESUMES) {
      return jsonResponse(400, { error: `Resume limit reached (${MAX_RESUMES}).` }, origin);
    }

    const newId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO resumes (id, email, title, json, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(newId, email, title, json, ts, ts).run();
    return jsonResponse(200, { id: newId, updated_at: ts }, origin);
  } catch (err) {
    console.error('resume-doc save failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not save your resume.' }, origin);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) return jsonResponse(402, { error: 'The resume builder is a Flight Plan feature.', upgrade: true }, origin);

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const id = typeof body?.id === 'string' ? body.id.trim().slice(0, 64) : '';
  if (!id) return jsonResponse(400, { error: 'Missing resume id.' }, origin);

  try {
    await env.DB.prepare('DELETE FROM resumes WHERE id = ? AND email = ?').bind(id, email).run();
    await env.DB.prepare('DELETE FROM resume_versions WHERE resume_id = ? AND email = ?').bind(id, email).run();
  } catch (err) {
    console.error('resume-doc delete failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not delete your resume.' }, origin);
  }
  return jsonResponse(200, { ok: true }, origin);
}
