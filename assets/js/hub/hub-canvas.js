/**
 * Career Hub canvas rendering — zone tiles, sector orbs, labels.
 */
(function (global) {
  var _api = {};
  var hubCanvas = global.FWHubCanvasBg || {};
  var getHubCanvasBg = hubCanvas.getHubCanvasBg || function () { return '#080706'; };
  var isHubLightTheme = hubCanvas.isHubLightTheme || function () { return false; };

var ZONE_LABEL_FONT_PX = 13;
  var SECTOR_ORB_SCREEN_R = 5.6;
  var SECTOR_ORB_HOVER_R = 6.75;
  var LABEL_ANCHORS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];

// Orb size is fixed in WORLD units (SECTOR_ORB_SCREEN_R/HOVER_R) and scaled by
// the current zoom, so zooming in/out actually changes apparent orb size
// (broad view when zoomed out, close-up when zoomed in) instead of staying a
// constant screen pixel size regardless of zoom. Clamped so orbs never vanish
// at min zoom or balloon past a reasonable size at max/fly-to zoom.
function sectorOrbRadiusPx(emphasized) {
  var zoom = (_api.state && _api.state.zoom) || 1;
  var base = emphasized ? SECTOR_ORB_HOVER_R : SECTOR_ORB_SCREEN_R;
  return Math.max(4, Math.min(26, base * zoom));
}

function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function specularPoint(sx, sy, r) {
  if (!_api.state.mouseOn) {
    return { hx: sx - r * 0.38, hy: sy - r * 0.42 };
  }
  const mdx = (_api.state.mouseX - _api.state.panX) / _api.state.zoom - sx;
  const mdy = (_api.state.mouseY - _api.state.panY) / _api.state.zoom - sy;
  const len = Math.hypot(mdx, mdy) || 1;
  return {
    hx: sx + (mdx / len) * r * 0.46,
    hy: sy + (mdy / len) * r * 0.46
  };
}

function getHubLabelColors() {
  if (hubCanvas.getRoadmapTreeColors) return hubCanvas.getRoadmapTreeColors();
  return {
    labelBg: 'rgba(10, 9, 8, 0.94)',
    labelBgMuted: 'rgba(10, 9, 8, 0.82)',
    labelText: '#ffffff',
    labelTextMuted: '#eef1f8',
    labelBorder: 'rgba(255, 255, 255, 0.28)',
    labelBorderMuted: 'rgba(255, 255, 255, 0.14)',
  };
}

function drawOrbLabel(text, x, y, r, emphasized) {
  const lc = getHubLabelColors();
  const fontSize = emphasized ? 11 : 10;
  _api.ctx.font = `600 ${fontSize}px Inter, sans-serif`;
  const padX = 8;
  const padY = 4;
  const tw = _api.ctx.measureText(text).width;
  const w = tw + padX * 2;
  const h = fontSize + padY * 2;
  const lx = x - w / 2;
  const ly = y + r + 14;
  roundRectPath(_api.ctx, lx, ly, w, h, 6);
  _api.ctx.fillStyle = emphasized ? lc.labelBg : lc.labelBgMuted;
  _api.ctx.fill();
  _api.ctx.strokeStyle = emphasized ? lc.labelBorder : lc.labelBorderMuted;
  _api.ctx.lineWidth = 1;
  roundRectPath(_api.ctx, lx, ly, w, h, 6);
  _api.ctx.stroke();
  _api.ctx.fillStyle = emphasized ? lc.labelText : lc.labelTextMuted;
  _api.ctx.textAlign = 'center';
  _api.ctx.textBaseline = 'middle';
  _api.ctx.fillText(text, x, ly + h / 2);
}

function measureOrbLabelRect(text, x, y, r, emphasized) {
  const fontSize = emphasized ? 11 : 10;
  _api.ctx.font = `600 ${fontSize}px Inter, sans-serif`;
  const padX = 8;
  const padY = 4;
  const tw = _api.ctx.measureText(text).width;
  const w = tw + padX * 2;
  const h = fontSize + padY * 2;
  const lx = x - w / 2;
  const ly = y + r + 14;
  return { x: lx, y: ly, w: w, h: h };
}

function labelRectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function truncateSectorLabel(text, maxLen, emphasized) {
  if (emphasized || !text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function sectorLabelTypography(queue, emphasized) {
  if (emphasized) return { fontSize: 11, maxLen: 48 };
  const n = queue ? queue.length : 0;
  if (n > 40) return { fontSize: 9, maxLen: 18 };
  return { fontSize: 10, maxLen: 22 };
}

function labelRectForAnchor(text, sx, sy, orbR, anchor, fontSize, padX, padY, gap) {
  _api.ctx.font = '600 ' + fontSize + 'px Inter, sans-serif';
  const tw = _api.ctx.measureText(text).width;
  const w = tw + padX * 2;
  const h = fontSize + padY * 2;
  const diag = gap + 6;
  let lx = sx - w / 2;
  let ly = sy - orbR - gap - h;
  if (anchor === 'S') ly = sy + orbR + gap;
  else if (anchor === 'E') { lx = sx + orbR + gap; ly = sy - h / 2; }
  else if (anchor === 'W') { lx = sx - orbR - gap - w; ly = sy - h / 2; }
  else if (anchor === 'NE') { lx = sx + diag; ly = sy - orbR - gap - h; }
  else if (anchor === 'NW') { lx = sx - diag - w; ly = sy - orbR - gap - h; }
  else if (anchor === 'SE') { lx = sx + diag; ly = sy + orbR + gap; }
  else if (anchor === 'SW') { lx = sx - diag - w; ly = sy + orbR + gap; }
  return { x: lx, y: ly, w: w, h: h, textX: lx + w / 2, textY: ly + h / 2 };
}

function measureSectorLabelScreenRect(text, sx, sy, orbR, emphasized, anchor, fontSize) {
  const typo = fontSize != null ? { fontSize: fontSize } : sectorLabelTypography(null, emphasized);
  const padX = emphasized ? 5 : 4;
  const padY = emphasized ? 3 : 2;
  return labelRectForAnchor(text, sx, sy, orbR, anchor || 'N', typo.fontSize, padX, padY, emphasized ? 5 : 4);
}

function overlapArea(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function orbEdgePoint(sx, sy, orbR, anchor, rect) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = cx - sx;
  const dy = cy - sy;
  const len = Math.hypot(dx, dy) || 1;
  return { x: sx + (dx / len) * orbR, y: sy + (dy / len) * orbR };
}

function drawSectorOrbLabelScreen(text, sx, sy, orbR, emphasized, anchor, fontSize, leader, leaderRgb) {
  const lc = getHubLabelColors();
  const typo = fontSize != null ? { fontSize: fontSize } : sectorLabelTypography(null, emphasized);
  const padX = emphasized ? 5 : 4;
  const padY = emphasized ? 3 : 2;
  const rect = labelRectForAnchor(text, sx, sy, orbR, anchor || 'N', typo.fontSize, padX, padY, emphasized ? 5 : 4);
  if (leader) {
    const edge = orbEdgePoint(sx, sy, orbR, anchor, rect);
    const hubLight = isHubLightTheme();
    const rgb = leaderRgb || '148,163,184';
    _api.ctx.strokeStyle = hubLight ? 'rgba(' + rgb + ',0.35)' : 'rgba(' + rgb + ',0.45)';
    _api.ctx.lineWidth = 1;
    _api.ctx.beginPath();
    _api.ctx.moveTo(edge.x, edge.y);
    _api.ctx.lineTo(rect.textX, rect.textY);
    _api.ctx.stroke();
  }
  roundRectPath(_api.ctx, rect.x, rect.y, rect.w, rect.h, 4);
  _api.ctx.fillStyle = emphasized ? lc.labelBg : lc.labelBgMuted;
  _api.ctx.fill();
  _api.ctx.strokeStyle = emphasized ? lc.labelBorder : lc.labelBorderMuted;
  _api.ctx.lineWidth = 1;
  roundRectPath(_api.ctx, rect.x, rect.y, rect.w, rect.h, 4);
  _api.ctx.stroke();
  _api.ctx.fillStyle = emphasized ? lc.labelText : lc.labelTextMuted;
  _api.ctx.textAlign = 'center';
  _api.ctx.textBaseline = 'middle';
  _api.ctx.fillText(text, rect.textX, rect.textY);
}

function placeSectorLabelsScreen(queue) {
  if (!queue || !queue.length) return;
  const placed = [];
  const sorted = queue.slice().sort(function (a, b) {
    if (a.isHovered !== b.isHovered) return a.isHovered ? -1 : 1;
    if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
    return (b.fitScore || 0) - (a.fitScore || 0);
  });
  sorted.forEach(function (item, i) {
    const scr = worldToScreen(item.wx, item.wy);
    const screenR = sectorOrbRadiusPx(item.isHovered || item.isSelected);
    const emphasized = item.isHovered || item.isSelected;
    const labelText = truncateSectorLabel(item.name, emphasized ? 48 : 28, emphasized);
    const anchor = (i % 2) === 1 ? 'S' : 'N';
    const rect = measureSectorLabelScreenRect(labelText, scr.x, scr.y, screenR, emphasized, anchor);
    if (!emphasized) {
      for (let pi = 0; pi < placed.length; pi++) {
        if (labelRectsOverlap(rect, placed[pi])) return;
      }
    }
    drawSectorOrbLabelScreen(labelText, scr.x, scr.y, screenR, emphasized, anchor);
    placed.push(rect);
  });
}

function sectorZoneOrbColor(zoneId) {
  if (!zoneId || !window.FWOnetHub) return '#78716C';
  if (typeof FWOnetHub.getZoneColor === 'function') return FWOnetHub.getZoneColor(zoneId);
  return '#78716C';
}

function paintSectorScreenBackground(W, H, zoneId) {
  if (!zoneId || !_api.ctx) return;
  var rgb = hexToRgb(sectorZoneOrbColor(zoneId));
  var hubLight = isHubLightTheme();
  // Radial zone-color wash (brighter toward the center) instead of a flat
  // rect — matches the legacy hub's sense of depth.
  var cx = W / 2;
  var cy = H * 0.42;
  var wash = _api.ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
  if (hubLight) {
    wash.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.13)');
    wash.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.04)');
  } else {
    wash.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.16)');
    wash.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.03)');
  }
  _api.ctx.fillStyle = wash;
  _api.ctx.fillRect(0, 0, W, H);
  // Soft edge vignette for focus (dark mode only — light theme stays airy).
  if (!hubLight) {
    var vig = _api.ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.45, cx, cy, Math.max(W, H) * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.22)');
    _api.ctx.fillStyle = vig;
    _api.ctx.fillRect(0, 0, W, H);
  }
}

