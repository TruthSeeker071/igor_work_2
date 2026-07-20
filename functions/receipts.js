// FlightWay 2.0 — Pillar A3 "receipts": progress deltas the user can see.
//   GET → ensures a snapshot of this week's vectors (idempotent), then returns
//   the last 8 weekly snapshots + the top coordinates that moved.
// Gen Z pays for visible progress — this is the evidence surface. Pure D1 + math;
// dimension labels are mapped client-side from the registry the portal already loads.

import { originFromEnv, jsonResponse, preflightResponse } from './_lib.js';
import { getSessionEmail } from './_lib/auth.js';
import { requirePlan } from './_lib/entitlements.js';
import { loadUser } from './_lib/user.js';
import { isoWeek } from './_lib/weekly-plan-core.js';

const WINDOW = 8;

function values(vec) {
  return vec && Array.isArray(vec.values) ? vec.values : null;
}
function mean(arr) {
  if (!arr || !arr.length) return 0;
  let s = 0;
  for (const v of arr) s += Number(v) || 0;
  return s / arr.length;
}

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  // Free/paid merge §1: Receipts ship with the Weekly Flight Plan.
  const ent = await requirePlan(env, email, 'premium');
  if (!ent.ok) {
    return jsonResponse(402, { error: 'Receipts are a Flight Plan feature.', upgrade: true, feature: 'receipts' }, origin);
  }

  if (!env.DB) return jsonResponse(200, { week: isoWeek(), hasHistory: false, movers: [], trend: [] }, origin);

  const user = await loadUser(env, email);
  const vectors = (user && user.vectors) || {};
  const pers = values(vectors.personality);
  const week = isoWeek();

  // Ensure this week's snapshot exists (first /receipts load of the week writes it).
  try {
    await env.DB.prepare(
      `INSERT INTO vector_snapshots (email, week, personality_json, objective_json, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(email, week) DO NOTHING`,
    ).bind(
      email, week,
      pers ? JSON.stringify(pers) : null,
      values(vectors.objective) ? JSON.stringify(vectors.objective.values) : null,
      new Date().toISOString(),
    ).run();
  } catch (err) {
    console.error('vector_snapshots upsert failed', err?.message || err);
  }

  // Read the window (chronological).
  let rows = [];
  try {
    const res = await env.DB.prepare(
      'SELECT week, personality_json FROM vector_snapshots WHERE email = ? ORDER BY week DESC LIMIT ?',
    ).bind(email, WINDOW).all();
    rows = (res?.results || []).slice().reverse();
  } catch (err) {
    console.error('vector_snapshots read failed', err?.message || err);
  }

  const parsed = rows.map((r) => {
    let v = null;
    try { v = r.personality_json ? JSON.parse(r.personality_json) : null; } catch { v = null; }
    return { week: r.week, vec: v };
  });
  const withVec = parsed.filter((p) => Array.isArray(p.vec));
  const trend = withVec.map((p) => ({ week: p.week, score: Math.round(mean(p.vec) * 10) / 10 }));

  // Movers: earliest → latest delta per dimension, top 6 by |Δ| (>= 1 point).
  let movers = [];
  if (withVec.length >= 2) {
    const first = withVec[0].vec;
    const last = withVec[withVec.length - 1].vec;
    const len = Math.min(first.length, last.length);
    const deltas = [];
    for (let i = 0; i < len; i++) {
      const delta = Math.round(((Number(last[i]) || 0) - (Number(first[i]) || 0)));
      if (Math.abs(delta) >= 1) deltas.push({ index: i, from: Math.round(first[i]) || 0, to: Math.round(last[i]) || 0, delta });
    }
    deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    movers = deltas.slice(0, 6);
  }

  return jsonResponse(200, {
    week,
    hasHistory: withVec.length >= 2,
    weeks: withVec.map((p) => p.week),
    movers,
    trend,
  }, origin);
}
