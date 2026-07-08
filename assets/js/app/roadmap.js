/**
 * Career Roadmap — tree v2 + list fallback, generate, refine, split branches.
 */
(function (global) {
  const API = '/career-roadmap';
  const PENDING_CAREER_KEY = 'fw_roadmap_pending_career';

  let state = {
    roadmap: null,
    loading: false,
    generating: false,
    syncing: false,
    committing: false,
    previewNodeId: null,
    regenHintShown: false,
    stepsHintShown: false,
    error: '',
    chatOpen: false,
    chatHistory: [],
    exchangeCount: 0,
    pendingSlug: null,
    pendingName: null,
    pendingSoc: null,
    pendingRoadmap: null,
    pendingFocus: false,
    focusOpen: false,
    generatingCareerName: '',
    generatingFitScore: null,
    toastTimer: null,
    pendingToast: null,
    treeController: null,
  };

  let saveTimer = null;
  let lastBootSyncAt = 0;
  let focusLoadingTimer = null;
  let focusLoadingSafetyTimer = null;
  const BOOT_SYNC_DEBOUNCE_MS = 5 * 60 * 1000;
  const FOCUS_LOADING_SAFETY_MS = 10000;
  const GENERATE_TIMEOUT_MS = 120000;
  const FOCUS_TIMEOUT_MS = 20000;

  function friendlyGenerateError(err) {
    const msg = (err && err.message) || '';
    const name = (err && err.name) || '';
    if (name === 'AbortError' || name === 'TimeoutError' || /signal timed out|timed out/i.test(msg)) {
      return 'Roadmap generation is taking longer than expected. Please try again — your profile may still be processing.';
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return 'Network error while building your roadmap. Check your connection and try again.';
    }
    return msg || 'Generation failed. Please try again.';
  }

  function fetchWithTimeout(url, opts, ms) {
    opts = opts || {};
    ms = ms || GENERATE_TIMEOUT_MS;
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      opts.signal = AbortSignal.timeout(ms);
      return fetch(url, opts);
    }
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (!controller) return fetch(url, opts);
    var timer = setTimeout(function () { controller.abort(); }, ms);
    opts.signal = controller.signal;
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error(message || 'Request timed out.'));
      }, ms);
      Promise.resolve(promise).then(function (val) {
        clearTimeout(timer);
        resolve(val);
      }).catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function clearFocusLoadingTimers() {
    if (focusLoadingTimer) {
      clearTimeout(focusLoadingTimer);
      focusLoadingTimer = null;
    }
    if (focusLoadingSafetyTimer) {
      clearTimeout(focusLoadingSafetyTimer);
      focusLoadingSafetyTimer = null;
    }
  }

  // Styled confirm when available; native fallback keeps behavior if the
  // shared dialog script isn't on the page.
  function confirmAction(opts) {
    if (global.FWConfirm && typeof FWConfirm.show === 'function') {
      return FWConfirm.show(opts);
    }
    var text = (opts && (opts.title + ' ' + (opts.message || ''))) || 'Are you sure?';
    return Promise.resolve(global.confirm(text));
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function readRoadmap() {
    let rm = null;
    if (global.FWAuth && typeof FWAuth.readLocalRoadmap === 'function') {
      rm = FWAuth.readLocalRoadmap();
    }
    return normalizeLocalRoadmap(rm);
  }

  function quizData() {
    try {
      if (global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') return FWAuth.readLocalQuiz();
    } catch (_) { /* ignore */ }
    return null;
  }

  function resolveEmptyTarget() {
    if (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function') {
      const target = FWCareerTarget.resolveTargetCareer();
      if (target && target.slug && target.name) return target;
    }
    const focus = (global.FWAuth && typeof FWAuth.readCareerFocus === 'function')
      ? FWAuth.readCareerFocus() : null;
    if (!focus || !focus.slug || !focus.name) return null;
    let score = null;
    let rarity = (global.FWCareerTarget && FWCareerTarget.fitRarity)
      ? FWCareerTarget.fitRarity(50) : { tier: 'common', base: '#9AA0AD' };
    if (global.FWCareerTarget && typeof FWCareerTarget.rankedCareerMatches === 'function') {
      const hit = FWCareerTarget.rankedCareerMatches(40).find(function (m) { return m.slug === focus.slug; });
      if (hit) {
        score = hit.score;
        rarity = hit.rarity || rarity;
      }
    }
    return {
      slug: focus.slug,
      name: focus.name,
      soc: focus.soc || null,
      source: focus.source || 'careerFocus',
      score: score,
      rarity: rarity,
    };
  }

  function renderErrorPanel(message) {
    if (!message) return '';
    return '<div class="roadmap-error-panel" role="alert">'
      + '<strong>Could not build your roadmap</strong>'
      + '<p>' + esc(message) + '</p></div>';
  }

  function fitLabel(score, suffix) {
    const label = (global.FWCareerTarget && typeof FWCareerTarget.formatFitPercent === 'function')
      ? FWCareerTarget.formatFitPercent(score)
      : (Number.isFinite(score) ? Math.round(score) + '%' : '');
    return label ? label + (suffix || '') : '';
  }

  function topMatches(n) {
    if (global.FWCareerTarget && typeof FWCareerTarget.rankedCareerMatches === 'function') {
      return FWCareerTarget.rankedCareerMatches(n || 3).map(function (m) {
        return {
          career: { id: m.id, name: m.name },
          score: m.score,
          slug: m.slug,
          soc: m.soc || null,
        };
      });
    }
    return [];
  }

  function isTreeRoadmap(rm) {
    return global.FWRoadmapTree && FWRoadmapTree.isTreeRoadmap(rm);
  }

  function hasRoadmap(rm) {
    return !!(rm && rm.targetCareerSlug && (isTreeRoadmap(rm) || (rm.phases && rm.phases.length)));
  }

  function normalizeLocalRoadmap(rm) {
    if (!rm) return null;
    if (isTreeRoadmap(rm)) return rm;
    if (rm.phases && global.FWRoadmapTree && typeof FWRoadmapTree.migrateV1ToV2 === 'function') {
      return FWRoadmapTree.migrateV1ToV2(rm) || rm;
    }
    return rm;
  }

  function progress(roadmap) {
    if (isTreeRoadmap(roadmap) && global.FWRoadmapTree) {
      return FWRoadmapTree.progressTree(roadmap);
    }
    let total = 0;
    let done = 0;
    (roadmap.phases || []).forEach(function (p) {
      (p.actions || []).forEach(function (a) {
        total += 1;
        if (a.done) done += 1;
      });
    });
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function typeLabel(type) {
    const map = { class: 'Class', project: 'Project', skill: 'Skill', network: 'Network', other: 'Action' };
    return map[type] || 'Action';
  }

  function parseHashRoadmapParams() {
    const onRoadmapPage = document.body && document.body.classList.contains('roadmap-page')
      || /roadmap\.html$/i.test(location.pathname || '');
    if (onRoadmapPage) {
      const params = new URLSearchParams(location.search || '');
      const career = params.get('career');
      return {
        career: career ? career.toLowerCase() : null,
        focus: params.get('focus') === '1',
      };
    }
    const h = (location.hash || '').replace(/^#/, '');
    const base = h.split('?')[0];
    if (base !== 'roadmap') return { career: null, focus: false };
    const q = h.indexOf('?');
    if (q < 0) return { career: null, focus: false };
    const params = new URLSearchParams(h.slice(q + 1));
    const career = params.get('career');
    return {
      career: career ? career.toLowerCase() : null,
      focus: params.get('focus') === '1',
    };
  }

  function parseHashCareer() {
    return parseHashRoadmapParams().career;
  }

  function consumePendingCareer() {
    try {
      const raw = sessionStorage.getItem(PENDING_CAREER_KEY);
      if (raw) {
        sessionStorage.removeItem(PENDING_CAREER_KEY);
        return JSON.parse(raw);
      }
    } catch (_) { /* ignore */ }
    const slug = parseHashCareer();
    if (slug && global.FWHubCareers && typeof FWHubCareers.careerIdFromSlug === 'function') {
      const id = FWHubCareers.careerIdFromSlug(slug);
      const career = (FWHubCareers.careers || []).find(function (c) { return c.id === id; });
      if (career) return { slug: slug, name: career.name };
    }
    return null;
  }

  function debouncedSave(roadmap) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      if (global.FWAuth && typeof FWAuth.saveRoadmap === 'function') {
        FWAuth.saveRoadmap(roadmap).catch(function (err) {
          console.warn('roadmap save failed', err);
        });
      }
    }, 300);
  }

  function flushRoadmapSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const rm = state.roadmap || readRoadmap();
    if (rm && global.FWAuth && typeof FWAuth.saveRoadmap === 'function') {
      return FWAuth.saveRoadmap(rm).catch(function (err) {
        console.warn('roadmap flush save failed', err);
      });
    }
    return Promise.resolve();
  }

  function withFocusTracker(rm) {
    if (!rm || !isTreeRoadmap(rm)) return rm;
    const q = quizData();
    const scores = q && q.scores ? q.scores : null;
    if (global.FWRoadmapTree && FWRoadmapTree.ensureFocusTracker) {
      rm = FWRoadmapTree.ensureFocusTracker(rm, scores);
    }
    if (global.FWSkillGapTracker && typeof FWSkillGapTracker.syncProgress === 'function') {
      rm = FWSkillGapTracker.syncProgress(rm);
    }
    return rm;
  }

  function setRoadmap(roadmap, persist) {
    let rm = roadmap;
    if (rm && isTreeRoadmap(rm) && global.FWRoadmapTree && FWRoadmapTree.ensureWaypointContent) {
      rm = FWRoadmapTree.ensureWaypointContent(rm);
    }
    rm = withFocusTracker(rm);
    state.roadmap = rm;
    if (persist !== false && rm) {
      if (global.FWRoadmapSync && typeof FWRoadmapSync.publish === 'function') {
        rm = FWRoadmapSync.publish(rm, { source: 'roadmap' });
        state.roadmap = rm;
      } else {
        try {
          localStorage.setItem('fw_roadmap_v1', JSON.stringify(rm));
        } catch (_) { /* ignore */ }
        debouncedSave(rm);
      }
      if (isTreeRoadmap(rm)) notifyPortalRoadmapChanged();
    }
  }

  function notifyPortalRoadmapChanged() {
    if (!document.getElementById('portal-snapshot')) return;
    if (global.FWPortal && typeof FWPortal.refreshPortalCareerUi === 'function') {
      FWPortal.refreshPortalCareerUi();
    }
  }

  function roadmapEditBlockedMessage() {
    if (!state.roadmap || !global.FWRoadmapTree) return 'Finish your current focus waypoint first.';
    if (!FWRoadmapTree.immediateWaypoint(state.roadmap)) {
      return 'Only the most recently completed waypoint can be edited.';
    }
    return 'Finish your current focus waypoint first.';
  }

  function mountRoadmapToast() {
    const message = state.pendingToast;
    if (!message) return;
    const head = document.getElementById('roadmap-head');
    if (!head) return;
    let el = document.getElementById('roadmap-sync-toast');
    if (!el) {
      el = document.createElement('p');
      el.id = 'roadmap-sync-toast';
      el.className = 'roadmap-sync-toast';
      head.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    state.pendingToast = null;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 4200);
  }

  function showRoadmapToast(message) {
    if (!message) return;
    if (global.FWFwToast && typeof FWFwToast.show === 'function') {
      FWFwToast.show(message);
      return;
    }
    state.pendingToast = message;
    mountRoadmapToast();
  }

  async function recordFocusForCareer(slug, name, source, soc) {
    if (!slug || !name || !global.FWAuth || !FWAuth.authEmail || !FWAuth.authEmail()) return null;
    if (typeof FWAuth.recordCareerFocus !== 'function') return null;
    var payload = { slug: slug, name: name, source: source || 'build_roadmap' };
    if (soc) {
      payload.soc = soc;
    } else if (global.FWCareerTarget && typeof FWCareerTarget.rankedCareerMatches === 'function') {
      const hit = FWCareerTarget.rankedCareerMatches(40).find(function (m) { return m.slug === slug; });
      if (hit && hit.soc) payload.soc = hit.soc;
    }
    try {
      return await withTimeout(
        FWAuth.recordCareerFocus(payload),
        FOCUS_TIMEOUT_MS,
        'Recording career focus timed out.'
      );
    } catch (err) {
      console.warn('recordCareerFocus failed', err);
      return null;
    }
  }

  function ensureBackgroundSync() {
    if (state.generating || state.syncing) return;
    if (!global.FWAuth || !FWAuth.authEmail || !FWAuth.authEmail()) return;
    if (typeof FWAuth.roadmapIsStale !== 'function' || !FWAuth.roadmapIsStale()) return;
    if (typeof FWAuth.syncRoadmap !== 'function') return;
    var now = Date.now();
    if (now - lastBootSyncAt < BOOT_SYNC_DEBOUNCE_MS) return;
    lastBootSyncAt = now;
    state.syncing = true;
    FWAuth.syncRoadmap({ reason: 'roadmap-boot' })
      .then(function (data) {
        if (data && data.roadmap && !data.cached) {
          setRoadmap(data.roadmap, false);
          showRoadmapToast(data.retargeted
            ? 'Your plan now targets ' + data.roadmap.targetCareerName + '.'
            : 'Your roadmap was updated with your latest profile.');
          render();
        }
      })
      .catch(function (err) {
        console.warn('roadmap background sync failed', err);
      })
      .finally(function () {
        state.syncing = false;
      });
  }

  async function generate(careerSlug, careerName, refresh, careerSoc) {
    if (!careerSlug) {
      state.error = 'Career link missing — pick a career from the list or Career Hub.';
      state.generating = false;
      render();
      return;
    }
    if (!global.FWAuth || !FWAuth.authEmail || !FWAuth.authEmail()) {
      location.href = authSignInForRoadmap();
      return;
    }
    state.generating = true;
    state.generatingCareerName = careerName || '';
    state.generatingFitScore = null;
    if (global.FWCareerTarget && typeof FWCareerTarget.rankedCareerMatches === 'function') {
      const hit = FWCareerTarget.rankedCareerMatches(40).find(function (m) { return m.slug === careerSlug; });
      if (hit && Number.isFinite(hit.score)) state.generatingFitScore = Math.round(hit.score);
    }
    state.error = '';
    render();

    try {
      const focusResult = await recordFocusForCareer(careerSlug, careerName, 'build_roadmap', careerSoc);
      if (!refresh && focusResult && focusResult.roadmap && hasRoadmap(focusResult.roadmap)
        && focusResult.roadmap.targetCareerSlug === careerSlug) {
        setRoadmap(focusResult.roadmap, true);
        state.generating = false;
        state.generatingCareerName = '';
        state.generatingFitScore = null;
        render();
        return;
      }

      const q = quizData();
      let quizFitBreakdown = null;
      if (global.FWHubCareers && typeof FWHubCareers.careerIdFromSlug === 'function' && q && q.scores) {
        const id = FWHubCareers.careerIdFromSlug(careerSlug);
        if (id && typeof FWHubCareers.getCareerFitBreakdown === 'function') {
          quizFitBreakdown = FWHubCareers.getCareerFitBreakdown(id, q.scores);
        }
      }

      let targetSoc = careerSoc || null;
      if (!targetSoc && global.FWOnetVectors && typeof FWOnetVectors.resolveTargetSoc === 'function') {
        targetSoc = await FWOnetVectors.resolveTargetSoc(careerSlug, careerSoc);
      }
      let vectorFit = null;
      if (targetSoc && global.FWOnetVectors && typeof FWOnetVectors.fetchAuthenticatedVectorFit === 'function') {
        vectorFit = await FWOnetVectors.fetchAuthenticatedVectorFit(targetSoc);
        if (vectorFit && vectorFit.fitScore != null && state.generatingFitScore == null) {
          state.generatingFitScore = Math.round(vectorFit.fitScore);
          render();
        }
      }

      const body = {
        action: 'generate',
        careerSlug: careerSlug,
        careerName: careerName,
        userName: (q && q.name) || 'Student',
        refresh: !!refresh,
        version: 2,
      };
      if (q && q.scores) body.quizScores = q.scores;
      if (quizFitBreakdown) body.quizFitBreakdown = quizFitBreakdown;
      if (targetSoc) body.targetSoc = targetSoc;
      if (vectorFit) body.vectorFit = vectorFit;
      if (q && q.resumeSummary) body.resumeSummary = q.resumeSummary;
      if (q && q.characterSummary) body.characterSummary = q.characterSummary;
      if (q && q.customAnswers) body.customAnswers = q.customAnswers;

      const resp = await fetchWithTimeout(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      }, GENERATE_TIMEOUT_MS);
      const data = await resp.json().catch(function () { return {}; });
      if (!resp.ok) throw new Error(data.error || 'Could not generate roadmap.');
      if (!data.roadmap) throw new Error('No roadmap returned. Try again in a moment.');
      if (data.roadmap) setRoadmap(data.roadmap, true);
    } catch (err) {
      state.error = friendlyGenerateError(err);
    } finally {
      state.generating = false;
      state.generatingCareerName = '';
      state.generatingFitScore = null;
      render();
    }
  }

  function toggleAction(phaseKey, actionId) {
    if (!state.roadmap) return;
    if (isTreeRoadmap(state.roadmap)) {
      toggleNodeDone(actionId);
      return;
    }
    const phases = state.roadmap.phases.map(function (phase) {
      if (phase.key !== phaseKey) return phase;
      return {
        ...phase,
        actions: (phase.actions || []).map(function (a) {
          if (a.id !== actionId) return a;
          return { ...a, done: !a.done };
        }),
      };
    });
    const updated = { ...state.roadmap, phases: phases, updatedAt: new Date().toISOString() };
    setRoadmap(updated, true);
    render();
  }

  function refreshDrawerIfOpen(opts) {
    if (!global.FWRoadmapTree || !state.roadmap) return;
    const nodeId = FWRoadmapTree.getOpenDrawerNodeId && FWRoadmapTree.getOpenDrawerNodeId();
    if (nodeId) FWRoadmapTree.refreshDrawerForNode(state.roadmap, nodeId, opts || {});
  }

  function updateTreeNodes(mapper) {
    if (!state.roadmap || !isTreeRoadmap(state.roadmap)) return null;
    const nodes = (state.roadmap.nodes || []).map(mapper);
    const updated = Object.assign({}, state.roadmap, {
      nodes: nodes,
      updatedAt: new Date().toISOString(),
    });
    setRoadmap(updated, true);
    state.roadmap = updated;
    return updated;
  }

  function persistRoadmapFromTracker(updated) {
    if (global.FWSkillGapTracker && typeof FWSkillGapTracker.maybeAdvanceOnComplete === 'function') {
      FWSkillGapTracker.maybeAdvanceOnComplete(updated, trackerAdvanceCtx());
      return;
    }
    applyRoadmapFromTracker(updated);
  }

  function applyRoadmapFromTracker(updated) {
    const synced = global.FWSkillGapTracker && typeof FWSkillGapTracker.syncProgress === 'function'
      ? FWSkillGapTracker.syncProgress(updated)
      : updated;
    setRoadmap(synced, true);
    state.roadmap = synced;
    render();
    refreshDrawerIfOpen();
    if (state.focusOpen) renderFocusPanel();
  }

  function showRoadmapAdvanceLoading() {
    const loading = document.getElementById('roadmap-focus-loading');
    if (loading) {
      loading.textContent = 'Loading your next waypoint…';
      loading.hidden = false;
    }
  }

  function hideRoadmapAdvanceLoading() {
    const loading = document.getElementById('roadmap-focus-loading');
    if (loading) {
      loading.hidden = true;
      loading.textContent = 'Opening your focus…';
    }
  }

  function trackerAdvanceCtx() {
    const q = quizData();
    return {
      onPersist: applyRoadmapFromTracker,
      runAdvance: function () {
        if (!global.FWSkillGapTracker || typeof FWSkillGapTracker.runFocusAdvance !== 'function') return;
        FWSkillGapTracker.runFocusAdvance({
          getTree: function () { return state.roadmap; },
          quizScores: q && q.scores ? q.scores : null,
          showLoading: showRoadmapAdvanceLoading,
          hideLoading: hideRoadmapAdvanceLoading,
          onPersist: applyRoadmapFromTracker,
        });
      },
    };
  }

  function focusWaypointForRoadmap(rm) {
    if (!rm) return null;
    // Branch-aware focus (WS6): when a secondary branch is active, the focus card
    // follows that branch's next-undone waypoint.
    if (global.FWSkillGapTracker && typeof FWSkillGapTracker.branchFocusWaypoint === 'function') {
      const branchWp = FWSkillGapTracker.branchFocusWaypoint(rm);
      if (branchWp) return branchWp;
    }
    if (rm.focusTracker && rm.focusTracker.waypointId) {
      const pinned = (rm.nodes || []).find(function (n) { return n.id === rm.focusTracker.waypointId; });
      if (pinned) return pinned;
    }
    return global.FWRoadmapTree && FWRoadmapTree.immediateWaypoint
      ? FWRoadmapTree.immediateWaypoint(rm) : null;
  }

  function toggleNodeDone(nodeId) {
    if (!state.roadmap || !isTreeRoadmap(state.roadmap)) return;
    const node = (state.roadmap.nodes || []).find(function (n) { return n.id === nodeId; });
    if (!node) return;
    const markingUndone = !!node.done;
    if (markingUndone) {
      if (global.FWRoadmapTree && !FWRoadmapTree.canMarkWaypointUndone(state.roadmap, nodeId)) {
        showRoadmapToast('Only the most recently completed waypoint can be marked undone.');
        refreshDrawerIfOpen();
        return;
      }
    } else if (global.FWRoadmapTree && !FWRoadmapTree.canEditWaypoint(state.roadmap, nodeId)) {
      showRoadmapToast(roadmapEditBlockedMessage());
      refreshDrawerIfOpen();
      return;
    }
    updateTreeNodes(function (n) {
      if (n.id !== nodeId) return n;
      const done = !n.done;
      const steps = (n.steps || []).map(function (s) {
        return Object.assign({}, s, { done: done });
      });
      const out = Object.assign({}, n, {
        done: done,
        steps: steps.length ? steps : n.steps,
        status: done ? 'completed' : 'active',
      });
      if (global.FWRoadmapTree && FWRoadmapTree.syncNodeDoneFromSteps) FWRoadmapTree.syncNodeDoneFromSteps(out);
      return out;
    });
    if (markingUndone && global.FWSkillGapTracker
      && typeof FWSkillGapTracker.resetFocusTrackerForWaypoint === 'function') {
      const q = quizData();
      const reset = FWSkillGapTracker.resetFocusTrackerForWaypoint(
        state.roadmap,
        nodeId,
        q && q.scores ? q.scores : null
      );
      setRoadmap(reset, true);
      state.roadmap = reset;
      render();
      refreshDrawerIfOpen();
      if (state.focusOpen) renderFocusPanel();
      return;
    }
    if (!markingUndone && global.FWSkillGapTracker
      && typeof FWSkillGapTracker.maybeAdvanceOnComplete === 'function') {
      FWSkillGapTracker.maybeAdvanceOnComplete(state.roadmap, trackerAdvanceCtx());
      return;
    }
    render();
    refreshDrawerIfOpen();
    if (state.focusOpen) renderFocusPanel();
  }

  function toggleStep(nodeId, stepId) {
    if (!state.roadmap || !isTreeRoadmap(state.roadmap)) return;
    if (global.FWRoadmapTree && !FWRoadmapTree.canEditWaypoint(state.roadmap, nodeId)) {
      showRoadmapToast(roadmapEditBlockedMessage());
      refreshDrawerIfOpen();
      return;
    }
    updateTreeNodes(function (n) {
      if (n.id !== nodeId) return n;
      const steps = (n.steps || []).map(function (s) {
        if (s.id !== stepId) return s;
        return Object.assign({}, s, { done: !s.done });
      });
      const out = Object.assign({}, n, { steps: steps });
      if (global.FWRoadmapTree && FWRoadmapTree.syncNodeDoneFromSteps) FWRoadmapTree.syncNodeDoneFromSteps(out);
      return out;
    });
    if (global.FWSkillGapTracker && typeof FWSkillGapTracker.maybeAdvanceOnComplete === 'function') {
      FWSkillGapTracker.maybeAdvanceOnComplete(state.roadmap, trackerAdvanceCtx());
      return;
    }
    render();
    refreshDrawerIfOpen();
  }

  function renderFocusPanel() {
    const panel = document.getElementById('roadmap-focus-view');
    const canvasWrap = document.getElementById('roadmap-canvas-wrap');
    if (!panel || !state.roadmap || !global.FWSkillGapTracker) return;
    const wp = focusWaypointForRoadmap(state.roadmap);
    if (!wp) {
      state.focusOpen = false;
      panel.hidden = true;
      if (canvasWrap) canvasWrap.hidden = false;
      syncRefineFabVisibility();
      return;
    }
    panel.hidden = false;
    if (canvasWrap) canvasWrap.hidden = true;
    if (global.FWRoadmapTree && FWRoadmapTree.closeDrawer) FWRoadmapTree.closeDrawer();
    const advanceCtx = trackerAdvanceCtx();
    FWSkillGapTracker.renderFocusView(panel, state.roadmap, wp, {
      editable: true,
      getTree: function () { return state.roadmap; },
      onBack: function () {
        state.focusOpen = false;
        panel.hidden = true;
        if (canvasWrap) canvasWrap.hidden = false;
        if (state.treeController && state.treeController.redraw) state.treeController.redraw();
        syncRefineFabVisibility();
      },
      onPersist: persistRoadmapFromTracker,
      maybeAdvanceOnComplete: function (updated) {
        FWSkillGapTracker.maybeAdvanceOnComplete(updated, advanceCtx);
      },
      runAdvance: advanceCtx.runAdvance,
    });
    syncRefineFabVisibility();
  }

  function restoreFocusView() {
    state.focusOpen = true;
    const loading = document.getElementById('roadmap-focus-loading');
    clearFocusLoadingTimers();
    if (loading) loading.hidden = true;
    renderFocusPanel();
  }

  function openFocusView() {
    const loading = document.getElementById('roadmap-focus-loading');
    clearFocusLoadingTimers();
    if (loading) {
      loading.hidden = false;
      focusLoadingTimer = setTimeout(function () {
        focusLoadingTimer = null;
        loading.hidden = true;
        state.focusOpen = true;
        renderFocusPanel();
      }, 400);
      focusLoadingSafetyTimer = setTimeout(function () {
        focusLoadingSafetyTimer = null;
        if (!loading || loading.hidden) return;
        loading.hidden = true;
        state.focusOpen = false;
        state.error = state.error || 'Focus view took too long to load. Try opening your roadmap again.';
        const canvasWrap = document.getElementById('roadmap-canvas-wrap');
        const panel = document.getElementById('roadmap-focus-view');
        if (panel) panel.hidden = true;
        if (canvasWrap) canvasWrap.hidden = false;
        render();
      }, FOCUS_LOADING_SAFETY_MS);
      return;
    }
    state.focusOpen = true;
    renderFocusPanel();
  }

  function isRoadmapPageActive() {
    if (document.body && document.body.classList.contains('roadmap-page')) return true;
    const page = document.getElementById('page-roadmap');
    return !!(page && page.classList.contains('active'));
  }

  function roadmapPageUrl(pending) {
    var base = (global.FWPageBoot && FWPageBoot.URLS.roadmap) || 'roadmap.html';
    var qs = [];
    if (pending && pending.focus) qs.push('focus=1');
    if (pending && pending.career) qs.push('career=' + encodeURIComponent(pending.career));
    return qs.length ? base + '?' + qs.join('&') : base;
  }

  function authSignInForRoadmap() {
    if (global.FWPageBoot && typeof FWPageBoot.authSignInUrl === 'function') {
      return FWPageBoot.authSignInUrl('roadmap.html');
    }
    return 'auth.html#signin?next=' + encodeURIComponent('roadmap.html');
  }

  function syncRefineFabVisibility() {
    const fab = document.getElementById('roadmap-refine-fab');
    if (!fab) return;
    const drawerOpen = global.FWRoadmapTree && FWRoadmapTree.getOpenDrawerNodeId
      && FWRoadmapTree.getOpenDrawerNodeId();
    const show = isRoadmapPageActive()
      && state.roadmap
      && hasRoadmap(state.roadmap)
      && !state.chatOpen
      && !state.focusOpen
      && !drawerOpen;
    fab.hidden = !show;
  }

  function ensureChatUi() {
    if (document.getElementById('roadmap-chat-drawer')) return;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="roadmap-chat-drawer" class="career-chat-drawer roadmap-chat-drawer" hidden>'
      + '<div class="career-chat-header"><div><div class="career-chat-eye">Roadmap assistant</div>'
      + '<h3 class="career-chat-title">Refine your plan</h3>'
      + '<p class="career-chat-sub" id="roadmap-chat-count"></p></div>'
      + '<button type="button" class="career-chat-close" id="roadmap-chat-close" aria-label="Close">×</button></div>'
      + '<div class="career-chat-messages" id="roadmap-chat-messages"></div>'
      + '<div class="career-chat-input-row">'
      + '<textarea id="roadmap-chat-input" class="career-chat-input" rows="2" placeholder="Ask to adjust your plan…" aria-label="Message"></textarea>'
      + '<button type="button" id="roadmap-chat-send" class="career-chat-send">Send</button>'
      + '</div></div>'
      + '<button type="button" id="roadmap-refine-fab" class="career-ask-fab roadmap-refine-fab" hidden aria-label="Refine roadmap">'
      + '<span aria-hidden="true">✦</span> Refine plan</button>');

    document.getElementById('roadmap-chat-close').addEventListener('click', closeRefineChat);
    document.getElementById('roadmap-refine-fab').addEventListener('click', openRefineChat);
    document.getElementById('roadmap-chat-send').addEventListener('click', sendRefineChat);
    document.getElementById('roadmap-chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRefineChat(); }
    });
  }

  function openRefineChat() {
    ensureChatUi();
    state.chatOpen = true;
    document.getElementById('roadmap-chat-drawer').hidden = false;
    document.getElementById('roadmap-refine-fab').hidden = true;
    updateChatCount();
  }

  function closeRefineChat() {
    state.chatOpen = false;
    const drawer = document.getElementById('roadmap-chat-drawer');
    if (drawer) drawer.hidden = true;
    syncRefineFabVisibility();
  }

  function updateChatCount() {
    const el = document.getElementById('roadmap-chat-count');
    if (!el) return;
    const left = 5 - state.exchangeCount;
    el.textContent = left > 0
      ? left + ' exchange' + (left === 1 ? '' : 's') + ' until memory refresh'
      : 'Memory refreshed';
  }

  function appendChatMsg(role, text) {
    const wrap = document.getElementById('roadmap-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'career-chat-msg ' + role;
    div.textContent = text;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function showChatTyping() {
    const wrap = document.getElementById('roadmap-chat-messages');
    if (!wrap || document.getElementById('roadmap-chat-typing')) return;
    const div = document.createElement('div');
    div.id = 'roadmap-chat-typing';
    div.className = 'coach-typing';
    div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function hideChatTyping() {
    const el = document.getElementById('roadmap-chat-typing');
    if (el) el.remove();
  }

  async function sendRefineChat() {
    const input = document.getElementById('roadmap-chat-input');
    if (!input || !state.roadmap) return;
    const msg = (input.value || '').trim();
    if (!msg) return;
    input.value = '';
    input.disabled = true;
    document.getElementById('roadmap-chat-send').disabled = true;
    appendChatMsg('user', msg);
    showChatTyping();

    try {
      const q = quizData();
      const body = {
        action: 'chat',
        careerSlug: state.roadmap.targetCareerSlug,
        careerName: state.roadmap.targetCareerName,
        userMessage: msg,
        currentRoadmap: state.roadmap,
      };
      if (q) {
        if (q.scores) body.quizScores = q.scores;
        if (q.name) body.userName = q.name;
        if (q.characterSummary) body.characterSummary = q.characterSummary;
        if (q.customAnswers) body.customAnswers = q.customAnswers;
        if (q.profileBuilding && q.profileBuilding.answers && global.FWAuth
          && typeof FWAuth.profileBuildingAnswersForApi === 'function') {
          body.profileBuildingAnswers = FWAuth.profileBuildingAnswersForApi(q.profileBuilding);
        }
      }
      const resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(function () { return {}; });
      hideChatTyping();
      if (!resp.ok) throw new Error(data.error || 'Chat failed.');
      appendChatMsg('assistant', data.reply || 'Done.');
      if (data.intent === 'update' && data.roadmap) setRoadmap(data.roadmap, true);
      state.exchangeCount = data.reset ? 0 : (data.exchangeCount || state.exchangeCount);
      updateChatCount();
      if (data.intent === 'update') render();
    } catch (err) {
      hideChatTyping();
      appendChatMsg('assistant', (err && err.message) || 'Something went wrong.');
    } finally {
      input.disabled = false;
      document.getElementById('roadmap-chat-send').disabled = false;
      input.focus();
    }
  }

  function renderEmpty(head, body) {
    const q = quizData();
    const matches = topMatches(3);
    const resolvedTarget = resolveEmptyTarget();

    let selectedSlug = state.pendingSlug || '';
    let selectedName = state.pendingName || '';
    let selectedSoc = state.pendingSoc || '';
    if (!selectedSlug && resolvedTarget) {
      selectedSlug = resolvedTarget.slug;
      selectedName = resolvedTarget.name;
      selectedSoc = resolvedTarget.soc || '';
    }

    if (resolvedTarget && resolvedTarget.name) {
      head.innerHTML = '<div class="portal-greeting-row"><div>'
        + '<div class="portal-eyebrow">Career Roadmap</div>'
        + '<h1 class="portal-title">Your step-by-step plan for ' + esc(resolvedTarget.name) + '</h1>'
        + '<p class="portal-email">AI builds a personalized roadmap centered on your target career.</p></div></div>';
    } else {
      head.innerHTML = '<div class="portal-greeting-row"><div>'
        + '<div class="portal-eyebrow">Career Roadmap</div>'
        + '<h1 class="portal-title">Your step-by-step plan</h1>'
        + '<p class="portal-email">AI builds a personalized roadmap for your target career.</p></div></div>';
    }

    if (!q || !q.scores) {
      body.innerHTML = '<div class="portal-panel portal-empty">'
        + renderErrorPanel(state.error)
        + '<h2 class="portal-panel-title">Quick match first</h2>'
        + '<p class="portal-empty-text">Take the short quiz so we can personalize your roadmap.</p>'
        + '<button type="button" class="coach-secondary-btn portal-empty-cta" id="roadmap-go-quiz">Quick match (~90s) →</button></div>';
      document.getElementById('roadmap-go-quiz').addEventListener('click', function () {
        location.href = (global.FWPageBoot && FWPageBoot.URLS.quiz) || 'quiz.html';
      });
      return;
    }

    let bodyHtml = '<div class="portal-panel portal-panel--wide roadmap-empty-panel">';
    bodyHtml += renderErrorPanel(state.error);

    if (resolvedTarget) {
      const scoreLabel = fitLabel(resolvedTarget.score, ' fit');
      const orbColor = (resolvedTarget.rarity && resolvedTarget.rarity.base) || '#9AA0AD';
      const gaps = (global.FWCareerTarget && typeof FWCareerTarget.gapsForTarget === 'function')
        ? FWCareerTarget.gapsForTarget(resolvedTarget, state.roadmap) : [];
      bodyHtml += '<div class="roadmap-focused-target">'
        + '<p class="roadmap-focused-label">Your target career</p>'
        + '<div class="roadmap-focused-card">'
        + '<span class="portal-target-orb" style="background:' + esc(orbColor) + '" aria-hidden="true"></span>'
        + '<div class="roadmap-focused-main">'
        + '<span class="roadmap-focused-name">' + esc(resolvedTarget.name) + '</span>'
        + (scoreLabel ? '<span class="roadmap-focused-fit">' + esc(scoreLabel) + '</span>' : '')
        + '</div></div>';
      if (gaps.length) {
        bodyHtml += '<div class="roadmap-focused-gaps">'
          + gaps.map(function (g) {
            const label = global.FWCareerTarget && FWCareerTarget.formatGapLabel
              ? FWCareerTarget.formatGapLabel(g) : g;
            return '<span class="portal-chip portal-chip--ai">' + esc(label) + '</span>';
          }).join('')
          + '</div>';
      }
      bodyHtml += '<button type="button" class="cta-btn roadmap-generate-btn" id="roadmap-generate-focused"'
        + (resolvedTarget.slug ? '' : ' disabled')
        + '>'
        + 'Generate roadmap for ' + esc(resolvedTarget.name) + ' →</button>'
        + '</div>';
      bodyHtml += '<details class="roadmap-alt-picker">'
        + '<summary class="roadmap-alt-picker-summary">Pick a different career</summary>'
        + '<div class="roadmap-picker"><p class="roadmap-picker-label">Other top matches:</p><div class="roadmap-picker-grid">';
    } else {
      bodyHtml += '<div class="roadmap-picker"><p class="roadmap-picker-label">Choose a target career:</p><div class="roadmap-picker-grid">';
    }

    matches.forEach(function (m) {
      const slug = m.slug || ((global.FWHubCareers && FWHubCareers.careerSlug)
        ? FWHubCareers.careerSlug(m.career.id) : '');
      if (!slug) return;
      const onCls = (slug === selectedSlug) ? ' roadmap-pick-card--on' : '';
      const socAttr = m.soc ? ' data-soc="' + esc(m.soc) + '"' : '';
      bodyHtml += '<button type="button" class="portal-card roadmap-pick-card' + onCls + '" data-slug="' + esc(slug) + '" data-name="' + esc(m.career.name) + '"' + socAttr + '>'
        + '<span class="portal-card-body"><span class="portal-card-label">' + esc(m.career.name) + '</span>'
        + '<span class="portal-card-desc">' + esc(fitLabel(m.score, ' fit')) + '</span></span></button>';
    });

    if (resolvedTarget) {
      bodyHtml += '</div>'
        + '<button type="button" class="cta-btn cta-btn-outline roadmap-generate-btn" id="roadmap-generate-alt" disabled>Generate roadmap →</button>'
        + '<p class="roadmap-picker-hint">Or pick any career from the <a href="dashboard.html">Career Hub</a>.</p>'
        + '</div></details>';
    } else {
      bodyHtml += '</div>'
        + '<button type="button" class="cta-btn roadmap-generate-btn" id="roadmap-generate-top" disabled>Generate roadmap →</button>'
        + '<p class="roadmap-picker-hint">Or pick any career from the <a href="dashboard.html">Career Hub</a>.</p>'
        + '</div>';
    }

    bodyHtml += '</div>';
    body.innerHTML = bodyHtml;

    const focusedBtn = document.getElementById('roadmap-generate-focused');
    if (focusedBtn && resolvedTarget && resolvedTarget.slug) {
      focusedBtn.addEventListener('click', function () {
        generate(resolvedTarget.slug, resolvedTarget.name, false, resolvedTarget.soc || null);
      });
    }

    const altGenBtn = document.getElementById('roadmap-generate-alt');
    const topGenBtn = document.getElementById('roadmap-generate-top');
    const genBtn = altGenBtn || topGenBtn;

    body.querySelectorAll('.roadmap-pick-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        body.querySelectorAll('.roadmap-pick-card').forEach(function (b) { b.classList.remove('roadmap-pick-card--on'); });
        btn.classList.add('roadmap-pick-card--on');
        selectedSlug = btn.getAttribute('data-slug');
        selectedName = btn.getAttribute('data-name');
        selectedSoc = btn.getAttribute('data-soc') || '';
        if (genBtn) genBtn.disabled = !selectedSlug;
      });
    });

    if (selectedSlug && genBtn) genBtn.disabled = false;

    if (genBtn) {
      genBtn.addEventListener('click', function () {
        if (selectedSlug && selectedName) generate(selectedSlug, selectedName, false, selectedSoc || null);
      });
    }

    if (selectedSlug && selectedName && state.pendingSlug) {
      if (state.pendingRoadmap && hasRoadmap(state.pendingRoadmap)
        && state.pendingRoadmap.targetCareerSlug === selectedSlug) {
        setRoadmap(state.pendingRoadmap, true);
        state.pendingRoadmap = null;
      } else if (selectedSlug) {
        generate(selectedSlug, selectedName, false, selectedSoc || null);
      }
      state.pendingSlug = null;
      state.pendingName = null;
      state.pendingSoc = null;
    }
  }

  function redrawTree() {
    if (state.treeController && state.treeController.redraw) state.treeController.redraw();
  }

  function refreshDrawerBranchState(opts) {
    if (!global.FWRoadmapTree || !state.roadmap) return;
    const nodeId = FWRoadmapTree.getOpenDrawerNodeId && FWRoadmapTree.getOpenDrawerNodeId();
    if (nodeId) FWRoadmapTree.refreshDrawerForNode(state.roadmap, nodeId, opts || {});
  }

  // Client-only preview of an alternate route (WS1). Computes the trunk->target
  // chain locally, shows the banner, and re-renders the tree — never calls the
  // server (the 'follow' action saves immediately; that is the commit path).
  function startBranchPreview(nodeId) {
    if (!global.FWRoadmapTree || !state.roadmap) return;
    const path = FWRoadmapTree.computePreviewPath(state.roadmap, nodeId);
    if (!path || path.length <= 1) return;
    FWRoadmapTree.setPreviewPath(path);
    state.previewNodeId = nodeId;
    mountPreviewBanner();
    redrawTree();
    refreshDrawerBranchState();
  }

  function exitBranchPreview() {
    if (!global.FWRoadmapTree) return;
    FWRoadmapTree.clearPreviewPath();
    state.previewNodeId = null;
    unmountPreviewBanner();
    redrawTree();
    refreshDrawerBranchState();
  }

  function mountPreviewBanner() {
    const panel = document.querySelector('.roadmap-tree-panel');
    if (!panel) return;
    let banner = document.getElementById('roadmap-preview-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'roadmap-preview-banner';
      banner.className = 'roadmap-preview-banner';
      banner.innerHTML = '<span class="roadmap-preview-banner-label">Previewing alternate route</span>'
        + '<div class="roadmap-preview-banner-actions">'
        + '<button type="button" class="cta-btn roadmap-preview-commit">Commit</button>'
        + '<button type="button" class="cta-btn cta-btn-outline roadmap-preview-exit">Exit preview</button>'
        + '</div>';
      panel.appendChild(banner);
      banner.querySelector('.roadmap-preview-commit').addEventListener('click', function () {
        if (state.previewNodeId) commitBranch(state.previewNodeId);
      });
      banner.querySelector('.roadmap-preview-exit').addEventListener('click', exitBranchPreview);
    }
    banner.hidden = false;
  }

  function unmountPreviewBanner() {
    const banner = document.getElementById('roadmap-preview-banner');
    if (banner) banner.hidden = true;
  }

  async function postGraphAction(body) {
    const resp = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || 'Could not update your roadmap path.');
    return data;
  }

  // Commit resolution (WS3): if the target's chain root maps to a decision option,
  // POST {choose}; otherwise POST {follow}. On success we adopt the saved roadmap,
  // clear the preview, and offer the AI-extend CTA on the committed branch tip.
  async function commitBranch(nodeId) {
    if (!global.FWRoadmapTree || !state.roadmap || state.committing) return;
    const hit = FWRoadmapTree.findDecisionForNode(state.roadmap, nodeId);
    if (!hit) {
      showRoadmapToast('Could not find branch decision.');
      return;
    }
    // Check if the branch choice waypoint (major spine node) is completed
    const majorNode = (state.roadmap.nodes || []).find(function (n) { return n.id === hit.decision.nodeId; });
    if (!majorNode || !majorNode.done) {
      // Show a styled confirm dialog
      if (global.FWConfirm && typeof FWConfirm.show === 'function') {
        const confirmed = await FWConfirm.show({
          title: 'Cannot commit yet',
          message: 'You must complete the branch choice waypoint ("' + (majorNode?.shortTitle || majorNode?.title || 'Major waypoint') + '") before committing to this branch. Complete that waypoint first, then return here to commit.',
          confirmText: 'OK',
          cancelText: '',
          type: 'info',
        });
      } else {
        alert('You must complete the branch choice waypoint ("' + (majorNode?.shortTitle || majorNode?.title || 'Major waypoint') + '") before committing to this branch.');
      }
      return;
    }
    state.committing = true;
    refreshDrawerBranchState({ branchPending: true });
    try {
      const body = hit
        ? { action: 'choose', decisionId: hit.decision.id, optionId: hit.option.id, currentRoadmap: state.roadmap }
        : { action: 'follow', targetNodeId: nodeId, currentRoadmap: state.roadmap };
      const data = await postGraphAction(body);
      if (data.roadmap) setRoadmap(data.roadmap, false);
      exitBranchPreview();
      showRoadmapToast(data.reply || 'Committed to this branch.');
      render();
      // Re-open the drawer on the committed node so the user sees the follow-up
      // Extend / Track affordances without hunting for the node again.
      if (FWRoadmapTree.refreshDrawerForNode && state.roadmap) {
        // Pass the branch root node ID so the drawer can show the branch focus option
        FWRoadmapTree.refreshDrawerForNode(state.roadmap, nodeId, { committedBranchRoot: hit.option.childNodeId });
      }
    } catch (err) {
      showRoadmapToast((err && err.message) || 'Could not commit to that branch.');
      refreshDrawerBranchState({ error: (err && err.message) || '' });
    } finally {
      state.committing = false;
    }
  }

  async function extendBranch(nodeId) {
    if (!state.roadmap || state.committing) return;
    state.committing = true;
    refreshDrawerBranchState({ branchPending: true, branchAction: 'extend' });
    showRoadmapToast('Generating new steps for your branch…');
    try {
      const data = await postGraphAction({
        action: 'extend',
        branchNodeId: nodeId,
        currentRoadmap: state.roadmap,
      });
      if (data.roadmap) setRoadmap(data.roadmap, false);
      showRoadmapToast(data.reply || 'Added new steps to your branch.');
      render();
    } catch (err) {
      showRoadmapToast((err && err.message) || 'Could not extend that branch.');
      refreshDrawerBranchState({ error: (err && err.message) || '' });
    } finally {
      state.committing = false;
    }
  }

  // Track a committed branch in Focus (WS6): add/switch the secondary branchFocus
  // entry (max 2: main + one secondary), set it active, then open the focus view.
  function trackBranchInFocus(nodeId) {
    if (!global.FWSkillGapTracker || !state.roadmap) return;
    if (typeof FWSkillGapTracker.trackBranchFocus !== 'function') return;
    const updated = FWSkillGapTracker.trackBranchFocus(state.roadmap, nodeId, trackerQuizScores());
    if (!updated) return;
    setRoadmap(updated, true);
    state.roadmap = updated;
    if (global.FWRoadmapTree && FWRoadmapTree.closeDrawer) FWRoadmapTree.closeDrawer();
    openFocusView();
  }

  function trackerQuizScores() {
    const q = quizData();
    return q && q.scores ? q.scores : null;
  }

  function bindTreeCanvas(wrap, rm) {
    const canvas = wrap.querySelector('#roadmap-canvas');
    if (!canvas || !global.FWRoadmapTree) return;
    state.treeController = FWRoadmapTree.bindCanvas(canvas, rm, {
      getTree: function () { return state.roadmap; },
      onMarkDone: toggleNodeDone,
      onToggleStep: toggleStep,
      onPreviewPath: startBranchPreview,
      onExitPreview: exitBranchPreview,
      onCommitBranch: commitBranch,
      onExtendBranch: extendBranch,
      onTrackBranch: trackBranchInFocus,
      onNodeSelect: function (hit, tree) {
        const imm = FWRoadmapTree.immediateWaypoint(tree);
        if (imm && hit.id === imm.id) {
          openFocusView();
          return true;
        }
        return false;
      },
    });
  }

  function renderActive(head, body) {
    const rm = state.roadmap;
    const prog = progress(rm);
    const isTree = isTreeRoadmap(rm);
    const resolvedTarget = resolveEmptyTarget();

    const progLabel = isTree
      ? prog.done + '/' + prog.total + ' steps'
      : prog.done + '/' + prog.total + ' done';

    head.innerHTML = '';

    let html = '';

    if (state.error) {
      html += renderErrorPanel(state.error);
    }

    if (isTree) {
      const mismatchChip = (resolvedTarget && resolvedTarget.slug && resolvedTarget.slug !== rm.targetCareerSlug)
        ? '<button type="button" class="roadmap-hud-chip roadmap-hud-chip--warn" id="roadmap-retarget">Target: '
          + esc(resolvedTarget.name) + ' — update plan</button>'
        : '';
      const imm = global.FWRoadmapTree && FWRoadmapTree.immediateWaypoint
        ? FWRoadmapTree.immediateWaypoint(rm) : null;
      const focusChip = imm
        ? '<span class="roadmap-hud-chip">Current focus: ' + esc(imm.shortTitle || imm.title || 'Waypoint') + '</span>'
        : '';

      html += '<div class="roadmap-stage">'
        + '<div class="roadmap-hud">'
        + '<div class="roadmap-hud-left">'
        + '<h1 class="roadmap-hud-title">' + esc(rm.targetCareerName) + '</h1>'
        + '<p class="roadmap-hud-sub">Your long-term path</p>';
      const fc = rm.fitContext || {};
      if (fc.targetSoc && global.FWOnetVectors && typeof FWOnetVectors.renderDualFitBarsHtml === 'function') {
        html += '<div class="roadmap-hud-fit">' + FWOnetVectors.renderDualFitBarsHtml(
          fc.personalityFit,
          fc.objectiveFit,
          { preparedness: fc.preparedness }
        ) + '</div>';
      }
      html += '<div class="roadmap-hud-progress">'
        + '<span class="roadmap-hud-progress-label">' + esc(progLabel) + '</span>'
        + '<div class="roadmap-hud-progress-bar"><span style="width:' + prog.pct + '%"></span></div>'
        + '</div>'
        + mismatchChip
        + focusChip
        + '</div>'
        + '<div class="roadmap-hud-actions">'
        + '<button type="button" class="roadmap-hud-btn roadmap-hud-btn--primary" id="roadmap-regen" title="Regenerate plan" aria-label="Regenerate plan">↻</button>'
        + '</div>'
        + '</div>';

      html += '<div class="roadmap-tree-panel">'
        + '<div class="roadmap-focus-loading" id="roadmap-focus-loading" hidden>Opening your focus…</div>'
        + '<div class="roadmap-canvas-wrap" id="roadmap-canvas-wrap">'
        + '<canvas id="roadmap-canvas" role="img" aria-label="Career roadmap tree"></canvas>'
        + '</div>'
        + '<div class="roadmap-focus-view" id="roadmap-focus-view" hidden></div>'
        + '</div>';

      html += '</div>';
    } else {
      html += '<div class="roadmap-stage roadmap-stage--legacy">'
        + '<div class="roadmap-hud">'
        + '<div class="roadmap-hud-left">'
        + '<h1 class="roadmap-hud-title">' + esc(rm.targetCareerName) + '</h1>'
        + '<div class="roadmap-hud-progress">'
        + '<span class="roadmap-hud-progress-label">' + esc(progLabel) + '</span>'
        + '<div class="roadmap-hud-progress-bar"><span style="width:' + prog.pct + '%"></span></div>'
        + '</div></div>'
        + '<div class="roadmap-hud-actions">'
        + '<button type="button" class="roadmap-hud-btn roadmap-hud-btn--primary" id="roadmap-regen" title="Regenerate plan" aria-label="Regenerate plan">↻</button>'
        + '</div></div>'
        + '<div class="roadmap-legacy-empty">'
        + '<p>Your plan was saved in an older format. Upgrade it to the interactive career tree — '
        + 'your target career stays <strong>' + esc(rm.targetCareerName) + '</strong> and the rebuild '
        + 'takes about 20 seconds.</p>'
        + '<button type="button" class="cta-btn" id="roadmap-regen-legacy">Upgrade to career tree →</button>'
        + '</div></div>';
    }

    body.innerHTML = html;

    const retargetBtn = document.getElementById('roadmap-retarget');
    if (retargetBtn && resolvedTarget) {
      retargetBtn.addEventListener('click', function () {
        confirmAction({
          title: 'Update plan to ' + resolvedTarget.name + '?',
          message: 'This regenerates your roadmap for your new target career and replaces the current plan.',
          confirmLabel: 'Update plan',
        }).then(function (ok) {
          if (ok) generate(resolvedTarget.slug, resolvedTarget.name, true);
        });
      });
    }

    if (isTree) {
      bindTreeCanvas(body, rm);
      // A live preview survives a re-render of the tree panel DOM — re-mount its
      // banner (the module still holds previewPathIds) or drop it if stale.
      if (state.previewNodeId && global.FWRoadmapTree && FWRoadmapTree.getPreviewPath
        && FWRoadmapTree.getPreviewPath()) {
        mountPreviewBanner();
      } else if (state.previewNodeId) {
        exitBranchPreview();
      }
      if (state.pendingFocus) {
        state.pendingFocus = false;
        openFocusView();
      } else if (state.focusOpen) {
        restoreFocusView();
      }
    }

    const regenBtn = document.getElementById('roadmap-regen');
    const regenLegacyBtn = document.getElementById('roadmap-regen-legacy');
    function wireRegen(btn) {
      if (!btn) return;
      btn.addEventListener('click', function () {
        confirmAction({
          title: 'Regenerate your roadmap?',
          message: 'This replaces the current plan — completed checkmarks may be lost.',
          confirmLabel: 'Regenerate',
        }).then(function (ok) {
          if (!ok) return;
        if (global.FWAuth && typeof FWAuth.syncRoadmap === 'function' && FWAuth.authEmail && FWAuth.authEmail()) {
          state.generating = true;
          state.generatingCareerName = rm.targetCareerName || '';
          render();
          FWAuth.syncRoadmap({ force: true, reason: 'manual-regen' })
            .then(function (data) {
              if (data && data.roadmap) setRoadmap(data.roadmap, true);
            })
            .catch(function (err) {
              state.error = (err && err.message) || 'Regeneration failed.';
            })
            .finally(function () {
              state.generating = false;
              state.generatingCareerName = '';
              render();
            });
        } else {
          generate(rm.targetCareerSlug, rm.targetCareerName, true);
        }
        });
      });
    }
    wireRegen(regenBtn);
    wireRegen(regenLegacyBtn);

    ensureChatUi();
    syncRefineFabVisibility();
  }

  function renderLoading(body) {
    const name = state.generatingCareerName || 'your target career';
    const fitLabelText = Number.isFinite(state.generatingFitScore)
      ? '<span class="roadmap-generating-fit">' + esc(fitLabel(state.generatingFitScore, ' fit')) + '</span>' : '';
    const statusLines = [
      'Reading your profile and quiz results…',
      'Mapping your six-step career spine…',
      'Placing major decision branches…',
      'Writing checklist steps for each waypoint…',
    ];
    const spineDots = [1, 2, 3, 4, 5, 6].map(function (i) {
      return '<span class="roadmap-spine-dot" style="--dot-i:' + i + '"></span>';
    }).join('');

    body.innerHTML = '<div class="roadmap-stage roadmap-stage--generating">'
      + renderErrorPanel(state.error)
      + '<div class="roadmap-generating-card">'
      + '<div class="roadmap-generating-spinner" aria-hidden="true"></div>'
      + '<p class="roadmap-generating-eyebrow">Career Roadmap</p>'
      + '<h2 class="roadmap-generating-title">Building your plan for ' + esc(name) + fitLabelText + '</h2>'
      + '<div class="roadmap-generating-status" aria-live="polite">'
      + statusLines.map(function (line, i) {
        return '<p class="roadmap-generating-line" style="--line-i:' + i + '">' + esc(line) + '</p>';
      }).join('')
      + '</div>'
      + '<div class="roadmap-generating-progress" aria-hidden="true"><span></span></div>'
      + '<div class="roadmap-spine-preview" aria-hidden="true">' + spineDots + '</div>'
      + '</div></div>';
  }

  function renderInvalidTreeFallback(head, body, rm) {
    head.innerHTML = '';
    body.innerHTML = '<div class="roadmap-stage roadmap-stage--legacy">'
      + '<div class="roadmap-hud">'
      + '<div class="roadmap-hud-left">'
      + '<h1 class="roadmap-hud-title">' + esc(rm.targetCareerName || 'Your plan') + '</h1>'
      + '</div></div>'
      + '<div class="roadmap-legacy-empty">'
      + '<p class="roadmap-error">This plan couldn\'t be displayed as a career tree. Rebuild it for '
      + esc(rm.targetCareerName || 'your target career') + ' — it takes about 20 seconds.</p>'
      + '<button type="button" class="cta-btn" id="roadmap-regen">Rebuild career tree →</button>'
      + '</div></div>';
    const regen = document.getElementById('roadmap-regen');
    if (regen) {
      regen.addEventListener('click', function () {
        generate(rm.targetCareerSlug, rm.targetCareerName, true);
      });
    }
  }

  function render() {
    const head = document.getElementById('roadmap-head');
    const body = document.getElementById('roadmap-body');
    if (!head || !body) return;

    if (!isRoadmapPageActive()) {
      if (global.FWRoadmapTree && typeof FWRoadmapTree.closeDrawer === 'function') {
        FWRoadmapTree.closeDrawer();
      }
      closeRefineChat();
      return;
    }

    state.roadmap = readRoadmap();

    if (state.generating) {
      head.innerHTML = '';
      renderLoading(body);
      return;
    }

    if (state.roadmap && hasRoadmap(state.roadmap)) {
      if (isTreeRoadmap(state.roadmap) && (!state.roadmap.trunk || !state.roadmap.nodes)) {
        renderInvalidTreeFallback(head, body, state.roadmap);
      } else {
        renderActive(head, body);
      }
    } else {
      renderEmpty(head, body);
    }

    ensureBackgroundSync();

    syncRefineFabVisibility();
    mountRoadmapToast();

    setTimeout(function () {
      if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }, 0);
  }

  function open(pending) {
    if (pending && pending.roadmap && hasRoadmap(pending.roadmap)) {
      state.pendingRoadmap = pending.roadmap;
    }
    if (pending && pending.slug) {
      state.pendingSlug = pending.slug;
      state.pendingName = pending.name || pending.slug;
      state.pendingSoc = pending.soc || null;
      try {
        sessionStorage.setItem(PENDING_CAREER_KEY, JSON.stringify({
          slug: pending.slug,
          name: pending.name,
          soc: pending.soc || null,
        }));
      } catch (_) { /* ignore */ }
    }
    if (pending && pending.focus) {
      state.pendingFocus = true;
    } else if (pending && pending.focus === false) {
      state.pendingFocus = false;
    } else if (!isRoadmapPageActive()) {
      state.pendingFocus = !!(pending && pending.focus);
    }
    if (isRoadmapPageActive()) {
      if (pending && pending.focus) {
        try {
          var u = new URL(location.href);
          u.searchParams.set('focus', '1');
          history.replaceState(null, '', u.pathname + u.search);
        } catch (_) { /* ignore */ }
      }
      if (window.FWAppNav) FWAppNav.sync('roadmap');
      render();
      return;
    }
    location.href = roadmapPageUrl(pending);
  }

  function openFromNav() {
    const signedIn = (global.FWAuth && FWAuth.authEmail && FWAuth.authEmail());
    if (!signedIn) {
      location.href = authSignInForRoadmap();
      return;
    }
    open();
  }

  function syncHashFocusState() {
    const params = parseHashRoadmapParams();
    if (params.focus) {
      state.pendingFocus = true;
      if (isRoadmapPageActive()) render();
    } else if ((location.hash || '').replace(/^#/, '').split('?')[0] === 'roadmap') {
      state.pendingFocus = false;
      clearFocusLoadingTimers();
      if (state.focusOpen) {
        state.focusOpen = false;
        const loading = document.getElementById('roadmap-focus-loading');
        const panel = document.getElementById('roadmap-focus-view');
        const canvasWrap = document.getElementById('roadmap-canvas-wrap');
        if (loading) loading.hidden = true;
        if (panel) panel.hidden = true;
        if (canvasWrap) canvasWrap.hidden = false;
      }
      if (isRoadmapPageActive()) render();
    }
  }

  function bootPending() {
    const pending = consumePendingCareer();
    if (pending) {
      state.pendingSlug = pending.slug;
      state.pendingName = pending.name;
      state.pendingSoc = pending.soc || null;
    }
    if (parseHashRoadmapParams().focus) {
      state.pendingFocus = true;
    }
  }

  global.openRoadmap = open;
  global.openRoadmapFromNav = openFromNav;
  global.FWRoadmap = {
    render: render,
    open: open,
    generate: generate,
    progress: progress,
    bootPending: bootPending,
    syncHashFocusState: syncHashFocusState,
    showToast: showRoadmapToast,
    flushRoadmapSave: flushRoadmapSave,
    syncRefineFabVisibility: syncRefineFabVisibility,
    isRoadmapPageActive: isRoadmapPageActive,
    closeRefineChat: closeRefineChat,
  };

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushRoadmapSave();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.previewNodeId) {
        exitBranchPreview();
      }
    });
    window.addEventListener('hashchange', function () {
      syncHashFocusState();
    });
  }

  if (global.FWCareerTarget && typeof FWCareerTarget.onCareerFocusChanged === 'function') {
    FWCareerTarget.onCareerFocusChanged(function () {
      const local = readRoadmap();
      if (local) state.roadmap = local;
      if (isRoadmapPageActive()) {
        render();
      } else {
        syncRefineFabVisibility();
      }
    });
  }

  if (global.FWRoadmapSync && typeof FWRoadmapSync.subscribe === 'function') {
    FWRoadmapSync.subscribe(function (detail) {
      if (detail && detail.source === 'roadmap') return;
      const tree = (detail && detail.tree) || FWRoadmapSync.readPrepared();
      if (tree) {
        state.roadmap = tree;
        if (isRoadmapPageActive()) render();
      }
    });
    if (typeof FWRoadmapSync.bindPageshowRefresh === 'function') {
      FWRoadmapSync.bindPageshowRefresh(function () {
        const tree = FWRoadmapSync.readPrepared();
        if (tree) {
          state.roadmap = tree;
          if (isRoadmapPageActive()) render();
        }
      });
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