// Mini constellation inside a zone tile — PURELY DECORATIVE. Dots take the
// zone's own fit tier color (already computed locally from zone aggregates)
// with deterministic per-dot size/alpha jitter; no per-career vector data is
// fetched or read for the macro view. Careers only get their true individual
// colors once you enter the sector. Dots are batched into three alpha-band
// fills per tile — per-dot gradients/fills were the macro frame-rate killer.
function drawZoneConstellation(ctx, zone, x, y, zw, zh, hoverA, zoneRarity) {
  var byZone = (window.FWOnetHub && typeof FWOnetHub.getCareersByZone === 'function')
    ? FWOnetHub.getCareersByZone() : null;
  var list = byZone && byZone[zone.id];
  if (!list || !list.length) return;
  var hubLight = isHubLightTheme();
  var glow = zoneRarity.glow;

  ctx.save();
  roundRectPath(ctx, x, y, zw, zh, 6);
  ctx.clip();

  // Three alpha bands → three fill calls total (not one per dot).
  var bands = [[], [], []];
  for (var i = 0; i < list.length; i++) {
    var pos = _api.careerWorldXY(list[i]);
    if (!pos) continue;
    var scr = worldToScreen(pos.x, pos.y);
    if (scr.x < x || scr.x > x + zw || scr.y < y || scr.y > y + zh) continue;
    // Deterministic jitter keyed by index — stable across frames.
    var j = ((i * 2654435761) >>> 16) % 100;
    var band = j < 55 ? 0 : (j < 85 ? 1 : 2);
    bands[band].push({ x: scr.x, y: scr.y, r: 1.3 + band * 0.7 + (j % 5) * 0.1 });
  }

  var baseA = hubLight ? 0.35 : 0.4;
  for (var bi = 0; bi < 3; bi++) {
    var dots = bands[bi];
    if (!dots.length) continue;
    ctx.fillStyle = 'rgba(' + glow + ',' + (baseA + bi * 0.18 + hoverA * 0.1).toFixed(3) + ')';
    ctx.beginPath();
    for (var di = 0; di < dots.length; di++) {
      ctx.moveTo(dots[di].x + dots[di].r, dots[di].y);
      ctx.arc(dots[di].x, dots[di].y, dots[di].r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  ctx.restore();
}

function drawFixedZoneTiles(targetCtx) {
  var ctx = targetCtx || _api.ctx;
  if (!_api.onetHubActive || !window.FWOnetHub || typeof FWOnetHub.getHubMode !== 'function') return;
  if (FWOnetHub.getHubMode() !== 'overview') return;
  var zones = (typeof FWOnetHub.getOverviewZones === 'function')
    ? FWOnetHub.getOverviewZones() : (FWOnetHub.getZoneTiles() || []);
  if (!zones || !zones.length) return;

  var rx = 6;
  var hubLight = isHubLightTheme();
  var gridStroke = hubLight ? 'rgba(62, 40, 28, 0.28)' : 'rgba(255, 255, 255, 0.22)';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  zones.forEach(function (zone) {
    var b = zone.bounds;
    if (!b) return;
    // Screen space: tiles scale spatially with zoom, but labels, star dots,
    // and strokes keep constant pixel size — zooming the overview used to
    // blow up fonts and dots because everything ran through ctx.scale().
    var p1 = worldToScreen(b.minX, b.minY);
    var p2 = worldToScreen(b.maxX, b.maxY);
    var x = p1.x;
    var y = p1.y;
    var zw = p2.x - p1.x;
    var zh = p2.y - p1.y;
    var isHover = _api.state.hoveredZone === zone.id;
    var hoverA = isHover ? (_api.state.zoneHoverAlpha || 0) : 0;
    var zoneFit = (zone.zoneFit) || (window.FWOnetHub && typeof FWOnetHub.getZoneFit === 'function'
      ? FWOnetHub.getZoneFit(zone.id) : null);
    var pPct = zoneFit && zoneFit.overallFit != null ? zoneFit.overallFit
      : (zoneFit && zoneFit.personalityFit != null ? zoneFit.personalityFit : 0);
    var rarity = rarityOf(pPct);
    var rgb = hexToRgb(rarity.base);

    // Hover halo behind the tile (rarity glow) — gives lift without layout shift.
    if (hoverA > 0.02) {
      var haloPad = 14;
      var halo = ctx.createRadialGradient(
        x + zw / 2, y + zh / 2, Math.min(zw, zh) * 0.35,
        x + zw / 2, y + zh / 2, Math.max(zw, zh) * 0.72 + haloPad,
      );
      halo.addColorStop(0, 'rgba(' + rarity.glow + ',' + (hoverA * 0.16).toFixed(3) + ')');
      halo.addColorStop(1, 'rgba(' + rarity.glow + ',0)');
      ctx.fillStyle = halo;
      ctx.fillRect(x - haloPad, y - haloPad, zw + haloPad * 2, zh + haloPad * 2);
    }

    // Tile fill: radial gradient (deeper at edges) instead of a flat wash.
    var baseA = hubLight ? 0.16 : 0.12;
    var fillA = baseA + hoverA * 0.07;
    var fillGrad = ctx.createRadialGradient(
      x + zw / 2, y + zh * 0.42, 0,
      x + zw / 2, y + zh * 0.42, Math.max(zw, zh) * 0.72,
    );
    fillGrad.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (fillA * 1.35).toFixed(3) + ')');
    fillGrad.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (fillA * 0.55).toFixed(3) + ')');
    roundRectPath(ctx, x, y, zw, zh, rx);
    ctx.fillStyle = fillGrad;
    ctx.fill();

    drawZoneConstellation(ctx, zone, x, y, zw, zh, hoverA, rarity);

    var scrimH = Math.min(zh * 0.38, 52);
    var scrimTop = hubLight ? 0.72 + hoverA * 0.12 : 0.55 + hoverA * 0.15;
    ctx.save();
    roundRectPath(ctx, x, y, zw, zh, rx);
    ctx.clip();
    var scrim = ctx.createLinearGradient(x, y, x, y + scrimH);
    if (hubLight) {
      scrim.addColorStop(0, 'rgba(255, 248, 242, ' + scrimTop + ')');
      scrim.addColorStop(1, 'rgba(255, 248, 242, 0)');
    } else {
      scrim.addColorStop(0, 'rgba(12, 10, 9, ' + scrimTop + ')');
      scrim.addColorStop(1, 'rgba(12, 10, 9, 0)');
    }
    ctx.fillStyle = scrim;
    ctx.fillRect(x, y, zw, scrimH);
    ctx.restore();

    ctx.strokeStyle = isHover
      ? 'rgba(' + rarity.glow + ',' + (0.35 + hoverA * 0.4).toFixed(3) + ')'
      : gridStroke;
    ctx.lineWidth = 1.25 + hoverA * 0.75;
    roundRectPath(ctx, x + 0.5, y + 0.5, zw - 1, zh - 1, rx);
    ctx.stroke();

    var labelText = String(zone.label || zone.id || '');
    var label = labelText.length > 16 ? labelText.slice(0, 15) + '…' : labelText;
    var count = _api.zoneCareerCount(zone.id);
    var countLine = count + (count === 1 ? ' career' : ' careers');
    var titleY = _api.zoneLabelCanvasY(y, zh);
    ctx.fillStyle = hubLight ? 'rgba(62, 40, 28, 0.78)' : 'rgba(255,255,255,0.85)';
    ctx.font = '600 ' + ZONE_LABEL_FONT_PX + 'px Inter, sans-serif';
    ctx.fillText(label.toUpperCase(), x + zw / 2, titleY);
    ctx.fillStyle = hubLight ? 'rgba(62, 40, 28, 0.50)' : 'rgba(255,255,255,0.50)';
    ctx.font = '500 10px Inter, sans-serif';
    ctx.fillText(countLine, x + zw / 2, titleY + 14);
    ctx.fillStyle = hubLight ? 'rgba(62, 40, 28, 0.42)' : 'rgba(255,255,255,0.42)';
    ctx.font = '500 9px Inter, sans-serif';
    ctx.fillText(Math.round(pPct) + '% overall fit', x + zw / 2, titleY + 26);
  });
}

// ── OVERVIEW LAYER CACHE ──
// The tile layer (18 gradient tiles + ~780 star dots + labels) re-rendered on
// every frame; with the cursor spotlight requesting a redraw per mouse move,
// that tanked the macro-view frame rate. Render the layer to an offscreen
// canvas and blit it; re-render only when the camera, hover state, theme, or
// data actually changes.
var overviewLayer = { canvas: null, key: '' };
var overviewDataVersion = 0;

function invalidateOverviewLayer() {
  overviewDataVersion += 1;
}

function overviewLayerKey() {
  var st = _api.state;
  return [
    st.zoom.toFixed(4),
    Math.round(st.panX), Math.round(st.panY),
    st.hoveredZone || '',
    Math.round((st.zoneHoverAlpha || 0) * 20),
    isHubLightTheme() ? 'l' : 'd',
    _api.viewW, _api.viewH,
    overviewDataVersion,
  ].join('|');
}

function drawZoneLabelsScreenSpace(lod) {
  if (!_api.onetHubActive || !window.FWOnetHub
    || typeof FWOnetHub.getHubMode !== 'function'
    || FWOnetHub.getHubMode() !== 'overview') return;
  var mainCanvas = _api.ctx.canvas;
  if (!mainCanvas || typeof document === 'undefined') {
    drawFixedZoneTiles(_api.ctx);
    return;
  }
  var key = overviewLayerKey();
  if (!overviewLayer.canvas
    || overviewLayer.canvas.width !== mainCanvas.width
    || overviewLayer.canvas.height !== mainCanvas.height) {
    overviewLayer.canvas = document.createElement('canvas');
    overviewLayer.canvas.width = mainCanvas.width;
    overviewLayer.canvas.height = mainCanvas.height;
    overviewLayer.key = '';
  }
  if (overviewLayer.key !== key) {
    var layerCtx = overviewLayer.canvas.getContext('2d');
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.clearRect(0, 0, overviewLayer.canvas.width, overviewLayer.canvas.height);
    // Match the main canvas DPR transform so all px math is identical.
    var dpr = mainCanvas.width / (_api.viewW || 1);
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFixedZoneTiles(layerCtx);
    overviewLayer.key = key;
  }
  _api.ctx.save();
  _api.ctx.setTransform(1, 0, 0, 1, 0, 0);
  _api.ctx.drawImage(overviewLayer.canvas, 0, 0);
  _api.ctx.restore();
}
function worldToScreen(wx, wy) {
  const wW = _api.hubWorldW();
  const wH = _api.hubWorldH();
  return {
    x: wx / wW * _api.viewW * _api.state.zoom + _api.state.panX,
    y: wy / wH * _api.viewH * _api.state.zoom + _api.state.panY
  };
}
function screenToWorld(sx, sy) {
  const wW = _api.hubWorldW();
  const wH = _api.hubWorldH();
  return {
    x: (sx - _api.state.panX) / _api.state.zoom / _api.viewW * wW,
    y: (sy - _api.state.panY) / _api.state.zoom / _api.viewH * wH
  };
}

// ── FIT SCORE COLOR (Fortnite rarity ladder) ──
// common → uncommon → rare → EPIC (purple) → LEGENDARY (gold) → shiny gold
function rarityOf(score) {
  if (score >= 84) return { tier:'mythic',     base:'#FFD24A', light:'#FFF3C0', dark:'#E0A012', glow:'255,205,70' };
  if (score >= 70) return { tier:'legendary',  base:'#F2A82E', light:'#FFD98A', dark:'#C97A14', glow:'242,168,46' };
  if (score >= 44) return { tier:'epic',       base:'#BD4AE8', light:'#E4A8F7', dark:'#8A2BB5', glow:'189,74,232' };
  if (score >= 16) return { tier:'rare',       base:'#3FAEF0', light:'#9AD6FA', dark:'#1E7BC4', glow:'63,174,240' };
  if (score >= 0) return { tier:'uncommon',   base:'#5ED152', light:'#A9EDA1', dark:'#36A02C', glow:'94,209,82' };
  return                  { tier:'common',     base:'#9AA0AD', light:'#C7CBD3', dark:'#6E7480', glow:'154,160,173' };
}
function fitColor(score) { return rarityOf(score).base; }

function hexToRgb(hex) {
  var h = String(hex || '#78716C').replace('#', '');
  if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  return {
    r: parseInt(h.slice(0, 2), 16) || 120,
    g: parseInt(h.slice(2, 4), 16) || 113,
    b: parseInt(h.slice(4, 6), 16) || 108,
  };
}

function darkenRgb(rgb, factor) {
  factor = factor != null ? factor : 0.55;
  return {
    r: Math.round(rgb.r * factor),
    g: Math.round(rgb.g * factor),
    b: Math.round(rgb.b * factor),
  };
}

function drawObjectiveBar(ctx, cx, y, maxW, pct, rgb) {
  if (pct == null || pct < 0) return;
  var barW = Math.max(36, Math.min(maxW - 8, 72));
  var barH = 5;
  var bx = cx - barW / 2;
  var fillW = Math.max(0, Math.min(barW, barW * (pct / 100)));
  var trackA = isHubLightTheme() ? 0.18 : 0.22;
  var fillA = isHubLightTheme() ? 0.55 : 0.65;
  roundRectPath(ctx, bx, y, barW, barH, 2);
  ctx.fillStyle = isHubLightTheme()
    ? 'rgba(62, 40, 28, ' + trackA + ')'
    : 'rgba(255, 255, 255, ' + trackA + ')';
  ctx.fill();
  if (fillW > 0) {
    roundRectPath(ctx, bx, y, fillW, barH, 2);
    ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + fillA + ')';
    ctx.fill();
  }
  ctx.font = '500 9px Inter, sans-serif';
  ctx.fillStyle = isHubLightTheme() ? 'rgba(62, 40, 28, 0.55)' : 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(pct) + '%', bx + barW + 5, y + barH / 2);
  ctx.textAlign = 'center';
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = h / 360;
  const t2rgb = function (t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(t2rgb(hue + 1 / 3) * 255),
    g: Math.round(t2rgb(hue) * 255),
    b: Math.round(t2rgb(hue - 1 / 3) * 255),
  };
}

