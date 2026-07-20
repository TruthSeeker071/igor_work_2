import {
  jsonResponse,
  preflightResponse,
  originFromEnv,
} from '../_lib.js';
import { getCareers, getLayout, getRegistry, getManifest } from '../_lib/onet/store.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);
  if (request.method === 'OPTIONS') return preflightResponse(origin);

  const url = new URL(request.url);
  const baseUrl = url.origin;

  try {
    if (request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const zone = url.searchParams.get('zone') || '';
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
      const meta = url.searchParams.get('meta');

      if (meta === 'registry') {
        const registry = await getRegistry(env, baseUrl);
        return jsonResponse(200, registry, origin);
      }
      if (meta === 'manifest') {
        const manifest = await getManifest(env, baseUrl);
        return jsonResponse(200, manifest, origin);
      }
      if (meta === 'layout') {
        const layout = await getLayout(env, baseUrl);
        return jsonResponse(200, layout, origin);
      }

      const careers = await getCareers(env, baseUrl);
      let filtered = careers.filter((c) => c.mvpInScope !== false);
      if (zone) filtered = filtered.filter((c) => c.hubZone === zone);
      if (q) {
        filtered = filtered.filter((c) =>
          c.titleNorm.includes(q) || c.soc.includes(q)
        );
      }
      const results = filtered.slice(0, limit).map((c) => ({
        soc: c.soc,
        title: c.title,
        hubZone: c.hubZone,
        layoutX: c.layoutX,
        layoutY: c.layoutY,
        jobZone: c.jobZone,
        hubFeatured: c.hubFeatured,
      }));
      return jsonResponse(200, { count: results.length, careers: results }, origin);
    }
    return jsonResponse(405, { error: 'Method not allowed' }, origin);
  } catch (err) {
    console.error('onet/careers error', err);
    return jsonResponse(500, { error: 'Failed to load careers' }, origin);
  }
}
