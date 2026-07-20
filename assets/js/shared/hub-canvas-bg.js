/**
 * Shared Career Hub canvas background — dot grid + theme-aware fill.
 */
(function (global) {
  function readCssVar(name, el) {
    if (!el) return '';
    return getComputedStyle(el).getPropertyValue(name).trim();
  }

  function computeHubCanvasBg() {
    const root = document.documentElement;
    const page = document.getElementById('page-roadmap');
    const fromRoot = readCssVar('--hub-canvas-bg', root);
    if (fromRoot) return fromRoot;
    const fromPage = readCssVar('--hub-canvas-bg', page);
    if (fromPage) return fromPage;
    const bg = readCssVar('--bg', root);
    if (bg) return 'rgb(' + bg + ')';
    return '';
  }

  // Cache the resolved canvas bg so we stop running getComputedStyle every
  // rendered frame (hub + roadmap-tree both paint continuously). Only a real
  // resolved value is cached; a transient empty result falls back without
  // pinning. Theme switches change --hub-canvas-bg / --bg, so drop the cache on
  // flightway-theme-change (dispatched on window by shared/theme.js).
  var _bgCache = '';
  function getHubCanvasBg() {
    if (_bgCache) return _bgCache;
    _bgCache = computeHubCanvasBg();
    return _bgCache || '#080706';
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('flightway-theme-change', function () { _bgCache = ''; });
  }

  function isHubLightTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function titleCaseSkill(skill) {
    return String(skill || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function getRoadmapTreeColors() {
    if (isHubLightTheme()) {
      return {
        labelBg: 'rgba(255, 255, 255, 0.94)',
        labelBgMuted: 'rgba(255, 255, 255, 0.88)',
        labelText: '#1a1512',
        labelTextMuted: '#3e2820',
        labelBorder: 'rgba(62, 40, 28, 0.18)',
        labelBorderMuted: 'rgba(62, 40, 28, 0.12)',
        nodeShell: 'rgba(255, 255, 255, 0.85)',
        nodeStroke: 'rgba(62, 40, 28, 0.35)',
        nodeStrokeHover: 'rgba(62, 40, 28, 0.75)',
        trunkSubtext: 'rgba(62, 40, 28, 0.55)',
        pctText: 'rgba(62, 40, 28, 0.85)',
      };
    }
    return {
      labelBg: 'rgba(10, 9, 8, 0.94)',
      labelBgMuted: 'rgba(10, 9, 8, 0.82)',
      labelText: '#ffffff',
      labelTextMuted: '#eef1f8',
      labelBorder: 'rgba(255, 255, 255, 0.28)',
      labelBorderMuted: 'rgba(255, 255, 255, 0.14)',
      nodeShell: 'rgba(16, 14, 12, 0.72)',
      nodeStroke: 'rgba(255, 255, 255, 0.35)',
      nodeStrokeHover: '#ffffff',
      trunkSubtext: 'rgba(255, 255, 255, 0.5)',
      pctText: 'rgba(255, 255, 255, 0.92)',
    };
  }

  function paintHubCanvasBackground(ctx, w, h, panX, panY, opts) {
    ctx.fillStyle = getHubCanvasBg();
    ctx.fillRect(0, 0, w, h);

    // Dot color must follow the CANVAS darkness, not the page theme: the
    // Career Hub forces a dark canvas in both themes (opts.forceDark), while
    // the roadmap tree keeps its theme-matched canvas.
    var darkCanvas = (opts && opts.forceDark) || !isHubLightTheme();
    ctx.fillStyle = darkCanvas ? 'rgba(255,255,255,0.04)' : 'rgba(62, 40, 28, 0.1)';
    const spacing = 40;
    const offX = ((panX % spacing) + spacing) % spacing;
    const offY = ((panY % spacing) + spacing) % spacing;
    // One path for the whole grid: moveTo the arc start (x+r, y) before each
    // arc so subpaths don't connect, then a single fill(). Identical pixels,
    // one rasterizer pass instead of ~600 beginPath/fill pairs per frame.
    ctx.beginPath();
    for (let x = offX - spacing; x < w + spacing; x += spacing) {
      for (let y = offY - spacing; y < h + spacing; y += spacing) {
        ctx.moveTo(x + 1.5, y);
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  global.FWHubCanvasBg = {
    getHubCanvasBg: getHubCanvasBg,
    isHubLightTheme: isHubLightTheme,
    titleCaseSkill: titleCaseSkill,
    getRoadmapTreeColors: getRoadmapTreeColors,
    paintHubCanvasBackground: paintHubCanvasBackground,
  };
})(typeof window !== 'undefined' ? window : globalThis);
