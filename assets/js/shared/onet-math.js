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

  function cosine(a, b, len) {
    var ma = magnitude(a, len);
    var mb = magnitude(b, len);
    if (!ma || !mb) return 0;
    return dot(a, b, len) / (ma * mb);
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

  global.FWOnetMath = {
    DIM: DIM,
    clamp100: clamp100,
    dot: dot,
    magnitude: magnitude,
    cosine: cosine,
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
