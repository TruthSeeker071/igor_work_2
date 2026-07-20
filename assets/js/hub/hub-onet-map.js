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
  // Bottom band kept clear of the Marco FAB (bottom-left overlay) at fit zoom.
  var OVERVIEW_BOTTOM_SAFE_PX = 64;
  var MIN_ZOOM = 0.35;
  // Overview zoom-out floor: fraction of the fit zoom the user can pull back
  // past "everything on screen" — breathing room around the whole map, capped
  // below by MIN_ZOOM.
  var OVERVIEW_MIN_ZOOM_MULT = 0.7;
  // Headroom past SECTOR_ENTRY_ZOOM (3.0): when the cap equaled the entry
  // threshold, the two-frame entry confirmation had to happen exactly at the
  // pinned cap — one clamped tick and manual zoom-in just stalled instead of
  // diving into the sector.
  var MAX_ZOOM = 3.5;
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

  // Post-ship macro-hub redesign: merged macro-sectors need an explicit
  // display label ("Engineering & Science") that naive hyphen-to-space
  // title-casing can't produce ("Engineering Science").
  var ZONE_LABEL_OVERRIDES = {
    'engineering-science': 'Engineering & Science',
    'creative-media': 'Creative & Media',
    'business-finance': 'Business & Finance',
  };

  function titleCaseZone(z) {
    if (ZONE_LABEL_OVERRIDES[z]) return ZONE_LABEL_OVERRIDES[z];
    return String(z || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Per-zone background sub-area labels (the legacy hub's faint area names
  // behind the orbs, e.g. Engineering & Science → PHYSICS & CHEMISTRY /
  // ENGINEERING / BIOLOGY…). Each career is assigned to the sub-area whose
  // `soc` prefix is the LONGEST match against career.soc; a label renders
  // only when it has >= SUBAREA_MIN members, positioned at the centroid of
  // its members' sector coordinates. Static per zone — NEVER gated on the
  // top-fit lens or fit scores: these are spatial grounding, not results.
  // Keying is per-zone on purpose: the same SOC prefix means different
  // things in different zones ('15-12' is Software in tech, Cybersecurity
  // in engineering-science).
  var SUBAREA_MIN = 3;
  var SECTOR_SUBAREAS = {
    'business-finance': [
      { label: 'Management & Leadership', soc: ['11-'] },
      { label: 'Finance & Accounting', soc: ['13-20'] },
      { label: 'Business Operations', soc: ['13-10', '13-11'] },
      { label: 'Sales & Real Estate', soc: ['41-'] },
    ],
    'engineering-science': [
      { label: 'Engineering', soc: ['17-10', '17-20', '17-21'] },
      { label: 'Drafting & Eng. Technicians', soc: ['17-30'] },
      { label: 'Biology & Life Sciences', soc: ['19-10'] },
      // '19-20' catches physics/astronomy/chemistry/materials/misc physical
      // sciences; earth sciences carve themselves out via longer prefixes.
      { label: 'Physics & Chemistry', soc: ['19-20'] },
      { label: 'Earth & Environmental Science', soc: ['19-2041', '19-2042', '19-2043'] },
      { label: 'Social Sciences', soc: ['19-30'] },
      { label: 'Science Technicians', soc: ['19-40'] },
      { label: 'Security & Cybersecurity', soc: ['15-12', '13-11', '11-30', '33-'] },
    ],
    tech: [
      { label: 'Software & IT', soc: ['15-12', '11-30'] },
      { label: 'Data Science & Math', soc: ['15-20'] },
      { label: 'Computer Hardware', soc: ['17-20'] }, // self-suppresses at current counts
    ],
    healthcare: [
      { label: 'Physicians & Surgeons', soc: ['29-12'] },
      { label: 'Dental, Pharmacy & Vision', soc: ['29-10'] },
      { label: 'Nursing & Therapy', soc: ['29-11'] },
      { label: 'Medical Technicians', soc: ['29-20', '29-90'] },
      { label: 'Care Aides & Assistants', soc: ['31-'] },
      { label: 'Mental Health & Counseling', soc: ['21-'] },
      { label: 'Public Health & Science', soc: ['19-', '15-12', '17-20'] },
    ],
    'creative-media': [
      { label: 'Art & Design', soc: ['27-10', '15-12'] },
      { label: 'Performing Arts', soc: ['27-20'] },
      { label: 'Writing & Journalism', soc: ['27-30'] },
      { label: 'Media Production', soc: ['27-40'] },
      { label: 'Marketing & PR', soc: ['11-20', '13-11', '41-30'] },
    ],
    education: [
      { label: 'College Faculty', soc: ['25-10', '25-11'] },
      { label: 'K–12 Teaching', soc: ['25-20'] },
      { label: 'Adult & Continuing Ed', soc: ['25-30'] },
      { label: 'Library & Museum', soc: ['25-40'] },
      { label: 'Administration & Support', soc: ['11-90', '25-90', '21-'] },
    ],
    government: [
      { label: 'Administrative Support', soc: ['43-10', '43-20', '43-40', '43-41', '43-60', '43-90', '43-91'] },
      { label: 'Financial & Records Clerks', soc: ['43-30'] },
      { label: 'Logistics & Dispatch', soc: ['43-50', '43-51'] },
      { label: 'Military & Defense', soc: ['55-'] },
      { label: 'Food Service', soc: ['35-'] },
    ],
    law: [
      { label: 'Legal Practice', soc: ['23-', '43-60'] },
      { label: 'Law Enforcement', soc: ['33-10', '33-30'] },
      { label: 'Fire & Protective Services', soc: ['33-20', '33-90'] },
    ],
    social: [
      { label: 'Counseling & Social Work', soc: ['21-'] },
      { label: 'Personal Care', soc: ['39-50', '39-60', '39-90'] },
      { label: 'Recreation & Gaming', soc: ['39-10', '39-20', '39-30'] },
      { label: 'Funeral Services', soc: ['39-40'] },
      { label: 'Hospitality & Guest Services', soc: ['39-70', '35-', '43-40'] },
    ],
    trades: [
      { label: 'Manufacturing & Machining', soc: ['51-40', '51-41'] },
      { label: 'Production & Plant Operations', soc: ['51-80', '51-90', '51-91'] },
      { label: 'Agriculture & Forestry', soc: ['45-', '19-40', '11-90'] },
      { label: 'Grounds & Maintenance', soc: ['37-'] },
      { label: 'Culinary', soc: ['35-'] }, // self-suppresses at current counts
    ],
  };

  function buildZoneSubareas(zoneId) {
    var defs = SECTOR_SUBAREAS[zoneId] || [];
    if (!defs.length) return [];
    // Fragments orbit their parent client-side (fragmentSectorXY) and carry
    // derived pseudo-SOCs — base careers only.
    var members = (state.careersByZone[zoneId] || []).filter(function (c) { return !c.aiDerived; });
    var buckets = defs.map(function () { return { n: 0, sx: 0, sy: 0 }; });
    members.forEach(function (c) {
      var soc = String(c.soc || '');
      var best = -1;
      var bestLen = 0;
      defs.forEach(function (d, di) {
        d.soc.forEach(function (prefix) {
          if (prefix.length > bestLen && soc.indexOf(prefix) === 0) {
            best = di;
            bestLen = prefix.length;
          }
        });
      });
      if (best >= 0 && c.sectorX != null && c.sectorY != null) {
        buckets[best].n += 1;
        buckets[best].sx += c.sectorX;
        buckets[best].sy += c.sectorY;
      }
    });
    var out = [];
    defs.forEach(function (d, di) {
      var b = buckets[di];
      if (b.n < SUBAREA_MIN) return;
      out.push({ label: d.label, x: b.sx / b.n, y: b.sy / b.n, count: b.n });
    });
    // Gentle de-overlap: interleaved sector layouts can land two centroids in
    // nearly the same spot, stacking the big backdrop names into mush. Push
    // label anchors apart on an x-major ellipse (≈ the shape of a wide text
    // line) until none overlap. Deterministic and bounded.
    var SEP_X = 460;
    var SEP_Y = 130;
    for (var it = 0; it < 40; it++) {
      var moved = false;
      for (var i = 0; i < out.length; i++) {
        for (var j = i + 1; j < out.length; j++) {
          var a = out[i];
          var b2 = out[j];
          var dx = (b2.x - a.x) / SEP_X;
          var dy = (b2.y - a.y) / SEP_Y;
          if (!dx && !dy) dy = 0.01 * (j - i); // identical anchors: split vertically
          var d = Math.hypot(dx, dy);
          if (d < 1) {
            var push = ((1 - d) / d) * 0.5;
            var px = dx * push * SEP_X;
            var py = dy * push * SEP_Y;
            a.x -= px; a.y -= py;
            b2.x += px; b2.y += py;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return out;
  }

  function getZoneSubareas(zoneId) {
    if (!zoneId) return [];
    if (!state.subareaCache) state.subareaCache = {};
    if (!state.subareaCache[zoneId]) state.subareaCache[zoneId] = buildZoneSubareas(zoneId);
    return state.subareaCache[zoneId];
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
    // Top-matches lens: on by default; the user can opt out ("Show all").
    lensOn: (function () {
      try { return localStorage.getItem('fw_hub_lens') !== 'off'; } catch (e) { return true; }
    })(),
    fitsVersion: 0,
    lensCache: { key: '', cutoff: null },
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
    // Fit scores changed → an orb may cross a rarity band, so the cached
    // sector link graph (which carries per-edge glow colors) must rebuild.
    invalidateSectorLinkCache();
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
    // worldToScreen is viewport-normalized: zoom 1 maps the world onto the
    // full viewport on BOTH axes. Fit math therefore works in viewport
    // fractions only — the previous form divided viewport px by world units,
    // which was ~1.0 by coincidence at desktop widths (top tile row hidden
    // under the fixed HUD) and collapsed the map to ~30% scale on phones.
    var topbar = topbarHeightPx();
    var availH = Math.max(viewH - topbar - OVERVIEW_BOTTOM_SAFE_PX, viewH * 0.5);
    return Math.min(OVERVIEW_FILL, OVERVIEW_FILL * availH / viewH, MAX_ZOOM);
  }

  function overviewCameraPan(viewW, viewH, zoom, focusX, focusY) {
    var topbar = topbarHeightPx();
    var availH = Math.max(viewH - topbar - OVERVIEW_BOTTOM_SAFE_PX, 1);
    var panX = viewW / 2 - (focusX / worldW() * viewW) * zoom;
    // Center the focus point in the band between the HUD and the bottom-left
    // FAB. The focus term uses viewH (worldToScreen's Y scale), not availH.
    var panY = topbar + availH / 2 - (focusY / worldH() * viewH) * zoom;
    return { panX: panX, panY: panY };
  }

  function getMinZoom(viewW, viewH) {
    if (state.hubMode === 'sector' && state.activeZone) {
      return sectorEffectiveZoom(state.activeZone, SECTOR_ZOOM_MIN, viewW, viewH);
    }
    return Math.max(MIN_ZOOM, computeOverviewFitZoom(viewW, viewH) * OVERVIEW_MIN_ZOOM_MULT);
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

  // Nearest cluster to a world point, measured from the circle EDGE (negative
  // dist = inside). The organic macro map has real gaps between clusters, so
  // "which cluster does the user mean" needs a nearest-with-slack answer, not
  // strict containment.
  function nearestZoneToWorldPoint(wx, wy) {
    if (!state.zoneLayout || !state.zoneLayout.zones) return null;
    var best = null;
    Object.keys(state.zoneLayout.zones).forEach(function (zone) {
      var b = state.zoneLayout.zones[zone];
      if (!b) return;
      var cx = b.cx != null ? b.cx : (b.minX + b.maxX) / 2;
      var cy = b.cy != null ? b.cy : (b.minY + b.maxY) / 2;
      var r = b.r != null ? b.r : Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2;
      var d = Math.hypot(wx - cx, wy - cy) - r;
      if (!best || d < best.dist) best = { zone: zone, dist: d };
    });
    return best;
  }

  function viewportCenterWorld(panX, panY, zoom, viewW, viewH) {
    return {
      x: ((viewW / 2 - panX) / zoom) / viewW * worldW(),
      y: ((viewH / 2 - panY) / zoom) / viewH * worldH(),
    };
  }

  function buildZoneIndexes() {
    var byZone = {};
    var bySoc = {};
    var fragsByParent = {};
    state.all.forEach(function (c) {
      var z = c.hubZone;
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push(c);
      if (c.soc) bySoc[c.soc] = c;
      if (c.aiDerived && c.derivedFrom && c.derivedFrom.soc) {
        var ps = c.derivedFrom.soc;
        if (!fragsByParent[ps]) fragsByParent[ps] = [];
        fragsByParent[ps].push(c.soc);
      }
    });
    state.careersByZone = byZone;
    state.bySoc = bySoc;
    state.subareaCache = null; // membership may have changed; rebuilt lazily
    // Deterministic satellite ordering: each fragment knows its index i of n
    // siblings around its parent, so the client-side orbit layout is stable
    // across sessions and identical for render, hit-test, and badge counts.
    var fragOrder = {};
    Object.keys(fragsByParent).forEach(function (ps) {
      var socs = fragsByParent[ps].slice().sort();
      socs.forEach(function (soc, i) {
        fragOrder[soc] = { i: i, n: socs.length, parentSoc: ps };
      });
    });
    state.fragOrder = fragOrder;
    state.fragCountByParent = {};
    Object.keys(fragsByParent).forEach(function (ps) {
      state.fragCountByParent[ps] = fragsByParent[ps].length;
    });
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
      var inZone = state.careersByZone[zone] || [];
      return {
        id: zone,
        label: titleCaseZone(zone),
        bounds: b,
        count: inZone.length,
        orbColor: state.zoneColors[zone]
          || (inZone[0] ? inZone[0].orbColor : '#78716C'),
        zoneFit: state.zoneFits[zone] || null,
        // Hover/zoom-in reveal (rich detail on demand, not at rest): a taste
        // of what this macro-sector actually contains. Deterministic (first
        // N in load order) rather than random, so it doesn't flicker on
        // every hover re-render.
        exampleTitles: inZone.slice(0, 3).map(function (c) { return c.name; }).filter(Boolean),
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
    invalidateSectorLinkCache();
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
    invalidateSectorLinkCache();
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
        // Strict containment (zoneAtWorldPoint) made manual zoom-in stall:
        // on the organic map the viewport center often sits in the gap
        // BETWEEN clusters, so entry never fired and the user hit MAX_ZOOM
        // with nowhere to go — "have to click the sector instead". Accept
        // the nearest cluster within a generous slack so zooming in always
        // resolves to whatever the user is clearly zooming toward.
        var near = nearestZoneToWorldPoint(center.x, center.y);
        var zone = near && near.dist <= worldH() * 0.18 ? near.zone : null;
        if (zone) {
          state.sectorEntryFrames++;
          if (state.sectorEntryFrames >= 2) {
            return {
              action: 'enter',
              zone: zone,
              // No preserveView: manual zoom often crosses the threshold with
              // the cluster half-off-center (nearest-with-slack entry), and
              // preserving that camera landed users on a mostly-empty corner
              // of the sector. Always compute the centered careers-bbox
              // camera — the caller's short tween glides there, so entry is
              // both centered and smooth.
              camera: enterSectorMode(zone, viewW, viewH),
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

  // Display-zone (11 macro-sector) aggregate vectors, derived once from the
  // untouched 18-zone zone-aggregate-vectors.json (see rezone-hub.mjs):
  // merged macro-sectors get a count-weighted average of their constituents.
  // Every display-keyed consumer (zone fit %, neighbor links) must read THIS,
  // never the raw file — reading raw keys is how the merged zones ended up
  // with 0% fit and no similarity links after the redesign.
  var DISPLAY_ZONE_MERGE = {
    engineering: 'engineering-science', science: 'engineering-science', cybersecurity: 'engineering-science',
    creative: 'creative-media', marketing: 'creative-media', media: 'creative-media',
    business: 'business-finance', finance: 'business-finance',
  };

  function displayZoneAggregates() {
    if (state._displayAggs) return state._displayAggs;
    var aggs = state.zoneAggregateVectors;
    if (!aggs) return null;
    var acc = {};
    Object.keys(aggs).forEach(function (z) {
      var a = aggs[z];
      if (!a || !a.lvMean) return;
      var dz = DISPLAY_ZONE_MERGE[z] || z;
      var n = a.count || 0;
      if (!acc[dz]) {
        acc[dz] = { count: n, sum: a.lvMean.map(function (v) { return v * n; }) };
      } else {
        acc[dz].count += n;
        acc[dz].sum = acc[dz].sum.map(function (v, d) { return v + a.lvMean[d] * n; });
      }
    });
    var out = {};
    Object.keys(acc).forEach(function (dz) {
      var a = acc[dz];
      out[dz] = { count: a.count, lvMean: a.count ? a.sum.map(function (v) { return v / a.count; }) : a.sum };
    });
    state._displayAggs = out;
    return out;
  }

  function applySectorAggregateFits() {
    var displayAggs = displayZoneAggregates();
    if (!displayAggs || !state.personality || !window.FWOnetVectors) return;
    if (window.FWHubZoneFit && typeof FWHubZoneFit.computeZoneFitsMap === 'function') {
      state.zoneFits = FWHubZoneFit.computeZoneFitsMap(
        state.personality,
        state.objective,
        displayAggs
      );
      return;
    }
    var V = FWOnetVectors;
    var cp = V.cosinePercent || function (cos) { return V.clamp100(Math.round((cos || 0) * 100)); };
    var byZone = {};
    Object.keys(displayAggs).forEach(function (zone) {
      var agg = displayAggs[zone];
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
    state.fitsVersion++;
  }

  // Nth-highest fitScore among a list (fragments excluded); null when fewer
  // than n careers carry a score — the lens stays inert until fits exist.
  function nthHighestFit(list, n) {
    var scores = [];
    (list || []).forEach(function (c) {
      if (!c.aiDerived && c.fitScore != null) scores.push(c.fitScore);
    });
    if (scores.length < n) return null;
    scores.sort(function (a, b) { return b - a; });
    return scores[n - 1];
  }

  // Effective lens cutoff for the current sector view: careers at/above it
  // render at full weight, the long tail dims. min(global top-40, zone top-8)
  // so a zone whose careers all sit below the global bar still keeps its own
  // best handful fully visible.
  function lensCutoffValue() {
    var key = String(state.activeZone || '') + '|' + state.fitsVersion;
    if (state.lensCache.key === key) return state.lensCache.cutoff;
    var globalCut = nthHighestFit(state.all, 40);
    var zoneCut = state.activeZone
      ? nthHighestFit(state.careersByZone[state.activeZone], 8) : null;
    var cutoff = null;
    if (globalCut != null && zoneCut != null) cutoff = Math.min(globalCut, zoneCut);
    else if (globalCut != null) cutoff = globalCut;
    state.lensCache = { key: key, cutoff: cutoff };
    return cutoff;
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

  // Sector layouts were precomputed fairly dense; stretch positions slightly
  // away from the sector-canvas center for breathing room. CONSTRAINT: the
  // camera clamp (clampPanSector) only reaches the fixed canvas ±8%, so
  // spread coords MUST stay inside the canvas or edge careers become
  // permanently unreachable (the 1.45x version put Quantitative Financial
  // Analysts off-screen for good).
  var SECTOR_SPREAD = 1.15;
  function spreadSectorCoord(v, extent) {
    var c = extent / 2;
    var out = c + (Number(v) - c) * SECTOR_SPREAD;
    return Math.max(70, Math.min(extent - 70, out));
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
      sectorX: spreadSectorCoord(row.sectorX != null ? row.sectorX : row.layoutX, SECTOR_CANVAS_W),
      sectorY: spreadSectorCoord(row.sectorY != null ? row.sectorY : row.layoutY, SECTOR_CANVAS_H),
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
    // A derived career joined the active zone: its tether is drawn separately,
    // but the sector link set changed, so drop the cached graph.
    invalidateSectorLinkCache();
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
    // Satellites never join the similarity web — their ONLY link is the
    // tether to their parent (drawn in hub-canvas.js). Without this filter the
    // min-links backfill below wires each satellite to arbitrary neighbors.
    visibleCareers = visibleCareers.filter(function (c) { return !c.aiDerived; });
    if (!visibleCareers.length) return [];
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

  // F1: buildBalancedSectorLinks is O(n²) and was rebuilt EVERY frame from
  // updateViewport (the loop runs continuously in sector mode). The link graph
  // depends only on the visible career set (activeZone + count), never the
  // camera, so cache it and hand back a STABLE array reference — the canvas
  // backdrop/edge-color caches key on that reference identity. Invalidated on
  // sector entry, overview reset, derived-row appends, and vector updates.
  var _sectorLinkCache = { zone: null, count: -1, links: null };
  function invalidateSectorLinkCache() {
    _sectorLinkCache.zone = null;
    _sectorLinkCache.count = -1;
    _sectorLinkCache.links = null;
  }

  function refreshSimilarityLinks(lod) {
    if (state.hubMode !== 'sector' || lod !== 'local') {
      state.similarityLinks = [];
      return state.similarityLinks;
    }
    var count = state.renderCareers ? state.renderCareers.length : 0;
    if (_sectorLinkCache.links && _sectorLinkCache.zone === state.activeZone && _sectorLinkCache.count === count) {
      state.similarityLinks = _sectorLinkCache.links;
      return state.similarityLinks;
    }
    var links = getSimilarityLinks(state.renderCareers);
    // Only cache a real build: while the similarity index is still loading the
    // build returns [] cheaply — keep retrying until real links appear rather
    // than pinning the empty result behind the (zone,count) key.
    if (links.length) {
      _sectorLinkCache.zone = state.activeZone;
      _sectorLinkCache.count = count;
      _sectorLinkCache.links = links;
    }
    state.similarityLinks = links;
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
        // /data/* is HTTP-cached for a day (+a week stale-while-revalidate,
        // see _headers) — artifacts REGENERATED by an ETL run must carry a
        // fresh ?v= or every returning visitor keeps the old taxonomy from
        // cache while the (busted) hub JS expects the new one. This exact
        // mix — new code, day-old cached zone-layout/careers — is how the
        // dissolved 18-zone sectors kept appearing after the macro redesign.
        fetchArtifactJson(ARTIFACT_BASE + 'zone-layout.json?v=20260718f'),
        fetchArtifactJsonOptional(ARTIFACT_BASE + 'zone-centroids.json'),
        fetchArtifactJsonOptional(ARTIFACT_BASE + 'zone-aggregate-vectors.json'),
        fetchArtifactJsonOptional(ARTIFACT_BASE + 'zone-colors.json?v=20260718f').then(function (data) {
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

  // F3: mountedIds has no per-frame consumer and only changes with the visible
  // set (active zone or its count) — rebuild the Set then, not every frame.
  var _mountedIdsCache = { zone: null, count: -1 };
  function updateViewport(panX, panY, zoom, viewW, viewH) {
    if (!state.ready) return state.renderCareers;

    syncDerivedRows();

    var visible = [];
    if (state.hubMode === 'sector' && state.activeZone) {
      visible = state.careersByZone[state.activeZone] || [];
    }

    state.renderCareers = visible;
    if (_mountedIdsCache.zone !== state.activeZone || _mountedIdsCache.count !== visible.length) {
      state.mountedIds = new Set(visible.map(function (c) { return c.id; }));
      _mountedIdsCache.zone = state.activeZone;
      _mountedIdsCache.count = visible.length;
    }

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

  // Land ON the fit zoom: the hub opens showing the entire world — every
  // cluster on screen — and the user zooms IN toward what interests them
  // (the earlier 1.85x "readable clusters" landing read as opening already
  // half-zoomed with most of the map off-screen). Zooming out further than
  // the landing is still possible down to the OVERVIEW_MIN_ZOOM_MULT floor
  // in getMinZoom.
  var OVERVIEW_DEFAULT_ZOOM_MULT = 1.0;

  function suggestInitialCamera(viewW, viewH) {
    var zoom = Math.min(computeOverviewFitZoom(viewW, viewH) * OVERVIEW_DEFAULT_ZOOM_MULT, MAX_ZOOM);
    // Land centered on the map (not on the best-fit zone): starting off-center
    // read as broken — half the clusters off-screen with orphaned edge labels.
    var focusX = worldW() / 2;
    var focusY = worldH() / 2;
    var pan = overviewCameraPan(viewW, viewH, zoom, focusX, focusY);
    state.hubMode = 'overview';
    state.activeZone = null;
    state.sectorZoom = 1;
    invalidateSectorLinkCache();
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
    // Post-ship macro-hub redesign: the world is now organically spread and
    // several times bigger than the old fixed grid, so panning must work at
    // every zoom level — including the default/fit zoom. Previously this
    // forced panX to dead-center whenever the whole map fit horizontally
    // (zoom*viewW <= viewW), which is why dragging never visibly moved the
    // clusters (only the decorative backdrop, which follows raw pan deltas
    // unclamped, appeared to move). Edge-clamp uniformly instead — with a
    // wide overscroll border past the world edges (the "camera border"):
    // without it, edge clusters could never be centered on screen, so
    // cursor-anchored zoom near an edge fought the clamp (the camera visibly
    // slid sideways each zoom tick) and the sector-entry condition (cluster
    // near viewport center) was unreachable for perimeter clusters.
    var marginX = viewW * 0.45;
    var marginY = viewH * 0.4;
    var minPanX = Math.min(0, viewW - zoom * viewW) - marginX;
    var maxPanX = Math.max(0, viewW - zoom * viewW) + marginX;
    panX = Math.min(maxPanX, Math.max(minPanX, panX));
    // Y still respects the band between the fixed HUD and the FAB safe zone,
    // widened by the same overscroll border.
    var topbar = topbarHeightPx();
    var k = viewH - OVERVIEW_BOTTOM_SAFE_PX - zoom * viewH;
    var minPanY = Math.min(topbar, k) - marginY;
    var maxPanY = Math.max(topbar, k) + marginY;
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

  function applySectorZoomDelta(delta, viewW, viewH, pivotX, pivotY, panX, panY, curWorldZoom) {
    // Reconcile sectorZoom to the ACTUAL current camera zoom before applying
    // the delta. sectorZoom is set to its final value the instant a sector is
    // entered, but the world zoom only eases to match over the entry camera
    // tween — so a wheel zoom that lands mid-tween would read oldZoom from the
    // final sectorZoom while panX/panY are mid-tween, snapping the camera to
    // the sector frame. Deriving sectorZoom from the live world zoom (inverse
    // of the entry*sz term) keeps the pair consistent, so the zoom takes over
    // smoothly from wherever the tween currently is.
    if (curWorldZoom != null) {
      var entryZ = sectorEntryZoom(state.activeZone, viewW, viewH);
      if (entryZ > 0) {
        state.sectorZoom = Math.min(SECTOR_ZOOM_MAX, Math.max(SECTOR_ZOOM_MIN, curWorldZoom / entryZ));
      }
    }
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

  // Small string hash for deterministic per-orb jitter (layout must be
  // identical across frames, sessions, and the render/hit-test/badge paths).
  function socHash(s) {
    var h = 5381;
    var str = String(s || '');
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h;
  }

  // Client-side satellite orbit: fragments are laid out around their parent's
  // sector position in evenly-spaced slots with deterministic angular/radial
  // jitter (reads organic, never overlaps siblings). This REPLACES the
  // server-stored offsetLayout coords in sector mode so render, hit-test,
  // tethers, and count badges all derive from one function.
  var SAT_RING_W = 104;  // world units — base orbit radius (sector canvas 2560x1440)
  var SAT_RING_GAP = 62; // world units added per concentric ring for large clusters
  var SAT_PER_RING = 8;  // orbs before a cluster spills to an outer ring
  function fragmentSectorXY(c) {
    var ord = state.fragOrder && state.fragOrder[c.soc];
    if (!ord || !state.bySoc) return null;
    var parent = state.bySoc[ord.parentSoc];
    if (!parent || parent.sectorX == null || parent.sectorY == null) return null;

    // Even angular slots on a stable elliptical ring. A firm inner radius
    // clears the parent orb + its badge + glow; the variance below is kept
    // small so no orb flings far from its siblings and none gets crushed into
    // the parent (the failure modes of the old ±0.45-slot / 0.68–1.43× ring).
    // Large clusters (> SAT_PER_RING) spill onto concentric rings rather than
    // crowding one band.
    var ring = Math.floor(ord.i / SAT_PER_RING);
    var slot = ord.i - ring * SAT_PER_RING;
    var inRing = Math.min(SAT_PER_RING, ord.n - ring * SAT_PER_RING);
    var slots = Math.max(inRing, 3); // a lone orb still gets a full sweep, never a hug
    var step = (Math.PI * 2) / slots;

    // socHash is a full unsigned 32-bit value, so shift UNSIGNED (>>>): a
    // signed >> on a high-bit-set hash yields a negative remainder, which
    // silently flipped the squash and collapsed the radius — orbs landing on
    // the wrong side of, or on top of, the parent. That was a real source of
    // the placement mishaps this rewrite fixes.
    var h = socHash(c.soc);
    var jA = ((h % 1000) / 1000) - 0.5;    // angular jitter (kept < half a slot)
    var jR = ((h >>> 10) % 1000) / 1000;   // radial variance
    var jS = ((h >>> 20) % 1000) / 1000;   // ellipse squash

    // Stable per-parent rotation, plus a half-step twist per ring so
    // concentric rings interleave instead of radially aligning.
    var rot = (socHash(ord.parentSoc) % 628) / 100;
    var angle = rot + ring * step * 0.5 + slot * step + jA * step * 0.32;
    var radius = (SAT_RING_W + ring * SAT_RING_GAP) * (0.92 + jR * 0.16);
    var squash = 0.84 + jS * 0.12; // gentle ellipse — no vertical crush into the parent
    return {
      x: parent.sectorX + Math.cos(angle) * radius,
      y: parent.sectorY + Math.sin(angle) * radius * squash,
    };
  }

  function careerWorldXY(c) {
    if (state.hubMode === 'sector') {
      if (c.aiDerived) {
        var fp = fragmentSectorXY(c);
        if (fp) return fp;
      }
      if (c.sectorX != null && c.sectorY != null) {
        return { x: c.sectorX, y: c.sectorY };
      }
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

  // ── FRAGMENT ORBS ──
  // Satellites now render inside the main hub-canvas.js sector pass (one
  // renderer, one label solver, one layout source: careerWorldXY above).
  // The old separate overlay canvas is gone; these stubs keep the
  // enter/exit-sector call sites inert.
  function startFragmentOverlay() {}
  function stopFragmentOverlay() {}

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
    getZoneSubareas: getZoneSubareas,
    getSimilarityLinks: function () { return state.similarityLinks; },
    getSimilarNeighbors: getSimilarNeighbors,
    relationLabel: relationLabel,
    getCareerBySoc: function (soc) {
      return state.all.find(function (c) { return c.soc === soc; }) || null;
    },
    // Single source of truth for "how many specializations branch off this
    // career" — the renderer's badge, the side panel, and the satellite layout
    // all read this same index, so the counts can never disagree.
    getFragmentCount: function (soc) {
      return (state.fragCountByParent && state.fragCountByParent[soc]) || 0;
    },
    // Macro-view cluster links: top related zone pairs by cosine of the zone
    // aggregate vectors. Computed once (aggregates are static per session).
    // zone-aggregate-vectors.json intentionally still keys off the original
    // 18 real O*NET zones (FWOnetVectors.hydrateQuizVectors depends on that;
    // see rezone-hub.mjs) — merged display macro-sectors don't exist in it,
    // so their vector is derived here the same way the ETL derives it for
    // cluster placement: a count-weighted average of the constituents'
    // existing aggregate vectors, read-only.
    getZoneNeighborLinks: function () {
      if (state._zoneLinks) return state._zoneLinks;
      var aggs11 = displayZoneAggregates();
      if (!aggs11 || !window.FWOnetVectors || typeof FWOnetVectors.cosine !== 'function') return [];
      var zones = Object.keys(aggs11).filter(function (z) {
        // Only link zones actually present in the current overview render —
        // dissolved zones (agriculture/operations/hospitality) never reach
        // here since they have no entry in MERGE_INTO and no surviving
        // careersByZone bucket of their own name.
        return state.careersByZone && state.careersByZone[z] && state.careersByZone[z].length;
      });
      var pairs = [];
      for (var i = 0; i < zones.length; i++) {
        for (var j = i + 1; j < zones.length; j++) {
          var s = FWOnetVectors.cosine(aggs11[zones[i]].lvMean, aggs11[zones[j]].lvMean);
          pairs.push({ a: zones[i], b: zones[j], score: s });
        }
      }
      // The Business&Finance↔Tech↔Engineering&Science bridge is spatially
      // chained in rezone-hub.mjs; its two links are seeded ahead of the
      // greedy fill so the link web always tells the same story as the
      // placement (they'd usually win on score anyway — this makes it a
      // guarantee, not a coincidence).
      var BRIDGE_PAIRS = { 'business-finance|tech': 1, 'engineering-science|tech': 1 };
      function zonePairKey(p) { return p.a < p.b ? p.a + '|' + p.b : p.b + '|' + p.a; }
      pairs.sort(function (x, y) {
        var bx = BRIDGE_PAIRS[zonePairKey(x)] || 0;
        var by = BRIDGE_PAIRS[zonePairKey(y)] || 0;
        if (bx !== by) return by - bx;
        return y.score - x.score;
      });
      // Greedy: strongest pairs first, max 2 links per zone — a sparse web,
      // not a hairball.
      var degree = {};
      var links = [];
      pairs.forEach(function (p) {
        if ((degree[p.a] || 0) >= 2 || (degree[p.b] || 0) >= 2) return;
        links.push(p);
        degree[p.a] = (degree[p.a] || 0) + 1;
        degree[p.b] = (degree[p.b] || 0) + 1;
      });
      state._zoneLinks = links;
      return links;
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
    nearestZoneToWorldPoint: nearestZoneToWorldPoint,
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
    lensAvailable: function () { return lensCutoffValue() != null; },
    isLensOn: function () { return state.lensOn; },
    setLensOn: function (on) {
      state.lensOn = !!on;
      try { localStorage.setItem('fw_hub_lens', on ? 'on' : 'off'); } catch (e) { /* private mode */ }
    },
    getLensCutoff: function () { return state.lensOn ? lensCutoffValue() : null; },
    getPersonalityVector: function () { return state.personality; },
    getObjectiveVector: function () { return state.objective; },
    set onVectorsUpdated(fn) { state.onVectorsUpdated = fn; },
    get onVectorsUpdated() { return state.onVectorsUpdated; },
    _syncPan: function (px, py) { state._lastPanX = px; state._lastPanY = py; },
  };
})();
