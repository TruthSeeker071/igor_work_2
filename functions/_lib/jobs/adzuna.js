// Adzuna Search API client (Good Fit Jobs). Free-tier, US-only for v1.
// Every call has an explicit abort timeout (Workers fetch has none) and soft-fails
// to null — never throws past the caller. All returned text is normalized/stripped;
// raw Adzuna description HTML is never stored or returned.

const ADZUNA_SEARCH_BASE = 'https://api.adzuna.com/v1/api/jobs/us/search';
const FETCH_TIMEOUT_MS = 6000;
const MAX_DAYS_OLD = 30;

// Title tokens that mark an entry-level / early-career posting (used for ranking).
const ENTRY_LEVEL_RE = /\b(intern|internship|junior|entry|graduate|trainee)\b/i;

/** Strip HTML tags and decode the handful of entities Adzuna emits in titles. */
function stripHtml(str) {
  return String(str == null ? '' : str)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Career title → Adzuna `what` keywords: lowercase, drop parentheticals, collapse space. */
function toKeywords(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Days between an ISO date and now (Infinity if unparseable). */
function daysAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

/** Normalize one Adzuna result row to our stored shape. Untrusted text is stripped. */
function normalizeResult(r) {
  if (!r || typeof r !== 'object') return null;
  const url = typeof r.redirect_url === 'string' ? r.redirect_url : '';
  if (!/^https?:\/\//i.test(url)) return null; // no usable link → drop
  const title = stripHtml(r.title);
  if (!title) return null;
  // Note: Number(null) === 0 (finite), so guard null/'' explicitly or a missing
  // salary would render as "$0".
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Math.round(Number(v));
  const salaryMin = num(r.salary_min);
  const salaryMax = num(r.salary_max);
  return {
    id: String(r.id || url).slice(0, 64),
    title: title.slice(0, 160),
    company: stripHtml(r.company && r.company.display_name).slice(0, 120),
    location: stripHtml(r.location && r.location.display_name).slice(0, 120),
    salaryMin,
    salaryMax,
    url,
    postedAt: typeof r.created === 'string' ? r.created : null,
  };
}

/** Rank early-career-relevant, recent postings first. Stable sort (input is date-sorted). */
function rankJobs(jobs) {
  const scored = jobs.map((j, i) => {
    let score = 0;
    if (ENTRY_LEVEL_RE.test(j.title)) score += 2;
    if (daysAgo(j.postedAt) <= 7) score += 1;
    return { j, score, i };
  });
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return scored.map((s) => s.j);
}

/**
 * Search Adzuna for postings matching a career. Returns a normalized+ranked array
 * (up to resultsPerPage), or null on missing config / non-OK / timeout / parse error.
 * Never throws.
 */
export async function searchJobs(env, { title, jobZone, page = 1, resultsPerPage = 10 } = {}) {
  const appId = env && env.ADZUNA_APP_ID;
  const appKey = env && env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return null;

  const what = toKeywords(title);
  if (!what) return null;

  // Entry-level targeting: broaden with OR terms, never hard-filter (what_and is
  // too strict and empties results for many careers). Zone drives which terms.
  const zone = Number(jobZone) || 0;
  const whatOr = zone > 0 && zone <= 3
    ? 'intern internship junior entry graduate assistant'
    : 'junior entry associate analyst assistant';

  const params = new URLSearchParams({
    app_id: String(appId),
    app_key: String(appKey),
    what,
    what_or: whatOr,
    max_days_old: String(MAX_DAYS_OLD),
    results_per_page: String(Math.min(Math.max(resultsPerPage, 1), 50)),
    sort_by: 'date',
    'content-type': 'application/json',
  });

  const url = `${ADZUNA_SEARCH_BASE}/${Math.max(1, page | 0)}?${params.toString()}`;

  let data;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!resp.ok) return null;
    data = await resp.json();
  } catch {
    return null; // timeout, network, or parse failure — soft-fail
  }

  const results = data && Array.isArray(data.results) ? data.results : [];
  const normalized = results.map(normalizeResult).filter(Boolean);
  return rankJobs(normalized).slice(0, resultsPerPage);
}
