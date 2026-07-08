// ── DATA (catalog + quiz scoring in assets/hub-careers.js) ──
let careers = FWHubCareers.careers;
let onetHubActive = false;
const subBranchNames = FWHubCareers.subBranchNames;

const hubCanvas = window.FWHubCanvasBg || {};
const getHubCanvasBg = hubCanvas.getHubCanvasBg || function () { return '#080706'; };
const isHubLightTheme = hubCanvas.isHubLightTheme || function () { return false; };
const titleCaseSkill = hubCanvas.titleCaseSkill || function (skill) {
  return String(skill || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
};

// ── STATE ──
const state = {
  zoom: 1, panX: 0, panY: 0,
  hoveredId: null, hoveredZone: null, selectedId: null,
  isDragging: false, hasDragged: false,
  dragStart: { x: 0, y: 0 }, panStart: { x: 0, y: 0 },
  searchQuery: '',
  mouseX: 0, mouseY: 0, mouseOn: false,
  activePointerId: null,
  zoneHoverAlpha: 0,
};
const hoverRadii = {};
const sectorHoverRadii = {};
function syncHoverRadii() {
  if (onetHubActive) return;
  var list = careers;
  list.forEach(c => {
    if (hoverRadii[c.id] == null) hoverRadii[c.id] = 11;
  });
}
function syncSectorHoverRadii() {
  careers.forEach(function (c) {
    if (sectorHoverRadii[c.id] == null) sectorHoverRadii[c.id] = sectorOrbBaseRadiusPx();
  });
}
syncHoverRadii();

// Non-obvious-fits state. Declared here (not beside its render helpers below)
// because syncMapHud() → syncStretchFitsVisibility() reads stretchRendered
// during the top-level boot (resize() runs before the render section executes);
// a `let` declared later would be in its temporal dead zone and throw, aborting
// the whole hub boot. See the "NON-OBVIOUS FITS" section for the render logic.
const STRETCH_DISMISS_KEY = 'fw_stretch_dismissed_v1';
let stretchRendered = [];      // last-rendered candidate list (for AI upgrade)
let stretchRunToken = 0;       // guards against stale async runs

// Fragment ("AI specializations") strip. Declared here (top-level state region)
// per the TDZ rule so any code path that could read it during boot stays safe;
// the token guards against a stale async /derive-career fetch resolving after
// the user has opened a different panel.
let fragmentRunToken = 0;

const careersById = {};
function rebuildCareersById() {
  Object.keys(careersById).forEach(k => { delete careersById[k]; });
  careers.forEach(c => { careersById[c.id] = c; });
}
rebuildCareersById();

function resolveCareerPanelSlug(career) {
  if (!career) return '';
  if (career.slug) return career.slug;
  if (career.soc && window.FWOnetVectors && typeof FWOnetVectors.getLegacySlugForSoc === 'function') {
    var legacy = FWOnetVectors.getLegacySlugForSoc(career.soc);
    if (legacy) return legacy;
  }
  if (window.FWHubCareers && FWHubCareers.careerSlug) {
    return FWHubCareers.careerSlug(career.id) || '';
  }
  return '';
}

// ── PERSONALIZATION FROM QUIZ ──
// Quiz writes name + 24 industry scores to #r=<token> and fw_hub_quiz_v1.
let userName = 'Student';
let hubQuizScores = null;
(function () {
  try {
    const p = FWHubCareers.initPersonalization();
    userName = p.userName;
    hubQuizScores = p.hubQuizScores;
  } catch (err) {
    console.error('[Career Hub] personalization failed', err);
  }
})();

const subNodes = [];

// ── LOADING / ERROR UI ──
let hubMapReady = false;

function hideHubLoading() {
  if (hubMapReady) return;
  const el = document.getElementById('hub-loading');
  if (!el) {
    requestAnimationFrame(function () {
      const retry = document.getElementById('hub-loading');
      if (retry && !hubMapReady) hideHubLoading();
    });
    return;
  }
  el.classList.add('is-hidden');
  el.setAttribute('aria-busy', 'false');
  hubMapReady = true;
}

function isHubLoadingVisible() {
  const el = document.getElementById('hub-loading');
  return !!(el && !el.classList.contains('is-hidden'));
}

function startHubBootWatchdog() {
  setTimeout(function () {
    if (!isHubLoadingVisible()) return;
    dismissHubLoadingOnce();
    showHubBootError('Career map took too long to load. Try refreshing the page.');
  }, 8000);
}

function showHubBootError(msg) {
  const el = document.getElementById('hub-boot-error');
  const text = document.getElementById('hub-boot-error-text');
  if (text) text.textContent = msg || 'Career map could not load.';
  if (el) el.hidden = false;
}

function hideHubBootError() {
  const el = document.getElementById('hub-boot-error');
  if (el) el.hidden = true;
}

function hubOverviewAnimCareers() {
  return [];
}

// ── CANVAS SETUP ──
const canvas = document.getElementById('map-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const FIT_EXPLAINER_KEY = 'fw_hub_fit_explainer_seen_v1';
let viewW = window.innerWidth;
let viewH = window.innerHeight;

function hubViewportSize() {
  const vv = window.visualViewport;
  let w = vv ? vv.width : window.innerWidth;
  let h = vv ? vv.height : window.innerHeight;
  if (!w || w < 1) w = window.innerWidth || 1;
  if (!h || h < 1) h = window.innerHeight || 1;
  return { w: w, h: h };
}

const HUB_TOPBAR_H = 56;
const ZONE_LABEL_FONT_PX = 13;
const ZONE_LABEL_HALF_LINE = 7;
const SECTOR_ORB_SCREEN_R = 5.6;
const SECTOR_ORB_HOVER_R = 6.75;
let sectorLabelsPending = null;
let needsRedraw = true;

function getTopbarHeight() {
  var bar = document.getElementById('topbar');
  if (bar && bar.getBoundingClientRect) {
    var h = bar.getBoundingClientRect().height;
    if (h > 0) return h;
  }
  return HUB_TOPBAR_H;
}

function hubSafeTop() {
  return getTopbarHeight() + 10;
}
let sectorLabelCache = { key: '', layout: [] };
let lastSectorLabelZoomBucket = null;
let rafId = null;
let animationPaused = false;
let hubLoopReady = false;
const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function dismissHubLoadingOnce() {
  hideHubLoading();
}

function invalidateSectorLabelCache() {
  sectorLabelCache = { key: '', layout: [] };
}

function sectorLabelCacheKey() {
  if (!window.FWOnetHub || FWOnetHub.getHubMode() !== 'sector') return '';
  var zone = FWOnetHub.getActiveZone() || '';
  // Deliberately no zoom component: label anchors stay stable while zooming
  // (positions still track the camera every frame); the overlap solve reruns
  // via maybeInvalidateSectorLabelCacheOnZoom once the zoom settles.
  return zone + '|q' + (state.searchQuery || '');
}

function sectorZoomBucket() {
  return Math.round(state.zoom * 20) / 20;
}

let lastZoomInputAt = 0;
const LABEL_SETTLE_MS = 160;

function maybeInvalidateSectorLabelCacheOnZoom() {
  if (!onetHubActive || !window.FWOnetHub || FWOnetHub.getHubMode() !== 'sector') {
    lastSectorLabelZoomBucket = null;
    return;
  }
  // While the user is actively zooming, keep the existing label layout —
  // anchors re-solving every 0.05 zoom step made labels flicker and jump.
  // Positions still track the camera each frame; the overlap solve reruns
  // once the zoom has settled.
  if (performance.now() - lastZoomInputAt < LABEL_SETTLE_MS) {
    requestHubRedraw();
    return;
  }
  var bucket = sectorZoomBucket();
  if (lastSectorLabelZoomBucket !== bucket) {
    invalidateSectorLabelCache();
    lastSectorLabelZoomBucket = bucket;
  }
}

function requestHubRedraw() {
  needsRedraw = true;
  if (hubLoopReady && hubBootOk && !rafId && !animationPaused) loop();
}

function resize() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = hubViewportSize();
  viewW = vp.w;
  viewH = vp.h;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
  if (onetHubActive && window.FWOnetHub && typeof FWOnetHub.invalidateViewport === 'function') {
    FWOnetHub.invalidateViewport();
  }
  if (onetHubActive) clampHubPan();
  invalidateSectorLabelCache();
  requestHubRedraw();
  syncMapHud();
}

let hubBootOk = false;
if (!canvas || !ctx) {
  console.error('[Career Hub] canvas unavailable');
  hideHubLoading();
  showHubBootError('Career map could not start. Try refreshing the page.');
} else {
  hubBootOk = true;
  resize();
  window.addEventListener('resize', resize);
  let hubVvTimer = null;
  function onHubVisualViewportResize() {
    if (hubVvTimer) clearTimeout(hubVvTimer);
    hubVvTimer = setTimeout(resize, 80);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onHubVisualViewportResize);
  }
}

