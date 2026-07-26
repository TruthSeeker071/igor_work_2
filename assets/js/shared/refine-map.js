/**
 * Sharpen-panel answers → O*NET personality / objective vector bumps.
 * Sources tagged refine:* for strip/reapply idempotency.
 */
(function (global) {
  var SCHEMA = 'onet-lv-161-v1';
  var DIM = 161;

  var DOMAIN_INDEX_RANGES = {
    skills: [0, 35],
    knowledge: [35, 68],
    abilities: [68, 120],
    workActivities: [120, 161],
  };

  var SUBJECT_TEXT = {
    math: 'math statistics calculus',
    writing: 'writing english literature',
    science: 'science biology chemistry physics',
    art: 'art design creative',
    business: 'business finance marketing',
    tech: 'programming software computer coding',
    psych: 'psychology social education',
    politics: 'politics law government',
    medicine: 'medicine healthcare nursing',
    engineering: 'engineering mechanical civil',
    economics: 'economics finance business',
    film: 'film media marketing creative',
    global: 'social government law',
    hands: 'trades engineering building',
    cyber: 'cybersecurity programming tech',
    hospitality: 'hospitality business service',
  };

  function clamp100(n) {
    return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  }

  function emptyVector() {
    var v = new Array(DIM);
    for (var i = 0; i < DIM; i++) v[i] = 0;
    return v;
  }

  function bumpDomainPending(pending, domain, boost) {
    var range = DOMAIN_INDEX_RANGES[domain];
    if (!range || !boost) return;
    for (var i = range[0]; i < range[1]; i++) pending[i] += boost;
  }

  // Sharpen answers bump whole 33-52 dimension domains at once, so ungated they
  // pile far more mass onto the vector than the quiz seed carries and flatten
  // the direction it established. Total |delta| the sharpen layer may apply,
  // after per-dim direction gating (parity: functions/_lib/onet/refine-map.js).
  var REFINE_L1_BUDGET = 120;

  function gateRefinePending(values, pending) {
    if (global.FWOnetMath && typeof FWOnetMath.gateLayerDeltas === 'function') {
      return FWOnetMath.gateLayerDeltas(values, pending, REFINE_L1_BUDGET, 50);
    }
    return pending;
  }

  // Tags carry the pre-bump value ("refine:42") so strip restores the base
  // exactly instead of zeroing it — strip/reapply must be a true inverse or
  // every hydration destroys the quiz-seeded personality in bumped domains.
  // Legacy name tags ("refine:hours") have no number and restore to 0, which
  // matches the old steady state so existing profiles don't jump.
  function stripTagged(vec, prefix) {
    var base = vec || { schemaId: SCHEMA, values: emptyVector(), sources: [] };
    var values = base.values ? base.values.slice() : emptyVector();
    var sources = base.sources ? base.sources.slice() : new Array(DIM);
    for (var i = 0; i < DIM; i++) {
      var tag = sources[i];
      if (tag && String(tag).indexOf(prefix) === 0) {
        var restored = parseFloat(String(tag).slice(prefix.length));
        values[i] = Number.isFinite(restored) ? clamp100(restored) : 0;
        sources[i] = null;
      }
    }
    var out = {
      schemaId: base.schemaId || SCHEMA,
      values: values,
      sources: sources,
      updatedAt: base.updatedAt,
      source: base.source,
    };
    if (base.confidence) out.confidence = base.confidence;
    return out;
  }

  function stripRefineFromPersonality(personalityVec) {
    return stripTagged(personalityVec, 'refine:');
  }

  function stripRefineFromObjective(objectiveVec) {
    return stripTagged(objectiveVec, 'refine-obj:');
  }

  function applyTextToObjective(objectiveVec, text, tag) {
    if (!global.FWOnetVectors || typeof FWOnetVectors.applyTextRulesToObjective !== 'function') {
      return objectiveVec;
    }
    return FWOnetVectors.applyTextRulesToObjective(objectiveVec, text, tag);
  }

  function subjectsObjectiveText(refine) {
    var tags = refine && refine.subjects;
    if (!Array.isArray(tags) || !tags.length) return '';
    return tags.map(function (t) {
      var key = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
      var keys = Object.keys(SUBJECT_TEXT);
      for (var i = 0; i < keys.length; i++) {
        if (key.indexOf(keys[i]) >= 0) return SUBJECT_TEXT[keys[i]];
      }
      return String(t || '').replace(/[^\w\s]/g, ' ');
    }).join(' ');
  }

  function applyRefineToPersonality(personalityVec, refine) {
    var base = stripRefineFromPersonality(personalityVec);
    var values = base.values.slice();
    var sources = base.sources ? base.sources.slice() : new Array(DIM);
    var a = refine || {};
    var pending = emptyVector();

    if (typeof a.hours === 'number') {
      var hx = a.hours / 100;
      bumpDomainPending(pending, 'workActivities', Math.round(hx * 9));
      bumpDomainPending(pending, 'abilities', Math.round((1 - hx) * 5));
    }
    if (typeof a.intensity === 'number') {
      var ix = a.intensity / 100;
      bumpDomainPending(pending, 'workActivities', Math.round(ix * 10));
      bumpDomainPending(pending, 'abilities', Math.round((1 - ix) * 4));
    }
    if (typeof a.creative === 'number') {
      var cx = a.creative / 100;
      bumpDomainPending(pending, 'abilities', Math.round(cx * 8));
      bumpDomainPending(pending, 'knowledge', Math.round((1 - cx) * 6));
    }
    if (typeof a.social === 'number') {
      var sx = a.social / 100;
      bumpDomainPending(pending, 'workActivities', Math.round(sx * 8));
      bumpDomainPending(pending, 'abilities', Math.round((1 - sx) * 5));
    }
    if (typeof a.workday === 'number') {
      var wd = [
        { workActivities: 10, skills: 8 },
        { workActivities: 9, abilities: 6 },
        { abilities: 9, workActivities: 5 },
        { workActivities: 8, abilities: 7 },
        { knowledge: 9, abilities: 6 },
      ];
      var pick = wd[a.workday] || wd[2];
      Object.keys(pick).forEach(function (dom) {
        bumpDomainPending(pending, dom, pick[dom]);
      });
    }
    if (typeof a.problem === 'number') {
      var pb = [
        { knowledge: 8, skills: 6 },
        { abilities: 9, skills: 5 },
        { workActivities: 9, abilities: 5 },
        { knowledge: 7, workActivities: 6 },
      ];
      var pp = pb[a.problem] || pb[0];
      Object.keys(pp).forEach(function (dom) {
        bumpDomainPending(pending, dom, pp[dom]);
      });
    }
    if (typeof a.path === 'number') {
      var pt = [
        { workActivities: 8, knowledge: 5 },
        { knowledge: 8, abilities: 6 },
        { abilities: 5, workActivities: 5 },
        { workActivities: 7, skills: 6 },
        { abilities: 10, skills: 7 },
      ];
      var pathPick = pt[a.path] || pt[2];
      Object.keys(pathPick).forEach(function (dom) {
        bumpDomainPending(pending, dom, pathPick[dom]);
      });
    }

    var gated = gateRefinePending(values, pending);
    for (var i = 0; i < DIM; i++) {
      if (!gated[i]) continue;
      var next = clamp100(values[i] + gated[i]);
      if (next === values[i]) continue;
      sources[i] = 'refine:' + values[i];
      values[i] = next;
    }

    var out = {
      schemaId: base.schemaId || SCHEMA,
      values: values,
      sources: sources,
      updatedAt: new Date().toISOString(),
      source: base.source || 'refine-rules',
    };
    if (base.confidence) out.confidence = base.confidence;
    return out;
  }

  function applyRefineToObjective(objectiveVec, refine) {
    var base = stripRefineFromObjective(objectiveVec);
    var a = refine || {};
    var out = base;
    var subj = subjectsObjectiveText(a);
    if (subj) out = applyTextToObjective(out, subj, 'refine-obj:subjects');
    var mcText = {
      workday: [
        'programming software engineering tech coding computer science',
        'business finance strategy meetings law negotiations',
        'design creative marketing media production',
        'healthcare education social work clients patients',
        'research science analysis writing deep thought',
      ],
      problem: [
        'data statistics finance science analysis crunch numbers',
        'design creative prototyping startups innovation',
        'consensus leadership business social communication',
        'engineering methodology healthcare law frameworks',
      ],
      path: [
        'finance business law corporate ladder stable',
        'healthcare education law professional craft expertise',
        'balanced business tech marketing growth',
        'tech marketing startups fast company',
        'entrepreneur startups founder builder bold',
      ],
    };
    Object.keys(mcText).forEach(function (key) {
      if (typeof a[key] !== 'number') return;
      var list = mcText[key];
      var text = list && list[a[key]];
      if (text) out = applyTextToObjective(out, text, 'refine-obj:' + key);
    });
    return out;
  }

  function refreshPersonalityFromRefine(personalityVec, refine) {
    if (!refine) return personalityVec;
    return applyRefineToPersonality(personalityVec, refine);
  }

  function refreshObjectiveFromRefine(objectiveVec, refine) {
    if (!refine) return objectiveVec;
    return applyRefineToObjective(objectiveVec, refine);
  }

  global.FWRefineMap = {
    stripRefineFromPersonality: stripRefineFromPersonality,
    stripRefineFromObjective: stripRefineFromObjective,
    applyRefineToPersonality: applyRefineToPersonality,
    applyRefineToObjective: applyRefineToObjective,
    refreshPersonalityFromRefine: refreshPersonalityFromRefine,
    refreshObjectiveFromRefine: refreshObjectiveFromRefine,
  };
}(typeof window !== 'undefined' ? window : globalThis));
