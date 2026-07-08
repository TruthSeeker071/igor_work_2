/**
 * Career Hub zone overall-fit — single client source (O*NET aggregates + vectors).
 */
(function (global) {
  var ZONE_ORDER = [
    'tech', 'healthcare', 'finance', 'science', 'engineering', 'creative',
    'business', 'marketing', 'education', 'law', 'social', 'media',
    'government', 'operations', 'trades', 'agriculture', 'cybersecurity', 'hospitality',
  ];

  var ZONE_LABELS = {
    tech: 'Tech',
    healthcare: 'Healthcare',
    finance: 'Finance',
    science: 'Science',
    engineering: 'Engineering',
    creative: 'Creative',
    business: 'Business',
    marketing: 'Marketing',
    education: 'Education',
    law: 'Law',
    social: 'Social',
    media: 'Media',
    government: 'Government',
    operations: 'Operations',
    trades: 'Trades',
    agriculture: 'Agriculture',
    cybersecurity: 'Cybersecurity',
    hospitality: 'Hospitality',
  };

  var AGGREGATES_URL = '/data/onet/artifacts/zone-aggregate-vectors.json';
  var cachedRows = null;
  var pendingResolve = null;
  var hubHookBound = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function zoneLabel(id) {
    return ZONE_LABELS[id] || String(id || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function tierBarStyle(score) {
    if (global.FWCareerTarget && typeof FWCareerTarget.fitRarity === 'function') {
      return FWCareerTarget.fitRarity(score).base;
    }
    return 'rgb(var(--primary))';
  }

  function cosinePercent(V, cos) {
    if (V.cosinePercent) return V.cosinePercent(cos);
    return V.clamp100(Math.round((cos || 0) * 100));
  }

  function objectiveActive(objective) {
    if (!objective || !objective.values || !global.FWOnetVectors) return false;
    if (typeof FWOnetVectors.isObjectiveVectorActive === 'function') {
      return FWOnetVectors.isObjectiveVectorActive(objective.values);
    }
    return FWOnetVectors.magnitude(objective.values) > 0.01;
  }

  function computeZoneFitsMap(personality, objective, aggregates) {
    if (!personality || !personality.values || !aggregates || !global.FWOnetVectors) return {};
    var V = FWOnetVectors;
    var objOn = objectiveActive(objective);
    var byZone = {};
    Object.keys(aggregates).forEach(function (zone) {
      var agg = aggregates[zone];
      if (!agg || !agg.lvMean || !agg.count) return;
      var pFit = cosinePercent(V, V.cosine(personality.values, agg.lvMean));
      var oFit = objOn && V.objectiveFitFromVectors
        ? V.objectiveFitFromVectors(objective.values, agg.lvMean)
        : (objOn ? cosinePercent(V, V.cosine(objective.values, agg.lvMean)) : null);
      byZone[zone] = {
        personalityFit: pFit,
        rawPersonality: pFit,
        objectiveFit: oFit,
        rawObjective: oFit != null ? oFit : null,
        overallFit: V.overallFitScore ? V.overallFitScore(pFit, oFit) : pFit,
      };
    });
    return byZone;
  }

  function zoneRowsFromMap(map) {
    return ZONE_ORDER.map(function (id) {
      var fit = map && map[id];
      var score = fit && fit.overallFit != null ? fit.overallFit
        : (fit && fit.personalityFit != null ? fit.personalityFit : 0);
      return { id: id, name: zoneLabel(id), score: Math.round(score) };
    }).filter(function (z) { return z.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  function zoneFitsFromHub() {
    if (!global.FWOnetHub || typeof FWOnetHub.isReady !== 'function' || !FWOnetHub.isReady()) {
      return null;
    }
    var map = {};
    ZONE_ORDER.forEach(function (id) {
      var fit = typeof FWOnetHub.getZoneFit === 'function' ? FWOnetHub.getZoneFit(id) : null;
      if (fit) map[id] = fit;
    });
    return zoneRowsFromMap(map);
  }

  function invalidateZoneFitCache() {
    cachedRows = null;
    pendingResolve = null;
  }

  function getCachedZoneFits() {
    return cachedRows ? cachedRows.slice() : null;
  }

  function notifyZoneFitsUpdated(rows) {
    try {
      global.dispatchEvent(new CustomEvent('fw-zone-fits-updated', { detail: { rows: rows || [] } }));
    } catch (_) { /* ignore */ }
  }

  function bindHubVectorHook() {
    if (hubHookBound || !global.FWOnetHub) return;
    hubHookBound = true;
    var prev = FWOnetHub.onVectorsUpdated;
    FWOnetHub.onVectorsUpdated = function () {
      invalidateZoneFitCache();
      resolveZoneFits().then(function (rows) {
        notifyZoneFitsUpdated(rows);
      });
      if (typeof prev === 'function') prev();
    };
  }

  function resolveZoneFits() {
    var fromHub = zoneFitsFromHub();
    if (fromHub && fromHub.length) {
      cachedRows = fromHub;
      bindHubVectorHook();
      notifyZoneFitsUpdated(fromHub);
      return Promise.resolve(fromHub);
    }
    if (cachedRows && cachedRows.length) {
      return Promise.resolve(cachedRows);
    }
    if (pendingResolve) return pendingResolve;

    if (!global.FWOnetVectors) return Promise.resolve([]);

    pendingResolve = FWOnetVectors.resolvePersonality().then(function (personality) {
      if (!personality) return [];
      var quiz = FWOnetVectors.readQuizVectors();
      return fetch(AGGREGATES_URL)
        .then(function (r) { return r.json(); })
        .then(function (agg) {
          var map = computeZoneFitsMap(personality, quiz.objective, agg);
          return zoneRowsFromMap(map);
        })
        .catch(function () { return []; });
    }).then(function (rows) {
      cachedRows = rows;
      pendingResolve = null;
      bindHubVectorHook();
      if (rows && rows.length) notifyZoneFitsUpdated(rows);
      return rows;
    }).catch(function () {
      pendingResolve = null;
      return [];
    });

    return pendingResolve;
  }

  function prefetchZoneFitsForPortal() {
    return resolveZoneFits();
  }

  function renderHubZoneFitSheet(zoneRows, opts) {
    var rows = (zoneRows || []).slice();
    if (!rows.length) return '';
    var html = rows.map(function (it) {
      var color = tierBarStyle(it.score);
      return '<div class="portal-sector-row">'
        + '<div class="portal-sector-head">'
        + '<span class="portal-sector-label">' + esc(it.name) + '</span>'
        + '<span class="portal-sector-score">' + it.score + '%</span>'
        + '</div>'
        + '<div class="portal-sector-bar-wrap">'
        + '<div class="portal-sector-bar" style="width:' + it.score + '%;background:' + color + '"></div>'
        + '</div>'
        + '</div>';
    }).join('');
    return '<div class="portal-sector-sheet">'
      + '<div class="portal-sector-sheet-grid">' + html + '</div>'
      + '</div>';
  }

  function profileEntryHint(zoneRows) {
    var top = (zoneRows || []).slice(0, 2);
    if (!top.length) return '';
    return top.map(function (z) { return z.name; }).join(' · ');
  }

  function topZoneLabels(n) {
    var rows = getCachedZoneFits() || zoneFitsFromHub();
    if (!rows || !rows.length) return [];
    return rows.slice(0, n || 3).map(function (z) { return z.name; });
  }

  global.FWHubZoneFit = {
    ZONE_ORDER: ZONE_ORDER,
    ZONE_LABELS: ZONE_LABELS,
    computeZoneFitsMap: computeZoneFitsMap,
    zoneRowsFromMap: zoneRowsFromMap,
    zoneFitsFromHub: zoneFitsFromHub,
    resolveZoneFits: resolveZoneFits,
    getCachedZoneFits: getCachedZoneFits,
    invalidateZoneFitCache: invalidateZoneFitCache,
    prefetchZoneFitsForPortal: prefetchZoneFitsForPortal,
    renderHubZoneFitSheet: renderHubZoneFitSheet,
    profileEntryHint: profileEntryHint,
    topZoneLabels: topZoneLabels,
    tierBarStyle: tierBarStyle,
    zoneLabel: zoneLabel,
  };
}(typeof window !== 'undefined' ? window : globalThis));
