import { originFromEnv } from './_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
} from './_lib/auth.js';
import { maybeSyncRoadmap } from './_lib/roadmap-sync.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  if (request.method === 'OPTIONS') return authPreflight(origin);
  if (request.method !== 'POST') return authJsonResponse(405, { error: 'Method not allowed' }, origin);

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    const { email } = await requireSession(request, env);
    const result = await maybeSyncRoadmap(env, email, {
      force: !!payload.force,
      reason: String(payload.reason || 'client').slice(0, 64),
      userPivotNote: payload.userPivotNote ? String(payload.userPivotNote).slice(0, 600) : undefined,
    });

    return authJsonResponse(200, {
      roadmap: result.roadmap,
      cached: result.cached,
      retargeted: result.retargeted,
      focus: result.focus,
      focusUpdated: result.focusUpdated,
      reason: result.reason,
    }, origin);
  } catch (err) {
    console.error('roadmap-sync failed', err && err.stack ? err.stack : err);
    const msg = err && err._userFacing
      ? err.message
      : 'Could not sync roadmap. Please try again.';
    return authJsonResponse(err.status || 500, { error: msg }, origin);
  }
}