function fitOrbPalette(zoneId, fitPercent, zoneColors) {
  const hex = (zoneColors && zoneColors[zoneId])
    || (window.FWOnetHub && typeof FWOnetHub.getZoneColor === 'function'
      ? FWOnetHub.getZoneColor(zoneId) : '#78716C');
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const t = fitPercent != null ? Math.max(0, Math.min(1, fitPercent / 100)) : 0.42;
  const lightness = 22 + t * 50;
  const sat = Math.min(100, hsl.s + t * 8);
  const baseRgb = hslToRgb(hsl.h, sat, lightness);
  const lightRgb = hslToRgb(hsl.h, sat, Math.min(88, lightness + 14));
  const darkRgb = hslToRgb(hsl.h, sat, Math.max(10, lightness - 16));
  return {
    tier: 'fit',
    base: 'rgb(' + baseRgb.r + ',' + baseRgb.g + ',' + baseRgb.b + ')',
    light: 'rgb(' + lightRgb.r + ',' + lightRgb.g + ',' + lightRgb.b + ')',
    dark: 'rgb(' + darkRgb.r + ',' + darkRgb.g + ',' + darkRgb.b + ')',
    glow: baseRgb.r + ',' + baseRgb.g + ',' + baseRgb.b,
  };
}

function orbPalette(c, opts) {
  opts = opts || {};
  if (_api.onetHubActive && opts.sectorMode) {
    var fit = c.fitScore != null ? c.fitScore
      : (c.personalityFit != null ? c.personalityFit : 0);
    return rarityOf(fit);
  }
  if (_api.onetHubActive && c.orbColor && !opts.sectorMode) {
    var rgb = hexToRgb(c.orbColor);
    var light = 'rgb(' + Math.min(255, rgb.r + 48) + ',' + Math.min(255, rgb.g + 48) + ',' + Math.min(255, rgb.b + 48) + ')';
    var dark = 'rgb(' + Math.max(0, rgb.r - 40) + ',' + Math.max(0, rgb.g - 40) + ',' + Math.max(0, rgb.b - 40) + ')';
    return {
      tier: 'sector',
      base: c.orbColor,
      light: light,
      dark: dark,
      glow: rgb.r + ',' + rgb.g + ',' + rgb.b,
    };
  }
  return rarityOf(c.fitScore != null ? c.fitScore : 0);
}

