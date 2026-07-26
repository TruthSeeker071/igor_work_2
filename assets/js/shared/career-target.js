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

  // Tier boundaries are canonical in FWOnetMath.fitTier (calibrated to the
  // current fit scale); this only owns the color per tier name.
  const RARITY_COLORS = {
    mythic: '#FFD24A', legendary: '#F2A82E', epic: '#BD4AE8',
    rare: '#3FAEF0', uncommon: '#5ED152', common: '#9AA0AD',
  };
  // resume.html loads this module WITHOUT onet-math.js, so the ladder and the
  // neutral placeholder need a local copy for that one page. This is the only
  // copy of either outside FWOnetMath — recalibrate it in the same commit that
  // recalibrates FIT_TIERS / FIT_NEUTRAL, or resume.html silently keeps the old
  // ladder.
  const LOCAL_FIT_TIERS = { mythic: 85, legendary: 75, epic: 60, rare: 45, uncommon: 30 };
  const LOCAL_FIT_NEUTRAL = 0;
  function localFitTier(s) {
    s = Number(s) || 0;
    if (s >= LOCAL_FIT_TIERS.mythic) return { tier: 'mythic' };
    if (s >= LOCAL_FIT_TIERS.legendary) return { tier: 'legendary' };
    if (s >= LOCAL_FIT_TIERS.epic) return { tier: 'epic' };
    if (s >= LOCAL_FIT_TIERS.rare) return { tier: 'rare' };
    if (s >= LOCAL_FIT_TIERS.uncommon) return { tier: 'uncommon' };
    return { tier: 'common' };
  }
  function fitRarity(score) {
    const t = (global.FWOnetMath && FWOnetMath.fitTier)
      ? FWOnetMath.fitTier(score) : localFitTier(score);
    return { tier: t.tier, base: RARITY_COLORS[t.tier] || RARITY_COLORS.common };
  }
  // "We have no fit for this yet" — a display placeholder, not a score. Callers
  // used to pass the literal 50, which reads as legendary the moment the ladder
  // moves down.
  function neutralFit() {
    return (global.FWOnetMath && FWOnetMath.FIT_NEUTRAL != null)
      ? FWOnetMath.FIT_NEUTRAL : LOCAL_FIT_NEUTRAL;
  }
  function neutralRarity() {
    return fitRarity(neutralFit());
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
      .then(function (ranked) {
        // Only re-render when the build actually produced data. Refreshing on
        // a failed build re-enters this kick from the render pass — an
        // infinite render→fetch loop whenever the vector endpoint is down.
        if (ranked && ranked.length
          && global.FWPortal && typeof FWPortal.refreshPortalCareerUi === 'function') {
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
        rarity: target.rarity || fitRarity(target.score || neutralFit()),
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
          rarity: neutralRarity(),
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
      rarity: hit ? hit.rarity : neutralRarity(),
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
          var pivot = data && data.pivot;
          // Any real pivot (a career-vs-career transfer %) opens the summary
          // modal — the per-coordinate breakdown is enrichment shown when the
          // objective vector is populated, but the modal renders fine without it
          // (it has its own empty-breakdown fallback). Gating the whole modal on
          // a breakdown meant users with an empty objective vector only ever saw
          // a toast and never the pivot surface at all.
          var hasPivot = !!(pivot && pivot.transferPct != null);
          // The modal already tells the user their roadmap was reordered, so the
          // retarget toast is only for the no-pivot case (e.g. first focus).
          if (data && data.roadmapRetargeted && !hasPivot) {
            var toastMsg = 'Your plan now targets ' + opts.name + '.';
            if (global.FWFwToast && typeof FWFwToast.show === 'function') {
              FWFwToast.show(toastMsg);
            } else if (global.FWRoadmap && typeof FWRoadmap.showToast === 'function') {
              FWRoadmap.showToast(toastMsg);
            }
          }
          if (hasPivot) {
            try { showPivotSummary(pivot, current && current.name, opts.name); } catch (_) {}
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

  // ── Pivot summary surface ─────────────────────────────────────────────────
  // Renders the quantified pivot breakdown returned by recordCareerFocus so a
  // career switch shows what carries over vs. what's new — not just a toast %.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function injectPivotCss() {
    if (document.getElementById('fw-pv-css')) return;
    var el = document.createElement('style');
    el.id = 'fw-pv-css';
    el.textContent = ''
      + '.fw-pv-overlay{position:fixed;inset:0;z-index:1250;background:rgba(8,10,18,.72);display:flex;align-items:center;justify-content:center;padding:18px;opacity:0;transition:opacity .25s ease;}'
      + '.fw-pv-overlay.show{opacity:1;}'
      + '.fw-pv-modal{background:var(--surface-solid,#141821);color:inherit;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:520px;width:100%;max-height:88vh;overflow-y:auto;padding:24px 24px 22px;position:relative;transform:translateY(12px) scale(.98);transition:transform .25s ease;}'
      + '.fw-pv-overlay.show .fw-pv-modal{transform:none;}'
      + '.fw-pv-close{position:absolute;top:10px;right:14px;background:none;border:none;color:inherit;font-size:22px;cursor:pointer;opacity:.7;line-height:1;}'
      + '.fw-pv-close:hover{opacity:1;}'
      + '.fw-pv-eye{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:4px;}'
      + '.fw-pv-title{margin:0 0 14px;font-size:19px;font-weight:700;line-height:1.25;}'
      + '.fw-pv-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:2px;}'
      + '.fw-pv-stats-solo{grid-template-columns:1fr;}'
      + '.fw-pv-stat{border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 14px;}'
      + '.fw-pv-stat-num{font-size:25px;font-weight:700;line-height:1;}'
      + '.fw-pv-stat-lbl{font-size:11.5px;opacity:.72;margin-top:6px;line-height:1.35;}'
      + '.fw-pv-group{margin-top:15px;}'
      + '.fw-pv-group-head{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;margin-bottom:8px;}'
      + '.fw-pv-dot{width:9px;height:9px;border-radius:50%;flex:none;}'
      + '.fw-pv-chips{display:flex;flex-wrap:wrap;gap:6px;}'
      + '.fw-pv-chip{font-size:12px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);}'
      + '.fw-pv-transfers .fw-pv-dot{background:#4caf72;}'
      + '.fw-pv-partial .fw-pv-dot{background:#e0a93a;}'
      + '.fw-pv-newgap .fw-pv-dot{background:#5b9bf0;}'
      + '.fw-pv-note{margin:15px 0 0;font-size:12.5px;opacity:.7;line-height:1.45;}'
      + '.fw-pv-cta{margin-top:18px;width:100%;padding:11px;border-radius:10px;border:none;background:rgb(var(--primary));color:#fff;font-size:14px;font-weight:600;cursor:pointer;}'
      + '.fw-pv-cta:hover{filter:brightness(1.06);}';
    (document.head || document.documentElement).appendChild(el);
  }

  var PIVOT_GROUPS = [
    { key: 'transfers', cls: 'fw-pv-transfers', label: 'Directly transferable', help: 'carry these straight over' },
    { key: 'partial',   cls: 'fw-pv-partial',   label: 'Partially transferable', help: 'a head start to build on' },
    { key: 'new_gap',   cls: 'fw-pv-newgap',    label: 'New strengths to build',  help: 'the focus of your new plan' },
  ];

  function showPivotSummary(pivot, fromName, toName) {
    if (!pivot || !document.body) return;
    var breakdown = Array.isArray(pivot.breakdown) ? pivot.breakdown : [];
    injectPivotCss();
    var overlay = document.createElement('div');
    overlay.className = 'fw-pv-overlay';
    var groupsHtml = PIVOT_GROUPS.map(function (g) {
      var items = breakdown.filter(function (b) { return b.status === g.key; });
      if (!items.length) return '';
      return '<div class="fw-pv-group ' + g.cls + '">'
        + '<div class="fw-pv-group-head"><span class="fw-pv-dot"></span>' + g.label
        + ' <span style="opacity:.55;font-weight:400">· ' + esc(g.help) + '</span></div>'
        + '<div class="fw-pv-chips">'
        + items.map(function (b) { return '<span class="fw-pv-chip">' + esc(b.name) + '</span>'; }).join('')
        + '</div></div>';
    }).join('');
    var overlapHtml = pivot.objectiveOverlapPct != null
      ? '<div class="fw-pv-stat"><div class="fw-pv-stat-num">' + pivot.objectiveOverlapPct + '%</div>'
        + '<div class="fw-pv-stat-lbl">of your background already lines up with this path</div></div>'
      : '';
    overlay.innerHTML = '<div class="fw-pv-modal" role="dialog" aria-modal="true" aria-label="Career pivot summary">'
      + '<button type="button" class="fw-pv-close" aria-label="Close">&times;</button>'
      + '<div class="fw-pv-eye">Your pivot</div>'
      + '<h3 class="fw-pv-title">' + esc(fromName || 'Your last focus') + ' &rarr; ' + esc(toName || 'new target') + '</h3>'
      + '<div class="fw-pv-stats' + (overlapHtml ? '' : ' fw-pv-stats-solo') + '">'
      + '<div class="fw-pv-stat"><div class="fw-pv-stat-num">' + (pivot.transferPct != null ? pivot.transferPct + '%' : '—') + '</div>'
      + '<div class="fw-pv-stat-lbl">of what you\'ve built carries over to ' + esc(toName || 'the new role') + '</div></div>'
      + overlapHtml
      + '</div>'
      + (groupsHtml || '<p class="fw-pv-note">Your new plan is being tuned to this target.</p>')
      + '<p class="fw-pv-note">Your roadmap has been reordered to close the biggest gaps first.</p>'
      + '<button type="button" class="fw-pv-cta">Got it</button>'
      + '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function closePv() {
      overlay.classList.remove('show');
      document.removeEventListener('keydown', onPvKey);
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 250);
    }
    function onPvKey(e) { if (e.key === 'Escape') closePv(); }
    overlay.querySelector('.fw-pv-close').addEventListener('click', closePv);
    overlay.querySelector('.fw-pv-cta').addEventListener('click', closePv);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePv(); });
    document.addEventListener('keydown', onPvKey);
  }

  global.FWCareerTarget = {
    formatFitPercent: formatFitPercent,
    fitRarity: fitRarity,
    neutralFit: neutralFit,
    neutralRarity: neutralRarity,
    showPivotSummary: showPivotSummary,
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