function pointerOnCanvas(e) {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function zoneLabelCanvasY(zoneY, zoneH) {
  // Inputs are already screen-space (tiles render outside the world
  // transform); keep the label clear of the fixed top HUD.
  var safeTop = hubSafeTop();
  var labelOffset = ZONE_LABEL_HALF_LINE + 4;
  var preferred = zoneY + Math.max(zoneH * 0.22, 22);
  if (preferred - labelOffset < safeTop) preferred = safeTop + labelOffset;
  return preferred;
}


const hubRender = window.FWHubCanvasRender || {};

// Zoom-aware sector orb radius, shared with hub-canvas.js (single source of
// truth for orb size so it always scales with zoom the same way everywhere
// it's read: draw, hit-test, and this hover-radius smoothing). Falls back to
// the fixed constants if hub-canvas.js hasn't loaded for any reason.
function sectorOrbBaseRadiusPx(emphasized) {
  return (typeof hubRender.sectorOrbRadiusPx === 'function')
    ? hubRender.sectorOrbRadiusPx(!!emphasized)
    : (emphasized ? SECTOR_ORB_HOVER_R : SECTOR_ORB_SCREEN_R);
}

function bindHubCanvasRender() {
  if (!hubRender.bind) return;
  hubRender.bind({
    get ctx() { return ctx; },
    get viewW() { return viewW; },
    get viewH() { return viewH; },
    get state() { return state; },
    get careers() { return careers; },
    get onetHubActive() { return onetHubActive; },
    motionOk: motionOk,
    get sectorHoverRadii() { return sectorHoverRadii; },
    get sectorLabelCache() { return sectorLabelCache; },
    set sectorLabelCache(v) { sectorLabelCache = v; },
    get sectorLabelsPending() { return sectorLabelsPending; },
    set sectorLabelsPending(v) { sectorLabelsPending = v; },
    get needsRedraw() { return needsRedraw; },
    set needsRedraw(v) { needsRedraw = v; },
    hubWorldW: hubWorldW,
    hubWorldH: hubWorldH,
    zoneLabelCanvasY: zoneLabelCanvasY,
    zoneCareerCount: zoneCareerCount,
    careerWorldXY: careerWorldXY,
    sectorLabelCacheKey: sectorLabelCacheKey,
    hideHubBootError: hideHubBootError,
  });
}

function render() {
  if (hubRender.render) hubRender.render();
}

function worldToScreen(wx, wy) {
  return hubRender.worldToScreen ? hubRender.worldToScreen(wx, wy) : { x: 0, y: 0 };
}

function screenToWorld(sx, sy) {
  return hubRender.screenToWorld ? hubRender.screenToWorld(sx, sy) : { x: 0, y: 0 };
}

function zoneAtScreen(mx, my) {
  return hubRender.zoneAtScreen ? hubRender.zoneAtScreen(mx, my) : null;
}

function careerAtScreen(mx, my) {
  return hubRender.careerAtScreen ? hubRender.careerAtScreen(mx, my) : null;
}

function orbPalette(c, opts) {
  return hubRender.orbPalette ? hubRender.orbPalette(c, opts) : { base: '#78716C', light: '#aaa', dark: '#555', glow: '120,113,108' };
}

function rarityOf(score) {
  return hubRender.rarityOf ? hubRender.rarityOf(score) : { base: '#9AA0AD', light: '#C7CBD3', dark: '#6E7480', glow: '154,160,173' };
}

function formatCosineFit(val) {
  return hubRender.formatCosineFit ? hubRender.formatCosineFit(val)
    : (val == null ? '—' : Math.round(val) + '%');
}

function formatFitPercentile(val) {
  return formatCosineFit(val);
}

function formatFitScore(val) {
  return hubRender.formatFitScore ? hubRender.formatFitScore(val) : '—';
}

function careerWorldXY(c) {
  if (onetHubActive && window.FWOnetHub && typeof FWOnetHub.careerWorldXY === 'function') {
    return FWOnetHub.careerWorldXY(c);
  }
  return { x: c.x, y: c.y };
}

bindHubCanvasRender();

function zoneCareerCount(zoneId) {
  if (!window.FWOnetHub || typeof FWOnetHub.getCareersByZone !== 'function') return 0;
  var byZone = FWOnetHub.getCareersByZone();
  return (byZone[zoneId] || []).length;
}

function syncMapHud() {
  var hud = document.getElementById('hub-map-hud');
  if (!hud) return;
  var backBtn = document.getElementById('hub-sector-back');
  var title = document.getElementById('hub-sector-title');
  var searchHud = document.getElementById('hub-search-hud');
  var inSector = onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() === 'sector';
  var zoneId = inSector && FWOnetHub.getActiveZone ? FWOnetHub.getActiveZone() : null;
  if (backBtn) backBtn.hidden = !inSector;
  if (searchHud) {
    if (!inSector && state.searchQuery && onetHubActive && window.FWOnetHub) {
      var matches = FWOnetHub.searchAll(state.searchQuery, 999).length;
      searchHud.textContent = matches
        ? matches + ' career' + (matches === 1 ? '' : 's') + ' match “' + state.searchQuery + '”'
        : 'No careers match “' + state.searchQuery + '”';
      searchHud.hidden = false;
    } else {
      searchHud.hidden = true;
    }
  }
  if (title) {
    if (inSector && zoneId) {
      var titleFn = FWOnetHub.titleCaseZone || function (z) { return String(z || ''); };
      var count = zoneCareerCount(zoneId);
      title.textContent = titleFn(zoneId) + ' · ' + count + ' careers';
      title.hidden = false;
    } else {
      title.hidden = true;
    }
  }
  hud.classList.toggle('is-sector', !!inSector);
  syncLegendMode(inSector);
  syncStretchFitsVisibility(inSector);
}

function syncLegendMode(inSector) {
  var legend = document.querySelector('.topbar-right .legend');
  if (!legend || !onetHubActive) return;
  legend.classList.toggle('legend--sector', !!inSector);
  legend.classList.toggle('legend--overview', !inSector);
  var rarityBar = legend.querySelector('.legend-bar--rarity');
  if (rarityBar) rarityBar.hidden = false;
  var labels = legend.querySelectorAll('.legend-label');
  if (labels[0]) labels[0].textContent = inSector ? 'Fit rarity' : 'Overall fit';
  if (labels[1]) labels[1].textContent = '';
}

// ── NON-OBVIOUS FITS (objective-vector stretch surfacing) ──
// Surfaces careers where the OBJECTIVE (background) vector alone indicates a
// strong fit while personality fit is only moderate — so they don't surface in
// today's personality-dominated top ranks. Overview-only card near the HUD.
// (State — STRETCH_DISMISS_KEY / stretchRendered / stretchRunToken — is declared
// near the top of the file so top-level boot can safely read it; see note there.)

function stretchDismissed() {
  try { return sessionStorage.getItem(STRETCH_DISMISS_KEY) === '1'; } catch (_) { return false; }
}

function syncStretchFitsVisibility(inSector) {
  var el = document.getElementById('hub-stretch-fits');
  if (!el) return;
  // Only ever visible in overview mode, with rendered rows, and not dismissed.
  var canShow = !inSector && !stretchDismissed() && stretchRendered.length > 0;
  el.hidden = !canShow;
}

function stretchFallbackText(candidate) {
  var names = (candidate.drivers || []).map(function (d) { return d.name; }).filter(Boolean).slice(0, 3);
  if (!names.length) return 'Your background points to this path.';
  var list = names.length <= 1 ? names[0]
    : (names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
  return 'Driven by your background in ' + list + '.';
}

function renderStretchFits(candidates) {
  var el = document.getElementById('hub-stretch-fits');
  var list = document.getElementById('hub-stretch-list');
  if (!el || !list) return;
  stretchRendered = candidates || [];
  if (!stretchRendered.length) {
    list.innerHTML = '';
    el.hidden = true;
    return;
  }
  list.innerHTML = '';
  stretchRendered.forEach(function (c) {
    var slug = c.slug || '';
    var href = 'career.html?slug=' + encodeURIComponent(slug)
      + (c.soc ? ('&soc=' + encodeURIComponent(c.soc)) : '');
    var a = document.createElement('a');
    a.className = 'hub-stretch-row';
    a.href = href;
    a.setAttribute('data-slug', slug);

    var top = document.createElement('div');
    top.className = 'hub-stretch-row-top';
    var title = document.createElement('span');
    title.className = 'hub-stretch-row-title';
    title.textContent = c.name || slug;
    var badge = document.createElement('span');
    badge.className = 'hub-stretch-badge';
    badge.textContent = 'Non-obvious fit';
    top.appendChild(title);
    top.appendChild(badge);

    var pair = document.createElement('div');
    pair.className = 'hub-stretch-pair';
    pair.textContent = 'Background ' + Math.round(c.objectiveFit)
      + ' · Personality ' + Math.round(c.personalityFit);

    var why = document.createElement('div');
    why.className = 'hub-stretch-why';
    why.textContent = stretchFallbackText(c);

    a.appendChild(top);
    a.appendChild(pair);
    a.appendChild(why);
    var li = document.createElement('li');
    li.className = 'hub-stretch-item';
    li.appendChild(a);
    list.appendChild(li);
  });
  syncStretchFitsVisibility(onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() === 'sector');
}

// Upgrade fallback explanations via the AI endpoint (logged-in only).
function upgradeStretchExplanations(candidates, token) {
  if (!candidates || !candidates.length) return;
  if (!(window.FWAuth && FWAuth.authEmail && FWAuth.authEmail() && typeof FWAuth.authFetch === 'function')) {
    return; // logged out — keep fallback, skip the call entirely
  }
  var items = candidates.slice(0, 4).map(function (c) {
    return {
      slug: c.slug,
      soc: c.soc,
      drivers: (c.drivers || []).map(function (d) { return d.name; }).filter(Boolean),
    };
  });
  FWAuth.authFetch('/stretch-fits', { method: 'POST', body: { items: items } })
    .then(function (resp) { return resp && resp.ok ? resp.json() : null; })
    .then(function (data) {
      if (!data || !data.explanations || token !== stretchRunToken) return;
      var list = document.getElementById('hub-stretch-list');
      if (!list) return;
      Object.keys(data.explanations).forEach(function (slug) {
        var text = data.explanations[slug];
        if (!text) return;
        var row = list.querySelector('.hub-stretch-row[data-slug="' + (window.CSS && CSS.escape ? CSS.escape(slug) : slug) + '"]');
        var why = row && row.querySelector('.hub-stretch-why');
        if (why) why.textContent = text;
      });
    })
    .catch(function () { /* keep fallback text */ });
}

function refreshStretchFits() {
  if (!(window.FWOnetVectors && typeof FWOnetVectors.stretchFitCandidates === 'function')) return;
  var token = ++stretchRunToken;
  var q = (typeof FWOnetVectors.readLocalQuizBlob === 'function') ? FWOnetVectors.readLocalQuizBlob() : null;
  var scores = q && q.scores ? q.scores : null;
  FWOnetVectors.stretchFitCandidates({ scores: scores, limit: 3 }).then(function (candidates) {
    if (token !== stretchRunToken) return; // superseded by a newer run
    renderStretchFits(candidates || []);
    if (candidates && candidates.length) upgradeStretchExplanations(candidates, token);
  }).catch(function () { /* leave whatever is rendered */ });
}

(function wireStretchDismiss() {
  var btn = document.getElementById('hub-stretch-dismiss');
  if (!btn) return;
  btn.addEventListener('click', function () {
    try { sessionStorage.setItem(STRETCH_DISMISS_KEY, '1'); } catch (_) {}
    var el = document.getElementById('hub-stretch-fits');
    if (el) el.hidden = true;
  });
})();

function exitToOverview() {
  if (!onetHubActive || !window.FWOnetHub) return;
  var exitCam = FWOnetHub.exitSectorMode(viewW, viewH);
  invalidateSectorLabelCache();
  lastSectorLabelZoomBucket = null;
  careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
  rebuildCareersById();
  closePanel();
  syncMapHud();
  animateCameraTo(exitCam, 320);
}

// ── COORDINATE HELPERS ──
function hubWorldW() {
  if (onetHubActive && window.FWOnetHub && typeof FWOnetHub.WORLD_W === 'function') {
    return FWOnetHub.WORLD_W();
  }
  return 100;
}
function hubWorldH() {
  if (onetHubActive && window.FWOnetHub && typeof FWOnetHub.WORLD_H === 'function') {
    return FWOnetHub.WORLD_H();
  }
  return 100;
}
function clampHubPan() {
  if (onetHubActive && window.FWOnetHub && typeof FWOnetHub.clampPan === 'function') {
    const c = FWOnetHub.clampPan(state.panX, state.panY, state.zoom, viewW, viewH);
    state.panX = c.panX;
    state.panY = c.panY;
  }
}
function hubMinZoom() {
  if (onetHubActive && window.FWOnetHub && typeof FWOnetHub.getMinZoom === 'function') {
    return FWOnetHub.getMinZoom(viewW, viewH);
  }
  return (onetHubActive && window.FWOnetHub && FWOnetHub.MIN_ZOOM) ? FWOnetHub.MIN_ZOOM : 0.5;
}
function hubMaxZoom() {
  if (onetHubActive && window.FWOnetHub && typeof FWOnetHub.getMaxZoom === 'function') {
    return FWOnetHub.getMaxZoom(viewW, viewH);
  }
  return (onetHubActive && window.FWOnetHub && FWOnetHub.MAX_ZOOM) ? FWOnetHub.MAX_ZOOM : 4;
}

const ZOOM_SENSITIVITY = 0.0008;
const ZOOM_STEP_CAP = 0.04;

function applyHubWheelZoom(deltaY, mx, my) {
  if (camAnim) cancelCameraAnim();
  lastZoomInputAt = performance.now();
  if (!onetHubActive || !window.FWOnetHub) {
    const factor = deltaY < 0 ? 1.03 : 0.97;
    const newZoom = Math.min(hubMaxZoom(), Math.max(hubMinZoom(), state.zoom * factor));
    state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
    state.panY = my - (my - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;
    return;
  }

  FWOnetHub._syncPan(state.panX, state.panY);

  if (FWOnetHub.getHubMode() === 'sector') {
    var rawFactor = Math.exp(-deltaY * ZOOM_SENSITIVITY);
    var capped = Math.max(1 - ZOOM_STEP_CAP, Math.min(1 + ZOOM_STEP_CAP, rawFactor));
    var result = FWOnetHub.applySectorZoomDelta(capped, viewW, viewH, mx, my, state.panX, state.panY);
    state.zoom = result.zoom;
    state.panX = result.panX;
    state.panY = result.panY;
    if (FWOnetHub.getSectorZoom() <= FWOnetHub.SECTOR_ZOOM_MIN + 0.001) {
      exitToOverview();
      return;
    }
  } else {
    var raw = Math.exp(-deltaY * ZOOM_SENSITIVITY);
    var factor = Math.max(1 - ZOOM_STEP_CAP, Math.min(1 + ZOOM_STEP_CAP, raw));
    var newZoom = Math.min(hubMaxZoom(), Math.max(hubMinZoom(), state.zoom * factor));
    state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
    state.panY = my - (my - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;

    var transition = FWOnetHub.evaluateModeTransition(state.zoom, state.panX, state.panY, viewW, viewH);
    if (transition.action === 'enter' && transition.camera) {
      state.zoom = transition.camera.zoom;
      state.panX = transition.camera.panX;
      state.panY = transition.camera.panY;
      invalidateSectorLabelCache();
      lastSectorLabelZoomBucket = sectorZoomBucket();
      FWOnetHub.invalidateViewport();
    }
  }
  clampHubPan();
  maybeInvalidateSectorLabelCacheOnZoom();
  requestHubRedraw();
  syncMapHud();
}

function lerp(a, b, t) { return a + (b - a) * t; }


// ── ANIMATION LOOP ──
function forceHubRepaint() {
  requestHubRedraw();
}

document.addEventListener('visibilitychange', function () {
  animationPaused = document.hidden;
  if (animationPaused && rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  } else {
    forceHubRepaint();
    if (!rafId) loop();
  }
});
window.addEventListener('pageshow', forceHubRepaint);

// ── CAMERA ANIMATION ──
// Sector enter/exit and fly-to used to teleport the camera in one frame —
// the single biggest source of perceived zoom jank. Short eased tween;
// any user input (wheel/drag) cancels it and takes over.
let camAnim = null;

function cancelCameraAnim() {
  if (camAnim && typeof camAnim.onDone === 'function') camAnim.onDone();
  camAnim = null;
}

function animateCameraTo(target, ms, onDone) {
  if (!target) return;
  if (!motionOk) {
    state.zoom = target.zoom;
    state.panX = target.panX;
    state.panY = target.panY;
    if (typeof onDone === 'function') onDone();
    requestHubRedraw();
    return;
  }
  camAnim = {
    from: { zoom: state.zoom, panX: state.panX, panY: state.panY },
    to: { zoom: target.zoom, panX: target.panX, panY: target.panY },
    start: performance.now(),
    ms: ms || 320,
    onDone: onDone || null,
  };
  requestHubRedraw();
}

function stepCameraAnim(now) {
  if (!camAnim) return false;
  var t = Math.min(1, (now - camAnim.start) / camAnim.ms);
  var ease = 1 - Math.pow(1 - t, 3);
  var from = camAnim.from;
  var to = camAnim.to;
  // Zoom interpolates in log space so the motion feels constant-rate.
  state.zoom = from.zoom * Math.pow(to.zoom / from.zoom, ease);
  state.panX = from.panX + (to.panX - from.panX) * ease;
  state.panY = from.panY + (to.panY - from.panY) * ease;
  if (t >= 1) {
    state.zoom = to.zoom;
    state.panX = to.panX;
    state.panY = to.panY;
    var done = camAnim.onDone;
    camAnim = null;
    if (typeof done === 'function') done();
    return false;
  }
  return true;
}

function loop() {
  if (animationPaused || !hubBootOk) {
    rafId = null;
    dismissHubLoadingOnce();
    return;
  }
  const camAnimating = stepCameraAnim(performance.now());
  if (camAnimating) needsRedraw = true;
  const onetHub = onetHubActive && window.FWOnetHub;
  const inSector = onetHub && FWOnetHub.getHubMode() === 'sector';
  let sectorAnimating = false;
  let overviewAnimating = false;
  if (onetHub && !inSector) {
    var hoverTarget = state.hoveredZone ? 1 : 0;
    var nextZoneA = lerp(state.zoneHoverAlpha || 0, hoverTarget, 0.12);
    if (Math.abs(nextZoneA - (state.zoneHoverAlpha || 0)) > 0.008) {
      state.zoneHoverAlpha = nextZoneA;
      overviewAnimating = true;
    } else {
      state.zoneHoverAlpha = hoverTarget;
    }
  }
  if (onetHub && !needsRedraw && !inSector && !overviewAnimating) {
    rafId = null;
    dismissHubLoadingOnce();
    return;
  }
  try {
    if (onetHubActive && window.FWOnetHub) {
      if (typeof FWOnetHub._syncPan === 'function') {
        FWOnetHub._syncPan(state.panX, state.panY);
      }
      careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
      syncSectorHoverRadii();
    }
    const animCareers = hubOverviewAnimCareers();
    if (!onetHub) {
    animCareers.forEach(c => {
      if (!c || !c.id) return;
      const target = state.hoveredId === c.id ? 15 : 11;
      const cur = hoverRadii[c.id] ?? 11;
      const next = lerp(cur, target, 0.18);
      if (Math.abs(next - cur) > 0.01) hoverRadii[c.id] = next;
      else hoverRadii[c.id] = target;
    });
    }
    if (inSector) {
      careers.forEach(function (c) {
        if (!c || !c.id) return;
        const target = sectorOrbBaseRadiusPx(state.hoveredId === c.id || state.selectedId === c.id);
        const cur = sectorHoverRadii[c.id] ?? sectorOrbBaseRadiusPx(false);
        const next = lerp(cur, target, 0.14);
        if (Math.abs(next - cur) > 0.02) {
          sectorHoverRadii[c.id] = next;
          sectorAnimating = true;
        } else {
          sectorHoverRadii[c.id] = target;
        }
      });
      if (sectorAnimating || isGoldShimmerActive()) needsRedraw = true;
    }
    render();
  } catch (err) {
    console.error('[Career Hub] frame failed', err);
    window.__hubLastRenderError = err;
    showHubBootError('Career map hit a display error. Try refreshing.');
  } finally {
    dismissHubLoadingOnce();
  }
  if (onetHub) {
    rafId = (needsRedraw || inSector || overviewAnimating || camAnim)
      ? requestAnimationFrame(loop) : null;
  } else {
    rafId = requestAnimationFrame(loop);
  }
}
function isGoldShimmerActive() {
  if (!motionOk || !onetHubActive) return false;
  return careers.some(function (c) {
    var fit = c.fitScore != null ? c.fitScore : c.personalityFit;
    if (fit == null || fit < 70) return false;
    return state.hoveredId === c.id || state.selectedId === c.id;
  });
}
hubLoopReady = true;
if (hubBootOk) loop();

// ── TOOLTIP ──
const tooltip = document.getElementById('tooltip');
const ttName = document.getElementById('tt-name');
const ttScore = document.getElementById('tt-score');
const ttInd = document.getElementById('tt-industry');
const ttAccent = document.getElementById('tt-accent');
const ttFitPersonality = document.getElementById('tt-fit-personality');
const ttFitObjective = document.getElementById('tt-fit-objective');
const ttPersonalityVal = document.getElementById('tt-personality-val');
const ttObjectiveVal = document.getElementById('tt-objective-val');

function showTooltip(career, mx, my) {
  ttName.textContent = career.name;
  var objActive = window.FWOnetHub && typeof FWOnetHub.objectiveVectorActive === 'function'
    && FWOnetHub.objectiveVectorActive();
  if (onetHubActive && ttFitPersonality && ttFitObjective) {
    if (ttScore) {
      ttScore.hidden = false;
      ttScore.textContent = career.fitScore != null
        ? career.fitScore + '% overall fit' : '—';
    }
    ttFitPersonality.hidden = false;
    ttFitObjective.hidden = !objActive;
    if (ttPersonalityVal) ttPersonalityVal.textContent = formatFitPercentile(career.personalityFit);
    if (ttObjectiveVal) ttObjectiveVal.textContent = formatFitPercentile(career.objectiveFit);
  } else {
    if (ttFitPersonality) ttFitPersonality.hidden = true;
    if (ttFitObjective) ttFitObjective.hidden = true;
    if (ttScore) {
      ttScore.hidden = false;
      if (career.fitScore != null) ttScore.textContent = career.fitScore + '% match';
      else ttScore.textContent = '';
    }
  }
  ttInd.textContent = career.industry;
  if (ttAccent) {
    var fitPct = career.fitScore != null ? career.fitScore
      : (career.personalityFit != null ? career.personalityFit : null);
    if (onetHubActive && window.FWHubCanvasRender && typeof FWHubCanvasRender.rarityOf === 'function' && fitPct != null) {
      ttAccent.style.background = FWHubCanvasRender.rarityOf(fitPct).base;
    } else {
      var zoneHex = career.hubZone && window.FWOnetHub && typeof FWOnetHub.getZoneColor === 'function'
        ? FWOnetHub.getZoneColor(career.hubZone) : (career.orbColor || '#78716C');
      ttAccent.style.background = zoneHex;
    }
  }
  const OFFSET = 16;
  let tx = mx + OFFSET, ty = my - 10;
  if (tx + 220 > window.innerWidth) tx = mx - 220 - OFFSET;
  if (ty + 90 > window.innerHeight) ty = my - 90;
  tooltip.style.left = tx + 'px';
  tooltip.style.top = ty + 'px';
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
}
function hideTooltip() {
  tooltip.classList.remove('visible');
  tooltip.setAttribute('aria-hidden', 'true');
}

// ── DETAIL PANEL ──
const panel = document.getElementById('detail-panel');

function openPanel(career) {
  if (window.FWHubRefine && typeof FWHubRefine.close === 'function') FWHubRefine.close();
  if (window.FWHubAcademics && typeof FWHubAcademics.close === 'function') FWHubAcademics.close();
  recordRecentCareer(career.id);
  state.selectedId = career.id;
  const inSector = onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() === 'sector';
  const rar = orbPalette(career, { sectorMode: inSector });
  const badge = document.getElementById('panel-industry');
  badge.textContent = career.industry;
  const zoneHex = onetHubActive && career.hubZone && window.FWOnetHub && typeof FWOnetHub.getZoneColor === 'function'
    ? FWOnetHub.getZoneColor(career.hubZone) : career.orbColor;
  badge.style.background = zoneHex ? zoneHex + '22' : 'rgba(' + rar.glow + ',0.18)';
  badge.style.color = zoneHex || rar.light;
  badge.style.borderColor = zoneHex ? zoneHex + '55' : '';
  document.getElementById('panel-career-name').textContent = career.name;

  const aiTag = document.getElementById('panel-ai-derived');
  if (aiTag) {
    aiTag.hidden = !career.aiDerived;
    if (career.aiDerived) {
      var baseTitle = career.derivedFrom && career.derivedFrom.title;
      aiTag.textContent = baseTitle ? 'AI-derived from ' + baseTitle : 'AI-derived';
    }
  }

  const pEl = document.getElementById('panel-personality-fit');
  const oEl = document.getElementById('panel-objective-fit');
  const overallEl = document.getElementById('panel-overall-fit');
  const pBar = document.getElementById('panel-personality-bar');
  const oBar = document.getElementById('panel-objective-bar');
  const tradeEl = document.getElementById('panel-tradeoff');
  const objectiveRow = oEl && oEl.closest('.panel-fit-row');
  const objectiveBarWrap = oBar && oBar.parentElement;
  var objActive = window.FWOnetHub && typeof FWOnetHub.objectiveVectorActive === 'function'
    && FWOnetHub.objectiveVectorActive();
  if (onetHubActive && pEl && oEl) {
    if (overallEl) overallEl.textContent = formatFitPercentile(career.fitScore);
    pEl.textContent = formatFitPercentile(career.personalityFit);
    oEl.textContent = formatFitPercentile(career.objectiveFit);
    if (objectiveRow) objectiveRow.hidden = !objActive;
    if (objectiveBarWrap) objectiveBarWrap.hidden = !objActive;
    if (pBar) {
      pBar.style.width = (career.personalityFit || 0) + '%';
      pBar.style.background = zoneHex || rar.base;
      const highFit = career.fitScore != null && career.fitScore >= 70;
      pBar.classList.toggle('panel-fit-bar-fill--glow', highFit);
      if (highFit) {
        pBar.style.boxShadow = '0 0 14px rgba(' + (rar.glow || '255,205,70') + ',0.55)';
      } else {
        pBar.style.boxShadow = '';
      }
    }
    if (oBar) {
      oBar.style.width = (career.objectiveFit || 0) + '%';
      oBar.style.background = isHubLightTheme() ? 'rgba(62, 40, 28, 0.45)' : 'rgba(255,255,255,0.45)';
    }
    if (tradeEl && window.FWOnetHub) {
      var trade = (career.personalityFit != null && career.objectiveFit != null)
        ? FWOnetHub.tradeOffLabel(career.personalityFit, career.objectiveFit) : '';
      tradeEl.textContent = trade;
      tradeEl.hidden = !trade;
    }
    var prepRow = document.getElementById('panel-readiness-row');
    var prepEl = document.getElementById('panel-preparedness-fit');
    if (prepRow && prepEl) {
      var showPrep = career.preparedness != null && career.objectiveFit != null;
      prepRow.hidden = !showPrep;
      prepEl.textContent = showPrep ? formatFitPercentile(career.preparedness) : '—';
    }
    const legacyWrap = document.querySelector('.panel-fit-wrap--legacy');
    if (legacyWrap) legacyWrap.style.display = 'none';
    const dual = document.getElementById('panel-dual-fit');
    if (dual) dual.hidden = false;
  } else {
    const fitLine = career.fitScore != null ? (career.fitScore + '% match') : '—';
    document.getElementById('panel-fit-pct').textContent = fitLine;
    const bar = document.getElementById('panel-fit-bar');
    bar.style.width = (career.fitScore || 0) + '%';
    bar.style.background = `linear-gradient(90deg, ${rar.dark}, ${rar.base}, ${rar.light})`;
    bar.style.boxShadow = `0 0 12px rgba(${rar.glow},0.6)`;
    const legacyWrap = document.querySelector('.panel-fit-wrap--legacy');
    if (legacyWrap) legacyWrap.style.display = '';
    const dual = document.getElementById('panel-dual-fit');
    if (dual) dual.hidden = true;
    if (tradeEl) tradeEl.hidden = true;
  }
  const skillsWrap = document.getElementById('panel-skills');
  if (career.skills && career.skills.length) {
    skillsWrap.innerHTML = career.skills.map(s => `<span class="skill-pill">${titleCaseSkill(s)}</span>`).join('');
  } else if (onetHubActive && career.vectorLoaded) {
    skillsWrap.innerHTML = '<span class="panel-skills-empty">Skills unavailable</span>';
  } else {
    skillsWrap.innerHTML = '<span class="panel-skills-empty">Skills data loading…</span>';
  }
  document.getElementById('panel-description').textContent = career.description;
  renderPanelRelatedCareers(career);
  renderPanelFragments(career);
  // Career Tester — live in both hub modes; slug via the panel resolver
  // (O*NET-aware), same source career.html links use.
  const daylifeBtn = document.getElementById('panel-daylife');
  if (daylifeBtn) {
    const dlSlug = resolveCareerPanelSlug(career);
    daylifeBtn.hidden = !dlSlug;
    daylifeBtn.onclick = dlSlug
      ? function () {
          window.location.href = 'simulation.html?slug=' + encodeURIComponent(dlSlug)
            + '&name=' + encodeURIComponent(career.name || career.title || '');
        }
      : null;
  }
  const deepBtn = document.getElementById('panel-deep-dive');
  const roadmapBtn = document.getElementById('panel-roadmap');
  if (deepBtn) {
    const slug = resolveCareerPanelSlug(career);
    if (slug) {
      let careerUrl = 'career.html?slug=' + encodeURIComponent(slug);
      if (career.soc) careerUrl += '&soc=' + encodeURIComponent(career.soc);
      deepBtn.href = careerUrl;
      deepBtn.style.display = '';
      if (roadmapBtn) {
        roadmapBtn.href = 'roadmap.html?career=' + encodeURIComponent(slug);
        roadmapBtn.style.display = '';
        roadmapBtn.onclick = function (e) {
          try {
            sessionStorage.setItem('fw_roadmap_pending_career', JSON.stringify({ slug: slug, name: career.name }));
          } catch (_) { /* ignore */ }
          if (window.FWAuth && FWAuth.authEmail && FWAuth.authEmail()
            && typeof FWAuth.recordCareerFocus === 'function') {
            FWAuth.recordCareerFocus({ slug: slug, name: career.name, source: 'build_roadmap' })
              .catch(function () { /* ignore */ });
          }
        };
      }
    } else {
      deepBtn.style.display = 'none';
      if (roadmapBtn) roadmapBtn.style.display = 'none';
    }
  }
  panel.classList.add('open');

  if (window.FWAuth && FWAuth.authEmail && FWAuth.authEmail()
    && typeof FWAuth.recordCareerFocus === 'function' && career) {
    const slug = resolveCareerPanelSlug(career);
    if (slug) {
      const focus = (typeof FWAuth.readCareerFocus === 'function') ? FWAuth.readCareerFocus() : null;
      if (!focus || focus.slug !== slug) {
        FWAuth.recordCareerFocus({ slug: slug, name: career.name, source: 'hub_view' })
          .catch(function () { /* ignore */ });
      }
    }
  }
}

function renderPanelRelatedCareers(career) {
  var wrap = document.getElementById('panel-related');
  var chipsEl = document.getElementById('panel-related-chips');
  if (!wrap || !chipsEl) return;
  if (!onetHubActive || !career || !career.soc || !window.FWOnetHub
    || typeof FWOnetHub.getSimilarNeighbors !== 'function') {
    wrap.hidden = true;
    chipsEl.innerHTML = '';
    return;
  }
  var neighbors = FWOnetHub.getSimilarNeighbors(career.soc, { limit: 5, zoneOnly: true });
  if (!neighbors.length) {
    wrap.hidden = true;
    chipsEl.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  chipsEl.innerHTML = neighbors.map(function (entry) {
    var c = entry.career;
    var slug = resolveCareerPanelSlug(c);
    var rel = FWOnetHub.relationLabel ? FWOnetHub.relationLabel(entry.relation) : entry.relation;
    var href = slug ? ('career.html?slug=' + encodeURIComponent(slug)
      + (c.soc ? '&soc=' + encodeURIComponent(c.soc) : '')) : '#';
    return '<a class="panel-related-chip" href="' + href + '" data-career-id="' + escAttr(c.id) + '">'
      + '<span class="panel-related-chip-name">' + escHtml(c.name) + '</span>'
      + '<span class="panel-related-chip-badge">' + escHtml(rel) + '</span>'
      + '</a>';
  }).join('');
  chipsEl.querySelectorAll('.panel-related-chip[data-career-id]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('data-career-id');
      var hit = careerById(id);
      if (hit && link.getAttribute('href') === '#') {
        e.preventDefault();
        openPanel(hit);
      }
    });
  });
}

// "AI specializations" strip: runtime AI-derived fragment careers whose base is
// the currently-open (real O*NET) career. Fetched async from /derive-career so
// it never blocks panel render; hidden when zero fragments or when the open
// career is itself derived. Mirrors renderPanelRelatedCareers.
function renderPanelFragments(career) {
  var wrap = document.getElementById('panel-fragments');
  var chipsEl = document.getElementById('panel-fragments-chips');
  if (!wrap || !chipsEl) return;
  fragmentRunToken += 1;
  var token = fragmentRunToken;
  wrap.hidden = true;
  chipsEl.innerHTML = '';
  // Never derive off a derived career, off a synthetic SOC, or without a SOC.
  if (!career || !career.soc || career.aiDerived || String(career.soc).indexOf('99-') === 0) return;
  fetch('/derive-career?base=' + encodeURIComponent(career.soc)).then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (data) {
    if (token !== fragmentRunToken) return; // a newer panel opened
    var fragments = (data && Array.isArray(data.fragments)) ? data.fragments : [];
    if (!fragments.length) return;
    // Merge rows into the catalog so getBySoc/slug resolve them (chip click can
    // then open in-memory instead of navigating).
    if (window.FWOnetCatalog && typeof FWOnetCatalog.addDerivedRows === 'function') {
      FWOnetCatalog.addDerivedRows(fragments);
    }
    wrap.hidden = false;
    chipsEl.innerHTML = fragments.map(function (f) {
      var slug = f.slug || (window.FWOnetCatalog && FWOnetCatalog.slugify
        ? FWOnetCatalog.slugify(f.title) : '');
      var href = slug ? ('career.html?slug=' + encodeURIComponent(slug)
        + (f.soc ? '&soc=' + encodeURIComponent(f.soc) : '')) : '#';
      return '<a class="panel-related-chip panel-fragment-chip" href="' + escAttr(href) + '"'
        + ' data-fragment-soc="' + escAttr(f.soc) + '">'
        + '<span class="panel-related-chip-name">' + escHtml(f.title) + '</span>'
        + '<span class="panel-related-chip-badge panel-fragment-badge">AI-derived</span>'
        + '</a>';
    }).join('');
    chipsEl.querySelectorAll('.panel-fragment-chip[data-fragment-soc]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var soc = link.getAttribute('data-fragment-soc');
        if (!soc) return;
        var hubHit = (onetHubActive && window.FWOnetHub && typeof FWOnetHub.getCareerBySoc === 'function')
          ? FWOnetHub.getCareerBySoc(soc) : null;
        if (hubHit) { e.preventDefault(); openPanel(hubHit); }
        // else fall through to the href (career.html deep dive)
      });
    });
  }).catch(function () { /* tolerant: strip stays hidden */ });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

