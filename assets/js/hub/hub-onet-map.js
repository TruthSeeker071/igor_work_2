/**
 * O*NET Career Hub — overview zone tiles + full sector render.
 */
(function () {
  var VECTOR_FETCH_BATCH = 40;
  var ARTIFACT_BASE = '/data/onet/artifacts/';
  var FETCH_TIMEOUT_MS = 12000;
  var initPromise = null;
  var SIMILARITY_ADJACENT = 0.75;
  var SIMILARITY_RELATED = 0.55;
  var MIN_LINKS_PER_NODE = 1;
  var MAX_LINKS_PER_NODE = 3;

  var LOD_CONTINENT_ZOOM = 2.2;
  var LOD_REGION_ZOOM = 4.8;
  var DEFAULT_ZOOM = 1.8;
  var OVERVIEW_FILL = 0.94;
  var OVERVIEW_TOPBAR_FALLBACK_PX = 64;
  var MIN_ZOOM = 0.5;
  var MAX_ZOOM = 3.0;
  var SECTOR_ENTRY_ZOOM = 3.0;
  var SECTOR_EXIT_ZOOM = 2.6;
  var SECTOR_ZOOM_MIN = 0.7;
  var SECTOR_ZOOM_MAX = 2.2;
  var SECTOR_FLY_ZOOM = 1.8;
  var FLY_TO_ZOOM = 3.0;

  var ZONE_LABEL_FONT = 11;

  var DEFAULT_WORLD_W = 1200;
  var DEFAULT_WORLD_H = 525;
  var SECTOR_CANVAS_W = 2560;
  var SECTOR_CANVAS_H = 1440;
  var LAYOUT_PAD = 24;

  function titleCaseZone(z) {
    return String(z || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function slugify(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  var state = {
    all: [],
    renderCareers: [],
    mountedIds: new Set(),
    renderMeta: { lod: 'continent', orbAlpha: 1, hubMode: 'overview' },
    visibleZoneLabels: [],
    zoneTiles: [],
    careersByZone: {},
    similarityLinks: [],
    zoneLayout: null,
    zoneCentroids: null,
    similarityIndex: null,
    personality: null,
    objective: null,
    vectorCache: {},
    ready: false,
    vectorQueue: null,
    onVectorsUpdated: null,
    hubMode: 'overview',
    activeZone: null,
    sectorZoom: 1,
    sectorEntryFrames: 0,
    zoneColors: {},
    zoneAggregateVectors: null,
    zoneFits: {},
    registry: null,
  };

  function worldW() {
    if (state.hubMode === 'sector') {
      return (state.zoneLayout && state.zoneLayout.sectorCanvas && state.zoneLayout.sectorCanvas.w) || SECTOR_CANVAS_W;
    }
    return (state.zoneLayout && state.zoneLayout.worldW) || DEFAULT_WORLD_W;
  }

  function worldH() {
    if (state.hubMode === 'sector') {
      return (state.zoneLayout && state.zoneLayout.sectorCanvas && state.zoneLayout.sectorCanvas.h) || SECTOR_CANVAS_H;
    }
    return (state.zoneLayout && state.zoneLayout.worldH) || DEFAULT_WORLD_H;
  }

  function notifyVectorsUpdated() {
    if (typeof state.onVectorsUpdated === 'function') {
      try { state.onVectorsUpdated(); } catch (e) { /* ignore */ }
    }
  }

  function fetchWithTimeout(url, ms) {
    var timeoutMs = ms || FETCH_TIMEOUT_MS;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    return fetch(url, { signal: controller.signal })
      .finally(function () { clearTimeout(timer); });
  }

  function fetchArtifactJson(url) {
    return fetchWithTimeout(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function fetchArtifactJsonOptional(url) {
    return fetchWithTimeout(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function getOverviewZoneCount() {
    return getOverviewZones().length;
  }

  function initReadyFromData(rows) {
    if (!rows || !rows.length) return false;
    if (!state.zoneLayout || !state.zoneLayout.zones) return false;
    return getOverviewZoneCount() > 0;
  }

  function getLodTier(zoom) {
    if (state.hubMode === 'sector') return 'local';
    if (zoom < LOD_CONTINENT_ZOOM) return 'continent';
    if (zoom < LOD_REGION_ZOOM) return 'region';
    return 'local';
  }

  function zoneInnerBounds(zoneId) {
    var b = state.zoneLayout && state.zoneLayout.zones && state.zoneLayout.zones[zoneId];
    if (!b) return null;
    return {
      minX: b.minX + LAYOUT_PAD,
      maxX: b.maxX - LAYOUT_PAD,
      minY: b.minY + LAYOUT_PAD,
      maxY: b.maxY - LAYOUT_PAD,
      labelX: b.labelX,
      labelY: b.labelY,
    };
  }

  function sectorBaseZoom(zoneId, viewW, viewH) {
    var wW = worldW();
    var wH = worldH();
    var zoomX = (2 * wW) / (0.85 * wW);
    var zoomY = (2 * wH) / (0.85 * wH);
    return Math.min(zoomX, zoomY);
  }

  function sectorCareerBBox(zoneId) {
    var careers = state.careersByZone[zoneId] || [];
    if (!careers.length) return null;
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    careers.forEach(function (c) {
      var pos = careerWorldXY(c);
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.y > maxY) maxY = pos.y;
    });
    var spanW = Math.max(maxX - minX, 1);
    var spanH = Math.max(maxY - minY, 1);
    return {
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      spanW: spanW,
      spanH: spanH,
    };
  }

  function sectorEntryZoom(zoneId, viewW, viewH) {
    var bbox = sectorCareerBBox(zoneId);
    if (!bbox) return DEFAULT_ZOOM;
    var wW = worldW();
    var wH = worldH();
    var fill = 0.90;
    var zoomX = fill * wW / bbox.spanW;
    var zoomY = fill * wH / bbox.spanH;
    return Math.min(zoomX, zoomY, sectorBaseZoom(zoneId, viewW, viewH));
  }

  function sectorEffectiveZoom(zoneId, sectorZoom, viewW, viewH) {
    var sz = sectorZoom != null ? sectorZoom : state.sectorZoom;
    var entry = sectorEntryZoom(zoneId, viewW, viewH);
    var cap = sectorBaseZoom(zoneId, viewW, viewH);
    return Math.min(entry * sz, cap);
  }

  function effectiveWorldZoom(viewW, viewH) {
    if (state.hubMode === 'sector' && state.activeZone) {
      return sectorEffectiveZoom(state.activeZone, state.sectorZoom, viewW, viewH);
    }
    return null;
  }

  function topbarHeightPx() {
    try {
      var bar = document.getElementById('topbar');
      if (bar) return bar.getBoundingClientRect().height;
    } catch (_) { /* ignore */ }
    return OVERVIEW_TOPBAR_FALLBACK_PX;
  }

  function computeOverviewFitZoom(viewW, viewH) {
    if (!viewW || !viewH) return 1;
    var wW = worldW();
    var wH = worldH();
    var topbar = topbarHeightPx();
    var availH = Math.max(viewH - topbar, viewH * 0.5);
    var zoomX = OVERVIEW_FILL * viewW / wW;
    var zoomY = OVERVIEW_FILL * availH / wH;
    return Math.min(zoomX, zoomY, MAX_ZOOM);
  }

  function overviewCameraPan(viewW, viewH, zoom, focusX, focusY) {
    var topbar = topbarHeightPx();
    var availH = Math.max(viewH - topbar, 1);
    var panX = viewW / 2 - (focusX / worldW() * viewW) * zoom;
    var panY = topbar + availH / 2 - (focusY / worldH() * availH) * zoom;
    return { panX: panX, panY: panY };
  }

  function getMinZoom(viewW, viewH) {
    if (state.hubMode === 'sector' && state.activeZone) {
      return sectorEffectiveZoom(state.activeZone, SECTOR_ZOOM_MIN, viewW, viewH);
    }
    return computeOverviewFitZoom(viewW, viewH);
  }

  function getMaxZoom(viewW, viewH) {
    if (state.hubMode === 'sector' && state.activeZone) {
      return sectorEffectiveZoom(state.activeZone, SECTOR_ZOOM_MAX, viewW, viewH);
    }
    return MAX_ZOOM;
  }

  function viewportRect(panX, panY, zoom, viewW, viewH, marginFrac) {
    var wW = worldW();
    var wH = worldH();
    var marginX = wW * (marginFrac || 0);
    var marginY = wH * (marginFrac || 0);
    return {
      minX: (-panX / zoom) / viewW * wW - marginX,
      maxX: ((viewW - panX) / zoom) / viewW * wW + marginX,
      minY: (-panY / zoom) / viewH * wH - marginY,
      maxY: ((viewH - panY) / zoom) / viewH * wH + marginY,
    };
  }

  function rectsOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function pointInZone(wx, wy, zoneId) {
    var b = state.zoneLayout && state.zoneLayout.zones && state.zoneLayout.zones[zoneId];
    if (!b) return false;
    return wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY;
  }

  function zoneAtWorldPoint(wx, wy) {
    if (!state.zoneLayout || !state.zoneLayout.zones) return null;
    var found = null;
    Object.keys(state.zoneLayout.zones).forEach(function (zone) {
      if (pointInZone(wx, wy, zone)) found = zone;
    });
    return found;
  }

  function viewportCenterWorld(panX, panY, zoom, viewW, viewH) {
    return {
      x: ((viewW / 2 - panX) / zoom) / viewW * worldW(),
      y: ((viewH / 2 - panY) / zoom) / viewH * worldH(),
    };
  }

  function buildZoneIndexes() {
    var byZone = {};
    state.all.forEach(function (c) {
      var z = c.hubZone;
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push(c);
    });
    state.careersByZone = byZone;
  }

  function visibleZones(rect) {
    if (!state.zoneLayout || !state.zoneLayout.zones) return [];
    var out = [];
    Object.keys(state.zoneLayout.zones).forEach(function (zone) {
      var b = state.zoneLayout.zones[zone];
      if (rectsOverlap(rect, b)) {
        out.push({
          id: zone,
          label: titleCaseZone(zone),
          bounds: b,
          orbColor: b.orbColor || null,
        });
      }
    });
    return out;
  }

  function getOverviewZones() {
    if (!state.zoneLayout || !state.zoneLayout.zones) return [];
    return Object.keys(state.zoneLayout.zones)
      .filter(function (zone) {
        var count = (state.careersByZone[zone] || []).length;
        var layoutCount = state.zoneLayout.zones[zone] && state.zoneLayout.zones[zone].count;
        return count > 0 || (layoutCount != null && layoutCount > 0);
      })
      .map(function (zone) {
      var b = state.zoneLayout.zones[zone];
      return {
        id: zone,
        label: titleCaseZone(zone),
        bounds: b,
        count: (state.careersByZone[zone] || []).length,
        orbColor: state.zoneColors[zone]
          || ((state.careersByZone[zone] && state.careersByZone[zone][0])
            ? state.careersByZone[zone][0].orbColor : '#78716C'),
        zoneFit: state.zoneFits[zone] || null,
      };
    });
  }

  function orbAlphaForLod(lod, zoom) {
    if (state.hubMode === 'sector') return 1;
    return 1;
  }

  var similarityPromise = null;
  function ensureSimilarityIndex() {
    if (state.similarityIndex) return Promise.resolve(state.similarityIndex);
    if (similarityPromise) return similarityPromise;
    similarityPromise = fetchWithTimeout(ARTIFACT_BASE + 'similarity-top8.json').then(function (r) {
      if (r.ok) return r.json();
      return fetchArtifactJson(ARTIFACT_BASE + 'similarity-top50.json');
    }).then(function (data) {
      state.similarityIndex = data || null;
      // Links appear once loaded — refresh + repaint.
      if (state.hubMode === 'sector') {
        state.similarityLinks = [];
        notifyVectorsUpdated();
      }
      return state.similarityIndex;
    }).catch(function () {
      similarityPromise = null;
      return null;
    });
    return similarityPromise;
  }

  function prefetchZoneVectors(zoneId) {
    var zoneCareers = state.careersByZone[zoneId] || [];
    var socs = zoneCareers.filter(function (c) { return !state.vectorCache[c.soc]; }).map(function (c) { return c.soc; });
    if (socs.length) scheduleVectorFetch(socs);
  }

  // Warm the user's best-fit zones so the overview constellation (and the
  // first sector they're likely to open) colorizes immediately instead of
  // staying neutral until a sector visit fetches vectors.
  function prefetchTopZoneVectors(limit) {
    var zones = Object.keys(state.careersByZone || {});
    if (!zones.length) return;
    zones.sort(function (a, b) {
      var fa = state.zoneFits[a];
      var fb = state.zoneFits[b];
      var va = fa && fa.overallFit != null ? fa.overallFit : (fa && fa.personalityFit) || 0;
      var vb = fb && fb.overallFit != null ? fb.overallFit : (fb && fb.personalityFit) || 0;
      return vb - va;
    });
    zones.slice(0, limit || 3).forEach(prefetchZoneVectors);
  }

  function careersFitInViewport(zoneId, panX, panY, zoom, viewW, viewH, marginFrac) {
    var careers = state.careersByZone[zoneId] || [];
    if (!careers.length) return false;
    var rect = viewportRect(panX, panY, zoom, viewW, viewH, marginFrac || 0.02);
    return careers.every(function (c) {
      var pos = careerWorldXY(c);
      return pos.x >= rect.minX && pos.x <= rect.maxX && pos.y >= rect.minY && pos.y <= rect.maxY;
    });
  }

  function enterSectorMode(zoneId, viewW, viewH, opts) {
    opts = opts || {};
    var b = state.zoneLayout && state.zoneLayout.zones && state.zoneLayout.zones[zoneId];
    if (!b) return null;
    if (!(state.careersByZone[zoneId] || []).length) return null;

    state.hubMode = 'sector';
    state.activeZone = zoneId;
    state.sectorEntryFrames = 0;
    ensureSimilarityIndex();

    var zoom;
    var panX;
    var panY;
    var preserveView = !!opts.preserveView
      && opts.currentZoom != null
      && opts.currentPanX != null
      && opts.currentPanY != null
      && careersFitInViewport(zoneId, opts.currentPanX, opts.currentPanY, opts.currentZoom, viewW, viewH, 0.04);

    if (preserveView) {
      var entry = sectorEntryZoom(zoneId, viewW, viewH);
      state.sectorZoom = entry > 0 ? opts.currentZoom / entry : 1;
      state.sectorZoom = Math.min(SECTOR_ZOOM_MAX, Math.max(SECTOR_ZOOM_MIN, state.sectorZoom));
      zoom = sectorEffectiveZoom(zoneId, state.sectorZoom, viewW, viewH);
      panX = opts.currentPanX;
      panY = opts.currentPanY;
    } else {
      state.sectorZoom = 1.1;
      var bbox = sectorCareerBBox(zoneId);
      var focusX = bbox ? bbox.centerX : b.labelX;
      var focusY = bbox ? bbox.centerY : b.labelY;
      zoom = sectorEffectiveZoom(zoneId, 1, viewW, viewH);
      panX = viewW / 2 - (focusX / worldW() * viewW) * zoom;
      panY = viewH / 2 - (focusY / worldH() * viewH) * zoom;
    }

    var clamped = clampPanSector(panX, panY, zoom, viewW, viewH, zoneId);

    prefetchZoneVectors(zoneId);
    state.renderCareers = state.careersByZone[zoneId] || [];
    state.mountedIds = new Set(state.renderCareers.map(function (c) { return c.id; }));
    applyCachedFit(state.renderCareers);
    refreshSimilarityLinks('local');
    startFragmentOverlay();

    return {
      zoom: zoom,
      panX: clamped.panX,
      panY: clamped.panY,
      sectorZoom: state.sectorZoom,
    };
  }

  function enterSectorByZone(zoneId, viewW, viewH, opts) {
    return enterSectorMode(zoneId, viewW, viewH, opts || {});
  }

  function exitSectorMode(viewW, viewH) {
    stopFragmentOverlay();
    state.hubMode = 'overview';
    state.activeZone = null;
    state.sectorZoom = 1;
    state.renderCareers = [];
    state.mountedIds = new Set();
    state.similarityLinks = [];
    var zoom = computeOverviewFitZoom(viewW, viewH);
    var panX = viewW / 2 - (worldW() / 2 / worldW() * viewW) * zoom;
    var panY = overviewCameraPan(viewW, viewH, zoom, worldW() / 2, worldH() / 2).panY;
    var clamped = clampPanOverview(panX, panY, zoom, viewW, viewH);
    return { zoom: zoom, panX: clamped.panX, panY: clamped.panY };
  }

  function evaluateModeTransition(zoom, panX, panY, viewW, viewH) {
    if (state.hubMode === 'overview') {
      if (zoom >= SECTOR_ENTRY_ZOOM - 0.001) {
        var center = viewportCenterWorld(panX, panY, zoom, viewW, viewH);
        var zone = zoneAtWorldPoint(center.x, center.y);
        if (zone) {
          state.sectorEntryFrames++;
          if (state.sectorEntryFrames >= 2) {
            return {
              action: 'enter',
              zone: zone,
              camera: enterSectorMode(zone, viewW, viewH, {
                preserveView: true,
                currentZoom: zoom,
                currentPanX: panX,
                currentPanY: panY,
              }),
            };
          }
        } else {
          state.sectorEntryFrames = 0;
        }
      } else {
        state.sectorEntryFrames = 0;
      }
      return { action: 'none' };
    }

    if (state.hubMode === 'sector') {
      if (state.sectorZoom <= SECTOR_ZOOM_MIN + 0.001) {
        return { action: 'exit', camera: exitSectorMode(viewW, viewH) };
      }
    }
    return { action: 'none' };
  }

  function applyFitToCareer(career, vec) {
    if (!vec || !state.personality) return false;
    var V = window.FWOnetVectors;
    var cp = V.cosinePercent || function (cos) { return V.clamp100(Math.round((cos || 0) * 100)); };
    var prevP = career.personalityFit;
    var prevO = career.objectiveFit;
    var cosP = V.cosine(state.personality.values, vec);
    career.personalityFit = cp(cosP);
    career.rawPersonalityFit = career.personalityFit;
    if (state.objective && state.objective.values && objectiveVectorActive()) {
      if (window.FWOnetMath && typeof FWOnetMath.objectiveFitPercent === 'function') {
        career.objectiveFit = FWOnetMath.objectiveFitPercent(state.objective.values, vec);
      } else if (V.objectiveFitFromVectors) {
        career.objectiveFit = V.objectiveFitFromVectors(state.objective.values, vec);
      }
      career.rawObjectiveFit = career.objectiveFit;
      if (window.FWOnetVectors
        && typeof FWOnetVectors.computePreparedness === 'function') {
        career.preparedness = FWOnetVectors.computePreparedness(
          state.objective.values,
          vec,
          { jobZone: career.jobZone },
        );
      } else {
        career.preparedness = null;
      }
    } else {
      career.objectiveFit = null;
      career.rawObjectiveFit = null;
      career.preparedness = null;
    }
    if (V && typeof V.overallFitScore === 'function') {
      career.fitScore = V.overallFitScore(career.personalityFit, career.objectiveFit);
    } else {
      career.fitScore = career.personalityFit;
    }
    career.vectorLoaded = true;
    var imp = V && typeof V.getCachedVectorImportance === 'function'
      ? V.getCachedVectorImportance(career.soc) : null;
    career.skills = topSkillsFromVector(vec, imp, state.registry, 5);
    return career.personalityFit !== prevP || career.objectiveFit !== prevO;
  }

  function topSkillsFromVector(lv, importance, registry, n) {
    if (!lv || !registry || !registry.dimensions) return [];
    var limit = n || 5;
    var scored = [];
    registry.dimensions.forEach(function (d) {
      if (d.domain !== 'skills') return;
      var idx = d.index;
      var imp = importance && importance[idx] != null ? importance[idx] / 100 : 0.5;
      var level = lv[idx] || 0;
      if (level <= 0) return;
      scored.push({ name: d.name, score: level * imp });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit).map(function (s) { return s.name; });
  }

  function objectiveVectorActive() {
    if (!state.objective || !state.objective.values || !window.FWOnetVectors) return false;
    return FWOnetVectors.magnitude(state.objective.values) > 0.01;
  }

  function applySectorAggregateFits() {
    if (!state.zoneAggregateVectors || !state.personality || !window.FWOnetVectors) return;
    if (window.FWHubZoneFit && typeof FWHubZoneFit.computeZoneFitsMap === 'function') {
      state.zoneFits = FWHubZoneFit.computeZoneFitsMap(
        state.personality,
        state.objective,
        state.zoneAggregateVectors
      );
      return;
    }
    var V = FWOnetVectors;
    var cp = V.cosinePercent || function (cos) { return V.clamp100(Math.round((cos || 0) * 100)); };
    var byZone = {};
    Object.keys(state.zoneAggregateVectors).forEach(function (zone) {
      var agg = state.zoneAggregateVectors[zone];
      if (!agg || !agg.lvMean || !agg.count) return;
      var pFit = cp(V.cosine(state.personality.values, agg.lvMean));
      byZone[zone] = {
        personalityFit: pFit,
        rawPersonality: pFit,
        objectiveFit: objectiveVectorActive()
          ? (window.FWOnetMath && FWOnetMath.objectiveFitPercent
            ? FWOnetMath.objectiveFitPercent(state.objective.values, agg.lvMean)
            : (V.objectiveFitFromVectors
              ? V.objectiveFitFromVectors(state.objective.values, agg.lvMean)
              : cp(V.cosine(state.objective.values, agg.lvMean))))
          : null,
      };
      if (byZone[zone].objectiveFit != null) {
        byZone[zone].rawObjective = byZone[zone].objectiveFit;
      }
      if (V && typeof V.overallFitScore === 'function') {
        byZone[zone].overallFit = V.overallFitScore(byZone[zone].personalityFit, byZone[zone].objectiveFit);
      }
    });
    state.zoneFits = byZone;
  }

  function getZoneFit(zoneId) {
    return state.zoneFits[zoneId] || null;
  }

  function applyGlobalCosineFits() {
    state.all.forEach(function (c) {
      if (window.FWOnetVectors && typeof FWOnetVectors.overallFitScore === 'function') {
        c.fitScore = FWOnetVectors.overallFitScore(c.personalityFit, c.objectiveFit);
      } else if (c.personalityFit != null) {
        c.fitScore = c.personalityFit;
      }
    });
    applySectorAggregateFits();
  }

  function applyCachedFit(careerList) {
    var changed = false;
    (careerList || []).forEach(function (c) {
      if (state.vectorCache[c.soc] && applyFitToCareer(c, state.vectorCache[c.soc])) {
        changed = true;
      }
    });
    if (changed) applyGlobalCosineFits();
    return changed;
  }

  function ensureVectorQueue() {
    if (state.vectorQueue || !window.FWOnetVectors || !FWOnetVectors.createVectorFetchQueue) return state.vectorQueue;
    state.vectorQueue = FWOnetVectors.createVectorFetchQueue({
      batchSize: VECTOR_FETCH_BATCH,
      cache: state.vectorCache,
      onBatchComplete: function () {
        applyCachedFit(state.all);
        notifyVectorsUpdated();
      },
    });
    return state.vectorQueue;
  }

  function enqueueVectorFetch(socs) {
    var queue = ensureVectorQueue();
    if (queue) queue.enqueue(socs);
  }

  function scheduleVectorFetch(socs) {
    enqueueVectorFetch(socs);
  }

  function mapOnetCareer(row) {
    return {
      id: 'soc:' + row.soc,
      soc: row.soc,
      name: row.title,
      industry: titleCaseZone(row.hubZone),
      hubZone: row.hubZone,
      jobZone: row.jobZone,
      x: row.layoutX,
      y: row.layoutY,
      sectorX: row.sectorX != null ? row.sectorX : row.layoutX,
      sectorY: row.sectorY != null ? row.sectorY : row.layoutY,
      sectorNX: row.sectorNX != null ? row.sectorNX : (row.layoutNX != null ? row.layoutNX : 0.5),
      sectorNY: row.sectorNY != null ? row.sectorNY : (row.layoutNY != null ? row.layoutNY : 0.5),
      layoutNX: row.layoutNX != null ? row.layoutNX : 0.5,
      layoutNY: row.layoutNY != null ? row.layoutNY : 0.5,
      orbColor: row.orbColor || '#78716C',
      aiDerived: !!row.aiDerived,
      derivedFrom: row.derivedFrom || null,
      fitScore: null,
      personalityFit: null,
      objectiveFit: null,
      rawPersonalityFit: null,
      rawObjectiveFit: null,
      skills: [],
      // Live getter: descriptions arrive after the core catalog (see
      // onet-catalog.js loadCore) and merge into `row` in place.
      get description() { return row.description || ''; },
      slug: slugify(row.title),
      hubFeatured: row.hubFeatured === 1,
      vectorIndex: row.vectorIndex,
    };
  }

  // Shared row -> career mapping (legacy slug resolution included) used both
  // at boot and when syncing runtime-merged derived/fragment rows so the two
  // paths can never drift apart.
  function mapRowsToCareers(rows) {
    return (rows || []).map(function (row) {
      var c = mapOnetCareer(row);
      if (window.FWOnetCatalog && typeof FWOnetCatalog.getLegacySlugForSoc === 'function') {
        var legacySlug = FWOnetCatalog.getLegacySlugForSoc(row.soc);
        if (legacySlug) c.slug = legacySlug;
      } else if (window.FWOnetVectors && typeof FWOnetVectors.getLegacySlugForSoc === 'function') {
        var legacySlugVec = FWOnetVectors.getLegacySlugForSoc(row.soc);
        if (legacySlugVec) c.slug = legacySlugVec;
      }
      return c;
    });
  }

  // Runtime-merged derived ("fragment") rows land in FWOnetCatalog via
  // addDerivedRows (called from hub-dashboard.js / career-personalize.js
  // after a drawer fetch) but that path has no push notification back into
  // this module's state. Rather than editing those files, poll the cheap
  // catalog row count on every viewport update (already runs per-frame in
  // sector mode) and merge any newly-appended rows in place. No-ops when
  // nothing changed.
  var lastCatalogRowCount = 0;
  function syncDerivedRows() {
    if (!state.ready || !window.FWOnetCatalog || typeof FWOnetCatalog.getAll !== 'function') return false;
    var rows = FWOnetCatalog.getAll();
    if (!rows || rows.length <= lastCatalogRowCount) return false;
    var newRows = rows.slice(lastCatalogRowCount);
    lastCatalogRowCount = rows.length;
    var knownSocs = {};
    state.all.forEach(function (c) { knownSocs[c.soc] = true; });
    var appended = mapRowsToCareers(newRows.filter(function (row) {
      return row && row.soc && !knownSocs[row.soc];
    }));
    if (!appended.length) return false;
    state.all = state.all.concat(appended);
    buildZoneIndexes();
    applyCachedFit(state.all);
    applyGlobalCosineFits();
    if (window.FWHubCanvasRender && typeof FWHubCanvasRender.invalidateOverviewLayer === 'function') {
      FWHubCanvasRender.invalidateOverviewLayer();
    }
    return true;
  }

  function tradeOffLabel(personalityFit, objectiveFit) {
    if (window.FWOnetVectors && typeof FWOnetVectors.tradeOffLabel === 'function') {
      return FWOnetVectors.tradeOffLabel(personalityFit, objectiveFit);
    }
    if (personalityFit == null || objectiveFit == null) return '';
    var gap = personalityFit - objectiveFit;
    if (gap >= 30) {
      return 'Strong personality fit, early-stage objective fit — invest in skills before applying';
    }
    if (gap <= -30) {
      return 'Strong objective fit, moderate personality fit — explore whether this path energizes you';
    }
    if (personalityFit >= 50 && objectiveFit >= 50) {
      return 'Strong fit on both personality and objective dimensions';
    }
    return '';
  }

  function neighborRelation(score) {
    if (score >= SIMILARITY_ADJACENT) return 'adjacent';
    if (score >= SIMILARITY_RELATED) return 'related';
    return 'cross-sector';
  }

  function relationLabel(relation) {
    if (relation === 'adjacent') return 'Adjacent';
    if (relation === 'related') return 'Related';
    return 'Cross-sector';
  }

  function getSimilarNeighbors(soc, opts) {
    opts = opts || {};
    if (!soc || !state.similarityIndex) return [];
    var limit = opts.limit != null ? opts.limit : 5;
    var zoneOnly = opts.zoneOnly !== false;
    var zone = opts.zone || state.activeZone;
    var neighbors = state.similarityIndex[soc] || [];
    var out = [];
    neighbors.forEach(function (n) {
      if (!n || !n.soc || n.soc === soc) return;
      var career = state.all.find(function (c) { return c.soc === n.soc; });
      if (!career) return;
      if (zoneOnly && zone && career.hubZone !== zone) return;
      out.push({
        career: career,
        score: n.score,
        relation: neighborRelation(n.score),
      });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, limit);
  }

  function linkPosFor(c) {
    if (state.hubMode === 'sector' && c.sectorX != null && c.sectorY != null) {
      return { x: c.sectorX, y: c.sectorY };
    }
    return { x: c.x, y: c.y };
  }

  function linkEdgeWeight(score, dist) {
    return score / Math.pow(1 + dist / 120, 1.5);
  }

  function buildBalancedSectorLinks(visibleCareers) {
    if (!state.similarityIndex || !visibleCareers || !visibleCareers.length) return [];
    var bySoc = {};
    visibleCareers.forEach(function (c) { bySoc[c.soc] = c; });
    var socs = visibleCareers.map(function (c) { return c.soc; });
    var candidates = [];
    var seenCand = {};

    function addCandidate(socA, socB, score) {
      if (!bySoc[socA] || !bySoc[socB] || socA === socB) return;
      var key = socA < socB ? socA + '|' + socB : socB + '|' + socA;
      if (seenCand[key]) return;
      var pa = linkPosFor(bySoc[socA]);
      var pb = linkPosFor(bySoc[socB]);
      var dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      var weight = linkEdgeWeight(score, dist);
      seenCand[key] = true;
      candidates.push({ a: bySoc[socA], b: bySoc[socB], score: score, weight: weight, key: key });
    }

    visibleCareers.forEach(function (c) {
      var neighbors = state.similarityIndex[c.soc];
      if (!neighbors) return;
      neighbors.forEach(function (n) {
        if (!n || !bySoc[n.soc]) return;
        if (n.score >= SIMILARITY_ADJACENT) addCandidate(c.soc, n.soc, n.score);
      });
    });

    var parent = {};
    socs.forEach(function (soc) { parent[soc] = soc; });
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    var sorted = candidates.slice().sort(function (x, y) { return y.weight - x.weight; });
    var edges = [];
    var edgeKeys = {};
    var degree = {};
    socs.forEach(function (soc) { degree[soc] = 0; });

    function addEdge(edge) {
      if (edgeKeys[edge.key]) return false;
      if (degree[edge.a.soc] >= MAX_LINKS_PER_NODE || degree[edge.b.soc] >= MAX_LINKS_PER_NODE) return false;
      edgeKeys[edge.key] = true;
      edges.push({ a: edge.a, b: edge.b, score: edge.score });
      degree[edge.a.soc]++;
      degree[edge.b.soc]++;
      return true;
    }

    sorted.forEach(function (edge) {
      if (find(edge.a.soc) !== find(edge.b.soc)) {
        if (addEdge(edge)) union(edge.a.soc, edge.b.soc);
      }
    });

    var roots = {};
    socs.forEach(function (soc) { roots[find(soc)] = true; });
    if (Object.keys(roots).length > 1) {
      var bridgeCandidates = [];
      visibleCareers.forEach(function (c) {
        var neighbors = state.similarityIndex[c.soc];
        if (!neighbors) return;
        neighbors.forEach(function (n) {
          if (!n || !bySoc[n.soc] || n.score < SIMILARITY_RELATED) return;
          var pa = linkPosFor(c);
          var pb = linkPosFor(bySoc[n.soc]);
          var dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          bridgeCandidates.push({
            a: c,
            b: bySoc[n.soc],
            score: n.score,
            weight: linkEdgeWeight(n.score, dist),
            key: c.soc < n.soc ? c.soc + '|' + n.soc : n.soc + '|' + c.soc,
          });
        });
      });
      bridgeCandidates.sort(function (x, y) { return y.weight - x.weight; });
      bridgeCandidates.forEach(function (edge) {
        if (find(edge.a.soc) === find(edge.b.soc)) return;
        if (addEdge(edge)) union(edge.a.soc, edge.b.soc);
      });
    }

    sorted.forEach(function (edge) {
      if (degree[edge.a.soc] >= MAX_LINKS_PER_NODE || degree[edge.b.soc] >= MAX_LINKS_PER_NODE) return;
      addEdge(edge);
    });

    socs.forEach(function (soc) {
      if (degree[soc] >= MIN_LINKS_PER_NODE) return;
      var neighbors = state.similarityIndex[soc] || [];
      var best = neighbors
        .filter(function (n) { return n && bySoc[n.soc] && n.score >= SIMILARITY_RELATED; })
        .map(function (n) {
          var pa = linkPosFor(bySoc[soc]);
          var pb = linkPosFor(bySoc[n.soc]);
          var dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          return {
            a: bySoc[soc],
            b: bySoc[n.soc],
            score: n.score,
            weight: linkEdgeWeight(n.score, dist),
            key: soc < n.soc ? soc + '|' + n.soc : n.soc + '|' + soc,
          };
        })
        .sort(function (x, y) { return y.weight - x.weight; });
      for (var i = 0; i < best.length && degree[soc] < MIN_LINKS_PER_NODE; i++) {
        addEdge(best[i]);
      }
    });

    socs.forEach(function (soc) {
      if (degree[soc] >= MIN_LINKS_PER_NODE) return;
      var others = socs
        .filter(function (otherSoc) { return otherSoc !== soc; })
        .map(function (otherSoc) {
          var pa = linkPosFor(bySoc[soc]);
          var pb = linkPosFor(bySoc[otherSoc]);
          return { otherSoc: otherSoc, dist: Math.hypot(pa.x - pb.x, pa.y - pb.y) };
        })
        .sort(function (a, b) { return a.dist - b.dist; });
      for (var j = 0; j < others.length && degree[soc] < MIN_LINKS_PER_NODE; j++) {
        var otherSoc = others[j].otherSoc;
        addEdge({
          a: bySoc[soc],
          b: bySoc[otherSoc],
          score: SIMILARITY_RELATED,
          weight: linkEdgeWeight(SIMILARITY_RELATED, others[j].dist),
          key: soc < otherSoc ? soc + '|' + otherSoc : otherSoc + '|' + soc,
        });
      }
    });

    return edges;
  }

  function getSimilarityLinks(visibleCareers) {
    return buildBalancedSectorLinks(visibleCareers);
  }

  function refreshSimilarityLinks(lod) {
    if (state.hubMode !== 'sector' || lod !== 'local') {
      state.similarityLinks = [];
      return state.similarityLinks;
    }
    state.similarityLinks = getSimilarityLinks(state.renderCareers);
    return state.similarityLinks;
  }

  function syncVectorsFromQuiz(quiz) {
    if (!quiz || !window.FWOnetVectors) return quiz;
    if (typeof FWOnetVectors.hydrateQuizVectors === 'function') {
      return FWOnetVectors.hydrateQuizVectors(quiz, { zoneCentroids: state.zoneCentroids });
    }
    return quiz;
  }

  function syncPersonalityFromQuiz(quiz) {
    quiz = syncVectorsFromQuiz(quiz);
    var personality = quiz.personalityVector || quiz.personality;
    var objective = quiz.objectiveVector || quiz.objective;
    if (personality && personality.values) {
      state.personality = personality;
    } else if (quiz.scores && state.zoneCentroids && window.FWOnetVectors) {
      state.personality = FWOnetVectors.seedPersonalityFromQuiz(quiz.scores, state.zoneCentroids);
    } else if (window.FWOnetVectors) {
      state.personality = { values: FWOnetVectors.emptyVector() };
    }
    state.objective = objective || { values: window.FWOnetVectors.emptyVector() };
  }

  function init() {
    if (state.ready) return Promise.resolve(true);
    if (initPromise) return initPromise;

    // loadCore: descriptions stream in behind the map render; the mapped
    // career objects read them through a live getter (mapOnetCareer).
    var catalogLoad = window.FWOnetCatalog
      ? (FWOnetCatalog.loadCore || FWOnetCatalog.load)()
      : Promise.resolve([]);

    // Catalog (careers.json, ~0.5MB) and the artifact bundle load in
    // PARALLEL — they used to serialize, putting careers.json alone on the
    // critical path. The similarity index (~230KB) is sector-only and loads
    // lazily on first sector entry (ensureSimilarityIndex).
    initPromise = Promise.all([
      catalogLoad,
      Promise.all([
        fetchArtifactJson(ARTIFACT_BASE + 'zone-layout.json'),
        fetchArtifactJsonOptional(ARTIFACT_BASE + 'zone-centroids.json'),
        fetchArtifactJsonOptional(ARTIFACT_BASE + 'zone-aggregate-vectors.json'),
        fetchArtifactJsonOptional(ARTIFACT_BASE + 'zone-colors.json').then(function (data) {
          return data || {};
        }),
        fetchWithTimeout('/data/onet/dimension-registry-v1.json').then(function (r) {
          if (!r.ok) return null;
          return r.json();
        }).catch(function () { return null; }),
      ]),
    ]).then(function (loaded) {
      var rows = window.FWOnetCatalog && FWOnetCatalog.getAll
        ? FWOnetCatalog.getAll()
        : [];
      return Promise.resolve(loaded[1]).then(function (parts) {
        state.zoneLayout = parts[0];
        state.zoneCentroids = parts[1];
        state.zoneAggregateVectors = parts[2];
        state.zoneColors = parts[3] || {};
        state.registry = parts[4] || null;
        state.all = mapRowsToCareers(rows);
        lastCatalogRowCount = rows.length;
        buildZoneIndexes();

      var quizBlob = (window.FWOnetVectors && typeof FWOnetVectors.readLocalQuizBlob === 'function')
        ? FWOnetVectors.readLocalQuizBlob()
        : null;
      var quiz = quizBlob && typeof FWOnetVectors.hydrateQuizVectors === 'function'
        ? FWOnetVectors.hydrateQuizVectors(quizBlob, { zoneCentroids: state.zoneCentroids })
        : window.FWOnetVectors.readQuizVectors({ hydrate: true, zoneCentroids: state.zoneCentroids });
      syncPersonalityFromQuiz(quiz);
      applySectorAggregateFits();

      if (!initReadyFromData(rows)) {
        state.ready = false;
        return false;
      }
      state.ready = true;
      return true;
      });
    }).catch(function (err) {
      console.error('[FWOnetHub] init failed', err);
      state.ready = false;
      return false;
    }).finally(function () {
      initPromise = null;
    });

    return initPromise;
  }

  function updateViewport(panX, panY, zoom, viewW, viewH) {
    if (!state.ready) return state.renderCareers;

    syncDerivedRows();

    var visible = [];
    if (state.hubMode === 'sector' && state.activeZone) {
      visible = state.careersByZone[state.activeZone] || [];
    }

    state.renderCareers = visible;
    state.mountedIds = new Set(visible.map(function (c) { return c.id; }));

    var rect = viewportRect(panX, panY, zoom, viewW, viewH, 0.05);
    state.visibleZoneLabels = visibleZones(rect);
    state.zoneTiles = state.hubMode === 'overview' ? getOverviewZones() : [];
    state.renderMeta = {
      lod: state.hubMode === 'sector' ? 'local' : getLodTier(zoom),
      orbAlpha: 1,
      hubMode: state.hubMode,
      activeZone: state.activeZone,
    };
    refreshSimilarityLinks(state.renderMeta.lod);

    return visible;
  }

  function refreshPersonalityFromQuiz() {
    var blob = (window.FWOnetVectors && typeof FWOnetVectors.readLocalQuizBlob === 'function')
      ? FWOnetVectors.readLocalQuizBlob()
      : null;
    var quiz = blob && typeof FWOnetVectors.hydrateQuizVectors === 'function'
      ? FWOnetVectors.hydrateQuizVectors(blob, { zoneCentroids: state.zoneCentroids })
      : window.FWOnetVectors.readQuizVectors({ hydrate: true, zoneCentroids: state.zoneCentroids });
    syncPersonalityFromQuiz(quiz);
    applyCachedFit(state.all);
    applyGlobalCosineFits();
    if (state.activeZone) prefetchZoneVectors(state.activeZone);
    buildZoneIndexes();
    notifyVectorsUpdated();
    return true;
  }

  function searchAll(query, limit) {
    query = String(query || '').trim().toLowerCase();
    if (!query) return [];
    limit = limit || 12;
    return state.all.filter(function (c) {
      return c.name.toLowerCase().includes(query) || c.soc.includes(query)
        || c.hubZone.includes(query);
    }).slice(0, limit);
  }

  function getZoneCentroids() {
    if (state.zoneLayout && state.zoneLayout.zones) {
      var out = {};
      Object.keys(state.zoneLayout.zones).forEach(function (z) {
        var b = state.zoneLayout.zones[z];
        out[titleCaseZone(z)] = { x: b.labelX, y: b.labelY };
      });
      return out;
    }
    return {};
  }

  function bestPersonalityZoneKey() {
    if (!state.zoneCentroids || !state.personality || !window.FWOnetVectors) return null;
    var bestZone = null;
    var bestScore = -1;
    Object.keys(state.zoneCentroids).forEach(function (zone) {
      var centroid = state.zoneCentroids[zone];
      if (!centroid || centroid.length !== FWOnetVectors.DIM) return;
      var score = FWOnetVectors.cosine(state.personality.values, centroid);
      if (score > bestScore) {
        bestScore = score;
        bestZone = zone;
      }
    });
    return bestZone;
  }

  function suggestInitialCamera(viewW, viewH) {
    var zoom = computeOverviewFitZoom(viewW, viewH);
    var focusX = worldW() / 2;
    var focusY = worldH() / 2;
    var bestZone = bestPersonalityZoneKey();
    if (bestZone && state.zoneLayout && state.zoneLayout.zones[bestZone]) {
      var b = state.zoneLayout.zones[bestZone];
      focusX = b.labelX;
      focusY = b.labelY;
    }
    var pan = overviewCameraPan(viewW, viewH, zoom, focusX, focusY);
    state.hubMode = 'overview';
    state.activeZone = null;
    state.sectorZoom = 1;
    var clamped = clampPanOverview(pan.panX, pan.panY, zoom, viewW, viewH);
    return {
      zoom: zoom,
      panX: clamped.panX,
      panY: clamped.panY,
      focusX: focusX,
      focusY: focusY,
    };
  }

  function clampPanOverview(panX, panY, zoom, viewW, viewH) {
    var minPanX = Math.min(0, viewW - zoom * viewW);
    var maxPanX = Math.max(0, viewW - zoom * viewW);
    panX = Math.min(maxPanX, Math.max(minPanX, panX));
    var minPanY = Math.min(0, viewH - zoom * viewH);
    var maxPanY = Math.max(0, viewH - zoom * viewH);
    panY = Math.min(maxPanY, Math.max(minPanY, panY));
    return { panX: panX, panY: panY };
  }

  function clampPan(panX, panY, zoom, viewW, viewH) {
    if (state.hubMode === 'sector' && state.activeZone) {
      return clampPanSector(panX, panY, zoom, viewW, viewH, state.activeZone);
    }
    return clampPanOverview(panX, panY, zoom, viewW, viewH);
  }

  function clampPanSector(panX, panY, zoom, viewW, viewH, zoneId) {
    var wW = worldW();
    var wH = worldH();
    var marginFrac = 0.08;
    var padX = wW * marginFrac;
    var padY = wH * marginFrac;
    var minWx = -padX;
    var maxWx = wW + padX;
    var minWy = -padY;
    var maxWy = wH + padY;

    var leftPan = viewW - (maxWx / wW * viewW) * zoom;
    var rightPan = -(minWx / wW * viewW) * zoom;
    var topPan = viewH - (maxWy / wH * viewH) * zoom;
    var bottomPan = -(minWy / wH * viewH) * zoom;

    if (leftPan > rightPan) {
      panX = (leftPan + rightPan) / 2;
    } else {
      panX = Math.min(rightPan, Math.max(leftPan, panX));
    }
    if (topPan > bottomPan) {
      panY = (topPan + bottomPan) / 2;
    } else {
      panY = Math.min(bottomPan, Math.max(topPan, panY));
    }
    return { panX: panX, panY: panY };
  }

  function applySectorZoomDelta(delta, viewW, viewH, pivotX, pivotY, panX, panY) {
    var oldZoom = sectorEffectiveZoom(state.activeZone, state.sectorZoom, viewW, viewH);
    var newSectorZoom = Math.min(SECTOR_ZOOM_MAX, Math.max(SECTOR_ZOOM_MIN, state.sectorZoom * delta));
    var newZoom = sectorEffectiveZoom(state.activeZone, newSectorZoom, viewW, viewH);
    var newPanX = pivotX - (pivotX - panX) * (newZoom / oldZoom);
    var newPanY = pivotY - (pivotY - panY) * (newZoom / oldZoom);
    state.sectorZoom = newSectorZoom;
    var clamped = clampPanSector(newPanX, newPanY, newZoom, viewW, viewH, state.activeZone);
    return { zoom: newZoom, panX: clamped.panX, panY: clamped.panY, sectorZoom: newSectorZoom };
  }

  function flyToCareer(career, hubState) {
    if (!career || !hubState) return;
    var viewW = window.innerWidth;
    var viewH = window.innerHeight;
    var zone = career.hubZone;

    if (state.hubMode !== 'sector' || state.activeZone !== zone) {
      var cam = enterSectorMode(zone, viewW, viewH);
      if (!cam) return;
      hubState.zoom = cam.zoom;
      hubState.panX = cam.panX;
      hubState.panY = cam.panY;
    }

    state.sectorZoom = SECTOR_FLY_ZOOM;
    var zoom = sectorEffectiveZoom(zone, state.sectorZoom, viewW, viewH);
    hubState.zoom = zoom;
    var pos = careerWorldXY(career);
    hubState.panX = viewW / 2 - (pos.x / worldW() * viewW) * zoom;
    hubState.panY = viewH / 2 - (pos.y / worldH() * viewH) * zoom;
    var clamped = clampPan(hubState.panX, hubState.panY, hubState.zoom, viewW, viewH);
    hubState.panX = clamped.panX;
    hubState.panY = clamped.panY;
  }

  function careerById(id) {
    if (String(id).indexOf('soc:') === 0) {
      var soc = String(id).slice(4);
      return state.all.find(function (c) { return c.soc === soc; }) || null;
    }
    return state.all.find(function (c) { return c.id === id; }) || null;
  }

  function careerWorldXY(c) {
    if (state.hubMode === 'sector' && c.sectorX != null && c.sectorY != null) {
      return { x: c.sectorX, y: c.sectorY };
    }
    return { x: c.x, y: c.y };
  }

  function tileWorldToLocal(tile, wx, wy) {
    var cx = tile.x + tile.w / 2;
    var cy = tile.y + tile.h / 2;
    var inner = zoneInnerBounds(tile.id);
    if (!inner) return { x: cx, y: cy };
    var innerW = inner.maxX - inner.minX;
    var innerH = inner.maxY - inner.minY;
    if (innerW <= 0 || innerH <= 0) return { x: cx, y: cy };
    var nx = (Number(wx) - inner.minX) / innerW;
    var ny = (Number(wy) - inner.minY) / innerH;
    if (!Number.isFinite(nx)) nx = 0.5;
    if (!Number.isFinite(ny)) ny = 0.5;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    return {
      x: tile.x + nx * tile.w,
      y: tile.y + ny * tile.h,
    };
  }

  // ── FRAGMENT-ORB OVERLAY ──
  // AI-derived ("fragment") careers carry aiDerived:true + derivedFrom:{soc,
  // title} into state.all/renderCareers, but the base orb draw loop and
  // hit-test live in hub-canvas.js/hub-dashboard.js (owned by other agents).
  // Rather than edit those files, this module draws a decorative overlay on
  // its own transparent canvas layered on top of #map-canvas, matching the
  // legacy main-branch "sub-branch spotlight reveal": fragments stay hidden
  // (tiny dim dots) until the cursor comes near, then bloom into a full orb
  // with a tether line back to the parent and a label. It reuses the
  // *exported* FWHubCanvasRender.worldToScreen/rarityOf so the projection
  // and palette always match the base renderer exactly, and it never
  // intercepts pointer events (pointer-events:none) so existing
  // hit-testing/hover/click handling in hub-dashboard.js is untouched —
  // fragment orbs stay clickable through the same path as any other orb.
  var FRAGMENT_MIN_R = 2.5; // floor so a fragment accent never disappears at low zoom (2.5 * 0.4 = 1.0px min)
  var SPOT_R = 140; // screen-space proximity radius (px) that triggers bloom
  var fragOverlay = {
    canvas: null,
    ctx: null,
    raf: null,
    pointerX: 0,
    pointerY: 0,
    pointerOn: false,
    anim: Object.create(null), // per-fragment soc -> current bloom amount [0,1]
    reduceMotion: (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  };

  function isLightTheme() {
    return !!(window.FWHubCanvasBg && typeof window.FWHubCanvasBg.isHubLightTheme === 'function'
      && window.FWHubCanvasBg.isHubLightTheme());
  }

  function ensureFragmentCanvas() {
    if (fragOverlay.canvas) return fragOverlay.canvas;
    var host = document.getElementById('map-canvas');
    if (!host || !host.parentNode) return null;
    var c = document.createElement('canvas');
    c.id = 'fw-fragment-overlay';
    c.setAttribute('aria-hidden', 'true');
    c.style.position = 'fixed';
    c.style.inset = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.pointerEvents = 'none';
    c.style.zIndex = '1';
    host.parentNode.insertBefore(c, host.nextSibling);
    fragOverlay.canvas = c;
    fragOverlay.ctx = c.getContext('2d');
    // The overlay never intercepts events (pointer-events:none), so this
    // listener on the canvas element itself never fires — track the pointer
    // via window instead, constrained to the underlying map canvas' rect so
    // coordinates line up with FWHubCanvasRender.worldToScreen(). This is
    // purely additive: it never calls preventDefault/stopPropagation and
    // never touches hub-dashboard.js's own pointer handling.
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerleave', onWindowPointerLeave);
    document.addEventListener('mouseleave', onWindowPointerLeave);
    return c;
  }

  function onWindowPointerMove(e) {
    var host = document.getElementById('map-canvas');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right
      || e.clientY < rect.top || e.clientY > rect.bottom) {
      setPointer(0, 0, false);
      return;
    }
    setPointer(e.clientX - rect.left, e.clientY - rect.top, true);
  }

  function onWindowPointerLeave() {
    setPointer(0, 0, false);
  }

  // Exported so hub-dashboard.js (or any other module that already tracks
  // pointer position over the map) can feed it in directly instead of this
  // module's own window listener, if a future wiring prefers that path.
  function setPointer(x, y, on) {
    var wasOn = fragOverlay.pointerOn;
    fragOverlay.pointerX = x;
    fragOverlay.pointerY = y;
    fragOverlay.pointerOn = !!on;
    if (fragOverlay.pointerOn || wasOn !== fragOverlay.pointerOn) {
      scheduleFragmentFrame();
    }
  }

  function resizeFragmentCanvas() {
    var c = fragOverlay.canvas;
    if (!c) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    fragOverlay.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function smoothstep(t) {
    var x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  function drawFragmentLabel(ctx, text, x, y, r, emphasized, alpha, hubLight) {
    var fontSize = 8; // smaller than main orb labels (10-11)
    ctx.font = '400 ' + fontSize + 'px Inter, sans-serif'; // lighter weight
    var padX = 4, padY = 2;
    var tw = ctx.measureText(text).width;
    var w = tw + padX * 2;
    var h = fontSize + padY * 2;
    var lx = x - w / 2;
    var ly = y + r + 8; // closer to orb
    var radius = 3;
    ctx.save();
    ctx.globalAlpha = alpha * 0.5; // much more transparent
    // No background box - just text with subtle outline for readability
    ctx.strokeStyle = hubLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(text, x, ly + h / 2);
    ctx.fillStyle = hubLight ? 'rgba(62,40,28,0.5)' : 'rgba(255,255,255,0.45)';
    ctx.fillText(text, x, ly + h / 2);
    ctx.restore();
  }

  function drawFragmentFrame() {
    fragOverlay.raf = null;
    if (state.hubMode !== 'sector' || !fragOverlay.canvas) return;
    var render = window.FWHubCanvasRender;
    if (!render || typeof render.worldToScreen !== 'function') {
      scheduleFragmentFrame();
      return;
    }
    resizeFragmentCanvas();
    var ctx = fragOverlay.ctx;
    var w = window.innerWidth;
    var h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    var visible = state.renderCareers || [];
    var fragments = visible.filter(function (c) { return c.aiDerived; });
    if (!fragments.length) {
      scheduleFragmentFrame();
      return;
    }
    var bySoc = {};
    visible.forEach(function (c) { bySoc[c.soc] = c; });

    var hubLight = isLightTheme();
    var alphaFloor = hubLight ? 0.35 : 0.07;
    var alphaSpan = hubLight ? 0.45 : 0.9;
    var rarityOf = typeof render.rarityOf === 'function' ? render.rarityOf : function () {
      return { glow: '154,160,173', base: '#9AA0AD' };
    };
    var pointerOn = fragOverlay.pointerOn && !(fragOverlay.reduceMotion && !fragOverlay.pointerOn);
    var anyRestless = false;

    // Group fragments by parent SOC
    var fragmentsByParent = {};
    fragments.forEach(function (c) {
      var parentSoc = c.derivedFrom && c.derivedFrom.soc ? c.derivedFrom.soc : null;
      if (!parentSoc) return;
      if (!fragmentsByParent[parentSoc]) fragmentsByParent[parentSoc] = [];
      fragmentsByParent[parentSoc].push(c);
    });

    // Shared zoom-aware radius (hub-canvas.js is the single source of truth for orb size)
    var baseR = (typeof render.sectorOrbRadiusPx === 'function') ? render.sectorOrbRadiusPx(false) : 5.6;
    var zoomScale = baseR / 5.6;

    // Satellite orbit radius = 3x main orb radius
    var ORBIT_RADIUS_MULTIPLIER = 3.0;

    // Process each parent's fragments in an even orbit
    Object.keys(fragmentsByParent).forEach(function (parentSoc) {
      var parentFrags = fragmentsByParent[parentSoc];
      var parent = bySoc[parentSoc];
      if (!parent) return;

      var ppos = careerWorldXY(parent);
      var pscr = render.worldToScreen(ppos.x, ppos.y);
      var orbitRadius = baseR * ORBIT_RADIUS_MULTIPLIER * zoomScale;

      parentFrags.forEach(function (c, idx) {
        var key = c.soc || c.name;
        // Even angular spacing around the parent
        var angle = (idx / parentFrags.length) * Math.PI * 2;
        var scr = {
          x: pscr.x + Math.cos(angle) * orbitRadius,
          y: pscr.y + Math.sin(angle) * orbitRadius
        };

        // Proximity in screen space → target bloom amount, smoothstep falloff.
        var target = 0;
        if (fragOverlay.pointerOn) {
          var d = Math.hypot(scr.x - fragOverlay.pointerX, scr.y - fragOverlay.pointerY);
          target = smoothstep(1 - d / SPOT_R);
        }
        var prevAnim = fragOverlay.anim[key] || 0;
        var a = fragOverlay.reduceMotion ? target : lerp(prevAnim, target, 0.2);
        if (Math.abs(a - target) > 0.002 || a > 0.002) anyRestless = true;
        fragOverlay.anim[key] = a;

        var rarity = rarityOf(c.fitScore != null ? c.fitScore : 0);
        var glowRgb = rarity.glow || '154,160,173';
        var baseColor = rarity.base || '#9AA0AD';
        // Satellite orb radius = 1.0 to 3.0 px (absolute, not scaled by main orb)
        var subR = Math.max(1.0, 1.0 + 2.0 * a);

        ctx.save();
        ctx.globalAlpha = alphaFloor + alphaSpan * a;

        // Tether from the parent orb's edge outward
        var dx = scr.x - pscr.x, dy = scr.y - pscr.y;
        var dlen = Math.hypot(dx, dy) || 1;
        var pr = baseR;
        ctx.strokeStyle = 'rgba(' + glowRgb + ',' + (0.1 + 0.5 * a).toFixed(3) + ')';
        ctx.lineWidth = 0.8 + 1.3 * a;
        ctx.beginPath();
        ctx.moveTo(pscr.x + dx / dlen * pr, pscr.y + dy / dlen * pr);
        ctx.lineTo(scr.x, scr.y);
        ctx.stroke();

        // Bloom glow once sufficiently lit.
        if (a > 0.04) {
          var g = ctx.createRadialGradient(scr.x, scr.y, subR * 0.4, scr.x, scr.y, subR * 2.6);
          g.addColorStop(0, 'rgba(' + glowRgb + ',' + (0.45 * a).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(' + glowRgb + ',0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(scr.x, scr.y, subR * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Orb body.
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(scr.x, scr.y, subR, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight, tracks the cursor when it's driving the bloom.
        if (a > 0.1) {
          var hx = scr.x - subR * 0.38, hy = scr.y - subR * 0.42;
          if (fragOverlay.pointerOn) {
            var mdx = fragOverlay.pointerX - scr.x, mdy = fragOverlay.pointerY - scr.y;
            var mlen = Math.hypot(mdx, mdy) || 1;
            hx = scr.x + (mdx / mlen) * subR * 0.46;
            hy = scr.y + (mdy / mlen) * subR * 0.46;
          }
          var hi = ctx.createRadialGradient(hx, hy, 0, hx, hy, subR * 0.55);
          hi.addColorStop(0, 'rgba(255,255,255,' + (0.65 * a).toFixed(3) + ')');
          hi.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = hi;
          ctx.beginPath();
          ctx.arc(scr.x, scr.y, subR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Label fades in only once meaningfully bloomed.
        if (a > 0.4) {
          var labelAlpha = (a - 0.4) / 0.6;
          drawFragmentLabel(ctx, c.name, scr.x, scr.y, subR, a > 0.75, labelAlpha, hubLight);
        }
      });
    });

    if (anyRestless || fragOverlay.pointerOn) {
      scheduleFragmentFrame();
    }
    // Otherwise every fragment is at rest (anim ≈ target ≈ 0, cursor off) —
    // stop the rAF loop here; setPointer()/enterSectorMode wake it back up.
  }

  function scheduleFragmentFrame() {
    if (fragOverlay.raf || state.hubMode !== 'sector') return;
    if (document.hidden) return;
    fragOverlay.raf = requestAnimationFrame(drawFragmentFrame);
  }

  function startFragmentOverlay() {
    if (!ensureFragmentCanvas()) return;
    scheduleFragmentFrame();
  }

  function stopFragmentOverlay() {
    if (fragOverlay.raf) {
      cancelAnimationFrame(fragOverlay.raf);
      fragOverlay.raf = null;
    }
    if (fragOverlay.canvas && fragOverlay.ctx) {
      fragOverlay.ctx.clearRect(0, 0, fragOverlay.canvas.width, fragOverlay.canvas.height);
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleFragmentFrame();
  });
  window.addEventListener('resize', function () {
    if (fragOverlay.canvas) resizeFragmentCanvas();
  });

  window.FWOnetHub = {
    WORLD_W: function () { return worldW(); },
    WORLD_H: function () { return worldH(); },
    VECTOR_FETCH_BATCH: VECTOR_FETCH_BATCH,
    SIMILARITY_ADJACENT: SIMILARITY_ADJACENT,
    SIMILARITY_RELATED: SIMILARITY_RELATED,
    MIN_LINKS_PER_NODE: MIN_LINKS_PER_NODE,
    MAX_LINKS_PER_NODE: MAX_LINKS_PER_NODE,
    LOD_CONTINENT_ZOOM: LOD_CONTINENT_ZOOM,
    LOD_REGION_ZOOM: LOD_REGION_ZOOM,
    DEFAULT_ZOOM: DEFAULT_ZOOM,
    OVERVIEW_FILL: OVERVIEW_FILL,
    MIN_ZOOM: MIN_ZOOM,
    MAX_ZOOM: MAX_ZOOM,
    getMinZoom: getMinZoom,
    getMaxZoom: getMaxZoom,
    SECTOR_ENTRY_ZOOM: SECTOR_ENTRY_ZOOM,
    SECTOR_EXIT_ZOOM: SECTOR_EXIT_ZOOM,
    SECTOR_ZOOM_MIN: SECTOR_ZOOM_MIN,
    SECTOR_ZOOM_MAX: SECTOR_ZOOM_MAX,
    FLY_TO_ZOOM: FLY_TO_ZOOM,
    ZONE_LABEL_FONT: ZONE_LABEL_FONT,
    computeOverviewFitZoom: computeOverviewFitZoom,
    getOverviewZones: getOverviewZones,
    getZoneFit: getZoneFit,
    prefetchZoneVectors: prefetchZoneVectors,
    sectorCareerBBox: sectorCareerBBox,
    init: init,
    isReady: function () { return state.ready; },
    getHubMode: function () { return state.hubMode; },
    getActiveZone: function () { return state.activeZone; },
    getSectorZoom: function () { return state.sectorZoom; },
    setSectorZoom: function (z) { state.sectorZoom = z; },
    getRenderCareers: function () { return state.renderCareers; },
    getZoneTiles: function () { return state.zoneTiles; },
    getRenderMeta: function () { return state.renderMeta; },
    getLodTier: getLodTier,
    getVisibleZoneLabels: function () { return state.visibleZoneLabels; },
    getZoneLayout: function () { return state.zoneLayout; },
    getCareersByZone: function () { return state.careersByZone; },
    getSimilarityLinks: function () { return state.similarityLinks; },
    getSimilarNeighbors: getSimilarNeighbors,
    relationLabel: relationLabel,
    getCareerBySoc: function (soc) {
      return state.all.find(function (c) { return c.soc === soc; }) || null;
    },
    getMountedIds: function () { return state.mountedIds; },
    tradeOffLabel: tradeOffLabel,
    objectiveVectorActive: objectiveVectorActive,
    refreshPersonalityFromQuiz: refreshPersonalityFromQuiz,
    invalidateViewport: function () { /* no-op: full zone always rendered */ },
    evaluateModeTransition: evaluateModeTransition,
    enterSectorMode: enterSectorMode,
    enterSectorByZone: enterSectorByZone,
    exitSectorMode: exitSectorMode,
    getZoneColor: function (zoneId) {
      return state.zoneColors[zoneId]
        || ((state.careersByZone[zoneId] && state.careersByZone[zoneId][0])
          ? state.careersByZone[zoneId][0].orbColor : '#78716C');
    },
    getZoneColors: function () { return state.zoneColors; },
    zoneAtWorldPoint: zoneAtWorldPoint,
    applySectorZoomDelta: applySectorZoomDelta,
    sectorBaseZoom: sectorBaseZoom,
    sectorEntryZoom: sectorEntryZoom,
    sectorEffectiveZoom: sectorEffectiveZoom,
    titleCaseZone: titleCaseZone,
    tileWorldToLocal: tileWorldToLocal,
    zoneInnerBounds: zoneInnerBounds,
    getAllCareers: function () { return state.all; },
    updateViewport: updateViewport,
    clampPan: clampPan,
    searchAll: searchAll,
    getZoneCentroids: getZoneCentroids,
    suggestInitialCamera: suggestInitialCamera,
    flyToCareer: flyToCareer,
    careerById: careerById,
    careerWorldXY: careerWorldXY,
    getPersonalityVector: function () { return state.personality; },
    getObjectiveVector: function () { return state.objective; },
    set onVectorsUpdated(fn) { state.onVectorsUpdated = fn; },
    get onVectorsUpdated() { return state.onVectorsUpdated; },
    _syncPan: function (px, py) { state._lastPanX = px; state._lastPanY = py; },
    setPointer: setPointer,
  };
})();
