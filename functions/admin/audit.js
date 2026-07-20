// FlightWay — GET /admin/audit?limit&offset. Append-only trail, newest first.
// Readable by any admin (sub-admins included): the log is the check on the
// console, so hiding it from the people who can act would defeat the point.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { adminGate, adminNotFound, listAudit } from '../_lib/admin.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  let limit = 50;
  let offset = 0;
  try {
    const params = new URL(request.url).searchParams;
    limit = Number(params.get('limit')) || 50;
    offset = Number(params.get('offset')) || 0;
  } catch (_) { /* defaults */ }

  try {
    const page = await listAudit(env, { limit, offset });
    return jsonResponse(200, {
      entries: page.rows,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.rows.length === page.limit,
    }, origin, { credentials: true });
  } catch (err) {
    console.error('admin/audit list failed', err?.message || err);
    return jsonResponse(500, { error: 'Could not load the audit log.' }, origin, { credentials: true });
  }
}
