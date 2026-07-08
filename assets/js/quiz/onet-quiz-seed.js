(function () {
  var centroidsPromise = null;

  function loadZoneCentroids() {
    if (!centroidsPromise) {
      centroidsPromise = fetch('/data/onet/artifacts/zone-centroids.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return centroidsPromise;
  }

  function attachVectorsToPayload(payload) {
    if (!window.FWOnetVectors || !payload || !payload.scores) return Promise.resolve(payload);
    return loadZoneCentroids().then(function (zc) {
      if (!zc) return payload;
      payload.vectorSchemaId = FWOnetVectors.SCHEMA;
      payload.personalityVector = FWOnetVectors.seedPersonalityFromQuiz(payload.scores, zc);
      payload.objectiveVector = {
        schemaId: FWOnetVectors.SCHEMA,
        values: FWOnetVectors.emptyVector(),
        sources: [],
        updatedAt: new Date().toISOString(),
        source: 'quiz-empty',
      };
      return payload;
    });
  }

  /**
   * FW2.0 A2 — static map: O*NET dimension id → follow-up question templates that
   * best "firm up" a low-confidence (estimated) coordinate. profile-building.js
   * reads ?dims=<id,id> (set by the Dimension Viewer "firm up" CTA) and front-loads
   * the matching prompts so the next 3 questions raise those specific bars from
   * estimated → quiz-anchored. Keyed by dimension id; values are prompt seeds the
   * quiz engine expands. Extend as the registry grows — unknown ids fall back to
   * the default question flow.
   */
  var DIM_QUESTION_MAP = {
    // Skills / cognitive
    'skill.critical_thinking': ['When a plan breaks mid-way, do you rework it yourself or escalate?'],
    'skill.complex_problem_solving': ['Do you enjoy untangling problems with no obvious right answer?'],
    'skill.active_learning': ['How often do you pick up a new tool just to see how it works?'],
    'skill.mathematics': ['Are you comfortable reasoning with numbers and quantities day to day?'],
    'skill.writing': ['Do you like turning messy ideas into clear written explanations?'],
    // Work styles / interests
    'style.attention_to_detail': ['Do small errors in your work bother you enough to double-check?'],
    'style.leadership': ['Do you tend to take charge when a group has no clear direction?'],
    'style.social_orientation': ['Do you get energy from working closely with other people?'],
    'interest.investigative': ['Would you rather research the answer than be handed it?'],
    'interest.artistic': ['Do you look for ways to make things original or expressive?'],
    'interest.enterprising': ['Do you like persuading people toward a goal you set?'],
  };

  /** Return the prompt seeds for a list of dim ids (order preserved, dedup'd). */
  function questionsForDims(ids) {
    var out = [];
    (ids || []).forEach(function (id) {
      var qs = DIM_QUESTION_MAP[id];
      if (qs) qs.forEach(function (q) { if (out.indexOf(q) === -1) out.push(q); });
    });
    return out;
  }

  window.FWOnetQuizSeed = {
    loadZoneCentroids: loadZoneCentroids,
    attachVectorsToPayload: attachVectorsToPayload,
    DIM_QUESTION_MAP: DIM_QUESTION_MAP,
    questionsForDims: questionsForDims,
  };
})();
