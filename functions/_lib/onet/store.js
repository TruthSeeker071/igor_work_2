import { SCHEMA_ID, DIM_COUNT, STATIC_ARTIFACT_BASE } from './constants.js';
import { deriveZoneProfilesFromAggregates } from './zone-profiles-fallback.js';
import { baseIndexFromCareers, rekeyDerivedRows } from './derive-rekey.js';

/**
 * Site-native O*NET artifact store. Artifacts are produced by `npm run onet:build`;
 * this module never calls O*NET Online. Reads static files (or optional R2 override).
 */

let manifestCache = null;
let registryCache = null;
let careersCache = null;
let similarityCache = null;
let layoutCache = null;
let socIndexCache = null;
let lvBufferCache = null;
let imBufferCache = null;
let zoneProfilesCache = null;
let derivedCareersCache = null;
// Static-sidecar portion of derived careers (R2 override → static file), cached
// for the module lifetime like the other artifacts. The D1 (runtime fragment)
// portion is cached separately with a short TTL so newly-derived rows surface.
let derivedStaticCache = null;
let derivedD1Cache = null;
let derivedD1CacheAt = 0;
const DERIVED_D1_TTL_MS = 60 * 1000;
// SOCs already appended into careersCache, so later-derived rows can still merge
// into a warm catalog cache (replaces the old `some(aiDerived)` boolean guard).
let careersDerivedSocs = null;

async function fetchJson(url, opts) {
  // derived-careers.json is edited by hand (career resets) outside the
  // onet:build ETL that the /data/* 24h edge cache is designed around — an
  // edit to its content can't bump its URL, so a plain fetch would keep
  // serving a stale cached copy for up to a day. cf.cacheTtl:0 forces this
  // one self-fetch to bypass Cloudflare's edge cache.
  const fetchOpts = opts && opts.noCache ? { cf: { cacheTtl: 0, cacheEverything: false } } : undefined;
  const res = await fetch(url, fetchOpts);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function fetchBinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.arrayBuffer();
}

function artifactUrl(baseUrl, name) {
  return new URL(`${STATIC_ARTIFACT_BASE}${name}`, baseUrl).toString();
}

async function loadFromR2(env, key) {
  if (!env.ONET_BUCKET) return null;
  const obj = await env.ONET_BUCKET.get(key);
  if (!obj) return null;
  return obj;
}

export async function getManifest(env, baseUrl) {
  if (manifestCache) return manifestCache;
  const r2 = await loadFromR2(env, 'onet/v1/manifest.json');
  if (r2) {
    manifestCache = await r2.json();
    return manifestCache;
  }
  manifestCache = await fetchJson(artifactUrl(baseUrl, 'manifest.json'));
  return manifestCache;
}

export async function getRegistry(env, baseUrl) {
  if (registryCache) return registryCache;
  const r2 = await loadFromR2(env, 'onet/v1/dimension-registry-v1.json');
  if (r2) {
    registryCache = await r2.json();
    return registryCache;
  }
  registryCache = await fetchJson(new URL('/data/onet/dimension-registry-v1.json', baseUrl).toString());
  return registryCache;
}

/**
 * "Additional Careers" sidecar: careers that don't exist in O*NET, AI-derived
 * from an adjacent base career (see scripts/derive-career.mjs). Returns the raw
 * derived row array (each carries an inline `vector` and `importance` plus the
 * full careers.json row shape). Cached like the other getters. A missing sidecar
 * is tolerated — derived careers are additive, not identity.
 */
async function getStaticDerivedCareers(env, baseUrl) {
  if (derivedStaticCache) return derivedStaticCache;
  let data = null;
  const r2 = await loadFromR2(env, 'onet/v1/derived-careers.json');
  if (r2) {
    data = await r2.json();
  } else {
    try {
      data = await fetchJson(artifactUrl(baseUrl, 'derived-careers.json'), { noCache: true });
    } catch {
      data = null;
    }
  }
  derivedStaticCache = data && Array.isArray(data.careers) ? data.careers : [];
  return derivedStaticCache;
}

