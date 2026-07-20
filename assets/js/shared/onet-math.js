/**
 * Browser O*NET vector math — aligned with functions/_lib/onet/math.js
 */
(function (global) {
  var DIM = 161;

  function clamp100(n) {
    return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  }

  function dot(a, b, len) {
    var dim = len || DIM;
    var sum = 0;
    for (var i = 0; i < dim; i++) sum += (a[i] || 0) * (b[i] || 0);
    return sum;
  }

  function magnitude(vec, len) {
    return Math.sqrt(dot(vec, vec, len));
  }

  function vecMean(vec, len) {
    var dim = len || DIM;
    var s = 0;
    for (var i = 0; i < dim; i++) s += (vec[i] || 0);
    return s / dim;
  }

  // Mean-centered cosine (Pearson correlation). O*NET importance/level vectors
  // are almost all-positive and share a large "generic occupation" common-mode
  // baseline, so RAW cosine between any two occupation-derived vectors sits at
  // ~0.70-0.85 regardless of true fit — the compression that made every score
  // land in the same high band ("everything is gold"). Centering each vector by
  // its own mean strips that shared baseline so the dot product reflects only
  // the discriminating deviations. Returns [-1,1]; cosinePercent clamps <0 to 0.
  // MUST stay identical to functions/_lib/onet/math.js cosine (parity invariant).
  function cosine(a, b, len) {
    var dim = len || DIM;
    var ma = vecMean(a, dim);
    var mb = vecMean(b, dim);
    var dab = 0, na = 0, nb = 0;
    for (var i = 0; i < dim; i++) {
      var da = (a[i] || 0) - ma;
      var db = (b[i] || 0) - mb;
      dab += da * db; na += da * da; nb += db * db;
    }
    if (na <= 0 || nb <= 0) return 0;
    return dab / Math.sqrt(na * nb);
  }

  function cosinePercent(cos) {
    return clamp100(Math.round((Number(cos) || 0) * 100));
  }

  function computeFitPercent(userVec, careerVec, len) {
    return cosinePercent(cosine(userVec, careerVec, len));
  }

  function percentileRank(sortedIndex, n) {
    if (n <= 1) return 50;
    return clamp100(Math.round((sortedIndex / (n - 1)) * 100));
  }

  function blendVectors(vectors, weights) {
    var out = new Array(DIM);
    for (var d = 0; d < DIM; d++) out[d] = 0;
    var wSum = 0;
    for (var i = 0; i < vectors.length; i++) {
      var w = weights[i] || 0;
      wSum += w;
      for (var j = 0; j < DIM; j++) out[j] += (vectors[i][j] || 0) * w;
    }
    if (wSum > 0) {
      for (var k = 0; k < DIM; k++) out[k] /= wSum;
    }
    return out;
  }

  function emptyVector(fill) {
    var v = new Array(DIM);
    var val = fill != null ? fill : 0;
    for (var i = 0; i < DIM; i++) v[i] = val;
    return v;
  }

  function normalizeVector(vec, len) {
    var dim = len || DIM;
    var mag = magnitude(vec, len);
    if (mag < 1e-6) {
      var zero = new Array(dim);
      for (var z = 0; z < dim; z++) zero[z] = 0;
      return zero;
    }
    var out = new Array(dim);
    for (var i = 0; i < dim; i++) out[i] = (vec[i] || 0) / mag;
    return out;
  }

  function objectiveFitPercent(objectiveVec, careerVec, len) {
    return cosinePercent(cosine(normalizeVector(objectiveVec, len), careerVec, len));
  }

  /**
   * FW2.0 A1 — "why this match": per-dimension contribution to a cosine fit.
   * Each dim's product u_i*c_i, divided by |u||c|, is its share of the cosine
   * similarity; summed over all dims it equals the cosine. Returns the top-k
   * contributors sorted by product (desc), each with its share of the total.
   * `labels` (optional) maps dim index → human name (from the ETL registry).
   */
  function fitContributions(userVec, careerVec, k, labels) {
    if (!userVec || !careerVec) return [];
    var len = Math.min(userVec.length, careerVec.length) || DIM;
    var denom = magnitude(userVec, len) * magnitude(careerVec, len);
    var rows = [];
    var total = 0;
    for (var i = 0; i < len; i++) {
      var u = userVec[i] || 0;
      var c = careerVec[i] || 0;
      var product = u * c;
      if (product <= 0) continue;
      total += product;
      rows.push({
        index: i,
        label: labels && labels[i] != null ? labels[i] : null,
        userScore: clamp100(u),
        careerWeight: clamp100(c),
        product: product,
        contribution: denom > 0 ? product / denom : 0,
      });
    }
    rows.sort(function (a, b) { return b.product - a.product; });
    for (var j = 0; j < rows.length; j++) rows[j].share = total > 0 ? rows[j].product / total : 0;
    return rows.slice(0, k && k > 0 ? k : 3);
  }

  // CANONICAL FIT-TIER LADDER — single source of truth for every "how good is
  // this fit" threshold in the app. Calibrated to the mean-centered cosine
  // distribution above (top real matches ~58-66, so mythic is genuinely rare).
  // Consumers: career-target.js fitRarity, hub-canvas.js rarityOf/isGold/isBest,
  // marco.js isGold, quiz-app.js qzTierFor, hub-dashboard.js highFit. If you
  // change these, you change all of them — that's the point (no drift).
  var FIT_TIERS = { mythic: 66, legendary: 56, epic: 46, rare: 34, uncommon: 20 };

  function fitTier(score) {
    var s = Number(score) || 0;
    var tier = s >= FIT_TIERS.mythic ? 'mythic'
      : s >= FIT_TIERS.legendary ? 'legendary'
      : s >= FIT_TIERS.epic ? 'epic'
      : s >= FIT_TIERS.rare ? 'rare'
      : s >= FIT_TIERS.uncommon ? 'uncommon'
      : 'common';
    return { tier: tier, isGold: s >= FIT_TIERS.legendary, isBest: s >= FIT_TIERS.mythic };
  }

  global.FWOnetMath = {
    DIM: DIM,
    clamp100: clamp100,
    dot: dot,
    magnitude: magnitude,
    cosine: cosine,
    FIT_TIERS: FIT_TIERS,
    fitTier: fitTier,
    normalizeVector: normalizeVector,
    cosinePercent: cosinePercent,
    computeFitPercent: computeFitPercent,
    objectiveFitPercent: objectiveFitPercent,
    fitContributions: fitContributions,
    percentileRank: percentileRank,
    blendVectors: blendVectors,
    emptyVector: emptyVector,
  };
})(typeof window !== 'undefined' ? window : globalThis);
