// Per-career KV cache for Good Fit Jobs. Keyed by SOC and shared across all users
// matched to that career — this is what keeps us inside Adzuna's free tier.
import { searchJobs } from './adzuna.js';

const KEY_PREFIX = 'jobs:v1:';
const TTL_FULL_SEC = 24 * 3600; // careers with postings: refresh daily
const TTL_EMPTY_SEC = 6 * 3600; // careers with none: retry sooner, but not per-request

/**
 * Normalized job listings for one career, served from KV when warm. On a miss,
 * fetches Adzuna, caches the (possibly empty) result, and returns it. Any failure
 * degrades to []. `baseUrl` is accepted for call-site parity with other store
 * helpers; Adzuna needs only env + career fields.
 */
export async function getJobsForCareer(env, baseUrl, { soc, title, jobZone } = {}) {
  const kv = env && env.COACH_KV;
  const key = soc ? `${KEY_PREFIX}${soc}` : null;
  if (!title) return [];

  if (kv && key) {
    try {
      const cached = await kv.get(key);
      if (cached != null) {
        // A cached "[]" is authoritative — do not re-hit Adzuna for empty careers.
        const arr = JSON.parse(cached);
        return Array.isArray(arr) ? arr : [];
      }
    } catch { /* fall through to a live fetch */ }
  }

  const jobs = await searchJobs(env, { title, jobZone });
  if (jobs == null) return []; // upstream soft-failed — don't cache, retry next time

  if (kv && key) {
    try {
      await kv.put(key, JSON.stringify(jobs), {
        expirationTtl: jobs.length ? TTL_FULL_SEC : TTL_EMPTY_SEC,
      });
    } catch { /* cache write is best-effort */ }
  }
  return jobs;
}

export { KEY_PREFIX as JOBS_KEY_PREFIX };
