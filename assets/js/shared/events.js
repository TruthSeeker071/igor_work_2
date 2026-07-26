/**
 * FlightWay — site-wide telemetry (V2 S1: local ring buffer + server beacon).
 *
 * v1 was localStorage-only, which meant the product could be watched in a
 * moderated session and nowhere else. v2 keeps that ring buffer EXACTLY as it
 * was — same key, same shape, same debug panel — and adds a batching beacon to
 * `POST /events` (D19: self-hosted, no vendors, no cookies, no cross-site ids).
 *
 * The public API is unchanged and source-compatible with all 22 pre-S1 call
 * sites: FWEvents.log(type, data). Nothing that called it needs to change.
 *
 *   Local shape:  { t, at, page, d }        (unchanged — feature-intro.js reads it)
 *   Wire shape:   { anon, path, attr, events: [ { n, p, path } ] }
 *
 * Identity, deliberately minimal:
 *   fw_anon_v1     a random uuid for THIS BROWSER. Not a person, not a cookie,
 *                  never sent anywhere but our own origin.
 *   fw_anon_sess_v1  {id,last} — a new session after a 30-minute gap.
 *   fw_attr_v1     FIRST-touch utm/ref, written once and never overwritten, so
 *                  a signup can be attributed to the channel that found the
 *                  user rather than the last page they happened to reload.
 *   fw_evq_v1      the durable send queue, so a navigation mid-batch does not
 *                  lose the events that were waiting.
 *
 * Privacy rules that are enforced here rather than hoped for:
 *   - navigator.doNotTrack === '1' → the beacon is never armed at all. The
 *     local ring buffer keeps working so debugging still works.
 *   - The server can switch everything off with one env var; events.js reads
 *     `analyticsEnabled` from /config and drops the queue when it is false.
 *   - Props are shape, never identity. The server scrubs again (functions/
 *     _lib/events.js) — this is defence in depth, not delegation.
 *
 * Timestamps: the SERVER stamps ts. Client clocks are wrong often enough to
 * ruin a funnel, and the cost is that a queued event is dated at flush time
 * (≤15s late in practice). Queue entries older than 6h are dropped on boot
 * rather than landing with a badly wrong date.
 *
 * Debug view: append ?fw_debug_events=1 to any page (via flags.js →
 * window.__FW_FLAGS.debugEvents).
 */
