// FlightWay 2.0 — Good Fit Jobs invariants (Adzuna client, KV cache, endpoint validation).
//   run: npm run test:jobs
import { searchJobs } from '../functions/_lib/jobs/adzuna.js';
import { getJobsForCareer } from '../functions/_lib/jobs/cache.js';
import { selectRequestedCareers, MAX_ITEMS } from '../functions/job-matches.js';

let fail = 0;
const assert = (c, m) => { if (c) console.log('  PASS', m); else { fail++; console.error('  FAIL', m); } };

const ENV = { ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key' };
const recentIso = new Date(Date.now() - 2 * 86400000).toISOString();  // within 7 days
const oldIso = '2020-01-01T00:00:00Z';

// Swap globalThis.fetch for a canned Adzuna response; return a call counter.
function stubFetch(results) {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ results }) };
  };
  return () => calls;
}

function fakeKv() {
  const store = new Map();
  const puts = [];
  return {
    store, puts,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, opts) { store.set(k, v); puts.push({ k, v, opts }); },
  };
}

const SAMPLE = [
  { id: 1, title: 'Senior <strong>Data</strong> Architect', company: { display_name: 'BigCo' }, location: { display_name: 'New York' }, salary_min: 150000, salary_max: 180000, redirect_url: 'https://adzuna.com/1', created: oldIso },
  { id: 2, title: 'Data Science Intern', company: { display_name: 'StartCo' }, location: { display_name: 'Remote' }, salary_min: 60000, salary_max: null, redirect_url: 'https://adzuna.com/2', created: recentIso },
  { id: 3, title: 'Junior Data Analyst', company: {}, location: {}, redirect_url: 'https://adzuna.com/3', created: oldIso },
  { id: 4, title: 'Broken Link', company: {}, location: {}, redirect_url: 'ftp://nope', created: oldIso },
];

console.log('searchJobs — normalization:');
{
  stubFetch(SAMPLE);
  const jobs = await searchJobs(ENV, { title: 'Data Scientists (research)', jobZone: 4 });
  assert(Array.isArray(jobs) && jobs.length === 3, 'drops rows without an http(s) url (4 → 3)');
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  assert(byId['1'].title === 'Senior Data Architect', 'strips HTML tags from title');
  assert(byId['1'].salaryMin === 150000 && byId['1'].salaryMax === 180000, 'carries salary min/max');
  assert(byId['2'].salaryMax === null, 'null salary stays null');
  assert(byId['2'].url === 'https://adzuna.com/2', 'maps redirect_url → url');
  assert(byId['2'].postedAt === recentIso, 'maps created → postedAt');
  assert(byId['3'].company === '' && byId['3'].location === '', 'missing company/location → empty string');
}

console.log('searchJobs — entry-level + recency ranking:');
{
  stubFetch(SAMPLE);
  const jobs = await searchJobs(ENV, { title: 'Data Scientists', jobZone: 4 });
  assert(jobs.map((j) => j.id).join(',') === '2,3,1',
    'intern+recent (3pts) > junior (2pts) > senior/old (0pts)');
}

console.log('searchJobs — config guard:');
{
  stubFetch(SAMPLE);
  assert((await searchJobs({}, { title: 'x' })) === null, 'missing keys → null (no fetch)');
  assert((await searchJobs(ENV, { title: '' })) === null, 'empty title → null');
}

console.log('getJobsForCareer — cache key + write:');
{
  const kv = fakeKv();
  const getCalls = stubFetch(SAMPLE);
  const jobs = await getJobsForCareer({ ...ENV, COACH_KV: kv }, 'https://flightway.ai', { soc: '15-2051.00', title: 'Data Scientists', jobZone: 4 });
  assert(jobs.length === 3, 'returns normalized jobs on cache miss');
  assert(getCalls() === 1, 'one Adzuna fetch on miss');
  assert(kv.puts[0].k === 'jobs:v1:15-2051.00', 'cache key = jobs:v1:<soc>');
  assert(kv.puts[0].opts.expirationTtl === 24 * 3600, 'non-empty result cached 24h');

  const again = await getJobsForCareer({ ...ENV, COACH_KV: kv }, 'https://flightway.ai', { soc: '15-2051.00', title: 'Data Scientists', jobZone: 4 });
  assert(again.length === 3 && getCalls() === 1, 'second call served from cache (no refetch)');
}

console.log('getJobsForCareer — empty-result caching:');
{
  const kv = fakeKv();
  const getCalls = stubFetch([]);
  const jobs = await getJobsForCareer({ ...ENV, COACH_KV: kv }, 'https://flightway.ai', { soc: '99-9999.00', title: 'Nowhere Job', jobZone: 2 });
  assert(jobs.length === 0, 'empty career → []');
  assert(kv.puts[0].opts.expirationTtl === 6 * 3600, 'empty result cached 6h (retry sooner)');
  const again = await getJobsForCareer({ ...ENV, COACH_KV: kv }, 'https://flightway.ai', { soc: '99-9999.00', title: 'Nowhere Job', jobZone: 2 });
  assert(again.length === 0 && getCalls() === 1, 'cached [] served without re-hitting Adzuna');
}

console.log('selectRequestedCareers — cap / validation / dedupe:');
{
  const bySoc = new Map(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((s) => [s, { soc: s, title: 'Title ' + s, jobZone: 3 }]),
  );
  assert(MAX_ITEMS === 6, 'MAX_ITEMS is 6');
  const capped = selectRequestedCareers(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((s) => ({ soc: s })), bySoc,
  );
  assert(capped.length === 6 && !capped.some((c) => c.soc === 'G'), 'caps input at 6 (G dropped)');
  assert(capped[0].title === 'Title A' && capped[0].jobZone === 3, 'returns {soc,title,jobZone} from catalog');
  assert(selectRequestedCareers([{ soc: 'X' }, { soc: 'A' }], bySoc).length === 1, 'unknown SOC skipped, not 400');
  assert(selectRequestedCareers([{ soc: 'A' }, { soc: 'A' }], bySoc).length === 1, 'duplicate SOC de-duped');
  assert(selectRequestedCareers(null, bySoc).length === 0, 'non-array → []');
}

console.log(fail ? `\n${fail} FAILED` : '\nAll good.');
process.exit(fail ? 1 : 0);
