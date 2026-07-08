/**
 * FlightWay 2.0 — Pillar A3 "Receipts" portal card.
 *
 * "This month" evidence: which O*NET coordinates moved, and a small sparkline of
 * your profile movement over recent weeks. Reads /receipts (which also writes the
 * week's snapshot). Injected like sim-portal-card.js; dimension labels mapped from
 * the registry the dimension viewer already loads.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function afetch(url) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') return FWAuth.authFetch(url, { method: 'GET' });
    return fetch(url, { method: 'GET', credentials: 'include' });
  }

  function loadLabels() {
    if (global.FWOnetDimensionViewer && typeof FWOnetDimensionViewer.loadRegistry === 'function') {
      return FWOnetDimensionViewer.loadRegistry()
        .then(function (reg) { return (reg && reg.dimensions) || []; })
        .catch(function () { return []; });
    }
    return Promise.resolve([]);
  }

  function labelFor(dims, i) {
    var d = dims && dims[i];
    return (d && d.name) ? d.name : ('Dimension ' + i);
  }

  function sparkline(trend) {
    if (!trend || trend.length < 2) return '';
    var w = 200, h = 40, pad = 3;
    var vals = trend.map(function (t) { return Number(t.score) || 0; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = (max - min) || 1;
    var step = (w - pad * 2) / (vals.length - 1);
    var pts = vals.map(function (v, i) {
      var x = pad + i * step;
      var y = h - pad - ((v - min) / span) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="fw-rc-spark" viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">'
      + '<polyline fill="none" stroke="var(--fw2-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + pts + '"/></svg>';
  }

  function render(card, data, dims) {
    if (!data || !data.hasHistory) {
      card.innerHTML = '<div class="fw-rc-head"><h3>Your receipts</h3></div>'
        + '<p class="fw-rc-empty">Your first receipt lands next week — come back to see which coordinates moved and why.</p>';
      return;
    }
    var movers = (data.movers || []).slice(0, 6);
    var rows = movers.map(function (m) {
      var up = m.delta >= 0;
      return '<li class="fw-rc-row">'
        + '<span class="fw-rc-name">' + esc(labelFor(dims, m.index)) + '</span>'
        + '<span class="fw-rc-delta ' + (up ? 'is-up' : 'is-down') + '">' + (up ? '▲ +' : '▼ ') + m.delta + '</span>'
        + '<span class="fw-rc-fromto">' + m.from + ' → ' + m.to + '</span>'
        + '</li>';
    }).join('');
    card.innerHTML = '<div class="fw-rc-head"><h3>Your receipts</h3>'
      + '<span class="fw-rc-window">last ' + (data.weeks ? data.weeks.length : 0) + ' weeks</span></div>'
      + sparkline(data.trend)
      + '<ul class="fw-rc-list">' + rows + '</ul>'
      + '<p class="fw-rc-note">What moved your O*NET coordinates — uploads, sims, and firmed-up answers.</p>';
  }

  function inject() {
    var host = document.getElementById('portal-actions');
    if (!host || document.getElementById('portal-card-receipts')) return;
    var card = document.createElement('div');
    card.id = 'portal-card-receipts';
    card.className = 'fw-receipts-card';
    card.innerHTML = '<div class="fw-rc-head"><h3>Your receipts</h3></div><p class="fw-rc-empty">Loading…</p>';
    host.appendChild(card);
    Promise.all([afetch('/receipts').then(function (r) { return r.json(); }), loadLabels()])
      .then(function (out) {
        render(card, out[0], out[1]);
        try { if (global.FWEvents) FWEvents.log('receipts_view', { movers: (out[0] && out[0].movers || []).length }); } catch (_) {}
      })
      .catch(function () { card.remove(); });
  }

  global.FWReceiptsCard = { inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
