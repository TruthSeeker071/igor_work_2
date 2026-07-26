/**
 * FWUser — the client face of the canonical user object.
 *
 * Mirrors functions/_lib/user-model.js VERBATIM (KEY_MAP, normalize,
 * denormalize): scripts/test-user-model.mjs diffs the two maps and their
 * normalize outputs, so a change to either file without the other fails
 * test:user. Storage stays the legacy fw_hub_quiz_v1 blob until Phase 4;
 * FWUser.get() reads a normalized view over it, FWUser.update() writes back
 * through FWAuth's save path so the no-op-save hash guard and the GET-merge-
 * PUT field protections keep working unchanged.
 *
 * Load order: after auth.js (update() uses FWAuth when present), before any
 * consumer that calls FWUser.
 */
(function () {
  var HUB_QUIZ_KEY = 'fw_hub_quiz_v1'; // legacy key: promoted then deleted at boot
  var USER_KEY = 'fw_user_v1';         // canonical storage since Phase 4 — holds the v2 user

  // [v1 path, v2 path] — the two-home rows list the winner first: root school
  // before profile.school, academics.gpa (panel-edited) before profile.gpa
  // (written once at quiz completion). See user-model.js for the full spec.
  var KEY_MAP = [
    ['name', 'identity.name'],
    ['school', 'identity.school'],
    ['profile.school', 'identity.school'],
    ['profile.schoolCity', 'identity.schoolCity'],
    ['profile.year', 'identity.year'],
    ['academics.gpa', 'identity.gpa'],
    ['profile.gpa', 'identity.gpa'],
    ['profile.subjects', 'identity.subjects'],
    ['profile.careerLeaning', 'identity.careerLeaning'],
    ['careerLeaningSoc', 'identity.careerLeaningSoc'],
    // S18 Semester Loop — see user-model.js for why these are three scalars and
    // not one `term` object. Mirror of the `terms` row (0026), never its master.
    ['termSystem', 'identity.termSystem'],
    ['termStart', 'identity.termStart'],
    ['termEnd', 'identity.termEnd'],
    ['personalityVector', 'vectors.personality'],
    ['objectiveVector', 'vectors.objective'],
    ['vectorSchemaId', 'vectors.schemaId'],
    ['objectiveSkipped', 'vectors.objectiveSkipped'],
    ['objectiveAiPatch', 'vectors.objectiveAiPatch'],
    ['personalityPatchFailed', 'vectors.personalityPatchFailed'],
    ['scores', 'assessment.scores'],
    ['scoresRaw', 'assessment.scoresRaw'],
    ['traits', 'assessment.traits'],
    ['characterSummary', 'assessment.characterSummary'],
    ['sectorFitSheet', 'assessment.sectorFitSheet'],
    ['enrichBoosts', 'assessment.enrichBoosts'],
    ['customAnswers', 'assessment.customAnswers'],
    ['careerFocus', 'focus.careerFocus'],
    ['careerFocusHistory', 'focus.careerFocusHistory'],
    ['academics', 'focus.academics'],
    ['academicsTranscript', 'focus.academicsTranscript'],
    ['resumeText', 'resume.text'],
    ['resumeSummary', 'resume.summary'],
    ['resumeBoosts', 'resume.boosts'],
    ['profileBuilding', 'journey.profileBuilding'],
    ['refine', 'journey.refine'],
    ['portalSnapshot', 'journey.portalSnapshot'],
    ['profileAlignment', 'journey.profileAlignment'],
    ['featureIntros', 'journey.featureIntros'],
  ];

  var GROUPS = ['identity', 'vectors', 'assessment', 'focus', 'resume', 'journey'];

  function getPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i += 1) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function emptyUser() {
    var user = { v: 2 };
    GROUPS.forEach(function (g) { user[g] = {}; });
    return user;
  }

  var V1_ROOT_KEYS = {};
  var V1_PROFILE_KEYS = {};
  var V2_IDENTITY_KEYS = {};
  KEY_MAP.forEach(function (row) {
    var v1 = row[0];
    var v2 = row[1];
    if (v1.indexOf('.') === -1) V1_ROOT_KEYS[v1] = true;
    if (v1.indexOf('profile.') === 0) V1_PROFILE_KEYS[v1.slice(8)] = true;
    if (v2.indexOf('identity.') === 0) V2_IDENTITY_KEYS[v2.slice(9)] = true;
  });

  function isBlank(v) { return v === undefined || v === null || v === ''; }

  // v2 holds exactly one GPA (identity.gpa). A stored blob written before the
  // GPA merge — or one mutated through focus.academics — carries a second copy
  // there; it is the academics panel's, so adopt it and drop the key.
  function stripAcademicsGpa(user) {
    var acad = user.focus && user.focus.academics;
    if (!acad || typeof acad !== 'object' || !('gpa' in acad)) return user;
    var copy = Object.assign({}, acad);
    delete copy.gpa;
    user.focus.academics = copy;
    return user;
  }

  function adoptAcademicsGpa(user) {
    var acad = user.focus && user.focus.academics;
    if (!acad || typeof acad !== 'object' || !('gpa' in acad)) return user;
    if (!isBlank(acad.gpa)) setPath(user, 'identity.gpa', acad.gpa);
    return stripAcademicsGpa(user);
  }

  function normalizeUser(raw) {
    if (!raw || typeof raw !== 'object') return emptyUser();
    if (raw.v === 2) return adoptAcademicsGpa(raw);
    var user = emptyUser();
    KEY_MAP.forEach(function (row) {
      var val = getPath(raw, row[0]);
      if (val === undefined) return;
      var existing = getPath(user, row[1]);
      if (existing !== undefined && !isBlank(existing)) return;
      if (existing !== undefined && isBlank(val)) return;
      setPath(user, row[1], val);
    });
    if (raw.profile && typeof raw.profile === 'object') {
      Object.keys(raw.profile).forEach(function (k) {
        if (!V1_PROFILE_KEYS[k]) user.identity[k] = raw.profile[k];
      });
    }
    Object.keys(raw).forEach(function (k) {
      if (V1_ROOT_KEYS[k] || k === 'profile') return;
      if (k === 'v' || GROUPS.indexOf(k) !== -1 || k === '_legacy') {
        if (!user._legacy) user._legacy = {};
        user._legacy[k] = raw[k];
        return;
      }
      user[k] = raw[k];
    });
    // The academics.gpa row already adopted the panel's value with the right
    // precedence; drop the copy so v2 holds exactly one GPA.
    return stripAcademicsGpa(user);
  }

  function denormalizeUser(user) {
    if (!user || typeof user !== 'object') return {};
    if (user.v !== 2) return user;
    var out = {};
    KEY_MAP.forEach(function (row) {
      if (row[1] === 'identity.school') return; // handled below — two homes
      if (row[0] === 'academics.gpa') return;   // handled below — two homes
      var val = getPath(user, row[1]);
      if (val !== undefined) setPath(out, row[0], val);
    });
    var school = getPath(user, 'identity.school');
    if (school !== undefined) {
      if (typeof school === 'string' && school.trim()) {
        out.school = school;
        setPath(out, 'profile.school', school);
      } else {
        setPath(out, 'profile.school', school);
      }
    }
    // GPA's second home: rewritten from identity.gpa, and created when the
    // student never opened the academics panel, so the vector GPA boost and
    // every other academics.gpa reader see the one live value. A blank GPA is
    // never fabricated (gpaTierBoost reads null as 0).
    var gpa = getPath(user, 'identity.gpa');
    var acad = out.academics && typeof out.academics === 'object' ? out.academics : null;
    if (gpa !== undefined && (!isBlank(gpa) || acad)) {
      out.academics = acad ? Object.assign({}, acad, { gpa: gpa }) : { gpa: gpa };
    }
    if (user.identity && typeof user.identity === 'object') {
      Object.keys(user.identity).forEach(function (k) {
        if (!V2_IDENTITY_KEYS[k]) setPath(out, 'profile.' + k, user.identity[k]);
      });
    }
    Object.keys(user).forEach(function (k) {
      if (k === 'v' || GROUPS.indexOf(k) !== -1 || k === '_legacy') return;
      out[k] = user[k];
    });
    if (user._legacy && typeof user._legacy === 'object') {
      Object.keys(user._legacy).forEach(function (k) { out[k] = user._legacy[k]; });
    }
    return out;
  }

  function readRaw() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : null;
    } catch (_) { return null; }
  }

  function writeStored(user) {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return true;
    } catch (_) { return false; }
  }

  // One-time boot migration: promote the legacy v1 blob to fw_user_v1 and
  // delete the old key — also when a prior boot (the rollback release) already
  // promoted it and left the legacy copy behind. The key survives only when
  // it holds the sole copy and promotion failed (corrupt JSON, full storage).
  try {
    var legacyRaw = localStorage.getItem(HUB_QUIZ_KEY);
    if (legacyRaw !== null) {
      var promoted = !!localStorage.getItem(USER_KEY);
      if (!promoted) {
        var legacy = JSON.parse(legacyRaw);
        if (legacy && typeof legacy === 'object') promoted = writeStored(normalizeUser(legacy));
      }
      if (promoted) localStorage.removeItem(HUB_QUIZ_KEY);
    }
  } catch (_) { /* private mode / corrupt legacy blob */ }

  /** Normalized user view over the stored blob; null when nothing is stored. */
  function get() {
    var raw = readRaw();
    return raw ? normalizeUser(raw) : null;
  }

  /**
   * v1-shaped view of the stored profile — the working shape of the legacy
   * vector/merge modules. Runs the full normalize→denormalize conversion so a
   * v2-stored payload (Phase 4) reads identically; until then it is identity
   * plus the school mirror.
   */
  function getBlob() {
    var raw = readRaw();
    return raw ? denormalizeUser(normalizeUser(raw)) : null;
  }

  /**
   * Write a v1-shaped working blob back to storage. Since Phase 4 the stored
   * shape is v2 under fw_user_v1 — the conversion lives here; callers never
   * changed. Returns false when storage rejected the write.
   */
  function putBlob(v1) {
    if (!v1 || typeof v1 !== 'object') return false;
    return writeStored(normalizeUser(v1));
  }

  /**
   * update(function (user) { ...mutate... }, opts) — normalize, mutate, write
   * back through FWAuth so the hash-guarded GET-merge-PUT sync path (and its
   * field-preservation merges) stay in charge of persistence. Pass
   * { sync: false } for local-mirror writes the server already has.
   */
  function update(mutator, opts) {
    var user = normalizeUser(readRaw() || {});
    var result = (typeof mutator === 'function' ? mutator(user) : null) || user;
    writeStored(normalizeUser(result));
    if (!(opts && opts.sync === false)
        && window.FWAuth && typeof FWAuth.uploadLocalQuizIfPresent === 'function') {
      try { FWAuth.uploadLocalQuizIfPresent(); } catch (_) {}
    }
    return result;
  }

  window.FWUser = {
    KEY_MAP: KEY_MAP,
    normalizeUser: normalizeUser,
    denormalizeUser: denormalizeUser,
    getUserField: getPath,
    emptyUser: emptyUser,
    get: get,
    update: update,
    getBlob: getBlob,
    putBlob: putBlob,
  };
})();
