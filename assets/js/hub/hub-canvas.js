/**
 * Career Hub canvas rendering — zone tiles, sector orbs, labels.
 */
(function (global) {
  var _api = {};
  var hubCanvas = global.FWHubCanvasBg || {};
  var getHubCanvasBg = hubCanvas.getHubCanvasBg || function () { return '#080706'; };
  // The hub canvas is ALWAYS dark (legacy behavior restored 2026-07-18 —
  // hub-dashboard.css pins --hub-canvas-bg dark in both themes so the cursor
  // spotlight reads everywhere). Every isHubLightTheme() branch in this file
  // styles canvas-INTERIOR paint, so all of them must follow the forced-dark
  // canvas, never the page theme. Page chrome (HUD/panels, hub-dashboard.js
  // DOM code) keeps real theme detection via FWHubCanvasBg.isHubLightTheme.
  var isHubLightTheme = function () { return false; };

var ZONE_LABEL_FONT_PX = 17; // bumped for the 11-macro-sector redesign (was 13)
  var SECTOR_ORB_SCREEN_R = 5.0;
  var SECTOR_ORB_HOVER_R = 6.15;
  var SATELLITE_SCALE = 0.48; // satellite orb radius as a fraction of a base orb
  var SAT_SPOT_R = 150; // px — cursor proximity radius that blooms satellites
  // Per-satellite bloom amount [0,1], eased per frame (sector mode redraws
  // continuously, so the lerp runs every frame — the legacy hub's smooth
  // "spring out of the background" reveal).
  var satAnim = Object.create(null);
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
  // A search filter / zoom animation can transiently collapse a tile to
  // w/h <= 0; arcTo throws on the resulting negative radius and one throw
  // kills the whole render frame ("Career map hit a display error").
  if (!(w > 0) || !(h > 0)) {
    c.beginPath();
    c.rect(x, y, Math.max(0, w), Math.max(0, h));
    c.closePath();
    return;
  }
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
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
  // Always the dark palette: label plates sit on the forced-dark canvas
  // (getRoadmapTreeColors would hand back light-theme plates in light mode).
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

// No hard length cap anymore: long titles wrap onto a balanced second line
// instead of truncating, so the full name is always readable.
function wrapSectorLabel(text) {
  const t = String(text || '');
  if (t.length <= 16) return [t];
  const mid = t.length / 2;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === ' ') {
      const d = Math.abs(i - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  }
  if (best === -1) return [t];
  return [t.slice(0, best), t.slice(best + 1)];
}

// Labels are fixed in WORLD units like the orbs (font ∝ zoom, clamped), so
// zooming out shrinks the label with its orb instead of the label growing to
// take the same share of the screen.
function sectorLabelTypography(queue, emphasized) {
  const zoom = (_api.state && _api.state.zoom) || 1;
  const n = queue ? queue.length : 0;
  const base = n > 40 ? 4.6 : 5.1;
  const fontSize = Math.max(6, Math.min(15, Math.round(base * zoom * 10) / 10));
  if (emphasized) return { fontSize: Math.max(fontSize + 1, 9) };
  return { fontSize: fontSize };
}

function labelRectForAnchor(lines, sx, sy, orbR, anchor, fontSize, padX, padY, gap) {
  _api.ctx.font = '600 ' + fontSize + 'px Inter, sans-serif';
  let tw = 0;
  for (let i = 0; i < lines.length; i++) tw = Math.max(tw, _api.ctx.measureText(lines[i]).width);
  const lineH = fontSize + 2;
  const w = tw + padX * 2;
  const h = lineH * lines.length + padY * 2;
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

function measureSectorLabelScreenRect(lines, sx, sy, orbR, emphasized, anchor, fontSize) {
  const typo = fontSize != null ? { fontSize: fontSize } : sectorLabelTypography(null, emphasized);
  const padX = emphasized ? 5 : 4;
  const padY = emphasized ? 3 : 2;
  return labelRectForAnchor(lines, sx, sy, orbR, anchor || 'N', typo.fontSize, padX, padY, emphasized ? 5 : 4);
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

function drawSectorOrbLabelScreen(lines, sx, sy, orbR, emphasized, anchor, fontSize, leader, leaderRgb) {
  if (typeof lines === 'string') lines = wrapSectorLabel(lines);
  const lc = getHubLabelColors();
  const typo = fontSize != null ? { fontSize: fontSize } : sectorLabelTypography(null, emphasized);
  const padX = emphasized ? 5 : 4;
  const padY = emphasized ? 3 : 2;
  const rect = labelRectForAnchor(lines, sx, sy, orbR, anchor || 'N', typo.fontSize, padX, padY, emphasized ? 5 : 4);
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
  _api.ctx.font = '600 ' + typo.fontSize + 'px Inter, sans-serif';
  const lineH = typo.fontSize + 2;
  const startY = rect.y + (rect.h - lineH * lines.length) / 2 + lineH / 2;
  for (let li = 0; li < lines.length; li++) {
    _api.ctx.fillText(lines[li], rect.textX, startY + li * lineH);
  }
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
    const labelText = wrapSectorLabel(item.name);
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
  drawSectorSubareaLabels(zoneId);
}

// Faint background sub-area names behind the orbs (legacy-hub grounding, e.g.
// PHYSICS & CHEMISTRY / ENGINEERING / BIOLOGY across Engineering & Science).
// Data comes from FWOnetHub.getZoneSubareas — static per zone, positioned at
// member centroids. INVARIANT: never gated on the top-fit lens or fit scores;
// these orient the space even when nothing in the area is a top match.
// World-anchored with font ∝ zoom so they scale with the map like terrain,
// not HUD text.
function drawSectorSubareaLabels(zoneId) {
  if (!window.FWOnetHub || typeof FWOnetHub.getZoneSubareas !== 'function') return;
  var subs = FWOnetHub.getZoneSubareas(zoneId);
  if (!subs || !subs.length) return;
  var ctx = _api.ctx;
  var zoom = (_api.state && _api.state.zoom) || 1;
  var fontPx = Math.max(16, Math.min(64, Math.round(26 * zoom)));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 ' + fontPx + 'px Inter, sans-serif';
  subs.forEach(function (s) {
    var scr = worldToScreen(s.x, s.y);
    var lines = wrapZoneLabel(String(s.label).toUpperCase());
    var lineH = fontPx * 1.12;
    var startY = scr.y - (lines.length - 1) * lineH / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.085)';
    for (var li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], scr.x, startY + li * lineH);
    }
  });
  ctx.restore();
}

// ── MACRO CLUSTER-ORBS ──
// The macro view is a career hub at industry scale: each sector renders as a
// compact cloud-cluster "orb" (soft cloud + mini career orbs compressed into
// a circle), floating in open space with curved links between related
// clusters — NOT a wall-to-wall tile grid. Zone hit-testing still uses the
// layout rects (generous click targets around each cluster).
//
// Everything here renders into the CACHED overview layer (see overviewLayer
// below) — richness is affordable because it only re-renders on camera/
// hover/theme/data changes. The only per-frame work is drawOverviewIdleLayer,
// which draws a handful of twinkle/drift dots over the cached blit.

function zoneSeededRnd(zoneId) {
  var seed = 0;
  var zid = String(zoneId || '');
  for (var si = 0; si < zid.length; si++) seed = ((seed << 5) + seed + zid.charCodeAt(si)) >>> 0;
  return function (k) {
    // xorshift-style mix so successive k values decorrelate.
    var h = (seed ^ (k * 2654435761)) >>> 0;
    h ^= h >> 13; h = (h * 1274126177) >>> 0; h ^= h >> 16;
    return (h % 1000) / 1000;
  };
}

function zoneClusterGeom(zone, x, y, zw, zh, countNorm) {
  var rnd = zoneSeededRnd(zone.id);
  // Cluster radius scales with the zone's real career count (sqrt so area
  // tracks count): big industries read big, small ones read small.
  var t = Math.sqrt(Math.max(0, Math.min(1, countNorm == null ? 0.5 : countNorm)));
  var R = Math.min(zw, zh) * (0.20 + 0.17 * t);
  // Deterministic organic offset, kept inside the tile so the cluster always
  // sits within its own hit-test rect (and labels have room below).
  var cx = x + zw / 2 + (rnd(3) - 0.5) * zw * 0.18;
  var cy = y + zh * 0.44 + (rnd(9) - 0.5) * zh * 0.14;
  cx = Math.max(x + R + 8, Math.min(x + zw - R - 8, cx));
  cy = Math.max(y + R + 8, Math.min(y + zh - R - 48, cy));
  return { cx: cx, cy: cy, R: R, rnd: rnd };
}

// Mini career orbs packed with a seeded Vogel (sunflower) spiral — a truly
// circular silhouette with natural center density, one dot per real career
// (capped for the largest zones). Purely decorative; per-career data stays
// sector-only. Returns depth-banded dots so the caller can draw back-to-front.
function zoneClusterDots(zone, g, count) {
  var rnd = g.rnd;
  var n = Math.max(4, Math.min(count || 0, 130));
  var rot = rnd(41) * Math.PI * 2;
  var squash = 0.86 + rnd(43) * 0.1; // slight ellipse per zone
  var GA = 2.399963229728653; // golden angle
  var back = [], mid = [], front = [], cores = [];
  var sparkles = [];
  for (var i = 0; i < n; i++) {
    var fr = (i + 0.5) / n;
    var rad = g.R * 0.94 * Math.sqrt(fr);
    var th = i * GA + rot;
    // Small per-dot jitter so the spiral reads organic, not mechanical.
    var jx = (rnd(i * 7 + 11) - 0.5) * g.R * 0.09;
    var jy = (rnd(i * 5 + 29) - 0.5) * g.R * 0.09;
    var px = g.cx + Math.cos(th) * rad + jx;
    var py = g.cy + Math.sin(th) * rad * squash + jy;
    var j = Math.floor(rnd(i * 3 + 71) * 100);
    if (j >= 93 && cores.length < 6) {
      cores.push({ x: px, y: py, r: 2.4 + (j % 5) * 0.28 });
    } else if (j < 52) {
      back.push({ x: px, y: py, r: 0.8 + (j % 4) * 0.14 });
    } else if (j < 84) {
      mid.push({ x: px, y: py, r: 1.3 + (j % 5) * 0.16 });
    } else {
      var dot = { x: px, y: py, r: 1.9 + (j % 4) * 0.24 };
      front.push(dot);
      if (sparkles.length < 7) {
        sparkles.push({ x: px, y: py, r: dot.r, phase: rnd(i + 97) * Math.PI * 2, speed: 0.6 + rnd(i + 53) * 0.9 });
      }
    }
  }
  return { back: back, mid: mid, front: front, cores: cores, sparkles: sparkles };
}

function fillDotBatch(ctx, dots, style) {
  if (!dots.length) return;
  ctx.fillStyle = style;
  ctx.beginPath();
  for (var i = 0; i < dots.length; i++) {
    ctx.moveTo(dots[i].x + dots[i].r, dots[i].y);
    ctx.arc(dots[i].x, dots[i].y, dots[i].r, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawZoneClusterOrbs(ctx, dots, hoverA, zoneRarity) {
  var hubLight = isHubLightTheme();
  // Light theme draws dots in the rarity's dark variant — the pale glow
  // color washes out on a light background.
  var dotRgb = hubLight ? hexToRgb(zoneRarity.dark) : hexToRgb(zoneRarity.base);
  var dotCol = dotRgb.r + ',' + dotRgb.g + ',' + dotRgb.b;
  var glow = zoneRarity.glow;
  var boost = hoverA * 0.12;
  // Back-to-front: dim small dots first, bright ones on top — reads as depth.
  fillDotBatch(ctx, dots.back, 'rgba(' + dotCol + ',' + ((hubLight ? 0.30 : 0.26) + boost).toFixed(3) + ')');
  fillDotBatch(ctx, dots.mid, 'rgba(' + dotCol + ',' + ((hubLight ? 0.52 : 0.46) + boost).toFixed(3) + ')');
  fillDotBatch(ctx, dots.front, 'rgba(' + dotCol + ',' + ((hubLight ? 0.82 : 0.78) + boost).toFixed(3) + ')');
  // Cores: soft glow halo + bright body + specular highlight.
  for (var ci = 0; ci < dots.cores.length; ci++) {
    var c = dots.cores[ci];
    var halo = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 3.4);
    halo.addColorStop(0, 'rgba(' + glow + ',' + (hubLight ? 0.30 : 0.38) + ')');
    halo.addColorStop(1, 'rgba(' + glow + ',0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  fillDotBatch(ctx, dots.cores, 'rgba(' + dotCol + ',' + (hubLight ? 0.92 : 0.95) + ')');
  ctx.fillStyle = 'rgba(255,255,255,' + (hubLight ? 0.6 : 0.7) + ')';
  ctx.beginPath();
  for (var ch = 0; ch < dots.cores.length; ch++) {
    var co = dots.cores[ch];
    var hr = co.r * 0.34;
    ctx.moveTo(co.x - co.r * 0.26 + hr, co.y - co.r * 0.3);
    ctx.arc(co.x - co.r * 0.26, co.y - co.r * 0.3, hr, 0, Math.PI * 2);
  }
  ctx.fill();
}

// Balanced two-line wrap for long sector names ("Community & Social Service"
// used to truncate to "COMMUNITY & SOC…").
function wrapZoneLabel(text) {
  var s = String(text || '');
  if (s.length <= 14) return [s];
  var mid = s.length / 2;
  var best = -1, bestDist = 1e9;
  for (var i = 1; i < s.length - 1; i++) {
    if (s[i] === ' ' && Math.abs(i - mid) < bestDist) { best = i; bestDist = Math.abs(i - mid); }
  }
  if (best < 0) return [s];
  return [s.slice(0, best), s.slice(best + 1)];
}

// Screen-space geometry of the last-rendered overview layer. The per-frame
// idle overlay (drawOverviewIdleLayer) reads this instead of recomputing.
var overviewGeoCache = null;

function drawFixedZoneTiles(targetCtx) {
  var ctx = targetCtx || _api.ctx;
  if (!_api.onetHubActive || !window.FWOnetHub || typeof FWOnetHub.getHubMode !== 'function') return;
  if (FWOnetHub.getHubMode() !== 'overview') return;
  var zones = (typeof FWOnetHub.getOverviewZones === 'function')
    ? FWOnetHub.getOverviewZones() : (FWOnetHub.getZoneTiles() || []);
  if (!zones || !zones.length) return;

  var hubLight = isHubLightTheme();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Pass 1: geometry for every cluster (centers feed the link web). Cluster
  // radius scales with each zone's career count so scale reads visually.
  var counts = {};
  var maxCount = 1;
  zones.forEach(function (zone) {
    var c = _api.zoneCareerCount(zone.id) || 0;
    counts[zone.id] = c;
    if (c > maxCount) maxCount = c;
  });
  var geo = {};
  zones.forEach(function (zone) {
    var b = zone.bounds;
    if (!b) return;
    var p1 = worldToScreen(b.minX, b.minY);
    var p2 = worldToScreen(b.maxX, b.maxY);
    var x = p1.x, y = p1.y, zw = p2.x - p1.x, zh = p2.y - p1.y;
    if (!(zw > 0) || !(zh > 0)) return;
    var zoneFit = (zone.zoneFit) || (window.FWOnetHub && typeof FWOnetHub.getZoneFit === 'function'
      ? FWOnetHub.getZoneFit(zone.id) : null);
    var pPct = zoneFit && zoneFit.overallFit != null ? zoneFit.overallFit
      : (zoneFit && zoneFit.personalityFit != null ? zoneFit.personalityFit : 0);
    var hoverA = _api.state.hoveredZone === zone.id ? (_api.state.zoneHoverAlpha || 0) : 0;
    var g = zoneClusterGeom(zone, x, y, zw, zh, counts[zone.id] / maxCount);
    // Hover response: the whole cluster scales up and lifts, not just a rim
    // glow. Lives in the cached layer — hoverA is part of the cache key, so
    // the fade re-renders exactly as the old rim-glow did.
    if (hoverA > 0) {
      g.R *= 1 + 0.05 * hoverA;
      g.cy -= 4 * hoverA;
    }
    geo[zone.id] = {
      zone: zone, x: x, y: y, zw: zw, zh: zh,
      g: g,
      count: counts[zone.id],
      pPct: pPct,
      rarity: rarityOf(pPct),
      rgb: hexToRgb(rarityOf(pPct).base),
      isHover: _api.state.hoveredZone === zone.id,
      hoverA: hoverA,
    };
  });

  // Pass 2: the inter-cluster web (under everything). Link strength comes
  // from the real zone-vector cosine — stronger relationships draw wider,
  // brighter, and in a gradient between the two clusters' colors, so the web
  // reads as meaningful rather than decorative.
  if (window.FWOnetHub && typeof FWOnetHub.getZoneNeighborLinks === 'function') {
    var links = FWOnetHub.getZoneNeighborLinks() || [];
    var sMin = Infinity, sMax = -Infinity;
    links.forEach(function (l) {
      if (typeof l.score === 'number') {
        if (l.score < sMin) sMin = l.score;
        if (l.score > sMax) sMax = l.score;
      }
    });
    var sSpan = (sMax > sMin) ? (sMax - sMin) : 1;
    links.forEach(function (link) {
      var A = geo[link.a];
      var B = geo[link.b];
      if (!A || !B) return;
      var t = (typeof link.score === 'number') ? (link.score - sMin) / sSpan : 0.5;
      var a = { x: A.g.cx, y: A.g.cy };
      var b2 = { x: B.g.cx, y: B.g.cy };
      var dx = b2.x - a.x, dy = b2.y - a.y;
      var len = Math.hypot(dx, dy) || 1;
      // Start/end at the cluster edges, not centers.
      var ax = a.x + dx / len * A.g.R * 0.95;
      var ay = a.y + dy / len * A.g.R * 0.95;
      var bx = b2.x - dx / len * B.g.R * 0.95;
      var by = b2.y - dy / len * B.g.R * 0.95;
      var mx = (ax + bx) / 2, my = (ay + by) / 2;
      var bulge = Math.min(40, len * 0.12);
      var alpha = (hubLight ? 0.13 : 0.11) + t * 0.20;
      var grad = ctx.createLinearGradient(ax, ay, bx, by);
      grad.addColorStop(0, 'rgba(' + A.rarity.glow + ',' + alpha.toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(' + B.rarity.glow + ',' + alpha.toFixed(3) + ')');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.9 + t * 1.6;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx - (dy / len) * bulge, my + (dx / len) * bulge, bx, by);
      ctx.stroke();
    });
  }

  // Pass 3: cloud + orb cluster per zone.
  var geoCache = { zones: [] };
  zones.forEach(function (zone) {
    var G = geo[zone.id];
    if (!G) return;
    var g = G.g;
    var rgb = G.rgb;
    var rarity = G.rarity;
    var hoverA = G.hoverA;
    var baseA = (hubLight ? 0.30 : 0.20) + hoverA * 0.10;

    // Soft cloud: one broad wash + 4 offset blobs, all inside ~1.5R so each
    // cluster reads as a discrete cloud-orb with open space around it.
    var wash = ctx.createRadialGradient(g.cx, g.cy, g.R * 0.1, g.cx, g.cy, g.R * 1.55);
    wash.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (baseA * 1.15).toFixed(3) + ')');
    wash.addColorStop(0.62, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (baseA * 0.5).toFixed(3) + ')');
    wash.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
    ctx.fillStyle = wash;
    ctx.fillRect(g.cx - g.R * 1.6, g.cy - g.R * 1.6, g.R * 3.2, g.R * 3.2);
    for (var bi = 0; bi < 4; bi++) {
      var bx = g.cx + (g.rnd(bi * 5 + 1) - 0.5) * g.R * 1.1;
      var by = g.cy + (g.rnd(bi * 7 + 3) - 0.5) * g.R * 1.0;
      var br = g.R * (0.5 + 0.35 * g.rnd(bi * 3 + 5));
      var ba = baseA * 0.6;
      var blob = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      blob.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + ba.toFixed(3) + ')');
      blob.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hover: rim glow around the (already scaled+lifted) cloud-orb.
    if (hoverA > 0.02) {
      var rim = ctx.createRadialGradient(g.cx, g.cy, g.R * 0.9, g.cx, g.cy, g.R * 1.7);
      rim.addColorStop(0, 'rgba(' + rarity.glow + ',0)');
      rim.addColorStop(0.7, 'rgba(' + rarity.glow + ',' + (hoverA * 0.26).toFixed(3) + ')');
      rim.addColorStop(1, 'rgba(' + rarity.glow + ',0)');
      ctx.fillStyle = rim;
      ctx.fillRect(g.cx - g.R * 1.8, g.cy - g.R * 1.8, g.R * 3.6, g.R * 3.6);
    }

    var dots = zoneClusterDots(zone, g, G.count);
    drawZoneClusterOrbs(ctx, dots, hoverA, rarity);
    geoCache.zones.push({
      id: zone.id,
      cx: g.cx, cy: g.cy, R: g.R,
      glow: rarity.glow,
      sparkles: dots.sparkles,
      moteSeedA: g.rnd(201), moteSeedB: g.rnd(207),
    });
  });

  // Pass 4: label plates, big zones first, colliding plates culled — at
  // mobile widths not all 11 macro-sector labels may fit; the biggest
  // sectors win instead of every label overprinting into noise. Plates use
  // the same rounded panel language as the sector-view orb labels.
  var placed = [];
  var labelFont = Math.max(12, Math.min(19, ZONE_LABEL_FONT_PX * (_api.state.zoom || 1)));
  var subFont = Math.max(10, Math.min(14, labelFont * 0.76));
  var ordered = zones.slice().sort(function (za, zb) { return (counts[zb.id] || 0) - (counts[za.id] || 0); });
  ordered.forEach(function (zone) {
    var G = geo[zone.id];
    if (!G) return;
    var g = G.g;
    var hoverA = G.hoverA;
    // A label belongs to its cluster: when the cluster itself has been panned
    // off-screen, its label must go with it — the on-screen clamp below used
    // to pin orphaned labels to the viewport edge with no orb in sight.
    var vw = _api.viewW;
    var vh = _api.viewH;
    if (vw > 0 && vh > 0
      && (g.cx + g.R < 0 || g.cx - g.R > vw || g.cy + g.R < 0 || g.cy - g.R > vh)) return;
    var lines = wrapZoneLabel(String(zone.label || zone.id || '')).map(function (s) { return s.toUpperCase(); });
    var sub = G.count + (G.count === 1 ? ' career' : ' careers') + ' · ' + Math.round(G.pPct) + '% fit';
    // Rich hover/zoom-in reveal: resting plate stays label+count+fit% only;
    // a taste of real contents appears once the zone is actually being
    // considered (hover, or the hovered zone winning the collision cull).
    // Detail scales with attention instead of showing everything at rest.
    var showExamples = hoverA > 0.35 && zone.exampleTitles && zone.exampleTitles.length;
    var exampleLine = '';
    if (showExamples) {
      exampleLine = 'Includes: ' + zone.exampleTitles.slice(0, 2).join(', ');
      if (exampleLine.length > 52) exampleLine = exampleLine.slice(0, 51) + '…';
    }
    ctx.font = '600 ' + labelFont + 'px Inter, sans-serif';
    var w = 0;
    lines.forEach(function (ln) { w = Math.max(w, ctx.measureText(ln).width); });
    ctx.font = '500 ' + subFont + 'px Inter, sans-serif';
    w = Math.max(w, ctx.measureText(sub).width);
    var exampleFont = Math.max(9, subFont - 1);
    if (showExamples) {
      ctx.font = '400 ' + exampleFont + 'px Inter, sans-serif';
      w = Math.max(w, ctx.measureText(exampleLine).width);
    }
    var lineH = labelFont + 3;
    var plateW = w + 24;
    var plateH = lines.length * lineH + subFont + 16 + (showExamples ? exampleFont + 8 : 0);
    var plateX = g.cx - plateW / 2;
    // Keep the plate on-screen (edge zones otherwise clip at narrow widths).
    plateX = Math.max(4, Math.min((_api.viewW || 1e9) - plateW - 4, plateX));
    var plateCx = plateX + plateW / 2;
    var plateY = Math.max(g.cy + g.R + 8, _api.zoneLabelCanvasY(G.y, G.zh) - 12);
    var rect = { x: plateX - 4, y: plateY - 4, w: plateW + 8, h: plateH + 8 };
    var collides = placed.some(function (p) {
      return rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y;
    });
    // The hovered zone's label always shows, even if it lost the cull.
    if (collides && hoverA < 0.05) return;
    placed.push(rect);

    roundRectPath(ctx, plateX, plateY, plateW, plateH, 9);
    ctx.fillStyle = hubLight
      ? 'rgba(255,251,246,' + (0.86 + hoverA * 0.08).toFixed(3) + ')'
      : 'rgba(16,13,11,' + (0.74 + hoverA * 0.12).toFixed(3) + ')';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hoverA > 0.02
      ? 'rgba(' + G.rarity.glow + ',' + (0.25 + hoverA * 0.3).toFixed(3) + ')'
      : (hubLight ? 'rgba(62,40,28,0.14)' : 'rgba(255,255,255,0.10)');
    roundRectPath(ctx, plateX, plateY, plateW, plateH, 9);
    ctx.stroke();

    ctx.fillStyle = hubLight ? 'rgba(62,40,28,0.85)' : 'rgba(255,255,255,0.90)';
    ctx.font = '600 ' + labelFont + 'px Inter, sans-serif';
    var ty = plateY + 8 + lineH / 2;
    lines.forEach(function (ln) {
      ctx.fillText(ln, plateCx, ty);
      ty += lineH;
    });
    ctx.fillStyle = hubLight ? 'rgba(62,40,28,0.52)' : 'rgba(255,255,255,0.52)';
    ctx.font = '500 ' + subFont + 'px Inter, sans-serif';
    ctx.fillText(sub, plateCx, ty + 1);
    if (showExamples) {
      ctx.fillStyle = hubLight ? 'rgba(62,40,28,0.42)' : 'rgba(255,255,255,0.42)';
      ctx.font = '400 ' + exampleFont + 'px Inter, sans-serif';
      ctx.fillText(exampleLine, plateCx, ty + 1 + subFont + 6);
    }
  });

  overviewGeoCache = geoCache;
}

// ── PER-FRAME IDLE LAYER ──
// A few twinkling front dots and two slow-drifting motes per cluster, drawn
// over the cached blit every frame. ~160 tiny arcs total — cheap enough to
// run continuously without touching the cached layer (the fix that the cache
// exists for). Skipped entirely under prefers-reduced-motion.
function drawOverviewIdleLayer(nowMs) {
  var geo = overviewGeoCache;
  if (!geo || !geo.zones.length || !_api.ctx) return;
  if (!_api.motionOk) return;
  var ctx = _api.ctx;
  var t = (nowMs || 0) / 1000;
  for (var zi = 0; zi < geo.zones.length; zi++) {
    var z = geo.zones[zi];
    // Twinkle: sine-pulse the bright front dots.
    for (var si = 0; si < z.sparkles.length; si++) {
      var s = z.sparkles[si];
      var pulse = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      var a = 0.10 + 0.38 * pulse;
      ctx.fillStyle = 'rgba(' + z.glow + ',' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r + 0.9 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    // Motes: two faint dots on slow elliptical orbits inside the cloud.
    for (var mi = 0; mi < 2; mi++) {
      var seed = mi === 0 ? z.moteSeedA : z.moteSeedB;
      var orbitR = z.R * (0.45 + 0.4 * seed);
      var speed = (Math.PI * 2) / (26 + seed * 18) * (mi === 0 ? 1 : -1);
      var ang = t * speed + seed * Math.PI * 2;
      var mx = z.cx + Math.cos(ang) * orbitR;
      var my = z.cy + Math.sin(ang) * orbitR * 0.85;
      ctx.fillStyle = 'rgba(' + z.glow + ',0.35)';
      ctx.beginPath();
      ctx.arc(mx, my, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  drawOverviewIdleLayer(typeof performance !== 'undefined' ? performance.now() : Date.now());
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
// Tier boundaries canonical in FWOnetMath.FIT_TIERS (mean-centered cosine scale:
// 66/56/46/34/20). Literals kept here to avoid coupling the render hot path to
// module load order — keep them in sync with FWOnetMath.
function rarityOf(score) {
  if (score >= 66) return { tier:'mythic',     base:'#FFD24A', light:'#FFF3C0', dark:'#E0A012', glow:'255,205,70' };
  if (score >= 56) return { tier:'legendary',  base:'#F2A82E', light:'#FFD98A', dark:'#C97A14', glow:'242,168,46' };
  if (score >= 46) return { tier:'epic',       base:'#BD4AE8', light:'#E4A8F7', dark:'#8A2BB5', glow:'189,74,232' };
  if (score >= 34) return { tier:'rare',       base:'#3FAEF0', light:'#9AD6FA', dark:'#1E7BC4', glow:'63,174,240' };
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
    // Satellites yield label space to base careers (they're secondary info).
    if (!!a.isSatellite !== !!b.isSatellite) return a.isSatellite ? 1 : -1;
    if ((b.fitScore || 0) !== (a.fitScore || 0)) return (b.fitScore || 0) - (a.fitScore || 0);
    return String(a.id).localeCompare(String(b.id));
  });
  sorted.forEach(function (item) {
    const scr = worldToScreen(item.wx, item.wy);
    const screenR = item.isSatellite
      ? Math.max(3, sectorOrbRadiusPx(false) * SATELLITE_SCALE)
      : sectorOrbRadiusPx(false);
    const emphasized = item.isHovered || item.isSelected;
    const labelText = wrapSectorLabel(item.name);
    const fontSize = emphasized ? sectorLabelTypography(queue, true).fontSize
      : (item.isSatellite ? Math.max(6, typo.fontSize * 0.82) : typo.fontSize);
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
    // Satellites never take a leader-line fallback: a blocked satellite label
    // is culled outright rather than allowed to overlap (declutter beats
    // completeness for secondary orbs — hover still reveals the name).
    if (chosen.leader && item.isSatellite && !emphasized) return;
    placed.push(chosen.rect);
    layout.push({ id: item.id, anchor: chosen.anchor, leader: chosen.leader, fontSize: fontSize });
  });
  _api.sectorLabelCache = { key: key, layout: layout };
  return layout;
}

function drawSectorLabelsFromCache(queue, layout) {
  _api.baseLabelRects = [];
  if (!queue || !queue.length || !layout || !layout.length) return;
  const byId = {};
  queue.forEach(function (item) { byId[item.id] = item; });
  layout.forEach(function (entry) {
    const item = byId[entry.id];
    if (!item) return;
    const scr = worldToScreen(item.wx, item.wy);
    const emphasized = item.isHovered || item.isSelected;
    const screenR = item.isSatellite && !emphasized
      ? Math.max(3, sectorOrbRadiusPx(false) * SATELLITE_SCALE)
      : sectorOrbRadiusPx(emphasized);
    const labelText = wrapSectorLabel(item.name);
    const fontSize = emphasized ? sectorLabelTypography(queue, true).fontSize
      : (entry.fontSize || sectorLabelTypography(queue, false).fontSize);
    const rar = emphasized && item.fitScore != null
      ? rarityOf(item.fitScore).glow : null;
    _api.baseLabelRects.push(measureSectorLabelScreenRect(labelText, scr.x, scr.y, screenR, emphasized, entry.anchor, fontSize));
    drawSectorOrbLabelScreen(labelText, scr.x, scr.y, screenR, emphasized, entry.anchor, fontSize, entry.leader, rar);
  });
}

var _sectorBackdropCache = { edges: null, len: -1, groups: null };
function drawSectorClusterBackdrop(careerList) {
  if (!careerList || careerList.length < 4) return;
  if (!window.FWOnetHub || typeof FWOnetHub.getSimilarityLinks !== 'function') return;
  var edges = FWOnetHub.getSimilarityLinks();
  if (!edges.length) return;
  // F3: cluster MEMBERSHIP (union-find over the static link graph) changes only
  // when the link set does. getSimilarityLinks() hands back a stable array
  // reference until the graph rebuilds, so key the membership cache on that
  // identity + careerList length. The per-frame screen projection below stays
  // live (it tracks the camera).
  var groups;
  if (_sectorBackdropCache.groups && _sectorBackdropCache.edges === edges && _sectorBackdropCache.len === careerList.length) {
    groups = _sectorBackdropCache.groups;
  } else {
    var parent = {};
    careerList.forEach(function (c) { parent[c.id] = c.id; });
    var find = function (id) {
      while (parent[id] !== id) {
        parent[id] = parent[parent[id]];
        id = parent[id];
      }
      return id;
    };
    var union = function (a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    edges.forEach(function (edge) {
      if (edge.a && edge.b) union(edge.a.id, edge.b.id);
    });
    groups = {};
    careerList.forEach(function (c) {
      var root = find(c.id);
      if (!groups[root]) groups[root] = [];
      groups[root].push(c);
    });
    _sectorBackdropCache.edges = edges;
    _sectorBackdropCache.len = careerList.length;
    _sectorBackdropCache.groups = groups;
  }
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
    // F3: the blended glow color depends only on both orbs' rarity band, not
    // the camera — memoize it on the (cached, stable) edge object to drop the
    // twice-per-edge orbPalette + string parse from the per-frame path. The link
    // cache rebuilds fresh edge objects whenever a fit-band could change, so a
    // stale color can't survive a rarity crossing.
    let glow = edge._glow;
    if (!glow) {
      const rarA = orbPalette(ca, { sectorMode: true });
      const rarB = orbPalette(cb, { sectorMode: true });
      const ga = rarA.glow.split(',').map(function (v) { return parseInt(v, 10) || 0; });
      const gb = rarB.glow.split(',').map(function (v) { return parseInt(v, 10) || 0; });
      glow = edge._glow = {
        r: Math.round((ga[0] + gb[0]) / 2),
        g: Math.round((ga[1] + gb[1]) / 2),
        b: Math.round((ga[2] + gb[2]) / 2),
      };
    }
    const glowR = glow.r;
    const glowG = glow.g;
    const glowB = glow.b;
    const distFade = Math.max(0.45, 1 - screenDist / maxScreenDist);
    const alpha = (hubLight ? 0.18 + pairFit / 250 : 0.14 + pairFit / 200) * distFade;
    _api.ctx.strokeStyle = 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',' + alpha.toFixed(3) + ')';
    _api.ctx.lineWidth = (pairFit >= 56 ? 1.35 : 1.0) * distFade;
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

// F2: per-frame flag — true while any satellite bloom spring is still moving,
// so the dashboard loop keeps running until blooms settle (they ease down after
// the pointer leaves the canvas, past the last pointer-driven redraw).
var _satBloomActive = false;
function drawSectorOrbsScreen(careerList) {
  _satBloomActive = false;
  const q = _api.state.searchQuery.toLowerCase();
  const labelQueue = [];
  const satLabelQueue = [];
  const now = performance.now();
  const hubLight = isHubLightTheme();
  const SPOT_R = Math.max(_api.viewW, _api.viewH) * 0.14;
  // Top-matches lens: careers below the cutoff render dimmed/shrunk so the
  // ranked handful dominates first glance. Hover/select/search un-dims.
  const lensCutoff = (window.FWOnetHub && typeof FWOnetHub.getLensCutoff === 'function')
    ? FWOnetHub.getLensCutoff() : null;
  // Satellites (AI-derived fragments) render in this same pass as smaller
  // tethered orbs; their parents get a ring + count badge after the loop.
  const parentBySoc = {};
  const drawnFragParents = [];
  careerList.forEach(function (c) {
    if (!c.aiDerived && c.soc) parentBySoc[c.soc] = c;
  });
  careerList.forEach(function (c) {
    const pos = _api.careerWorldXY(c);
    const scr = worldToScreen(pos.x, pos.y);
    const isHovered = _api.state.hoveredId === c.id;
    const isSelected = _api.state.selectedId === c.id;
    const isSat = !!c.aiDerived;
    const rar = orbPalette(c, { sectorMode: true });
    const displayFit = c.fitScore != null ? c.fitScore : (c.personalityFit != null ? c.personalityFit : 0);
    const rarity = rarityOf(displayFit);
    const sectorFit = displayFit;
    const dimmed = !isSat && lensCutoff != null && !q && !isHovered && !isSelected
      && displayFit < lensCutoff;
    // Satellites rest faded into the background and spring out smoothly as
    // the cursor nears (proximity-eased bloom), so they never clutter the
    // top-matches view until the user reaches for them.
    let satBloom = 0;
    if (isSat) {
      let target = (isHovered || isSelected) ? 1 : 0;
      if (!target && _api.state.mouseOn) {
        const md = Math.hypot(scr.x - _api.state.mouseX, scr.y - _api.state.mouseY);
        const t = Math.max(0, Math.min(1, 1 - md / SAT_SPOT_R));
        target = t * t * (3 - 2 * t);
      }
      const prev = satAnim[c.id] || 0;
      const settled = Math.abs(target - prev) < 0.004;
      if (!settled) _satBloomActive = true;
      satBloom = settled ? target : prev + (target - prev) * 0.16;
      satAnim[c.id] = satBloom;
    }
    const baseR0 = _api.sectorHoverRadii[c.id] != null ? _api.sectorHoverRadii[c.id] : sectorOrbRadiusPx(false);
    const baseR = isSat
      ? Math.max(2.5, sectorOrbRadiusPx(false) * SATELLITE_SCALE * (0.62 + 0.55 * satBloom))
      : (dimmed ? baseR0 * 0.72 : baseR0);
    const r = (isHovered || isSelected)
      ? Math.max(baseR, sectorOrbRadiusPx(true) * (isSat ? SATELLITE_SCALE + 0.14 : 1) - 0.5)
      : baseR;
    // Tether from the parent orb's edge to the satellite, under both orbs.
    const satParent = isSat && c.derivedFrom ? parentBySoc[c.derivedFrom.soc] : null;
    if (satParent) {
      if (drawnFragParents.indexOf(satParent) === -1) drawnFragParents.push(satParent);
      const ppos = _api.careerWorldXY(satParent);
      const pscr = worldToScreen(ppos.x, ppos.y);
      const dx = scr.x - pscr.x, dy = scr.y - pscr.y;
      const dlen = Math.hypot(dx, dy) || 1;
      const pr = sectorOrbRadiusPx(false);
      _api.ctx.strokeStyle = 'rgba(' + rarity.glow + ',' + (0.08 + 0.5 * satBloom).toFixed(3) + ')';
      _api.ctx.lineWidth = 0.7 + 0.8 * satBloom;
      _api.ctx.beginPath();
      _api.ctx.moveTo(pscr.x + dx / dlen * pr, pscr.y + dy / dlen * pr);
      _api.ctx.lineTo(scr.x - dx / dlen * r, scr.y - dy / dlen * r);
      _api.ctx.stroke();
    }
    const matches = !q || c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q);
    _api.ctx.globalAlpha = q ? (matches ? 1 : 0.2)
      : (dimmed ? 0.3 : (isSat ? 0.18 + 0.82 * satBloom : 1));

    let glowStrength = 0;
    const isGold = sectorFit != null && sectorFit >= 56;
    const isBest = sectorFit != null && sectorFit >= 66;
    if (isBest) glowStrength = 0.55;
    else if (isGold) glowStrength = 0.38;
    else if (sectorFit != null && sectorFit >= 44) glowStrength = 0.22;
    if (dimmed) glowStrength = 0;
    if (isSat) glowStrength = 0.4 * satBloom;
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

    // Dimmed long-tail orbs skip labels so the label solve favors top matches.
    // Satellites bypass the (cached) label solve entirely: their labels fade
    // in with the bloom, drawn ad-hoc after the cached labels.
    if (isSat) {
      if (satBloom > 0.5 || isHovered || isSelected) {
        satLabelQueue.push({ name: c.name, x: scr.x, y: scr.y, r: r, a: Math.max(satBloom, isHovered || isSelected ? 1 : 0), emphasized: isHovered || isSelected });
      }
    } else if (!dimmed) {
      labelQueue.push({
        id: c.id,
        name: c.name,
        wx: pos.x,
        wy: pos.y,
        isHovered: isHovered,
        isSelected: isSelected,
        fitScore: sectorFit,
      });
    }
    _api.ctx.globalAlpha = 1;
  });

  // Depth badges: parents whose satellites are in this render set get a ring
  // + count. The count comes from FWOnetHub.getFragmentCount — the SAME index
  // the side panel reads and the satellite layout is built from, so the badge
  // always matches the orbs on screen.
  const fragCountOf = (window.FWOnetHub && typeof FWOnetHub.getFragmentCount === 'function')
    ? FWOnetHub.getFragmentCount : null;
  drawnFragParents.forEach(function (p) {
    const count = fragCountOf ? fragCountOf(p.soc) : 0;
    if (!count) return;
    const ppos = _api.careerWorldXY(p);
    const pscr = worldToScreen(ppos.x, ppos.y);
    const pr = sectorOrbRadiusPx(false);
    const rarity = rarityOf(p.fitScore != null ? p.fitScore : 0);
    _api.ctx.save();
    _api.ctx.strokeStyle = 'rgba(' + rarity.glow + ',' + (hubLight ? 0.5 : 0.4) + ')';
    _api.ctx.lineWidth = 1;
    _api.ctx.beginPath();
    _api.ctx.arc(pscr.x, pscr.y, pr + 2.5, 0, Math.PI * 2);
    _api.ctx.stroke();
    const bx = pscr.x + pr * 0.95 + 3;
    const by = pscr.y - pr * 0.95 - 3;
    _api.ctx.fillStyle = hubLight ? 'rgba(255,255,255,0.92)' : 'rgba(20,17,15,0.9)';
    _api.ctx.strokeStyle = 'rgba(' + rarity.glow + ',0.75)';
    _api.ctx.beginPath();
    _api.ctx.arc(bx, by, 6, 0, Math.PI * 2);
    _api.ctx.fill();
    _api.ctx.stroke();
    _api.ctx.fillStyle = hubLight ? 'rgba(62,40,28,0.95)' : 'rgba(255,255,255,0.9)';
    _api.ctx.font = '700 8px Inter, sans-serif';
    _api.ctx.textAlign = 'center';
    _api.ctx.textBaseline = 'middle';
    _api.ctx.fillText(count > 9 ? '9+' : String(count), bx, by + 0.5);
    _api.ctx.restore();
  });
  _api.sectorLabelsPending = labelQueue;
  _api.satLabelsPending = satLabelQueue;
}

// Bloom-gated satellite labels — fade in with the orb's own spring-out.
function drawSatelliteLabels(queue) {
  if (!queue || !queue.length) return;
  const typo = sectorLabelTypography(null, false);
  const fontSize = Math.max(6, typo.fontSize * 0.82);
  // Greedy declutter: strongest bloom first; a label whose rect would overlap
  // an already-placed satellite label is skipped (it appears as the cursor
  // gets closer and its bloom wins).
  const placed = (_api.baseLabelRects || []).slice();
  queue.slice().sort(function (a, b) { return (b.emphasized - a.emphasized) || (b.a - a.a); })
    .forEach(function (item) {
      const alpha = item.emphasized ? 1 : Math.max(0, Math.min(1, (item.a - 0.5) / 0.5));
      if (alpha <= 0.02) return;
      const lines = wrapSectorLabel(item.name);
      const fs = item.emphasized ? fontSize + 1 : fontSize;
      const rect = measureSectorLabelScreenRect(lines, item.x, item.y, item.r, item.emphasized, 'S', fs);
      if (!item.emphasized) {
        for (let pi = 0; pi < placed.length; pi++) {
          if (labelRectsOverlap(rect, placed[pi])) return;
        }
      }
      placed.push(rect);
      _api.ctx.save();
      _api.ctx.globalAlpha = alpha;
      drawSectorOrbLabelScreen(lines, item.x, item.y, item.r, item.emphasized, 'S', fs, false, null);
      _api.ctx.restore();
    });
}

function drawSectorLayerScreen(careerList) {
  drawSectorClusterBackdrop(careerList);
  drawSectorLinksScreen();
  drawSectorOrbsScreen(careerList);
  if (_api.sectorLabelsPending && _api.sectorLabelsPending.length) {
    const layout = buildSectorLabelLayout(_api.sectorLabelsPending);
    drawSectorLabelsFromCache(_api.sectorLabelsPending, layout);
  }
  drawSatelliteLabels(_api.satLabelsPending);
}

function zoneAtScreen(mx, my) {
  if (!_api.onetHubActive || !window.FWOnetHub || FWOnetHub.getHubMode() !== 'overview') return null;
  const world = screenToWorld(mx, my);
  // Nearest-with-slack instead of strict containment: a click/hover just
  // outside a cluster's soft glow edge should still count as that cluster —
  // strict bbox hit-testing made clicking feel unresponsive on the organic
  // map where the visual glow extends past the geometric circle.
  if (typeof FWOnetHub.nearestZoneToWorldPoint === 'function') {
    const near = FWOnetHub.nearestZoneToWorldPoint(world.x, world.y);
    if (!near) return null;
    const layout = typeof FWOnetHub.getZoneLayout === 'function' ? FWOnetHub.getZoneLayout() : null;
    const slack = ((layout && layout.worldH) || 2500) * 0.05;
    return near.dist <= slack ? near.zone : null;
  }
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
    const satR = c.aiDerived ? Math.max(3, sectorOrbRadiusPx(false) * SATELLITE_SCALE) : null;
    const hitR = isSector
      ? (satR != null ? satR + 4
        : ((_api.state.hoveredId === c.id || _api.state.selectedId === c.id)
          ? sectorOrbRadiusPx(true) : (_api.sectorHoverRadii[c.id] ?? sectorOrbRadiusPx(false))) + 4)
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
    // Backdrop is keyed to drag-only offsets (bgOffX/Y), not panX/Y — zoom
    // adjusts pan every tick to stay cursor-anchored, and a pan-keyed grid
    // visibly slides during zoom.
    hubCanvas.paintHubCanvasBackground(_api.ctx, W, H, _api.state.bgOffX || 0, _api.state.bgOffY || 0, { forceDark: true });
  } else {
    _api.ctx.fillStyle = getHubCanvasBg();
    _api.ctx.fillRect(0, 0, W, H);
  }

  // Cursor spotlight brighten — restored from the legacy hub. Always on:
  // the canvas is forced dark in both themes.
  if (_api.state.mouseOn && _api.motionOk) {
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
    // One renderer for everything: base orbs AND AI-derived satellites draw
    // in the same pass with one shared label solver, all positioned via
    // careerWorldXY — so render, hit-test, tooltips, and depth badges can
    // never disagree about where (or how many) satellites exist.
    drawSectorLayerScreen(_api.careers);
  }

  // CAM4 — arrival beacon, drawn last so it sits over the orbs. Lives in this
  // dynamic pass (not the cached overview layer), so it repaints every frame
  // and tracks the orb's live screen position through pan/zoom.
  drawMatchHalo(performance.now());

  _api.hideHubBootError();
  // F2: clear needsRedraw for BOTH modes so the loop can park in sector too.
  // Sector liveness (hover springs, gold shimmer, satellite blooms, pointer on
  // canvas) is re-evaluated by the dashboard's continuation gate every frame,
  // and every discrete sector-visible change re-arms via requestHubRedraw.
  if (_api.onetHubActive && window.FWOnetHub) {
    _api.needsRedraw = false;
  }
}

// CAM4 fly-to-match beacon: a single expanding ring + soft glow that fades over
// ~900ms, tinted to the orb's rarity color. The dashboard owns the timer/gating
// (matchHalo state); this only paints the current frame. Reduced motion skips
// it outright via _api.motionOk.
function drawMatchHalo(nowMs) {
  var halo = _api.matchHalo;
  if (!halo || !halo.career || !_api.motionOk || !_api.ctx) return;
  var t = (nowMs - halo.start) / halo.ms;
  if (t < 0) t = 0;
  if (t > 1) return;
  var ease = 1 - Math.pow(1 - t, 3);
  var pos = _api.careerWorldXY(halo.career);
  if (!pos) return;
  var scr = worldToScreen(pos.x, pos.y);
  var fit = halo.career.fitScore != null ? halo.career.fitScore
    : (halo.career.personalityFit != null ? halo.career.personalityFit : 0);
  var glow = rarityOf(fit).glow; // "r,g,b"
  var baseR = sectorOrbRadiusPx(true) + 3;
  var ctx = _api.ctx;
  ctx.save();
  var glowR = baseR + ease * 30;
  var gAlpha = (1 - ease) * 0.28;
  if (gAlpha > 0.002) {
    var rg = ctx.createRadialGradient(scr.x, scr.y, baseR * 0.4, scr.x, scr.y, glowR);
    rg.addColorStop(0, 'rgba(' + glow + ',' + gAlpha.toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(' + glow + ',0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(scr.x, scr.y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(' + glow + ',' + ((1 - ease) * 0.9).toFixed(3) + ')';
  ctx.beginPath();
  ctx.arc(scr.x, scr.y, baseR + ease * 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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
    get satBloomActive() { return _satBloomActive; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
