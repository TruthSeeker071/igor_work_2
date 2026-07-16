/**
 * FlightWay signed-in home page (#page-portal).
 * Renders a personalized dashboard: greeting, action cards for every site
 * area, and a profile snapshot (archetype, character analysis, top industries,
 * top skills, top career matches). Data-driven so new areas/widgets are easy.
 */
(function (global) {
  // Site areas — append here to surface new features on the home page.
  const AREAS = [
    {
      key: 'hub',
      label: 'Career Hub',
      desc: 'Explore your matched careers and AI deep dives.',
      icon: 'compass',
      go: function () { location.href = (global.FWPageBoot && FWPageBoot.URLS.hub) || 'dashboard.html'; },
    },
    {
      key: 'profile-build',
      label: 'Help us know you better',
      desc: 'A few short prompts so your coach and deep dives feel personal.',
      icon: 'sparkles',
      hint: true,
      go: function () {
        location.href = (global.FWPageBoot && FWPageBoot.URLS.profile) || 'profile-build.html';
      },
    },
    {
      key: 'resume',
      label: 'Add your resume',
      desc: 'Upload experience to unlock objective fit scores.',
      icon: 'file-text',
      resumeHint: true,
      go: function () {
        if (global.FWPortalResume && typeof FWPortalResume.open === 'function') {
          FWPortalResume.open();
        }
      },
    },
    {
      key: 'refine',
      label: 'Sharpen matches',
      desc: 'A few more questions to fine-tune your career map.',
      icon: 'sliders-horizontal',
      go: function () { location.href = 'dashboard.html?refine=open'; },
    },
    {
      key: 'career-switch',
      label: 'Career Switch Advisor',
      desc: 'Explore or change your target career — scoped switching only.',
      icon: 'repeat',
      go: function () {
        if (global.FWPortalCareerAdvisor && typeof FWPortalCareerAdvisor.openDrawer === 'function') {
          FWPortalCareerAdvisor.openDrawer();
        } else {
          const input = document.getElementById('portal-career-advisor-input');
          if (input) input.focus();
        }
      },
    },
    {
      key: 'advisor',
      label: 'Marco',
      desc: 'Chat with Marco, your AI advisor who knows your profile.',
      icon: 'message-circle',
      go: function () {
        location.href = ((global.FWPageBoot && FWPageBoot.URLS.coach) || 'coach.html');
      },
    },
    {
      key: 'roadmap',
      label: 'Career Roadmap',
      desc: 'Step-by-step plan for your target career.',
      icon: 'map',
      go: function () { goRoadmap(); },
    },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function industryName(key) {
    if (global.QZ_IND && global.QZ_IND[key] && global.QZ_IND[key].name) return global.QZ_IND[key].name;
    return String(key || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function titleCase(s) {
    return String(s || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function profile() {
    try {
      if (global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') return FWAuth.readLocalQuiz();
    } catch (_) { /* ignore */ }
    return null;
  }

  function userEmail() {
    try {
      if (global.FWAuth && typeof FWAuth.authEmail === 'function') return FWAuth.authEmail();
    } catch (_) { /* ignore */ }
    return null;
  }

  function topCareers(scores, n) {
    if (global.FWOnetVectors && typeof FWOnetVectors.getCachedOnetRank === 'function') {
      var onetCached = FWOnetVectors.getCachedOnetRank(n || 3);
      if (onetCached && onetCached.length) {
        return FWOnetVectors.toHubRankShape(onetCached);
      }
    }
    if (global.FWOnetVectors && typeof FWOnetVectors.getCachedFeaturedRank === 'function') {
      var cached = FWOnetVectors.getCachedFeaturedRank(n || 3);
      if (cached && cached.length) {
        return FWOnetVectors.toHubRankShape(cached);
      }
    }
    if (!global.FWOnetVectors) {
      if (!global.FWHubCareers || typeof FWHubCareers.rankCareersFromQuizScores !== 'function') return [];
      if (!scores) return [];
      try {
        return FWHubCareers.rankCareersFromQuizScores(scores).slice(0, n || 3);
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  function prefetchVectorRanking(scores) {
    if (!scores || !global.FWCareerTarget) return Promise.resolve();
    if (global.FWOnetVectors && FWOnetVectors.getCachedOnetRank
      && FWOnetVectors.getCachedOnetRank(1)) return Promise.resolve();
    if (global.FWOnetVectors && FWOnetVectors.getCachedFeaturedRank
      && FWOnetVectors.getCachedFeaturedRank(1)) return Promise.resolve();
    return ensureVectorRanking(12).then(function () {
      updateTargetSwitch();
    });
  }

  function aggregateSkills(matches, limit) {
    const seen = {};
    const out = [];
    matches.forEach(function (m) {
      const skills = (m.career && Array.isArray(m.career.skills)) ? m.career.skills : [];
      skills.forEach(function (s) {
        const key = String(s).toLowerCase();
        if (!seen[key]) { seen[key] = true; out.push(titleCase(s)); }
      });
    });
    return out.slice(0, limit || 8);
  }

  function openProfileBuilding() {
    var area = AREAS.find(function (a) { return a.key === 'profile-build'; });
    if (area && typeof area.go === 'function') area.go();
  }

  function goQuiz() {
    location.href = (global.FWPageBoot && FWPageBoot.URLS && FWPageBoot.URLS.quiz) || 'quiz.html';
  }

  function portalHasRoadmap(rm) {
    return !!(rm && rm.targetCareerSlug && ((rm.version === 2 && rm.nodes) || (rm.phases && rm.phases.length)));
  }

  function isProfileBuildingDone(pb) {
    if (!pb) return false;
    if (pb.completedAt) return true;
    return !!(pb.answers && pb.answers.length >= 2);
  }

  function refineDone() {
    try { return !!localStorage.getItem('fw_hub_refine_updated_v1'); } catch (_) { return false; }
  }

  function academicsDone() {
    try { return !!localStorage.getItem('fw_hub_academics_updated_v1'); } catch (_) { return false; }
  }

  function goRoadmap(opts) {
    if (typeof global.openRoadmap === 'function') {
      global.openRoadmap(opts);
      return;
    }
    var base = (global.FWPageBoot && FWPageBoot.URLS.roadmap) || 'roadmap.html';
    if (opts && opts.slug) {
      try {
        sessionStorage.setItem('fw_roadmap_pending_career', JSON.stringify({
          slug: opts.slug,
          name: opts.name || opts.slug,
          soc: opts.soc || null,
        }));
      } catch (_) { /* ignore */ }
    }
    var qs = [];
    if (opts && opts.focus) qs.push('focus=1');
    location.href = qs.length ? base + '?' + qs.join('&') : base;
  }

  var lastSnapshotRenderKey = '';
  var profileDrawerCtx = { data: null, snap: null };
  var profileDrawerOpen = false;
  var targetRankPromise = null;
  var profileEntryBound = false;

  function updateTargetSwitch(data) {
    if (!global.FWPortalTargetSwitch) return;
    var quizData = data || profile();
    var slot = document.getElementById('portal-target-switch-slot');
    if (!slot) return;
    if (slot.querySelector('#portal-target-row')) {
      FWPortalTargetSwitch.update({
        data: quizData,
        target: global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function'
          ? FWCareerTarget.resolveTargetCareer() : null,
      });
      return;
    }
    FWPortalTargetSwitch.mount(slot, {
      data: quizData,
      onSwitched: function () { refreshPortalCareerUi(); },
    });
  }

  function renderTargetCareerBlock(data) {
    const hasQuiz = data && data.scores && Object.keys(data.scores).length;
    const signedIn = !!(global.FWAuth && FWAuth.authEmail && FWAuth.authEmail());
    if (!hasQuiz || !signedIn || !global.FWCareerTarget) return '';
    if (!FWCareerTarget.resolveTargetCareer()) return '';
    return '<div id="portal-target-switch-slot"></div>';
  }

  function ensureVectorRanking(limit) {
    if (!global.FWCareerTarget || typeof FWCareerTarget.rankedCareerMatchesAsync !== 'function') {
      return Promise.resolve();
    }
    if (global.FWOnetVectors && FWOnetVectors.getCachedOnetRank
      && FWOnetVectors.getCachedOnetRank(1)) {
      return Promise.resolve();
    }
    if (global.FWOnetVectors && FWOnetVectors.getCachedFeaturedRank
      && FWOnetVectors.getCachedFeaturedRank(1)) {
      return Promise.resolve();
    }
    if (targetRankPromise) return targetRankPromise;
    targetRankPromise = FWCareerTarget.rankedCareerMatchesAsync(limit || 12).then(function () {
      return null;
    }).catch(function () { return null; });
    return targetRankPromise;
  }

  function renderHead(head, data, email) {
    const name = (data && data.name) ? data.name : 'there';
    const archetype = data && data.archetype;
    const pb = profileBuildingState();
    const showPbCta = !isProfileBuildingDone(pb);
    head.innerHTML =
      '<div class="portal-greeting-row">'
      + '<div>'
      + '<div class="portal-eyebrow">Your FlightWay home</div>'
      + '<h1 class="portal-title">Hey ' + esc(name) + '</h1>'
      + '<p class="portal-email">Built from your quiz answers &middot; <a href="quiz.html" class="portal-retake">retake quiz</a>' + (email ? ' &middot; ' + esc(email) : '') + '</p>'
      + '</div>'
      + (archetype ? '<div class="portal-archetype" title="Your quiz archetype"><span class="portal-archetype-eye">Archetype</span><span class="portal-archetype-name">' + esc(archetype) + '</span></div>' : '')
      + '</div>'
      + (showPbCta
        ? '<div class="portal-greeting-cta-row">'
          + '<button type="button" class="portal-pb-tertiary" id="portal-pb-head-cta">Help us know you better →</button>'
          + '</div>'
        : '')
      + renderTargetCareerBlock(data);
    if (showPbCta) {
      const pbCta = head.querySelector('#portal-pb-head-cta');
      if (pbCta) pbCta.addEventListener('click', openProfileBuilding);
    }
    updateTargetSwitch(data);
    ensureVectorRanking(12).then(function () {
      updateTargetSwitch();
    });
  }

  function profileBuildingState() {
    if (global.FWProfileBuilding && typeof FWProfileBuilding.readBuilding === 'function') {
      return FWProfileBuilding.readBuilding();
    }
    var data = profile();
    return (data && data.profileBuilding) ? data.profileBuilding : null;
  }

  function showProfileHint(pb) {
    if (isProfileBuildingDone(pb)) return false;
    if (pb && pb.promptDismissedAt && !(pb.answers && pb.answers.length)) return false;
    return true;
  }

  function renderPromptBanner(wrap, data) {
    if (!wrap) return;
    var pb = profileBuildingState();
    var hasQuiz = data && data.scores && Object.keys(data.scores).length;
    if (!hasQuiz) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    var profileDone = isProfileBuildingDone(pb);
    var refineComplete = refineDone();
    var academicsComplete = academicsDone();
    if (profileDone && refineComplete && academicsComplete) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    var steps = [
      { key: 'quiz', label: 'Career quiz', done: true },
      { key: 'profile', label: 'Know-you prompts', done: profileDone },
      { key: 'refine', label: 'Sharpen in Hub', done: refineComplete },
      { key: 'academics', label: 'Add academics', done: academicsComplete },
    ];
    var next = steps.find(function (s) { return !s.done; }) || steps[1];
    wrap.style.display = '';
    wrap.innerHTML = ''
      + '<div class="portal-onboard-banner" role="status">'
      + '<p class="portal-onboard-title"><strong>Your setup checklist</strong></p>'
      + '<ol class="portal-onboard-steps">' + steps.map(function (s) {
        return '<li class="portal-onboard-step' + (s.done ? ' is-done' : '') + '">'
          + '<span class="portal-onboard-check" aria-hidden="true">' + (s.done ? '✓' : '○') + '</span>'
          + esc(s.label) + '</li>';
      }).join('') + '</ol>'
      + '<p class="portal-prompt-banner-text">Next: <strong>' + esc(next.label) + '</strong>'
      + (next.key === 'refine'
        ? ' — fine-tune matches in Career Hub.'
        : next.key === 'profile'
          ? ' — personalize Marco and career deep dives.'
          : next.key === 'academics'
            ? ' — add grades and courses for objective fit scores.'
            : '.') + '</p>'
      + '<div class="portal-prompt-banner-actions">'
      + '<button type="button" class="portal-prompt-cta" id="portal-onboard-cta">'
      + (next.key === 'refine' ? 'Open Career Hub'
        : next.key === 'profile' ? 'Get started'
          : next.key === 'academics' ? 'Add academics'
            : 'Continue') + '</button>'
      + '<button type="button" class="portal-prompt-dismiss" id="portal-pb-banner-dismiss" aria-label="Dismiss">✕</button>'
      + '</div></div>';
    var cta = wrap.querySelector('#portal-onboard-cta');
    var dismiss = wrap.querySelector('#portal-pb-banner-dismiss');
    if (cta) {
      cta.addEventListener('click', function () {
        if (next.key === 'profile') openProfileBuilding();
        else if (next.key === 'refine') location.href = 'dashboard.html?refine=open';
        else if (next.key === 'academics') location.href = 'dashboard.html?academics=open';
        else location.href = 'dashboard.html';
      });
    }
    if (dismiss) {
      dismiss.addEventListener('click', function () {
        if (global.FWProfileBuilding && typeof FWProfileBuilding.dismissPrompt === 'function') {
          FWProfileBuilding.dismissPrompt();
        } else {
          try {
            var q = profile() || {};
            q.profileBuilding = q.profileBuilding || { version: 1, answers: [] };
            q.profileBuilding.promptDismissedAt = new Date().toISOString();
            if (global.FWAuth && typeof FWAuth.writeLocalQuiz === 'function') FWAuth.writeLocalQuiz(q);
          } catch (_) { /* ignore */ }
        }
        wrap.innerHTML = '';
        wrap.style.display = 'none';
        renderActions(document.getElementById('portal-actions'));
      });
    }
  }

  function pendingAnalysisMsg() {
    if (global.FWProfileBuildingFallback && FWProfileBuildingFallback.PENDING_ANALYSIS_MSG) {
      return FWProfileBuildingFallback.PENDING_ANALYSIS_MSG;
    }
    return 'Generating your analysis, check back soon.';
  }

  function profileZoneEntryHint() {
    if (!global.FWHubZoneFit) return '';
    var rows = FWHubZoneFit.getCachedZoneFits();
    if (!rows || !rows.length) rows = FWHubZoneFit.zoneFitsFromHub();
    if (rows && rows.length) return FWHubZoneFit.profileEntryHint(rows);
    return '';
  }

  function initialZoneFitHtml() {
    if (!global.FWHubZoneFit) {
      return '<p class="portal-identity-foot">' + esc(pendingAnalysisMsg()) + '</p>';
    }
    var rows = FWHubZoneFit.getCachedZoneFits();
    if (!rows || !rows.length) rows = FWHubZoneFit.zoneFitsFromHub();
    if (rows && rows.length) {
      return FWHubZoneFit.renderHubZoneFitSheet(rows, { history: false });
    }
    return '<p class="portal-identity-foot">Loading sector fit…</p>';
  }

  function mountProfileZoneFit(zoneMount) {
    if (!zoneMount || !global.FWHubZoneFit) return;
    FWHubZoneFit.resolveZoneFits().then(function (rows) {
      if (!zoneMount.parentNode) return;
      if (rows && rows.length) {
        zoneMount.innerHTML = FWHubZoneFit.renderHubZoneFitSheet(rows, { history: false });
      } else {
        zoneMount.innerHTML = '<p class="portal-identity-foot">' + esc(pendingAnalysisMsg()) + '</p>';
      }
    });
  }

  function isPlaceholderCharacter(text) {
    var t = String(text || '').trim();
    var pending = pendingAnalysisMsg();
    return !t
      || t === pending
      || t === 'Take the quiz and share a bit about yourself to unlock a personalized character read.'
      || t === 'Complete the quiz and profile prompts to unlock a personalized character read.';
  }

  function isPlaceholderKnowYou(text) {
    var t = String(text || '').trim();
    var pending = pendingAnalysisMsg();
    return !t
      || t === pending
      || t === 'Complete a few "Know you better" prompts so we can personalize your home page.'
      || t === 'Share a few prompts in Know you better to personalize this space.';
  }

  function resolveKnowYou(data, snap) {
    if (snap && snap.knowYou && !isPlaceholderKnowYou(snap.knowYou) && snap.source === 'ai') {
      return snap.knowYou;
    }
    var pb = profileBuildingState();
    if (pb && pb.answers && pb.answers.length && global.FWProfileBuildingFallback
      && typeof FWProfileBuildingFallback.buildShortKnowYou === 'function') {
      var fromAnswers = FWProfileBuildingFallback.buildShortKnowYou(pb.answers, quizContextForPortal());
      if (fromAnswers) return fromAnswers;
    }
    if (data && data.archetype) {
      return 'Your ' + data.archetype + ' archetype shapes how we match careers and coach you.';
    }
    return pendingAnalysisMsg();
  }

  function resolveCharacter(data, snap) {
    if (snap && snap.characterAnalysis && !isPlaceholderCharacter(snap.characterAnalysis) && snap.source === 'ai') {
      return snap.characterAnalysis;
    }
    var fromQuiz = String((data && data.characterSummary) || '').trim();
    if (fromQuiz) return fromQuiz;
    if (data && data.archetype) {
      return 'As a ' + data.archetype + ', you tend toward careers that reward your natural strengths.';
    }
    return pendingAnalysisMsg();
  }

  function snapshotNeedsRefresh(data, snap) {
    if (!snap || !snap.knowYou || !snap.characterAnalysis) return true;
    if (isPlaceholderCharacter(snap.characterAnalysis) && resolveCharacter(data, null) !== snap.characterAnalysis) {
      return true;
    }
    if (isPlaceholderKnowYou(snap.knowYou) && resolveKnowYou(data, null) !== snap.knowYou) {
      return true;
    }
    return false;
  }

  function portalSnapshotFromData(data) {
    if (data && data.portalSnapshot) {
      if (data.portalSnapshot.source === 'fallback') return null;
      return data.portalSnapshot;
    }
    if (global.FWAuth && typeof FWAuth.readPortalSnapshot === 'function') {
      return FWAuth.readPortalSnapshot();
    }
    return null;
  }

  function fallbackSnapshot(data, careerPool) {
    if (global.FWProfileBuildingFallback && typeof FWProfileBuildingFallback.buildFallbackPortalSnapshot === 'function') {
      return FWProfileBuildingFallback.buildFallbackPortalSnapshot(data, careerPool);
    }
    return null;
  }

  function careerPool(scores) {
    if (global.FWAuth && typeof FWAuth.buildCareerPoolForApi === 'function') {
      return FWAuth.buildCareerPoolForApi(scores);
    }
    return topCareers(scores, 6).map(function (m) {
      return {
        careerId: m.career.id,
        name: m.career.name,
        score: m.score,
        skills: m.career.skills || [],
      };
    });
  }

  function careerById(pool, id) {
    var hit = (pool || []).find(function (c) { return Number(c.careerId) === Number(id); });
    if (hit) {
      return {
        id: hit.careerId,
        name: hit.name,
        skills: hit.skills || [],
      };
    }
    if (global.FWHubCareers && typeof FWHubCareers.getCareerById === 'function') {
      var career = FWHubCareers.getCareerById(id);
      if (career) return career;
    }
    return { id: id, name: 'Career', skills: [] };
  }

  function resolveAiCareerMatches(snapshot, pool) {
    if (!snapshot || snapshot.source !== 'ai' || !Array.isArray(snapshot.careerPicks) || !snapshot.careerPicks.length) {
      return null;
    }
    return snapshot.careerPicks.map(function (pick) {
      var career = careerById(pool, pick.careerId);
      return {
        career: career,
        score: Number.isFinite(Number(pick.fitScore)) ? Number(pick.fitScore) : 0,
        note: pick.note || '',
      };
    }).slice(0, 3);
  }

  function resolveSkillsFromSnapshot(snapshot, scores) {
    var tags = [];
    if (snapshot && Array.isArray(snapshot.skillTags) && snapshot.skillTags.length) {
      tags = snapshot.skillTags.slice();
    }
    if (!tags.length) {
      var pool = careerPool(scores);
      pool.slice(0, 3).forEach(function (c) {
        (c.skills || []).forEach(function (s) {
          if (tags.length < 8 && tags.indexOf(s) === -1) tags.push(s);
        });
      });
    }
    if (!tags.length && scores) {
      return aggregateSkills(topCareers(scores, 3), 8).map(function (label) {
        return { label: label, ai: false };
      });
    }
    var isAi = !!(snapshot && snapshot.source === 'ai');
    return tags.map(function (tag) {
      return { label: titleCase(tag), ai: isAi };
    }).slice(0, 8);
  }

  function resolveDrawerMetaFoot(snap, knowYou, character) {
    if (snap && snap.source === 'ai') return 'Personalized from your answers and coach dossier';
    if (knowYou && !isPlaceholderKnowYou(knowYou)) return 'Based on your quiz and profile answers';
    if (character && !isPlaceholderCharacter(character)) return 'Based on your quiz results';
    return 'Analysis in progress';
  }

  function metricsPendingHtml() {
    return '<p class="portal-identity-foot">' + esc(pendingAnalysisMsg()) + '</p>';
  }

  function readLocalRoadmap() {
    try {
      if (global.FWAuth && typeof FWAuth.readLocalRoadmap === 'function') {
        return FWAuth.readLocalRoadmap();
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function snapshotRenderKey(data, snap, localRoadmap) {
    var target = (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function')
      ? FWCareerTarget.resolveTargetCareer() : null;
    var rankToken = '';
    if (global.FWOnetVectors) {
      if (typeof FWOnetVectors.getRankCacheVersion === 'function') {
        rankToken = String(FWOnetVectors.getRankCacheVersion());
      }
      if (typeof FWOnetVectors.getCachedOnetRank === 'function') {
        var onetTop = FWOnetVectors.getCachedOnetRank(1);
        if (onetTop && onetTop[0]) rankToken += '|' + onetTop[0].slug;
      }
    }
    return [
      snap && snap.updatedAt,
      snap && snap.inputsHash,
      snap && snap.source,
      localRoadmap && localRoadmap.updatedAt,
      localRoadmap && localRoadmap.targetCareerSlug,
      target && target.slug,
      rankToken,
    ].join('|');
  }

  function bindPortalSnapshotDelegation() {
    var wrap = document.getElementById('portal-snapshot');
    if (!wrap || wrap._fwDelegated) return;
    wrap._fwDelegated = true;
    wrap.addEventListener('click', function (e) {
      var openFocus = e.target.closest('.sgt-open-focus');
      if (openFocus) {
        e.preventDefault();
        goRoadmap({ focus: true });
        return;
      }
      var marco = e.target.closest('.sgt-ask-marco');
      if (marco) {
        e.preventDefault();
        try {
          sessionStorage.setItem('fw_marco_user_prompt', 'What skill gap should I tackle next on my current roadmap waypoint?');
        } catch (_) {}
        location.href = (global.FWPageBoot && FWPageBoot.URLS.coach) || 'coach.html';
        return;
      }
      var ctx = global.FWPortalFocusCtx;
      if (!ctx || !ctx.onPersist || !ctx.getTree || !global.FWSkillGapTracker) return;
      var logPreset = e.target.closest('.sgt-log-preset');
      if (logPreset) {
        e.preventDefault();
        var updatedPreset = FWSkillGapTracker.persistLog(
          ctx.getTree(),
          logPreset.getAttribute('data-gap-id'),
          logPreset.getAttribute('data-log-text')
        );
        ctx.onPersist(updatedPreset);
        return;
      }
      var logAdd = e.target.closest('.sgt-log-add');
      if (logAdd) {
        e.preventDefault();
        var row = logAdd.closest('.sgt-log-row');
        var gapId = FWSkillGapTracker.resolveLogGapId(row) || logAdd.getAttribute('data-gap-id');
        var input = row ? row.querySelector('.sgt-log-input') : null;
        var text = input ? input.value : '';
        if (!String(text || '').trim()) return;
        var updatedLog = FWSkillGapTracker.persistLog(ctx.getTree(), gapId, text);
        ctx.onPersist(updatedLog);
        if (input) input.value = '';
        return;
      }
      var logRemove = e.target.closest('.sgt-log-remove');
      if (logRemove) {
        e.preventDefault();
        var updatedRemove = FWSkillGapTracker.removeLog(
          ctx.getTree(),
          logRemove.getAttribute('data-gap-id'),
          logRemove.getAttribute('data-log-id')
        );
        ctx.onPersist(updatedRemove);
      }
    });

    wrap.addEventListener('change', function (e) {
      var cb = e.target.closest('.sgt-step-check');
      if (cb && cb.closest('#portal-skill-gap-tracker')) {
        var ctx = global.FWPortalFocusCtx;
        if (!ctx || !ctx.onPersist || !ctx.getTree || !global.FWSkillGapTracker) return;
        FWSkillGapTracker.handleStepCheckboxChange(cb, ctx);
        return;
      }
      var gapCb = e.target.closest('.sgt-gap-check');
      if (!gapCb || !gapCb.closest('#portal-skill-gap-tracker')) return;
      var gapCtx = global.FWPortalFocusCtx;
      if (!gapCtx || !gapCtx.onPersist || !gapCtx.getTree || !global.FWSkillGapTracker) return;
      FWSkillGapTracker.handleGapCheckboxChange(gapCb, gapCtx);
    });

    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var input = e.target.closest('#portal-skill-gap-tracker .sgt-log-input');
      if (!input) return;
      e.preventDefault();
      var ctx = global.FWPortalFocusCtx;
      if (!ctx || !ctx.onPersist || !ctx.getTree || !global.FWSkillGapTracker) return;
      var row = input.closest('.sgt-log-row');
      var gapId = FWSkillGapTracker.resolveLogGapId(row) || input.getAttribute('data-gap-id');
      var text = input.value;
      if (!String(text || '').trim()) return;
      var updated = FWSkillGapTracker.persistLog(ctx.getTree(), gapId, text);
      ctx.onPersist(updated);
      input.value = '';
    });
  }

  function ensureProfileDrawerShell() {
    if (document.getElementById('portal-profile-drawer')) return;
    var shell = document.createElement('div');
    shell.innerHTML = ''
      + '<div id="portal-profile-drawer-backdrop" class="portal-profile-backdrop" hidden aria-hidden="true"></div>'
      + '<aside id="portal-profile-drawer" class="portal-profile-drawer" role="dialog" aria-modal="true" aria-labelledby="portal-profile-drawer-title" hidden>'
      + '<header class="portal-profile-drawer-head">'
      + '<h2 id="portal-profile-drawer-title" class="portal-profile-drawer-title">Your profile</h2>'
      + '<button type="button" class="portal-profile-drawer-close" id="portal-profile-drawer-close" aria-label="Close profile">✕</button>'
      + '</header>'
      + '<div class="portal-profile-drawer-body" id="portal-profile-drawer-body"></div>'
      + '</aside>';
    document.body.appendChild(shell.firstElementChild);
    document.body.appendChild(shell.lastElementChild);
    var backdrop = document.getElementById('portal-profile-drawer-backdrop');
    var closeBtn = document.getElementById('portal-profile-drawer-close');
    if (backdrop && !backdrop._fwBound) {
      backdrop._fwBound = true;
      backdrop.addEventListener('click', closeProfileDrawer);
    }
    if (closeBtn && !closeBtn._fwBound) {
      closeBtn._fwBound = true;
      closeBtn.addEventListener('click', closeProfileDrawer);
    }
    if (!document._fwProfileDrawerKey) {
      document._fwProfileDrawerKey = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && profileDrawerOpen) closeProfileDrawer();
      });
    }
  }

  function profileDrawerFocusables() {
    var drawer = document.getElementById('portal-profile-drawer');
    if (!drawer) return [];
    return Array.from(drawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function trapProfileDrawerFocus(e) {
    if (!profileDrawerOpen || e.key !== 'Tab') return;
    var nodes = profileDrawerFocusables();
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openProfileDrawerSafe() {
    ensureProfileDrawerShell();
    var data = profile();
    var snap = profileDrawerCtx.snap || portalSnapshotFromData(data);
    try {
      renderProfileDrawerContent(data, snap);
    } catch (err) {
      console.warn('profile drawer content failed', err);
    }
    openProfileDrawer();
  }

  function ensureProfileEntryDelegation(wrap) {
    if (!wrap || profileEntryBound) return;
    profileEntryBound = true;
    wrap.addEventListener('click', function (e) {
      if (!e.target.closest('.portal-profile-entry-btn, #portal-profile-open')) return;
      e.preventDefault();
      openProfileDrawerSafe();
    });
  }

  function openProfileDrawer() {
    ensureProfileDrawerShell();
    var drawer = document.getElementById('portal-profile-drawer');
    var backdrop = document.getElementById('portal-profile-drawer-backdrop');
    if (!drawer || !backdrop) return;
    profileDrawerOpen = true;
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('portal-profile-drawer-open');
    document.addEventListener('keydown', trapProfileDrawerFocus);
    var nodes = profileDrawerFocusables();
    if (nodes[0]) nodes[0].focus();
  }

  function closeProfileDrawer() {
    var drawer = document.getElementById('portal-profile-drawer');
    var backdrop = document.getElementById('portal-profile-drawer-backdrop');
    profileDrawerOpen = false;
    if (drawer) {
      drawer.hidden = true;
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('portal-profile-drawer-open');
    document.removeEventListener('keydown', trapProfileDrawerFocus);
    var trigger = document.getElementById('portal-profile-open');
    if (trigger) trigger.focus();
  }

  function renderProfileDrawerContent(data, snap) {
    ensureProfileDrawerShell();
    var body = document.getElementById('portal-profile-drawer-body');
    if (!body) return;
    profileDrawerCtx.data = data;
    profileDrawerCtx.snap = snap;
    var pool = careerPool(data && data.scores);
    var resolved = snap || portalSnapshotFromData(data) || fallbackSnapshot(data, pool);
    var skills = resolveSkillsFromSnapshot(resolved, data && data.scores) || [];
    var traits = (resolved && resolved.traits && resolved.traits.length)
      ? resolved.traits
      : (Array.isArray(data && data.traits) ? data.traits : []);
    var knowYou = resolveKnowYou(data, resolved);
    var character = resolveCharacter(data, resolved);

    var metaFoot = resolveDrawerMetaFoot(resolved, knowYou, character);
    var patchPending = !!(data && data.personalityPatchFailed);

    body.innerHTML = ''
      + '<div class="portal-drawer-section" role="region" aria-labelledby="portal-drawer-know-title">'
      + '<div class="portal-drawer-card">'
      + '<h3 id="portal-drawer-know-title" class="portal-drawer-section-title">What we know about you</h3>'
      + '<div class="portal-drawer-card-body"><p class="portal-drawer-prose">' + esc(knowYou) + '</p></div>'
      + '<div class="portal-drawer-card-foot">'
      + '<p class="portal-identity-foot">' + esc(metaFoot) + '</p>'
      + (patchPending
        ? '<p class="portal-identity-foot portal-identity-foot--warn">Vector update pending — try saving your answers again later.</p>'
        : '')
      + '<button type="button" class="portal-identity-update" id="portal-drawer-pb-update">Update your answers</button>'
      + '</div></div></div>'
      + '<div class="portal-drawer-section" role="region" aria-labelledby="portal-drawer-char-title">'
      + '<div class="portal-drawer-card">'
      + '<h3 id="portal-drawer-char-title" class="portal-drawer-section-title">Your character analysis</h3>'
      + '<div class="portal-drawer-card-body">'
      + '<p class="portal-drawer-prose">' + esc(character) + '</p>'
      + (traits.length
        ? '<div class="portal-chips">' + traits.map(function (t) { return '<span class="portal-chip">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '')
      + '</div>'
      + '<div class="portal-drawer-card-foot"><p class="portal-identity-foot">' + esc(metaFoot) + '</p></div>'
      + '</div></div>'
      + '<div class="portal-drawer-section portal-drawer-section--sectors" role="region" aria-labelledby="portal-drawer-sector-title">'
      + '<div class="portal-drawer-card">'
      + '<h3 id="portal-drawer-sector-title" class="portal-drawer-section-title">Career Hub sector fit</h3>'
      + '<p class="portal-drawer-section-sub">Fit across Career Hub sectors — overall fit from your personality and objective vectors.</p>'
      + '<div class="portal-drawer-card-body" id="portal-hub-zone-fit">'
      + initialZoneFitHtml()
      + '</div></div></div>'
      + '<div class="portal-drawer-section portal-drawer-section--onet" role="region" aria-labelledby="portal-drawer-onet-title">'
      + '<div class="portal-drawer-card">'
      + '<h3 id="portal-drawer-onet-title" class="portal-drawer-section-title">O*NET dimensions</h3>'
      + '<p class="portal-drawer-section-sub">Top personality coordinates (0–100) from your quiz profile.</p>'
      + '<div class="portal-drawer-card-body" id="portal-onet-dimensions"></div>'
      + '</div></div>'
      + '<div class="portal-drawer-section" role="region" aria-labelledby="portal-drawer-skills-title">'
      + '<div class="portal-drawer-card">'
      + '<h3 id="portal-drawer-skills-title" class="portal-drawer-section-title">Your main skills/interests</h3>'
      + '<div class="portal-drawer-card-body">'
      + (skills.length
        ? '<div class="portal-chips portal-chips--skills">'
          + skills.map(function (s) {
            var cls = 'portal-chip portal-chip--skill' + (s.ai ? ' portal-chip--ai' : '');
            return '<span class="' + cls + '">' + esc(s.label) + '</span>';
          }).join('')
          + '</div>'
        : metricsPendingHtml())
      + '</div></div></div>';

    var updateBtn = body.querySelector('#portal-drawer-pb-update');
    if (updateBtn) {
      updateBtn.addEventListener('click', openProfileBuilding);
    }
    if (global.FWOnetDimensionViewer && typeof FWOnetDimensionViewer.mountPortalViewer === 'function') {
      FWOnetDimensionViewer.mountPortalViewer('portal-onet-dimensions');
    }
    mountProfileZoneFit(body.querySelector('#portal-hub-zone-fit'));
  }

  function updateProfileDrawerContent(data, snap) {
    renderProfileDrawerContent(data, snap);
  }

  function renderProfileEntry(wrap, data) {
    if (!wrap) return;
    var hasQuiz = data && data.scores && Object.keys(data.scores).length;
    if (!hasQuiz) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    var hint = profileZoneEntryHint();
    wrap.innerHTML = ''
      + '<button type="button" class="portal-profile-entry-btn" id="portal-profile-open" aria-haspopup="dialog">'
      + '<span class="portal-profile-entry-icon" aria-hidden="true"><i data-lucide="user-round"></i></span>'
      + '<span class="portal-profile-entry-text">'
      + '<span class="portal-profile-entry-label">Your profile</span>'
      + '<span class="portal-profile-entry-sub">' + (hint ? esc(hint) : 'Character, sectors &amp; skills') + '</span>'
      + '</span>'
      + '<span class="portal-profile-entry-arrow" aria-hidden="true">&rarr;</span>'
      + '</button>';
    if (!hint && global.FWHubZoneFit) {
      FWHubZoneFit.resolveZoneFits().then(function (rows) {
        if (!rows || !rows.length) return;
        var sub = wrap.querySelector('.portal-profile-entry-sub');
        if (sub) sub.textContent = FWHubZoneFit.profileEntryHint(rows);
      });
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  }

  function mountPortalFocusPanel(roadmapForPanel, resolvedTarget, localRoadmap) {
    const el = document.getElementById('portal-skill-gap-tracker');
    if (!el || !resolvedTarget || !global.FWCareerTarget) return;
    var focusTree = roadmapForPanel;

    function showPortalAdvanceLoading() {
      var loading = document.getElementById('portal-focus-loading');
      if (loading) loading.hidden = false;
    }

    function hidePortalAdvanceLoading() {
      var loading = document.getElementById('portal-focus-loading');
      if (loading) loading.hidden = true;
    }

    function applyPortalFocusTree(updated) {
      focusTree = global.FWSkillGapTracker.syncProgress(updated);
      if (global.FWRoadmapSync && typeof FWRoadmapSync.publish === 'function') {
        focusTree = FWRoadmapSync.publish(focusTree, { source: 'portal' });
      } else {
        try { localStorage.setItem('fw_roadmap_v1', JSON.stringify(focusTree)); } catch (_) {}
        if (global.FWAuth && typeof FWAuth.saveRoadmap === 'function') {
          FWAuth.saveRoadmap(focusTree).catch(function () {});
        }
      }
      syncPortalFocusCtx();
      FWSkillGapTracker.renderHomePanel(el, focusTree, portalFocusOpts);
    }

    function portalAdvanceCtx() {
      var qz = profile();
      return {
        onPersist: applyPortalFocusTree,
        runAdvance: function () {
          FWSkillGapTracker.runFocusAdvance({
            getTree: function () { return focusTree; },
            quizScores: qz && qz.scores ? qz.scores : null,
            showLoading: showPortalAdvanceLoading,
            hideLoading: hidePortalAdvanceLoading,
            onPersist: applyPortalFocusTree,
          });
        },
      };
    }

    function syncPortalFocusCtx() {
      global.FWPortalFocusCtx = {
        getTree: function () { return focusTree; },
        onPersist: portalFocusPersist,
        maybeAdvanceOnComplete: function (updated) {
          FWSkillGapTracker.maybeAdvanceOnComplete(updated, portalAdvanceCtx());
        },
        runAdvance: portalAdvanceCtx().runAdvance,
      };
    }

    function portalFocusPersist(updated) {
      if (global.FWSkillGapTracker && typeof FWSkillGapTracker.maybeAdvanceOnComplete === 'function') {
        FWSkillGapTracker.maybeAdvanceOnComplete(updated, portalAdvanceCtx());
        return;
      }
      applyPortalFocusTree(updated);
    }

    var portalFocusOpts = {
      getTree: function () { return focusTree; },
      onPersist: portalFocusPersist,
    };

    if (global.FWSkillGapTracker && roadmapForPanel && roadmapForPanel.focusTracker) {
      syncPortalFocusCtx();
      FWSkillGapTracker.renderHomePanel(el, roadmapForPanel, portalFocusOpts);
      return;
    }
    if (portalHasRoadmap(localRoadmap)) {
      el.innerHTML = '<p class="portal-character">Waypoint focus opens from your roadmap. Use the <strong>Career Roadmap</strong> card above to view progress and next steps.</p>'
        + '<button type="button" class="cta-btn cta-btn-outline portal-empty-cta" id="portal-open-roadmap-focus">Open roadmap</button>';
      var openRmBtn = el.querySelector('#portal-open-roadmap-focus');
      if (openRmBtn) openRmBtn.addEventListener('click', goRoadmap);
      return;
    }
    if (typeof FWCareerTarget.gapsNeedRoadmap === 'function'
      && FWCareerTarget.gapsNeedRoadmap(resolvedTarget, localRoadmap)) {
      el.innerHTML = '<p class="portal-character">Skill gaps appear after you build a roadmap for '
        + esc(resolvedTarget.name) + '. Use the <strong>Career Roadmap</strong> card above.</p>';
      return;
    }
    const gaps = FWCareerTarget.gapsForTarget(resolvedTarget, localRoadmap);
    el.innerHTML = '<p class="portal-character">' + (gaps.length
      ? 'Build a roadmap with the <strong>Career Roadmap</strong> card above to track skill gaps for ' + esc(resolvedTarget.name) + '.'
      : 'No major skill gaps flagged from your quiz — strong alignment so far.') + '</p>';
  }

  function snapshotIsStale(data) {
    if (!global.FWAuth || !FWAuth.authEmail || !FWAuth.authEmail()) return false;
    if (!data) return false;
    var snap = portalSnapshotFromData(data);
    if (snap && snap.source === 'fallback') return true;
    if (snapshotNeedsRefresh(data, snap)) return true;
    if (!snap || !snap.inputsHash) return true;
    if (snap.source === 'ai' && snap.dossierFp && typeof FWAuth.readDossierFingerprint === 'function') {
      var dossierFp = FWAuth.readDossierFingerprint();
      if (!dossierFp && typeof FWAuth.writeDossierFingerprint === 'function') {
        FWAuth.writeDossierFingerprint(snap.dossierFp);
        dossierFp = snap.dossierFp;
      }
    }
    var hash = typeof FWAuth.computePortalInputsHash === 'function'
      ? FWAuth.computePortalInputsHash(data) : '';
    return snap.inputsHash !== hash;
  }

  function ensurePortalSnapshot(data, opts) {
    if (!data) return Promise.resolve(null);
    if (!global.FWAuth || !FWAuth.authEmail || !FWAuth.authEmail()) {
      return Promise.resolve(portalSnapshotFromData(data) || fallbackSnapshot(data, careerPool(data.scores)));
    }
    if (!snapshotIsStale(data) && !(opts && opts.force)) {
      return Promise.resolve(portalSnapshotFromData(data));
    }
    return FWAuth.refreshPortalSnapshot({ force: !!(opts && opts.force) })
      .catch(function (err) {
        console.warn('portal snapshot refresh failed', err);
        return fallbackSnapshot(data, careerPool(data.scores));
      });
  }

  function quizContextForPortal() {
    var data = profile();
    var ctx = {};
    if (data) {
      if (data.name) ctx.userName = data.name;
      if (data.archetype) ctx.archetype = data.archetype;
      if (global.FWHubZoneFit && typeof FWHubZoneFit.topZoneLabels === 'function') {
        var zoneLabels = FWHubZoneFit.topZoneLabels(3);
        if (zoneLabels.length) ctx.topIndustries = zoneLabels;
      }
      if (!ctx.topIndustries && data.scores) {
        ctx.topIndustries = Object.entries(data.scores)
          .filter(function (e) { return Number(e[1]) > 0; })
          .sort(function (a, b) { return b[1] - a[1]; })
          .slice(0, 3)
          .map(function (e) {
            return String(e[0]).replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
          });
      }
    }
    return ctx;
  }

  function renderEmptyQuizPromo(wrap, data) {
    if (!wrap) return;
    const hasQuiz = data && data.scores && Object.keys(data.scores).length;
    if (hasQuiz) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    wrap.innerHTML =
      '<div class="portal-panel portal-empty">'
      + '<h2 class="portal-panel-title">Unlock your profile</h2>'
      + '<p class="portal-empty-text">Take the ~90 second career quiz to reveal your archetype, top industries, skills, and best-fit careers.</p>'
      + '<button type="button" class="cta-btn portal-empty-cta" id="portal-empty-quiz-cta">Take the quiz &rarr;</button>'
      + '</div>';
    const cta = wrap.querySelector('#portal-empty-quiz-cta');
    if (cta) cta.addEventListener('click', goQuiz);
  }

  function showResumeHint() {
    if (!global.FWOnetVectors) return true;
    var quiz = profile();
    if (quiz && quiz.objectiveSkipped) return true;
    var vec = quiz && quiz.objectiveVector && quiz.objectiveVector.values;
    if (!vec) return true;
    return !FWOnetVectors.isObjectiveVectorActive(vec);
  }

  function renderActions(wrap) {
    var pb = profileBuildingState();
    wrap.innerHTML = AREAS.map(function (a) {
      const muted = a.muted ? ' portal-card--muted' : '';
      const accent = a.accent === 'sky' ? ' portal-card--accent-sky' : '';
      const hint = (a.hint && showProfileHint(pb)) || (a.resumeHint && showResumeHint())
        ? ' portal-card-hint' : '';
      return '<button type="button" class="portal-card' + muted + accent + hint + '" data-portal-area="' + esc(a.key) + '">'
        + '<span class="portal-card-icon"><i data-lucide="' + esc(a.icon) + '"></i></span>'
        + '<span class="portal-card-body">'
        + '<span class="portal-card-label">' + esc(a.label) + '</span>'
        + '<span class="portal-card-desc">' + esc(a.desc) + '</span>'
        + '</span>'
        + '<span class="portal-card-arrow" aria-hidden="true">&rarr;</span>'
        + '</button>';
    }).join('');
    wrap.querySelectorAll('[data-portal-area]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const area = AREAS.find(function (a) { return a.key === btn.getAttribute('data-portal-area'); });
        if (area && typeof area.go === 'function') area.go();
      });
    });
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  }

  function onObjectiveUpdated() {
    var actions = document.getElementById('portal-actions');
    if (actions) renderActions(actions);
    var profileEntry = document.getElementById('portal-profile-entry');
    var data = profile();
    if (profileEntry) renderProfileEntry(profileEntry, data);
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('fw-objective-updated', onObjectiveUpdated);
  }

  function renderSnapshot(wrap, data, snapshot) {
    const hasQuiz = data && data.scores && Object.keys(data.scores).length;
    if (!hasQuiz) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';

    const localRoadmap = readLocalRoadmap();

    const resolvedTarget = (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function')
      ? FWCareerTarget.resolveTargetCareer() : null;

    let html = '';
    let roadmapForPanel = null;

    if (resolvedTarget && global.FWCareerTarget) {
      const qz = profile();
      const localRoadmapForFocus = localRoadmap && global.FWRoadmapTree && FWRoadmapTree.ensureFocusTracker
        ? FWRoadmapTree.ensureFocusTracker(localRoadmap, qz && qz.scores ? qz.scores : null)
        : localRoadmap;
      roadmapForPanel = localRoadmapForFocus;
      html += '<div class="portal-panel portal-panel--wide portal-panel--focus" id="portal-focus-panel">'
        + '<div class="sgt-focus-loading" id="portal-focus-loading" hidden>Loading your next waypoint…</div>'
        + '<div class="portal-panel-accent" aria-hidden="true"></div>'
        + '<h2 class="portal-panel-title">Skill gaps</h2>'
        + '<div id="portal-skill-gap-tracker"></div>'
        + '</div>';
    } else {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }

    wrap.innerHTML = html;
    mountPortalFocusPanel(roadmapForPanel, resolvedTarget, localRoadmap);
    bindPortalSnapshotDelegation();
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  }

  function showPortalSwitchError(message) {
    console.warn(message);
    if (global.FWPortalTargetSwitch && typeof FWPortalTargetSwitch.showError === 'function') {
      FWPortalTargetSwitch.showError(message);
      return;
    }
    var slot = document.getElementById('portal-target-switch-slot');
    var row = slot && slot.querySelector('.portal-target-row');
    if (row) {
      var err = row.querySelector('.portal-target-switch-error');
      if (!err) {
        err = document.createElement('p');
        err.className = 'portal-target-switch-error';
        err.setAttribute('role', 'alert');
        row.appendChild(err);
      }
      err.textContent = message;
      setTimeout(function () {
        if (err && err.parentNode) err.parentNode.removeChild(err);
      }, 4200);
      return;
    }
    if (global.FWFwToast && typeof FWFwToast.show === 'function') {
      FWFwToast.show(message);
    }
  }

  function refreshPortalCareerUi() {
    const head = document.getElementById('portal-head');
    const banner = document.getElementById('portal-prompt-banner');
    const emptyQuiz = document.getElementById('portal-empty-quiz');
    const actions = document.getElementById('portal-actions');
    const snapshot = document.getElementById('portal-snapshot');
    const profileEntry = document.getElementById('portal-profile-entry');
    const data = profile();
    if (head) {
      if (head.querySelector('#portal-target-row')) {
        updateTargetSwitch(data);
      } else {
        renderHead(head, data, userEmail());
      }
    }
    if (banner) renderPromptBanner(banner, data);
    if (emptyQuiz) renderEmptyQuizPromo(emptyQuiz, data);
    if (actions) renderActions(actions);
    if (profileEntry) {
      renderProfileEntry(profileEntry, data);
      updateProfileDrawerContent(data, portalSnapshotFromData(data));
    }
    if (snapshot) {
      const savedSnap = portalSnapshotFromData(data);
      const localRm = readLocalRoadmap();
      const newKey = snapshotRenderKey(data, savedSnap, localRm);
      if (newKey !== lastSnapshotRenderKey) {
        renderSnapshot(snapshot, data, savedSnap);
        lastSnapshotRenderKey = newKey;
      }
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  }

  function render() {
    const head = document.getElementById('portal-head');
    const banner = document.getElementById('portal-prompt-banner');
    const emptyQuiz = document.getElementById('portal-empty-quiz');
    const actions = document.getElementById('portal-actions');
    const profileEntry = document.getElementById('portal-profile-entry');
    const snapshot = document.getElementById('portal-snapshot');
    if (!head || !actions || !snapshot) return;

    syncSignOutFooter();
    bindPortalSnapshotDelegation();
    ensureProfileDrawerShell();
    ensureProfileEntryDelegation(profileEntry);

    const data = profile();
    renderHead(head, data, userEmail());
    renderPromptBanner(banner, data);
    renderEmptyQuizPromo(emptyQuiz, data);
    renderActions(actions);
    renderProfileEntry(profileEntry, data);

    var savedSnap = portalSnapshotFromData(data);
    var fallback = savedSnap || (data ? fallbackSnapshot(data, careerPool(data.scores)) : null);
    var localRm = readLocalRoadmap();
    renderSnapshot(snapshot, data, savedSnap || fallback);
    lastSnapshotRenderKey = snapshotRenderKey(data, savedSnap || fallback, localRm);
    updateProfileDrawerContent(data, savedSnap || fallback);

    ensurePortalSnapshot(data).then(function (snap) {
      if (!data) return;
      var freshData = profile() || data;
      var resolvedSnap = snap || savedSnap || fallback;
      updateProfileDrawerContent(freshData, resolvedSnap);
      profileDrawerCtx.snap = resolvedSnap;
      var newKey = snapshotRenderKey(freshData, resolvedSnap, readLocalRoadmap());
      if (newKey !== lastSnapshotRenderKey) {
        lastSnapshotRenderKey = newKey;
        renderSnapshot(snapshot, freshData, resolvedSnap);
      }
    });

    if (data && data.scores) prefetchVectorRanking(data.scores);
    if (global.FWHubZoneFit && typeof FWHubZoneFit.resolveZoneFits === 'function') {
      FWHubZoneFit.resolveZoneFits().catch(function () { /* ignore */ });
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  }

  function syncSignOutFooter() {
    var footer = document.getElementById('portal-footer');
    var btn = document.getElementById('portal-signout-btn');
    if (!footer) return;
    var signedIn = !!(global.FWAuth && FWAuth.authEmail && FWAuth.authEmail());
    footer.hidden = !signedIn;
    if (btn && !btn._fwBound) {
      btn._fwBound = true;
      btn.addEventListener('click', function () {
        if (!global.FWAuth || typeof FWAuth.authLogout !== 'function') return;
        FWAuth.authLogout().catch(function () { /* ignore */ }).then(function () {
          var authUrl = (global.FWPageBoot && typeof FWPageBoot.authSignInUrl === 'function')
            ? FWPageBoot.authSignInUrl()
            : 'auth.html#signin';
          location.replace(authUrl);
        });
      });
    }
  }

  global.FWPortal = { render: render, AREAS: AREAS, syncSignOutFooter: syncSignOutFooter, refreshPortalCareerUi: refreshPortalCareerUi };

  if (global.FWCareerTarget && typeof FWCareerTarget.onCareerFocusChanged === 'function') {
    FWCareerTarget.onCareerFocusChanged(function () {
      refreshPortalCareerUi();
    });
  }

  if (global.FWRoadmapSync && typeof FWRoadmapSync.subscribe === 'function') {
    FWRoadmapSync.subscribe(function (detail) {
      if (detail && detail.source === 'portal') return;
      refreshPortalCareerUi();
    });
    if (typeof FWRoadmapSync.bindPageshowRefresh === 'function') {
      FWRoadmapSync.bindPageshowRefresh(function () {
        if (global.FWPortal && typeof FWPortal.render === 'function') {
          FWPortal.render();
        } else {
          refreshPortalCareerUi();
        }
      });
    }
  }

  global.addEventListener('fw-zone-fits-updated', function () {
    var data = profile();
    var profileEntry = document.getElementById('portal-profile-entry');
    if (profileEntry) renderProfileEntry(profileEntry, data);
    if (profileDrawerOpen) {
      updateProfileDrawerContent(data, portalSnapshotFromData(data));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
