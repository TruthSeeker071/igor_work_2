/**
 * O*NET dimension viewer + vector fit helpers for portal / profile / deep dive surfaces.
 */
(function () {
  var REGISTRY_URL = '/data/onet/dimension-registry-v1.json';
  var TOP_N = 12;

  function loadRegistry() {
    return fetch(REGISTRY_URL).then(function (r) {
      if (!r.ok) throw new Error('registry');
      return r.json();
    });
  }

  function readVectorsFromQuiz() {
    var q = window.FWOnetVectors && FWOnetVectors.readQuizVectors
      ? FWOnetVectors.readQuizVectors()
      : { personality: null, objective: null };
    return q;
  }

  function formatScale100(n, decimals) {
    if (window.FWFormatScale && typeof FWFormatScale.formatScale100 === 'function') {
      return FWFormatScale.formatScale100(n, decimals);
    }
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(decimals != null ? decimals : 1) + '/100';
  }

  function onetLevelToScale100(level) {
    return formatScale100(level, 1);
  }

  function humanizeDomainLabel(domain) {
    if (window.FWFormatScale && typeof FWFormatScale.humanizeOnetDomain === 'function') {
      return FWFormatScale.humanizeOnetDomain(domain);
    }
    return String(domain || '');
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // FW2.0 A2 — confidence tiers -------------------------------------------------
  var CONF_LABEL = { anchored: 'Quiz-anchored', inferred: 'Inferred', estimated: 'Estimated' };

  /** Collapse the vector engine's per-coordinate source tags into 3 display tiers. */
  function confidenceTier(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase();
    if (s === 'quiz-anchored' || s === 'anchored' || s === 'quiz') return 'anchored';
    if (s === '' || s === 'estimated' || s === 'quiz-seed' || s === 'empty') return 'estimated';
    return 'inferred'; // resume-bleed | ai-patch | resume | dossier-inferred | objective
  }

  function dimId(d, i) {
    if (d && d.id != null) return String(d.id);
    if (d && d.index != null) return String(d.index);
    return String(i);
  }

  function confidenceLegendHtml() {
    return '<div class="onet-dim-legend" role="note" aria-label="Confidence legend">'
      + '<span class="onet-dim-legend-item"><span class="onet-conf-dot onet-conf-dot--anchored"></span>Quiz-anchored</span>'
      + '<span class="onet-dim-legend-item"><span class="onet-conf-dot onet-conf-dot--inferred"></span>Inferred</span>'
      + '<span class="onet-dim-legend-item"><span class="onet-conf-dot onet-conf-dot--estimated"></span>Estimated</span>'
      + '</div>';
  }

  function firmUpHtml(estimatedIds) {
    if (!estimatedIds || !estimatedIds.length) return '';
    var href = 'profile-build.html?dims=' + encodeURIComponent(estimatedIds.slice(0, 6).join(','));
    return '<a class="onet-dim-firmup" href="' + href + '">'
      + 'Answer 3 more questions to firm up ' + estimatedIds.length + ' estimated '
      + (estimatedIds.length === 1 ? 'dimension' : 'dimensions') + ' &rarr;</a>';
  }

  function renderDimensionBars(container, personality, registry, targetVec) {
    if (!container || !registry || !personality || !personality.values) return;
    var dims = registry.dimensions || [];
    var conf = Array.isArray(personality.confidence) ? personality.confidence : null;
    var rows = dims.map(function (d, i) {
      return {
        id: dimId(d, i),
        name: d.name,
        user: personality.values[i] || 0,
        target: targetVec ? (targetVec[i] || 0) : null,
        tier: conf ? confidenceTier(conf[i]) : null,
      };
    });
    rows.sort(function (a, b) { return b.user - a.user; });
    var top = rows.slice(0, TOP_N);
    var estimatedIds = top.filter(function (r) { return r.tier === 'estimated'; })
      .map(function (r) { return r.id; });
    var barsHtml = top.map(function (row) {
      var targetHtml = row.target != null
        ? '<span class="onet-dim-target">' + Math.round(row.target) + ' req</span>'
        : '';
      var confAttr = row.tier ? ' data-confidence="' + row.tier + '"' : '';
      var chip = row.tier && row.tier !== 'anchored'
        ? '<span class="onet-conf-chip onet-conf-chip--' + row.tier + '">' + CONF_LABEL[row.tier] + '</span>'
        : '';
      return '<div class="onet-dim-row"' + confAttr + '>'
        + '<div class="onet-dim-label">' + esc(row.name) + chip + targetHtml + '</div>'
        + '<div class="onet-dim-track"><div class="onet-dim-fill" style="width:' + Math.round(row.user) + '%"></div></div>'
        + '<span class="onet-dim-val">' + formatScale100(row.user, 0) + '</span>'
        + '</div>';
    }).join('');
    container.innerHTML = (conf ? confidenceLegendHtml() : '') + barsHtml
      + (conf ? firmUpHtml(estimatedIds) : '');
  }

  function renderUserVsCareerBars(container, comparisons, limit) {
    if (!container || !comparisons || !comparisons.length) return;
    var lim = limit || 8;
    var rows = comparisons.slice(0, lim);
    container.innerHTML = rows.map(function (row) {
      return '<div class="onet-match-row">'
        + '<div class="onet-match-label">'
        + '<span class="onet-match-name">' + esc(row.name) + '</span>'
        + '<span class="onet-match-domain">' + esc(humanizeDomainLabel(row.domain)) + '</span>'
        + '</div>'
        + '<div class="onet-match-bars">'
        + '<div class="onet-match-bar-line">'
        + '<span class="onet-match-bar-tag">You</span>'
        + '<div class="onet-dim-track"><div class="onet-dim-fill onet-dim-fill--user" style="width:' + row.user + '%"></div></div>'
        + '<span class="onet-dim-val">' + formatScale100(row.user, 0) + '</span>'
        + '</div>'
        + '<div class="onet-match-bar-line">'
        + '<span class="onet-match-bar-tag">Role</span>'
        + '<div class="onet-dim-track"><div class="onet-dim-fill onet-dim-fill--role" style="width:' + row.target + '%"></div></div>'
        + '<span class="onet-dim-val">' + formatScale100(row.target, 0) + '</span>'
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function renderDemandBars(container, dimensions) {
    if (!container || !dimensions || !dimensions.length) return;
    container.innerHTML = dimensions.map(function (d) {
      var pct = Math.round(Math.min(100, d.level));
      return '<div class="onet-demand-row">'
        + '<div class="onet-demand-label">'
        + '<span class="onet-demand-name">' + esc(d.name) + '</span>'
        + '<span class="onet-demand-domain">' + esc(humanizeDomainLabel(d.domain)) + '</span>'
        + '</div>'
        + '<div class="onet-dim-track"><div class="onet-dim-fill onet-dim-fill--role" style="width:' + pct + '%"></div></div>'
        + '<span class="onet-dim-val">' + onetLevelToScale100(d.level) + '</span>'
        + '</div>';
    }).join('');
  }

  // "Your strengths" combines personality with background (objective) evidence
  // using the standardized project weighting: 0.75*personality + 0.25*objective
  // per dimension. Blend only when the objective vector is actually populated —
  // mirrors overall fit's null handling so accounts without a resume or
  // academics keep showing their raw quiz personality instead of a scaled-down
  // (0.75x) version.
  function blendStrengthsForDisplay(personality, objective) {
    if (!personality || !personality.values) return personality;
    var objVals = objective && objective.values ? objective.values : null;
    var active = objVals && window.FWOnetVectors
      && typeof FWOnetVectors.isObjectiveVectorActive === 'function'
      && FWOnetVectors.isObjectiveVectorActive(objVals);
    if (!active) return personality;
    var blended = personality.values.map(function (p, i) {
      return Math.round(0.75 * (Number(p) || 0) + 0.25 * (Number(objVals[i]) || 0));
    });
    return Object.assign({}, personality, { values: blended });
  }

  function mountPortalViewer(rootId) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var vecs = readVectorsFromQuiz();
    if (!vecs.personality) {
      root.innerHTML = '<p class="onet-dim-empty">Complete the quiz to see your strengths.</p>';
      return;
    }
    var display = blendStrengthsForDisplay(vecs.personality, vecs.objective);
    loadRegistry().then(function (reg) {
      renderDimensionBars(root, display, reg, null);
    }).catch(function () {
      root.innerHTML = '<p class="onet-dim-empty">Your strengths are unavailable right now.</p>';
    });
  }

  window.FWOnetDimensionViewer = {
    mountPortalViewer: mountPortalViewer,
    renderDimensionBars: renderDimensionBars,
    renderUserVsCareerBars: renderUserVsCareerBars,
    renderDemandBars: renderDemandBars,
    confidenceTier: confidenceTier,
    loadRegistry: loadRegistry,
  };
})();
