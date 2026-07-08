/**
 * FlightWay 2.0 — site-wide client telemetry (Pillar 0.2).
 *
 * Generalises the sim event log (fw_sim_events_v1) into a single ring buffer
 * so Leo can read the whole funnel in moderated sessions. No server beacon in
 * v1 — individual-level server logging stays out until it's reconciled with the
 * privacy policy. Load with `defer` on every page; instrument funnel points via
 * FWEvents.log(type, data).
 *
 *   Event shape: { t, at, page, d }   (mirrors the sim {t, at, ..., d} shape)
 *
 * Debug view: append ?fw_debug_events=1 to any page to dump the buffer to a
 * floating panel (wired through flags.js → window.__FW_FLAGS.debugEvents).
 */
(function (global) {
  'use strict';

  var KEY = 'fw_events_v1';
  var MAX = 500;

  function page() {
    try {
      var p = (location.pathname || '/').split('/').pop();
      return p || 'index.html';
    } catch (_) { return 'unknown'; }
  }

  function read() {
    try {
      var arr = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  /**
   * Append one event. `type` is a short funnel label (e.g. 'quiz_complete',
   * 'signup', 'pricing_view', 'pricing_click'); `data` is a small plain object.
   * Never throws — telemetry must never break a page.
   */
  function log(type, data) {
    if (!type) return;
    try {
      var arr = read();
      arr.unshift({
        t: String(type).slice(0, 60),
        at: new Date().toISOString(),
        page: page(),
        d: data != null ? data : null
      });
      localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX)));
    } catch (_) { /* quota / private mode — drop silently */ }
  }

  function all() { return read(); }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  /** Count events by type, optionally since an ISO timestamp. */
  function counts(sinceIso) {
    var out = {};
    read().forEach(function (e) {
      if (sinceIso && e.at < sinceIso) return;
      out[e.t] = (out[e.t] || 0) + 1;
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Floating debug panel for moderated sessions (?fw_debug_events=1). */
  function renderDebugPanel() {
    if (document.getElementById('fw-events-debug')) return;
    var box = document.createElement('div');
    box.id = 'fw-events-debug';
    box.setAttribute('role', 'log');
    box.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:99999',
      'max-width:360px', 'max-height:50vh', 'overflow:auto',
      'background:rgba(12,16,28,0.94)', 'color:#dfe7ff', 'font:11px/1.5 ui-monospace,Menlo,monospace',
      'border:1px solid #2c3e66', 'border-radius:10px', 'padding:10px 12px',
      'box-shadow:0 8px 30px rgba(0,0,0,0.45)'
    ].join(';');
    var rows = read().slice(0, 60).map(function (e) {
      var d = e.d ? ' ' + esc(JSON.stringify(e.d)) : '';
      return '<div><span style="color:#7fd0ff">' + esc(e.t) + '</span>'
        + '<span style="color:#7c88a8"> · ' + esc(e.page) + '</span>' + d + '</div>';
    }).join('') || '<div style="color:#7c88a8">no events yet</div>';
    box.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px">'
      + '<strong style="color:#fff">fw_events_v1 (' + read().length + ')</strong>'
      + '<button type="button" id="fw-events-debug-clear" style="background:none;border:1px solid #2c3e66;color:#dfe7ff;border-radius:6px;cursor:pointer">clear</button>'
      + '</div>' + rows;
    document.body.appendChild(box);
    var btn = document.getElementById('fw-events-debug-clear');
    if (btn) btn.addEventListener('click', function () { clear(); box.remove(); });
  }

  global.FWEvents = { log: log, all: all, counts: counts, clear: clear };

  function maybeDebug() {
    var on = (global.__FW_FLAGS && global.__FW_FLAGS.debugEvents)
      || (location.search.indexOf('fw_debug_events=1') !== -1);
    if (on) renderDebugPanel();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeDebug);
  } else {
    maybeDebug();
  }
})(typeof window !== 'undefined' ? window : globalThis);
