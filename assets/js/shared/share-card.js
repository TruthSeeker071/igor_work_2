/**
 * FlightWay V2 S15 — the shareable career map (plan §5 S15, D4/D14).
 *
 * The card itself is pure client-side canvas, exactly like sim-share.js, and
 * that is deliberate: download and native share work with no account, no
 * database and no migration applied. Only "create a public link" touches the
 * server, and it is the one action with a privacy consequence — so it is the
 * one the user has to press separately, after looking at what they are about to
 * publish.
 *
 * Data in: the top three matches from FWOnetVectors and, optionally, the user's
 * first name. Nothing else about them ever reaches the card. The POST sends SOC
 * codes rather than titles — the server resolves those against the catalog, so a
 * public flightway.ai page can never be made to say arbitrary text.
 */
(function (global) {
  'use strict';

  var W = 1200, H = 630;

  var COL = {
    bg0: '#0b1020', bg1: '#141d38', card: '#0e1730',
    ink: '#f2f6ff', sub: '#aab6d8', accent: '#6ea8ff', accent2: '#8be0c0',
    line: '#26365f'
  };

  /**
   * Tier vocabulary. Mirrors `qzTierFor()` in quiz-app.js so the words on the
   * shared card are the words the user read on their reveal — and reads its
   * thresholds from FWOnetMath.FIT_TIERS, the single source the whole product
   * tiers on. The KEY is what the server is sent; the label is chosen there too
   * (functions/_lib/share.js TIER_LABELS), so the two can never drift into a
   * page rendering text this file invented.
   */
  function tierFor(pct) {
    var T = (global.FWOnetMath && FWOnetMath.FIT_TIERS) || { legendary: 75, epic: 60, rare: 45, uncommon: 30 };
    var p = Number(pct) || 0;
    if (p >= T.legendary) return { key: 'LEGENDARY', label: 'Legendary fit', color: '#f5b301' };
    if (p >= T.epic) return { key: 'EPIC', label: 'Epic match', color: '#a98bff' };
    if (p >= T.rare) return { key: 'GREAT', label: 'Great match', color: '#6ea8ff' };
    if (p >= T.uncommon) return { key: 'SOLID', label: 'Solid match', color: '#8be0c0' };
    return { key: 'EARLY', label: 'Early match', color: '#9AA0AD' };
  }

  function firstName() {
    try {
      var blob = (global.FWUser && typeof FWUser.getBlob === 'function') ? FWUser.getBlob() : null;
      var n = (blob && blob.name ? String(blob.name) : '').trim();
      return n ? n.split(/\s+/)[0].slice(0, 24) : '';
    } catch (_) { return ''; }
  }

  /** The top three matches, from the rank cache when it is warm and a fresh
   *  rank when it is not. Resolves to [] rather than rejecting — a share button
   *  that throws is worse than one that says it has nothing to share yet. */
  function collect() {
    var V = global.FWOnetVectors;
    if (!V) return Promise.resolve([]);
    var cached = typeof V.getCachedOnetRank === 'function' ? V.getCachedOnetRank(3) : null;
    var p = (cached && cached.length)
      ? Promise.resolve(cached)
      : (typeof V.rankOnetCareersFromVectors === 'function'
        ? Promise.resolve(V.rankOnetCareersFromVectors({ limit: 3 })).catch(function () { return null; })
        : Promise.resolve(null));
    return p.then(function (list) {
      return (list || []).slice(0, 3).map(function (e) {
        var pct = Math.round(Number(e && e.score) || 0);
        return { soc: (e && e.soc) || '', name: (e && e.name) || '', score: pct, tier: tierFor(pct) };
      }).filter(function (e) { return e.soc && e.name; });
    });
  }

  // ------------------------------------------------------------------ canvas

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fitText(ctx, text, maxWidth) {
    var s = String(text);
    if (ctx.measureText(s).width <= maxWidth) return s;
    while (s.length > 4 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s + '…';
  }

  function render(payload) {
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    var careers = (payload && payload.careers) || [];
    var name = (payload && payload.firstName) || '';
    var F = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, COL.bg0); g.addColorStop(1, COL.bg1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = COL.card;
    roundRect(ctx, 48, 48, W - 96, H - 96, 28); ctx.fill();
    ctx.strokeStyle = COL.line; ctx.lineWidth = 2; ctx.stroke();

    var padX = 92;
    ctx.fillStyle = COL.accent;
    ctx.font = '700 28px ' + F;
    ctx.fillText('FLIGHTWAY', padX, 122);
    ctx.fillStyle = COL.sub;
    ctx.font = '600 20px ' + F;
    ctx.fillText('CAREER MAP', padX + 196, 122);

    ctx.fillStyle = COL.ink;
    ctx.font = '800 52px ' + F;
    ctx.fillText(fitText(ctx, name ? name + '’s top matches' : 'My top career matches', W - padX * 2), padX, 196);

    ctx.fillStyle = COL.sub;
    ctx.font = '400 22px ' + F;
    ctx.fillText('Scored against real occupation data — every match comes with its reason.', padX, 234);

    // Three 78px rows at 90px pitch, starting at 276, put the last row's bottom
    // edge at y=500 — twelve pixels clear of the footer rule at H-118. At the
    // obvious 288/96 the third row's plate ran straight through that rule.
    var rowY = 276;
    careers.slice(0, 3).forEach(function (c, i) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      roundRect(ctx, padX, rowY - 34, W - padX * 2, 78, 16); ctx.fill();
      ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.stroke();

      ctx.fillStyle = COL.sub;
      ctx.font = '700 26px ' + F;
      ctx.fillText('#' + (i + 1), padX + 26, rowY + 12);

      ctx.fillStyle = COL.ink;
      ctx.font = '700 30px ' + F;
      ctx.fillText(fitText(ctx, c.name, W - padX * 2 - 300), padX + 84, rowY + 4);

      ctx.fillStyle = c.tier.color;
      ctx.font = '600 18px ' + F;
      ctx.fillText(c.tier.label.toUpperCase(), padX + 84, rowY + 30);

      ctx.fillStyle = COL.ink;
      ctx.font = '800 34px ' + F;
      var pct = c.score + '%';
      ctx.fillText(pct, W - padX - 26 - ctx.measureText(pct).width, rowY + 14);

      rowY += 90;
    });

    ctx.fillStyle = COL.line; ctx.fillRect(padX, H - 118, W - padX * 2, 2);
    ctx.fillStyle = COL.sub;
    ctx.font = '500 23px ' + F;
    ctx.fillText('flightway.ai · find your own path in about 90 seconds', padX, H - 76);

    return canvas;
  }

  function toBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
      else resolve(null);
    });
  }

  function fileName(payload) {
    var top = ((payload && payload.careers && payload.careers[0] && payload.careers[0].name) || 'career');
    return 'flightway-' + top.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  }

  function logEvent(name, props) {
    try { if (global.FWEvents) FWEvents.log(name, props || {}); } catch (_) {}
  }

  function download(canvas, payload) {
    return toBlob(canvas).then(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fileName(payload);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      // Reuses the Career Tester's two names on purpose — same two actions,
      // same shared code path. See docs/EVENTS.md (S15).
      logEvent('sim_share_download', { kind: 'career-map' });
    });
  }

  function nativeShare(canvas, payload) {
    return toBlob(canvas).then(function (blob) {
      if (!blob) return download(canvas, payload);
      var file = null;
      try { file = new File([blob], fileName(payload), { type: 'image/png' }); } catch (_) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        logEvent('sim_share_native', { kind: 'career-map' });
        return navigator.share({
          files: [file],
          title: 'My FlightWay career map',
          text: 'My top career matches, with the reasoning behind each one.'
        }).catch(function () { return download(canvas, payload); });
      }
      return download(canvas, payload);
    });
  }

  function canvasToBase64(canvas) {
    try { return canvas.toDataURL('image/png'); } catch (_) { return ''; }
  }

  // ------------------------------------------------------------------- modal

  var modal = null;

  function closeModal() {
    if (!modal) return;
    modal.remove();
    modal = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) { if (e.key === 'Escape') closeModal(); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function copyText(text, btn) {
    var ok = function () {
      var was = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = was; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { btn.textContent = 'Press Ctrl+C'; });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (_) { btn.textContent = 'Press Ctrl+C'; }
    ta.remove();
  }

  function open(surface) {
    if (modal) return;
    modal = el('div', 'fw-share-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Share your career map');

    var box = el('div', 'fw-share-box');
    var close = el('button', 'fw-share-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeModal);

    var head = el('h2', 'fw-share-title', 'Share your career map');
    var lede = el('p', 'fw-share-lede', 'This is exactly what gets shared — your top three matches, your first name if you have one saved, and nothing else.');
    var preview = el('img', 'fw-share-preview');
    preview.alt = 'Preview of your FlightWay career map card';
    var status = el('p', 'fw-share-status');
    status.setAttribute('aria-live', 'polite');
    var row = el('div', 'fw-share-actions');

    box.appendChild(close);
    box.appendChild(head);
    box.appendChild(lede);
    box.appendChild(preview);
    box.appendChild(row);
    box.appendChild(status);
    modal.appendChild(box);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
    document.addEventListener('keydown', onKey);
    close.focus();

    status.textContent = 'Building your card…';
    collect().then(function (careers) {
      if (!careers.length) {
        status.textContent = 'Take the quiz first — there are no matches to put on a card yet.';
        return;
      }
      var payload = { firstName: firstName(), careers: careers };
      var canvas = render(payload);
      preview.src = canvasToBase64(canvas);
      status.textContent = '';

      var dl = el('button', 'fw-sc-btn fw-sc-btn--primary', 'Download PNG');
      dl.type = 'button';
      dl.addEventListener('click', function () { download(canvas, payload); });
      row.appendChild(dl);

      if (navigator.share) {
        var sh = el('button', 'fw-sc-btn', 'Share…');
        sh.type = 'button';
        sh.addEventListener('click', function () { nativeShare(canvas, payload); });
        row.appendChild(sh);
      }

      var link = el('button', 'fw-sc-btn', 'Create a public link');
      link.type = 'button';
      link.addEventListener('click', function () {
        link.disabled = true;
        status.textContent = 'Creating your link…';
        createLink(payload, canvas, surface).then(function (res) {
          if (!res || !res.url) {
            status.textContent = (res && res.error) || 'Could not create a link. Try again in a moment.';
            link.disabled = false;
            return;
          }
          link.remove();
          var out = el('div', 'fw-share-linkbox');
          var url = el('span', 'fw-share-url', res.url);
          var copy = el('button', 'fw-sc-btn', 'Copy link');
          copy.type = 'button';
          copy.addEventListener('click', function () { copyText(res.url, copy); });
          out.appendChild(url); out.appendChild(copy);
          box.insertBefore(out, status);
          status.textContent = 'Anyone with this link can see the card. You can turn it off any time from Home.';
        });
      });
      row.appendChild(link);
    });
  }

  function createLink(payload, canvas, surface) {
    var body = {
      firstName: payload.firstName,
      careers: payload.careers.map(function (c) { return { soc: c.soc, score: c.score, tier: c.tier.key }; }),
      png: canvasToBase64(canvas)
    };
    var req = (global.FWAuth && typeof FWAuth.authFetch === 'function')
      ? FWAuth.authFetch('/share', { method: 'POST', body: body })
      : fetch('/share', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
    return Promise.resolve(req).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) return { error: (data && data.error) || 'Could not create a link.' };
        logEvent('share_created', { surface: surface || 'unknown' });
        return data;
      });
    }).catch(function () {
      return { error: 'Could not reach FlightWay. Try again in a moment.' };
    });
  }

  // ------------------------------------------------------------------- mount

  /** Every host is `<div data-fw-share-host="<surface>">`; the surface string
   *  becomes the `share_created` prop, so the funnel can say WHERE pride
   *  actually converts into distribution. */
  function autoMount(root) {
    var hosts = (root || document).querySelectorAll('[data-fw-share-host]');
    Array.prototype.forEach.call(hosts, function (host) {
      if (host.querySelector('.fw-share-cta')) return;
      var btn = el('button', 'fw-share-cta', 'Share my career map');
      btn.type = 'button';
      btn.addEventListener('click', function () { open(host.getAttribute('data-fw-share-host') || 'unknown'); });
      host.appendChild(btn);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { autoMount(); });
  } else {
    autoMount();
  }

  global.FWShareCard = {
    open: open, render: render, collect: collect, tierFor: tierFor, autoMount: autoMount
  };
})(typeof window !== 'undefined' ? window : globalThis);
