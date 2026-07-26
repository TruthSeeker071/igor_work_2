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

// ── BOOT PERF ──
// One permanent [fw-perf] line per hub boot, emitted when the loading veil
// lifts. Stages are plain `performance.mark`s so any hub module can set one
// without a shared object (hub-onet-map marks catalog + indexes); every value
// is milliseconds since navigation start. Declared with function/var only —
// this block is reachable from top-level boot (hub TDZ trap).
function hubPerfMark(stage) {
  try { performance.mark('fw-hub:' + stage); } catch (_) { /* no perf API */ }
}

function hubPerfAt(stage) {
  try {
    var entries = performance.getEntriesByName('fw-hub:' + stage);
    return entries.length ? Math.round(entries[entries.length - 1].startTime) : null;
  } catch (_) {
    return null;
  }
}

var hubPerfReported = false;
var hubFirstPaintMarked = false;
function hubPerfReport() {
  if (hubPerfReported) return;
  hubPerfReported = true;
  var parts = ['script-eval', 'catalog', 'indexes', 'first-paint', 'veil'].map(function (stage) {
    var t = hubPerfAt(stage);
    return stage + '=' + (t == null ? '-' : t + 'ms');
  });
  console.info('[fw-perf] hub boot ' + parts.join(' '));
}

// Run after first paint: idle if the browser offers it, else a short timer.
function hubAfterPaint(fn, delayMs) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: delayMs || 1500 });
    return;
  }
  setTimeout(fn, delayMs || 1500);
}

// Panel-only modules, kept off the boot parse budget and injected on first use
// or on idle — whichever comes first. Idempotent by the promise cache; the
// buster must match the one this page would have shipped in its script tag.
var HUB_LAZY_MODULES = {
  'career-compare': '/assets/js/hub/career-compare.js?v=20260721q',
  'career-deep-dives': '/assets/js/hub/career-deep-dives.js?v=20260703p',
};
var hubLazyLoads = {};
function ensureHubModule(name) {
  if (hubLazyLoads[name]) return hubLazyLoads[name];
  var src = HUB_LAZY_MODULES[name];
  if (!src) return Promise.resolve(false);
  hubLazyLoads[name] = new Promise(function (resolve) {
    var el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = function () { resolve(true); };
    el.onerror = function () { resolve(false); };
    (document.head || document.documentElement).appendChild(el);
  });
  return hubLazyLoads[name];
}

function warmHubLazyModules() {
  Object.keys(HUB_LAZY_MODULES).forEach(function (name) { ensureHubModule(name); });
}

// ── STATE ──
const state = {
  zoom: 1, panX: 0, panY: 0,
  hoveredId: null, hoveredZone: null, selectedId: null,
  isDragging: false, hasDragged: false,
  dragStart: { x: 0, y: 0 }, panStart: { x: 0, y: 0 },
  // Dot-grid backdrop offset. Follows drag-pans only — cursor-anchored zoom
  // mutates panX/panY every tick, and a backdrop keyed to pan visibly slides
  // during zoom. Keyed to drags alone, the backdrop stays rock-still while
  // zooming yet still gives tactile motion feedback when the map is dragged.
  bgOffX: 0, bgOffY: 0, bgOffStart: { x: 0, y: 0 },
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
// Quiz writes name + 24 industry scores to #r=<token> and the local quiz blob.
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
  hubPerfMark('veil');
  hubPerfReport();
}

function isHubLoadingVisible() {
  const el = document.getElementById('hub-loading');
  return !!(el && !el.classList.contains('is-hidden'));
}