function formatFitScore(val) {
  if (val == null) return '—';
  return val + '%';
}

function formatCosineFit(val) {
  if (val == null) return '—';
  return Math.round(val) + '%';
}

function formatFitPercentile(val) {
  return formatCosineFit(val);
}

// ── INDUSTRY CENTROIDS ──


function specularPointScreen(sx, sy, r) {
  if (!_api.state.mouseOn) {
    return { hx: sx - r * 0.38, hy: sy - r * 0.42 };
  }
  const mdx = _api.state.mouseX - sx;
  const mdy = _api.state.mouseY - sy;
  const len = Math.hypot(mdx, mdy) || 1;
  return {
    hx: sx + (mdx / len) * r * 0.46,
    hy: sy + (mdy / len) * r * 0.46,
  };
}

function buildSectorLabelLayout(queue) {
  const key = _api.sectorLabelCacheKey();
  if (_api.sectorLabelCache.key === key && _api.sectorLabelCache.layout.length) {
    return _api.sectorLabelCache.layout;
  }
  const placed = [];
  const layout = [];
  const typo = sectorLabelTypography(queue, false);
  const sorted = queue.slice().sort(function (a, b) {
    if (a.isHovered !== b.isHovered) return a.isHovered ? -1 : 1;
    if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
    if ((b.fitScore || 0) !== (a.fitScore || 0)) return (b.fitScore || 0) - (a.fitScore || 0);
    return String(a.id).localeCompare(String(b.id));
  });
  sorted.forEach(function (item) {
    const scr = worldToScreen(item.wx, item.wy);
    const screenR = sectorOrbRadiusPx(false);
    const emphasized = item.isHovered || item.isSelected;
    const labelText = truncateSectorLabel(item.name, emphasized ? 48 : typo.maxLen, emphasized);
    const fontSize = emphasized ? 11 : typo.fontSize;
    let chosen = null;
    let chosenOverlap = Infinity;
    for (let ai = 0; ai < LABEL_ANCHORS.length; ai++) {
      const anchor = LABEL_ANCHORS[ai];
      const rect = measureSectorLabelScreenRect(labelText, scr.x, scr.y, screenR, emphasized, anchor, fontSize);
      let blocked = false;
      let totalOverlap = 0;
      for (let pi = 0; pi < placed.length; pi++) {
        if (labelRectsOverlap(rect, placed[pi])) {
          blocked = true;
          totalOverlap += overlapArea(rect, placed[pi]);
        }
      }
      if (!blocked) {
        chosen = { anchor: anchor, leader: false, rect: rect };
        break;
      }
      if (totalOverlap < chosenOverlap) {
        chosenOverlap = totalOverlap;
        chosen = { anchor: anchor, leader: true, rect: rect };
      }
    }
    if (!chosen) return;
    placed.push(chosen.rect);
    layout.push({ id: item.id, anchor: chosen.anchor, leader: chosen.leader, fontSize: fontSize });
  });
  _api.sectorLabelCache = { key: key, layout: layout };
  return layout;
}

