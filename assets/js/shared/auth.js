(function (global) {
  const ANALYSIS_CACHE_KEY = 'fw_career_analysis_v6';
  const ROADMAP_KEY = 'fw_roadmap_v1';
  const MIN_PASSWORD_LEN = 8;
  const AUTH_FETCH_TIMEOUT_MS = 30000;

  let sessionEmail = null;
  let sessionVerified = null; // raw `verified` from the last /auth/me; null = not yet known
  let bootPromise = null;

  // Every failure that can reach a display site goes through FWErr, so server
  // dev-speak never lands in the UI. (fw-errors.js loads before auth.js on
  // every page; the fallback keeps auth working if it ever doesn't.)
  function respError(resp, data, fallback) {
    return global.FWErr
      ? FWErr.fromResponse(resp ? resp.status : 0, data, fallback)
      : new Error(fallback);
  }

  function authFetchTimeoutSignal(existingSignal, timeoutMs) {
    var controller = new AbortController();
    var limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : AUTH_FETCH_TIMEOUT_MS;
    var timer = setTimeout(function () { controller.abort(); }, limit);

    function cleanup() {
      clearTimeout(timer);
    }

    if (existingSignal) {
      if (existingSignal.aborted) {
        controller.abort();
        cleanup();
      } else {
        existingSignal.addEventListener('abort', function () {
          controller.abort();
          cleanup();
        }, { once: true });
      }
    }

    if (controller.signal.aborted) {
      cleanup();
    } else {
      controller.signal.addEventListener('abort', cleanup, { once: true });
    }

    return controller.signal;
  }

  // Timeout policy: every authFetch is capped at AUTH_FETCH_TIMEOUT_MS (30s)
  // via authFetchTimeoutSignal unless the caller passes timeoutMs. Known
  // long-running endpoints override: roadmap generate 120s, resume parse
  // 60–120s, career analysis 90s, switch advisor 90s, coach chat 60s.
  function authFetch(path, opts) {
    const options = Object.assign({ credentials: 'include' }, opts || {});
    const fetchTimeoutMs = options.timeoutMs;
    if (fetchTimeoutMs != null) delete options.timeoutMs;
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      options.body = JSON.stringify(options.body);
    }
    options.signal = authFetchTimeoutSignal(options.signal, fetchTimeoutMs);
    return fetch(path, options).catch(function (err) {
      if (err && err.name === 'AbortError') {
        throw global.FWErr
          ? FWErr.friendly('Request timed out. Check your connection and try again.')
          : new Error('Request timed out. Check your connection and try again.');
      }
      throw err;
    });
  }

  function scheduleQuizProfileSync(context) {
    syncQuizProfile().catch(function (err) {
      console.warn(context || 'quiz profile sync failed', err);
    });
  }

  async function parseJson(resp) {
    const text = await resp.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      // Never hand the raw body back — it becomes data.error and would reach
      // the UI. Log it for debugging, return nothing usable.
      if (text) console.warn('[auth] non-JSON response', text.slice(0, 200));
      return {};
    }
  }

  // Storage goes through FWUser's v1-shaped blob view (user.js loads directly
  // after this file on every page) — the Phase 4 storage flip happens inside
  // that facade. The scores-check + sector-sheet materialization semantics of
  // readLocalQuiz are preserved on top of the view.
  function readLocalQuiz() {
    try {
      if (!global.FWUser || typeof FWUser.getBlob !== 'function') return null;
      const data = FWUser.getBlob();
      if (data && data.scores && typeof data.scores === 'object') {
        if (global.FWSectorFitSheet && typeof FWSectorFitSheet.ensureSectorFitSheet === 'function') {
          FWSectorFitSheet.ensureSectorFitSheet(data);
        }
        return data;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function writeLocalQuiz(profile) {
    if (!profile || typeof profile !== 'object') return;
    try {
      if (global.FWUser && typeof FWUser.putBlob === 'function') FWUser.putBlob(profile);
    } catch (_) { /* ignore */ }
  }

  function readProfileBuilding() {
    const quiz = readLocalQuiz();
    if (!quiz || !quiz.profileBuilding || typeof quiz.profileBuilding !== 'object') {
      return { version: 1, answers: [] };
    }
    return quiz.profileBuilding;
  }

  function writeProfileBuilding(patch) {
    const quiz = readLocalQuiz() || { scores: {} };
    const current = readProfileBuilding();
    const next = Object.assign({}, current, patch || {});
    if (!Array.isArray(next.answers)) next.answers = current.answers || [];
    quiz.profileBuilding = next;
    writeLocalQuiz(quiz);
    return next;
  }

  function profileBuildingAnswersForApi(pb) {
    if (!pb || !Array.isArray(pb.answers)) return [];
    return pb.answers
      .filter(function (a) { return a && a.prompt && a.answer; })
      .map(function (a) {
        return {
          id: a.id,
          prompt: String(a.prompt).slice(0, 240),
          answer: String(a.answer).trim().slice(0, 400),
        };
      })
      .slice(0, 8);
  }

  var DOSSIER_FP_KEY = 'fw_dossier_fp';

  function hashString(str) {
    var s = String(str || '');
    var hash = 5381;
    for (var i = 0; i < s.length; i += 1) {
      hash = ((hash << 5) + hash) + s.charCodeAt(i);
      hash &= hash;
    }
    return (hash >>> 0).toString(36);
  }

  function readDossierFingerprint() {
    try {
      return localStorage.getItem(DOSSIER_FP_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function writeDossierFingerprint(fp) {
    if (!fp) return;
    try {
      localStorage.setItem(DOSSIER_FP_KEY, String(fp));
    } catch (_) { /* ignore */ }
  }

  function bumpDossierFingerprint() {
    writeDossierFingerprint('bump:' + Date.now());
  }

  function computePortalInputsHash(quiz) {
    if (!quiz || typeof quiz !== 'object') return '';
    var pb = quiz.profileBuilding;
    var sheet = quiz.sectorFitSheet;
    var payload = {
      scores: quiz.scores || {},
      sectorUpdatedAt: String((sheet && sheet.updatedAt) || ''),
      characterSummary: String(quiz.characterSummary || ''),
      traits: Array.isArray(quiz.traits) ? quiz.traits : [],
      pb: Array.isArray(pb && pb.answers)
        ? pb.answers.map(function (a) {
          return { id: a.id, answer: String(a.answer || '').trim() };
        })
        : [],
      dossierFp: readDossierFingerprint(),
      personalityVecAt: String((quiz.personalityVector && quiz.personalityVector.updatedAt) || ''),
      objectiveVecAt: String((quiz.objectiveVector && quiz.objectiveVector.updatedAt) || ''),
      vectorSchemaId: String(quiz.vectorSchemaId || ''),
    };
    // The snapshot's prose is written by the model against careerPool's fit
    // percentages (see buildCareerPoolForApi), so a change to how fit is scored
    // has to invalidate it even when the user's vectors have not moved — the
    // vector timestamps above cannot see a formula change.
    // Version 1 is omitted on purpose: including it would rewrite every
    // existing hash and regenerate every snapshot through the AI for a scoring
    // change that has not happened yet. It starts salting at the first bump.
    var fitMath = (global.FWOnetMath && FWOnetMath.FIT_MATH_VERSION) || 1;
    if (fitMath > 1) payload.fitMathVersion = fitMath;
    return hashString(JSON.stringify(payload));
  }

  function applySectorFitFromResponse(resp) {
    if (!resp || !resp.sectorFitSheet) return;
    var quiz = readLocalQuiz();
    if (!quiz || !global.FWSectorFitSheet) return;
    FWSectorFitSheet.applyServerSheet(quiz, resp.sectorFitSheet);
    writeLocalQuiz(quiz);
    if (global.FWHubCareers && typeof FWHubCareers.applyQuizScores === 'function') {
      FWHubCareers.applyQuizScores(FWSectorFitSheet.getCanonicalScores(quiz));
    }
  }

  function applyObjectiveFromResponse(resp) {
    if (!resp || typeof resp !== 'object') return;
    var quiz = readLocalQuiz() || {};
    var changed = false;
    if (resp.objectiveVector && resp.objectiveVector.values) {
      quiz.objectiveVector = resp.objectiveVector;
      quiz.objectiveSkipped = false;
      changed = true;
    }
    // The replayable AI patch record must be stored too — the vector alone is
    // rebuilt from rules on the next hydration and the enrichment would vanish.
    if (resp.objectiveAiPatch && resp.objectiveAiPatch.dimensions) {
      quiz.objectiveAiPatch = resp.objectiveAiPatch;
      changed = true;
    }
    if (resp.summary) {
      quiz.resumeSummary = String(resp.summary).slice(0, 1200);
      changed = true;
    }
    if (resp.industryBoosts && typeof resp.industryBoosts === 'object') {
      quiz.resumeBoosts = resp.industryBoosts;
      changed = true;
    }
    if (resp.resumeText) {
      quiz.resumeText = String(resp.resumeText).slice(0, 12000);
      changed = true;
    }
    if (resp.extractedText) {
      quiz.resumeText = String(resp.extractedText).slice(0, 12000);
      changed = true;
    }
    if (resp.roadmap && ROADMAP_KEY) {
      try { localStorage.setItem(ROADMAP_KEY, JSON.stringify(resp.roadmap)); } catch (_) { /* ignore */ }
    }
    if (!changed) return;
    writeLocalQuiz(quiz);
    if (global.FWOnetVectors && typeof FWOnetVectors.clearRankedCache === 'function') {
      FWOnetVectors.clearRankedCache();
    }
    uploadLocalQuizIfPresent().catch(function () { /* ignore */ });
    try {
      global.dispatchEvent(new CustomEvent('fw-objective-updated'));
    } catch (_) { /* ignore */ }
  }

  function applyPersonalityFromResponse(resp) {
    if (!resp || typeof resp !== 'object') return;
    if (!resp.personalityVector || !resp.personalityVector.values) return;
    var quiz = readLocalQuiz() || {};
    quiz.personalityVector = resp.personalityVector;
    if (resp.scores && typeof resp.scores === 'object') {
      quiz.scores = resp.scores;
    }
    writeLocalQuiz(quiz);
    if (global.FWHubCareers && typeof FWHubCareers.applyQuizScores === 'function' && quiz.scores) {
      FWHubCareers.applyQuizScores(quiz.scores);
    }
    if (global.FWOnetVectors && typeof FWOnetVectors.clearRankedCache === 'function') {
      FWOnetVectors.clearRankedCache();
    }
    uploadLocalQuizIfPresent().catch(function () { /* ignore */ });
    try {
      global.dispatchEvent(new CustomEvent('fw-personality-updated'));
    } catch (_) { /* ignore */ }
  }

  function applyVectorsFromResponse(resp) {
    if (!resp || typeof resp !== 'object') return;
    var quiz = readLocalQuiz() || {};
    var changed = false;
    if (resp.personalityVector && resp.personalityVector.values) {
      quiz.personalityVector = resp.personalityVector;
      changed = true;
    }
    if (resp.objectiveVector && resp.objectiveVector.values) {
      quiz.objectiveVector = resp.objectiveVector;
      quiz.objectiveSkipped = false;
      changed = true;
    }
    if (resp.objectiveAiPatch && resp.objectiveAiPatch.dimensions) {
      quiz.objectiveAiPatch = resp.objectiveAiPatch;
      changed = true;
    }
    if (!changed) return;
    writeLocalQuiz(quiz);
    if (global.FWOnetVectors && typeof FWOnetVectors.clearRankedCache === 'function') {
      FWOnetVectors.clearRankedCache();
    }
    uploadLocalQuizIfPresent().catch(function () { /* ignore */ });
    try {
      global.dispatchEvent(new CustomEvent('fw-objective-updated'));
      global.dispatchEvent(new CustomEvent('fw-personality-updated'));
    } catch (_) { /* ignore */ }
  }

  function readPortalSnapshot() {
    var quiz = readLocalQuiz();
    var snap = (quiz && quiz.portalSnapshot) ? quiz.portalSnapshot : null;
    if (snap && snap.source === 'fallback') return null;
    return snap;
  }

  function writePortalSnapshot(snapshot) {
    var quiz = readLocalQuiz();
    if (!quiz || !snapshot) return;
    quiz.portalSnapshot = snapshot;
    writeLocalQuiz(quiz);
    if (snapshot.dossierFp) writeDossierFingerprint(snapshot.dossierFp);
  }

  function buildCareerPoolForApi(scores) {
    if (global.FWOnetVectors && typeof FWOnetVectors.getCachedOnetRank === 'function') {
      var onetCached = FWOnetVectors.getCachedOnetRank(6);
      if (onetCached && onetCached.length) {
        return onetCached.map(function (m) {
          return {
            careerId: m.id || (m.career && m.career.id),
            name: m.name || (m.career && m.career.name),
            score: m.score,
            skills: m.career && Array.isArray(m.career.skills) ? m.career.skills.slice() : [],
            soc: m.soc || null,
          };
        });
      }
    }
    if (!global.FWOnetVectors) {
      if (!global.FWHubCareers || typeof FWHubCareers.rankCareersFromQuizScores !== 'function') return [];
      if (!scores) return [];
      try {
        return FWHubCareers.rankCareersFromQuizScores(scores).slice(0, 6).map(function (m) {
          return {
            careerId: m.career.id,
            name: m.career.name,
            score: m.score,
            skills: Array.isArray(m.career.skills) ? m.career.skills.slice() : [],
          };
        });
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  async function refreshPortalSnapshot(opts) {
    if (!sessionEmail) return null;
    var force = !!(opts && opts.force);

    async function runSnapshot() {
      var quiz = readLocalQuiz();
      if (!quiz) return null;
      if (!force && !portalSnapshotIsStale(quiz)) {
        return readPortalSnapshot() || quiz.portalSnapshot || null;
      }
      try {
        await uploadLocalQuizIfPresent();
        quiz = readLocalQuiz() || quiz;
      } catch (err) {
        console.warn('quiz upload before snapshot failed', err);
      }

      async function fetchSnapshot(fetchForce) {
        var resp = await authFetch('/portal-snapshot', {
          method: 'POST',
          body: {
            force: !!fetchForce,
            careerPool: buildCareerPoolForApi(quiz.scores),
            inputsHash: computePortalInputsHash(quiz),
          },
        });
        var data = await parseJson(resp);
        if (!resp.ok) throw respError(resp, data, 'Could not refresh portal snapshot.');
        return data;
      }

      var data = await fetchSnapshot(force);
      if (data.aiError) console.warn('portal snapshot AI:', data.aiError);
      if (
        data.portalSnapshot
        && data.portalSnapshot.source === 'fallback'
        && !(opts && opts._retried)
      ) {
        await new Promise(function (resolve) { setTimeout(resolve, 3000); });
        data = await fetchSnapshot(true);
        if (data.aiError) console.warn('portal snapshot AI (retry):', data.aiError);
      }

      if (data.portalSnapshot && (data.portalSnapshot.source === 'ai' || data.portalSnapshot.source === 'fallback')) {
        writePortalSnapshot(data.portalSnapshot);
      }
      return data.portalSnapshot || null;
    }

    if (force) return runSnapshot();
    if (!portalSnapshotPromise) {
      portalSnapshotPromise = runSnapshot().finally(function () { portalSnapshotPromise = null; });
    }
    return portalSnapshotPromise;
  }

  function mergePortalSnapshot(localQuiz, serverQuiz) {
    if (!localQuiz || !serverQuiz) return serverQuiz || localQuiz;
    var localSnap = localQuiz.portalSnapshot;
    var serverSnap = serverQuiz.portalSnapshot;
    var hash = computePortalInputsHash(serverQuiz);
    if (!localSnap || typeof localSnap !== 'object') {
      return stripFallbackSnapshot(serverQuiz);
    }
    if (!serverSnap || typeof serverSnap !== 'object') {
      return Object.assign({}, serverQuiz, {
        portalSnapshot: localSnap.source === 'ai' ? localSnap : undefined,
      });
    }
    if (localSnap.source === 'ai' && localSnap.inputsHash === hash) {
      var localAt = Date.parse(localSnap.generatedAt || '');
      var serverAt = Date.parse(serverSnap.generatedAt || '');
      if (!Number.isNaN(localAt) && (Number.isNaN(serverAt) || localAt >= serverAt)) {
        return Object.assign({}, serverQuiz, {
          portalSnapshot: Object.assign({}, serverSnap, localSnap),
        });
      }
    }
    return stripFallbackSnapshot(serverQuiz);
  }

  function stripFallbackSnapshot(quiz) {
    if (!quiz || !quiz.portalSnapshot || quiz.portalSnapshot.source !== 'fallback') return quiz;
    var next = Object.assign({}, quiz);
    delete next.portalSnapshot;
    return next;
  }

  function mergeCareerFocus(localQuiz, serverQuiz) {
    if (global.FWCareerFocusMigrate && typeof FWCareerFocusMigrate.mergeCareerFocus === 'function') {
      return FWCareerFocusMigrate.mergeCareerFocus(localQuiz, serverQuiz);
    }
    if (!localQuiz || !serverQuiz) return serverQuiz || localQuiz;
    var localFocus = localQuiz.careerFocus;
    var serverFocus = serverQuiz.careerFocus;
    if (!localFocus || typeof localFocus !== 'object') return serverQuiz;
    if (!serverFocus || typeof serverFocus !== 'object') {
      return Object.assign({}, serverQuiz, { careerFocus: localFocus });
    }
    var localWeight = localFocus.weight || 0;
    var serverWeight = serverFocus.weight || 0;
    if (localWeight > serverWeight || (localFocus.soc && !serverFocus.soc)) {
      return Object.assign({}, serverQuiz, {
        careerFocus: Object.assign({}, localFocus, { weight: Math.max(localWeight, serverWeight) }),
      });
    }
    return serverQuiz;
  }

  function computeRoadmapInputsHash(quiz) {
    return computePortalInputsHash(quiz);
  }

  function readCareerFocus() {
    var quiz = readLocalQuiz();
    return (quiz && quiz.careerFocus) ? quiz.careerFocus : null;
  }

  function writeCareerFocus(focus) {
    if (!focus || !focus.slug) return;
    var quiz = readLocalQuiz() || { scores: {} };
    quiz.careerFocus = focus;
    writeLocalQuiz(quiz);
  }

  function readCareerFocusHistory() {
    var quiz = readLocalQuiz();
    return (quiz && Array.isArray(quiz.careerFocusHistory)) ? quiz.careerFocusHistory : [];
  }

  function writeCareerFocusHistory(history) {
    if (!Array.isArray(history)) return;
    var quiz = readLocalQuiz() || { scores: {} };
    quiz.careerFocusHistory = history;
    writeLocalQuiz(quiz);
  }

  function roadmapIsStale() {
    if (!sessionEmail) return false;
    var roadmap = readLocalRoadmap();
    var quiz = readLocalQuiz();
    if (!quiz) return false;
    var hash = computeRoadmapInputsHash(quiz);
    var focus = readCareerFocus();
    var focusSlug = (focus && focus.weight >= 75 && focus.slug)
      ? focus.slug
      : (roadmap && roadmap.targetCareerSlug) || '';
    if (!roadmap || (!roadmap.phases && !roadmap.nodes)) return !!focusSlug;
    var meta = roadmap.roadmapMeta;
    if (meta && meta.inputsHash === hash && meta.focusSlug === focusSlug) return false;
    if (!meta && roadmap.updatedAt) {
      var age = Date.now() - Date.parse(roadmap.updatedAt);
      if (!Number.isNaN(age) && age < 24 * 3600 * 1000 && roadmap.targetCareerSlug === focusSlug) {
        return false;
      }
    }
    return true;
  }

  var roadmapSyncPromise = null;
  var uploadPromise = null;
  var portalSnapshotPromise = null;
  var focusPromise = null;
  var lastUploadedQuizHash = '';

  // The uploaded-quiz hash persists across page navigations (per tab, keyed
  // by email) so an unchanged profile doesn't re-run the GET+PUT /profile/quiz
  // pair on every page load — that pair used to sit on the boot critical path
  // of every authed page. sessionStorage (not localStorage) so a browser
  // restart always re-syncs.
  var UPLOAD_HASH_KEY = 'fw-quiz-upload-hash';
  var SESSION_HINT_KEY = 'fw-session-hint';
  var profilePrefetch = null;

  function readUploadedHash() {
    try {
      var raw = sessionStorage.getItem(UPLOAD_HASH_KEY);
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      return parsed && parsed.email === sessionEmail ? String(parsed.hash || '') : '';
    } catch (_) {
      return '';
    }
  }

  function writeUploadedHash(hash) {
    try {
      if (hash && sessionEmail) {
        sessionStorage.setItem(UPLOAD_HASH_KEY, JSON.stringify({ email: sessionEmail, hash: hash }));
      } else {
        sessionStorage.removeItem(UPLOAD_HASH_KEY);
      }
    } catch (_) { /* ignore */ }
  }

  // Feature-intro marks are the one persisted field that changes without any
  // quiz input changing; without a term here, "seen" would stay local for the
  // whole session and the student would meet the same interstitial on their
  // next device. Order-independent so a key-order difference is not a change.
  function introsHash(intros) {
    if (!intros || typeof intros !== 'object') return '';
    return Object.keys(intros).sort().map(function (key) {
      var row = intros[key] || {};
      return key + ':' + (row.seen ? '1' : '0') + (row.ribbonDismissed ? '1' : '0');
    }).join(',');
  }

  function quizPayloadHash(quiz) {
    if (!quiz) return '';
    // Must cover every input the server persists — anything omitted here can
    // change locally and silently never re-sync to D1 for the session.
    return hashString(JSON.stringify({
      scores: quiz.scores || {},
      characterSummary: String(quiz.characterSummary || ''),
      traits: Array.isArray(quiz.traits) ? quiz.traits : [],
      pb: profileBuildingAnswersForApi(quiz.profileBuilding),
      refine: quiz.refine || null,
      academics: quiz.academics || null,
      resume: hashString(String(quiz.resumeText || '') + '|' + String(quiz.academicsTranscript || '')),
      personalityVecAt: String((quiz.personalityVector && quiz.personalityVector.updatedAt) || ''),
      objectiveVecAt: String((quiz.objectiveVector && quiz.objectiveVector.updatedAt) || ''),
      objectivePatchAt: String((quiz.objectiveAiPatch && quiz.objectiveAiPatch.updatedAt) || ''),
      focus: quiz.careerFocus
        ? { slug: quiz.careerFocus.slug, weight: quiz.careerFocus.weight || 0 }
        : null,
      intros: introsHash(quiz.featureIntros),
    }));
  }

  function portalSnapshotIsStale(quiz) {
    if (!quiz) return true;
    var snap = quiz.portalSnapshot;
    if (snap && snap.source === 'fallback') return true;
    if (!snap || !snap.inputsHash || snap.source !== 'ai') return true;
    if (!snap.knowYou || !snap.characterAnalysis) return true;
    return snap.inputsHash !== computePortalInputsHash(quiz);
  }

  async function recordCareerFocus(opts) {
    if (!sessionEmail || !opts || !opts.slug || !opts.name || !opts.source) return null;
    var current = readCareerFocus();
    if (current && current.slug === opts.slug) {
      var lowWeight = opts.source === 'hub_view' || opts.source === 'deep_dive_view';
      if (lowWeight || (current.weight || 0) >= 75) {
        return {
          focus: current,
          skipped: true,
          retarget: false,
          roadmap: readLocalRoadmap(),
        };
      }
    }

    async function runFocus() {
      var resp = await authFetch('/career-focus', {
        method: 'POST',
        body: {
          slug: opts.slug,
          name: opts.name,
          source: opts.source,
          soc: opts.soc || null,
        },
      });
      var data = await parseJson(resp);
      if (!resp.ok) throw respError(resp, data, 'Could not record career focus.');
      if (data.focus) {
        var enriched = Object.assign({}, data.focus);
        if (opts.soc) enriched.soc = opts.soc;
        if (opts.hubSlug) enriched.hubSlug = opts.hubSlug;
        if (opts.migratedFrom) enriched.migratedFrom = opts.migratedFrom;
        if (opts.migratedAt) enriched.migratedAt = opts.migratedAt;
        writeCareerFocus(enriched);
      }
      if (data.careerFocusHistory) writeCareerFocusHistory(data.careerFocusHistory);
      if (data.roadmap) cacheRoadmap(data.roadmap);
      if (global.FWProfileAlignment && typeof FWProfileAlignment.handleAlignmentResponse === 'function') {
        FWProfileAlignment.handleAlignmentResponse(data);
      }
      return data;
    }

    if (!focusPromise) {
      focusPromise = runFocus().finally(function () { focusPromise = null; });
    }
    return focusPromise;
  }

  async function syncRoadmap(opts) {
    if (!sessionEmail) return null;
    async function run() {
      var resp = await authFetch('/roadmap-sync', {
        method: 'POST',
        body: {
          force: !!(opts && opts.force),
          reason: (opts && opts.reason) || 'client',
        },
        timeoutMs: opts && opts.timeoutMs ? opts.timeoutMs : 120000,
      });
      var data = await parseJson(resp);
      if (!resp.ok) throw respError(resp, data, 'Could not sync roadmap.');
      if (data.roadmap) cacheRoadmap(data.roadmap);
      if (data.focus) writeCareerFocus(data.focus);
      return data;
    }
    if (opts && opts.force) return run();
    if (!roadmapSyncPromise) {
      roadmapSyncPromise = run().finally(function () { roadmapSyncPromise = null; });
    }
    return roadmapSyncPromise;
  }

  async function uploadLocalQuizIfPresent() {
    const local = readLocalQuiz();
    if (!local) return;
    var payloadHash = quizPayloadHash(local);
    if (payloadHash && (payloadHash === lastUploadedQuizHash || payloadHash === readUploadedHash())) return;

    async function doUpload() {
      var toUpload = local;
      try {
        const getResp = await authFetch('/profile/quiz');
        const getData = await parseJson(getResp);
        if (getResp.ok && getData.profile) {
          // Mirror loadProfile's merge chain exactly — omitting the vector or
          // focus merges here would overwrite just-saved local refine/academics/
          // vectors/careerFocus with the server's stale copy, then upload it.
          var merged = mergeProfileBuilding(local, getData.profile);
          merged = mergeSectorFitSheet(local, merged);
          merged = mergeVectorInputs(local, merged);
          merged = mergePortalSnapshot(local, merged);
          merged = mergeCareerFocus(local, merged);
          merged = mergeFeatureIntros(local, merged);
          writeLocalQuiz(merged);
          if (merged.portalSnapshot && merged.portalSnapshot.dossierFp) {
            writeDossierFingerprint(merged.portalSnapshot.dossierFp);
          }
          toUpload = merged;
        }
      } catch (err) {
        console.warn('quiz fetch before upload failed', err);
      }
      const resp = await authFetch('/profile/quiz', {
        method: 'PUT',
        body: { profile: toUpload },
      });
      if (!resp.ok) {
        const data = await parseJson(resp);
        throw respError(resp, data, 'Could not sync quiz profile.');
      }
      lastUploadedQuizHash = quizPayloadHash(toUpload);
      writeUploadedHash(lastUploadedQuizHash);
    }

    if (!uploadPromise) {
      uploadPromise = doUpload().finally(function () { uploadPromise = null; });
    }
    return uploadPromise;
  }

  // Seed the client career-analysis cache from the server's stored analyses so
  // deep dives are instant and follow the profile across devices. Key/value
  // shape matches career-personalize.js (cacheId = "email:slug").
  function analysisProfileCacheKey() {
    var quiz = readLocalQuiz();
    var hash = computePortalInputsHash(quiz);
    var focusSlug = '';
    var focus = readCareerFocus();
    if (focus && focus.slug) focusSlug = focus.slug;
    return hash + '|' + focusSlug;
  }

  function seedAnalysisCache(email, analyses) {
    if (!email || !analyses || typeof analyses !== 'object') return;
    try {
      const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
      const all = raw ? (JSON.parse(raw) || {}) : {};
      const profileKey = analysisProfileCacheKey();
      Object.keys(analyses).forEach(function (slug) {
        if (!analyses[slug]) return;
        const key = email + ':' + slug;
        const existing = all[key];
        const samePayload = existing && existing.analysis
          && JSON.stringify(existing.analysis) === JSON.stringify(analyses[slug]);
        if (samePayload && existing.profileKey === profileKey) return;
        if (existing && existing.profileKey === profileKey && existing.at) return;
        all[key] = {
          analysis: analyses[slug],
          profileKey: profileKey,
          at: samePayload && existing && existing.at ? existing.at : Date.now(),
        };
      });
      localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(all));
    } catch (_) { /* quota / parse */ }
  }

  function readLocalRoadmap() {
    try {
      const raw = localStorage.getItem(ROADMAP_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.version === 2 && data.nodes && data.targetCareerSlug) return data;
      if (data && data.phases && data.targetCareerSlug) {
        if (global.FWRoadmapTree && typeof FWRoadmapTree.migrateV1ToV2 === 'function') {
          const migrated = FWRoadmapTree.migrateV1ToV2(data);
          if (migrated) {
            cacheRoadmap(migrated);
            return migrated;
          }
        }
        return data;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function cacheRoadmap(roadmap) {
    try {
      if (roadmap) localStorage.setItem(ROADMAP_KEY, JSON.stringify(roadmap));
      else localStorage.removeItem(ROADMAP_KEY);
    } catch (_) { /* ignore */ }
  }

  // GET /profile -> one authenticated round trip that hydrates quiz, analyses,
  // and roadmap from the server (source of truth) into local fast caches.
  function mergeSectorFitSheet(localQuiz, serverQuiz) {
    if (!localQuiz || !serverQuiz) return serverQuiz || localQuiz;
    var localSheet = localQuiz.sectorFitSheet;
    var serverSheet = serverQuiz.sectorFitSheet;
    if (!serverSheet || typeof serverSheet !== 'object') {
      if (localSheet && localSheet.scores) {
        return Object.assign({}, serverQuiz, {
          sectorFitSheet: localSheet,
          scores: Object.assign({}, localSheet.scores),
        });
      }
      return serverQuiz;
    }
    if (!localSheet || typeof localSheet !== 'object') return serverQuiz;
    var localAt = Date.parse(localSheet.updatedAt || '');
    var serverAt = Date.parse(serverSheet.updatedAt || '');
    if (!Number.isNaN(localAt) && (Number.isNaN(serverAt) || localAt >= serverAt)) {
      return Object.assign({}, serverQuiz, {
        sectorFitSheet: localSheet,
        scores: Object.assign({}, localSheet.scores),
      });
    }
    return serverQuiz;
  }

  function mergeVectorInputs(localQuiz, serverQuiz) {
    if (!localQuiz || !serverQuiz) return serverQuiz || localQuiz;
    var out = Object.assign({}, serverQuiz);
    if (localQuiz.refine && typeof localQuiz.refine === 'object') {
      out.refine = localQuiz.refine;
    }
    if (localQuiz.academics && typeof localQuiz.academics === 'object') {
      out.academics = Object.assign({}, serverQuiz.academics || {}, localQuiz.academics);
    }
    if (localQuiz.academicsTranscript) {
      out.academicsTranscript = localQuiz.academicsTranscript;
    }
    var localPAt = Date.parse((localQuiz.personalityVector && localQuiz.personalityVector.updatedAt) || '');
    var serverPAt = Date.parse((serverQuiz.personalityVector && serverQuiz.personalityVector.updatedAt) || '');
    if (!Number.isNaN(localPAt) && (Number.isNaN(serverPAt) || localPAt >= serverPAt)) {
      out.personalityVector = localQuiz.personalityVector;
    }
    var localOAt = Date.parse((localQuiz.objectiveVector && localQuiz.objectiveVector.updatedAt) || '');
    var serverOAt = Date.parse((serverQuiz.objectiveVector && serverQuiz.objectiveVector.updatedAt) || '');
    if (!Number.isNaN(localOAt) && (Number.isNaN(serverOAt) || localOAt >= serverOAt)) {
      out.objectiveVector = localQuiz.objectiveVector;
    }
    var localPatchAt = Date.parse((localQuiz.objectiveAiPatch && localQuiz.objectiveAiPatch.updatedAt) || '');
    var serverPatchAt = Date.parse((serverQuiz.objectiveAiPatch && serverQuiz.objectiveAiPatch.updatedAt) || '');
    if (localQuiz.objectiveAiPatch
      && !Number.isNaN(localPatchAt)
      && (Number.isNaN(serverPatchAt) || localPatchAt >= serverPatchAt)) {
      out.objectiveAiPatch = localQuiz.objectiveAiPatch;
    }
    if (localQuiz.resumeText
      && String(localQuiz.resumeText).length > String(serverQuiz.resumeText || '').length) {
      out.resumeText = localQuiz.resumeText;
    }
    return out;
  }

  function mergeProfileBuilding(localQuiz, serverQuiz) {
    if (!localQuiz || !serverQuiz) return serverQuiz || localQuiz;
    const localPb = localQuiz.profileBuilding;
    const serverPb = serverQuiz.profileBuilding;
    if (!localPb || typeof localPb !== 'object') return serverQuiz;
    if (!serverPb || typeof serverPb !== 'object') {
      return Object.assign({}, serverQuiz, { profileBuilding: localPb });
    }
    const localAt = Date.parse(localPb.completedAt || '');
    const serverAt = Date.parse(serverPb.completedAt || '');
    if (!Number.isNaN(localAt) && (Number.isNaN(serverAt) || localAt >= serverAt)) {
      return Object.assign({}, serverQuiz, {
        profileBuilding: Object.assign({}, serverPb, localPb),
      });
    }
    return serverQuiz;
  }

  // Feature intros are one-way facts: a screen you have already been shown can
  // never become unshown. So the merge is a union, per feature, in both
  // directions — that is also the signed-out → account migration path (an
  // anonymous student's marks live in the same local blob and survive the
  // first server pull). Read from FWUser rather than `localQuiz`, because
  // readLocalQuiz() returns null until the quiz has scores and intros start
  // before that.
  function localFeatureIntros() {
    try {
      if (!global.FWUser || typeof FWUser.get !== 'function') return null;
      var user = FWUser.get();
      var intros = user && user.journey && user.journey.featureIntros;
      return (intros && typeof intros === 'object') ? intros : null;
    } catch (_) { return null; }
  }

  function mergeFeatureIntros(localQuiz, serverQuiz) {
    if (!serverQuiz) return localQuiz || serverQuiz;
    var localIntros = localFeatureIntros()
      || ((localQuiz && typeof localQuiz.featureIntros === 'object') ? localQuiz.featureIntros : null);
    if (!localIntros) return serverQuiz;
    var serverIntros = (serverQuiz.featureIntros && typeof serverQuiz.featureIntros === 'object')
      ? serverQuiz.featureIntros : {};
    var out = Object.assign({}, serverIntros);
    Object.keys(localIntros).forEach(function (key) {
      var mine = localIntros[key];
      if (!mine || typeof mine !== 'object') return;
      var theirs = (out[key] && typeof out[key] === 'object') ? out[key] : {};
      var seenAt = mine.seenAt && theirs.seenAt
        ? (mine.seenAt < theirs.seenAt ? mine.seenAt : theirs.seenAt)
        : (mine.seenAt || theirs.seenAt || '');
      var merged = Object.assign({}, theirs, mine);
      if (theirs.seen || mine.seen) merged.seen = true;
      if (theirs.ribbonDismissed || mine.ribbonDismissed) merged.ribbonDismissed = true;
      if (seenAt) merged.seenAt = seenAt;
      out[key] = merged;
    });
    return Object.assign({}, serverQuiz, { featureIntros: out });
  }

  async function loadProfile() {
    if (!sessionEmail) return null;
    const localBefore = readLocalQuiz();
    // Use the boot-time parallel prefetch when one was started (one-shot);
    // fall back to a fresh request if it failed.
    var pending = profilePrefetch;
    profilePrefetch = null;
    let resp;
    if (pending) {
      try { resp = await pending; } catch (_) { resp = null; }
    }
    if (!resp) resp = await authFetch('/profile');
    const data = await parseJson(resp);
    if (!resp.ok) throw respError(resp, data, 'Could not load profile.');
    if (data.quiz) {
      var merged = mergeProfileBuilding(localBefore, data.quiz);
      merged = mergeSectorFitSheet(localBefore, merged);
      merged = mergeVectorInputs(localBefore, merged);
      merged = mergePortalSnapshot(localBefore, merged);
      merged = mergeCareerFocus(localBefore, merged);
      merged = mergeFeatureIntros(localBefore, merged);
      if (global.FWSectorFitSheet) FWSectorFitSheet.ensureSectorFitSheet(merged);
      if (global.FWOnetVectors && typeof FWOnetVectors.hydrateQuizVectors === 'function') {
        merged = FWOnetVectors.hydrateQuizVectors(merged);
      }
      writeLocalQuiz(merged);
      if (merged.portalSnapshot && merged.portalSnapshot.dossierFp) {
        writeDossierFingerprint(merged.portalSnapshot.dossierFp);
      }
    }
    seedAnalysisCache(data.email || sessionEmail, data.analyses);
    cacheRoadmap(data.roadmap);
    return data;
  }

  // Push any anonymous local quiz up first (so it is not lost on login), then
  // pull the unified server profile down.
  async function syncQuizProfile() {
    if (!sessionEmail) return null;
    const local = readLocalQuiz();
    if (local) {
      await uploadLocalQuizIfPresent();
    }
    const profile = await loadProfile();
    if (global.FWCareerFocusMigrate && typeof FWCareerFocusMigrate.runOnBoot === 'function') {
      try {
        await FWCareerFocusMigrate.runOnBoot();
      } catch (migrateErr) {
        console.warn('career focus migration failed', migrateErr);
      }
    }
    return (profile && profile.quiz) || null;
  }

  async function getRoadmap() {
    if (!sessionEmail) return null;
    const resp = await authFetch('/profile/roadmap');
    const data = await parseJson(resp);
    if (!resp.ok) throw respError(resp, data, 'Could not load roadmap.');
    cacheRoadmap(data.roadmap || null);
    return data.roadmap || null;
  }

  async function saveRoadmap(roadmap) {
    if (!sessionEmail) return null;
    const resp = await authFetch('/profile/roadmap', { method: 'PUT', body: { roadmap } });
    const data = await parseJson(resp);
    if (!resp.ok) throw respError(resp, data, 'Could not save roadmap.');
    cacheRoadmap(roadmap);
    // The server re-syncs the objective vector to step progress on every save;
    // absorb the result so local fit numbers move without a reload.
    if (data && data.objectiveSynced) applyObjectiveFromResponse(data);
    return data;
  }

  function setSessionEmail(email) {
    sessionEmail = email || null;
    // Same-tab hint that a session exists, so the next page's boot can start
    // the /profile fetch in parallel with /auth/me instead of after it.
    try {
      if (sessionEmail) sessionStorage.setItem(SESSION_HINT_KEY, sessionEmail);
      else sessionStorage.removeItem(SESSION_HINT_KEY);
    } catch (_) { /* ignore */ }
    if (global.dispatchEvent) {
      global.dispatchEvent(new CustomEvent('fw-auth-change', { detail: { email: sessionEmail } }));
    }
  }

  function authEmail() {
    return sessionEmail;
  }

  // Unknown (pre-migration server, or /auth/me not yet resolved) must never
  // nag — only an explicit `verified: false` from the server does.
  function isVerified() {
    return sessionVerified !== false;
  }

  function isValidPassword(password) {
    return typeof password === 'string' && password.length >= MIN_PASSWORD_LEN;
  }

  async function authMe() {
    const resp = await authFetch('/auth/me');
    const data = await parseJson(resp);
    if (!resp.ok) {
      sessionVerified = null;
      setSessionEmail(null);
      return null;
    }
    // Capture before setSessionEmail — its fw-auth-change dispatch is
    // synchronous, so isVerified() must already read the fresh value inside
    // any listener (auth-nav.js's soft-verify banner included).
    sessionVerified = (data && typeof data.verified === 'boolean') ? data.verified : null;
    setSessionEmail(data.email || null);
    return data.email ? { email: data.email } : null;
  }

  async function authBoot() {
    if (!bootPromise) {
      bootPromise = (async function () {
        // When this tab already saw a session AND the local quiz is already
        // synced (so no PUT will run that the GET could race), fetch /profile
        // concurrently with /auth/me — both only need the session cookie.
        // Saves one full serial round trip on every page navigation.
        try {
          var hint = sessionStorage.getItem(SESSION_HINT_KEY);
          if (hint) {
            var localQuiz = readLocalQuiz();
            var hintedHashRaw = sessionStorage.getItem(UPLOAD_HASH_KEY);
            var hinted = hintedHashRaw ? JSON.parse(hintedHashRaw) : null;
            var uploadNotNeeded = !localQuiz
              || (hinted && hinted.email === hint && hinted.hash === quizPayloadHash(localQuiz));
            if (uploadNotNeeded) {
              profilePrefetch = authFetch('/profile');
              // Side handler so a discarded prefetch never surfaces as an
              // unhandled rejection; loadProfile handles its own failures.
              profilePrefetch.catch(function () {});
            }
          }
        } catch (_) { profilePrefetch = null; }
        await authMe();
        if (!sessionEmail) profilePrefetch = null;
        if (sessionEmail) {
          try {
            await syncQuizProfile();
          } catch (err) {
            console.warn('quiz profile sync failed', err);
          }
          if (global.FWProfileAlignment && typeof FWProfileAlignment.checkOnLoad === 'function') {
            FWProfileAlignment.checkOnLoad().catch(function (err) {
              console.warn('profile alignment check failed', err);
            });
          }
        }
        return sessionEmail;
      })();
    }
    return bootPromise;
  }

  async function authRegister(email, password, quizProfile, opts) {
    const body = { email, password };
    const profile = quizProfile || readLocalQuiz();
    if (profile) body.quizProfile = profile;

    const resp = await authFetch('/auth/register', { method: 'POST', body });
    const data = await parseJson(resp);
    if (!resp.ok) throw respError(resp, data, 'Registration failed.');

    // Only past the failure guard — a rejected registration is not a signup.
    // `source` (S6) attributes where the account was created (e.g. the quiz
    // reveal gate) so the funnel can split signups by entry point.
    try {
      if (global.FWEvents) {
        var suProps = { method: 'password' };
        if (opts && opts.source) suProps.source = opts.source;
        FWEvents.log('signup_complete', suProps);
        // S15 (D24). The bind happens SERVER-side, from the fw_ref cookie —
        // a client-supplied referrer would be a client-chosen referrer — so
        // `referred` on the response is the browser's only way to know it
        // happened. No props: the code is the server's business, not a stat.
        if (data && data.referred) FWEvents.log('referral_signup', {});
      }
    } catch (_) {}
    setSessionEmail(data.email || email);
    scheduleQuizProfileSync('post-register quiz sync failed');
    // No props by design: the server joins anon_id → user_id off the session
    // cookie the response above already set. Must NOT move into setSessionEmail
    // — that also runs on every authMe boot and on logout.
    try { if (global.FWEvents) FWEvents.log('identify', {}); } catch (_) {}
    return data;
  }

  async function authLogin(email, password) {
    const resp = await authFetch('/auth/login', { method: 'POST', body: { email, password } });
    const data = await parseJson(resp);
    if (!resp.ok) throw respError(resp, data, 'Invalid email or password.');

    // The only sign-in success point; the reset flow is a separate function
    // that never lands here, so a password reset can't be counted as a login.
    try { if (global.FWEvents) FWEvents.log('login', { method: 'password' }); } catch (_) {}
    setSessionEmail(data.email || email);
    scheduleQuizProfileSync('post-login quiz sync failed');
    // Mirror of the register-side identify — same cookie-is-already-set reason.
    try { if (global.FWEvents) FWEvents.log('identify', {}); } catch (_) {}
    return data;
  }

  async function authLogout() {
    try {
      await authFetch('/auth/logout', { method: 'POST' });
    } catch (_) { /* ignore */ }
    writeUploadedHash('');
    setSessionEmail(null);
  }

  async function authForgotPassword(email) {
    const resp = await authFetch('/auth/forgot-password', { method: 'POST', body: { email } });
    const data = await parseJson(resp);
    if (!resp.ok) throw respError(resp, data, 'Could not send reset email.');
    return data;
  }

  async function authResetPassword(token, newPassword) {
    const resp = await authFetch('/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword },
    });
    const data = await parseJson(resp);
    if (!resp.ok) throw respError(resp, data, 'Could not reset password.');
    return data;
  }

  global.FWAuth = {
    ROADMAP_KEY,
    MIN_PASSWORD_LEN,
    authBoot,
    authMe,
    authRegister,
    authLogin,
    authLogout,
    authForgotPassword,
    authResetPassword,
    authEmail,
    isVerified,
    syncQuizProfile,
    uploadLocalQuizIfPresent,
    loadProfile,
    getRoadmap,
    saveRoadmap,
    cacheRoadmap,
    readLocalRoadmap,
    readLocalQuiz,
    writeLocalQuiz,
    readProfileBuilding,
    writeProfileBuilding,
    profileBuildingAnswersForApi,
    computePortalInputsHash,
    readDossierFingerprint,
    writeDossierFingerprint,
    bumpDossierFingerprint,
    readPortalSnapshot,
    writePortalSnapshot,
    buildCareerPoolForApi,
    refreshPortalSnapshot,
    applySectorFitFromResponse,
    applyObjectiveFromResponse,
    applyPersonalityFromResponse,
    applyVectorsFromResponse,
    computeRoadmapInputsHash,
    readCareerFocus,
    writeCareerFocus,
    readCareerFocusHistory,
    writeCareerFocusHistory,
    roadmapIsStale,
    recordCareerFocus,
    syncRoadmap,
    isValidPassword,
    authFetch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
