import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
  loadQuizProfile,
  saveQuizProfile,
} from '../_lib/auth.js';
import { refreshFullObjective } from '../_lib/onet/resume-map.js';
import { DIM_COUNT } from '../_lib/onet/constants.js';

function vectorValuesEqual(a, b) {
  if (!a?.values || !b?.values) return false;
  for (let i = 0; i < DIM_COUNT; i += 1) {
    if ((a.values[i] || 0) !== (b.values[i] || 0)) return false;
  }
  return true;
}
import { getZoneDimensionProfiles } from '../_lib/onet/store.js';
import { setZoneDimensionProfiles } from '../_lib/onet/resume-theme-map.js';

export async function onRequestOptions(context) {
  return authPreflight(originFromEnv(context.env));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);

  try {
    const { email } = await requireSession(request, env);
    const profile = await loadQuizProfile(env, email);
    return authJsonResponse(200, { profile: profile || null }, origin);
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

  if (!payload.profile || typeof payload.profile !== 'object') {
    return authJsonResponse(400, { error: 'Missing profile object.' }, origin);
  }

  try {
    const { email } = await requireSession(request, env);
    const profile = { ...payload.profile };
    const baseUrl = originFromEnv(env);
    const zoneProfiles = await getZoneDimensionProfiles(env, baseUrl);
    setZoneDimensionProfiles(zoneProfiles);
    // Keep the client's vector object (and updatedAt) when the rebuild is a
    // no-op — a fresh timestamp per PUT would churn every staleness hash
    // downstream (portal snapshot, roadmap, analysis cache).
    const rebuilt = refreshFullObjective(profile.objectiveVector, profile, zoneProfiles);
    if (!vectorValuesEqual(rebuilt, profile.objectiveVector)) {
      profile.objectiveVector = rebuilt;
    }
    await saveQuizProfile(env, email, profile);
    return authJsonResponse(200, { ok: true }, origin);
  } catch (err) {
    console.error('profile/quiz PUT failed', err);
    return authErrorResponse(err, origin);
  }
}
