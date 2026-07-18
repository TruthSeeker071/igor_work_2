import {
  jsonResponse,
  preflightResponse,
  originFromEnv,
} from './_lib.js';
import { requireSession, checkRateLimit, clientIp } from './_lib/auth.js';
import { getCareers } from './_lib/onet/store.js';
import { getJobsForCareer } from './_lib/jobs/cache.js';

export const MAX_ITEMS = 6; // client sends at most this many careers
const MAX_JOBS_PER_CAREER = 5;
const WALLCLOCK_BUDGET_MS = 8000; // stop starting new career fetches past this

/**
 * Cap requested items to `max`, validate each SOC against the catalog map, and
 * de-dupe. Unknown SOCs are silently skipped (client state can be stale) rather
 * than rejected. Returns `[{ soc, title, jobZone }]`. Pure — unit-tested directly.
 */
export function selectRequestedCareers(rawItems, bySoc, max = MAX_ITEMS) {
  const items = Array.isArray(rawItems) ? rawItems.slice(0, max) : [];
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const soc = String(raw.soc || '').trim().slice(0, 20);
    if (!soc || seen.has(soc)) continue;
    const meta = bySoc.get(soc);
    if (!meta) continue;
    seen.add(soc);
    out.push({ soc: meta.soc, title: meta.title || soc, jobZone: meta.jobZone });
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = originFromEnv(env);
  if (request.method === 'OPTIONS') return preflightResponse(origin, { credentials: true });

  const baseUrl = new URL(request.url).origin;

  try {
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' }, origin, { credentials: true });
    }

    await requireSession(request, env);

    // No Adzuna keys (e.g. dev, or not yet configured) → hide the section cleanly.
    if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) {
      return jsonResponse(200, { careers: [], unconfigured: true }, origin, { credentials: true });
    }

    await checkRateLimit(env, `jobs:${clientIp(request)}`, { max: 30 });

    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.items) || !body.items.length) {
      return jsonResponse(200, { careers: [] }, origin, { credentials: true });
    }

    const careers = await getCareers(env, baseUrl);
    // Store rows are keyed by SOC (no `slug` column); derived (99-*) SOCs are valid.
    const bySoc = new Map(careers.map((c) => [c.soc, c]));
    const wanted = selectRequestedCareers(body.items, bySoc);

    // Fetch sequentially (protects Adzuna rate limits on a cold cache; warm cache
    // makes this fast). Bounded by a wall-clock budget — a partial result in time
    // beats a timeout.
    const start = Date.now();
    const out = [];
    for (const c of wanted) {
      if (Date.now() - start > WALLCLOCK_BUDGET_MS) break;
      const jobs = await getJobsForCareer(env, baseUrl, c);
      if (jobs.length) {
        out.push({ soc: c.soc, title: c.title, jobs: jobs.slice(0, MAX_JOBS_PER_CAREER) });
      }
    }

    return jsonResponse(200, { careers: out }, origin, { credentials: true });
  } catch (err) {
    if (err && err.status === 401) {
      return jsonResponse(401, { error: 'Sign in required' }, origin, { credentials: true });
    }
    if (err && err.status === 429) {
      return jsonResponse(429, { error: 'Rate limited' }, origin, { credentials: true });
    }
    console.error('job-matches error', err);
    // Never break the page for a jobs failure — client hides the section.
    return jsonResponse(200, { careers: [] }, origin, { credentials: true });
  }
}