function closePanel() {
  state.selectedId = null;
  panel.classList.remove('open');
}

window.FWHubDashboard = { closePanel: closePanel };

document.getElementById('panel-close')?.addEventListener('click', closePanel);
document.getElementById('hub-sector-back')?.addEventListener('click', exitToOverview);

// ── FIT EXPLAINER ──
const fitExplainerEl = document.getElementById('hub-fit-explainer');
function openFitExplainer() {
  if (fitExplainerEl) fitExplainerEl.hidden = false;
  document.getElementById('hub-fit-explainer-close')?.focus();
}
function closeFitExplainer() {
  if (fitExplainerEl) fitExplainerEl.hidden = true;
  try { localStorage.setItem(FIT_EXPLAINER_KEY, '1'); } catch (_) {}
  requestHubRedraw();
}
document.getElementById('hub-fit-help')?.addEventListener('click', openFitExplainer);
document.getElementById('hub-fit-explainer-close')?.addEventListener('click', closeFitExplainer);
fitExplainerEl?.addEventListener('click', function (e) {
  if (e.target === fitExplainerEl) closeFitExplainer();
});

// ── POINTER EVENTS (mouse + touch) ──
if (hubBootOk) {
function hubPointerMove(e) {
  if (state.activePointerId != null && e.pointerId !== state.activePointerId) return;
  const pt = pointerOnCanvas(e);
  const mx = pt.x, my = pt.y;
  state.mouseX = mx; state.mouseY = my; state.mouseOn = true;

  if (state.isDragging) {
    const dx = mx - state.dragStart.x, dy = my - state.dragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.hasDragged = true;
    state.panX = state.panStart.x + dx;
    state.panY = state.panStart.y + dy;
    clampHubPan();
    canvas.style.cursor = 'grabbing';
    requestHubRedraw();
    return;
  }

  const prevHover = state.hoveredId;
  const prevZone = state.hoveredZone;
  const hit = careerAtScreen(mx, my);
  if (hit) {
    state.hoveredId = hit.id;
    state.hoveredZone = null;
    canvas.style.cursor = 'pointer';
    showTooltip(hit, mx, my);
  } else {
    state.hoveredId = null;
    hideTooltip();
    if (onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() === 'overview') {
      const zone = zoneAtScreen(mx, my);
      state.hoveredZone = zone || null;
      canvas.style.cursor = zone ? 'pointer' : 'grab';
    } else {
      state.hoveredZone = null;
      canvas.style.cursor = 'grab';
    }
  }
  if (prevHover !== state.hoveredId || prevZone !== state.hoveredZone) {
    requestHubRedraw();
  } else if (state.mouseOn && motionOk && !isHubLightTheme()) {
    // Dark-mode cursor spotlight tracks the pointer — needs a redraw per move
    // (sector mode already renders continuously; overview renders are cheap).
    requestHubRedraw();
  }
}

function hubPointerUp(e) {
  if (state.activePointerId != null && e.pointerId !== state.activePointerId) return;
  state.activePointerId = null;
  if (!state.isDragging) return;
  state.isDragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  canvas.style.cursor = 'grab';

  if (!state.hasDragged) {
    const pt = pointerOnCanvas(e);
    const hit = careerAtScreen(pt.x, pt.y);
    if (hit) {
      openPanel(hit);
      requestHubRedraw();
    } else if (onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() === 'overview') {
      const zone = zoneAtScreen(pt.x, pt.y);
      if (zone && typeof FWOnetHub.enterSectorByZone === 'function') {
        const cam = FWOnetHub.enterSectorByZone(zone, viewW, viewH);
        if (cam) {
          // Mode flips now; the camera glides to the sector frame instead of
          // teleporting, so the orbs slide into place.
          invalidateSectorLabelCache();
          lastSectorLabelZoomBucket = sectorZoomBucket();
          careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
          rebuildCareersById();
          closePanel();
          syncMapHud();
          animateCameraTo(cam, 360, function () {
            clampHubPan();
            invalidateSectorLabelCache();
          });
        }
      } else {
        closePanel();
      }
    } else {
      closePanel();
      requestHubRedraw();
    }
  }
}

canvas.addEventListener('pointerdown', e => {
  if (camAnim) cancelCameraAnim();
  state.activePointerId = e.pointerId;
  const pt = pointerOnCanvas(e);
  state.isDragging = true;
  state.hasDragged = false;
  state.dragStart = { x: pt.x, y: pt.y };
  state.panStart = { x: state.panX, y: state.panY };
  canvas.style.cursor = 'grabbing';
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});

canvas.addEventListener('pointermove', hubPointerMove);
canvas.addEventListener('pointerup', hubPointerUp);
canvas.addEventListener('pointercancel', function (e) {
  state.isDragging = false;
  state.activePointerId = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
});

canvas.addEventListener('pointerleave', () => {
  if (state.isDragging) return;
  state.hoveredId = null;
  state.hoveredZone = null;
  state.mouseOn = false;
  hideTooltip();
  canvas.style.cursor = 'default';
  requestHubRedraw();
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const pt = pointerOnCanvas(e);
  applyHubWheelZoom(e.deltaY, pt.x, pt.y);
}, { passive: false });
}

