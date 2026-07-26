/**
 * /derive-career — runtime AI-derived "fragment" careers.
 *
 * GET  ?all(=1)  → { fragments: [rows sans vector/importance] } — full union of
 *                    static-sidecar + all D1-derived rows (getAllDerivedRows,
 *                    re-keyed to the live catalog), capped at 500, no session;
 *                    hub boot reads this once.
 * GET  ?base=SOC → { fragments: [rows sans vector/importance] }  (cheap D1 read,
 *                    no session; the fragment strip in the hub drawer reads this)
 * GET  ?soc=SOC  → { row } for a single derived career sans vectors (deep-dive
 *                    resolution when a synthetic 99-1XXX SOC isn't in the catalog)
 * POST { baseSoc } → requireSession + rate limit; synchronously generates (or
 *                    returns existing) fragments for the base. Rejects
 *                    derived/unknown bases 400.
 */
import { originFromEnv } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  checkRateLimit,
  RATE_LIMIT_DERIVE_MAX,
} from './_lib/auth.js';
import {
  generateFragmentsForBase,
  getAllDerivedRows,
  getFragmentsForSoc,
  getRuntimeDerivedBySoc,
  stripVectors,
} from './_lib/derive-career.js';
import { requirePlan } from './_lib/entitlements.js';

const SOC_RE = /^\d{2}-\d{4}\.\d{2}$/;

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const url = new URL(request.url);
  const baseUrl = url.origin;

  if (request.method === 'OPTIONS') return authPreflight(origin);

  try {
    if (request.method === 'GET') {
      const all = url.searchParams.get('all');
      const base = String(url.searchParams.get('base') || '').trim();
      const soc = String(url.searchParams.get('soc') || '').trim();
      if (all !== null && !base && !soc) {
        const derived = await getAllDerivedRows(env, baseUrl);
        return authJsonResponse(200, { fragments: derived.map(stripVectors).slice(0, 500) }, origin);
      }
      if (soc) {
        if (!SOC_RE.test(soc)) return authJsonResponse(400, { error: 'Invalid soc.' }, origin);
        const row = await getRuntimeDerivedBySoc(env, baseUrl, soc);
        return authJsonResponse(200, { row: row ? stripVectors(row) : null }, origin);
      }
      if (!base) return authJsonResponse(400, { error: 'Missing base.' }, origin);
      if (!SOC_RE.test(base)) return authJsonResponse(400, { error: 'Invalid base.' }, origin);
      const fragments = await getFragmentsForSoc(env, baseUrl, base);
      return authJsonResponse(200, { fragments }, origin);
    }

    if (request.method === 'POST') {
      let payload = {};
      try { payload = await request.json(); } catch { payload = {}; }
      const baseSoc = String(payload.baseSoc || '').trim();
      if (!baseSoc || !SOC_RE.test(baseSoc) || baseSoc.startsWith('99-')) {
        return authJsonResponse(400, { error: 'Invalid or unsupported base career.' }, origin);
      }

      const { email } = await requireSession(request, env);
      // Free/paid merge §1: every derived career is a live Gemini generation —
      // the natural cost boundary between the free map and Flight Plan.
      const ent = await requirePlan(env, email, 'premium');
      if (!ent.ok) {
        return authJsonResponse(402, {
          error: 'AI-derived careers are a Flight Plan feature.',
          upgrade: true,
          feature: 'derive-career',
          fragments: [],
        }, origin);
      }
      await checkRateLimit(env, `derive:${email}`, { max: RATE_LIMIT_DERIVE_MAX });

      const rows = await generateFragmentsForBase(env, context, { baseSoc, email, baseUrl });
      // An empty result means either an unknown/derived base (guarded above but
      // also enforced in the lib) or a Gemini failure — surface as 200 with an
      // empty list so the client degrades gracefully rather than erroring.
      return authJsonResponse(200, { fragments: rows.map(stripVectors) }, origin);
    }

    return authJsonResponse(405, { error: 'Method not allowed' }, origin);
  } catch (err) {
    return authErrorResponse(err, origin);
  }
}
