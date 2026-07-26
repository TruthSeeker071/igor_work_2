/**
 * Site-native O*NET career catalog — single loader for careers.json + hub bridge.
 * Data is imported once via `npm run onet:build`; runtime reads deployed artifacts only.
 */
(function (global) {
  // Bumped with the 2026-07-18 macro-hub rezone (18→11 hubZones) — careers.json
  // changed and /data/* is day-cached, so a stale stamp serves the old taxonomy.
  var CAREERS_URL = '/data/onet/artifacts/careers.json?v=20260718f';
  var DESCRIPTIONS_URL = '/data/onet/artifacts/career-descriptions.json?v=20260703q';
  var DERIVED_URL = '/data/onet/artifacts/derived-careers.json?v=20260703q';
  var HUB_MAP_URL = '/data/onet/hub-career-soc-map.json';

  // CANONICAL legacy-slug alias table. hub-careers.js and
  // career-focus-migrate.js delegate here at runtime and keep fallback copies
  // only for load order; functions/_lib/roadmap-sync.js holds the server copy.
  // scripts/verify-slug-aliases.mjs asserts all four stay identical.
  var SLUG_ALIASES = {
    'software-engineering': 'software-engineer',
    'data-science': 'data-scientist',
    'ux-design': 'ux-designer',
    'product-management': 'product-manager',
    'investment-banking': 'investment-banker',
    'financial-analysis': 'financial-analyst',
    'management-consulting': 'operations-manager',
    'marketing-strategy': 'content-strategist',
    'business-analytics': 'financial-analyst',
    'corporate-strategy': 'operations-manager',
    'healthcare-admin': 'nurse',
    'legal-operations': 'paralegal',
  };

  var loadPromise = null;
  var allRows = [];        // full row set (pre-mvp-filter), retained for re-indexing
  var derivedFetches = {}; // soc -> in-flight ensureDerivedRow promise
  var careers = [];
  var bySoc = {};
  var bySlug = {};
  var byZone = {};
  var hubMap = null;
  var socToLegacySlug = {};
  var hubIdToSlug = {};
  var slugToHubId = {};

  function slugify(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function normalizeSlug(slug) {
    var s = String(slug || '').trim().toLowerCase();
    if (!s) return '';
    return SLUG_ALIASES[s] || s;
  }

  function buildIndexes(rows, map) {
    allRows = rows;
    careers = rows.filter(function (row) {
      return row && row.mvpInScope !== false && row.soc && row.title;
    });
    bySoc = {};
    bySlug = {};
    byZone = {};
    socToLegacySlug = {};
    hubIdToSlug = {};
    slugToHubId = {};

    careers.forEach(function (row) {
      bySoc[row.soc] = row;
      var titleSlug = slugify(row.title);
      if (!bySlug[titleSlug]) bySlug[titleSlug] = row;
      if (!byZone[row.hubZone]) byZone[row.hubZone] = [];
      byZone[row.hubZone].push(row);
    });

    if (map && map.careers) {
      Object.keys(map.careers).forEach(function (hubId) {
        var entry = map.careers[hubId];
        var legacySlug = slugify(entry.name);
        hubIdToSlug[hubId] = legacySlug;
        slugToHubId[legacySlug] = Number(hubId);
        var normalized = normalizeSlug(legacySlug);
        if (normalized !== legacySlug) slugToHubId[normalized] = Number(hubId);
        (entry.socs || []).forEach(function (s) {
          if (s && s.soc && !socToLegacySlug[s.soc]) {
            socToLegacySlug[s.soc] = legacySlug;
          }
        });
      });
    }
  }

  var descPromise = null;
  var descMap = null;

  function applyDescriptions() {
    if (!descMap) return;
    careers.forEach(function (row) {
      if (row.description == null && descMap[row.soc] != null) row.description = descMap[row.soc];
    });
  }

  // Descriptions live in a separate artifact so the boot-critical catalog
  // stays small. They merge into the same row objects in place, so any
  // reference held to a row (or a getter reading one) sees them on arrival.
  function loadDescriptions() {
    if (!descPromise) {
      descPromise = fetch(DESCRIPTIONS_URL).then(function (r) { return r.json(); }).then(function (map) {
        descMap = map || {};
        applyDescriptions();
        return descMap;
      }).catch(function (err) {
        console.warn('[FWOnetCatalog] descriptions load failed', err);
        descPromise = null;
        return {};
      });
    }
    return descPromise;
  }

  // Resolves as soon as the catalog rows/indexes exist; descriptions keep
  // loading in the background. Use for boot paths that only need identity,
  // layout, and titles (the hub map).
  function loadCore() {
    if (careers.length && hubMap) return Promise.resolve(careers);
    if (!loadPromise) {
      loadPromise = Promise.all([
        fetch(CAREERS_URL).then(function (r) { return r.json(); }),
        fetch(HUB_MAP_URL).then(function (r) { return r.json(); }).catch(function () { return null; }),
        // "Additional Careers" sidecar: careers that don't exist in O*NET,
        // AI-derived from an adjacent base career. Rows match the careers.json
        // shape (plus aiDerived/derivedFrom/description) so every consumer of
        // the row list picks them up. Merged BEFORE buildIndexes so they land
        // in bySoc/bySlug/byZone/searchByTitle automatically. Missing/failed
        // sidecar is tolerated — it's additive, not identity.
        fetch(DERIVED_URL).then(function (r) { return r.json(); }).catch(function () { return null; }),
      ]).then(function (parts) {
        var data = parts[0];
        var rows = Array.isArray(data) ? data : (data && data.careers) || [];
        hubMap = parts[1];
        var derived = parts[2];
        var derivedRows = derived && Array.isArray(derived.careers) ? derived.careers : [];
        if (derivedRows.length) rows = rows.concat(derivedRows);
        buildIndexes(rows, hubMap);
        applyDescriptions();
        // Descriptions (~185KB) are enrichment for drawers/panels, never for
        // first paint — start them once the caller's boot work has settled so
        // they stop competing with the boot-critical fetches. Anything that
        // needs the text sooner (`load()`, the hub panel) calls
        // loadDescriptions() itself; the promise is memoized, so it races safely.
        if (typeof global.requestIdleCallback === 'function') {
          global.requestIdleCallback(loadDescriptions, { timeout: 2000 });
        } else {
          setTimeout(loadDescriptions, 600);
        }
        return careers;
      }).catch(function (err) {
        console.warn('[FWOnetCatalog] load failed', err);
        careers = [];
        loadPromise = null;
        return careers;
      });
    }
    return loadPromise;
  }

  // Original contract: rows are fully populated (descriptions included) when
  // this resolves. Both fetches run in parallel, so this is no slower than
  // the old single-file load.
  function load() {
    return loadCore().then(function (rows) {
      if (!rows.length) return rows;
      return loadDescriptions().then(function () { return rows; });
    });
  }

  function getAll() {
    return careers;
  }

  function getBySoc(soc) {
    return soc ? (bySoc[soc] || null) : null;
  }

  function getBySlug(slug) {
    if (!slug) return null;
    var norm = normalizeSlug(slug);
    return bySlug[norm] || bySlug[slug] || null;
  }

  function getByZone(zone) {
    return byZone[zone] ? byZone[zone].slice() : [];
  }

  function getTitle(soc) {
    var row = getBySoc(soc);
    return row ? row.title : (soc || '');
  }

  function getLegacySlugForSoc(soc) {
    return socToLegacySlug[soc] || null;
  }

  function getLegacySlugForHubId(hubId) {
    return hubIdToSlug[String(hubId)] || hubIdToSlug[hubId] || null;
  }

  function getHubMap() {
    return hubMap;
  }

  function canonicalSlugForRow(row) {
    if (!row) return '';
    var legacy = getLegacySlugForSoc(row.soc);
    if (legacy) return legacy;
    return slugify(row.title);
  }

  function toCanonical(row) {
    if (!row) return null;
    return {
      soc: row.soc,
      name: row.title,
      slug: canonicalSlugForRow(row),
      hubZone: row.hubZone,
    };
  }

  function findHubIdForSlug(slug) {
    if (!slug) return null;
    var norm = normalizeSlug(slug);
    var hubId = slugToHubId[norm] || slugToHubId[slug];
    if (hubId) return hubId;
    if (!hubMap || !hubMap.careers) return null;
    var hitKey = Object.keys(hubMap.careers).find(function (id) {
      var entry = hubMap.careers[id];
      var ls = slugify(entry.name);
      return ls === norm || ls === slug || normalizeSlug(ls) === norm;
    });
    return hitKey ? Number(hitKey) : null;
  }

  function resolveCanonical(slug, soc) {
    return load().then(function () {
      if (soc) {
        var bySocRow = getBySoc(soc);
        if (bySocRow) return toCanonical(bySocRow);
      }
      if (slug) {
        var norm = normalizeSlug(slug);
        var bySlugRow = getBySlug(norm) || getBySlug(slug);
        if (bySlugRow) return toCanonical(bySlugRow);
        var hubId = findHubIdForSlug(slug);
        if (hubId && hubMap && hubMap.careers && hubMap.careers[hubId]) {
          var entry = hubMap.careers[hubId];
          var primarySoc = entry.socs && entry.socs[0] ? entry.socs[0].soc : null;
          if (primarySoc) {
            var row = getBySoc(primarySoc);
            if (row) return toCanonical(row);
          }
        }
      }
      return null;
    });
  }

  function socFromHubSlug(hubSlug) {
    return load().then(function () {
      if (!hubSlug) return null;
      var hubId = findHubIdForSlug(hubSlug);
      if (!hubId || !hubMap || !hubMap.careers[hubId]) return null;
      var entry = hubMap.careers[hubId];
      var socs = entry.socs || [];
      return socs.length ? socs[0].soc : null;
    });
  }

  function normalizeSearch(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function singularizeToken(token) {
    var t = String(token || '');
    if (t.length > 3 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.length > 3 && t.endsWith('es')) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
    return t;
  }

  function normalizeTokens(text) {
    return normalizeSearch(text).split(' ').filter(Boolean).map(singularizeToken).join(' ');
  }

  function searchByTitle(query, limit) {
    var q = normalizeSearch(query);
    var qTokens = normalizeTokens(query);
    if (!q) return [];
    limit = limit || 12;
    return careers.map(function (row) {
      var title = normalizeSearch(row.title);
      var titleNorm = row.titleNorm || title;
      var titleTokens = normalizeTokens(row.title);
      var score = 0;
      if (title === q || titleTokens === qTokens) score = 200;
      else if (title.indexOf(q) === 0 || titleTokens.indexOf(qTokens) === 0) score = 150;
      else if (title.indexOf(q) !== -1 || titleNorm.indexOf(q) !== -1 || titleTokens.indexOf(qTokens) !== -1) score = 100;
      else if (qTokens.indexOf(titleTokens) !== -1) score = 80;
      return score > 0 ? { row: row, score: score } : null;
    }).filter(Boolean).sort(function (a, b) {
      return b.score - a.score || b.row.title.length - a.row.title.length;
    }).slice(0, limit).map(function (hit) {
      return toCanonical(hit.row);
    });
  }

  function descriptionFor(soc) {
    var row = getBySoc(soc);
    return row && row.description ? row.description : '';
  }

  // Append runtime-derived rows (from /derive-career) not already present (by
  // soc) and rebuild indexes so they resolve via getBySoc/getBySlug/searchByTitle.
  // Rows match the careers.json shape (aiDerived/derivedFrom/description). Returns
  // the count actually added.
  function addDerivedRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    var added = 0;
    rows.forEach(function (row) {
      if (!row || !row.soc || !row.title) return;
      if (bySoc[row.soc]) return;
      allRows.push(row);
      added += 1;
    });
    if (added) buildIndexes(allRows, hubMap);
    return added;
  }

  // Resolve a derived row on demand: if getBySoc misses and the soc is synthetic
  // (99-…), fetch the single row from /derive-career?soc=, merge it, and return
  // it. Memoized per soc. Resolves to null on any failure (tolerant).
  function ensureDerivedRow(soc) {
    if (!soc) return Promise.resolve(null);
    var existing = getBySoc(soc);
    if (existing) return Promise.resolve(existing);
    if (String(soc).indexOf('99-') !== 0) return Promise.resolve(null);
    if (derivedFetches[soc]) return derivedFetches[soc];
    var p = fetch('/derive-career?soc=' + encodeURIComponent(soc)).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      var row = data && data.row;
      if (row) addDerivedRows([row]);
      return getBySoc(soc);
    }).catch(function () {
      return null;
    }).then(function (result) {
      delete derivedFetches[soc];
      return result;
    });
    derivedFetches[soc] = p;
    return p;
  }

  global.FWOnetCatalog = {
    load: load,
    loadCore: loadCore,
    loadDescriptions: loadDescriptions,
    descriptionFor: descriptionFor,
    getAll: getAll,
    getBySoc: getBySoc,
    getBySlug: getBySlug,
    getByZone: getByZone,
    getTitle: getTitle,
    getLegacySlugForSoc: getLegacySlugForSoc,
    getLegacySlugForHubId: getLegacySlugForHubId,
    getHubMap: getHubMap,
    resolveCanonical: resolveCanonical,
    socFromHubSlug: socFromHubSlug,
    slugify: slugify,
    normalizeSlug: normalizeSlug,
    SLUG_ALIASES: SLUG_ALIASES,
    canonicalSlugForRow: canonicalSlugForRow,
    toCanonical: toCanonical,
    searchByTitle: searchByTitle,
    addDerivedRows: addDerivedRows,
    ensureDerivedRow: ensureDerivedRow,
  };
})(typeof window !== 'undefined' ? window : globalThis);