// ── SEARCH ──
// ── SEARCH + SUGGESTIONS ──
// Recently-opened careers (most-recent first), persisted so suggestions survive reloads.
const RECENT_KEY = 'fw_hub_recent_careers_v1';
function readRecent() {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (!Array.isArray(a)) return [];
    return a.filter(function (id) {
      return !!careerById(id);
    });
  }
  catch (_) { return []; }
}
function recordRecentCareer(id) {
  let a = readRecent().filter(x => x !== id);
  a.unshift(id);
  a = a.slice(0, 5);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(a)); } catch (_) {}
}
function careerById(id) {
  if (onetHubActive && window.FWOnetHub) {
    return FWOnetHub.careerById(id) || careers.find(c => c.id === id) || null;
  }
  return careers.find(c => c.id === id) || null;
}

const searchInput = document.getElementById('search');
const suggestEl = document.getElementById('search-suggest');

// Default seeds shown before the user has opened anything.
const DEFAULT_SUGGEST = ['Data Scientist', 'Accountant'];

function suggestionItems(query) {
  query = (query || '').trim().toLowerCase();
  if (query && onetHubActive && window.FWOnetHub) {
    return FWOnetHub.searchAll(query, 8).map(c => ({ career: c, kind: 'match' }));
  }
  if (query) {
    // Typed query → matching careers by name (cap 6).
    return careers.filter(c => c.name.toLowerCase().includes(query))
      .slice(0, 6).map(c => ({ career: c, kind: 'match' }));
  }
  // Empty box → last 1-2 opened careers, else the default seeds.
  const recent = readRecent().map(careerById).filter(Boolean).slice(0, 2);
  if (recent.length) return recent.map(c => ({ career: c, kind: 'recent' }));
  return DEFAULT_SUGGEST.map(n => careers.find(c => c.name === n)).filter(Boolean)
    .map(c => ({ career: c, kind: 'suggested' }));
}

