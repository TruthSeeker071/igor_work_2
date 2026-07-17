/**
 * FlightWay 2.0 — Pillar D2 resume builder UI (premium).
 *
 * A portal card opens a panel that turns the student's dossier into resume bullets
 * tuned to their target career's top O*NET dimensions, with copy buttons and a
 * coverage meter ("your bullets cover 7/10 of what this career weighs most").
 * Reads the focused career client-side; the endpoint does the authoritative work.
 * Injected like sim-portal-card.js — no edits to portal.js. Premium-gated via FWEnt.
 */
(function (global) {
  'use strict';

  var state = { soc: null, name: '', busy: false };
  var overlay = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function post(bodyObj) {
    var url = '/resume-builder';
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') return FWAuth.authFetch(url, { method: 'POST', body: bodyObj });
    return fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) });
  }

  function currentFocus() {
    try {
      var q = (global.FWAuth && FWAuth.readLocalQuiz) ? FWAuth.readLocalQuiz() : null;
      var f = q && q.careerFocus;
      if (f && f.soc) return { soc: f.soc, name: f.name || f.title || '' };
    } catch (_) {}
    try {
      if (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function') {
        var t = FWCareerTarget.resolveTargetCareer();
        if (t && t.soc) return { soc: t.soc, name: t.name || '' };
      }
    } catch (_) {}
    return null;
  }

  function setBusy(b, label) {
    state.busy = b;
    var g = overlay && overlay.querySelector('#fw-rb-gen');
    if (g) { g.disabled = b; g.textContent = b ? (label || 'Working…') : 'Generate bullets'; }
  }

  function copyBtn(text) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'fw-rb-copy'; b.textContent = 'Copy';
    b.addEventListener('click', function () {
      var done = function () { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy'; }, 1200); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
        else done();
      } catch (_) { done(); }
    });
    return b;
  }

  function renderResult(data) {
    var box = overlay.querySelector('#fw-rb-result');
    box.innerHTML = '';
    var cov = data.coverage || { covered: 0, total: (data.targetDims || []).length };
    var pct = cov.total ? Math.round((cov.covered / cov.total) * 100) : 0;
    var head = document.createElement('div');
    head.className = 'fw-rb-cover';
    head.innerHTML = '<div class="fw-rb-cover-top"><span>Coverage</span>'
      + '<span class="fw-rb-cover-num">' + cov.covered + '/' + cov.total + ' of what this career weighs most</span></div>'
      + '<div class="fw-rb-cover-track"><div class="fw-rb-cover-fill" style="width:' + pct + '%"></div></div>'
      + ((data.targetDims && data.targetDims.length)
        ? '<div class="fw-rb-dims">' + data.targetDims.map(function (d) { return '<span class="fw-rb-dim">' + esc(d) + '</span>'; }).join('') + '</div>'
        : '');
    box.appendChild(head);

    (data.bullets || []).forEach(function (bl) {
      var row = document.createElement('div');
      row.className = 'fw-rb-bullet';
      row.innerHTML = '<p class="fw-rb-text">' + esc(bl.text) + '</p>'
        + '<div class="fw-rb-meta">'
        + (bl.dims || []).map(function (d) { return '<span class="fw-rb-chip">' + esc(d) + '</span>'; }).join('')
        + '<span class="fw-rb-ev">' + esc(bl.evidence || 'dossier') + '</span></div>';
      row.querySelector('.fw-rb-meta').appendChild(copyBtn(bl.text));
      box.appendChild(row);
    });
    box.hidden = false;
  }

  function showError(msg) {
    var e = overlay.querySelector('#fw-rb-error');
    if (e) { e.textContent = msg || 'Something went wrong — try again.'; e.hidden = false; setTimeout(function () { e.hidden = true; }, 5000); }
  }

  function generate() {
    var focus = currentFocus();
    if (!focus || !focus.soc) { showError('Set a target career on your roadmap first, then build your resume.'); return; }
    state.soc = focus.soc; state.name = focus.name;
    setBusy(true, 'Drafting bullets…');
    overlay.querySelector('#fw-rb-result').hidden = true;
    post({ soc: state.soc, careerName: state.name })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setBusy(false);
        if (!res.ok) { showError(res.d && res.d.error); return; }
        renderResult(res.d);
        try { if (global.FWEvents) FWEvents.log('resume_build', { soc: state.soc, bullets: (res.d.bullets || []).length }); } catch (_) {}
      })
      .catch(function () { setBusy(false); showError(); });
  }

  function buildPanel() {
    overlay = document.createElement('div');
    overlay.className = 'fw-iv-overlay';
    overlay.id = 'fw-rb-overlay';
    overlay.hidden = true;
    var focus = currentFocus();
    var target = focus && focus.name ? esc(focus.name) : 'your target career';
    overlay.innerHTML = ''
      + '<div class="fw-iv-modal" role="dialog" aria-modal="true" aria-labelledby="fw-rb-title">'
      + '<button type="button" class="fw-iv-close" id="fw-rb-close" aria-label="Close">&times;</button>'
      + '<h3 id="fw-rb-title">Resume builder</h3>'
      + '<p class="fw-iv-sub">Bullets from your profile, tuned to <strong>' + target + '</strong> and tagged by the O*NET coordinates it weighs most.</p>'
      + '<div class="fw-rb-body">'
      + '<button type="button" id="fw-rb-gen" class="fw-iv-btn fw-iv-btn--primary">Generate bullets</button>'
      + '<a class="fw-iv-btn" href="resume.html">Open the full builder →</a>'
      + '<div id="fw-rb-result" class="fw-rb-result" hidden></div>'
      + '<p id="fw-rb-error" class="fw-iv-error" hidden></p>'
      + '</div></div>';
    (document.body).appendChild(overlay);
    overlay.querySelector('#fw-rb-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#fw-rb-gen').addEventListener('click', generate);
    if (global.FWEnt && typeof FWEnt.boot === 'function') {
      FWEnt.boot().then(function () { if (!FWEnt.has('premium')) FWEnt.gate(overlay.querySelector('.fw-rb-body'), 'resume-builder'); });
    }
  }

  function open() {
    if (!overlay) buildPanel();
    overlay.hidden = false;
    try { if (global.FWEvents) FWEvents.log('resume_open'); } catch (_) {}
  }
  function close() { if (overlay) overlay.hidden = true; }

  function injectCard() {
    var host = document.getElementById('portal-actions');
    if (!host || document.getElementById('portal-card-resume')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'portal-card-resume';
    btn.className = 'portal-card';
    btn.innerHTML = '<span class="portal-card-icon"><i data-lucide="file-text"></i></span>'
      + '<span class="portal-card-body"><span class="portal-card-label">Build your resume</span>'
      + '<span class="portal-card-desc">Turn your background into bullets tuned to your target career.</span></span>'
      + '<span class="portal-card-arrow" aria-hidden="true">&rarr;</span>';
    btn.addEventListener('click', open);
    host.appendChild(btn);
    try { if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons(); } catch (_) {}
  }

  function inject() { injectCard(); }

  global.FWResumeBuilder = { inject: inject, open: open };
})(typeof window !== 'undefined' ? window : globalThis);
