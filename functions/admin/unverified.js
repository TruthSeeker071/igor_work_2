// FlightWay V2 S4 — GET /admin/unverified
// Report-only: accounts that never confirmed their email and are older than 30
// days (D7 flags them for a later, Jacob-approved purge; nothing is deleted
// here). Read-only, so it uses adminGate like the other admin read panels and
// needs no elevation. 404s to everyone who is not an admin.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { adminGate, adminNotFound } from '../_lib/admin.js';

const STALE_DAYS = 30;
const CAP = 500;

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  let rows = [];
  try {
    const r = await env.DB.prepare(
      'SELECT email, created_at, verify_sent_at FROM users WHERE verified_at IS NULL AND created_at <= ? ORDER BY created_at ASC LIMIT ' + CAP,
    ).bind(cutoff).all();
    rows = r.results || [];
  } catch (_) {
    // verified_at column absent (pre-0019 window): nothing to report yet.
    rows = [];
  }
  return jsonResponse(
    200,
    { unverified: rows, staleDays: STALE_DAYS, cutoff, capped: rows.length >= CAP },
    origin,
    { credentials: true },
  );
}