function renderSuggest(query) {
  if (!suggestEl || !searchInput) return;
  const items = suggestionItems(query);
  const q = (query || '').trim();
  if (!items.length && q) {
    suggestEl.innerHTML = '<div class="ss-empty" role="status">No careers found for “' + q.replace(/</g, '&lt;') + '”</div>';
    suggestEl.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    return;
  }
  if (!items.length) { hideSuggest(); return; }
  const label = { recent: 'Recently viewed', suggested: 'Try', match: '' };
  suggestEl.innerHTML = items.map(it => {
    const tag = it.kind !== 'match' ? `<span class="ss-tag">${label[it.kind]}</span>` : '';
    return `<button type="button" class="ss-item" role="option" data-id="${it.career.id}">`
      + `<span class="ss-name">${it.career.name}</span>`
      + `<span class="ss-industry">${it.career.industry}</span>${tag}</button>`;
  }).join('');
  suggestEl.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}
function hideSuggest() {
  if (!suggestEl || !searchInput) return;
  suggestEl.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
}

if (searchInput && suggestEl) {
let searchDebounceTimer = null;
searchInput.addEventListener('input', e => {
  // Debounce the expensive parts (catalog search, label relayout, redraw);
  // the suggest dropdown stays immediate for responsiveness.
  renderSuggest(e.target.value);
  const value = e.target.value.trim();
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    state.searchQuery = value;
    if (onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() === 'sector') {
      invalidateSectorLabelCache();
    }
    syncMapHud();
    requestHubRedraw();
  }, 120);
});
searchInput.addEventListener('focus', e => { renderSuggest(e.target.value); });
searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') { hideSuggest(); searchInput.blur(); } });

