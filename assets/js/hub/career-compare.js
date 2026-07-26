/**
 * Career Hub — vector-powered side-by-side career comparison.
 *
 * Overlay comparing two O*NET careers at the coordinate level: shared
 * strengths (both careers weigh a dimension high), biggest divergences,
 * and each career's fit against the user's personality vector vs their
 * objective (skills/academics) vector — same dual-fit distinction the
 * hub panel shows. All math goes through FWOnetMath / FWOnetVectors;
 * no scoring logic is duplicated here.
 */
(function (global) {
  'use strict';

  var HIGH = 70;          // 0–100 O*NET level considered a strength
  var ROW_LIMIT = 6;      // rows per section
  var overlay = null;
  var requestId = 0;
  var state = { a: null, b: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function injectCss() {
    if (document.getElementById('fw-cmp-css')) return;
    var css = ''
      + '.fw-cmp-overlay{position:fixed;inset:0;z-index:1200;background:rgba(8,10,18,.72);display:flex;align-items:center;justify-content:center;padding:18px;}'
      + '.fw-cmp-modal{background:var(--surface-solid);color:inherit;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:720px;width:100%;max-height:88vh;overflow-y:auto;padding:22px 24px;position:relative;}'
      + '.fw-cmp-close{position:absolute;top:10px;right:14px;background:none;border:none;color:inherit;font-size:22px;cursor:pointer;opacity:.7;}'
      + '.fw-cmp-close:hover{opacity:1;}'
      + '.fw-cmp-title{margin:0 0 4px;font-size:19px;}'
      + '.fw-cmp-sub{margin:0 0 14px;font-size:13px;opacity:.75;}'
      + '.fw-cmp-heads{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}'
      + '.fw-cmp-head{border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;}'
      + '.fw-cmp-head-name{font-weight:600;font-size:14px;margin-bottom:6px;}'
      + '.fw-cmp-fitline{font-size:12px;opacity:.85;margin:2px 0;}'
      + '.fw-cmp-search{width:100%;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:inherit;font-size:13px;}'
      + '.fw-cmp-results{margin-top:6px;max-height:150px;overflow-y:auto;}'
      + '.fw-cmp-result{display:block;width:100%;text-align:left;background:none;border:none;color:inherit;padding:6px 8px;font-size:13px;cursor:pointer;border-radius:6px;}'
      + '.fw-cmp-result:hover{background:rgba(255,255,255,.08);}'
      + '.fw-cmp-section{margin:14px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.65;}'
      + '.fw-cmp-row{display:grid;grid-template-columns:minmax(120px,1fr) 70px 70px;gap:10px;align-items:center;font-size:13px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06);}'
      + '.fw-cmp-dim{opacity:.9;}'
      + '.fw-cmp-cell{position:relative;height:16px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;}'
      + '.fw-cmp-cell-fill{position:absolute;inset:0 auto 0 0;border-radius:4px;background:var(--fw2-accent);opacity:.8;}'
      + '.fw-cmp-cell-fill--b{background:#6fa8ff;}'
      + '.fw-cmp-cell-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;}'
      + '.fw-cmp-trade{margin:16px 0 0;padding:11px 13px;border-radius:10px;background:rgba(255,255,255,.06);font-size:13.5px;line-height:1.45;}'
      + '.fw-cmp-loading .fw-cmp-skel{height:14px;border-radius:6px;background:rgba(255,255,255,.1);margin:10px 0;animation:fwCmpPulse 1.2s ease-in-out infinite;}'
      + '.fw-cmp-skel--short{width:60%;}'
      + '@keyframes fwCmpPulse{0%,100%{opacity:.45}50%{opacity:.9}}'
      + '.fw-cmp-error{color:#ff9b9b;font-size:13px;margin:12px 0;}'
      + '.fw-cmp-legend{display:flex;gap:14px;font-size:11px;opacity:.7;margin-top:8px;}'
      + '.fw-cmp-swatch{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px;}';
    var el = document.createElement('style');
    el.id = 'fw-cmp-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function renderLoadingHtml() {
    return '<div class="fw-cmp-loading" aria-busy="true">'
      + '<div class="fw-cmp-skel"></div>'
      + '<div class="fw-cmp-skel fw-cmp-skel--short"></div>'
      + '<div class="fw-cmp-skel"></div>'
      + '</div>';
  }

  function renderErrorHtml() {
    return '<p class="fw-cmp-error">This comparison isn\'t available right now — we couldn\'t load the data. Try again in a moment.</p>';
  }

  // Same shape as portal-target-switch's fetchPortalVectorFit: authenticated
  // server fit when signed in, client-side fallback otherwise.
  function fetchUserFit(soc, careerVec) {
    if (global.FWAuth && FWAuth.authEmail && FWAuth.authEmail()
      && global.FWOnetVectors && typeof FWOnetVectors.fetchAuthenticatedVectorFit === 'function') {
      return FWOnetVectors.fetchAuthenticatedVectorFit(soc).then(function (vf) {
        if (vf && vf.personalityFit != null) return vf;
        return clientFit(careerVec);
      }).catch(function () { return clientFit(careerVec); });
    }
    return Promise.resolve(clientFit(careerVec));
  }

  function clientFit(careerVec) {
    if (!careerVec || !global.FWOnetVectors || !global.FWOnetMath) return null;
    return FWOnetVectors.resolvePersonality({}).then(function (personality) {
      if (!personality) return null;
      var M = global.FWOnetMath;
      var entry = { personalityFit: M.personalityFitPercent(personality.values, careerVec) };
      var objective = FWOnetVectors.readQuizVectors().objective;
      if (objective && objective.values && FWOnetVectors.magnitude(objective.values) > 0.01) {
        entry.objectiveFit = M.objectiveFitPercent(objective.values, careerVec);
      }
      return entry;
    }).catch(function () { return null; });
  }

  function dimName(registry, idx) {
    var dims = (registry && registry.dimensions) || [];
    for (var i = 0; i < dims.length; i++) {
      if (dims[i].index === idx) return dims[i].name;
    }
    return (dims[idx] && dims[idx].name) || ('Dimension ' + idx);
  }

  function rowHtml(name, a, b) {
    function cell(v, cls) {
      var pct = Math.max(0, Math.min(100, Math.round(v || 0)));
      return '<div class="fw-cmp-cell">'
        + '<div class="fw-cmp-cell-fill ' + cls + '" style="width:' + pct + '%"></div>'
        + '<span class="fw-cmp-cell-num">' + pct + '</span></div>';
    }
    return '<div class="fw-cmp-row"><span class="fw-cmp-dim">' + esc(name) + '</span>'
      + cell(a, '') + cell(b, 'fw-cmp-cell-fill--b') + '</div>';
  }

  function tradeoffLine(a, b) {
    var fa = a.fit || {}; var fb = b.fit || {};
    var parts = [];
    if (fa.objectiveFit != null && fb.objectiveFit != null) {
      var closer = fa.objectiveFit >= fb.objectiveFit ? a : b;
      var other = closer === a ? b : a;
      var diff = Math.abs(fa.objectiveFit - fb.objectiveFit);
      parts.push(diff <= 3
        ? 'Based on your current skills and academics, you are about equally close to qualifying for both today.'
        : 'Based on your current skills and academics, you are closer to qualifying for <strong>' + esc(closer.name) + '</strong> today ('
          + closer.fit.objectiveFit + '% vs ' + other.fit.objectiveFit + '% objective fit).');
    }
    if (fa.personalityFit != null && fb.personalityFit != null) {
      var pref = fa.personalityFit >= fb.personalityFit ? a : b;
      var otherP = pref === a ? b : a;
      var pDiff = Math.abs(fa.personalityFit - fb.personalityFit);
      parts.push(pDiff <= 3
        ? 'Long-term, both are similarly strong personality fits.'
        : 'Long-term, <strong>' + esc(pref.name) + '</strong> is the stronger personality fit ('
          + pref.fit.personalityFit + '% vs ' + otherP.fit.personalityFit + '%).');
    }
    if (!parts.length) return '';
    return '<div class="fw-cmp-trade">' + parts.join(' ') + '</div>';
  }

  function headHtml(entry, side) {
    var f = entry.fit || {};
    var lines = '';
    if (f.personalityFit != null) lines += '<p class="fw-cmp-fitline">Personality fit: <strong>' + f.personalityFit + '%</strong></p>';
    if (f.objectiveFit != null) lines += '<p class="fw-cmp-fitline">Objective fit (skills/academics): <strong>' + f.objectiveFit + '%</strong></p>';
    var picker = side === 'b'
      ? '<input type="search" class="fw-cmp-search" id="fw-cmp-search" placeholder="Compare a different career…" autocomplete="off" aria-label="Search careers to compare" />'
        + '<div class="fw-cmp-results" id="fw-cmp-results"></div>'
      : '';
    return '<div class="fw-cmp-head"><div class="fw-cmp-head-name">'
      + '<span class="fw-cmp-swatch" style="background:' + (side === 'a' ? 'var(--fw2-accent)' : '#6fa8ff') + '"></span>'
      + esc(entry.name || entry.soc) + '</div>' + lines + picker + '</div>';
  }

  function compute(registry, vecA, vecB) {
    var len = Math.min(vecA.length, vecB.length);
    var shared = [];
    var diverge = [];
    for (var i = 0; i < len; i++) {
      var a = Number(vecA[i]) || 0;
      var b = Number(vecB[i]) || 0;
      if (a >= HIGH && b >= HIGH) shared.push({ i: i, a: a, b: b, key: Math.min(a, b) });
      diverge.push({ i: i, a: a, b: b, key: Math.abs(a - b) });
    }
    shared.sort(function (x, y) { return y.key - x.key; });
    diverge.sort(function (x, y) { return y.key - x.key; });
    return {
      shared: shared.slice(0, ROW_LIMIT),
      diverge: diverge.slice(0, ROW_LIMIT).filter(function (d) { return d.key >= 8; }),
    };
  }

  function renderResult(box, registry, vectors) {
    var vecA = vectors[state.a.soc];
    var vecB = vectors[state.b.soc];
    if (!vecA || !vecB) { box.innerHTML = renderErrorHtml(); return; }
    var cmp = compute(registry, vecA, vecB);

    var html = '<div class="fw-cmp-heads">' + headHtml(state.a, 'a') + headHtml(state.b, 'b') + '</div>';

    if (cmp.shared.length) {
      html += '<div class="fw-cmp-section">Shared strengths — both careers weigh these high</div>';
      html += cmp.shared.map(function (r) { return rowHtml(dimName(registry, r.i), r.a, r.b); }).join('');
    }
    if (cmp.diverge.length) {
      html += '<div class="fw-cmp-section">Where they diverge most</div>';
      html += cmp.diverge.map(function (r) { return rowHtml(dimName(registry, r.i), r.a, r.b); }).join('');
    }
    html += '<div class="fw-cmp-legend">'
      + '<span><span class="fw-cmp-swatch" style="background:var(--fw2-accent)"></span>' + esc(state.a.name) + '</span>'
      + '<span><span class="fw-cmp-swatch" style="background:#6fa8ff"></span>' + esc(state.b.name) + '</span>'
      + '</div>';
    html += tradeoffLine(state.a, state.b);
    box.innerHTML = html;
    bindSearch(box);
  }

  function bindSearch(box) {
    var input = box.querySelector('#fw-cmp-search');
    var results = box.querySelector('#fw-cmp-results');
    if (!input || !results || !global.FWOnetCatalog) return;
    input.addEventListener('input', function () {
      var q = (input.value || '').trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      FWOnetCatalog.load().then(function () {
        var hits = FWOnetCatalog.searchByTitle(q, 8) || [];
        results.innerHTML = hits.filter(function (h) { return h.soc; }).map(function (h) {
          return '<button type="button" class="fw-cmp-result" data-soc="' + esc(h.soc) + '" data-name="' + esc(h.name) + '">' + esc(h.name) + '</button>';
        }).join('');
      });
    });
    results.addEventListener('click', function (e) {
      var btn = e.target.closest('.fw-cmp-result');
      if (!btn) return;
      state.b = { soc: btn.getAttribute('data-soc'), name: btn.getAttribute('data-name') };
      load();
    });
  }

  function load() {
    var box = overlay.querySelector('#fw-cmp-body');
    if (!state.a || !state.a.soc || !state.b || !state.b.soc) {
      box.innerHTML = renderErrorHtml();
      return;
    }
    var rid = ++requestId;
    box.innerHTML = renderLoadingHtml();
    Promise.all([
      FWOnetVectors.loadDimensionRegistry(),
      FWOnetVectors.fetchVectorsBatched([state.a.soc, state.b.soc]),
    ]).then(function (parts) {
      if (rid !== requestId) return;
      var registry = parts[0];
      var vectors = parts[1] || {};
      if (!registry || !vectors[state.a.soc] || !vectors[state.b.soc]) {
        box.innerHTML = renderErrorHtml();
        return;
      }
      return Promise.all([
        fetchUserFit(state.a.soc, vectors[state.a.soc]),
        fetchUserFit(state.b.soc, vectors[state.b.soc]),
      ]).then(function (fits) {
        if (rid !== requestId) return;
        state.a.fit = fits[0] || {};
        state.b.fit = fits[1] || {};
        renderResult(box, registry, vectors);
      });
    }).catch(function () {
      if (rid !== requestId) return;
      box.innerHTML = renderErrorHtml();
    });
  }

  function ensureOverlay() {
    if (overlay) return;
    injectCss();
    overlay = document.createElement('div');
    overlay.className = 'fw-cmp-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="fw-cmp-modal" role="dialog" aria-modal="true" aria-labelledby="fw-cmp-title">'
      + '<button type="button" class="fw-cmp-close" aria-label="Close">&times;</button>'
      + '<h3 class="fw-cmp-title" id="fw-cmp-title">Compare careers</h3>'
      + '<p class="fw-cmp-sub">Side by side on the strengths each career weighs most — plus how each fits your personality and background.</p>'
      + '<div id="fw-cmp-body"></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.fw-cmp-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) close();
    });
  }

  function currentFocus() {
    try {
      var f = (global.FWAuth && FWAuth.readCareerFocus) ? FWAuth.readCareerFocus() : null;
      if (f && f.soc) return { soc: f.soc, name: f.name || '' };
    } catch (_) {}
    try {
      if (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function') {
        var t = FWCareerTarget.resolveTargetCareer();
        if (t && t.soc) return { soc: t.soc, name: t.name || '' };
      }
    } catch (_) {}
    return null;
  }

  /**
   * Open the comparison. `other` is {soc, name} — usually the career whose
   * panel the user is viewing; side A is the user's current focus career.
   * If no focus exists (or focus === other), the other career becomes A and
   * the user picks B via search.
   */
  function open(other) {
    ensureOverlay();
    var focus = currentFocus();
    if (focus && other && other.soc && focus.soc !== other.soc) {
      state.a = { soc: focus.soc, name: focus.name };
      state.b = { soc: other.soc, name: other.name };
    } else if (other && other.soc) {
      state.a = { soc: other.soc, name: other.name };
      state.b = state.b && state.b.soc && state.b.soc !== other.soc ? state.b : null;
    } else if (focus) {
      state.a = { soc: focus.soc, name: focus.name };
    }
    overlay.hidden = false;
    var box = overlay.querySelector('#fw-cmp-body');
    if (state.a && state.b) {
      load();
    } else if (state.a) {
      box.innerHTML = '<div class="fw-cmp-heads">' + headHtml(state.a, 'a')
        + '<div class="fw-cmp-head"><div class="fw-cmp-head-name">Pick a career to compare</div>'
        + '<input type="search" class="fw-cmp-search" id="fw-cmp-search" placeholder="Search all careers…" autocomplete="off" aria-label="Search careers to compare" />'
        + '<div class="fw-cmp-results" id="fw-cmp-results"></div></div></div>';
      bindSearch(box);
    } else {
      box.innerHTML = '<p class="fw-cmp-error">Take the quiz and set a target career first, then compare careers side by side.</p>';
    }
    try { if (global.FWEvents) FWEvents.log('career_compare_open', { a: state.a && state.a.soc, b: state.b && state.b.soc }); } catch (_) {}
  }

  function close() {
    if (overlay) overlay.hidden = true;
    requestId++;
  }

  global.FWCareerCompare = { open: open, close: close };
})(typeof window !== 'undefined' ? window : globalThis);