function drawSectorLabelsFromCache(queue, layout) {
  if (!queue || !queue.length || !layout || !layout.length) return;
  const byId = {};
  queue.forEach(function (item) { byId[item.id] = item; });
  layout.forEach(function (entry) {
    const item = byId[entry.id];
    if (!item) return;
    const scr = worldToScreen(item.wx, item.wy);
    const emphasized = item.isHovered || item.isSelected;
    const screenR = sectorOrbRadiusPx(emphasized);
    const maxLen = emphasized ? 48 : sectorLabelTypography(queue, false).maxLen;
    const labelText = truncateSectorLabel(item.name, maxLen, emphasized);
    const fontSize = emphasized ? 11 : (entry.fontSize || sectorLabelTypography(queue, false).fontSize);
    const rar = emphasized && item.fitScore != null
      ? rarityOf(item.fitScore).glow : null;
    drawSectorOrbLabelScreen(labelText, scr.x, scr.y, screenR, emphasized, entry.anchor, fontSize, entry.leader, rar);
  });
}

function drawSectorClusterBackdrop(careerList) {
  if (!careerList || careerList.length < 4) return;
  if (!window.FWOnetHub || typeof FWOnetHub.getSimilarityLinks !== 'function') return;
  var edges = FWOnetHub.getSimilarityLinks();
  if (!edges.length) return;
  var parent = {};
  careerList.forEach(function (c) { parent[c.id] = c.id; });
  function find(id) {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]];
      id = parent[id];
    }
    return id;
  }
  function union(a, b) {
    var ra = find(a);
    var rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  edges.forEach(function (edge) {
    if (edge.a && edge.b) union(edge.a.id, edge.b.id);
  });
  var groups = {};
  careerList.forEach(function (c) {
    var root = find(c.id);
    if (!groups[root]) groups[root] = [];
    groups[root].push(c);
  });
  var hubLight = isHubLightTheme();
  Object.keys(groups).forEach(function (root) {
    var members = groups[root];
    if (members.length < 3) return;
    var sx = 0;
    var sy = 0;
    members.forEach(function (c) {
      var pos = _api.careerWorldXY(c);
      var scr = worldToScreen(pos.x, pos.y);
      sx += scr.x;
      sy += scr.y;
    });
    sx /= members.length;
    sy /= members.length;
    var maxR = 0;
    members.forEach(function (c) {
      var pos = _api.careerWorldXY(c);
      var scr = worldToScreen(pos.x, pos.y);
      maxR = Math.max(maxR, Math.hypot(scr.x - sx, scr.y - sy));
    });
    var haloR = Math.max(48, maxR + 36);
    var wash = _api.ctx.createRadialGradient(sx, sy, haloR * 0.15, sx, sy, haloR);
    var alpha = hubLight ? 0.056 : 0.088;
    wash.addColorStop(0, 'rgba(148, 163, 184, ' + alpha + ')');
    wash.addColorStop(1, 'rgba(148, 163, 184, 0)');
    _api.ctx.fillStyle = wash;
    _api.ctx.beginPath();
    _api.ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
    _api.ctx.fill();
  });
}

