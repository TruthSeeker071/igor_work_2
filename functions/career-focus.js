import { originFromEnv } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
} from './_lib/auth.js';
import {
  recordCareerFocus,
  maybeSyncRoadmap,
  FOCUS_WEIGHTS,
} from './_lib/roadmap-sync.js';
import { generateFragmentsForBase } from './_lib/derive-career.js';

const SOC_RE = /^\d{2}-\d{4}\.\d{2}$/;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LEN = 64;
const MAX_NAME_LEN = 120;

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  const baseUrl = new URL(request.url).origin;

  if (request.method === 'OPTIONS') return authPreflight(origin);
  if (request.method !== 'POST') return authJsonResponse(405, { error: 'Method not allowed' }, origin);

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const slug = String(payload.slug || '').trim().toLowerCase().slice(0, MAX_SLUG_LEN);
  const name = String(payload.name || '').trim().slice(0, MAX_NAME_LEN);
  const source = String(payload.source || '').trim().slice(0, 32);
  const soc = String(payload.soc || '').trim().slice(0, 16) || null;

  if (!slug || !SLUG_RE.test(slug)) {
    return authJsonResponse(400, { error: 'Missing or invalid slug.' }, origin);
  }
  if (!name) return authJsonResponse(400, { error: 'Missing name.' }, origin);
  if (!FOCUS_WEIGHTS[source]) {
    return authJsonResponse(400, { error: 'Invalid or missing source.' }, origin);
  }

  try {
    const { email } = await requireSession(request, env);
    const { focus, retarget, careerFocusHistory, switchCount, quiz: focusQuiz, alignment, pivot } = await recordCareerFocus(env, email, { slug, name, source, soc });

    // Global fragment generation: on a successful focus record for a real
    // (non-99) O*NET career with a resolvable SOC, spawn its AI specializations
    // in the background. Never blocks the response; errors swallowed. The lib
    // guard is idempotent (existing fragments short-circuit) and rejects
    // derived/unknown bases, so this is safe to fire unconditionally here.
    if (soc && SOC_RE.test(soc) && !soc.startsWith('99-') && context.waitUntil) {
      context.waitUntil(
        generateFragmentsForBase(env, context, { baseSoc: soc, email, baseUrl })
          .catch(() => { /* swallow — fragments are additive */ }),
      );
    }

    let syncResult = null;
    if (retarget) {
      try {
        syncResult = await maybeSyncRoadmap(env, email, { reason: source, quiz: focusQuiz });
      } catch (syncErr) {
        console.warn('career-focus sync failed', syncErr);
      }
    }

    return authJsonResponse(200, {
      focus,
      focusUpdated: true,
      pivot: pivot || null,
      retarget,
      careerFocusHistory: careerFocusHistory || [],
      switchCount: switchCount || 0,
      roadmap: syncResult?.roadmap || null,
      roadmapRetargeted: syncResult?.retargeted || false,
      roadmapCached: syncResult?.cached || false,
      alignment: alignment ? {
        severity: alignment.severity,
        reasons: alignment.reasons || [],
        appliedSmall: !!alignment.appliedSmall,
        proposal: alignment.proposal || null,
      } : null,
    }, origin);
  } catch (err) {
    return authErrorResponse(err, origin);
  }
}