// Pick a suggestion → open that career.
suggestEl.addEventListener('mousedown', e => {
  const btn = e.target.closest('.ss-item');
  if (!btn) return;
  e.preventDefault();
  const c = careerById(btn.getAttribute('data-id'));
  if (c) {
    searchInput.value = '';
    state.searchQuery = '';
    if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
    hideSuggest();
    if (onetHubActive && window.FWOnetHub) {
      const pre = { zoom: state.zoom, panX: state.panX, panY: state.panY };
      FWOnetHub.flyToCareer(c, state);
      const target = { zoom: state.zoom, panX: state.panX, panY: state.panY };
      state.zoom = pre.zoom; state.panX = pre.panX; state.panY = pre.panY;
      animateCameraTo(target, 380, function () { invalidateSectorLabelCache(); });
    }
    invalidateSectorLabelCache();
    requestHubRedraw();
    openPanel(c);
  }
});

// Dismiss when focus/click leaves the search area.
document.addEventListener('click', e => {
  if (!e.target.closest('#search-wrap')) hideSuggest();
});
}

// ── Career advisor (FlightWay coach) ──
function openCareerAdvisor() {
  try {
    const quizState = FWHubCareers.readQuizStateFromUrl();
    if (quizState && quizState.scores) {
      localStorage.setItem(FWHubCareers.HUB_QUIZ_KEY, JSON.stringify({
        name: userName,
        scores: quizState.scores
      }));
    } else if (hubQuizScores) {
      localStorage.setItem(FWHubCareers.HUB_QUIZ_KEY, JSON.stringify({ name: userName, scores: hubQuizScores }));
    }
  } catch (_) {}
  window.location.replace('coach.html');
}

