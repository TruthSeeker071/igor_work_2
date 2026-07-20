import { originFromEnv } from '../_lib.js';
import {
  authPreflight,
  authJsonResponse,
  authErrorResponse,
  requireSession,
} from '../_lib/auth.js';
import { loadUser, saveUser, normalizeUser, denormalizeUser } from '../_lib/user.js';
import { mirrorFieldsToDossier } from '../_lib/user-sync.js';
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
  return authPreflight(originFromEnv(context.env, context.request));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  try {
    const { email } = await requireSession(request, env);
    const user = await loadUser(env, email);
    // Clients consume the v1 view; they normalize on read (FWUser).
    return authJsonResponse(200, { profile: user ? denormalizeUser(user) : null }, origin);
  } catch (err) {
    return authErrorResponse(err, origin);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  let payload;
  try {
    // A full quiz profile (vectors + refine + academics + resume text +
    // portal snapshot) measures in the tens of KB; anything near 1 MB is
    // abuse, and D1 rows shouldn't grow unbounded.
    const raw = await request.text();
    if (raw.length > 1_000_000) {
      return authJsonResponse(413, { error: 'Profile payload too large.' }, origin);
    }
    payload = JSON.parse(raw);
  } catch {
    return authJsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  if (!payload.profile || typeof payload.profile !== 'object') {
    return authJsonResponse(400, { error: 'Missing profile object.' }, origin);
  }

  try {
    const { email } = await requireSession(request, env);
    // Accept v1 (today's clients) and v2 (post-rollout tokens/tabs) bodies;
    // the rebuild below works on the v1 view.
    const profile = denormalizeUser(normalizeUser(payload.profile));
    const baseUrl = originFromEnv(env, request);
    const zoneProfiles = await getZoneDimensionProfiles(env, baseUrl);
    setZoneDimensionProfiles(zoneProfiles);
    // Keep the client's vector object (and updatedAt) when the rebuild is a
    // no-op — a fresh timestamp per PUT would churn every staleness hash
    // downstream (portal snapshot, roadmap, analysis cache).
    const rebuilt = refreshFullObjective(profile.objectiveVector, profile, zoneProfiles);
    if (!vectorValuesEqual(rebuilt, profile.objectiveVector)) {
      profile.objectiveVector = rebuilt;
    }
    const user = normalizeUser(profile);
    await saveUser(env, email, user);
    // The academics panel edits the GPA through this blob (academics.gpa,
    // which normalizeUser resolves into identity.gpa). Mirror it into the
    // dossier's `gpa:` line, or the next dossier write would sync the
    // onboarding value back over the edit. Best-effort, off the response path.
    const mirror = mirrorFieldsToDossier(env, email, user, { only: ['identity.gpa'] });
    if (typeof context.waitUntil === 'function') context.waitUntil(mirror);
    else await mirror;
    return authJsonResponse(200, { ok: true }, origin);
  } catch (err) {
    console.error('profile/quiz PUT failed', err);
    return authErrorResponse(err, origin);
  }
}
