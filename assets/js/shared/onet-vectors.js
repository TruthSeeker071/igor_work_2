(function () {
  var M = window.FWOnetMath || {};
  var DIM = M.DIM || 161;
  var SCHEMA = 'onet-lv-161-v1';
  var ZONE_CENTROIDS_URL = '/data/onet/artifacts/zone-centroids.json';
  var MAX_SOC_BATCH = 40;

  var rankedCache = null;
  var rankedOnetCache = null;
  var rankedOnetPromise = null;
  var rankedOnetCacheVersion = 0;
  var rankedFeaturedPromise = null;
  // After a failed rank build (vector endpoint down), don't retry for a
  // window — every portal render re-requests the rank, and without this a
  // backend outage turns each open tab into an unbounded fetch loop.
  var rankBuildFailedAt = 0;
  var RANK_FAIL_COOLDOWN_MS = 30000;
  var vectorImportanceCache = {};
  var dimensionRegistryCache = null;
  var dimensionRegistryPromise = null;

  var REGISTRY_URL = '/data/onet/dimension-registry-v1.json';

  function hashString(str) {
    var s = String(str || '');
    var hash = 5381;
    for (var i = 0; i < s.length; i++) {
      hash = ((hash << 5) + hash) + s.charCodeAt(i);
      hash &= hash;
    }
    return (hash >>> 0).toString(36);
  }

  function vectorInputsHash(quiz) {
    if (!quiz || typeof quiz !== 'object') return '';
    var p = (quiz.personalityVector && quiz.personalityVector.updatedAt) || '';
    var o = (quiz.objectiveVector && quiz.objectiveVector.updatedAt) || '';
    var schema = quiz.vectorSchemaId || SCHEMA;
    var refine = quiz.refine ? JSON.stringify(quiz.refine) : '';
    var academics = quiz.academics ? JSON.stringify(quiz.academics) : '';
    return hashString(schema + '|' + p + '|' + o + '|' + refine + '|' + academics);
  }

  function loadDimensionRegistry() {
    if (dimensionRegistryCache) return Promise.resolve(dimensionRegistryCache);
    if (dimensionRegistryPromise) return dimensionRegistryPromise;
    dimensionRegistryPromise = fetch(REGISTRY_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('registry');
        return r.json();
      })
      .then(function (data) {
        dimensionRegistryCache = data;
        return data;
      })
      .catch(function (err) {
        console.warn('[FWOnetVectors] loadDimensionRegistry failed', err);
        dimensionRegistryPromise = null;
        return null;
      });
    return dimensionRegistryPromise;
  }

  function dimByIndex(registry, index) {
    var dims = (registry && registry.dimensions) || [];
    for (var i = 0; i < dims.length; i++) {
      if (dims[i].index === index) return dims[i];
    }
    return dims[index] || null;
  }

  function formatGapList(topGaps, registry, limit) {
    if (!topGaps || !topGaps.length) return { gaps: [], labels: [] };
    var lim = limit || 5;
    var out = [];
    var labels = [];
    for (var i = 0; i < topGaps.length && out.length < lim; i++) {
      var g = topGaps[i];
      var idx = g.index;
      var dim = registry ? dimByIndex(registry, idx) : null;
      var name = dim ? dim.name : ('Dimension ' + idx);
      var domain = dim ? dim.domain : 'unknown';
      out.push({ index: idx, gap: g.gap, name: name, domain: domain });
      labels.push(name);
    }
    return { gaps: out, labels: labels };
  }

  function topDimensionsByDomainFromVector(lv, importance, registry, domain, n) {
    if (!lv || !registry || !registry.dimensions) return [];
    var limit = n || 6;
    var scored = [];
    registry.dimensions.forEach(function (d) {
      if (domain && d.domain !== domain) return;
      var idx = d.index;
      var imp = importance && importance[idx] != null ? importance[idx] / 100 : 0.5;
      var level = lv[idx] || 0;
      if (level <= 0) return;
      scored.push({
        index: idx,
        name: d.name,
        domain: d.domain,
        level: level,
        score: level * imp,
      });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit);
  }

  function topSkillsFromVector(lv, importance, registry, n) {
    return topDimensionsByDomainFromVector(lv, importance, registry, 'skills', n || 5)
      .map(function (s) { return s.name; });
  }

  var USER_BLEND_OBJECTIVE = 0.75;
  var USER_BLEND_PERSONALITY = 0.25;
  var PERSONALITY_OBJECTIVE_BLEED = 0.2;
  // Know-you / resume text reaches personality only through this bleed, and the
  // objective layer it bleeds from touches most of the vector — so it gets the
  // same direction gate and L1 budget as sharpen, one notch looser because the
  // text is the user's own words rather than five slider positions.
  // Parity: functions/_lib/onet/user-vectors.js.
  var BLEED_L1_BUDGET = 150;

  // Bleed contributions are recorded in a sparse restore map (bleedBase) so the
  // next hydration can strip them exactly before re-applying. Without the strip,
  // every page boot re-added 0.2 × delta and personality drifted upward.
  function stripBleedFromPersonality(personalityVec) {
    if (!personalityVec || !personalityVec.bleedBase || !personalityVec.values) {
      return personalityVec;
    }
    var values = personalityVec.values.slice();
    Object.keys(personalityVec.bleedBase).forEach(function (key) {
      var idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= DIM) return;
      var restored = Number(personalityVec.bleedBase[key]);
      if (Number.isFinite(restored)) values[idx] = clamp100(restored);
    });
    var out = {};
    Object.keys(personalityVec).forEach(function (k) {
      if (k !== 'bleedBase' && k !== 'values') out[k] = personalityVec[k];
    });
    out.values = values;
    return out;
  }

  function bleedPersonalityFromObjectiveDelta(personalityVec, beforeObjectiveValues, afterObjectiveValues) {
    if (!personalityVec || !personalityVec.values || !afterObjectiveValues) return personalityVec;
    var before = beforeObjectiveValues || emptyVector();
    var values = personalityVec.values.slice();
    var confidence = personalityVec.confidence ? personalityVec.confidence.slice() : new Array(DIM);
    var bleedBase = {};
    var changed = false;
    var pending = new Array(DIM);
    var j;
    for (j = 0; j < DIM; j++) {
      pending[j] = PERSONALITY_OBJECTIVE_BLEED * ((afterObjectiveValues[j] || 0) - (before[j] || 0));
    }
    var bleed = (window.FWOnetMath && typeof FWOnetMath.gateLayerDeltas === 'function')
      ? FWOnetMath.gateLayerDeltas(values, pending, BLEED_L1_BUDGET, 50)
      : pending;
    for (var i = 0; i < DIM; i++) {
      var delta = bleed[i];
      if (!delta) continue;
      var bumped = clamp100(values[i] + delta);
      if (bumped === values[i]) continue;
      bleedBase[i] = values[i];
      values[i] = bumped;
      if (!confidence[i] || confidence[i] === 'estimated') confidence[i] = 'resume-bleed';
      changed = true;
    }
    if (!changed) return personalityVec;
    var out = {
      schemaId: personalityVec.schemaId || SCHEMA,
      values: values,
      confidence: confidence,
      bleedBase: bleedBase,
      updatedAt: new Date().toISOString(),
      source: personalityVec.source || 'resume-bleed',
    };
    if (personalityVec.sources) out.sources = personalityVec.sources;
    return out;
  }

  function applyResumeWithPersonalityBleed(objectiveVec, personalityVec, resumeText, profiles) {
    var before = (objectiveVec && objectiveVec.values) ? objectiveVec.values.slice() : emptyVector();
    var objective = applyTextRulesToObjective(objectiveVec, resumeText, 'resume-rules', profiles);
    var personality = personalityVec;
    if (personalityVec) {
      personality = bleedPersonalityFromObjectiveDelta(personalityVec, before, objective.values);
    }
    return { objective: objective, personality: personality };
  }

  function weightedUserComponent(personalityValues, objectiveValues, index) {
    var p = personalityValues && personalityValues[index] != null ? Number(personalityValues[index]) : 0;
    var o = objectiveValues && objectiveValues[index] != null ? Number(objectiveValues[index]) : 0;
    if (!objectiveValues || !objectiveValues.length) {
      return clamp100(Math.round(p));
    }
    if (!personalityValues || !personalityValues.length) {
      return clamp100(Math.round(o));
    }
    return clamp100(Math.round(USER_BLEND_OBJECTIVE * o + USER_BLEND_PERSONALITY * p));
  }

  function dimensionIndexByName(registry, name) {
    if (!registry || !registry.dimensions || !name) return -1;
    var target = String(name).trim().toLowerCase();
    for (var i = 0; i < registry.dimensions.length; i++) {
      if (String(registry.dimensions[i].name || '').trim().toLowerCase() === target) {
        return registry.dimensions[i].index;
      }
    }
    return -1;
  }

  function skillPillsDataForCareer(soc, limit) {
    return careerVectorData(soc).then(function (data) {
      if (!data) return [];
      var items = topDimensionsByDomainFromVector(
        data.vec, data.imp, data.registry, 'skills', limit || 5,
      );
      var vecs = readQuizVectors();
      var pVals = vecs.personality && vecs.personality.values;
      var oVals = vecs.objective && vecs.objective.values;
      return items.map(function (item) {
        return {
          name: item.name,
          index: item.index,
          pct: weightedUserComponent(pVals, oVals, item.index),
        };
      });
    });
  }

  function skillPillsDataFromNames(names, registry) {
    if (!names || !names.length) return [];
    var vecs = readQuizVectors();
    var pVals = vecs.personality && vecs.personality.values;
    var oVals = vecs.objective && vecs.objective.values;
    return names.map(function (name) {
      var idx = dimensionIndexByName(registry, name);
      return {
        name: name,
        index: idx,
        pct: idx >= 0 ? weightedUserComponent(pVals, oVals, idx) : 0,
      };
    });
  }

  function careerVectorData(soc) {
    if (!soc) return Promise.resolve(null);
    return Promise.all([
      loadDimensionRegistry(),
      fetchVectorsBatched([soc]),
    ]).then(function (parts) {
      var registry = parts[0];
      var vectors = parts[1] || {};
      var vec = vectors[soc];
      if (!vec || !registry) return null;
      var imp = vectorImportanceCache[soc] || null;
      return { vec: vec, imp: imp, registry: registry };
    }).catch(function () { return null; });
  }

  function topDimensionsByDomain(soc, domain, limit) {
    return careerVectorData(soc).then(function (data) {
      if (!data) return [];
      return topDimensionsByDomainFromVector(data.vec, data.imp, data.registry, domain, limit || 6);
    });
  }

  function buildCareerOnetProfile(soc) {
    return careerVectorData(soc).then(function (data) {
      if (!data) return null;
      var domains = ['skills', 'knowledge', 'abilities', 'workActivities'];
      var byDomain = {};
      domains.forEach(function (domain) {
        byDomain[domain] = topDimensionsByDomainFromVector(
          data.vec, data.imp, data.registry, domain, 6,
        );
      });
      var overall = [];
      (data.registry.dimensions || []).forEach(function (d) {
        var idx = d.index;
        var level = data.vec[idx] || 0;
        if (level <= 0) return;
        var imp = data.imp && data.imp[idx] != null ? data.imp[idx] / 100 : 0.5;
        overall.push({
          index: idx,
          name: d.name,
          domain: d.domain,
          level: level,
          score: level * imp,
        });
      });
      overall.sort(function (a, b) { return b.score - a.score; });
      return {
        byDomain: byDomain,
        topOverall: overall.slice(0, 10),
        onetRelease: (data.registry && data.registry.onetRelease) || null,
      };
    });
  }

  // Confidence provenance → the 3 display tiers the viewer/why-drawer render.
  // Mirrors FWOnetDimensionViewer's normalization so chips agree across surfaces.
  function displayTierFor(conf) {
    var s = String(conf || '').toLowerCase();
    if (s === 'quiz-anchored' || s === 'anchored' || s === 'quiz') return 'anchored';
    if (s === '' || s === 'estimated' || s === 'quiz-seed' || s === 'empty') return 'estimated';
    return 'inferred';
  }

  function userVsCareerDimensions(soc, personalityValues, objectiveValues, confidence) {
    if (!personalityValues || !personalityValues.length) return Promise.resolve(null);
    return careerVectorData(soc).then(function (data) {
      if (!data) return null;
      var comparisons = [];
      (data.registry.dimensions || []).forEach(function (d) {
        var idx = d.index;
        var target = data.vec[idx] || 0;
        if (target <= 0.5) return;
        var user = weightedUserComponent(personalityValues, objectiveValues, idx);
        var userPct = clamp100(Math.round(user));
        var targetPct = clamp100(Math.round(target));
        comparisons.push({
          index: idx,
          name: d.name,
          domain: d.domain,
          user: userPct,
          target: targetPct,
          tier: confidence && confidence.length ? displayTierFor(confidence[idx]) : null,
          gap: Math.max(0, Math.round(targetPct - userPct)),
          strength: Math.max(0, Math.round(userPct - targetPct)),
        });
      });
      comparisons.sort(function (a, b) { return b.gap - a.gap; });
      var gaps = comparisons.filter(function (c) { return c.gap > 0; }).slice(0, 8);
      var strengths = comparisons.slice().sort(function (a, b) { return b.strength - a.strength; })
        .filter(function (c) { return c.strength > 0; })
        .slice(0, 6);
      return { comparisons: comparisons, gaps: gaps, strengths: strengths };
    });
  }

  // Additive sibling of userVsCareerDimensions for the Skill Gap Tracker.
  // Coordinate-delta gaps must attack the OBJECTIVE (background) vector directly
  // when it is active — the 0.75/0.25 blend used by userVsCareerDimensions dilutes
  // an objective gap with personality signal, understating what the user must build.
  // When the objective vector is empty/inactive we fall back to the same blended
  // component so vectorless-but-quiz users still get sensible deltas.
  function objectiveVsCareerDimensions(soc, objectiveValues, personalityValues) {
    return careerVectorData(soc).then(function (data) {
      if (!data) return null;
      var objActive = objectiveValues
        && objectiveValues.length
        && vectorMagnitude(objectiveValues) > 0.01;
      if (!objActive && (!personalityValues || !personalityValues.length)) return null;
      var comparisons = [];
      (data.registry.dimensions || []).forEach(function (d) {
        var idx = d.index;
        var target = data.vec[idx] || 0;
        if (target <= 0.5) return;
        var userRaw = objActive
          ? (objectiveValues[idx] != null ? Number(objectiveValues[idx]) : 0)
          : weightedUserComponent(personalityValues, objectiveValues, idx);
        var userPct = clamp100(Math.round(userRaw));
        var targetPct = clamp100(Math.round(target));
        comparisons.push({
          index: idx,
          name: d.name,
          domain: d.domain,
          user: userPct,
          target: targetPct,
          gap: Math.max(0, Math.round(targetPct - userPct)),
          strength: Math.max(0, Math.round(userPct - targetPct)),
        });
      });
      comparisons.sort(function (a, b) { return b.gap - a.gap; });
      var gaps = comparisons.filter(function (c) { return c.gap > 0; }).slice(0, 8);
      return { comparisons: comparisons, gaps: gaps, objectiveActive: !!objActive };
    });
  }

  function topSkillsFromOnet(soc, limit) {
    if (!soc) return Promise.resolve([]);
    return Promise.all([
      loadDimensionRegistry(),
      fetchVectorsBatched([soc]),
    ]).then(function (parts) {
      var registry = parts[0];
      var vectors = parts[1] || {};
      var vec = vectors[soc];
      if (!vec || !registry) return [];
      var imp = vectorImportanceCache[soc] || null;
      return topSkillsFromVector(vec, imp, registry, limit || 5);
    }).catch(function () { return []; });
  }

  function resolveTargetSoc(slug, socParam) {
    if (socParam) return Promise.resolve(socParam);
    if (window.FWOnetCatalog && typeof FWOnetCatalog.resolveCanonical === 'function') {
      return FWOnetCatalog.resolveCanonical(slug, null).then(function (canonical) {
        if (canonical && canonical.soc) return canonical.soc;
        return socFromSlugOrParam(slug, null);
      });
    }
    return socFromSlugOrParam(slug, null);
  }

  var clamp100 = M.clamp100 || function (n) {
    return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  };
  var dot = M.dot || function (a, b) {
    var s = 0;
    for (var i = 0; i < DIM; i++) s += (a[i] || 0) * (b[i] || 0);
    return s;
  };
  var magnitude = M.magnitude || function (vec) {
    return Math.sqrt(dot(vec, vec));
  };
  var cosine = M.cosine || function (a, b) {
    var ma = magnitude(a), mb = magnitude(b);
    if (!ma || !mb) return 0;
    return dot(a, b) / (ma * mb);
  };
  var cosinePercent = M.cosinePercent || function (cos) {
    return clamp100(Math.round((Number(cos) || 0) * 100));
  };
  // THE personality-fit chokepoint (assets/js/shared/onet-math.js). No `||`
  // fallback on purpose: every page that loads this file also loads onet-math,
  // and one that somehow did not must fail loudly rather than quietly score
  // personality fit with a formula that stopped being the app's formula.
  var personalityFitPercent = M.personalityFitPercent;
  function objectiveFitFromVectors(objValues, careerVec) {
    if (M.objectiveFitPercent) return M.objectiveFitPercent(objValues, careerVec);
    var norm = M.normalizeVector ? M.normalizeVector(objValues) : objValues;
    return cosinePercent(cosine(norm, careerVec));
  }
  var percentileRank = M.percentileRank || function (sortedIndex, n) {
    if (n <= 1) return 50;
    return clamp100(Math.round((sortedIndex / (n - 1)) * 100));
  };
  var blendVectors = M.blendVectors || function (vecs, weights) {
    var out = emptyVector();
    var total = 0;
    for (var i = 0; i < vecs.length; i++) {
      var w = weights[i] || 1;
      total += w;
      for (var d = 0; d < DIM; d++) out[d] += (vecs[i][d] || 0) * w;
    }
    if (total > 0) {
      for (var j = 0; j < DIM; j++) out[j] /= total;
    }
    return out;
  };

  function vectorMagnitude(vec) {
    return magnitude(vec);
  }

  function writeQuizPersonalityVector(personality) {
    try {
      var quiz = readLocalQuizBlob() || {};
      quiz.personalityVector = personality;
      quiz.vectorSchemaId = SCHEMA;
      // Route through the canonical persist path — a raw setItem here skipped
      // hydration, D1 sync, and update events, leaving stale fit everywhere.
      persistQuizVectors(quiz, { sync: true });
    } catch (err) {
      console.warn('[FWOnetVectors] writeQuizPersonalityVector failed', err);
    }
  }

  var zoneCentroidsCache = null;
  var zoneCentroidsPromise = null;

  function loadZoneCentroids() {
    if (zoneCentroidsCache) return Promise.resolve(zoneCentroidsCache);
    if (zoneCentroidsPromise) return zoneCentroidsPromise;
    zoneCentroidsPromise = fetch(ZONE_CENTROIDS_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        zoneCentroidsCache = data;
        return data;
      })
      .catch(function () {
        zoneCentroidsPromise = null;
        return null;
      });
    return zoneCentroidsPromise;
  }

  // Storage access goes through FWUser's v1-shaped blob view (user.js loads
  // first on every page that loads this file) so the Phase 4 storage flip
  // happens inside the facade, not here.
  function readLocalQuizBlob() {
    if (!window.FWUser || typeof FWUser.getBlob !== 'function') return null;
    return FWUser.getBlob();
  }

  function emptyObjectiveVec() {
    return {
      schemaId: SCHEMA,
      values: emptyVector(),
      sources: [],
      source: 'empty',
    };
  }

  // Sources written by the SERVER's personality patches
  // (functions/_lib/onet/personality-patch.js). Unlike objectiveAiPatch there
  // is no replay record for these — they edit personalityVector.values in
  // place — so a stored vector carrying one of these cannot be regenerated
  // from the quiz. Every other layer on top of the seed (refine, resume bleed)
  // IS replayed by hydrateQuizVectors, so dropping the base loses nothing.
  // A patch source survives both layers: the bleed keeps
  // `personalityVec.source || 'resume-bleed'` and refine keeps `base.source`.
  var UNREPLAYABLE_PERSONALITY_SOURCES = ['gemini-patch', 'profile-building', 'resume-gemini'];

  /**
   * Can this stored personality vector be thrown away and re-seeded without
   * losing information? Fail-closed: anything we cannot re-derive stays.
   */
  function personalityReseedIsLossless(stored) {
    if (!stored) return false;
    return UNREPLAYABLE_PERSONALITY_SOURCES.indexOf(String(stored.source || '')) < 0;
  }

  function shouldReseedPersonality(stored, quiz, zoneCentroids) {
    if ((Number(stored && stored.seedGen) || 0) >= PERSONALITY_SEED_GEN) return false;
    // Only when a re-seed is actually possible. Without centroids or scores the
    // seed returns an empty vector, so dropping here would destroy the profile
    // rather than sharpen it.
    if (!zoneCentroids || !quiz.scores) return false;
    return personalityReseedIsLossless(stored);
  }

  function basePersonalityFromQuiz(quiz, zoneCentroids) {
    var stored = quiz.personalityVector;
    // Fix 1.3 sharpened the seed, but a stored vector was always reused, so
    // the sharper seed reached new quiz completions and nobody else. Accounts
    // still on an older generation are re-seeded here — the one place that
    // holds both the scores and the centroids a re-seed needs.
    if (stored && shouldReseedPersonality(stored, quiz, zoneCentroids)) {
      // The seed ranks the quiz scores through FWSectorFitSheet.SECTOR_KEYS, and
      // not every page that hydrates loads that module. Without it the seed comes
      // back all zeros — which would overwrite a real profile with nothing, and
      // then be deleted as corrupt and re-written on the next boot, forever. The
      // re-seed is an upgrade or it does not happen: fail closed to the stored
      // vector, exactly as the missing-centroids case above does.
      var reseeded = seedPersonalityFromQuiz(quiz.scores, zoneCentroids);
      if (reseeded && !personalityLooksCorrupt(reseeded.values)) return reseeded;
    }
    if (stored && stored.values && stored.values.length) {
      // Strip in reverse application order: bleed (applied last) first, then refine.
      var unbled = stripBleedFromPersonality(stored);
      if (window.FWRefineMap && typeof FWRefineMap.stripRefineFromPersonality === 'function') {
        return FWRefineMap.stripRefineFromPersonality(unbled);
      }
      return unbled;
    }
    if (quiz.scores && zoneCentroids) {
      return seedPersonalityFromQuiz(quiz.scores, zoneCentroids);
    }
    var confidence = new Array(DIM);
    for (var i = 0; i < DIM; i++) confidence[i] = 'estimated';
    return {
      schemaId: SCHEMA,
      values: emptyVector(),
      confidence: confidence,
      updatedAt: new Date().toISOString(),
      source: 'empty',
    };
  }

  function applyObjectiveAiPatchToVector(objectiveVec, patch) {
    if (!patch || !patch.dimensions || !patch.dimensions.length) return objectiveVec;
    var values = (objectiveVec && objectiveVec.values) ? objectiveVec.values.slice() : emptyVector();
    var sources = (objectiveVec && objectiveVec.sources) ? objectiveVec.sources.slice() : new Array(DIM);
    var changed = false;
    for (var i = 0; i < patch.dimensions.length; i++) {
      var d = patch.dimensions[i];
      var idx = Number(d && d.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= DIM) continue;
      var next = clamp100(d.value != null ? d.value : d.to);
      if (values[idx] === next) continue;
      values[idx] = next;
      sources[idx] = 'ai-patch';
      changed = true;
    }
    if (!changed) return objectiveVec;
    return {
      schemaId: (objectiveVec && objectiveVec.schemaId) || SCHEMA,
      values: values,
      sources: sources,
      updatedAt: new Date().toISOString(),
      source: (objectiveVec && objectiveVec.source) || 'ai-patch',
    };
  }

  function vectorValuesEqual(a, b) {
    if (!a || !b || !a.values || !b.values) return false;
    if (a.values.length !== b.values.length) return false;
    for (var i = 0; i < a.values.length; i++) {
      if ((a.values[i] || 0) !== (b.values[i] || 0)) return false;
    }
    return true;
  }

  // A real O*NET personality profile always has spread. A stored vector with no
  // spread (all identical) or pinned near the ceiling across most dimensions is
  // corrupt legacy data — not something the quiz ever produces.
  function personalityLooksCorrupt(values) {
    if (!Array.isArray(values) || !values.length) return true;
    var min = Infinity, max = -Infinity, saturated = 0;
    for (var i = 0; i < values.length; i++) {
      var n = Number(values[i]) || 0;
      if (n < min) min = n;
      if (n > max) max = n;
      if (n >= 99.5) saturated++;
    }
    return (max - min) < 1 || saturated >= values.length * 0.5;
  }

  // Legacy-account hydration guard. Older saved profiles predate keys and vector
  // schemas that current features assume. Patch missing structures, and drop any
  // vector that is structurally incompatible (wrong dimension count), from an old
  // schema, or corrupt — so the rebuild below reseeds it from the quiz scores
  // instead of crashing on a cosine over mismatched dims or showing junk values.
  function migrateLegacyQuizSchema(quiz) {
    if (!quiz || typeof quiz !== 'object') return quiz;
    try {
      if (!Array.isArray(quiz.careerFocusHistory)) quiz.careerFocusHistory = [];
      if (!quiz.academics || typeof quiz.academics !== 'object') quiz.academics = {};
      if (!quiz.profile || typeof quiz.profile !== 'object') quiz.profile = {};
      if (quiz.refine && typeof quiz.refine !== 'object') delete quiz.refine;

      ['personalityVector', 'objectiveVector'].forEach(function (key) {
        var v = quiz[key];
        if (!v) return;
        var badShape = !Array.isArray(v.values) || v.values.length !== DIM;
        var badSchema = v.schemaId && v.schemaId !== SCHEMA;
        // Only reseed a corrupt personality when there are scores to reseed FROM;
        // objective is always rebuilt from inputs so its stale values don't matter.
        var corrupt = key === 'personalityVector' && quiz.scores
          && personalityLooksCorrupt(v.values);
        if (badShape || badSchema || corrupt) delete quiz[key];
      });
    } catch (_) { /* migration must never throw during hydration */ }
    return quiz;
  }

  function hydrateQuizVectors(quiz, opts) {
    opts = opts || {};
    if (!quiz || typeof quiz !== 'object') return quiz;
    var zoneCentroids = opts.zoneCentroids || zoneCentroidsCache;

    // The migration drops vectors it judges unusable, so it can delete a stored
    // vector before the rebuild below ever compares against it. Snapshot first:
    // a rebuild that reproduces the dropped values exactly changed nothing, and
    // must not bump updatedAt — the staleness hashes downstream (portal
    // snapshot, roadmap, analysis cache) key off it.
    var priorPersonality = quiz.personalityVector;
    migrateLegacyQuizSchema(quiz);
    quiz.vectorSchemaId = SCHEMA;

    var personality = basePersonalityFromQuiz(quiz, zoneCentroids);
    // The stamp describes the BASE the layers sit on, and refine/bleed rebuild
    // the vector object without carrying it. Capture it here and re-attach
    // after the layers, or a re-seeded profile would be re-seeded every boot.
    var baseSeedGen = Number(personality && personality.seedGen) || 0;
    if (quiz.refine && window.FWRefineMap && typeof FWRefineMap.refreshPersonalityFromRefine === 'function') {
      personality = FWRefineMap.refreshPersonalityFromRefine(personality, quiz.refine);
    }

    var objective;
    if (quiz.objectiveSkipped) {
      objective = {
        schemaId: SCHEMA,
        values: emptyVector(),
        sources: [],
        updatedAt: new Date().toISOString(),
        source: 'skipped',
        skipped: true,
      };
    } else {
      objective = emptyObjectiveVec();
      if (quiz.academics) {
        objective = refreshObjectiveFromAcademics(objective, quiz.academics, quiz.profile);
      }
      if (quiz.refine && window.FWRefineMap && typeof FWRefineMap.refreshObjectiveFromRefine === 'function') {
        objective = FWRefineMap.refreshObjectiveFromRefine(objective, quiz.refine);
      }
      var resumeParts = [];
      if (quiz.resumeText) resumeParts.push(String(quiz.resumeText));
      if (quiz.academicsTranscript) resumeParts.push(String(quiz.academicsTranscript));
      var resumeText = resumeParts.join('\n').trim();
      if (resumeText.length >= 40) {
        var profiles = getZoneProfilesSync();
        var bleed = applyResumeWithPersonalityBleed(objective, personality, resumeText, profiles);
        objective = bleed.objective;
        if (bleed.personality) personality = bleed.personality;
      }
      // AI patches (resume-parse / chat Gemini enrichment) replay last —
      // this rebuild starts from empty, so without the replay every server
      // objective patch survived exactly one page load.
      if (quiz.objectiveAiPatch && quiz.objectiveAiPatch.dimensions
          && quiz.objectiveAiPatch.dimensions.length) {
        objective = applyObjectiveAiPatchToVector(objective, quiz.objectiveAiPatch);
      }
    }

    // Keep the stored vector objects (and their updatedAt) when a rebuild
    // produces identical values — hydration must be idempotent so staleness
    // hashes downstream (portal snapshot, roadmap, analysis cache) hold still.
    if (baseSeedGen && personality) personality.seedGen = baseSeedGen;
    if (vectorValuesEqual(quiz.personalityVector, personality)) {
      // Reusing the stored object keeps updatedAt (and downstream staleness
      // hashes) still. Carry the stamp onto it so a re-seed that happened to
      // reproduce the stored values is not attempted again on every boot.
      if (baseSeedGen) quiz.personalityVector.seedGen = baseSeedGen;
      personality = quiz.personalityVector;
    } else if (personality && vectorValuesEqual(priorPersonality, personality)
               && personality !== priorPersonality && priorPersonality.updatedAt) {
      // Same values as the vector the migration dropped: nothing moved.
      personality.updatedAt = priorPersonality.updatedAt;
    }
    if (vectorValuesEqual(quiz.objectiveVector, objective)) {
      objective = quiz.objectiveVector;
    }
    quiz.personalityVector = personality;
    quiz.objectiveVector = objective;
    return quiz;
  }

  function persistQuizVectors(quiz, opts) {
    opts = opts || {};
    var prevPersonality = quiz && quiz.personalityVector;
    var prevObjective = quiz && quiz.objectiveVector;
    var hydrated = hydrateQuizVectors(quiz, opts);
    var vectorsChanged = !hydrated
      || hydrated.personalityVector !== prevPersonality
      || hydrated.objectiveVector !== prevObjective;
    var wrote = window.FWUser && typeof FWUser.putBlob === 'function' && FWUser.putBlob(hydrated);
    if (!wrote) {
      console.warn('[FWOnetVectors] persistQuizVectors failed');
      return hydrated;
    }
    if (vectorsChanged) clearRankedCache();
    if (vectorsChanged && opts.dispatchEvents !== false) {
      try {
        window.dispatchEvent(new CustomEvent('fw-objective-updated'));
        window.dispatchEvent(new CustomEvent('fw-personality-updated'));
      } catch (_) { /* ignore */ }
    }
    if (opts.sync !== false && window.FWAuth && typeof FWAuth.uploadLocalQuizIfPresent === 'function') {
      FWAuth.uploadLocalQuizIfPresent().catch(function () { /* ignore */ });
    }
    return hydrated;
  }

  function clearRankedCache() {
    rankedCache = null;
    rankedOnetCache = null;
    rankedOnetPromise = null;
  }

  function getRankCacheVersion() {
    return rankedOnetCacheVersion;
  }

  function loadOnetCareers() {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.load === 'function') {
      return FWOnetCatalog.load();
    }
    return Promise.resolve([]);
  }

  function buildOnetRankEntry(row, score, components) {
    var slug = window.FWOnetCatalog && FWOnetCatalog.canonicalSlugForRow
      ? FWOnetCatalog.canonicalSlugForRow(row)
      : slugifyCareerName(row.title);
    var entry = {
      id: 'soc:' + row.soc,
      soc: row.soc,
      name: row.title,
      slug: slug,
      score: score,
      career: { id: 'soc:' + row.soc, name: row.title, skills: [], soc: row.soc, slug: slug },
    };
    // Additive per-component fits (no existing consumer reads these — grep of
    // rankOnetCareersFromVectors / getCachedOnetRank / toHubRankShape consumers
    // shows they only touch score/slug/name/soc/career/id). Used by
    // stretchFitCandidates to surface objective-dominant "non-obvious fits".
    if (components) {
      entry.personalityFit = components.personalityFit != null ? components.personalityFit : null;
      entry.objectiveFit = components.objectiveFit != null ? components.objectiveFit : null;
    }
    return entry;
  }

  // Returns the overall fit percent. When `out` is provided, also stashes
  // the pFit/oFit components on it so callers can retain them without a second
  // pass. `score` semantics are unchanged for every existing caller.
  function scoreCareerVector(personality, objValues, objActive, vec, out) {
    var pFit = personalityFitPercent(personality.values, vec);
    var oFit = objActive ? objectiveFitFromVectors(objValues, vec) : null;
    if (out) {
      out.personalityFit = pFit;
      out.objectiveFit = oFit;
    }
    return displayFitPercent(personality.values, vec);
  }

  function emptyVector() {
    if (M.emptyVector) return M.emptyVector(0);
    var v = new Array(DIM);
    for (var i = 0; i < DIM; i++) v[i] = 0;
    return v;
  }

  function loadHubMap() {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.load === 'function') {
      return FWOnetCatalog.load().then(function () {
        return FWOnetCatalog.getHubMap();
      });
    }
    return Promise.resolve(null);
  }

  function fetchVectorsBatched(socs) {
    var unique = socs.slice();
    if (!unique.length) return Promise.resolve({});
    var batches = [];
    for (var i = 0; i < unique.length; i += MAX_SOC_BATCH) {
      batches.push(unique.slice(i, i + MAX_SOC_BATCH));
    }
    var merged = {};
    return batches.reduce(function (chain, batch) {
      return chain.then(function () {
        return fetch('/onet/vectors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ socs: batch }),
        }).then(function (r) { return r.json(); }).then(function (data) {
          Object.assign(merged, data.vectors || {});
          if (data.importance) Object.assign(vectorImportanceCache, data.importance);
        });
      });
    }, Promise.resolve()).then(function () { return merged; });
  }

  function createVectorFetchQueue(options) {
    options = options || {};
    var batchSize = options.batchSize || MAX_SOC_BATCH;
    var cache = options.cache || {};
    var queued = {};
    var running = false;
    var pendingTimer = null;
    var firstFetch = options.firstFetch !== false;
    var onBatchComplete = options.onBatchComplete || function () {};

    function drain() {
      if (running) return;
      var pending = Object.keys(queued).filter(function (soc) {
        return !cache[soc];
      });
      if (!pending.length) return;

      var batch = pending.slice(0, batchSize);
      running = true;
      fetchVectorsBatched(batch).then(function (vectors) {
        Object.keys(vectors || {}).forEach(function (soc) {
          cache[soc] = vectors[soc];
          delete queued[soc];
        });
        batch.forEach(function (soc) {
          if (!vectors || !vectors[soc]) delete queued[soc];
        });
        onBatchComplete(batch, vectors || {});
      }).catch(function (err) {
        console.warn('[FWOnetVectors] vector fetch failed', err);
        batch.forEach(function (soc) { delete queued[soc]; });
      }).finally(function () {
        running = false;
        drain();
      });
    }

    function enqueue(socs) {
      var added = false;
      (socs || []).forEach(function (soc) {
        if (!soc || cache[soc] || queued[soc]) return;
        queued[soc] = true;
        added = true;
      });
      if (!added && running) return;
      if (pendingTimer) clearTimeout(pendingTimer);
      var run = function () {
        pendingTimer = null;
        drain();
      };
      if (firstFetch) {
        firstFetch = false;
        run();
        return;
      }
      pendingTimer = setTimeout(run, options.debounceMs || 80);
    }

    return {
      enqueue: enqueue,
      drain: drain,
      isPending: function (soc) { return !!queued[soc]; },
    };
  }

  // Seed gain (parity: functions/_lib/onet/user-vectors.js — same constants,
  // same values, verified by npm run test:vectors).
  // The seed blends the top-3 sector centroids, and three broadly-similar
  // occupation centroids average out to something close to the generic
  // occupation — a direction that fits everything a little and nothing much.
  // Two corrections: the blend weight is steep enough that the declared top
  // sector dominates (90-vs-60 reads ~7.6:1, not 2.25:1), and the contrast
  // expansion is stronger on the dimensions the top sector commits to, so the
  // result stays on that axis.
  // Everything is measured from the per-dimension "generic occupation" baseline
  // (the mean across every zone centroid), not from a literal 50: fit is a
  // mean-centered cosine precisely because O*NET level vectors sit on a large
  // shared baseline well off 50, so 50 is not the neutral point and gating
  // against it barely discriminates.
  // Generation stamp on the seed's output. Bumped whenever the seed's MATH
  // changes, so accounts carrying an older generation can be re-seeded instead
  // of keeping a vector nobody would produce today. Gen 2 is fix 1.3's
  // sharpened seed (`f958b3a`); gen 1 is everything written before it, which
  // carries no stamp at all. Parity: functions/_lib/onet/user-vectors.js.
  var PERSONALITY_SEED_GEN = 2;
  var SEED_WEIGHT_EXPONENT = 5;
  var SEED_GAIN_ALIGNED = 3;
  var SEED_GAIN_OTHER = 0.75;
  var SEED_TOP_COMMIT = 8;  // |topCentroid - its mean| below this is not a commitment
  var SEED_ZERO_BAND = 6;   // post-gain |v - its mean| below this reads as "no signal"

  function vectorMean(vec) {
    var s = 0;
    for (var i = 0; i < DIM; i++) s += Number(vec[i]) || 0;
    return s / DIM;
  }

  // Per-dimension "generic occupation" baseline: the mean across every zone
  // centroid. Every sector scores high on reading, speaking and critical
  // thinking and low on wrist-finger speed, so those dimensions say nothing
  // about WHICH sector — only a dimension's departure from this baseline does.
  function zoneBaselineVector(zoneCentroids) {
    var keys = zoneCentroids ? Object.keys(zoneCentroids) : [];
    var out = emptyVector();
    var used = 0;
    keys.forEach(function (k) {
      var c = zoneCentroids[k];
      if (!c || c.length !== DIM) return;
      used++;
      for (var i = 0; i < DIM; i++) out[i] += Number(c[i]) || 0;
    });
    if (!used) return null;
    for (var i = 0; i < DIM; i++) out[i] /= used;
    return out;
  }

  function seedPersonalityFromQuiz(scores, zoneCentroids) {
    var SECTOR_KEYS = (window.FWSectorFitSheet && FWSectorFitSheet.SECTOR_KEYS) || [];
    var SECTOR_TO_ZONE = {
      tech: 'tech', healthcare: 'healthcare', finance: 'finance', creative: 'creative',
      education: 'education', business: 'business', law: 'law', engineering: 'engineering',
      science: 'science', startups: 'business', social: 'social', marketing: 'marketing',
      trades: 'trades', media: 'media', government: 'government', cybersecurity: 'cybersecurity',
      operations: 'operations', hospitality: 'hospitality', aerospace: 'engineering',
      pharmaceutical: 'pharmaceutical', sports: 'sports', realestate: 'realestate',
      hr: 'hr', agriculture: 'agriculture',
    };
    var ranked = SECTOR_KEYS.map(function (key) {
      return { key: key, score: Number(scores && scores[key]) || 0 };
    }).filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 3);
    var values = emptyVector();
    var confidence = new Array(DIM);
    var i;
    for (i = 0; i < DIM; i++) confidence[i] = 'estimated';
    if (!ranked.length) {
      return {
        schemaId: SCHEMA,
        values: values,
        confidence: confidence,
        updatedAt: new Date().toISOString(),
        source: 'quiz-seed',
        seedGen: PERSONALITY_SEED_GEN,
      };
    }
    var total = 0;
    ranked.forEach(function (item) {
      var zone = SECTOR_TO_ZONE[item.key] || item.key;
      var centroid = zoneCentroids && zoneCentroids[zone];
      if (!centroid || centroid.length !== DIM) return;
      var w = Math.pow(item.score / 100, SEED_WEIGHT_EXPONENT);
      total += w;
      for (i = 0; i < DIM; i++) values[i] += centroid[i] * w;
    });
    if (total > 0) {
      for (i = 0; i < DIM; i++) values[i] /= total;
    }
    var topZone = SECTOR_TO_ZONE[ranked[0].key] || ranked[0].key;
    var topCentroid = zoneCentroids && zoneCentroids[topZone];
    if (!topCentroid || topCentroid.length !== DIM) topCentroid = null;
    var baseline = zoneBaselineVector(zoneCentroids);
    for (i = 0; i < DIM; i++) {
      var b = baseline ? baseline[i] : 50;
      var d = values[i] - b;
      var t = topCentroid ? topCentroid[i] - b : 0;
      var aligned = d !== 0 && Math.abs(t) >= SEED_TOP_COMMIT && (d > 0) === (t > 0);
      values[i] = clamp100(b + d * (aligned ? SEED_GAIN_ALIGNED : SEED_GAIN_OTHER));
    }
    // Zeroing runs against the amplified vector's own mean, not the baseline: a
    // dimension is "no signal" when it fails to stand out from the rest of THIS
    // user's profile. Zeroed dims are what make the vector discriminate — an
    // all-dimensions-populated vector correlates with every occupation.
    var vMean = vectorMean(values);
    for (i = 0; i < DIM; i++) {
      if (Math.abs(values[i] - vMean) < SEED_ZERO_BAND) {
        values[i] = 0;
        confidence[i] = 'estimated';
      } else {
        confidence[i] = 'quiz-anchored';
      }
    }
    return {
      schemaId: SCHEMA,
      values: values,
      confidence: confidence,
      updatedAt: new Date().toISOString(),
      source: 'quiz-seed',
      seedGen: PERSONALITY_SEED_GEN,
    };
  }

  // The displayed fit for a career or a sector: personality only. Objective fit
  // is computed alongside and shown separately — it answers "am I ready", not
  // "would I like this". Delegates to the FWOnetMath chokepoint so client and
  // server cannot drift.
  function displayFitPercent(personalityValues, careerVec, len) {
    if (M.displayFitPercent) return M.displayFitPercent(personalityValues, careerVec, len);
    return personalityFitPercent(personalityValues, careerVec, len);
  }

  function slugifyCareerName(name) {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.slugify === 'function') {
      return FWOnetCatalog.slugify(name);
    }
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function resolveFeaturedCareerSlug(hubId, entry, hubCareer) {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.getLegacySlugForHubId === 'function') {
      var catalogSlug = FWOnetCatalog.getLegacySlugForHubId(hubId);
      if (catalogSlug) return catalogSlug;
    }
    var name = (entry && entry.name) || (hubCareer && hubCareer.name) || '';
    return slugifyCareerName(name);
  }

  function invalidateRankedCacheIfNeeded() {
    if (rankedCache && rankedCache.some(function (r) { return !r.slug; })) {
      rankedCache = null;
    }
  }

  function readQuizVectors(opts) {
    opts = opts || {};
    try {
      var data = readLocalQuizBlob();
      if (!data) return { scores: null, personality: null, objective: null };
      if (opts.hydrate) data = hydrateQuizVectors(data, opts);
      return {
        scores: data.scores || null,
        personality: data.personalityVector || null,
        objective: data.objectiveVector || null,
        refine: data.refine || null,
        academics: data.academics || null,
        profile: data.profile || null,
      };
    } catch (e) {
      return { scores: null, personality: null, objective: null };
    }
  }

  // A stored vector with no signal is not an answer, and treating it as one is
  // how a profile ends up scoring the same nothing against every career. It
  // happens: hydration that ran before the zone centroids loaded writes a
  // `source: 'empty'` vector with a full-length all-zero `values` array, and an
  // earlier roadmap bug zeroed live vectors outright. Because the values array
  // exists, every downstream check ("do we have a vector?") passed, and because
  // re-hydration reuses a stored vector, nothing ever repaired it.
  //
  // MIN_VECTOR_SIGNAL is well under what a completed quiz produces (real
  // profiles carry 48-152 nonzero dims) and well over what rounding noise could
  // leave behind, so this re-seeds the broken case without touching thin-but-
  // real profiles.
  var MIN_VECTOR_SIGNAL = 12;

  function hasVectorSignal(values) {
    if (!values || !values.length) return false;
    var n = 0;
    for (var i = 0; i < values.length; i++) {
      if ((values[i] || 0) !== 0 && (n += 1) >= MIN_VECTOR_SIGNAL) return true;
    }
    return false;
  }

  function resolvePersonality(opts) {
    opts = opts || {};
    var quiz = readQuizVectors({ hydrate: true, zoneCentroids: opts.zoneCentroids });
    var personality = opts.personality || quiz.personality;
    var scores = opts.scores || quiz.scores;
    if (personality && personality.values && hasVectorSignal(personality.values)) {
      return Promise.resolve(personality);
    }
    if (!scores) return Promise.resolve(null);
    // Honour centroids the caller already has — the hub and the gates both hold
    // them — instead of forcing a fetch that may be cached-rejected.
    var centroids = opts.zoneCentroids
      ? Promise.resolve(opts.zoneCentroids)
      : loadZoneCentroids();
    return centroids.then(function (zc) {
      if (!zc) return null;
      var seeded = seedPersonalityFromQuiz(scores, zc);
      if (quiz.refine && window.FWRefineMap && typeof FWRefineMap.refreshPersonalityFromRefine === 'function') {
        return FWRefineMap.refreshPersonalityFromRefine(seeded, quiz.refine);
      }
      return seeded;
    });
  }

  function rankFeaturedFromVectors(opts) {
    opts = opts || {};
    var limit = opts.limit || 12;
    invalidateRankedCacheIfNeeded();
    if (rankedFeaturedPromise) {
      return rankedFeaturedPromise.then(function (ranked) {
        return ranked ? ranked.slice(0, limit) : null;
      });
    }
    if (rankBuildFailedAt && Date.now() - rankBuildFailedAt < RANK_FAIL_COOLDOWN_MS) {
      return Promise.resolve(null);
    }
    rankedFeaturedPromise = resolvePersonality(opts).then(function (personality) {
      if (!personality || !personality.values) return null;
      return loadHubMap().then(function (map) {
        if (!map || !map.careers) return null;
        var careers = map.careers;
        var allSocs = [];
        Object.keys(careers).forEach(function (hubId) {
          (careers[hubId].socs || []).forEach(function (s) {
            if (allSocs.indexOf(s.soc) < 0) allSocs.push(s.soc);
          });
        });
        return fetchVectorsBatched(allSocs).then(function (vectors) {
          var quizVecs = readQuizVectors({ hydrate: true });
          var objective = quizVecs.objective;
          var objValues = objective && objective.values ? objective.values : null;
          var objActive = objValues && vectorMagnitude(objValues) > 0.01;
          var ranked = [];
          Object.keys(careers).forEach(function (hubId) {
            var entry = careers[hubId];
            var vecs = [];
            var weights = [];
            (entry.socs || []).forEach(function (s) {
              if (vectors[s.soc]) {
                vecs.push(vectors[s.soc]);
                weights.push(s.weight || 1);
              }
            });
            if (!vecs.length) return;
            var blended = blendVectors(vecs, weights);
            var pFit = personalityFitPercent(personality.values, blended);
            var oFit = objActive ? objectiveFitFromVectors(objValues, blended) : null;
            var score = displayFitPercent(personality.values, blended);
            var slug = resolveFeaturedCareerSlug(hubId, entry, null);
            ranked.push({
              hubId: Number(hubId),
              name: entry.name || '',
              score: score,
              slug: slug,
              career: { id: Number(hubId), name: entry.name, skills: [] },
            });
          });
          ranked.sort(function (a, b) { return b.score - a.score; });
          ranked.forEach(function (item, idx) {
            item.percentile = percentileRank(idx, ranked.length);
          });
          rankedCache = ranked;
          rankBuildFailedAt = 0;
          return ranked;
        });
      });
    }).catch(function () {
      rankBuildFailedAt = Date.now();
      return null;
    }).finally(function () {
      rankedFeaturedPromise = null;
    });
    return rankedFeaturedPromise.then(function (ranked) {
      return ranked ? ranked.slice(0, limit) : null;
    });
  }

  function getCachedFeaturedRank(limit) {
    invalidateRankedCacheIfNeeded();
    if (!rankedCache) return null;
    return rankedCache.slice(0, limit || rankedCache.length);
  }

  function rankOnetCareersFromVectors(opts) {
    opts = opts || {};
    var limit = opts.limit || 12;
    if (rankedOnetCache && rankedOnetCache.length) {
      return Promise.resolve(rankedOnetCache.slice(0, limit));
    }
    if (rankedOnetPromise) {
      return rankedOnetPromise.then(function (ranked) {
        return ranked ? ranked.slice(0, limit) : null;
      });
    }
    if (rankBuildFailedAt && Date.now() - rankBuildFailedAt < RANK_FAIL_COOLDOWN_MS) {
      return Promise.resolve(null);
    }
    rankedOnetPromise = resolvePersonality(opts).then(function (personality) {
      if (!personality || !personality.values) return null;
      return loadOnetCareers().then(function (rows) {
        if (!rows || !rows.length) return null;
        var allSocs = rows.map(function (r) { return r.soc; });
        return fetchVectorsBatched(allSocs).then(function (vectors) {
          var quizVecs = readQuizVectors({ hydrate: true });
          var objective = quizVecs.objective;
          var objValues = objective && objective.values ? objective.values : null;
          var objActive = objValues && vectorMagnitude(objValues) > 0.01;
          // Stated-interest bonus: the career the user named in the quiz's
          // leaning question gets a flat rank bonus. Recomputed fresh from the
          // persisted quiz on every rank build (never accumulated), so it's
          // idempotent and survives hydration like the resume/enrich boosts.
          var leaningSoc = null;
          try {
            var quizRaw = readLocalQuizBlob();
            leaningSoc = quizRaw && quizRaw.careerLeaningSoc ? String(quizRaw.careerLeaningSoc) : null;
          } catch (_) { /* no leaning */ }
          var ranked = [];
          rows.forEach(function (row) {
            var vec = vectors[row.soc];
            if (!vec) return;
            var components = {};
            var score = scoreCareerVector(personality, objValues, objActive, vec, components);
            if (leaningSoc && row.soc === leaningSoc) {
              score += 8;
              components.statedInterest = true;
            }
            ranked.push(buildOnetRankEntry(row, score, components));
          });
          ranked.sort(function (a, b) { return b.score - a.score; });
          rankedOnetCache = ranked;
          rankedOnetCacheVersion += 1;
          rankBuildFailedAt = 0;
          return ranked.slice(0, limit);
        });
      });
    }).catch(function () {
      rankBuildFailedAt = Date.now();
      return null;
    }).finally(function () {
      rankedOnetPromise = null;
    });
    return rankedOnetPromise;
  }

  function getCachedOnetRank(limit) {
    if (!rankedOnetCache || !rankedOnetCache.length) return null;
    return rankedOnetCache.slice(0, limit || rankedOnetCache.length);
  }

  // Objective-Vector Stretch Surfacing.
  // Surfaces careers where the OBJECTIVE (background) vector alone indicates a
  // strong fit even though the personality (quiz) fit is only moderate — so the
  // career would not appear in today's personality-dominated top ranks. Only
  // active when the objective vector is active (magnitude > 0.01).
  //
  // Criteria (mean-centered scale): objectiveFit >= 52 AND objectiveFit >= personalityFit
  // + 12 AND the entry is NOT in the top 12 by displayed (personality) fit. Returns up to
  // opts.limit (default 3), best objectiveFit first. Each candidate carries its
  // top 3 contributing dimensions (drivers) — dims where min(user objective
  // value, career value) is highest.
  var STRETCH_MIN_OBJECTIVE = 52;
  var STRETCH_MIN_GAP = 12;
  var STRETCH_TOP_EXCLUDE = 12;

  function stretchFitCandidates(opts) {
    opts = opts || {};
    var limit = opts.limit || 3;
    // Reuse the ranked cache; rankOnetCareersFromVectors returns the full list
    // (limit=782 covers the whole catalog) without refetching when cached.
    return rankOnetCareersFromVectors({ scores: opts.scores, limit: 782 }).then(function (ranked) {
      if (!ranked || !ranked.length) return [];
      var quizVecs = readQuizVectors({ hydrate: true });
      var objective = quizVecs.objective;
      var objValues = objective && objective.values ? objective.values : null;
      var objActive = objValues && vectorMagnitude(objValues) > 0.01;
      if (!objActive) return [];

      // ranked is sorted by the displayed fit, which IS personality fit — so the
      // top of this list is exactly "what the quiz alone surfaces", which is what
      // this panel is defined against. (It briefly was not: while overall fit was
      // a correlation against the personality + objective sum, the ranking itself
      // lifted objective-dominant careers and this exclusion hid the very
      // candidates the panel exists to rescue.)
      var topSocs = {};
      for (var i = 0; i < ranked.length && i < STRETCH_TOP_EXCLUDE; i++) {
        if (ranked[i] && ranked[i].soc) topSocs[ranked[i].soc] = true;
      }

      var candidates = ranked.filter(function (e) {
        if (!e || topSocs[e.soc]) return false;
        var oFit = e.objectiveFit;
        var pFit = e.personalityFit;
        if (oFit == null || pFit == null) return false;
        return oFit >= STRETCH_MIN_OBJECTIVE && oFit >= pFit + STRETCH_MIN_GAP;
      }).sort(function (a, b) { return b.objectiveFit - a.objectiveFit; })
        .slice(0, limit);

      if (!candidates.length) return [];

      // Compute drivers: fetch the (few) candidate career vectors + registry.
      var socs = candidates.map(function (c) { return c.soc; });
      return Promise.all([
        fetchVectorsBatched(socs),
        loadDimensionRegistry(),
      ]).then(function (parts) {
        var vectors = parts[0] || {};
        var registry = parts[1];
        var dims = (registry && registry.dimensions) || [];
        candidates.forEach(function (c) {
          var vec = vectors[c.soc];
          c.drivers = [];
          if (!vec || !dims.length) return;
          var scored = [];
          for (var d = 0; d < dims.length; d++) {
            var idx = dims[d].index != null ? dims[d].index : d;
            var userVal = Number(objValues[idx]) || 0;
            var careerVal = Number(vec[idx]) || 0;
            scored.push({
              name: dims[d].name || ('Dimension ' + idx),
              user: Math.round(userVal),
              target: Math.round(careerVal),
              overlap: Math.min(userVal, careerVal),
            });
          }
          scored.sort(function (a, b) { return b.overlap - a.overlap; });
          c.drivers = scored.slice(0, 3).map(function (s) {
            return { name: s.name, user: s.user, target: s.target };
          });
        });
        return candidates;
      });
    }).catch(function () { return []; });
  }

  function findOnetCareerRow(slug, soc) {
    if (!window.FWOnetCatalog) return null;
    if (soc) {
      var bySoc = FWOnetCatalog.getBySoc(soc);
      if (bySoc) return bySoc;
    }
    if (!slug) return null;
    return FWOnetCatalog.getBySlug(slug);
  }

  function socFromHubSlug(hubSlug) {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.socFromHubSlug === 'function') {
      return FWOnetCatalog.socFromHubSlug(hubSlug);
    }
    return Promise.resolve(null);
  }

  function resolveOnetCareerBySlug(slug, socHint) {
    return loadOnetCareers().then(function () {
      var row = findOnetCareerRow(slug, socHint);
      return row ? buildOnetRankEntry(row, null) : null;
    });
  }

  function resolveLegacyHubSlugToOnet(hubSlug) {
    return resolveOnetCareerBySlug(hubSlug, null).then(function (direct) {
      if (direct) return direct;
      return socFromHubSlug(hubSlug).then(function (soc) {
        if (!soc) return null;
        return resolveOnetCareerBySlug(null, soc);
      });
    });
  }

  function toHubRankShape(ranked) {
    return (ranked || []).map(function (m) {
      var displayScore = m.rawScore != null ? m.rawScore : m.score;
      return { career: m.career, score: displayScore, slug: m.slug, name: m.name };
    });
  }

  function socFromSlugOrParam(careerSlug, socParam) {
    if (socParam) return socParam;
    if (rankedOnetCache && careerSlug) {
      var onetHit = rankedOnetCache.find(function (m) { return m.slug === careerSlug; });
      if (onetHit && onetHit.soc) return onetHit.soc;
    }
    return loadOnetCareers().then(function () {
      var row = findOnetCareerRow(careerSlug, null);
      if (row && row.soc) return row.soc;
      if (window.FWOnetCatalog && FWOnetCatalog.getAll) {
        var legacyHit = FWOnetCatalog.getAll().find(function (r) {
          return FWOnetCatalog.getLegacySlugForSoc(r.soc) === careerSlug;
        });
        if (legacyHit) return legacyHit.soc;
      }
      return null;
    });
  }

  // Single fit formula for every surface: percent is the same personality fit
  // the hub map uses, with objective fit exposed separately for the dual bars.
  function fitForSlugOrSoc(careerSlug, soc, fitScoreFallback) {
    var socPromise = soc
      ? Promise.resolve(soc)
      : socFromSlugOrParam(careerSlug, null);
    return Promise.all([resolvePersonality({}), socPromise]).then(function (parts) {
      var personality = parts[0];
      var resolvedSoc = parts[1];
      if (!personality || !resolvedSoc) {
        return typeof fitScoreFallback === 'number'
          ? { percent: fitScoreFallback, strengths: [], gaps: [], mappedIndustries: [], vector: false }
          : null;
      }
      return fetchVectorsBatched([resolvedSoc]).then(function (vectors) {
        var vec = vectors[resolvedSoc];
        if (!vec) {
          return typeof fitScoreFallback === 'number'
            ? { percent: fitScoreFallback, strengths: [], gaps: [], mappedIndustries: [], vector: false }
            : null;
        }
        var pFit = personalityFitPercent(personality.values, vec);
        var quizVecs = readQuizVectors();
        var objValues = quizVecs.objective && quizVecs.objective.values;
        var objActive = objValues && vectorMagnitude(objValues) > 0.01;
        var oFit = objActive ? objectiveFitFromVectors(objValues, vec) : null;
        return {
          percent: displayFitPercent(personality.values, vec),
          personalityFit: pFit,
          objectiveFit: oFit,
          strengths: ['O*NET vector alignment'],
          gaps: [],
          mappedIndustries: [],
          vector: true,
          soc: resolvedSoc,
        };
      });
    }).catch(function () {
      return typeof fitScoreFallback === 'number'
        ? { percent: fitScoreFallback, strengths: [], gaps: [], mappedIndustries: [], vector: false }
        : null;
    });
  }

  function tradeOffLabel(personalityFit, objectiveFit) {
    if (personalityFit == null || objectiveFit == null) return '';
    var gap = personalityFit - objectiveFit;
    if (gap >= 30) {
      return 'Strong personality fit, early-stage objective fit — invest in skills before applying';
    }
    if (gap <= -30) {
      return 'Strong objective fit, moderate personality fit — explore whether this path energizes you';
    }
    if (personalityFit >= 50 && objectiveFit >= 50) {
      return 'Strong fit on both personality and objective dimensions';
    }
    return '';
  }

  function formatFitPercentile(val) {
    if (val == null || Number.isNaN(val)) return '—';
    if (window.FWFormatScale && typeof FWFormatScale.formatScale100 === 'function') {
      return FWFormatScale.formatScale100(val, 0);
    }
    return Math.round(val) + '/100';
  }

  function renderDualFitBarsHtml(personalityFit, objectiveFit, opts) {
    opts = opts || {};
    var pPct = personalityFit != null ? personalityFit : 0;
    var hasObjective = objectiveFit != null;
    var oPct = hasObjective ? objectiveFit : 0;
    var pLabel = opts.personalityLabel || 'Personality fit';
    var oLabel = opts.objectiveLabel || 'Objective fit';
    var trade = hasObjective ? tradeOffLabel(personalityFit, objectiveFit) : '';
    var prep = opts.preparedness;
    var prepPct = (prep != null && !Number.isNaN(prep)) ? prep : 0;
    var prepHtml = (hasObjective && prep != null && !Number.isNaN(prep))
      ? '<div class="dual-fit-row dual-fit-row--readiness">'
        + '<span class="dual-fit-label">Readiness</span>'
        + '<span class="dual-fit-pct">' + formatFitPercentile(prep) + '</span>'
        + '</div>'
        + '<div class="dual-fit-bar-bg"><div class="dual-fit-bar-fill dual-fit-bar-fill--readiness" style="width:' + prepPct + '%"></div></div>'
        + '<p class="dual-fit-readiness-note">Coverage of this career\'s requirements from your background (distinct from alignment).</p>'
      : '';
    var objectiveHtml = hasObjective
      ? '<div class="dual-fit-row"><span class="dual-fit-label">' + oLabel + '</span>'
        + '<span class="dual-fit-pct">' + formatFitPercentile(objectiveFit) + '</span></div>'
        + '<div class="dual-fit-bar-bg"><div class="dual-fit-bar-fill dual-fit-bar-fill--objective" style="width:' + oPct + '%"></div></div>'
      : '';
    return '<div class="dual-fit-bars">'
      + '<div class="dual-fit-row"><span class="dual-fit-label">' + pLabel + '</span>'
      + '<span class="dual-fit-pct">' + formatFitPercentile(personalityFit) + '</span></div>'
      + '<div class="dual-fit-bar-bg"><div class="dual-fit-bar-fill dual-fit-bar-fill--personality" style="width:' + pPct + '%"></div></div>'
      + objectiveHtml
      + prepHtml
      + (trade ? '<p class="dual-fit-tradeoff">' + trade + '</p>' : '')
      + '</div>';
  }

  function fetchSimilarNeighbors(soc, limit) {
    if (!soc) return Promise.resolve([]);
    var k = limit != null ? limit : 8;
    return fetch('/onet/similar?soc=' + encodeURIComponent(soc) + '&k=' + k, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.neighbors) return [];
        return data.neighbors;
      })
      .catch(function () { return []; });
  }

  function fetchAuthenticatedVectorFit(soc) {
    if (!soc) return Promise.resolve(null);
    return fetch('/vector-fit', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socs: [soc] }),
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      return (data && data.fits && data.fits[soc]) ? data.fits[soc] : null;
    }).catch(function () { return null; });
  }

  var ZONE_PROFILES_URL = '/data/onet/artifacts/zone-dimension-profiles.json';
  var zoneProfilesCache = null;
  var zoneProfilesPromise = null;
  var MAX_THEME_DELTA = 15;
  var MAX_RULES_LAYER = 25;
  var PROFILE_BOOST_SCALE = 10;
  var PROFILE_WEIGHT_FLOOR = 0.035;
  var DOMINANT_ZONE_COUNT = 2;
  var NON_DOMINANT_ATTENUATION = 0.08;

  var SECTOR_TO_ZONE_RESUME = {
    tech: 'tech', healthcare: 'healthcare', finance: 'finance', creative: 'creative',
    education: 'education', business: 'business', law: 'law', engineering: 'engineering',
    science: 'science', startups: 'business', social: 'social', marketing: 'marketing',
    trades: 'trades', media: 'media', government: 'government', cybersecurity: 'cybersecurity',
    operations: 'operations', hospitality: 'hospitality', aerospace: 'engineering',
    pharmaceutical: 'healthcare', sports: 'operations', realestate: 'finance',
    hr: 'business', agriculture: 'agriculture',
  };

  var FALLBACK_ZONE_PROFILES = {
    tech: [
      { index: 21, weight: 0.12, name: 'Programming' },
      { index: 19, weight: 0.1, name: 'Technology Design' },
      { index: 139, weight: 0.1, name: 'Working with Computers' },
    ],
    finance: [
      { index: 4, weight: 0.1, name: 'Mathematics' },
      { index: 32, weight: 0.1, name: 'Management of Financial Resources' },
    ],
    academic: [
      { index: 0, weight: 0.2, name: 'Reading Comprehension' },
      { index: 4, weight: 0.25, name: 'Mathematics' },
      { index: 7, weight: 0.2, name: 'Active Learning' },
    ],
    business: [
      { index: 11, weight: 0.08, name: 'Coordination' },
      { index: 12, weight: 0.08, name: 'Persuasion' },
    ],
  };

  var ZONE_AGGREGATES_URL = '/data/onet/artifacts/zone-aggregate-vectors.json';

  function deriveZoneProfilesFromAggregates(aggregates, topK) {
    var k = topK || 15;
    var profiles = {};
    var zones = Object.keys(aggregates || {});
    zones.forEach(function (zone) {
      var entry = aggregates[zone];
      // Parity with functions/_lib/onet/zone-profiles-fallback.js: prefer the
      // representativeness-weighted centroid when the artifact carries one.
      var lvMean = Array.isArray(entry) ? entry : (entry && (entry.lvMeanW || entry.lvMean));
      if (!Array.isArray(lvMean)) return;
      var ranked = lvMean.map(function (v, i) {
        return { index: i, score: Number(v) || 0 };
      }).filter(function (d) { return d.score > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, k);
      var sum = ranked.reduce(function (s, d) { return s + d.score; }, 0) || 1;
      profiles[zone] = ranked.map(function (d) {
        return { index: d.index, weight: Math.round((d.score / sum) * 10000) / 10000 };
      });
    });
    return profiles;
  }

  function loadZoneDimensionProfiles() {
    if (zoneProfilesCache) return Promise.resolve(zoneProfilesCache);
    if (zoneProfilesPromise) return zoneProfilesPromise;
    var url = (window.FWAcademicsMap && FWAcademicsMap.ZONE_PROFILES_URL) || ZONE_PROFILES_URL;
    zoneProfilesPromise = fetch(url).then(function (r) {
      if (!r.ok) throw new Error('profiles fetch failed');
      return r.json();
    }).then(function (data) {
      zoneProfilesCache = data;
      return data;
    }).catch(function () {
      return fetch(ZONE_AGGREGATES_URL).then(function (r) {
        if (!r.ok) throw new Error('aggregates fetch failed');
        return r.json();
      }).then(function (agg) {
        zoneProfilesCache = deriveZoneProfilesFromAggregates(agg);
        return zoneProfilesCache;
      });
    }).catch(function () {
      zoneProfilesCache = FALLBACK_ZONE_PROFILES;
      return zoneProfilesCache;
    });
    return zoneProfilesPromise;
  }

  function getZoneProfilesSync() {
    return zoneProfilesCache || FALLBACK_ZONE_PROFILES;
  }

  function resolveThemeZone(themeName) {
    var key = String(themeName || '').trim();
    if (!key) return null;
    if (getZoneProfilesSync()[key]) return key;
    return SECTOR_TO_ZONE_RESUME[key] || key;
  }

  function resumeThemeRules() {
    if (window.FWAcademicsMap && FWAcademicsMap.RESUME_THEME_RULES) {
      return FWAcademicsMap.RESUME_THEME_RULES;
    }
    return [];
  }

  function normalizeThemes(themes) {
    if (!Array.isArray(themes)) return [];
    return themes.map(function (t) {
      if (typeof t === 'string') return { zone: t, weight: 1 };
      return { zone: t.zone, weight: typeof t.weight === 'number' ? t.weight : 1 };
    }).filter(function (t) { return t.zone; });
  }

  function zoneKeyFromTag(tag) {
    if (!tag) return null;
    return String(tag).replace(/^resume:/, '');
  }

  function sharpenPendingByZone(pending, zoneTag) {
    var zoneScores = {};
    var i;
    for (i = 0; i < pending.length; i++) {
      if (pending[i] <= 0 || !zoneTag[i]) continue;
      var z = zoneKeyFromTag(zoneTag[i]);
      if (!z) continue;
      zoneScores[z] = (zoneScores[z] || 0) + pending[i];
    }
    var ranked = Object.keys(zoneScores).map(function (k) {
      return { zone: k, score: zoneScores[k] };
    }).sort(function (a, b) { return b.score - a.score; });
    var dominant = {};
    ranked.slice(0, DOMINANT_ZONE_COUNT).forEach(function (item) {
      dominant[item.zone] = true;
    });
    if (!ranked.length) return;
    for (i = 0; i < pending.length; i++) {
      if (pending[i] <= 0 || !zoneTag[i]) continue;
      var zk = zoneKeyFromTag(zoneTag[i]);
      if (zk && !dominant[zk]) pending[i] *= NON_DOMINANT_ATTENUATION;
    }
  }

  function sharpenObjectiveValues(values) {
    var peak = 0;
    var i;
    for (i = 0; i < values.length; i++) if (values[i] > peak) peak = values[i];
    if (peak <= 0) return values;
    var floor = peak * 0.25;
    for (i = 0; i < values.length; i++) {
      if (values[i] > 0 && values[i] < floor) {
        values[i] = clamp100(Math.round(values[i] * 0.12));
      }
    }
    return values;
  }

  function applyTextRulesToObjective(objectiveVec, text, sourceTag, profiles) {
    var prof = profiles || getZoneProfilesSync();
    var rules = resumeThemeRules();
    var values = (objectiveVec && objectiveVec.values) ? objectiveVec.values.slice() : emptyVector();
    var sources = (objectiveVec && objectiveVec.sources) ? objectiveVec.sources.slice() : new Array(DIM);
    var pending = new Array(DIM);
    var zoneTag = new Array(DIM);
    var i;
    for (i = 0; i < DIM; i++) { pending[i] = 0; zoneTag[i] = null; }
    var blob = String(text || '');

    rules.forEach(function (rule) {
      if (!rule.pattern.test(blob)) return;
      normalizeThemes(rule.themes).forEach(function (theme) {
        var zone = resolveThemeZone(theme.zone);
        if (!zone) return;
        var profile = prof[zone];
        if (!profile || !profile.length) return;
        var themeWeight = theme.weight > 0 ? theme.weight : 1;
        profile.forEach(function (entry) {
          var idx = Number(entry.index);
          if (!Number.isInteger(idx) || idx < 0 || idx >= DIM) return;
          var w = Number(entry.weight) || 0;
          if (w < PROFILE_WEIGHT_FLOOR) return;
          var delta = rule.boost * themeWeight * w * PROFILE_BOOST_SCALE;
          pending[idx] += delta;
          if (!zoneTag[idx]) zoneTag[idx] = 'resume:' + zone;
        });
      });
    });

    sharpenPendingByZone(pending, zoneTag);

    for (i = 0; i < DIM; i++) {
      if (pending[i] <= 0) continue;
      var d = Math.min(pending[i], MAX_THEME_DELTA);
      values[i] = clamp100(Math.min(MAX_RULES_LAYER, values[i] + d));
      sources[i] = sources[i] || zoneTag[i] || sourceTag || 'resume-themed';
    }

    sharpenObjectiveValues(values);

    return {
      schemaId: (objectiveVec && objectiveVec.schemaId) || SCHEMA,
      values: values,
      sources: sources,
      updatedAt: new Date().toISOString(),
      source: sourceTag || 'resume-rules',
    };
  }

  function applyResumeToObjective(objectiveVec, resumeText, profiles) {
    return applyTextRulesToObjective(objectiveVec, resumeText, 'resume-rules', profiles);
  }

  function gpaTierBoost(gpa) {
    var g = Number(gpa);
    if (!Number.isFinite(g)) return 0;
    if (g >= 3.7) return 14;
    if (g >= 3.3) return 10;
    if (g >= 3.0) return 7;
    if (g >= 2.5) return 4;
    return 2;
  }

  var ACADEMICS_DOMAIN_RANGES = {
    skills: [0, 35],
    knowledge: [35, 68],
    abilities: [68, 120],
    workActivities: [120, 161],
  };

  function bumpObjectiveDomain(values, sources, domain, boost, sourceTag) {
    var range = ACADEMICS_DOMAIN_RANGES[domain];
    if (!range) return;
    for (var i = range[0]; i < range[1]; i++) {
      values[i] = clamp100(values[i] + boost);
      sources[i] = sources[i] || sourceTag;
    }
  }

  function stripAcademicsFromObjective(objectiveVec) {
    var base = objectiveVec || { schemaId: SCHEMA, values: emptyVector(), sources: [] };
    var values = base.values ? base.values.slice() : emptyVector();
    var sources = base.sources ? base.sources.slice() : new Array(DIM);
    for (var i = 0; i < DIM; i++) {
      var tag = sources[i];
      if (tag && String(tag).indexOf('academics:') === 0) {
        values[i] = 0;
        sources[i] = null;
      }
    }
    return {
      schemaId: base.schemaId || SCHEMA,
      values: values,
      sources: sources,
      updatedAt: base.updatedAt || new Date().toISOString(),
      source: base.source || 'empty',
    };
  }

  function refreshObjectiveFromAcademics(objectiveVec, academics, profile) {
    var stripped = stripAcademicsFromObjective(objectiveVec);
    if (!academics) return stripped;
    return applyAcademicsToObjective(stripped, academics, profile);
  }

  function applyAcademicsToObjective(objectiveVec, academics, profile) {
    var base = objectiveVec || { schemaId: SCHEMA, values: emptyVector(), sources: [] };
    var values = base.values ? base.values.slice() : emptyVector();
    var sources = base.sources ? base.sources.slice() : new Array(DIM);
    var acad = academics || {};
    var gpaBoost = gpaTierBoost(acad.gpa);
    if (gpaBoost > 0) {
      bumpObjectiveDomain(values, sources, 'skills', gpaBoost, 'academics:gpa');
      bumpObjectiveDomain(values, sources, 'knowledge', Math.round(gpaBoost * 0.6), 'academics:gpa');
    }
    var majorText = [acad.major, profile && profile.school].filter(Boolean).join(' ');
    if (majorText) {
      var majorPatch = applyTextRulesToObjective({ values: values, sources: sources, schemaId: SCHEMA }, majorText, 'academics:major');
      values = majorPatch.values;
      sources = majorPatch.sources;
    }
    if (acad.liked) {
      var likedPatch = applyTextRulesToObjective({ values: values, sources: sources, schemaId: SCHEMA }, acad.liked, 'academics:liked');
      values = likedPatch.values;
      sources = likedPatch.sources;
    }
    if (acad.disliked) {
      var dislikedRules = applyTextRulesToObjective({ values: emptyVector(), sources: [], schemaId: SCHEMA }, acad.disliked, 'academics:disliked');
      for (var i = 0; i < DIM; i++) {
        if (dislikedRules.values[i] > 0) {
          values[i] = clamp100(Math.max(0, values[i] - Math.round(dislikedRules.values[i] * 0.35)));
        }
      }
    }
    if (typeof acad.majorLock === 'number' && acad.majorLock >= 70) {
      bumpObjectiveDomain(values, sources, 'knowledge', 6, 'academics:major-lock');
    }
    if (typeof acad.grad === 'number' && window.FWAcademicsMap && typeof FWAcademicsMap.gradObjectiveText === 'function') {
      var gradTxt = FWAcademicsMap.gradObjectiveText(acad.grad);
      if (gradTxt) {
        var gradPatch = applyTextRulesToObjective(
          { values: values, sources: sources, schemaId: SCHEMA },
          gradTxt,
          'academics:grad',
        );
        values = gradPatch.values;
        sources = gradPatch.sources;
      }
    }
    return {
      schemaId: SCHEMA,
      values: values,
      sources: sources,
      updatedAt: new Date().toISOString(),
      source: 'academics',
    };
  }

  function demandScoreFromJobZone(jobZone) {
    var jz = Number(jobZone);
    if (!Number.isFinite(jz)) return 50;
    return clamp100(40 + jz * 12);
  }

  function computePreparedness(objectiveVec, careerVec) {
    if (!objectiveVec || !careerVec || !window.FWOnetMath) return null;
    var M = FWOnetMath;
    var careerMagSq = M.dot(careerVec, careerVec);
    if (!careerMagSq) return null;
    return clamp100((100 * M.dot(objectiveVec, careerVec)) / careerMagSq);
  }

  function patchQuizObjectiveVector(patchFn) {
    try {
      var quiz = readLocalQuizBlob();
      if (!quiz) return null;
      quiz.objectiveVector = patchFn(quiz.objectiveVector || { schemaId: SCHEMA, values: emptyVector(), sources: [] }, quiz);
      return persistQuizVectors(quiz, { sync: true }).objectiveVector;
    } catch (err) {
      console.warn('[FWOnetVectors] patchQuizObjectiveVector failed', err);
      return null;
    }
  }

  function singleSocFit(soc, quizVecs) {
    if (!soc) return Promise.resolve(null);
    return resolvePersonality({}).then(function (personality) {
      if (!personality || !personality.values) return null;
      return fetchVectorsBatched([soc]).then(function (vectors) {
        var vec = vectors[soc];
        if (!vec) return null;
        var pFit = personalityFitPercent(personality.values, vec);
        var objective = quizVecs && quizVecs.objective;
        var objValues = objective && objective.values ? objective.values : null;
        var objActive = objValues && vectorMagnitude(objValues) > 0.01;
        var oFit = objActive ? objectiveFitFromVectors(objValues, vec) : null;
        return displayFitPercent(personality.values, vec);
      });
    });
  }

  function fitForSlugFromVectors(slug) {
    if (!slug) return Promise.resolve(null);
    var q = readQuizVectors({ hydrate: true });
    if (rankedOnetCache && rankedOnetCache.length) {
      var onetHit = rankedOnetCache.find(function (m) { return m.slug === slug; });
      if (onetHit && Number.isFinite(onetHit.score)) return Promise.resolve(onetHit.score);
    }
    // Resolve the SOC and fetch ONE vector — ranking all 782 careers (20
    // network batches) to answer a single slug was the old fallback order.
    return Promise.resolve(socFromSlugOrParam(slug, null)).then(function (soc) {
      if (soc) return singleSocFit(soc, q);
      // Slug not in the catalog (legacy hub bridge): fall back to the
      // featured-rank path which knows the 40-career aliases.
      return rankFeaturedFromVectors({ scores: q.scores, limit: 45 }).then(function () {
        if (rankedCache && rankedCache.length) {
          var hit = rankedCache.find(function (m) { return m.slug === slug; });
          if (hit && Number.isFinite(hit.score)) return hit.score;
        }
        return null;
      });
    }).catch(function () { return null; });
  }

  function percentileRankForSlug(slug) {
    return fitForSlugFromVectors(slug);
  }

  // Igor's hub heatmap blend, re-applied on sync. Pure and stateless: dot
  // brightness on the career hub map is 0.75 x personality + 0.25 x objective.
  // Lives here because hub-onet-map.js reads it off FWOnetVectors.
  function overallFitScore(personalityFit, objectiveFit) {
    if (personalityFit == null) return null;
    if (objectiveFit == null) return personalityFit;
    return Math.round(0.75 * personalityFit + 0.25 * objectiveFit);
  }

  window.FWOnetVectors = {
    overallFitScore: overallFitScore,
    DIM: DIM,
    SCHEMA: SCHEMA,
    PERSONALITY_SEED_GEN: PERSONALITY_SEED_GEN,
    personalityReseedIsLossless: personalityReseedIsLossless,
    clamp100: clamp100,
    cosine: cosine,
    magnitude: vectorMagnitude,
    objectiveFitFromVectors: objectiveFitFromVectors,
    personalityFitPercent: personalityFitPercent,
    cosinePercent: cosinePercent,
    percentileRank: percentileRank,
    displayFitPercent: displayFitPercent,
    hasVectorSignal: hasVectorSignal,
    seedPersonalityFromQuiz: seedPersonalityFromQuiz,
    writeQuizPersonalityVector: writeQuizPersonalityVector,
    hydrateQuizVectors: hydrateQuizVectors,
    persistQuizVectors: persistQuizVectors,
    readLocalQuizBlob: readLocalQuizBlob,
    loadZoneCentroids: loadZoneCentroids,
    clearRankedCache: clearRankedCache,
    readQuizVectors: readQuizVectors,
    resolvePersonality: resolvePersonality,
    emptyVector: emptyVector,
    rankFeaturedFromVectors: rankFeaturedFromVectors,
    rankOnetCareersFromVectors: rankOnetCareersFromVectors,
    stretchFitCandidates: stretchFitCandidates,
    getCachedOnetRank: getCachedOnetRank,
    getRankCacheVersion: getRankCacheVersion,
    loadOnetCareers: loadOnetCareers,
    resolveOnetCareerBySlug: resolveOnetCareerBySlug,
    resolveLegacyHubSlugToOnet: resolveLegacyHubSlugToOnet,
    getCachedFeaturedRank: getCachedFeaturedRank,
    percentileRankForSlug: percentileRankForSlug,
    fitForSlugFromVectors: fitForSlugFromVectors,
    toHubRankShape: toHubRankShape,
    fitForSlugOrSoc: fitForSlugOrSoc,
    fetchAuthenticatedVectorFit: fetchAuthenticatedVectorFit,
    applyResumeToObjective: applyResumeToObjective,
    applyResumeWithPersonalityBleed: applyResumeWithPersonalityBleed,
    bleedPersonalityFromObjectiveDelta: bleedPersonalityFromObjectiveDelta,
    applyTextRulesToObjective: applyTextRulesToObjective,
    loadZoneDimensionProfiles: loadZoneDimensionProfiles,
    getZoneProfilesSync: getZoneProfilesSync,
    applyAcademicsToObjective: applyAcademicsToObjective,
    stripAcademicsFromObjective: stripAcademicsFromObjective,
    refreshObjectiveFromAcademics: refreshObjectiveFromAcademics,
    patchQuizObjectiveVector: patchQuizObjectiveVector,
    computePreparedness: computePreparedness,
    tradeOffLabel: tradeOffLabel,
    formatFitPercentile: formatFitPercentile,
    renderDualFitBarsHtml: renderDualFitBarsHtml,
    fetchSimilarNeighbors: fetchSimilarNeighbors,
    loadHubMap: loadHubMap,
    fetchVectorsBatched: fetchVectorsBatched,
    getCachedVectorImportance: function (soc) {
      return vectorImportanceCache[soc] || null;
    },
    createVectorFetchQueue: createVectorFetchQueue,
    isObjectiveVectorActive: function (values) {
      return vectorMagnitude(values) > 0.01;
    },
    slugifyTitle: slugifyCareerName,
    getLegacySlugForSoc: function (soc) {
      if (window.FWOnetCatalog && typeof FWOnetCatalog.getLegacySlugForSoc === 'function') {
        return FWOnetCatalog.getLegacySlugForSoc(soc);
      }
      return null;
    },
    resolveSocForSlug: function (slug) {
      return socFromSlugOrParam(slug, null);
    },
    resolveTargetSoc: resolveTargetSoc,
    loadDimensionRegistry: loadDimensionRegistry,
    formatGapList: formatGapList,
    topSkillsFromOnet: topSkillsFromOnet,
    weightedUserComponent: weightedUserComponent,
    dimensionIndexByName: dimensionIndexByName,
    skillPillsDataForCareer: skillPillsDataForCareer,
    skillPillsDataFromNames: skillPillsDataFromNames,
    topDimensionsByDomain: topDimensionsByDomain,
    buildCareerOnetProfile: buildCareerOnetProfile,
    userVsCareerDimensions: userVsCareerDimensions,
    objectiveVsCareerDimensions: objectiveVsCareerDimensions,
    vectorInputsHash: vectorInputsHash,
  };

  function bootHydrateQuizVectors() {
    var blob = readLocalQuizBlob();
    if (!blob) return;
    if (!blob.refine && !blob.academics && !blob.resumeText && !blob.academicsTranscript) return;
    try {
      persistQuizVectors(blob, { sync: false, dispatchEvents: false });
    } catch (_) { /* ignore */ }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootHydrateQuizVectors);
    } else {
      bootHydrateQuizVectors();
    }
  }
})();
