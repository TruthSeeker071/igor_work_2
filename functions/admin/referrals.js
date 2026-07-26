// FlightWay V2 S15 — GET/POST /admin/referrals (plan §5 S15, D24).
//
// The referral loop moves real money (a Stripe customer-balance credit), so it
// gets the same treatment as comp grants: 404 to non-admins, password elevation
// on every write, an audit row per action.
//
// Two write actions, and the pair is deliberate. `void` is the fraud kill
// switch. `retry` exists because a held referral is otherwise a dead end: the
// commonest hold by far is `referrer_unverified` — someone who invited a friend
// before confirming their own email — and that resolves itself the moment they
// click the link. Without a retry, the credit they earned would never be issued
// and nothing in the product would ever say why.

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { checkRateLimit, hashedIpKey } from '../_lib/auth.js';
import { adminGate, adminNotFound, audit, readJsonBody, requireElevation } from '../_lib/admin.js';
import {
  MAX_CREDITS_PER_YEAR, REFERRAL_STATUSES, creditReferrer, listReferrals, voidReferral,
} from '../_lib/referral.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request), { credentials: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || '');
  const limit = Number(url.searchParams.get('limit')) || 100;
  const offset = Number(url.searchParams.get('offset')) || 0;

  try {
    const rows = await listReferrals(env, { limit, offset, status });
    return jsonResponse(200, {
      referrals: rows.map((r) => ({
        ...r,
        // Stored as a JSON array; handed to the console already parsed so the
        // panel never has to guess whether it is a string or a list.
        flags: (() => { try { return JSON.parse(r.flags || '[]'); } catch { return []; } })(),
      })),
      statuses: REFERRAL_STATUSES,
      maxPerYear: MAX_CREDITS_PER_YEAR,
      promoConfigured: !!String((env && env.STRIPE_REFERRAL_PROMO_ID) || '').trim(),
    }, origin, { credentials: true });
  } catch (err) {
    // A missing table is the pre-0023 state, not a server fault — say which.
    console.warn('admin/referrals list failed', err?.message || err);
    return jsonResponse(200, {
      referrals: [], statuses: REFERRAL_STATUSES, maxPerYear: MAX_CREDITS_PER_YEAR,
      migrationPending: true,
    }, origin, { credentials: true });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const who = await adminGate(request, env);
  if (!who) return adminNotFound(origin);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResponse(parsed.status, { error: parsed.error }, origin, { credentials: true });

  if (!(await requireElevation(env, who.email))) {
    return jsonResponse(403, { error: 'Confirm your password to make changes.', elevate: true }, origin, { credentials: true });
  }

  try {
    await checkRateLimit(env, `adminref:${who.email}`, { max: 60 });
    await checkRateLimit(env, `adminref:${await hashedIpKey(env, request)}`, { max: 60 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin, { credentials: true });
  }

  const action = String(parsed.body?.action || '').trim().toLowerCase();
  const id = String(parsed.body?.id || '').trim();
  if (!id) return jsonResponse(400, { error: 'Which referral?' }, origin, { credentials: true });

  if (action === 'void') {
    const reason = String(parsed.body?.reason || '').trim();
    if (reason.length < 3) return jsonResponse(400, { error: 'Say why — it goes in the audit log.' }, origin, { credentials: true });
    try {
      const done = await voidReferral(env, id, reason);
      if (!done) {
        return jsonResponse(409, {
          error: 'That referral is already credited or already void — voiding it would not take the money back.',
        }, origin, { credentials: true });
      }
      await audit(env, who.email, 'referral_void', id, reason.slice(0, 200));
      return jsonResponse(200, { ok: true, id, status: 'void' }, origin, { credentials: true });
    } catch (err) {
      console.error('admin/referrals void failed', err?.message || err);
      return jsonResponse(500, { error: 'Could not void that referral.' }, origin, { credentials: true });
    }
  }

  if (action === 'retry') {
    let row;
    try {
      row = await env.DB.prepare('SELECT referee_id, status FROM referrals WHERE id = ?').bind(id).first();
    } catch {
      return jsonResponse(503, { error: 'Referrals are not switched on yet (migration 0023).' }, origin, { credentials: true });
    }
    if (!row) return jsonResponse(404, { error: 'No such referral.' }, origin, { credentials: true });
    if (row.status !== 'converted') {
      return jsonResponse(409, {
        error: `Only a referral held at "converted" can be retried (this one is "${row.status}").`,
      }, origin, { credentials: true });
    }
    const res = await creditReferrer(env, row.referee_id, { retry: true });
    await audit(env, who.email, 'referral_retry', id, res.ok ? `credited ${res.cents}` : `held: ${res.reason}`);
    return jsonResponse(res.ok ? 200 : 409, res.ok
      ? { ok: true, id, status: 'credited', cents: res.cents }
      : { error: `Still held: ${res.reason}${res.flags ? ` (${res.flags.join(', ')})` : ''}` },
    origin, { credentials: true });
  }

  return jsonResponse(400, { error: 'Unknown action.' }, origin, { credentials: true });
}
