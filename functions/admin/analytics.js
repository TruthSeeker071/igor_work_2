// FlightWay — GET /admin/analytics?panel=<name>&from&to&days&limit
//
// The read side of S3's self-hosted dashboards. One route, one gate; the panel
// query picks which aggregate to compute. Like every admin route it answers 404
// to anyone who is not an admin (including signed-out callers), so the console's
// existence is not discoverable. Reads do NOT require elevation — elevation
// gates mutations, and there are none here; the console has to render before you
// unlock it, exactly as /admin/grants and /admin/audit already do.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { adminGate, adminNotFound } from '../_lib/admin.js';
import { logServerError } from '../_lib/events.js';
import {
  overviewMetrics, funnelMetrics, retentionMetrics, featureUsage,
  sourceAttribution, liveTail, recentServerErrors,
} from '../_lib/analytics.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

const PANELS = {
  overview: (db, env, p) => overviewMetrics(db, { monthlyCents: env.MRR_MONTHLY_CENTS }),
  funnel: (db, env, p) => funnelMetrics(db, { from: p.get('from'), to: p.get('to') }),
  retention: (db, env, p) => retentionMetrics(db, { weeks: Number(p.get('weeks')) || 8 }),
  features: (db, env, p) => featureUsage(db, { weeks: Number(p.get('weeks')) || 8 }),
  sources: (db, env, p) => sourceAttribution(db, { from: p.get('from'), to: p.get('to') }),
  tail: (db, env, p) => liveTail(db, { limit: Number(p.get('limit')) || 100 }),
  errors: (db, env, p) => recentServerErrors(db, { limit: Number(p.get('limit')) || 50, sinceDays: Number(p.get('days')) || 7 }),
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  let params;
  try { params = new URL(request.url).searchParams; } catch (_) { params = new URLSearchParams(); }
  const panel = String(params.get('panel') || 'overview').toLowerCase();
  const compute = PANELS[panel];
  if (!compute) return jsonResponse(400, { error: 'Unknown panel.', panels: Object.keys(PANELS) }, origin, { credentials: true });

  if (!env || !env.DB) return jsonResponse(200, { panel, data: null, note: 'No database binding.' }, origin, { credentials: true });

  try {
    const data = await compute(env.DB, env, params);
    return jsonResponse(200, { panel, data }, origin, { credentials: true });
  } catch (err) {
    // Dogfood the error log: the analytics endpoint records its own failures.
    await logServerError(env, 'admin/analytics', err, { detail: panel });
    console.error('admin/analytics failed', panel, err?.message || err);
    return jsonResponse(500, { error: 'Could not compute this panel.' }, origin, { credentials: true });
  }
}
