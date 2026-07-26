import {
  jsonResponse,
  preflightResponse,
  originFromEnv,
} from './_lib.js';
import { requireSession } from './_lib/auth.js';
import { loadUser, normalizeUser, denormalizeUser } from './_lib/user.js';
import { getVectorsForSocs, getMagnitudeSample } from './_lib/onet/vectors.js';
import { getCareers } from './_lib/onet/store.js';
import {
  personalityFitPercent,
  objectiveFitPercent,
  displayFitPercent,
  computePreparedness,
  computeGapVector,
  isObjectiveVectorActive,
} from './_lib/onet/math.js';
import { ensureUserVectors } from './_lib/onet/user-vectors.js';
import { MAX_SOC_BATCH } from './_lib/onet/constants.js';

async function loadZoneCentroids(baseUrl) {
  const res = await fetch(new URL('/data/onet/artifacts/zone-centroids.json', baseUrl).toString());
  if (!res.ok) return null;
  return res.json();
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  if (request.method === 'OPTIONS') return preflightResponse(origin, { credentials: true });

  const baseUrl = new URL(request.url).origin;

  try {
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' }, origin, { credentials: true });
    }

    const session = await requireSession(request, env);
    const email = session.email;

    const body = await request.json().catch(() => ({}));
    const socs = body.socs || [];
    if (!Array.isArray(socs) || socs.length === 0) {
      return jsonResponse(400, { error: 'socs required' }, origin, { credentials: true });
    }
    if (socs.length > MAX_SOC_BATCH) {
      return jsonResponse(400, { error: `max ${MAX_SOC_BATCH} socs`, maxBatch: MAX_SOC_BATCH }, origin, { credentials: true });
    }

    const [vectorResult, careers, zoneCentroids, magSample] = await Promise.all([
      getVectorsForSocs(env, baseUrl, socs),
      getCareers(env, baseUrl),
      loadZoneCentroids(baseUrl),
      getMagnitudeSample(env, baseUrl),
    ]);

    if (vectorResult.error) {
      return jsonResponse(400, { error: vectorResult.error }, origin, { credentials: true });
    }

    // normalizeUser accepts v1 or v2 posted profiles; the fit math below works
    // on the v1 view (ensureUserVectors' contract).
    const user = body.quizProfile ? normalizeUser(body.quizProfile) : await loadUser(env, email);
    let quiz = user ? denormalizeUser(user) : null;
    if (zoneCentroids && quiz) {
      quiz = ensureUserVectors({ ...quiz }, zoneCentroids);
    }

    const personality = quiz?.personalityVector?.values || null;
    const objective = quiz?.objectiveVector?.values || null;
    const objectiveActive = isObjectiveVectorActive(objective);
    const careerMeta = new Map(careers.map((c) => [c.soc, c]));

    const fits = {};
    for (const soc of socs) {
      const careerVec = vectorResult.vectors[soc];
      if (!careerVec) continue;
      const importance = vectorResult.importance[soc];
      const meta = careerMeta.get(soc);
      const entry = { soc };
      if (personality) {
        entry.personalityFit = personalityFitPercent(personality, careerVec);
      }
      if (objectiveActive) {
        entry.objectiveFit = objectiveFitPercent(objective, careerVec);
        entry.preparedness = computePreparedness(objective, careerVec, {
          jobZone: meta?.jobZone,
          magnitudeSample: magSample,
        });
        entry.topGaps = computeGapVector(objective, careerVec, importance)
          .slice(0, 5)
          .map((g) => ({ index: g.index, gap: Math.round(g.gap * 10) / 10 }));
      }
      if (entry.personalityFit != null) {
        entry.fitScore = displayFitPercent(personality, careerVec);
      }
      fits[soc] = entry;
    }

    return jsonResponse(200, {
      schemaId: vectorResult.schemaId,
      fits,
      missing: vectorResult.missing,
    }, origin, { credentials: true });
  } catch (err) {
    console.error('vector-fit error', err);
    return jsonResponse(500, { error: 'Fit computation failed' }, origin, { credentials: true });
  }
}
