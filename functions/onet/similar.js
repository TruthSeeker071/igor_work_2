import {
  jsonResponse,
  preflightResponse,
  originFromEnv,
} from '../_lib.js';
import { getSimilarityIndex } from '../_lib/onet/store.js';
import { SIMILARITY_ADJACENT, SIMILARITY_CROSS_SECTOR } from '../_lib/onet/constants.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  if (request.method === 'OPTIONS') return preflightResponse(origin);

  const baseUrl = new URL(request.url).origin;

  try {
    if (request.method !== 'GET') {
      return jsonResponse(405, { error: 'Method not allowed' }, origin);
    }

    const url = new URL(request.url);
    const soc = (url.searchParams.get('soc') || '').trim();
    if (!soc) {
      return jsonResponse(400, { error: 'soc required' }, origin);
    }

    const index = await getSimilarityIndex(env, baseUrl);
    const neighbors = index[soc];
    if (!neighbors) {
      return jsonResponse(404, { error: 'SOC not found' }, origin);
    }

    const k = Math.min(50, Math.max(1, parseInt(url.searchParams.get('k') || '10', 10)));
    const tagged = neighbors.slice(0, k).map((n) => ({
      ...n,
      relation: n.score >= SIMILARITY_ADJACENT ? 'adjacent'
        : n.score < SIMILARITY_CROSS_SECTOR ? 'cross-sector' : 'related',
    }));

    return jsonResponse(200, { soc, neighbors: tagged, thresholds: {
      adjacent: SIMILARITY_ADJACENT,
      crossSector: SIMILARITY_CROSS_SECTOR,
    } }, origin);
  } catch (err) {
    console.error('onet/similar error', err);
    return jsonResponse(500, { error: 'Failed to load similarity' }, origin);
  }
}
