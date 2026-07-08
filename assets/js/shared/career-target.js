/**
 * Shared target-career resolution, orb colors, and switch orchestration.
 */
(function (global) {
  const FOCUS_EVENT = 'fw:career-focus-changed';
  const RETARGET_WEIGHT_MIN = 75;
  let switchChain = Promise.resolve();

  function normalizeSlug(slug) {
    if (global.FWCareerFocusMigrate && typeof FWCareerFocusMigrate.normalizeSlug === 'function') {
      return FWCareerFocusMigrate.normalizeSlug(slug);
    }
    return String(slug || '').trim().toLowerCase();
  }

  function slugsEquivalent(a, b) {
    if (global.FWCareerFocusMigrate && typeof FWCareerFocusMigrate.slugsEquivalent === 'function') {
      return FWCareerFocusMigrate.slugsEquivalent(a, b);
    }
    return normalizeSlug(a) === normalizeSlug(b);
  }

  function fitRarity(score) {
    const s = Number(score) || 0;
    if (s >= 90) return { tier: 'mythic', base: '#FFD24A' };
    if (s >= 76) return { tier: 'legendary', base: '#F2A82E' };
    if (s >= 61) return { tier: 'epic', base: '#BD4AE8' };
    if (s >= 41) return { tier: 'rare', base: '#3FAEF0' };
    if (s >= 21) return { tier: 'uncommon', base: '#5ED152' };
    return { tier: 'common', base: '#9AA0AD' };
  }

  function quizData() {
    try {
      if (global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') return FWAuth.readLocalQuiz();
    } catch (_) { /* ignore */ }
    return null;
  }

  function readRoadmap() {
    try {
      if (global.FWAuth && typeof FWAuth.readLocalRoadmap === 'function') return FWAuth.readLocalRoadmap();
    } catch (_) { /* ignore */ }
    return null;
  }

  function careerSlugFromId(id) {
    if (!global.FWHubCareers || typeof FWHubCareers.careerSlug !== 'function') return '';
    return FWHubCareers.careerSlug(id) || '';
  }

  function formatFitPercent(score) {
    if (!Number.isFinite(score)) return '';
    return Math.round(Number(score)) + '%';
  }

  function displayRankScore(m) {
    if (!m) return null;
    if (m.rawScore != null && Number.isFinite(m.rawScore)) return m.rawScore;
    return Number.isFinite(m.score) ? m.score : null;
  }

  function mapOnetRankItems(items, limit) {
    return (items || []).slice(0, limit || 12).map(function (m) {
      var score = displayRankScore(m);
      return {
        id: m.id || (m.career && m.career.id),
        soc: m.soc || (m.career && m.career.soc) || null,
        name: m.name || (m.career && m.career.name) || '',
        score: score,
        slug: m.slug,
        rarity: fitRarity(score),
      };
    });
  }

  function mapFeaturedRankItems(items, limit) {
    return mapOnetRankItems(items, limit);
  }

  function legacyRankedCareerMatches(limit) {
    const q = quizData();
    if (!q || !q.scores || !global.FWHubCareers
      || typeof FWHubCareers.rankCareersFromQuizScores !== 'function') return [];
    try {
      return FWHubCareers.rankCareersFromQuizScores(q.scores).slice(0, limit || 12).map(function (m) {
        const slug = careerSlugFromId(m.career.id);
        return {
          id: m.career.id,
          name: m.career.name,
          score: m.score,
          slug: slug,
          rarity: fitRarity(m.score),
        };
      });
    } catch (_) {
      return [];
    }
  }

  function kickOnetRankRefresh(limit) {
    const q = quizData();
    if (!q || !q.scores || !global.FWOnetVectors
      || typeof FWOnetVectors.rankOnetCareersFromVectors !== 'function') return;
    FWOnetVectors.rankOnetCareersFromVectors({ scores: q.scores, limit: limit || 12 })
      .then(function () {
        if (global.FWPortal && typeof FWPortal.refreshPortalCareerUi === 'function') {
          FWPortal.refreshPortalCareerUi();
        }
      })
      .catch(function () { /* ignore */ });
  }

  function injectCurrentTarget(list, limit) {
    var out = (list || []).slice();
    var target = resolveTargetCareerRaw();
    if (!target || !target.slug) return out.slice(0, limit || 12);
    var present = out.some(function (m) {
      return m.slug === target.slug
        || (target.soc && m.soc === target.soc)
        || slugsEquivalent(m.slug, target.slug);
    });
    if (!present) {
      out.unshift({
        id: target.soc ? ('soc:' + target.soc) : target.slug,
        soc: target.soc || null,
        name: target.name,
        score: target.score,
        slug: target.slug,
        rarity: target.rarity || fitRarity(target.score || 50),
      });
    }
    return out.slice(0, limit || 12);
  }

  function rankedCareerMatchesBase(limit) {
    const q = quizData();
    const lim = limit || 12;
    if (global.FWOnetVectors && typeof FWOnetVectors.getCachedOnetRank === 'function') {
      var onetCached = FWOnetVectors.getCachedOnetRank(lim);
      if (onetCached && onetCached.length) {
        return mapOnetRankItems(onetCached, lim);
      }
      if (q && q.scores && typeof FWOnetVectors.rankOnetCareersFromVectors === 'function') {
        kickOnetRankRefresh(lim);
      }
    }
    if (global.FWOnetVectors && typeof FWOnetVectors.getCachedFeaturedRank === 'function') {
      var cached = FWOnetVectors.getCachedFeaturedRank(lim);
      if (cached && cached.length) {
        return mapFeaturedRankItems(cached, lim);
      }
      if (q && q.scores && typeof FWOnetVectors.rankFeaturedFromVectors === 'function') {
        FWOnetVectors.rankFeaturedFromVectors({ scores: q.scores, limit: lim }).catch(function () { /* ignore */ });
      }
    }
    if (global.FWOnetVectors) return [];
    return legacyRankedCareerMatches(lim);
  }

  function rankedCareerMatches(limit) {
    return injectCurrentTarget(rankedCareerMatchesBase(limit), limit);
  }

  function rankedCareerMatchesAsync(limit) {
    const q = quizData();
    const lim = limit || 12;
    if (global.FWOnetVectors && q && q.scores && typeof FWOnetVectors.rankOnetCareersFromVectors === 'function') {
      var onetCached = FWOnetVectors.getCachedOnetRank(lim);
      if (onetCached && onetCached.length) {
        return Promise.resolve(injectCurrentTarget(mapOnetRankItems(onetCached, lim), lim));
      }
      return FWOnetVectors.rankOnetCareersFromVectors({ scores: q.scores, limit: lim })
        .then(function (ranked) {
          if (ranked && ranked.length) {
            return injectCurrentTarget(mapOnetRankItems(ranked, lim), lim);
          }
          return injectCurrentTarget([], lim);
        })
        .catch(function () { return injectCurrentTarget([], lim); });
    }
    return Promise.resolve(rankedCareerMatches(lim));
  }

  function findRankHit(slug, soc) {
    const ranked = rankedCareerMatchesBase(40);
    var norm = normalizeSlug(slug);
    var hit = ranked.find(function (m) { return m.slug === slug || normalizeSlug(m.slug) === norm; });
    if (!hit && soc) hit = ranked.find(function (m) { return m.soc === soc; });
    if (!hit && slug && global.FWOnetVectors && FWOnetVectors.getCachedOnetRank) {
      var all = FWOnetVectors.getCachedOnetRank(782) || [];
      var onetHit = all.find(function (m) {
        return m.slug === slug || normalizeSlug(m.slug) === norm || (soc && m.soc === soc);
      });
      if (onetHit) {
        var score = displayRankScore(onetHit);
        return {
          id: onetHit.id,
          soc: onetHit.soc,
          name: onetHit.name,
          score: score,
          slug: onetHit.slug,
          rarity: fitRarity(score),
        };
      }
    }
    if (!hit && global.FWOnetCatalog && typeof FWOnetCatalog.getBySoc === 'function') {
      var row = soc ? FWOnetCatalog.getBySoc(soc) : FWOnetCatalog.getBySlug(slug);
      if (row) {
        var canonicalSlug = FWOnetCatalog.canonicalSlugForRow
          ? FWOnetCatalog.canonicalSlugForRow(row)
          : slug;
        return {
          id: 'soc:' + row.soc,
          soc: row.soc,
          name: row.title,
          score: null,
          slug: canonicalSlug,
          rarity: fitRarity(50),
        };
      }
    }
    return hit;
  }

  function resolveSlugFit(slug) {
    if (!slug || !global.FWOnetVectors) return Promise.resolve(null);
    var norm = normalizeSlug(slug);
    if (typeof FWOnetVectors.getCachedOnetRank === 'function') {
      var onetCached = FWOnetVectors.getCachedOnetRank(782);
      if (onetCached && onetCached.length) {
        var onetHit = onetCached.find(function (m) {
          return m.slug === slug || normalizeSlug(m.slug) === norm;
        });
        var onetScore = onetHit ? displayRankScore(onetHit) : null;
        if (onetScore != null) return Promise.resolve(onetScore);
      }
    }
    var cached = FWOnetVectors.getCachedFeaturedRank ? FWOnetVectors.getCachedFeaturedRank(45) : null;
    if (cached && cached.length) {
      var hit = cached.find(function (m) { return m.slug === slug || normalizeSlug(m.slug) === norm; });
      var score = hit ? displayRankScore(hit) : null;
      if (score != null) return Promise.resolve(score);
    }
    if (typeof FWOnetVectors.fitForSlugFromVectors === 'function') {
      return FWOnetVectors.fitForSlugFromVectors(slug).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function buildTarget(slug, name, source, soc) {
    const hit = findRankHit(slug, soc);
    return {
      slug: slug,
      name: name,
      soc: soc || (hit && hit.soc) || null,
      source: source,
      score: hit ? hit.score : null,
      rarity: hit ? hit.rarity : fitRarity(50),
    };
  }

  function focusIsActive(focus, roadmap) {
    if (!focus || !focus.slug || !focus.name) return false;
    if ((focus.weight || 0) >= RETARGET_WEIGHT_MIN) return true;
    var strongSource = focus.source === 'build_roadmap'
      || focus.source === 'home_dropdown'
      || focus.source === 'legacy_migration'
      || focus.source === 'coach_pivot'
      || focus.source === 'home_advisor';
    if (strongSource && (focus.weight || 0) > 0) return true;
    if (roadmap && roadmap.targetCareerSlug
      && slugsEquivalent(roadmap.targetCareerSlug, focus.slug)) return true;
    return false;
  }

  function resolveTargetCareerRaw() {
    const q = quizData();
    const roadmap = readRoadmap();
    const focus = (q && q.careerFocus) ? q.careerFocus : null;

    if (focus && focusIsActive(focus, roadmap)) {
      var slug = normalizeSlug(focus.slug) || focus.slug;
      return buildTarget(slug, focus.name, focus.source || 'careerFocus', focus.soc);
    }

    if (roadmap && roadmap.targetCareerSlug && roadmap.targetCareerName
      && ((roadmap.nodes && roadmap.nodes.length) || (roadmap.phases && roadmap.phases.length))) {
      var roadmapSoc = (roadmap.fitContext && roadmap.fitContext.targetSoc) || null;
      return buildTarget(
        normalizeSlug(roadmap.targetCareerSlug) || roadmap.targetCareerSlug,
        roadmap.targetCareerName,
        'roadmap',
        roadmapSoc
      );
    }

    const top = rankedCareerMatchesBase(1)[0];
    if (top) {
      return {
        slug: top.slug,
        name: top.name,
        soc: top.soc || null,
        source: 'quiz_rank',
        score: top.score,
        rarity: top.rarity,
      };
    }

    return null;
  }

  function resolveTargetCareer() {
    return resolveTargetCareerRaw();
  }

  function dispatchFocusChanged(detail) {
    try {
      global.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: detail || {} }));
    } catch (_) { /* ignore */ }
  }

  function onCareerFocusChanged(fn) {
    if (typeof fn !== 'function') return function () {};
    global.addEventListener(FOCUS_EVENT, fn);
    return function () { global.removeEventListener(FOCUS_EVENT, fn); };
  }

  function gapsNeedRoadmap(target, roadmap) {
    if (!target || !target.slug) return false;
    if (roadmap && (roadmap.targetCareerSlug === target.slug || slugsEquivalent(roadmap.targetCareerSlug, target.slug))) {
      if (roadmap.focusTracker && Array.isArray(roadmap.focusTracker.skillGaps) && roadmap.focusTracker.skillGaps.length) {
        return false;
      }
      if (roadmap.fitContext && Array.isArray(roadmap.fitContext.topGaps) && roadmap.fitContext.topGaps.length) {
        return false;
      }
    }
    const q = quizData();
    if (!q || !q.scores) return false;
    const ranked = rankedCareerMatches(40);
    const hit = ranked.find(function (m) {
      return m.slug === target.slug || slugsEquivalent(m.slug, target.slug);
    });
    if (!hit) return false;
    return String(hit.id || '').indexOf('soc:') === 0;
  }

  function gapsForTarget(target, roadmap) {
    if (!target || !target.slug) return [];
    if (roadmap && (roadmap.targetCareerSlug === target.slug || slugsEquivalent(roadmap.targetCareerSlug, target.slug))
      && roadmap.focusTracker && Array.isArray(roadmap.focusTracker.skillGaps)
      && roadmap.focusTracker.skillGaps.length
      && global.FWSkillGapTracker && typeof FWSkillGapTracker.gapLabelsFromTracker === 'function') {
      return FWSkillGapTracker.gapLabelsFromTracker(roadmap);
    }
    if (roadmap && (roadmap.targetCareerSlug === target.slug || slugsEquivalent(roadmap.targetCareerSlug, target.slug))
      && roadmap.fitContext && Array.isArray(roadmap.fitContext.vectorGaps)
      && roadmap.fitContext.vectorGaps.length) {
      return roadmap.fitContext.vectorGaps.map(function (g) { return g.name || g.label; }).filter(Boolean).slice(0, 4);
    }
    if (roadmap && (roadmap.targetCareerSlug === target.slug || slugsEquivalent(roadmap.targetCareerSlug, target.slug))
      && roadmap.fitContext && Array.isArray(roadmap.fitContext.topGaps)
      && roadmap.fitContext.topGaps.length) {
      return roadmap.fitContext.topGaps.slice(0, 4);
    }
    const q = quizData();
    if (!q || !q.scores || !global.FWHubCareers) return [];
    const ranked = rankedCareerMatches(40);
    const hit = ranked.find(function (m) {
      return m.slug === target.slug || slugsEquivalent(m.slug, target.slug);
    });
    if (!hit || typeof FWHubCareers.getCareerFitBreakdown !== 'function') return [];
    if (target.soc || (hit.id && String(hit.id).indexOf('soc:') === 0)) return [];
    try {
      const breakdown = FWHubCareers.getCareerFitBreakdown(hit.id, q.scores);
      return (breakdown && breakdown.gaps) ? breakdown.gaps.slice(0, 4) : [];
    } catch (_) {
      return [];
    }
  }

  function formatGapLabel(gap) {
    const s = String(gap || '').trim();
    if (!s) return '';
    if (global.FWHubCanvasBg && typeof FWHubCanvasBg.titleCaseSkill === 'function') {
      return FWHubCanvasBg.titleCaseSkill(s);
    }
    return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function switchPlaceholderText() {
    const current = resolveTargetCareer();
    const currentSlug = current && current.slug ? current.slug : '';
    const pool = rankedCareerMatches(5).filter(function (m) {
      return m.slug && m.slug !== currentSlug && m.name;
    });
    if (!pool.length) return 'Thinking about another career instead?';
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return 'Thinking about ' + pick.name + ' instead?';
  }

  function switchTargetCareer(opts) {
    if (!opts || !opts.slug || !opts.name || !opts.source) {
      return Promise.resolve(null);
    }
    if (!global.FWAuth || typeof FWAuth.recordCareerFocus !== 'function') {
      return Promise.resolve(null);
    }

    function doSwitch(payload) {
      const current = resolveTargetCareer();
      if (current && (current.slug === payload.slug || slugsEquivalent(current.slug, payload.slug))) {
        return Promise.resolve({ focus: FWAuth.readCareerFocus ? FWAuth.readCareerFocus() : null, skipped: true });
      }

      const hit = findRankHit(payload.slug, payload.soc);
      if (!payload.soc && hit && hit.soc) payload.soc = hit.soc;

      switchChain = switchChain.then(function () {
        return FWAuth.recordCareerFocus(payload).then(function (data) {
          if (data && data.focus && payload.soc && !data.focus.soc
            && typeof FWAuth.writeCareerFocus === 'function') {
            FWAuth.writeCareerFocus(Object.assign({}, data.focus, {
              soc: payload.soc,
              hubSlug: payload.hubSlug || data.focus.hubSlug,
            }));
          }
          if (data && data.careerFocusHistory && typeof FWAuth.writeCareerFocusHistory === 'function') {
            FWAuth.writeCareerFocusHistory(data.careerFocusHistory);
          }
          dispatchFocusChanged({
            focus: data && data.focus,
            roadmap: data && data.roadmap,
            roadmapRetargeted: !!(data && data.roadmapRetargeted),
            source: opts.source,
          });
          if (data && data.roadmapRetargeted) {
            if (global.FWFwToast && typeof FWFwToast.show === 'function') {
              FWFwToast.show('Your plan now targets ' + opts.name + '.');
            } else if (global.FWRoadmap && typeof FWRoadmap.showToast === 'function') {
              FWRoadmap.showToast('Your plan now targets ' + opts.name + '.');
            }
          }
          return data;
        });
      });
      return switchChain;
    }

    var payload = {
      slug: normalizeSlug(opts.slug) || opts.slug,
      name: opts.name,
      source: opts.source,
    };
    if (opts.soc) payload.soc = opts.soc;

    if (!opts.soc && global.FWCareerFocusMigrate && typeof FWCareerFocusMigrate.migrateFocus === 'function') {
      return FWCareerFocusMigrate.migrateFocus({
        slug: payload.slug,
        name: payload.name,
        soc: opts.soc || null,
        weight: RETARGET_WEIGHT_MIN,
        source: opts.source,
      }).then(function (migrated) {
        if (migrated) {
          payload.slug = migrated.slug || payload.slug;
          payload.name = migrated.name || payload.name;
          if (migrated.soc) payload.soc = migrated.soc;
          if (migrated.hubSlug) payload.hubSlug = migrated.hubSlug;
        }
        return doSwitch(payload);
      });
    }
    return doSwitch(payload);
  }

  global.FWCareerTarget = {
    formatFitPercent: formatFitPercent,
    fitRarity: fitRarity,
    resolveTargetCareer: resolveTargetCareer,
    rankedCareerMatches: rankedCareerMatches,
    rankedCareerMatchesAsync: rankedCareerMatchesAsync,
    resolveSlugFit: resolveSlugFit,
    switchTargetCareer: switchTargetCareer,
    onCareerFocusChanged: onCareerFocusChanged,
    dispatchFocusChanged: dispatchFocusChanged,
    gapsForTarget: gapsForTarget,
    gapsNeedRoadmap: gapsNeedRoadmap,
    formatGapLabel: formatGapLabel,
    switchPlaceholderText: switchPlaceholderText,
    normalizeSlug: normalizeSlug,
    FOCUS_EVENT: FOCUS_EVENT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