// The advisor nav tab was replaced by the Marco bubble (marco.js), so this
// element may be absent — guard against it to avoid breaking hub init.
var hubAdvisorLink = document.getElementById('hub-advisor-link');
if (hubAdvisorLink) {
  hubAdvisorLink.addEventListener('click', function (e) {
    e.preventDefault();
    openCareerAdvisor();
  });
}

// ── SIGNED-IN USER (resolved during personalization above) ──
(function() {
  const name = userName || 'Student';
  const nameEl = document.getElementById('user-display-name');
  const avatarEl = document.getElementById('user-avatar-initials');
  if (nameEl) nameEl.textContent = name;
  if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
})();

window.addEventListener('flightway-theme-change', () => { requestHubRedraw(); syncMapHud(); });

function finishHubBootFromInit(ok) {
  dismissHubLoadingOnce();
  if (!ok) {
    showHubBootError('Career map data failed to load.');
    return;
  }
  var zoneCount = 0;
  if (window.FWOnetHub && typeof FWOnetHub.getOverviewZones === 'function') {
    zoneCount = FWOnetHub.getOverviewZones().length;
  }
  if (!zoneCount) {
    showHubBootError('Career map loaded empty. Try refreshing the page.');
    return;
  }
  hideHubBootError();
  onetHubActive = true;
  subNodes.length = 0;
  if (typeof FWOnetHub.suggestInitialCamera === 'function') {
    const cam = FWOnetHub.suggestInitialCamera(viewW, viewH);
    state.zoom = cam.zoom;
    state.panX = cam.panX;
    state.panY = cam.panY;
    clampHubPan();
  }
  careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
  syncHoverRadii();
  rebuildCareersById();
  needsRedraw = true;
  if (hubLoopReady && hubBootOk) loop();
  syncMapHud();
  refreshStretchFits();
  try {
    if (!localStorage.getItem(FIT_EXPLAINER_KEY)) openFitExplainer();
  } catch (_) {}
  console.info('[Career Hub] O*NET sector-stable map active');
  var bootSoc = new URLSearchParams(window.location.search).get('soc');
  if (bootSoc && window.FWOnetHub) {
    var bootCareer = FWOnetHub.careerById('soc:' + bootSoc) || FWOnetHub.careerById(bootSoc);
    if (bootCareer) {
      FWOnetHub.flyToCareer(bootCareer, state);
      invalidateSectorLabelCache();
      careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
      rebuildCareersById();
      openPanel(bootCareer);
      requestHubRedraw();
    }
  }
  warmHubFragments();
}

