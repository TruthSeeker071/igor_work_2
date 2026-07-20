import {
  jsonResponse,
  preflightResponse,
  originFromEnv,
} from '../_lib.js';
import { getVectorsForSocs } from '../_lib/onet/vectors.js';
import { MAX_SOC_BATCH } from '../_lib/onet/constants.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  if (request.method === 'OPTIONS') return preflightResponse(origin);

  const baseUrl = new URL(request.url).origin;

  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const socs = body.socs || body.SOCs;
      const result = await getVectorsForSocs(env, baseUrl, socs);
      if (result.error) {
        return jsonResponse(400, { error: result.error, maxBatch: MAX_SOC_BATCH }, origin);
      }
      return jsonResponse(200, result, origin);
    }

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const raw = url.searchParams.get('socs') || '';
      const socs = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const result = await getVectorsForSocs(env, baseUrl, socs);
      if (result.error) {
        return jsonResponse(400, { error: result.error, maxBatch: MAX_SOC_BATCH }, origin);
      }
      return jsonResponse(200, result, origin);
    }

    return jsonResponse(405, { error: 'Method not allowed' }, origin);
  } catch (err) {
    console.error('onet/vectors error', err);
    return jsonResponse(500, { error: 'Failed to load vectors' }, origin);
  }
}