function startHubBootWatchdog() {
  setTimeout(function () {
    if (!isHubLoadingVisible()) return;
    hideHubLoading();
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
// CAM4 — fly-to-match arrival halo. Declared here (not near its trigger) so
// loop(), which reads it and is reachable from top-level boot, never hits the
// hub TDZ trap. { career, start, ms } while a beacon is pulsing, else null.
let matchHalo = null;

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

// Frames render (and dismiss fires) from the moment the loop starts, but the
// map is only legacy fallback content until the O*NET init lands — keep the
// loading screen up until the real map (or a definitive fallback/error) is
// ready, so the user never sees the placeholder map swap under them.
// Failsafes (boot watchdog, boot errors) bypass via hideHubLoading directly.
let hubContentReady = false;

function dismissHubLoadingOnce() {
  if (!hubContentReady) return;
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
  if (onetHubActive) {
    // Re-fit the camera when the viewport changes: a page that booted with a
    // degenerate (hidden/zero-size) viewport otherwise keeps a collapsed zoom
    // forever — the map renders as a blank corner smudge with no error.
    var minZ = hubMinZoom();
    var maxZ = hubMaxZoom();
    if (Number.isFinite(minZ) && Number.isFinite(maxZ) && (state.zoom < minZ || state.zoom > maxZ)) {
      state.zoom = Math.max(minZ, Math.min(maxZ, state.zoom));
    }
    clampHubPan();
  }
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
  let hubVvTimer = null;
  function onHubVisualViewportResize() {
    if (hubVvTimer) clearTimeout(hubVvTimer);
    hubVvTimer = setTimeout(resize, 80);
  }
  // Debounce window resize through the same 80ms timer as visualViewport so a
  // desktop window-drag doesn't re-run canvas realloc + overviewLayer
  // invalidation on every intermediate event.
  window.addEventListener('resize', onHubVisualViewportResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onHubVisualViewportResize);
  }
  watchDevicePixelRatio(resize);
}

// A pure DPR change — OS display scaling, or dragging the window to a monitor
// with a different scale factor — leaves the layout viewport the same size, so
// no resize event fires and the backing store keeps its old resolution: the
// map is then upscaled blurry with no way to notice. The query pins one exact
// ratio, so it has to re-arm itself after every change.
function watchDevicePixelRatio(onChange) {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
  const once = function () {
    mq.removeEventListener('change', once);
    onChange();
    watchDevicePixelRatio(onChange);
  };
  mq.addEventListener('change', once);
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
    get matchHalo() { return matchHalo; },
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
  var lensBtn = document.getElementById('hub-lens-toggle');
  if (lensBtn) {
    var lensAvail = inSector && typeof FWOnetHub.lensAvailable === 'function' && FWOnetHub.lensAvailable();
    lensBtn.hidden = !lensAvail;
    if (lensAvail) {
      var lensOn = FWOnetHub.isLensOn();
      lensBtn.textContent = lensOn ? 'Showing top matches' : 'Showing all careers';
      lensBtn.setAttribute('aria-pressed', lensOn ? 'true' : 'false');
    }
  }
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
      // Minimal provenance note (fix plan 2.5): explanations may lean on a
      // current-outlook web brief — show its "as of" date when present.
      var asOf = data.grounding && data.grounding.fetchedAt ? String(data.grounding.fetchedAt).slice(0, 10) : '';
      var note = document.getElementById('hub-stretch-asof');
      if (asOf) {
        if (!note) {
          note = document.createElement('p');
          note.id = 'hub-stretch-asof';
          note.className = 'hub-stretch-asof';
          list.parentNode.appendChild(note);
        }
        note.textContent = 'Outlook notes current as of ' + asOf;
      } else if (note) {
        note.remove();
      }
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

// Fast, locked flights both ways — clicking into or out of a cluster is a
// deliberate shortcut past manual pan/zoom, so it should always beat manually
// scrolling there. Manual pan/zoom (unlocked, interruptible) is unaffected —
// this only governs the click-triggered teleport tween.
// Asymmetric by design (CAM2): entering a sector should feel like arriving
// somewhere (weightier), leaving should feel effortless (quicker). The sub-area
// backdrop font scales with zoom, so it grows into place across the same flight
// — arrival and backdrop land together with no extra fade timer. Reduced motion
// snaps instantly (animateCameraTo short-circuits when !motionOk).
const FLY_TO_SECTOR_MS = 360;
const FLY_TO_OVERVIEW_MS = 240;

// CAM1 establishing shot: on the first hub view per session, ease from a slight
// zoom-in on the map center back out to the fitted overview — a one-second pull-
// back that teaches "this is a world you can move through." Once per session,
// skipped on reduced motion and when deep-linked to a specific career (?soc=).
const HUB_ESTABLISH_KEY = 'fw_hub_established';
const HUB_ESTABLISH_MS = 650;
const HUB_ESTABLISH_ZOOM = 1.12;

// CAM3 dossier push-in: clicking a career's "deep dive" pushes the camera into
// that orb (locked, orb-anchored) while the page fades out (M5), then navigates
// — "I flew into this career." Nav is capped so it never feels laggy.
const DOSSIER_PUSHIN_ZOOM = 1.3;
const DOSSIER_PUSHIN_MS = 240;
const DOSSIER_PUSHIN_NAV_MS = 250;

function exitToOverview() {
  if (!onetHubActive || !window.FWOnetHub) return;
  if (isCameraLocked()) return;
  var exitCam = FWOnetHub.exitSectorMode(viewW, viewH);
  invalidateSectorLabelCache();
  lastSectorLabelZoomBucket = null;
  careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
  rebuildCareersById();
  closePanel();
  syncMapHud();
  animateCameraTo(exitCam, FLY_TO_OVERVIEW_MS, null, { locked: true });
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

// Wheel zoom: legacy-parity sensitivity with a short glide. Each wheel event
// banks log-zoom into an accumulator; the animation loop drains a fixed
// fraction of the bank per frame, so a hard spin lands almost instantly while
// single notches ease in smoothly. (The old per-event 4% cap made the map
// feel stuck compared to the legacy hub's 10%-per-notch response.)
const ZOOM_SENSITIVITY = 0.0022;
const ZOOM_PENDING_CAP = 2.0;   // max banked |log-zoom| so wild spins can't queue forever
const ZOOM_GLIDE = 0.38;        // fraction of the bank consumed per frame
let pendingZoomLog = 0;
const zoomAnchor = { x: 0, y: 0 };

function accumulateWheelZoom(deltaY, mx, my) {
  if (isCameraLocked()) return; // locked fly-in/out ignores wheel entirely
  if (camAnim) cancelCameraAnim();
  lastZoomInputAt = performance.now();
  pendingZoomLog = Math.max(-ZOOM_PENDING_CAP, Math.min(ZOOM_PENDING_CAP,
    pendingZoomLog - deltaY * ZOOM_SENSITIVITY));
  zoomAnchor.x = mx;
  zoomAnchor.y = my;
  if (!motionOk) {
    stepWheelZoom(true);
    return;
  }
  requestHubRedraw();
}

// Drains the wheel-zoom bank one frame at a time. Returns true while zoom
// motion is still pending so the loop keeps running.
function stepWheelZoom(consumeAll) {
  if (!pendingZoomLog) return false;
  var step = consumeAll ? pendingZoomLog : pendingZoomLog * ZOOM_GLIDE;
  if (Math.abs(pendingZoomLog - step) < 0.002) step = pendingZoomLog;
  pendingZoomLog -= step;
  lastZoomInputAt = performance.now(); // hold sector-label relayout until the glide settles
  var modeChanged = applyZoomFactorAt(Math.exp(step), zoomAnchor.x, zoomAnchor.y);
  if (modeChanged) pendingZoomLog = 0; // never glide across a mode transition
  return pendingZoomLog !== 0;
}

// Applies one multiplicative zoom step anchored at (mx,my). Returns true when
// the step drove a mode transition (sector enter/exit).
function applyZoomFactorAt(factor, mx, my) {
  if (!onetHubActive || !window.FWOnetHub) {
    const newZoom = Math.min(hubMaxZoom(), Math.max(hubMinZoom(), state.zoom * factor));
    state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
    state.panY = my - (my - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;
    return false;
  }

  FWOnetHub._syncPan(state.panX, state.panY);
  var modeChanged = false;

  if (FWOnetHub.getHubMode() === 'sector') {
    // Pass the live world zoom so the sector layer can reconcile its own
    // sectorZoom to it first — a zoom landing mid entry-tween then takes over
    // smoothly instead of snapping to the sector frame.
    var result = FWOnetHub.applySectorZoomDelta(factor, viewW, viewH, mx, my, state.panX, state.panY, state.zoom);
    state.zoom = result.zoom;
    state.panX = result.panX;
    state.panY = result.panY;
    if (FWOnetHub.getSectorZoom() <= FWOnetHub.SECTOR_ZOOM_MIN + 0.001) {
      exitToOverview();
      return true;
    }
  } else {
    var newZoom = Math.min(hubMaxZoom(), Math.max(hubMinZoom(), state.zoom * factor));
    state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
    state.panY = my - (my - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;

    var transition = FWOnetHub.evaluateModeTransition(state.zoom, state.panX, state.panY, viewW, viewH);
    if (transition.action === 'enter' && transition.camera) {
      invalidateSectorLabelCache();
      lastSectorLabelZoomBucket = sectorZoomBucket();
      FWOnetHub.invalidateViewport();
      // Ease into the sector camera instead of teleporting — same tween the
      // click-to-enter path uses; further wheel input cancels it and takes over.
      animateCameraTo(transition.camera, 300, function () { invalidateSectorLabelCache(); });
      modeChanged = true;
    }
  }
  clampHubPan();
  maybeInvalidateSectorLabelCacheOnZoom();
  requestHubRedraw();
  syncMapHud();
  return modeChanged;
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
// any user input (wheel/drag) cancels it and takes over — EXCEPT a locked
// flight (macro-hub click-to-fly, post-ship redesign): the whole point of
// clicking a cluster is a fast, uninterruptible trip there, deliberately
// quicker than scrolling would get you there manually. cancelCameraAnim()
// is a no-op while a locked animation is in flight; every input handler
// that would otherwise cancel or divert the camera checks isCameraLocked()
// first and no-ops entirely instead.
let camAnim = null;

function isCameraLocked() {
  return !!(camAnim && camAnim.locked);
}

function cancelCameraAnim() {
  if (isCameraLocked()) return;
  if (camAnim && typeof camAnim.onDone === 'function') camAnim.onDone();
  camAnim = null;
}

function animateCameraTo(target, ms, onDone, opts) {
  if (!target) return;
  const locked = !!(opts && opts.locked);
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
    locked: locked,
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

// CAM4 — fire a one-shot ~900ms beacon pulse on a career orb after a fly-to
// arrival (search pick / portal "view on map" deep-link). Drawn every frame in
// hub-canvas's dynamic pass so the overview layer cache is never touched.
// Reduced motion: no-op (the beacon is skipped outright).
function startMatchHalo(career) {
  if (!motionOk || !career) return;
  matchHalo = { career: career, start: performance.now(), ms: 900 };
  requestHubRedraw();
}

function loop() {
  if (animationPaused || !hubBootOk) {
    rafId = null;
    dismissHubLoadingOnce();
    return;
  }
  // Sentinel: requestHubRedraw() invokes loop() synchronously when rafId is
  // null, and frame steps (wheel-zoom glide) call requestHubRedraw — keep
  // rafId truthy for the duration of the frame so it can't recurse.
  rafId = -1;
  const camAnimating = stepCameraAnim(performance.now());
  if (camAnimating) needsRedraw = true;
  if (stepWheelZoom(false)) needsRedraw = true;
  // CAM4 halo: expire when its window elapses; while live, force a redraw so
  // the beacon animates even in the otherwise-idle overview (render() resets
  // needsRedraw before the RAF-gate below, so matchHalo is also its own term).
  if (matchHalo && performance.now() - matchHalo.start >= matchHalo.ms) matchHalo = null;
  if (matchHalo) needsRedraw = true;
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
  // Idle motion in the macro view (twinkle/mote overlay in hub-canvas) needs
  // the loop alive; the per-frame cost is a cached-layer blit + ~160 dots.
  // Under prefers-reduced-motion the loop parks exactly as before.
  const overviewIdle = onetHub && !inSector && motionOk
    && FWOnetHub.getHubMode() === 'overview';
  if (onetHub && !needsRedraw && !inSector && !overviewAnimating && !overviewIdle) {
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
    if (!hubFirstPaintMarked) {
      hubFirstPaintMarked = true;
      hubPerfMark('first-paint');
    }
  } catch (err) {
    console.error('[Career Hub] frame failed', err);
    window.__hubLastRenderError = err;
    showHubBootError('Career map hit a display error. Try refreshing.');
  } finally {
    dismissHubLoadingOnce();
  }
  if (onetHub) {
    // F2: sector mode used to keep the loop alive unconditionally (bare
    // inSector), burning a full 60fps repaint while idle. Park it unless
    // something is actually animating: hover-radius springs, gold-orb shimmer,
    // or the pointer over the canvas (the proximity glow is cursor-coupled).
    // Every discrete change re-arms via requestHubRedraw, and pointerleave
    // fires one so re-entry re-arms. The satellite-bloom spring used to be a
    // fourth reason to stay awake; with satellites gone the loop parks sooner.
    const sectorLive = inSector && (sectorAnimating || isGoldShimmerActive() || state.mouseOn);
    rafId = (needsRedraw || sectorLive || overviewAnimating || overviewIdle || camAnim || pendingZoomLog || matchHalo)
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

  // Depth signal: how many AI-mapped specializations branch off this career.
  const subTag = document.getElementById('panel-subpaths');
  if (subTag) {
    var subCount = 0;
    if (!career.aiDerived && career.soc && onetHubActive && window.FWOnetHub
      && typeof FWOnetHub.getFragmentCount === 'function') {
      // Same index the canvas badge and satellite layout read — one source.
      subCount = FWOnetHub.getFragmentCount(career.soc);
    }
    subTag.hidden = !subCount;
    if (subCount) {
      subTag.textContent = subCount + ' specialization' + (subCount === 1 ? '' : 's')
        + ' branch off this career — look for the smaller orbs around it';
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
      const highFit = career.fitScore != null && career.fitScore >= FWOnetMath.FIT_TIERS.legendary;
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
  renderPanelWhy(career);
  const skillsWrap = document.getElementById('panel-skills');
  if (career.skills && career.skills.length) {
    skillsWrap.innerHTML = career.skills.map(s => `<span class="skill-pill">${escHtml(titleCaseSkill(s))}</span>`).join('');
  } else if (onetHubActive && career.vectorLoaded) {
    skillsWrap.innerHTML = '<span class="panel-skills-empty">Skills unavailable</span>';
  } else {
    skillsWrap.innerHTML = '<span class="panel-skills-empty">Skills data loading…</span>';
  }
  const descEl = document.getElementById('panel-description');
  descEl.textContent = career.description;
  // Descriptions load off the boot path now (onet-catalog defers them to idle),
  // so a panel opened in the first moments can beat them. Pull them on demand
  // and fill this line when they land, if this career is still selected.
  if (!career.description && window.FWOnetCatalog && typeof FWOnetCatalog.loadDescriptions === 'function') {
    FWOnetCatalog.loadDescriptions().then(function () {
      if (state.selectedId === career.id) descEl.textContent = career.description || '';
    }).catch(function () { /* description stays empty */ });
  }
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
  const compareBtn = document.getElementById('panel-compare');
  if (compareBtn) {
    // career-compare.js is injected on demand (see HUB_LAZY_MODULES), so the
    // button's availability keys off the career, not off the module being
    // parsed yet; the click awaits the load.
    const canCompare = !!career.soc;
    compareBtn.hidden = !canCompare;
    compareBtn.onclick = canCompare
      ? function () {
          ensureHubModule('career-compare').then(function () {
            if (!window.FWCareerCompare) return;
            FWCareerCompare.open({ soc: career.soc, name: career.name || career.title || '' });
          });
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

// FW trust pass — compact "why this match" in the hub detail panel, so the
// explanation exists at the point a user decides whether to open the deep
// dive, not only after. Same rows/drawer career.html renders. Async + additive:
// stale content is cleared synchronously so a fast career switch never shows
// the previous career's drivers.
let panelWhyToken = 0;
function renderPanelWhy(career) {
  const mount = document.getElementById('panel-why');
  if (!mount) return;
  mount.innerHTML = '';
  const token = ++panelWhyToken;
  if (!career || !career.soc || !window.FWWhyMatch || !window.FWOnetVectors
    || typeof FWOnetVectors.userVsCareerDimensions !== 'function'
    || typeof FWOnetVectors.readQuizVectors !== 'function') return;
  let vecs = null;
  try { vecs = FWOnetVectors.readQuizVectors(); } catch (_) { return; }
  const personality = vecs && vecs.personality && vecs.personality.values;
  if (!personality || !personality.length) return;
  const objective = vecs.objective && vecs.objective.values;
  const confidence = vecs.personality.confidence;
  FWOnetVectors.userVsCareerDimensions(career.soc, personality, objective, confidence).then(match => {
    if (token !== panelWhyToken) return;
    if (!match || !match.comparisons || !match.comparisons.length) return;
    FWWhyMatch.inject(mount, match.comparisons, null, { k: 3 });
  }).catch(() => {});
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

// CAM3 — "fly into this career": push the camera into the selected orb (locked,
// orb-anchored) while the page fades out (M5 body.fw-departing), then navigate.
// Reduced motion, no live map, or an unresolved orb → navigate immediately.
// A locked animateCameraTo only interpolates (never triggers evaluateModeTransition),
// and we leave the page at DOSSIER_PUSHIN_NAV_MS, so no mode-boundary glide.
function flyIntoCareerThenNav(career, href) {
  if (!href || href === '#') return;
  if (!motionOk || !onetHubActive || !window.FWOnetHub || !career) {
    window.location.href = href;
    return;
  }
  try { document.body.classList.add('fw-departing'); } catch (_) {}
  var wpos = careerWorldXY(career);
  var spos = (wpos && typeof worldToScreen === 'function') ? worldToScreen(wpos.x, wpos.y) : null;
  if (spos && Number.isFinite(spos.x) && Number.isFinite(spos.y) && state.zoom > 0) {
    var pushZoom = state.zoom * DOSSIER_PUSHIN_ZOOM;
    var maxZ = hubMaxZoom();
    if (Number.isFinite(maxZ)) pushZoom = Math.min(pushZoom, maxZ);
    animateCameraTo({
      zoom: pushZoom,
      panX: spos.x - (spos.x - state.panX) * (pushZoom / state.zoom),
      panY: spos.y - (spos.y - state.panY) * (pushZoom / state.zoom),
    }, DOSSIER_PUSHIN_MS, null, { locked: true });
  }
  setTimeout(function () { window.location.href = href; }, DOSSIER_PUSHIN_NAV_MS);
}

document.getElementById('panel-close')?.addEventListener('click', closePanel);
document.getElementById('panel-deep-dive')?.addEventListener('click', function (e) {
  var href = this.getAttribute('href');
  if (!href || href === '#') return;      // no target set — let the default <a> handle it
  var c = state.selectedId ? careerById(state.selectedId) : null;
  if (!c) return;                          // can't resolve the orb — default nav
  e.preventDefault();
  flyIntoCareerThenNav(c, href);
});
// Esc closes the career panel — every other drawer in the app closes on
// Escape; the hub's main panel was mouse-only.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && panel && panel.classList.contains('open')) closePanel();
});
document.getElementById('hub-sector-back')?.addEventListener('click', exitToOverview);
document.getElementById('hub-lens-toggle')?.addEventListener('click', () => {
  if (!window.FWOnetHub || typeof FWOnetHub.setLensOn !== 'function') return;
  FWOnetHub.setLensOn(!FWOnetHub.isLensOn());
  invalidateSectorLabelCache();
  syncMapHud();
  requestHubRedraw();
});

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
  if (isCameraLocked()) return; // camera is flying on its own — no hover/drag mid-flight
  const pt = pointerOnCanvas(e);
  const mx = pt.x, my = pt.y;
  state.mouseX = mx; state.mouseY = my; state.mouseOn = true;

  if (state.isDragging) {
    const dx = mx - state.dragStart.x, dy = my - state.dragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.hasDragged = true;
    state.panX = state.panStart.x + dx;
    state.panY = state.panStart.y + dy;
    state.bgOffX = state.bgOffStart.x + dx;
    state.bgOffY = state.bgOffStart.y + dy;
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
  } else if (state.mouseOn && motionOk) {
    // Cursor spotlight tracks the pointer — needs a redraw per move (sector
    // mode already renders continuously; overview renders are cheap). Always
    // on: the hub canvas is forced dark in both themes.
    requestHubRedraw();
  }
}

function hubPointerUp(e) {
  if (state.activePointerId != null && e.pointerId !== state.activePointerId) return;
  if (isCameraLocked()) return; // no click-to-select-elsewhere while a flight is in progress
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
          // teleporting, so the orbs slide into place. Locked + fast: clicking
          // a cluster is a shortcut past manual pan/zoom, not a starting point
          // for one — no redirect if another cluster is clicked mid-flight.
          invalidateSectorLabelCache();
          lastSectorLabelZoomBucket = sectorZoomBucket();
          careers = FWOnetHub.updateViewport(state.panX, state.panY, state.zoom, viewW, viewH);
          rebuildCareersById();
          closePanel();
          syncMapHud();
          animateCameraTo(cam, FLY_TO_SECTOR_MS, function () {
            clampHubPan();
            invalidateSectorLabelCache();
          }, { locked: true });
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
  if (isCameraLocked()) return; // locked fly-in/out: input ignored entirely, not just non-canceling
  if (camAnim) cancelCameraAnim();
  state.activePointerId = e.pointerId;
  const pt = pointerOnCanvas(e);
  state.isDragging = true;
  state.hasDragged = false;
  state.dragStart = { x: pt.x, y: pt.y };
  state.panStart = { x: state.panX, y: state.panY };
  state.bgOffStart = { x: state.bgOffX, y: state.bgOffY };
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
  accumulateWheelZoom(e.deltaY, pt.x, pt.y);
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
    suggestEl.innerHTML = '<div class="ss-empty" role="status">No careers found for “' + q.replace(/</g, '&lt;') + '”'
      + '<span class="ss-empty-hint">The map is built from real occupation titles, not job-ad wording. '
      + 'Try the field instead — “data”, “health”, “law”.</span></div>';
    suggestEl.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    return;
  }
  if (!items.length) { hideSuggest(); return; }
  const label = { recent: 'Recently viewed', suggested: 'Try', match: '' };
  suggestEl.innerHTML = items.map(it => {
    const tag = it.kind !== 'match' ? `<span class="ss-tag">${label[it.kind]}</span>` : '';
    return `<button type="button" class="ss-item" role="option" data-id="${escAttr(String(it.career.id))}">`
      + `<span class="ss-name">${escHtml(it.career.name)}</span>`
      + `<span class="ss-industry">${escHtml(it.career.industry)}</span>${tag}</button>`;
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
      animateCameraTo(target, 380, function () { invalidateSectorLabelCache(); startMatchHalo(c); });
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
      FWUser.putBlob({ name: userName, scores: quizState.scores });
    } else if (hubQuizScores) {
      FWUser.putBlob({ name: userName, scores: hubQuizScores });
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
  hubContentReady = true;
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
    // CAM1 — establishing shot. Runs once per session, not when deep-linked
    // (?soc= flies to a career below instead), and never under reduced motion.
    var hubDeepLinked = !!new URLSearchParams(window.location.search).get('soc');
    var hubEstablished = false;
    try { hubEstablished = sessionStorage.getItem(HUB_ESTABLISH_KEY) === '1'; } catch (_) {}
    if (motionOk && !hubDeepLinked && !hubEstablished) {
      try { sessionStorage.setItem(HUB_ESTABLISH_KEY, '1'); } catch (_) {}
      var fitCam = { zoom: state.zoom, panX: state.panX, panY: state.panY };
      var maxZ = hubMaxZoom();
      var startZoom = fitCam.zoom * HUB_ESTABLISH_ZOOM;
      if (Number.isFinite(maxZ)) startZoom = Math.min(startZoom, maxZ);
      var ecx = viewW / 2, ecy = viewH / 2;
      // Zoom around the viewport center (cursor-anchor identity, mx=ecx).
      state.zoom = startZoom;
      state.panX = ecx - (ecx - fitCam.panX) * (startZoom / fitCam.zoom);
      state.panY = ecy - (ecy - fitCam.panY) * (startZoom / fitCam.zoom);
      clampHubPan();
      animateCameraTo(fitCam, HUB_ESTABLISH_MS, function () { invalidateSectorLabelCache(); }, { locked: true });
    }
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
      startMatchHalo(bootCareer);
    }
  }
  // Fragment warming is a D1 scan plus (signed-in) a synchronous Gemini
  // generation with a 60s budget — both were contending with the boot-critical
  // catalog/artifact fetches. Nothing on screen waits for them (syncDerivedRows
  // folds rows in whenever they land), so they run once the map is up. Panel-only
  // modules warm on the same idle beat.
  hubAfterPaint(function () {
    warmHubFragments();
    warmHubLazyModules();
  });
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

hubPerfMark('script-eval');
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
} else {
  // No O*NET module at all — the legacy map IS the final content; release the
  // loading screen on the next frame rather than holding it to the watchdog.
  hubContentReady = true;
  requestHubRedraw();
}
