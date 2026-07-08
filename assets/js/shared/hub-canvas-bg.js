/**
 * Shared Career Hub canvas background — dot grid + theme-aware fill.
 */
(function (global) {
  function readCssVar(name, el) {
    if (!el) return '';
    return getComputedStyle(el).getPropertyValue(name).trim();
  }

  function getHubCanvasBg() {
    const root = document.documentElement;
    const page = document.getElementById('page-roadmap');
    const fromRoot = readCssVar('--hub-canvas-bg', root);
    if (fromRoot) return fromRoot;
    const fromPage = readCssVar('--hub-canvas-bg', page);
    if (fromPage) return fromPage;
    const bg = readCssVar('--bg', root);
    if (bg) return 'rgb(' + bg + ')';
    return '#080706';
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

  function paintHubCanvasBackground(ctx, w, h, panX, panY) {
    ctx.fillStyle = getHubCanvasBg();
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = isHubLightTheme() ? 'rgba(62, 40, 28, 0.1)' : 'rgba(255,255,255,0.04)';
    const spacing = 40;
    const offX = ((panX % spacing) + spacing) % spacing;
    const offY = ((panY % spacing) + spacing) % spacing;
    for (let x = offX - spacing; x < w + spacing; x += spacing) {
      for (let y = offY - spacing; y < h + spacing; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  global.FWHubCanvasBg = {
    getHubCanvasBg: getHubCanvasBg,
    isHubLightTheme: isHubLightTheme,
    titleCaseSkill: titleCaseSkill,
    getRoadmapTreeColors: getRoadmapTreeColors,
    paintHubCanvasBackground: paintHubCanvasBackground,
  };
})(typeof window !== 'undefined' ? window : globalThis);