(function (global) {
  'use strict';

  var KEY = 'fw_events_v1';
  var MAX = 500;

  var ANON_KEY = 'fw_anon_v1';
  var SESS_KEY = 'fw_anon_sess_v1';
  var ATTR_KEY = 'fw_attr_v1';
  var QUEUE_KEY = 'fw_evq_v1';

  var ENDPOINT = '/events';
  var FLUSH_MS = 15000;
  var MAX_BATCH = 20;          // matches MAX_BATCH in functions/_lib/events.js
  var MAX_PROPS_BYTES = 1024;  // matches MAX_PROPS_BYTES  (server drops beyond)
  var MAX_SEND_BYTES = 7500;   // headroom under the server's 8KB MAX_BODY_BYTES
  var ENVELOPE_BYTES = 320;    // anon + path + attr, budgeted generously
  var MAX_QUEUE = 200;
  var MAX_SENDS_PER_FLUSH = 5;
  var SESSION_GAP_MS = 30 * 60 * 1000;
  var STALE_QUEUE_MS = 6 * 60 * 60 * 1000;

  var queue = [];
  var timer = null;
  var armed = false;           // beacon armed (false under Do Not Track)
  var killed = false;          // /config said analyticsEnabled: false
  var configAsked = false;
  var booted = false;

  // ---------------------------------------------------------------- storage

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (_) { return false; }
  }
  function lsJson(k, fallback) {
    try {
      var raw = localStorage.getItem(k);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }

  function page() {
    try {
      var p = (location.pathname || '/').split('/').pop();
      return p || 'index.html';
    } catch (_) { return 'unknown'; }
  }

  /** Path only — a query string is where a token or an email ends up. */
  function pathOnly() {
    try { return location.pathname || '/'; } catch (_) { return '/'; }
  }

  function read() {
    var arr = lsJson(KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  // --------------------------------------------------------------- identity

  function uuid() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return global.crypto.randomUUID();
      }
      if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
        var b = new Uint8Array(16);
        global.crypto.getRandomValues(b);
        var out = '';
        for (var i = 0; i < b.length; i++) out += ('0' + b[i].toString(16)).slice(-2);
        return out;
      }
    } catch (_) { /* fall through */ }
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function anonId() {
    var id = lsGet(ANON_KEY);
    if (id && id.length >= 8) return id;
    id = uuid();
    lsSet(ANON_KEY, id);
    return id;
  }

  /** Do Not Track. Checked once per page; if set, the beacon is never armed. */
  function dnt() {
    try {
      var nav = global.navigator || {};
      return nav.doNotTrack === '1' || nav.doNotTrack === 'yes'
        || global.doNotTrack === '1' || nav.msDoNotTrack === '1';
    } catch (_) { return false; }
  }

  /**
   * 30-minute inactivity gap = a new session. Returns true when THIS call
   * opened one, which is what session_start is emitted from.
   */
  function touchSession() {
    var now = Date.now();
    var s = lsJson(SESS_KEY, null);
    var fresh = !s || !s.id || typeof s.last !== 'number' || (now - s.last) > SESSION_GAP_MS;
    lsSet(SESS_KEY, JSON.stringify({ id: fresh ? uuid() : s.id, last: now }));
    return fresh;
  }

  /**
   * FIRST-touch attribution, written once. The whole point is that the LAST
   * page a user reloaded must not be able to overwrite the LinkedIn post that
   * actually found them — so this never updates an existing record.
   */
  function attribution() {
    var stored = lsJson(ATTR_KEY, null);
    if (stored && typeof stored === 'object') return stored;
    var rec = { ref: null, utm_source: null, utm_medium: null, utm_campaign: null, at: new Date().toISOString() };
    try {
      var q = new URLSearchParams(location.search || '');
      rec.utm_source = q.get('utm_source') || null;
      rec.utm_medium = q.get('utm_medium') || null;
      rec.utm_campaign = q.get('utm_campaign') || null;
      var r = document.referrer || '';
      if (r) {
        var host = '';
        try { host = new URL(r).hostname; } catch (_) { host = ''; }
        if (host && host !== location.hostname) rec.ref = host;
      }
    } catch (_) { /* keep the nulls — a direct visit is a real answer */ }
    lsSet(ATTR_KEY, JSON.stringify(rec));
    return rec;
  }

  // ------------------------------------------------------------------ queue

  function loadQueue() {
    var arr = lsJson(QUEUE_KEY, []);
    if (!Array.isArray(arr)) return [];
    var cutoff = Date.now() - STALE_QUEUE_MS;
    return arr.filter(function (e) {
      return e && typeof e.n === 'string' && typeof e.qat === 'number' && e.qat >= cutoff;
    }).slice(-MAX_QUEUE);
  }

  function saveQueue() {
    if (!queue.length) { try { localStorage.removeItem(QUEUE_KEY); } catch (_) {} return; }
    lsSet(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  }

  /**
   * Props the server would refuse are dropped HERE rather than carried across
   * the wire, because the body cap is per-BATCH: one caller passing a fat
   * object would otherwise push the whole batch past 8KB and take 19 good
   * events down with it. `_big` keeps the event itself, which is the part that
   * matters — the count is the signal, the payload is the detail.
   */
  function clampProps(data) {
    if (data == null) return null;
    try {
      var json = JSON.stringify(data);
      if (json && json.length <= MAX_PROPS_BYTES) return data;
    } catch (_) { /* circular or unserializable */ }
    return { _big: 1 };
  }

  function enqueue(name, data) {
    if (killed) return;
    queue.push({ n: name, p: clampProps(data), path: pathOnly(), qat: Date.now() });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    saveQueue();
    if (queue.length >= MAX_BATCH) flush(false);
    else armTimer();
  }

  function armTimer() {
    if (timer || !queue.length) return;
    try {
      timer = global.setTimeout(function () { timer = null; flush(false); }, FLUSH_MS);
    } catch (_) { timer = null; }
  }

  function bodyFor(batch) {
    return JSON.stringify({
      anon: anonId(),
      path: pathOnly(),
      attr: attribution(),
      events: batch.map(function (e) { return { n: e.n, p: e.p, path: e.path }; }),
    });
  }

  /**
   * Send one batch. `beacon` is true on the pagehide path, where a fetch would
   * be cancelled by the navigation — sendBeacon is the only transport the
   * browser promises to finish. text/plain keeps it CORS-safelisted so the
   * beacon never needs a preflight it cannot perform.
   */
  function send(batch, beacon) {
    var body = bodyFor(batch);
    try {
      if (beacon && global.navigator && typeof global.navigator.sendBeacon === 'function') {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        return global.navigator.sendBeacon(ENDPOINT, blob);
      }
    } catch (_) { /* fall through to fetch */ }
    try {
      if (typeof global.fetch !== 'function') return false;
      global.fetch(ENDPOINT, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        credentials: 'same-origin',
        keepalive: true,
        cache: 'no-store',
      }).catch(function () { /* telemetry never surfaces an error */ });
      return true;
    } catch (_) { return false; }
  }

  /**
   * Drain the queue. Events are removed BEFORE the send resolves: a beacon
   * gives no result to wait for, and retrying forever would let one bad batch
   * grow without bound. Losing an event is strictly better than a page that
   * accumulates megabytes of localStorage.
   */
  /**
   * Take as many queued events as fit under the server's body cap. Slicing by
   * COUNT alone is not enough — 20 events with real props can clear 8KB, and
   * the server's rejection is all-or-nothing, so a size-blind batch loses every
   * event in it. Always takes at least one so an oversized single event cannot
   * wedge the queue forever.
   */
  function takeBatch() {
    var batch = [];
    var size = ENVELOPE_BYTES;
    for (var i = 0; i < queue.length && batch.length < MAX_BATCH; i++) {
      var one = 1;
      try { one += JSON.stringify({ n: queue[i].n, p: queue[i].p, path: queue[i].path }).length; } catch (_) { one += 80; }
      if (batch.length && size + one > MAX_SEND_BYTES) break;
      size += one;
      batch.push(queue[i]);
    }
    return batch;
  }

  function flush(beacon) {
    if (timer) { try { global.clearTimeout(timer); } catch (_) {} timer = null; }
    if (killed || !armed || !queue.length) return;
    var sends = 0;
    while (queue.length && sends < MAX_SENDS_PER_FLUSH) {
      var batch = takeBatch();
      var ok = send(batch, !!beacon);
      if (!ok) break;                 // transport refused — keep them for later
      queue = queue.slice(batch.length);
      sends++;
    }
    saveQueue();
    armTimer();
  }

  // ----------------------------------------------------------- kill switch

  /**
   * Read `analyticsEnabled` off /config. Deferred to idle so the beacon never
   * competes with the page's own first requests, and it reuses a config that
   * another module (entitlements.js, billing.js) already fetched when one is
   * published on window.__FW_CONFIG. Fails OPEN — the server defaults to
   * enabled too, so a /config outage does not silently blind the product.
   */
  function askConfig() {
    if (configAsked) return;
    configAsked = true;
    var apply = function (cfg) {
      if (cfg && cfg.analyticsEnabled === false) {
        killed = true;
        queue = [];
        saveQueue();
      }
    };
    var run = function () {
      if (global.__FW_CONFIG) { apply(global.__FW_CONFIG); return; }
      if (typeof global.fetch !== 'function') return;
      global.fetch('/config', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (cfg) { global.__FW_CONFIG = cfg || {}; apply(cfg); })
        .catch(function () { /* fail open */ });
    };
    try {
      if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(run, { timeout: 2000 });
      else global.setTimeout(run, 1200);
    } catch (_) { run(); }
  }

  // -------------------------------------------------------------- public API

  /**
   * Append one event. `type` is a short funnel label (e.g. 'quiz_complete',
   * 'page_view'); `data` is a small plain object of SHAPE, never identity —
   * ids, counts, enums, booleans. Never throws: telemetry must never break a
   * page, which is why every branch below is inside a try.
   */
  function log(type, data) {
    if (!type) return;
    var name = String(type).slice(0, 60);
    try {
      var arr = read();
      arr.unshift({ t: name, at: new Date().toISOString(), page: page(), d: data != null ? data : null });
      lsSet(KEY, JSON.stringify(arr.slice(0, MAX)));
    } catch (_) { /* quota / private mode — the local mirror is best-effort */ }
    try {
      if (!armed) return;
      askConfig();
      enqueue(name, data != null ? data : null);
    } catch (_) { /* the beacon is never allowed to throw at a call site */ }
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
      + '<span style="color:#7c88a8">' + (armed ? (killed ? 'beacon off' : 'beacon on') : 'DNT') + '</span>'
      + '<button type="button" id="fw-events-debug-clear" style="background:none;border:1px solid #2c3e66;color:#dfe7ff;border-radius:6px;cursor:pointer">clear</button>'
      + '</div>' + rows;
    document.body.appendChild(box);
    var btn = document.getElementById('fw-events-debug-clear');
    if (btn) btn.addEventListener('click', function () { clear(); box.remove(); });
  }

  global.FWEvents = {
    log: log,
    all: all,
    counts: counts,
    clear: clear,
    // S1 additions — used by the beacon itself and available for debugging.
    flush: function () { flush(false); },
    anonId: anonId,
    attribution: attribution,
    queued: function () { return queue.length; },
    enabled: function () { return armed && !killed; },
  };

  // ------------------------------------------------------------------- boot

  /**
   * Arms at PARSE time, not on DOMContentLoaded. events.js is deferred, and so
   * is every module that calls it — deferred scripts all run before
   * DOMContentLoaded, so waiting for that event would silently drop the beacon
   * for anything logged during another module's initialization while still
   * writing it to the local ring. That failure is invisible from both ends.
   * Only the debug panel waits, because it needs document.body.
   */
  function boot() {
    if (booted) return;
    booted = true;
    armed = !dnt();
    if (armed) {
      queue = loadQueue();
      try {
        global.addEventListener('pagehide', function () { flush(true); });
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') flush(true);
        });
      } catch (_) { /* no lifecycle events — the interval flush still runs */ }
    }

    // Order matters: session_start before page_view, so a funnel query that
    // walks a session in insertion order sees the session open first.
    try { if (armed && touchSession()) log('session_start', null); } catch (_) {}
    log('page_view', null);
  }

  function maybeDebug() {
    var on = (global.__FW_FLAGS && global.__FW_FLAGS.debugEvents)
      || (location.search.indexOf('fw_debug_events=1') !== -1);
    if (on) renderDebugPanel();
  }

  boot();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeDebug);
  } else {
    maybeDebug();
  }
})(typeof window !== 'undefined' ? window : globalThis);