// D1 (runtime fragment) portion. Cached ~60s so a SOC derived on one request
// surfaces to catalog/vector reads shortly after, without a query per read.
async function getD1DerivedCareers(env) {
  if (!env.DB) return [];
  const now = Date.now();
  if (derivedD1Cache && now - derivedD1CacheAt < DERIVED_D1_TTL_MS) return derivedD1Cache;
  try {
    const result = await env.DB.prepare('SELECT row_json FROM derived_careers').all();
    const rows = (result && result.results) || [];
    const out = [];
    for (const r of rows) {
      if (!r || !r.row_json) continue;
      try { out.push(JSON.parse(r.row_json)); } catch { /* skip corrupt row */ }
    }
    derivedD1Cache = out;
    derivedD1CacheAt = now;
    return out;
  } catch {
    return derivedD1Cache || [];
  }
}

export async function getDerivedCareers(env, baseUrl) {
  const [staticRows, d1Rows] = await Promise.all([
    getStaticDerivedCareers(env, baseUrl),
    getD1DerivedCareers(env),
  ]);
  // Merge static sidecar + D1, dedupe by soc (static wins on collision — it owns
  // the 99-0XXX range, D1 owns 99-1XXX, so collisions shouldn't happen, but be safe).
  const bySoc = new Map();
  for (const r of staticRows) {
    if (r && r.soc) bySoc.set(r.soc, r);
  }
  for (const r of d1Rows) {
    if (r && r.soc && !bySoc.has(r.soc)) bySoc.set(r.soc, r);
  }
  derivedCareersCache = Array.from(bySoc.values());
  return derivedCareersCache;
}

// Merge derived ("Additional Careers") rows into the (already-cached) catalog so
// every server consumer (career-lookup fuzzy search, switch-advisor proposals,
// vector-fit, hub metrics) sees them. Strip the inline vector/importance from the
// merged catalog rows (those are served by the vectors endpoint) to keep parity
// with the careers.json row shape. Guarded by a Set of appended SOCs — not a
// `some(aiDerived)` boolean — so a row derived AFTER the cache warmed can still
// merge on a later request, while re-entrant calls never double-append.
async function mergeDerivedIntoCareers(env, baseUrl) {
  if (!Array.isArray(careersCache)) return;
  try {
    if (!careersDerivedSocs) {
      careersDerivedSocs = new Set();
      for (const r of careersCache) {
        if (r && r.aiDerived && r.soc) careersDerivedSocs.add(r.soc);
      }
    }
    const derived = await getDerivedCareers(env, baseUrl);
    // Fragments snapshot their base's zone/color/coords at generation time, so
    // re-key them against the live catalog before they enter it (and drop the
    // ones whose base is gone) — see derive-rekey.js.
    const rekeyed = rekeyDerivedRows(derived, baseIndexFromCareers(careersCache));
    for (const d of rekeyed) {
      if (!d || !d.soc || careersDerivedSocs.has(d.soc)) continue;
      const { vector, importance, ...row } = d;
      careersCache.push(row);
      careersDerivedSocs.add(d.soc);
    }
  } catch {
    // fall through — derived careers are additive, not identity
  }
}

export async function getCareers(env, baseUrl) {
  if (careersCache) {
    // Warm cache: still re-check for later-derived rows (cheap — the D1 portion
    // is TTL-cached and the Set makes re-merge idempotent).
    await mergeDerivedIntoCareers(env, baseUrl);
    return careersCache;
  }
  const r2 = await loadFromR2(env, 'onet/v1/careers.json');
  if (r2) {
    careersCache = await r2.json();
  } else {
    careersCache = await fetchJson(artifactUrl(baseUrl, 'careers.json'));
  }
  // careers.json no longer carries descriptions — they ship as a separate
  // artifact so the client boot payload stays small. Server-side consumers
  // (career-analysis prompt context) still want them, so merge here. Every
  // consumer is null-safe, so a missing descriptions artifact is tolerated.
  if (Array.isArray(careersCache) && careersCache.length && careersCache[0].description == null) {
    try {
      const descriptions = await fetchJson(artifactUrl(baseUrl, 'career-descriptions.json'));
      for (const row of careersCache) {
        if (descriptions[row.soc] != null) row.description = descriptions[row.soc];
      }
    } catch {
      // fall through — descriptions are enrichment, not identity
    }
  }
  await mergeDerivedIntoCareers(env, baseUrl);
  return careersCache;
}