function drawSectorLinksScreen() {
  if (!window.FWOnetHub || typeof FWOnetHub.getSimilarityLinks !== 'function') return;
  const simEdges = FWOnetHub.getSimilarityLinks();
  const hubLight = isHubLightTheme();
  const maxScreenDist = Math.max(_api.viewW, _api.viewH) * 0.42;
  simEdges.forEach(function (edge) {
    const ca = edge.a;
    const cb = edge.b;
    if (!ca || !cb) return;
    const pa = _api.careerWorldXY(ca);
    const pb = _api.careerWorldXY(cb);
    const a = worldToScreen(pa.x, pa.y);
    const b = worldToScreen(pb.x, pb.y);
    const screenDist = Math.hypot(a.x - b.x, a.y - b.y);
    const fitA = ca.fitScore != null ? ca.fitScore : (ca.personalityFit != null ? ca.personalityFit : 50);
    const fitB = cb.fitScore != null ? cb.fitScore : (cb.personalityFit != null ? cb.personalityFit : 50);
    const pairFit = (fitA + fitB) / 2;
    const rarA = orbPalette(ca, { sectorMode: true });
    const rarB = orbPalette(cb, { sectorMode: true });
    const ga = rarA.glow.split(',').map(function (v) { return parseInt(v, 10) || 0; });
    const gb = rarB.glow.split(',').map(function (v) { return parseInt(v, 10) || 0; });
    const glowR = Math.round((ga[0] + gb[0]) / 2);
    const glowG = Math.round((ga[1] + gb[1]) / 2);
    const glowB = Math.round((ga[2] + gb[2]) / 2);
    const distFade = Math.max(0.45, 1 - screenDist / maxScreenDist);
    const alpha = (hubLight ? 0.18 + pairFit / 250 : 0.14 + pairFit / 200) * distFade;
    _api.ctx.strokeStyle = 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',' + alpha.toFixed(3) + ')';
    _api.ctx.lineWidth = (pairFit >= 70 ? 1.35 : 1.0) * distFade;
    _api.ctx.globalAlpha = (0.50 + pairFit / 250) * distFade;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bulge = Math.min(28, screenDist * 0.12);
    const cx = mx - (dy / len) * bulge;
    const cy = my + (dx / len) * bulge;
    _api.ctx.beginPath();
    _api.ctx.moveTo(a.x, a.y);
    _api.ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    _api.ctx.stroke();
    _api.ctx.globalAlpha = 1;
  });
}

