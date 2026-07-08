(function () {
  var canvas = document.getElementById('fw-data-field');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var LINK_DIST = 90;
  var CURSOR_RADIUS = 240;
  var FOLLOW = 0.35;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function palette() {
    if (isLight()) {
      return { rgb: '210, 85, 40', scale: 1.35 };
    }
    return { rgb: '210, 85, 40', scale: 1 };
  }

  var w = 0, h = 0, points = [], raf = 0, running = true, t = 0;
  var mouse = { tx: 0, ty: 0, cx: 0, cy: 0 };

  function seed() {
    var count = Math.min(180, Math.round((w * h) / 8000));
    points = [];
    for (var i = 0; i < count; i++) {
      var depth = Math.random();
      points.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        depth: depth,
        r: 0.6 + depth * 0.9,
        pulse: Math.random() * Math.PI * 2,
        bright: i % 11 === 0
      });
    }
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mouse.tx = mouse.cx = w / 2;
    mouse.ty = mouse.cy = h / 2;
    seed();
  }

  function frame() {
    var colors = palette();
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    mouse.cx += (mouse.tx - mouse.cx) * 0.06;
    mouse.cy += (mouse.ty - mouse.cy) * 0.06;
    var ox = (mouse.cx - w / 2) / (w / 2);
    var oy = (mouse.cy - h / 2) / (h / 2);
    var px = new Float32Array(points.length);
    var py = new Float32Array(points.length);

    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!reduced) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }
      var x = p.x + ox * p.depth * 48;
      var y = p.y + oy * p.depth * 48;
      var dx = mouse.cx - x;
      var dy = mouse.cy - y;
      var d = Math.hypot(dx, dy);
      if (d < CURSOR_RADIUS && d > 0.001) {
        var pull = Math.pow(1 - d / CURSOR_RADIUS, 2) * FOLLOW;
        x += dx * pull;
        y += dy * pull;
      }
      px[i] = x;
      py[i] = y;
    }

    for (var a = 0; a < points.length; a++) {
      for (var b = a + 1; b < points.length; b++) {
        var ldx = px[a] - px[b];
        var ldy = py[a] - py[b];
        var d2 = ldx * ldx + ldy * ldy;
        if (d2 < LINK_DIST * LINK_DIST) {
          var alpha = (1 - Math.sqrt(d2) / LINK_DIST) * (isLight() ? 0.28 : 0.1) * colors.scale;
          ctx.strokeStyle = 'rgba(' + colors.rgb + ', ' + alpha + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px[a], py[a]);
          ctx.lineTo(px[b], py[b]);
          ctx.stroke();
        }
      }
    }

    for (var j = 0; j < points.length; j++) {
      var pt = points[j];
      var breath = 0.75 + 0.25 * Math.sin(t * 0.8 + pt.pulse);
      var alpha = (pt.bright ? 0.85 : 0.22 + 0.3 * pt.depth) * breath * colors.scale;
      if (isLight()) alpha *= 0.9;
      ctx.fillStyle = 'rgba(' + colors.rgb + ', ' + alpha + ')';
      ctx.beginPath();
      ctx.arc(px[j], py[j], pt.bright ? pt.r + 0.8 : pt.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!reduced && running) raf = requestAnimationFrame(frame);
  }

  function onMove(e) {
    mouse.tx = e.clientX;
    mouse.ty = e.clientY;
  }

  function onVisibility() {
    running = document.visibilityState === 'visible';
    if (running && !reduced) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
  }

  resize();
  if (reduced) frame();
  else {
    raf = requestAnimationFrame(frame);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('flightway-theme-change', function () {
    canvas.style.opacity = getComputedStyle(document.documentElement).getPropertyValue('--canvas-opacity') || '1';
    if (!reduced && running) frame();
  });
  canvas.style.opacity = getComputedStyle(document.documentElement).getPropertyValue('--canvas-opacity') || '1';
})();