export async function getSimilarityIndex(env, baseUrl) {
  if (similarityCache) return similarityCache;
  const r2Top8 = await loadFromR2(env, 'onet/v1/similarity-top8.json');
  if (r2Top8) {
    similarityCache = await r2Top8.json();
    return similarityCache;
  }
  const r2Top50 = await loadFromR2(env, 'onet/v1/similarity-top50.json');
  if (r2Top50) {
    similarityCache = await r2Top50.json();
    return similarityCache;
  }
  try {
    similarityCache = await fetchJson(artifactUrl(baseUrl, 'similarity-top8.json'));
    return similarityCache;
  } catch {
    similarityCache = await fetchJson(artifactUrl(baseUrl, 'similarity-top50.json'));
    return similarityCache;
  }
}

export async function getLayout(env, baseUrl) {
  if (layoutCache) return layoutCache;
  const r2 = await loadFromR2(env, 'onet/v1/layout-2d.json');
  if (r2) {
    layoutCache = await r2.json();
    return layoutCache;
  }
  layoutCache = await fetchJson(artifactUrl(baseUrl, 'layout-2d.json'));
  return layoutCache;
}

export async function getSocIndex(env, baseUrl) {
  if (socIndexCache) return socIndexCache;
  const r2 = await loadFromR2(env, 'onet/v1/soc-index.json');
  if (r2) {
    socIndexCache = await r2.json();
    return socIndexCache;
  }
  socIndexCache = await fetchJson(artifactUrl(baseUrl, 'soc-index.json'));
  return socIndexCache;
}

export async function getLvBuffer(env, baseUrl) {
  if (lvBufferCache) return lvBufferCache;
  const r2 = await loadFromR2(env, 'onet/v1/vectors-lv.f32.bin');
  let buf;
  if (r2) {
    buf = await r2.arrayBuffer();
  } else {
    buf = await fetchBinary(artifactUrl(baseUrl, 'vectors-lv.f32.bin'));
  }
  lvBufferCache = new Float32Array(buf);
  return lvBufferCache;
}

export async function getImBuffer(env, baseUrl) {
  if (imBufferCache) return imBufferCache;
  const r2 = await loadFromR2(env, 'onet/v1/importance-im.f32.bin');
  let buf;
  if (r2) {
    buf = await r2.arrayBuffer();
  } else {
    buf = await fetchBinary(artifactUrl(baseUrl, 'importance-im.f32.bin'));
  }
  imBufferCache = new Float32Array(buf);
  return imBufferCache;
}

export function sliceVector(buffer, index) {
  const start = index * DIM_COUNT;
  return Array.from(buffer.subarray(start, start + DIM_COUNT));
}

export function validateSocList(socs, max = 40) {
  if (!Array.isArray(socs)) return { ok: false, error: 'socs must be an array' };
  if (socs.length === 0) return { ok: false, error: 'socs required' };
  if (socs.length > max) return { ok: false, error: `max ${max} socs per request` };
  const clean = socs.map((s) => String(s || '').trim()).filter(Boolean);
  if (clean.length !== socs.length) return { ok: false, error: 'invalid soc' };
  return { ok: true, socs: clean };
}

export async function getZoneDimensionProfiles(env, baseUrl) {
  if (zoneProfilesCache) return zoneProfilesCache;
  const r2 = await loadFromR2(env, 'onet/v1/zone-dimension-profiles.json');
  if (r2) {
    zoneProfilesCache = await r2.json();
    return zoneProfilesCache;
  }
  try {
    zoneProfilesCache = await fetchJson(artifactUrl(baseUrl, 'zone-dimension-profiles.json'));
    return zoneProfilesCache;
  } catch {
    const aggregates = await fetchJson(artifactUrl(baseUrl, 'zone-aggregate-vectors.json'));
    zoneProfilesCache = deriveZoneProfilesFromAggregates(aggregates);
    return zoneProfilesCache;
  }
}

export function clearOnetCache() {
  manifestCache = null;
  registryCache = null;
  careersCache = null;
  similarityCache = null;
  layoutCache = null;
  socIndexCache = null;
  lvBufferCache = null;
  imBufferCache = null;
  zoneProfilesCache = null;
  derivedCareersCache = null;
  derivedStaticCache = null;
  derivedD1Cache = null;
  derivedD1CacheAt = 0;
  careersDerivedSocs = null;
}

export { SCHEMA_ID, DIM_COUNT };
