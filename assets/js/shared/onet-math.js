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

  // ---- Fit chokepoints ----

  // Stamps every stored fit percent (KV rank keys, stretch-fit caches, portal
  // snapshots) so a cache written by one formula can never be served under
  // another. Bump it in BOTH math files whenever a chokepoint's output moves.
  var FIT_MATH_VERSION = 4;

  // THE personality-fit chokepoint. Every personality fit percent in the app,
  // client and server, comes from here; no call site composes
  // cosinePercent(cosine(personality, ...)) itself. Changing how personality fit
  // is scored means changing this function and nothing else.
  //
  // This is the mean-centered cosine, restored 2026-07-21 after the
  // baseline-subtracted ("distinctive") formula shipped and was rejected in use:
  // it separated desk sectors well but compressed almost the whole catalog into
  // single digits, which reads as no answer at all. Plain correlation trades that
  // discrimination for a legible spread — see docs/FIT_MATH.md.
  function personalityFitPercent(userValues, careerVec, len) {
    return cosinePercent(cosine(userValues, careerVec, len));
  }

  // THE display-fit chokepoint. Every fit percent the product SHOWS — sector
  // clouds, career orbs, career pages, quiz results, Marco — is personality fit:
  // how the way you like to work lines up with what a career actually involves.
  //
  // Objective fit (what you have built so far) is deliberately NOT folded in.
  // It was, twice: as a 0.75/0.25 blend, then as one correlation against the
  // summed vector. Both mixed 'would I like this' with 'am I ready for this',
  // which are different questions a user asks at different moments. Objective
  // fit is still computed and still shown — beside personality fit on the career
  // page, and driving preparedness, skill gaps and the stretch panel, which is
  // where 'am I ready' belongs.
  function displayFitPercent(personalityValues, careerVec, len) {
    if (!personalityValues || !personalityValues.length) return null;
    return personalityFitPercent(personalityValues, careerVec, len);
  }
  /**
   * FW2.0 A1 — "why this match": per-dimension contribution to the fit.
   * Each dim's product, divided by |u||c|, is its share of the correlation;
   * summed over all dims it equals the cosine. Returns the top-k contributors
   * sorted by product (desc), each with its share of the total.
   * `labels` (optional) maps dim index → human name (from the ETL registry).
   *
   * Products are taken on the raw levels, matching the plain correlation the
   * displayed percent comes from. The consequence is honest and worth knowing:
   * the top contributors skew toward what ALL work needs (Reading
   * Comprehension, Active Listening, Speaking), because that is what a
   * mean-centered cosine actually scores highest on.
   */
  function fitContributions(userVec, careerVec, k, labels) {
    if (!userVec || !careerVec) return [];
    var len = Math.min(userVec.length, careerVec.length) || DIM;
    var n = len;
    var denom = magnitude(userVec, n) * magnitude(careerVec, n);
    var rows = [];
    var total = 0;
    for (var i = 0; i < n; i++) {
      var d = i;
      var product = (userVec[i] || 0) * (careerVec[i] || 0);
      if (product <= 0) continue;
      total += product;
      rows.push({
        index: d,
        label: labels && labels[d] != null ? labels[d] : null,
        userScore: clamp100(userVec[d] || 0),
        careerWeight: clamp100(careerVec[d] || 0),
        product: product,
        contribution: denom > 0 ? product / denom : 0,
      });
    }
    rows.sort(function (a, b) { return b.product - a.product; });
    for (var j = 0; j < rows.length; j++) rows[j].share = total > 0 ? rows[j].product / total : 0;
    return rows.slice(0, k && k > 0 ? k : 3);
  }

  // ---- Onboarding layer gating ----
  // Onboarding stacks several sources (quiz seed, sharpen, know-you / resume)
  // onto ONE personality vector. Ungated, each source adds positive mass in a
  // slightly different direction, the sum drifts back toward the generic-
  // occupation baseline, and every career ends up scoring the same middling
  // percent. So each source's pending deltas are gated against the vector they
  // land on, and the whole layer is then held to an L1 budget so no single
  // source can out-shout the seed. MUST stay identical to
  // functions/_lib/onet/math.js gateLayerDeltas (client/server parity).
  var LAYER_GAIN_ALIGNED = 1;    // sharpens a direction the vector already has
  var LAYER_GAIN_OPEN = 0.5;     // opens a dim the vector has no opinion on
  var LAYER_GAIN_OPPOSED = 0.25; // fights the direction — new info still moves it, slowly

  // `center` is the vector's neutral point: 50 for personality (an O*NET level
  // profile), 0 for objective (a sparse target vector built up from nothing).
  function gateLayerDeltas(baseValues, pending, budget, center) {
    var c = center == null ? 50 : center;
    var out = new Array(pending.length);
    var total = 0;
    var i;
    for (i = 0; i < pending.length; i++) {
      var delta = Number(pending[i]) || 0;
      if (!delta) { out[i] = 0; continue; }
      var base = Number(baseValues && baseValues[i]) || 0;
      var d = base - c;
      var gain;
      if (base === 0 || d === 0) gain = LAYER_GAIN_OPEN;
      else gain = ((delta > 0) === (d > 0)) ? LAYER_GAIN_ALIGNED : LAYER_GAIN_OPPOSED;
      out[i] = delta * gain;
      total += Math.abs(out[i]);
    }
    if (budget > 0 && total > budget) {
      var k = budget / total;
      for (i = 0; i < out.length; i++) out[i] *= k;
    }
    return out;
  }

  // CANONICAL FIT-TIER LADDER — single source of truth for every "how good is
  // this fit" threshold in the app. Recalibrated 2026-07-21 for the summed-vector
  // correlation (npm run fit:calibrate, six personas x 782 careers, table in
  // docs/FIT_MATH.md). Plain correlation puts a decided profile's whole catalog
  // much higher than the distinctive formula did, so every threshold moved up.
  // KNOWN LIMIT, measured not assumed: one absolute ladder cannot be fair across
  // profiles, because how high a profile scores in absolute terms depends on how
  // typical it is, not how good the match is. Under this ladder a quant-finance
  // profile reads 17% mythic while a trades profile reads 0%. Percentile tiers —
  // "mythic = your own top 2%" — are the real fix and are written up as the
  // follow-up in docs/FIT_MATH.md.
  // Consumers: career-target.js fitRarity, hub-canvas.js rarityOf/isGold/isBest,
  // marco.js isGold, quiz-app.js qzTierFor, hub-dashboard.js highFit. If you
  // change these, you change all of them — that's the point (no drift).
  var FIT_TIERS = { mythic: 85, legendary: 75, epic: 60, rare: 45, uncommon: 30 };

  // The score to colour an entry by when there is genuinely no fit yet — a
  // catalog search hit, a career focus with no rank. It is a display
  // placeholder, NOT a measured fit, and it is named so that recalibrating
  // FIT_TIERS cannot silently promote "we don't know" into a legendary badge.
  // 0 reads "common" under the ladder above; any positive placeholder would
  // inherit a real tier.
  var FIT_NEUTRAL = 0;

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
    LAYER_GAIN_ALIGNED: LAYER_GAIN_ALIGNED,
    LAYER_GAIN_OPEN: LAYER_GAIN_OPEN,
    LAYER_GAIN_OPPOSED: LAYER_GAIN_OPPOSED,
    gateLayerDeltas: gateLayerDeltas,
    FIT_TIERS: FIT_TIERS,
    FIT_NEUTRAL: FIT_NEUTRAL,
    fitTier: fitTier,
    normalizeVector: normalizeVector,
    cosinePercent: cosinePercent,
    computeFitPercent: computeFitPercent,
    FIT_MATH_VERSION: FIT_MATH_VERSION,
    personalityFitPercent: personalityFitPercent,
    displayFitPercent: displayFitPercent,
    objectiveFitPercent: objectiveFitPercent,
    fitContributions: fitContributions,
    percentileRank: percentileRank,
    blendVectors: blendVectors,
    emptyVector: emptyVector,
  };
})(typeof window !== 'undefined' ? window : globalThis);
