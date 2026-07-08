/**
 * Gemini-personalized career deep dives: loading, quiz+AI fit, metrics, chat.
 */
(function (global) {
  const API = '/career-analysis';
  const CACHE_KEY = 'fw_career_analysis_v7';
  const HUB_QUIZ_KEY = 'fw_hub_quiz_v1';
  const EXCHANGE_RESET_AT = 5;

  let state = {
    slug: '',
    title: '',
    soc: '',
    analysis: null,
    quizFit: null,
    vectorFitDetails: null,
    dimensionRegistry: null,
    chatHistory: [],
    exchangeCount: 0,
    fitTab: 'assessed',
    staticFallback: null,
  };

  let personalizationCache = null;

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function titleCaseIndustry(key) {
    return String(key || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function coachUserId() {
    if (window.FWAuth && typeof FWAuth.authEmail === 'function') {
      return FWAuth.authEmail() || null;
    }
    return null;
  }

  // On sign-in, re-key any anonymous cached analyses to the user's namespace so
  // a deep dive viewed before logging in stays warm afterward (same device).
  function migrateAnonCache(email) {
    if (!email) return;
    try {
      const all = readJson(CACHE_KEY) || {};
      let changed = false;
      Object.keys(all).forEach(function (key) {
        if (key.indexOf('anon:') === 0) {
          const target = email + ':' + key.slice('anon:'.length);
          if (!all[target]) { all[target] = all[key]; }
          delete all[key];
          changed = true;
        }
      });
      if (changed) localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (_) { /* quota / parse */ }
  }

  function quizContext() {
    if (window.FWHubCareers && typeof FWHubCareers.initPersonalization === 'function') {
      if (!personalizationCache) {
        personalizationCache = FWHubCareers.initPersonalization();
      }
      const p = personalizationCache;
      if (p && p.hubQuizScores) {
        return {
          name: p.userName,
          scores: p.hubQuizScores,
          resumeSummary: p.resumeSummary,
          characterSummary: p.characterSummary,
          customAnswers: p.customAnswers,
          profileBuildingAnswers: p.profileBuildingAnswers || [],
        };
      }
    }
    const hub = readJson(HUB_QUIZ_KEY);
    if (hub && hub.scores) {
      return {
        name: hub.name || 'Student',
        scores: hub.scores,
        resumeSummary: hub.resumeSummary || '',
        characterSummary: hub.characterSummary || '',
        customAnswers: hub.customAnswers || [],
        profileBuildingAnswers: (hub.profileBuilding && hub.profileBuilding.answers)
          ? hub.profileBuilding.answers.filter(function (a) { return a && a.prompt && a.answer; }).slice(0, 8)
          : [],
      };
    }
    return null;
  }

  function hasResume() {
    const q = quizContext();
    return !!(q && q.resumeSummary);
  }

  function canPersonalize() {
    return !!(coachUserId() || (quizContext() && quizContext().scores));
  }

  function canFetchAiAnalysis() {
    return !!coachUserId();
  }

  function cacheId(userId, slug) {
    return (userId || 'anon') + ':' + slug;
  }

  function profileCacheKey() {
    var quiz = quizContext();
    var hash = '';
    if (window.FWAuth && typeof FWAuth.computePortalInputsHash === 'function' && quiz) {
      hash = FWAuth.computePortalInputsHash(quiz);
    }
    var focusSlug = '';
    if (window.FWAuth && typeof FWAuth.readCareerFocus === 'function') {
      var focus = FWAuth.readCareerFocus();
      focusSlug = (focus && focus.slug) ? focus.slug : '';
    }
    if (window.FWOnetVectors && typeof FWOnetVectors.vectorInputsHash === 'function' && quiz) {
      hash += '|' + FWOnetVectors.vectorInputsHash(quiz);
    }
    return hash + '|' + focusSlug;
  }

  function readCache(userId, slug) {
    const MAX_AGE = 6 * 3600 * 1000;
    try {
      const all = readJson(CACHE_KEY) || {};
      const hit = all[cacheId(userId, slug)];
      const profileKey = profileCacheKey();
      if (hit && hit.analysis && (Date.now() - (hit.at || 0)) < MAX_AGE) {
        if (hit.profileKey && hit.profileKey !== profileKey) return null;
        if (!hit.profileKey && profileKey) return null;
        return hit.analysis;
      }
    } catch (_) { /* quota */ }
    return null;
  }

  function writeCache(userId, slug, analysis) {
    try {
      const all = readJson(CACHE_KEY) || {};
      all[cacheId(userId, slug)] = {
        analysis: analysis,
        at: Date.now(),
        profileKey: profileCacheKey(),
      };
      const keys = Object.keys(all);
      if (keys.length > 24) {
        keys.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
        keys.slice(0, keys.length - 24).forEach(function (k) { delete all[k]; });
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (_) { /* quota */ }
  }

  function riskLabel(risk) {
    if (risk === 'low') return 'Low risk';
    if (risk === 'high') return 'High risk';
    return 'Moderate';
  }

  function aiBarClass(pct) {
    if (pct <= 30) return 'ai-bar-low';
    if (pct <= 50) return 'ai-bar-med';
    return 'ai-bar-high';
  }

  function compactFitBreakdown(fit) {
    if (!fit) return null;
    return {
      percent: fit.percent,
      strengths: (fit.strengths || []).slice(0, 3),
      gaps: (fit.gaps || []).slice(0, 2),
      mappedIndustries: (fit.mappedIndustries || []).slice(0, 3),
    };
  }

  function topQuizScores(scores, limit) {
    const n = limit || 10;
    if (!scores || typeof scores !== 'object') return {};
    return Object.fromEntries(
      Object.entries(scores)
        .filter(function (entry) { return Number(entry[1]) > 0; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, n),
    );
  }

  function mapAnalysisError(status, data) {
    if (status === 429) return 'Too many personalization requests—try again in a few minutes.';
    var msg = (data && data.error) || 'Personalization failed';
    if (msg === 'Could not generate personalized analysis. Please try again.' && state.soc) {
      return 'O*NET profile and quiz fit are shown — AI narrative is temporarily unavailable.';
    }
    return msg;
  }

  function degradedAnalysisMessage(rawMessage) {
    if (state.soc && (!rawMessage || rawMessage.indexOf('Could not generate') >= 0
      || rawMessage === 'Personalization failed')) {
      return 'O*NET profile and quiz fit are shown — AI narrative is temporarily unavailable.';
    }
    return rawMessage || 'AI personalization is unavailable — showing quiz-based fit only.';
  }

  function showPersonalizeError(message, showRetry) {
    var banner = document.getElementById('career-personal-err');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'career-personal-err';
      banner.className = 'career-personal-err';
      banner.setAttribute('role', 'status');
      var fitSection = document.querySelector('.career-fit-section');
      if (fitSection && fitSection.parentNode) {
        fitSection.parentNode.insertBefore(banner, fitSection);
      }
    }
    banner.innerHTML = '';
    var msgEl = document.createElement('p');
    msgEl.className = 'career-personal-err-msg';
    msgEl.textContent = degradedAnalysisMessage(message);
    banner.appendChild(msgEl);
    var actions = document.createElement('div');
    actions.className = 'career-personal-err-actions';
    var hubLink = document.createElement('a');
    hubLink.href = 'dashboard.html';
    hubLink.className = 'career-personal-hub-link';
    hubLink.textContent = 'Explore sector fit in Career Hub →';
    actions.appendChild(hubLink);
    if (showRetry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'career-personal-retry';
      btn.textContent = 'Try again';
      btn.addEventListener('click', retryPersonalize);
      actions.appendChild(btn);
    }
    banner.appendChild(actions);
    banner.hidden = false;
  }

  async function careerAuthFetch(path, options) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') {
      return FWAuth.authFetch(path, options);
    }
    return fetch(path, {
      method: (options && options.method) || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: options && options.body ? JSON.stringify(options.body) : undefined,
    });
  }

  function buildBaselineAnalysis(staticFallback, quizFit) {
    const fb = staticFallback || {};
    const overviewEl = document.querySelector('[data-career-personal="overview"] p');
    const quizPct = quizFit && typeof quizFit.percent === 'number' ? quizFit.percent : 0;
    return {
      overview: overviewEl ? overviewEl.textContent : '',
      responsibilities: [],
      daySchedule: [],
      skills: { core: [], other: [] },
      metrics: {
        entrySalary: fb.entrySalary,
        midSalary: fb.midSalary,
        seniorSalary: fb.seniorSalary,
        jobGrowth: fb.jobGrowth,
        jobGrowthLabel: fb.jobGrowthLabel,
        technicalScore: fb.technicalScore,
      },
      aiReplacement: {
        percent: fb.aiAutomation,
        outlook: fb.aiOutlook || '',
        tasks: Array.isArray(fb.aiTasks) ? fb.aiTasks : [],
      },
      fitScores: {
        quizFitPercent: quizPct,
        aiFitPercent: quizPct,
        resumeFitPercent: null,
        assessedFitPercent: quizPct,
      },
      closerLook: { summary: '', insights: [], considerations: [] },
      quickFacts: {},
    };
  }

  function retryPersonalize() {
    if (!state.slug) return;
    hidePersonalizeError();
    showLoading(true);
    showFab(false);
    var chain = Promise.resolve();
    if (state.soc) {
      chain = resolveVectorFitForSoc(state.soc).then(function (vf) {
        if (vf) state.vectorFitDetails = vf;
      });
    }
    chain.then(function () {
      return fetchPersonalized(state.slug, state.title, state.quizFit, {
        refresh: true,
        soc: state.soc,
      });
    }).then(function (analysis) {
      hidePersonalizeError();
      if (analysis) applyAnalysis(analysis);
      if (state.vectorFitDetails || state.quizFit) renderAssessedFit(state.analysis, state.quizFit);
      syncFabVisibility(false);
    }).catch(function (err) {
      console.warn('Career personalization retry failed', err);
      showPersonalizeError(err && err.message ? err.message : 'AI personalization failed.', true);
      if (state.vectorFitDetails || state.quizFit) renderAssessedFit(state.analysis, state.quizFit);
      ensureBaselineForChat();
      syncFabVisibility(true);
    }).finally(function () {
      showLoading(false);
    });
  }

  function hidePersonalizeError() {
    var banner = document.getElementById('career-personal-err');
    if (banner) banner.hidden = true;
  }

  function ensureShell() {
    if (document.getElementById('career-loading-overlay')) return;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="career-loading-overlay" class="career-loading-overlay" hidden>'
      + '<div class="career-loading-card"><div class="career-loading-spinner" aria-hidden="true"></div>'
      + '<h2>Personalizing your deep dive</h2>'
      + '<p>FlightWay AI is researching this career and your profile…</p></div></div>'
      + '<button type="button" id="career-ask-fab" class="career-ask-fab" hidden aria-label="Ask AI about this career">'
      + '<span aria-hidden="true">✦</span> Ask AI</button>'
      + '<div id="career-chat-drawer" class="career-chat-drawer" hidden>'
      + '<div class="career-chat-header"><div><div class="career-chat-eye">Deep dive assistant</div>'
      + '<h3 class="career-chat-title">Ask or refine</h3>'
      + '<p class="career-chat-sub" id="career-chat-count"></p></div>'
      + '<button type="button" class="career-chat-close" id="career-chat-close" aria-label="Close">×</button></div>'
      + '<div class="career-chat-messages" id="career-chat-messages"></div>'
      + '<div class="career-chat-input-row">'
      + '<textarea id="career-chat-input" class="career-chat-input" rows="2" placeholder="Ask a question or share context…" aria-label="Message"></textarea>'
      + '<button type="button" id="career-chat-send" class="career-chat-send">Send</button>'
      + '</div></div>');
    document.getElementById('career-chat-close').addEventListener('click', closeChat);
    document.getElementById('career-ask-fab').addEventListener('click', openChat);
    document.getElementById('career-chat-send').addEventListener('click', sendChat);
    document.getElementById('career-chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
  }

  function updateChatCount() {
    const el = document.getElementById('career-chat-count');
    if (!el) return;
    const left = EXCHANGE_RESET_AT - state.exchangeCount;
    el.textContent = left > 0
      ? left + ' message' + (left === 1 ? '' : 's') + ' until context refreshes'
      : 'Context refreshed — new thread started';
  }

  function showLoading(on) {
    ensureShell();
    const overlay = document.getElementById('career-loading-overlay');
    const fitSection = document.querySelector('.career-fit-section');
    if (overlay) overlay.hidden = true;
    if (fitSection) fitSection.classList.toggle('career-fit-section--loading', on);
    document.body.classList.toggle('career-page-loading', on);
  }

  function showFab(on) {
    const fab = document.getElementById('career-ask-fab');
    if (fab) fab.hidden = !on;
    const inline = document.querySelector('[data-career-personal="askAiBtn"]');
    if (inline) inline.hidden = !on;
  }

  function ensureBaselineForChat() {
    if (!state.analysis && state.staticFallback) {
      state.analysis = buildBaselineAnalysis(state.staticFallback, state.quizFit);
    }
  }

  function syncFabVisibility(analysisFailed) {
    if (!coachUserId()) {
      showFab(false);
      return;
    }
    ensureBaselineForChat();
    showFab(true);
    const sub = document.getElementById('career-chat-count');
    if (sub && analysisFailed) {
      sub.textContent = 'Analysis unavailable—ask to refine';
    } else {
      updateChatCount();
    }
  }

  function isMetricMissing(val) {
    const s = String(val == null ? '' : val).trim();
    return !s || s.toLowerCase() === 'n/a' || s === '0' || s === '0%' || s.includes('|');
  }

  function computeQuizFit(careerSlug) {
    if (!window.FWHubCareers || !FWHubCareers.getCareerFitBreakdown) return null;
    const quiz = quizContext();
    if (!quiz || !quiz.scores) return null;
    const id = FWHubCareers.careerIdFromSlug(careerSlug);
    if (!id) return null;
    return FWHubCareers.getCareerFitBreakdown(id, quiz.scores);
  }

  function socFromUrl() {
    try {
      return new URLSearchParams(location.search).get('soc') || '';
    } catch (_) {
      return '';
    }
  }

  function resolveQuizFit(careerSlug, fitScore, soc) {
    const resolvedSoc = soc || socFromUrl();
    // Vector fit only — the legacy 40-career industry breakdown
    // (computeQuizFit) uses a different scale and made the deep dive disagree
    // with the hub and portal for the same career. It remains solely as the
    // no-vector-module fallback below.
    if (window.FWOnetVectors && typeof FWOnetVectors.fitForSlugOrSoc === 'function') {
      return FWOnetVectors.fitForSlugOrSoc(careerSlug, resolvedSoc, fitScore).then(function (vectorFit) {
        if (vectorFit) return vectorFit;
        if (typeof fitScore === 'number') {
          return {
            percent: fitScore,
            strengths: [],
            gaps: [],
            mappedIndustries: [],
          };
        }
        return null;
      });
    }
    const legacy = computeQuizFit(careerSlug);
    if (legacy) return Promise.resolve(legacy);
    if (typeof fitScore === 'number') {
      return Promise.resolve({
        percent: fitScore,
        strengths: [],
        gaps: [],
        mappedIndustries: [],
      });
    }
    return Promise.resolve(null);
  }

  function buildStaticFromOnet(soc, slug) {
    if (!window.FWOnetCatalog || !window.FWHubStaticMetrics) return null;
    var row = soc && FWOnetCatalog.getBySoc ? FWOnetCatalog.getBySoc(soc) : null;
    if (!row && slug && FWOnetCatalog.getBySlug) row = FWOnetCatalog.getBySlug(slug);
    if (!row) return null;
    if (typeof FWHubStaticMetrics.buildOnetDeepDiveProfile === 'function') {
      return FWHubStaticMetrics.buildOnetDeepDiveProfile(row);
    }
    return FWHubStaticMetrics.forOnetRow(row);
  }

  function safeResolveQuizFit(careerSlug, fitScore, soc) {
    return Promise.resolve().then(function () {
      return resolveQuizFit(careerSlug, fitScore, soc);
    }).catch(function (err) {
      console.warn('resolveQuizFit failed', err);
      return null;
    });
  }

  function resolveVectorFitForSoc(soc) {
    if (!soc || !window.FWOnetVectors) return Promise.resolve(null);
    var promise;
    if (coachUserId() && typeof FWOnetVectors.fetchAuthenticatedVectorFit === 'function') {
      promise = FWOnetVectors.fetchAuthenticatedVectorFit(soc)
        .then(function (vf) { return vf || computeClientVectorFit(soc); });
    } else {
      promise = computeClientVectorFit(soc);
    }
    return promise.catch(function (err) {
      console.warn('vector fit failed', err);
      return null;
    });
  }

  function renderSkillsPills(skillItems) {
    var skills = document.querySelector('[data-career-personal="skills"]');
    if (!skills || !skillItems || !skillItems.length) return;
    skills.innerHTML = skillItems.map(function (item) {
      var pct = item.pct != null && !Number.isNaN(Number(item.pct)) ? Math.max(0, Math.min(100, Number(item.pct))) : 0;
      return '<span class="skill-pill" style="--skill-fill:' + pct + '%">'
        + '<span class="skill-pill-fill" aria-hidden="true"></span>'
        + '<span class="skill-pill-label">' + esc(item.name) + '</span></span>';
    }).join('');
  }

  function hydrateSkillsPillsFromSoc(soc, limit) {
    if (!soc || !window.FWOnetVectors || typeof FWOnetVectors.skillPillsDataForCareer !== 'function') return;
    FWOnetVectors.skillPillsDataForCareer(soc, limit || 5).then(function (items) {
      if (!items || !items.length) return;
      if (!state.staticFallback) state.staticFallback = {};
      state.staticFallback.coreSkills = items.map(function (i) { return i.name; });
      state.staticFallback.otherSkills = [];
      renderSkillsPills(items);
      renderStaticResponsibilitiesFromSkills(items.map(function (i) { return i.name; }));
    }).catch(function () { /* ignore */ });
  }

  function hydrateSkillsPillsFromNames(coreNames, otherNames) {
    var names = (coreNames || []).concat(otherNames || []);
    if (!names.length) return;
    var registry = state.dimensionRegistry;
    var render = function (reg) {
      var items = (window.FWOnetVectors && typeof FWOnetVectors.skillPillsDataFromNames === 'function')
        ? FWOnetVectors.skillPillsDataFromNames(names, reg)
        : names.map(function (name) { return { name: name, pct: 0 }; });
      renderSkillsPills(items);
    };
    if (registry) {
      render(registry);
      return;
    }
    if (window.FWOnetVectors && typeof FWOnetVectors.loadDimensionRegistry === 'function') {
      FWOnetVectors.loadDimensionRegistry().then(function (reg) {
        state.dimensionRegistry = reg;
        render(reg);
      }).catch(function () { render(null); });
      return;
    }
    render(null);
  }

  var ONET_DOMAIN_LABELS = {
    skills: 'Skills',
    knowledge: 'Knowledge',
    abilities: 'Abilities',
    workActivities: 'Work Activities',
  };

  var ONET_DOMAIN_LABELS = {
    skills: 'Skills',
    knowledge: 'Knowledge',
    abilities: 'Abilities',
    workActivities: 'Work Activities',
  };

  function fmt100(n, decimals) {
    if (global.FWFormatScale && typeof FWFormatScale.formatScale100 === 'function') {
      return FWFormatScale.formatScale100(n, decimals);
    }
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(decimals != null ? decimals : 1) + '/100';
  }

  function fmtOnetLevel(level) {
    return fmt100(level, 1);
  }

  function humanizeDomain(domain) {
    if (global.FWFormatScale && typeof FWFormatScale.humanizeOnetDomain === 'function') {
      return FWFormatScale.humanizeOnetDomain(domain);
    }
    return ONET_DOMAIN_LABELS[domain] || domain;
  }

  function renderOnetDomainPills(dimensions) {
    if (!dimensions || !dimensions.length) return '';
    return dimensions.map(function (d) {
      return '<span class="onet-domain-pill"><span class="onet-domain-pill-name">' + esc(d.name)
        + '</span><span class="onet-domain-pill-level">' + esc(fmtOnetLevel(d.level)) + '</span></span>';
    }).join('');
  }

  function renderOnetProfileTabs(profile, activeDomain) {
    var tabsEl = document.querySelector('[data-career-onet="profileTabs"]');
    var panelsEl = document.querySelector('[data-career-onet="profilePanels"]');
    if (!tabsEl || !panelsEl || !profile || !profile.byDomain) return;
    var domains = ['skills', 'knowledge', 'abilities', 'workActivities'];
    var active = activeDomain || 'skills';
    tabsEl.innerHTML = domains.map(function (domain) {
      var count = (profile.byDomain[domain] || []).length;
      if (!count) return '';
      return '<button type="button" class="onet-profile-tab' + (domain === active ? ' is-active' : '')
        + '" data-onet-domain="' + domain + '" role="tab">'
        + esc(ONET_DOMAIN_LABELS[domain] || domain) + '</button>';
    }).join('');
    function showDomain(domain) {
      tabsEl.querySelectorAll('[data-onet-domain]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-onet-domain') === domain);
      });
      panelsEl.innerHTML = renderOnetDomainPills(profile.byDomain[domain] || []);
    }
    showDomain(active);
    tabsEl.querySelectorAll('[data-onet-domain]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showDomain(btn.getAttribute('data-onet-domain'));
      });
    });
  }

  function renderDayScheduleSkeleton() {
    var schedule = document.querySelector('[data-career-personal="daySchedule"]');
    if (!schedule) return;
    var times = ['9:00 AM', '11:30 AM', '2:00 PM', '4:30 PM'];
    schedule.innerHTML = times.map(function (time) {
      return '<div class="timeline-item timeline-item--skeleton">'
        + '<div class="timeline-time">' + time + '</div>'
        + '<div class="timeline-content"><div class="timeline-skeleton-title"></div>'
        + '<div class="timeline-skeleton-desc"></div></div></div>';
    }).join('');
    var note = document.querySelector('[data-career-personal="dayScheduleNote"]');
    if (note) {
      note.textContent = 'Building a realistic day-in-life schedule…';
      note.hidden = false;
    }
  }

  function renderDayScheduleUnavailableNote() {
    var schedule = document.querySelector('[data-career-personal="daySchedule"]');
    if (!schedule || (state.analysis && state.analysis.daySchedule && state.analysis.daySchedule.length)) return;
    renderDayScheduleSkeleton();
    var note = document.querySelector('[data-career-personal="dayScheduleNote"]');
    if (note) {
      note.textContent = 'Day-in-life schedule unavailable — O*NET work activities are listed in the Role Profile above.';
      note.hidden = false;
    }
  }

  function clearDayScheduleNote() {
    var note = document.querySelector('[data-career-personal="dayScheduleNote"]');
    if (note) note.hidden = true;
  }

  function hydrateOnetProfile(soc) {
    if (!soc || !window.FWOnetVectors || typeof FWOnetVectors.buildCareerOnetProfile !== 'function') return;
    document.querySelectorAll('[data-career-onet-section]').forEach(function (el) {
      el.hidden = false;
    });
    FWOnetVectors.buildCareerOnetProfile(soc).then(function (profile) {
      if (!profile) return;
      state.onetProfile = profile;
      renderOnetProfileTabs(profile, 'skills');
      var demandEl = document.querySelector('[data-career-onet="demandBars"]');
      if (demandEl && window.FWOnetDimensionViewer
        && typeof FWOnetDimensionViewer.renderDemandBars === 'function') {
        FWOnetDimensionViewer.renderDemandBars(demandEl, profile.topOverall.slice(0, 8));
      }
      if (profile.onetRelease) {
        var sidebar = document.querySelector('[data-career-personal="quickFacts"]');
        if (sidebar && !sidebar.querySelector('[data-quick-fact="onet-release"]')) {
          sidebar.insertAdjacentHTML('beforeend',
            '<div class="sidebar-item" data-quick-fact="onet-release"><span class="label">O*NET release</span>'
            + '<span class="value">' + esc(profile.onetRelease) + '</span></div>');
        }
      }
    }).catch(function () { /* ignore */ });
  }

  function ensureObjectiveFromResume() {
    if (!window.FWOnetVectors || typeof FWOnetVectors.applyResumeToObjective !== 'function') return;
    var hub = readJson(HUB_QUIZ_KEY);
    var resumeText = String((hub && hub.resumeText) || '').trim();
    if (!resumeText || (hub && hub.objectiveSkipped)) return;
    var vecs = FWOnetVectors.readQuizVectors();
    var objVals = vecs && vecs.objective && vecs.objective.values;
    var mag = (objVals && FWOnetVectors.magnitude) ? FWOnetVectors.magnitude(objVals) : 0;
    if (mag > 0.01) return;
    var baseObj = (vecs && vecs.objective) || {
      schemaId: FWOnetVectors.SCHEMA || 'onet-lv-161-v1',
      values: FWOnetVectors.emptyVector(),
      sources: [],
    };
    var profiles = FWOnetVectors.getZoneProfilesSync ? FWOnetVectors.getZoneProfilesSync() : null;
    if (typeof FWOnetVectors.applyResumeWithPersonalityBleed === 'function') {
      var applied = FWOnetVectors.applyResumeWithPersonalityBleed(
        baseObj, vecs && vecs.personality, resumeText, profiles,
      );
      hub.objectiveVector = applied.objective;
      if (applied.personality) hub.personalityVector = applied.personality;
    } else {
      hub.objectiveVector = FWOnetVectors.applyResumeToObjective(baseObj, resumeText, profiles);
    }
    try { localStorage.setItem(HUB_QUIZ_KEY, JSON.stringify(hub)); } catch (_) { /* quota */ }
  }

  function hydrateUserOnetMatch(soc) {
    var section = document.querySelector('[data-career-onet="matchSection"]');
    var panel = document.querySelector('[data-career-onet="matchPanel"]');
    if (!section || !panel || !soc || !window.FWOnetVectors
      || typeof FWOnetVectors.userVsCareerDimensions !== 'function') return;
    ensureObjectiveFromResume();
    var vecs = FWOnetVectors.readQuizVectors ? FWOnetVectors.readQuizVectors() : null;
    var personality = vecs && vecs.personality && vecs.personality.values;
    var objective = vecs && vecs.objective && vecs.objective.values;
    if (!personality || !personality.length) {
      panel.innerHTML = '<p class="onet-dim-empty">Complete the Career Quiz to see how your O*NET profile compares to this role.</p>';
      section.hidden = false;
      return;
    }
    FWOnetVectors.userVsCareerDimensions(soc, personality, objective).then(function (match) {
      if (!match || !match.gaps.length) {
        panel.innerHTML = '<p class="onet-dim-empty">Your quiz vector is close to this role on top O*NET dimensions.</p>';
        section.hidden = false;
        return;
      }
      if (window.FWOnetDimensionViewer
        && typeof FWOnetDimensionViewer.renderUserVsCareerBars === 'function') {
        FWOnetDimensionViewer.renderUserVsCareerBars(panel, match.gaps, 8);
      }
      // FW2.0 A1 — "why this match" drawer, built from the same comparison rows
      // (no vector recompute). Cites the top O*NET coordinates driving the fit.
      if (window.FWWhyMatch && typeof FWWhyMatch.inject === 'function') {
        try {
          var whyPct = match.percent != null ? match.percent
            : (match.fit != null ? match.fit : null);
          FWWhyMatch.inject(section, match.gaps, whyPct, { k: 3 });
        } catch (_) { /* drawer is additive — never block the panel */ }
      }
      section.hidden = false;
    }).catch(function () {
      section.hidden = true;
    });
  }

  function hydrateOnetSkills(soc) {
    hydrateSkillsPillsFromSoc(soc, 5);
  }

  function renderStaticResponsibilitiesFromSkills(skillNames) {
    if (!skillNames || !skillNames.length) return;
    var resp = document.querySelector('[data-career-personal="responsibilities"]');
    if (!resp || resp.childElementCount) return;
    var items = skillNames.slice(0, 4).map(function (name) {
      return 'Apply ' + name.toLowerCase() + ' in day-to-day work for this role';
    });
    resp.innerHTML = items.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');
    var respSection = resp.closest('.career-resp-section');
    if (respSection) respSection.style.display = '';
  }

  function finishHydrateRender(opts) {
    opts = opts || {};
    if (state.vectorFitDetails || state.quizFit) {
      renderAssessedFit(state.analysis, state.quizFit);
    }
    if (state.soc) renderRelatedCareers(state.soc);
    if (opts.analysisFailed && canFetchAiAnalysis()) {
      showPersonalizeError(degradedAnalysisMessage(opts.analysisError), true);
      renderDayScheduleUnavailableNote();
      ensureBaselineForChat();
      syncFabVisibility(true);
    } else {
      hidePersonalizeError();
      syncFabVisibility(false);
    }
  }

  function renderFitMetricChips(vf, hasVectorFit, displayPct) {
    if (hasVectorFit) {
      var chips = [
        { label: 'Personality', value: vf.personalityFit },
      ];
      if (vf.objectiveFit != null) chips.push({ label: 'Objective', value: vf.objectiveFit });
      if (vf.preparedness != null && !Number.isNaN(vf.preparedness)) {
        chips.push({ label: 'Readiness', value: vf.preparedness });
      }
      return '<div class="fit-metric-chips">' + chips.map(function (chip) {
        return '<span class="fit-metric-chip"><span class="fit-metric-chip-label">' + esc(chip.label)
          + '</span><span class="fit-metric-chip-value">' + esc(fmt100(chip.value, 0)) + '</span></span>';
      }).join('') + '</div>';
    }
    return '<div class="fit-metric-chips"><span class="fit-metric-chip fit-metric-chip--solo">'
      + '<span class="fit-metric-chip-label">Assessed</span>'
      + '<span class="fit-metric-chip-value">' + esc(fmt100(displayPct, 0)) + '</span></span></div>';
  }

  function renderVectorGapDetails(vectorFit) {
    if (!vectorFit || !vectorFit.topGaps || !vectorFit.topGaps.length) return '';
    var registry = state.dimensionRegistry;
    var formatted = (window.FWOnetVectors && typeof FWOnetVectors.formatGapList === 'function' && registry)
      ? FWOnetVectors.formatGapList(vectorFit.topGaps, registry, 5)
      : { gaps: vectorFit.topGaps.map(function (g) {
        return { name: 'Dimension ' + g.index, domain: 'skill', gap: g.gap };
      }), labels: [] };
    var items = formatted.gaps.map(function (g) {
      return '<div class="fit-gap-card">'
        + '<span class="fit-gap-domain">' + esc(humanizeDomain(g.domain)) + '</span>'
        + '<span class="fit-gap-name">' + esc(g.name) + '</span>'
        + '<span class="fit-gap-val">Gap ' + esc(fmt100(g.gap, 1)) + '</span>'
        + '</div>';
    }).join('');
    var roadmapHref = 'roadmap.html?focus=1&career=' + encodeURIComponent(state.slug || '');
    if (state.soc) roadmapHref += '&soc=' + encodeURIComponent(state.soc);
    return '<div class="fit-subsection fit-subsection--gaps">'
      + '<h5 class="fit-subsection-title">Top O*NET gaps</h5>'
      + '<div class="fit-gap-grid">' + items + '</div>'
      + '<div class="fit-gaps-track"><a class="cta-btn cta-btn-outline fit-track-roadmap-btn" href="' + esc(roadmapHref) + '">Track on Career Roadmap</a></div>'
      + '</div>';
  }

  function renderAssessedFit(analysis, quizFit) {
    const el = document.querySelector('[data-career-personal="assessedFit"]');
    if (!el) return;
    const vf = state.vectorFitDetails || {};
    const hasVectorFit = vf.personalityFit != null
      && window.FWOnetVectors && typeof FWOnetVectors.renderDualFitBarsHtml === 'function';
    const fs = (analysis && analysis.fitScores) || {};
    const quizPct = fs.quizFitPercent != null ? fs.quizFitPercent : (quizFit ? quizFit.percent : 0);
    const assessed = fs.assessedFitPercent != null ? fs.assessedFitPercent : quizPct;

    const mapped = quizFit && quizFit.mappedIndustries
      ? quizFit.mappedIndustries.map(function (m) {
        return titleCaseIndustry(m.key) + ' ' + m.score + '%';
      }).join(' · ')
      : '';

    const strengthHtml = quizFit && (quizFit.strengths || []).length
      ? '<div class="fit-subsection fit-subsection--strengths"><h5 class="fit-subsection-title">Strengths</h5>'
        + '<div class="fit-strength-list">' + quizFit.strengths.map(function (s) {
          return '<span class="fit-strength-pill">' + esc(s) + '</span>';
        }).join('') + '</div></div>'
      : '';
    const gapHtml = quizFit && (quizFit.gaps || []).length && !hasVectorFit
      ? '<div class="fit-subsection fit-subsection--gaps"><h5 class="fit-subsection-title">Gaps to close</h5>'
        + '<p class="fit-gaps-inline">' + esc(quizFit.gaps.join(' · ')) + '</p>'
        + '<div class="fit-gaps-track"><a class="cta-btn cta-btn-outline fit-track-roadmap-btn" href="roadmap.html?focus=1">Track on Career Roadmap</a></div></div>'
      : '';
    const vectorGapHtml = state.vectorFitDetails ? renderVectorGapDetails(state.vectorFitDetails) : '';
    var roadmapHref = 'roadmap.html?career=' + encodeURIComponent(state.slug || '');
    if (state.soc) roadmapHref += '&soc=' + encodeURIComponent(state.soc);
    const roadmapCta = state.slug
      ? '<div class="fit-subsection fit-subsection--cta"><p class="fit-roadmap-cta"><a class="cta-btn cta-btn-outline" href="' + esc(roadmapHref) + '">Build roadmap for this career</a></p></div>'
      : '';

    let tabContent = '';
    if (!hasVectorFit && hasResume() && fs.quizFitPercent != null) {
      tabContent = '<div class="fit-tab-bar" role="tablist">'
        + '<button type="button" class="fit-tab' + (state.fitTab === 'assessed' ? ' is-active' : '') + '" data-fit-tab="assessed" role="tab">Your Assessed Fit</button>'
        + '<button type="button" class="fit-tab' + (state.fitTab === 'quiz' ? ' is-active' : '') + '" data-fit-tab="quiz" role="tab">Quiz Signals</button>'
        + '</div>';
    }

    const displayPct = state.fitTab === 'quiz' ? quizPct : assessed;
    const note = hasVectorFit
      ? (vf.objectiveFit != null
        ? 'Personality fit reflects who you are; objective fit reflects your background and credentials.'
        : 'Personality fit from your quiz vector. Add academics or a resume in Career Hub for objective fit.')
      : (state.fitTab === 'quiz'
        ? 'Raw Career Quiz industry mapping for this role.'
        : 'Blended from your quiz signals and AI profile analysis.');

    var dualHtml = hasVectorFit
      ? FWOnetVectors.renderDualFitBarsHtml(vf.personalityFit, vf.objectiveFit, {
        preparedness: vf.preparedness,
      })
      : '';

    const metricChips = renderFitMetricChips(vf, hasVectorFit, displayPct);

  el.innerHTML = tabContent
      + (hasVectorFit
        ? '<h4 class="fit-panel-head">How this career fits you</h4>' + metricChips + dualHtml
        : '<h4 class="fit-panel-head">How this career fits you</h4>' + metricChips)
      + '<p class="fit-quiz-note">' + note + '</p>'
      + (mapped ? '<div class="fit-mapped"><strong>Relevant quiz signals:</strong> ' + esc(mapped) + '</div>' : '')
      + strengthHtml + gapHtml + vectorGapHtml + roadmapCta;

    el.querySelectorAll('[data-fit-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.fitTab = btn.getAttribute('data-fit-tab');
        renderAssessedFit(state.analysis, state.quizFit);
      });
    });

    var section = el.closest('.career-fit-section');
    if (section) section.style.display = '';
  }

  var careerTitleBySocCache = null;

  function loadCareerTitleBySoc() {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.load === 'function') {
      return FWOnetCatalog.load().then(function () {
        careerTitleBySocCache = {};
        (FWOnetCatalog.getAll() || []).forEach(function (c) {
          if (c && c.soc) careerTitleBySocCache[c.soc] = c.title || c.soc;
        });
        return careerTitleBySocCache;
      }).catch(function () {
        careerTitleBySocCache = {};
        return careerTitleBySocCache;
      });
    }
    if (careerTitleBySocCache) return Promise.resolve(careerTitleBySocCache);
    careerTitleBySocCache = {};
    return Promise.resolve(careerTitleBySocCache);
  }

  function slugifyTitle(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function slugForSoc(soc, title) {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.getLegacySlugForSoc === 'function') {
      var catalogLegacy = FWOnetCatalog.getLegacySlugForSoc(soc);
      if (catalogLegacy) return catalogLegacy;
    }
    if (window.FWOnetVectors && typeof FWOnetVectors.getLegacySlugForSoc === 'function') {
      var legacy = FWOnetVectors.getLegacySlugForSoc(soc);
      if (legacy) return legacy;
    }
    if (title) return slugifyTitle(title);
    if (window.FWOnetCatalog && typeof FWOnetCatalog.getTitle === 'function') {
      return slugifyTitle(FWOnetCatalog.getTitle(soc));
    }
    return '';
  }

  function computeClientVectorFit(soc) {
    if (!soc || !window.FWOnetVectors || !window.FWOnetMath) return Promise.resolve(null);
    return Promise.all([
      FWOnetVectors.resolvePersonality({}),
      FWOnetVectors.fetchVectorsBatched([soc]),
    ]).then(function (parts) {
      var personality = parts[0];
      var vectors = parts[1] || {};
      var careerVec = vectors[soc];
      var objective = FWOnetVectors.readQuizVectors().objective;
      if (!personality || !careerVec) return null;
      var M = FWOnetMath;
      var entry = {
        personalityFit: M.cosinePercent(M.cosine(personality.values, careerVec)),
      };
      if (objective && objective.values && FWOnetVectors.magnitude(objective.values) > 0.01) {
        entry.objectiveFit = M.objectiveFitPercent
          ? M.objectiveFitPercent(objective.values, careerVec)
          : M.cosinePercent(M.cosine(objective.values, careerVec));
        if (typeof FWOnetVectors.computePreparedness === 'function') {
          entry.preparedness = FWOnetVectors.computePreparedness(objective.values, careerVec, {});
        }
      }
      if (typeof FWOnetVectors.overallFitScore === 'function') {
        entry.fitScore = FWOnetVectors.overallFitScore(entry.personalityFit, entry.objectiveFit ?? null);
      }
      return entry.personalityFit != null ? entry : null;
    }).catch(function () { return null; });
  }

  // Coordinate (dimension-level) profile for the current SOC, sent to the server
  // so the analysis prompt can name specific strengths/gaps. Non-blocking: resolves
  // null when vectors or the API are unavailable.
  function computeVectorDimensions(soc) {
    if (!soc || !window.FWOnetVectors
      || typeof FWOnetVectors.userVsCareerDimensions !== 'function') {
      return Promise.resolve(null);
    }
    var vecs = FWOnetVectors.readQuizVectors ? FWOnetVectors.readQuizVectors({ hydrate: true }) : null;
    var personality = vecs && vecs.personality && vecs.personality.values;
    var objective = vecs && vecs.objective && vecs.objective.values;
    if (!personality || !personality.length) return Promise.resolve(null);
    return FWOnetVectors.userVsCareerDimensions(soc, personality, objective).then(function (match) {
      if (!match) return null;
      function pack(item) {
        return {
          name: String(item.name || '').slice(0, 60),
          domain: String(item.domain || '').slice(0, 60),
          user: Math.max(0, Math.min(100, Math.round(Number(item.user) || 0))),
          target: Math.max(0, Math.min(100, Math.round(Number(item.target) || 0))),
          gap: Math.round(Number(item.gap) || 0),
          strength: Math.round(Number(item.strength) || 0),
        };
      }
      var strengths = (match.strengths || []).slice(0, 5).map(pack);
      var gaps = (match.gaps || []).slice(0, 6).map(pack);
      if (!strengths.length && !gaps.length) return null;
      return { strengths: strengths, gaps: gaps };
    }).catch(function () { return null; });
  }

  function renderRelatedCareers(soc) {
    var section = document.querySelector('[data-career-personal="relatedCareers"]');
    var listEl = document.querySelector('[data-career-personal="relatedList"]');
    if (!section || !listEl || !soc || !window.FWOnetVectors
      || typeof FWOnetVectors.fetchSimilarNeighbors !== 'function') {
      if (section) section.hidden = true;
      return;
    }
    Promise.all([
      FWOnetVectors.fetchSimilarNeighbors(soc, 8),
      loadCareerTitleBySoc(),
      FWOnetVectors.loadHubMap ? FWOnetVectors.loadHubMap() : Promise.resolve(),
    ]).then(function (parts) {
      var neighbors = parts[0] || [];
      var titles = parts[1] || {};
      var adjacent = neighbors.filter(function (n) { return n.relation === 'adjacent'; });
      var related = neighbors.filter(function (n) { return n.relation !== 'adjacent'; });
      var picks = adjacent.concat(related).slice(0, 5);
      if (!picks.length) {
        section.hidden = true;
        return;
      }
      listEl.innerHTML = picks.map(function (n) {
        var title = titles[n.soc] || n.soc;
        var slug = slugForSoc(n.soc, title);
        var href = slug
          ? ('career.html?slug=' + encodeURIComponent(slug) + '&soc=' + encodeURIComponent(n.soc))
          : '#';
        var badge = n.relation === 'adjacent' ? 'Adjacent' : 'Related';
        return '<a class="career-related-chip" href="' + esc(href) + '">'
          + '<span class="career-related-chip-name">' + esc(title) + '</span>'
          + '<span class="career-related-chip-badge">' + esc(badge) + '</span>'
          + '</a>';
      }).join('');
      section.hidden = false;
    }).catch(function () {
      section.hidden = true;
    });
  }

  function renderAiProfile(analysis) {
    const panel = document.querySelector('[data-career-personal="aiProfile"]');
    if (!panel) return;
    const fs = (analysis && analysis.fitScores) || {};
    const closerLook = (analysis && analysis.closerLook) || {};
    const quiz = quizContext();
    const aiPct = fs.aiFitPercent;
    const resumePct = fs.resumeFitPercent;
    const hasAiContent = typeof aiPct === 'number' || closerLook.summary || (quiz && quiz.characterSummary);

    if (!hasAiContent) {
      panel.hidden = true;
      return;
    }

    const insights = (closerLook.insights || []).map(function (i) {
      return '<li>' + esc(i) + '</li>';
    }).join('');
    const considerations = (closerLook.considerations || []).map(function (c) {
      return '<li>' + esc(c) + '</li>';
    }).join('');

    let scoreLine = '';
    if (typeof aiPct === 'number') {
      scoreLine = '<p class="fit-ai-score"><strong>AI fit score:</strong> ' + aiPct + '%</p>';
    }
    if (typeof resumePct === 'number') {
      scoreLine += '<p class="fit-ai-score"><strong>Resume fit score:</strong> ' + resumePct + '%</p>';
    }

    const summary = closerLook.summary
      || (quiz && quiz.characterSummary)
      || 'Personalized analysis based on your quiz profile and background.';

    panel.innerHTML = '<h4 class="fit-panel-head">AI Profile Analysis</h4>'
      + scoreLine
      + '<p class="fit-ai-summary">' + esc(summary) + '</p>'
      + (insights ? '<ul class="closer-insights">' + insights + '</ul>' : '')
      + (considerations ? '<p class="closer-consider-label"><strong>Consider:</strong></p><ul class="closer-considerations">' + considerations + '</ul>' : '');
    panel.hidden = false;
  }

  function applyMetrics(metrics) {
    if (!metrics) return;
    const fallback = state.staticFallback || {};
    function setMetric(key, val) {
      const use = isMetricMissing(val) ? fallback[key] : val;
      if (isMetricMissing(use)) return;
      document.querySelectorAll('[data-career-metric="' + key + '"]').forEach(function (n) {
        n.textContent = use;
      });
    }
    setMetric('entrySalary', metrics.entrySalary);
    setMetric('midSalary', metrics.midSalary);
    setMetric('seniorSalary', metrics.seniorSalary);
    setMetric('jobGrowth', metrics.jobGrowth);
    setMetric('jobGrowthLabel', metrics.jobGrowthLabel);
    const techVal = metrics.technicalScore != null && !isMetricMissing(metrics.technicalScore)
      ? metrics.technicalScore
      : fallback.technicalScore;
    if (techVal != null && !isMetricMissing(techVal)) {
      setMetric('technicalScore', techVal);
      document.querySelectorAll('[data-career-tech-bar]').forEach(function (bar) {
        bar.style.width = techVal + '%';
        bar.dataset.target = String(techVal);
      });
      document.querySelectorAll('.metric-technical-suffix').forEach(function (s) { s.style.display = ''; });
    }
  }

  function syncAiRisk(pct, outlook, tasks) {
    const cls = aiBarClass(pct);
    document.querySelectorAll('[data-career-ai-risk]').forEach(function (node) {
      node.textContent = pct;
    });
    document.querySelectorAll('[data-career-ai-bar]').forEach(function (bar) {
      if (bar.classList.contains('ai-bar-big-fill')) {
        bar.className = 'ai-bar-big-fill ' + cls;
      } else {
        bar.className = 'scale-bar-fill ' + cls;
      }
      bar.style.width = pct + '%';
      bar.dataset.target = String(pct);
    });
    const aiCard = document.querySelector('[data-career-personal="aiReplacement"]');
    if (aiCard) {
      const riskSpan = aiCard.querySelector('[data-career-ai-risk]');
      if (riskSpan) riskSpan.textContent = pct;
      const p = aiCard.querySelector('.ai-outlook-text');
      if (p && outlook) p.textContent = outlook;
      const taskEl = aiCard.querySelector('.ai-tasks');
      if (taskEl && tasks && tasks.length) {
        taskEl.innerHTML = tasks.map(function (t) {
          return '<div class="ai-task-row"><span class="ai-task-label">' + esc(t.task)
            + '</span><span class="ai-task-risk risk-' + t.risk + '">' + riskLabel(t.risk) + '</span></div>';
        }).join('');
      }
    }
  }

  // Ensure a personalization section exists in the DOM, inserting it relative to
  // an anchor when first created. Returns the section element (or null if the
  // anchor is missing so we can't place it).
  function ensurePersonalSection(key, className, anchorSelector, position) {
    var existing = document.querySelector('[data-career-personal="' + key + '"]');
    if (existing) return existing;
    var content = document.getElementById('career-content');
    if (!content) return null;
    var anchor = anchorSelector ? content.querySelector(anchorSelector) : null;
    var section = document.createElement('section');
    section.className = className;
    section.setAttribute('data-career-personal', key);
    section.hidden = true;
    if (anchor && position === 'before') {
      anchor.parentNode.insertBefore(section, anchor);
    } else if (anchor && position === 'after') {
      anchor.parentNode.insertBefore(section, anchor.nextSibling);
    } else {
      content.appendChild(section);
    }
    return section;
  }

  function renderWhatYouBring(analysis) {
    var wyb = analysis && analysis.whatYouBring;
    var section = ensurePersonalSection(
      'whatYouBring', 'career-section career-bring-section',
      '.career-fit-section', 'before',
    );
    if (!section) return;
    var summary = wyb && String(wyb.summary || '').trim();
    var points = (wyb && Array.isArray(wyb.points)) ? wyb.points.filter(Boolean) : [];
    if (!summary && !points.length) {
      section.hidden = true;
      section.innerHTML = '';
      return;
    }
    var cards = points.slice(0, 3).map(function (p) {
      return '<div class="bring-chip">' + esc(p) + '</div>';
    }).join('');
    section.innerHTML = '<div class="section-inner">'
      + '<div class="section-tag fade-in">Your edge</div>'
      + '<h2 class="section-title fade-in">What you already bring</h2>'
      + (summary ? '<p class="bring-summary fade-in">' + esc(summary) + '</p>' : '')
      + (cards ? '<div class="bring-chips fade-in">' + cards + '</div>' : '')
      + '</div>';
    section.hidden = false;
  }

  function renderEntryPath(analysis) {
    var ep = analysis && analysis.entryPath;
    var section = ensurePersonalSection(
      'entryPath', 'career-section career-entry-section',
      '.cta-section', 'before',
    );
    if (!section) return;
    var intro = ep && String(ep.intro || '').trim();
    var steps = (ep && Array.isArray(ep.steps)) ? ep.steps.filter(function (s) {
      return s && (s.title || s.desc);
    }) : [];
    if (!steps.length) {
      section.hidden = true;
      section.innerHTML = '';
      return;
    }
    var items = steps.slice(0, 4).map(function (s, i) {
      var gapTag = s.closesGap
        ? '<span class="entry-gap-tag">Closes gap: ' + esc(s.closesGap) + '</span>'
        : '';
      return '<li class="entry-step fade-in"><span class="entry-step-num">' + (i + 1) + '</span>'
        + '<div class="entry-step-body"><h5>' + esc(s.title || '') + '</h5>'
        + (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') + gapTag + '</div></li>';
    }).join('');
    section.innerHTML = '<div class="section-inner">'
      + '<div class="section-tag fade-in">Getting in</div>'
      + '<h2 class="section-title fade-in">Your entry path</h2>'
      + (intro ? '<p class="entry-intro fade-in">' + esc(intro) + '</p>' : '')
      + '<ol class="entry-steps fade-in">' + items + '</ol>'
      + '</div>';
    section.hidden = false;
  }

  function applyAnalysis(analysis) {
    state.analysis = analysis;

    const overview = document.querySelector('[data-career-personal="overview"] p');
    if (overview && analysis.overview) overview.textContent = analysis.overview;

    applyMetrics(analysis.metrics);
    renderAssessedFit(analysis, state.quizFit);
    renderAiProfile(analysis);
    renderWhatYouBring(analysis);
    renderEntryPath(analysis);

    const resp = document.querySelector('[data-career-personal="responsibilities"]');
    if (resp && analysis.responsibilities && analysis.responsibilities.length) {
      resp.innerHTML = analysis.responsibilities.map(function (r) {
        return '<li>' + esc(r) + '</li>';
      }).join('');
      var respSection = resp.closest('.career-resp-section');
      if (respSection) respSection.style.display = '';
    }

    const timeline = document.querySelector('[data-career-personal="daySchedule"]');
    if (timeline && analysis.daySchedule && analysis.daySchedule.length) {
      timeline.innerHTML = analysis.daySchedule.map(function (i) {
        return '<div class="timeline-item"><div class="timeline-time">' + esc(i.time)
          + '</div><div class="timeline-content"><h5>' + esc(i.title) + '</h5><p>' + esc(i.desc) + '</p></div></div>';
      }).join('');
      clearDayScheduleNote();
    }

    const skills = document.querySelector('[data-career-personal="skills"]');
    if (skills && analysis.skills) {
      var coreNames = analysis.skills.core || [];
      var otherNames = analysis.skills.other || [];
      hydrateSkillsPillsFromNames(coreNames, otherNames);
    }

    const aiPct = analysis.aiReplacement && analysis.aiReplacement.percent;
    const fallbackAi = state.staticFallback && state.staticFallback.aiAutomation;
    const resolvedAi = (typeof aiPct === 'number' && aiPct > 0) ? aiPct : fallbackAi;
    const aiOutlook = (analysis.aiReplacement && analysis.aiReplacement.outlook)
      || (state.staticFallback && state.staticFallback.aiOutlook);
    const aiTasks = (analysis.aiReplacement && analysis.aiReplacement.tasks && analysis.aiReplacement.tasks.length)
      ? analysis.aiReplacement.tasks
      : (state.staticFallback && state.staticFallback.aiTasks);
    if (typeof resolvedAi === 'number' && resolvedAi > 0) {
      syncAiRisk(resolvedAi, aiOutlook, aiTasks);
    }

    const sidebar = document.querySelector('[data-career-personal="quickFacts"]');
    if (sidebar && analysis.quickFacts) {
      var staticFacts = (state.staticFallback && state.staticFallback.sidebar) || {};
      var merged = Object.assign({}, staticFacts, analysis.quickFacts);
      if (staticFacts['O*NET SOC']) merged['O*NET SOC'] = staticFacts['O*NET SOC'];
      if (staticFacts['Job zone']) merged['Job zone'] = staticFacts['Job zone'];
      sidebar.innerHTML = Object.entries(merged).map(function (entry) {
        var valueClass = entry[0] === 'O*NET SOC' ? ' value sidebar-value--soc' : ' value';
        return '<div class="sidebar-item"><span class="label">' + esc(entry[0])
          + '</span><span class="' + valueClass.trim() + '">' + esc(entry[1]) + '</span></div>';
      }).join('');
    }

    const suffix = document.getElementById('career-personal-suffix');
    if (suffix) suffix.hidden = false;
  }

  async function fetchPersonalized(careerSlug, careerTitle, quizFit, opts) {
    opts = opts || {};
    const userId = coachUserId();
    if (!opts.refresh && !opts.skipCache) {
      const cached = readCache(userId, careerSlug);
      if (cached) return cached;
    }

    const quiz = quizContext();
    const body = { careerSlug: careerSlug, careerName: careerTitle, action: 'analyze' };
    if (opts.refresh) body.refresh = true;
    if (quiz) {
      body.quizScores = topQuizScores(quiz.scores);
      body.userName = quiz.name;
      if (quiz.resumeSummary) body.resumeSummary = quiz.resumeSummary.slice(0, 240);
      if (quiz.characterSummary) body.characterSummary = quiz.characterSummary.slice(0, 200);
      if (quiz.customAnswers && quiz.customAnswers.length) {
        body.customAnswers = quiz.customAnswers.slice(0, 4).map(function (a) {
          return {
            prompt: String(a.prompt || '').slice(0, 100),
            answer: String(a.answer || '').slice(0, 120),
          };
        });
      }
      if (quiz.profileBuildingAnswers && quiz.profileBuildingAnswers.length) {
        body.profileBuildingAnswers = quiz.profileBuildingAnswers.slice(0, 5).map(function (a) {
          return {
            prompt: String(a.prompt || '').slice(0, 100),
            answer: String(a.answer || '').slice(0, 120),
          };
        });
      }
    }
    if (quizFit) body.quizFitBreakdown = compactFitBreakdown(quizFit);
    if (state.vectorFitDetails) {
      body.vectorFit = {
        personalityFit: state.vectorFitDetails.personalityFit,
        objectiveFit: state.vectorFitDetails.objectiveFit,
        preparedness: state.vectorFitDetails.preparedness,
        fitScore: state.vectorFitDetails.fitScore,
        topGaps: state.vectorFitDetails.topGaps || [],
      };
      if (typeof state.vectorFitDetails.fitScore === 'number') {
        body.vectorFitPercent = state.vectorFitDetails.fitScore;
      } else if (typeof state.vectorFitDetails.personalityFit === 'number') {
        body.vectorFitPercent = state.vectorFitDetails.personalityFit;
      }
    } else if (quizFit && quizFit.vector && typeof quizFit.percent === 'number') {
      body.vectorFitPercent = quizFit.percent;
    }
    if (opts.soc) body.soc = opts.soc;
    else if (quizFit && quizFit.soc) body.soc = quizFit.soc;

    // Coordinate-level strengths/gaps for the analysis prompt. Non-blocking:
    // omitted when vectors or the SOC are unavailable.
    const dimSoc = body.soc || state.soc;
    const vectorDimensions = await computeVectorDimensions(dimSoc);
    if (vectorDimensions) body.vectorDimensions = vectorDimensions;
    if (state.staticFallback) {
      body.staticMetrics = {
        entrySalary: state.staticFallback.entrySalary,
        midSalary: state.staticFallback.midSalary,
        seniorSalary: state.staticFallback.seniorSalary,
        jobGrowth: state.staticFallback.jobGrowth,
        jobGrowthLabel: state.staticFallback.jobGrowthLabel,
        technicalScore: state.staticFallback.technicalScore,
        aiAutomation: state.staticFallback.aiAutomation,
        aiOutlook: state.staticFallback.aiOutlook,
        aiTasks: state.staticFallback.aiTasks,
      };
    }

    const resp = await careerAuthFetch(API, {
      method: 'POST',
      body: body,
      // Gemini analysis generation can exceed the 30s authFetch default.
      timeoutMs: 120000,
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(mapAnalysisError(resp.status, data));
    if (data.analysis) writeCache(userId, careerSlug, data.analysis);
    return data.analysis;
  }

  function openChat() {
    ensureShell();
    const drawer = document.getElementById('career-chat-drawer');
    if (drawer) drawer.hidden = false;
    const msgs = document.getElementById('career-chat-messages');
    if (msgs && !msgs.childElementCount) {
      msgs.innerHTML = '<div class="career-chat-msg assistant">Ask questions about this career, or tell me about your experience to refine the analysis.</div>';
    }
    updateChatCount();
  }

  function closeChat() {
    const drawer = document.getElementById('career-chat-drawer');
    if (drawer) drawer.hidden = true;
  }

  function resetChatThread() {
    state.chatHistory = [];
    state.exchangeCount = 0;
    const msgs = document.getElementById('career-chat-messages');
    if (msgs) {
      msgs.innerHTML = '<div class="career-chat-msg system">Conversation refreshed — your dossier was updated with what we discussed.</div>';
    }
    updateChatCount();
  }

  function appendChatMsg(role, text) {
    const msgs = document.getElementById('career-chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = 'career-chat-msg ' + role;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showChatTyping() {
    const msgs = document.getElementById('career-chat-messages');
    if (!msgs || document.getElementById('career-chat-typing')) return;
    const div = document.createElement('div');
    div.id = 'career-chat-typing';
    div.className = 'coach-typing';
    div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function hideChatTyping() {
    const t = document.getElementById('career-chat-typing');
    if (t) t.remove();
  }

  async function sendChat() {
    const input = document.getElementById('career-chat-input');
    const sendBtn = document.getElementById('career-chat-send');
    if (!input || !state.analysis) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendChatMsg('user', text);
    state.chatHistory.push({ role: 'user', content: text });
    if (sendBtn) sendBtn.disabled = true;
    showChatTyping();

    try {
      const quiz = quizContext();
      const body = {
        action: 'chat',
        careerSlug: state.slug,
        careerName: state.title,
        userMessage: text,
        currentAnalysis: state.analysis,
        history: state.chatHistory.slice(-10),
        exchangeCount: state.exchangeCount,
      };
      if (state.staticFallback) {
        body.staticMetrics = {
          entrySalary: state.staticFallback.entrySalary,
          midSalary: state.staticFallback.midSalary,
          seniorSalary: state.staticFallback.seniorSalary,
          jobGrowth: state.staticFallback.jobGrowth,
          jobGrowthLabel: state.staticFallback.jobGrowthLabel,
          technicalScore: state.staticFallback.technicalScore,
          aiAutomation: state.staticFallback.aiAutomation,
          aiOutlook: state.staticFallback.aiOutlook,
          aiTasks: state.staticFallback.aiTasks,
        };
      }
      if (quiz) {
        body.quizScores = quiz.scores;
        body.userName = quiz.name;
      }
      const userId = coachUserId();
      const resp = await careerAuthFetch(API, {
        method: 'POST',
        body: body,
        timeoutMs: 120000,
      });
      const data = await resp.json().catch(function () { return {}; });
      hideChatTyping();
      if (!resp.ok) throw new Error(mapAnalysisError(resp.status, data));

      appendChatMsg('assistant', data.reply || 'Done.');
      state.chatHistory.push({ role: 'assistant', content: data.reply || '' });

      if (data.intent === 'update' && data.analysis) {
        applyAnalysis(data.analysis);
        writeCache(userId, state.slug, data.analysis);
      }

      if (typeof data.exchangeCount === 'number') {
        state.exchangeCount = data.exchangeCount;
      } else {
        state.exchangeCount += 1;
      }

      if (data.reset) {
        resetChatThread();
      } else {
        updateChatCount();
      }

      if (data.roadmapRetargeted || data.focusUpdated) {
        if (global.FWAuth && typeof FWAuth.getRoadmap === 'function') {
          FWAuth.getRoadmap().catch(function () { /* ignore */ });
        }
        if (global.FWRoadmap && typeof FWRoadmap.showToast === 'function') {
          FWRoadmap.showToast('Your career plan was updated based on what you shared.');
        }
        if (global.FWRoadmap && typeof FWRoadmap.render === 'function') {
          FWRoadmap.render();
        }
      }

      if (data.dossierUpdated && global.FWAuth) {
        if (typeof FWAuth.bumpDossierFingerprint === 'function') FWAuth.bumpDossierFingerprint();
        if (typeof FWAuth.refreshPortalSnapshot === 'function') {
          FWAuth.refreshPortalSnapshot({ force: true }).catch(function () { /* ignore */ });
        }
      }

      if (data.sectorFitUpdated && global.FWAuth
          && typeof FWAuth.applySectorFitFromResponse === 'function') {
        FWAuth.applySectorFitFromResponse(data);
      }
      if (data.personalityVector && global.FWAuth
          && typeof FWAuth.applyVectorsFromResponse === 'function') {
        FWAuth.applyVectorsFromResponse(data);
      }
    } catch (err) {
      hideChatTyping();
      appendChatMsg('assistant', err.message || 'Something went wrong. Try again.');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function hydrateDeepDive(careerSlug, careerTitle, fitScore, staticFallback, opts) {
    opts = opts || {};
    ensureShell();
    state.slug = careerSlug;
    state.title = careerTitle;
    state.soc = opts.soc || socFromUrl();
    state.chatHistory = [];
    state.exchangeCount = 0;
    state.fitTab = 'assessed';
    state.dimensionRegistry = null;
    state.vectorFitDetails = null;

    var socPromise = (window.FWOnetVectors && typeof FWOnetVectors.resolveTargetSoc === 'function')
      ? FWOnetVectors.resolveTargetSoc(careerSlug, state.soc).catch(function () { return state.soc; })
      : Promise.resolve(state.soc);

    socPromise.then(function (resolvedSoc) {
      var soc = resolvedSoc || state.soc;
      // Runtime-derived (99-) careers aren't in the static catalog; the D1 row
      // must land before buildStaticFromOnet or the page boots titleless.
      if (soc && soc.indexOf('99-') === 0 && window.FWOnetCatalog
          && typeof FWOnetCatalog.ensureDerivedRow === 'function') {
        return FWOnetCatalog.ensureDerivedRow(soc)
          .catch(function () { return null; })
          .then(function () { return resolvedSoc; });
      }
      return resolvedSoc;
    }).then(function (resolvedSoc) {
      state.soc = resolvedSoc || state.soc;
      state.staticFallback = staticFallback || buildStaticFromOnet(state.soc, careerSlug) || null;

      if (state.staticFallback && state.staticFallback.coreSkills && state.staticFallback.coreSkills.length) {
        hydrateSkillsPillsFromNames(state.staticFallback.coreSkills, state.staticFallback.otherSkills);
      } else if (state.soc) {
        hydrateOnetSkills(state.soc);
      }
      if (state.soc) {
        hydrateOnetProfile(state.soc);
        hydrateUserOnetMatch(state.soc);
      }

      if (global.FWAuth && FWAuth.authEmail && FWAuth.authEmail()
        && typeof FWAuth.recordCareerFocus === 'function' && careerSlug && careerTitle) {
        FWAuth.recordCareerFocus({
          slug: careerSlug,
          name: careerTitle,
          soc: state.soc || undefined,
          source: 'deep_dive_view',
        }).catch(function () { /* ignore */ });
      }

      if (state.soc && state.soc.indexOf('99-') !== 0
        && global.FWAuth && FWAuth.authEmail && FWAuth.authEmail()) {
        careerAuthFetch('/derive-career', {
          method: 'POST',
          body: { baseSoc: state.soc },
          timeoutMs: 60000,
        }).then(function (resp) {
          return resp && resp.ok ? resp.json() : null;
        }).then(function (data) {
          if (data && Array.isArray(data.fragments) && data.fragments.length
            && window.FWOnetCatalog && typeof FWOnetCatalog.addDerivedRows === 'function') {
            FWOnetCatalog.addDerivedRows(data.fragments);
          }
        }).catch(function () { /* background fragment warm-up */ });
      }

      if (!canPersonalize()) {
        showLoading(false);
        showFab(false);
        return;
      }

      showLoading(true);
      showFab(false);
      if (canFetchAiAnalysis()) renderDayScheduleSkeleton();

      var registryPromise = (window.FWOnetVectors && FWOnetVectors.loadDimensionRegistry)
        ? FWOnetVectors.loadDimensionRegistry()
        : Promise.resolve(null);

      return registryPromise.then(function (registry) {
        state.dimensionRegistry = registry;
        return safeResolveQuizFit(careerSlug, fitScore, state.soc);
      }).then(function (quizFit) {
        state.quizFit = quizFit;
        return resolveVectorFitForSoc(state.soc);
      }).then(function (vectorFit) {
        if (vectorFit) state.vectorFitDetails = vectorFit;
        if (!canFetchAiAnalysis()) return { analysis: null, skipped: true };
        return fetchPersonalized(careerSlug, careerTitle, state.quizFit, { soc: state.soc })
          .then(function (analysis) { return { analysis: analysis, skipped: false }; })
          .catch(function (err) {
            return { analysis: null, skipped: false, error: err };
          });
      });
    }).then(function (result) {
      if (!result) return;
      if (result.analysis) {
        applyAnalysis(result.analysis);
      } else if (!result.skipped && canFetchAiAnalysis()) {
        ensureBaselineForChat();
      }
      finishHydrateRender({
        analysisFailed: !!(result.error && canFetchAiAnalysis()),
        analysisError: result.error && result.error.message
          ? result.error.message
          : 'AI personalization is unavailable — showing quiz-based fit only.',
      });
    }).catch(function (err) {
      console.warn('Career deep dive hydrate failed', err);
      finishHydrateRender({
        analysisFailed: canFetchAiAnalysis(),
        analysisError: (err && err.message) || 'Could not load personalization.',
      });
    }).finally(function () {
      showLoading(false);
      setTimeout(function () {
        document.querySelectorAll('.scale-bar-fill[data-target],.ai-bar-big-fill[data-target],[data-career-tech-bar]').forEach(function (b) {
          if (b.dataset.target) b.style.width = b.dataset.target + '%';
        });
      }, 200);
    });
  }

  if (typeof global !== 'undefined' && global.addEventListener) {
    global.addEventListener('fw-auth-change', function (e) {
      const email = e && e.detail && e.detail.email;
      if (email) migrateAnonCache(email);
      const careerPage = document.getElementById('page-career');
      if (email && state.slug && careerPage && careerPage.classList.contains('active')) {
        hydrateDeepDive(state.slug, state.title, state.quizFit && state.quizFit.percent, state.staticFallback);
      }
    });
    global.addEventListener('fw-objective-updated', function () {
      if (!state.soc) return;
      hydrateUserOnetMatch(state.soc);
      hydrateSkillsPillsFromSoc(state.soc, 5);
    });
  }

  global.FWCareerPersonalize = {
    hydrateDeepDive: hydrateDeepDive,
    fetchPersonalized: fetchPersonalized,
    canPersonalize: canPersonalize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
