/**
 * FlightWay V2 S13 — the loader behind the public career pages.
 *
 * `career-page.js` is pure and knows nothing about env; this file is the half
 * that touches the O*NET artifact store, and it exists so the route files stay
 * short and the sitemap, the directory and the detail page all resolve slugs
 * through ONE index rather than three.
 *
 * Everything is cached for the isolate's life. The artifacts are immutable
 * build outputs (`npm run onet:build`), so a per-isolate cache can only ever be
 * stale for as long as the isolate lives after a deploy — and the KV render
 * cache above it is versioned by CAREER_PAGE_VERSION anyway.
 */
import { getCareers, getLvBuffer, getImBuffer, getRegistry, getSimilarityIndex } from './onet/store.js';
import { DIM_COUNT } from './onet/constants.js';
import { buildCatalogIndex } from './career-page.js';

let indexCache = null;
let hubMapCache = null;
let salaryCache = null;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function getHubMap(baseUrl) {
  if (hubMapCache) return hubMapCache;
  try {
    hubMapCache = await fetchJson(new URL('/data/onet/hub-career-soc-map.json', baseUrl).toString());
  } catch {
    // The hub map only supplies LEGACY slugs. Without it every career still has
    // a page — at its title slug — so degrade rather than fail the route.
    hubMapCache = { careers: {} };
  }
  return hubMapCache;
}

export async function getSalaryTiers(baseUrl) {
  if (salaryCache) return salaryCache;
  try {
    salaryCache = await fetchJson(new URL('/assets/data/salary-tiers.json', baseUrl).toString());
  } catch {
    salaryCache = {};
  }
  return salaryCache;
}

/**
 * The routing + directory index over every PUBLISHABLE career.
 *
 * AI-derived careers (`aiDerived`, the 99-xxxx SOC range) are excluded on
 * purpose. They are generated on demand for one user out of an adjacent base
 * career, they appear and disappear as people reset their targets, and their
 * text is model output rather than O*NET data. A public URL that exists because
 * one student once typed a job title is exactly the thin, unstable page Google
 * penalizes a whole domain for. They stay fully available inside the app.
 */
export async function loadCareerIndex(env, baseUrl) {
  if (indexCache) return indexCache;
  const [careers, hubMap] = await Promise.all([getCareers(env, baseUrl), getHubMap(baseUrl)]);
  const publishable = (careers || []).filter((r) => r && r.aiDerived !== true);
  indexCache = buildCatalogIndex({ careers: publishable, hubMap });
  return indexCache;
}

/** [{ name, domain, lv, im }] for one career — both already 0–100. */
export async function dimensionsFor(env, baseUrl, row) {
  if (!row || typeof row.vectorIndex !== 'number') return [];
  const [registry, lv, im] = await Promise.all([
    getRegistry(env, baseUrl), getLvBuffer(env, baseUrl), getImBuffer(env, baseUrl),
  ]);
  const dims = (registry && registry.dimensions) || [];
  const start = row.vectorIndex * DIM_COUNT;
  if (start < 0 || start + DIM_COUNT > lv.length) return [];
  const out = [];
  for (let i = 0; i < DIM_COUNT && i < dims.length; i += 1) {
    out.push({ name: dims[i].name, domain: dims[i].domain, lv: lv[start + i], im: im[start + i] });
  }
  return out;
}

/**
 * Nearest neighbours by O*NET profile, then same-sector fill.
 * Returns { related, sameSector } — both arrays of catalog rows, disjoint, so
 * the two link blocks on the page never repeat each other.
 */
export async function neighboursFor(env, baseUrl, index, row, { relatedCount = 6, sectorCount = 8 } = {}) {
  const related = [];
  const seen = new Set([row.soc]);
  try {
    const sim = await getSimilarityIndex(env, baseUrl);
    for (const hit of (sim && sim[row.soc]) || []) {
      if (related.length >= relatedCount) break;
      const other = index.bySoc.get(hit && hit.soc);
      if (!other || seen.has(other.soc)) continue;
      seen.add(other.soc);
      related.push(other);
    }
  } catch {
    // similarity is enrichment; a page without it is still a page
  }

  const sameZone = index.sectors.find((s) => s.key === row.hubZone);
  const pool = (sameZone && sameZone.rows) || [];
  // Fill `related` from the same sector when similarity came up short, so the
  // block is never a lonely one-link list on a career with sparse neighbours.
  for (const other of pool) {
    if (related.length >= relatedCount) break;
    if (seen.has(other.soc)) continue;
    seen.add(other.soc);
    related.push(other);
  }
  const sameSector = [];
  for (const other of pool) {
    if (sameSector.length >= sectorCount) break;
    if (seen.has(other.soc)) continue;
    seen.add(other.soc);
    sameSector.push(other);
  }
  return { related, sameSector };
}

/** Test seam — the gates load artifacts from disk and must not inherit a
 *  cache built from a different fixture. */
export function clearCareerPageCache() {
  indexCache = null;
  hubMapCache = null;
  salaryCache = null;
}
