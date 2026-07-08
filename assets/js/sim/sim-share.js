/**
 * FlightWay 2.0 — Pillar C2 "Sim → signal".
 *
 * Renders a shareable 1200×630 card from a completed Career Tester trial
 * ("I spent a day as a forensic accountant — here's what clicked"), aimed at the
 * TikTok/IG surface where the demo lives. Pure client-side canvas: no backend,
 * no PII beyond an optional first name (omitted by default). Download or Web Share.
 *
 * Trial shape comes from sim-engine.js S.lastTrial:
 *   { simTitle, tier, predicted, experienced, gap, energizers[], ... }
 */
(function (global) {
  'use strict';

  var W = 1200, H = 630;
  var TIER_LABEL = { taxi: 'a 2-minute look at', flight: 'a 10-minute test flight as', deep: 'a 25-minute deep dive as' };

  var COL = {
    bg0: '#0b1020', bg1: '#141d38', card: '#0e1730',
    ink: '#f2f6ff', sub: '#aab6d8', accent: '#6ea8ff', accent2: '#8be0c0',
    line: '#26365f'
  };

  function firstStringy(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      var keys = ['text', 'label', 'title', 'prompt', 'name', 'moment'];
      for (var i = 0; i < keys.length; i++) if (typeof v[keys[i]] === 'string') return v[keys[i]];
    }
    return '';
  }

  function energizerLine(trial) {
    var list = trial && trial.energizers;
    if (!Array.isArray(list) || !list.length) return '';
    var s = firstStringy(list[0]).trim();
    if (s.length > 90) s = s.slice(0, 87).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrap(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function render(trial, opts) {
    opts = opts || {};
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // background
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, COL.bg0); g.addColorStop(1, COL.bg1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // inner card
    ctx.fillStyle = COL.card;
    roundRect(ctx, 48, 48, W - 96, H - 96, 28); ctx.fill();
    ctx.strokeStyle = COL.line; ctx.lineWidth = 2; ctx.stroke();

    var padX = 92;

    // wordmark + eyebrow
    ctx.fillStyle = COL.accent;
    ctx.font = '700 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('FLIGHTWAY', padX, 132);
    ctx.fillStyle = COL.sub;
    ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('CAREER TEST FLIGHT', padX + 210, 132);

    // headline
    var tier = TIER_LABEL[trial && trial.tier] || 'a day as';
    var career = firstStringy(trial && trial.simTitle) || 'this career';
    var name = opts.firstName ? String(opts.firstName).trim() : '';
    var head = (name ? name + ' spent ' : 'I spent ') + tier + ' ' + career + '.';
    ctx.fillStyle = COL.ink;
    ctx.font = '800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    var lines = wrap(ctx, head, W - padX * 2 - 20).slice(0, 3);
    var y = 236;
    lines.forEach(function (ln) { ctx.fillText(ln, padX, y); y += 76; });

    // energizer
    var ez = energizerLine(trial);
    if (ez) {
      ctx.fillStyle = COL.accent2;
      ctx.font = '600 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillText('What clicked', padX, y + 6);
      ctx.fillStyle = COL.ink;
      ctx.font = '400 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      var ezLines = wrap(ctx, '“' + ez + '”', W - padX * 2 - 20).slice(0, 2);
      var ey = y + 46;
      ezLines.forEach(function (ln) { ctx.fillText(ln, padX, ey); ey += 40; });
      y = ey;
    }

    // expected vs felt chip
    var p = Number(trial && trial.predicted);
    var e = Number(trial && trial.experienced);
    if (Number.isFinite(p) && Number.isFinite(e)) {
      var chipY = H - 150;
      ctx.fillStyle = COL.sub;
      ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillText('Expected ' + p + '  →  Felt ' + e, padX, chipY);
      var delta = e - p;
      ctx.fillStyle = delta >= 0 ? COL.accent2 : COL.accent;
      ctx.fillText((delta >= 0 ? '  +' : '  ') + delta + ' surprise', padX + ctx.measureText('Expected ' + p + '  →  Felt ' + e).width, chipY);
    }

    // footer
    ctx.fillStyle = COL.line; ctx.fillRect(padX, H - 118, W - padX * 2, 2);
    ctx.fillStyle = COL.sub;
    ctx.font = '500 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('flightway.ai · test-drive a career before you commit years to it', padX, H - 76);

    return canvas;
  }

  function toBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
      else resolve(null);
    });
  }

  function filename(trial) {
    var t = firstStringy(trial && trial.simTitle) || 'career';
    return 'flightway-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  }

  function download(trial, opts) {
    var canvas = render(trial, opts);
    return toBlob(canvas).then(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename(trial);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      if (global.FWEvents) FWEvents.log('sim_share_download', { tier: trial && trial.tier });
    });
  }

  function share(trial, opts) {
    var canvas = render(trial, opts);
    return toBlob(canvas).then(function (blob) {
      if (!blob) return download(trial, opts);
      var file = null;
      try { file = new File([blob], filename(trial), { type: 'image/png' }); } catch (_) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        if (global.FWEvents) FWEvents.log('sim_share_native', { tier: trial && trial.tier });
        return navigator.share({
          files: [file],
          title: 'My FlightWay test flight',
          text: 'I test-drove a career on FlightWay.'
        }).catch(function () { return download(trial, opts); });
      }
      return download(trial, opts);
    });
  }

  /** Append a share button into a container (used by the sim debrief + Mirror hooks). */
  function injectButton(container, trial, opts) {
    if (!container || !trial) return;
    if (container.querySelector('.fw-share-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fw-share-btn';
    btn.textContent = 'Share your card';
    btn.addEventListener('click', function () { share(trial, opts); });
    container.appendChild(btn);
    return btn;
  }

  global.FWSimShare = {
    render: render, download: download, share: share, injectButton: injectButton
  };
})(typeof window !== 'undefined' ? window : globalThis);