// Merge freshly-fetched derived rows into the live catalog and request a
// redraw. The map's updateViewport runs syncDerivedRows() every frame, which
// polls FWOnetCatalog row count and folds any newly-appended rows into
// state.all (then invalidates the overview layer) — so a redraw is all that's
// needed to surface the new satellites; no direct map-sync call exists to make.
function mergeFragmentsIntoHub(fragments) {
  if (!fragments || !fragments.length) return;
  if (window.FWOnetCatalog && typeof FWOnetCatalog.addDerivedRows === 'function') {
    FWOnetCatalog.addDerivedRows(fragments);
  }
  requestHubRedraw();
}

// B1: surface the EXISTING global set of AI-derived fragment careers (static
// sidecar + all D1 rows) on hub boot, so satellites render even for a user
// who never opens a drawer. Best-effort — never blocks boot.
// B2: for a signed-in user, warm fragments for their targeted (careerFocus)
// career — same primary target as portal-snapshot.js warmFragmentsForSnapshot —
// so a user landing straight on the hub gets satellites generated for the
// career most relevant to them, not just whatever already exists globally.
function warmHubFragments() {
  try {
    fetch('/derive-career?all=1').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      var fragments = (data && Array.isArray(data.fragments)) ? data.fragments : [];
      mergeFragmentsIntoHub(fragments);
    }).catch(function () { /* best-effort: hub still works without global fragments */ });
  } catch (_) { /* best-effort */ }

  try {
    if (!(window.FWAuth && FWAuth.authEmail && FWAuth.authEmail() && typeof FWAuth.authFetch === 'function')) return;
    // The hub overview computes NO per-career fits at boot (fetched lazily on
    // sector entry — perf design), so ranking careers by fitScore here would
    // find nothing. The user's targeted career (careerFocus) is the cheap,
    // always-available, most-relevant base to warm. Skip synthetic 99- SOCs.
    var focus = (typeof FWAuth.readCareerFocus === 'function') ? FWAuth.readCareerFocus() : null;
    var focusSoc = focus && focus.soc ? String(focus.soc) : '';
    if (!focusSoc || focusSoc.indexOf('99-') === 0 || !/^\d{2}-\d{4}\.\d{2}$/.test(focusSoc)) return;
    FWAuth.authFetch('/derive-career', { method: 'POST', body: { baseSoc: focusSoc }, timeoutMs: 60000 })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (data) {
        var fragments = (data && Array.isArray(data.fragments)) ? data.fragments : [];
        mergeFragmentsIntoHub(fragments);
      })
      .catch(function () { /* best-effort: swallow, never block boot */ });
  } catch (_) { /* best-effort */ }
}

startHubBootWatchdog();

if (window.FWOnetHub) {
  FWOnetHub.onVectorsUpdated = function () {
    if (window.FWHubCanvasRender && FWHubCanvasRender.invalidateOverviewLayer) {
      FWHubCanvasRender.invalidateOverviewLayer();
    }
    if (onetHubActive && window.FWOnetHub) {
      careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
      rebuildCareersById();
      syncMapHud();
      if (state.selectedId) {
        var refreshed = careerById(state.selectedId);
        if (refreshed) openPanel(refreshed);
      }
    }
    refreshStretchFits();
    requestHubRedraw();
  };
  FWOnetHub.init().then(function (ok) {
    finishHubBootFromInit(ok);
  }).catch(function (err) {
    console.error('[Career Hub] FWOnetHub.init rejected', err);
    finishHubBootFromInit(false);
  });
}
