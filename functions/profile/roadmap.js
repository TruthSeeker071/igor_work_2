import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadRoadmap,
  saveRoadmap,
} from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  try {
    const { email } = await requireSession(request, env);
    const roadmap = await loadRoadmap(env, email);
    return authJsonResponse(200, { roadmap: roadmap || {} }, origin);
  } catch (err) {
    return authErrorResponse(err, origin);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const roadmap = payload.roadmap && typeof payload.roadmap === 'object' ? payload.roadmap : {};

  try {
    const { email } = await requireSession(request, env);
    await saveRoadmap(env, email, roadmap);
    return authJsonResponse(200, { ok: true }, origin);
  } catch (err) {
    console.error('profile/roadmap PUT failed', err);
    return authErrorResponse(err, origin);
  }
}