function drawSectorOrbsScreen(careerList) {
  const q = _api.state.searchQuery.toLowerCase();
  const labelQueue = [];
  const now = performance.now();
  const hubLight = isHubLightTheme();
  const SPOT_R = Math.max(_api.viewW, _api.viewH) * 0.14;
  careerList.forEach(function (c) {
    const pos = _api.careerWorldXY(c);
    const scr = worldToScreen(pos.x, pos.y);
    const isHovered = _api.state.hoveredId === c.id;
    const isSelected = _api.state.selectedId === c.id;
    const baseR = _api.sectorHoverRadii[c.id] != null ? _api.sectorHoverRadii[c.id] : sectorOrbRadiusPx(false);
    const r = (isHovered || isSelected) ? Math.max(baseR, sectorOrbRadiusPx(true) - 0.5) : baseR;
    const rar = orbPalette(c, { sectorMode: true });
    const displayFit = c.fitScore != null ? c.fitScore : (c.personalityFit != null ? c.personalityFit : 0);
    const rarity = rarityOf(displayFit);
    const sectorFit = displayFit;
    const matches = !q || c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q);
    _api.ctx.globalAlpha = q ? (matches ? 1 : 0.2) : 1;

    let glowStrength = 0;
    const isGold = sectorFit != null && sectorFit >= 70;
    const isBest = sectorFit != null && sectorFit >= 84;
    if (isBest) glowStrength = 0.55;
    else if (isGold) glowStrength = 0.38;
    else if (sectorFit != null && sectorFit >= 44) glowStrength = 0.22;
    if (isHovered) glowStrength = Math.max(glowStrength, 0.38);
    if (isSelected) glowStrength = Math.max(glowStrength, 0.48);

    if (_api.state.mouseOn && _api.motionOk) {
      const d = Math.hypot(scr.x - _api.state.mouseX, scr.y - _api.state.mouseY);
      const prox = Math.max(0, 1 - d / SPOT_R);
      glowStrength = Math.min(0.9, glowStrength + prox * prox * (hubLight ? 0.34 : 0.24));
    }

    if (glowStrength > 0) {
      const mult = isGold && _api.motionOk ? 1 + 0.24 * Math.sin(now / 380 + (c.vectorIndex || 0)) : 1;
      const haloR = r * (isBest ? 3.1 : 2.5);
      const glow = _api.ctx.createRadialGradient(scr.x, scr.y, r * 0.35, scr.x, scr.y, haloR);
      const glowRgb = rarity.glow || rar.glow;
      glow.addColorStop(0, 'rgba(' + glowRgb + ',' + (glowStrength * mult).toFixed(3) + ')');
      glow.addColorStop(1, 'rgba(' + glowRgb + ',0)');
      _api.ctx.fillStyle = glow;
      _api.ctx.beginPath();
      _api.ctx.arc(scr.x, scr.y, haloR, 0, Math.PI * 2);
      _api.ctx.fill();
    }

    if (isSelected) {
      _api.ctx.strokeStyle = 'rgba(' + (rarity.glow || rar.glow) + ',0.9)';
      _api.ctx.lineWidth = 2;
      _api.ctx.beginPath();
      _api.ctx.arc(scr.x, scr.y, r + 4, 0, Math.PI * 2);
      _api.ctx.stroke();
    }

    const sp = specularPointScreen(scr.x, scr.y, r);
    const body = _api.ctx.createRadialGradient(
      sp.hx - r * 0.12, sp.hy - r * 0.12, r * 0.08,
      scr.x, scr.y, r
    );
    body.addColorStop(0, rar.light);
    body.addColorStop(0.55, rar.base);
    body.addColorStop(1, rar.dark);
    _api.ctx.fillStyle = body;
    _api.ctx.beginPath();
    _api.ctx.arc(scr.x, scr.y, r, 0, Math.PI * 2);
    _api.ctx.fill();

    if (isGold) {
      _api.ctx.strokeStyle = isBest ? 'rgba(255,247,210,0.88)' : 'rgba(255,225,150,0.55)';
      _api.ctx.lineWidth = isBest ? 1.4 : 1;
      _api.ctx.beginPath();
      _api.ctx.arc(scr.x, scr.y, r - 0.5, 0, Math.PI * 2);
      _api.ctx.stroke();
    }

    // Legacy 3-stop specular profile — the mid stop is what gives the orbs
    // their metallic gem read instead of a soft blur.
    const hi = _api.ctx.createRadialGradient(sp.hx, sp.hy, 0, sp.hx, sp.hy, r * 0.62);
    hi.addColorStop(0, 'rgba(255,255,255,' + (isGold ? 0.9 : (isHovered ? 0.72 : 0.55)) + ')');
    hi.addColorStop(0.45, 'rgba(255,255,255,' + (isGold ? 0.35 : 0.18) + ')');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    _api.ctx.fillStyle = hi;
    _api.ctx.beginPath();
    _api.ctx.arc(scr.x, scr.y, r, 0, Math.PI * 2);
    _api.ctx.fill();

    labelQueue.push({
      id: c.id,
      name: c.name,
      wx: pos.x,
      wy: pos.y,
      isHovered: isHovered,
      isSelected: isSelected,
      fitScore: sectorFit,
    });
    _api.ctx.globalAlpha = 1;
  });
  _api.sectorLabelsPending = labelQueue;
}

