/**
 * FlightWay 2.0 — Pillar C1 "AI-Exposure Score" (deep-dive section).
 *
 * Renders "How AI hits this career": a 0–100 score (percentile across careers),
 * what AI is starting to do, and what stays human — from data/ai-exposure.json
 * (precomputed by scripts/onet-etl/build-ai-exposure.mjs). Every fear stat in the
 * news becomes traffic to a page only we can personalize. Framed as a
 * self-assessment, never a job-loss prediction (see docs/AI_EXPOSURE_METHOD.md).
 */
(function (global) {
  'use strict';

  var URL_DATA = '/data/ai-exposure.json';
  var cache = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function load() {
    if (!cache) {
      cache = fetch(URL_DATA).then(function (r) {
        if (!r.ok) throw new Error('ai-exposure');
        return r.json();
      }).catch(function () { return null; });
    }
    return cache;
  }

  function getExposure(soc, data) {
    var d = data || (cache && cache.__resolved);
    if (!d || !d.careers) return null;
    return d.careers[soc] || null;
  }

  var BAND_LABEL = { low: 'Lower exposure', moderate: 'Moderate exposure', high: 'Higher exposure' };

  function list(items) {
    return '<ul class="fw-ax-list">' + (items || []).map(function (x) {
      return '<li>' + esc(x) + '</li>';
    }).join('') + '</ul>';
  }

  function sectionHtml(ex, score) {
    var band = ex.band || 'moderate';
    return '<div class="fw-ax-card">'
      + '<div class="fw-ax-head">'
      + '<h2>How AI hits this career</h2>'
      + '<span class="fw-ax-badge">AI estimate · self-assessment</span>'
      + '</div>'
      + '<div class="fw-ax-meter" data-band="' + esc(band) + '">'
      + '<div class="fw-ax-meter-top"><span class="fw-ax-score">' + score + '<span class="fw-ax-score-max">/100</span></span>'
      + '<span class="fw-ax-band fw-ax-band--' + esc(band) + '">' + esc(BAND_LABEL[band] || band) + '</span></div>'
      + '<div class="fw-ax-track"><div class="fw-ax-fill" style="width:' + score + '%"></div></div>'
      + '<p class="fw-ax-caption">More AI-exposed than <strong>' + score + '%</strong> of careers we map.</p>'
      + '</div>'
      + '<div class="fw-ax-cols">'
      + '<div class="fw-ax-col fw-ax-col--eats"><h3>What AI is starting to do</h3>' + list(ex.topExposed) + '</div>'
      + '<div class="fw-ax-col fw-ax-col--human"><h3>What stays human</h3>' + list(ex.topDurable) + '</div>'
      + '</div>'
      + '<p class="fw-ax-method">Estimated from this career’s O*NET work activities — a way to plan, not a prediction of your job. '
      + '<a href="docs/AI_EXPOSURE_METHOD.md" target="_blank" rel="noopener">How we estimate this</a>.</p>'
      + '<a class="cta-btn cta-btn-outline fw-ax-cta" href="roadmap.html?aiproof=1">AI-proof my plan — build toward the durable skills &rarr;</a>'
      + '</div>';
  }

  /**
   * Inject the exposure section for `soc`, after `anchorEl` (or into main). Idempotent.
   * Resolves with the rounded 0-100 score (or null) so callers can keep the
   * "AI Exposure" metric tile in sync with this section's number.
   */
  function inject(soc, anchorEl) {
    if (!soc) return Promise.resolve(null);
    return load().then(function (data) {
      if (data) cache.__resolved = data;
      var ex = getExposure(soc, data);
      if (!ex) return null;
      var score = Math.max(0, Math.min(100, Math.round(ex.score)));
      var existing = document.getElementById('career-ai-exposure');
      if (existing) existing.remove();
      var sec = document.createElement('section');
      sec.id = 'career-ai-exposure';
      sec.className = 'fw-ax-section';
      sec.innerHTML = sectionHtml(ex, score);
      var anchor = anchorEl && anchorEl.parentNode ? anchorEl : null;
      if (anchor) anchor.parentNode.insertBefore(sec, anchor.nextSibling);
      else (document.querySelector('main') || document.body).appendChild(sec);
      try { if (global.FWEvents) FWEvents.log('ai_exposure_view', { soc: soc, score: ex.score, band: ex.band }); } catch (_) {}
      return score;
    });
  }

  global.FWAiExposure = { load: load, getExposure: getExposure, inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