function drawSectorLayerScreen(careerList) {
  drawSectorClusterBackdrop(careerList);
  drawSectorLinksScreen();
  drawSectorOrbsScreen(careerList);
  if (_api.sectorLabelsPending && _api.sectorLabelsPending.length) {
    const layout = buildSectorLabelLayout(_api.sectorLabelsPending);
    drawSectorLabelsFromCache(_api.sectorLabelsPending, layout);
  }
}

function zoneAtScreen(mx, my) {
  if (!_api.onetHubActive || !window.FWOnetHub || FWOnetHub.getHubMode() !== 'overview') return null;
  const world = screenToWorld(mx, my);
  if (typeof FWOnetHub.zoneAtWorldPoint === 'function') {
    return FWOnetHub.zoneAtWorldPoint(world.x, world.y);
  }
  return null;
}

// ── HIT TEST ──


function careerAtScreen(mx, my) {
  if (_api.onetHubActive && window.FWOnetHub && typeof FWOnetHub.getHubMode === 'function'
    && FWOnetHub.getHubMode() === 'overview') {
    return null;
  }
  for (let i = _api.careers.length - 1; i >= 0; i--) {
    const c = _api.careers[i];
    const pos = _api.careerWorldXY(c);
    const s = worldToScreen(pos.x, pos.y);
    const isSector = _api.onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() === 'sector';
    const hitR = isSector
      ? ((_api.state.hoveredId === c.id || _api.state.selectedId === c.id)
        ? sectorOrbRadiusPx(true) : (_api.sectorHoverRadii[c.id] ?? sectorOrbRadiusPx(false))) + 4
      : (_api.sectorHoverRadii[c.id] ?? 11) * _api.state.zoom;
    const dist = Math.sqrt((mx - s.x) ** 2 + (my - s.y) ** 2);
    if (dist <= hitR) return c;
  }
  return null;
}

// ── RENDER ──
function render() {
  if (!_api.ctx) return;
  const W = _api.viewW, H = _api.viewH;
  _api.ctx.clearRect(0, 0, W, H);

  // Background
  if (hubCanvas.paintHubCanvasBackground) {
    hubCanvas.paintHubCanvasBackground(_api.ctx, W, H, _api.state.panX, _api.state.panY);
  } else {
    _api.ctx.fillStyle = getHubCanvasBg();
    _api.ctx.fillRect(0, 0, W, H);
  }

  // Cursor spotlight brighten (dark mode) — restored from the legacy hub.
  if (_api.state.mouseOn && !isHubLightTheme() && _api.motionOk) {
    var spotR = Math.max(W, H) * 0.12;
    var sg = _api.ctx.createRadialGradient(
      _api.state.mouseX, _api.state.mouseY, 0,
      _api.state.mouseX, _api.state.mouseY, spotR * 1.5,
    );
    sg.addColorStop(0, 'rgba(255,255,255,0.07)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    _api.ctx.fillStyle = sg;
    _api.ctx.fillRect(0, 0, W, H);
  }

  if (_api.onetHubActive && window.FWOnetHub && typeof FWOnetHub.getHubMode === 'function'
    && FWOnetHub.getHubMode() === 'sector') {
    paintSectorScreenBackground(W, H, FWOnetHub.getActiveZone());
  }

  const renderMeta = (_api.onetHubActive && window.FWOnetHub && typeof FWOnetHub.getRenderMeta === 'function')
    ? FWOnetHub.getRenderMeta() : { lod: 'local', orbAlpha: 1 };
  const lod = renderMeta.lod || 'local';
  const hubMode = (_api.onetHubActive && window.FWOnetHub && typeof FWOnetHub.getHubMode === 'function')
    ? FWOnetHub.getHubMode() : 'overview';

  // Everything is drawn in screen space (worldToScreen applies pan/zoom) so
  // text, dots, and strokes stay constant-size while the map scales.
  drawZoneLabelsScreenSpace(lod);

  if (_api.onetHubActive && hubMode === 'sector') {
    // AI-derived ("fragment"/satellite) careers are excluded from the normal
    // always-visible orb+label path — they render exclusively through the
    // hub-onet-map.js overlay's hover-bloom system so they don't clutter the
    // view with permanent labels. careerAtScreen() below still hit-tests the
    // UNFILTERED _api.careers, so fragments stay clickable.
    drawSectorLayerScreen(_api.careers.filter(function (c) { return !c.aiDerived; }));
  }

  _api.hideHubBootError();
  if (_api.onetHubActive && window.FWOnetHub && FWOnetHub.getHubMode() !== 'sector') {
    _api.needsRedraw = false;
  }
}

  global.FWHubCanvasRender = {
    bind: function (api) {
      _api = api;
      if (!_api.sectorLabelCache) _api.sectorLabelCache = { key: '', layout: [] };
    },
    render: render,
    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    orbPalette: orbPalette,
    rarityOf: rarityOf,
    formatFitPercentile: formatFitPercentile,
    formatCosineFit: formatCosineFit,
    formatFitScore: formatFitScore,
    zoneAtScreen: zoneAtScreen,
    careerAtScreen: careerAtScreen,
    invalidateOverviewLayer: invalidateOverviewLayer,
    sectorOrbRadiusPx: sectorOrbRadiusPx,
  };
})(typeof window !== 'undefined' ? window : globalThis);
